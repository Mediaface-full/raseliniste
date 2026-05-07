import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Loader2 } from "lucide-react";

interface Recording {
  id: string;
  projectName: string;
  type: "STANDARD" | "BRIEF";
  status: string;
  durationSec: number | null;
  transcript: string;
  createdAt: string;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(sec: number | null): string {
  if (!sec || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s} s`;
  if (s === 0) return `${m} min`;
  return `${m} min ${s} s`;
}

export default function GuestRecordings({
  recordings,
  heading = "Tvé poslední záznamy",
  subtitle = "Klikni na záznam pro zobrazení kompletního přepisu — ať už víš, kde jsi skončil.",
  hideErrors = false,
}: {
  recordings: Recording[];
  heading?: string;
  subtitle?: string;
  /** Pokud true, error záznamy se hostovi vůbec nezobrazí (na /me/<token>).
      Petr je na svých stránkách (Prskavka, Studna admin) má vidět. */
  hideErrors?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const visible = hideErrors ? recordings.filter((r) => r.status !== "error") : recordings;

  if (visible.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="flex items-center gap-2 mb-3 px-1">
        <FileText className="size-4 text-[var(--tint-lavender)]" />
        <h2 className="font-serif text-lg tracking-tight">{heading}</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-3 px-1">{subtitle}</p>

      <div className="space-y-2">
        {visible.map((r) => {
          const isOpen = openId === r.id;
          const isProcessing = r.status === "processing";
          const isError = r.status === "error";
          return (
            <div
              key={r.id}
              className="glass rounded-xl overflow-hidden"
              style={{ ["--c" as string]: "var(--tint-lavender)" }}
            >
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : r.id)}
                className="w-full flex items-start gap-3 p-3 text-left hover:bg-white/[0.03] transition-colors"
                disabled={isProcessing || isError}
              >
                <span className="mt-0.5 text-muted-foreground">
                  {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-medium">{fmtDate(r.createdAt)}</span>
                    <span className="text-xs font-mono text-muted-foreground">{fmtTime(r.createdAt)}</span>
                    {r.type === "BRIEF" && (
                      <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--tint-rose)]/15 text-[var(--tint-rose)]">
                        brief
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {r.projectName} · {fmtDuration(r.durationSec)}
                    {isProcessing && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[var(--tint-butter)]">
                        <Loader2 className="size-3 animate-spin" /> zpracovává se
                      </span>
                    )}
                    {isError && (
                      <span className="ml-2 text-[var(--tint-rose)]">chyba zpracování</span>
                    )}
                  </div>
                </div>
              </button>
              {isOpen && !isProcessing && !isError && (
                <div className="px-4 pb-4 pt-0">
                  <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-2 pt-3 border-t border-white/[0.05]">
                    Přepis
                  </div>
                  {r.transcript.trim() ? (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{r.transcript}</p>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">Přepis je prázdný.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
