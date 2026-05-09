# Jak nahrát audio soubor do Studánky

Návod pro hosty (klienty) i pro Gideona. Stačí jakákoli aplikace, která umí audio uložit do souboru — typicky **Voice Recorder** na iPhone, ale jakákoli jiná funguje stejně.

---

## Krok za krokem (iPhone)

### 1. Nahraj nebo otevři audio záznam

Použij svou oblíbenou nahrávací aplikaci (Voice Recorder, Hlasové poznámky, Diktafon, …). Nebo si můžeš poslat soubor z Whatsappu, mailu — kamkoliv, co se ti uloží do Files.

### 2. Ulož ho jako soubor (NE jako přílohu mailu)

V Voice Recorder klikni na záznam → ikona **Sdílet** (čtvereček se šipkou nahoru).

Z dlouhého seznamu možností vyber **JEDNU z těchto tří**:

| Volba | Doporučení | Proč |
|---|---|---|
| **Save in Photo Album** | ⭐ nejjednodušší | Soubor se uloží mezi videa v Galerii. V Studánce ho vybereš přes „Knihovna fotek". |
| **Save to iCloud** / **Save to Files** | ⭐ nejspolehlivější | Soubor se uloží do Files (iCloud Drive). V Studánce ho najdeš v „Procházet". |
| **Save to Google Drive / Dropbox / OneDrive** | jen pokud máš apku nainstalovanou | Soubor v cloudu, dostupný odkudkoli. |

**❌ NEPOUŽÍVEJ:**
- ❌ Send By Email / SMS — pošle se příjemci, ale lokálně se neuloží
- ❌ Send to Bluetooth / FTP / WiFi Download — pro Studánku nepoužitelné
- ❌ Post to YouTube / Sound Cloud — zveřejní to publicky (jiný problém)

### 3. Otevři pozvánku Studánky

Klikni na odkaz, který ti Gideon poslal — tvar `https://www.raseliniste.cz/me/...`.

### 4. Klikni na **„📎 Nahrát audio soubor (MP3/M4A/...)"**

Lavender tlačítko pod hlavním nahrávacím kruhem.

### 5. Telefon ti nabídne, odkud chceš soubor vybrat

Nabídka se liší podle toho, kam jsi v kroku 2 uložil:

- **Pokud Save in Photo Album** → zvol **„Knihovna fotek"** a vyber svůj záznam
- **Pokud Save to Files / iCloud** → zvol **„Procházet"** → najdi soubor v „Recently" nebo v iCloud Drive
- **Pokud Google Drive / Dropbox** → tvoje cloud apka tam bude jako další volba

### 6. Klepni na soubor

Upload se spustí automaticky. Vidíš progress bar (% kolik se nahrálo).

### 7. Hotovo

Po nahrání ti Studánka řekne „Hotovo". Soubor se uložil, **přepis do textu** se připraví na pozadí — vrátíš se kdykoli a v seznamu svých záznamů uvidíš plný text.

---

## Co se po uploadu stane

| Stage | Co se děje |
|---|---|
| Upload | Audio jde z telefonu na server (~2–60 sekund podle velikosti) |
| Přepis | AI (Gemini) si soubor poslechne a doslova ho přepíše do textu (~30 s – 5 min podle délky) |
| Hotovo | V seznamu Studánky uvidíš záznam s tvým názvem souboru a **plným textem** |

**Jen přepis, žádná AI analýza.** Tvoje audio + text Gideon najde v projektu, ale AI z toho nedělá strukturované shrnutí ani témata. To je záměrné — když nahráváš podcast nebo zápis schůzky, chceš jen text, ne interpretaci.

---

## Které formáty fungují

✅ **MP3, M4A, WAV, OGG, AAC, FLAC, WEBM**

**Voice Recorder app** typicky exportuje M4A nebo MP3 — oba jsou OK.

❌ Video soubory (MP4, MOV) — nejsou audio, server odmítne.

---

## Limity

- **Velikost souboru:** max **500 MB** (cca 6+ hodin záznamu v 128 kbps)
- **Počet uploadů:** max 20 za hodinu (bezpečnostní limit)
- **Délka:** žádný strop — server zvládne i hodinové podcasty

---

## Časté problémy

### „Soubor není audio"

Server poznal, že to není audio (mime type nesedí). Typicky:
- Vybral jsi obrázek nebo video místo audia
- Soubor má neobvyklou příponu (`.amr`, `.opus` — neoficiální)

**Řešení:** v aplikaci Voice Recorder zkontroluj, že vybíráš zvukový záznam (ne fotku); v exportu zvol M4A nebo MP3.

### „Soubor je moc velký"

Přesahuje 500 MB. Buď:
- Rozsekni audio na kratší úseky v editoru
- Re-encodni na nižší bitrate (Voice Recorder má volbu kvality)

### Nahrávání trvá věčně

Velký soubor + slabší WiFi. Počkej. Pokud se uploadu nepodaří dokončit, **ne**posílej znovu hned — zkus se připojit na lepší síť.

### Po uploadu nevidím přepis

AI ho zpracovává na pozadí — typicky 30 s až 5 min. Dej mu chvíli a obnov stránku. Pokud po 10 minutách pořád nic, napiš Gideonovi.

---

## Pro Gideona (vlastní upload)

Tlačítko **📎 Nahrát audio soubor** najdeš na **třech místech** v Rašeliništi:

### Studánka / Prskavka
- Otevři projekt v `/studna/<id>` nebo `/prskavka/<id>`
- Záložka **Záznamy** → karta **„Nahrát audio soubor"**
- Žádná AI analýza, jen přepis. Audio + text natrvalo.

### Úkoly (Ozvěna)
- Otevři `/ozvena?mode=task`
- Místo kliknutí na velký mikrofon klikni **📎 Nahrát soubor** pod ním
- AI extrahuje strukturované úkoly → review screen → push do Todoistu
- **Limit: 50 MB** (cca 10 min)

### Deník (Ozvěna)
- Otevři `/ozvena?mode=journal`
- Stejný file picker pod mikrofonem
- AI vytvoří strukturovaný zápis (METADATA + tělo + POZNÁMKY EDITORA + NÁPADY)
- **Limit: 100 MB** (~60 min — Plaud nahrávky se vejdou)

V Prskavce je to bez permission flagu (jsi jediný uživatel = automaticky povoleno).
V úkolech a deníku stejně — jen pro tebe.

---

*Dokument k vytisknutí přes [public stránku /help/upload-audio](https://www.raseliniste.cz/help/upload-audio) → Cmd+P / Uložit jako PDF.*
