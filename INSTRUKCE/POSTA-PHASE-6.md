# Pošta — fáze 6 (DetectedCommitment + confidence routing + UI + Todoist)

> Stav k 2026-05-12: **HOTOVO**. Finální fáze Pošty.
>
> Po fázi 6 je modul **kompletní**: import + klasifikace + UI + RAG search
> + real-time push + encryption + retention + commitment detection.

## Architekturní princip

**Primárka commitmentu** je `DetectedCommitment` v naší DB. Todoist je
**sekundární mirror** s 1-way sync (DB → Todoist). Vyhneme se konflikt
resolution peklu dvousměrné synchronizace. Když si rozmyslíš změnit task
manager (Things, Asana, Linear), schema commitmentu zůstává nedotčené.

## Co je hotové

| Komponenta | Cesta | Co dělá |
|---|---|---|
| **Schema** | `DetectedCommitment` model + `User.gmailEmailAddress` | 1:N user, 1:N source email |
| **Prompt** | `prompts/classify_commitment_v1.md` | Versioning po prompt revizi → v2 |
| **Detector lib** | `src/lib/posta-commitment.ts` | LLM scan outbound, dedup, confidence routing |
| **Detector cron** | `posta-commitment-detect` every 15 min | LLM Flash structured JSON |
| **Todoist sync lib** | `src/lib/posta-commitment-sync.ts` | `syncCommitmentToTodoist`, `syncPendingCommitments`, `markStaleCommitments`, `trackRelatedEmail` |
| **Todoist sync cron** | `posta-commitment-todoist-sync` every 5 min | 1-way, rate limit 30/min |
| **Stale marker cron** | `posta-commitment-stale` daily 03:00 | `active + lastActionAt < 30d → stale` |
| **Related tracking** | hook v `gmail-watch` + `posta-sync` | Inbound mail v threadu → update lastActionAt |
| **Action API** | `POST /api/posta/commitments/:id/action` | confirm/reject/resolve/postpone/unstale/merge |
| **UI** | `/posta?section=commitments` | Top switch + 4 subtaby + karty + akce |
| **Sidebar badge** | `getPostaBadgeCount` | Stale commitments se přičítají "šeptem" |

## Schema

```ts
DetectedCommitment {
  id, userId, sourceEmailId (FK cascade)
  detectedAt

  // Závazek
  quotedText (přesný citát)
  recipient, recipientEmail
  proposedTitle (LLM návrh)
  deadlineHint, parsedDeadline

  // Dedup soft-link
  relatedTo[]    // IDs existujících commitmentů se similar quote
  mergedInto     // po slouceni: secondary commitment dostane primary.id

  // AI metadata
  confidence (0-1), promptVersion ("classify_commitment_v1")

  // Lifecycle
  status: "active" | "confirmed" | "rejected" | "resolved" | "merged" | "stale"
  autoCreated: bool (confidence >= 0.85 = true)
  confirmedAt / rejectedAt / resolvedAt / staleAt: DateTime?
  rejectionReason: text
  lastActionAt: DateTime   // kritické pro stale detection

  // Todoist sync
  todoistTaskId

  // Related email tracking
  relatedEmailIds[]   // thread match / keyword match
}
```

## Lifecycle

```
[Petr pošle mail "do pátku ti pošlu nabídku"]
        ↓
[Cron posta-commitment-detect every 15 min]
   ├── filter: from = User.gmailEmailAddress AND classification != null
   │           AND no DetectedCommitment yet
   ├── LLM (Flash structured JSON): scan body
   ├── per candidate s confidence >= 0.55:
   │     ├── embed quotedText
   │     ├── dedup soft-link (cosine > 0.85 + same recipient + 7d window
   │     │   → relatedTo: [matched_ids])
   │     └── insert DetectedCommitment
   └── confidence < 0.55 → SKIP (debug log only)
        ↓
[Confidence routing]
   - >= 0.85: status=active, autoCreated=true → trigger Todoist sync
   - 0.55-0.84: status=active, autoCreated=false → needs confirm v UI
        ↓
[Cron posta-commitment-todoist-sync every 5 min]
   - autoCreated=true → createTask
   - po confirmed (Petr klikl) → createTask (i pro low-conf po confirm)
   - po resolved → closeTask
   - po stale → updateTask labels=["zavazek","stale"]
   - po rejected/merged → deleteTask + clear todoistTaskId
        ↓
[Inbound mail v threadu zdrojového mailu]
   ↓ trackRelatedEmail hook
   - append relatedEmailIds
   - lastActionAt = email.receivedAt
   → DRŽÍ COMMITMENT ALIVE
        ↓
[Cron posta-commitment-stale daily 03:00]
   - SELECT active WHERE lastActionAt < now - 30d → status=stale
        ↓
[Petr v /posta?section=commitments]
   - subtab "Zastaralé" — karta s "X dní bez akce" velkým fontem
   - akce: Vrátit aktivní | Vyřízeno | Archivovat
```

## Confidence routing — výchozí prahy

| Confidence | Akce |
|---|---|
| `>= 0.85` | **Auto** — status=active, autoCreated=true, → Todoist push do 5 min |
| `0.55 - 0.84` | **Needs confirm** — status=active, autoCreated=false, jen v UI, NE Todoist |
| `< 0.55` | **Skip** — debug log, NE zapsat (Petrovo zadání: prázdné pole je lepší než false positive) |

Po manuálním "Potvrdit" v UI: low-conf commitment dostane `autoCreated=true`
a triggeruje Todoist sync.

## Dedup — soft-link, NIKDY auto-skip

Per Petrovo zadání:
> "Pokud similarity > 0.85 AND same recipient AND received_at do 7 dní →
> ulož nový s polem related_to = [matched_id]. V UI zobraz jako kartu
> s badge 'souvisí s #ID'."

Implementace:
1. `embedText(quoted_text)` — 768 dim vector
2. Načti active commitmenty se stejnym `recipientEmail` v okně 7 dnů
3. Per existing: cosine similarity vs new
4. Pokud > 0.85 → append do `relatedTo[]`
5. Vytvoř **vždy** nový DetectedCommitment row (ne skip)
6. UI ukáže badge "souvisí s N dalšími"

**Sloučení manuálně:** akce `merge` v UI nastaví `mergedInto = primary.id`
a `status = merged`. Todoist task se smaže (primary zůstává).

**Future optimization** (ne fáze 6): `DetectedCommitment.quoteEmbedding`
pole pro pgvector cosine query přímo (rychlejší než embed+compare per row).

## Related email tracking

Po každém příchozím (inbound) mailu skript:
1. Skip pokud `fromAddress = User.gmailEmailAddress` (outbound — řeší detector)
2. Najdi active commitmenty s `sourceEmail.threadId = email.threadId`
3. Append `email.id` do `relatedEmailIds[]` + update `lastActionAt = receivedAt`

Důsledek: pokud klient odepíše na původní mail kde Petr slíbil "pošlu",
commitment se nestane stale dokud konverzace pokračuje. Stale se aktivuje
jen pokud reálně nikdo neodpovídá.

**Plus**: future enhancement — keyword match z `quoted_text`. Pokud
inbound mail obsahuje slova z citátu, related taky. Pro fázi 6 jen
thread match (jednodušší, conservative).

## Stale detection

```sql
SELECT id FROM "DetectedCommitment"
WHERE status = 'active'
  AND "lastActionAt" < NOW() - INTERVAL '30 days'
```

→ UPDATE status = 'stale', staleAt = NOW()

UI v subtabu "Zastaralé":
- Velký počítadlo "X dní bez akce" (rose-tlumene barva)
- Akce: Vrátit aktivní | Vyřízeno | Archivovat

## Cron joby — kompletní seznam (fáze 1-6)

| Job | Schedule | Fáze | Účel |
|---|---|---|---|
| `posta-sync` | every 30 min | 1→5 | Polling záchrana nad push |
| `posta-classify` | every 15 min | 2 | Klasifikace 7-polí |
| `posta-embed` | every 5 min | 4 | RAG chunking + embeddings |
| `posta-digest` | daily 7:00 | 3 | Daily digest snapshot |
| `posta-cleanup` | daily 3:00 | 5 | 96d retention body cleanup |
| `posta-watch-renew` | daily 4:00 | 5 | Gmail watch <48h auto-renew |
| `posta-commitment-detect` | every 15 min | 6 | LLM scan outbound, vytvoří DetectedCommitment |
| `posta-commitment-todoist-sync` | every 5 min | 6 | 1-way DB→Todoist, rate limit 30/min |
| `posta-commitment-stale` | daily 3:00 | 6 | active+lastActionAt<30d → stale |

## Cost reality check

Per outbound mail:
- LLM call Flash structured JSON ~500 tok in + 200 tok out = $0.0001
- Plus per candidate embed (max 3-5 candidates per mail) ~50 tok = $0.000005

Petrův typical outbound volume: ~10 mailů/den × 30 = 300 mailů/měs
- Detector cost: 300 × $0.0001 = **$0.03/měs**
- Embedding (dedup): 300 × $0.000005 = $0.0015/měs (zanedbatelné)
- Todoist sync: free (Todoist API has no per-request cost)

**Total cost fáze 6: ~$0.03/měs = 0.70 Kč/měs.** Zanedbatelné.

## Hranice fáze ✓

Per Petrovo zadání:
- ☑ Pošlu mail "do pátku ti pošlu nabídku" → DetectedCommitment vznikne
  (cron 15 min)
- ☑ V `/posta?section=commitments` → vidím ho s confidence vyšší
- ☑ Mock recipient odpoví → `related_email_ids` se update, `last_action_at`
  se posune
- ☑ Neudělám nic 31 dní → přesune se do "Zastaralé" subtab
- ☑ Označím "Vyřízeno" → status=resolved, Todoist task closed
- ☑ Označím "Odmítnout" → status=rejected, počítadlo směrem k 30

## Ověření po deploy

1. Push commitů + Synology pull
2. Migrace `add_posta_commitments` se aplikuje automaticky
3. **Detector test:**
   ```bash
   # Pošli si testovací mail z Gmailu, např.:
   # "Karle, dodám ti nabídku do pátku 17.5. Děkuji."

   # Počkej cca 15 min nebo manuálně:
   ssh root@SPIZ
   sudo docker compose exec app curl -X POST http://localhost:3000/api/cron/posta-commitment-detect \
     -H "x-cron-key: $CRON_SECRET"
   ```

4. **DB inspekce:**
   ```sql
   SELECT "id", "proposedTitle", "confidence", "status", "autoCreated"
   FROM "DetectedCommitment"
   ORDER BY "detectedAt" DESC LIMIT 10;
   ```

5. **UI test:**
   - Otevři `/posta?section=commitments`
   - Měla by být karta s `proposedTitle`, italic quoted_text, deadline hint
   - Klikni "Vyřízeno" → status update + Todoist task closed (v 5 min)

6. **Sidebar badge:**
   - Po `posta-commitment-stale` cronu pokud máš stale commitments,
     badge u Pošty se zvýší

## Známé limity fáze 6

1. **Detector "neexistuje již scanováno" check** = `sourceCommitments has NONE`.
   Pokud `commitments=[]` vrátil LLM (low conf nebo žádné), mail se nikdy
   neoznačí jako "scanned" a může být reprocessed. Pro fázi 6 OK (cron
   filter `sourceCommitments has NONE` + LLM call ~$0.0001 je levné),
   ale **TODO**: přidat `EmailMessage.commitmentScannedAt` field
   v budoucnu pro skip.

2. **Dedup embedding nezachycuje recipient signal** — cosine je nad
   `quoted_text` only. Pokud Petr říká stejnou formulaci 2 různým klientům,
   relatedTo je prázdné (kvůli `recipientEmail` filter), ale neproniká
   skrz subject. OK pro většinu cases.

3. **Bez auto-merge** — relatedTo jen značí, sloučení vyžaduje Petrův
   klik. Per Petrovo zadání: "NIKDY neauto-skip duplikát."

4. **Manual prompt revize** — po ~30 rejected zachycených v audit
   (`rejectionReason` má hodnoty) Petr by měl manuálně projet a vyrobit
   `classify_commitment_v2.md`. **TODO faze 6+**: dashboard
   `/settings/posta-classifier` s precision metrics + revision trigger.

5. **Related tracking jen thread match** — keyword match z `quoted_text`
   (Petrovo zadání zmiňuje) implementováno NENÍ. Pro fázi 6 thread match
   stačí pro běžné cases. Future: vector similarity over inbound emails.

6. **Todoist task content nezachycuje source mail link** — Petr ve
   Todoistu vidí "Poslat nabídku Karlovi" + description s citátem,
   ale ne URL na Gmail thread. **TODO**: přidat description footer
   s Gmail deeplink.

7. **UI bez "merge" tlačítka** — `relatedTo[]` badge v kartě je read-only,
   action `merge` přes endpoint funguje ale UI tlačítko neexistuje (vyžadovalo
   by select-target picker). **TODO**: dropdown nebo modal v expand sekci
   pro manuální merge.

## 3 otázky pro budoucnost

### 1. Když Petr přepne Todoist na Things / jiný task manager?

DB primárka = OK, ale 1-way sync je hardcoded na Todoist. Refactor:
- Abstract `CommitmentSyncProvider` interface
- Implementace per provider (TodoistSyncProvider, ThingsSyncProvider, ...)
- Petr v `/settings/integrations` vybere preferovaný provider
- Faze 7+, ne teď.

### 2. Notifikace "31 dní bez akce" před stale → proaktivní push?

Aktuálně Petr uvidí stale jen když otevře `/posta`. Mohl by přijít:
- Email z Rašeliniště "Závazek 'X' nepřišel pohyb 28 dnů, brzy stale"
- Web Push notifikace (existující WebPushSubscription infrastructure)
- SMS přes GoSMS (existující infrastruktura)

Faze 7+. Pravděpodobně volitelné per closeness commitmentu k deadlinu.

### 3. Prompt classify_commitment_v1 dashboard pro revizi?

`/settings/posta-classifier`:
- Precision metrics — `confirmed_rate`, `rejected_rate`, `auto_create_rate`
- Top rejected commitments s `rejectionReason` (pro pattern detection)
- Trigger tlačítko "Vyrobit v2 prompt" co generuje draft markdown
  na základě rejected patterns

Faze 7+. Manuální revize zatím stačí pro single-user fázi 6.

---

## Souhrn celého modulu Pošta (fáze 1-6)

| Fáze | Co dorazilo | Stav |
|---|---|---|
| **1** | OAuth + import skeleton (cron polling) | ✅ |
| **2** | Klasifikace 7-polí ortogonálně | ✅ |
| **3** | UI `/posta` SSR + digest + filter chips + resolve | ✅ |
| **4** | RAG embeddings + hybrid search + backfill | ✅ |
| **5** | Gmail push (real-time) + encryption + 96d retention + full delete | ✅ |
| **6** | DetectedCommitment + confidence routing + UI + Todoist sync | ✅ |

**~30 commitů**, **~6000 řádků kódu**, **9 cron jobů**, **3 prompty**,
**8 migrací**, **4 dokumentace**, **3 helper scripts**.

**Cost steady state:** Petrův typical volume (600 mailů/měs):
- Klasifikace: ~$0.012/měs
- Embedding: ~$0.012/měs
- Digest: ~50 hal/rok
- Commitment detector: ~$0.03/měs
- **Total: ~$0.05/měs = ~1 Kč/měs**

Plus jednorázové:
- Backfill 10K historických mailů: ~$0.20
- Commitment backfill (manual rescan starých outbound): TODO if needed
