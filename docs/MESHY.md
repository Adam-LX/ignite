# Meshy.ai — pipeline assetów 3D (FlyBall / Ignite)

Dokumentacja projektowa. **Zawsze postępuj według tej kolejności** — pominięcie kroku (np. resize) daje złe proporcje (płaski „placek”) lub ogromne pliki.

## Konfiguracja

```bash
cp data/meshy.env.example data/meshy.env
# Klucz: https://www.meshy.ai/settings/api → MESHY_API_KEY=msy_...
```

Pliki śledzone w `data/meshy-car-task.json` (ID tasków Meshy — nie commituj `meshy.env`).

## Konwencje FlyBall (Three.js)

| Oś | Znaczenie | Wymiar Octane |
|----|-----------|---------------|
| **X** | szerokość | 0.68 m (`OCTANE_VISUAL_WIDTH`) |
| **Y** | wysokość | ~0.36 m (`OCTANE_BODY_HEIGHT`) |
| **Z** | długość / przód auta | 1.18 m (`OCTANE_LENGTH`) |

- Przód auta: **+Z** (loader: `CarModel.ts`, Blender prep).
- Dno opon: **Y = 0** (`alignCarToHitbox`).
- Koła w GLB: `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR`.
- Karoseria: mesh `body`.
- Gra ładuje: `public/assets/models/car.glb` (Draco — wymaga `createGltfLoader()`).

## Pipeline (właściwa kolejność)

```
Źródło (T4.glb / Meshy export)
    ↓
① Retexture API     — PBR, remove_lighting, hd_texture
    ↓
② Remesh API        — triangle, ~28k poly
    ↓
③ Resize API        — resize_longest_side: 1.18, origin_at: bottom  ← KRYTYCZNE
    ↓
④ Blender prep      — orient długości → +Z + UNIFORM scale + koła
    ↓
⑤ gltf-transform    — tekstury 1024 + Draco
    ↓
public/assets/models/car.glb
```

### Dlaczego Resize?

Remesh zwraca mesh w **losowej skali** i często z długością na złej osi. **Non-uniform scale** w Blenderze/TS (osobno X/Y/Z do hitboxa) **spłaszcza** model — nigdy tego nie rób.

`resize_longest_side: 1.18` ustawia najdłuższy bok na długość Octane **z zachowaniem proporcji**.

### Dlaczego uniform scale?

Po **resize API** najdłuższy bok ≈ 1.18 m — skaluj **tylko uniform**, żeby nie zgnieść proporcji:

```python
# DOBRZE (Blender prep + CarModel.ts)
longest = max(sx, sy, sz)
s = L / longest
body.scale = (s, s, s)

# ŹLE — placek
body.scale = (W/w, H/h, L/l)  # gdy długość jest na X/Y, H/sy zgniata auto
```

### Orientacja osi (Blender Z-up → glTF Y-up)

Blender domyślnie **Z-up**. Eksport `export_yup=True` mapuje:

| Blender | glTF / Three.js |
|---------|-----------------|
| X | X (szerokość) |
| Z | Y (wysokość) |
| Y | −Z (przód → **+Z** w Three.js) |

**Długość auta musi być na osi Blender Y** przed eksportem — nie na Blender Z (to wysokość w pliku glTF).

Import GLB ustawia `rotation_mode = QUATERNION` — przed `rotation_euler` ustaw `rotation_mode = "XYZ"`.

## Komendy npm

| Komenda | Opis |
|---------|------|
| `npm run meshy:build-car` | Pełny pipeline (retexture tylko bez task id) |
| `npm run meshy:build-car -- --retexture` | Wymuś nowy retexture z `T4.glb` |
| `npm run meshy:retexture-car` | Sam retexture + auto optimize (legacy) |
| `npm run meshy:optimize-car` | remesh + resize + prep (bez retexture) |
| `npm run assets:meshy-car` | Tylko Blender prep z `MESHY_CAR_SRC` |
| `npm run meshy:build-arena` | Murawa + ściany + bramki (pełny pipeline) |
| `npm run meshy:build-arena:textures` | Tylko tekstury murawy i ścian |
| `npm run meshy:build-ball` | Piłka: albedo (text-to-image) + model 3D |
| `npm run meshy:build-ball -- --from-image <png>` | Piłka z referencji (image-to-3d) |
| `npm run meshy:build-ball -- --force` | Pełny re-run API + compress |
| `npm run meshy:prep-ball` | **Lokalnie** — compress sized → Draco + `ball.glb` (bez API) |
| `npm run meshy:build-ball:texture` | Tylko albedo piłki |
| `npm run meshy:build-all` | Auto + arena + piłka |
| `npm run meshy:build-all:textures` | Tekstury arena + piłka (bez kosztownego 3D) |
| `npm run meshy:build-ceiling` | Sufit areny (text-to-image pro) |
| `npm run meshy:sync-manifest` | Skan dysku → arena-manifest.json |
| `npm run meshy:full-throttle` | Pełny re-run wszystkiego (`--force`) |

## Arena (murawa, ściany, bramki)

```
npm run meshy:build-arena              # pełny pipeline
npm run meshy:build-arena:textures    # tylko murawa + ściany
npm run meshy:build-arena -- --goal-only
npm run meshy:build-arena -- --force
```

| Asset | Meshy API | Plik w grze |
|-------|-----------|-------------|
| Murawa PBR | `text-to-image` → bake (tile 2×2) | `meshy_grass_*.jpg` |
| Ściany | `text-to-image` | `meshy_arena_wall.png` |
| Skybox | `text-to-image` (16:9) | `meshy_skybox.png` *(opcjonalny, nie używany w grze)* |
| Bandy LED | `text-to-image` | `meshy_banner_panel.png` |
| Sufit areny | `text-to-image` (pro) | `meshy_arena_ceiling.png` |
| Rama bramki | `text-to-3d` → remesh → resize (18 m) | `goal_frame.glb` |
| Piłka albedo | `text-to-image` | `meshy_ball_albedo.jpg` |
| Piłka 3D | `text-to-3d` → remesh → resize (1.825 m) | `ball_meshy.glb` |

Manifest: `public/assets/meshy/arena-manifest.json` · taski: `data/meshy-{car,arena,ball}-task.json`

Fizyka bramek bez zmian — Meshy tylko wizualna rama (fallback proceduralny w `goalPocket.ts`).

## Piłka (1.825 m średnicy)

```
Referencja PNG (opcjonalnie)
    ↓
① text-to-image albedo  LUB  image-to-3d (z --from-image)
    ↓
② text-to-3d preview + refine  (gdy bez obrazu)
    ↓
③ Remesh API        — ~8k poly
    ↓
④ Resize API        — resize_longest_side: 1.825, origin_at: center
    ↓
⑤ gltf-transform    — tekstury 1024 + Draco
    ↓
ball_meshy.glb → kopia ball.glb (asset w grze)
```

Gra ładuje `getMeshyBallModelUrl()` z manifestu (`ball_meshy.glb`); `BallVfx.preserveMeshyMaterials` nie nadpisuje PBR z GLB.

**Bez API** (gdy masz już `ball_meshy_sized.glb` lub `ball_meshy.glb`):

```bash
npm run meshy:prep-ball
npm run meshy:sync-manifest
```

Taski: `data/meshy-ball-task.json` · referencja: `public/assets/textures/ball_meshy_reference.png`

## API Meshy (skrót)

| Endpoint | Wejście | Parametry kluczowe |
|----------|---------|-------------------|
| `POST /openapi/v1/retexture` | `model_url` (data URI) | `text_style_prompt`, `enable_pbr`, `remove_lighting`, `hd_texture` |
| `POST /openapi/v1/remesh` | `input_task_id` | `target_polycount: 28000`, `topology: triangle` |
| `POST /openapi/v1/resize` | `input_task_id` | `resize_longest_side: 1.18`, `origin_at: bottom` |

Auth: `Authorization: Bearer msy_...`

Upload modelu: `data:application/octet-stream;base64,...` (max ~duże pliki — retexture T4 ~53 MB działa).

Polling: `GET /openapi/v1/{retexture|remesh|resize}/:id` co 5 s do `SUCCEEDED`.

## Pliki w repo

| Plik | Rola |
|------|------|
| `T4.glb` | Źródło z Meshy (lokalne) |
| `public/assets/models/car_meshy.glb` | Po retexture |
| `public/assets/models/car_meshy_low.glb` | Po remesh |
| `public/assets/models/car_meshy_sized.glb` | Po resize |
| `public/assets/models/car.glb` | **Asset w grze** |
| `scripts/meshy/client.ts` | Klient API |
| `scripts/meshy/pipelineCar.ts` | Orchestrator |
| `scripts/blender_prep_meshy_car.py` | Skala + koła |
| `src/visual/CarModel.ts` | Loader + lekki runtime fit |
| `src/util/gltfLoader.ts` | Draco decoder |

## Prompt retexture (domyślny)

```
Futuristic rocket league cyberpunk car, proper 3D vehicle proportions with height and volume,
not flat or squashed, brushed chrome panels, cyan neon LED trim, carbon fiber, game-ready PBR
```

## Rozwiązywanie problemów

| Objaw | Przyczyna | Fix |
|-------|-----------|-----|
| Placek / płaskie auto | non-uniform scale lub brak orient osi | resize → prep z `rotation_mode=XYZ`, uniform scale |
| Koła odjechane | koła przed resize / zła oś | resize → prep, `fitMeshyBodyAndWheels` w TS |
| 50+ MB | brak remesh/draco | pełny pipeline |
| Czarny model | brak `remove_lighting` | retexture z `remove_lighting: true` |
| Draco error w grze | stary loader | `createGltfLoader()` wszędzie |

## Trellis 3D (lokalna alternatywa)

Lokalny kontener NixOS (`:8004`, output `/var/lib/trellis3d/output`) — **bez kosztów API**, ten sam post-processing co Meshy.

| Komenda | Opis |
|---------|------|
| `npm run trellis:health` | Sprawdzenie `/health` |
| `npm run trellis:build-car -- --id muscle --prompt "..."` | GLB → Blender prep → Draco → `public/assets/cars/` + wpis w catalog |
| `npm run trellis:build-arena-props -- --arena vault --prop goalFrame` | Props do `public/assets/arenas/<id>/` |
| `npm run trellis:batch` | Kolejka z `data/content/*.design.json` |
| `npm run trellis:sync-arena-manifests` | Skan dysku → manifest per mapa |
| `npm run content:design` | Gemini design pass → `data/content/*.design.json` |

**Te same constrainty co Meshy:** długość **1.18 m**, oś jazdy **+Z**, koła `wheel_FL/FR/RL/RR`, origin na podłożu. Blender prep: `scripts/blender_prep_meshy_car.py`. Runtime fit: `CarModel.fitMeshyBodyAndWheels()`.

Workflow: Gemini (`content:design`) → Trellis generate → prep → gra. Szczegóły: [`docs/CONTENT-SYSTEM.md`](CONTENT-SYSTEM.md).

## Bezpieczeństwo

- **Nie** używaj cookies z przeglądarki — tylko API key.
- `data/meshy.env` jest w `.gitignore`.
- Po wycieku klucza: revoke na meshy.ai → nowy klucz.

## Referencje

- Docs: https://docs.meshy.ai/
- API key: https://www.meshy.ai/settings/api
- LLM index: https://docs.meshy.ai/llms.txt
