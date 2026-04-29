# Návody k Rašeliništi

Sada uživatelských manuálů, které ti vysvětlí, jak ovládat všechny moduly + jak je provozovat na NASu.

## Co tady je

| # | Soubor | Stran | O čem |
|---|---|---|---|
| 01 | [Kalendář](01-kalendar.pdf) | 7 | Kalendář, quickadd, bookingy, dovolená, lokace, 18 pravidel, briefing |
| 02 | [Úkoly](02-ukoly.pdf) | 7 | Manuální úkoly, audio diktát, delegace, smart Todoist routing |
| 03 | [Cron nastavení](03-crony.pdf) | 6 | Všech 10 cronů na NASu — co, kdy, jak nastavit |
| 04 | [Testovací checklist](04-testy.pdf) | 8 | 50+ testů k odškrtávání pro ověření, že všechno jede |

PDF jsou hotová ke čtení / tisku. HTML zdroje vedle nich pro pozdější úpravy.

## Jak je číst

Začni **04 testy** pokud potřebuješ ověřit, že po deployi všechno jede. Pak **03 crony** pokud cíhle ještě nemáš na NASu zaregistrované. **01 a 02** si přečti pomalu když máš čas — naučíš se všechny funkce.

## Jak je upravit

Edituj příslušný `.html` soubor. Pak přepiš PDF:

```bash
cd "/Users/petrperina/CLOUDS/CLOUDE PROJECTS/raseliniste/Návody"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=01-kalendar.pdf "file://$PWD/01-kalendar.html"
```

Nebo prostě otevři HTML v Chrome → Cmd+P → Save as PDF.

---

_Vygenerováno 2026-04-29._
