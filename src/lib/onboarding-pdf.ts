/* eslint-disable @typescript-eslint/no-explicit-any */
import { Document, Page, Text, View, Image, StyleSheet, pdf, Font } from "@react-pdf/renderer";
import { createElement as h, type ReactElement } from "react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

// Hledáme fonty a logo v různých kandidátních cestách, ať to funguje
// v dev (./public, ./src/assets/fonts) i v produkci (/app/dist/client/fonts).
function resolveAssetPath(filename: string, subdirs: string[]): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = subdirs.flatMap((sub) => [
    path.resolve(here, `../${sub}`, filename),
    path.resolve(here, `../../${sub}`, filename),
    path.resolve(here, `../../../${sub}`, filename),
    `/app/${sub}/${filename}`,
    `/app/dist/client/${sub.replace(/^public\//, "")}/${filename}`,
  ]);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function fontPath(name: string): string {
  // Fonty primárně v public/fonts/ (Astro je kopíruje do dist/client/fonts/),
  // fallback assets/fonts/ pro dev.
  return (
    resolveAssetPath(name, ["public/fonts", "assets/fonts"]) ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/fonts", name)
  );
}

const LOGO_PATH = resolveAssetPath("apple-touch-icon.png", ["public"]);

let fontsRegistered = false;
function ensureFonts() {
  if (fontsRegistered) return;
  Font.register({
    family: "NotoSans",
    fonts: [
      { src: fontPath("NotoSans-Regular.ttf") },
      { src: fontPath("NotoSans-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.register({
    family: "NotoSerif",
    fonts: [
      { src: fontPath("NotoSerif-Regular.ttf") },
      { src: fontPath("NotoSerif-Bold.ttf"), fontWeight: 700 },
    ],
  });
  fontsRegistered = true;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 50,
    paddingBottom: 60,
    paddingHorizontal: 60,
    fontSize: 11,
    fontFamily: "NotoSans",
    color: "#1a1a1a",
    lineHeight: 1.6,
  },
  header: { marginBottom: 24, alignItems: "flex-start" },
  logo: { width: 56, height: 56, borderRadius: 12, marginBottom: 16 },
  brand: { fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#888", marginBottom: 8 },
  title: { fontFamily: "NotoSerif", fontWeight: 700, fontSize: 28, marginBottom: 10, lineHeight: 1.15 },
  subtitle: { fontSize: 14, color: "#666", marginBottom: 4 },
  greeting: { fontSize: 12, marginTop: 14, marginBottom: 14, lineHeight: 1.6 },
  h2: { fontFamily: "NotoSerif", fontWeight: 700, fontSize: 16, marginTop: 18, marginBottom: 8 },
  h3: { fontFamily: "NotoSans", fontWeight: 700, fontSize: 13, marginTop: 12, marginBottom: 6 },
  para: { marginBottom: 8 },
  intro: { fontSize: 11, color: "#444", marginBottom: 8, lineHeight: 1.6 },
  bullet: { flexDirection: "row", marginBottom: 5, paddingLeft: 4 },
  bulletDot: { width: 12, color: "#b8763c", fontWeight: 700, fontSize: 12 },
  bulletText: { flex: 1 },
  step: { flexDirection: "row", marginBottom: 6, paddingLeft: 4 },
  stepNum: {
    width: 22,
    height: 18,
    fontFamily: "NotoSans",
    fontWeight: 700,
    fontSize: 11,
    color: "#b8763c",
  },
  stepText: { flex: 1 },
  cta: {
    marginTop: 18,
    backgroundColor: "#fbebd0",
    padding: 14,
    borderRadius: 8,
  },
  ctaTitle: { fontFamily: "NotoSerif", fontWeight: 700, fontSize: 14, marginBottom: 4 },
  ctaSub: { fontSize: 10, color: "#666", marginBottom: 8 },
  link: { color: "#a05a1f", fontFamily: "NotoSans", fontWeight: 700, fontSize: 11 },
  tip: {
    marginTop: 10,
    backgroundColor: "#f0f0f0",
    padding: 10,
    borderRadius: 6,
    fontSize: 10,
    color: "#444",
  },
  tipLabel: { fontFamily: "NotoSans", fontWeight: 700, color: "#1a1a1a" },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 60,
    right: 60,
    borderTop: "1pt solid #cccccc",
    paddingTop: 8,
    fontSize: 8,
    color: "#888",
    textAlign: "center",
  },
});

interface OnboardingData {
  guestName: string;
  projectName: string;
  projectDescription: string | null;
  inviteLink: string;
}

function Bullet({ children }: { children: string }) {
  return h(View, { style: styles.bullet },
    h(Text, { style: styles.bulletDot }, "·"),
    h(Text, { style: styles.bulletText }, children),
  );
}

function Step({ n, children }: { n: number; children: string }) {
  return h(View, { style: styles.step },
    h(Text, { style: styles.stepNum }, `${n}.`),
    h(Text, { style: styles.stepText }, children),
  );
}

function Tip({ label, children }: { label: string; children: string }) {
  return h(View, { style: styles.tip },
    h(Text, null,
      h(Text, { style: styles.tipLabel }, label + " "),
      h(Text, null, children),
    ),
  );
}

// =============================================================================
// STANDARD onboarding
// =============================================================================
function StandardOnboarding(d: OnboardingData): ReactElement {
  return h(Document, null,
    // === STRÁNKA 1 ===
    h(Page as any, { size: "A4", style: styles.page },
      h(View, { style: styles.header },
        LOGO_PATH && h(Image as any, { src: LOGO_PATH, style: styles.logo }),
        h(Text, { style: styles.brand }, "Rašeliniště · Studna"),
        h(Text, { style: styles.title }, "Vítej v projektu"),
        h(Text, { style: styles.subtitle }, d.projectName),
      ),

      h(Text, { style: styles.greeting },
        `Ahoj ${d.guestName},\n\nPetr tě pozval do projektu „${d.projectName}". Tady je krátký a jednoduchý návod, jak fungovat. Není to nic složitého — slibuju.`,
      ),

      d.projectDescription && h(View, null,
        h(Text, { style: styles.h2 }, "O čem to je"),
        h(Text, { style: styles.para }, d.projectDescription),
      ),

      h(Text, { style: styles.h2 }, "K čemu to slouží"),
      h(Text, { style: styles.para },
        "Když tě napadne myšlenka, postřeh nebo nápad k projektu — otevřeš odkaz, klepneš na velký mikrofon a nahlas to řekneš. Stačí mluvit normálně, jako bys to říkal Petrovi do telefonu. Umělá inteligence to přepíše a vytáhne z toho hlavní body. Petr si to pak v klidu projde.",
      ),
      h(Text, { style: styles.para },
        "Maximální délka jednoho záznamu je 10 minut. Když zapomeneš zastavit, sám se vypne. Můžeš nahrát klidně víc krátkých záznamů za sebou.",
      ),

      // === Jak na iPhone ===
      h(Text, { style: styles.h2 }, "iPhone — uložení odkazu na plochu"),
      h(Text, { style: styles.intro },
        "Doporučujeme si odkaz uložit na hlavní plochu telefonu, ať na něj pak ťukneš jako na běžnou aplikaci.",
      ),
      h(Step, { n: 1 }, "Otevři odkaz dole na této stránce v aplikaci Safari."),
      h(Step, { n: 2 }, "Klepni na ikonu Sdílet (čtvereček s šipkou nahoru, dole uprostřed)."),
      h(Step, { n: 3 }, 'Posuň nabídku dolů a klepni na "Přidat na plochu".'),
      h(Step, { n: 4 }, 'Vpravo nahoře potvrď "Přidat".'),
      h(Step, { n: 5 }, "Hotovo — na ploše se objeví ikona G. Klepni na ni kdykoli, kdy budeš chtít něco poznamenat."),

      // === Jak na Androidu ===
      h(Text, { style: styles.h2 }, "Android — uložení odkazu na plochu"),
      h(Step, { n: 1 }, "Otevři odkaz dole na této stránce v aplikaci Chrome."),
      h(Step, { n: 2 }, "Klepni na tři tečky vpravo nahoře."),
      h(Step, { n: 3 }, 'Vyber "Přidat na plochu" (nebo "Install app", podle verze).'),
      h(Step, { n: 4 }, "Potvrď. Ikona se objeví na hlavní obrazovce."),
    ),

    // === STRÁNKA 2 ===
    h(Page as any, { size: "A4", style: styles.page },
      h(Text, { style: styles.h2 }, "Jak nahrát záznam — krok za krokem"),
      h(Step, { n: 1 }, "Klepni na ikonu Studny na ploše (nebo otevři odkaz dole)."),
      h(Step, { n: 2 }, 'Pokud máš víc projektů, zvol nahoře "Test" nebo to, co chceš.'),
      h(Step, { n: 3 }, "Klepni na velký kruh s mikrofonem uprostřed obrazovky."),
      h(Step, { n: 4 }, 'Telefon se zeptá, jestli smí používat mikrofon. Klepni "Povolit".'),
      h(Step, { n: 5 }, "Začne se nahrávat. Mluv normálně. Uvidíš odpočet, kolik času ti zbývá."),
      h(Step, { n: 6 }, 'Až skončíš, klepni na "Stop".'),
      h(Step, { n: 7 }, 'Za pár vteřin uvidíš zelenou fajfku a "Záznam uložen". Hotovo.'),

      h(Text, { style: styles.h2 }, "Tipy, ať to dobře dopadne"),
      h(Bullet, null, "Mluv klidně, ne v hlučném prostředí — Gemini rozumí češtině moc dobře."),
      h(Bullet, null, "Jeden záznam = jedna myšlenka nebo jedno téma. Radši víc krátkých než jeden dlouhý."),
      h(Bullet, null, 'Nemusíš formulovat „spisovně". Stačí, abys řekl, co tě napadlo. AI si s tím poradí.'),
      h(Bullet, null, "Kdykoli něco zkazíš, můžeš to jednoduše natočit znovu — Petr starý záznam smaže."),
      h(Bullet, null, "Petr u každého záznamu vidí, kdo ho natočil, takže se autorství nikdy neztratí."),

      h(View, { style: styles.tip },
        h(Text, null,
          h(Text, { style: styles.tipLabel }, "Když by se ti otevíralo dialogové okno o mikrofonu pokaždé znova: "),
          h(Text, null, 'to je bezpečnostní fíčura prohlížeče. V iPhone Nastavení → Safari → Mikrofon můžeš pro tuhle stránku nastavit „Povolit".'),
        ),
      ),

      // === Tvůj odkaz ===
      h(View, { style: styles.cta },
        h(Text, { style: styles.ctaTitle }, "Tvůj odkaz"),
        h(Text, { style: styles.ctaSub }, "Tento odkaz je tvůj osobní. Když tě Petr přidá do dalšího projektu, uvidíš ho v nabídce — žádný nový odkaz nedostaneš."),
        h(Text, { style: styles.link }, d.inviteLink),
      ),

      h(Text, { style: styles.footer },
        "Děkuji, Petr · raseliniste.cz",
      ),
    ),
  );
}

// =============================================================================
// BRIEF onboarding
// =============================================================================
function BriefOnboarding(d: OnboardingData): ReactElement {
  return h(Document, null,
    // === STRÁNKA 1 ===
    h(Page as any, { size: "A4", style: styles.page },
      h(View, { style: styles.header },
        LOGO_PATH && h(Image as any, { src: LOGO_PATH, style: styles.logo }),
        h(Text, { style: styles.brand }, "Rašeliniště · Studna · Klíčový brief"),
        h(Text, { style: styles.title }, "Klíčový brief"),
        h(Text, { style: styles.subtitle }, d.projectName),
      ),

      h(Text, { style: styles.greeting },
        `Ahoj ${d.guestName},\n\nPetr tě požádal o tzv. „klíčový brief" k projektu „${d.projectName}". Není to úkol na 5 minut, ale je to extrémně cenné — pomůže Petrovi a celému týmu rychle pochopit kontext.`,
      ),

      d.projectDescription && h(View, null,
        h(Text, { style: styles.h2 }, "O čem to je"),
        h(Text, { style: styles.para }, d.projectDescription),
      ),

      h(Text, { style: styles.h2 }, "Co je klíčový brief"),
      h(Text, { style: styles.para },
        "Brief je delší hlasový záznam — typicky 30 až 90 minut — ve kterém vyprávíš to nejdůležitější o projektu. Mluvíš o kontextu, historii, lidech, cílech a o tom, co je teď otevřené.",
      ),
      h(Text, { style: styles.para },
        "Slouží Petrovi jako referenční materiál. Vrací se k němu, když potřebuje rychle nahodit kontext. AI ti z toho vytvoří přehledný dokument: souhrn, glosář pojmů, seznam aktérů, historii rozhodnutí.",
      ),
      h(Text, { style: styles.para },
        "Není to formální. Mluv tak, jak to máš v hlavě.",
      ),

      h(Text, { style: styles.h2 }, "Co by tvůj brief měl pokrýt"),
      h(Bullet, null, "O čem projekt je — proč vznikl, co řeší, co je cílem."),
      h(Bullet, null, "Stručná historie — kde to začalo, jakými fázemi to prošlo."),
      h(Bullet, null, "Klíčové postavy — kdo je v projektu, kdo má jakou roli, kdo o čem rozhoduje."),
      h(Bullet, null, "Aktuální stav — co se teď děje, co už je rozhodnuté, co se teprve řeší."),
      h(Bullet, null, "Otevřené otázky — co je nedořešeno, kde Petr může pomoct."),
      h(Bullet, null, "Důležitá rozhodnutí, která padla — proč, kdy, kdo."),
      h(Bullet, null, "Pojmy a zkratky, které v projektu používáme."),

      h(View, { style: styles.tip },
        h(Text, null,
          h(Text, { style: styles.tipLabel }, "Tip: "),
          h(Text, null, 'Klidně si dopředu uděláš pár bodů na papír. Ale neřeš to dlouho — když si na něco vzpomeneš později, prostě se vrátíš a doplníš („A ještě k tomu, na co jsem zapomněl…").'),
        ),
      ),
    ),

    // === STRÁNKA 2 — JAK NAHRÁT ===
    h(Page as any, { size: "A4", style: styles.page },
      h(Text, { style: styles.h2 }, "Jak brief nahrát"),
      h(Text, { style: styles.intro },
        "Brief NEnahrávej přímo přes web. Devadesát minut nahrávání v prohlížeči je riskantní (vybitá baterie, výpadek sítě, telefon se uspí). Místo toho použij standardní aplikaci na hlasové poznámky a hotový soubor pak nahraj.",
      ),

      // iPhone
      h(Text, { style: styles.h3 }, "iPhone — Hlasové poznámky"),
      h(Step, { n: 1 }, 'Otevři aplikaci Hlasové poznámky (ikona červené vlnovky, často je v "Užitečné" složce).'),
      h(Step, { n: 2 }, "Klepni na velké červené kolečko dole uprostřed."),
      h(Step, { n: 3 }, "Začni mluvit. Telefon můžeš klidně položit na stůl. Klidně si dej pauzu, vrať se, opravuj — nevadí."),
      h(Step, { n: 4 }, "Když skončíš, klepni na červený čtvereček (Stop)."),
      h(Step, { n: 5 }, 'Záznam se objeví v seznamu (typicky pojmenovaný „Nový záznam").'),

      // Android
      h(Text, { style: styles.h3 }, "Android — Záznamník (nebo Easy Voice Recorder)"),
      h(Step, { n: 1 }, 'Otevři vestavěný "Záznamník" (Recorder). Pokud nemáš, stáhni z Google Play "Easy Voice Recorder".'),
      h(Step, { n: 2 }, "Klepni na velké tlačítko nahrávat."),
      h(Step, { n: 3 }, "Mluv. Telefon můžeš nechat ležet."),
      h(Step, { n: 4 }, "Po skončení klepni Stop. Záznam se uloží."),

      // Upload do Studny
      h(Text, { style: styles.h2 }, "Nahrání záznamu do Studny"),
      h(Step, { n: 1 }, "Otevři odkaz, který ti Petr poslal (najdeš ho dole na této stránce)."),
      h(Step, { n: 2 }, 'Pod velkým tlačítkem "Tap pro záznam" je menší odkaz "Klíčový brief — nahrát soubor →". Klepni na něj.'),
      h(Step, { n: 3 }, 'Klepni "Vybrat soubor". Telefon ti otevře průzkumník souborů.'),
      h(Step, { n: 4 }, "Najdi ten záznam, který jsi natočil v Hlasových poznámkách / Záznamníku, a vyber ho."),
      h(Step, { n: 5 }, 'Vrátíš se zpět do Studny — zobrazí se ti název souboru a tlačítko "Odeslat brief". Klepni.'),
      h(Step, { n: 6 }, "Vydrž. Nahrávání + zpracování trvá u dlouhého briefu klidně 2–5 minut. Neopouštěj stránku."),
      h(Step, { n: 7 }, 'Až uvidíš "Záznam uložen ✓", máš hotovo. Můžeš zavřít.'),

      h(View, { style: styles.tip },
        h(Text, null,
          h(Text, { style: styles.tipLabel }, "Tip: "),
          h(Text, null, "Pokud máš záznam na jiném zařízení (např. natočil jsi ho na iPhone, ale chceš nahrávat z počítače), pošli si soubor sám sobě e-mailem nebo přes AirDrop / Google Drive — pak ho nahraješ z toho zařízení, kde ho máš."),
        ),
      ),

      h(Text, { style: styles.h2 }, "Tipy, ať tvůj brief dobře sedne"),
      h(Bullet, null, "Mluv jednoduše a přirozeně. AI si s odbočkami a vsuvkami poradí."),
      h(Bullet, null, 'Když si na něco vzpomeneš později v záznamu, vrať se („Ještě se vrátím k tomu, co jsem říkal…"). Nemusíš mluvit dokonale lineárně.'),
      h(Bullet, null, "Klidně si dej pauzu na kafe — nahrávka může pokračovat dlouho."),
      h(Bullet, null, "Nepotřebuješ akademický tón. Petrovi pomáhá tvůj přirozený způsob, jak o projektu přemýšlíš."),
      h(Bullet, null, "Chyby v řeči neřeš — AI je opraví."),

      // === Tvůj odkaz ===
      h(View, { style: styles.cta },
        h(Text, { style: styles.ctaTitle }, "Tvůj odkaz pro upload"),
        h(Text, { style: styles.ctaSub }, "Pošli si ho i sám sobě na zařízení, kde máš nahraný brief, ať z něj můžeš nahrát přímo."),
        h(Text, { style: styles.link }, d.inviteLink),
      ),

      h(Text, { style: styles.footer },
        "Děkuji, Petr · raseliniste.cz",
      ),
    ),
  );
}

export async function renderOnboardingPdf(
  variant: "standard" | "brief",
  data: OnboardingData,
): Promise<Buffer> {
  ensureFonts();
  const doc = variant === "brief" ? BriefOnboarding(data) : StandardOnboarding(data);
  const stream = await pdf(doc as any).toBuffer();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}
