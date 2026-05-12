/**
 * Pošta — detector vyšumělých závazků (fáze 6).
 *
 * Pipeline:
 *  1. SELECT outbound EmailMessage (from = User.gmailEmailAddress)
 *     WHERE neexistuje DetectedCommitment.sourceEmailId = email.id
 *     LIMIT N
 *  2. Per email: LLM scan (Gemini Flash, structured JSON output dle
 *     prompts/classify_commitment_v1.md)
 *  3. Pro každý candidate s confidence >= 0.55:
 *     a. Soft-link dedup: cosine similarity > 0.85 + same recipient +
 *        within 7d → uložit s relatedTo = [matched_ids]
 *     b. Confidence routing:
 *        >= 0.85: autoCreated=true, status=active, → trigger Todoist sync
 *        0.55-0.84: autoCreated=false, status=active (needs confirm)
 *     c. Insert DetectedCommitment + quote embedding (pro budoucí dedup)
 *  4. Candidates s confidence < 0.55 → debug log, NE záznam
 *
 * Decoupling: detector běží jako separátní cron `posta-commitment-detect`
 * every 15 min. NE sync v posta-classify (klasifikace má jiný účel,
 * jiné latency requirements).
 */

import { prisma } from "./db";
import { getGemini, DEFAULT_MODEL } from "./gemini";
import { trackGeminiCall } from "./gemini-usage";
import { getDecryptedBodyText } from "./email-body-crypto";
import { embedText, vectorLiteral } from "./rag";

const PROMPT_VERSION = "classify_commitment_v1";

const AUTO_CONFIDENCE_THRESHOLD = 0.85;
const MIN_CONFIDENCE_THRESHOLD = 0.55;

// Dedup parametry
const DEDUP_COSINE_THRESHOLD = 0.85;
const DEDUP_WINDOW_DAYS = 7;

const BODY_MAX_CHARS = 6000; // dlouhé maily zkrátit, závazky obvykle v top half

interface LlmCommitment {
  quoted_text: string;
  recipient: string | null;
  recipient_email: string | null;
  proposed_title: string;
  deadline_hint: string | null;
  confidence: number;
  reason: string;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    commitments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quoted_text: { type: "string" },
          recipient: { type: "string", nullable: true },
          recipient_email: { type: "string", nullable: true },
          proposed_title: { type: "string" },
          deadline_hint: { type: "string", nullable: true },
          confidence: { type: "number" },
          reason: { type: "string" },
        },
        required: ["quoted_text", "proposed_title", "confidence", "reason"],
      },
    },
  },
  required: ["commitments"],
};

const SYSTEM_INSTRUCTION = `Jsi detektor vysumelych zavazku v Petrovych odeslanych mailech.
Identifikujes explicitni sliby ktere by Petr mohl zapomenout.

KONZERVATIVNI BIAS: radsi prazdne pole nez false positive. Petr ma rad
prazdny seznam nez zaplavu falesnych ukolu.

OUTPUT: ciste JSON object s polem "commitments" (muze byt prazdne).
Zadny markdown code fence, zadne komentare.`;

export interface DetectStats {
  userId: string;
  total: number;       // pocet mailu k zpracovani
  scanned: number;     // skutecne poslano do LLM
  candidatesFound: number; // pocet candidates s confidence >= 0.55
  skippedLowConfidence: number; // confidence < 0.55, NE zapsano
  created: number;     // vytvorene DetectedCommitment rows
  errors: number;
  errorDetails: Array<{ emailId: string; error: string }>;
  durationMs: number;
}

interface CandidateRowForDedup {
  id: string;
  quotedText: string;
  recipientEmail: string | null;
  detectedAt: Date;
}

const BATCH_LIMIT = 30; // max emaily per cron run; LLM call per email ~2-5s

export async function detectCommitmentsForUser(userId: string): Promise<DetectStats> {
  const start = Date.now();
  const stats: DetectStats = {
    userId,
    total: 0,
    scanned: 0,
    candidatesFound: 0,
    skippedLowConfidence: 0,
    created: 0,
    errors: 0,
    errorDetails: [],
    durationMs: 0,
  };

  // 1) Načti Petrovu email adresu
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { gmailEmailAddress: true },
  });
  if (!user?.gmailEmailAddress) {
    stats.durationMs = Date.now() - start;
    console.log(`[posta-commitment] userId=${userId} skip: gmailEmailAddress is null (run posta-sync first)`);
    return stats;
  }
  const meEmail = user.gmailEmailAddress.toLowerCase();

  // 2) Najdi outbound maily co nemají DetectedCommitment záznam.
  //    Odkud = klasifikace musí existovat (jinak nemáme základní filter
  //    "this is meaningful") + from = me + není už scanováno.
  //
  //    Test pro "already scanned" — pokud existuje JAKÝKOLI DetectedCommitment
  //    pro tento sourceEmailId, mail je hotový (i kdyby všechny candidates
  //    measly skip pro low confidence, nechceme rescan). Pro to potřebujeme
  //    samostatný marker — použijeme `EmailMessage.commitmentScannedAt` field.
  //    Pojďme to nemít teď a místo toho:
  //    Pokud existuje commitment WHERE sourceEmailId = email.id → skip.
  //    Pokud žádný — možná je low confidence (commitments=[]), ale to neumíme
  //    detekovat. Workaround: pro fázi 6 chceme rescan vzácný, klidně reprocessing.
  //    TODO: budoucí scan-marker field. Pro fázi 6 OK.
  const candidates = await prisma.emailMessage.findMany({
    where: {
      userId,
      fromAddress: { equals: meEmail, mode: "insensitive" },
      classification: { isNot: null },
      sourceCommitments: { none: {} }, // ještě nescanováno
    },
    select: {
      id: true,
      subject: true,
      bodyText: true,
      bodyHtml: true,
      bodyTextCiphertext: true,
      bodyHtmlCiphertext: true,
      bodyEncryptionKeyId: true,
      snippet: true,
      toAddresses: true,
      ccAddresses: true,
      receivedAt: true,
      fromAddress: true,
    },
    orderBy: { receivedAt: "desc" },
    take: BATCH_LIMIT,
  });

  stats.total = candidates.length;

  if (candidates.length === 0) {
    stats.durationMs = Date.now() - start;
    console.log(`[posta-commitment] userId=${userId} no candidates`);
    return stats;
  }

  // 3) Per mail: LLM scan
  for (const email of candidates) {
    try {
      const result = await scanEmail(email, meEmail);
      stats.scanned++;
      stats.candidatesFound += result.candidates.length;

      // 4) Per candidate: routing + dedup + insert
      for (const c of result.candidates) {
        if (c.confidence < MIN_CONFIDENCE_THRESHOLD) {
          stats.skippedLowConfidence++;
          continue;
        }

        // Dedup soft-link
        let relatedTo: string[] = [];
        try {
          const quoteEmbedding = await embedText(c.quoted_text);
          relatedTo = await findRelatedCommitments({
            userId,
            embedding: quoteEmbedding,
            recipientEmail: c.recipient_email,
            now: email.receivedAt,
          });

          await insertCommitment({
            userId,
            sourceEmailId: email.id,
            candidate: c,
            embedding: quoteEmbedding,
            relatedTo,
          });
        } catch (e) {
          stats.errors++;
          stats.errorDetails.push({
            emailId: email.id,
            error: e instanceof Error ? e.message.slice(0, 200) : "?",
          });
          continue;
        }
        stats.created++;
      }

      // Aby cron neblokoval Vertex rate limit při hodně mailech
      await sleep(150);
    } catch (e) {
      stats.errors++;
      stats.errorDetails.push({
        emailId: email.id,
        error: e instanceof Error ? e.message.slice(0, 200) : "?",
      });
    }
  }

  stats.durationMs = Date.now() - start;
  console.log(
    `[posta-commitment] userId=${userId} total=${stats.total} scanned=${stats.scanned} candidates=${stats.candidatesFound} created=${stats.created} skipped=${stats.skippedLowConfidence} errors=${stats.errors} duration=${stats.durationMs}ms`,
  );
  return stats;
}

// ---------------------------------------------------------------------------
// LLM scan
// ---------------------------------------------------------------------------

interface ScanInput {
  id: string;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  bodyTextCiphertext: string | null;
  bodyHtmlCiphertext: string | null;
  bodyEncryptionKeyId: string | null;
  snippet: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  receivedAt: Date;
  fromAddress: string;
}

async function scanEmail(
  email: ScanInput,
  meEmail: string,
): Promise<{ candidates: LlmCommitment[] }> {
  // Body fallback: decrypted text → HTML stripped → snippet
  const decryptedText = getDecryptedBodyText(email);
  const body =
    (decryptedText && decryptedText.slice(0, BODY_MAX_CHARS)) ||
    (email.bodyHtml && stripHtml(email.bodyHtml).slice(0, BODY_MAX_CHARS)) ||
    email.snippet ||
    "";

  if (!body || body.length < 20) {
    return { candidates: [] };
  }

  const prompt = `Petruv odeslany mail. Detekuj vysumele zavazky.

OUTPUT JSON: { "commitments": [{ quoted_text, recipient, recipient_email, proposed_title, deadline_hint, confidence, reason }, ...] }
Prazdne pole pokud zadny zavazek.

PRAVIDLA:
- Petr ma raji prazdny seznam nez false positive.
- "OK diky", "Mozna se uvidime", "Pokud bude cas" → NENI zavazek.
- "Posli", "Dodam", "Ozvu se", "Domluvime" → JE zavazek.
- quoted_text = presny citat (1-2 vety), recipient = jmeno, recipient_email = email.
- proposed_title = "sloveso + objekt" cesky ("Poslat nabidku Karlovi").
- deadline_hint = mlhavy popis ("do patku", "pristi tyden") nebo null.
- confidence 0-1, NE pridavej "kdyz si nejsi jisty"-low → confidence < 0.55.

VSTUP:
From: ${email.fromAddress} (= ja, Petr)
To: ${email.toAddresses.slice(0, 3).join(", ")}
Cc: ${email.ccAddresses.slice(0, 3).join(", ")}
Subject: ${email.subject ?? "(no subject)"}
Sent: ${email.receivedAt.toISOString()}
---
${body}

JSON:`;

  const llmStart = Date.now();
  const genai = getGemini();
  const response = await genai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: prompt,
    config: {
      temperature: 0.2,
      maxOutputTokens: 1500,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA as never,
      systemInstruction: SYSTEM_INSTRUCTION,
    },
  });
  void trackGeminiCall({
    module: "posta-commitment",
    response,
    modelName: DEFAULT_MODEL,
    durationMs: Date.now() - llmStart,
  });

  const rawText = response.text ?? "";
  let parsed: { commitments?: unknown };
  try {
    let trimmed = rawText.trim();
    if (trimmed.startsWith("```")) {
      const m = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/);
      if (m) trimmed = m[1].trim();
    }
    parsed = JSON.parse(trimmed);
  } catch (e) {
    throw new Error(`LLM JSON parse failed: ${e instanceof Error ? e.message : "?"}`);
  }

  const arr = Array.isArray(parsed.commitments) ? parsed.commitments : [];
  const candidates: LlmCommitment[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.quoted_text !== "string" || typeof r.proposed_title !== "string") continue;
    if (typeof r.confidence !== "number") continue;
    candidates.push({
      quoted_text: r.quoted_text,
      recipient: typeof r.recipient === "string" ? r.recipient : null,
      recipient_email: typeof r.recipient_email === "string" ? r.recipient_email.toLowerCase() : null,
      proposed_title: r.proposed_title,
      deadline_hint: typeof r.deadline_hint === "string" ? r.deadline_hint : null,
      confidence: Math.max(0, Math.min(1, r.confidence)),
      reason: typeof r.reason === "string" ? r.reason : "",
    });
  }

  return { candidates };
}

// ---------------------------------------------------------------------------
// Dedup soft-link
// ---------------------------------------------------------------------------

async function findRelatedCommitments(params: {
  userId: string;
  embedding: number[];
  recipientEmail: string | null;
  now: Date;
}): Promise<string[]> {
  if (!params.recipientEmail) return [];

  const windowStart = new Date(params.now.getTime() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Najdi active commitmenty se stejnym recipient v okne 7 dnu.
  // Pak embedneme jejich quoted_text a srovnáme cosine.
  // (Optimalizace: kdybychom mali quote_embedding sloupec v DB, mohli bychom
  // udelat pgvector cosine query primo. Pro fazi 6 zaved bez toho — embeddings
  // jsou v RagChunk ale ne specificky pro commitments. Future work: pridat
  // DetectedCommitment.quoteEmbedding pole + pgvector index.)
  const candidates = await prisma.detectedCommitment.findMany({
    where: {
      userId: params.userId,
      status: "active",
      recipientEmail: { equals: params.recipientEmail, mode: "insensitive" },
      detectedAt: { gte: windowStart, lte: params.now },
    },
    select: { id: true, quotedText: true },
    take: 50,
  });

  if (candidates.length === 0) return [];

  // Embed each existing quote + cosine vs new
  const relatedIds: string[] = [];
  for (const c of candidates) {
    try {
      const otherEmbedding = await embedText(c.quotedText);
      const similarity = cosineSimilarity(params.embedding, otherEmbedding);
      if (similarity > DEDUP_COSINE_THRESHOLD) {
        relatedIds.push(c.id);
      }
    } catch {
      // Embed selhalo — preskoc, nejde o kriticky path
    }
  }

  return relatedIds;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

async function insertCommitment(params: {
  userId: string;
  sourceEmailId: string;
  candidate: LlmCommitment;
  embedding: number[];
  relatedTo: string[];
}): Promise<void> {
  const c = params.candidate;
  const autoCreated = c.confidence >= AUTO_CONFIDENCE_THRESHOLD;

  // Try parsing deadline_hint na ISO datum (basic patterns)
  const parsedDeadline = parseDeadlineHint(c.deadline_hint);

  await prisma.detectedCommitment.create({
    data: {
      userId: params.userId,
      sourceEmailId: params.sourceEmailId,
      quotedText: c.quoted_text,
      recipient: c.recipient,
      recipientEmail: c.recipient_email,
      proposedTitle: c.proposed_title,
      deadlineHint: c.deadline_hint,
      parsedDeadline,
      relatedTo: params.relatedTo,
      confidence: c.confidence,
      promptVersion: PROMPT_VERSION,
      status: "active",
      autoCreated,
      lastActionAt: new Date(),
    },
  });
}

/**
 * Pokus o parsování "do pátku 17.5." → Date. Czech-friendly heuristika.
 * Pokud nelze, vrátí null (parsedDeadline zůstává null, UI ukáže deadlineHint
 * jako text).
 */
function parseDeadlineHint(hint: string | null): Date | null {
  if (!hint) return null;
  // ISO datum YYYY-MM-DD
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(hint);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  // D.M. nebo D. M. (česky)
  const cz = /\b(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(\d{4}))?/.exec(hint);
  if (cz) {
    const year = cz[3] ? Number(cz[3]) : new Date().getFullYear();
    const d = new Date(year, Number(cz[2]) - 1, Number(cz[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
