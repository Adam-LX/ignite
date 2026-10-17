# Prematch / kickoff freezes — playbook dla agentów

> Hub widowiska (look, warmup, audio, preferencje): [`PREMATCH_SHOW.md`](PREMATCH_SHOW.md)
>
> **Dla NixBot / Cursor cloud / każdego agenta:** czytaj to ZANIM ruszysz show, RT, smoke, lasers lub `primeArenaVisuals`.
> Runtime dump: `window.__ignitePrematchHitch` (DEV lub `?hitchProbe=1`).

## Objaw

Klatki ≥50 ms (hitch), ≥100 ms (severe), ≥250 ms (freeze) podczas:

1. **Prematch stadium show** (~24 s) — zwłaszcza cue DROP (~u=0.5)
2. **Teardown → dispose** tuż po show
3. **Countdown / kickoff** — `snapChase` + `primeArenaVisuals` + późny RT invalidate

## Repro

```text
npm run start
# opcjonalnie: ?hitchProbe=1  (force logi)
# A/B bez show: ?skipShow=1 lub ?noshow=1
Start meczu → oglądaj show (DROP) → countdown → pierwsze sekundy gry
Konsola: [hitchProbe] FREEZE|SEVERE|hitch …
Po show/prime: window.__ignitePrematchHitch
```

Thresholds = `src/diagnostic/frameStats.ts` + `prematchHitchProbe.ts`.

## Timeline (nominalnie)

| Wall | Faza probe | Co się dzieje | Hot files |
|------|------------|---------------|-----------|
| T+0 | `show_construct` | Alloc laser/smoke/wash/scanners/pyro | `PreMatchStadiumShow.ts` ctor |
| T+0…24s | `show_run` → cues | RAF show (NIE `gameLoop`) — **tu earlier nie było `noteFrameTime`** | `PreMatchStadiumShow.run` |
| u≈0.12 | `show_cue_build` | Build lasers / wash | `StadiumLaserRig`, `StadiumColorWash` |
| u≈0.32 | `show_cue_liquid` | Liquid sky parallel beams | `StadiumLaserRig` |
| u≈0.50 | `show_cue_drop` | **Hero DROP** — pyro, flash, scanners punch | `StadiumShowPyro`, scanners, FX |
| u≈0.70 | `show_cue_rain` | Celebration rain / grid | lasers |
| end | `show_teardown` | `beginTeardown` + yield 2 frames | soft hide overlay |
| +2f | `show_dispose` | Sync `*.dispose()` ShaderMaterials | wszystkie show modules |
| +2f | RT unsuspend | `setRealtimeRtSuspended(false)` | `Renderer` / RT director |
| next | `post_show_snap` | `snapChaseCamera` + present resync | `Renderer.ts` |
| +2f | `countdown_prime` | `primeArenaVisuals` (pads/juice/weather/commentator) | `GameSession.ts` |
| +1.2s | (jumbotron) | **YT mount odłożony** — nie w prime hot frame | `jumbotronFeed.ts` |
| +5.5s | RT invalidate | CubeCamera/PMREM/BVH — **celowo late** | `IgniteRtDirector.ts` |

## Znane root causes (kolejność prawdopodobieństwa)

1. **Show RAF poza `gameLoop`** — bez probe hitche w show były niewidoczne dla `frameStats` / PlayerReport.
2. **DROP cue** — burst pyro + smoke + flash + scanner + laser mode switch w jednej klatce.
3. **Sync dispose** wielu ShaderMaterial / SpotLight / billboard textures po show (nawet po soft teardown).
4. **`primeArenaVisuals`** — BoostPadVfx + IgnitionZoneVfx + weather + commentator; wcześniej też **sync YT jumbotron** (teraz +1.2 s).
5. **`resyncPresentAfterCameraSnap` / snapChase** zaraz po dispose.
6. **`IgniteRtDirector` env bake / BVH** jeśli invalidate za wcześnie (obecnie 5.5 s po show).
7. Construct show (laser rig ~24 beams + smoke textures) na pierwszym ticku.

## Co już próbowano

- **`loading.status.gpuHeavy`**: show (wszystkie akty + pyro/smoke) + gameplay VFX + `warmupArenaGpu` (pads/juice) + 1 klatka RT, budget ~6s
- **`warmupPrematchShowGpu` w loadingu meczu** (`loading.status.prematchShaders`) — `compile` + ciche klatki zanim zniknie loading; show na starcie pomija ciężki prewarm jeśli już warm
 (nie cofaj bez pomiaru)

- Smoke pool 180→64, rarer emit, puff co 2 klatki
- Pyro głównie wokół DROP; gobos 6→2
- Half-rate wash/jupiter/energy/fx; side lasers co 2f poza liquid/DROP
- `beginTeardown` → yield 2 → **chunked `disposeAsync`** (3 GPU batches + yield) → yield 1 → unsuspend RT
- RT invalidate @ 5.5 s; `primeArenaVisuals` pads first, weather/commentator deferred (+1/+2 rAF)
- Jumbotron YT mount @ +1.2 s po prime (2026-09)
- Chromatic lasers + bloom preserve-color (look, nie hitch)

## Instrumentacja

| API | Plik |
|-----|------|
| `beginPrematchHitchProbe` / `notePrematchHitchTick` / `setPrematchHitchPhase` / `endPrematchHitchProbe` | `src/diagnostic/prematchHitchProbe.ts` |
| Global dump | `window.__ignitePrematchHitch` |
| Agregaty meczu | `frameStats.ts` → PlayerReport / matchSessionMonitor |
| Force ON | `?hitchProbe=1` lub `localStorage.ignite-hitch-probe=1` |
| DEV | probe ON domyślnie |

Fazy w dumpie `byPhase` + `suspects[]` wskazują następny patch.

## Reguły zmian (dla cloud agent / PR)

1. **Zmierz najpierw** — 1 przejście z probe, wklej `byPhase` / top events do PR.
2. **Jeden hotspot na PR** (np. tylko DROP pyro LUB tylko dispose) — nie mieszaj look + hitch.
3. **Nie przywracaj sync jumbotron / early RT invalidate** bez A/B `?skipShow=1`.
4. Prematch look (lasers/title) = lokalnie NixBot, o ile Adam nie każe inaczej.
5. Po fixie: dump powinien mieć `freezeCount=0` i `severe` tylko sporadycznie na DROP jeśli GPU weak.

## Hot files (checklist)

- `src/visual/preMatchShow/PreMatchStadiumShow.ts`
- `src/visual/preMatchShow/StadiumLaserRig.ts`
- `src/visual/preMatchShow/StadiumShowPyro.ts` / `StadiumShowSmoke.ts` / `StadiumTranceScanners.ts` / `StadiumShowFireworks.ts`
- `warmupPrematchShowGpu` + `loading.status.gpuHeavy` w `main.ts`
- `src/diagnostic/prematchHitchProbe.ts` / `frameStats.ts`
- `src/main.ts` (post-show → countdown)
- `src/game/GameSession.ts` (`primeArenaVisuals`)
- `src/visual/pathTracing/IgniteRtDirector.ts`
- `src/Renderer.ts` (`resyncPresentAfterCameraSnap`)

## Szybki triage

```text
severe tylko w show_cue_drop     → pyro/smoke/flash budget
severe w show_dispose            → split dispose / more yields / dispose GPU async
severe w countdown_prime         → split prime; check pads/juice (YT już deferred)
freeze ~5s po starcie meczu      → RT invalidate / PMREM
brak eventów w show, są w match  → show tick bez notePrematchHitchTick (bug)
?skipShow=1 czysto, z show nie   → winny show path
```
