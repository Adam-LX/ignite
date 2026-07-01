#!/usr/bin/env python3
"""Generuje tekstury SplatMap murawy (ComfyUI 2048px lub proceduralny fallback)."""

from __future__ import annotations

import json
import math
import random
import struct
import sys
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "assets" / "textures"
COMFY_URL = "http://127.0.0.1:8188"
COMFY_OUTPUT = Path("/var/lib/comfyui/output")
SIZE = 2048  # web-friendly; --size 4096 opcjonalnie

ASSETS: list[tuple[str, str, str]] = [
	(
		"arena_grass_main.png",
		"Highly detailed photorealistic football pitch grass texture, dense vibrant green sports turf, "
		"seamless tileable top-down macro, uniform soft lighting, no seam, no stripe",
		"stripe, checkerboard, seam, brown, dry, blur, text, watermark",
	),
	(
		"arena_moss_detail.png",
		"Dark mossy grass patches on sports field, deep forest green micro texture, seamless tileable "
		"top-down, wet organic detail, no seam",
		"stripe, checkerboard, seam, sand, blur, text",
	),
	(
		"arena_sand_wear.png",
		"Worn sand and dry turf near soccer goal, beige sand mixed with sparse yellow grass, "
		"seamless tileable top-down, no seam",
		"stripe, checkerboard, vivid green, blur, text",
	),
	(
		"arena_mud_wear.png",
		"Kickoff circle mud wear on football pitch, brown soil mixed with dark green grass, "
		"seamless tileable top-down, no seam",
		"stripe, checkerboard, neon, blur, text",
	),
]

SPLAT_OUT = OUT / "arena_splat_map.png"


def _chunk(tag: bytes, data: bytes) -> bytes:
	crc = zlib.crc32(tag + data) & 0xFFFFFFFF
	return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def write_png_rgb(path: Path, w: int, h: int, rgb: bytes) -> None:
	raw = bytearray()
	for y in range(h):
		raw.append(0)
		for x in range(w):
			i = (y * w + x) * 3
			raw.extend(rgb[i : i + 3])
	comp = zlib.compress(bytes(raw), 9)
	ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
	png = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", comp) + _chunk(b"IEND", b"")
	path.parent.mkdir(parents=True, exist_ok=True)
	path.write_bytes(png)


def _hash(x: float, y: float, seed: float) -> float:
	return (math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453) % 1.0


def _fbm(x: float, y: float, seed: float, octaves: int = 5) -> float:
	amp = 0.5
	freq = 1.0
	total = 0.0
	norm = 0.0
	for i in range(octaves):
		total += amp * _hash(x * freq, y * freq, seed + i * 17.3)
		norm += amp
		amp *= 0.5
		freq *= 2.03
	return total / max(norm, 1e-6)


def _seamless_fbm(u: float, v: float, seed: float) -> float:
	# Toroidal sampling — brak widocznych krawędzi kafelka
	x = math.cos(u * math.tau) * 2.5
	y = math.sin(u * math.tau) * 2.5
	z = math.cos(v * math.tau) * 2.5
	w = math.sin(v * math.tau) * 2.5
	return (_fbm(x, y, seed) + _fbm(z, w, seed + 91.0)) * 0.5


def procedural_layer(kind: str, w: int, h: int) -> bytes:
	pixels = bytearray(w * h * 3)
	for y in range(h):
		v = y / h
		for x in range(w):
			u = x / w
			n = _seamless_fbm(u, v, {"grass": 3.0, "moss": 17.0, "sand": 41.0, "mud": 73.0}[kind])
			if kind == "grass":
				g = int(55 + n * 95 + _seamless_fbm(u * 3.1, v * 2.7, 5.0) * 35)
				r, g, b = max(0, g // 5), max(0, min(255, g)), max(0, g // 6)
			elif kind == "moss":
				g = int(28 + n * 55)
				r, g, b = max(0, g // 3), max(0, min(200, g)), max(0, g // 4)
			elif kind == "sand":
				base = int(145 + n * 55)
				r, g, b = min(255, base + 15), min(255, base), max(0, base - 35)
			else:  # mud
				base = int(55 + n * 45)
				r, g, b = min(255, base + 25), max(0, base - 5), max(0, base // 2)
			i = (y * w + x) * 3
			pixels[i] = r
			pixels[i + 1] = g
			pixels[i + 2] = b
	return bytes(pixels)


def generate_splat_map(w: int = 1024, h: int = 1536) -> None:
	"""R=moss (losowe plamy), G=piasek przy bramkach, B=błoto na kickoffie (środek)."""
	rgb = bytearray(w * h * 3)
	half_w, half_l = 40.0, 60.0
	for y in range(h):
		z = (y / (h - 1)) * (half_l * 2) - half_l
		for x in range(w):
			px = (x / (w - 1)) * (half_w * 2) - half_w
			moss = _fbm(px * 0.08, z * 0.08, 12.0, 4)
			moss = max(0.0, (moss - 0.42) * 2.2)
			goal_dist = abs(abs(z) - half_l)
			sand = max(0.0, 1.0 - goal_dist / 14.0) * 0.85
			center = math.hypot(px, z)
			mud = max(0.0, 1.0 - center / 11.0) * 0.75
			i = (y * w + x) * 3
			rgb[i] = int(min(255, moss * 255))
			rgb[i + 1] = int(min(255, sand * 255))
			rgb[i + 2] = int(min(255, mud * 255))
	write_png_rgb(SPLAT_OUT, w, h, bytes(rgb))
	print(f"Zapisano splat map: {SPLAT_OUT}")


def comfy_available() -> bool:
	try:
		with urllib.request.urlopen(f"{COMFY_URL}/system_stats", timeout=5) as resp:
			return resp.status == 200
	except OSError:
		return False


def api_get(path: str) -> dict:
	with urllib.request.urlopen(f"{COMFY_URL}{path}", timeout=30) as resp:
		return json.loads(resp.read())


def api_post(path: str, payload: dict) -> dict:
	data = json.dumps(payload).encode()
	req = urllib.request.Request(
		f"{COMFY_URL}{path}",
		data=data,
		headers={"Content-Type": "application/json"},
		method="POST",
	)
	with urllib.request.urlopen(req, timeout=60) as resp:
		return json.loads(resp.read())


def pick_checkpoint() -> str:
	info = api_get("/object_info/CheckpointLoaderSimple")
	choices = info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
	for preferred in (
		"juggernautXL_v9Rdphoto2Lightning.safetensors",
		"juggernaut_xl.safetensors",
	):
		if preferred in choices:
			return preferred
	return choices[0] if choices else ""


def build_workflow(ckpt: str, prompt: str, negative: str, seed: int, size: int) -> dict:
	lightning = "Lightning" in ckpt or "Turbo" in ckpt
	steps = 8 if lightning else 28
	cfg = 2.0 if lightning else 6.5
	sampler = "dpmpp_sde" if lightning else "dpmpp_2m"
	return {
		"4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
		"5": {"class_type": "EmptyLatentImage", "inputs": {"width": size, "height": size, "batch_size": 1}},
		"6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
		"7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["4", 1]}},
		"3": {
			"class_type": "KSampler",
			"inputs": {
				"seed": seed,
				"steps": steps,
				"cfg": cfg,
				"sampler_name": sampler,
				"scheduler": "karras",
				"denoise": 1.0,
				"model": ["4", 0],
				"positive": ["6", 0],
				"negative": ["7", 0],
				"latent_image": ["5", 0],
			},
		},
		"8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
		"9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "flyball_arena", "images": ["8", 0]}},
	}


def wait_for_image(prompt_id: str, timeout_s: int = 900) -> str:
	deadline = time.time() + timeout_s
	while time.time() < deadline:
		time.sleep(2)
		try:
			history = api_get(f"/history/{prompt_id}")
		except urllib.error.HTTPError:
			continue
		entry = history.get(prompt_id)
		if not entry or "outputs" not in entry:
			continue
		images = entry["outputs"].get("9", {}).get("images", [])
		if images:
			return images[0]["filename"]
	raise TimeoutError(f"ComfyUI timeout ({timeout_s}s)")


def generate_via_comfy(name: str, prompt: str, negative: str, ckpt: str, size: int) -> bool:
	seed = (int(time.time()) + hash(name)) % 2_147_483_647
	print(f"[ComfyUI] {name} ({size}px)…")
	result = api_post("/prompt", {"prompt": build_workflow(ckpt, prompt, negative, seed, size)})
	prompt_id = result.get("prompt_id")
	if not prompt_id:
		return False
	filename = wait_for_image(prompt_id)
	out = OUT / name
	OUT.mkdir(parents=True, exist_ok=True)
	try:
		with urllib.request.urlopen(f"{COMFY_URL}/view?filename={filename}&type=output", timeout=120) as resp:
			out.write_bytes(resp.read())
	except OSError:
		host_copy = COMFY_OUTPUT / filename
		if host_copy.is_file():
			out.write_bytes(host_copy.read_bytes())
		else:
			raise
	print(f"  → {out} ({out.stat().st_size} B)")
	return True


def derive_from_grass_jpg() -> None:
	"""Fallback: pochodne z istniejącej grass_color.jpg (ffmpeg)."""
	import shutil
	import subprocess

	src = OUT / "grass_color.jpg"
	if not src.is_file():
		return
	ffmpeg = shutil.which("ffmpeg")
	if not ffmpeg:
		return
	presets = [
		("arena_grass_main.png", "eq=brightness=0.04:saturation=1.15"),
		("arena_moss_detail.png", "eq=brightness=-0.18:saturation=0.75:gamma=1.15"),
		("arena_sand_wear.png", "eq=brightness=0.42:saturation=0.35:gamma=0.85"),
		("arena_mud_wear.png", "eq=brightness=-0.12:saturation=0.55:gamma=1.2"),
	]
	for name, vf in presets:
		out = OUT / name
		if out.is_file():
			continue
		try:
			subprocess.run(
				[ffmpeg, "-y", "-i", str(src), "-vf", f"{vf},scale={SIZE}:{SIZE}", str(out)],
				check=True,
				capture_output=True,
			)
			print(f"  → {out} (z grass_color.jpg)")
		except subprocess.CalledProcessError as exc:
			print(f"  ffmpeg skip {name}: {exc.stderr.decode(errors='replace')[:120]}", file=sys.stderr)


def main() -> int:
	global SIZE
	force = "--force" in sys.argv
	if "--size" in sys.argv:
		idx = sys.argv.index("--size")
		SIZE = int(sys.argv[idx + 1])

	OUT.mkdir(parents=True, exist_ok=True)
	use_comfy = comfy_available()
	print(f"ComfyUI: {'TAK' if use_comfy else 'NIE'} ({COMFY_URL})")
	print(f"Rozdzielczość warstw: {SIZE}px")

	if use_comfy:
		try:
			ckpt = pick_checkpoint()
			print(f"Checkpoint: {ckpt}")
			for name, prompt, negative in ASSETS:
				if (OUT / name).is_file() and not force:
					print(f"Pomijam (istnieje): {name}")
					continue
				if not generate_via_comfy(name, prompt, negative, ckpt, SIZE):
					print(f"ComfyUI fail: {name}", file=sys.stderr)
					use_comfy = False
					break
		except Exception as exc:
			print(f"ComfyUI błąd: {exc}", file=sys.stderr)
			use_comfy = False

	if not use_comfy:
		print("ComfyUI niedostępne — przerwano (bez ffmpeg fallback).", file=sys.stderr)
		print("Uruchom: sudo systemctl reset-failed podman-comfyui.service && sudo systemctl start podman-comfyui.service", file=sys.stderr)
		return 1

	generate_splat_map(1024, 1536)
	print("Arena splat assets — gotowe.")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
