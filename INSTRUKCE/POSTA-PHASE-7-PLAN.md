# Pošta — Fáze 7: Mobile inbox + AI reply (návrh)

Petr 2026-05-27 bod #20 z dashboard feedback listu: chce na dashboardu
správu emailů s AI návrhem odpovědi a možností označit mail k vyřízení.

Aktuálně máme **fáze 1-6 hotové** (klasifikace, retention, RAG, commitment
detector — viz `INSTRUKCE/POSTA-PHASE-6.md`). Co chybí pro Petrův use case
je **inbox UI** s actions.

---

## Cíl

Petr otevře mobil → otevře tile **Pošta** → vidí list urgentních mailů →
klikne mail → vidí AI návrh odpovědi → upraví → odešle. Vše bez Macu.

---

## UI návrh

### A) `/posta` — list (mobile-first)

```
┌───────────────────────────────────────┐
│ ← Start         Pošta                  │
├───────────────────────────────────────┤
│  TABS  Akce  Čeká  Info  Šum          │
├───────────────────────────────────────┤
│  🔴 Faktura splatná do pátku           │
│  od Jan Novák · před 2 h                │
│  → odpovědět dnes do 18h                │
│  [Odpovědět] [Archivovat] [Hotovo]     │
├───────────────────────────────────────┤
│  🟡 RE: Schůzka — Karel                │
│  od karel@... · před 5 h                │
│  → potvrdit termín středa 14:00         │
│  [Odpovědět] [Archivovat] [Hotovo]     │
├───────────────────────────────────────┤
│  ...                                    │
└───────────────────────────────────────┘
```

Tabs: action_required / waiting_external / informational / noise.
Default Akce (action_required).

### B) `/posta/<id>` — detail s AI reply

```
┌───────────────────────────────────────┐
│ ← Pošta        Faktura splatná         │
├───────────────────────────────────────┤
│  od Jan Novák <jan@firma.cz>           │
│  pondělí 27.5. 09:14                    │
│                                         │
│  Dobrý den Petře,                       │
│  posílám fakturu č. 2026-042 ...       │
│  ... [plný text]                        │
│                                         │
├───────────────────────────────────────┤
│  🤖 AI návrh odpovědi (Tvým stylem)    │
│  ┌─────────────────────────────────┐   │
│  │ Jano,                            │   │
│  │ díky za fakturu — projdu během   │   │
│  │ středy a dám ti vědět. Petr      │   │
│  └─────────────────────────────────┘   │
│  [Upravit] [Odeslat] [Přegenerovat]   │
├───────────────────────────────────────┤
│  Akce:                                  │
│  ☐ Archivovat po odeslání               │
│  ☐ Vytvořit úkol (do když odpovědět)    │
│  ☐ Označit jako hotové (bez odpovědi)   │
└───────────────────────────────────────┘
```

### C) Tile na `/start`

Přidat tile „Pošta" mezi Mise a Notifikace, s badge `count(action_required
+ unread za 7d)`. Nebo využít existující Notifikace tile (jen rozšířit).

---

## API endpointy potřebné

| Endpoint | Co dělá |
|---|---|
| `GET /api/posta?actionType=action_required&page=1` | List mailů s filtrem |
| `GET /api/posta/<id>` | Detail email + classification |
| `POST /api/posta/<id>/generate-reply` | AI generate odpověď (Gemini Pro) |
| `POST /api/posta/<id>/send-reply` | Odeslat odpověď přes Gmail API + archivovat |
| `POST /api/posta/<id>/archive` | Gmail label „IRŠ-Archiv" |
| `POST /api/posta/<id>/mark-done` | Vlastní DB flag (done=true) |
| `POST /api/posta/<id>/create-task` | Vytvořit Task s odkazem na mail |

---

## AI návrh odpovědi — Petrův styl

Klíčové: AI musí psát **Petrovým způsobem**, ne generickým „Dobrý den, …".

Strategie (Petr 2026-05-27 #24):

1. **Sběr datasetu**: 50-100 odeslaných mailů z Gmail Sent. Volitelné
   filtrování přes Gmail API `q=in:sent newer_than:30d`.
2. **System prompt** s ukázkami (few-shot):
   ```
   Jsi Petr Peřina. Píšeš e-maily takhle:
   
   <example 1>
   Klientovi: Jano, díky za projekt — koukni na tu nabídku, ozvu se ti
   v pátek. Petr
   </example 1>
   
   <example 2>
   Týmu: Gáťo, hod to na úterý 14:00, pak to projedeme. P.
   </example 2>
   
   ...
   ```
3. **Per-recipient adaptace**:
   - VIP / člen rodiny → neformální, krátké, hodně zkratek
   - Klient → poloformální, profesní podpis
   - Cizí → formální, „Dobrý den"
4. **Context-aware**: AI dostane plný text mailu na který reaguje +
   classification (urgency, suggested_action) + případně Petrovo
   historické vlákno s tím odesílatelem.

---

## Implementační milníky

1. **MVP — list + tabs + done flag** (2h)
   - `/posta` stránka + EmailFeed komponenta
   - Tab filter podle actionType
   - Tlačítko „Hotovo" (jen DB done=true, neodesílá nic)

2. **AI návrh odpovědi (raw)** (2h)
   - Generic prompt „odpověz na tento email v Petrově stylu"
   - Bez datasetu — zatím neutrální profesní jazyk
   - `POST /api/posta/<id>/generate-reply` + UI textarea

3. **Send přes Gmail API** (1-2h)
   - Vyžaduje Gmail scope `gmail.send` (už máme od 2026-05-13)
   - Reply uchovává In-Reply-To + References headers pro thread match

4. **Petrův styl tuning** (2-3h)
   - Sběr 50 mailů z Sent
   - Few-shot prompt v `ai-prompts.ts`
   - A/B test: AI návrh vs Petrova reálná odpověď

---

## Závislosti

- Gmail OAuth scope `gmail.modify + gmail.send` — máme (2026-05-13)
- Gemini Pro model — máme
- EmailMessage + EmailClassification schema — máme
- Posta cron jobs (sync, classify, …) — máme

**Žádné nové migrace.** Případně přidat `EmailMessage.done Boolean
@default(false)` (1 řádek).

---

## Termín

Není urgentní. Petr má v `/notifikace` urgentní emaily viditelné, plus
Gmail iOS app pro reply. Tahle fáze 7 je „nice to have" co umožní reply
bez Macu, ale ne kritická.

Doporučuju: až bude tichý týden bez dalších rozšiřování modulů, ten
weekend si na to sednout celistvě (4-6h fokus). Pak Petr přejde z Gmail
app na vlastní mobile pošta UI a nemusí psát reply ručně z hlavy.
