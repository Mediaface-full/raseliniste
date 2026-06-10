import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Loader2, Check, X, Edit3, Trash2, AlertTriangle, RotateCw, Clock, UserCheck, Tag, ChevronDown, Hourglass,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { InlineTitle } from "./ui/InlineTitle";

/**
 * Trvání úkolu — pevný set hodnot. Petr si v Triage zvolí dropdown,
 * hodnota se uloží jako extra tag na Task před pushem do Todoistu.
 *
 * Default `t-?` znamená "nezvoleno" — Petr může pushnout bez výběru,
 * ale tag pak bude `t-?` a v Todoistu bude vidět co potřebuje doladit.
 */
const T_TAGS = ["t-?", "t-30m", "t-1h", "t-2h", "t-půlden", "t-celý-den"] as const;
type TTag = typeof T_TAGS[number];

const T_LABEL: Record<TTag, string> = {
  "t-?": "?",
  "t-30m": "30 min",
  "t-1h": "1 h",
  "t-2h": "2 h",
  "t-půlden": "půlden",
  "t-celý-den": "celý den",
};

/** Vrátí t-* tag z proposal.tags (první match), nebo "t-?" pokud žádný. */
function getTTag(tags: string[]): TTag {
  const found = tags.find((t) => (T_TAGS as readonly string[]).includes(t));
  return (found as TTag) ?? "t-?";
}

/** Vrátí tagy bez jakéhokoli t-* — pro filtraci před zápisem nového. */
function stripTTag(tags: string[]): string[] {
  return tags.filter((t) => !(T_TAGS as readonly string[]).includes(t));
}

interface Contact {
  id: string;
  displayName: string;
  firstName: string | null;
  // Petr 2026-05-27: potřebujeme pro routing preview chip
  isTeam: boolean;
  clientTag: string | null;
}

/**
 * Petr 2026-05-27: client-side preview kam úkol půjde v Todoistu.
 * Zrcadlí pravidla z task-todoist-push.ts resolveRoute (bez side effects,
 * bez Todoist API call). Pro skutečné rozhodnutí Team vs Personal projekt
 * server kompletní logika rozhodne při push — tady stačí name preview.
 *
 * Priorita pravidel (první match vyhrává):
 *  1. tag `klient-<slug>` v proposal.tags → projekt podle slugu
 *  2. assignedToContact.clientTag → projekt podle slugu
 *  3. assignedToContact.isTeam → „Práce / FirstName"
 *  4. assignedToContact (kdokoli jiný) → „Lidé / FirstName"
 *  5. nic → „Moje úkoly"
 */
function humanizeSlug(slug: string): string {
  return slug.split("-").map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
}

function slugifyClient(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Najde Team Workspace projekt v seznamu podle jména (exact ci nebo slug match).
 * Vrátí název projektu nebo null. Client-side mirror funkce
 * `resolveTeamMemberProject` ze server-side `todoist-workspace.ts`.
 */
function findTeamProjectByName(
  todoistProjects: TodoistProjectOption[],
  names: (string | null | undefined)[],
): string | null {
  const teamProjects = todoistProjects.filter((p) => p.isTeam);
  if (teamProjects.length === 0) return null;
  const cleanNames = names.filter((n): n is string => !!n && n.trim().length > 0);
  // 1. Exact case-insensitive match
  for (const name of cleanNames) {
    const lower = name.toLowerCase();
    const exact = teamProjects.find((p) => p.name.toLowerCase() === lower);
    if (exact) return exact.name;
  }
  // 2. Slug match (diakritika / mezery)
  for (const name of cleanNames) {
    const slug = slugifyClient(name);
    const fuzzy = teamProjects.find((p) => slugifyClient(p.name) === slug);
    if (fuzzy) return fuzzy.name;
  }
  return null;
}

function computeRoutePreview(
  proposal: { tags: string[]; assignedToContactId: string | null },
  contacts: Contact[],
  todoistProjects: TodoistProjectOption[] = [],
): { project: string; section: string | null } {
  const KLIENT = "klient-";
  const klientTag = proposal.tags.find((t) => t.startsWith(KLIENT));
  if (klientTag) {
    const slug = klientTag.slice(KLIENT.length);
    // Najdi Team Workspace projekt podle slug (humanized jméno)
    const teamMatch = findTeamProjectByName(todoistProjects, [humanizeSlug(slug), slug]);
    if (teamMatch) return { project: teamMatch, section: null };
    return { project: "Práce", section: humanizeSlug(slug) };
  }
  const contact = proposal.assignedToContactId
    ? contacts.find((c) => c.id === proposal.assignedToContactId)
    : null;
  if (contact?.clientTag) {
    const teamMatch = findTeamProjectByName(todoistProjects, [humanizeSlug(contact.clientTag), contact.clientTag]);
    if (teamMatch) return { project: teamMatch, section: null };
    return { project: "Práce", section: humanizeSlug(contact.clientTag) };
  }
  if (contact?.isTeam) {
    // Petr 2026-06-09: členové týmu mají vlastní top-level Team projekty
    // (např. „Dominik", „Gáťa"). Najdi a vrať přímo projekt bez sekce.
    const teamMatch = findTeamProjectByName(todoistProjects, [contact.firstName, contact.displayName]);
    if (teamMatch) return { project: teamMatch, section: null };
    return { project: "Práce", section: contact.firstName ?? contact.displayName };
  }
  if (contact) {
    return { project: "Lidé", section: contact.firstName ?? contact.displayName };
  }
  return { project: "Moje úkoly", section: null };
}

interface Proposal {
  title: string;
  dueAt: string | null;
  dueIsTime: boolean;
  tags: string[];
  priority: "low" | "normal" | "high";
  notes: string | null;
  rawSnippet: string;
  assignedToContactName: string | null;
  // Hierarchie 1 úroveň — podúkoly (sami už nemohou mít subtasks)
  subtasks?: Proposal[];
  // UI-only
  _checked: boolean;
  _id: string;          // local stable ID pro React keys
  _editing: boolean;
  // Po vyřešení assignedToContactName na ID
  assignedToContactId: string | null;
  // Manuální override Smart routingu — Petr klikl na chip 📁 a vybral
  // projekt sám. Pokud nastaveno, posíláme na server místo auto-routingu.
  manualTodoistProjectId?: string | null;
  manualTodoistSectionId?: string | null;
  manualTodoistProjectName?: string | null; // jen pro UI preview
  manualTodoistSectionName?: string | null;
}

interface TodoistProjectOption {
  id: string;
  name: string;
  isInbox: boolean;
  isTeam: boolean;
  sections?: { id: string; name: string }[];
}

interface Batch {
  id: string;
  status: string;
  rawTranscript: string | null;
  proposalsJson: unknown;
  processingError: string | null;
  audioDurationSec: number | null;
  createdAt: string;
}

export default function TaskAudioReview({ batchId }: { batchId: string }) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [todoistProjects, setTodoistProjects] = useState<TodoistProjectOption[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadContacts();
    void loadTodoistProjects();
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  async function loadTodoistProjects() {
    try {
      // S sekcemi — chce to víc requests, ale Petr potřebuje plný picker
      const res = await fetch("/api/todoist/projects-list?withSections=1");
      if (res.ok) {
        const data = await res.json();
        setTodoistProjects(data.projects ?? []);
      }
    } catch (e) {
      console.warn("[TaskAudioReview] loadTodoistProjects failed:", e);
    }
  }

  // Petr 2026-05-27: stopky tickají každou sekundu, ne jen při polling
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (!batch || batch.status !== "processing") return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [batch?.status]);

  // Polling pokud processing
  useEffect(() => {
    if (!batch || (batch.status !== "processing")) return;
    const interval = setInterval(() => void load(), 3000);
    return () => clearInterval(interval);
  }, [batch?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadContacts() {
    // Petr 2026-05-25: jen členové týmu (Contact.isTeam=true) — Petr nechce
    // v dropdownu přiřazení mít celý adresář, jen lidi se kterými spolupracuje.
    const res = await fetch("/api/contacts?team=1");
    if (res.ok) {
      const data = await res.json();
      setContacts(data.contacts ?? data);
    }
  }

  async function load() {
    const res = await fetch(`/api/ukoly/audio/${batchId}`);
    if (!res.ok) {
      setError("Batch nenalezen.");
      return;
    }
    const data = await res.json();
    setBatch(data.batch);

    // Pokud máme proposals a ještě jsme je nezprocesovali, naplň state
    if (data.batch.status === "review" && Array.isArray(data.batch.proposalsJson)) {
      const cs = await ensureContacts();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function hydrate(p: any, idPrefix: string): Proposal {
        // Doplň t-? tag pokud chybí — ať je dropdown vždy něčím vybraný.
        // Případné existující t-* tag z AI extrakce zachováme (Gemini může
        // odhadnout délku z kontextu „rychle to vyřídím" → t-30m).
        const incomingTags: string[] = Array.isArray(p.tags) ? p.tags : [];
        const tagsWithT = (T_TAGS as readonly string[]).some((t) => incomingTags.includes(t))
          ? incomingTags
          : [...incomingTags, "t-?"];
        return {
          ...p,
          tags: tagsWithT,
          _checked: true,
          _id: idPrefix,
          _editing: false,
          assignedToContactId: resolveContactId(p.assignedToContactName, cs),
          subtasks: Array.isArray(p.subtasks)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ? p.subtasks.map((s: any, j: number) => hydrate(s, `${idPrefix}.${j}`))
            : undefined,
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const next: Proposal[] = data.batch.proposalsJson.map((p: any, i: number) => hydrate(p, `${i}`));
      setProposals(next);
    }
  }

  async function ensureContacts(): Promise<Contact[]> {
    if (contacts.length > 0) return contacts;
    const res = await fetch("/api/contacts?team=1");
    if (res.ok) {
      const data = await res.json();
      const cs = data.contacts ?? data;
      setContacts(cs);
      return cs;
    }
    return [];
  }

  function resolveContactId(name: string | null, cs: Contact[]): string | null {
    if (!name) return null;
    const lower = name.toLowerCase();
    const match = cs.find((c) =>
      c.displayName.toLowerCase() === lower ||
      c.firstName?.toLowerCase() === lower ||
      c.displayName.toLowerCase().includes(lower) ||
      lower.includes((c.firstName ?? "").toLowerCase()),
    );
    return match?.id ?? null;
  }

  async function regenerate(mode: "extract-only" | "full") {
    setError(null);
    const res = await fetch(`/api/ukoly/audio/${batchId}/regenerate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Regenerace selhala.");
      return;
    }
    setBatch((b) => b ? { ...b, status: "processing" } : b);
    setProposals([]);
  }

  async function commit() {
    const checked = proposals.filter((p) => p._checked);
    if (checked.length === 0) {
      setError("Nic nemáš zaškrtnuté.");
      return;
    }
    setCommitting(true);
    setError(null);
    try {
      function flatten(p: Proposal) {
        return {
          title: p.title,
          notes: p.notes,
          dueAt: p.dueAt,
          dueIsTime: p.dueIsTime,
          tags: p.tags,
          priority: p.priority,
          rawSnippet: p.rawSnippet,
          assignedToContactId: p.assignedToContactId,
          manualTodoistProjectId: p.manualTodoistProjectId ?? null,
          manualTodoistSectionId: p.manualTodoistSectionId ?? null,
        };
      }
      const payload = {
        proposals: checked.map((p) => ({
          ...flatten(p),
          subtasks: (p.subtasks ?? [])
            .filter((s) => s._checked)
            .map(flatten),
        })),
      };
      const res = await fetch(`/api/ukoly/audio/${batchId}/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Commit selhal.");
        return;
      }
      const data = await res.json();
      window.location.href = `/ukoly?created=${data.count}`;
    } finally {
      setCommitting(false);
    }
  }

  async function discard() {
    if (!confirm("Opravdu zahodit všechny návrhy?")) return;
    const res = await fetch(`/api/ukoly/audio/${batchId}/discard`, { method: "POST" });
    if (res.ok) window.location.href = "/ukoly";
  }

  if (!batch) {
    return <div className="text-center py-12 text-muted-foreground"><Loader2 className="size-6 animate-spin mx-auto" /></div>;
  }

  // PROCESSING — Petr 2026-05-27: viditelné fáze + stopky + warning při >5 min
  if (batch.status === "processing") {
    // Detekce fáze podle dat: pokud transcript existuje → už jsme ve Stage 2.
    const inExtraction = (batch.rawTranscript?.length ?? 0) > 50;
    const phaseTitle = inExtraction ? "Vytahuji úkoly z přepisu" : "Přepisuji audio";
    const phaseDesc = inExtraction
      ? "AI projíždí přepis a vytváří návrhy úkolů. Trvá to typicky 30-90 sekund."
      : "AI poslouchá tvé audio a píše přepis. Pro 30 minut to trvá 2-4 minuty.";
    // Stopky od createdAt (nowTick tickne každou sekundu z useEffect výše)
    const elapsedSec = Math.floor((nowTick - new Date(batch.createdAt).getTime()) / 1000);
    const elM = Math.floor(elapsedSec / 60);
    const elS = (elapsedSec % 60).toString().padStart(2, "0");
    const stuckWarning = elapsedSec > 5 * 60;

    return (
      <div className="space-y-4">
        <div className="glass-strong rounded-xl p-8 text-center space-y-3">
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-3 text-xs font-mono text-muted-foreground">
            <span className={inExtraction ? "text-foreground/40 line-through" : "text-[var(--tint-peach)] font-bold"}>
              1. Přepis
            </span>
            <span className="text-foreground/30">→</span>
            <span className={inExtraction ? "text-[var(--tint-peach)] font-bold" : "text-foreground/40"}>
              2. Úkoly
            </span>
          </div>

          <Loader2 className={`size-12 animate-spin mx-auto ${stuckWarning ? "text-[var(--tint-rose)]" : "text-[var(--tint-peach)]"}`} />

          <h1 className="font-serif text-xl">{phaseTitle}</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">{phaseDesc}</p>

          {/* Stopky */}
          <div className={`text-2xl font-mono ${stuckWarning ? "text-[var(--tint-rose)]" : "text-foreground/80"}`}>
            {elM}:{elS}
          </div>

          {/* Meta info */}
          <div className="text-xs font-mono text-muted-foreground space-y-1">
            {batch.audioDurationSec && (
              <div>Audio: {Math.floor(batch.audioDurationSec / 60)}:{Math.floor(batch.audioDurationSec % 60).toString().padStart(2, "0")} ({Math.round(batch.audioDurationSec)} s)</div>
            )}
            {inExtraction && batch.rawTranscript && (
              <div>Přepis: {batch.rawTranscript.length.toLocaleString("cs-CZ")} znaků</div>
            )}
          </div>

          {stuckWarning && (
            <div className="mt-4 rounded-lg border-2 border-[var(--tint-rose)]/50 bg-[var(--tint-rose)]/10 px-4 py-3 text-sm">
              <strong>Hm, trvá to déle než obvykle.</strong> Pro dlouhá audia (45+ min) to může být normální,
              ale pokud stojí na místě 10+ minut, něco se zaseklo. Zkus refresh stránky nebo nahrát znovu.
            </div>
          )}

          <p className="text-xs text-muted-foreground/70 mt-2">
            Stránka se obnovuje sama každé 3 sekundy. Můžeš zatím dělat něco jiného.
          </p>
        </div>
      </div>
    );
  }

  // ERROR
  if (batch.status === "error") {
    return (
      <div className="space-y-4">
        <div className="glass-strong rounded-xl p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-8 text-destructive shrink-0" />
            <div className="flex-1">
              <h1 className="font-serif text-xl mb-1">Něco se nepovedlo</h1>
              <p className="text-sm text-destructive break-all">{batch.processingError}</p>
              {batch.rawTranscript && (
                <p className="text-xs text-muted-foreground mt-2">Přepis máme — zkus znovu jen extrakci.</p>
              )}
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            {batch.rawTranscript && (
              <Button onClick={() => regenerate("extract-only")}>
                <RotateCw /> Zkusit jen extrakci
              </Button>
            )}
            <Button variant="outline" onClick={() => regenerate("full")}>
              <RotateCw /> Zkusit od začátku
            </Button>
            <Button variant="ghost" onClick={discard}><Trash2 /> Zahodit</Button>
          </div>
          {batch.rawTranscript && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Surový přepis</summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs bg-black/20 p-3 rounded">{batch.rawTranscript}</pre>
            </details>
          )}
        </div>
      </div>
    );
  }

  // COMMITTED nebo DISCARDED
  if (batch.status === "committed" || batch.status === "discarded") {
    return (
      <div className="glass-strong rounded-xl p-8 text-center">
        <Check className="size-12 text-[var(--tint-sage)] mx-auto mb-2" />
        <h1 className="font-serif text-xl">{batch.status === "committed" ? "Hotovo" : "Zahozeno"}</h1>
        <a href="/ukoly" className="inline-block mt-4 text-sm underline">Zpět na úkoly</a>
      </div>
    );
  }

  // REVIEW
  return (
    <div className="space-y-4">
      <div className="glass rounded-xl p-4 flex items-center gap-3">
        <div className="flex-1">
          <h1 className="font-serif text-xl">
            {proposals.length === 0
              ? "AI nenašla žádné úkoly"
              : `Nadiktoval jsi ${proposals.length} ${proposals.length === 1 ? "úkol" : proposals.length < 5 ? "úkoly" : "úkolů"}`}
          </h1>
          {batch.audioDurationSec && (
            <p className="text-xs font-mono text-muted-foreground">
              {Math.floor(batch.audioDurationSec / 60)}m{(batch.audioDurationSec % 60).toString().padStart(2, "0")}s
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => regenerate("extract-only")}>
          <RotateCw /> Zkusit znovu
        </Button>
      </div>

      {batch.rawTranscript && (
        <details className="glass rounded-xl px-4 py-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground flex items-center gap-1">
            <ChevronDown className="size-3" /> Surový přepis
          </summary>
          <pre className="mt-2 whitespace-pre-wrap text-xs bg-black/20 p-3 rounded font-mono">{batch.rawTranscript}</pre>
        </details>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {proposals.length === 0 ? (
        <div className="glass rounded-xl p-6 text-center text-sm text-muted-foreground">
          Buď audio neobsahuje úkoly, nebo se AI ztratila. Zkus regenerate, nebo zahoď.
        </div>
      ) : (
        <div className="space-y-2">
          {proposals.map((p, idx) => (
            <div key={p._id} className="space-y-1">
              <ProposalRow
                proposal={p}
                contacts={contacts}
                todoistProjects={todoistProjects}
                onChange={(patch) => setProposals((prev) => prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)))}
                onRemove={() => setProposals((prev) => prev.filter((_, i) => i !== idx))}
              />
              {p.subtasks && p.subtasks.length > 0 && (
                <div className="ml-7 space-y-1 border-l-2 border-[var(--tint-peach)]/30 pl-3">
                  {p.subtasks.map((sub, sIdx) => (
                    <ProposalRow
                      key={sub._id}
                      proposal={sub}
                      contacts={contacts}
                      todoistProjects={todoistProjects}
                      isSubtask
                      // Pokud rodič odškrtnut, sub se vizuálně tmaví ale dál edituje
                      onChange={(patch) =>
                        setProposals((prev) =>
                          prev.map((q, i) =>
                            i === idx
                              ? { ...q, subtasks: (q.subtasks ?? []).map((s, j) => (j === sIdx ? { ...s, ...patch } : s)) }
                              : q,
                          ),
                        )
                      }
                      onRemove={() =>
                        setProposals((prev) =>
                          prev.map((q, i) =>
                            i === idx
                              ? { ...q, subtasks: (q.subtasks ?? []).filter((_, j) => j !== sIdx) }
                              : q,
                          ),
                        )
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="glass-strong rounded-xl p-4 flex items-center gap-2 sticky bottom-4 z-10">
        <span className="text-sm">
          Vybráno: <strong>{proposals.filter((p) => p._checked).length}</strong> / {proposals.length}
        </span>
        <Button
          onClick={commit}
          disabled={committing || proposals.filter((p) => p._checked).length === 0}
          className="ml-auto"
        >
          {committing ? <><Loader2 className="animate-spin" /> Vytvářím…</> : <><Check /> Vytvořit zaškrtnuté</>}
        </Button>
        <Button variant="ghost" onClick={discard}><Trash2 /> Zahodit vše</Button>
      </div>
    </div>
  );
}

function ProposalRow({
  proposal, contacts, todoistProjects, onChange, onRemove, isSubtask = false,
}: {
  proposal: Proposal;
  contacts: Contact[];
  todoistProjects: TodoistProjectOption[];
  onChange: (patch: Partial<Proposal>) => void;
  onRemove: () => void;
  isSubtask?: boolean;
}) {
  const dueObj = proposal.dueAt ? new Date(proposal.dueAt) : null;

  return (
    <div className={`${isSubtask ? "rounded-md p-3 bg-white/[0.04]" : "glass rounded-xl p-4 border border-white/10"} ${!proposal._checked ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-3">
        <button
          onClick={() => onChange({ _checked: !proposal._checked })}
          className={`mt-1 size-5 rounded border shrink-0 ${
            proposal._checked
              ? "bg-[var(--tint-peach)]/40 border-[var(--tint-peach)]"
              : "border-white/40 hover:border-white/70"
          } grid place-items-center`}
        >
          {proposal._checked && <Check className="size-3" />}
        </button>

        <div className="flex-1 min-w-0">
          {/* Petr 2026-05-25: vše inline — žádný „rozkliknout edit panel".
              Title editovatelný klikem, ostatní pole vždy viditelné selecty/inputy.
              Tab přeskakuje, změny se ukládají rovnou do local state (DB commit
              jde tlačítkem „Uložit X úkolů" dole). */}
          <InlineTitle
            value={proposal.title}
            onSave={(next) => onChange({ title: next })}
          />

          <div className="flex flex-wrap items-center gap-2 mt-2 text-sm">
            {/* Trvání (t-* tag) */}
            <label className="flex items-center gap-1 cursor-pointer" title="Trvání úkolu">
              <Hourglass className="size-3.5 text-[var(--tint-lavender)]" />
              <select
                value={getTTag(proposal.tags)}
                onChange={(e) => {
                  const newTTag = e.target.value as TTag;
                  onChange({ tags: [...stripTTag(proposal.tags), newTTag] });
                }}
                className="bg-black/40 border border-white/20 rounded px-2 py-1 text-sm font-mono cursor-pointer hover:border-white/40 focus:outline-none focus:border-[var(--tint-lavender)]/70"
              >
                {T_TAGS.map((t) => (
                  <option key={t} value={t}>{T_LABEL[t]}</option>
                ))}
              </select>
            </label>

            {/* Datum — vždy viditelný native date input, prázdné = bez termínu */}
            <label className="flex items-center gap-1" title="Datum splnění">
              <Clock className="size-3.5 text-foreground/70" />
              <input
                type="date"
                value={proposal.dueAt ? proposal.dueAt.slice(0, 10) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange({ dueAt: v ? new Date(`${v}T09:00:00`).toISOString() : null, dueIsTime: false });
                }}
                className="bg-black/40 border border-white/20 rounded px-2 py-1 text-sm font-mono cursor-pointer hover:border-white/40 focus:outline-none focus:border-[var(--tint-butter)]/70"
              />
            </label>

            {/* Priorita — vždy viditelný select */}
            <label className="flex items-center gap-1" title="Priorita">
              <span className="text-foreground/70 font-mono">!</span>
              <select
                value={proposal.priority}
                onChange={(e) => onChange({ priority: e.target.value as "low" | "normal" | "high" })}
                className={`bg-black/40 border border-white/20 rounded px-2 py-1 text-sm font-mono cursor-pointer hover:border-white/40 focus:outline-none ${
                  proposal.priority === "high" ? "text-[var(--tint-rose)]" : proposal.priority === "low" ? "text-foreground/70" : "text-foreground"
                }`}
              >
                <option value="low">↓ Low</option>
                <option value="normal">Normal</option>
                <option value="high">! Priorita</option>
              </select>
            </label>

            {/* Kontakt — vždy viditelný select, prázdné = „Já" */}
            <label className="flex items-center gap-1" title="Komu úkol patří">
              <UserCheck className={`size-3.5 ${proposal.assignedToContactId ? "text-[var(--tint-lavender)]" : "text-foreground/70"}`} />
              <select
                value={proposal.assignedToContactId ?? ""}
                onChange={(e) => onChange({ assignedToContactId: e.target.value || null })}
                className="bg-black/40 border border-white/20 rounded px-2 py-1 text-sm cursor-pointer hover:border-white/40 focus:outline-none focus:border-[var(--tint-lavender)]/70 max-w-[160px]"
              >
                <option value="">Já</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
              </select>
            </label>
            {proposal.assignedToContactName && !proposal.assignedToContactId && (
              <span className="flex items-center gap-1 text-[var(--tint-butter)] text-xs italic">
                AI nabídla: {proposal.assignedToContactName} (vyber kontakt ↑)
              </span>
            )}

            {/* Petr 2026-05-27: chip = preview kam to půjde v Todoistu.
                Petr 2026-06-09: chip je teď klikatelný dropdown — manual
                override Smart routingu. Výběr „🤖 Automaticky" = auto routing.
                Pokud Petr zvolí konkrétní projekt/sekci, override. */}
            <ProjectPicker
              proposal={proposal}
              contacts={contacts}
              todoistProjects={todoistProjects}
              onChange={onChange}
            />

            {/* Tagy — inline input s čárkou. Zachovává t-* tag mimo. */}
            <label className="flex items-center gap-1 flex-1 min-w-[160px]" title="Tagy oddělené čárkou (bez #, bez t-*)">
              <Tag className="size-3.5 text-foreground/70" />
              <input
                type="text"
                defaultValue={stripTTag(proposal.tags).join(", ")}
                onBlur={(e) => {
                  const raw = e.target.value;
                  const newTags = raw.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean);
                  const tTag = getTTag(proposal.tags);
                  onChange({ tags: [...newTags, tTag] });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                placeholder="tagy, čárkou"
                className="flex-1 min-w-0 bg-black/40 border border-white/20 rounded px-2 py-1 text-sm font-mono hover:border-white/40 focus:outline-none focus:border-[var(--tint-sage)]/70"
              />
            </label>
          </div>

          {/* Poznámka — inline textarea, vždy viditelná, prázdný placeholder */}
          <textarea
            value={proposal.notes ?? ""}
            onChange={(e) => onChange({ notes: e.target.value || null })}
            placeholder="+ poznámka"
            rows={proposal.notes ? 2 : 1}
            className="w-full mt-2 bg-black/30 border border-white/10 rounded px-2 py-1.5 text-sm leading-snug resize-y hover:border-white/20 focus:outline-none focus:border-white/40 placeholder:text-muted-foreground/60"
          />

          {/* Surová citace z přepisu — read only */}
          {proposal.rawSnippet && (
            <div className="text-sm italic text-muted-foreground mt-1.5">„{proposal.rawSnippet}"</div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onRemove}
            className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground"
            title="Smazat tento návrh"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ProposalEdit({
  proposal, contacts, onSave, onCancel,
}: {
  proposal: Proposal;
  contacts: Contact[];
  onSave: (patch: Partial<Proposal>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(proposal.title);
  const [notes, setNotes] = useState(proposal.notes ?? "");
  const [dueAt, setDueAt] = useState(proposal.dueAt ? proposal.dueAt.slice(0, 10) : "");
  // Tags bez t-* — ten řešíme dropdownem mimo edit form
  const [tags, setTags] = useState(stripTTag(proposal.tags).join(", "));
  const [priority, setPriority] = useState(proposal.priority);
  const [assigned, setAssigned] = useState(proposal.assignedToContactId ?? "");
  // Stávající t-* tag zachovat při uložení edit formu
  const existingTTag = getTTag(proposal.tags);

  return (
    <div className="space-y-2 mt-1">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Poznámka"
        className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm resize-none"
      />
      <div className="grid grid-cols-3 gap-2">
        <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
          className="px-2 py-1.5 rounded-md bg-black/30 border border-white/10 text-sm" />
        <select value={priority} onChange={(e) => setPriority(e.target.value as "low" | "normal" | "high")}
          className="px-2 py-1.5 rounded-md bg-black/30 border border-white/10 text-sm">
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
        <select value={assigned} onChange={(e) => setAssigned(e.target.value)}
          className="px-2 py-1.5 rounded-md bg-black/30 border border-white/10 text-sm">
          <option value="">Já</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
        </select>
      </div>
      <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tagy (čárkou)" />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSave({
          title,
          notes: notes || null,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          // Spojí user-edited tagy + zachovaný t-* z dropdownu před editem
          tags: [
            ...stripTTag(tags.split(",").map((s) => s.trim()).filter(Boolean)),
            existingTTag,
          ],
          priority,
          assignedToContactId: assigned || null,
        })}><Check /> OK</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}><X /></Button>
      </div>
    </div>
  );
}

/**
 * ProjectPicker — chip 📁 který je klikatelný dropdown.
 *
 * Default = "🤖 Automaticky" (computeRoutePreview). Po výběru konkrétního
 * project/section uloží do proposal.manualTodoist*Id. Pro re-clearnutí
 * stačí znovu zvolit „🤖 Automaticky".
 *
 * Petr 2026-06-09: tohle byla missing feature — Smart routing někdy
 * rozhodne špatně (např. „Dominik zajistit X" → Moje úkoly místo Práce/Dominik)
 * a Petr musí mít možnost override jedním kliknutím.
 */
function ProjectPicker({
  proposal, contacts, todoistProjects, onChange,
}: {
  proposal: Proposal;
  contacts: Contact[];
  todoistProjects: TodoistProjectOption[];
  onChange: (patch: Partial<Proposal>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const route = computeRoutePreview(proposal, contacts, todoistProjects);
  const isManual = !!proposal.manualTodoistProjectId;

  // Label co se zobrazí na chipu
  const label = isManual
    ? `${proposal.manualTodoistProjectName ?? "Projekt"}${proposal.manualTodoistSectionName ? ` / ${proposal.manualTodoistSectionName}` : ""}`
    : `${route.project}${route.section ? ` / ${route.section}` : ""}`;

  // Před otevřením dropdownu spočítej pozici z buttonu — dropdown jde do Portalu
  // (mimo glass parent stacking context). Pattern z calendar/Timeline View.
  function handleOpen() {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const dropdownWidth = 320;
    const viewportWidth = window.innerWidth;
    // Vpravo by mohl utéct mimo viewport — clamp na 8px padding
    const left = Math.min(rect.left, viewportWidth - dropdownWidth - 8);
    setPosition({
      top: rect.bottom + 4,
      left: Math.max(8, left),
    });
    setOpen(true);
  }

  function clearManual() {
    onChange({
      manualTodoistProjectId: null,
      manualTodoistSectionId: null,
      manualTodoistProjectName: null,
      manualTodoistSectionName: null,
    });
    setOpen(false);
  }

  function pick(projectId: string, projectName: string, sectionId: string | null, sectionName: string | null) {
    onChange({
      manualTodoistProjectId: projectId,
      manualTodoistSectionId: sectionId,
      manualTodoistProjectName: projectName,
      manualTodoistSectionName: sectionName,
    });
    setOpen(false);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : handleOpen())}
        className={`flex items-center gap-1 font-mono text-sm px-2 py-1 rounded border cursor-pointer transition ${
          isManual
            ? "border-[var(--tint-sage)]/50 bg-[var(--tint-sage)]/15 text-[var(--tint-sage)] hover:bg-[var(--tint-sage)]/25"
            : "border-[var(--tint-sky)]/30 bg-[var(--tint-sky)]/10 text-[var(--tint-sky)] hover:bg-[var(--tint-sky)]/20"
        }`}
        title={isManual ? "Manuálně vybráno — klikni pro změnu" : "Auto routing — klikni pro override"}
      >
        📁 {label} <ChevronDown className="size-3" />
      </button>

      {open && position && typeof document !== "undefined" && createPortal(
        <>
          {/* Backdrop přes celý viewport — klik mimo zavře */}
          <div
            className="fixed inset-0 z-[100]"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed z-[101] min-w-[320px] max-w-[420px] max-h-[400px] overflow-y-auto rounded-lg border border-white/20 bg-black/95 backdrop-blur-md shadow-2xl p-1"
            style={{ top: position.top, left: position.left }}
          >
            {/* Auto option */}
            <button
              type="button"
              onClick={clearManual}
              className={`w-full text-left px-3 py-2 rounded text-sm hover:bg-white/10 ${!isManual ? "bg-white/5" : ""}`}
            >
              🤖 <strong>Automaticky</strong>{" "}
              <span className="text-muted-foreground">
                ({route.project}{route.section ? ` / ${route.section}` : ""})
              </span>
            </button>
            <div className="my-1 border-t border-white/10" />

            {todoistProjects.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground italic">
                Načítám projekty…
              </div>
            )}

            {todoistProjects.map((proj) => (
              <div key={proj.id}>
                {/* Projekt jako item bez sekce */}
                <button
                  type="button"
                  onClick={() => pick(proj.id, proj.name, null, null)}
                  className={`w-full text-left px-3 py-1.5 rounded text-sm hover:bg-white/10 ${
                    isManual && proposal.manualTodoistProjectId === proj.id && !proposal.manualTodoistSectionId
                      ? "bg-[var(--tint-sage)]/20"
                      : ""
                  }`}
                >
                  📁 <strong>{proj.name}</strong>
                  {proj.isTeam && <span className="text-xs text-muted-foreground ml-1">(tým)</span>}
                </button>
                {/* Sekce pod projektem */}
                {proj.sections?.map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => pick(proj.id, proj.name, sec.id, sec.name)}
                    className={`w-full text-left pl-8 pr-3 py-1 rounded text-sm hover:bg-white/10 ${
                      isManual && proposal.manualTodoistSectionId === sec.id
                        ? "bg-[var(--tint-sage)]/20"
                        : ""
                    }`}
                  >
                    <span className="text-muted-foreground">└</span> {sec.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
