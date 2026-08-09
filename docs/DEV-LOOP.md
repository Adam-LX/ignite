# Dev loop — feel + silnik (podejście C)

Krótka pętla pracy nad Ignite bez monorepo. Mapa silnika: [`ENGINE.md`](ENGINE.md).

## Codziennie

1. **Graj** (`npm run start` / desktop).
2. **F9** — max 30 s clip → `data/gameplay-clips/latest.*` (+ kopia w `~/Wideo`).
3. **`npm run clip:review`** — klatki w `_frames/review-*.jpg` + skrót inputu.
4. **Fix** w `src/engine/` (generyczne) lub warstwie gry (`game/`, `physics/`, `visual/`).
5. **`npm run feel:gate`** — wąski zestaw auditów S0 przed uznaniem za OK.

Na czacie wystarczy „zobacz klip” / „dziwne obserwacje” — agent bierze ten sam folder (reguła F9).

## Skrypty

| Komenda | Co robi |
|---------|---------|
| `npm run clip:review` | latest F9 → frames + `latest.review.json` |
| `npm run feel:gate` | `audit:ball` + grounding/camera unit tests (S0 feel) |
| `npm run audit:*` | pojedyncze diagnostyki (grip, dodge, wall-ceiling, …) |
| `npm run probe:matches:smoke` | szybki probe meczowy |

## Gdzie kod

- Wejście / clip / asset URL / graphics profile → `src/engine/`
- Sesja meczu (HUD / net / VFX juice / sim helpers) → `src/game/session/`
- Boot clip + deps → `src/boot/`
- Feel auta → `src/physics/RocketCar.ts`, `src/visual/CarGrounding.ts`, `cameraFollow.ts`

## Nie rób teraz

- `packages/engine` monorepo
- Wynoszenie RocketCar / soccar do silnika
