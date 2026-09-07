import { useState } from "react";
import { Apple, Check, Copy, ExternalLink, Info, Key, Smartphone, TerminalSquare } from "lucide-react";
import { Button } from "./ui/Button";

function CodeBlock({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <div className="relative group">
      {label && (
        <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono mb-1">
          {label}
        </div>
      )}
      <pre className="rounded-md border border-white/10 bg-black/30 p-3 text-xs overflow-x-auto font-mono">
        {children}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Zkopírováno" : "Kopírovat"}
        title="Kopírovat"
        className="absolute top-1 right-1 px-2 py-1 rounded text-xs bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
        style={label ? { top: 22 } : undefined}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    </div>
  );
}

function Step({
  num,
  title,
  icon: Icon,
  tint,
  children,
}: {
  num: number;
  title: string;
  icon: typeof Apple;
  tint: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="glass rounded-xl p-5"
      style={{ ["--c" as string]: `var(--tint-${tint})` }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className="size-9 rounded-md grid place-items-center shrink-0"
          style={{ background: "color-mix(in oklch, var(--c) 16%, transparent)", color: "var(--c)" }}
        >
          <Icon className="size-4" />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
            Krok {num}
          </div>
          <h3 className="font-serif text-lg leading-tight">{title}</h3>
        </div>
      </div>
      <div className="text-sm space-y-3 pl-12">{children}</div>
    </section>
  );
}

export default function IngestSetupGuide({ appUrl }: { appUrl: string }) {
  const endpoint = `${appUrl}/api/health-ingest`;
  const prodEndpoint = "https://www.raseliniste.cz/api/health-ingest";
  const testPayload = `{
  "data": {
    "metrics": [
      {
        "name": "step_count",
        "units": "count",
        "data": [
          {
            "date": "2026-04-20 00:00:00 +0200",
            "qty": 8432,
            "source": "iPhone test"
          }
        ]
      }
    ]
  }
}`;
  const curlTest = `curl -X POST ${endpoint} \\
  -H "content-type: application/json" \\
  -H "x-api-key: <TVŮJ_TOKEN>" \\
  -d '${testPayload.replace(/\n\s*/g, " ").replace(/\s+/g, " ")}'`;

  return (
    <div className="space-y-5">
      {/* Intro */}
      <div>
        <h1 className="font-serif text-[2rem] leading-tight tracking-tight">
          Napojení Health Auto Export
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Jak nakonfigurovat iPhone aplikaci Health Auto Export, aby automaticky posílala data z Apple Health do Rašeliniště.
        </p>
      </div>

      {/* Step 1: Token */}
      <Step num={1} title="Vytvoř API token" icon={Key} tint="lavender">
        <p>
          V <a href="/settings/tokens" className="underline text-foreground hover:text-[var(--tint-lavender)]">Nastavení → API tokeny</a> klikni na <strong>Nový token</strong> a pojmenuj ho například „Health Auto Export".
        </p>
        <p className="text-muted-foreground">
          Plain token se zobrazí <strong>pouze jednou</strong> — hned ho zkopíruj. Začíná prefixem <code className="font-mono">rasel_</code>.
        </p>
      </Step>

      {/* Step 2: App install */}
      <Step num={2} title="Nainstaluj Health Auto Export na iPhone" icon={Apple} tint="peach">
        <p>
          App Store → <strong>Health Auto Export — JSON+CSV</strong> (autor Lybrow Solutions). Aplikace je freemium — pro REST API export je potřeba <strong>Premium subscription</strong> (~3 €/měs nebo jednorázový nákup).
        </p>
        <p>
          Po instalaci dej aplikaci v iOS povolení ke čtení z Apple Health (Settings → Health → Data Access → Health Auto Export → povolit relevantní kategorie: Activity, Heart, Body Measurements, Sleep, Vitals).
        </p>
      </Step>

      {/* Step 3: Automation */}
      <Step num={3} title="Vytvoř Automatic Export" icon={Smartphone} tint="sky">
        <p>V aplikaci jdi na tab <strong>Automations</strong> → <strong>Add Automation</strong> (nebo <em>New Export</em>):</p>

        <div className="space-y-2">
          <div className="rounded-md border border-white/10 bg-black/20 p-3 text-xs space-y-2">
            <div className="grid grid-cols-[140px_1fr] gap-2">
              <span className="text-muted-foreground font-mono">Automation Type</span>
              <span><code className="font-mono">REST API</code> (ne e-mail, ne iCloud Drive)</span>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-2">
              <span className="text-muted-foreground font-mono">URL</span>
              <span className="break-all"><code className="font-mono text-[var(--tint-sky)]">{prodEndpoint}</code></span>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-2">
              <span className="text-muted-foreground font-mono">HTTP Method</span>
              <span><code className="font-mono">POST</code></span>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-2">
              <span className="text-muted-foreground font-mono">Format</span>
              <span><code className="font-mono">JSON</code> (ne CSV)</span>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-2">
              <span className="text-muted-foreground font-mono">Aggregation</span>
              <span>obvykle <code className="font-mono">Daily</code> (stačí denní souhrny)</span>
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-2">
              <span className="text-muted-foreground font-mono">Frequency</span>
              <span>v sekci <em>Schedule</em>: <code className="font-mono">Daily</code> nebo <code className="font-mono">Every 6 hours</code></span>
            </div>
          </div>

          <p className="text-muted-foreground">
            Pokud aplikace nabízí přímo pole <strong>„Custom Headers"</strong>, přidej hlavičku:
          </p>

          <CodeBlock label="Custom header">{`x-api-key: <VLOŽ_TVŮJ_TOKEN>`}</CodeBlock>

          <p className="text-muted-foreground">
            Pokud to aplikace neumožňuje, podívej se do sekce <strong>„Authentication"</strong> — často má tam volbu <em>API Key</em> s polem pro název hlavičky a hodnotu.
          </p>
        </div>
      </Step>

      {/* Step 4: Metriky */}
      <Step num={4} title="Vyber metriky" icon={Check} tint="mint">
        <p>
          V sekci <strong>Data Types</strong> nebo <strong>Metrics</strong> zapni aspoň:
        </p>
        <ul className="list-none space-y-1 pl-0">
          {[
            ["Activity", "Steps, Active Energy, Walking + Running Distance, Flights Climbed, Exercise Time, Stand Time"],
            ["Heart", "Resting Heart Rate, Heart Rate Variability, Respiratory Rate, Cardio Recovery"],
            ["Sleep", "Sleep Analysis (se všemi fázemi)"],
            ["Body", "Body Mass, Body Fat Percentage, Walking Step Length"],
            ["Vitals", "Blood Pressure (pokud ho měříš)"],
            ["ECG", "Electrocardiogram (pokud máš Apple Watch S4+)"],
          ].map(([k, v]) => (
            <li key={k} className="flex gap-2">
              <span className="text-[var(--tint-mint)] font-mono text-xs mt-0.5">▸</span>
              <span><strong>{k}:</strong> <span className="text-muted-foreground">{v}</span></span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          Parser v Rašeliništi zpracuje i metriky, které teď explicitně nepodporuje — uloží je do univerzální tabulky, jen je nezobrazí v dashboardu (dokud pro ně nepřidáme graf).
        </p>
      </Step>

      {/* Step 5: Test */}
      <Step num={5} title="Otestuj ruční exportem" icon={TerminalSquare} tint="butter">
        <p>
          V aplikaci použij <strong>„Export Now"</strong> nebo <strong>„Test Webhook"</strong> (název se liší podle verze) — pošle aktuální data na tvoji URL. V Rašeliništi zkontroluj na <a href="/health" className="underline text-foreground hover:text-[var(--tint-butter)]">/health</a> že se počet metrik zvýšil.
        </p>

        <p className="pt-1 text-muted-foreground">Volitelně můžeš otestovat endpoint přímo terminálem:</p>

        <CodeBlock label="Terminal test (nahraď token)">{curlTest}</CodeBlock>

        <p className="text-muted-foreground">
          Odpověď <code className="font-mono">200</code> + JSON s <code className="font-mono">db.metricsInserted</code> znamená, že data prošla. <code className="font-mono">401</code> = špatný token, <code className="font-mono">400</code> = nesprávný JSON.
        </p>
      </Step>

      {/* Step 6: Důležité poznámky */}
      <Step num={6} title="Poznámky k běžnému provozu" icon={Info} tint="rose">
        <ul className="space-y-2 list-none pl-0">
          <li className="flex gap-2">
            <span className="text-[var(--tint-rose)] font-mono text-xs mt-0.5">▸</span>
            <span>
              <strong>Duplicity:</strong> endpoint má unique index <code className="font-mono">(user, type, recordedAt, source)</code>, takže opakovaný export stejných dat nevadí — duplikáty se automaticky přeskakují.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--tint-rose)] font-mono text-xs mt-0.5">▸</span>
            <span>
              <strong>Velikost:</strong> endpoint přijme až <strong>100 MB</strong> payloadu. Typický denní přírůstek je pod 100 KB, roční historický export ~3 MB.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--tint-rose)] font-mono text-xs mt-0.5">▸</span>
            <span>
              <strong>Zamítnuté požadavky:</strong> bez tokenu <code className="font-mono">401</code>, s odvolaným tokenem taky <code className="font-mono">401</code>. Pokud aplikace hlásí selhání, nejčastěji je to v tokenu (zkontroluj, jestli není odvolaný v <a href="/settings/tokens" className="underline text-foreground">/settings/tokens</a>).
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--tint-rose)] font-mono text-xs mt-0.5">▸</span>
            <span>
              <strong>Historický základ:</strong> jednorázový export ročních dat už proběhl přes CLI skript. HAE pak posílá jen přírůstky od posledního exportu.
            </span>
          </li>
        </ul>
      </Step>

      <div className="text-xs text-muted-foreground pl-1 pt-2">
        <a
          href="https://apps.apple.com/app/health-auto-export-json-csv/id1115567069"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          Health Auto Export v App Store <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}
