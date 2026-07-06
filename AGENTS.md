# AGENTS.md

## Cursor Cloud specific instructions

Ignite is a browser car-soccer game (TypeScript · Vite · Three.js · Rapier3D). Node 22 is
preinstalled; `nix` is **not** available in the Cloud VM, so ignore the `nix develop` steps in
`README.md` — run the `npm` scripts directly. Dependencies are installed by the startup update
script (`npm install`).

### Services

| Service | Command | Endpoint | Notes |
|---------|---------|----------|-------|
| Game (dev) | `npm run dev` | http://localhost:5173 | Vite dev server, HMR. `predev` bakes `public/donation.json`; missing `data/donation.env` is fine (fork/CI). Vite `open: true` tries `xdg-open` — harmless in headless. |
| Multiplayer room server (optional) | `npm run mp:server` | `ws://localhost:8765` (+ `GET /policy`) | Only needed for Online 1v1 / bot-policy federation. Not required to play solo. |

### Test / build

- Tests: `npm test` (vitest, node env; RAPIER is initialized in `tests/setup.ts`).
- Build: `npm run build` = `tsc && vite build && npm run diagnostic`. The `diagnostic` step runs
  headless-browser autopilot scripts (Playwright); use `npm run build:web` (`tsc && vite build`) for a
  plain build without the diagnostic.

### Lint gotcha (important)

`biome.json` targets Biome **v2** (schema 2.x, uses `includes`/`assist` keys), but
`devDependencies` pins `@biomejs/biome@1.9.2`. The intended dev shell (`flake.nix`) supplies Biome v2
from nixpkgs. Because `nix` is absent here, `npm run lint` (and the `lint-staged` pre-commit hook via
`scripts/lint-staged-biome.sh`) fail with `unknown key includes/assist`. Lint with a v2 binary instead:

```bash
npx --yes @biomejs/biome@2 check ./src        # add --write to auto-fix
```

### Hello-world check

Open http://localhost:5173, pick "1V1 Duel" and click "HIT THE PITCH", then drive with W/A/D + Space —
the car should move and hit the ball.
