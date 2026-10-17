#!/usr/bin/env python3
"""Stadium light gobo (cookie) + murawa wear maps — ComfyUI / SM.

  python3 scripts/generate_stadium_gobo_wear_comfyui.py
  python3 scripts/generate_stadium_gobo_wear_comfyui.py --only gobo
  python3 scripts/generate_stadium_gobo_wear_comfyui.py --only wear
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageChops

COMFY = "http://127.0.0.1:8188"
ROOT = Path(__file__).resolve().parents[1]
TEX = ROOT / "public/assets/textures"
WORK = Path.home() / "StabilityMatrix" / "Images" / "IgniteArena"

CKPT = "juggernaut_xl.safetensors"

GOBO_PROMPT = (
	"flat orthographic stadium floodlight gobo cookie texture, "
	"grayscale only, soft hexagonal lattice grille, thin metal bars, "
	"circular soft vignette falloff to black, center brighter, "
	"projection mask for spotlight, no color, no text, no logo, "
	"game engine light cookie, high contrast soft edges"
)
GOBO_NEG = (
	"color, rainbow, text, logo, photo, people, cars, stadium seats, "
	"perspective, 3d scene, grass, sky, watermark, noisy grain heavy"
)

WEAR_PROMPT = (
	"seamless tileable worn stadium turf detail texture, top-down, "
	"muted olive-brown worn grass patches mixed with thin mud streaks, "
	"subtle sand scuffs, soft tire marks, PBR albedo, flat lighting, "
	"no chalk lines, no logo, no text, game texture"
)
WEAR_NEG = (
	"text, logo, pitch markings, people, cars, perspective, sky, "
	"bright green healthy lawn only, watermark, vignette"
)

SPLAT_PROMPT = (
	"flat top-down stadium pitch splat distribution map, "
	"RGB channels as masks: red=moss patches near walls, "
	"green=sand wear near goals and sidelines, blue=mud center midfield, "
	"black elsewhere, soft organic blobs, no text, no photo of stadium"
)
SPLAT_NEG = (
	"photoreal grass, stadium seats, text, logo, people, cars, "
	"hard checkerboard, watermark"
)


def get_json(url: str, timeout: float = 30):
	with urllib.request.urlopen(url, timeout=timeout) as resp:
		return json.loads(resp.read())


def post_json(url: str, payload: dict, timeout: float = 60):
	req = urllib.request.Request(
		url,
		data=json.dumps(payload).encode(),
		headers={"Content-Type": "application/json"},
		method="POST",
	)
	with urllib.request.urlopen(req, timeout=timeout) as resp:
		return json.loads(resp.read())


def post_multipart(url: str, fields: dict[str, str], file_field: str, filename: str, data: bytes):
	boundary = f"----IgniteGobo{int(time.time() * 1000)}"
	parts: list[bytes] = []
	for k, v in fields.items():
		parts.append(
			f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
		)
	ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
	parts.append(
		(
			f"--{boundary}\r\n"
			f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
			f"Content-Type: {ctype}\r\n\r\n"
		).encode()
		+ data
		+ b"\r\n"
	)
	parts.append(f"--{boundary}--\r\n".encode())
	req = urllib.request.Request(
		url,
		data=b"".join(parts),
		headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
		method="POST",
	)
	with urllib.request.urlopen(req, timeout=120) as resp:
		return json.loads(resp.read())


def strip_png(path: Path) -> None:
	with Image.open(path) as im:
		clean = Image.new(im.mode, im.size)
		clean.paste(im)
	clean.save(path, format="PNG", optimize=True)


def download(filename: str, subfolder: str, typ: str, dest: Path) -> None:
	q = urllib.parse.urlencode(
		{"filename": filename, "subfolder": subfolder, "type": typ}
	)
	with urllib.request.urlopen(f"{COMFY}/view?{q}", timeout=120) as resp:
		dest.parent.mkdir(parents=True, exist_ok=True)
		dest.write_bytes(resp.read())
	if dest.suffix.lower() == ".png":
		strip_png(dest)


def wait_image(prompt_id: str, timeout_s: float = 420) -> tuple[str, str, str]:
	deadline = time.time() + timeout_s
	while time.time() < deadline:
		time.sleep(1.4)
		try:
			hist = get_json(f"{COMFY}/history/{prompt_id}", timeout=20)
		except Exception:
			continue
		entry = hist.get(prompt_id)
		if not entry:
			continue
		for node in (entry.get("outputs") or {}).values():
			for img in node.get("images") or []:
				return img["filename"], img.get("subfolder", ""), img.get("type", "output")
		status = entry.get("status") or {}
		if status.get("status_str") == "error":
			raise RuntimeError(f"ComfyUI error: {status}")
	raise TimeoutError(prompt_id)


def upload(path: Path) -> str:
	resp = post_multipart(
		f"{COMFY}/upload/image",
		{"overwrite": "true"},
		"image",
		path.name,
		path.read_bytes(),
	)
	return resp.get("name") or path.name


def img2img(ckpt: str, image_name: str, prompt: str, neg: str, seed: int, prefix: str, denoise: float) -> tuple[str, str, str]:
	wf = {
		"4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
		"10": {"class_type": "LoadImage", "inputs": {"image": image_name}},
		"11": {"class_type": "VAEEncode", "inputs": {"pixels": ["10", 0], "vae": ["4", 2]}},
		"6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
		"7": {"class_type": "CLIPTextEncode", "inputs": {"text": neg, "clip": ["4", 1]}},
		"3": {
			"class_type": "KSampler",
			"inputs": {
				"seed": seed,
				"steps": 22,
				"cfg": 5.5,
				"sampler_name": "dpmpp_2m",
				"scheduler": "karras",
				"denoise": denoise,
				"model": ["4", 0],
				"positive": ["6", 0],
				"negative": ["7", 0],
				"latent_image": ["11", 0],
			},
		},
		"8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
		"9": {"class_type": "SaveImage", "inputs": {"filename_prefix": prefix, "images": ["8", 0]}},
	}
	resp = post_json(f"{COMFY}/prompt", {"prompt": wf})
	pid = resp["prompt_id"]
	print(f"  prompt_id={pid}")
	return wait_image(pid)


def make_gobo_template(size: int = 768) -> Image.Image:
	im = Image.new("L", (size, size), 0)
	draw = ImageDraw.Draw(im)
	cx = cy = size / 2
	# soft radial discs
	for r, v in ((size * 0.48, 90), (size * 0.36, 130), (size * 0.22, 170), (size * 0.1, 210)):
		draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=v)
	im = im.filter(ImageFilter.GaussianBlur(radius=18))
	# hex lattice
	draw = ImageDraw.Draw(im)
	R = 38
	for row in range(-8, 9):
		for col in range(-8, 9):
			ox = cx + col * R * 1.55 + (row % 2) * R * 0.775
			oy = cy + row * R * 1.35
			pts = []
			for k in range(6):
				ang = math.pi / 6 + k * math.pi / 3
				pts.append((ox + math.cos(ang) * R * 0.72, oy + math.sin(ang) * R * 0.72))
			draw.line(pts + [pts[0]], fill=220, width=3)
	draw.ellipse([cx - 18, cy - 18, cx + 18, cy + 18], outline=245, width=3)
	im = im.filter(ImageFilter.GaussianBlur(radius=1.4))
	mask = Image.new("L", (size, size), 0)
	md = ImageDraw.Draw(mask)
	md.ellipse([24, 24, size - 24, size - 24], fill=255)
	mask = mask.filter(ImageFilter.GaussianBlur(28))
	im = ImageChops.multiply(im, mask)
	return im.convert("RGB")


def make_wear_template(size: int = 1024) -> Image.Image:
	"""Muted wear albedo seed for img2img."""
	import random

	rng = random.Random(42)
	im = Image.new("RGB", (size, size), (62, 88, 42))
	px = im.load()
	for _ in range(180):
		x = rng.randint(0, size - 1)
		y = rng.randint(0, size - 1)
		r = rng.randint(40, 160)
		col = rng.choice([(78, 70, 42), (54, 48, 32), (96, 90, 55), (48, 62, 36)])
		draw = ImageDraw.Draw(im)
		draw.ellipse([x - r, y - r, x + r, y + r], fill=col)
	im = im.filter(ImageFilter.GaussianBlur(18))
	# grain
	for y in range(0, size, 2):
		for x in range(0, size, 2):
			j = rng.randint(-8, 8)
			r, g, b = px[x, y]
			px[x, y] = (max(0, min(255, r + j)), max(0, min(255, g + j)), max(0, min(255, b + j)))
	return im


def make_splat_template(size: int = 1024) -> Image.Image:
	import random

	rng = random.Random(7)
	im = Image.new("RGB", (size, size), (0, 0, 0))
	draw = ImageDraw.Draw(im)
	# red moss — edges
	for _ in range(40):
		x = rng.choice([rng.randint(0, size // 5), rng.randint(4 * size // 5, size - 1)])
		y = rng.randint(0, size - 1)
		r = rng.randint(30, 90)
		draw.ellipse([x - r, y - r, x + r, y + r], fill=(180, 0, 0))
	# green sand — goals (top/bottom)
	for _ in range(50):
		x = rng.randint(0, size - 1)
		y = rng.choice([rng.randint(0, size // 6), rng.randint(5 * size // 6, size - 1)])
		r = rng.randint(40, 110)
		draw.ellipse([x - r, y - r, x + r, y + r], fill=(0, 190, 0))
	# blue mud — center
	for _ in range(35):
		x = rng.randint(size // 3, 2 * size // 3)
		y = rng.randint(size // 3, 2 * size // 3)
		r = rng.randint(35, 100)
		draw.ellipse([x - r, y - r, x + r, y + r], fill=(0, 0, 200))
	return im.filter(ImageFilter.GaussianBlur(22))


def to_grayscale_cookie(src: Path, dest: Path) -> None:
	im = Image.open(src).convert("L")
	# boost contrast for cookie
	px = im.load()
	w, h = im.size
	for y in range(h):
		for x in range(w):
			v = px[x, y]
			v = int(max(0, min(255, (v - 20) * 1.25)))
			px[x, y] = v
	# radial black edge
	mask = Image.new("L", (w, h), 0)
	md = ImageDraw.Draw(mask)
	md.ellipse([16, 16, w - 16, h - 16], fill=255)
	mask = mask.filter(ImageFilter.GaussianBlur(22))
	im = ImageChops.multiply(im, mask)
	im = im.resize((512, 512), Image.Resampling.LANCZOS)
	im.convert("RGB").save(dest, format="PNG", optimize=True)
	strip_png(dest)


def run_gobo() -> None:
	print("=== GOBO cookie ===")
	WORK.mkdir(parents=True, exist_ok=True)
	tpl = WORK / "gobo_template.png"
	make_gobo_template(768).save(tpl)
	name = upload(tpl)
	seed = int(time.time()) % (2**31 - 1)
	print(f"  seed={seed}")
	fn, sub, typ = img2img(CKPT, name, GOBO_PROMPT, GOBO_NEG, seed, "ignite_gobo", 0.52)
	raw = WORK / "gobo_raw.png"
	download(fn, sub, typ, raw)
	out = TEX / "stadium_light_gobo.png"
	to_grayscale_cookie(raw, out)
	print(f"✓ {out}")


def run_wear() -> None:
	print("=== WEAR albedo + splat ===")
	WORK.mkdir(parents=True, exist_ok=True)

	# mud wear enhance from existing or template
	src = TEX / "arena_mud_wear.png"
	work = WORK / "mud_src.png"
	if src.exists():
		Image.open(src).convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS).save(work)
	else:
		make_wear_template().save(work)
	name = upload(work)
	seed = (int(time.time()) + 11) % (2**31 - 1)
	print(f"  mud seed={seed}")
	fn, sub, typ = img2img(CKPT, name, WEAR_PROMPT, WEAR_NEG, seed, "ignite_mud_wear", 0.45)
	raw = WORK / "mud_raw.png"
	download(fn, sub, typ, raw)
	mud = Image.open(raw).convert("RGB").resize((2048, 2048), Image.Resampling.LANCZOS)
	# seamless-ish offset blend X
	mud = ImageChops.offset(mud, 1024, 1024)
	mud.save(TEX / "arena_mud_wear.png", format="PNG", optimize=True)
	strip_png(TEX / "arena_mud_wear.png")

	# sand from mud tint
	sand = Image.blend(mud, Image.new("RGB", mud.size, (168, 148, 96)), 0.35)
	sand.save(TEX / "arena_sand_wear.png", format="PNG", optimize=True)
	strip_png(TEX / "arena_sand_wear.png")

	# splat map
	spl_tpl = WORK / "splat_tpl.png"
	make_splat_template(1024).save(spl_tpl)
	name = upload(spl_tpl)
	seed = (int(time.time()) + 29) % (2**31 - 1)
	print(f"  splat seed={seed}")
	fn, sub, typ = img2img(CKPT, name, SPLAT_PROMPT, SPLAT_NEG, seed, "ignite_splat", 0.5)
	raw = WORK / "splat_raw.png"
	download(fn, sub, typ, raw)
	sp = Image.open(raw).convert("RGB").resize((2048, 2048), Image.Resampling.LANCZOS)
	sp.save(TEX / "arena_splat_map.png", format="PNG", optimize=True)
	strip_png(TEX / "arena_splat_map.png")
	print("✓ arena_mud_wear / sand_wear / splat_map")


def main() -> int:
	ap = argparse.ArgumentParser()
	ap.add_argument("--only", choices=("gobo", "wear"))
	args = ap.parse_args()
	print("ComfyUI…")
	get_json(f"{COMFY}/system_stats", timeout=30)
	if args.only in (None, "gobo"):
		run_gobo()
	if args.only in (None, "wear"):
		run_wear()
	print("DONE")
	return 0


if __name__ == "__main__":
	try:
		raise SystemExit(main())
	except Exception as e:
		print(f"ERROR: {e}", file=sys.stderr)
		raise SystemExit(1)
