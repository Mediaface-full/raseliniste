# 00 — START HERE (pro novou Claude Code session)

> **Pokud jsi Claude Code session a právě jsi otevřela tento projekt, čti tohle JAKO PRVNÍ.**
> Pak teprve sahej na kód.

## Co je tento projekt

**Rašeliniště** — osobní informační systém Petra „Gideona" Periny. Single-user, max security, hostováno na Synology DS718+ v Dockeru přes ghcr.io. Doména **https://www.raseliniste.cz**.

14 živých modulů (Auth, Capture, Úkoly /ukoly, Poznámky, Deník /denik, Zdraví, Kontakty, Firewall, Dopisy, Studna, Kalendář, Ozvěna /ozvena, Start /start, Zeptat se /zeptat-se). Plus AI tracking, AI prompty editor, diagnostika.

## Pravidla — nepřekoč

1. **Komunikace česky, stručně, přímo.** Žádná vata. Tykání.
2. **Uživatel se v systému jmenuje GIDEON, ne Petr.**
   - V AI promptech, UI textech, interních zápisech → **Gideon**
   - Externí komunikace (mail klientům, dopisy, onboarding PDF Studny) → **Petr** (klient handle nezná)
3. **Před riskantními akcemi se ptej** (`git push --force`, `rm -rf`, drop DB, mazání migrací).
4. **Neprogramuj dopředu** — nepřidávej abstrakce/features, které Gideon neřekl.
5. **Mobilní UX** — testuj/zvažuj na telefonu po každé větší změně layoutu.
6. **Gemini klíč NIKDY do client bundle** — vždy přes server-side endpoint.
7. **Maximum bezpečnosti** — argon2, rate-limit, ownership check. Neřezat.

## V jakém pořadí číst dokumenty

```
INSTRUKCE/
├── 00-START-HERE.md            ← jsi zde
├── 01-aktualni-stav.md         ← co je teď nasazeno, co čeká
├── 02-architektura.md          ← stack, schémata, klíčová rozhodnutí
├── 03-moduly.md                ← všechny moduly, URL, status
├── 04-todo-list.md             ← co se má dělat
├── 05-styl-prace.md            ← jak Gideon pracuje, co očekává
├── 06-troubleshooting.md       ← známé problémy + diagnostika
├── 07-resources.md             ← kde co je (repo, NAS, doména, soubory)
└── 08-deploy-testing.md        ← jak nerozbít produkci (staging, smoke test, rollback)
```

**Plus existující projektové dokumenty** (na ně narazíš v repo root):
- `CLAUDE.md` + `AGENTS.md` — auto-loaded, přečteš automaticky
- `HANDOFF.md` — předávací dokument (může být zastaralý — viz 01-aktualni-stav.md)
- `HANDBOOK.md` — technická reference (1000+ řádků, na konci je changelog 2026-04-29)
- `RUNBOOK.md` — operativní příručka pro Gideona (provoz na NASu)
- `Návody/` — uživatelské PDF manuály (5 dokumentů + HTML zdroje)

## Když máš čas, projdi taky

**Memory** (`/Users/petrperina/.claude/projects/.../memory/MEMORY.md`):
- Profil Gideona
- Design preferences (4 dřívější pokusy zamítnuty — neopakovat)
- TODO Studna async (vyřešeno commit 2f32fac, pro reference)
- TODO GCP Billing (čeká na zpracování)

## První akce v session

Než cokoliv navrhnete:

```bash
git status
git log --oneline -10
npx tsc --noEmit | tail -5  # 0 errors except known env Proxy issues
```

Pak se Gideona zeptej **co chce řešit**. Nepředpokládej.

---

_Vygenerováno 2026-04-30. Při větších změnách aktualizuj 01-aktualni-stav.md._
