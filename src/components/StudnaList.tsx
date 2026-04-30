import { useEffect, useState } from "react";
import { Plus, Loader2, Mic, Waves, Users, AudioLines, Activity } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface Project {
  id: string;
  name: string;
  homeTitle: string | null;
  description: string | null;
  archivedAt: string | null;
  createdAt: string;
  _count: { recordings: number; invitations: number };
}

export default function StudnaList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/studna");
      const data = await res.json();
      if (res.ok) setProjects(data.projects);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="glass rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Načítám…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="text-sm text-muted-foreground flex-1">
          {projects.length} projekt{projects.length === 1 ? "" : projects.length < 5 ? "y" : "ů"}
        </div>
        <Button variant="outline" onClick={() => (window.location.href = "/studna/aktivita")}>
          <Activity /> Aktivita
        </Button>
        <Button variant="outline" onClick={() => (window.location.href = "/studna/nahravka")}>
          <Mic /> Nahrávat
        </Button>
        <Button onClick={() => setCreating(true)}>
          <Plus /> Nový projekt
        </Button>
      </div>

      {creating && (
        <NewProjectForm
          onCancel={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            window.location.href = `/studna/${p.id}`;
          }}
        />
      )}

      {projects.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center text-muted-foreground">
          Zatím žádné projekty. Vytvoř první klikem na <strong>Nový projekt</strong>.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {projects.map((p) => (
            <a
              key={p.id}
              href={`/studna/${p.id}`}
              className="glass rounded-xl p-4 hover:bg-white/5 transition-colors block"
              style={{ ["--c" as string]: "var(--tint-butter)" }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="size-10 rounded-md grid place-items-center shrink-0"
                  style={{
                    background: "color-mix(in oklch, var(--c) 18%, transparent)",
                    color: "var(--c)",
                  }}
                >
                  <Waves className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{p.name}</div>
                  {p.description && (
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.description}</div>
                  )}
                  <div className="mt-2 flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <AudioLines className="size-3" /> {p._count.recordings}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="size-3" /> {p._count.invitations}
                    </span>
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function NewProjectForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (p: Project) => void;
}) {
  const [name, setName] = useState("");
  const [homeTitle, setHomeTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/studna", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          homeTitle: homeTitle.trim() || null,
          description: description.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Vytvoření selhalo.");
        return;
      }
      onCreated(data.project);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass rounded-xl p-4 space-y-3" style={{ ["--c" as string]: "var(--tint-butter)" }}>
      <div className="font-serif text-base">Nový projekt</div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Název</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ART76 brainstorm" autoFocus />
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
          Zkratka pro plochu iPhone (max 9 znaků, ukáže se jako „G: ZKRATKA")
        </label>
        <Input
          value={homeTitle}
          onChange={(e) => setHomeTitle(e.target.value.slice(0, 9))}
          maxLength={9}
          placeholder="ART76"
        />
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
          Popis (kontext pro AI a pro hosty)
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="O čem ten projekt je. Pomáhá AI rozumět, co je důležité."
          className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm resize-none"
        />
      </div>
      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">{error}</div>}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={busy || !name.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Plus />} Vytvořit
        </Button>
        <Button variant="ghost" onClick={onCancel}>Zrušit</Button>
      </div>
    </div>
  );
}
