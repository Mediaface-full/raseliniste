# Pošta — fáze 2 (klasifikátor)

> Stav k 2026-05-12: **HOTOVO**. Fáze 3 (UI `/posta` modul) čeká.

Email Intelligence — ortogonální klasifikace mailů dle
`POSTA-DESIGN-DECISIONS.md`. Tato fáze: 7-polní klasifikace přes
Gemini Flash + structured JSON output + post-processing escalation DB
override + cron + manuální endpoint + UI dashboard.

## Co je hotové

| Komponenta | Kde | Co dělá |
|---|---|---|
| Schema `EmailClassification` | migrace `add_posta_classification` | 1:1 vs `EmailMessage`, 7-polní ortogonální schema |
| `EmailMessage.hasOutboundCommitmentCandidates` | tatáž migrace | Placeholder pro fázi 6 (default false, populace přijde s `DetectedCommitment`) |
| Prompt spec | `prompts/classify_v1.md` | Versionovaný markdown, schema + edge cases + příklady |
| Klasifikační lib | `src/lib/posta-classify.ts` | `classifyEmail`, `classifyBatch`, `classifyPendingForUser` |
| Cron | `posta-classify` à 15 min | Po každém sync iteraci klasifikuje unclassified maily (max 50) |
| Manuální endpoint | `POST /api/integrations/google/posta-classify` | Default pending batch, s `{emailIds}` reklasifikace konkrétních |
| UI | `PostaIntegration.tsx` | Grid 3-col stats + tlačítka Sync/Klasifikovat |

## Architektura

```
[Petr klikne "Klasifikovat nové"]
  ↓
[POST /api/integrations/google/posta-classify]
  ↓ session auth
  ↓
[classifyPendingForUser(userId, limit=50)] ── src/lib/posta-classify.ts
  ↓
  ├── SELECT FROM EmailMessage WHERE userId=X AND classification IS NULL LIMIT 50
  │   ORDER BY receivedAt DESC
  ↓
  ├── classifyBatch — paralelně 5 concurrent, 200ms pauza mezi dávkami
  │
  │   pro každý mail:
  │     ├── buildClassifyPrompt(...) — From/To/Subject/Body trunc 4000 znaků
  │     ├── Gemini Flash generateContent(prompt, schema, system_instruction)
  │     │     responseMimeType: application/json
  │     │     responseSchema: { actionType enum, contentType enum, ... }
  │     │     temperature: 0.2
  │     │     maxOutputTokens: 800
  │     ├── parseAndValidate(text) — enum check, type assertion
  │     ├── checkEscalationByDb(userId, fromAddress, receivedAt)
  │     │     → COUNT(*) FROM EmailMessage WHERE fromAddress=X AND
  │     │       receivedAt IN [-7d, receivedAt] >= 2 → override true
  │     └── upsert EmailClassification (1:1)
  │
  └── UPDATE User SET ... (nothing — sync state je v posta-sync)

[Cron každých 15 min]
  ↓ /api/cron/posta-classify (x-cron-key auth)
  ↓ stejný classifyPendingForUser, default limit
```

## Schema

```ts
EmailClassification {
  id String @id
  messageId String @unique  // 1:1 vs EmailMessage
  message EmailMessage @relation(...)

  // ORTOGONÁLNÍ 7-polí
  actionType   String   // action_required | waiting_external | informational | noise
  contentType  String   // klient | osobni | admin | newsletter | reklama | systemovy | bezpecnostni | spam
  urgency      String   // low | medium | high
  escalation   Boolean
  suggestedAction String?
  projectHint  String?
  reason       String   @db.Text

  // Audit
  model           String  // "gemini-2.5-flash+classify_v1"
  confidence      Float?  // LLM self-report 0-1
  classifiedAt    DateTime
  escalationDbOverride Boolean  // true pokud post-processing override z DB
}
```

## Použití klasifikace v dotazech

Stejně jako v `POSTA-DESIGN-DECISIONS.md`:

```sql
-- Digest "dnes vyřídit"
SELECT em.* FROM "EmailMessage" em
JOIN "EmailClassification" ec ON ec."messageId" = em.id
WHERE em."userId" = '...'
  AND ec."actionType" = 'action_required'
ORDER BY ec.urgency DESC, em."receivedAt" DESC;

-- Eskalace
SELECT em.* FROM "EmailMessage" em
JOIN "EmailClassification" ec ON ec."messageId" = em.id
WHERE em."userId" = '...'
  AND (ec.escalation = true OR ec.urgency = 'high');

-- Archivace newsletterů (kandidáti pro batch delete)
SELECT em.* FROM "EmailMessage" em
JOIN "EmailClassification" ec ON ec."messageId" = em.id
WHERE em."userId" = '...'
  AND ec."contentType" = 'newsletter'
  AND ec."actionType" = 'noise';
```

## Cost reality check

Per mail ~ **1500 input tokens + 200 output tokens** (Gemini Flash):
- Vstup: From/To/Subject (~150 tok) + body trunc 4000 znaků (~1200 tok) + system prompt (~150 tok)
- Výstup: JSON klasifikace (~150-200 tok)

Cena (Gemini 2.5 Flash, k 2026-05):
- Input: $0.075 / 1M tokens
- Output: $0.30 / 1M tokens

Per mail = (1500 × 0.075 + 200 × 0.30) / 1_000_000 = **~0.00018 USD ≈ 4 hal**

Pro 10 000 mailů jednorázový initial pass = **~1.80 USD**. Pro průměrných
20 mailů/den pravidelně = 0.0036 USD/den = **1.30 USD/rok**. Náklady
zanedbatelné.

## Versionování promptu

Pokud upravíme prompt:
1. `cp prompts/classify_v1.md prompts/classify_v2.md`
2. Edit `v2`
3. V `posta-classify.ts` změň `const PROMPT_VERSION = "classify_v2";`
4. Audit: nové maily se klasifikují s `model = "gemini-2.5-flash+classify_v2"`,
   stará klasifikace v DB zůstane s `v1` pro replay/srovnání

## Ověření

### V UI
`/settings/integrations/google` → karta **Pošta** → grid:
- Klasifikované: `N / M` (z M importovaných)
- Klik **Klasifikovat nové** → zelená karta s `classified/skipped/errors/duration`

### V DB
```sql
-- Kolik klasifikovaných
SELECT COUNT(*) FROM "EmailClassification";

-- Rozdělení dle actionType
SELECT "actionType", COUNT(*)
FROM "EmailClassification"
GROUP BY "actionType"
ORDER BY 2 DESC;

-- Rozdělení dle contentType
SELECT "contentType", COUNT(*)
FROM "EmailClassification"
GROUP BY "contentType"
ORDER BY 2 DESC;

-- Eskalace (test post-processing)
SELECT em."fromAddress", em.subject, ec.escalation, ec."escalationDbOverride"
FROM "EmailMessage" em
JOIN "EmailClassification" ec ON ec."messageId" = em.id
WHERE ec.escalation = true
ORDER BY em."receivedAt" DESC LIMIT 20;

-- Confidence distribution (pro budoucí fázi 6 kalibraci)
SELECT
  CASE
    WHEN confidence >= 0.85 THEN '>=0.85 (auto-zone)'
    WHEN confidence >= 0.55 THEN '0.55-0.85 (confirm-zone)'
    ELSE '<0.55 (noise-zone)'
  END AS bucket,
  COUNT(*)
FROM "EmailClassification"
GROUP BY bucket;
```

### V cron logu
```bash
sudo docker compose logs app --tail 200 | grep posta-classify
# [posta-classify] userId=... total=50 classified=48 skipped=0 errors=2 duration=8234ms
```

## Známé limity fáze 2

1. **Body truncation na 4000 znaků** — dlouhé maily se klasifikují podle
   prvního ~6 odstavců. Pro fázi 4 (RAG) budeme indexovat plný text.
   Pro klasifikaci priority/category je truncated zoom dostačující.

2. **Post-processing escalation NEbere v úvahu reply ode mne** — pro
   fázi 2 sledujeme jen *přijaté maily od stejného odesílatele*. Pokud
   Petr odpověděl, my to teď nevidíme (Gmail nemá sent maily v
   `gmail.readonly` scope... vlastně má, jen je nepullujeme). Fáze 5
   po implementaci sent-mail importu (přes `gmail.modify`) vylepší
   na *bez moji reply v daném threadId*.

3. **Confidence kalibrace je LLM self-report** — nereálná pro auto-routing
   ve fázi 6. Tam přidáme sigmoid s parametry odhadovanými z rejected
   ratios (po pár týdnech feedback).

4. **Žádná pre-filtrace** — klasifikujeme všechny maily včetně zjevného
   spamu. Mohli bychom před LLM call přidat heuristiku (pokud
   `labels` obsahuje `SPAM` → automaticky `actionType=noise, contentType=spam`),
   ale Gemini Flash je levné, není to nutné.

5. **Reklasifikace not automatic při prompt upgrade** — když přejdeme na
   `classify_v2`, stará klasifikace v DB zůstává. Manuální reklasifikace
   přes `POST /posta-classify` s `force: true`. Pro fázi 3+ přidáme cron
   job „reclassify on prompt version change".

## 3 nezodpovězené otázky blokující fázi 3 (`/posta` UI modul)

### 1. Sidebar entry — kam?

Návrhy:
- **(a) Nová položka v sidebaru** "Pošta" pod skupinou "Organizace"
  (mezi Studánka a Spíž). Vlastní cool-blue ikona Mail.
- **(b) Subitem pod Capture** — Triage je už tam. Logicky pošta = další
  vstup co projde Triage. Mínus: schová ji o úroveň níž.
- **(c) Vlastní skupina "Komunikace"** s podpoložkami Pošta + budoucí
  Slack/WhatsApp/SMS aggregátor. Future-proof, ale teď osamělé.

### 2. Layout — split-pane vs 3-pane vs list-only?

- **(a) Split-pane** (left list, right detail): klasický Gmail/Apple Mail.
  Plus: rychlé skenování. Mínus: na mobilu collapsible jen jeden.
- **(b) 3-pane** (sidebar filters + list + detail): plný power-user.
  Plus: filtrování dle actionType/contentType/urgency v sidebar.
  Mínus: hodně místa, mobil = peklo.
- **(c) List-only** s filter chips nahoře + detail v overlay/modal.
  Plus: mobil-friendly, jednoduché. Mínus: pro keyboard navigaci horší.

Tip: Rašeliniště je primárně server-rendered, ne SPA. Plný split-pane
s URL routing per email vyžaduje hodně JS. Doporučuju **(c)** + později
ESC/J/K shortcuts pro power-user.

### 3. Real-time vs page refresh?

Když klikneme „Klasifikovat", cron za 15 min pullne sám. Otázka pro UI:
- **(a) Static page refresh** — Petr v `/posta` vidí stav v okamžiku
  načtení, refresh manuální. Jednoduché, žádný overhead.
- **(b) Auto-refresh polling** každých 30s (jako `/ukoly` review screen).
  Plus: nové maily se objeví automaticky. Mínus: nikdy nepotřebuješ
  vidět novou poštu během sledování svého denního digest.
- **(c) Web Push notifikace** (využít existující `WebPushSubscription`)
  pro nové action_required maily. Plus: nezatěžuje UI, ale upozorní.
  Mínus: další UX rozhodnutí (kdy push? jen high urgency? batched?).

Doporučuju **(a)** + **(c) jen pro escalation+urgency=high** (selektivně,
ne pro každý nový mail — to by Petr brzo začal ignorovat).
