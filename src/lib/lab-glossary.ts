/**
 * Lidské vysvětlivky laboratorních analytů (Petr 2026-07-21) — tooltip
 * v tabulce a grafech na /health/krev. Párování přes analyteKey (slug):
 * entry matchne, když klíč obsahuje některý z tokenů.
 *
 * Texty jsou obecně-vzdělávací, ne diagnóza.
 */

interface GlossaryEntry {
  match: string[];   // substring match v analyteKey (lowercase slug)
  text: string;
}

const GLOSSARY: GlossaryEntry[] = [
  // ---- Krevní obraz ----
  { match: ["leukocyty", "wbc"], text: "Bílé krvinky — obranyschopnost. Zvýšené bývají při infekci či zánětu, snížené při útlumu imunity." },
  { match: ["erytrocyty", "rbc"], text: "Červené krvinky — přenášejí kyslík. Málo = anémie, hodně např. při dehydrataci nebo kouření." },
  { match: ["hemoglobin"], text: "Červené krevní barvivo přenášející kyslík. Nízký = chudokrevnost (únava, bledost)." },
  { match: ["hematokrit"], text: "Podíl červených krvinek na objemu krve. Souvisí s anémií i zavodněním organismu." },
  { match: ["trombocyty", "plt", "destic"], text: "Krevní destičky — srážení krve. Málo = sklon ke krvácení, hodně = riziko sraženin." },
  { match: ["mcv", "stredni-objem"], text: "Průměrná velikost červené krvinky. Pomáhá rozlišit typ anémie (malé = nedostatek železa, velké = B12/folát)." },
  { match: ["mch", "barvivo-erytr"], text: "Průměrné množství hemoglobinu v jedné červené krvince. Doplňuje obraz anémie." },
  { match: ["mchc"], text: "Koncentrace hemoglobinu v červených krvinkách. Další ukazatel typu anémie." },
  { match: ["rdw"], text: "Rozptyl velikostí červených krvinek. Zvýšený bývá časnou známkou nedostatku železa nebo B12." },
  { match: ["neutrofily"], text: "Nejpočetnější bílé krvinky — první obrana proti bakteriím. Rostou při bakteriální infekci a stresu." },
  { match: ["lymfocyty"], text: "Bílé krvinky specializované na viry a imunitní paměť. Rostou při virózách." },
  { match: ["monocyty"], text: "Bílé krvinky — „úklidová četa“ imunity. Zvýšené při doznívajících infekcích a chronických zánětech." },
  { match: ["eozinofily"], text: "Bílé krvinky spojené s alergiemi a parazity. Zvýšené při alergii, astmatu, ekzému." },
  { match: ["bazofily"], text: "Nejvzácnější bílé krvinky, role při alergických reakcích. Samostatně málokdy významné." },

  // ---- Cukr ----
  { match: ["glukoza", "glukóza", "glykemie"], text: "Krevní cukr. Zvýšený nalačno = riziko prediabetu/cukrovky; ovlivní ho i jídlo před odběrem." },
  { match: ["hba1c", "glykovany"], text: "„Dlouhodobý cukr“ — průměrná glykémie za ~3 měsíce. Klíčový pro záchyt a kontrolu cukrovky." },

  // ---- Ledviny, minerály ----
  { match: ["kreatinin"], text: "Odpad ze svalů vylučovaný ledvinami — hlavní ukazatel funkce ledvin. Vyšší = horší filtrace; nižší bývá při malé svalové hmotě." },
  { match: ["urea", "mocovina"], text: "Odpad z bílkovin vylučovaný ledvinami. Ovlivní ji i příjem bílkovin a pitný režim." },
  { match: ["gfr", "glomerularni"], text: "Odhad filtrační výkonnosti ledvin. Čím nižší, tím hůř ledviny čistí krev." },
  { match: ["kys-mocova", "kyselina-mocova", "urat"], text: "Kyselina močová — odpad z purinů (maso, pivo). Vysoká = riziko dny a ledvinových kamenů." },
  { match: ["sodik", "natrium"], text: "Sodík — hospodaření s vodou a tlakem. Vychyluje se při dehydrataci či převodnění." },
  { match: ["draslik", "kalium"], text: "Draslík — činnost srdce a svalů. Vychýlení oběma směry může působit arytmie." },
  { match: ["chloridy"], text: "Chloridy — doplněk sodíku v hospodaření s vodou a acidobazické rovnováze." },
  { match: ["vapnik", "kalcium"], text: "Vápník — kosti, svaly, nervy. Vychýlení souvisí s příštítnými tělísky či vitaminem D." },
  { match: ["horcik", "magnezium"], text: "Hořčík — svaly, nervy, spánek. Nedostatek se projevuje křečemi a únavou." },
  { match: ["fosfor", "fosfat"], text: "Fosfor — kosti a energetický metabolismus. Sleduje se hlavně s vápníkem a ledvinami." },
  { match: ["zelezo"], text: "Železo v séru — surovina pro krvetvorbu. Samotné kolísá během dne; přesnější je ferritin." },
  { match: ["ferritin"], text: "Zásobní železo. Nízký = vyčerpané zásoby (dřív než anémie); zvýšený bývá i při zánětu." },
  { match: ["transferin"], text: "Bílkovina přenášející železo krví. Pomáhá rozlišit příčinu nedostatku železa." },

  // ---- Játra, slinivka ----
  { match: ["alt"], text: "Jaterní enzym — nejcitlivější běžný ukazatel poškození jaterních buněk (tuk, alkohol, léky, viry)." },
  { match: ["ast"], text: "Enzym z jater a svalů. Zvýšený při poškození jater, ale i po velké fyzické zátěži." },
  { match: ["ggt", "gmt"], text: "Jaterní enzym citlivý na alkohol, léky a ztukovatění jater." },
  { match: ["alp", "alkalicka-fosfataza"], text: "Enzym z jater, žlučových cest a kostí. Zvýšený při městnání žluči nebo kostních dějích." },
  { match: ["bilirubin"], text: "Žlučové barvivo z rozpadu červených krvinek. Mírně zvýšený bývá neškodný (Gilbertův syndrom), vysoký = žloutenka." },
  { match: ["amylaza"], text: "Enzym slinivky a slinných žláz. Výrazně roste při zánětu slinivky." },
  { match: ["lipaza"], text: "Enzym slinivky trávící tuky — specifičtější ukazatel zánětu slinivky než amyláza." },

  // ---- Tuky ----
  { match: ["cholesterol-celk", "celkovy-cholesterol"], text: "Součet všech typů cholesterolu. Sám o sobě říká málo — důležitý je poměr LDL/HDL." },
  { match: ["ldl"], text: "„Zlý“ cholesterol — ukládá se do cév a zvyšuje riziko infarktu. Čím nižší, tím lépe." },
  { match: ["hdl"], text: "„Hodný“ cholesterol — odváží tuk z cév. Vyšší = ochranný. Zvedá ho pohyb." },
  { match: ["triacylglycerol", "triglycerid"], text: "Tuky z jídla a cukrů. Zvýšené po sladkém, alkoholu a při nadváze; velmi ovlivněné jídlem před odběrem." },

  // ---- Bílkoviny, zánět ----
  { match: ["crp"], text: "Ukazatel zánětu. Vysoký = bakteriální infekce/zánět; mírně zvýšený i při chronickém zánětu." },
  { match: ["albumin"], text: "Hlavní krevní bílkovina z jater — stav výživy a jaterní syntézy." },
  { match: ["celkova-bilkovina"], text: "Souhrn všech bílkovin v krvi (albumin + protilátky). Obraz výživy a imunity." },
  { match: ["sedimentace", "fw"], text: "Rychlost usazování krvinek — starší nespecifický ukazatel zánětu." },

  // ---- Hormony, vitamíny ----
  { match: ["tsh"], text: "Řídící hormon štítné žlázy. Vysoký = štítná žláza líná (hypofunkce), nízký = přehnaně aktivní." },
  { match: ["ft4", "tyroxin"], text: "Hormon štítné žlázy (volný tyroxin). Čte se společně s TSH." },
  { match: ["ft3"], text: "Aktivní hormon štítné žlázy. Doplněk k TSH a fT4." },
  { match: ["vitamin-d", "25-oh"], text: "Vitamin D — kosti a imunita. V ČR má většina lidí v zimě nedostatek." },
  { match: ["vitamin-b12", "b12", "kobalamin"], text: "Vitamin B12 — krvetvorba a nervy. Nedostatek: únava, brnění, chudokrevnost (častěji u rostlinné stravy)." },
  { match: ["folat", "kyselina-listova"], text: "Folát (B9) — krvetvorba a dělení buněk. Čte se spolu s B12." },
  { match: ["psa"], text: "Prostatický antigen — screening prostaty. Zvýšený i při zánětu či po jízdě na kole; hodnotí se trend." },
  { match: ["testosteron"], text: "Mužský pohlavní hormon — energie, svaly, libido. Klesá s věkem, stresem a nedostatkem spánku." },
  { match: ["kortizol"], text: "Stresový hormon nadledvin. Silně kolísá během dne — záleží na čase odběru." },

  // ---- Moč ----
  { match: ["specificka-hustota"], text: "Hustota moči — jak koncentrovaná je. Nízká při hodně pití, vysoká při dehydrataci." },
  { match: ["ph-moc", "ph"], text: "Kyselost moči. Ovlivněná stravou; význam hlavně u ledvinových kamenů." },
  { match: ["bilkovina-v-moci", "proteinurie"], text: "Bílkovina v moči — zdravé ledviny ji nepropouštějí. Nález = kontrola ledvin." },
  { match: ["ldh"], text: "Enzym přítomný ve všech tkáních — nespecifický ukazatel rozpadu buněk." },
];

/** Najdi vysvětlivku podle analyteKey (slug). Null když nemáme. */
export function labExplanation(analyteKey: string): string | null {
  for (const entry of GLOSSARY) {
    if (entry.match.some((m) => analyteKey.includes(m))) return entry.text;
  }
  return null;
}
