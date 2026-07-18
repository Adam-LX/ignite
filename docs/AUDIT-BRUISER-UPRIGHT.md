# Audyt: bruiser / Bułdog do góry nogami (2026-07-16)

**Screen:** `screenshots/garage-bruiser-upside-down.png`  
**Gemini:** `screenshots/gemini-consult-20260716-121241.json`  
**Pomiar:** `nix develop -c npx vite-node scripts/audit-bruiser-orientation.ts`

## Werdykt

**Przyczyna:** zbędne flipy w runtime po poprawnym `ensureMeshyGltfAxes`.

1. **Force list** (`FORCE_UPRIGHT_CAR_IDS`) — +180° X na już dobrym modelu → UPSIDE_DOWN.
2. **Heurystyka normalnych** — na bruiserze false positive (masa OK, normals mówią „flip”) → ten sam efekt.

| Krok | Werdykt |
|------|---------|
| Po `ensureMeshyGltfAxes` | **OK** (masa nad hubami) |
| Po force / normals flip | **UPSIDE_DOWN** |
| muscle (bez force) | OK |
| Po fix (tylko mass skew) | **OK** we wszystkich krokach load |

Gemini (`screenshots/gemini-consult-20260716-121241.json`): usunąć force; nie dublować flipów.

## Werdykt (aktualizacja)

1. Stałe `rotation.x -= 90°` kładło **gęste podwozie Trellis u góry** → koła na dachu ekranu.
2. Force-flip / normals psuły metryki albo dawały double-flip.
3. Huby Blendera trzymały długość w **local Y**; po ±90° `syncEmptyWheelHubCenterY` zerowało rozstaw osi.

## Fix (v60)

1. Preferencja ±90°: **dense-bottom** (gęstsze = nadkola/podwozie).
2. Prep bruiser: **wyłączony** gentle weld / interior cull (zjadał ~50%+ tris → „poobgryzany”).
3. Crash miniatury: `disposeCarMeshGroup` nie dispose’uje współdzielonej geometrii; `cloneCarMesh` klonuje geo.
4. Diagnostyka: `npm run diagnose:car-upright -- bruiser`

Pomiar: `PASS bruiser orient=OK mesh=OK denseBottom=true tris=100% raw`.

## Pipeline (jak działa)

1. Blender prep eksportuje GLB z długością wzdłuż **Y** (hub FL y≈+0.35, RL y≈−0.33).
2. `ensureMeshyGltfAxes` kładzie auto: `rotation.x -= π/2` → długość na **Z**, Y = góra.
3. (Błędnie) force flip dodawał kolejne `+π` → dach w dół.
4. Ground align / yaw π — na już odwróconym modelu.

Muscle ma ten sam układ hubów w GLB, ale **nie** był na liście force → wyświetlał się dobrze.

## Fix zastosowany

- Usunięto `FORCE_UPRIGHT_CAR_IDS` — flip tylko gdy `bodyMassSkewInverted` / normals.
- Cache bump: `wheels-v48-no-force-flip`, `proc-wheels-v18-no-force`.
- Skrypt audytu: `scripts/audit-bruiser-orientation.ts`.

## Ostrze (blade) — podwójny mesh w thumb

Osobny temat: baked koła / druga skorupa w jednym `body` albo brak maski hubów w miniaturce — nie mylić z upright.
