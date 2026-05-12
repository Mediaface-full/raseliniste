# Email klasifikace — prompt v1

> **Versioning:** soubor nese hash v názvu (`v1`). Změny promptu = nový
> soubor `classify_v2.md` + reference v `src/lib/posta-classify.ts`.
> Stará verze zůstává v repo pro audit/replay starých klasifikací.

## Účel

Klasifikovat příchozí email do 7 ortogonálních polí pro:
- Digest „dnes vyřídit" (action_type=action_required)
- Filtrování v UI (content_type, urgency)
- Eskalační alerty (escalation, urgency=high)

## Schéma odpovědi

```json
{
  "action_type": "action_required" | "waiting_external" | "informational" | "noise",
  "content_type": "klient" | "osobni" | "admin" | "newsletter" | "reklama" | "systemovy" | "bezpecnostni" | "spam",
  "urgency": "low" | "medium" | "high",
  "escalation": true | false,
  "suggested_action": "krátký string nebo null",
  "project_hint": "krátký string nebo null",
  "reason": "1 věta proč ta klasifikace",
  "confidence": 0.0-1.0
}
```

## Definice polí

### action_type
| Hodnota | Význam |
|---|---|
| `action_required` | Čeká na **moji** akci (odpověď, rozhodnutí, schválení, úkol) |
| `waiting_external` | Já jsem už něco poslal/udělal, **čeká se na druhou stranu** (např. „díky, dám vědět příští týden") |
| `informational` | K přečtení / povědomí, **žádná akce ode mě nepotřeba** |
| `noise` | Archivovat — marketing, automaty, zjevný spam, generické notifikace |

### content_type
| Hodnota | Význam |
|---|---|
| `klient` | Pracovní mail od klienta/zákazníka |
| `osobni` | Nepracovní, soukromé (rodina, přátelé, osobní záležitosti) |
| `admin` | Faktury, smlouvy, účetnictví, HR, banka |
| `newsletter` | Oborové newslettery, RSS-like obsah |
| `reklama` | Marketing, prodejní email, nabídky |
| `systemovy` | Notifikace ze SaaS, deploy alerts, monitoring, Sentry, GitHub |
| `bezpecnostni` | 2FA kódy, password reset, security alerts od poskytovatelů |
| `spam` | Zjevný spam (cizí jazyk, podvod, phishing) |

### urgency
- `low` — žádný spěch, vyřídit kdykoli
- `medium` — vyřídit v rozumné době (do týdne)
- `high` — vyřídit dnes/zítra (deadline zmíněn, klient čeká, problém produkce)

### escalation
- `true` pokud v textu jsou **eskalační markery** (urgent, asap, "už podruhé píšu", zvýšené afektivní markery, vykřičníky, capslock, výhrůžky)
- `false` jinak

> Pozn.: i pokud detekuješ pouze textové markery, vrať `false` u
> rutinního "URGENT" v subject line marketingových mailů. Eskalace
> = skutečný emotion+repeat signal.
> Post-processing v `posta-classify.ts` může později override na
> `true` pokud DB query najde ≥2 maily od stejného odesílatele bez
> mojí odpovědi v posledních 7 dnech. Toto NE řešíš v promptu.

### suggested_action
Krátký akční string ve tvaru *„sloveso + objekt"* (česky). Příklady:
- `"odpovědět dnes do 18h"`
- `"schválit fakturu"`
- `"delegovat na Karla"`
- `"archivovat"`
- `"přečíst v klidu, není spěch"`
- `null` pokud žádná akce není evidentní

### project_hint
Volný krátký string s odhadem projektu/tématu (pro pozdější clusterování).
Příklady: `"TK Stavby"`, `"Mediaface web"`, `"fakturace duben"`,
`"Matěj škola"`. `null` pokud neidentifikuješ.

### reason
**JEDNA věta** proč ta klasifikace. Pro debug + display v digestu.
Příklady:
- `"Klient TK Stavby žádá schválení do pátku."`
- `"Generický marketing od newsletter providera, žádná akce."`
- `"Faktura k zaplacení, deadline za 5 dnů."`

### confidence
Vlastní odhad správnosti klasifikace 0.0–1.0:
- `1.0` — naprostá jistota (jasná faktura, jasný spam, ...)
- `0.8` — velmi pravděpodobné, drobné nejistoty
- `0.5` — středně jisté, mohu se mýlit
- `< 0.3` — opravdu nevím, dej raději konzervativní hodnoty

## Vstup

Klasifikujte následující email. Hodnoty vrať PŘESNĚ podle schématu výše.

```
From: {{fromName}} <{{fromAddress}}>
To: {{toAddresses}}
Subject: {{subject}}
Received: {{receivedAt}}
Labels: {{labels}}
---
{{bodyTextOrSnippet}}
```

## Důležité pokyny

1. **Hodnoty enumů zachovat přesně** — žádné `action-required` (dash),
   `Action_Required` (capslock), `urgent_action` (vlastní). Jen
   povolené hodnoty z definice.
2. **Pokud je email v anglicině**, klasifikuj normálně — schema je
   stejné. `reason` a `suggested_action` ale piš česky (pro Petrův UI).
3. **Edge case prázdný body:** pokud máš jen subject + snippet, použij
   to. Sniž confidence na ≤ 0.5.
4. **Edge case automaty s lidským jménem:** např. `From: "Jan Novák"
   <noreply@bank.cz>` → koukni na doménu, ne na jméno. Pokud
   `noreply@`, `mailer@`, `info@` + obsah je transakční → `systemovy`
   nebo `admin`, ne `klient`.
5. **NEPOKOUŠEJ se** detekovat vyšumělé závazky — to je separátní úloha
   (fáze 6 modulu). Tady jen klasifikuj příchozí mail.
6. **Output je čistý JSON** bez markdown code fence, bez komentářů.
