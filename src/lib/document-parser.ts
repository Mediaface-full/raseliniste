/**
 * Document parser — extrakce textu z PDF/DOCX/XLSX/TXT do plain stringu.
 *
 * Petr 2026-06-19: Studánka host umožňuje upload dokumentů (kromě audio).
 * Extrahovaný text se ukládá do `ProjectFile.extractedText` + indexuje do
 * RAG jako sourceType "project-document" — projektová znalostní báze.
 *
 * Limity:
 *   - Max input size: 50 MB (větší = error)
 *   - Max output text: 100 000 znaků (truncate s indikací)
 *   - Heavy parsování (PDF s OCR) běží sync, ale fire-and-forget na server
 *     side endpoint vrací 200 OK rovnou a extrakce pokračuje na pozadí.
 */

const MAX_TEXT_CHARS = 100_000;

export interface ParseResult {
  text: string;
  truncated: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Detekce typu dokumentu z MIME + filename fallback.
 *
 * Některé prohlížeče posílají `application/octet-stream` místo correct MIME,
 * pak musíme z přípony.
 */
export type DocKind = "pdf" | "docx" | "xlsx" | "txt" | "unknown";

export function detectDocKind(mime: string, filename: string): DocKind {
  const m = mime.toLowerCase();
  const n = filename.toLowerCase();
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (
    m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    m === "application/msword" ||
    n.endsWith(".docx") ||
    n.endsWith(".doc")
  ) {
    return "docx";
  }
  if (
    m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    m === "application/vnd.ms-excel" ||
    n.endsWith(".xlsx") ||
    n.endsWith(".xls")
  ) {
    return "xlsx";
  }
  if (m === "text/plain" || n.endsWith(".txt") || n.endsWith(".md")) return "txt";
  return "unknown";
}

export function isDocumentMime(mime: string, filename: string): boolean {
  return detectDocKind(mime, filename) !== "unknown";
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_TEXT_CHARS), truncated: true };
}

async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  // Dynamic import — pdf-parse má side-effect při importu (čte test PDF),
  // tak ho loadneme jen když je potřeba.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("pdf-parse");
  const pdfParse = mod.default ?? mod;
  const result = await pdfParse(buffer);
  const t = truncate(result.text ?? "");
  return {
    text: t.text,
    truncated: t.truncated,
    metadata: { pages: result.numpages, info: result.info },
  };
}

async function parseDocx(buffer: Buffer): Promise<ParseResult> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  const t = truncate(result.value ?? "");
  return {
    text: t.text,
    truncated: t.truncated,
    metadata: { warnings: result.messages?.length ?? 0 },
  };
}

async function parseXlsx(buffer: Buffer): Promise<ParseResult> {
  // SheetJS — celý workbook → CSV per sheet → concat
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim().length > 0) {
      parts.push(`# ${sheetName}\n${csv}`);
    }
  }
  const t = truncate(parts.join("\n\n"));
  return {
    text: t.text,
    truncated: t.truncated,
    metadata: { sheets: wb.SheetNames.length },
  };
}

function parseTxt(buffer: Buffer): ParseResult {
  // Pokus UTF-8, fallback latin1 (Windows CP-1250 plain je mírně robustní zpracovat)
  let text = buffer.toString("utf-8");
  // Heuristika: pokud má replacement characters (?), zkus latin1
  const replacementRatio = (text.match(/�/g) ?? []).length / Math.max(1, text.length);
  if (replacementRatio > 0.01) {
    text = buffer.toString("latin1");
  }
  const t = truncate(text);
  return { text: t.text, truncated: t.truncated };
}

/**
 * Hlavní vstupní bod — vyber parser podle kind, vrať text.
 *
 * Hází Error pokud parser selže (caller obvykle uloží do extractionError).
 */
export async function parseDocument(
  buffer: Buffer,
  mime: string,
  filename: string,
): Promise<ParseResult> {
  const kind = detectDocKind(mime, filename);
  switch (kind) {
    case "pdf":
      return parsePdf(buffer);
    case "docx":
      return parseDocx(buffer);
    case "xlsx":
      return parseXlsx(buffer);
    case "txt":
      return parseTxt(buffer);
    case "unknown":
      throw new Error(`Nepodporovaný typ dokumentu: ${mime} / ${filename}`);
  }
}
