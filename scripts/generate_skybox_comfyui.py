#!/usr/bin/env python3
"""Generuje panoramiczny skybox 4096×2048 (equirectangular) przez ComfyUI API."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "assets" / "textures"
OUT_PNG = OUT_DIR / "cyberpunk_skybox.png"
OUT_JPG = OUT_DIR / "cyberpunk_skybox.jpg"

COMFY_URL = "http://127.0.0.1:8188"
WIDTH = 4096
HEIGHT = 2048

PROMPT = (
	"Futuristic cyberpunk megacity night sky, volumetric neon fog, glowing smog, "
	"toxic rainclouds illuminated by distant city lights, giant holographic advertisements "
	"projecting into the upper atmosphere, hyper-detailed, synthwave aesthetic, "
	"deep purples, neon blues, and blood orange reflections, equirectangular panorama, "
	"360 degree sky, seamless horizon"
)
NEGATIVE = (
	"ugly, blurry, low quality, watermark, text, logo, frame, border, daylight, "
	"sun, grass, ground, people, cars, trees, flat color, cartoon"
)


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
	steps = 10 if lightning else 30
	cfg = 2.2 if lightning else 6.5
	sampler = "dpmpp_sde" if lightning else "dpmpp_2m"
	return {
		"4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
		"5": {
			"class_type": "EmptyLatentImage",
			"inputs": {"width": WIDTH, "height": HEIGHT, "batch_size": 1},
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
		"11": {
			"class_type": "VAEDecodeTiled",
			"inputs": {
				"samples": ["3", 0],
				"vae": ["4", 2],
				"tile_size": 512,
				"overlap": 64,
				"temporal_size": 64,
				"temporal_overlap": 8,
			},
		},
		"9": {
			"class_type": "SaveImage",
			"inputs": {"filename_prefix": "flyball_skybox", "images": ["11", 0]},
		},
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
	raise TimeoutError(f"ComfyUI nie zwrócił skyboxa w {timeout_s}s")


def verify_png(path: Path) -> None:
	data = path.read_bytes()
	if data[:4] != b"\x89PNG":
		raise RuntimeError(f"{path} nie jest PNG (magic: {data[:4]!r})")
	if path.stat().st_size < 50_000:
		raise RuntimeError(f"{path} zbyt mały — prawdopodobnie uszkodzony")


def export_jpeg(png_path: Path, jpg_path: Path) -> None:
	ffmpeg = shutil.which("ffmpeg")
	if not ffmpeg:
		print("UWAGA: brak ffmpeg — pomijam cyberpunk_skybox.jpg")
		return
	subprocess.run(
		[ffmpeg, "-y", "-loglevel", "error", "-i", str(png_path), "-q:v", "2", str(jpg_path)],
		check=True,
	)
	print(f"Zapisano JPEG: {jpg_path}")


def main() -> int:
	try:
		api_get("/system_stats")
	except OSError as exc:
		print(f"ComfyUI niedostępne na {COMFY_URL}: {exc}", file=sys.stderr)
		return 1

	ckpt = pick_checkpoint()
	seed = int(time.time()) % 2_147_483_647
	print(f"Checkpoint: {ckpt}")
	print(f"Generuję skybox {WIDTH}×{HEIGHT}px…")

	payload = {"prompt": build_workflow(ckpt, seed)}
	result = api_post("/prompt", payload)
	prompt_id = result.get("prompt_id")
	if not prompt_id:
		print(json.dumps(result, indent=2), file=sys.stderr)
		return 1

	print(f"prompt_id={prompt_id}")
	filename = wait_for_image(prompt_id)
	print(f"Pobieram {filename}…")

	OUT_DIR.mkdir(parents=True, exist_ok=True)
	with urllib.request.urlopen(
		f"{COMFY_URL}/view?filename={filename}&type=output", timeout=180
	) as resp:
		OUT_PNG.write_bytes(resp.read())

	verify_png(OUT_PNG)
	export_jpeg(OUT_PNG, OUT_JPG)
	print(f"Zapisano: {OUT_PNG} ({OUT_PNG.stat().st_size} B)")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
