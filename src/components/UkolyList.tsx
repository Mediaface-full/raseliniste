import { useState, useEffect } from "react";
import {
  Plus, Check, Trash2, Loader2, Mic, User, UserCheck, Clock, Tag,
  AlertTriangle, Send, ExternalLink, Edit3, X, ChevronDown,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface Contact {
  id: string;
  displayName: string;
}

interface Task {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  dueIsTime: boolean;
  tags: string[];
  status: "open" | "done" | "cancelled";
  priority: "low" | "normal" | "high";
  source: string;
  rawSnippet: string | null;
  todoistTaskId: string | null;
  todoistProjectId: string | null;
  todoistProjectName?: string | null;
  pushedAt: string | null;
  pushError: string | null;
  completedAt: string | null;
  createdAt: string;
  assignedToContact: { id: string; displayName: string } | null;
}

interface TagCount { tag: string; count: number; }

export default function UkolyList({ todoistConfigured }: { todoistConfigured: boolean }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"open" | "done" | "all">("open");
  const [assignedFilter, setAssignedFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdBanner, setCreatedBanner] = useState<number | null>(null);

  useEffect(() => {
    void loadContacts();
    // Detect ?created=N v URL po commit z review screenu
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const c = params.get("created");
      if (c) {
        setCreatedBanner(parseInt(c));
        // Vyčisti URL bez reload
        window.history.replaceState({}, "", "/ukoly");
        setTimeout(() => setCreatedBanner(null), 6000);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, assignedFilter, tagFilter]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("assignedTo", assignedFilter);
      if (tagFilter) params.set("tag", tagFilter);
      const res = await fetch(`/api/ukoly?${params}`);
      const data = await res.json();
      if (res.ok) {
        setTasks(data.tasks);
        setTags(data.tags);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadContacts() {
    const res = await fetch("/api/contacts");
    if (res.ok) {
      const data = await res.json();
      setContacts(data.contacts ?? data);
    }
  }

  async function patchTask(id: string, patch: Partial<Task>) {
    setBusy(id);
    try {
      const res = await fetch(`/api/ukoly/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        setTasks((prev) => prev.map((t) => (t.id === id ? data.task : t)));
      }
    } finally {
      setBusy(null);
    }
  }

  // Optimistic delete bez confirm dialogu — Petr explicitně chtěl, hromadné
  // mazání 50× confirm bylo neúnosné. Server propagace do Todoist je idempotent
  // (404 ignoruje), takže náhodný klik je opravitelný (úkol manuálně znovu).
  async function deleteTask(id: string) {
    // Optimistic UI removal
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      const res = await fetch(`/api/ukoly/${id}`, { method: "DELETE" });
      if (!res.ok) {
        // Rollback při chybě
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Mazání selhalo, obnov stránku.");
        await load();
      }
    } catch {
      setError("Síťová chyba — obnov stránku.");
      await load();
    }
  }

  async function pushTodoist(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/ukoly/${id}/todoist`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Push selhal.");
        return;
      }
      void load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Hlavička s tlačítky */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={() => setCreating(true)}><Plus /> Nový úkol</Button>
        <a href="/ozvena">
          <Button variant="outline"><Mic /> Nadiktovat úkoly</Button>
        </a>
      </div>

      {createdBanner !== null && (
        <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2 flex items-center gap-2">
          <Check className="size-4 text-[var(--tint-sage)]" />
          <span>Vytvořeno {createdBanner} {createdBanner === 1 ? "úkol" : createdBanner < 5 ? "úkoly" : "úkolů"} z diktátu.</span>
          <button onClick={() => setCreatedBanner(null)} className="ml-auto text-muted-foreground"><X className="size-4" /></button>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-muted-foreground"><X className="size-4" /></button>
        </div>
      )}

      {creating && (
        <CreateTaskForm
          contacts={contacts}
          onSave={async (payload) => {
            const res = await fetch("/api/ukoly", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });
            if (res.ok) {
              setCreating(false);
              void load();
            } else {
              const data = await res.json();
              setError(data.error ?? "Vytvoření selhalo.");
            }
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {/* Filtry */}
      <div className="glass rounded-xl p-3 flex flex-wrap items-center gap-2 text-sm">
        <FilterPills
          options={[
            { value: "open", label: "Otevřené" },
            { value: "done", label: "Hotové" },
            { value: "all", label: "Vše" },
          ]}
          active={statusFilter}
          onChange={(v) => setStatusFilter(v as "open" | "done" | "all")}
        />
        <span className="w-px h-4 bg-white/10 mx-1" />
        <FilterPills
          options={[
            { value: "all", label: "Všichni" },
            { value: "me", label: "Moje" },
            ...contacts.slice(0, 5).map((c) => ({ value: c.id, label: c.displayName })),
          ]}
          active={assignedFilter}
          onChange={setAssignedFilter}
          icon="user"
        />
        {tags.length > 0 && (
          <>
            <span className="w-px h-4 bg-white/10 mx-1" />
            <span className="text-xs text-muted-foreground font-mono uppercase">tagy:</span>
            {tags.slice(0, 8).map((t) => (
              <button
                key={t.tag}
                onClick={() => setTagFilter(tagFilter === t.tag ? null : t.tag)}
                className={`text-xs font-mono px-2 py-0.5 rounded ${
                  tagFilter === t.tag ? "bg-foreground text-background" : "bg-white/5 hover:bg-white/10 text-muted-foreground"
                }`}
              >
                #{t.tag} <span className="opacity-50">{t.count}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {/* Seznam úkolů */}
      {loading ? (
        <div className="glass rounded-xl p-6 text-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin mx-auto" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center text-muted-foreground">
          {statusFilter === "open" ? "Žádné otevřené úkoly. ✓" : "Nic tady."}
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              busy={busy === t.id}
              contacts={contacts}
              todoistConfigured={todoistConfigured}
              onToggleDone={() => patchTask(t.id, { status: t.status === "done" ? "open" : "done" })}
              onUpdate={(patch) => patchTask(t.id, patch)}
              onDelete={() => deleteTask(t.id)}
              onPush={() => pushTodoist(t.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPills({
  options, active, onChange, icon,
}: {
  options: { value: string; label: string }[];
  active: string;
  onChange: (v: string) => void;
  icon?: "user";
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 rounded text-xs font-mono flex items-center gap-1 ${
            active === o.value ? "bg-foreground text-background" : "bg-white/5 hover:bg-white/10 text-muted-foreground"
          }`}
        >
          {icon === "user" && o.value !== "all" && <User className="size-3" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CreateTaskForm({
  contacts, onSave, onCancel,
}: {
  contacts: Contact[];
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [tags, setTags] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const [assignedToContactId, setAssignedToContactId] = useState<string>("");

  return (
    <div className="glass rounded-xl p-4 space-y-3" style={{ ["--c" as string]: "var(--tint-peach)" }}>
      <div className="flex items-center gap-2">
        <h2 className="font-serif text-lg">Nový úkol</h2>
        <button onClick={onCancel} className="ml-auto text-muted-foreground"><X className="size-4" /></button>
      </div>
      <Input placeholder="Co je třeba udělat" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <textarea
        placeholder="Poznámka (volitelně)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm resize-none"
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-mono uppercase text-muted-foreground">Termín</label>
          <input
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-mono uppercase text-muted-foreground">Priorita</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as "low" | "normal" | "high")}
            className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
          >
            <option value="low">Nízká</option>
            <option value="normal">Normální</option>
            <option value="high">Vysoká</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs font-mono uppercase text-muted-foreground">Tagy (čárkou)</label>
        <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="prace, dum, telefonat" />
      </div>
      <div>
        <label className="text-xs font-mono uppercase text-muted-foreground">Přidělit komu</label>
        <select
          value={assignedToContactId}
          onChange={(e) => setAssignedToContactId(e.target.value)}
          className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm"
        >
          <option value="">Já</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>{c.displayName}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2 pt-2">
        <Button
          onClick={() => onSave({
            title,
            notes: notes || null,
            dueAt: dueAt ? new Date(dueAt).toISOString() : null,
            tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
            priority,
            assignedToContactId: assignedToContactId || null,
          })}
          disabled={!title.trim()}
        >
          <Check /> Uložit
        </Button>
        <Button variant="ghost" onClick={onCancel}><X /> Zrušit</Button>
      </div>
    </div>
  );
}

function TaskRow({
  task, busy, contacts, todoistConfigured, onToggleDone, onUpdate, onDelete, onPush,
}: {
  task: Task;
  busy: boolean;
  contacts: Contact[];
  todoistConfigured: boolean;
  onToggleDone: () => void;
  onUpdate: (patch: Partial<Task>) => void;
  onDelete: () => void;
  onPush: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const isDone = task.status === "done";
  const dueDate = task.dueAt ? new Date(task.dueAt) : null;
  const isOverdue = dueDate && dueDate < new Date() && !isDone;
  const isToday = dueDate && dueDate.toDateString() === new Date().toDateString();

  return (
    <div className={`glass rounded-xl p-3 ${isDone ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-3">
        <button
          onClick={onToggleDone}
          disabled={busy}
          className={`mt-0.5 size-5 rounded border shrink-0 ${
            isDone ? "bg-[var(--tint-sage)]/40 border-[var(--tint-sage)]" : "border-white/30 hover:border-white/60"
          } grid place-items-center`}
        >
          {isDone && <Check className="size-3" />}
          {busy && !isDone && <Loader2 className="size-3 animate-spin" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className={`text-sm ${isDone ? "line-through" : ""}`}>{task.title}</div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs">
            {dueDate && (
              <span className={`flex items-center gap-1 font-mono ${isOverdue ? "text-[var(--tint-rose)]" : isToday ? "text-[var(--tint-butter)]" : "text-muted-foreground"}`}>
                <Clock className="size-3" />
                {dueDate.toLocaleDateString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" })}
                {task.dueIsTime && ` ${dueDate.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}`}
              </span>
            )}
            {task.assignedToContact && (
              <span className="flex items-center gap-1 text-[var(--tint-lavender)]">
                <UserCheck className="size-3" /> {task.assignedToContact.displayName}
              </span>
            )}
            {task.priority === "high" && (
              <span className="flex items-center gap-1 text-[var(--tint-rose)] font-mono">! priorita</span>
            )}
            {task.priority === "low" && (
              <span className="text-muted-foreground font-mono">↓ low</span>
            )}
            {task.tags.length > 0 && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Tag className="size-3" />
                {task.tags.map((t) => `#${t}`).join(" ")}
              </span>
            )}
            {task.todoistProjectName && (
              <span className="font-mono text-[var(--tint-sky)]">📁 {task.todoistProjectName}</span>
            )}
            {task.todoistTaskId && !task.todoistProjectName && (
              <span className="text-[var(--tint-sage)] font-mono">✓ Todoist</span>
            )}
            {task.source === "vip_call_log" && (
              <span className="font-mono text-[var(--tint-rose)]">⭐ VIP firewall</span>
            )}
            {task.source !== "manual" && task.source !== "vip_call_log" && (
              <span className="text-muted-foreground font-mono">[{task.source}]</span>
            )}
          </div>

          {(task.notes || task.rawSnippet) && (
            <button
              onClick={() => setShowDetail(!showDetail)}
              className="text-xs text-muted-foreground hover:text-foreground mt-1 flex items-center gap-1"
            >
              <ChevronDown className={`size-3 transition-transform ${showDetail ? "rotate-180" : ""}`} />
              detail
            </button>
          )}
          {showDetail && (
            <div className="mt-2 text-xs space-y-1">
              {task.notes && <div className="text-muted-foreground">{task.notes}</div>}
              {task.rawSnippet && <div className="italic text-muted-foreground">„{task.rawSnippet}"</div>}
              {task.pushError && (
                <div className="text-destructive">Push error: {task.pushError}</div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!task.todoistTaskId && todoistConfigured && !isDone && (
            <button
              onClick={onPush}
              disabled={busy}
              className="p-1.5 rounded hover:bg-[var(--tint-sage)]/20 text-muted-foreground hover:text-[var(--tint-sage)]"
              title="Push do Todoistu"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            </button>
          )}
          <button
            onClick={() => setEditing(!editing)}
            className="p-1.5 rounded hover:bg-white/5 text-muted-foreground"
            title="Upravit"
          >
            <Edit3 className="size-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground"
            title="Smazat"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {editing && (
        <EditInline
          task={task}
          contacts={contacts}
          onSave={(patch) => { onUpdate(patch); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function EditInline({
  task, contacts, onSave, onCancel,
}: {
  task: Task;
  contacts: Contact[];
  onSave: (patch: Partial<Task>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [dueAt, setDueAt] = useState(task.dueAt ? task.dueAt.slice(0, 10) : "");
  const [tags, setTags] = useState(task.tags.join(", "));
  const [priority, setPriority] = useState(task.priority);
  const [assigned, setAssigned] = useState(task.assignedToContact?.id ?? "");

  return (
    <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Poznámka"
        className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm resize-none"
      />
      <div className="grid grid-cols-3 gap-2">
        <input
          type="date"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="px-2 py-1.5 rounded-md bg-black/30 border border-white/10 text-sm"
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as "low" | "normal" | "high")}
          className="px-2 py-1.5 rounded-md bg-black/30 border border-white/10 text-sm"
        >
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
        <select
          value={assigned}
          onChange={(e) => setAssigned(e.target.value)}
          className="px-2 py-1.5 rounded-md bg-black/30 border border-white/10 text-sm"
        >
          <option value="">Já</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
        </select>
      </div>
      <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tagy (čárkou)" />
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => onSave({
            title,
            notes: notes || null,
            dueAt: dueAt ? new Date(dueAt).toISOString() : null,
            tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
            priority,
            assignedToContactId: assigned || null,
          })}
        ><Check /> Uložit</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}><X /> Zrušit</Button>
      </div>
    </div>
  );
}
