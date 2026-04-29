# Návody k Rašeliništi

Sada uživatelských manuálů — jak ovládat všechny moduly a jak provozovat NAS.

## Co tady je

| # | Soubor | Stran | O čem |
|---|---|---|---|
| 01 | [Kalendář](01-kalendar.pdf) | 7 | Kalendář, quickadd, bookingy, dovolená, lokace, 18 pravidel, briefing |
| 02 | [Úkoly](02-ukoly.pdf) | 7 | Manuální úkoly, hlasový diktát Ozvěna, delegace, smart Todoist routing |
| 03 | [Cron nastavení](03-crony.pdf) | 7 | Všech 11 cronů na NASu — co, kdy, jak nastavit |
| 04 | [Testovací checklist](04-testy.pdf) | 8 | 50+ testů k odškrtávání pro ověření, že všechno jede |
| 05 | [Deník](05-denik.pdf) | 7 | Hlasový + textový deník, vyhledávání, měsíční review, NÁPADY |

PDF jsou hotová ke čtení / tisku. HTML zdroje vedle nich pro pozdější úpravy.

## Jak je číst

- **První spuštění / po deployi:** 04 testy → 03 crony → ostatní postupně
- **Denní práce:** podle modulu — 01 kalendář, 02 úkoly, 05 deník
- **Něco se rozbilo:** 04 testy A. Nutné minimum + diagnostický endpoint `/api/diagnose/studna`

## Jak je upravit

Edituj příslušný `.html` soubor. Pak přepiš PDF:

```bash
cd "/Users/petrperina/CLOUDS/CLOUDE PROJECTS/raseliniste/Návody"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=05-denik.pdf "file://$PWD/05-denik.html"
```

Nebo otevři HTML v Chrome → Cmd+P → Save as PDF.

---

_Aktualizováno 2026-04-29._
