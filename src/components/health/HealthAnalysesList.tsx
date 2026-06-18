import { useEffect, useImperativeHandle, forwardRef, useState } from "react";
import {
  BookMarked,
  CalendarClock,
  Loader2,
  Mail,
  MailWarning,
  Sparkles,
  Trash2,
  User,
  X,
} from "lucide-react";
import { marked } from "marked";
import { Button } from "../ui/Button";

type AnalysisSummary = {
  id: string;
  periodFrom: string;
  periodTo: string;
  focus: string | null;
  trigger: "MANUAL" | "MONTHLY_AUTO";
  model: string;
  totalSamples: number | null;
  metricsWithData: number | null;
  emailSentAt: string | null;
  emailError: string | null;
  createdAt: string;
};

type AnalysisDetail = AnalysisSummary & {
  text: string;
  promptChars: number | null;
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
}
function fmtDateTime(s: string): string {
  return new Date(s).toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type HealthAnalysesListHandle = {
  refresh: () => void;
};

export const HealthAnalysesList = forwardRef<HealthAnalysesListHandle>((_, ref) => {
  const [items, setItems] = useState<AnalysisSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/health/analyses?limit=30");
      const data = await res.json();
      if (res.ok) setItems(data.analyses);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useImperativeHandle(ref, () => ({ refresh: load }), []);

  async function onDelete(id: string) {
    if (!confirm("Smazat tuto analýzu?")) return;
    await fetch(`/api/health/analyses/${id}`, { method: "DELETE", headers: { "content-type": "application/json" } });
    setItems((prev) => prev.filter((a) => a.id !== id));
    if (openId === id) setOpenId(null);
  }

  return (
    <div className="glass rounded-xl">
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookMarked className="size-4 text-muted-foreground" />
          <h2 className="font-serif text-xl">Uložené analýzy</h2>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
          {items.length} celkem
        </span>
      </div>

      {loading && (
        <div className="px-5 py-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Načítám…
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          Zatím žádné analýzy. Klikni na <strong className="text-foreground">Analyzovat</strong> a vytvoř první.
        </div>
      )}

      {!loading && items.length > 0 && (
        <ul className="divide-y divide-white/5">
          {items.map((a) => {
            const auto = a.trigger === "MONTHLY_AUTO";
            const tint = auto ? "butter" : "lavender";
            return (
              <li key={a.id} className="px-5 py-3 flex items-center gap-4 hover:bg-white/[0.03] transition-colors">
                <div
                  className="size-9 rounded-md grid place-items-center shrink-0"
                  style={{
                    background: `color-mix(in oklch, var(--tint-${tint}) 16%, transparent)`,
                    color: `var(--tint-${tint})`,
                  }}
                >
                  {auto ? <CalendarClock className="size-4" /> : <User className="size-4" />}
                </div>
                <a
                  href={`/health/analyza/${a.id}`}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-foreground">
                      {fmtDate(a.periodFrom)} → {fmtDate(a.periodTo)}
                    </span>
                    <span
                      className="text-[9px] uppercase tracking-widest font-mono rounded px-1.5 py-0.5"
                      style={{
                        background: `color-mix(in oklch, var(--tint-${tint}) 18%, transparent)`,
                        color: `var(--tint-${tint})`,
                      }}
                    >
                      {auto ? "měsíční" : "ruční"}
                    </span>
                    {a.emailSentAt && (
                      <span className="text-[9px] uppercase tracking-widest font-mono rounded px-1.5 py-0.5 bg-white/5 text-muted-foreground inline-flex items-center gap-1">
                        <Mail className="size-2.5" /> odeslán
                      </span>
                    )}
                    {a.emailError && (
                      <span className="text-[9px] uppercase tracking-widest font-mono rounded px-1.5 py-0.5 bg-destructive/15 text-destructive inline-flex items-center gap-1">
                        <MailWarning className="size-2.5" /> mail chyba
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono tabular mt-0.5">
                    vytvořeno {fmtDateTime(a.createdAt)}
                    {a.metricsWithData != null && <> · {a.metricsWithData} metrik · {a.totalSamples?.toLocaleString("cs-CZ")} záznamů</>}
                    {a.focus && <> · {a.focus.slice(0, 40)}…</>}
                  </div>
                </a>
                <Button variant="ghost" size="icon" onClick={() => onDelete(a.id)} aria-label="Smazat">
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {openId && <AnalysisDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
});
HealthAnalysesList.displayName = "HealthAnalysesList";

// ---- Detail modal ----
function AnalysisDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [a, setA] = useState<AnalysisDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/health/analyses/${id}`);
        const data = await res.json();
        if (!res.ok) { setError(data.error ?? "Chyba"); return; }
        setA(data.analysis);
      } catch {
        setError("Síťová chyba");
      }
    })();
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-6 pb-6 sm:pt-10 sm:pb-10"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-panel w-full max-w-3xl">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="size-10 rounded-lg grid place-items-center"
              style={{
                background: "color-mix(in oklch, var(--tint-lavender) 18%, transparent)",
                color: "var(--tint-lavender)",
              }}
            >
              <Sparkles className="size-5" />
            </div>
            <div>
              <h2 className="font-serif text-xl">
                {a ? `${fmtDate(a.periodFrom)} → ${fmtDate(a.periodTo)}` : "Detail analýzy"}
              </h2>
              {a && (
                <p className="text-xs text-muted-foreground font-mono tabular mt-0.5">
                  {a.trigger === "MONTHLY_AUTO" ? "měsíční automat" : "ruční"} · {fmtDateTime(a.createdAt)} · {a.model}
                </p>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Zavřít"><X /></Button>
        </div>

        <div className="p-6">
          {error && <div className="text-sm text-destructive">{error}</div>}
          {!a && !error && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Načítám…
            </div>
          )}
          {a && (
            <>
              {a.focus && (
                <div className="mb-4 rounded-md border border-white/10 bg-black/20 px-4 py-2 text-sm">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-0.5">
                    Focus
                  </div>
                  {a.focus}
                </div>
              )}
              <div
                className="prose-rasel rounded-lg border border-white/10 bg-black/20 p-5 text-[15px] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: marked.parse(a.text) as string }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
