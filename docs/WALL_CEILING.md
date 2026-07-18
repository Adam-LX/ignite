# Wall-ride / Ceiling — mechanika

Diagnostyka: `npm run audit:wall-ceiling` → `test-results/wall-ceiling/WALL_CEILING.md`

## Cele (referencja RL)

1. Wjazd z murawy na bandę (rampa → ściana) bez launchu w kosmos.
2. Jazda w górę ściany przy gazie/boost.
3. Przejście ściana → sufit (cove 45°).
4. Przy wysokiej prędkości — chwilowe trzymanie na suficie.

## Fizyka auta (`RocketCar`)

| Problem | Fix |
|---------|-----|
| `normal.y < 0 → negate` | Normalna = przeciw rayDir (sufit OK) |
| `\|up.y\| < 0.7` blokował drive | Wyjątek dla `isOnWallOrRamp()` |
| `isVerticalStand` na ścianie | Wyłączone gdy wall contact (forward.y≈1 = climb) |
| Turtle recovery na suficie | Recovery względem surfaceNormal; brak turtle vs stick |
| Stick | Speed mul + ceiling mul; niższy sep max na suficie; **detach po jump** (bez klejenia) |
| Jump na ścianie | Krótki cooldown; stick/sep-damp wyłączone na `wallJumpDetachSec` |
| Yaw na ścianie | Angvel wokół surfaceNormal |

## Arena — quarter-pipe

Profil rampy (`perimeter/constants.ts`):

- `RAMP_BASE_Y = PLAYFIELD_SURFACE_Y` (0.05) — **bez progu 5 cm** vs murawa
- `rampCurveRun(t) = R·sin(θ)`, `rampCurveHeight(t) = R·(1−cos(θ))`, `θ = t·π/2`
- t=0 styczna pozioma (murawa), t=1 styczna pionowa (ściana)
- `RAMP_CURVE_STEPS = 12`, `RAMP_SIZE ≈ 3.2`
- Mesh + trimesh collider z tych samych funkcji
- Floor collider = **trimesh obwodu** (nie AABB) — AABB nachodził na rampy w cutoutach narożników
- Wall collider = **pełna wysokość** od y=0 (inner face = outer ramp) — dno boxa na `RAMP_TOP_Y` robiło półkę ~y=2.6
- LED-y = farba na powierzchni ćwiartki (bez collidera, bez poziomej półki)

Cove: `CEILING_COVE_RUN` — **ćwiartka trimesh** ściana→sufit (nie box 45°).
Wall collider kończy się na starcie cove (bez nachodzenia). Sufit sięga do `HALF+RAMP`.
- Wall collider: half-extent = `WALL_THICKNESS/2` (pełne THICKNESS wsuwało box w boisko → korek na szwie narożnika).
- Segmenty ścian: zawsze oriented box (także łuki), lekki overlap szwu.
- Stick wymaga gazu/boost (RL): coast → brak kompensacji grawitacji / sep-damp → odklejenie.
- Bramki (wymiary RL): ~17.86×6.43×8.8 m.
- Bramki: płaski wlot (`GOAL_MOUTH_CLEAR`) + ćwiartki w głębi (`GOAL_COVE_RUN`) — wall-ride na tył/sufit jak RL.
- Sufit wizualny: prawie przezroczysty + cienka ramka (widać mecz pod spodem).

Diagnostyka wjazdu: `npm run audit:goal-drive` → `test-results/goal-drive/GOAL_DRIVE.md`
(kryteria: brak wywrotki na linii, climb back wall, climb ceiling).

## Boty

- `botRecovery`: wall ≠ unstable
- `applyWallAvoidance`: nie ściągaj gdy na bandzie / piłka wysoko / szybki wjazd
- Steer powierzchniowy na wall (jak Meridian)
