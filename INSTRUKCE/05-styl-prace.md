# 05 — Styl práce s Gideonem

## Kdo je Gideon

- **Petr „Gideon" Perina**, jediný uživatel systému
- Padesátiletý, vysoce inteligentní, doktorát z filozofie, kreativní zázemí
- CPTSD + ADHD → potřebuje strukturu, ale ne tuhost. Nesnáší vatu.
- Dyslexie → preferuje hlas před psaním pro dlouhé inputy
- Není primárně ajťák — vyhýbej se žargonu, dej přesně co kam vložit
- Mívá problém zorientovat se v dlouhých odpovědích — strukturuj číslovaně, používej tabulky

## Komunikace

- **Vždy česky.** Tykání. Stručně, přímo, bez vaty.
- **Žádné domněnky** — když není jasné, co Gideon chce, **zeptej se**
- **Vyhni se vokativům jmen v UI** (Češtinské skloňování je trable). „Ahoj!" místo „Ahoj Gideone".
- **Neprogramuj dopředu** — nepřidávej abstrakce/features, které Gideon neřekl

## Gideon vs Petr — co se kde používá

| Kontext | Jméno |
|---|---|
| AI prompty (Vertex/Gemini) | **Gideon** |
| UI texty v Rašeliništi | **Gideon** (nebo bez jména) |
| Komentáře v kódu | OK obě varianty |
| Mail klientům (booking confirmation, cancellation) | **Petr** (klient handle nezná) |
| Onboarding PDF pro hosty Studny | **Petr** |
| Letter senders / dopisy | **Petr Perina** (právní jméno) |
| Booking footer „Těším se, X" | **Petr** |

## Risk management — co dělat opatrně

**Nikdy bez explicitního souhlasu Gideona:**
- `git push --force` (zvlášť na main)
- `rm -rf` (cokoliv)
- Drop DB, drop tabulky
- Mazání migrací (`prisma/migrations/<timestamp>/`)
- `git rebase -i` nebo `git reset --hard`
- Skip hooks (`--no-verify`)
- `git add -A` v root pokud vidíš `.env` nebo credentials soubory v untracked

**Před commitem se ujisti:**
- `npx tsc --noEmit` — známé pre-existující errors v env Proxy / mailer / cron jsou OK ignorovat (nesouvisí s aktuálním kódem)
- `npx astro build` — musí projít s 0 errors

## Mobilní UX testing

Gideon používá iPhone hodně. Po každé větší layoutové změně:
- Zvaž responsivitu
- Sidebar je off-canvas pod `lg` breakpoint
- Recordery testuj v PWA fullscreen módu
- Tap targets ≥ 44 px (Apple guidelines)

## Bezpečnost — neřezat

- **argon2id** OWASP 2024 parametry
- **Konstantní čas** v auth (dummy hash pro neexistujícího usera)
- **Rate limit** všude kde je public endpoint nebo pošle mail
- **Session validace VŽDY přes DB** (middleware je jen optimistic check)
- **JWT cookie** httpOnly + sameSite=lax + secure v produkci
- **Path-traversal** blokovaný v `lib/uploads.ts`
- **HMAC-SHA256** pro magic-link tokeny (booking)
- **Ownership check** v každém PATCH/DELETE endpointu

## Design preferences (z paměti)

- **Dark only** — light netřeba
- **Tmavě modré pozadí** (Petr odmítl warm/béžové)
- **Pastely** jako akcenty (peach/mint/lavender/sky/sage/butter/rose/pink) — **ne křiklavé/neonové**
- **Vysoký kontrast** (foreground 98 %, muted 78 %, min 70 %) — Gideon „špatně vidí"
- **Každý modul = jeden tint** (konzistence napříč sidebar/KPI/badge)
- **Glass utility** (`.glass`, `.glass-strong`, `.glass-subtle`) — backdrop-blur + bílý tint
- **Nadpisy bezpatkové (sans default)** — Geist sans pro h1/h2/h3, serif `font-serif` jen kde explicit (hero karty)
- **4 dřívější design pokusy zamítnuty** (PaperCSS, DaisyUI warm, DaisyUI dark+rough.js) — neopakovat. Před další iterací zeptej se Gideona co konkrétně vadí.

## Workflow Gideona

1. **Plánování:** Gideon má brief, řekne co chce
2. **Implementace:** Claude Code píše kód
3. **Commit + push:** Claude commituje (NIKDY pushuje sám), Gideon pushuje přes GitHub Desktop
4. **Deploy:** Gideon na NASu spustí `~/deploy.sh` (jeden příkaz)
5. **Test:** Gideon ověří v prohlížeči / mobilu

**Nikdy nepushuj kód za Gideona** ani „proaktivně". Vždy commit a počkej. Push je jeho akce.

## Zápisy do memory

Pokud se objeví něco důležitého (nový pattern, vyřešený TODO, design rozhodnutí), napiš do projektové memory:

```
/Users/petrperina/.claude/projects/-Users-petrperina-CLOUDS-CLOUDE-PROJECTS-raseliniste/memory/
```

Vytvoř `todo_<jmeno>.md` nebo `note_<jmeno>.md` a přidej řádek do `MEMORY.md` indexu.

## Pravidlo „nikdy nemení promp bez kontroly"

AI prompty v `src/lib/ai-prompts.ts` `DEFAULT_PROMPTS` jsou citlivé — mění chování celého modulu. Pokud Gideon nezmínil že chce změnu promptu, **nesahej** na ně. Naopak pokud je explicit zadání, jdi do toho.

Editace promptů je dostupná Gideonovi v UI `/settings/ai-prompts` — pokud chce experimentovat, udělá to sám tam.

## Co Gideon ocení

- Jasný plán **před** implementací (3-4 řádky shrnutí + co bude potřeba od něj)
- **Diagnostické endpointy** (`/api/diagnose/studna` typ věcí) — místo SSH na NAS
- **Návody v PDF** (`Návody/`) — Gideon je čte
- **Memory soubory** — ať si nemusí pamatovat detail, najde to v souboru
- **Před riskem se ptáš** — ne „udělala jsem to", ale „chceš abych to udělala?"
- **Krátké commit messages s vysvětlením proč**
