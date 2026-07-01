#!/usr/bin/env python3
"""Jedna mapa albedo boiska Ignite — 4096×2048, 80 m (X) × 120 m (Z), bez tile repeat."""

from __future__ import annotations

import json
import math
import struct
import sys
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "assets" / "textures" / "arena_albedo_ignite.png"
COMFY_URL = "http://127.0.0.1:8188"

# Szerokość tekstury = oś Z (120 m), wysokość = oś X (80 m) — 4096×2048 jak w blueprint.
TEX_W = 4096
TEX_H = 2048
USE_COMFY_GRAIN = "--no-comfy" not in sys.argv
# Domyślnie czysta murawa — linie boiska są w wektorowym overlay (arena.ts).
BAKE_MARKINGS = "--branded" in sys.argv

HALF_W = 40.0
HALF_L = 60.0
CENTER_R = 12.0


def write_png_rgb(path: Path, rgb: np.ndarray) -> None:
	"""rgb: uint8 H×W×3"""
	h, w, _ = rgb.shape

	def chunk(tag: bytes, data: bytes) -> bytes:
		c = tag + data
		return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

	ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
	raw = b"".join(b"\x00" + rgb[y].tobytes() for y in range(h))
	path.parent.mkdir(parents=True, exist_ok=True)
	path.write_bytes(
		b"\x89PNG\r\n\x1a\n"
		+ chunk(b"IHDR", ihdr)
		+ chunk(b"IDAT", zlib.compress(raw, 9))
		+ chunk(b"IEND", b"")
	)


def _fbm(x: np.ndarray, y: np.ndarray, seed: float, octaves: int = 5) -> np.ndarray:
	v = np.zeros(x.shape, dtype=np.float64)
	amp = 1.0
	freq = 1.0
	for i in range(octaves):
		v += amp * np.sin((x * freq + seed) * 1.7 + np.cos(y * freq * 1.3 + seed * 0.7) * 2.1)
		v += amp * 0.5 * np.sin((x * freq * 2.3 + y * freq * 1.9 + seed * 1.3))
		amp *= 0.52
		freq *= 2.05
	return v


def grass_base(h: int, w: int) -> np.ndarray:
	"""Ciemnozielona e-sportowa murawa — krótko skoszona, bez pasów."""
	ys = np.linspace(0, 48, h, dtype=np.float64)
	xs = np.linspace(0, 64, w, dtype=np.float64)
	px, py = np.meshgrid(xs, ys, indexing="xy")
	n1 = _fbm(px, py, 2.4, 4)
	n2 = _fbm(px * 3.1, py * 2.7, 7.8, 3) * 0.35
	n3 = np.random.default_rng(42).normal(0, 0.04, (h, w))
	field = n1 * 0.55 + n2 + n3
	field = (field - field.min()) / (field.max() - field.min() + 1e-9)

	r = 0.04 + field * 0.10
	g = 0.28 + field * 0.22
	b = 0.06 + field * 0.08
	return np.stack([r, g, b], axis=-1)


def comfy_grass_tile() -> np.ndarray | None:
	if not USE_COMFY_GRAIN:
		return None
	try:
		with urllib.request.urlopen(f"{COMFY_URL}/system_stats", timeout=4) as resp:
			if resp.status != 200:
				return None
	except OSError:
		return None

	try:
		with urllib.request.urlopen(f"{COMFY_URL}/object_info/CheckpointLoaderSimple", timeout=10) as resp:
			info = json.loads(resp.read())
			choices = info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
			ckpt = next((c for c in choices if "Lightning" in c or "juggernaut" in c.lower()), choices[0])
	except OSError:
		return None

	prompt = (
		"Dark short-cut esports soccer turf texture, uniform deep forest green artificial grass, "
		"macro top-down, seamless, soft even lighting, no mower stripes, no lines, no logo"
	)
	negative = "stripe, checkerboard, lines, circle, goal, text, logo, bright, dry, brown, blur"
	size = 1024
	seed = int(time.time()) % 2_147_483_647
	workflow = {
		"4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
		"5": {"class_type": "EmptyLatentImage", "inputs": {"width": size, "height": size, "batch_size": 1}},
		"6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
		"7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["4", 1]}},
		"3": {
			"class_type": "KSampler",
			"inputs": {
				"seed": seed,
				"steps": 8,
				"cfg": 2.0,
				"sampler_name": "dpmpp_sde",
				"scheduler": "karras",
				"denoise": 1.0,
				"model": ["4", 0],
				"positive": ["6", 0],
				"negative": ["7", 0],
				"latent_image": ["5", 0],
			},
		},
		"8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
		"9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "ignite_grass_tile", "images": ["8", 0]}},
	}
	req = urllib.request.Request(
		f"{COMFY_URL}/prompt",
		data=json.dumps({"prompt": workflow}).encode(),
		headers={"Content-Type": "application/json"},
		method="POST",
	)
	with urllib.request.urlopen(req, timeout=30) as resp:
		prompt_id = json.loads(resp.read()).get("prompt_id")
	if not prompt_id:
		return None

	deadline = time.time() + 300
	filename = None
	while time.time() < deadline:
		time.sleep(2)
		try:
			with urllib.request.urlopen(f"{COMFY_URL}/history/{prompt_id}", timeout=10) as resp:
				history = json.loads(resp.read())
		except urllib.error.HTTPError:
			continue
		entry = history.get(prompt_id)
		if entry and entry.get("outputs", {}).get("9", {}).get("images"):
			filename = entry["outputs"]["9"]["images"][0]["filename"]
			break
	if not filename:
		return None

	try:
		with urllib.request.urlopen(f"{COMFY_URL}/view?filename={filename}&type=output", timeout=60) as resp:
			png = resp.read()
	except OSError:
		host = Path(f"/var/lib/comfyui/output/{filename}")
		if not host.is_file():
			return None
		png = host.read_bytes()

	# Minimalny dekoder PNG → RGB float 0..1
	pos = 8
	w = h = ct = None
	raw = b""
	while pos < len(png):
		ln = int.from_bytes(png[pos : pos + 4], "big")
		pos += 4
		typ = png[pos : pos + 4]
		pos += 4
		chunk = png[pos : pos + ln]
		pos += ln + 4
		if typ == b"IHDR":
			w, h, _, ct = struct.unpack(">IIBBBBB", chunk)[:4]
		elif typ == b"IDAT":
			raw += chunk
	if w is None:
		return None
	bpp = {2: 3, 6: 4}[ct]
	inflated = zlib.decompress(raw)
	tile = np.zeros((h, w, 3), dtype=np.float64)
	i = 0
	prev = np.zeros(w * bpp, dtype=np.uint8)
	for y in range(h):
		i += 1
		row = np.frombuffer(inflated[i : i + w * bpp], dtype=np.uint8).copy()
		i += w * bpp
		for x in range(bpp, len(row)):
			row[x] = (row[x] + row[x - bpp]) & 255
		for x in range(w):
			if bpp == 4:
				tile[y, x] = row[x * 4 : x * 4 + 3] / 255.0
			else:
				tile[y, x] = row[x * 3 : x * 3 + 3] / 255.0
	print(f"[ComfyUI] grass tile {w}×{h} ({ckpt})")
	return tile


def apply_grain(base: np.ndarray, tile: np.ndarray, strength: float = 0.38) -> np.ndarray:
	"""Jeden kafel ComfyUI skalowany na całą mapę — bez repeat (zero szwów)."""
	th, tw, _ = tile.shape
	h, w, _ = base.shape
	ys = np.linspace(0, th - 1, h)
	xs = np.linspace(0, tw - 1, w)
	sx, sy = np.meshgrid(xs, ys)
	x0 = np.floor(sx).astype(int)
	y0 = np.floor(sy).astype(int)
	x1 = np.minimum(x0 + 1, tw - 1)
	y1 = np.minimum(y0 + 1, th - 1)
	fx = sx - x0
	fy = sy - y0
	out = np.zeros((h, w, 3), dtype=np.float64)
	for c in range(3):
		ch = tile[..., c]
		top = ch[y0, x0] * (1 - fx) + ch[y0, x1] * fx
		bot = ch[y1, x0] * (1 - fx) + ch[y1, x1] * fx
		out[..., c] = top * (1 - fy) + bot * fy
	return np.clip(base * (1 - strength) + out * strength, 0, 1)


def world_grid(h: int, w: int) -> tuple[np.ndarray, np.ndarray]:
	"""Wiersz = X (−40..40), kolumna = Z (−60..60)."""
	x = np.linspace(-HALF_W, HALF_W, h, dtype=np.float64)
	z = np.linspace(-HALF_L, HALF_L, w, dtype=np.float64)
	px, pz = np.meshgrid(x, z, indexing="ij")
	return px, pz


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
	t = np.clip((x - edge0) / (edge1 - edge0 + 1e-9), 0, 1)
	return t * t * (3 - 2 * t)


def blur_separable(img: np.ndarray, radius: int) -> np.ndarray:
	if radius <= 0:
		return img
	k = radius * 2 + 1
	ax = np.arange(k) - radius
	kernel = np.exp(-(ax**2) / (2 * (radius * 0.45) ** 2))
	kernel /= kernel.sum()
	out = img.copy()
	for c in range(3):
		ch = out[..., c]
		ch = np.apply_along_axis(lambda r: np.convolve(r, kernel, mode="same"), 1, ch)
		ch = np.apply_along_axis(lambda r: np.convolve(r, kernel, mode="same"), 0, ch)
		out[..., c] = ch
	return out


def add_team_zones(rgb: np.ndarray, px: np.ndarray, pz: np.ndarray) -> np.ndarray:
	"""Półokręgi stref: niebieska −X (lewo), pomarańczowa +X (prawo)."""
	dist = np.hypot(px, pz)
	in_circle = dist <= CENTER_R + 2.5
	edge = smoothstep(CENTER_R + 2.5, CENTER_R - 0.5, dist)
	glow_strength = edge * 0.22 * in_circle

	blue = np.array([0.05, 0.22, 0.95], dtype=np.float64)
	orange = np.array([0.98, 0.42, 0.05], dtype=np.float64)
	left = (px < -0.15) & in_circle
	right = (px > 0.15) & in_circle

	zone = rgb.copy()
	for mask, col in ((left, blue), (right, orange)):
		a = (glow_strength * mask)[..., None]
		zone = zone * (1 - a) + col * a

	mid = (np.abs(px) <= 0.15) & (dist < CENTER_R)
	zone[mid] = zone[mid] * 0.7 + np.array([0.55, 0.65, 0.85]) * 0.3
	return zone


def _letter_bitmap(ch: str) -> list[str]:
	font = {
		"I": ["111", "010", "010", "010", "111"],
		"G": ["011", "100", "101", "100", "011"],
		"N": ["1001", "1101", "1011", "1001", "1001"],
		"T": ["11111", "00100", "00100", "00100", "00100"],
		"E": ["1111", "1000", "1110", "1000", "1111"],
	}
	return font.get(ch, ["111", "101", "101", "101", "111"])


def draw_logo(rgb: np.ndarray, cx: int, cy: int) -> np.ndarray:
	text = "IGNITE"
	scale = max(12, TEX_W // 220)
	glyphs = [_letter_bitmap(c) for c in text]
	gap = scale // 2
	total_w = sum(max(len(g[0]) for g in gl) * scale for gl in glyphs) + gap * (len(glyphs) - 1)
	max_h = max(len(g) for g in glyphs) * scale
	x0 = cx - total_w // 2
	y0 = cy - max_h // 2

	mask = np.zeros(rgb.shape[:2], dtype=np.float64)
	glow = np.zeros_like(rgb)

	for ch, glyph in zip(text, glyphs):
		gw = max(len(row) for row in glyph)
		gh = len(glyph)
		for gy, row in enumerate(glyph):
			for gx, bit in enumerate(row):
				if bit != "1":
					continue
				x1 = x0 + gx * scale
				y1 = y0 + gy * scale
				x2 = x1 + scale
				y2 = y1 + scale
				if x2 <= 0 or y2 <= 0 or x1 >= TEX_W or y1 >= TEX_H:
					continue
				x1c, y1c = max(0, x1), max(0, y1)
				x2c, y2c = min(TEX_W, x2), min(TEX_H, y2)
				mask[y1c:y2c, x1c:x2c] = 1.0
				# Cyberpunk gradient: lewa połowa niebieska, prawa pomarańczowa
				t = (gx + 0.5) / gw
				col = np.array([0.15 + 0.1 * t, 0.55 + 0.15 * (1 - abs(t - 0.5)), 1.0 - 0.55 * t])
				glow[y1c:y2c, x1c:x2c] = np.maximum(glow[y1c:y2c, x1c:x2c], col)
		x0 += gw * scale + gap

	mask = blur_separable(np.stack([mask] * 3, axis=-1), 6)[..., 0]
	glow = blur_separable(glow, 10)
	halo = blur_separable(np.stack([mask] * 3, axis=-1), 18)

	out = rgb.copy()
	# Outer glow
	out = out * (1 - halo[..., 0:1] * 0.35) + glow * halo * 0.55
	# Core letter
	out = out * (1 - mask[..., None] * 0.92) + glow * mask[..., None] * 0.95 + np.array([0.92, 0.96, 1.0]) * mask[..., None] * 0.85
	return np.clip(out, 0, 1)


def draw_center_ring(rgb: np.ndarray, px: np.ndarray, pz: np.ndarray) -> np.ndarray:
	dist = np.hypot(px, pz)
	ring = (np.abs(dist - CENTER_R) < 0.22) & (dist <= CENTER_R + 0.5)
	out = rgb.copy()
	line = np.array([0.82, 0.88, 0.95])
	out[ring] = out[ring] * 0.35 + line * 0.65
	return out


def main() -> int:
	print(f"Generuję {OUT.name} ({TEX_W}×{TEX_H}, 80×120 m)…")
	rgb = grass_base(TEX_H, TEX_W)

	tile = comfy_grass_tile()
	if tile is not None:
		rgb = apply_grain(rgb, tile, 0.38)
	else:
		print("ComfyUI pominięte — proceduralna murawa.")

	if BAKE_MARKINGS:
		px, pz = world_grid(TEX_H, TEX_W)
		rgb = add_team_zones(rgb, px, pz)
		rgb = draw_center_ring(rgb, px, pz)
		rgb = draw_logo(rgb, TEX_W // 2, TEX_H // 2)

	out_u8 = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)
	write_png_rgb(OUT, out_u8)
	print(f"Zapisano: {OUT} ({OUT.stat().st_size // 1024} KiB)")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
