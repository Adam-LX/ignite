# Ignite — roadmap techniczny

**Stan:** v0.3.28 · fokus komercyjny Steam

**Komercja / Steam:** [`docs/STEAM-LAUNCH.md`](docs/STEAM-LAUNCH.md) · podpis: [`docs/CODE-SIGNING.md`](docs/CODE-SIGNING.md)

**Product (tożsamość Experimental — nie blokuje Launch):** [`docs/PRODUCT-ROADMAP.md`](docs/PRODUCT-ROADMAP.md)

**Fizyka / boty / lighting P0:** [`docs/ROADMAP.md`](docs/ROADMAP.md) · playlisty: [`docs/MODE-PLAYLISTS.md`](docs/MODE-PLAYLISTS.md)

Konsultacje: `screenshots/gemini-consult-20260712-023942.json` (legacy v1.0)

---

## Finalizacja v1.0 → Commercial S0–S7

| # | Krok | Stan | Kryterium DONE |
|---|------|------|----------------|
| 1 | **S0 Feel + stab** | 🔄 | Adam 8/10 ☐ · P0 freeze/pasy = 0 |
| 2 | **2v2 local** | ✅ | `test:e2e:local-2v2` 60s |
| 3 | **Arena manifests** | ✅ | 4 mapy |
| 4 | **S4–S6 Steam** | ☐ | AppID · signing · Coming Soon · demo |
| 5 | **VPS relay** | ✅ | public E2E |

**Kolejność:** S0 → S1 → S2 równolegle ze startem S4 (Steam account / cert lead time).

### QA Feel 8/10 — checklist (Adam)

| Obszar | Test | Pass? |
|--------|------|-------|
| Sterowanie | A/D skręt + boost + skok — bez „pływania” | ☐ |
| Kickoff | 3…2…1…GO — auto rusza płynnie, bez teleportu | ☐ |
| Uderzenie piłki | front/side — przewidywalna prędkość, bez glitchy | ☐ |
| Wall ride | ściana + boost — stabilny kontakt, bez wypadnięcia | ☐ |
| Menu | hover kart, GRAJ czytelny, bez migotania filtra | ☐ |
| 1v1 online | 5 min mecz — brak widocznego desyncu | ☐ |
| 2v2 local | 4 sloty, pełny mecz bez crashy | ☐ |
| Ignition | bot używa power-upów, pickup widoczny | ☐ |

**8/10** = max 1–2 ☐ w krytycznych (sterowanie, kickoff, online).

**Engineering gates (2026-07-19):** `audit:physics` ✅ · `audit:ball` ✅ · `audit:wall-ceiling` ✅ · `audit:grip` ✅ · `audit:chase` ✅ · probe smoke 0 findings ✅. Adam QA = remaining human PASS.

### AAA Core completeness (bez Steam ops)

| Faza | Stan |
|------|------|
| A Feel/stab | ✅ audity green + cam/freeze mitigations |
| B Bots | ✅ aerial_spam finding + tighter aerial/goalie mid |
| C Online | ✅ fillBots default off · ping RTT · host-left / reconnect copy |
| D AV | ✅ pady 3D · spectacle skip hint · content freeze doc |
| E Onboarding | ✅ 90s tutorial · Deck gfx · demo flag (`demoBuild.ts`) |
---

## Kolejność wykonania (1–20)

| # | Zadanie | Wersja | Stan |
|---|---------|--------|------|
| 1 | Relay `--release`, wall ride, dodge damp | v0.3.5 | ✅ |
| 2 | Boost pady standard/compact | v0.3.5 | ✅ |
| 3 | validate:glb + catalog 8 aut | v0.3.6 | ✅ |
| 4 | Trellis batch 5 aut (hatch→phantom) | v0.3.6 | ✅ |
| 5 | VPS Hetzner + `test:e2e:public-relay` | v0.3.5 | ☐ |
| 6 | Adam QA feel 8/10 | v0.3.5 | ☐ |
| 7 | **Release v0.3.5** stable | v0.3.5 | ✅ (w v0.3.6) |
| 8 | Dropy map (wide/vault) + neon per arena | v0.4.0 | ✅ |
| 9 | Arena atmosphere accent → hemi + VFX | v0.4.0 | ✅ |
| 10 | Vault/custom edges testy regresji | v0.4.0 | ✅ |
| 11 | Trellis arena manifests sync | v0.4.0 | ✅ |
| 12 | Wall ride tire sparks + boost pad tint | v0.3.6 | ✅ |
| 13 | **Release v0.3.6** Content Pipeline | v0.3.6 | ✅ |
| 14 | protocol.ts 4 sloty 2v2 | v0.5.0 | ✅ |
| 15 | Guest reconcile 2v2 | v0.5.0 | ✅ |
| 16 | Lobby UI 2v2 + lista pokoi | v0.5.0 | ✅ |
| 17 | Snapshot co 2 ticki | v0.5.0 | ✅ |
| 17b | `test:e2e:local-2v2` (bundled mp-server + requestStart) | v0.5.0 | ✅ 2026-07-18 |
| 18 | Podpis Win/Linux | v1.0.0 | ☐ |
| 19 | Strona DOWNLOADS + changelog | v1.0.0 | ☐ |
| 20 | **Release v1.0.0** Launch | v1.0.0 | ☐ |

---

## Wersje

| Wersja | Cel | Kryterium release |
|--------|-----|-------------------|
| **v0.3.5** | Stability & Feel | 70/70 physics, relay bake, boost pady |
| **v0.3.6** | Content Pipeline | 8 aut GLB validate, Trellis batch |
| **v0.4.0** | M5 Content | 4 mapy, dropy wide/vault, neon accent |
| **v0.5.0** | M5 Online | 4 graczy 2v2 ranked bez desync |
| **v1.0.0** | Launch | Commercial S0–S7 DONE · Very Positive bar · Steam Win+Linux |

---

## Asset Pipeline

```bash
npm run trellis:health
npm run trellis:batch              # tylko brakujące GLB
npm run trellis:prep-car -- --id muscle
npm run validate:glb -- --catalog
npm run catalog:sync-design
```

| Krok | Plik | Done gdy |
|------|------|----------|
| Generate | `trellis/pipelineCar.ts` | `public/assets/cars/<id>.glb` |
| Prep | `blender_prep_meshy_car.py` | koła 4/4, L=1.18 m |
| Validate | `validateGlb.mjs` | `npm run validate:glb -- --catalog` |
| Catalog | `syncCatalogFromDesign.ts` | 8 wpisów w car-catalog.json |

**Autonomiczna pętla:** `trellis:batch` → validate → prep (retry×2) → next car.

---

## v0.3.5 — Stability & Feel

- [x] `bake-mp-endpoint.sh --release`
- [x] Wall ride tangent gravity (`RocketCar.ts`)
- [x] Dodge damp 0.25 (`rlConstants.ts`)
- [x] Boost pady (`boostPadLayout.ts`, standard+compact)
- [ ] VPS live (`vps-relay-setup.sh`)
- [ ] `npm run test:e2e:public-relay`

---

## v0.3.6 — Content Pipeline

- [x] muscle/sleek Blender prep + validate
- [x] `catalog:sync-design` (8 aut)
- [x] Trellis client retry (socket crash)
- [x] `trellis:batch --missing-only`
- [x] hatch/truck/blade/buggy/phantom GLB

---

## v0.4.0 — M5 Content

- [x] Garaż mapy (`LoadoutOverlay.ts`)
- [x] Dropy map wide/vault (`DropTable.ts`)
- [x] Neon accent per mapa (`setArenaNeonAccent`)
- [x] vault custom edges (`arenaVariants.test.ts`)
- [x] `trellis:sync-arena-manifests`

---

## v0.5.0 — M5 Online

- [ ] `server/protocol.ts` — 4 sloty
- [ ] `netcode/guestReconcile.ts` — 2v2
- [ ] `MultiplayerLobby.ts` — public rooms
- [ ] `validateInput.ts` — anti-cheat P2

---

## v1.0.0 — Launch (Commercial S0–S7)

Pełna oś: [`docs/STEAM-LAUNCH.md`](docs/STEAM-LAUNCH.md). Skrót:

- [ ] **S0** Feel 8/10 + P0 stab (freeze / pasy / crash)
- [ ] **S1** Core loop + boty 1v1/2v2
- [ ] **S2** Online friend path (bots opt-in)
- [ ] **S3–S4** Identity trailer + Steam AppID + signing
- [ ] **S5** Content floor + **Demo**
- [ ] **S6** Coming Soon ≥ 4 tyg
- [ ] **S7** Release Win+Linux
- [ ] Code signing — [`docs/CODE-SIGNING.md`](docs/CODE-SIGNING.md)
- [ ] Steam Deck — `scripts/build-steamdeck.sh`
- [ ] Changelog / DOWNLOADS

---

## Spectacle

| Feature | Stan |
|---------|------|
| Boost pady | ✅ |
| Wall ride sparks | ✅ `wallRideSparksVfx` |
| Quick chat | ✅ |
| Impact sparks | ✅ |
| Goal orbit | ✅ |

---

## Anti-patterns

- **NIE** zmieniaj `RL_CAR.mass`
- **NIE** commituj trycloudflare URL
- **NIE** zwiększaj tolerancji E2E zamiast fix fizyki
- **ZASADA:** `npm run audit:physics` przed merge

---

*Ostatnia aktualizacja: 2026-07-19 · Steam commercial axis*
