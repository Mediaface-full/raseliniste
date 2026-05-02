// Sdílené barevné konstanty pro B&W Myš vizualizace.
// Recharts neumí CSS proměnné — používáme hex přibližně odpovídající --tint-* z global.css.

export const MOOD_COLORS: Record<number, string> = {
  1: "#ECAAA6", // rose   — nejhorší
  2: "#ECDB94", // butter
  3: "#9CCAE8", // sky    — neutrální
  4: "#9DDDC2", // mint
  5: "#B6D8B7", // sage   — nejlepší
};

export const MOOD_LABEL: Record<number, string> = {
  1: "nejhorší",
  2: "horší",
  3: "neutrální",
  4: "lepší",
  5: "nejlepší",
};

// Six Hats — barvy odpovídají klasickému schématu Edwarda de Bono.
export const HAT_COLORS: Record<string, string> = {
  bily: "#E0E0E0",     // fakta
  cerveny: "#ECAAA6",  // emoce
  cerny: "#5A5A5A",    // rizika (světlejší než pure black kvůli kontrastu na dark BG)
  zluty: "#ECDB94",    // přínosy
  zeleny: "#9DDDC2",   // alternativy
  modry: "#9CCAE8",    // meta
};

// Mapování úhlu pohledu (DB hodnota) na hat-barvu.
export const UHEL_TO_HAT: Record<string, keyof typeof HAT_COLORS> = {
  fakta: "bily",
  emoce: "cerveny",
  kritika: "cerny",
  prinosy: "zluty",
  alternativy: "zeleny",
  meta: "modry",
};

export const UHEL_LABEL_SHORT: Record<string, string> = {
  fakta: "Fakta",
  emoce: "Emoce",
  kritika: "Kritika",
  prinosy: "Přínosy",
  alternativy: "Alternativy",
  meta: "Meta",
};

// Typ vstupu — distinctní barvy.
export const TYPE_COLORS: Record<string, string> = {
  novy_fakt_zvenci: "#7DC8C0",   // teal
  nova_uvaha: "#A8B0C0",         // neutral
  napadlo_me: "#88869A",         // ztlumená
  reakce_na_udalost: "#C7AFE0",  // lavender
};

export const TYPE_LABEL: Record<string, string> = {
  novy_fakt_zvenci: "Nový fakt zvenčí",
  nova_uvaha: "Nová úvaha",
  napadlo_me: "Napadlo mě",
  reakce_na_udalost: "Reakce na událost",
};

// Mřížka argumentů — pro/proti.
export const ARGUMENT_COLORS = {
  pro: "#9DDDC2",    // mint
  proti: "#ECAAA6",  // rose
};

// Pomocné — efektivní úhel pohledu (manuální přebije AI klasifikaci pokud je vybrán).
export function effectiveUhel(uhelPohledu: string, uhelPohleduAi: string | null | undefined): string | null {
  if (uhelPohledu && uhelPohledu !== "nevybrano") return uhelPohledu;
  if (uhelPohleduAi) return uhelPohleduAi;
  return null;
}
