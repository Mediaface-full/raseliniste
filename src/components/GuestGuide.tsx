import { useState } from "react";
import { Info, X, Mic, Upload, Smartphone, FileAudio, Lightbulb } from "lucide-react";

/**
 * Inline návod pro hosty Studny — místo aby Petr posílal PDF e-mailem.
 *
 * Dvě varianty:
 *   - "standard": jen krátké záznamy (3-10 min)
 *   - "brief":    standard + sekce o klíčovém briefu (30-90 min) a uploadu souboru
 *
 * Otevírá se "i" ikonou v hlavičce /me/<token> stránky.
 */

export default function GuestGuide({
  variant,
  guestName,
}: {
  variant: "standard" | "brief";
  guestName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="size-9 rounded-full bg-[var(--tint-sky)]/15 border border-[var(--tint-sky)]/40 hover:bg-[var(--tint-sky)]/25 flex items-center justify-center text-[var(--tint-sky)] transition shadow-sm"
        aria-label="Otevřít návod"
        title="Návod — jak Studánku používat"
      >
        <Info className="size-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-3 sm:p-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="glass-strong rounded-xl max-w-2xl w-full max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 bg-[var(--background)]/85 backdrop-blur-md border-b border-white/10 px-5 py-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] font-mono text-muted-foreground">
                  Návod
                </div>
                <h2 className="font-serif text-xl">
                  Vítej, {guestName}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-2 rounded-md hover:bg-white/5 text-muted-foreground hover:text-foreground"
                aria-label="Zavřít"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="px-5 py-5 space-y-6 text-sm leading-relaxed">
              <Welcome variant={variant} />
              {variant === "brief" && <BriefSection />}
              <RecordSection variant={variant} />
              <PwaSection />
              <Tips variant={variant} />
              <div className="pt-4 border-t border-white/5 text-center text-xs text-muted-foreground">
                Děkuji, Petr · raseliniste.cz
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// =============================================================================
// Sekce
// =============================================================================

function Welcome({ variant }: { variant: "standard" | "brief" }) {
  return (
    <section className="space-y-3">
      <h3 className="font-serif text-lg flex items-center gap-2">
        <Lightbulb className="size-4 text-[var(--tint-butter)]" />
        Co je Studánka
      </h3>
      <p>
        Studánka je sdílená nahrávárna. Když tě napadne myšlenka, postřeh, otázka
        nebo nápad k projektu, otevřeš tuhle stránku a hlasem to nahraješ. Mluvíš
        normálně, jako bys to říkal po telefonu.
      </p>
      <p>
        Umělá inteligence záznam přepíše a vytáhne z něj klíčové body. Petr si to
        v klidu projde. <strong>Nemusíš nic psát.</strong>
      </p>
      <p>
        U každého záznamu Petr vidí, kdo ho natočil — autorství se nikdy neztratí.
      </p>
      {variant === "brief" && (
        <div className="rounded-md border border-[var(--tint-rose)]/30 bg-[var(--tint-rose)]/[0.07] px-3 py-2.5 text-[13px]">
          <strong className="text-[var(--tint-rose)]">Máš oprávnění nahrát Klíčový brief</strong> —
          jednu dlouhou nahrávku (30–90 min), ve které vyprávíš to nejdůležitější
          o projektu. Detail níže.
        </div>
      )}
    </section>
  );
}

function BriefSection() {
  return (
    <section className="space-y-3 rounded-md border border-[var(--tint-rose)]/25 bg-[var(--tint-rose)]/[0.04] p-4">
      <h3 className="font-serif text-lg flex items-center gap-2">
        <FileAudio className="size-4 text-[var(--tint-rose)]" />
        Klíčový brief
      </h3>
      <p>
        Brief je <strong>delší hlasová nahrávka</strong> — typicky 30 až 90 minut —
        ve které vyprávíš to nejdůležitější o projektu. Mluvíš o kontextu,
        historii, lidech, cílech a o tom, co je teď otevřené.
      </p>
      <p>
        Slouží jako referenční materiál. Petr se k němu vrací, když potřebuje
        rychle nahodit kontext. AI z něj vytvoří přehledný strukturovaný dokument:
        souhrn, glosář pojmů, seznam aktérů, historii rozhodnutí.
      </p>

      <div>
        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1.5">
          Co by tvůj brief měl pokrýt
        </div>
        <ul className="space-y-1 list-disc pl-5 text-[13px]">
          <li>O čem projekt je — proč vznikl, co řeší, co je cílem.</li>
          <li>Stručná historie — kde to začalo, jakými fázemi to prošlo.</li>
          <li>Klíčové postavy — kdo je v projektu, kdo má jakou roli, kdo o čem rozhoduje.</li>
          <li>Aktuální stav — co se teď děje, co už je rozhodnuté, co se teprve řeší.</li>
          <li>Otevřené otázky — co je nedořešeno, kde Petr může pomoct.</li>
          <li>Důležitá rozhodnutí, která padla — proč, kdy, kdo.</li>
          <li>Pojmy a zkratky, které v projektu používáme.</li>
        </ul>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1.5">
          Tipy, ať tvůj brief dobře sedne
        </div>
        <ul className="space-y-1 list-disc pl-5 text-[13px]">
          <li>Mluv jednoduše a přirozeně. AI si s odbočkami a vsuvkami poradí.</li>
          <li>Když si na něco vzpomeneš později, klidně se vrať („Ještě k tomu, co jsem říkal…"). Lineárnost není potřeba.</li>
          <li>Klidně si dej pauzu na kafe — nahrávka může trvat dlouho.</li>
          <li>Nemusíš mluvit „akademicky". Tvůj přirozený způsob, jak o projektu přemýšlíš, je to nejcennější.</li>
          <li>Chyby v řeči neřeš — AI je opraví.</li>
        </ul>
      </div>

      <div className="rounded-md border border-[var(--tint-butter)]/30 bg-[var(--tint-butter)]/[0.08] px-3 py-2 text-[13px]">
        <strong>Tip:</strong> Klidně si dopředu udělej pár bodů na papír. Ale neřeš to moc — pokud zapomeneš, prostě se vrátíš a doplníš.
      </div>
    </section>
  );
}

function RecordSection({ variant }: { variant: "standard" | "brief" }) {
  return (
    <section className="space-y-3">
      <h3 className="font-serif text-lg flex items-center gap-2">
        <Mic className="size-4 text-[var(--tint-mint)]" />
        Jak nahrát rychlý záznam
      </h3>
      <ol className="space-y-1.5 list-decimal pl-5 text-[13px]">
        <li>Otevři tuhle stránku (nebo ikonu Studánky na ploše, viz níže).</li>
        <li>Pokud máš víc projektů, nahoře vyber ten, do kterého nahráváš.</li>
        <li>Klepni na velký kruh s mikrofonem uprostřed.</li>
        <li>Telefon se zeptá, jestli smí používat mikrofon — klepni <strong>Povolit</strong>.</li>
        <li>Začne se nahrávat. Mluv normálně. Vidíš odpočet, kolik času ti zbývá.</li>
        <li>Až skončíš, klepni <strong>Stop</strong>. Maximální délka rychlého záznamu je 10 minut.</li>
        <li>Za pár vteřin uvidíš <strong>„Záznam uložen ✓"</strong>. Hotovo.</li>
      </ol>

      {variant === "brief" && (
        <>
          <h3 className="font-serif text-lg flex items-center gap-2 pt-3">
            <Upload className="size-4 text-[var(--tint-rose)]" />
            Jak nahrát dlouhý brief (přes upload souboru)
          </h3>
          <p className="text-[13px]">
            Brief <strong>NEnahrávej přímo přes web</strong> — devadesát minut
            v prohlížeči je riskantní (vybitá baterie, výpadek sítě, telefon se uspí).
            Místo toho použij standardní aplikaci na hlasové poznámky a hotový soubor pak nahraj.
          </p>
          <ol className="space-y-1.5 list-decimal pl-5 text-[13px]">
            <li>Otevři aplikaci <strong>Hlasové poznámky</strong> (iPhone) nebo <strong>Záznamník</strong> (Android).</li>
            <li>Klepni na nahrávací tlačítko a začni mluvit. Telefon můžeš položit na stůl.</li>
            <li>Po skončení klepni Stop. Záznam se uloží do aplikace.</li>
            <li>Vrať se sem, klepni pod mikrofonem na malý odkaz <strong>„Klíčový brief — nahrát soubor"</strong>.</li>
            <li>Klepni <strong>Vybrat soubor</strong> a najdi nahrávku.</li>
            <li>Klepni <strong>Odeslat brief</strong>. Vydrž 2–5 minut, AI ho zpracovává.</li>
            <li>Až uvidíš <strong>„Záznam uložen ✓"</strong>, máš hotovo.</li>
          </ol>
        </>
      )}
    </section>
  );
}

function PwaSection() {
  return (
    <section className="space-y-3">
      <h3 className="font-serif text-lg flex items-center gap-2">
        <Smartphone className="size-4 text-[var(--tint-sky)]" />
        Uložení odkazu na plochu
      </h3>
      <p className="text-[13px]">
        Místo abys hledal mail s odkazem, ulož si Studánku jako ikonu na hlavní obrazovku telefonu.
        Pak ji máš na jeden klik.
      </p>

      <div>
        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1.5">
          iPhone (Safari)
        </div>
        <ol className="space-y-1 list-decimal pl-5 text-[13px]">
          <li>V Safari otevři tuhle stránku.</li>
          <li>Klepni na ikonu <strong>Sdílet</strong> (čtvereček s šipkou nahoru, dole uprostřed).</li>
          <li>V nabídce vyber <strong>„Přidat na plochu"</strong>.</li>
          <li>Vpravo nahoře potvrď <strong>Přidat</strong>.</li>
          <li>Hotovo — na ploše vznikne ikona „G". Klepneš na ni kdykoli.</li>
        </ol>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1.5">
          Android (Chrome)
        </div>
        <ol className="space-y-1 list-decimal pl-5 text-[13px]">
          <li>V Chrome otevři tuhle stránku.</li>
          <li>Klepni na tři tečky vpravo nahoře.</li>
          <li>Vyber <strong>„Přidat na plochu"</strong> (nebo „Install app").</li>
          <li>Potvrď. Ikona se objeví na hlavní obrazovce.</li>
        </ol>
      </div>
    </section>
  );
}

function Tips({ variant }: { variant: "standard" | "brief" }) {
  void variant;
  return (
    <section className="space-y-2">
      <h3 className="font-serif text-lg flex items-center gap-2">
        <Lightbulb className="size-4 text-[var(--tint-butter)]" />
        Tipy, ať to dobře dopadne
      </h3>
      <ul className="space-y-1 list-disc pl-5 text-[13px]">
        <li>Mluv klidně, ne v hlučném prostředí — Gemini rozumí češtině moc dobře.</li>
        <li>Jeden záznam = jedna myšlenka nebo téma. Radši víc krátkých než jeden dlouhý.</li>
        <li>Nemusíš formulovat „spisovně". Stačí říct, co tě napadlo.</li>
        <li>Pokud se ti záznam nepovedl, klidně to natočíš znovu — Petr starý záznam smaže.</li>
      </ul>
    </section>
  );
}
