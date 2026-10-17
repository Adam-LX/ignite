# Roadmap — mechanika, boty, oświetlenie

**Komercja (S0–S1):** [`STEAM-LAUNCH.md`](STEAM-LAUNCH.md) — ten plik = szczegół P0 feel/boty/light pod „dobrą grę”.

Ostatni baseline: `npm run probe:matches`, `npm run audit:wall-ceiling`, `npm run audit:ball`, `npm run audit:menu-orbit`.

**Online:** party lobby + pre-match; fill bots **opt-in**; ranked 1v1/2v2 — `docs/MP_RELAY.md`.

---

## 1. Mechanika i fizyka jazdy (P0)

| Krok | Cel | Diagnostyka |
|------|-----|-------------|
| **A. Grip / powerslide** | Sticky bez Shift + czytelny slide + soft exit (~0.14 s) — `audit:grip` PASS | `npm run audit:grip` |
| **B. Jump / dodge consistency** | Drugi skok, flip cancel, timing okien — bez ghost inputów | `audit:dodge`, `audit:second-jump` |
| **C. Wall→ceiling fillet** | Cove 45° + **quarter-pipe** (sin/1−cos, steps=12) — `audit:wall-ceiling` PASS | `npm run audit:wall-ceiling` |
| **D. Ball–car contact** | Soft dribble + Psyonix impulse + CR≈0.6 — `audit:ball` | `npm run audit:ball` + `ballBalance` |
| **E. Camera–physics sync** | Chase nie „z góry” po menu — `audit:chase` PASS (2026-07-18) | `audit:chase`, `audit:chase:survey` |

**Metryka sukcesu:** gracz czuje boost + wall-ride + short ceiling stick; zero unexplained launches.

---

## 2. Boty (P0/P1)

| Krok | Cel | Diagnostyka |
|------|-----|-------------|
| **A. Strzał / scoring** | **Zrobione (2v2):** attacking-third punch + near-net dodge + striker always ALIGN (team≥2); seed55 goals ~0.6 | `probe:matches -- --mode 2v2` + `zero_scoring` |
| **B. Recovery fail** | **Zrobione:** air-roll + snap tylko przy klinie (1.65s) + grounded po reset; 2v2 recFail ~3% | probe `recoveryFailRate` < 20% |
| **C. Boost economy** | **Zrobione:** pady włączone w katalogu areny + probe; seeks/pickups żywe | probe `avgBoostFuel`, `padSeeks` |
| **D. Role 2v2/3v3** | **Zrobione (2v2):** MatchProbe + goalie shadow; striker finish bez pad divert w 1/3 ataku | `probe:matches -- --mode 2v2` + `goalie_ball_chase` |
| **E. Sytuacje** | **Częściowo:** backboard + 50/50 + demo avoidance (lateral) — dopracowanie później | `BotBehavior` + `backboardClear.test` |

**Metryka sukcesu:** gole z sensownych podejść; FSM `AERIAL` < 8 s/min; brak `zero_scoring`.

---

## 3. Oświetlenie stadionu (P1)

| Krok | Cel | Diagnostyka |
|------|-----|-------------|
| **A. Menu = match lighting language** | Orbita stadionu (zrobione: bez dronów/atmosfery/snopów, neon lineBoost fix, ekspozycja ×0.88) | `audit:menu-orbit` + hotFrac |
| **B. Anti-blind w meczu** | Soft ceiling flare (tonemap 3.4, clamp 0.26) — 2026-07-18 | chase survey PNGs; `lensFlarePost` |
| **C. Dynamic crowd / surge** | **Zrobione:** goal_wave 2-fazowy rytm LED/jupiter + inne surges | `crowdSurge.ts` + capture |
| **D. Arena catalog presets** | **Zrobione:** `neonAccent` + `lightingProfile` per mapa (dusk/night) | przełączanie areny w menu |
| **E. Night vs dusk profiles** | **Zrobione:** `LIGHTING_FILM_DUSK`/`NIGHT` + `sampleLightingFilm` blend | `tests/visual/lightingFilm.test.ts` |

**Metryka sukcesu:** menu i mecz wyglądają jak ten sam stadion; czytelność piłki/auta w każdym kadrze chase.

---

## Kolejność rekomendowana (2–3 sprinty)

1. ~~Fizyka A (grip) + boty B (recovery)~~ **done**
2. ~~Fizyka B (dodge) + boty A+C (finish, boost) + oświetlenie B (anti-blind)~~ **done 2026-07-18**
3. ~~Wall/ceiling C~~ + ~~boty D~~ + ~~oświetlenie D/E~~ **done 2026-07-18** → **boty E / polish Core**

Każdy krok: najpierw rozszerz / odpal skrypt diagnostyczny → FINDINGS → patch → re-probe.
