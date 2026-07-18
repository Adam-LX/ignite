# Ignite — Product Roadmap (v0.7 → v1.0 Launch)

**Cel:** tożsamość gry poza „kolejnym Rocket League” — **energia pola + spectacle + karoseria jako build**.

**Oś produktu:** *Ignite* = mecz ma fazy, pole reaguje na drużynę, każdy gol wygląda jak event, garaż buduje więź z autem.

**Stan wyjściowy (2026-07-16):** fizyka RL, 8 aut Trellis, garaż/loadout, Ignition power-upy, goal spectacle v1, match moments, 2v2 foundation.

**Numeracja:** fazy produktowe (`v0.7`…) ≠ tagi buildów (`package.json` 0.3.x). **v1.0 = Launch** (podpis, polish Core, promocja Experimental→Core) — nie Pit/garaż.

**Aktualny focus (2026-07-17):** polish **mechanik Core Soccar + Experimental** (Rush / OC / Zones / body traits / Ignition FFA). **Meridian poza scope.** Training Gym v0.12 — drugorzędnie.

| Faza | Status |
|------|--------|
| v0.7 Field Energy | DONE w kodzie (Rush, OC, Zones) |
| v0.8 Body Identity | DONE (`carBodyTraits`) |
| v0.9 Broadcast | DONE (Match Director + Goal Spectacle) |
| v0.10 Pit & Collection | DONE (pit, provenance, collection) |
| v0.11 Community Loop | DONE (weekly mutator, duel contracts) |
| v0.12 Esport Lite | PARTIAL — Training Gym / replay share backlog |
| v1.0 Launch | TODO |

---

## Zasada playlist (core vs experimental)

| Playlist | Tryby | Gameplay |
|----------|-------|----------|
| **Core Soccar** | 1v1–4v4 | Czysty RL — bez power-upów, rush, overcharge, mutatorów, body traits |
| **Experimental** | Ignition Rush 2v2, Ignition Test, Ignition FFA | Nowe mechaniki gameplay **tylko tutaj** |
| **Weekly Lab** | Weekly Lab 2v2 | Experimental + rotujący mutator tygodnia |

**Promocja do Core:** dopiero po walidacji w Experimental (10+ meczów, `npm run audit:physics` pass, brak regresji).

Implementacja flag: [`docs/MODE-PLAYLISTS.md`](MODE-PLAYLISTS.md) · `src/game/modePolicy.ts` → `getModePolicy(mode).features`.

---

## Wersje docelowe

| Wersja | Nazwa | Deliverable | Kryterium „ship” |
|--------|-------|-------------|------------------|
| **v0.7** | Field Energy | Ignition Rush + Team Overcharge | tryb w menu, 10 meczów bez bugów regresji fizyki |
| **v0.8** | Body Identity | bodyStyle → gameplay hooks (4 style) | odczuwalna różnica w 1v1 A/B |
| **v0.9** | Broadcast | Match Director + Goal Spectacle v2 | każdy gol = 3s micro-scene, bez motion sickness |
| **v0.10** | Pit & Collection | Garaż pit + provenance itemów | kolekcja + team garage 3-slot |
| **v0.11** | Community Loop | Weekly Mutator + Duel Contracts | jeden mutator / tydzień, challenge 1v1 |
| **v0.12** | Esport Lite | Replay code + Training Gym v1 | share replay, 3 hinty po meczu |
| **v1.0** | Launch | Podpis Win/Linux + polish Core + kryteria promocji | zgodne z `ROADMAP.md` v1.0.0 |

Szacunek do Launch: **~8–12 tygodni** part-time. Fazy 0.7→0.12 sekwencyjne; **v1.0** po walidacji, nie „następny feature”.

---

## Faza 1 — v0.7 Field Energy (tydzień 1–2)

### 1.1 Tryb flagowy: **Ignition Rush**

**Opis:** mecz 7 min; co 90 s **Rush** (piłka szybsza, boost regen ↑, bramki „pulsują” wizualnie 20 s).

| Task | Pliki / moduły | DONE gdy |
|------|----------------|----------|
| Definicja trybu w `GameMode` | `src/game/modes.ts`, `src/game/modePolicy.ts` | `ignitionRush2v2` w enum + policy features |
| Rush state machine | `src/modes/IgnitionRushController.ts` (nowy) | fazy: `normal` ↔ `rush`, eventy na wejście/wyjście |
| Ball speed multiplier | `src/physics/RocketCar.ts`, `Ball` touch | +15–25% max speed piłki w rush (tunable `rlConstants`) |
| Boost regen w rush | `IgnitionManager` lub osobny `RushBoostPolicy` | +30% regen, test w `tests/modes/` |
| Wizual pola | `src/visual/arena.ts`, `stadiumLighting.ts` | hemi + emissive pulse na murawie, bez FPS drop |
| HUD + i18n | `RlHud.ts`, `en.ts` / `pl.ts` | „RUSH!” banner, timer do następnej fazy |
| Menu | `MainMenu.ts`, `LiveMainMenuScene.ts` | karta trybu obok Duel / Ignition |
| Testy | `tests/modes/ignitionRush.test.ts` | rush co N s, ball mult aktywny tylko w fazie |

**Acceptance (Adam):** 3 mecze 2v2 — gracz wie *kiedy* rush bez czytania HUD; mecz „przyspiesza” emocjonalnie w 2. i 4. rush.

### 1.2 **Team Overcharge**

**Opis:** drużyna ładuje pasek od save / dribble / demo; po pełnym — **8 s Overcharge** (jeden aktywnator na drużynę, cooldown).

| Task | Pliki | DONE gdy |
|------|-------|----------|
| Charge model | `src/modes/TeamOvercharge.ts` (nowy) | API: `addCharge(team, reason)`, `trigger()`, `isActive()` |
| Źródła charge | `GameSession.ts`, `BallTouchTracker.ts` | save +0.08, demo +0.12, dribble chain +0.05 (tune) |
| Efekt gameplay | `RocketCar.ts` / power-up layer | np. +10% boost capacity lub krótszy dodge cooldown — **jeden** efekt, nie stack |
| VFX + audio | `goalVfx.ts`, `GameAudio.ts` | team color pulse na murawie, distinct sting |
| HUD | `RlHud.ts` | pasek per drużyna pod scoreboard |
| Sync multiplayer | `server/protocol.ts`, guest reconcile | charge % replicated, trigger authoritative host |

**Acceptance:** overcharge nie stackuje z Ignition power-up w sposób broken; `npm run audit:physics` pass.

### 1.3 Ignition Zones (MVP — 2 strefy)

**Opis:** 2 plamy na boisku; **buff tylko w środku**. Po wyjechaniu strefa znika i respawnuje w losowym miejscu (poza boost padami).

| Strefa | Efekt |
|--------|--------|
| Low Grav | mniejsza grawitacja auta |
| Magnetic | mini-magnet na piłkę (słabszy niż power-up) |

| Task | Pliki | DONE gdy |
|------|-------|----------|
| Spawn layout | `src/modes/IgnitionZones.ts` | 2 strefy, nie kolidują z boost padami |
| Trigger + relocate | `GameSession`, `IgnitionZoneVfx` | leave → `relocateZone`, VFX refresh |
| Balance | `tests/modes/ignitionZones.test.ts` | buff nie permanent; respawn po leave |

**Scope cut:** max 2 strefy w v0.7; reszta w v0.11 jako mutatory.

---

## Faza 2 — v0.8 Body Identity (tydzień 2–3)

**Zasada:** kosmetyk = build. `CarCatalog.bodyStyle` już istnieje — dodać **data-driven hooks**, nie hardcode per `carId`.

### Mapowanie styl → hook

| `bodyStyle` | Hook (kod) | Efekt (tunable) |
|-------------|------------|-----------------|
| `wide` | `RamHit` | +8% impulse przy frontal hit & v < 1200 uu/s |
| `low` | `AeroSnap` | +12% curve po wallride exit |
| `hatch` | `PivotBoost` | dodge input threshold −15% przy v < 900 |
| `tall` | `ShockwaveDemo` | radial impulse po demolce (wizual + lekki knockback) |
| `standard` | — | baseline octane |

| Task | Pliki | DONE gdy |
|------|-------|----------|
| Registry | `src/meta/carBodyTraits.ts` (nowy) | `getTraitsForCar(carId)` z catalog `bodyStyle` |
| Apply w fizyce | `rlContacts.ts`, `RocketCar.ts` | hooki wywoływane w jednym miejscu |
| UI opis w garażu | `LoadoutOverlay.ts`, i18n | 1 linia „Cecha: …” na karcie auta |
| Testy | `tests/meta/carBodyTraits.test.ts` | wide vs low różny wynik w fixture contact |

**Acceptance:** Adam blind test 1v1 — rozpoznaje wide vs low w 5 min bez czytania opisu.

**Anti-pattern:** NIE zmieniać `RL_CAR.mass` per auto — tylko mnożniki kontaktu / input.

---

## Faza 3 — v0.9 Broadcast (tydzień 3–4)

### 3.1 Match Director

**Opis:** auto-kamera na momenty: gol, epic save, demo, flip reset (już wykrywane w `matchMoments.ts`).

| Task | Pliki | DONE gdy |
|------|-------|----------|
| Director FSM | `src/visual/matchDirector/MatchDirector.ts` (nowy) | priorytety: goal > save > demo > flip |
| Integracja kamery | `cameraFollow.ts`, `GameSession.ts` | blend 0.4s, powrót do chase |
| Settings | `SettingsOverlay.ts` | „Cinematic camera: on / reduced / off” |
| Test | `tests/visual/matchDirector.test.ts` | nie triggeruje 2× w 2 s |

### 3.2 Goal Spectacle v2

Rozszerzyć istniejący `goalSpectacle.ts` + `goalVfx.ts`.

| Task | DONE gdy |
|------|----------|
| Orbit 180° wokół piłki | kamera w `GoalSpectacle.getCameraPose()` |
| Team grade flash | `cinematicPostFx.ts` pulse 0.6 s |
| Loadout-aware FX | `goalExplosion` z loadoutu gracza strzelającego |
| Skip (hold Space) | spectator / scorer skip po 1 s |

**Acceptance:** gol w 2v2 — wszyscy widzą tę samą sekwencję (host authoritative).

---

## Faza 4 — v0.10 Pit & Collection

### 4.1 Showcase Pit (garaż)

| Task | Pliki | DONE gdy |
|------|-------|----------|
| Team row 3 aut | `GarageOverlay.ts` / `LiveMainMenuScene.ts` | 3 sloty dla party (local preview) |
| Slot focus | klik karta → obrót showcase na to auto | |
| Thumbnail fix | `carThumbnail.ts` | kolory z GLB, brak cyan (w toku) |

### 4.2 Collection / provenance

| Task | Pliki | DONE gdy |
|------|-------|----------|
| Schema | `PlayerInventory.ts` + migration | `item.provenance: { source, arenaId?, season? }` |
| Crate reveal | `CrateRevealOverlay.ts` | „Zdobyto w: …” |
| Collection UI | nowy `CollectionOverlay.ts` lub zakładka w garażu | grid + filtr rarity |

**Acceptance:** każdy nowy unlock zapisuje provenance; stare itemy = `unknown`.

---

## Faza 5 — v0.11 Community Loop

### 5.1 Weekly Mutator

| Task | DONE gdy |
|------|----------|
| `data/content/weekly-mutators.json` | ✅ rotacja 7 mutatorów |
| `MutatorRegistry.ts` | ✅ cube / low grav / giant / double boost (+3) |
| Menu badge | ✅ „Mutator tygodnia” na karcie Lab |
| Lokalny seed | ✅ `isoWeekKey` — ten sam mutator w tygodniu |

### 5.2 Duel Contracts

| Task | DONE gdy |
|------|----------|
| Challenge flow | ✅ `MultiplayerLobby` → BO3, fixed car |
| Reward | ✅ gwarantowany rare+ (`rollCrateItem` pity) |
| Persist | ✅ `PlayerInventory.duelContract` |

---

## Faza 6 — v0.12 Esport Lite (backlog)

| Feature | Pliki | Uwagi |
|---------|-------|-------|
| Replay file export | `GameSession` snapshot stream | deterministyczny input log |
| Replay code share | 6-znakowy kod, import w menu | |
| Training Gym | `MatchCoachTracker` + `CoachHintsOverlay` | ✅ v1: whiff / boost waste / late save |

---

## Faza 7 — v1.0 Launch

Zgodne z [`ROADMAP.md`](../ROADMAP.md): podpis Win/Linux, DOWNLOADS, stabilne 2v2, polish Core po walidacji Experimental.

---

## Zależności techniczne (nie blokują startu v0.7)

| Bloker | Status | Akcja |
|--------|--------|-------|
| Regen 8 aut Trellis | w toku | `npm run trellis:regen-cars` |
| Miniatury garażu | w toku | `loadCarThumbnailModel`, cache bump |
| 2v2 desync | częściowo | snapshot co 2 ticki — test przed Overcharge sync |
| VPS relay | opcjonalny | v0.7 działa local + LAN |

---

## Metryki sukcesu (vs „kolejny RL”)

| Metryka | Cel przy Launch (v1.0) |
|---------|------------------------|
| „W czym to inne niż RL?” | 80% playtesterów wymienia Rush / Overcharge / body trait |
| Highlight rate | ≥1 „wow moment” / mecz (director + spectacle) |
| Session length | +20% czas w garażu vs tylko mecz (collection, v0.10+) |
| Retention D7 | baseline + mutator tygodnia (v0.11+) |

---

## Kolejność implementacji (skrót)

```
DONE:     v0.7 Rush/OC/Zones → v0.8 bodyTraits → v0.9 Director → v0.10 Pit → v0.11 Lab/Duel
NOW:      polish Core + Experimental mechanics (bez Meridian)
NEXT:     Training Gym v1 (hinty) → Replay code
Launch:   podpis + polish Core                              (v1.0)
```

---

## Powiązane dokumenty

- `ROADMAP.md` — wersje techniczne, asset pipeline, release / Launch
- `docs/CONTENT-SYSTEM.md` — Trellis / catalog
- `data/content/cars.design.json` — prompty aut

*Utworzono: 2026-07-16 · product pass po audycie garażu / Trellis regen · renumber 2026-07-16 (1.0 = Launch)*
