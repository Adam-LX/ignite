#!/usr/bin/env python3
"""Murawa PBR z _grass_raw.png — ffmpeg + Python (bez Blendera, który psuje JPEG)."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "public" / "assets" / "textures" / "_grass_raw.png"
OUT = ROOT / "public" / "assets" / "textures"
COLOR = OUT / "grass_color.jpg"
NORMAL = OUT / "grass_normal.jpg"
ROUGH = OUT / "grass_roughness.jpg"
HEIGHT = OUT / "grass_height.jpg"
SIZE = 2048

COLOR_VF = "eq=brightness=0.22:contrast=1.85:saturation=1.5:gamma=0.92"


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


def _luminance(r: int, g: int, b: int) -> float:
	return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _is_procedural_fallback(rgb: bytes) -> bool:
	"""Wykryj generate_grass_fallback.py (px0 ≈ [18,37,17])."""
	if len(rgb) < 3:
		return False
	return rgb[0] < 28 and rgb[1] < 42 and rgb[2] < 22


def _avg_brightness(rgb: bytes) -> float:
	if not rgb:
		return 0.0
	return sum(rgb) / len(rgb)


def _lum_at(rgb: bytes, x: int, y: int, w: int, h: int) -> float:
	x %= w
	y %= h
	i = (y * w + x) * 3
	return _luminance(rgb[i], rgb[i + 1], rgb[i + 2])


def main() -> None:
	if not RAW.is_file():
		print(f"BŁĄD: brak {RAW}", file=sys.stderr)
		sys.exit(1)

	OUT.mkdir(parents=True, exist_ok=True)

	color_rgb = _load_rgb(RAW, COLOR_VF)
	expected = SIZE * SIZE * 3
	if len(color_rgb) != expected:
		raise RuntimeError(f"Nieprawidłowy rozmiar bufora koloru: {len(color_rgb)} != {expected}")

	if _is_procedural_fallback(color_rgb):
		raise RuntimeError(
			"_grass_raw.png to proceduralna szachownica — uruchom: python3 scripts/generate_grass_comfyui.py"
		)

	avg = _avg_brightness(color_rgb)
	print(f"grass_color avg brightness: {avg:.1f}")
	if avg < 12:
		raise RuntimeError("grass_color wygląda na czarną — przerwano")

	_write_jpeg(color_rgb, COLOR)

	rough = bytearray(expected)
	for i in range(0, expected, 3):
		lum = _luminance(color_rgb[i], color_rgb[i + 1], color_rgb[i + 2]) / 255.0
		val = int(min(255, max(0, (0.28 + (1.0 - lum) * 0.52) * 255)))
		rough[i] = rough[i + 1] = rough[i + 2] = val
	_write_jpeg(bytes(rough), ROUGH)

	height = bytearray(expected)
	for i in range(0, expected, 3):
		lum = _luminance(color_rgb[i], color_rgb[i + 1], color_rgb[i + 2]) / 255.0
		val = int(min(255, max(0, (0.12 + lum * 0.78) * 255)))
		height[i] = height[i + 1] = height[i + 2] = val
	_write_jpeg(bytes(height), HEIGHT)

	w = h = SIZE
	strength = 3.5
	normal = bytearray(expected)
	for y in range(h):
		for x in range(w):
			dx = (_lum_at(color_rgb, x + 1, y, w, h) - _lum_at(color_rgb, x - 1, y, w, h)) * (
				strength / 255.0
			)
			dy = (_lum_at(color_rgb, x, y + 1, w, h) - _lum_at(color_rgb, x, y - 1, w, h)) * (
				strength / 255.0
			)
			nx, ny, nz = -dx, -dy, 1.0
			length = (nx * nx + ny * ny + nz * nz) ** 0.5
			nx /= length
			ny /= length
			nz /= length
			i = (y * w + x) * 3
			normal[i] = int((nx * 0.5 + 0.5) * 255)
			normal[i + 1] = int((ny * 0.5 + 0.5) * 255)
			normal[i + 2] = int((nz * 0.5 + 0.5) * 255)
	_write_jpeg(bytes(normal), NORMAL)

	for path in (COLOR, NORMAL, ROUGH, HEIGHT):
		print(f"Zapisano: {path} ({path.stat().st_size} B)")


if __name__ == "__main__":
	main()
