#!/usr/bin/env python3
"""Proceduralna murawa 2048×2048 gdy ComfyUI niedostępne."""

from __future__ import annotations

import random
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "assets" / "textures" / "_grass_raw.png"
SIZE = 2048


def _chunk(tag: bytes, data: bytes) -> bytes:
	crc = zlib.crc32(tag + data) & 0xFFFFFFFF
	return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def write_png(path: Path, rgb) -> None:
	w, h = SIZE, SIZE
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
	print(f"Zapisano proceduralny PNG: {path}")


def main() -> None:
	random.seed(42)
	pixels = bytearray(SIZE * SIZE * 3)
	for y in range(SIZE):
		for x in range(SIZE):
			n = random.randint(-18, 18)
			g = 48 + n + ((x // 64 + y // 64) % 2) * 22
			r = max(0, min(255, 12 + g // 6))
			g = max(0, min(255, g))
			b = max(0, min(255, 10 + g // 5))
			i = (y * SIZE + x) * 3
			pixels[i] = r
			pixels[i + 1] = g
			pixels[i + 2] = b
	write_png(OUT, pixels)


if __name__ == "__main__":
	main()
