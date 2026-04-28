/* eslint-disable @typescript-eslint/no-explicit-any */
import { Document, Page, Text, View, Image, StyleSheet, pdf, Font } from "@react-pdf/renderer";
import { createElement as h, type ReactElement } from "react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

// -----------------------------------------------------------------------------
// Asset path resolution — fungující v dev (./public, ./src/assets)
// i v produkci (/app/dist/client po Astro buildu).
// -----------------------------------------------------------------------------
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
  return (
    resolveAssetPath(name, ["public/fonts", "assets/fonts"]) ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/fonts", name)
  );
}

const LOGO_PATH = resolveAssetPath("apple-touch-icon.png", ["public"]);

// -----------------------------------------------------------------------------
// Fonty — bezpatkový NotoSans pro vše (žádné mixování serif/sans).
// -----------------------------------------------------------------------------
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
  fontsRegistered = true;
}

// -----------------------------------------------------------------------------
// Styly — sans-serif, čistý layout, link nahoře dobře viditelný.
// -----------------------------------------------------------------------------
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

  // Hlavička s logem
  headerBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 22,
  },
  logo: { width: 56, height: 56, borderRadius: 12 },
  headerCol: { flex: 1, flexDirection: "column" },
  brand: {
    fontSize: 9,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "#888",
    marginBottom: 6,
    lineHeight: 1.2,
  },
  title: {
    fontFamily: "NotoSans",
    fontWeight: 700,
    fontSize: 22,
    marginBottom: 6,
    lineHeight: 1.15,
  },
  subtitle: { fontSize: 13, color: "#555", lineHeight: 1.3 },

  // Link box nahoře
  linkBox: {
    backgroundColor: "#fbebd0",
    padding: 14,
    borderRadius: 8,
    marginBottom: 18,
  },
  linkBoxTitle: {
    fontFamily: "NotoSans",
    fontWeight: 700,
    fontSize: 12,
    marginBottom: 4,
    color: "#1a1a1a",
  },
  linkBoxSub: { fontSize: 10, color: "#6a4a1a", marginBottom: 6 },
  linkText: {
    color: "#a05a1f",
    fontFamily: "NotoSans",
    fontWeight: 700,
    fontSize: 11,
  },

  // Sekce
  h2: {
    fontFamily: "NotoSans",
    fontWeight: 700,
    fontSize: 16,
    marginTop: 14,
    marginBottom: 8,
  },
  h3: {
    fontFamily: "NotoSans",
    fontWeight: 700,
    fontSize: 12,
    marginTop: 12,
    marginBottom: 6,
  },
  para: { marginBottom: 8 },
  intro: { fontSize: 11, color: "#444", marginBottom: 10, lineHeight: 1.6 },

  // Bullety + kroky
  bullet: { flexDirection: "row", marginBottom: 5, paddingLeft: 4 },
  bulletDot: { width: 12, color: "#b8763c", fontWeight: 700, fontSize: 12 },
  bulletText: { flex: 1 },
  step: { flexDirection: "row", marginBottom: 6, paddingLeft: 4 },
  stepNum: {
    width: 22,
    fontFamily: "NotoSans",
    fontWeight: 700,
    fontSize: 11,
    color: "#b8763c",
  },
  stepText: { flex: 1 },

  // Tip box
  tip: {
    marginTop: 12,
    backgroundColor: "#f0f0f0",
    padding: 10,
    borderRadius: 6,
    fontSize: 10,
    color: "#444",
    lineHeight: 1.5,
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

// -----------------------------------------------------------------------------
// Pomocné komponenty
// -----------------------------------------------------------------------------
interface OnboardingData {
  guestName: string;
  projectName: string;
  projectDescription: string | null;
  inviteLink: string;
}

function Header({ brandText, title, subtitle }: { brandText: string; title: string; subtitle: string }) {
  return h(View, { style: styles.headerBlock },
    LOGO_PATH && h(Image as any, { src: LOGO_PATH, style: styles.logo }),
    h(View, { style: styles.headerCol },
      h(Text, { style: styles.brand }, brandText),
      h(Text, { style: styles.title }, title),
      h(Text, { style: styles.subtitle }, subtitle),
    ),
  );
}

function LinkBox({ link }: { link: string }) {
  return h(View, { style: styles.linkBox },
    h(Text, { style: styles.linkBoxTitle }, "Tvůj osobní odkaz"),
    h(Text, { style: styles.linkBoxSub }, "Ulož si ho do oblíbených nebo na plochu telefonu. Když tě Petr přidá do dalšího projektu, uvidíš ho v nabídce — žádný nový odkaz nedostaneš."),
    h(Text, { style: styles.linkText }, link),
  );
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

function Footer() {
  return h(Text, { style: styles.footer }, "Děkuji, Petr · raseliniste.cz");
}

// -----------------------------------------------------------------------------
// Stránka 1 — společná pro Standard i Brief: uvítání + projekt + link nahoře
// -----------------------------------------------------------------------------
function PageWelcome(d: OnboardingData, opts: { brandText: string; title: string }): ReactElement {
  return h(Page as any, { size: "A4", style: styles.page },
    h(Header, {
      brandText: opts.brandText,
      title: opts.title,
      subtitle: d.projectName,
    }),

    // Link hned nahoře, hezky viditelný
    h(LinkBox, { link: d.inviteLink }),

    // Pozdrav (vyhýbá se vokativu — "Ahoj!" bez jména)
    h(Text, { style: styles.intro },
      `Ahoj!\n\nPetr tě pozval do projektu „${d.projectName}". Tady je krátký a srozumitelný návod, jak to bude celé fungovat. Není to nic složitého.`,
    ),

    // O projektu
    d.projectDescription && h(View, null,
      h(Text, { style: styles.h2 }, "O projektu"),
      h(Text, { style: styles.para }, d.projectDescription),
    ),

    // Co si má představit
    h(Text, { style: styles.h2 }, "Co si pod tím představit"),
    h(Text, { style: styles.para },
      "Studna je sdílená nahrávárna pro tým. Když tě napadne myšlenka, postřeh, otázka nebo nápad k projektu, otevřeš odkaz výše a hlasem to nahraješ. Mluvíš normálně, jako bys to říkal po telefonu Petrovi.",
    ),
    h(Text, { style: styles.para },
      "Umělá inteligence záznam přepíše a vytáhne z něj klíčové body. Petr si to pak v klidu projde. Nemusíš nic psát.",
    ),
    h(Text, { style: styles.para },
      "Petr u každého záznamu vidí, kdo ho natočil — autorství se nikdy neztratí.",
    ),

    h(Footer),
  );
}

// -----------------------------------------------------------------------------
// Stránka „Klíčový brief" (jen pro brief verzi)
// -----------------------------------------------------------------------------
function PageBriefInfo(d: OnboardingData): ReactElement {
  return h(Page as any, { size: "A4", style: styles.page },
    h(Text, { style: styles.h2 }, "Klíčový brief"),
    h(Text, { style: styles.intro },
      "Brief je delší hlasová nahrávka — typicky 30 až 90 minut — ve které vyprávíš to nejdůležitější o projektu. Mluvíš o kontextu, historii, lidech, cílech a o tom, co je teď otevřené.",
    ),
    h(Text, { style: styles.para },
      "Slouží jako referenční materiál. Petr se k němu vrací, když potřebuje rychle nahodit kontext. AI z něj vytvoří přehledný strukturovaný dokument: souhrn, glosář pojmů, seznam aktérů, historii rozhodnutí.",
    ),

    h(Text, { style: styles.h2 }, "Co by tvůj brief měl pokrýt"),
    h(Bullet, null, "O čem projekt je — proč vznikl, co řeší, co je cílem."),
    h(Bullet, null, "Stručná historie — kde to začalo, jakými fázemi to prošlo."),
    h(Bullet, null, "Klíčové postavy — kdo je v projektu, kdo má jakou roli, kdo o čem rozhoduje."),
    h(Bullet, null, "Aktuální stav — co se teď děje, co už je rozhodnuté, co se teprve řeší."),
    h(Bullet, null, "Otevřené otázky — co je nedořešeno, kde Petr může pomoct."),
    h(Bullet, null, "Důležitá rozhodnutí, která padla — proč, kdy, kdo."),
    h(Bullet, null, "Pojmy a zkratky, které v projektu používáme."),

    h(Text, { style: styles.h2 }, "Tipy, ať tvůj brief dobře sedne"),
    h(Bullet, null, "Mluv jednoduše a přirozeně. AI si s odbočkami a vsuvkami poradí."),
    h(Bullet, null, 'Když si na něco vzpomeneš později v záznamu, klidně se vrať („Ještě k tomu, co jsem říkal…"). Lineárnost není potřeba.'),
    h(Bullet, null, "Klidně si dej pauzu na kafe — nahrávka může trvat dlouho."),
    h(Bullet, null, 'Nemusíš mluvit „akademicky". Tvůj přirozený způsob, jak o projektu přemýšlíš, je to nejcennější.'),
    h(Bullet, null, "Chyby v řeči neřeš — AI je opraví."),

    h(Tip, { label: "Tip:" }, "Klidně si dopředu udělej pár bodů na papír. Ale neřeš to moc — pokud zapomeneš, prostě se vrátíš a doplníš."),

    h(Footer),
  );
}

// -----------------------------------------------------------------------------
// Stránka „Nahrání záznamů do Studny" — pro oba typy
// Pro brief verzi obsahuje navíc sekci o uploadu souboru (pro dlouhé briefy).
// -----------------------------------------------------------------------------
function PageHowToRecord(d: OnboardingData, opts: { includeBriefUpload: boolean }): ReactElement {
  return h(Page as any, { size: "A4", style: styles.page },
    h(Text, { style: styles.h2 }, "Nahrání záznamů do Studny"),
    h(Text, { style: styles.intro },
      "Komentář, nápad, informace, otázka — cokoliv tě k projektu napadne. Nahraješ to hlasem, my si s tím poradíme.",
    ),

    h(Text, { style: styles.h3 }, "iPhone — uložení odkazu na plochu"),
    h(Step, { n: 1 }, "V aplikaci Safari otevři odkaz, který máš nahoře na první stránce."),
    h(Step, { n: 2 }, "Klepni na ikonu Sdílet (čtvereček s šipkou nahoru, dole uprostřed)."),
    h(Step, { n: 3 }, 'V nabídce vyber „Přidat na plochu".'),
    h(Step, { n: 4 }, 'Vpravo nahoře potvrď „Přidat".'),
    h(Step, { n: 5 }, "Hotovo — na ploše vznikne ikona G. Klepneš na ni kdykoli, kdy budeš chtít něco poznamenat."),

    h(Text, { style: styles.h3 }, "Android — uložení odkazu na plochu"),
    h(Step, { n: 1 }, "V aplikaci Chrome otevři odkaz nahoře."),
    h(Step, { n: 2 }, "Klepni na tři tečky vpravo nahoře."),
    h(Step, { n: 3 }, 'Vyber „Přidat na plochu" (nebo „Install app").'),
    h(Step, { n: 4 }, "Potvrď. Ikona se objeví na hlavní obrazovce."),

    h(Text, { style: styles.h3 }, "Jak nahrát rychlý záznam"),
    h(Step, { n: 1 }, "Klepni na ikonu Studny na ploše."),
    h(Step, { n: 2 }, "Pokud máš víc projektů, zvol nahoře ten, do kterého nahráváš."),
    h(Step, { n: 3 }, "Klepni na velký kruh s mikrofonem uprostřed obrazovky."),
    h(Step, { n: 4 }, 'Telefon se zeptá, jestli smí používat mikrofon. Klepni „Povolit".'),
    h(Step, { n: 5 }, "Začne se nahrávat. Mluv normálně. Uvidíš odpočet, kolik času ti zbývá."),
    h(Step, { n: 6 }, 'Až skončíš, klepni „Stop". Maximální délka je 10 minut, pak se to vypne samo.'),
    h(Step, { n: 7 }, 'Za pár vteřin uvidíš „Záznam uložen ✓". Hotovo.'),

    // Pokud je to brief verze, přidáme sekci pro upload dlouhého audio souboru
    opts.includeBriefUpload && h(View, null,
      h(Text, { style: styles.h3 }, "Jak nahrát dlouhý brief (přes upload souboru)"),
      h(Text, { style: styles.para },
        "Brief NEnahrávej přímo přes web — devadesát minut v prohlížeči je riskantní (vybitá baterie, výpadek sítě, telefon se uspí). Místo toho použij standardní aplikaci na hlasové poznámky a hotový soubor pak nahraj.",
      ),
      h(Step, { n: 1 }, "Otevři aplikaci Hlasové poznámky (iPhone) nebo Záznamník (Android)."),
      h(Step, { n: 2 }, "Klepni na nahrávací tlačítko a začni mluvit. Telefon můžeš položit na stůl."),
      h(Step, { n: 3 }, "Po skončení klepni Stop. Záznam se uloží do aplikace."),
      h(Step, { n: 4 }, 'Otevři odkaz na Studnu, klepni pod mikrofonem na malý odkaz „Klíčový brief — nahrát soubor →".'),
      h(Step, { n: 5 }, 'Klepni na „Vybrat soubor" a najdi nahrávku, kterou jsi natočil.'),
      h(Step, { n: 6 }, 'Klepni „Odeslat brief". Vydrž 2–5 minut — AI ho zpracovává.'),
      h(Step, { n: 7 }, 'Až uvidíš „Záznam uložen ✓", máš hotovo.'),
    ),

    h(Text, { style: styles.h3 }, "Tipy, ať to dobře dopadne"),
    h(Bullet, null, "Mluv klidně, ne v hlučném prostředí — Gemini rozumí češtině moc dobře."),
    h(Bullet, null, "Jeden záznam = jedna myšlenka nebo téma. Radši víc krátkých než jeden dlouhý."),
    h(Bullet, null, 'Nemusíš formulovat „spisovně". Stačí říct, co tě napadlo.'),
    h(Bullet, null, "Pokud zkazíš, klidně to natočíš znovu — Petr starý záznam smaže."),

    h(Footer),
  );
}

// -----------------------------------------------------------------------------
// Standard PDF (2 strany): Vítej / Nahrání záznamů
// -----------------------------------------------------------------------------
function StandardPdf(d: OnboardingData): ReactElement {
  return h(Document, null,
    PageWelcome(d, { brandText: "Rašeliniště · Studna", title: "Vítej v projektu" }),
    PageHowToRecord(d, { includeBriefUpload: false }),
  );
}

// -----------------------------------------------------------------------------
// Brief PDF (3 strany): Vítej / Klíčový brief / Nahrání záznamů (vč. brief upload)
// -----------------------------------------------------------------------------
function BriefPdf(d: OnboardingData): ReactElement {
  return h(Document, null,
    PageWelcome(d, { brandText: "Rašeliniště · Studna · Klíčový brief", title: "Vítej v projektu" }),
    PageBriefInfo(d),
    PageHowToRecord(d, { includeBriefUpload: true }),
  );
}

export async function renderOnboardingPdf(
  variant: "standard" | "brief",
  data: OnboardingData,
): Promise<Buffer> {
  ensureFonts();
  const doc = variant === "brief" ? BriefPdf(data) : StandardPdf(data);
  const stream = await pdf(doc as any).toBuffer();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}
