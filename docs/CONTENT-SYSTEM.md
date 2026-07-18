# Ignite Content System (M5)

System aut i aren — kosmetyka + mapy z własnymi wymiarami, pipeline Gemini → Trellis → gra.

## Zasady

| Obszar | Zasada |
|--------|--------|
| **Auta** | Pełne różnice wizualne, **jeden hitbox Octane** (`RL_CAR`) |
| **Areny** | Własne wymiary, obwód, spawny — fizyka per mapa |
| **Generacja 3D** | Trellis lokalnie (`:8004`) lub Meshy API |
| **Design** | Gemini — prompty i parametry, nie GLB |

## Pliki runtime

```
public/assets/cars/car-catalog.json     — registry aut
public/assets/arenas/arena-catalog.json — registry map
public/assets/arenas/<id>/manifest.json — skórka mapy
src/meta/CarCatalog.ts
src/arena/ArenaCatalog.ts
src/arena/ArenaRuntime.ts               — aktywna mapa (RL_ARENA proxy)
```

## Dodanie auta (Trellis)

```bash
npm run trellis:health
npm run trellis:build-car -- --id muscle --prompt "Wide rocket league car..."
```

Pipeline: Trellis `:8004` → `public/assets/cars/<id>.glb` → Blender prep (1.18 m) → auto-append `car-catalog.json`.

Batch z design JSON:

```bash
npm run content:design          # Gemini → data/content/*.design.json
npm run trellis:batch           # wszystkie locked cars z design
```

## Dodanie mapy

1. Wpis w `public/assets/arenas/arena-catalog.json` (wymiary, preset obwodu, manifest).
2. `public/assets/arenas/<id>/manifest.json` — tekstury, goal GLB.
3. `perimeterPreset: "rlOctagon"` lub `"custom"` + `customEdges[]`.
4. `npm run trellis:sync-arena-manifests` po dodaniu propsów.

Mapy startowe: `standard`, `compact`, `wide`, `vault`.

## Gemini design pass

```bash
npm run content:design
npm run content:design:validate   # bez API — tylko jq
```

Output: `data/content/cars.design.json`, `data/content/arenas.design.json`.

## UI

- **Garaż** — wybór auta, rarity z katalogu.
- **Areny** (menu) — wybór mapy, minimapa SVG, rebuild areny w menu.

Persist: `ignite.inventory.v2` (`equippedCarId`, `equippedArenaId`).

## Testy

```bash
npx vitest run tests/arena/arenaCatalog.test.ts
npx vitest run tests/physics/arenaVariants.test.ts
npx vitest run tests/trellis/client.test.ts
npm run audit:physics
npm run validate:glb -- --catalog
```

## Trellis (NixOS)

Kontener `trellis3d`, port **8004**, output `/var/lib/trellis3d/output`.

```bash
trellis3d-share status
curl http://127.0.0.1:8004/health
```
