#!/usr/bin/env python3
"""Proceduralny cyberpunk skybox 4096×2048 gdy ComfyUI niedostępne."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_PNG = ROOT / "public" / "assets" / "textures" / "cyberpunk_skybox.png"
OUT_JPG = ROOT / "public" / "assets" / "textures" / "cyberpunk_skybox.jpg"
W, H = 4096, 2048


def main() -> int:
	ffmpeg = shutil.which("ffmpeg")
	if not ffmpeg:
		print("BŁĄD: brak ffmpeg", file=sys.stderr)
		return 1

	OUT_PNG.parent.mkdir(parents=True, exist_ok=True)

	subprocess.run(
		[
			ffmpeg,
			"-y",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			f"gradients=size={W}x{H}:colors=0x05030f|0x1a0840|0x5522aa|0xff6622",
			"-frames:v",
			"1",
			str(OUT_PNG),
		],
		check=True,
	)

	data = OUT_PNG.read_bytes()
	if data[:4] != b"\x89PNG":
		raise RuntimeError("fallback skybox nie jest PNG")

	subprocess.run(
		[ffmpeg, "-y", "-loglevel", "error", "-i", str(OUT_PNG), "-q:v", "2", str(OUT_JPG)],
		check=True,
	)
	print(f"Zapisano proceduralny skybox: {OUT_PNG}")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
