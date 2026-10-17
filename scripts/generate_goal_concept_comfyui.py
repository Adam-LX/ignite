#!/usr/bin/env python3
"""ComfyUI: photoreal orthographic goal-frame concept → Trellis image-to-3D.

  python3 scripts/generate_goal_concept_comfyui.py
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

COMFY = "http://127.0.0.1:8188"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets/arenas/standard/concepts"
CKPT_PREF = (
	"juggernaut_xl.safetensors",
	"juggernautXL_v9Rdphoto2Lightning.safetensors",
	"DreamShaperXL_Turbo_dpmppSdeKarras_half_pruned_6.safetensors",
)

PROMPT = (
	"product photography of a single hollow rectangular rocket-league soccer goal frame, "
	"front orthographic centered view, two thick vertical gunmetal posts and one thick "
	"horizontal crossbar forming a perfect U/arch mouth, solid welded mitered corners "
	"with ZERO gaps, dark brushed metal PBR, thin electric cyan neon edge strip ONLY on "
	"the inner mouth perimeter, completely empty hollow opening, no net, no floor plate, "
	"no back wall, no pipes, no scaffold, no brick, pure black background, studio key light, "
	"sharp silhouette, game-ready prop concept, 8k detail"
)
NEG = (
	"net mesh, rope, floor, ground plane, grass, backboard, filled wall, scaffold, pipes, "
	"orange brick, scaffolding, people, car, ball, text, watermark, logo, purple haze, "
	"perspective distortion, isometric clutter, multiple goals, broken corners, gaps, "
	"holes at joints, floating pieces, cartoon, lowpoly, UI"
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


def pick_ckpt() -> str:
	info = get_json(f"{COMFY}/object_info/CheckpointLoaderSimple", timeout=90)
	names = info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
	for pref in CKPT_PREF:
		if pref in names:
			return pref
	return names[0]


def is_turbo(ckpt: str) -> bool:
	n = ckpt.lower()
	return "turbo" in n or "lightning" in n


def txt2img_workflow(ckpt: str, seed: int, prefix: str, w: int, h: int) -> dict:
	turbo = is_turbo(ckpt)
	steps = 8 if turbo else 28
	cfg = 2.0 if turbo else 6.5
	sampler = "dpmpp_sde" if turbo else "dpmpp_2m"
	return {
		"4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
		"5": {
			"class_type": "EmptyLatentImage",
			"inputs": {"batch_size": 1, "height": h, "width": w},
		},
		"6": {
			"class_type": "CLIPTextEncode",
			"inputs": {"text": PROMPT, "clip": ["4", 1]},
		},
		"7": {
			"class_type": "CLIPTextEncode",
			"inputs": {"text": NEG, "clip": ["4", 1]},
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


def download(filename: str, subfolder: str, typ: str, dest: Path) -> None:
	q = urllib.parse.urlencode(
		{"filename": filename, "subfolder": subfolder, "type": typ}
	)
	with urllib.request.urlopen(f"{COMFY}/view?{q}", timeout=120) as resp:
		dest.parent.mkdir(parents=True, exist_ok=True)
		dest.write_bytes(resp.read())
	with Image.open(dest) as im:
		clean = Image.new(im.mode, im.size)
		clean.paste(im)
	clean.save(dest, format="PNG", optimize=True)


def main() -> int:
	ckpt = pick_ckpt()
	print(f"ckpt={ckpt}")
	OUT.mkdir(parents=True, exist_ok=True)
	# Archive previous concept
	prev = OUT / "goalFrame_front.png"
	if prev.exists():
		bak = OUT / "goalFrame_front_pil.bak.png"
		bak.write_bytes(prev.read_bytes())
		print(f"archived → {bak.name}")

	wf = txt2img_workflow(ckpt, seed=20260806, prefix="ignite_goalFrame_front", w=1280, h=768)
	resp = post_json(f"{COMFY}/prompt", {"prompt": wf})
	pid = resp["prompt_id"]
	print(f"prompt_id={pid}")
	fn, sub, typ = wait_image(pid)
	dest = OUT / "goalFrame_front.png"
	download(fn, sub, typ, dest)
	print(f"saved {dest} ({dest.stat().st_size} bytes)")
	return 0


if __name__ == "__main__":
	try:
		raise SystemExit(main())
	except Exception as e:
		print(f"FAIL: {e}", file=sys.stderr)
		raise SystemExit(1)
