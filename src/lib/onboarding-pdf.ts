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
    h(Text, { style: styles.linkBoxSub }, "Ulož si ho do oblíbených nebo na plochu telefonu. Když tě Gideon přidá do dalšího projektu, uvidíš ho v nabídce — žádný nový odkaz nedostaneš."),
    h(Text, { style: styles.linkText }, link),
  );
}

// Pomocné komponenty — content předáváme přes prop, ne přes children,
// abychom se vyhnuli React.createElement type-checkingu.
function Bullet(text: string) {
  return h(View, { style: styles.bullet },
    h(Text, { style: styles.bulletDot }, "·"),
    h(Text, { style: styles.bulletText }, text),
  );
}

function Step(n: number, text: string) {
  return h(View, { style: styles.step },
    h(Text, { style: styles.stepNum }, `${n}.`),
    h(Text, { style: styles.stepText }, text),
  );
}

function Tip(label: string, text: string) {
  return h(View, { style: styles.tip },
    h(Text, null,
      h(Text, { style: styles.tipLabel }, label + " "),
      h(Text, null, text),
    ),
  );
}

function Footer() {
  return h(Text, { style: styles.footer }, "Děkuji, Gideon · raseliniste.cz");
}

// -----------------------------------------------------------------------------
// Stránka 1 — společná pro Standard i Brief: uvítání + projekt + link nahoře
// -----------------------------------------------------------------------------
function PageWelcome(d: OnboardingData, opts: { brandText: string; title: string }): ReactElement {
  // Petr 2026-05-18: vyhozený dlouhý úvod + "Co si představit" — host dostane
  // jen odkaz a rovnou jak na to. Header + LinkBox.
  return h(Page as any, { size: "A4", style: styles.page },
    h(Header, {
      brandText: opts.brandText,
      title: opts.title,
      subtitle: d.projectName,
    }),
    h(LinkBox, { link: d.inviteLink }),
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
      "Slouží jako referenční materiál. Gideon se k němu vrací, když potřebuje rychle nahodit kontext. AI z něj vytvoří přehledný strukturovaný dokument: souhrn, glosář pojmů, seznam aktérů, historii rozhodnutí.",
    ),

    h(Text, { style: styles.h2 }, "Co by tvůj brief měl pokrýt"),
    Bullet("O čem projekt je — proč vznikl, co řeší, co je cílem."),
    Bullet("Stručná historie — kde to začalo, jakými fázemi to prošlo."),
    Bullet("Klíčové postavy — kdo je v projektu, kdo má jakou roli, kdo o čem rozhoduje."),
    Bullet("Aktuální stav — co se teď děje, co už je rozhodnuté, co se teprve řeší."),
    Bullet("Otevřené otázky — co je nedořešeno, kde Gideon může pomoct."),
    Bullet("Důležitá rozhodnutí, která padla — proč, kdy, kdo."),
    Bullet("Pojmy a zkratky, které v projektu používáme."),

    h(Footer),
  );
}

// -----------------------------------------------------------------------------
// Stránka „Nahrání záznamů do Studny" — pro oba typy
// Pro brief verzi obsahuje navíc sekci o uploadu souboru (pro dlouhé briefy).
// -----------------------------------------------------------------------------
function PageHowToRecord(d: OnboardingData, _opts: { includeBriefUpload: boolean }): ReactElement {
  // Petr 2026-05-18: jen iPhone + Android + Upload (i ve standard verzi).
  // Vyhozené: intro, "Jak nahrát rychlý záznam" sekce, Tipy.
  return h(Page as any, { size: "A4", style: styles.page },
    h(Text, { style: styles.h2 }, "Nahrání záznamů do Studny"),

    h(Text, { style: styles.h3 }, "iPhone — uložení odkazu na plochu"),
    Step(1, "V aplikaci Safari otevři odkaz, který máš nahoře na první stránce."),
    Step(2, "Klepni na ikonu Sdílet (čtvereček s šipkou nahoru, dole uprostřed)."),
    Step(3, 'V nabídce vyber „Přidat na plochu".'),
    Step(4, 'Vpravo nahoře potvrď „Přidat".'),
    Step(5, "Hotovo — na ploše vznikne ikona G. Klepneš na ni kdykoli, kdy budeš chtít něco poznamenat."),

    h(Text, { style: styles.h3 }, "Android — uložení odkazu na plochu"),
    Step(1, "V aplikaci Chrome otevři odkaz nahoře."),
    Step(2, "Klepni na tři tečky vpravo nahoře."),
    Step(3, 'Vyber „Přidat na plochu" (nebo „Install app").'),
    Step(4, "Potvrď. Ikona se objeví na hlavní obrazovce."),

    h(Text, { style: styles.h3 }, "Nahrání hotového audio souboru (upload)"),
    h(Text, { style: styles.para },
      "Pokud máš nahrávku už hotovou v telefonu (Hlasové poznámky iPhone, Záznamník Android, podcast, zápis z mítinku), nemusíš ji nahrávat přes web — můžeš ji rovnou uploadnout.",
    ),
    Step(1, "Otevři odkaz na Studnu (ikona G na ploše)."),
    Step(2, 'Pod hlavním nahrávacím kruhem najdi tlačítko „📎 Nahrát audio soubor".'),
    Step(3, "Klepni na něj — telefon nabídne odkud vybrat (Knihovna fotek / Files / iCloud / Google Drive)."),
    Step(4, "Vyber soubor. Upload poběží na pozadí, vidíš progress."),
    Step(5, 'Až uvidíš „Záznam uložen ✓", máš hotovo. Přepis se zpracovává automaticky (do 5 min).'),

    h(Footer),
  );
}

// -----------------------------------------------------------------------------
// Standard PDF (2 strany): Vítej / Nahrání záznamů
// -----------------------------------------------------------------------------
function StandardPdf(d: OnboardingData): ReactElement {
  return h(Document, null,
    PageWelcome(d, { brandText: "Rašeliniště · Studánka", title: "Vítej v projektu" }),
    PageHowToRecord(d, { includeBriefUpload: false }),
  );
}

// -----------------------------------------------------------------------------
// Brief PDF (3 strany): Vítej / Klíčový brief / Nahrání záznamů (vč. brief upload)
// -----------------------------------------------------------------------------
function BriefPdf(d: OnboardingData): ReactElement {
  return h(Document, null,
    PageWelcome(d, { brandText: "Rašeliniště · Studánka · Klíčový brief", title: "Vítej v projektu" }),
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
