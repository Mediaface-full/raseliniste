import { useEffect, useState } from "react";
import { Loader2, Plus, Clock, MessageSquare, AlertTriangle, Send, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "./ui/Button";

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
  entries: DecisionEntry[];
  evaluations: DecisionEvaluation[];
}

interface DecisionEntry {
  id: string;
  datum: string;
  nalada: number;
  typVstupu: string;
  uhelPohledu: string;
  obsah: string;
}

interface DecisionEvaluation {
  id: string;
  datum: string;
  typ: string;
  obsahStrukturovany: unknown;
  pocetVstupuVDobeGenerovani: number;
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
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/bwmys/${id}`);
      const data = await res.json();
      if (res.ok) setD(data.item);
      else setErr(data.error ?? "Nelze načíst");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

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
      <div className="glass-strong rounded-xl p-4 space-y-2">
        <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
          {d.kontext} · status {d.status}
        </div>
        <h1 className="font-serif text-2xl">{d.nazev}</h1>
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
          d.entries.slice().reverse().map((e) => (
            <div key={e.id} className="glass rounded-xl p-4 flex flex-col gap-1.5">
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
              </div>
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{e.obsah}</div>
            </div>
          ))
        )}
      </div>

      {/* Vyhodnocení */}
      {d.evaluations.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground px-1">
            Vyhodnocení ({d.evaluations.length})
          </div>
          {d.evaluations.map((ev) => (
            <details key={ev.id} className="glass rounded-xl p-3">
              <summary className="cursor-pointer text-sm">
                <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground mr-2">
                  {ev.typ === "finalni" ? "Finální" : "Průběžné"}
                </span>
                {new Date(ev.datum).toLocaleString("cs-CZ")}
                <span className="text-xs text-muted-foreground ml-2">({ev.pocetVstupuVDobeGenerovani} zápisů)</span>
              </summary>
              <pre className="mt-3 text-xs whitespace-pre-wrap font-mono bg-black/20 p-3 rounded-md overflow-auto">
                {JSON.stringify(ev.obsahStrukturovany, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      )}

      {/* Akční zóna */}
      {d.status === "aktivni" && (
        <div className="glass-strong rounded-xl p-3 sticky bottom-4 flex flex-wrap gap-2">
          <Button onClick={() => setAdding(true)}>
            <Plus /> Přidat zápis
          </Button>
          <Button
            variant="outline"
            disabled={!canMini}
            title={!canMini ? "Potřeba alespoň 3 zápisy" : ""}
          >
            <Send /> Mini-vyhodnocení
          </Button>
          <Button
            variant="outline"
            disabled={!ready}
            title={!ready ? "Potřeba alespoň 5 zápisů" : ""}
          >
            <Send /> Finální vyhodnocení
          </Button>
        </div>
      )}

      {d.status !== "aktivni" && d.verdiktText && (
        <div className="glass-strong rounded-xl p-4 border-l-4 border-[var(--tint-sage)]">
          <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1">
            Verdikt ({d.status})
          </div>
          <div className="text-base whitespace-pre-wrap">{d.verdiktText}</div>
          {d.coByZmeniloVerdikt && (
            <div className="mt-3 pt-3 border-t border-white/5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-1">
                Co by mohlo verdikt překlopit
              </div>
              <div className="text-sm text-muted-foreground/90 italic">{d.coByZmeniloVerdikt}</div>
            </div>
          )}
        </div>
      )}

      {adding && <NewEntryModal decisionId={d.id} onClose={(reload) => { setAdding(false); if (reload) load(); }} />}
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
