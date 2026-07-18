#!/usr/bin/env python3
"""Czysty wektorowy Ign!te SVG: wygładzone kontury płomieni + Anton→path (bez PNG)."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TMP = ROOT / "tmp-logo"
SRC = Path.home() / "Muzyka" / "Ignite.png"
NOBG = TMP / "ignite_nobg.png"
TEXT_DRAFT = TMP / "ignite_text_draft.svg"
TEXT_PATHS = TMP / "ignite_text_paths.svg"
OUT = ROOT / "public" / "assets" / "ignite_logo.svg"

NAVY = "#0B1524"
ORANGE_HI = "#FF8A1A"
ORANGE_MID = "#FF5A00"
ORANGE_DEEP = "#C83200"
YELLOW = "#FFD56A"
WHITE = "#FFF6E8"


def ensure_nobg() -> None:
    TMP.mkdir(parents=True, exist_ok=True)
    if NOBG.exists() and NOBG.stat().st_size > 10_000:
        return
    subprocess.run(
        ["nix", "run", "nixpkgs#rembg", "--", "i", str(SRC), str(NOBG)],
        check=True,
    )


def chaikin(pts: np.ndarray, iters: int = 3) -> np.ndarray:
    pts = pts.astype(np.float64)
    for _ in range(iters):
        n = len(pts)
        out = []
        for i in range(n):
            p0, p1 = pts[i], pts[(i + 1) % n]
            out.append(0.75 * p0 + 0.25 * p1)
            out.append(0.25 * p0 + 0.75 * p1)
        pts = np.asarray(out)
    return pts


def contour_to_path(cnt: np.ndarray, simplify_px: float = 3.5) -> str | None:
    peri = cv2.arcLength(cnt, True)
    approx = cv2.approxPolyDP(cnt, max(simplify_px, peri * 0.002), True)
    if len(approx) < 6:
        return None
    pts = chaikin(approx.reshape(-1, 2), iters=3)
    n = len(pts)
    target = max(12, (n // 3) * 3)
    idx = np.linspace(0, n - 1, target).astype(int)
    pts = pts[idx]
    pts = np.vstack([pts, pts[0]])
    d = [f"M{pts[0, 0]:.2f},{pts[0, 1]:.2f}"]
    i = 0
    while i + 3 < len(pts):
        p1, p2, p3 = pts[i + 1], pts[i + 2], pts[i + 3]
        d.append(
            f"C{p1[0]:.2f},{p1[1]:.2f} {p2[0]:.2f},{p2[1]:.2f} {p3[0]:.2f},{p3[1]:.2f}"
        )
        i += 3
    d.append("Z")
    return " ".join(d)


def extract_flame_paths(w: int, h: int, arr: np.ndarray) -> list[str]:
    r, g, b, a = [arr[:, :, i].astype(np.float32) for i in range(4)]
    mask = a > 40
    navy = mask & (r < 70) & (g < 80) & (b < 110) & ((r + g + b) < 180)
    pale = mask & (((r + g + b) > 500) | ((r > 170) & (g > 165) & (b > 150)))
    teal = mask & (b > 90) & (g > 70) & (r < g * 0.98) & ((g + b) / 2 - r > 20)
    warm = mask & (r > 100) & (r >= g * 0.55) & (r > b) & ((r - b) > 12)
    core = cv2.dilate(
        (navy | pale).astype(np.uint8), np.ones((13, 13), np.uint8), 2
    ).astype(bool)
    flame = (warm | (mask & (r > 120) & (r > b) & (g > 50))) & ~core & ~teal

    bin8 = (flame.astype(np.uint8) * 255)
    bin8 = cv2.morphologyEx(
        bin8, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8), iterations=2
    )
    bin8 = cv2.morphologyEx(
        bin8, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8), iterations=1
    )
    bin8 = cv2.GaussianBlur(bin8, (7, 7), 0)
    _, bin8 = cv2.threshold(bin8, 100, 255, cv2.THRESH_BINARY)

    cnts, _ = cv2.findContours(bin8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cnts = sorted(cnts, key=cv2.contourArea, reverse=True)
    paths: list[str] = []
    for c in cnts:
        if cv2.contourArea(c) < 500:
            continue
        p = contour_to_path(c)
        if p:
            paths.append(p)
        if len(paths) >= 12:
            break

    paths.extend(
        [
            f"M{w*0.06:.1f},{h*0.55:.1f} C{w*0.02:.1f},{h*0.62:.1f} {w*0.04:.1f},{h*0.78:.1f} {w*0.12:.1f},{h*0.82:.1f} "
            f"C{w*0.14:.1f},{h*0.70:.1f} {w*0.12:.1f},{h*0.58:.1f} {w*0.10:.1f},{h*0.52:.1f} Z",
            f"M{w*0.88:.1f},{h*0.38:.1f} C{w*0.95:.1f},{h*0.32:.1f} {w*1.02:.1f},{h*0.48:.1f} {w*0.98:.1f},{h*0.62:.1f} "
            f"C{w*0.94:.1f},{h*0.52:.1f} {w*0.90:.1f},{h*0.48:.1f} {w*0.86:.1f},{h*0.46:.1f} Z",
            f"M{w*0.40:.1f},{h*0.78:.1f} C{w*0.48:.1f},{h*0.92:.1f} {w*0.58:.1f},{h*0.90:.1f} {w*0.66:.1f},{h*0.78:.1f} "
            f"C{w*0.58:.1f},{h*0.84:.1f} {w*0.50:.1f},{h*0.84:.1f} {w*0.42:.1f},{h*0.76:.1f} Z",
        ]
    )
    return paths


def inkscape_text_to_paths(w: int, h: int) -> tuple[str, str]:
    TEXT_DRAFT.write_text(
        f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
  <defs>
    <linearGradient id="letterFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="{ORANGE_MID}"/>
      <stop offset="28%" stop-color="{ORANGE_HI}"/>
      <stop offset="55%" stop-color="{YELLOW}"/>
      <stop offset="80%" stop-color="{WHITE}"/>
      <stop offset="100%" stop-color="#E8EEF4"/>
    </linearGradient>
  </defs>
  <g id="word" transform="translate({w/2},{h*0.52:.1f}) skewX(-12)">
    <text x="0" y="0" text-anchor="middle" dominant-baseline="middle"
      font-family="Anton, Impact, sans-serif" font-size="{h*0.40:.1f}"
      letter-spacing="-0.03em" fill="url(#letterFill)" stroke="{NAVY}"
      stroke-width="{h*0.058:.2f}" stroke-linejoin="round" stroke-linecap="round"
      paint-order="stroke fill">Ign!te</text>
    <text x="0" y="0" text-anchor="middle" dominant-baseline="middle"
      font-family="Anton, Impact, sans-serif" font-size="{h*0.40:.1f}"
      letter-spacing="-0.03em" fill="none" stroke="{ORANGE_HI}"
      stroke-width="{h*0.013:.2f}" stroke-linejoin="round" opacity="0.92">Ign!te</text>
  </g>
</svg>
""",
        encoding="utf-8",
    )
    subprocess.run(
        [
            "inkscape",
            str(TEXT_DRAFT),
            f"--export-filename={TEXT_PATHS}",
            "--export-type=svg",
            "--export-plain-svg",
            "--export-text-to-path",
            "--export-area-page",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    tp = TEXT_PATHS.read_text(encoding="utf-8")
    tp = re.sub(r'\s+inkscape:[^=]+="[^"]*"', "", tp)
    tp = re.sub(r'\s+sodipodi:[^=]+="[^"]*"', "", tp)
    defs = re.search(r"<defs[\s\S]*?</defs>", tp)
    body = re.search(r"</defs>([\s\S]*)</svg>", tp)
    return (defs.group(0) if defs else "<defs/>"), (
        body.group(1).strip() if body else ""
    )


def main() -> None:
    ensure_nobg()
    arr = np.array(Image.open(NOBG).convert("RGBA"))
    h, w = arr.shape[:2]
    flames = extract_flame_paths(w, h, arr)
    defs_s, word_body = inkscape_text_to_paths(w, h)

    extra = f"""
    <linearGradient id="flameDeep" x1="0.15" y1="1" x2="0.6" y2="0">
      <stop offset="0%" stop-color="#8B1800"/>
      <stop offset="45%" stop-color="{ORANGE_MID}"/>
      <stop offset="100%" stop-color="{YELLOW}"/>
    </linearGradient>
    <linearGradient id="flameMid" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="{ORANGE_DEEP}"/>
      <stop offset="50%" stop-color="{ORANGE_HI}"/>
      <stop offset="100%" stop-color="#FFE08A"/>
    </linearGradient>
    <linearGradient id="flameHot" x1="0.5" y1="1" x2="0.5" y2="0">
      <stop offset="0%" stop-color="{ORANGE_MID}"/>
      <stop offset="100%" stop-color="{YELLOW}"/>
    </linearGradient>
"""
    if "</defs>" in defs_s:
        defs_s = defs_s.replace("</defs>", extra + "</defs>")
    else:
        defs_s = f"<defs>{extra}</defs>"

    grads = ["url(#flameDeep)", "url(#flameMid)", "url(#flameHot)"]
    flame_els = [
        f'    <path d="{d}" fill="{grads[i % 3]}"/>' for i, d in enumerate(flames)
    ]

    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
{defs_s}
  <g id="flames">
{chr(10).join(flame_els)}
  </g>
  <g id="sparks" fill="{YELLOW}">
    <ellipse cx="{w*0.14:.1f}" cy="{h*0.30:.1f}" rx="3.2" ry="2.0" transform="rotate(-14 {w*0.14:.1f} {h*0.30:.1f})"/>
    <ellipse cx="{w*0.72:.1f}" cy="{h*0.18:.1f}" rx="2.8" ry="1.7" transform="rotate(16 {w*0.72:.1f} {h*0.18:.1f})"/>
    <ellipse cx="{w*0.92:.1f}" cy="{h*0.44:.1f}" rx="3.4" ry="1.9" transform="rotate(-8 {w*0.92:.1f} {h*0.44:.1f})"/>
  </g>
  <g id="word">
{word_body}
  </g>
</svg>
"""
    if "<image" in svg.lower() or "data:image" in svg.lower():
        raise SystemExit("ERROR: SVG zawiera osadzony obraz — abort")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(svg, encoding="utf-8")
    print(f"Wrote pure vector {OUT} ({OUT.stat().st_size} B, paths={svg.count('<path')})")


if __name__ == "__main__":
    main()
