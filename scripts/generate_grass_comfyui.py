#!/usr/bin/env python3
"""Generuje bezszwową teksturę murawy 2048×2048 przez ComfyUI API."""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "assets" / "textures"
OUT_PNG = OUT_DIR / "_grass_raw.png"
OUT_JPG = OUT_DIR / "grass_color.jpg"

COMFY_URL = "http://127.0.0.1:8188"
PROMPT = (
	"Highly detailed photorealistic football pitch grass texture, dense lawn, "
	"vibrant juicy green color, short cut sports turf, seamless, tileable, "
	"top-down view, 4k, octane render, ambient occlusion micro-shadows, "
	"macro blade detail, uniform lighting, no objects"
)
NEGATIVE = (
	"ugly, blurry, low quality, watermark, text, perspective, horizon, "
	"visible seam, border, frame, harsh shadow, dirt patch, ball, player, "
	"stripe, checkerboard, brown, dry, yellow grass"
)
SIZE = 2048


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
		"DreamShaperXL_Turbo_dpmppSdeKarras_half_pruned_6.safetensors",
	):
		if preferred in choices:
			return preferred
	if not choices:
		raise RuntimeError("Brak checkpointów w ComfyUI")
	return choices[0]


def build_workflow(ckpt: str, seed: int) -> dict:
	lightning = "Lightning" in ckpt or "Turbo" in ckpt
	steps = 8 if lightning else 28
	cfg = 2.0 if lightning else 6.5
	sampler = "dpmpp_sde" if lightning else "dpmpp_2m"
	return {
		"4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
		"5": {
			"class_type": "EmptyLatentImage",
			"inputs": {"width": SIZE, "height": SIZE, "batch_size": 1},
		},
		"6": {"class_type": "CLIPTextEncode", "inputs": {"text": PROMPT, "clip": ["4", 1]}},
		"7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEGATIVE, "clip": ["4", 1]}},
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
			"inputs": {"filename_prefix": "flyball_grass", "images": ["8", 0]},
		},
	}


def wait_for_image(prompt_id: str, timeout_s: int = 600) -> str:
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
	raise TimeoutError(f"ComfyUI nie zwrócił obrazu w {timeout_s}s")


def save_downloaded_png(png_bytes: bytes, png_path: Path) -> None:
	OUT_DIR.mkdir(parents=True, exist_ok=True)
	png_path.write_bytes(png_bytes)
	print(f"Zapisano surowy PNG: {png_path}")


def png_to_jpg(png_path: Path, jpg_path: Path) -> None:
	import shutil
	import subprocess

	ffmpeg = shutil.which("ffmpeg")
	if ffmpeg:
		subprocess.run(
			[ffmpeg, "-y", "-i", str(png_path), "-q:v", "2", str(jpg_path)],
			check=True,
			capture_output=True,
		)
		print(f"Zapisano JPEG (ffmpeg): {jpg_path}")
		return

	try:
		from PIL import Image

		Image.open(png_path).convert("RGB").save(jpg_path, "JPEG", quality=92)
		print(f"Zapisano JPEG (PIL): {jpg_path}")
		return
	except ImportError:
		pass

	# Ostateczny fallback: zachowaj PNG pod właściwą nazwą — blender_grass_maps nadpisze JPEG
	png_copy = OUT_DIR / "grass_color.png"
	png_copy.write_bytes(png_path.read_bytes())
	print(f"ffmpeg/PIL niedostępne — zapisano {png_copy}; blender_grass_maps wyeksportuje JPEG")


def main() -> int:
	try:
		api_get("/system_stats")
	except OSError as exc:
		print(f"ComfyUI niedostępne na {COMFY_URL}: {exc}", file=sys.stderr)
		return 1

	ckpt = pick_checkpoint()
	seed = int(time.time()) % 2_147_483_647
	print(f"Checkpoint: {ckpt}")
	print(f"Generuję {SIZE}×{SIZE}px (bez HyperTile — czysta murawa)…")

	payload = {"prompt": build_workflow(ckpt, seed)}
	result = api_post("/prompt", payload)
	prompt_id = result.get("prompt_id")
	if not prompt_id:
		print(json.dumps(result, indent=2), file=sys.stderr)
		return 1

	print(f"prompt_id={prompt_id}")
	filename = wait_for_image(prompt_id)
	print(f"Pobieram {filename}…")

	png_tmp = OUT_PNG
	OUT_DIR.mkdir(parents=True, exist_ok=True)
	with urllib.request.urlopen(
		f"{COMFY_URL}/view?filename={filename}&type=output", timeout=120
	) as resp:
		save_downloaded_png(resp.read(), png_tmp)

	png_to_jpg(png_tmp, OUT_JPG)
	print(f"Pipeline: uruchom blender_grass_maps.py dla normal/roughness + seamless")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
