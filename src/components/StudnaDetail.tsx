import { useEffect, useState } from "react";
import {
  Loader2, Plus, Pin, Trash2, Sparkles, FileText, Settings, Users, AudioLines,
  ChevronDown, ChevronRight, Copy, Check, FileAudio2, Mic, Send, FileDown,
  Star, RotateCw, Pencil,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import OwnerRecorder from "./OwnerRecorder";

interface ProjectDetail {
  id: string;
  name: string;
  homeTitle: string | null;
  description: string | null;
  extractionPrompt: string | null;
  studnaStandardPrompt: string | null;
  studnaBriefPrompt: string | null;
  projectSummaryPrompt: string | null;
  analysisModel: string | null;
  includeInDigest: boolean;
  archivedAt: string | null;
  createdAt: string;
  invitations: Array<{
    canRecordBrief: boolean;
    invitedAt: string;
    guestUser: {
      id: string;
      name: string;
      email: string;
      phone: string | null;
      guestToken: string;
      lastSeenAt: string | null;
    };
  }>;
  recordings: Array<{
    id: string;
    authorName: string;
    isOwner: boolean;
    type: "STANDARD" | "BRIEF";
    status: string;
    processingError: string | null;
    audioPath: string | null;
    audioDurationSec: number | null;
    isPinned: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    analysis: any;
    transcript: string;
    guestNote: string | null;
    createdAt: string;
  }>;
  summaries: Array<{
    id: string;
    text: string;
    model: string;
    recordingsIncluded: number;
    briefsIncluded: number;
    createdAt: string;
  }>;
}

type Tab = "feed" | "guests" | "summaries" | "settings";

export default function StudnaDetail({ projectId, ownerName }: { projectId: string; ownerName: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("feed");

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch(`/api/studna/${projectId}`);
      const data = await res.json();
      if (res.ok) setProject(data.project);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [projectId]);

  // Polling: pokud existuje processing recording, refresh každých 5 s (bez loading flash).
  useEffect(() => {
    if (!project) return;
    const hasProcessing = project.recordings.some((r) => r.status === "processing");
    if (!hasProcessing) return;
    const interval = setInterval(() => load(false), 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  if (loading) {
    return (
      <div className="glass rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Načítám…
      </div>
    );
  }
  if (!project) {
    return <div className="text-muted-foreground">Projekt nenalezen.</div>;
  }

  const hasCustomStudnaPrompts = Boolean(project.studnaStandardPrompt || project.studnaBriefPrompt);

  return (
    <div className="space-y-4">
      {hasCustomStudnaPrompts && (
        <div
          className="rounded-md border border-[var(--tint-lavender)]/40 bg-[var(--tint-lavender)]/[0.08] px-3 py-2 text-[11px] font-mono text-[var(--tint-lavender)] cursor-pointer hover:bg-[var(--tint-lavender)]/[0.12]"
          onClick={() => setTab("settings")}
          title="Tento projekt má vlastní AI prompty pro analýzu — klikni pro úpravu"
        >
          ⚙ Tento projekt používá vlastní AI prompty (Studna Standard{project.studnaStandardPrompt ? " ✓" : ""}{project.studnaBriefPrompt ? ", Brief ✓" : ""})
        </div>
      )}

      {/* Tabs */}
      <div className="glass rounded-xl p-1.5 flex gap-1">
        <TabButton active={tab === "feed"} onClick={() => setTab("feed")}>
          <AudioLines className="size-4" /> Záznamy ({project.recordings.length})
        </TabButton>
        <TabButton active={tab === "guests"} onClick={() => setTab("guests")}>
          <Users className="size-4" /> Hosti ({project.invitations.length})
        </TabButton>
        <TabButton active={tab === "summaries"} onClick={() => setTab("summaries")}>
          <Sparkles className="size-4" /> Souhrny ({project.summaries.length})
        </TabButton>
        <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
          <Settings className="size-4" /> Nastavení
        </TabButton>
      </div>

      {tab === "feed" && <FeedTab project={project} ownerName={ownerName} onRefresh={load} />}
      {tab === "guests" && <GuestsTab project={project} onRefresh={load} />}
      {tab === "summaries" && <SummariesTab project={project} onRefresh={load} />}
      {tab === "settings" && <SettingsTab project={project} onRefresh={load} />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm transition-colors ${
        active ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

// =============================================================================
// FEED tab
// =============================================================================
function FeedTab({ project, ownerName, onRefresh }: { project: ProjectDetail; ownerName: string; onRefresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function togglePin(recId: string, current: boolean) {
    setBusy(recId);
    try {
      const res = await fetch(`/api/studna/recordings/${recId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isPinned: !current }),
      });
      if (res.ok) onRefresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(recId: string) {
    if (!confirm("Opravdu smazat záznam?")) return;
    setBusy(recId);
    try {
      const res = await fetch(`/api/studna/recordings/${recId}`, { method: "DELETE" });
      if (res.ok) onRefresh();
    } finally {
      setBusy(null);
    }
  }

  async function regenerate(recId: string) {
    setBusy(recId);
    try {
      const res = await fetch(`/api/studna/recordings/${recId}/regenerate`, {
        method: "POST",
      });
      if (res.ok) {
        onRefresh();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Regenerace selhala.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function markError(recId: string) {
    if (!confirm("Označit zpracování jako chybu? Pak budeš moct kliknout Regenerovat a zkusit to znovu.")) return;
    setBusy(recId);
    try {
      const res = await fetch(`/api/studna/recordings/${recId}/mark-error`, {
        method: "POST",
      });
      if (res.ok) {
        onRefresh();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Akce selhala.");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Inline recorder — nahrávej rovnou bez odchodu na /studna/nahravka */}
      <OwnerRecorder
        ownerName={ownerName}
        projects={[{ id: project.id, name: project.name, description: project.description }]}
        compact
        onSuccess={onRefresh}
      />

      {project.recordings.length === 0 ? (
        <div className="glass rounded-xl p-6 text-center text-sm text-muted-foreground">
          Zatím žádné záznamy. Nahraj nahoře, nebo pošli odkaz hostům.
        </div>
      ) : (
        <div className="space-y-3">
          {project.recordings.map((r) => (
            <RecordingCard
              key={r.id}
              recording={r}
              busy={busy === r.id}
              onTogglePin={() => togglePin(r.id, r.isPinned)}
              onDelete={() => remove(r.id)}
              onRegenerate={() => regenerate(r.id)}
              onMarkError={() => markError(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RecordingCard({
  recording,
  busy,
  onTogglePin,
  onDelete,
  onRegenerate,
  onMarkError,
}: {
  recording: ProjectDetail["recordings"][number];
  busy: boolean;
  onTogglePin: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onMarkError: () => void;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  const created = new Date(recording.createdAt);
  const tint = recording.type === "BRIEF" ? "mint" : "butter";
  const a = recording.analysis ?? {};

  return (
    <div
      className="glass rounded-xl p-4"
      style={{ ["--c" as string]: `var(--tint-${tint})` }}
    >
      <div className="flex items-start gap-3">
        <div
          className="size-10 rounded-md grid place-items-center shrink-0"
          style={{
            background: "color-mix(in oklch, var(--c) 18%, transparent)",
            color: "var(--c)",
          }}
        >
          {recording.type === "BRIEF" ? <FileAudio2 className="size-5" /> : <AudioLines className="size-5" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">
              {recording.authorName}
              {recording.isOwner && <span className="ml-1 text-[10px] font-mono opacity-60">(owner)</span>}
            </span>
            <span
              className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: "color-mix(in oklch, var(--c) 20%, transparent)", color: "var(--c)" }}
            >
              {recording.type === "BRIEF" ? "Brief" : "Záznam"}
            </span>
            {recording.isPinned && (
              <span className="text-[10px] uppercase font-mono tracking-wider text-[var(--tint-peach)] flex items-center gap-1">
                <Pin className="size-3" fill="currentColor" /> připnuto
              </span>
            )}
            {recording.status === "error" && (
              <span className="text-[10px] uppercase font-mono tracking-wider text-destructive">chyba zpracování</span>
            )}
            {recording.status === "processing" && (
              <>
                <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" /> zpracovávám
                </span>
                <button
                  type="button"
                  onClick={onMarkError}
                  disabled={busy}
                  className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground hover:text-destructive underline-offset-2 hover:underline disabled:opacity-50"
                  title="Zrušit zpracování (pokud uvázlo) — pak můžeš Regenerovat"
                >
                  zrušit
                </button>
              </>
            )}
          </div>
          <div className="text-xs font-mono text-muted-foreground mt-0.5">
            {created.toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })}
            {recording.audioDurationSec ? ` · ${formatDuration(recording.audioDurationSec)}` : ""}
            {a.sentiment && ` · ${a.sentiment}`}
          </div>

          {/* Strukturovaný rozbor */}
          {recording.status === "processed" && a && (
            <div className="mt-3 space-y-2.5">
              {/* Témata */}
              {Array.isArray(a.key_themes) && a.key_themes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {a.key_themes.map((t: string, i: number) => (
                    <span
                      key={i}
                      className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {/* Souhrn */}
              {a.summary && (
                <div className="text-sm leading-relaxed whitespace-pre-wrap">{a.summary}</div>
              )}

              {/* Myšlenky */}
              {Array.isArray(a.thoughts) && a.thoughts.length > 0 && (
                <div className="space-y-1.5 mt-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                    Myšlenky ({a.thoughts.length})
                  </div>
                  <ul className="space-y-1.5">
                    {a.thoughts.map((th: { text: string; importance: string; rationale: string; category: string }, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span
                          className="mt-1 size-2 rounded-full shrink-0"
                          style={{
                            background:
                              th.importance === "high"
                                ? "var(--tint-peach)"
                                : th.importance === "medium"
                                  ? "var(--tint-sage)"
                                  : "rgba(255,255,255,0.3)",
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div>{th.text}</div>
                          {th.rationale && (
                            <div className="text-[11px] text-muted-foreground italic mt-0.5">{th.rationale}</div>
                          )}
                          <div className="text-[10px] font-mono text-muted-foreground/70 mt-0.5">
                            {th.category} · {th.importance}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Otevřené otázky */}
              {Array.isArray(a.open_questions) && a.open_questions.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-1">
                    Otevřené otázky
                  </div>
                  <ul className="text-sm space-y-0.5">
                    {a.open_questions.map((q: string, i: number) => (
                      <li key={i} className="flex gap-2"><span>•</span> <span>{q}</span></li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Intensity signals */}
              {a.intensity_signals && (
                <div className="mt-2 text-xs text-muted-foreground italic border-l-2 pl-2" style={{ borderColor: "var(--c)" }}>
                  {a.intensity_signals}
                </div>
              )}

              {/* Brief-only sekce */}
              {recording.type === "BRIEF" && Array.isArray(a.glossary) && a.glossary.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[11px] uppercase tracking-wider text-muted-foreground font-mono cursor-pointer">
                    Glosář pojmů ({a.glossary.length})
                  </summary>
                  <dl className="mt-2 space-y-1 text-sm">
                    {a.glossary.map((g: { term: string; definition: string }, i: number) => (
                      <div key={i}>
                        <dt className="font-medium inline">{g.term}</dt>
                        <dd className="inline text-muted-foreground"> — {g.definition}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
              {recording.type === "BRIEF" && Array.isArray(a.actors) && a.actors.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[11px] uppercase tracking-wider text-muted-foreground font-mono cursor-pointer">
                    Aktéři ({a.actors.length})
                  </summary>
                  <ul className="mt-2 space-y-1 text-sm">
                    {a.actors.map((ac: { name: string; role: string }, i: number) => (
                      <li key={i}>
                        <strong>{ac.name}</strong> — <span className="text-muted-foreground">{ac.role}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {recording.type === "BRIEF" && Array.isArray(a.decision_history) && a.decision_history.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[11px] uppercase tracking-wider text-muted-foreground font-mono cursor-pointer">
                    Rozhodnutí ({a.decision_history.length})
                  </summary>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {a.decision_history.map((d: any, i: number) => {
                      // AI může vrátit string (starší formát) NEBO objekt {decision, rationale, timestamp}
                      if (typeof d === "string") {
                        return <li key={i} className="flex gap-2"><span>•</span> <span>{d}</span></li>;
                      }
                      if (d && typeof d === "object") {
                        return (
                          <li key={i} className="flex gap-2">
                            <span>•</span>
                            <div className="flex-1">
                              <div>{d.decision ?? "(bez popisu)"}</div>
                              {d.rationale && (
                                <div className="text-xs text-muted-foreground italic mt-0.5">
                                  {d.rationale}
                                </div>
                              )}
                              {d.timestamp && (
                                <div className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">
                                  {d.timestamp}
                                </div>
                              )}
                            </div>
                          </li>
                        );
                      }
                      return null;
                    })}
                  </ul>
                </details>
              )}

              {/* Plný transkript */}
              {/* Textové info k projektu od hosta vedle nahrávky — odkazy,
                  jména, čísla. Petr to potřebuje VIDĚT (lavender + ikona
                  tužky), aby si nemusel domýšlet co host v hlasu zkomolil. */}
              {recording.guestNote && (
                <div className="pt-3 mt-1">
                  <div
                    className="rounded-lg p-3 border-l-4"
                    style={{
                      background: "color-mix(in oklch, var(--tint-lavender) 14%, transparent)",
                      borderLeftColor: "var(--tint-lavender)",
                      borderTop: "1px solid color-mix(in oklch, var(--tint-lavender) 30%, transparent)",
                      borderRight: "1px solid color-mix(in oklch, var(--tint-lavender) 30%, transparent)",
                      borderBottom: "1px solid color-mix(in oklch, var(--tint-lavender) 30%, transparent)",
                    }}
                  >
                    <div
                      className="text-[11px] font-mono uppercase tracking-wider mb-1.5 flex items-center gap-1.5 font-semibold"
                      style={{ color: "color-mix(in oklch, var(--tint-lavender) 90%, white)" }}
                    >
                      <Pencil className="size-3" /> Textové info k projektu
                    </div>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/95">
                      {recording.guestNote}
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-white/5">
                <button
                  onClick={() => setShowTranscript(!showTranscript)}
                  className="text-[11px] font-mono text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  {showTranscript ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  Plný transkript
                </button>
                {showTranscript && (
                  <div className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-foreground/80 max-h-[400px] overflow-y-auto bg-black/20 rounded p-3">
                    {recording.transcript}
                  </div>
                )}
              </div>

              {/* Audio přehrávač (pokud existuje) */}
              {recording.audioPath && (
                <div className="pt-1">
                  <button
                    onClick={() => setShowAudio(!showAudio)}
                    className="text-[11px] font-mono text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    {showAudio ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                    Přehrát audio
                  </button>
                  {showAudio && (
                    <audio
                      controls
                      src={`/api/studna/recordings/${recording.id}/audio`}
                      className="mt-2 w-full"
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {recording.status === "error" && (
            <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 text-xs px-3 py-2 font-mono">
              {recording.processingError ?? "Zpracování selhalo."}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={onTogglePin}
            disabled={busy}
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
            title={recording.isPinned ? "Odepnout" : "Připnout (zachovat audio)"}
          >
            <Pin
              className="size-4"
              style={{ color: recording.isPinned ? "var(--tint-peach)" : "var(--muted-foreground)" }}
              fill={recording.isPinned ? "currentColor" : "none"}
            />
          </button>
          {recording.audioPath && recording.status !== "processing" && (
            <button
              onClick={onRegenerate}
              disabled={busy}
              className="p-1.5 rounded hover:bg-[var(--tint-sky)]/20 transition-colors text-[var(--tint-sky)]"
              title={recording.status === "processed"
                ? "Přegenerovat AI analýzu (přepis + resumé znovu z audia)"
                : "Regenerovat AI analýzu z uloženého audia"}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={busy}
            className="p-1.5 rounded hover:bg-destructive/20 transition-colors text-muted-foreground"
            title="Smazat"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// =============================================================================
// GUESTS tab
// =============================================================================
function GuestsTab({ project, onRefresh }: { project: ProjectDetail; onRefresh: () => void }) {
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function copyLink(token: string) {
    const link = `${window.location.origin}/me/${token}`;
    await navigator.clipboard.writeText(link);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  }

  async function toggleBrief(guestId: string, current: boolean) {
    setBusy(guestId);
    try {
      await fetch(`/api/studna/${project.id}/invitations/${guestId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ canRecordBrief: !current }),
      });
      onRefresh();
    } finally {
      setBusy(null);
    }
  }

  async function removeInvite(guestId: string) {
    if (!confirm("Odebrat hosta z projektu? Jeho předchozí záznamy zůstanou.")) return;
    setBusy(guestId);
    try {
      await fetch(`/api/studna/${project.id}/invitations/${guestId}`, { method: "DELETE" });
      onRefresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {!inviting && (
          <Button onClick={() => setInviting(true)}>
            <Plus /> Pozvat přispěvatele
          </Button>
        )}
      </div>

      {inviting && (
        <InviteForm
          projectId={project.id}
          onCancel={() => setInviting(false)}
          onInvited={(link) => {
            setInviting(false);
            onRefresh();
            navigator.clipboard.writeText(link).catch(() => null);
            alert(`Pozvánka vytvořena.\n\nLink (zkopírováno do schránky):\n${link}`);
          }}
        />
      )}

      {project.invitations.length === 0 && !inviting && (
        <div className="glass rounded-xl p-6 text-center text-muted-foreground text-sm">
          Zatím nikdo nepozván.
        </div>
      )}

      {project.invitations.map((inv) => {
        const link = `${typeof window !== "undefined" ? window.location.origin : ""}/me/${inv.guestUser.guestToken}`;
        return (
          <div key={inv.guestUser.id} className="glass rounded-xl p-4" style={{ ["--c" as string]: "var(--tint-lavender)" }}>
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{inv.guestUser.name}</div>
                <div className="text-xs font-mono text-muted-foreground">{inv.guestUser.email}</div>
                {inv.guestUser.phone && (
                  <div className="text-xs font-mono text-muted-foreground">{inv.guestUser.phone}</div>
                )}
                <div className="text-[11px] text-muted-foreground mt-1">
                  {inv.guestUser.lastSeenAt
                    ? `naposledy online: ${new Date(inv.guestUser.lastSeenAt).toLocaleDateString("cs-CZ")}`
                    : "ještě nebyl"}
                </div>
              </div>

              <div className="flex flex-col gap-2 items-end">
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={inv.canRecordBrief}
                    onChange={() => toggleBrief(inv.guestUser.id, inv.canRecordBrief)}
                    disabled={busy === inv.guestUser.id}
                    className="size-3.5"
                  />
                  <Star className="size-3" /> Klíčový brief
                </label>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => copyLink(inv.guestUser.guestToken)}>
                    {copied === inv.guestUser.guestToken ? <Check className="size-3" /> : <Copy className="size-3" />}
                    Kopírovat link
                  </Button>
                  <a
                    href={`/api/studna/${project.id}/onboarding/${inv.guestUser.id}/${inv.canRecordBrief ? "brief" : "standard"}.pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-white/5 hover:bg-white/10"
                    title="Stáhnout onboarding PDF"
                  >
                    <FileDown className="size-3" /> PDF
                  </a>
                  <button
                    onClick={() => removeInvite(inv.guestUser.id)}
                    disabled={busy === inv.guestUser.id}
                    className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-2 text-[10px] font-mono text-muted-foreground/80 truncate">{link}</div>
          </div>
        );
      })}
    </div>
  );
}

function InviteForm({
  projectId,
  onCancel,
  onInvited,
}: {
  projectId: string;
  onCancel: () => void;
  onInvited: (link: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [canBrief, setCanBrief] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/studna/${projectId}/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          canRecordBrief: canBrief,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Pozvání selhalo.");
        return;
      }
      onInvited(data.link);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass rounded-xl p-4 space-y-3" style={{ ["--c" as string]: "var(--tint-lavender)" }}>
      <div className="font-serif text-base">Nový přispěvatel</div>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jméno" autoFocus />
      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
      <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefon (volitelné)" />
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={canBrief} onChange={(e) => setCanBrief(e.target.checked)} className="size-4" />
        Smí nahrávat <strong>Klíčový brief</strong> (dlouhé audio přes upload, hloubková AI analýza)
      </label>
      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">{error}</div>}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={busy || !name.trim() || !email.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Send />} Vytvořit a získat link
        </Button>
        <Button variant="ghost" onClick={onCancel}>Zrušit</Button>
      </div>
    </div>
  );
}

// =============================================================================
// SUMMARIES tab
// =============================================================================
function SummariesTab({ project, onRefresh }: { project: ProjectDetail; onRefresh: () => void }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!confirm(`Vytvořit nový AI souhrn? Použije Gemini Pro nad ${project.recordings.filter((r) => r.status === "processed").length} záznamy.`)) return;
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch(`/api/studna/${project.id}/summary`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Generování selhalo.");
        return;
      }
      onRefresh();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={generate} disabled={generating}>
          {generating ? <><Loader2 className="animate-spin" /> Generuji…</> : <><Sparkles /> Souhrn projektu</>}
        </Button>
      </div>

      {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">{error}</div>}

      {project.summaries.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center text-muted-foreground text-sm">
          Zatím žádný souhrn. Klikni na <strong>Souhrn projektu</strong> pro hloubkovou analýzu Gemini Pro
          nad všemi záznamy.
        </div>
      ) : (
        project.summaries.map((s) => (
          <details key={s.id} className="glass rounded-xl p-4" open>
            <summary className="cursor-pointer flex items-center gap-2 mb-2">
              <Sparkles className="size-4 text-[var(--tint-rose)]" />
              <span className="font-medium">
                {new Date(s.createdAt).toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })}
              </span>
              <span className="text-[11px] font-mono text-muted-foreground ml-2">
                {s.model} · {s.recordingsIncluded} záznamů ({s.briefsIncluded} briefů)
              </span>
            </summary>
            <div className="mt-2 text-sm leading-relaxed whitespace-pre-wrap prose prose-invert max-w-none">
              {s.text}
            </div>
          </details>
        ))
      )}
    </div>
  );
}

// =============================================================================
// SETTINGS tab
// =============================================================================
function SettingsTab({ project, onRefresh }: { project: ProjectDetail; onRefresh: () => void }) {
  const [name, setName] = useState(project.name);
  const [homeTitle, setHomeTitle] = useState(project.homeTitle ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [extractionPrompt, setExtractionPrompt] = useState(project.extractionPrompt ?? "");
  const [studnaStandardPrompt, setStudnaStandardPrompt] = useState(project.studnaStandardPrompt ?? "");
  const [studnaBriefPrompt, setStudnaBriefPrompt] = useState(project.studnaBriefPrompt ?? "");
  const [projectSummaryPrompt, setProjectSummaryPrompt] = useState(project.projectSummaryPrompt ?? "");
  const [analysisModel, setAnalysisModel] = useState<string>(project.analysisModel ?? "");
  const [showCustomPrompts, setShowCustomPrompts] = useState(
    Boolean(project.studnaStandardPrompt || project.studnaBriefPrompt),
  );
  const [includeInDigest, setIncludeInDigest] = useState(project.includeInDigest);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/studna/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          homeTitle: homeTitle.trim() || null,
          description: description.trim() || null,
          extractionPrompt: extractionPrompt.trim() || null,
          analysisModel: analysisModel || null,
          projectSummaryPrompt: projectSummaryPrompt.trim() || null,
          studnaStandardPrompt: studnaStandardPrompt.trim() || null,
          studnaBriefPrompt: studnaBriefPrompt.trim() || null,
          includeInDigest,
        }),
      });
      if (res.ok) {
        setSavedAt(Date.now());
        onRefresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteProject() {
    const t = prompt(`Pro potvrzení napiš název projektu: ${project.name}`);
    if (t !== project.name) return;
    const res = await fetch(`/api/studna/${project.id}`, { method: "DELETE" });
    if (res.ok) window.location.href = "/studna";
  }

  return (
    <div className="space-y-3">
      <div className="glass rounded-xl p-4 space-y-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Název</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Zkratka pro plochu (max 9 znaků)
          </label>
          <Input value={homeTitle} maxLength={9} onChange={(e) => setHomeTitle(e.target.value.slice(0, 9))} />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Popis</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm resize-none"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Vlastní AI prompt (volitelné — pokud prázdný, použije se default)
          </label>
          <textarea
            value={extractionPrompt}
            onChange={(e) => setExtractionPrompt(e.target.value)}
            rows={5}
            placeholder="Pro tento projekt zaměř pozornost zejména na…"
            className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm resize-none"
          />
        </div>

        {/* Vlastní prompt pro Souhrn projektu (volá tlačítko "Souhrn projektu"
            v detailu — agregát napříč všemi nahrávkami, vrací markdown).
            Pozor: NENÍ to per-recording analýza, je to mapa CELÉHO projektu. */}
        <div className="rounded-md border border-[var(--tint-rose)]/25 bg-[var(--tint-rose)]/[0.04] p-3">
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] uppercase tracking-wider text-[var(--tint-rose)] font-mono">
              ✨ Vlastní prompt pro Souhrn projektu
            </label>
            {projectSummaryPrompt && (
              <button
                type="button"
                onClick={() => setProjectSummaryPrompt("")}
                className="text-[10px] font-mono text-muted-foreground hover:text-destructive"
              >
                Resetovat na default
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed mb-2">
            Sem patří „mapa projektu", „index osob", „bílá místa", „časová osa" atd. Spustí se kliknutím na
            tlačítko <strong>Souhrn projektu</strong>. Pracuje s <strong>VŠEMI</strong> zpracovanými nahrávkami,
            ne s jednou. Vrací markdown — <strong>nemusíš</strong> řešit JSON schéma.
            <br />
            <span className="text-[var(--tint-rose)]">Když je vyplněno</span>, Gemini Pro dostane <strong>plné přepisy</strong> všech nahrávek
            (raw materiál, ne osekanou analýzu) + víc prostoru na výstup (32k tokenů). Pro kreativní práci
            (knížka, podcast, biografie) tohle dramaticky zvedne kvalitu.
          </p>
          <textarea
            value={projectSummaryPrompt}
            onChange={(e) => setProjectSummaryPrompt(e.target.value)}
            rows={10}
            placeholder={'Prázdné = použije se default „senior projektový analytik" prompt. Sem napiš co od souhrnu chceš (mapu kapitol, index osob s #, bílá místa, časovou osu, …).'}
            className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-xs font-mono resize-y"
          />
        </div>

        {/* Per-projekt Gemini model pro Stage 2 (analýzu nahrávky). */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Gemini model pro analýzu
          </label>
          <select
            value={analysisModel}
            onChange={(e) => setAnalysisModel(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm"
          >
            <option value="">Auto (krátké = Flash, Brief = Pro) — default</option>
            <option value="gemini-2.5-flash">Flash 2.5 — rychlejší, levnější</option>
            <option value="gemini-2.5-pro">Pro 2.5 — pomalejší, lepší pro kreativní práci</option>
          </select>
          <p className="text-[11px] text-muted-foreground/80 mt-1 leading-relaxed">
            Použije se na všechny analýzy v tomhle projektu (Standard i Brief). Stage 1 (přepis) je vždy Flash.
          </p>
        </div>

        {/* Per-projekt Stage 2 prompty — pokročilé, pro projekty kde standardní
            globální analýza nestačí (jiný typ výstupu, vlastní formát). */}
        <div className="rounded-md border border-white/5 bg-white/[0.02] p-3">
          <button
            type="button"
            onClick={() => setShowCustomPrompts((v) => !v)}
            className="flex items-center justify-between w-full text-left"
          >
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              ⚙ Vlastní AI prompty pro tento projekt {(project.studnaStandardPrompt || project.studnaBriefPrompt) && "· aktivní"}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              {showCustomPrompts ? "skrýt" : "zobrazit"}
            </span>
          </button>
          {showCustomPrompts && (
            <div className="mt-3 space-y-3">
              <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                Přepíše globální Studna prompt POUZE pro tento projekt. Když prázdné, použije se globální
                z <code className="font-mono">/settings/ai-prompts</code> (nebo default v kódu). Zachovej
                JSON schéma a explicitní instrukci češtiny v textech, jinak Gemini může vrátit anglicky.
              </p>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                    Standard (krátké záznamy, Flash model)
                  </label>
                  {studnaStandardPrompt && (
                    <button
                      type="button"
                      onClick={() => setStudnaStandardPrompt("")}
                      className="text-[10px] font-mono text-muted-foreground hover:text-destructive"
                    >
                      Resetovat na default
                    </button>
                  )}
                </div>
                <textarea
                  value={studnaStandardPrompt}
                  onChange={(e) => setStudnaStandardPrompt(e.target.value)}
                  rows={8}
                  placeholder="Prázdné = použije se globální studna-standard prompt"
                  className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-xs font-mono resize-y"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                    Brief (dlouhé brief 30–90 min, Pro model)
                  </label>
                  {studnaBriefPrompt && (
                    <button
                      type="button"
                      onClick={() => setStudnaBriefPrompt("")}
                      className="text-[10px] font-mono text-muted-foreground hover:text-destructive"
                    >
                      Resetovat na default
                    </button>
                  )}
                </div>
                <textarea
                  value={studnaBriefPrompt}
                  onChange={(e) => setStudnaBriefPrompt(e.target.value)}
                  rows={8}
                  placeholder="Prázdné = použije se globální studna-brief prompt"
                  className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-xs font-mono resize-y"
                />
              </div>
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={includeInDigest}
            onChange={(e) => setIncludeInDigest(e.target.checked)}
            className="size-4"
          />
          Zahrnout do denního souhrnu (e-mail v 7:00 ráno)
        </label>
        <div className="flex gap-2 pt-2 border-t border-white/5">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />} Uložit
          </Button>
          {savedAt && Date.now() - savedAt < 3000 && (
            <span className="self-center text-xs font-mono text-[var(--tint-sage)]">Uloženo ✓</span>
          )}
          <Button variant="ghost" onClick={deleteProject} className="ml-auto">
            <Trash2 /> Smazat projekt
          </Button>
        </div>
      </div>
    </div>
  );
}
