#!/usr/bin/env python3
"""Generuje teksturę paneli auta (ComfyUI → car_cyber_panel.png + .jpg)."""

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
OUT_ALBEDO = OUT_DIR / "car_cyber_panel.png"
OUT_ALBEDO_JPG = OUT_DIR / "car_cyber_panel.jpg"
COMFY_OUTPUT = Path("/var/lib/comfyui/output")

COMFY_URL = "http://127.0.0.1:8188"
PROMPT = (
	"Seamless tileable 2D texture of futuristic cyberpunk muscle car body panels, "
	"brushed silver polished metal, carbon fiber insets, glowing neon cyan LED trim lines "
	"between mechanical panels, photorealistic game asset, orthogonal top-down texture map, "
	"sharp clean panel edges, high contrast studio lighting, 8k detail"
)
NEGATIVE = (
	"boring, rust, scratches, organic, distorted, blurry, watermark, text, muddy, "
	"brown, yellow, purple nebula, low quality, random noise, gradient background, wheels, "
	"windows, full car render, perspective view"
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
	steps = 10 if lightning else 32
	cfg = 2.2 if lightning else 6.5
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
			"inputs": {"filename_prefix": "flyball_car_cyber", "images": ["8", 0]},
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


def fetch_comfy_png(filename: str) -> bytes:
	host = COMFY_OUTPUT / filename
	if host.is_file():
		print(f"Kopiuję z {host}")
		return host.read_bytes()
	with urllib.request.urlopen(
		f"{COMFY_URL}/view?filename={filename}&type=output", timeout=120
	) as resp:
		return resp.read()


def png_to_jpg(png_path: Path, jpg_path: Path) -> None:
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
	except ImportError:
		print(f"ffmpeg/PIL niedostępne — gra użyje PNG: {png_path}")


def export_assets(png_bytes: bytes | None = None, png_path: Path = OUT_ALBEDO) -> None:
	OUT_DIR.mkdir(parents=True, exist_ok=True)
	if png_bytes is not None:
		png_path.write_bytes(png_bytes)
		print(f"Zapisano panel PNG: {png_path}")
	elif not png_path.is_file():
		raise FileNotFoundError(f"Brak {png_path}")

	png_to_jpg(png_path, OUT_ALBEDO_JPG)


def main() -> int:
	if "--export-only" in sys.argv:
		src = COMFY_OUTPUT / "flyball_car_cyber_00001_.png"
		if src.is_file():
			export_assets(src.read_bytes())
			return 0
		if OUT_ALBEDO.is_file():
			export_assets()
			return 0
		print("Brak PNG do eksportu", file=sys.stderr)
		return 1

	try:
		api_get("/system_stats")
	except OSError as exc:
		print(f"ComfyUI niedostępne na {COMFY_URL}: {exc}", file=sys.stderr)
		return 1

	ckpt = pick_checkpoint()
	seed = int(time.time()) % 2_147_483_647
	print(f"Checkpoint: {ckpt}")
	print(f"Generuję teksturę paneli auta {SIZE}×{SIZE}px…")

	payload = {"prompt": build_workflow(ckpt, seed)}
	result = api_post("/prompt", payload)
	prompt_id = result.get("prompt_id")
	if not prompt_id:
		print(json.dumps(result, indent=2), file=sys.stderr)
		return 1

	print(f"prompt_id={prompt_id}")
	filename = wait_for_image(prompt_id)
	print(f"Pobieram {filename}…")

	export_assets(fetch_comfy_png(filename))
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
