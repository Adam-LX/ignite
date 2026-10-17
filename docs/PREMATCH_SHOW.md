# Prematch stadium show — hub dla agentów

> **Obowiązkowe** dla NixBot, Cursor cloud i każdego agenta ruszającego widowisko przed meczem, audio prematch, hitch/freeze, GPU warmup lub look (lasery/pyro/fireworks).
>
> Freeze playbook szczegółowy: [`PREMATCH_KICKOFF_FREEZE.md`](PREMATCH_KICKOFF_FREEZE.md)  
> Cursor rules: `.cursor/rules/ignite-prematch-show.mdc`, `.cursor/rules/ignite-prematch-freeze.mdc`

## Preferencje właściciela (Adam)

- Praca nad **prematch / look show**: edycja **lokalna** (NixBot na maszynie `nixos`), **nie** Cursor cloud — chyba że Adam każe inaczej.
- Cloud PR-y OK były dla garage / grass bump / RL physics — nie dla redesignu show.
- Komunikacja PL; czytelność boiska > mleczny bloom wash.
- Tytuł widowiska: **IGNITE ARENA**.

## Co to jest

~24 s widowisko stadionowe przed countdownem (local + host online). Własny RAF (poza `gameLoop`). Skip: klawisz / LMB / skok po 0.35 s. Wyłączenie: `?skipShow=1` / `?noshow=1` / `__igniteSkipPreMatchShow`.

Skrócony show diagnostyczny: `?showSec=8` (2–60).

## Architektura (hot files)

| Rola | Plik |
|------|------|
| Orchestrator | `src/visual/preMatchShow/PreMatchStadiumShow.ts` |
| Lasery (akty spatial) | `StadiumLaserRig.ts` |
| Color wash | `StadiumColorWash.ts` |
| Scannery trance | `StadiumTranceScanners.ts` |
| Pyro | `StadiumShowPyro.ts` |
| **Fireworks (aerial)** | `StadiumShowFireworks.ts` |
| Smoke | `StadiumShowSmoke.ts` |
| Jupiter / energy / FX | `StadiumJupiterShafts.ts`, `PitchEnergyField.ts`, `StadiumShowFx.ts` |
| Start meczu + GPU warm | `src/main.ts` (`loading.status.gpuHeavy`) |
| Arena juice warm | `GameSession.warmupArenaGpu` |
| Hitch probe | `src/diagnostic/prematchHitchProbe.ts` |
| Frame stats | `src/diagnostic/frameStats.ts` |
| Audio bed (procedural 138 BPM) | `GameAudio.startPrematchTranceBed` / `getPrematchTrancePulse` |
| i18n fazy | `src/i18n/locales/pl.ts` / `en.ts` (`prematch.*`) |
| Overlay CSS | `src/style.css` (`.prematch-show*`) |

## Choreografia (show-U)

| u | Faza UI | Wizual |
|---|---------|--------|
| 0–0.12 | BLACKOUT | deep blackout, scanners build |
| 0.12 | TEAM SPLIT | build slam, pyro, early fireworks |
| 0.32 | LIQUID SKY | parallel aerial lasers |
| **0.50** | **IGNITE DROP** | flash, `pulseSpectacle`, pyro stagger, **fireworks barrage** |
| 0.70 | FIREWORKS | celebration lasers + salwy |
| →1 | KICKOFF | settle cam → chase |

Cue constants: `CUE_BUILD/LIQUID/DROP/RAIN/BALL` w `PreMatchStadiumShow.ts`.

## Look — ważne decyzje

- **Chromatic lasers** + `setLaserShowPreserveColor(true)` — bez white-crush z additive + bloom.
- **Nie** wracać do midfield knot / tęczowego tunelu na środku.
- Spatial: TEAM SPLIT halves, LIQUID SKY parallel, goal curtains, celebration grid.
- Bloom: `bloomBias` w atmosfere **do ~0.055** (kiedyś cap **0.012** = mdły look — nie przywracać).
- DROP: `pulseSpectacle`, mocny flash CSS, FOV/shake; pyro+fireworks **staggerowane** (hitch).
- Tytuł duży + glow; fazy climax/rain w złotym kolorze CSS.

## GPU warmup (loading meczu)

Status: `loading.status.gpuHeavy` (~6 s budget, `Promise.race`).

Kolejność w `main.ts` (local + online):

1. `warmupPrematchShowGpu` — construct show (overlay ukryty), `compile` + silent sample **wszystkich aktów** + pyro/smoke/fireworks + optics spike, potem dispose (programy WebGL zostają w cache).
2. `warmupGameplayGpu` — ball/hit/wall/power-up (2 klatki).
3. `session.warmupArenaGpu` — pads, ignition, juice (sparks/turf/demo/shockwave/flip/ground marks), goal spectacle (reduced), **deszcz on→off**.
4. 1 klatka RT (unsuspend → render → suspend).

Jeśli warm OK: show **pomija** ciężki `prewarm()` (`prematchShowGpuWarmed`).

Jumbotron YT: **+1.2 s** po `primeArenaVisuals` (nie w hot frame).  
RT invalidate po show: **+5.5 s** (nie wcześniej).

## Hitch / freeze

Pełny playbook: [`PREMATCH_KICKOFF_FREEZE.md`](PREMATCH_KICKOFF_FREEZE.md).

- Probe ON w DEV lub `?hitchProbe=1` / `localStorage.ignite-hitch-probe=1`.
- Dump: `window.__ignitePrematchHitch` / `__igniteGetPrematchHitch()`.
- Capture script: `scripts/_hitch-probe-capture.mjs` (Playwright; SwiftShader ≠ real GPU — ranking faz jest sygnałem).
- Show RAF musi wołać `notePrematchHitchTick` — inaczej `frameStats` nie widzi show.

## Audio prematch

### Czego chce Adam (korekta 2026-09)

- **Nie** refren DJ Sammy „Heaven” / sample wokalu Do.
- **Tak:** **chórowe wstawki w stylu Hardwella** (festival „ahh” / choir stabs na DROP) — to grało w tle momentu z [TML 2026 ~23:18](https://youtu.be/Py-GG74lLU8?t=1398).
- Implementacja: `GameAudio.playStadiumShowChoir` (synteza formantowa + echo trybun), wołane na BUILD / DROP / FIREWORKS. **Nie rip** z YT/setu.

### Bed muzyczny

- `prematch_heaven_bed.mp3` — nadal oryginalny euphoric bed (140 BPM, gain ≈ 0.92) jako podkład; nazwa historyczna.
- Pulse laserów: `getPrematchTrancePulse()` @ 140.
- Commentary przyciszone pod bedem.
- **Zakaz:** ripować YouTube / sety Hardwell / stemmy.


## Query / debug cheatsheet

| Param | Efekt |
|-------|--------|
| `?hitchProbe=1` | force hitch logi + dump |
| `?skipShow=1` / `noshow=1` | bez widowiska (A/B kickoff) |
| `?showSec=N` | skróć show do N sekund |
| `?autostart=1v1&skipIntro=1` | od razu mecz (E2E / capture) |
| `?graphics=low\|medium\|high` | quality |

## Zasady zmian (dla cloud / PR)

1. Prematch look → lokalnie, o ile Adam nie każe cloud.
2. Jeden hotspot na PR (look **albo** hitch — nie mieszać bez potrzeby).
3. Po hitch fixu: dump `byPhase` w opisie.
4. Nie cofaj: deferred jumbotron, RT @5.5s, GPU heavy warm, bloom cap ~0.055, spatial choreo bez midfield knot.
5. Nowe VFX show: **pool + dispose**, sample w `warmupPrematchShowGpu` / `prewarm` silent.

## Historia skrótowa (2026-09)

- Redesign IGNITE ARENA → color wash → spatial (no knot) → trance scanners → fireworks + odblokowany bloom.
- Hitch: probe, deferred dispose, smoke/pyro cuts, GPU warm w loadingu.
- Cloud PRs (osobno): garage yaw #2, grass bump #3, RL physics #4.

## Kickoff countdown typography (HUD)

Adam (2026-09): **nie** wielkie cyfry / hollow Outer Glow jako główny look.

**Tak:** naprzemienne **napisy** (slide left / slide right) z literami o fill jak boot/loading bar:

| tick | napis | slide |
|------|-------|-------|
| 5 | IGNITE (`hud.kickoffEyebrow`) | left (nieparzysty) |
| 4 | ARENA (`hud.kickoffArena`) | right |
| 3 | READY | left |
| 2 | SET | right |
| 1 | FIRE (`hud.kickoffFire`) | left |
| GO | GO | left |

- Fill: `.kickoff-letter__fill` + RGB split (`::before/::after` + `data-ch`), pulse, grubszy stroke.
- Fill layer: `.kickoff-letter__fill` (Ignite logo/emissive/pitch) + `.kickoff-letter__stroke`.
- Wiring: `RlHud.renderKickoffWordBanner` → spany `.kickoff-letter` + `kickoff-slide-left|right`.
- Litery: Orbitron; **max punch / „kosmos”** — animowane wnętrze z Ignite (logo + pitch logo + cyber emissive + cyan/magenta/orange) + **solid outline**.
- **FX w tle liter** (nie w glifie): `.kickoff-word-fx` — bloom, light streaki, ring, iskry; hot na tick 3–1/GO.
- CSS: `#kickoff-banner.kickoff-word` w `src/style.css`.
- `#kickoff-label` = mały hint (numer tick / subtitle).
- OVERTIME / REPLAY: osobne ścieżki.

