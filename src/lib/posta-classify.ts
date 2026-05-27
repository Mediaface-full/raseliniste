/**
 * Pošta — klasifikátor mailů.
 *
 * Strategie:
 *   1. classifyEmail(emailId) — single mail přes Gemini Flash, structured JSON
 *      output dle prompts/classify_v1.md.
 *   2. classifyBatch(emailIds[]) — paralelně klasifikuje vícero mailů
 *      (concurrency 5 — Gemini Flash zvládne ale šetříme tokeny).
 *   3. classifyPendingForUser(userId, limit) — najde unclassified maily
 *      v DB a klasifikuje (max `limit`).
 *
 * Post-processing escalation override:
 *   Po LLM klasifikaci spustíme DB query: pokud od stejného `fromAddress`
 *   máme >=2 maily v posledních 7 dnech BEZ mojí odpovědi (= bez
 *   thread reply ode mě), nastavíme `escalation = true` i pokud LLM
 *   řekl false. `escalationDbOverride = true` pro audit.
 *
 * Idempotence: skipujeme maily co už mají EmailClassification záznam.
 * Reklasifikace = explicitní `force: true` flag (upsert override).
 */

import { prisma } from "./db";
import { getGemini, DEFAULT_MODEL } from "./gemini";
import { trackGeminiCall } from "./gemini-usage";
import { getDecryptedBodyText, getDecryptedBodyHtml } from "./email-body-crypto";

const PROMPT_VERSION = "classify_v1";

const ALLOWED_ACTION_TYPES = ["action_required", "waiting_external", "informational", "noise"] as const;
const ALLOWED_CONTENT_TYPES = [
  "klient", "osobni", "admin", "newsletter", "reklama",
  "systemovy", "bezpecnostni", "spam",
] as const;
const ALLOWED_URGENCY = ["low", "medium", "high"] as const;

type ActionType = (typeof ALLOWED_ACTION_TYPES)[number];
type ContentType = (typeof ALLOWED_CONTENT_TYPES)[number];
type Urgency = (typeof ALLOWED_URGENCY)[number];

interface LlmClassification {
  action_type: ActionType;
  content_type: ContentType;
  urgency: Urgency;
  escalation: boolean;
  suggested_action: string | null;
  project_hint: string | null;
  reason: string;
  confidence: number;
}

export interface ClassifyOptions {
  /** Reklasifikovat i pokud už záznam existuje. Default false. */
  force?: boolean;
  /** Přeskočit DB escalation post-processing (default false). */
  skipEscalationCheck?: boolean;
}

export interface ClassifyResult {
  emailId: string;
  ok: boolean;
  skipped?: boolean; // už klasifikováno + force=false
  classificationId?: string;
  llmEscalation?: boolean;
  finalEscalation?: boolean;
  durationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

const SYSTEM_INSTRUCTION = `Jsi klasifikator emailu pro Petrův Email Intelligence system "Rasellniste/Posta".
Tvuj ukol: pro kazdy mail vratit 7-poli ortogonalni klasifikaci v presnem JSON formatu.

NIKDY NEPOUZIVAJ jine hodnoty enumu nez ty co jsou v schema. Hodnoty zachovej presne
(action_required, ne Action-Required nebo ACTION_REQUIRED).

Output je ciste JSON object — zadny markdown code fence, zadne komentare, zadne """.`;

/**
 * Build user message s konkretnim mailem dle prompts/classify_v1.md.
 * Inline misto Read aby slozka /prompts v Docker image nemusela byt — promptiy
 * jsou stale soucasti binary.
 */
function buildClassifyPrompt(input: {
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  subject: string | null;
  receivedAt: Date;
  labels: string[];
  bodyTextOrSnippet: string;
}): string {
  return `Klasifikuj nasledujici email dle schema:

action_type: action_required | waiting_external | informational | noise
content_type: klient | osobni | admin | newsletter | reklama | systemovy | bezpecnostni | spam
urgency: low | medium | high
escalation: bool (eskalacni markery v textu — urgent/asap/"uz podruhe"/capslock/vyhruzky)
suggested_action: kratky string "sloveso + objekt" nebo null
project_hint: kratky string nebo null
reason: 1 veta proc tahle klasifikace, cesky
confidence: 0.0-1.0 (tvuj odhad jistoty)

PRAVIDLA:
- Hodnoty enumu PRESNE jak jsou (action_required, ne action-required).
- Automaty s lidskym jmenem (Jan Novak <noreply@bank.cz>) → kouknse na domenu,
  ne na jmeno. noreply@/mailer@/info@ + transakcni obsah = systemovy/admin.
- Anglicky mail: klasifikuj normalne, ale reason+suggested_action CZ.
- Prazdny body: jen subject+snippet, confidence <=0.5.
- "URGENT" v subject marketingu NENI escalation=true (jen skutecne emotion+repeat).
- NEDETEKUJ vysumele zavazky — to je separatni uloha.

VSTUP:
From: ${input.fromName ? `${input.fromName} <${input.fromAddress}>` : input.fromAddress}
To: ${input.toAddresses.slice(0, 5).join(", ")}${input.toAddresses.length > 5 ? `, +${input.toAddresses.length - 5}` : ""}
Subject: ${input.subject ?? "(no subject)"}
Received: ${input.receivedAt.toISOString()}
Labels: ${input.labels.join(", ") || "(none)"}
---
${input.bodyTextOrSnippet}

Vrat JSON:`;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    action_type: { type: "string", enum: ALLOWED_ACTION_TYPES as unknown as string[] },
    content_type: { type: "string", enum: ALLOWED_CONTENT_TYPES as unknown as string[] },
    urgency: { type: "string", enum: ALLOWED_URGENCY as unknown as string[] },
    escalation: { type: "boolean" },
    suggested_action: { type: "string", nullable: true },
    project_hint: { type: "string", nullable: true },
    reason: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["action_type", "content_type", "urgency", "escalation", "reason", "confidence"],
};

// ---------------------------------------------------------------------------
// Single-mail klasifikace
// ---------------------------------------------------------------------------

const BODY_MAX_CHARS = 4000; // šetříme tokeny — pro klasifikaci 4K char stačí

export async function classifyEmail(
  emailId: string,
  options: ClassifyOptions = {},
): Promise<ClassifyResult> {
  const start = Date.now();
  const result: ClassifyResult = { emailId, ok: false, durationMs: 0 };

  const email = await prisma.emailMessage.findUnique({
    where: { id: emailId },
    select: {
      id: true,
      userId: true,
      fromAddress: true,
      fromName: true,
      toAddresses: true,
      subject: true,
      snippet: true,
      // Faze 5: čteme i encrypted varianty + key id pro on-demand decrypt
      bodyText: true,
      bodyHtml: true,
      bodyTextCiphertext: true,
      bodyHtmlCiphertext: true,
      bodyEncryptionKeyId: true,
      receivedAt: true,
      labels: true,
      classification: { select: { id: true } },
    },
  });

  if (!email) {
    result.error = "EMAIL_NOT_FOUND";
    result.durationMs = Date.now() - start;
    return result;
  }

  if (email.classification && !options.force) {
    result.ok = true;
    result.skipped = true;
    result.classificationId = email.classification.id;
    result.durationMs = Date.now() - start;
    return result;
  }

  // Body fallback: decrypted text → decrypted HTML stripped → snippet → fallback
  // getDecryptedBodyText handluje encrypted vs legacy plain transparentně
  const decryptedText = getDecryptedBodyText(email);
  const decryptedHtml = decryptedText ? null : getDecryptedBodyHtml(email);
  const bodyTextOrSnippet =
    (decryptedText && decryptedText.slice(0, BODY_MAX_CHARS)) ||
    (decryptedHtml && stripHtml(decryptedHtml).slice(0, BODY_MAX_CHARS)) ||
    email.snippet ||
    "(prázdné tělo)";

  const prompt = buildClassifyPrompt({
    fromAddress: email.fromAddress,
    fromName: email.fromName,
    toAddresses: email.toAddresses,
    subject: email.subject,
    receivedAt: email.receivedAt,
    labels: email.labels,
    bodyTextOrSnippet,
  });

  let llmResult: LlmClassification;
  const llmStart = Date.now();
  try {
    const genai = getGemini();
    const response = await genai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: prompt,
      config: {
        temperature: 0.2,
        // Petr 2026-05-27: 800 tokenů classify obvykle stačí, ale občas
        // Gemini Flash thinking si vezme moc → truncated. Zvedáme + explicit
        // nízký thinking budget (stejně jako úkoly v process-task-audio.ts).
        maxOutputTokens: 2000,
        thinkingConfig: { thinkingBudget: 1024 },
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA as never,
        systemInstruction: SYSTEM_INSTRUCTION,
      },
    });
    void trackGeminiCall({
      module: "posta-classify",
      response,
      modelName: DEFAULT_MODEL,
      durationMs: Date.now() - llmStart,
    });

    const rawText = response.text ?? "";
    llmResult = parseAndValidate(rawText);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    result.durationMs = Date.now() - start;
    console.warn(`[posta-classify] emailId=${emailId} LLM failed: ${result.error.slice(0, 300)}`);
    return result;
  }

  // Post-processing: DB escalation override
  let finalEscalation = llmResult.escalation;
  let escalationDbOverride = false;
  if (!options.skipEscalationCheck && !llmResult.escalation) {
    const escalated = await checkEscalationByDb(
      email.userId,
      email.fromAddress,
      email.receivedAt,
    );
    if (escalated) {
      finalEscalation = true;
      escalationDbOverride = true;
    }
  }

  // Uloz/aktualizuj
  const classification = await prisma.emailClassification.upsert({
    where: { messageId: emailId },
    create: {
      messageId: emailId,
      actionType: llmResult.action_type,
      contentType: llmResult.content_type,
      urgency: llmResult.urgency,
      escalation: finalEscalation,
      suggestedAction: llmResult.suggested_action,
      projectHint: llmResult.project_hint,
      reason: llmResult.reason,
      model: `${DEFAULT_MODEL}+${PROMPT_VERSION}`,
      confidence: llmResult.confidence,
      escalationDbOverride,
    },
    update: {
      actionType: llmResult.action_type,
      contentType: llmResult.content_type,
      urgency: llmResult.urgency,
      escalation: finalEscalation,
      suggestedAction: llmResult.suggested_action,
      projectHint: llmResult.project_hint,
      reason: llmResult.reason,
      model: `${DEFAULT_MODEL}+${PROMPT_VERSION}`,
      confidence: llmResult.confidence,
      escalationDbOverride,
      classifiedAt: new Date(),
    },
  });

  result.ok = true;
  result.classificationId = classification.id;
  result.llmEscalation = llmResult.escalation;
  result.finalEscalation = finalEscalation;
  result.durationMs = Date.now() - start;
  return result;
}

// ---------------------------------------------------------------------------
// Batch klasifikace s concurrency limit
// ---------------------------------------------------------------------------

export interface BatchStats {
  userId: string;
  total: number;
  classified: number;
  skipped: number; // already done
  errors: number;
  errorDetails: Array<{ emailId: string; error: string }>;
  durationMs: number;
}

const BATCH_CONCURRENCY = 5;

export async function classifyBatch(
  emailIds: string[],
  options: ClassifyOptions = {},
): Promise<{ classified: number; skipped: number; errors: number; details: ClassifyResult[] }> {
  const results: ClassifyResult[] = [];

  // Process v dávkách po BATCH_CONCURRENCY paralelně
  for (let i = 0; i < emailIds.length; i += BATCH_CONCURRENCY) {
    const slice = emailIds.slice(i, i + BATCH_CONCURRENCY);
    const sliceResults = await Promise.all(
      slice.map((id) => classifyEmail(id, options).catch((e) => ({
        emailId: id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: 0,
      } as ClassifyResult))),
    );
    results.push(...sliceResults);
    // Mírná pauza mezi dávkami proti rate-limitu
    if (i + BATCH_CONCURRENCY < emailIds.length) {
      await sleep(200);
    }
  }

  return {
    classified: results.filter((r) => r.ok && !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
    errors: results.filter((r) => !r.ok).length,
    details: results,
  };
}

/**
 * Najde unclassified maily uživatele a klasifikuje je (max `limit`).
 * Vola se z cronu nebo manuálně.
 */
export async function classifyPendingForUser(
  userId: string,
  limit = 50,
): Promise<BatchStats> {
  const start = Date.now();

  const pending = await prisma.emailMessage.findMany({
    where: { userId, classification: null },
    select: { id: true },
    orderBy: { receivedAt: "desc" }, // novější priorita
    take: limit,
  });

  if (pending.length === 0) {
    return {
      userId,
      total: 0,
      classified: 0,
      skipped: 0,
      errors: 0,
      errorDetails: [],
      durationMs: Date.now() - start,
    };
  }

  const batch = await classifyBatch(
    pending.map((p) => p.id),
    { force: false },
  );

  const stats: BatchStats = {
    userId,
    total: pending.length,
    classified: batch.classified,
    skipped: batch.skipped,
    errors: batch.errors,
    errorDetails: batch.details
      .filter((d) => !d.ok)
      .map((d) => ({ emailId: d.emailId, error: d.error ?? "?" }))
      .slice(0, 20),
    durationMs: Date.now() - start,
  };

  console.log(
    `[posta-classify] userId=${userId} total=${stats.total} classified=${stats.classified} skipped=${stats.skipped} errors=${stats.errors} duration=${stats.durationMs}ms`,
  );
  return stats;
}

// ---------------------------------------------------------------------------
// Escalation DB check
// ---------------------------------------------------------------------------

/**
 * Vrátí `true` pokud od stejného `fromAddress` máme >=2 maily v posledních
 * 7 dnech (vč. právě klasifikovaného), bez existující reply ode mě.
 *
 * Heuristika "bez moji odpovědi": pro fázi 2 zjednodušená — kontrolujeme
 * jen jestli existuje EmailMessage ve stejném `threadId` kde
 * `fromAddress` patří uživateli (ale my zatím nemáme jeho mailovou adresu
 * v User... → fáze 5 to vylepší). Pro teď: pokud máme >=2 mailů od
 * stejného odesílatele, považujeme za eskalaci.
 *
 * TODO faze 5: po implementaci sent-mail importu (gmail.modify scope)
 * porovnávat real reply od usera.
 */
async function checkEscalationByDb(
  userId: string,
  fromAddress: string,
  cutoffDate: Date,
): Promise<boolean> {
  const sevenDaysAgo = new Date(cutoffDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recentFromSame = await prisma.emailMessage.count({
    where: {
      userId,
      fromAddress: { equals: fromAddress, mode: "insensitive" },
      receivedAt: { gte: sevenDaysAgo, lte: cutoffDate },
    },
  });
  return recentFromSame >= 2;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAndValidate(rawText: string): LlmClassification {
  let trimmed = rawText.trim();
  if (trimmed.startsWith("```")) {
    const m = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/);
    if (m) trimmed = m[1].trim();
  }

  // Petr 2026-05-27: tolerantní JSON parser — Gemini Flash často vrací
  // truncated nebo malformed JSON pro classification (49/50 errors v logu).
  // Stejný pattern jako u úkolů (process-task-audio.ts 5bbfc80):
  //   1. Najdi první balanced { ... } pomocí brace-stack scanu (sní přebytky)
  //   2. Pokud i tak fail, zkus oříznout na poslední validní `}` a parsing
  //   3. Pokud i tak fail, throw — caller (cron) si to zaloguje a přeskočí
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const balanced = extractFirstBalancedObject(trimmed);
    if (balanced) {
      try {
        parsed = JSON.parse(balanced);
      } catch (e2) {
        throw new Error(`LLM vrátil neparsovatelný JSON i po orezání: ${(e2 instanceof Error ? e2.message : "?")}. Text: ${trimmed.slice(0, 200)}`);
      }
    } else {
      throw new Error(`LLM vrátil neparsovatelný JSON bez balanced object. Text: ${trimmed.slice(0, 200)}`);
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("LLM vrátil ne-object JSON.");
  }
  const p = parsed as Record<string, unknown>;

  if (!ALLOWED_ACTION_TYPES.includes(p.action_type as ActionType)) {
    throw new Error(`Invalid action_type: ${String(p.action_type)}`);
  }
  if (!ALLOWED_CONTENT_TYPES.includes(p.content_type as ContentType)) {
    throw new Error(`Invalid content_type: ${String(p.content_type)}`);
  }
  if (!ALLOWED_URGENCY.includes(p.urgency as Urgency)) {
    throw new Error(`Invalid urgency: ${String(p.urgency)}`);
  }

  return {
    action_type: p.action_type as ActionType,
    content_type: p.content_type as ContentType,
    urgency: p.urgency as Urgency,
    escalation: Boolean(p.escalation),
    suggested_action: typeof p.suggested_action === "string" ? p.suggested_action : null,
    project_hint: typeof p.project_hint === "string" ? p.project_hint : null,
    reason: typeof p.reason === "string" ? p.reason : "",
    confidence: typeof p.confidence === "number" ? p.confidence : 0.5,
  };
}

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

/**
 * Petr 2026-05-27: tolerantní extrakce prvního balanced JSON object z textu.
 * Sní přebytky před a za, ignoruje stringy + escape characters. Pokud LLM
 * vrátí truncated JSON (typický bug u Gemini Flash classify), zkus aspoň
 * orezat na poslední validní `}` a doplnit chybějící závorky.
 */
function extractFirstBalancedObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }

  // Pokud jsme nenašli balanced end, zkus oříznout na poslední úspěšný
  // klíč-hodnota pár — najdi poslední `,` nebo `}` a doplň chybějící závorky.
  const lastComma = raw.lastIndexOf(",");
  const lastBrace = raw.lastIndexOf("}");
  const cut = Math.max(lastComma, lastBrace);
  if (cut > start) {
    // Pokud končí čárkou, oddělej ji
    let slice = raw.slice(start, cut + 1).trim();
    if (slice.endsWith(",")) slice = slice.slice(0, -1);
    // Spočítej kolik { vs } a doplň chybějící
    let open = 0;
    let close = 0;
    let inStr = false;
    let esc = false;
    for (const c of slice) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === "{") open++;
      else if (c === "}") close++;
    }
    const missing = open - close;
    if (missing > 0) slice = slice + "}".repeat(missing);
    return slice;
  }
  return null;
}
