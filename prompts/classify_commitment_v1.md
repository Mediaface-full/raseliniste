# DetectedCommitment — prompt v1

> **Versioning:** `prompt_version` na DetectedCommitment ukládá hodnotu
> "classify_commitment_v1". Při manuální revizi (po ~30 rejected) vytvořím
> `v2.md` + bump `PROMPT_VERSION` konstantu v `posta-commitment.ts`.
> Staré classify zůstávají s `v1`, nové s `v2` — můžeme analyzovat
> precision per verze.

## Účel

Z odeslaného mailu (`from = Petr`) extrahovat **vyšumělé závazky** —
explicitní sliby co Petr klientovi/druhému dal, ale které pokud
zapomene, "tečou pod kobercem".

## Charakteristika vyšumělého závazku

**JE závazek:**
- "Pošlu ti to do pátku" → konkrétní akce + deadline
- "Ozvu se ti příští týden" → akce + termín mlhavý
- "Dodám ti nabídku" → akce, deadline open
- "Dám vědět jakmile to budu mít" → akce s vágním triggerem
- "Domluvíme schůzku tento týden" → akce + termín

**NENÍ závazek (≠ confidence < 0.55):**
- "Děkuji za informace" → pasivní zdvořilost
- "Třeba se uvidíme" → podmíněné "možná"
- "Pokud bude čas, podívám se" → conditional bez závazku
- "Mohlo by to vyjít" → spekulace
- Newsletter sign-off "S pozdravem, ..." → boilerplate
- "Uvidím" / "Možná" → nezavazující
- Hypotetické nabídky ("kdyby tě zajímalo...")

## Schéma odpovědi

Pro každý mail vrať pole **commitments** (může být prázdné):

```json
{
  "commitments": [
    {
      "quoted_text": "konkrétní citát z mailu (1-2 věty)",
      "recipient": "Karel Novák",
      "recipient_email": "karel@example.cz",
      "proposed_title": "Poslat Karlovi cenovou nabídku do pátku",
      "deadline_hint": "do pátku 17.5.",
      "confidence": 0.92,
      "reason": "explicitní 'pošlu do pátku' s konkrétním deadlinem"
    }
  ]
}
```

Pokud žádný závazek: `{ "commitments": [] }`.

## Definice polí

### quoted_text
**Přesný citát z mailu**, 1-2 věty co obsahují závazkový signál.
Bez interpretace. Bez vlastních slov.

✅ `"Pošlu ti to úterý odpoledne s detailním cenovým rozpočtem."`
❌ `"Petr slíbil poslat rozpočet."` (parafráze)

### recipient + recipient_email
Komu byl závazek dán — typicky první `To:` adresát mailu. Pokud má
display name (např. `"Karel Novák" <karel@example.cz>`), vyplň oba.
Pokud jen email, `recipient` = null.

### proposed_title
Stručný název úkolu, **akční sloveso + objekt**. Format pro Todoist:

✅ `"Poslat cenovou nabídku Karlovi"`
✅ `"Domluvit schůzku s Janem o produktu X"`
✅ `"Dodat reference klientovi TK Stavby"`
❌ `"Email od Petra"` (popisné, ne akční)

### deadline_hint
Mlhavý popis z textu, **NE parsovaný datum** (to se snažíme udělat
v `parsed_deadline` post-processingem).

✅ `"do pátku 17.5."`
✅ `"příští týden"`
✅ `"na konci měsíce"`
✅ `"jakmile to budu mít"` (deadline open)
`null` — pokud Petr nezmínil čas vůbec.

### confidence (0.0-1.0)
| Range | Význam |
|---|---|
| 0.85-1.0 | Velmi pravděpodobné — explicitní sloveso ("pošlu", "dodám", "ozvu se") + jasný subject |
| 0.55-0.84 | Středně jisté — méně explicitní formulace, ale stále commit ("podívám se a dám vědět") |
| 0.30-0.54 | Slabé signály — "možná se ozvu", "uvidím" |
| < 0.3 | Není závazek |

**Routing v aplikaci:**
- `>= 0.85` → auto-create + auto-sync Todoist
- `0.55-0.84` → vytvořit záznam, ale potvrzení Petrem v UI
- `< 0.55` → **VYNECHAT** (NE vytvořit záznam vůbec)

### reason
1 věta proč jsi to klasifikoval s tou confidence. Pro debug + budoucí
prompt revizi.

✅ `"explicitní 'pošlu do pátku' + konkrétní recipient + parsovatelný deadline"`
✅ `"mlhavé 'ozvu se' bez deadline, ale klient v Subject prefixu"`

## Vstup

```
From: {{from}} (= Petr — je to jistě outbound mail)
To: {{toAddresses}}
Cc: {{ccAddresses}}
Subject: {{subject}}
Sent: {{receivedAt}}
---
{{bodyTextOrSnippet}}
```

## Důležitá pravidla

1. **Konzervativní bias** — radši žádný commitment než false positive.
   Pokud nejsi jistý, snižuj confidence. Petr má raději prázdnou listu
   než zaplavu falešných úkolů.

2. **Boilerplate ignoruj** — emailové podpisy, automatické zápatí,
   forwardované zprávy. Soustřeď se na hlavní text mailu.

3. **Reply markers** — pokud mail obsahuje "On X wrote:" + původní zpráva,
   detekuj závazky JEN v nové části (vrchu), NE v citovaném textu.

4. **Pluralita** — jeden mail může obsahovat 0, 1, ale i víc závazků
   (Petr v jednom mailu slibí dvě věci). Vrať vše jako pole.

5. **Recipient identifikace** — vždy první `To:` (= primary). Pokud
   chybí To, použij Cc[0]. Pokud nic, recipient = null.

6. **Output je čisté JSON** bez markdown code fence.

## Edge cases

- **Mail je jen "OK díky"** → `commitments: []`, žádný závazek
- **Forwarded message** → analyzuj jen Petrův komentář v top části, ne
  forwardovaný obsah
- **Konditional** ("pokud bude X, pak Y") → confidence ≤ 0.5, většinou skip
- **Auto-generovaný mail z systému** (calendar invites apod.) →
  `commitments: []` (Petr ho nepsal)
- **Anglicky mail** → zpracuj normálně, ale `proposed_title` + `reason`
  piš česky (Petrovo UI je české)
