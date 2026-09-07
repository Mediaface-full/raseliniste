import { useState } from "react";
import {
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  Inbox,
  Key,
  Mic,
  Smartphone,
  Sparkles,
  Zap,
} from "lucide-react";

function CodeBlock({ children }: { children: string }) {
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
      <pre className="rounded-md border border-white/10 bg-black/30 p-3 text-xs overflow-x-auto font-mono">
        {children}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Zkopírováno" : "Kopírovat"}
        title="Kopírovat"
        className="absolute top-1 right-1 px-2 py-1 rounded text-xs bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    </div>
  );
}

function ShortcutCard({
  title,
  subtitle,
  icon: Icon,
  tint,
  endpoint,
  description,
  flowSteps,
  behavior,
}: {
  title: string;
  subtitle: string;
  icon: typeof Mic;
  tint: string;
  endpoint: string;
  description: string;
  flowSteps: string[];
  behavior: string;
}) {
  return (
    <section
      className="glass rounded-xl p-5 space-y-4"
      style={{ ["--c" as string]: `var(--tint-${tint})` }}
    >
      <div className="flex items-start gap-3">
        <div
          className="size-10 rounded-md grid place-items-center shrink-0"
          style={{ background: "color-mix(in oklch, var(--c) 16%, transparent)", color: "var(--c)" }}
        >
          <Icon className="size-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-serif text-lg">{title}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      </div>

      <p className="text-sm">{description}</p>

      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
          Endpoint
        </div>
        <CodeBlock>{endpoint}</CodeBlock>
      </div>

      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
          Kroky v aplikaci Shortcuts
        </div>
        <ol className="list-decimal list-inside space-y-1.5 text-sm pl-1">
          {flowSteps.map((s, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: s }} />
          ))}
        </ol>
      </div>

      <div
        className="rounded-md border px-3 py-2 text-xs"
        style={{
          background: "color-mix(in oklch, var(--c) 8%, transparent)",
          borderColor: "color-mix(in oklch, var(--c) 25%, transparent)",
        }}
      >
        <strong className="font-medium">Chování:</strong> {behavior}
      </div>
    </section>
  );
}

export default function ShortcutsGuide() {
  const baseUrl = "https://www.raseliniste.cz";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-[2rem] leading-tight tracking-tight">
          iPhone Shortcuty
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Dva diktační Shortcuty — obecný Capture (Gemini klasifikuje) a přímý Deník (bez klasifikace, rovnou do deníku).
        </p>
      </div>

      {/* Prerequisites */}
      <section
        className="glass rounded-xl p-4 flex items-start gap-3"
        style={{ ["--c" as string]: "var(--tint-lavender)" }}
      >
        <div
          className="size-9 rounded-md grid place-items-center shrink-0"
          style={{ background: "color-mix(in oklch, var(--c) 16%, transparent)", color: "var(--c)" }}
        >
          <Key className="size-4" />
        </div>
        <div className="flex-1 text-sm">
          <div className="font-medium">Předpoklad: API token</div>
          <div className="text-muted-foreground mt-1">
            Pro oba Shortcuty potřebuješ stejný API token. Vytvoř si ho v{" "}
            <a href="/settings/tokens" className="underline text-foreground hover:text-[var(--tint-lavender)]">Nastavení → API tokeny</a>
            {" "}a pojmenuj například „iPhone Shortcuty". Plain token (začíná <code className="font-mono">rasel_</code>) se zobrazí jen jednou, hned ho zkopíruj.
          </div>
        </div>
      </section>

      <ShortcutCard
        title="Shortcut 1 — Capture (obecný diktát)"
        subtitle="Diktuji cokoli, Gemini rozhodne co to je"
        icon={Mic}
        tint="peach"
        endpoint={`POST ${baseUrl}/api/ingest`}
        description="Pro situace kdy sám nevím, co právě chci říct — může to být úkol, myšlenka, poznatek, nápad. Gemini vstup rozdělí a klasifikuje na TASK / JOURNAL / THOUGHT / CONTEXT / KNOWLEDGE. Po zpracování jde do triage k potvrzení nebo zahození."
        flowSteps={[
          'V aplikaci <strong>Shortcuts</strong> → <strong>+</strong> → New Shortcut',
          'Přidat akci <strong>Dictate Text</strong> (iOS) nebo <strong>Dictate a Flow note</strong> (pokud máš Wispr Flow)',
          'Přidat akci <strong>Get Contents of URL</strong>',
          `URL: <code class='font-mono text-[var(--tint-peach)]'>${baseUrl}/api/ingest</code>`,
          'Method: <code class="font-mono">POST</code>',
          'Headers: <code class="font-mono">Authorization: Bearer &lt;TOKEN&gt;</code> + <code class="font-mono">Content-Type: application/json</code>',
          'Request Body: <code class="font-mono">JSON</code> s klíči <code class="font-mono">text</code> (→ Dictated Text) a <code class="font-mono">source</code> = <code class="font-mono">SHORTCUT</code>',
          'Přidat akci <strong>Show Notification</strong> s textem: <em>Rašeliniště: zpracováno [entriesCount] položek</em>',
          `Volitelně: akce <strong>Open URL</strong> → <code class='font-mono'>${baseUrl}/triage</code>`,
          'Pojmenovat Shortcut například <em>Rasel Capture</em> a přiřadit k <strong>Action Buttonu</strong> (Settings → Action Button) nebo na home screen.',
        ]}
        behavior="Po stisknutí → diktát → Gemini klasifikuje (~3-5 s) → notifikace s počtem položek → položky čekají v /triage na potvrzení/úpravu."
      />

      <ShortcutCard
        title="Shortcut 2 — Deník (přímý zápis)"
        subtitle="Vím, že toto je deník — žádné pochybnosti"
        icon={BookOpen}
        tint="butter"
        endpoint={`POST ${baseUrl}/api/journal/ingest`}
        description="Pro explicitní deníkový zápis. Bez Gemini klasifikace — rychleji, spolehlivě, rovnou CONFIRMED (neprojde triage). Ideální pro ranní / večerní reflexi, kdy vím co chci zapsat."
        flowSteps={[
          'V aplikaci <strong>Shortcuts</strong> → <strong>+</strong> → New Shortcut',
          'Přidat akci <strong>Dictate Text</strong>',
          '<em>(volitelně)</em> Přidat akci <strong>Get Current Location</strong> — umožní uložit místo, kde zápis vznikl',
          '<em>(volitelně)</em> Přidat akci <strong>Get Details of Locations</strong>, nastavit <em>Get: Name</em> (vrátí čitelný název místa)',
          'Přidat akci <strong>Get Contents of URL</strong>',
          `URL: <code class='font-mono text-[var(--tint-butter)]'>${baseUrl}/api/journal/ingest</code>`,
          'Method: <code class="font-mono">POST</code>',
          'Headers: <code class="font-mono">x-api-key: &lt;TOKEN&gt;</code> + <code class="font-mono">Content-Type: application/json</code>',
          'Request Body: <code class="font-mono">JSON</code> s klíčem <code class="font-mono">text</code> (→ Dictated Text). <br>Pokud máš lokaci, přidej klíč <code class="font-mono">location</code> jako Dictionary s poli <code class="font-mono">lat</code> (→ Current Location Latitude), <code class="font-mono">lng</code> (→ Current Location Longitude) a volitelně <code class="font-mono">name</code> (→ Location Name).',
          'Přidat akci <strong>Show Notification</strong> s textem: <em>Deník uložen.</em>',
          'Pojmenovat <em>Rasel Deník</em> a přiřadit třeba k Siri fráze <em>zapiš deník</em> nebo na widget na lock screen.',
          '<strong>Privacy:</strong> při prvním spuštění iOS požádá o povolení lokace. Můžeš povolit „Ask Next Time" nebo „Allow While Using App".',
        ]}
        behavior="Po stisknutí → diktát → okamžité uložení (~200 ms) → notifikace → zápis je hned vidět v /journal."
      />

      {/* Tip o rozdělení */}
      <section className="glass-subtle rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Sparkles className="size-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-sm space-y-1.5">
            <div className="font-medium">Tip na rozdělení v iPhonu</div>
            <ul className="text-muted-foreground list-none pl-0 space-y-1">
              <li className="flex gap-2">
                <span className="text-[var(--tint-peach)] font-mono">▸</span>
                <span><strong className="text-foreground">Action Button</strong> → Capture (krátké stisknutí na diktát čehokoli)</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[var(--tint-butter)] font-mono">▸</span>
                <span><strong className="text-foreground">Siri fráze „zapiš deník"</strong> → Journal direct (hands-free při psaní deníku večer)</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[var(--tint-sky)] font-mono">▸</span>
                <span><strong className="text-foreground">Widget na lock screen</strong> → Journal direct (jeden klik a diktuj)</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Test curl */}
      <details className="glass rounded-xl px-5 py-4">
        <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
          <Zap className="size-4 text-muted-foreground" />
          Rychlý test z terminálu (bez iPhonu)
        </summary>
        <div className="mt-3 text-sm space-y-3">
          <p className="text-muted-foreground">Oba endpointy jdou otestovat i bez Shortcutu — hodí se pro ověření po deployi:</p>
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
              Capture
            </div>
            <CodeBlock>{`curl -X POST ${baseUrl}/api/ingest \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"text":"Zítra zavolat doktorovi. Dneska mi bylo dobře.","source":"MANUAL"}'`}</CodeBlock>
          </div>
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
              Deník
            </div>
            <CodeBlock>{`curl -X POST ${baseUrl}/api/journal/ingest \\
  -H "x-api-key: <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "text": "Dnes jsem zasadil první sazeničku rajčete. Je krásně.",
    "location": { "lat": 50.0755, "lng": 14.4378, "name": "Riegrovy sady" }
  }'`}</CodeBlock>
          </div>
        </div>
      </details>

      {/* Reference */}
      <div className="text-xs text-muted-foreground pl-1 pt-2 flex items-center gap-3">
        <a
          href="https://support.apple.com/guide/shortcuts/intro-to-shortcuts-apd163eb9f95/ios"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          Apple Shortcuts docs <ExternalLink className="size-3" />
        </a>
        <a
          href="/settings/tokens"
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <Inbox className="size-3" /> Správa tokenů
        </a>
      </div>
    </div>
  );
}
