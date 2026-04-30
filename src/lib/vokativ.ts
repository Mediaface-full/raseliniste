/**
 * Český vokativ (5. pád) z 1. pádu pro oslovení.
 *
 * Tady je kombinace:
 *   1. Tabulka výjimek (jména co algoritmus zkazí)
 *   2. Algoritmus pro běžné koncovky
 *
 * Pro 100% jistotu má `Contact` pole `firstNameVocative` — manuální override.
 * Použij `vokativ(firstName, override?)` — pokud override je vyplněný, vrátí ho.
 */

// Jména kde algoritmus selhává nebo by působil divně (česká i světová).
const EXCEPTIONS: Record<string, string> = {
  // Mužská
  "petr": "Petře",
  "tomáš": "Tomáši",
  "lukáš": "Lukáši",
  "ondřej": "Ondřeji",
  "matěj": "Matěji",
  "jiří": "Jiří",
  "alexej": "Alexeji",
  "honza": "Honzo",
  "míša": "Míšo",
  "saša": "Sašo",
  "pavel": "Pavle",
  "karel": "Karle",
  "michal": "Michale",
  "marek": "Marku",
  "filip": "Filipe",
  "martin": "Martine",
  "vít": "Víte",
  "ivan": "Ivane",
  "jakub": "Jakube",
  "david": "Davide",
  "daniel": "Danieli",
  "ben": "Bene",
  "jan": "Jane",
  "honzík": "Honzíku",

  // Ženská
  "marie": "Marie",
  "lucie": "Lucie",
  "natálie": "Natálie",
  "andrea": "Andreo",
  "monika": "Moniko",
  "blanka": "Blanko",
  "veronika": "Veroniko",
  "kateřina": "Kateřino",
  "katka": "Katko",
  "tereza": "Terezo",
  "petra": "Petro",
  "jana": "Jano",
  "hana": "Hano",
  "hanka": "Hanko",
  "alena": "Aleno",
  "eva": "Evo",
  "lenka": "Lenko",
  "anna": "Anno",
  "klára": "Kláro",
  "michaela": "Michaelo",
  "barbora": "Barboro",
};

function applyAlgorithm(name: string): string {
  if (name.length < 2) return name;
  const lower = name.toLowerCase();
  const last = lower[lower.length - 1];
  const last2 = lower.slice(-2);

  // Žensky -a → -o
  if (last === "a") {
    return name.slice(0, -1) + "o";
  }
  // Žensky -e (Marie, Lucie) → beze změny
  if (last === "e") {
    return name;
  }
  // Mužská -us → -e (Marius, Julius nech být)
  // Mužská -el → -le (Karel, Pavel) — řešeno v EXCEPTIONS
  // Mužská souhláska → +e
  if (/[bcdfghjklmnpqrstvwxz]/.test(last)) {
    // Měkčení po žádném zatím nedeláme — Petr/Tomáš jsou v EXCEPTIONS
    return name + "e";
  }
  // Ostatní (samohlásky -i, -o, -u, -y) → beze změny
  return name;
}

/**
 * Vrátí vokativ jména. Priorita:
 *   1. Manuální override z Contact.firstNameVocative (pokud je vyplněn)
 *   2. EXCEPTIONS tabulka
 *   3. Algoritmus
 *   4. Fallback na první pád (lepší než vytvořit blbost)
 */
export function vokativ(firstName: string | null | undefined, override?: string | null): string {
  if (override && override.trim()) return override.trim();
  if (!firstName) return "";
  const name = firstName.trim();
  if (!name) return "";

  const ex = EXCEPTIONS[name.toLowerCase()];
  if (ex) {
    // Zachovej původní velikost prvního písmene (kdyby byla CAPS)
    return ex;
  }

  try {
    return applyAlgorithm(name);
  } catch {
    return name;
  }
}
