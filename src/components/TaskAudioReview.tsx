import { useState, useEffect } from "react";
import {
  Loader2, Check, X, Edit3, Trash2, AlertTriangle, RotateCw, Clock, UserCheck, Tag, ChevronDown,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface Contact {
  id: string;
  displayName: string;
  firstName: string | null;
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
  // UI-only
  _checked: boolean;
  _id: string;          // local stable ID pro React keys
  _editing: boolean;
  // Po vyřešení assignedToContactName na ID
  assignedToContactId: string | null;
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
  const [showRaw, setShowRaw] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadContacts();
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  // Polling pokud processing
  useEffect(() => {
    if (!batch || (batch.status !== "processing")) return;
    const interval = setInterval(() => void load(), 3000);
    return () => clearInterval(interval);
  }, [batch?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadContacts() {
    const res = await fetch("/api/contacts");
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
      const next: Proposal[] = data.batch.proposalsJson.map((p: Proposal, i: number) => ({
        ...p,
        _checked: true,
        _id: `${i}`,
        _editing: false,
        assignedToContactId: resolveContactId(p.assignedToContactName, cs),
      }));
      setProposals(next);
    }
  }

  async function ensureContacts(): Promise<Contact[]> {
    if (contacts.length > 0) return contacts;
    const res = await fetch("/api/contacts");
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
      const payload = {
        proposals: checked.map((p) => ({
          title: p.title,
          notes: p.notes,
          dueAt: p.dueAt,
          dueIsTime: p.dueIsTime,
          tags: p.tags,
          priority: p.priority,
          rawSnippet: p.rawSnippet,
          assignedToContactId: p.assignedToContactId,
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

  // PROCESSING
  if (batch.status === "processing") {
    return (
      <div className="space-y-4">
        <div className="glass-strong rounded-xl p-8 text-center">
          <Loader2 className="size-12 animate-spin text-[var(--tint-peach)] mx-auto mb-3" />
          <h1 className="font-serif text-xl mb-1">AI extrahuje úkoly</h1>
          <p className="text-sm text-muted-foreground">Trvá to typicky 15-60 s. Můžeš zatím dělat něco jiného, stránka se sama obnoví.</p>
          {batch.audioDurationSec && (
            <p className="text-xs font-mono text-muted-foreground mt-2">
              Audio: {Math.round(batch.audioDurationSec)} s
            </p>
          )}
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
            <ProposalRow
              key={p._id}
              proposal={p}
              contacts={contacts}
              onChange={(patch) => setProposals((prev) => prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)))}
              onRemove={() => setProposals((prev) => prev.filter((_, i) => i !== idx))}
            />
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
  proposal, contacts, onChange, onRemove,
}: {
  proposal: Proposal;
  contacts: Contact[];
  onChange: (patch: Partial<Proposal>) => void;
  onRemove: () => void;
}) {
  const dueObj = proposal.dueAt ? new Date(proposal.dueAt) : null;

  return (
    <div className={`glass rounded-xl p-3 ${!proposal._checked ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-3">
        <button
          onClick={() => onChange({ _checked: !proposal._checked })}
          className={`mt-0.5 size-5 rounded border shrink-0 ${
            proposal._checked
              ? "bg-[var(--tint-peach)]/40 border-[var(--tint-peach)]"
              : "border-white/30 hover:border-white/60"
          } grid place-items-center`}
        >
          {proposal._checked && <Check className="size-3" />}
        </button>

        <div className="flex-1 min-w-0">
          {!proposal._editing ? (
            <>
              <div className="text-sm">{proposal.title}</div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs">
                {dueObj && (
                  <span className="flex items-center gap-1 font-mono text-muted-foreground">
                    <Clock className="size-3" />
                    {dueObj.toLocaleDateString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" })}
                    {proposal.dueIsTime && ` ${dueObj.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}`}
                  </span>
                )}
                {proposal.assignedToContactId && (
                  <span className="flex items-center gap-1 text-[var(--tint-lavender)]">
                    <UserCheck className="size-3" />
                    {contacts.find((c) => c.id === proposal.assignedToContactId)?.displayName ?? proposal.assignedToContactName}
                  </span>
                )}
                {proposal.assignedToContactName && !proposal.assignedToContactId && (
                  <span className="flex items-center gap-1 text-[var(--tint-butter)]">
                    <UserCheck className="size-3" /> {proposal.assignedToContactName} (nesedne na kontakt — vyber)
                  </span>
                )}
                {proposal.priority === "high" && <span className="text-[var(--tint-rose)] font-mono">! priorita</span>}
                {proposal.priority === "low" && <span className="text-muted-foreground font-mono">↓ low</span>}
                {proposal.tags.length > 0 && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Tag className="size-3" /> {proposal.tags.map((t) => `#${t}`).join(" ")}
                  </span>
                )}
              </div>
              {proposal.notes && <div className="text-xs text-muted-foreground mt-1">{proposal.notes}</div>}
              {proposal.rawSnippet && (
                <div className="text-xs italic text-muted-foreground mt-1">„{proposal.rawSnippet}"</div>
              )}
            </>
          ) : (
            <ProposalEdit
              proposal={proposal}
              contacts={contacts}
              onSave={(patch) => onChange({ ...patch, _editing: false })}
              onCancel={() => onChange({ _editing: false })}
            />
          )}
        </div>

        {!proposal._editing && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => onChange({ _editing: true })} className="p-1.5 rounded hover:bg-white/5 text-muted-foreground" title="Upravit">
              <Edit3 className="size-3.5" />
            </button>
            <button onClick={onRemove} className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground" title="Smazat">
              <X className="size-3.5" />
            </button>
          </div>
        )}
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
  const [tags, setTags] = useState(proposal.tags.join(", "));
  const [priority, setPriority] = useState(proposal.priority);
  const [assigned, setAssigned] = useState(proposal.assignedToContactId ?? "");

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
          tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
          priority,
          assignedToContactId: assigned || null,
        })}><Check /> OK</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}><X /></Button>
      </div>
    </div>
  );
}
