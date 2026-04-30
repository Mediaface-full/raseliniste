# 08 — Deploy & testování (jak nerozbít produkci)

Gideon je solo developer s reálnými uživateli (Blanka a další hosté na Studna).
Cíl: minimalizovat „push → rozbité u uživatele" bez toho, aby Gideon strávil
hodiny ručním testováním po každém commitu.

---

## Slovník — aby bylo jasno

- **Produkce (prod)** = `www.raseliniste.cz` — ostrá appka, ostrá data, používají
  ji reální lidé.
- **Staging** = `staging.raseliniste.cz` — testovací kopie appky na **stejném**
  NASu. Vlastní DB, vlastní data, nikdo ji nepoužívá. Pískoviště kde se zkouší
  nové verze před produkcí.
- **Smoke test** = rychlý automatický check (~5 s) co ověří, že základní stránky
  vrací 200 a nejsou rozbité.
- **Rollback** = návrat na předchozí verzi appky když po deployi něco selže.
- **Image** = Docker obraz appky (`ghcr.io/petrperina/raseliniste:latest`).
- **Tag** = pojmenování image (`latest`, `rollback`, `v1.2.3`, ...).

---

## Vrstvy ochrany (od nejdůležitější)

### Vrstva 1: Staging prostředí
**Co:** druhá kopie appky na NASu, oddělená DB, subdoména `staging.raseliniste.cz`.
**Cíl:** otestovat změny **dřív než** se pustí na produkci.

### Vrstva 2: Smoke test skript
**Co:** `scripts/smoke.sh <url>` — projede klíčové stránky a hlavičky.
**Cíl:** za 5 s víš, jestli je základ funkční.

### Vrstva 3: Rollback
**Co:** před deployem otaguj aktuální image jako `:rollback`. Když to selže,
1 příkazem zpátky.
**Cíl:** psychologická jistota — když to ucvakne, do 30 s je to zpět.

### Vrstva 4: Batch deploys
**Co:** nedeployovat po každém commitu, sbírat změny po dnech.
**Cíl:** méně příležitostí něco rozbít + lepší přehled co se mění.

---

## Standardní deploy workflow (od dnes)

### Před deployem — local check
```bash
# 1. Co se vlastně změnilo od posledního deploye?
git log --oneline origin/main..HEAD

# 2. Build prošel?
npx astro build
# → očekávej "Server built in X.XXs" + "Complete!"
# → žádný "error" v logu (warningy jsou OK)

# 3. Co konkrétně testovat? (Claude ti řekne v changelogu před deployem.)
```

### Krok 1: Push na GitHub
```bash
git push
# GitHub Actions postaví image a pushne na ghcr.io/petrperina/raseliniste:latest
# Trvá ~3-5 min. Sleduj: https://github.com/petrperina/raseliniste/actions
```

### Krok 2: Deploy na **staging** (NE produkci!)
```bash
ssh gideon@<NAS-IP>
cd /volume1/docker/raseliniste-staging   # ← všimni si: -staging suffix

# Pull nového image + restart
sudo docker compose pull
sudo docker compose up -d --force-recreate
sudo docker compose logs app --tail 30   # zkontroluj že naběhlo bez chyb
```

### Krok 3: Smoke test na stagingu
```bash
bash scripts/smoke.sh https://staging.raseliniste.cz
# → očekávej "ALL PASSED" na konci
```

### Krok 4: Manuální klick test (klíčové features)
Otevři `https://staging.raseliniste.cz` v prohlížeči (a na mobilu!) a projeď:
- [ ] **Login** — funguje, sice se přepneš do dashboardu
- [ ] **Záznam ve Studni** (`/studna/<projekt>`) — mikrofon povolí, nahrávání jede,
      stop → upload → processing → done
- [ ] **Deník** (`/denik`) — nový zápis, uložení
- [ ] **Úkoly** (`/ukoly`) — vytvoření, úprava
- [ ] **`/me/<test-token>`** na **mobilu** (Android pokud možno!) — mikrofon povolí
      a nahrávání funguje
- [ ] **`/api/diagnose/studna`** — JSON bez `🔴` v `conclusions`

**Pokud cokoli selže → STOP. Neopouštěj staging. Oprav, znovu push, znovu staging.**

### Krok 5: Tag rollback image (pojistka pro produkci)
```bash
# Na NASu, v prod složce
cd /volume1/docker/raseliniste

# Najdi current image hash
sudo docker images ghcr.io/petrperina/raseliniste:latest --format "{{.ID}}"
# → otaguj ho jako rollback
sudo docker tag <hash> ghcr.io/petrperina/raseliniste:rollback
```

### Krok 6: Deploy na **produkci**
```bash
sudo docker compose pull
sudo docker compose up -d --force-recreate
sudo docker compose logs app --tail 30
```

### Krok 7: Smoke test na produkci
```bash
bash scripts/smoke.sh https://www.raseliniste.cz
```

### Krok 8: Rychlý live check
- [ ] `https://www.raseliniste.cz/login` se otevře a přihlásíš se
- [ ] Otevři `/start`, klikni Studna, ověř že to jede
- [ ] Pokud je čas a Blanka by mohla volat — pošli si test guest link a ověř
      mikrofon na vlastním Androidu / iPhonu

---

## Když to po deployi selže — ROLLBACK

```bash
ssh gideon@<NAS-IP>
cd /volume1/docker/raseliniste

# Přepni latest na rollback verzi
sudo docker tag ghcr.io/petrperina/raseliniste:rollback ghcr.io/petrperina/raseliniste:latest
sudo docker compose up -d --force-recreate

# Ověř
sudo docker compose logs app --tail 30
bash scripts/smoke.sh https://www.raseliniste.cz
```

Trvá ~30 sekund. Produkce je zpátky na předchozí verzi.

**Pak v klidu** zkoumej v Claude session co se rozbilo a oprav správně.

---

## Známé pasti při deployi

### A. „Nepushuj v pátek večer"
Pravidlo profíků. Když se něco rozbije v pátek, opravuješ to v sobotu místo
relaxu. Plánuj deploye na pondělí–středu.

### B. Vždycky nejdřív staging
I když „je to jen kosmetická změna" — mikrofon-bug s `Permissions-Policy`
byl taky „kosmetická" změna v middleware. Nikdy nevíš.

### C. Otestovat na **mobilu**, ne jen desktopu
Většina klientů (Blanka & spol.) přistupuje z mobilu. iOS Safari a Android
Chrome se chovají jinak než desktop Chrome — viz gotcha #18 v `06-troubleshooting.md`.

### D. Nesahat na DB migrace v produkci ručně
Pokud `prisma migrate deploy` selže při startu kontejneru, **NEspouštět**
SQL ručně přes psql. Místo toho otevřít Claude session, popsat chybu,
opravit migraci v repozitáři, znovu push → deploy.

### E. Zálohy DB před velkými změnami
Před migrací co mění schéma (DROP COLUMN, atd.):
```bash
sudo docker exec raseliniste_db pg_dump -U raseliniste raseliniste \
  > /volume1/docker/backups/raseliniste-$(date +%Y%m%d-%H%M).sql
```

### F. Když to běží, nesahat
Pokud appka funguje a Gideon nemá konkrétní problém k řešení, neoptimalizovat
„preventivně". Refactor = nová příležitost něco rozbít.

---

## Batch deploy strategie

Místo „push po každém commitu":

1. Pracujeme s Claude session, commity vznikají normálně.
2. **Nepushuješ hned.** Necháš commity ležet lokálně.
3. Když je dobré množství / smysluplný celek (typicky 3–10 commitů, jednou týdně),
   řekneš „chci deploy". Claude ti pošle:
   - **Changelog** — co se změnilo, srozumitelnou češtinou
   - **Riziko** — co může selhat (auth, mikrofon, DB schema, ...)
   - **Test plan** — konkrétní checklist co kliknout na stagingu
4. Teprve pak push → staging → testy → produkce.

To je správný rytmus pro single-developer projekt s reálnými uživateli.

---

## Co všechno (zatím) nemáme

- **Playwright e2e testy** — automatické browser testy. Bod do budoucna,
  ne pro tuhle fázi. Vrstvy 1–4 stačí.
- **CI testy v GitHub Actions** — zatím jen build. Až bude staging stabilní,
  dá se přidat smoke test do CI.
- **Monitoring & alerting** — když produkce spadne v noci, nikdo o tom neví.
  Až později (UptimeRobot zdarma plán).
- **Feature flags** — zapínat features postupně. Pro single-user appku zbytečné.

---

## TL;DR — krátká kuchařka

```
1. Ověř lokálně: git status + npx astro build
2. git push
3. Počkej na GH Actions (3-5 min)
4. SSH na NAS → staging složka → docker compose pull + up
5. bash scripts/smoke.sh https://staging.raseliniste.cz
6. Klikni si Studna + mikrofon na mobilu
7. Tag rollback image v prod složce
8. SSH na NAS → prod složka → docker compose pull + up
9. bash scripts/smoke.sh https://www.raseliniste.cz
10. Hotovo.
```

Když selže krok 5–6: **NEpokračovat na produkci.** Oprav, znovu od kroku 1.
Když selže krok 9: **Rollback** (viz výš).
