#!/usr/bin/env python3
"""Meshy dual-layer 16:9 → equirect 2048×1024 — synthwave jak ComfyUI skybox."""

from __future__ import annotations

import math
import subprocess
from array import array
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEX = ROOT / "public" / "assets" / "textures"
ATMOS_RAW = TEX / "meshy_sky_atmosphere_raw.png"
HORIZON_RAW = TEX / "meshy_sky_horizon_raw.png"
LEGACY_RAW = TEX / "meshy_skybox_raw.png"
OUT = TEX / "meshy_skybox_panorama.jpg"
OUT_W = 2048
OUT_H = 1024


def _ffmpeg(args: list[str], stdin: bytes | None = None) -> bytes:
	result = subprocess.run(
		["ffmpeg", "-y", "-loglevel", "error", *args],
		input=stdin,
		check=True,
		capture_output=True,
	)
	return result.stdout


def _probe_size(path: Path) -> tuple[int, int]:
	probe = subprocess.run(
		[
			"ffprobe",
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=width,height",
			"-of",
			"csv=p=0:s=x",
			str(path),
		],
		check=True,
		capture_output=True,
		text=True,
	)
	w, h = (int(x) for x in probe.stdout.strip().split("x"))
	return w, h


def _load_rgb(path: Path, vf: str) -> tuple[int, int, array]:
	w, h = _probe_size(path)
	raw = _ffmpeg(
		[
			"-i",
			str(path),
			"-vf",
			vf,
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:",
		]
	)
	pixels = array("B", raw)
	if len(pixels) != w * h * 3:
		raise RuntimeError(f"Nieprawidłowy rozmiar {path}")
	return w, h, pixels


def _sample_bilinear(
	pixels: array, sw: int, sh: int, fx: float, fy: float
) -> tuple[int, int, int]:
	fx = max(0.0, min(sw - 1.001, fx))
	fy = max(0.0, min(sh - 1.001, fy))
	x0 = int(fx)
	y0 = int(fy)
	tx = fx - x0
	ty = fy - y0

	def px(x: int, y: int) -> tuple[int, int, int]:
		i = (y * sw + x) * 3
		return pixels[i], pixels[i + 1], pixels[i + 2]

	c00 = px(x0, y0)
	c10 = px(min(x0 + 1, sw - 1), y0)
	c01 = px(x0, min(y0 + 1, sh - 1))
	c11 = px(min(x0 + 1, sw - 1), min(y0 + 1, sh - 1))

	def lerp(a: float, b: float, t: float) -> float:
		return a + (b - a) * t

	out: list[int] = []
	for ch in range(3):
		top = lerp(c00[ch], c10[ch], tx)
		bot = lerp(c01[ch], c11[ch], tx)
		out.append(int(lerp(top, bot, ty)))
	return out[0], out[1], out[2]


def _lerp_rgb(
	a: tuple[int, int, int],
	b: tuple[int, int, int],
	t: float,
) -> tuple[int, int, int]:
	t = max(0.0, min(1.0, t))
	return (
		int(a[0] + (b[0] - a[0]) * t),
		int(a[1] + (b[1] - a[1]) * t),
		int(a[2] + (b[2] - a[2]) * t),
	)


def _blend_screen(
	base: tuple[int, int, int],
	wash: tuple[int, int, int],
	strength: float,
) -> tuple[int, int, int]:
	out: list[int] = []
	for b, w in zip(base, wash, strict=True):
		bn, wn = b / 255.0, w / 255.0
		screened = 1.0 - (1.0 - bn) * (1.0 - wn)
		val = b + (screened * 255.0 - b) * strength
		out.append(int(min(255, max(0, val))))
	return out[0], out[1], out[2]


def _synth_sky(lat: float, lon: float) -> tuple[int, int, int]:
	t = max(0.0, min(1.0, lat / (math.pi / 2)))
	r = int(18 + t * 55 + math.sin(lon * 1.8) * 14)
	g = int(12 + t * 28 + math.cos(lon * 1.5) * 10)
	b = int(42 + t * 68 + math.sin(lon * 2.4) * 12)
	if lat > 0.3:
		w = (lat - 0.3) * 1.4
		r = min(255, int(r + w * (80 + 40 * math.sin(lon * 3.0))))
		g = min(255, int(g + w * (30 + 20 * math.cos(lon * 2.5))))
		b = min(255, int(b + w * (50 + 30 * math.sin(lon * 2.0))))
	return r, g, b


def _nadir_color(lat: float) -> tuple[int, int, int]:
	t = max(0.0, min(1.0, (-lat - 0.08) / 0.55))
	return (
		int(28 + t * 8),
		int(16 + t * 10),
		int(48 + t * 14),
	)


def bake(
	atmos: tuple[int, int, array],
	horizon: tuple[int, int, array],
	out_path: Path,
) -> None:
	aw, ah, atmos_px = atmos
	hw, hh, horizon_px = horizon
	out = array("B", [0] * (OUT_W * OUT_H * 3))

	for y in range(OUT_H):
		lat = math.pi / 2 - (y / OUT_H) * math.pi
		for x in range(OUT_W):
			lon = (x / OUT_W) * 2 * math.pi - math.pi
			u = (lon + math.pi) / (2 * math.pi)
			i = (y * OUT_W + x) * 3

			if lat > 0.28:
				t = (lat - 0.28) / (math.pi / 2 - 0.28)
				src_y = ah * (0.05 + (1.0 - t) * 0.55)
				r, g, b = _sample_bilinear(atmos_px, aw, ah, u * aw, src_y)
				syn = _synth_sky(lat, lon)
				r, g, b = _blend_screen((r, g, b), syn, 0.15)
			elif lat > -0.38:
				band_t = (0.28 - lat) / 0.66
				src_y = hh * (0.18 + band_t * 0.72)
				r, g, b = _sample_bilinear(horizon_px, hw, hh, u * hw, src_y)
				fog = _sample_bilinear(horizon_px, hw, hh, u * hw, hh * 0.14)
				r, g, b = _blend_screen((r, g, b), fog, 0.1)
				if lat > 0.12:
					up = (lat - 0.12) / 0.16
					atm = _sample_bilinear(atmos_px, aw, ah, u * aw, ah * 0.38)
					r, g, b = _lerp_rgb((r, g, b), atm, up * 0.5)
			else:
				r, g, b = _nadir_color(lat)

			r = min(255, int(r * 1.03 + 5))
			g = min(255, int(g * 1.03 + 4))
			b = min(255, int(b * 1.03 + 7))

			out[i] = r
			out[i + 1] = g
			out[i + 2] = b

	_ffmpeg(
		[
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-s",
			f"{OUT_W}x{OUT_H}",
			"-i",
			"pipe:",
			"-q:v",
			"2",
			str(out_path),
		],
		stdin=out.tobytes(),
	)
	print(f"Zapisano panoramę: {out_path}")


def main() -> None:
	atmos_path = ATMOS_RAW if ATMOS_RAW.exists() else LEGACY_RAW
	horizon_path = HORIZON_RAW if HORIZON_RAW.exists() else LEGACY_RAW
	if not atmos_path.exists() or not horizon_path.exists():
		raise SystemExit("Brak meshy_sky_*_raw.png — npm run meshy:build-sky")

	vf = "eq=saturation=1.1:contrast=1.05:brightness=0.04:gamma=0.97,gblur=sigma=0.4"
	atmos = _load_rgb(atmos_path, vf)
	horizon = _load_rgb(horizon_path, vf)
	bake(atmos, horizon, OUT)


if __name__ == "__main__":
	main()
