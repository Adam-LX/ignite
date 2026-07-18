# Ignite — roadmap (final · Gemini 2026-07-12)

**Stan:** v0.3.10 · Trellis regen w toku · garaż 3D

**Product roadmap (Ignition Rush, Overcharge, body traits, spectacle):** [`docs/PRODUCT-ROADMAP.md`](docs/PRODUCT-ROADMAP.md)

**Playlisty trybów (Core / Experimental / Lab — architektura kodu):** [`docs/MODE-PLAYLISTS.md`](docs/MODE-PLAYLISTS.md)

Konsultacje: `screenshots/gemini-consult-20260712-023942.json` (finalizacja v1.0)

---

## Finalizacja v1.0 (Gemini 2026-07-12)

| # | Krok | VPS? | Kryterium DONE |
|---|------|------|----------------|
| 1 | **QA Feel** — Adam 8/10 | 🔄 | auto: 70/70 physics + kickoff + autopilot ✅ · Adam 8/10 ☐ |
| 2 | **2v2 local** — protocol 4 sloty + reconcile | ✅ | `test:e2e:local-2v2` 60s bez desync |
| 3 | **Arena manifests** — `trellis:sync-arena-manifests` | ✅ | 4 mapy: manifest + neon + dropy |
| 4 | **Launch prep** — podpis Win/Linux, DOWNLOADS | 🔄 | DOWNLOADS v0.3.6 ✅ · podpis Win ☐ |
| 5 | **VPS relay** — Hetzner + public E2E | ✅ VPS | `test:e2e:public-relay` pass |

**Kolejność bez VPS:** 1 → 2 → 3 → 4 → 5

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
| **v1.0.0** | Launch | Podpis + installer + stabilne 2v2 |

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
- [ ] `trellis:sync-arena-manifests`

---

## v0.5.0 — M5 Online

- [ ] `server/protocol.ts` — 4 sloty
- [ ] `netcode/guestReconcile.ts` — 2v2
- [ ] `MultiplayerLobby.ts` — public rooms
- [ ] `validateInput.ts` — anti-cheat P2

---

## v1.0.0 — Launch

- [ ] Code signing Windows/Linux
- [ ] Codeberg Pages / GH Releases changelog
- [ ] `docs/BOT-FEDERATION.md`
- [ ] Steam Deck `.run` CI

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

*Ostatnia aktualizacja: 2026-07-12 · finalizacja v1.0 Gemini*
