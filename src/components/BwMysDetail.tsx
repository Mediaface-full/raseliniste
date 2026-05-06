import { useEffect, useState } from "react";
import { Loader2, Plus, Clock, MessageSquare, AlertTriangle, Send, ChevronDown, ChevronUp, Mic, Trash2, Pencil, X, Save, Sparkles, FileDown, Printer } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import BwMysAudioRecorder from "./BwMysAudioRecorder";
import BwMysViz from "./BwMysViz";
import ArgumentsGrid, { type DecisionArgument } from "./BwMysViz/ArgumentsGrid";
import DecisionCompass from "./BwMysViz/DecisionCompass";
import SixHatsRadar from "./BwMysViz/SixHatsRadar";
import MoodCurve from "./BwMysViz/MoodCurve";
import EntryTypesDonut from "./BwMysViz/EntryTypesDonut";

interface Decision {
  id: string;
  nazev: string;
  otazka: string;
  kontext: string;
  status: string;
  varianty: string[];
  predpoklady: string[];
  deadlineRozhodnuti: string;
  delkaSberuDny: number;
  datumVytvoreni: string;
  datumUzavreni: string | null;
  verdiktText: string | null;
  coByZmeniloVerdikt: string | null;
  autorstvi: string;
  autorstviKdo: string | null;
  odlozeneUzavreniDo: string | null;
  uzavrenoPresUpozorneni: boolean;
  entries: DecisionEntry[];
  evaluations: DecisionEvaluation[];
}

interface DecisionEntry {
  id: string;
  datum: string;
  nalada: number;
  typVstupu: string;
  uhelPohledu: string;
  uhelPohleduAi?: string | null;
  stavSystemu: string;
  obsah: string;
  status?: string;            // "ready" | "processing" | "error"
  processingError?: string | null;
}

const STAV_OPTIONS: { value: string; label: string; popisek: string; color: string }[] = [
  { value: "aktivovany", label: "Aktivovaný", popisek: "neklid, tlak, zrychlení", color: "var(--tint-rose)" },
  { value: "stazeny", label: "Stažený", popisek: "otupělost, mlha, odpojenost", color: "var(--tint-lavender)" },
  { value: "klidny", label: "Klidný", popisek: "tělo i hlava souhlasí", color: "var(--tint-sage)" },
  { value: "nevim", label: "Nevím", popisek: "nedokážu to rozlišit", color: "#8a8a8a" },
];

interface DecisionEvaluation {
  id: string;
  datum: string;
  typ: string;
  obsahStrukturovany: unknown;
  argumentsJson: DecisionArgument[] | null;
  pocetVstupuVDobeGenerovani: number;
  status?: string;            // "ready" | "processing" | "error"
  processingError?: string | null;
}

const NALADA_BARVA: Record<number, string> = {
  1: "var(--tint-rose)",
  2: "var(--tint-butter)",
  3: "var(--tint-sky)",
  4: "var(--tint-mint)",
  5: "var(--tint-sage)",
};

const TYP_LABEL: Record<string, string> = {
  novy_fakt_zvenci: "Nový fakt zvenčí",
  nova_uvaha: "Nová úvaha",
  napadlo_me: "Napadlo mě",
  reakce_na_udalost: "Reakce na událost",
};

const UHEL_LABEL: Record<string, { label: string; color: string }> = {
  fakta: { label: "Fakta", color: "white" },
  emoce: { label: "Emoce", color: "var(--tint-rose)" },
  kritika: { label: "Kritika", color: "#999" },
  prinosy: { label: "Přínosy", color: "var(--tint-butter)" },
  alternativy: { label: "Alternativy", color: "var(--tint-mint)" },
  meta: { label: "Meta", color: "var(--tint-sky)" },
  nevybrano: { label: "—", color: "#666" },
};

export default function BwMysDetail({ id }: { id: string }) {
  const [d, setD] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFraming, setShowFraming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [audioRecording, setAudioRecording] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [evaluating, setEvaluating] = useState<"prubezne" | "finalni" | null>(null);
  const [closeDialog, setCloseDialog] = useState<"jdu" | "nejdu" | "odlozit" | "vic-dat" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function deleteDecision() {
    if (!d) return;
    const ok = confirm(`Opravdu smazat rozhodnutí „${d.nazev}"?\n\nTato akce je nevratná — smaže VŠE: zarámování, ${d.entries.length} zápisů, ${d.evaluations.length} vyhodnocení a verdikt.`);
    if (!ok) return;
    const res = await fetch(`/api/bwmys/${id}`, { method: "DELETE" });
    if (res.ok) {
      window.location.href = "/bwmys";
    } else {
      const data = await res.json().catch(() => ({}));
      setErr(data.error ?? "Smazání selhalo.");
    }
  }

  async function runEvaluation(typ: "prubezne" | "finalni") {
    setErr(null);
    setEvaluating(typ);
    try {
      let res = await fetch(`/api/bwmys/${id}/evaluate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typ }),
      });
      let data = await res.json();
      if (!res.ok && data.lowSample) {
        // Slabý vzorek — potvrď a pošli znovu s forceLowSample
        if (!confirm("Podklady jsou slabé (méně než 5 zápisů). Doporučuji počkat na víc zápisů. Pokračovat?")) {
          return;
        }
        res = await fetch(`/api/bwmys/${id}/evaluate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ typ, forceLowSample: true }),
        });
        data = await res.json();
      }
      if (!res.ok) {
        setErr(data.error ?? "Vyhodnocení selhalo.");
        return;
      }
      load();
    } finally {
      setEvaluating(null);
    }
  }

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch(`/api/bwmys/${id}`);
      const data = await res.json();
      if (res.ok) setD(data.item);
      else setErr(data.error ?? "Nelze načíst");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // Polling pro audio entries + evaluace co se zpracovávají na pozadí.
  // KRITICKÉ: load(false) — bez fullscreen spinneru, jinak by UI blikalo
  // každých 4 s (Petr nahlásil blikání 2026-05-06).
  useEffect(() => {
    if (!d) return;
    const hasProcessing =
      d.entries.some((e) => e.status === "processing") ||
      d.evaluations.some((ev) => ev.status === "processing");
    if (!hasProcessing) return;
    const interval = setInterval(() => load(false), 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  if (loading) return <div className="glass rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground">
    <Loader2 className="size-4 animate-spin" /> Načítám…
  </div>;
  if (!d) return <div className="glass rounded-xl p-6 text-sm text-destructive">{err ?? "Nenalezeno."}</div>;

  const days = Math.ceil((new Date(d.deadlineRozhodnuti).getTime() - Date.now()) / 86400000);
  const ready = d.entries.length >= 5;
  const canMini = d.entries.length >= 3;

  return (
    <div className="space-y-4">
      {/* Hlavička */}
      <div className="glass-strong rounded-xl p-4 space-y-2 relative">
        <div className="absolute top-3 right-3 flex items-center gap-1">
          {d.status === "aktivni" && (
            <button
              onClick={() => setEditing(true)}
              className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
              title="Upravit zarámování"
            >
              <Pencil className="size-4" />
            </button>
          )}
          <button
            onClick={deleteDecision}
            className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
            title="Smazat celé rozhodnutí (nevratné)"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
        <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
          {d.kontext} · status {d.status}
        </div>
        <h1 className="font-serif text-2xl pr-10">{d.nazev}</h1>
        <p className="text-base italic text-foreground/85">„{d.otazka}"</p>
        <div className="flex flex-wrap items-center gap-3 pt-2 text-xs font-mono">
          <span className={days < 0 ? "text-destructive" : days < 3 ? "text-[var(--tint-butter)]" : "text-muted-foreground"}>
            <Clock className="inline size-3 mr-1" />
            {days < 0 ? `po deadline (${-days}d)` : `${days}d do deadline`}
          </span>
          <span className={ready ? "text-[var(--tint-sage)]" : "text-muted-foreground"}>
            <MessageSquare className="inline size-3 mr-1" />
            {d.entries.length} / 5 zápisů
          </span>
        </div>
      </div>

      {/* Akční toolbar — nahoře, pod hlavičkou. Petr nemusí scrollovat dolů.
          Zobrazený jen u aktivních rozhodnutí. */}
      {d.status === "aktivni" && (
        <div className="glass-strong rounded-xl p-3 flex flex-wrap gap-2">
          <Button onClick={() => setAdding(true)}>
            <Plus /> Zápis textem
          </Button>
          <Button variant="outline" onClick={() => setAudioRecording(true)}>
            <Mic /> Nadiktovat
          </Button>
          <Button
            variant="outline"
            disabled={!canMini || evaluating !== null}
            onClick={() => runEvaluation("prubezne")}
            title={!canMini ? "Potřeba alespoň 3 zápisy" : ""}
          >
            {evaluating === "prubezne" ? <Loader2 className="animate-spin" /> : <Send />} Mini-vyhodnocení
          </Button>
          <Button
            variant="outline"
            disabled={evaluating !== null}
            onClick={() => runEvaluation("finalni")}
          >
            {evaluating === "finalni" ? <Loader2 className="animate-spin" /> : <Send />} Finální vyhodnocení
          </Button>
        </div>
      )}

      {/* Zarámování (sbalené) */}
      <div className="glass rounded-xl p-3">
        <button
          onClick={() => setShowFraming(!showFraming)}
          className="flex items-center gap-2 text-sm w-full"
        >
          {showFraming ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          <span className="font-mono uppercase text-xs tracking-widest text-muted-foreground">Zarámování</span>
        </button>
        {showFraming && (
          <div className="mt-3 space-y-3 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-1">Varianty</div>
              <ol className="list-decimal pl-5 space-y-0.5">
                {d.varianty.map((v, i) => <li key={i}>{v}</li>)}
              </ol>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-1">Předpoklady</div>
              <ul className="list-disc pl-5 space-y-0.5">
                {d.predpoklady.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Vizuální přehled */}
      {d.entries.length > 0 && <BwMysViz entries={d.entries} />}

      {/* Časová osa zápisů */}
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground px-1">
          Časová osa zápisů ({d.entries.length})
        </div>
        {d.entries.length === 0 ? (
          <div className="glass rounded-xl p-6 text-center text-sm text-muted-foreground">
            Zatím žádný zápis. Přidej první klikem dole.
          </div>
        ) : (
          d.entries.slice().reverse().map((e) => {
            const isProcessing = e.status === "processing";
            const isError = e.status === "error";
            return (
              <div
                key={e.id}
                className="glass rounded-xl p-4 flex flex-col gap-1.5"
                style={isProcessing ? { borderColor: "color-mix(in oklch, var(--tint-butter) 35%, transparent)" } : undefined}
              >
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span
                    className="size-3 rounded-full"
                    style={{ background: NALADA_BARVA[e.nalada] ?? "var(--muted-foreground)" }}
                    title={`Nálada ${e.nalada}/5`}
                  />
                  <span className="text-muted-foreground">{new Date(e.datum).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground/90">{TYP_LABEL[e.typVstupu] ?? e.typVstupu}</span>
                  {e.uhelPohledu !== "nevybrano" && (
                    <span style={{ color: UHEL_LABEL[e.uhelPohledu]?.color }}>
                      · {UHEL_LABEL[e.uhelPohledu]?.label}
                    </span>
                  )}
                  {isProcessing && (
                    <span className="ml-auto inline-flex items-center gap-1 text-[var(--tint-butter)]">
                      <Loader2 className="size-3 animate-spin" /> AI zpracovává…
                    </span>
                  )}
                  {isError && (
                    <span className="ml-auto text-[var(--tint-rose)]">
                      ⚠ chyba zpracování
                    </span>
                  )}
                </div>
                <div className="text-sm leading-relaxed whitespace-pre-wrap">{e.obsah}</div>
                {isError && e.processingError && (
                  <div className="text-[11px] font-mono text-[var(--tint-rose)]/80 bg-[var(--tint-rose)]/10 px-2 py-1 rounded">
                    {e.processingError}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Vyhodnocení */}
      {d.evaluations.length > 0 && (
        <div className="space-y-2 bwmys-print-root">
          <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground px-1 flex items-center gap-3 print:hidden">
            <span>Vyhodnocení ({d.evaluations.length})</span>
            <a
              href={`/api/bwmys/${d.id}/export`}
              className="ml-auto inline-flex items-center gap-1 text-foreground/80 hover:text-foreground"
              title="Stáhnout celé rozhodnutí jako Markdown"
            >
              <FileDown className="size-3" /> .md
            </a>
            <a
              href={`/bwmys/${d.id}/tisk?print=1`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-foreground/80 hover:text-foreground"
              title="Otevře tisknutelnou verzi v novém tabu (auto Cmd+P)"
            >
              <Printer className="size-3" /> PDF
            </a>
          </div>
          {d.evaluations.map((ev) => {
            const isProcessing = ev.status === "processing";
            const isError = ev.status === "error";
            return (
            <details
              key={ev.id}
              className="glass rounded-xl p-3"
              open={ev === d.evaluations[0]}
              style={isProcessing ? { borderColor: "color-mix(in oklch, var(--tint-butter) 35%, transparent)" } : undefined}
            >
              <summary className="cursor-pointer text-sm flex items-center flex-wrap gap-2">
                <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  {ev.typ === "finalni" ? "Finální" : "Průběžné"}
                </span>
                <span>{new Date(ev.datum).toLocaleString("cs-CZ")}</span>
                <span className="text-xs text-muted-foreground">({ev.pocetVstupuVDobeGenerovani} zápisů)</span>
                {isProcessing && (
                  <span className="ml-auto inline-flex items-center gap-1 text-[var(--tint-butter)] text-xs">
                    <Loader2 className="size-3 animate-spin" /> AI zpracovává…
                  </span>
                )}
                {isError && (
                  <span className="ml-auto text-[var(--tint-rose)] text-xs">⚠ chyba</span>
                )}
              </summary>
              <div className="mt-3">
                {isProcessing ? (
                  <div className="text-sm text-muted-foreground italic py-6 text-center flex items-center justify-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    {ev.typ === "finalni"
                      ? "Generuji finální analýzu (sekce A-H) — typicky 30-60 sekund. Můžeš zavřít stránku a vrátit se."
                      : "Generuji průběžné zrcadlo — typicky 10-20 sekund."}
                  </div>
                ) : isError ? (
                  <div className="text-sm text-[var(--tint-rose)] bg-[var(--tint-rose)]/10 rounded-md px-3 py-2">
                    <div className="font-mono text-xs mb-1">Vyhodnocení selhalo:</div>
                    <div className="text-xs whitespace-pre-wrap">{ev.processingError || "neznámá chyba"}</div>
                    <div className="text-xs text-muted-foreground mt-2">
                      Smaž tuto evaluaci a zkus to znovu — typicky pomůže.
                    </div>
                  </div>
                ) : ev.typ === "finalni"
                  ? <FinalEvalRender data={ev.obsahStrukturovany as Record<string, unknown>} evaluation={ev} entries={d.entries} decisionId={d.id} decisionStatus={d.status} />
                  : <MiniEvalRender data={ev.obsahStrukturovany as Record<string, unknown>} />}
              </div>
              {ev.typ === "finalni" && d.status === "aktivni" && !isProcessing && !isError && (
                <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap gap-2">
                  <Button onClick={() => setCloseDialog("jdu")}>
                    ✓ Jdu do toho
                  </Button>
                  <Button variant="outline" onClick={() => setCloseDialog("nejdu")}>
                    ✗ Nejdu
                  </Button>
                  <Button variant="outline" onClick={() => setCloseDialog("odlozit")}>
                    ⏸ Odložit
                  </Button>
                  <Button variant="ghost" onClick={() => setCloseDialog("vic-dat")}>
                    Potřebuju víc dat
                  </Button>
                </div>
              )}
            </details>
            );
          })}
        </div>
      )}


      {closeDialog && d && (
        <CloseDecisionDialog
          decision={d}
          onClose={(reload) => { setCloseDialog(null); if (reload) load(); }}
          mode={closeDialog}
        />
      )}

      {d.status !== "aktivni" && (
        <div className="glass-strong rounded-xl p-4 border-l-4 border-[var(--tint-sage)] space-y-3">
          {d.verdiktText && (
            <>
              <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
                Verdikt ({d.status})
              </div>
              <div className="text-base whitespace-pre-wrap">{d.verdiktText}</div>
              {d.coByZmeniloVerdikt && (
                <div className="pt-3 border-t border-white/5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-1">
                    Co by mohlo verdikt překlopit
                  </div>
                  <div className="text-sm text-muted-foreground/90 italic">{d.coByZmeniloVerdikt}</div>
                </div>
              )}
            </>
          )}
          <div className="pt-3 border-t border-white/5">
            <Button variant="outline" onClick={() => setReopening(true)}>
              ↻ Znovu otevřít (přes nový fakt)
            </Button>
          </div>
        </div>
      )}

      {adding && <NewEntryModal decisionId={d.id} onClose={(reload) => { setAdding(false); if (reload) load(); }} />}
      {audioRecording && <BwMysAudioRecorder decisionId={d.id} onClose={(created) => { setAudioRecording(false); if (created) load(); }} />}
      {editing && <EditFramingModal decision={d} onClose={(reload) => { setEditing(false); if (reload) load(); }} />}
      {reopening && <ReopenDialog decision={d} onClose={(reload) => { setReopening(false); if (reload) load(); }} />}
    </div>
  );
}

function NewEntryModal({ decisionId, onClose }: { decisionId: string; onClose: (reload: boolean) => void }) {
  const [nalada, setNalada] = useState(3);
  const [typVstupu, setTypVstupu] = useState<string>("nova_uvaha");
  const [uhelPohledu, setUhelPohledu] = useState<string>("nevybrano");
  const [obsah, setObsah] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/bwmys/${decisionId}/entry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nalada, typVstupu, uhelPohledu, obsah: obsah.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? "Uložení selhalo."); return; }
      onClose(true);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={() => onClose(false)}>
      <div className="glass-strong rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="font-serif text-lg">Nový zápis</div>

        {/* Nálada */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Nálada (1-5)
          </label>
          <div className="flex justify-between mt-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNalada(n)}
                className={`size-10 rounded-full border-2 transition ${
                  nalada === n ? "border-foreground scale-110" : "border-white/20"
                }`}
                style={{ background: NALADA_BARVA[n], opacity: nalada === n ? 1 : 0.5 }}
                title={String(n)}
              />
            ))}
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-muted-foreground font-mono">
            <span>nejhorší</span><span>neutrální</span><span>nejlepší</span>
          </div>
        </div>

        {/* Typ vstupu */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-2 block">
            Typ vstupu
          </label>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(TYP_LABEL).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setTypVstupu(v)}
                className={`text-xs px-3 py-2 rounded-md border ${
                  typVstupu === v
                    ? "bg-[var(--tint-sky)]/20 border-[var(--tint-sky)]/60"
                    : "bg-background/30 border-border/40 hover:bg-white/5"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Úhel pohledu (volitelné) */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-2 block">
            Úhel pohledu (volitelné — Six Hats)
          </label>
          <select
            value={uhelPohledu}
            onChange={(e) => setUhelPohledu(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm"
          >
            {Object.entries(UHEL_LABEL).map(([v, m]) => (
              <option key={v} value={v}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Obsah */}
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Obsah
          </label>
          <textarea
            value={obsah}
            onChange={(e) => setObsah(e.target.value)}
            rows={5}
            placeholder="Co tě k tomuhle rozhodnutí teď napadlo / potkalo / cítíš?"
            className="w-full px-3 py-2.5 rounded-md bg-background/40 border border-border/60 text-base resize-none"
          />
        </div>

        {err && <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">
          <AlertTriangle className="inline size-4 mr-1" /> {err}
        </div>}

        <div className="flex gap-2 pt-2">
          <Button onClick={save} disabled={saving || !obsah.trim()}>
            {saving ? <><Loader2 className="animate-spin" /> Ukládám…</> : <>Uložit zápis</>}
          </Button>
          <Button variant="ghost" onClick={() => onClose(false)}>Zrušit</Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Banner s mřížkou argumentů + 3 menší grafy nad finálním vyhodnocením
// ============================================================================

function ArgumentsBanner({
  decisionId, evaluation, entries, decisionStatus,
}: {
  decisionId: string;
  evaluation: DecisionEvaluation;
  entries: DecisionEntry[];
  decisionStatus: string;
}) {
  const [args, setArgs] = useState<DecisionArgument[] | null>(evaluation.argumentsJson ?? null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (args !== null) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/bwmys/${decisionId}/arguments`, { method: "POST" });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) { setErr(data.error ?? "Generování selhalo."); return; }
        setArgs(data.arguments ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluation.id]);

  async function regenerate() {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/bwmys/${decisionId}/arguments?force=1`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? "Generování selhalo."); return; }
      setArgs(data.arguments ?? []);
    } finally { setLoading(false); }
  }

  return (
    <div className="rounded-md border border-[var(--tint-sky)]/30 bg-[var(--tint-sky)]/[0.04] p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
          Vizuální shrnutí
        </div>
        <button
          onClick={regenerate}
          disabled={loading}
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-50"
          title="Přegenerovat mřížku argumentů (volá AI)"
        >
          <Sparkles className="size-3" /> {loading ? "generuji…" : "regenerovat"}
        </button>
      </div>

      {/* Decision Compass — primární shrnutí "kde rozhodnutí stojí".
          Spec: zadani-decision-compass.pdf (květen 2026). */}
      {args && args.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">
            Decision Compass
          </div>
          <DecisionCompass args={args} decisionStatus={decisionStatus} />
        </div>
      )}

      <div>
        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">
          Mřížka argumentů
        </div>
        {loading && args === null && (
          <div className="text-xs text-muted-foreground italic h-48 grid place-items-center">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Generuji argumenty…
            </span>
          </div>
        )}
        {err && (
          <div className="text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/10 p-2">
            {err}
          </div>
        )}
        {args && <ArgumentsGrid arguments={args} />}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-white/5">
        <MiniTile title="Six Hats">
          <SixHatsRadar entries={entries} />
        </MiniTile>
        <MiniTile title="Křivka nálad">
          <MoodCurve entries={entries} />
        </MiniTile>
        <MiniTile title="Typy zápisů">
          <EntryTypesDonut entries={entries} />
        </MiniTile>
      </div>
    </div>
  );
}

function MiniTile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] p-2">
      <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

// ============================================================================
// Render finálního vyhodnocení (sekce A-H)
// ============================================================================

function FinalEvalRender({
  data, evaluation, entries, decisionId, decisionStatus,
}: {
  data: Record<string, unknown>;
  evaluation: DecisionEvaluation;
  entries: DecisionEntry[];
  decisionId: string;
  decisionStatus: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  return (
    <div className="space-y-4 text-sm">
      <ArgumentsBanner
        decisionId={decisionId}
        evaluation={evaluation}
        entries={entries}
        decisionStatus={decisionStatus}
      />

      <Section letter="A" title="Statistika sběru">
        <div className="text-xs space-y-1 text-muted-foreground/90">
          <div>Zápisů: <strong>{d.A_statistika?.pocetZapisu}</strong> · Rozsah: {d.A_statistika?.rozsahDni} dní</div>
          <div>Nálady: {d.A_statistika?.distribuceNalad}</div>
          <div>Typy: {d.A_statistika?.distribuceTypu}</div>
          {d.A_statistika?.upozorneni && (
            <div className="text-[var(--tint-butter)] italic mt-1">⚠ {d.A_statistika.upozorneni}</div>
          )}
        </div>
      </Section>

      <Section letter="B" title="Six Hats">
        <HatsBlock label="⚪ Bílý — fakta" items={d.B_sixHats?.bily_fakta} />
        <HatsBlock label="🔴 Červený — emoce" items={d.B_sixHats?.cerveny_emoce} />
        <HatsBlock label="⚫ Černý — rizika" items={d.B_sixHats?.cerny_rizika} />
        <HatsBlock label="🟡 Žlutý — přínosy" items={d.B_sixHats?.zluty_prinosy} />
        <HatsBlock label="🟢 Zelený — alternativy" items={d.B_sixHats?.zeleny_alternativy} />
        <HatsBlock label="🔵 Modrý — meta" items={d.B_sixHats?.modry_meta} />
      </Section>

      <Section letter="C" title="Signál vs. šum">
        <BulletGroup label="Konzistentní signály" items={d.C_signalSum?.konzistentniSignaly} />
        <BulletGroup label="Náladově skreslené" items={d.C_signalSum?.naladoveSkrelene} />
        <BulletGroup label="Recyklované úvahy" items={d.C_signalSum?.recyklovaneUvahy} />
      </Section>

      <Section letter="D" title="Pre-mortem">
        <div className="italic text-muted-foreground mb-2">{d.D_preMortem?.horizont}</div>
        <ol className="list-decimal pl-5 space-y-1">
          {(d.D_preMortem?.duvody ?? []).map((r: string, i: number) => <li key={i}>{r}</li>)}
        </ol>
      </Section>

      <Section letter="E" title="10 / 10 / 10">
        <div className="space-y-2">
          <div><strong>Za 10 minut:</strong> {d.E_horizon10?.za10Minut}</div>
          <div><strong>Za 10 měsíců:</strong> {d.E_horizon10?.za10Mesicu}</div>
          <div><strong>Za 10 let:</strong> {d.E_horizon10?.za10Let}</div>
        </div>
      </Section>

      <Section letter="F" title="WRAP check">
        <div className="space-y-1.5">
          <div><strong>Reálně víc variant?</strong> {d.F_wrapCheck?.realneViceVariant}</div>
          <div><strong>Otestované předpoklady?</strong> {d.F_wrapCheck?.otestovanePredpoklady}</div>
          <div><strong>Dostatečný odstup?</strong> {d.F_wrapCheck?.dostatecnyOdstup}</div>
          <div><strong>Plán B?</strong> {d.F_wrapCheck?.planB}</div>
        </div>
      </Section>

      {(d.G_kriteria?.pracovni || d.G_kriteria?.osobni) && (
        <Section letter="G" title="Kritéria">
          {d.G_kriteria?.pracovni && (
            <div className="mb-3">
              <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">Pracovní</div>
              <div className="space-y-1 text-xs">
                <div>• Obchodní: {d.G_kriteria.pracovni.obchodni}</div>
                <div>• Finanční: {d.G_kriteria.pracovni.financni}</div>
                <div>• Marketingový: {d.G_kriteria.pracovni.marketingovy}</div>
                <div>• Náročnost realizace: {d.G_kriteria.pracovni.narocnostRealizace}</div>
                <div>• Strategický fit: {d.G_kriteria.pracovni.strategickyFit}</div>
              </div>
            </div>
          )}
          {d.G_kriteria?.osobni && (
            <div>
              <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">Osobní</div>
              <div className="space-y-1 text-xs">
                <div>• Soulad s hodnotami: {d.G_kriteria.osobni.souladSHodnotami}</div>
                <div>• Vliv na vztahy: {d.G_kriteria.osobni.vlivNaVztahy}</div>
                <div>• Vliv na čas a energii: {d.G_kriteria.osobni.vlivNaCasAEnergii}</div>
                <div>• Reverzibilita: {d.G_kriteria.osobni.reverzibilita}</div>
                <div>• Soulad se životní fází: {d.G_kriteria.osobni.souladSeZivotniFazi}</div>
              </div>
            </div>
          )}
        </Section>
      )}

      <Section letter="H" title="Verdikt" highlight>
        <div className="space-y-2">
          <div><strong>Doporučení:</strong> {d.H_verdikt?.doporuceni}</div>
          <div><strong>Hlavní pro:</strong> {d.H_verdikt?.hlavniArgumentPro}</div>
          <div><strong>Hlavní proti:</strong> {d.H_verdikt?.hlavniArgumentProti}</div>
          <div className="pt-2 border-t border-white/10">
            <strong>Co by verdikt překlopilo:</strong> <span className="italic">{d.H_verdikt?.coByPreklopilo}</span>
          </div>
          <div><strong>Doporučená revize:</strong> <span className="font-mono">{d.H_verdikt?.doporuceneDatumRevize}</span></div>
        </div>
      </Section>
    </div>
  );
}

function MiniEvalRender({ data }: { data: Record<string, unknown> }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  return (
    <div className="space-y-3 text-sm">
      <div className="text-xs text-muted-foreground italic">
        Průběžný náhled — zatím to NENÍ verdikt, jen zrcadlo.
      </div>
      <BulletGroup label="Rozložení nálad" items={[d.rozlozeniNalad]} />
      <BulletGroup label="Opakující se motivy" items={d.opakujiciSeMotivy} />
      <BulletGroup label="Co v zápisech chybí (úhly)" items={d.chybejiciUhly} />
      {d.poznamka && (
        <div className="rounded-md bg-white/5 p-3 italic text-foreground/85">{d.poznamka}</div>
      )}
    </div>
  );
}

function Section({ letter, title, children, highlight = false }: { letter: string; title: string; children: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-md p-3 ${highlight ? "border-2 border-[var(--tint-sage)]/40 bg-[var(--tint-sage)]/5" : "border border-white/5"}`}>
      <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-2">
        {letter}. {title}
      </div>
      {children}
    </div>
  );
}

function HatsBlock({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mb-2">
      <div className="text-xs font-medium mb-0.5">{label}</div>
      <ul className="list-disc pl-5 text-xs space-y-0.5 text-muted-foreground/90">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

function BulletGroup({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">{label}</div>
      <ul className="list-disc pl-5 text-xs space-y-0.5">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

// ============================================================================
// Close decision dialog (Tok 5)
// ============================================================================

function CloseDecisionDialog({ decision, onClose, mode }: { decision: Decision; onClose: (r: boolean) => void; mode: "jdu" | "nejdu" | "odlozit" | "vic-dat" }) {
  // Pokud je poslední evaluation finální, vytáhni AI doporučení jako prefill
  const lastFinal = decision.evaluations.find((ev) => ev.typ === "finalni");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ai = (lastFinal?.obsahStrukturovany as any)?.H_verdikt;

  const [verdikt, setVerdikt] = useState(ai?.doporuceni ?? "");
  const [coBy, setCoBy] = useState(ai?.coByPreklopilo ?? "");
  const [revize, setRevize] = useState(ai?.doporuceneDatumRevize ?? new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10));
  // Odložit
  const [odlozenoDo, setOdlozenoDo] = useState(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  // Víc dat
  const [novyDeadline, setNovyDeadline] = useState(new Date(new Date(decision.deadlineRozhodnuti).getTime() + 14 * 86400000).toISOString().slice(0, 10));
  const [novaDelkaSberu, setNovaDelkaSberu] = useState(decision.delkaSberuDny + 14);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let payload: any;
      if (mode === "jdu" || mode === "nejdu") {
        if (!verdikt.trim() || !coBy.trim()) {
          setErr("Verdikt a 'co by ho překlopilo' jsou povinné.");
          return;
        }
        payload = {
          status: mode === "jdu" ? "uzavrene_jdu" : "uzavrene_nejdu",
          verdiktText: verdikt.trim(),
          coByZmeniloVerdikt: coBy.trim(),
          datumRevize: new Date(revize).toISOString(),
        };
      } else if (mode === "odlozit") {
        if (!odlozenoDo) { setErr("Vyber datum, do kdy odložit."); return; }
        payload = {
          status: "odlozene",
          odlozenoDo: new Date(odlozenoDo).toISOString(),
        };
      } else {
        // vic-dat — zůstává aktivní, jen prodloužit deadline / sběr
        payload = {
          deadlineRozhodnuti: new Date(novyDeadline).toISOString(),
          delkaSberuDny: novaDelkaSberu,
        };
      }
      const res = await fetch(`/api/bwmys/${decision.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? "Uložení selhalo."); return; }
      onClose(true);
    } finally { setSaving(false); }
  }

  const titleMap = {
    "jdu": "✓ Uzavřít: Jdu do toho",
    "nejdu": "✗ Uzavřít: Nejdu",
    "odlozit": "⏸ Odložit rozhodnutí",
    "vic-dat": "Potřebuji víc dat — prodloužit",
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={() => onClose(false)}>
      <div className="glass-strong rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="font-serif text-lg">{titleMap[mode]}</div>

        {(mode === "jdu" || mode === "nejdu") && (
          <>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                Text verdiktu
              </label>
              <textarea
                value={verdikt}
                onChange={(e) => setVerdikt(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm resize-none"
              />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                Co by mohlo verdikt překlopit *
              </label>
              <textarea
                value={coBy}
                onChange={(e) => setCoBy(e.target.value)}
                rows={2}
                placeholder="Konkrétní nový fakt zvenčí — ne emoce, ne pochybnost"
                className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm resize-none"
              />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                Datum revize
              </label>
              <input
                type="date"
                value={revize}
                onChange={(e) => setRevize(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm"
              />
            </div>
          </>
        )}

        {mode === "odlozit" && (
          <>
            <div className="text-sm text-muted-foreground">
              Rozhodnutí se schová z aktivního seznamu. V určený den se automaticky vrátí.
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                Vrátit zpět dne
              </label>
              <input
                type="date"
                value={odlozenoDo}
                onChange={(e) => setOdlozenoDo(e.target.value)}
                min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm"
              />
            </div>
          </>
        )}

        {mode === "vic-dat" && (
          <>
            <div className="text-sm text-muted-foreground">
              Rozhodnutí zůstane aktivní, ale prodloužím deadline + délku sběru.
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                Nový deadline
              </label>
              <input
                type="date"
                value={novyDeadline}
                onChange={(e) => setNovyDeadline(e.target.value)}
                min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                Délka sběru (dnů)
              </label>
              <input
                type="number"
                min={1} max={180}
                value={novaDelkaSberu}
                onChange={(e) => setNovaDelkaSberu(parseInt(e.target.value, 10) || 14)}
                className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm"
              />
            </div>
          </>
        )}

        {err && <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">{err}</div>}

        <div className="flex gap-2 pt-2">
          <Button onClick={save} disabled={saving}>
            {saving ? <><Loader2 className="animate-spin" /> Ukládám…</> : <>Potvrdit a uzavřít</>}
          </Button>
          <Button variant="ghost" onClick={() => onClose(false)}>Zrušit</Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Edit zarámování modal — Tok 1 alternative (úprava existujícího)
// ============================================================================

function EditFramingModal({ decision, onClose }: { decision: Decision; onClose: (r: boolean) => void }) {
  const [nazev, setNazev] = useState(decision.nazev);
  const [otazka, setOtazka] = useState(decision.otazka);
  const [kontext, setKontext] = useState<string>(decision.kontext);
  const [varianty, setVarianty] = useState<string[]>([...decision.varianty]);
  const [predpoklady, setPredpoklady] = useState<string[]>([...decision.predpoklady]);
  const [deadlineDate, setDeadlineDate] = useState(new Date(decision.deadlineRozhodnuti).toISOString().slice(0, 10));
  const [delkaSberuDny, setDelkaSberuDny] = useState(decision.delkaSberuDny);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!otazka.trim().endsWith("?")) { setErr("Otázka musí končit otazníkem."); return; }
    const variantyClean = varianty.map((v) => v.trim()).filter(Boolean);
    if (variantyClean.length < 3) { setErr("Minimum 3 varianty."); return; }
    const predpokladyClean = predpoklady.map((p) => p.trim()).filter(Boolean);
    if (predpokladyClean.length < 1) { setErr("Minimum 1 předpoklad."); return; }
    if (new Date(deadlineDate) < new Date(new Date().toDateString())) { setErr("Deadline musí být v budoucnosti."); return; }

    setSaving(true);
    try {
      const res = await fetch(`/api/bwmys/${decision.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nazev: nazev.trim(),
          kontext,
          otazka: otazka.trim(),
          varianty: variantyClean,
          predpoklady: predpokladyClean,
          deadlineRozhodnuti: new Date(deadlineDate).toISOString(),
          delkaSberuDny,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? "Uložení selhalo."); return; }
      onClose(true);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={() => onClose(false)}>
      <div className="glass-strong rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg">Upravit zarámování</h3>
          <button onClick={() => onClose(false)} className="p-1 hover:bg-white/5 rounded">
            <X className="size-4" />
          </button>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Název</label>
          <Input value={nazev} onChange={(e) => setNazev(e.target.value)} />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Kontext</label>
          <select
            value={kontext}
            onChange={(e) => setKontext(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm"
          >
            <option value="pracovni">Pracovní</option>
            <option value="osobni">Osobní</option>
            <option value="smiseny">Smíšený</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Otázka (musí končit ?)</label>
          <textarea
            value={otazka}
            onChange={(e) => setOtazka(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm resize-none"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-1.5 block">
            Varianty (min 3)
          </label>
          <div className="space-y-1.5">
            {varianty.map((v, i) => (
              <div key={i} className="flex gap-2">
                <span className="font-mono text-xs text-muted-foreground self-center w-4">{i + 1}.</span>
                <Input
                  value={v}
                  onChange={(e) => {
                    const next = [...varianty];
                    next[i] = e.target.value;
                    setVarianty(next);
                  }}
                />
                {varianty.length > 3 && (
                  <button onClick={() => setVarianty(varianty.filter((_, idx) => idx !== i))} className="p-1 text-muted-foreground hover:text-destructive">
                    <X className="size-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setVarianty([...varianty, ""])}
              className="text-xs font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <Plus className="size-3" /> přidat
            </button>
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-1.5 block">
            Předpoklady (min 1)
          </label>
          <div className="space-y-1.5">
            {predpoklady.map((p, i) => (
              <div key={i} className="flex gap-2">
                <span className="font-mono text-xs text-muted-foreground self-center w-4">{i + 1}.</span>
                <Input
                  value={p}
                  onChange={(e) => {
                    const next = [...predpoklady];
                    next[i] = e.target.value;
                    setPredpoklady(next);
                  }}
                />
                {predpoklady.length > 1 && (
                  <button onClick={() => setPredpoklady(predpoklady.filter((_, idx) => idx !== i))} className="p-1 text-muted-foreground hover:text-destructive">
                    <X className="size-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setPredpoklady([...predpoklady, ""])}
              className="text-xs font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <Plus className="size-3" /> přidat
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Deadline</label>
            <Input type="date" value={deadlineDate} onChange={(e) => setDeadlineDate(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Délka sběru (dnů)</label>
            <Input type="number" min={1} max={180} value={delkaSberuDny} onChange={(e) => setDelkaSberuDny(parseInt(e.target.value, 10) || 14)} />
          </div>
        </div>

        {err && <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">{err}</div>}

        <div className="flex gap-2 pt-2">
          <Button onClick={save} disabled={saving}>
            {saving ? <><Loader2 className="animate-spin" /> Ukládám…</> : <><Save /> Uložit</>}
          </Button>
          <Button variant="ghost" onClick={() => onClose(false)}>Zrušit</Button>
        </div>
      </div>
    </div>
  );
}

// Re-export Sparkles aby ho TS nehlásil jako nepoužívaný (používáme v BwMysNew).
export { Sparkles };

// ============================================================================
// Reopen dialog (Tok 6) — povinný popis nového faktu + potvrzení že to není nálada
// ============================================================================

function ReopenDialog({ decision, onClose }: { decision: Decision; onClose: (r: boolean) => void }) {
  const [popis, setPopis] = useState("");
  const [schvaleno, setSchvaleno] = useState(false);
  const [novyDeadline, setNovyDeadline] = useState(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (popis.trim().length < 5) { setErr("Popis nového faktu musí mít alespoň 5 znaků."); return; }
    if (!schvaleno) { setErr("Musíš potvrdit, že je to opravdu nový fakt zvenčí."); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/bwmys/${decision.id}/reopen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          popisNovehoFaktu: popis.trim(),
          schvaleno: true,
          novyDeadline: new Date(novyDeadline).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? "Znovuotevření selhalo."); return; }
      onClose(true);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={() => onClose(false)}>
      <div className="glass-strong rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-lg">↻ Znovu otevřít rozhodnutí</h3>
          <button onClick={() => onClose(false)} className="p-1 hover:bg-white/5 rounded">
            <X className="size-4" />
          </button>
        </div>

        <div className="text-sm text-muted-foreground rounded-md bg-[var(--tint-butter)]/10 border border-[var(--tint-butter)]/30 p-3">
          <strong>Pravidlo nevracení:</strong> uzavřené rozhodnutí lze znovu otevřít POUZE
          přes konkrétní nový fakt zvenčí — NE přes pochybnost, náladu, opakovanou úvahu.
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Co se konkrétně změnilo? Jaký nový fakt přišel? *
          </label>
          <textarea
            value={popis}
            onChange={(e) => setPopis(e.target.value)}
            rows={4}
            placeholder='např. „Klient potvrdil rozpočet 200k", „Prodal jsem byt", „Marie souhlasila"'
            className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm resize-none"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            Nový deadline (default +14 dní)
          </label>
          <input
            type="date"
            value={novyDeadline}
            onChange={(e) => setNovyDeadline(e.target.value)}
            min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
            className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm"
          />
        </div>

        <label className="flex items-start gap-2 cursor-pointer text-sm rounded-md border border-[var(--tint-rose)]/30 bg-[var(--tint-rose)]/5 p-3">
          <input
            type="checkbox"
            checked={schvaleno}
            onChange={(e) => setSchvaleno(e.target.checked)}
            className="size-4 mt-0.5"
          />
          <span>
            Potvrzuji, že je to <strong>opravdu nový fakt zvenčí</strong>, ne pochybnost,
            ne nálada, ne opakovaná úvaha.
          </span>
        </label>

        {err && <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">{err}</div>}

        <div className="flex gap-2 pt-2">
          <Button onClick={save} disabled={saving || !schvaleno || popis.trim().length < 5}>
            {saving ? <><Loader2 className="animate-spin" /> Otevírám…</> : <>Znovu otevřít</>}
          </Button>
          <Button variant="ghost" onClick={() => onClose(false)}>Zrušit</Button>
        </div>
      </div>
    </div>
  );
}
