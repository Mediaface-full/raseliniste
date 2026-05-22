import { useEffect, useRef, useState } from "react";
import {
  Loader2, Plus, Pin, Trash2, Sparkles, FileText, Settings, Users, AudioLines,
  ChevronDown, ChevronRight, Copy, Check, FileAudio2, Mic, Send, FileDown,
  Star, RotateCw, Pencil, Paperclip, Upload, X as XIcon, Download,
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
    keepAudio: boolean;
    canUploadAudio: boolean;
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
    type: "STANDARD" | "BRIEF" | "UPLOAD";
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
    uploadedFilename: string | null;
  }>;
  summaries: Array<{
    id: string;
    text: string;
    model: string;
    recordingsIncluded: number;
    briefsIncluded: number;
    createdAt: string;
    status?: string;             // "ready" | "processing" | "error"
    processingError?: string | null;
  }>;
  files: Array<{
    id: string;
    originalName: string;
    mime: string;
    bytes: number;
    note: string | null;
    uploadedAt: string;
  }>;
}

type Tab = "feed" | "guests" | "summaries" | "files" | "settings";

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

  // Polling: pokud existuje processing recording NEBO summary, refresh à 5 s (bez loading flash).
  useEffect(() => {
    if (!project) return;
    const hasProcessing =
      project.recordings.some((r) => r.status === "processing") ||
      project.summaries.some((s) => s.status === "processing");
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
        <TabButton active={tab === "files"} onClick={() => setTab("files")}>
          <Paperclip className="size-4" /> Soubory ({project.files.length})
        </TabButton>
        <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
          <Settings className="size-4" /> Nastavení
        </TabButton>
      </div>

      {tab === "feed" && <FeedTab project={project} ownerName={ownerName} onRefresh={load} />}
      {tab === "guests" && <GuestsTab project={project} onRefresh={load} />}
      {tab === "summaries" && <SummariesTab project={project} onRefresh={load} />}
      {tab === "files" && <FilesTab project={project} onRefresh={load} />}
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
  const [regenAllBusy, setRegenAllBusy] = useState(false);

  async function regenerateAll() {
    const eligible = project.recordings.filter(
      (r) => (r.type === "STANDARD" || r.type === "BRIEF") && r.transcript,
    );
    if (eligible.length === 0) {
      alert("Žádné záznamy s přepisem k regeneraci.");
      return;
    }
    if (!confirm(
      `Přegenerovat AI analýzu u ${eligible.length} záznam${eligible.length === 1 ? "u" : eligible.length < 5 ? "ů" : "ů"}?\n\n` +
      `Spustí se Stage 2 (analýza nad přepisem) — audio se nepřepisuje znovu, takže je to rychlé a levné.\n` +
      `Použij po úpravě promptu projektu, ať se aplikuje na vše.`,
    )) return;
    setRegenAllBusy(true);
    try {
      const res = await fetch(`/api/studna/${project.id}/regenerate-all`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onRefresh();
      } else {
        alert(data.error ?? "Hromadná regenerace selhala.");
      }
    } finally {
      setRegenAllBusy(false);
    }
  }

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

  // Poslední záznam — preview pro hlavičku
  const lastRec = project.recordings.find((r) => r.status === "processed");

  return (
    <div className="space-y-4">
      {/* Poslední záznam — preview */}
      {lastRec && (
        <LastRecordingPreview recording={lastRec} />
      )}

      {/* Inline recorder — nahrávej rovnou bez odchodu na /studna/nahravka */}
      <OwnerRecorder
        ownerName={ownerName}
        projects={[{ id: project.id, name: project.name, description: project.description }]}
        compact
        onSuccess={onRefresh}
      />

      {/* Admin-only: nahrát hotový audio soubor (UPLOAD type).
          Petr 2026-05-14 hlásil "na mobilu nevidim tlacitko nahrát audio" —
          byl dole pod TextInputCard jako thin dashed button, ztrácel se.
          Přesunuto NAD TextInput + solid card styling pro viditelnost. */}
      <UploadAudioCard projectId={project.id} onSuccess={onRefresh} />

      {/* Admin-only: vložit hotový text (zápis schůzky) bez nahrávky */}
      <TextInputCard projectId={project.id} onSuccess={onRefresh} />

      {/* Zeptat se projektu — AI dotaz nad všemi záznamy */}
      <ProjectAskCard projectId={project.id} recordingsCount={project.recordings.filter((r) => r.status === "processed").length} />

      {project.recordings.length === 0 ? (
        <div className="glass rounded-xl p-6 text-center text-sm text-muted-foreground">
          Zatím žádné záznamy. Nahraj nahoře, nebo pošli odkaz hostům.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Hromadná regenerace — po úpravě promptu projektu */}
          <div className="flex items-center justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={regenerateAll}
              disabled={regenAllBusy}
              title="Spustí Stage 2 (AI analýzu) znovu nad všemi záznamy s přepisem. Použij po úpravě promptu projektu. Audio se nepřepisuje znovu — rychlé a levné."
            >
              {regenAllBusy ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
              Přegenerovat analýzu u všech
            </Button>
          </div>
          {project.recordings.map((r) => (
            <RecordingCard
              key={r.id}
              recording={r}
              busy={busy === r.id}
              onTogglePin={() => togglePin(r.id, r.isPinned)}
              onDelete={() => remove(r.id)}
              onRegenerate={() => regenerate(r.id)}
              onMarkError={() => markError(r.id)}
              onRefresh={onRefresh}
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
  onRefresh,
}: {
  recording: ProjectDetail["recordings"][number];
  busy: boolean;
  onTogglePin: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onMarkError: () => void;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  const [reuploading, setReuploading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const reuploadInputRef = useRef<HTMLInputElement | null>(null);

  async function saveManualTranscript() {
    const text = manualText.trim();
    if (!text) {
      alert("Přepis je prázdný.");
      return;
    }
    if (!confirm(
      `Uložit ruční přepis (${text.length} znaků) k tomuto záznamu od „${recording.authorName}"?\n\n` +
      `Spustí se AI analýza nad tvým textem (themes, summary, atd.). Záznam zůstává patřit ${recording.authorName}.`,
    )) return;
    setManualSaving(true);
    try {
      const res = await fetch(`/api/studna/recordings/${recording.id}/manual-transcript`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: text, runAnalysis: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error ?? "Uložení přepisu selhalo.");
        return;
      }
      setManualOpen(false);
      setManualText("");
      onRefresh();
    } finally {
      setManualSaving(false);
    }
  }

  async function cleanAndRegenerate() {
    if (!confirm(
      "Vyčistit audio přes ffmpeg a regenerovat?\n\n" +
      "Použij když Gemini nečte záznam kvůli hudbě/šumu v pozadí. " +
      "Filtr: highpass 200 Hz + lowpass 3 kHz + dynamická normalizace.\n\n" +
      "Pozor: ORIGINÁL SE PŘEPÍŠE vyčištěnou MP3 verzí. Pokud chceš zachovat původní, " +
      "stáhni si ho nejdřív tlačítkem Stáhnout.\n\n" +
      "Pokračovat?",
    )) return;
    setCleaning(true);
    try {
      const res = await fetch(`/api/studna/recordings/${recording.id}/clean-and-regenerate`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error ?? "Cleanup selhal.");
        return;
      }
      onRefresh();
    } finally {
      setCleaning(false);
    }
  }

  async function handleReupload(file: File) {
    if (!confirm(
      `Nahradit audio u tohoto záznamu souborem "${file.name}" (${(file.size / 1024 / 1024).toFixed(1)} MB)?\n\n` +
      `Starý přepis i analýza se smažou a spustí se AI pipeline znovu nad novým souborem.`,
    )) return;
    setReuploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/studna/recordings/${recording.id}/replace-audio`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error ?? "Reupload selhal.");
        return;
      }
      // Endpoint už spustil processing pipeline, jen znovu načti data.
      onRefresh();
    } finally {
      setReuploading(false);
      if (reuploadInputRef.current) reuploadInputRef.current.value = "";
    }
  }

  const created = new Date(recording.createdAt);
  const isUpload = recording.type === "UPLOAD";
  const tint = recording.type === "BRIEF" ? "mint" : isUpload ? "lavender" : "butter";
  const a = recording.analysis ?? {};
  // Petr 2026-05-15: pokud projekt měl custom prompt, Stage 2 vrátí
  // customExtract (volný markdown řízený Petrovým pokynem) místo strukturovaného
  // summary. Frontend ho zobrazí jako hlavní obsah.
  const hasCustomExtract = typeof a?.customExtract === "string" && a.customExtract.trim().length > 0;
  const customTitle: string | null = typeof a?.customTitle === "string" && a.customTitle.trim().length > 0 ? a.customTitle.trim() : null;
  const mainText: string = hasCustomExtract ? a.customExtract.trim() : (typeof a?.summary === "string" ? a.summary : "");
  const noteText = recording.guestNote?.trim() ?? "";
  // Petr 2026-05-20: snippet fallback chain: customTitle → mainText → transcript → guestNote
  // (host mohl poslat jen text přes /api/me/[token]/note bez audia)
  const summarySnippet = customTitle
    ? customTitle
    : (mainText
        ? mainText.slice(0, 140) + (mainText.length > 140 ? "…" : "")
        : ((recording.transcript ?? "").trim().slice(0, 140)
            || noteText.slice(0, 140)));

  // Petr 2026-05-20: prázdný shell — žádný audio, žádný transcript, žádný text.
  // Vznikl bug v note.ts validaci (text trim po min(1)) — opravený, ale starší
  // records v DB pořád existují. UI ukáže delete placeholder místo neviditelného nic.
  const isEmptyShell =
    recording.status === "processed" &&
    !recording.audioPath &&
    !(recording.transcript ?? "").trim() &&
    !noteText &&
    !hasCustomExtract &&
    !(typeof a?.summary === "string" && a.summary.trim());

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
          {recording.type === "BRIEF" ? <FileAudio2 className="size-5" /> : isUpload ? <Upload className="size-5" /> : <AudioLines className="size-5" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">
              {isUpload && recording.uploadedFilename
                ? recording.uploadedFilename
                : recording.authorName}
              {recording.isOwner && !isUpload && <span className="ml-1 text-[10px] font-mono opacity-60">(owner)</span>}
              {isUpload && (
                <span className="ml-1 text-[10px] font-mono opacity-60">
                  · {recording.authorName}{recording.isOwner ? " (owner)" : ""}
                </span>
              )}
            </span>
            <span
              className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: "color-mix(in oklch, var(--c) 20%, transparent)", color: "var(--c)" }}
            >
              {recording.type === "BRIEF" ? "Brief" : isUpload ? "📎 Upload" : "Záznam"}
            </span>
            {recording.isPinned && (
              <span className="text-[10px] uppercase font-mono tracking-wider text-[var(--tint-peach)] flex items-center gap-1">
                <Pin className="size-3" fill="currentColor" /> připnuto
              </span>
            )}
            {recording.status === "error" && (
              <span className="text-[10px] uppercase font-mono tracking-wider text-destructive">chyba zpracování</span>
            )}
            {/* Processing stav schován od uživatele (Petr 2026-05-07) — kolečko
                je matoucí ("můžu odejít?"). Záznam tu prostě je, polling
                ho automaticky doplní. "zrušit" tlačítko zachované, ale
                tiché — Petr ho najde když potřebuje. */}
            {recording.status === "processing" && (
              <button
                type="button"
                onClick={onMarkError}
                disabled={busy}
                className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground/40 hover:text-destructive disabled:opacity-50"
                title="Zrušit zpracování (pokud uvázlo) — pak můžeš Regenerovat"
              >
                ⨯
              </button>
            )}
          </div>
          <div className="text-xs font-mono text-muted-foreground mt-0.5">
            {created.toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })}
            {recording.audioDurationSec ? ` · ${formatDuration(recording.audioDurationSec)}` : ""}
            {a.sentiment && ` · ${a.sentiment}`}
          </div>

          {/* Collapsed preview — krátký řádek + tlačítko rozbalit */}
          {recording.status === "processed" && !expanded && summarySnippet && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-2 w-full text-left text-sm text-muted-foreground hover:text-foreground flex items-start gap-2 group"
              title="Rozbalit záznam"
            >
              <ChevronRight className="size-4 mt-0.5 shrink-0 text-muted-foreground group-hover:text-foreground transition-transform" />
              <span className="line-clamp-2 leading-relaxed italic">{summarySnippet}</span>
            </button>
          )}

          {/* Prázdný shell — vznikl bugem ve validaci /api/me/[token]/note (opraveno) */}
          {isEmptyShell && (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground italic">
              <span>Prázdný záznam (žádné audio ani text). Můžeš smazat →</span>
            </div>
          )}
          {recording.status === "processed" && expanded && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className="size-3" /> sbalit záznam
            </button>
          )}

          {/* Strukturovaný rozbor */}
          {expanded && recording.status === "processed" && a && (
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

              {/* Custom extract (volný markdown řízený Petrovým prompt projektu).
                  Petr 2026-05-15: pokud projekt má custom prompt, Stage 2 vrátí
                  customExtract místo strukturovaného summary. */}
              {hasCustomExtract && (
                <div className="rounded-md border border-[var(--tint-mint)]/25 bg-[var(--tint-mint)]/[0.05] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--tint-mint)] font-mono mb-2">
                    🎯 Vlastní extrakt
                  </div>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap">{a.customExtract}</div>
                </div>
              )}

              {/* Souhrn (default — pokud není custom extract) */}
              {!hasCustomExtract && a.summary && (
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
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowAudio(!showAudio)}
                      className="text-[11px] font-mono text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      {showAudio ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                      Přehrát audio
                    </button>
                    <a
                      href={`/api/studna/recordings/${recording.id}/audio?download=1`}
                      download
                      className="text-[11px] font-mono text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      <Download className="size-3" /> Stáhnout
                    </a>
                  </div>
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
            <div className="mt-2 space-y-2">
              <div className="rounded-md border border-destructive/30 bg-destructive/10 text-xs px-3 py-2 font-mono">
                {recording.processingError ?? "Zpracování selhalo."}
              </div>
              {/* Petr 2026-05-16: při chybě potřebuje slyšet audio aby ověřil
                  jestli je tiché/poškozené před regenerací. Předtím byl
                  přehrávač jen ve `processed` bloku, error stav ho neměl. */}
              {recording.audioPath && (
                <div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowAudio(!showAudio)}
                      className="text-[11px] font-mono text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      {showAudio ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                      Přehrát audio (zkontroluj jestli není tiché/poškozené)
                    </button>
                    <a
                      href={`/api/studna/recordings/${recording.id}/audio?download=1`}
                      download
                      className="text-[11px] font-mono text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      <Download className="size-3" /> Stáhnout
                    </a>
                  </div>
                  {showAudio && (
                    <audio
                      controls
                      src={`/api/studna/recordings/${recording.id}/audio`}
                      className="mt-2 w-full"
                    />
                  )}
                </div>
              )}

              {/* Ruční přepis — Petr poslechne audio a napíše přepis sám,
                  pak se spustí AI analýza. Záznam zůstává patřit původnímu autorovi. */}
              <div className="pt-1">
                <button
                  onClick={() => setManualOpen(!manualOpen)}
                  className="text-[11px] font-mono text-[var(--tint-mint)] hover:text-foreground flex items-center gap-1"
                >
                  {manualOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  Napsat přepis ručně (spustí AI analýzu nad mým textem)
                </button>
                {manualOpen && (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={manualText}
                      onChange={(e) => setManualText(e.target.value)}
                      placeholder={`Poslechni audio a napiš přepis sem. Po uložení se nad textem spustí AI analýza (summary, témata, ...). Záznam zůstává patřit ${recording.authorName}.`}
                      rows={8}
                      className="w-full text-sm bg-black/30 border border-white/10 rounded p-3 font-mono leading-relaxed"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={saveManualTranscript}
                        disabled={manualSaving || !manualText.trim()}
                        size="sm"
                        className="bg-[var(--tint-mint)]/20 text-[var(--tint-mint)] border-[var(--tint-mint)]/40"
                      >
                        {manualSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                        Uložit přepis + spustit analýzu
                      </Button>
                      <span className="text-[11px] font-mono text-muted-foreground">{manualText.length} znaků</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          {/* Skrytý file input pro reupload — admin nahradí audio (např. po konverzi formátu) */}
          <input
            ref={reuploadInputRef}
            type="file"
            accept="audio/*,.m4a,.mp3,.wav,.ogg,.opus,.aac,.webm,.mp4,.flac"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleReupload(f);
            }}
          />
          <button
            onClick={() => reuploadInputRef.current?.click()}
            disabled={busy || reuploading || cleaning}
            className="p-1.5 rounded hover:bg-[var(--tint-mint)]/20 transition-colors text-[var(--tint-mint)]"
            title="Nahradit audio (např. konvertovaný MP3/WAV když Gemini selže). Spustí AI pipeline znovu."
          >
            {reuploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          </button>
          {recording.audioPath && (
            <button
              onClick={cleanAndRegenerate}
              disabled={busy || reuploading || cleaning}
              className="p-1.5 rounded hover:bg-[var(--tint-butter)]/20 transition-colors text-[var(--tint-butter)]"
              title="Vyčistit audio přes ffmpeg (highpass 200 Hz + lowpass 3 kHz + dynaudnorm) a regenerovat. Použij když Gemini neumí přečíst kvůli hudbě/šumu v pozadí. POZOR: přepíše originál."
            >
              {cleaning ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            </button>
          )}
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

  async function toggleKeepAudio(guestId: string, current: boolean) {
    setBusy(guestId);
    try {
      await fetch(`/api/studna/${project.id}/invitations/${guestId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keepAudio: !current }),
      });
      onRefresh();
    } finally {
      setBusy(null);
    }
  }

  async function toggleUploadAudio(guestId: string, current: boolean) {
    setBusy(guestId);
    try {
      await fetch(`/api/studna/${project.id}/invitations/${guestId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ canUploadAudio: !current }),
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
                <label
                  className="flex items-center gap-2 text-xs cursor-pointer select-none"
                  title="Audio nahrávky tohoto hosta se nemažou po 14 dnech, zůstávají natrvalo."
                >
                  <input
                    type="checkbox"
                    checked={inv.keepAudio}
                    onChange={() => toggleKeepAudio(inv.guestUser.id, inv.keepAudio)}
                    disabled={busy === inv.guestUser.id}
                    className="size-3.5"
                  />
                  💾 Zachovávat audio
                </label>
                <label
                  className="flex items-center gap-2 text-xs cursor-pointer select-none"
                  title="Host může nahrávat hotové audio soubory (MP3/M4A/...). Spustí se jen přepis, žádná AI analýza. Audio + přepis se uchovávají natrvalo."
                >
                  <input
                    type="checkbox"
                    checked={inv.canUploadAudio}
                    onChange={() => toggleUploadAudio(inv.guestUser.id, inv.canUploadAudio)}
                    disabled={busy === inv.guestUser.id}
                    className="size-3.5"
                  />
                  📎 Upload audio
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
  const [keepAudio, setKeepAudio] = useState(false);
  const [canUploadAudio, setCanUploadAudio] = useState(false);
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
          keepAudio,
          canUploadAudio,
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
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={keepAudio} onChange={(e) => setKeepAudio(e.target.checked)} className="size-4" />
        💾 <strong>Zachovávat audio</strong> (audio nahrávky tohoto hosta se nemažou po 14 dnech)
      </label>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={canUploadAudio} onChange={(e) => setCanUploadAudio(e.target.checked)} className="size-4" />
        📎 <strong>Upload audio</strong> (host smí nahrávat hotové audio soubory MP3/M4A/... — jen přepis, žádná AI analýza, audio se uchovává)
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
        project.summaries.map((s) => {
          const isProcessing = s.status === "processing";
          const isError = s.status === "error";
          return (
          <details
            key={s.id}
            className="glass rounded-xl p-4"
            open
            style={isProcessing ? { borderColor: "color-mix(in oklch, var(--tint-butter) 35%, transparent)" } : undefined}
          >
            <summary className="cursor-pointer flex items-center flex-wrap gap-2 mb-2">
              <Sparkles className="size-4 text-[var(--tint-rose)]" />
              <span className="font-medium">
                {new Date(s.createdAt).toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })}
              </span>
              <span className="text-[11px] font-mono text-muted-foreground ml-2">
                {s.model} · {s.recordingsIncluded} záznamů ({s.briefsIncluded} briefů)
              </span>
              {/* Processing souhrn — kolečko schováno (Petr 2026-05-07).
                  Karta jen čeká, polling ji aktualizuje. */}
              {isError && (
                <span className="ml-auto text-[var(--tint-rose)] text-xs">⚠ chyba</span>
              )}
            </summary>
            {isProcessing ? (
              <div className="mt-2 text-sm text-muted-foreground italic py-4 text-center">
                Souhrn se připravuje na pozadí. Vrať se za chvíli — sám se objeví.
              </div>
            ) : isError ? (
              <div className="mt-2 text-sm text-[var(--tint-rose)] bg-[var(--tint-rose)]/10 rounded-md px-3 py-2">
                <div className="font-mono text-xs mb-1">Souhrn selhal:</div>
                <div className="text-xs whitespace-pre-wrap">{s.processingError || "neznámá chyba"}</div>
              </div>
            ) : (
              <div className="mt-2 text-sm leading-relaxed whitespace-pre-wrap prose prose-invert max-w-none">
                {s.text}
              </div>
            )}
          </details>
          );
        })
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
        {/* Petr 2026-05-15: extractionPrompt field je legacy/dead — neaplikuje
            se v žádném AI volání (jen ukládá do DB). Skryté. Pravé custom
            prompty jsou níž v sekci „⚙ Vlastní AI prompty pro tento projekt"
            (studnaStandardPrompt / studnaBriefPrompt) které opravdu řídí
            Stage 2 analýzu. Field v DB zachováno pro případnou budoucí
            funkčnost — neztratí se data. */}

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
        <div className="rounded-md border-2 border-[var(--tint-mint)]/30 bg-[var(--tint-mint)]/[0.04] p-3">
          <button
            type="button"
            onClick={() => setShowCustomPrompts((v) => !v)}
            className="flex items-center justify-between w-full text-left"
          >
            <span className="text-[11px] uppercase tracking-wider text-[var(--tint-mint)] font-mono font-semibold">
              🎯 Vlastní AI prompt pro analýzu nahrávek {(project.studnaStandardPrompt || project.studnaBriefPrompt) && "· AKTIVNÍ ✓"}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              {showCustomPrompts ? "skrýt" : "zobrazit"}
            </span>
          </button>
          {showCustomPrompts && (
            <div className="mt-3 space-y-3">
              <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                <strong className="text-foreground">Volný extrakt z přepisu.</strong> Sem napiš co konkrétně chceš
                z každé nahrávky vytáhnout — Stage 2 (analýza) vrátí <strong>volný markdown</strong> přesně dle tvých instrukcí,
                NE strukturované summary/themes. Výstup se zobrazí jako „🎯 Vlastní extrakt" v detailu záznamu.
                <br /><br />
                Příklady:
                <br />• <code className="text-xs">„Vytáhni seznam úkolů co z toho vyplynou: kdo, co, dokdy. Bullet list."</code>
                <br />• <code className="text-xs">„Klíčové rozhodnutí a důvody pro a proti. Markdown, 3-5 odstavců."</code>
                <br />• <code className="text-xs">„Jen jména osob a co ke každé z nich řekl. Tabulka markdown."</code>
                <br /><br />
                Prázdné = default strukturovaná analýza (summary + themes + thoughts + …).
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

        {/* Export přepisů */}
        <div className="pt-3 border-t border-white/5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium mb-0.5">Export přepisů</div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                Stáhne všechny přepisy záznamů (Standard i Brief) jako čistý Markdown,
                bez AI analýzy. Pro další zpracování v jiném nástroji.
              </div>
            </div>
            <a
              href={`/api/studna/${project.id}/export-transcripts`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-[var(--tint-mint)]/15 hover:bg-[var(--tint-mint)]/25 transition-colors"
              style={{ border: "1px solid color-mix(in oklch, var(--tint-mint) 30%, transparent)" }}
            >
              <FileDown className="size-4 text-[var(--tint-mint)]" />
              Stáhnout .md
            </a>
          </div>
        </div>

        <div className="flex gap-2 pt-3 border-t border-white/5">
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

// =============================================================================
// TextInputCard — admin-only: vložit hotový text (zápis schůzky) jako BRIEF/STANDARD
// =============================================================================
function TextInputCard({ projectId, onSuccess }: { projectId: string; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"STANDARD" | "BRIEF">("BRIEF");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (text.trim().length < 20) {
      setError("Text musí mít aspoň 20 znaků.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/studna/${projectId}/recording-text`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, text: text.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Vložení selhalo.");
        return;
      }
      setText("");
      setOpen(false);
      onSuccess();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full glass rounded-xl p-3 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors"
        style={{ ["--c" as string]: "var(--tint-mint)", borderStyle: "dashed" }}
      >
        <FileText className="size-4 text-[var(--tint-mint)]" />
        Vložit text místo nahrávky (zápis schůzky, brief)
      </button>
    );
  }

  return (
    <div
      className="glass rounded-xl p-4 space-y-3"
      style={{ ["--c" as string]: "var(--tint-mint)" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-[var(--tint-mint)]" />
          <span className="font-serif text-base">Vložit textový přepis</span>
        </div>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          zavřít
        </button>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Pro hotový zápis schůzky nebo dlouhý brief, který už máš jako text. AI přeskočí
        přepis a rovnou udělá strukturovanou analýzu — stejnou jako u nahrávky.
      </p>

      <div className="flex gap-2 items-center text-xs">
        <span className="text-muted-foreground">Typ:</span>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="text-type"
            checked={type === "BRIEF"}
            onChange={() => setType("BRIEF")}
            className="size-3.5"
          />
          <strong>Brief</strong> (Pro, hloubková)
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="text-type"
            checked={type === "STANDARD"}
            onChange={() => setType("STANDARD")}
            className="size-3.5"
          />
          Standard (Flash)
        </label>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Vlož text (zápis schůzky, briefovací poznámky...)"
        rows={10}
        className="w-full rounded-md bg-black/30 border border-white/10 p-3 text-sm leading-relaxed font-mono focus:outline-none focus:border-[var(--tint-mint)]/40 resize-y min-h-[200px]"
      />
      <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
        <span>{text.length.toLocaleString("cs-CZ")} znaků</span>
        {text.length >= 20 && <span className="text-[var(--tint-sage)]">✓ připraveno</span>}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={submit} disabled={busy || text.trim().length < 20}>
          {busy ? <Loader2 className="animate-spin" /> : <Send />} Uložit a analyzovat
        </Button>
        <Button variant="ghost" onClick={() => { setText(""); setError(null); }}>
          Vyčistit
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// FILES tab — admin přílohy (PDF, XLS, DOC...) bez AI analýzy
// =============================================================================
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function iconForMime(mime: string, name: string): React.ComponentType<{ className?: string }> {
  const m = mime.toLowerCase();
  if (m.includes("pdf")) return FileText;
  if (m.includes("audio")) return FileAudio2;
  if (m.includes("image")) return FileText; // fallback ikona
  if (m.includes("zip") || m.includes("rar") || m.includes("7z") || m.includes("tar")) return FileDown;
  if (name.match(/\.(xlsx?|csv)$/i)) return FileText;
  return FileText;
}

function FilesTab({ project, onRefresh }: { project: ProjectDetail; onRefresh: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const fileInputRef = useState<HTMLInputElement | null>(null);

  async function uploadFile(file: File) {
    setError(null);
    setUploading(true);
    setProgress(0);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (note.trim()) fd.append("note", note.trim());

      const xhr = new XMLHttpRequest();
      const done = new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            try {
              const data = JSON.parse(xhr.responseText);
              reject(new Error(data.error ?? `HTTP ${xhr.status}`));
            } catch {
              reject(new Error(`HTTP ${xhr.status}`));
            }
          }
        });
        xhr.addEventListener("error", () => reject(new Error("Síťová chyba")));
        xhr.open("POST", `/api/studna/${project.id}/files`);
        xhr.send(fd);
      });
      await done;
      setNote("");
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  async function deleteFile(fileId: string, name: string) {
    if (!confirm(`Smazat soubor „${name}"?`)) return;
    setBusy(fileId);
    try {
      const res = await fetch(`/api/studna/files/${fileId}`, { method: "DELETE" });
      if (res.ok) onRefresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Upload zone */}
      <div
        className="glass rounded-xl p-4 space-y-3"
        style={{ ["--c" as string]: "var(--tint-mint)" }}
      >
        <div className="flex items-center gap-2">
          <Paperclip className="size-4 text-[var(--tint-mint)]" />
          <span className="font-serif text-base">Přidat soubor</span>
          <span className="ml-auto text-[11px] font-mono text-muted-foreground">
            PDF, XLS, DOC, obrázky, ZIP — max 200 MB
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Soubory se neanalyzují AI. Slouží jako přílohy projektu — fakturace, tabulky, scany,
          podklady. Hosté je nevidí.
        </p>

        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder='Volitelný popis (např. "faktura listopad 2026")'
          className="w-full rounded-md bg-black/30 border border-white/10 px-3 py-2 text-sm focus:outline-none focus:border-[var(--tint-mint)]/40"
          disabled={uploading}
        />

        <div className="flex items-center gap-3">
          <label
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-md cursor-pointer text-sm transition-colors ${
              uploading
                ? "bg-white/5 text-muted-foreground cursor-not-allowed"
                : "bg-[var(--tint-mint)]/15 text-foreground hover:bg-[var(--tint-mint)]/25"
            }`}
            style={{ border: "1px solid color-mix(in oklch, var(--tint-mint) 30%, transparent)" }}
          >
            <Upload className="size-4" />
            {uploading ? "Nahrávám…" : "Vybrat soubor"}
            <input
              type="file"
              ref={(el) => { fileInputRef[1](el); }}
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {uploading && (
            <div className="flex-1 max-w-xs">
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--tint-mint)] transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                {progress}%
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {/* List */}
      {project.files.length === 0 ? (
        <div className="glass rounded-xl p-6 text-center text-sm text-muted-foreground">
          Zatím žádný soubor.
        </div>
      ) : (
        <div className="space-y-2">
          {project.files.map((f) => {
            const Icon = iconForMime(f.mime, f.originalName);
            return (
              <div
                key={f.id}
                className="glass rounded-xl p-3 flex items-center gap-3"
              >
                <div
                  className="size-10 rounded-md grid place-items-center shrink-0"
                  style={{
                    background: "color-mix(in oklch, var(--tint-mint) 12%, transparent)",
                    border: "1px solid color-mix(in oklch, var(--tint-mint) 25%, transparent)",
                  }}
                >
                  <Icon className="size-5 text-[var(--tint-mint)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <a
                      href={`/api/studna/files/${f.id}`}
                      className="text-sm font-medium hover:underline truncate"
                    >
                      {f.originalName}
                    </a>
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {fmtBytes(f.bytes)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {f.note ? `${f.note} · ` : ""}
                    {new Date(f.uploadedAt).toLocaleString("cs-CZ", {
                      day: "numeric", month: "numeric", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </div>
                </div>
                <a
                  href={`/api/studna/files/${f.id}`}
                  className="p-2 rounded-md hover:bg-white/5 text-muted-foreground hover:text-foreground"
                  title="Stáhnout"
                >
                  <Download className="size-4" />
                </a>
                <button
                  type="button"
                  onClick={() => deleteFile(f.id, f.originalName)}
                  disabled={busy === f.id}
                  className="p-2 rounded-md hover:bg-destructive/15 text-muted-foreground hover:text-destructive"
                  title="Smazat"
                >
                  {busy === f.id ? <Loader2 className="size-4 animate-spin" /> : <XIcon className="size-4" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// LastRecordingPreview — kompaktní karta v hlavičce záložky Záznamy
// =============================================================================
function LastRecordingPreview({ recording }: { recording: ProjectDetail["recordings"][number] }) {
  const created = new Date(recording.createdAt);
  const a = recording.analysis ?? {};
  const snippet =
    typeof a?.summary === "string" && a.summary.trim()
      ? a.summary.trim().slice(0, 220) + (a.summary.length > 220 ? "…" : "")
      : (recording.transcript ?? "").trim().slice(0, 220);

  return (
    <div
      className="glass-subtle rounded-xl p-3 flex items-start gap-3"
      style={{ borderLeft: "3px solid var(--tint-mint)" }}
    >
      <div
        className="size-8 rounded-md grid place-items-center shrink-0 mt-0.5"
        style={{ background: "color-mix(in oklch, var(--tint-mint) 15%, transparent)" }}
      >
        {recording.type === "BRIEF" ? (
          <FileAudio2 className="size-4 text-[var(--tint-mint)]" />
        ) : (
          <AudioLines className="size-4 text-[var(--tint-mint)]" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
            poslední záznam
          </span>
          <span className="text-xs font-mono">
            {created.toLocaleString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
          <span className="text-xs font-mono text-muted-foreground">·</span>
          <span className="text-xs font-medium">{recording.authorName}</span>
        </div>
        {snippet && (
          <p className="text-sm text-foreground/85 mt-1 leading-relaxed line-clamp-2">{snippet}</p>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// ProjectAskCard — AI Q&A nad všemi přepisy projektu
// =============================================================================
function ProjectAskCard({ projectId, recordingsCount }: { projectId: string; recordingsCount: number }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [estimate, setEstimate] = useState<{
    inputTokens: number;
    cost: { totalUsd: number };
    humanReadable: string;
    recordings: number;
  } | null>(null);
  const [busy, setBusy] = useState<"estimate" | "ask" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);

  async function fetchEstimate() {
    setError(null);
    setBusy("estimate");
    try {
      const res = await fetch(`/api/studna/${projectId}/ask?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Odhad selhal.");
        return;
      }
      setEstimate({
        inputTokens: data.estimate.inputTokens,
        cost: { totalUsd: data.estimate.cost.totalUsd },
        humanReadable: data.estimate.humanReadable,
        recordings: data.estimate.recordings,
      });
    } finally {
      setBusy(null);
    }
  }

  async function ask() {
    setError(null);
    setAnswer(null);
    setBusy("ask");
    try {
      const res = await fetch(`/api/studna/${projectId}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: q.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Dotaz selhal.");
        return;
      }
      setAnswer(data.answer);
    } finally {
      setBusy(null);
    }
  }

  if (recordingsCount === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full glass rounded-xl p-3 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors"
        style={{ ["--c" as string]: "var(--tint-lavender)", borderStyle: "dashed" }}
      >
        <Sparkles className="size-4 text-[var(--tint-lavender)]" />
        Zeptat se projektu (AI nad {recordingsCount} záznamy)
      </button>
    );
  }

  return (
    <div className="glass rounded-xl p-4 space-y-3" style={{ ["--c" as string]: "var(--tint-lavender)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-[var(--tint-lavender)]" />
          <span className="font-serif text-base">Zeptat se projektu</span>
        </div>
        <button
          type="button"
          onClick={() => { setOpen(false); setQ(""); setEstimate(null); setAnswer(null); setError(null); }}
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          zavřít
        </button>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        AI (Gemini Pro) si přečte všech {recordingsCount} přepisů + souhrnů a odpoví na tvou otázku.
        Cenu odhadneme předem.
      </p>

      <textarea
        value={q}
        onChange={(e) => { setQ(e.target.value); setEstimate(null); setAnswer(null); }}
        placeholder="Napiš otázku — třeba: Co Radek říkal o financích? Kolik je tam zmínek o Mortykovi? Shrň pro mě klíčová rozhodnutí z briefů."
        rows={3}
        className="w-full rounded-md bg-black/30 border border-white/10 p-3 text-sm leading-relaxed focus:outline-none focus:border-[var(--tint-lavender)]/40 resize-y min-h-[80px]"
        disabled={busy !== null}
      />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {estimate && !answer && (
        <div
          className="rounded-md px-3 py-2 text-xs space-y-1"
          style={{
            background: "color-mix(in oklch, var(--tint-butter) 8%, transparent)",
            border: "1px solid color-mix(in oklch, var(--tint-butter) 25%, transparent)",
          }}
        >
          <div className="font-mono">
            Odhad: <strong>{estimate.inputTokens.toLocaleString("cs-CZ")}</strong> input tokenů ·
            cena <strong>{estimate.humanReadable}</strong>
          </div>
          <div className="text-muted-foreground">
            (kontext: {estimate.recordings} záznamů, output max 4 000 tokenů ≈ $0.04)
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!estimate && !answer && (
          <Button
            onClick={fetchEstimate}
            disabled={busy !== null || q.trim().length < 3}
            variant="outline"
          >
            {busy === "estimate" ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Spočítat cenu
          </Button>
        )}
        {estimate && !answer && (
          <Button onClick={ask} disabled={busy !== null}>
            {busy === "ask" ? <Loader2 className="animate-spin" /> : <Send />}
            Spustit dotaz ({estimate.humanReadable})
          </Button>
        )}
        {(estimate || answer) && (
          <Button variant="ghost" onClick={() => { setEstimate(null); setAnswer(null); }}>
            Vyčistit
          </Button>
        )}
      </div>

      {answer && (
        <div className="rounded-md p-4 space-y-2 mt-3"
          style={{
            background: "color-mix(in oklch, var(--tint-lavender) 8%, transparent)",
            border: "1px solid color-mix(in oklch, var(--tint-lavender) 25%, transparent)",
          }}
        >
          <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">
            Odpověď
          </div>
          <div className="text-sm leading-relaxed whitespace-pre-wrap">{answer}</div>
          <div className="pt-2 border-t border-white/5 flex items-center justify-end gap-2 text-[11px] font-mono text-muted-foreground">
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(answer).catch(() => null)}
              className="hover:text-foreground inline-flex items-center gap-1"
            >
              <Copy className="size-3" /> Zkopírovat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// UploadAudioCard — admin upload audio souboru (MP3/M4A/...) jako UPLOAD recording
// =============================================================================
function UploadAudioCard({ projectId, onSuccess }: { projectId: string; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function uploadFile(file: File) {
    setError(null);
    setUploading(true);
    setProgress(0);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const xhr = new XMLHttpRequest();
      const done = new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            try {
              const data = JSON.parse(xhr.responseText);
              reject(new Error(data.error ?? `HTTP ${xhr.status}`));
            } catch {
              reject(new Error(`HTTP ${xhr.status}`));
            }
          }
        });
        xhr.addEventListener("error", () => reject(new Error("Síťová chyba")));
        xhr.open("POST", `/api/studna/${projectId}/upload-audio`);
        xhr.send(fd);
      });
      await done;
      onSuccess();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  if (!open) {
    // 2026-05-14: Solid card místo thin dashed button — Petr na mobilu nevidi.
    // Lavender tint, větší ikona, jasný popis. Card je hned pod rekordérem
    // (přesunuto v StudnaDetail.tsx).
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full glass rounded-xl p-4 flex items-center gap-3 text-left hover:bg-white/[0.04] transition-colors active:scale-[0.99]"
        style={{ ["--c" as string]: "var(--tint-lavender)", borderColor: "color-mix(in oklch, var(--tint-lavender) 30%, transparent)" }}
      >
        <div
          className="size-10 rounded-lg grid place-items-center shrink-0"
          style={{ background: "color-mix(in oklch, var(--tint-lavender) 20%, transparent)" }}
        >
          <Upload className="size-5 text-[var(--tint-lavender)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">Nahrát audio soubor</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            MP3 / M4A / WAV / podcast — jen přepis, bez AI analýzy
          </div>
        </div>
        <span className="text-muted-foreground text-lg shrink-0">→</span>
      </button>
    );
  }

  return (
    <div className="glass rounded-xl p-4 space-y-3" style={{ ["--c" as string]: "var(--tint-lavender)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Upload className="size-4 text-[var(--tint-lavender)]" />
          <span className="font-serif text-base">Nahrát audio soubor</span>
        </div>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          className="text-muted-foreground hover:text-foreground text-xs"
          disabled={uploading}
        >
          zavřít
        </button>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Hotová nahrávka (podcast, zápis schůzky, audiokniha…). MP3/M4A/WAV/OGG/AAC/FLAC, max 500 MB.
        Spustí se <strong>jen přepis</strong> — žádná AI analýza, audio + text zůstávají natrvalo.
      </p>

      <label
        className={`block w-full text-center py-4 rounded-md cursor-pointer transition-colors ${
          uploading ? "cursor-not-allowed opacity-60" : "hover:bg-[var(--tint-lavender)]/[0.08]"
        }`}
        style={{ border: "1px dashed color-mix(in oklch, var(--tint-lavender) 35%, transparent)" }}
      >
        <Upload className="size-5 mx-auto mb-1 text-[var(--tint-lavender)]" />
        <div className="text-sm">{uploading ? `Nahrávám… ${progress}%` : "Vybrat audio soubor"}</div>
        <input
          type="file"
          accept="audio/*,.m4a,.mp3,.wav,.ogg,.opus,.aac,.webm,.mp4,.flac"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadFile(f);
            e.target.value = "";
          }}
        />
      </label>

      {uploading && (
        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
          <div className="h-full bg-[var(--tint-lavender)] transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">
          {error}
        </div>
      )}
      <a
        href="/help/upload-audio"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] font-mono text-muted-foreground hover:text-foreground underline-offset-2 hover:underline self-start"
      >
        Návod pro hosty (pro sdílení) →
      </a>
    </div>
  );
}
