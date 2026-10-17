# Licensed car preview (temporary)

Branded GLBs from `~/Dokumenty/Ignite Cars` for local playtest only.
**Do not ship** — require manufacturer licenses.

## Install

```bash
python3 scripts/install-licensed-cars-preview.py
```

Writes gitignored `public/assets/cars/_licensed_preview/` (GLBs + `catalog.json`).
`CarCatalog` merges them automatically when the folder exists.

## Remove (one shot)

```bash
rm -rf public/assets/cars/_licensed_preview
```

Restart Vite. No other cleanup required (merge is a no-op without the folder).

### Soft disable (keep files)

- Browser: `localStorage.setItem('ignite.licensedCarsPreview', '0')`
- Build: `VITE_LICENSED_CARS_PREVIEW=0`

## Cars included

| id | model |
|----|--------|
| `lic_bmw_m4_adro` | BMW M4 Adro widebody |
| `lic_porsche_992_gt3r` | Porsche 992 GT3 R |
| `lic_bmw_m3_comp` | BMW M3 Competition |
| `lic_ferrari_296_gt3` | Ferrari 296 GT3 |
| `lic_porsche_992_gt3rs` | Porsche 992 GT3 RS |

Skipped: 2019 Porsche Cabriolet (FBX only, no GLB in zip).

## Visuals

Licensed GLBs keep embedded materials (paint/glass) and **stock wheels**.
Do **not** rename hubs to `wheel_FL` or run Octane paint/wheel cosmetics —
that was gutting arches and floating rims. UV1→UV0 remap + chroma-glass retint
applied in `CarModel`.
