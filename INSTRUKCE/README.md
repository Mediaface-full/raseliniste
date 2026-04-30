# INSTRUKCE — onboarding pro novou Claude Code session

Když někdo (Gideon nebo nová Claude session) otevře tento projekt poprvé, čte tyto soubory v daném pořadí.

## Co je v této složce

| # | Soubor | O čem | Pozn. |
|---|---|---|---|
| 00 | [START-HERE.md](00-START-HERE.md) | Vstupní bod, klíčová pravidla | **Začni zde** |
| 01 | [Aktuální stav](01-aktualni-stav.md) | Recent commits, co je nasazeno, co čeká | Aktualizuj po větších commitech |
| 02 | [Architektura](02-architektura.md) | Stack, klíčová rozhodnutí, datový model přehled | |
| 03 | [Moduly](03-moduly.md) | Všechny moduly, URL, status | |
| 04 | [TODO list](04-todo-list.md) | Aktivní + nice-to-have + záměrně odložené | Aktualizuj |
| 05 | [Styl práce](05-styl-prace.md) | Kdo je Gideon, jak komunikuje, risk management | |
| 06 | [Troubleshooting](06-troubleshooting.md) | Známé pasti + diagnostika | |
| 07 | [Resources](07-resources.md) | Kde co je (repo, NAS, soubory, env) | |

## Jak používat

### Nová Claude Code session

1. Otevři `00-START-HERE.md` — orientace + pravidla
2. `01-aktualni-stav.md` — co je teď
3. Zeptej se Gideona co chce řešit
4. Případně proklikávej dál (02-07) podle tématu

### Po větší sadě commitů

Aktualizuj:
- `01-aktualni-stav.md` (commit hashe, nové URL, status modulů)
- `04-todo-list.md` (přesun hotových z aktivních, přidat nové)
- `03-moduly.md` (jen pokud přibyl nový modul nebo se výrazně změnil)
- HANDBOOK.md (shrnující změny do changelog sekce na konci)

### Nový modul nebo důležitá změna

Doplň do:
- `03-moduly.md` (řádek do tabulky)
- `02-architektura.md` (pokud má nové architektonické rozhodnutí)
- `06-troubleshooting.md` (pokud objevíš nový gotcha)

### Nová persistent paměť

Vytvoř soubor v:
```
/Users/petrperina/.claude/projects/-Users-petrperina-CLOUDS-CLOUDE-PROJECTS-raseliniste/memory/
```

Plus přidej řádek do `MEMORY.md` indexu.

## Kde to ostatní není

- Tyto soubory jsou v gitu (component projektu).
- **Nejsou auto-loaded** Claude session. Buď je Gideon manuálně předá, nebo `CLAUDE.md` může na ně odkázat.
- Ze souborů co jsou auto-loaded: `CLAUDE.md` (přes `@AGENTS.md` v něm).

## Kdy přepsat zastaralé dokumenty

`HANDOFF.md` v root je z 2026-04-28. **Zastaralý**. Místo přepisování ho pojďme nechat jako historický artefakt a používat `INSTRUKCE/` jako primární zdroj.

`HANDBOOK.md` je rozšiřován changelog sekcí na konci (poslední 2026-04-29). Ne přepisovat horní část — append.

## Generováno

První verze: 2026-04-30 (commit po 900caec).
