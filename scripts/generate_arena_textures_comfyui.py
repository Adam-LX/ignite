#!/usr/bin/env python3
"""Murawa + bandy LED + (opcjonalnie) skybox IBL — ComfyUI / Stability Matrix.

Użycie:
  python3 scripts/generate_arena_textures_comfyui.py
  python3 scripts/generate_arena_textures_comfyui.py --skip-sky
  python3 scripts/generate_arena_textures_comfyui.py --only grass|banner|sky

Wymaga ComfyUI na :8188 (SM). Wyniki trafiają w ścieżki z arena-manifest.json.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

COMFY = "http://127.0.0.1:8188"
ROOT = Path(__file__).resolve().parents[1]
TEX = ROOT / "public/assets/textures"
WORK = Path.home() / "StabilityMatrix" / "Images" / "IgniteArena"
MANIFEST = ROOT / "public/assets/meshy/arena-manifest.json"

CKPT_PREF = (
	"juggernaut_xl.safetensors",
	"juggernautXL_v9Rdphoto2Lightning.safetensors",
	"DreamShaperXL_Turbo_dpmppSdeKarras_half_pruned_6.safetensors",
)

GRASS_PROMPT = (
	"photorealistic seamless tileable soccer stadium turf albedo texture, "
	"top-down orthographic, dense short-cropped natural green grass blades, "
	"subtle mow direction variation, soft wear patches, PBR basecolor, "
	"even flat studio lighting, no shadows from sun, no grid lines, no chalk lines, "
	"no logo, no watermark, uniform coverage, game-ready 2k texture"
)
GRASS_NEG = (
	"text, logo, watermark, chalk lines, pitch markings, center circle, "
	"dirt patches large, mud puddles, flowers, weeds, people, cars, stadium, "
	"perspective, horizon, 3d render, lowres, blurry, repeating square grid, "
	"checkerboard, vignette, strong directional sunlight, blue tint"
)

BANNER_PROMPT = (
	"seamless tileable LED stadium perimeter advertising board panel texture, "
	"widescreen 16:9, dark carbon fiber LED matrix pixel grid, "
	"electric cyan and amber-orange neon racing chevrons and geometric stripes, "
	"holographic esports energy bars, Ignite arena vibe, high emissive glow, "
	"flat orthographic front view, game PBR albedo+emissive, "
	"no letters, no numbers, no logos, no faces, no cars, no watermark"
)
BANNER_NEG = (
	"text, letters, numbers, logo, watermark, brand name, readable words, "
	"faces, people, cars, soccer ball, grass, sky, perspective, "
	"photo frame, UI chrome, blurry, lowres, purple haze cliché"
)

SKY_PROMPT = (
	"equirectangular 360 panoramic night sky for stadium IBL, "
	"cyberpunk megacity horizon band of cyan window lights and amber street glow, "
	"upper sky deep indigo with soft magenta storm clouds and volumetric godrays, "
	"cinematic esports atmosphere, soft haze, no stadium structure, no grass, "
	"no cars, no people, no text, seamless left-right wrap, photographic game HDRI look"
)
SKY_NEG = (
	"text, watermark, stadium seats, pitch, grass, cars, people, faces, "
	"fisheye distortion heavy, broken seam, collage, UI, logo, sun disk daytime"
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


def post_multipart(
	url: str,
	fields: dict[str, str],
	file_field: str,
	filename: str,
	data: bytes,
):
	boundary = f"----IgniteArena{int(time.time() * 1000)}"
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


def pick_ckpt() -> str:
	try:
		info = get_json(f"{COMFY}/object_info/CheckpointLoaderSimple", timeout=90)
		names = info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
		for pref in CKPT_PREF:
			if pref in names:
				return pref
		return names[0]
	except Exception:
		return CKPT_PREF[0]


def is_turbo(ckpt: str) -> bool:
	n = ckpt.lower()
	return "turbo" in n or "lightning" in n


def strip_png_metadata(path: Path) -> None:
	with Image.open(path) as im:
		clean = Image.new(im.mode, im.size)
		clean.paste(im)
	path.parent.mkdir(parents=True, exist_ok=True)
	clean.save(path, format="PNG", optimize=True)


def download(filename: str, subfolder: str, typ: str, dest: Path) -> None:
	q = urllib.parse.urlencode(
		{"filename": filename, "subfolder": subfolder, "type": typ}
	)
	with urllib.request.urlopen(f"{COMFY}/view?{q}", timeout=120) as resp:
		dest.parent.mkdir(parents=True, exist_ok=True)
		dest.write_bytes(resp.read())
	if dest.suffix.lower() == ".png":
		strip_png_metadata(dest)


def wait_image(prompt_id: str, timeout_s: float = 420) -> tuple[str, str, str]:
	deadline = time.time() + timeout_s
	while time.time() < deadline:
		time.sleep(1.5)
		try:
			hist = get_json(f"{COMFY}/history/{prompt_id}", timeout=20)
		except Exception:
			continue
		entry = hist.get(prompt_id)
		if not entry:
			continue
		for node in (entry.get("outputs") or {}).values():
			for img in node.get("images") or []:
				return (
					img["filename"],
					img.get("subfolder", ""),
					img.get("type", "output"),
				)
		status = entry.get("status") or {}
		if status.get("status_str") == "error":
			raise RuntimeError(f"ComfyUI error: {status}")
	raise TimeoutError(f"ComfyUI timeout ({timeout_s}s) id={prompt_id}")


def upload_image(path: Path) -> str:
	data = path.read_bytes()
	resp = post_multipart(
		f"{COMFY}/upload/image",
		{"overwrite": "true"},
		"image",
		path.name,
		data,
	)
	name = resp.get("name") or path.name
	return name


def txt2img_workflow(
	ckpt: str,
	prompt: str,
	neg: str,
	seed: int,
	prefix: str,
	w: int,
	h: int,
) -> dict:
	turbo = is_turbo(ckpt)
	steps = 8 if turbo else 26
	cfg = 2.0 if turbo else 6.0
	sampler = "dpmpp_sde" if turbo else "dpmpp_2m"
	return {
		"4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
		"5": {
			"class_type": "EmptyLatentImage",
			"inputs": {"batch_size": 1, "height": h, "width": w},
		},
		"6": {
			"class_type": "CLIPTextEncode",
			"inputs": {"text": prompt, "clip": ["4", 1]},
		},
		"7": {
			"class_type": "CLIPTextEncode",
			"inputs": {"text": neg, "clip": ["4", 1]},
		},
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
		"8": {
			"class_type": "VAEDecode",
			"inputs": {"samples": ["3", 0], "vae": ["4", 2]},
		},
		"9": {
			"class_type": "SaveImage",
			"inputs": {"filename_prefix": prefix, "images": ["8", 0]},
		},
	}


def img2img_workflow(
	ckpt: str,
	image_name: str,
	prompt: str,
	neg: str,
	seed: int,
	prefix: str,
	denoise: float,
) -> dict:
	turbo = is_turbo(ckpt)
	steps = 8 if turbo else 24
	cfg = 2.0 if turbo else 5.5
	sampler = "dpmpp_sde" if turbo else "dpmpp_2m"
	return {
		"4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
		"10": {
			"class_type": "LoadImage",
			"inputs": {"image": image_name},
		},
		"11": {
			"class_type": "VAEEncode",
			"inputs": {"pixels": ["10", 0], "vae": ["4", 2]},
		},
		"6": {
			"class_type": "CLIPTextEncode",
			"inputs": {"text": prompt, "clip": ["4", 1]},
		},
		"7": {
			"class_type": "CLIPTextEncode",
			"inputs": {"text": neg, "clip": ["4", 1]},
		},
		"3": {
			"class_type": "KSampler",
			"inputs": {
				"seed": seed,
				"steps": steps,
				"cfg": cfg,
				"sampler_name": sampler,
				"scheduler": "karras",
				"denoise": denoise,
				"model": ["4", 0],
				"positive": ["6", 0],
				"negative": ["7", 0],
				"latent_image": ["11", 0],
			},
		},
		"8": {
			"class_type": "VAEDecode",
			"inputs": {"samples": ["3", 0], "vae": ["4", 2]},
		},
		"9": {
			"class_type": "SaveImage",
			"inputs": {"filename_prefix": prefix, "images": ["8", 0]},
		},
	}


def queue(wf: dict) -> tuple[str, str, str]:
	resp = post_json(f"{COMFY}/prompt", {"prompt": wf})
	pid = resp["prompt_id"]
	print(f"  prompt_id={pid}")
	return wait_image(pid)


def make_seamless(im: Image.Image, blend: int = 96) -> Image.Image:
	"""Offset-blend half — usuwa szwy przy RepeatWrapping."""
	im = im.convert("RGB")
	w, h = im.size
	ox, oy = w // 2, h // 2
	shifted = ImageChops.offset(im, ox, oy)
	mask = Image.new("L", (w, h), 0)
	# miękki krzyż przez środek (szew po offset)
	from PIL import ImageDraw

	draw = ImageDraw.Draw(mask)
	bw = max(8, blend)
	for i in range(bw):
		a = int(255 * (1.0 - abs(i - bw / 2) / (bw / 2)))
		draw.line([(ox - bw // 2 + i, 0), (ox - bw // 2 + i, h)], fill=a)
		draw.line([(0, oy - bw // 2 + i), (w, oy - bw // 2 + i)], fill=a)
	mask = mask.filter(ImageFilter.GaussianBlur(radius=bw * 0.35))
	out = Image.composite(shifted, im, mask)
	# drugi pass — lekki blur szwu
	return ImageChops.offset(out, -ox // 4, -oy // 4)


def bake_grass_pbr(raw_png: Path) -> None:
	"""Reuse bake_meshy_grass_maps.py via RAW symlink swap."""
	raw_dest = TEX / "meshy_grass_raw.png"
	# backup
	bak = TEX / "meshy_grass_raw.bak.png"
	if raw_dest.exists() and not bak.exists():
		bak.write_bytes(raw_dest.read_bytes())
	im = Image.open(raw_png).convert("RGB").resize((2048, 2048), Image.Resampling.LANCZOS)
	im = make_seamless(im, blend=120)
	im.save(raw_dest, format="PNG", optimize=True)
	strip_png_metadata(raw_dest)
	py = sys.executable
	subprocess.check_call([py, str(ROOT / "scripts/bake_meshy_grass_maps.py")])
	# mirror to default grass_* used when manifest missing
	for src_name, dst_name in (
		("meshy_grass_color.jpg", "grass_color.jpg"),
		("meshy_grass_normal.jpg", "grass_normal.jpg"),
		("meshy_grass_roughness.jpg", "grass_roughness.jpg"),
	):
		src = TEX / src_name
		dst = TEX / dst_name
		if src.exists():
			dst.write_bytes(src.read_bytes())
	print(f"✓ grass PBR → meshy_grass_*.jpg + grass_*.jpg")


def save_banner(raw: Path) -> None:
	im = Image.open(raw).convert("RGB")
	# target ~16:9 LED strip
	im = im.resize((2048, 1152), Image.Resampling.LANCZOS)
	# soft horizontal seam for RepeatWrapping on X
	w, h = im.size
	ox = w // 2
	shifted = ImageChops.offset(im, ox, 0)
	mask = Image.new("L", (w, h), 0)
	from PIL import ImageDraw

	draw = ImageDraw.Draw(mask)
	bw = 80
	for i in range(bw):
		a = int(255 * (1.0 - abs(i - bw / 2) / (bw / 2)))
		draw.line([(ox - bw // 2 + i, 0), (ox - bw // 2 + i, h)], fill=a)
	mask = mask.filter(ImageFilter.GaussianBlur(radius=18))
	im = Image.composite(shifted, im, mask)
	out = TEX / "meshy_banner_panel.png"
	im.save(out, format="PNG", optimize=True)
	strip_png_metadata(out)
	# team-tint variants for optional use
	for name, tint in (
		("meshy_banner_blue.png", (40, 180, 255)),
		("meshy_banner_orange.png", (255, 140, 40)),
	):
		tinted = Image.blend(im, Image.new("RGB", im.size, tint), 0.22)
		tinted.save(TEX / name, format="PNG", optimize=True)
		strip_png_metadata(TEX / name)
	print(f"✓ banner → {out.name} (+ blue/orange)")


def save_sky(raw: Path) -> None:
	im = Image.open(raw).convert("RGB")
	im = im.resize((4096, 2048), Image.Resampling.LANCZOS)
	# horizontal wrap seam
	w, h = im.size
	ox = w // 2
	shifted = ImageChops.offset(im, ox, 0)
	mask = Image.new("L", (w, h), 0)
	from PIL import ImageDraw

	draw = ImageDraw.Draw(mask)
	bw = 120
	for i in range(bw):
		a = int(255 * (1.0 - abs(i - bw / 2) / (bw / 2)))
		draw.line([(ox - bw // 2 + i, 0), (ox - bw // 2 + i, h)], fill=a)
	mask = mask.filter(ImageFilter.GaussianBlur(radius=28))
	im = Image.composite(shifted, im, mask)
	png = TEX / "cyberpunk_skybox.png"
	jpg = TEX / "cyberpunk_skybox.jpg"
	bak = TEX / "cyberpunk_skybox.bak.png"
	if png.exists() and not bak.exists():
		bak.write_bytes(png.read_bytes())
	im.save(png, format="PNG", optimize=True)
	strip_png_metadata(png)
	im.save(jpg, format="JPEG", quality=92, optimize=True)
	print(f"✓ skybox IBL → {png.name} (PMREM / LightProbe)")


def bump_manifest() -> None:
	if not MANIFEST.exists():
		return
	data = json.loads(MANIFEST.read_text())
	data["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
	MANIFEST.write_text(json.dumps(data, indent="\t") + "\n")
	print(f"✓ manifest updatedAt → {data['updatedAt']}")


def run_grass(ckpt: str) -> None:
	print("=== GRASS (img2img enhance + seamless bake) ===")
	src = TEX / "meshy_grass_color.jpg"
	if not src.exists():
		src = TEX / "grass_color.jpg"
	work = WORK / "grass_src.png"
	WORK.mkdir(parents=True, exist_ok=True)
	Image.open(src).convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS).save(
		work, format="PNG"
	)
	name = upload_image(work)
	seed = int(time.time()) % (2**31 - 1)
	denoise = 0.42 if is_turbo(ckpt) else 0.48
	print(f"  ckpt={ckpt} seed={seed} denoise={denoise}")
	fn, sub, typ = queue(
		img2img_workflow(
			ckpt, name, GRASS_PROMPT, GRASS_NEG, seed, "ignite_grass", denoise
		)
	)
	raw = WORK / "grass_raw.png"
	download(fn, sub, typ, raw)
	bake_grass_pbr(raw)


def run_banner(ckpt: str) -> None:
	print("=== BANNER / BANDY LED (template → img2img flat) ===")
	from PIL import ImageDraw

	WORK.mkdir(parents=True, exist_ok=True)
	# procedural flat LED plate — unikamy 3D „scen” z txt2img
	w, h = 1536, 768
	im = Image.new("RGB", (w, h), (8, 10, 16))
	px = im.load()
	for y in range(h):
		for x in range(w):
			gx, gy = x // 4, y // 4
			base = 10 + ((gx * 17 + gy * 13) % 7)
			px[x, y] = (base, base + 2, base + 6)
	draw = ImageDraw.Draw(im, "RGBA")
	for i in range(7):
		x0 = 40 + i * 90
		pts = [
			(x0, 80),
			(x0 + 70, h // 2),
			(x0, h - 80),
			(x0 + 28, h - 80),
			(x0 + 90, h // 2),
			(x0 + 28, 80),
		]
		draw.polygon(pts, fill=(0, 220, 255, 210))
	for i in range(7):
		x0 = w - 110 - i * 90
		pts = [
			(x0, 80),
			(x0 - 70, h // 2),
			(x0, h - 80),
			(x0 - 28, h - 80),
			(x0 - 90, h // 2),
			(x0 - 28, 80),
		]
		draw.polygon(pts, fill=(255, 140, 30, 210))
	draw.rectangle([w // 2 - 40, 120, w // 2 + 40, h - 120], fill=(255, 230, 180, 180))
	draw.rectangle([w // 2 - 18, 160, w // 2 + 18, h - 160], fill=(255, 255, 255, 220))
	draw.rectangle([0, 36, w, 56], fill=(0, 255, 220, 160))
	draw.rectangle([0, h - 56, w, h - 36], fill=(255, 120, 40, 160))
	im = Image.blend(im, im.filter(ImageFilter.GaussianBlur(12)), 0.35)
	tpl = WORK / "banner_template.png"
	im.save(tpl, format="PNG")
	name = upload_image(tpl)
	seed = (int(time.time()) + 17) % (2**31 - 1)
	denoise = 0.5 if is_turbo(ckpt) else 0.55
	prompt = (
		"flat seamless tileable LED stadium advertising board albedo texture, "
		"orthographic front view only, dark carbon LED pixel matrix, "
		"cyan and orange neon racing chevrons, holographic energy bar center, "
		"high emissive glow, game texture, no perspective, no 3d room, no floor, "
		"no stadium, no sky, no text, no numbers, no logos, no faces"
	)
	neg = BANNER_NEG + ", perspective, vanishing point, floor reflection, arena interior, 3d scene"
	print(f"  ckpt={ckpt} seed={seed} denoise={denoise}")
	fn, sub, typ = queue(
		img2img_workflow(ckpt, name, prompt, neg, seed, "ignite_banner_flat", denoise)
	)
	raw = WORK / "banner_raw.png"
	download(fn, sub, typ, raw)
	save_banner(raw)


def run_sky(ckpt: str) -> None:
	print("=== SKYBOX IBL (img2img enhance equirect — zachowaj kompozycję) ===")
	src = TEX / "cyberpunk_skybox.bak.png"
	if not src.exists():
		src = TEX / "cyberpunk_skybox.png"
	work = WORK / "sky_src.png"
	WORK.mkdir(parents=True, exist_ok=True)
	Image.open(src).convert("RGB").resize((2048, 1024), Image.Resampling.LANCZOS).save(
		work, format="PNG"
	)
	name = upload_image(work)
	seed = (int(time.time()) + 91) % (2**31 - 1)
	denoise = 0.28 if is_turbo(ckpt) else 0.32
	prompt = (
		"equirectangular panoramic night sky HDRI, enhance existing cyberpunk city horizon, "
		"richer volumetric storm clouds, cyan and amber city glow, deeper indigo zenith, "
		"soft haze, seamless wrap, keep same composition, no stadium seats, no pitch, no grass"
	)
	neg = SKY_NEG + ", soccer pitch, purple glowing field, stadium bowl, floodlight towers close"
	print(f"  ckpt={ckpt} seed={seed} denoise={denoise}")
	fn, sub, typ = queue(
		img2img_workflow(ckpt, name, prompt, neg, seed, "ignite_sky_enhance", denoise)
	)
	raw = WORK / "sky_raw.png"
	download(fn, sub, typ, raw)
	save_sky(raw)


def main() -> int:
	ap = argparse.ArgumentParser()
	ap.add_argument("--skip-sky", action="store_true")
	ap.add_argument("--only", choices=("grass", "banner", "sky"))
	args = ap.parse_args()

	print("ComfyUI: checking…")
	get_json(f"{COMFY}/system_stats", timeout=30)
	ckpt = pick_ckpt()
	print(f"ckpt={ckpt}")
	WORK.mkdir(parents=True, exist_ok=True)

	only = args.only
	if only in (None, "grass"):
		run_grass(ckpt)
	if only in (None, "banner"):
		run_banner(ckpt)
	if only == "sky" or (only is None and not args.skip_sky):
		run_sky(ckpt)

	bump_manifest()
	print("DONE — hard-refresh gry (cache-bust textures).")
	return 0


if __name__ == "__main__":
	try:
		raise SystemExit(main())
	except Exception as e:
		print(f"ERROR: {e}", file=sys.stderr)
		raise SystemExit(1)
