#!/usr/bin/env python3
"""Murawa PBR z meshy_grass_raw.png → meshy_grass_*.jpg"""

from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "public" / "assets" / "textures" / "meshy_grass_raw.png"
OUT = ROOT / "public" / "assets" / "textures"
COLOR = OUT / "meshy_grass_color.jpg"
NORMAL = OUT / "meshy_grass_normal.jpg"
ROUGH = OUT / "meshy_grass_roughness.jpg"
SIZE = 2048
# Meshy raw bywa zbyt kontrastowy / „kafelkowy” — łagodzimy, bez zgniatania do czerni.
COLOR_VF = (
	"eq=saturation=1.18:contrast=1.08:brightness=0.04:gamma=0.96,"
	"gblur=sigma=1.2,"
	f"scale={SIZE}:{SIZE}"
)


def _ffmpeg(args: list[str], stdin: bytes | None = None) -> bytes:
	result = subprocess.run(
		["ffmpeg", "-y", "-loglevel", "error", *args],
		input=stdin,
		check=True,
		capture_output=True,
	)
	return result.stdout


def _load_rgb(path: Path, vf: str | None = None) -> bytes:
	cmd = ["-i", str(path)]
	if vf:
		cmd += ["-vf", f"{vf},scale={SIZE}:{SIZE}"]
	else:
		cmd += ["-vf", f"scale={SIZE}:{SIZE}"]
	cmd += ["-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:"]
	return _ffmpeg(cmd)


def _write_jpeg(rgb: bytes, path: Path) -> None:
	_ffmpeg(
		[
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-s",
			f"{SIZE}x{SIZE}",
			"-i",
			"pipe:",
			"-q:v",
			"2",
			str(path),
		],
		stdin=rgb,
	)


def _sobel_normal(rgb: bytes) -> bytes:
	import array

	pixels = array.array("B", rgb)
	out = array.array("B", [128] * len(pixels))
	w = SIZE

	def lum(i: int) -> float:
		return 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]

	for y in range(2, SIZE - 2):
		for x in range(2, SIZE - 2):
			i = (y * w + x) * 3
			dx = (
				lum(i + 3)
				+ 2 * lum(i + w * 3 + 3)
				+ lum(i + w * 2 * 3 + 3)
				- lum(i - 3)
				- 2 * lum(i + w * 3 - 3)
				- lum(i + w * 2 * 3 - 3)
			)
			dy = (
				lum(i + w * 3)
				+ 2 * lum(i + w * 3 + 3)
				+ lum(i + w * 3 + 6)
				- lum(i - w * 3)
				- 2 * lum(i - w * 3 + 3)
				- lum(i - w * 3 + 6)
			)
			out[i] = max(0, min(255, int(128 - dx * 0.35)))
			out[i + 1] = max(0, min(255, int(128 - dy * 0.35)))
			out[i + 2] = 255
	return out.tobytes()


def _roughness_from_color(rgb: bytes) -> bytes:
	import array

	pixels = array.array("B", rgb)
	out = array.array("B", [0] * len(pixels))
	for i in range(0, len(pixels), 3):
		l = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]
		v = int(max(40, min(230, 220 - l * 0.55)))
		out[i] = out[i + 1] = out[i + 2] = v
	return out.tobytes()


def main() -> None:
	if not RAW.is_file():
		raise SystemExit(f"Brak {RAW} — uruchom meshy:build-arena")

	color_rgb = _load_rgb(RAW, COLOR_VF)
	if len(color_rgb) != SIZE * SIZE * 3:
		raise SystemExit(f"Nieprawidłowy rozmiar RGB: {len(color_rgb)}")
	_write_jpeg(color_rgb, COLOR)
	_write_jpeg(_sobel_normal(color_rgb), NORMAL)
	_write_jpeg(_roughness_from_color(color_rgb), ROUGH)
	print(f"✓ {COLOR.name}, {NORMAL.name}, {ROUGH.name}")


if __name__ == "__main__":
	main()
