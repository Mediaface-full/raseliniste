/**
 * Pošta — hybrid chunking strategie pro RAG embeddings.
 *
 * Per `INSTRUKCE/POSTA-DESIGN-DECISIONS.md`:
 *  - Krátké maily (< 500 tokens body): 1 chunk = celé tělo
 *  - Dlouhé maily: split po větných hranicích, target 400 tokens,
 *    soft cap 500
 *  - Vlákna (multi-part body): každá zpráva = vlastní chunk
 *    (i krátká — autor + čas jsou semanticky odlišný kontext)
 *
 * Tokenizer: ŽÁDNÝ skutečný Vertex tokenizer není veřejně dostupný.
 * Používáme heuristic **4 znaky ≈ 1 token** což je dostatečně přesné
 * pro chunking decisions (skutečné token counts při embed call jsou
 * pak in actual API response z Gemini, ale tu zatím neukládáme).
 *
 * Detekce vláken: emaily v jedné konverzaci mají oddělovače typu
 * "On Mon, May 5, 2026 at 10:23 AM, X wrote:" nebo "-----Original
 * Message-----" nebo "Dne X napsal Y:". Pokud najdeme, splitneme.
 * Pokud ne, jedeme single-body strategii.
 */

const CHARS_PER_TOKEN = 4; // heuristic pro gemini-embedding / text-embedding-004
const TARGET_TOKENS = 400;
const SOFT_CAP_TOKENS = 500;
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN; // 1600
const SOFT_CAP_CHARS = SOFT_CAP_TOKENS * CHARS_PER_TOKEN; // 2000

// Reply markery — pokud najdeme v textu, odděluje původní a citovaný kus
// (heuristika; různé klienty maji různé formáty)
const REPLY_MARKERS = [
  /\n-{2,}\s*Original Message\s*-{2,}\n/gi,
  /\nOn .{1,80}wrote:\n/gi,
  /\nDne .{1,80} napsal[a]? .{1,80}:\n/gi,
  /\nDne .{1,80} v \d{1,2}:\d{2} .{1,80} napsal[a]?:\n/gi,
  /\nFrom: .{1,200}\nSent: .{1,80}\nTo: /gi,
  /\nOd: .{1,200}\nOdesláno: .{1,80}\nKomu: /gi,
];

export interface EmailChunk {
  text: string;
  tokenCount: number;
  sourceKind: "body" | "thread_message";
}

/**
 * Hlavni entry point — vrati pole chunků pro daný email body.
 *
 * `subject` se PŘILEPÍ na začátek prvního chunku — embedding tak vždy zachytí
 * předmět (typický signál co Petr hledá: "ten mail o té faktuře").
 */
export function chunkEmailBody(params: {
  subject: string | null;
  bodyText: string;
}): EmailChunk[] {
  const subject = (params.subject ?? "").trim();
  const body = normalizeBody(params.bodyText);

  if (!body) {
    // Prázdný body — pokud máme subject, embed alespoň ten (často to stačí
    // pro short emaily jako "OK" / "Děkuji")
    if (!subject) return [];
    return [
      {
        text: subject,
        tokenCount: estimateTokens(subject),
        sourceKind: "body",
      },
    ];
  }

  // Pokus o detekci vláken (reply markery)
  const threadMessages = splitThread(body);

  if (threadMessages.length > 1) {
    // Multi-message vlákno — každá zpráva = vlastní chunk (per Petrovo zadání)
    // Subject přilepíme jen k první zprávě (root)
    return threadMessages.map((msg, idx) => {
      const withSubject = idx === 0 && subject ? `${subject}\n\n${msg}` : msg;
      const trimmed = trimToSoftCap(withSubject);
      return {
        text: trimmed,
        tokenCount: estimateTokens(trimmed),
        sourceKind: "thread_message" as const,
      };
    });
  }

  // Single message — rozhodni dle délky
  const withSubject = subject ? `${subject}\n\n${body}` : body;
  const totalTokens = estimateTokens(withSubject);

  if (totalTokens <= SOFT_CAP_TOKENS) {
    // Krátký mail — 1 chunk
    return [
      {
        text: withSubject,
        tokenCount: totalTokens,
        sourceKind: "body" as const,
      },
    ];
  }

  // Dlouhý mail — split po větných hranicích
  const parts = splitBySentences(withSubject);
  return parts.map((p) => ({
    text: p,
    tokenCount: estimateTokens(p),
    sourceKind: "body" as const,
  }));
}

// ---------------------------------------------------------------------------
// Helpery
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function normalizeBody(raw: string | null | undefined): string {
  if (!raw) return "";
  // Sjednoť line endings, odstraň více než 2 prázdné řádky za sebou,
  // odstraň trailing whitespace na řádcích
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Pokud body obsahuje reply markery, splitne na jednotlivé zprávy.
 * Vrátí pole zpráv v původním pořadí (nejnovější obvykle první).
 * Pokud žádný marker, vrátí [body] (single message).
 */
function splitThread(body: string): string[] {
  // Najdi nejdřív první výskyt jakéhokoli markeru
  let earliest = body.length;
  let bestMarker: RegExp | null = null;
  for (const marker of REPLY_MARKERS) {
    marker.lastIndex = 0;
    const m = marker.exec(body);
    if (m && m.index < earliest) {
      earliest = m.index;
      bestMarker = marker;
    }
  }

  if (!bestMarker || earliest >= body.length) {
    return [body];
  }

  // Splitnem na ten marker (resetujeme lastIndex)
  bestMarker.lastIndex = 0;
  const parts = body.split(bestMarker).map((p) => p.trim()).filter((p) => p.length > 0);
  // Pokud po splitu máme jen 1 část (marker byl na začátku/konci), vrať single
  if (parts.length <= 1) return [body];
  return parts;
}

/**
 * Split textu po větných hranicích s target ~400 tokens, soft cap 500.
 * Snaží se nepřekročit soft cap, ale větu nerozpáruje uprostřed.
 */
function splitBySentences(text: string): string[] {
  // Sentence boundary regex — věta končí na .!? následované mezerou + velkým
  // písmenem (nebo koncem textu). Cz/En heuristika.
  const sentenceRegex = /([.!?])\s+(?=[A-ZÁ-Ž])/g;
  const sentences: string[] = [];

  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = sentenceRegex.exec(text)) !== null) {
    sentences.push(text.slice(lastEnd, m.index + 1).trim());
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < text.length) sentences.push(text.slice(lastEnd).trim());

  if (sentences.length === 0) {
    // Fallback — žádné věty (asi binární content), prostě hard-split na chars
    return hardSplit(text);
  }

  // Greedy packing — pridávej věty do current chunk dokud nedosáhneš target,
  // pak otevři nový. Pokud jedna věta je delší než soft cap, rozsekni ji hard.
  const chunks: string[] = [];
  let current = "";
  for (const sent of sentences) {
    if (estimateTokens(sent) > SOFT_CAP_TOKENS) {
      // Věta sama je nad cap — hard split
      if (current) {
        chunks.push(current.trim());
        current = "";
      }
      chunks.push(...hardSplit(sent));
      continue;
    }
    const candidate = current ? `${current} ${sent}` : sent;
    if (estimateTokens(candidate) > TARGET_TOKENS && current) {
      chunks.push(current.trim());
      current = sent;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

/**
 * Hard-split na char boundary když nelze najít větu (např. dlouhý URL nebo
 * base64 inline image). Cílí TARGET_CHARS.
 */
function hardSplit(text: string): string[] {
  const out: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    out.push(text.slice(pos, pos + TARGET_CHARS));
    pos += TARGET_CHARS;
  }
  return out;
}

/**
 * Pokud thread_message je extrémně dlouhá (>2× soft cap), trimne na soft cap.
 * Per zadání — thread message = 1 chunk; vyjímka jen pro výjimečně dlouhé.
 */
function trimToSoftCap(text: string): string {
  const maxChars = SOFT_CAP_CHARS * 2;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n[…trimmed]";
}
