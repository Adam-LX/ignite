# Roadmap — mechanika, boty, oświetlenie

Ostatni baseline diagnostyki: `npm run probe:matches`, `npm run audit:wall-ceiling`, `npm run audit:ball`, `npm run audit:menu-orbit`.

**Online:** party lobby + pre-match pads; wszystkie tryby menu (bot-fill); ranked 1v1/2v2 — `docs/MP_RELAY.md`.

---

## 1. Mechanika i fizyka jazdy (P0)

| Krok | Cel | Diagnostyka |
|------|-----|-------------|
| **A. Grip / powerslide** | Sticky bez Shift + czytelny slide + soft exit (~0.14 s) — `audit:grip` PASS | `npm run audit:grip` |
| **B. Jump / dodge consistency** | Drugi skok, flip cancel, timing okien — bez ghost inputów | `audit:dodge`, `audit:second-jump` |
| **C. Wall→ceiling fillet** | Cove 45° + **quarter-pipe** (sin/1−cos, steps=12) — `audit:wall-ceiling` PASS | `npm run audit:wall-ceiling` |
| **D. Ball–car contact** | Soft dribble + Psyonix impulse + CR≈0.6 — `audit:ball` | `npm run audit:ball` + `ballBalance` |
| **E. Camera–physics sync** | Chase nie „z góry” po menu; FOV vs prędkość | `audit:chase`, `audit:chase:survey` |

**Metryka sukcesu:** gracz czuje boost + wall-ride + short ceiling stick; zero unexplained launches.

---

## 2. Boty (P0/P1)

| Krok | Cel | Diagnostyka |
|------|-----|-------------|
| **A. Strzał / scoring** | Shadow + przebicie już podniesły gole (~0.7/mecz) — dopracować 50/50 kickoff i finish w polu karnym | `probe:matches` + alert `zero_scoring` |
| **B. Recovery fail** | **Zrobione:** air-roll (Shift) w recovery — fail **39% → 2%** | probe `recoveryFailRate` < 20% |
| **C. Boost economy** | Pady w Core; pad seek gdy fuel niski; mniej waste na aerial | probe `avgBoostFuel`, `padSeeks` |
| **D. Role 2v2/3v3** | Support nie goni tej samej piłki; goalie shadow | probe strefy `goal` / `mid` per role |
| **E. Sytuacje** | Backboard clear, 50/50, demo avoidance (później) | nowe case’y w `MatchProbeRunner` |

**Metryka sukcesu:** gole z sensownych podejść; FSM `AERIAL` < 8 s/min; brak `zero_scoring`.

---

## 3. Oświetlenie stadionu (P1)

| Krok | Cel | Diagnostyka |
|------|-----|-------------|
| **A. Menu = match lighting language** | Orbita stadionu (zrobione: bez dronów/atmosfery/snopów, neon lineBoost fix, ekspozycja ×0.88) | `audit:menu-orbit` + hotFrac |
| **B. Anti-blind w meczu** | Jupiter/flare nie wybielają chase cam | chase survey PNGs; `lensFlarePost` soft ceiling |
| **C. Dynamic crowd / surge** | LED perimeter + jupiter pulse przy golu już częściowo — spójny rytm | ręcznie + capture |
| **D. Arena catalog presets** | Każda arena: własny `neonAccent` / sky bez łamania ekspozycji | przełączanie areny w menu |
| **E. Night vs dusk profiles** | 2 profile `LIGHTING_FILM` z smooth blend | toggle + screenshot pair |

**Metryka sukcesu:** menu i mecz wyglądają jak ten sam stadion; czytelność piłki/auta w każdym kadrze chase.

---

## Kolejność rekomendowana (2–3 sprinty)

1. ~~Fizyka A (grip) + boty B (recovery)~~ **done**
2. **Fizyka B** (dodge) + **boty A+C** (finish, boost) + **oświetlenie B** (anti-blind)
3. **Wall/ceiling C** + **boty D** + **oświetlenie D/E**

Każdy krok: najpierw rozszerz / odpal skrypt diagnostyczny → FINDINGS → patch → re-probe.
