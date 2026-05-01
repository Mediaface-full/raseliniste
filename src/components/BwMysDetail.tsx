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
  const [evaluating, setEvaluating] = useState<"prubezne" | "finalni" | null>(null);
  const [closeDialog, setCloseDialog] = useState<"jdu" | "nejdu" | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
            <details key={ev.id} className="glass rounded-xl p-3" open={ev === d.evaluations[0]}>
              <summary className="cursor-pointer text-sm">
                <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground mr-2">
                  {ev.typ === "finalni" ? "Finální" : "Průběžné"}
                </span>
                {new Date(ev.datum).toLocaleString("cs-CZ")}
                <span className="text-xs text-muted-foreground ml-2">({ev.pocetVstupuVDobeGenerovani} zápisů)</span>
              </summary>
              <div className="mt-3">
                {ev.typ === "finalni"
                  ? <FinalEvalRender data={ev.obsahStrukturovany as Record<string, unknown>} />
                  : <MiniEvalRender data={ev.obsahStrukturovany as Record<string, unknown>} />}
              </div>
              {ev.typ === "finalni" && d.status === "aktivni" && (
                <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap gap-2">
                  <Button onClick={() => setCloseDialog("jdu")}>
                    ✓ Jdu do toho
                  </Button>
                  <Button variant="outline" onClick={() => setCloseDialog("nejdu")}>
                    ✗ Nejdu
                  </Button>
                </div>
              )}
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

      {closeDialog && d && (
        <CloseDecisionDialog
          decision={d}
          onClose={(reload) => { setCloseDialog(null); if (reload) load(); }}
          mode={closeDialog}
        />
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

// ============================================================================
// Render finálního vyhodnocení (sekce A-H)
// ============================================================================

function FinalEvalRender({ data }: { data: Record<string, unknown> }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  return (
    <div className="space-y-4 text-sm">
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

function CloseDecisionDialog({ decision, onClose, mode }: { decision: Decision; onClose: (r: boolean) => void; mode: "jdu" | "nejdu" }) {
  // Pokud je poslední evaluation finální, vytáhni AI doporučení jako prefill
  const lastFinal = decision.evaluations.find((ev) => ev.typ === "finalni");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ai = (lastFinal?.obsahStrukturovany as any)?.H_verdikt;

  const [verdikt, setVerdikt] = useState(ai?.doporuceni ?? "");
  const [coBy, setCoBy] = useState(ai?.coByPreklopilo ?? "");
  const [revize, setRevize] = useState(ai?.doporuceneDatumRevize ?? new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!verdikt.trim() || !coBy.trim()) {
      setErr("Verdikt a 'co by ho překlopilo' jsou povinné.");
      return;
    }
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/bwmys/${decision.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: mode === "jdu" ? "uzavrene_jdu" : "uzavrene_nejdu",
          verdiktText: verdikt.trim(),
          coByZmeniloVerdikt: coBy.trim(),
          datumRevize: new Date(revize).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? "Uzavření selhalo."); return; }
      onClose(true);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={() => onClose(false)}>
      <div className="glass-strong rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="font-serif text-lg">
          {mode === "jdu" ? "✓ Uzavřít: Jdu do toho" : "✗ Uzavřít: Nejdu"}
        </div>

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
