#!/usr/bin/env python3
"""
Blender (headless): grass_color.jpg → grass_normal.jpg + grass_roughness.jpg
Uruchomienie:
  blender --background --python scripts/blender_grass_maps.py
"""

from __future__ import annotations

import math
import os
from pathlib import Path

import bpy

ROOT = Path(os.environ.get("FLYBALL_ROOT", Path(__file__).resolve().parents[1]))
COLOR_RAW = ROOT / "public" / "assets" / "textures" / "_grass_raw.png"
COLOR_PATH = ROOT / "public" / "assets" / "textures" / "grass_color.jpg"
NORMAL_PATH = ROOT / "public" / "assets" / "textures" / "grass_normal.jpg"
ROUGH_PATH = ROOT / "public" / "assets" / "textures" / "grass_roughness.jpg"


def _resolve_color_source() -> Path:
	if COLOR_RAW.is_file():
		return COLOR_RAW
	if COLOR_PATH.is_file():
		return COLOR_PATH
	raise FileNotFoundError(
		f"Brak {COLOR_RAW} ani {COLOR_PATH} — uruchom generate_grass_comfyui.py"
	)


def _make_seamless_rgb(rgb):
	import numpy as np

	h, w = rgb.shape[:2]
	ox, oy = w // 2, h // 2
	shifted = np.roll(np.roll(rgb, ox, axis=1), oy, axis=0)
	blend = min(96, w // 8, h // 8)
	x = np.linspace(0.0, 1.0, blend, dtype=np.float32)
	xfade = np.concatenate([x, np.ones(w - 2 * blend, dtype=np.float32), 1.0 - x])
	yfade = np.concatenate([x, np.ones(h - 2 * blend, dtype=np.float32), 1.0 - x])
	mask_x = np.tile(xfade, (h, 1))[..., None]
	mask_y = np.tile(yfade[:, None], (1, w))[..., None]
	mask = np.clip(mask_x * mask_y, 0.0, 1.0)
	return np.clip(rgb * (1.0 - mask) + shifted * mask, 0.0, 1.0)


def _pixels_to_numpy(img: bpy.types.Image):
	import numpy as np

	w, h = img.size
	channels = 4 if img.channels == 4 else 3
	arr = np.empty(w * h * channels, dtype=np.float32)
	img.pixels.foreach_get(arr)
	return arr.reshape((h, w, channels))


def _numpy_to_pixels(img: bpy.types.Image, arr) -> None:
	import numpy as np

	flat = np.asarray(arr, dtype=np.float32).reshape(-1)
	img.pixels.foreach_set(flat)
	img.update()


def _load_color_image() -> bpy.types.Image:
	source = _resolve_color_source()
	for img in list(bpy.data.images):
		if img.users == 0:
			bpy.data.images.remove(img)
	return bpy.data.images.load(str(source))


def _luminance(rgb):
	return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def bake_normal_from_height(height, strength: float = 3.5):
	import numpy as np

	h, w = height.shape
	pad = np.pad(height, 1, mode="wrap")
	dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
	dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
	nx = -dx
	ny = -dy
	nz = np.ones_like(height)
	length = np.sqrt(nx * nx + ny * ny + nz * nz)
	nx /= length
	ny /= length
	nz /= length
	normal = np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5], axis=-1)
	return np.clip(normal, 0.0, 1.0)


def bake_roughness_from_color(rgb):
	import numpy as np

	lum = _luminance(rgb)
	# Jasne źdźbła = gładsze, ciemniejsze przejścia = bardziej matowe
	rough = 0.28 + (1.0 - lum) * 0.52
	rough = np.clip(rough, 0.12, 0.92)
	return np.stack([rough, rough, rough], axis=-1)


def _save_image(img: bpy.types.Image, path: Path, color_space: str) -> None:
	path.parent.mkdir(parents=True, exist_ok=True)
	img.filepath_raw = str(path)
	img.file_format = "JPEG"
	img.colorspace_settings.name = color_space
	img.save()
	print(f"Zapisano: {path}")


def main() -> None:
	import numpy as np

	bpy.ops.wm.read_factory_settings(use_empty=True)

	color_img = _load_color_image()
	w, h = color_img.size
	rgb = _pixels_to_numpy(color_img)[..., :3]
	rgb = _make_seamless_rgb(rgb)
	height = _luminance(rgb)

	normal_arr = bake_normal_from_height(height)
	rough_arr = bake_roughness_from_color(rgb)

	normal_img = bpy.data.images.new("GrassNormal", width=w, height=h, alpha=False)
	rough_img = bpy.data.images.new("GrassRoughness", width=w, height=h, alpha=False)

	normal_rgba = np.concatenate([normal_arr, np.ones((h, w, 1), dtype=normal_arr.dtype)], axis=-1)
	rough_rgba = np.concatenate([rough_arr, np.ones((h, w, 1), dtype=rough_arr.dtype)], axis=-1)

	_numpy_to_pixels(normal_img, normal_rgba)
	_numpy_to_pixels(rough_img, rough_rgba)

	color_out = bpy.data.images.new("GrassColorSeamless", width=w, height=h, alpha=False)
	color_rgba = np.concatenate([rgb, np.ones((h, w, 1), dtype=rgb.dtype)], axis=-1)
	_numpy_to_pixels(color_out, color_rgba)

	_save_image(color_out, COLOR_PATH, "sRGB")
	_save_image(normal_img, NORMAL_PATH, "Non-Color")
	_save_image(rough_img, ROUGH_PATH, "Non-Color")


if __name__ == "__main__":
	main()
