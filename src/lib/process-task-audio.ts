import { prisma } from "./db";
import { transcribeAudio } from "./audio-transcribe";
import { getGemini, ANALYSIS_MODEL } from "./gemini";
import { callTracked } from "./gemini-usage";
import { getPrompt } from "./ai-prompts";

/**
 * Audio → seznam úkolů (proposals).
 *
 * Pipeline:
 *  1) Stage 1: transcribe audio přes existující transcribeAudio() (two-stage,
 *     retries, AI Studio fallback) — vrátí čistý text přepisu.
 *  2) Stage 2: extractTaskProposals — Vertex Pro nad přepisem vyrobí
 *     strukturovaný JSON list úkolů (title/dueAt/tags/priority/notes/rawSnippet
 *     + assignedToContactName pokud Petr v hlasu řekl "Karel ať..." atd.)
 *  3) Uložit do TaskAudioBatch.proposalsJson, status=review.
 *  4) Petr v UI uvidí review screen, zaškrtne, klikne Vytvořit → vznikne N Task.
 *
 * NEsmí throw nahoru — všechny chyby se ukládají do batch.processingError.
 */

export interface TaskProposal {
  title: string;
  dueAt: string | null;        // ISO date nebo datetime
  dueIsTime: boolean;
  tags: string[];
  priority: "low" | "normal" | "high";
  notes: string | null;
  rawSnippet: string;
  // Délka jména/slug — Petr v review může vybrat z dropdownu kontaktů
  assignedToContactName: string | null;
  // Hierarchie 1 úroveň — pokud rodič má dílčí kroky, jsou tady.
  // Subtask sám subtasks NEMÁ (zakázáno v promptu).
  subtasks?: TaskProposal[];
}

// Module-level reference holder — chrání před GC fire-and-forget Promise.
// Stejný pattern jako process-recording.ts (kritické pro async upload flow).
interface InFlightTask {
  batchId: string;
  startedAt: number;
  promise: Promise<void>;
}
const inFlightTasks = new Set<InFlightTask>();

export function getInFlightTaskAudioSnapshot(): Array<{ batchId: string; ageMs: number }> {
  const now = Date.now();
  return Array.from(inFlightTasks).map((f) => ({ batchId: f.batchId, ageMs: now - f.startedAt }));
}

export async function processTaskAudio(params: {
  batchId: string;
  audio: Buffer;
  mimeType: string;
}): Promise<void> {
  const entry: InFlightTask = {
    batchId: params.batchId,
    startedAt: Date.now(),
    promise: Promise.resolve(),
  };

  entry.promise = (async () => {
    const batch = await prisma.taskAudioBatch.findUnique({ where: { id: params.batchId } });
    if (!batch) {
      console.error(`[process-task-audio] Batch ${params.batchId} nenalezen.`);
      inFlightTasks.delete(entry);
      return;
    }

    console.log(`[process-task-audio] ${params.batchId} start (${(params.audio.byteLength / 1024 / 1024).toFixed(1)} MB)`);

    try {
    // Stage 1: přepis (znovupoužití existujícího transcribeAudio,
    // ale pro úkoly nepotřebujeme jeho analysis — jen transcript).
    const transcribeResult = await transcribeAudio({
      audio: params.audio,
      mimeType: params.mimeType,
      recordingType: "STANDARD", // úkolová salva je krátká
      projectContext: null,
    });

    const transcript = transcribeResult.transcript.trim();
    if (!transcript) {
      throw new Error("Přepis je prázdný — nahrávka byla zřejmě tichá.");
    }

    // Uložit transcript hned (kdyby Stage 2 selhal, máme aspoň přepis)
    await prisma.taskAudioBatch.update({
      where: { id: params.batchId },
      data: { rawTranscript: transcript },
    });

    // Stage 2: extrakce — předáme userId aby AI dostala dynamické tagy/kontakty
    const proposals = await extractTaskProposals(transcript, { userId: params.userId });

    await prisma.taskAudioBatch.update({
      where: { id: params.batchId },
      data: {
        proposalsJson: proposals as unknown as object,
        status: "review",
        processingError: null,
      },
    });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[process-task-audio] ${params.batchId} failed:`, msg);
      await prisma.taskAudioBatch
        .update({
          where: { id: params.batchId },
          data: { status: "error", processingError: msg.slice(0, 1000) },
        })
        .catch(() => null);
    } finally {
      console.log(`[process-task-audio] ${params.batchId} finished in ${Date.now() - entry.startedAt}ms`);
      inFlightTasks.delete(entry);
    }
  })();

  inFlightTasks.add(entry);
  return entry.promise;
}

// ---------------------------------------------------------------------------
// Extrakce úkolů z přepisu — Vertex Gemini Pro, JSON output
// ---------------------------------------------------------------------------

export async function extractTaskProposals(transcript: string, opts?: { userId?: string }): Promise<TaskProposal[]> {
  const userId = opts?.userId;

  // Kontakty (delegace) — filtr na vlastníka pokud znám userId.
  const contacts = await prisma.contact.findMany({
    where: userId ? { userId } : undefined,
    select: {
      displayName: true,
      firstName: true,
      clientTag: true,
      isTeam: true,
      aliases: true,
      clientTagAliases: true,
    },
    take: 200,
  });

  // Kontaktní seznam s aliases — formát „Karel Novák (aka TK, Tékáčko)".
  // AI v promptu fuzzy match přes všechny aliases, ale do JSON proposalu
  // dá KANONICKÉ jméno (firstName nebo displayName).
  const contactLines: string[] = [];
  for (const c of contacts) {
    const canonical = c.firstName ?? c.displayName;
    if (canonical.length < 2) continue;
    if (c.aliases.length > 0) {
      contactLines.push(`${canonical} (aka ${c.aliases.join(", ")})`);
    } else {
      contactLines.push(canonical);
    }
  }
  const contactList = Array.from(new Set(contactLines)).sort();

  // Klient slugy s aliases — formát „tk-stavby (aka TK, TK Stavby, Tékáčko)".
  // AI generuje KANONICKÝ slug (klient-tk-stavby), aliases jen pomáhají
  // s detekcí v audiu.
  const clientLines: string[] = [];
  const seenSlugs = new Set<string>();
  for (const c of contacts) {
    if (!c.clientTag || seenSlugs.has(c.clientTag)) continue;
    seenSlugs.add(c.clientTag);
    if (c.clientTagAliases.length > 0) {
      clientLines.push(`${c.clientTag} (aka ${c.clientTagAliases.join(", ")})`);
    } else {
      clientLines.push(c.clientTag);
    }
  }
  const clientSlugs = clientLines.sort();

  // Dynamický seznam tagů — top tagy z existujících Task + Todoist labels mirror.
  // AI tak používá Petrovu skutečnou strukturu, ne hardcoded whitelist v promptu.
  let preferredTags: string[] = [];
  if (userId) {
    try {
      const recentTasks = await prisma.task.findMany({
        where: { userId },
        select: { tags: true },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      const tagCount = new Map<string, number>();
      for (const t of recentTasks) {
        for (const tag of t.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
      }
      const labels = await prisma.todoistLabelMirror.findMany({
        where: { userId },
        select: { name: true },
      });
      for (const l of labels) {
        const k = l.name.toLowerCase();
        if (!tagCount.has(k)) tagCount.set(k, 0);
      }
      preferredTags = Array.from(tagCount.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([tag]) => tag)
        .slice(0, 40);
    } catch (e) {
      console.warn("[task-audio] preferred tags load failed:", e instanceof Error ? e.message : String(e));
    }
  }

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const dayCz = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"][today.getDay()];

  // Načti base prompt (instrukce) z DB override / default. Runtime kontext
  // (datum, kontakty, tagy, přepis) se připojuje níže — Petr edituje jen instrukce.
  const basePrompt = await getPrompt("ozvena-stage2-task");
  const prompt = `${basePrompt}

KONTAKTY (pro detekci delegace — fuzzy match přes aliases v závorce, ale do JSON dej KANONICKÉ jméno):
${contactList.length > 0 ? contactList.slice(0, 50).join(", ") : "(žádné)"}

PREFEROVANÉ TAGY (skutečné struktury Petrova systému — vyber primárně z těchto, jen pokud ne padne přesně, klidně přidej nový):
${preferredTags.length > 0 ? preferredTags.join(", ") : "(žádné — použij obecné kategorie z hlavního promptu)"}

KLIENT TAGY — pravidlo prefixu \`klient-<slug>\`:
Stávající klienti (slug → aliases v závorce): ${clientSlugs.length > 0 ? clientSlugs.join(", ") : "(žádný)"}

PRAVIDLA pro klient-* tagy (POVINNĚ DODRŽ, nesmíš porušit):
- Když v audiu Petr mluví o úkolu pro KLIENTA (firma, projekt na zakázku), přidej tag \`klient-<slug>\`.
- **Aliases v závorce** za slugem ti pomáhají s detekcí — Petr může klienta zmínit pod aliasem ("TK", "Tékáčko"). Vždy ale do tagu generuj **KANONICKÝ slug** (např. \`klient-tk-stavby\`), nikdy ne alias jako slug.
- Pokud klient JIŽ EXISTUJE v seznamu výše (jako kanonický slug NEBO alias), použij PŘESNĚ ten kanonický slug — žádné fuzzy úpravy ("tk-stavby" NIKDY ne "tk_stavby" / "tkstavby" / "stavby-tk").
- Pokud klient v seznamu NENÍ (ani jako alias), vytvoř NOVÝ slug podle vzoru: lowercase, slova oddělená pomlčkou, bez diakritiky. Příklad: "TK Stavby Plus s.r.o." → \`klient-tk-stavby-plus\`. "Mortyk Design" → \`klient-mortyk-design\`.
- NIKDY si slug nevymýšlej. Pokud si nejsi 100% jistý, že jde o klienta (vs. jen kontakt = osoba), tag \`klient-*\` nepřidávej.
- Tag \`klient-*\` může mít úkol jen JEDEN. Pokud Petr zmíní víc klientů v jednom úkolu, vyber primárního.

REFERENCE DATE: dnes je ${todayStr} (${dayCz})

PŘEPIS:
"""
${transcript}
"""`;

  const genai = getGemini();
  const response = await callTracked({
    module: "task-extract",
    modelName: ANALYSIS_MODEL,
    fn: () => genai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: prompt,
      config: {
        temperature: 0.2,
        // 12 000 tokenů ≈ ~9 000 slov / cca 50 úkolů s detaily.
        // Pro Petrovu salvu (10-30 úkolů) bohatě stačí. Předtím 4 000
        // selhávalo na truncated JSON u dlouhých diktátů.
        maxOutputTokens: 12_000,
        responseMimeType: "application/json",
      },
    }),
  });

  const raw = (response.text ?? "").trim();
  if (!raw) {
    throw new Error("Extrakce úkolů: Vertex vrátil prázdný výstup.");
  }

  // Odstraní markdown wrapper kdyby ho Vertex přidal
  const cleaned = raw.startsWith("```")
    ? raw.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim()
    : raw;

  let parsed: { tasks?: unknown[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Pokus o opravu truncated JSON — když token limit byl vyčerpán
    // uprostřed úkolu, oříznou se neúplné konce a doplní zavírací
    // závorky tak, aby aspoň prvních N úkolů bylo zachráněno.
    const repaired = repairTruncatedTasksJson(cleaned);
    if (repaired) {
      try {
        parsed = JSON.parse(repaired);
        console.warn(`[task-extract] truncated JSON opraven, obnoveno ${(parsed.tasks ?? []).length} úkolů`);
      } catch (e2) {
        throw new Error(`Extrakce úkolů: nelze parse JSON ani po pokusu o opravu — ${e2 instanceof Error ? e2.message : String(e2)}. Prvních 200 znaků: ${raw.slice(0, 200)}`);
      }
    } else {
      throw new Error(`Extrakce úkolů: nelze parse JSON. Prvních 200 znaků: ${raw.slice(0, 200)}`);
    }
  }

  if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
    return [];
  }

  // Validace + sanitizace + plochá kopie subtask polí (1 úroveň, ostatní zahodit)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function sanitizeOne(t: any, allowSubtasks: boolean): TaskProposal {
    const proposal: TaskProposal = {
      title: String(t.title ?? "").slice(0, 200) || "(bez názvu)",
      dueAt: typeof t.dueAt === "string" && t.dueAt.length > 0 ? t.dueAt : null,
      dueIsTime: Boolean(t.dueIsTime),
      tags: Array.isArray(t.tags) ? t.tags.filter((x: unknown) => typeof x === "string").slice(0, 8) : [],
      priority: ["low", "normal", "high"].includes(t.priority) ? t.priority : "normal",
      notes: typeof t.notes === "string" && t.notes.length > 0 ? t.notes.slice(0, 500) : null,
      rawSnippet: String(t.rawSnippet ?? "").slice(0, 300),
      assignedToContactName: typeof t.assignedToContactName === "string" && t.assignedToContactName.length > 0
        ? t.assignedToContactName
        : null,
    };
    if (allowSubtasks && Array.isArray(t.subtasks) && t.subtasks.length > 0) {
      // Striktně 1 úroveň — children dostanou allowSubtasks=false
      const subs = t.subtasks
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((s: any) => s && typeof s === "object")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((s: any) => sanitizeOne(s, false))
        .slice(0, 20); // sanity max 20 podúkolů na rodiče
      // Pokud má JEN 1 subtask, povýšit ho na samostatný úkol
      // (řešení: vrátit pole 1 element bez parent struktury — ale na úrovni výše).
      // V tomto sanitize-one místo toho prostě necháme subtasks=[1] a UI/commit
      // si poradí. Tady jen zachováme strukturu jak ji AI dala.
      if (subs.length > 0) proposal.subtasks = subs;
    }
    return proposal;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return parsed.tasks.map((t: any) => sanitizeOne(t, true));
}

/**
 * Pokus o opravu truncated JSON odpovědi z `extractTaskProposals`.
 *
 * Vstup: useknutý JSON typu:
 *   { "tasks": [ { "title": "X", "tags": ["a", "b" <- konec
 *
 * Strategie:
 *   1. Najdi poslední validní `}` (uzavření úkolu) následované `,` nebo `]`
 *   2. Ořež všechno za touto závorkou
 *   3. Uzavři pole `]` a objekt `}`
 *
 * Vrátí opravený JSON string, nebo null pokud oprava není možná
 * (např. první úkol je useknutý).
 */
function repairTruncatedTasksJson(raw: string): string | null {
  // Najdi poslední `},` (= konec úkolu kterému následuje další)
  // nebo poslední `}` (= konec úkolu uvnitř pole)
  const lastValidEnd = Math.max(raw.lastIndexOf("},"), raw.lastIndexOf("} "));
  if (lastValidEnd < 0) {
    // Žádný úkol kompletní — nelze obnovit
    return null;
  }

  // Vezmi vše do konce posledního validního úkolu (bez čárky)
  const truncatedAt = raw.lastIndexOf("}", lastValidEnd + 1) + 1;
  let prefix = raw.slice(0, truncatedAt).trim();

  // Odstraň trailing comma kdyby tam zůstala
  if (prefix.endsWith(",")) prefix = prefix.slice(0, -1);

  // Doplň zavírací `]` a `}` pro celý objekt
  return prefix + "]}";
}
