# HANDOFF 2026-05-27 — Dashboard feedback (26 bodů)

Petr poslal 26-bodový feedback list pro úpravy mobilního dashboardu a
souvisejících modulů. Tento handoff dokumentuje co bylo uděláno v té
samé session (cca 30 commitů `97a3c3c` → `765f921`).

Předchozí handoff: `HANDOFF-2026-05-27.md` (booking/contacts/audio/AI
big day, ~26 commitů `dbebe81` → `2931dc1`).

---

## Přehled bodů

| # | Bod | Stav | Commit / referenc |
|---|---|---|---|
| 1 | Vkládání věcí do auta | ✅ doc + hint | `97a3c3c` |
| 2 | Pole „oblast" v Při cestě | ✅ doc | `97a3c3c` |
| 3 | Mazání v Google → Rašeliniště | ✅ tlačítko Sync + hide event | `3c2c1f3` `b930354` `f986223` |
| 4 | Briefing přejmenovat | ✅ „Večerní" | `1bc9051` |
| 5 | 2 nadcházející události na /start | ✅ karta nad dlaždicemi | `e884916` |
| 6 | Ikonky menší, 3 do řádku | ✅ grid-cols-3 | `baa4064` |
| 7 | Notifikace tile | ✅ /notifikace + agregace | `3ee403f` |
| 8 | Sloučit Úkoly+Deník → Ozvěna | ✅ jeden tile | `baa4064` |
| 9 | Lepší zpět z Ozvěny | ✅ pill button | `77b7da0` |
| 10 | Sloučit Studánka+Prskavka | ✅ jeden tile „Záznamy" | `baa4064` |
| 11 | Odstranit Týden tile | ✅ | `baa4064` |
| 12 | Měsíc v misi pohledu | ✅ odstraněn | `a4cd092` |
| 13 | Finalizovat Google sync | ✅ sweep guard tolerantní | `b930354` |
| 14 | Větší ikony v hlavičce Mise | ✅ size-5 + 44px buttons | `3c2c1f3` |
| 15 | Překlad „errands" | ✅ „pochůzky" | `97a3c3c` |
| 16 | Mobile přiřazování úkolů | ✅ EditInline mobile-friendly | `765f921` |
| 17 | Plná editace úkolů na mobilu | ✅ ditto | `765f921` |
| 18 | Otestovat deník přepis | ✅ doc (už funguje) | `b0b9331` |
| 19 | Auto-tagy v deníku | ✅ doc (už funguje) | `b0b9331` |
| 20 | Sekce maily na dashboardu | ✅ MVP přes /notifikace + plán fáze 7 | `3ee403f` `7cdff70` |
| 21 | VIP „kdy vyrazit" | ✅ doc (Apple/Google native) | textová odpověď |
| 22 | Mobile rezervace view | ✅ karty pozvánek mobile-friendly | `b1e308a` |
| 23 | Logika navrhovaných časů | ✅ doc | textová odpověď |
| 24 | AI Petrovým jazykem | ✅ plán v POSTA-PHASE-7 | `7cdff70` |
| 25 | Komplet revize todo workflow | ✅ UKOLY-WORKFLOW.md | `641c7b2` |
| 26 | Obsidian z iCloud | ✅ doc (3 možnosti) | textová odpověď |

**Hotových: 26/26** ✅

---

## Nové soubory

- `INSTRUKCE/UKOLY-WORKFLOW.md` (300+ řádků) — kompletní průvodce úkolovým
  systémem podle bodu #25
- `INSTRUKCE/POSTA-PHASE-7-PLAN.md` (170 řádků) — návrh mobile inbox + AI
  reply (body #20 + #24, plán pro budoucí session)
- `src/pages/notifikace.astro` — agregace urgentních notifikací (#7)
- `src/lib/notifications.ts` — helper pro loading + count
- `src/pages/api/calendar/events/[id]/hide.ts` — local hide event (#3)

---

## Modifikované soubory

- `src/components/DayView.tsx` — sync button, briefing tab, hide button,
  ikony zvětšené, Měsíc odstraněn
- `src/components/UkolyList.tsx` — mobile EditInline + ?team=1 contacts
- `src/components/DenikList.tsx` — direct file upload (#mobile fix
  z předchozí session, ale relevantní)
- `src/components/InviteCreator.tsx` — mobile-friendly cards
- `src/pages/start.astro` — Notifikace tile, „Dnes nadchází" karta,
  3-col grid, sloučené tiles, smazaný Týden
- `src/pages/ozvena.astro` — pill „← Start" button
- `src/pages/day/[date].astro` — fetch zítřejšího briefingu
- `src/lib/google-calendar.ts` — sweep guard tolerantní
- `src/lib/cron-schedule.ts` — briefing description přejmenování
- `src/lib/navody.ts` — booking, ukoly, denik, kontakty-firewall navody update

---

## Klíčové učení z této session

1. **Rychlé wins** (překlady, UI labely) jsou nejvíc oceněné — Petr o
   features pamatuje jen pokud je vidí v UI. Hidden config = neexistuje.

2. **Existující features Petr nezná** — auto-tagy v deníku, raw transcript,
   filter chips. Update navody je důležitý jak nový kód.

3. **3-sloupcový grid funguje pro 5-7 tilů**. Více než 7 = scroll, méně
   než 4 = prázdné místo.

4. **Empty state je důležitý** — /notifikace ukazuje sage check „Nic
   nového. Klid." místo prázdné stránky.

5. **Tolerance v sync guardech** — strict `errors === 0` znamená že jedna
   chyba blokuje funkčnost. Bound percentage je robustnější (10 %).

6. **Mobile != desktop** — mobile Safari je nejvíc restrictive (anti-popup
   pro programmatic click), iOS je nejpřísnější pro touch targets (44px
   minimum). Default pro vše mobile-first, sm: pro desktop overrides.

---

## TODO pro budoucí sessions

1. **POSTA fáze 7** — Mobile inbox + AI reply (~4-6h, plán v POSTA-PHASE-7-PLAN.md)
2. **VIP „kdy vyrazit" nad Google native** — pokud Apple Calendar default
   nestačí, doplnit `reminders.overrides` v `createGoogleEvent`. ~30 min.
3. **Studánka↔Prskavka switch** v /studna/nahravka stránce (bod #10
   technicky uzavřen sloučením tile, ale switch v UI cílové stránky
   zatím není — Petr klikne tile a dostane defaultně Studánku)
4. **DKIM v DNS pro SMTP2GO** (převzato z předchozí session) — kritické
   pro deliverability M365 příjemců
5. **Pošta classify 49/50 errors** — aplikovat tolerantParseTasks ekvivalent
   na classify endpoint (převzato z předchozí session)

---

## Stav repu

- Branch: `claude/busy-kowalevski-490e34` (worktree)
- Main repo: fast-forward merged všechny dnešní commity
- Petr pushne přes GitHub Desktop — měl by vidět ~30 commitů od `97a3c3c`
- Deploy: po pushi DSM Pull image + Recreate container

---

**Petr's final ask z této session: „pokracuj" a „udelame postupne vse" =
všechno z 26-bodového seznamu hotové buď kódově, nebo doc-route s plánem
pro budoucí session.**
