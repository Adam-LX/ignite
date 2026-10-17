#!/usr/bin/env python3
"""Install TEMP licensed car GLBs into Ignite (gitignored). Easy remove: delete the folder."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = Path.home() / "Dokumenty" / "Ignite Cars"
OUT = ROOT / "public" / "assets" / "cars" / "_licensed_preview"

CARS = [
	{
		"id": "lic_bmw_m4_adro",
		"zip": "2022-bmw-g82-m4-adro-widebody-kit.zip",
		"member": "source/2022_bmw_g82_m4_adro_carbon_fiber_widebody_kit.glb",
		"file": "bmw_m4_adro.glb",
		"name": "BMW M4 Adro (preview)",
		"bodyStyle": "wide",
	},
	{
		"id": "lic_porsche_992_gt3r",
		"zip": "2024-porsche-992-gt3-r.zip",
		"member": "source/porsche_992_gt3_r.glb",
		"file": "porsche_992_gt3r.glb",
		"name": "Porsche 992 GT3 R (preview)",
		"bodyStyle": "low",
	},
	{
		"id": "lic_bmw_m3_comp",
		"zip": "bmw-m3-competition.zip",
		"member": "source/bmw484051410.glb",
		"file": "bmw_m3_competition.glb",
		"name": "BMW M3 Competition (preview)",
		"bodyStyle": "standard",
	},
	{
		"id": "lic_ferrari_296_gt3",
		"zip": "ferrari-296-gt3-verstappencom-racing.zip",
		"member": "source/ferrari_296_gt3_verstappen__www_vecarz_com.glb",
		"file": "ferrari_296_gt3.glb",
		"name": "Ferrari 296 GT3 (preview)",
		"bodyStyle": "low",
	},
	{
		"id": "lic_porsche_992_gt3rs",
		"zip": "porsche-992-gt3-rs.zip",
		"member": "source/1300 099999.glb",
		"file": "porsche_992_gt3rs.glb",
		"name": "Porsche 992 GT3 RS (preview)",
		"bodyStyle": "low",
	},
]


def main() -> None:
	if not SRC.is_dir():
		raise SystemExit(f"Missing source folder: {SRC}")
	OUT.mkdir(parents=True, exist_ok=True)
	entries = []
	for i, c in enumerate(CARS):
		zpath = SRC / c["zip"]
		if not zpath.is_file():
			print("SKIP missing zip", zpath.name)
			continue
		dest = OUT / c["file"]
		print("extract", c["id"], "...")
		with zipfile.ZipFile(zpath) as zf:
			dest.write_bytes(zf.read(c["member"]))
		mb = dest.stat().st_size / (1024 * 1024)
		print(f"  -> {dest.name} {mb:.1f} MB")
		entries.append(
			{
				"id": c["id"],
				"nameKey": c["name"],
				"glb": f"/assets/cars/_licensed_preview/{c['file']}",
				"rarity": "legendary",
				"bodyStyle": c["bodyStyle"],
				"source": "manual",
				"tintable": True,
				"defaultUnlocked": True,
				"featured": True,
				"garageSort": 5 + i,
				"wheelWellMode": "stock",
				"licensedPreview": True,
			}
		)

	catalog = {
		"schemaVersion": 1,
		"note": "TEMPORARY — branded cars requiring license. Delete this folder to remove.",
		"cars": entries,
	}
	(OUT / "catalog.json").write_text(json.dumps(catalog, indent="\t") + "\n")
	(OUT / "REMOVE.md").write_text(
		"# Remove\n\n```bash\nrm -rf public/assets/cars/_licensed_preview\n```\n"
		"Kill-switch: localStorage `ignite.licensedCarsPreview=0` "
		"or env `VITE_LICENSED_CARS_PREVIEW=0`.\n"
	)
	print(f"DONE {len(entries)} cars → {OUT}")
	print("Skipped: 2019 Porsche Cabriolet (FBX only).")


if __name__ == "__main__":
	main()
