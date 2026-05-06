# Changelog

## [Unreleased]

### Added
- **B&W Myš — Decision Compass** (5. vizualizační komponenta). SVG kompas se 4 kvadranty (SZ/SV silný signál PRO/PROTI, JZ/JV šum strach/euforie). Argumenty s konzistencí > 0.5 jsou v horní polovině plné, s nižší v dolní polovině vybledlé + dashed. Velikost bodu = četnost, barva = Six Hats klobouk. V centru verdikt s labelem „opřený o sever/východ/jih/západ" podle dominantního kvadrantu. Render první v `ArgumentsBanner`, před stávající mřížkou argumentů. Spec: `INSTRUKCE/zadani-decision-compass.pdf`.
- `DecisionArgument.klobouk` field (Six Hats kategorie: fakta/emoce/kritika/prinosy/alternativy/meta) — AI vrací při `extractArguments()`. Optional v Zod schema kvůli backwards compat se starými argumentsJson v DB; chybějící klobouk → fallback na `meta` (šedá).
- `COMPASS_HAT_COLORS` v `bwmys-colors.ts` — sytější varianty Six Hats barev pro fill bodu na světlém SVG (hex z PDF speca).

### Changed
- `extractArguments()` prompt — AI nyní určuje klobouk pro každý argument podle příkladů („vysoké náklady" → kritika, „cítil bych se dobře" → emoce, atd.).
