# Engine vs game (podejście C)

Ignite rośnie w **jednym repo**. Warstwa `src/engine/` to powierzchnia API pod późniejszy extract — **bez** monorepo / osobnego pakietu na razie.

## Reguła importów

| Kierunek | OK? |
|----------|-----|
| `game` / `modes` / `meta` / `ai` / `ui` → `engine` | tak |
| `engine` → `game` / `modes` / `meta` / `menu` / soccar `ai` | **nie** |
| `engine` → `util/*` (legacy helpers) | tymczasowo OK (np. `gamepadLayout`, `rlConstants`) |
| Stare ścieżki `src/util/{GameInput,assetUrl,…}` | re-export deprecated → `engine` |

## Co jest silnikiem

| Obszar | Ścieżka | Uwagi |
|--------|---------|--------|
| Asset URL, graphics profile | `src/engine/core/` | przeniesione |
| Scene / GameObject / Renderer | re-export z roota w `core/` | move później |
| Input | `src/engine/input/` | GameInput, ControlInput |
| Clip F9 | `src/engine/clip/` | GameplayClipRecorder |
| Audio core | `src/engine/audio/` | re-export GameAudio |
| Diag constants | `src/engine/diag/` | ścieżki clipów |

## Co zostaje grą (Ignite)

- `src/game/` — GameSession, CarEntity, tryby meczu
- `src/physics/RocketCar.ts` — feel auta soccar
- `src/modes/`, `src/meta/`, `src/ai/` (taktyki piłkarskie)
- `src/net/` ranked / lobby, menu CSS, garage
- `src/visual/soccarShell/`, gole, arena manifests

## Checklista: czy to idzie do silnika?

1. Czy drugi projekt (nie car-soccer) mógłby tego użyć bez wycinania Ignite?
2. Czy nie ciągnie `modes` / `meta` / `PlayerInventory` / ranked?
3. Czy API da się opisać bez „piłka / gol / boost pad”?

Jeśli 3× tak → `src/engine/`. Jeśli nie → warstwa gry.

## DX

- `npm run clip:review` — ostatni F9 → klatki + skrót
- `npm run feel:gate` — wąski zestaw auditów S0
- `npm run assets:studio` — prosty edytor slotów aren ([ASSET-STUDIO.md](ASSET-STUDIO.md))
- Pętla: [`docs/DEV-LOOP.md`](DEV-LOOP.md)

## Później (nie teraz)

- `packages/engine` monorepo
- Wynoszenie RocketCar / soccar goals
