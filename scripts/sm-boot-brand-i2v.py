#!/usr/bin/env python3
"""FramePack I2V → Ignite brand boot intro.

Also watches Img2Vid/ for progressive partials if Gradio return path fails.
"""
from __future__ import annotations

import glob
import os
import shutil
import subprocess
import time

from gradio_client import Client, handle_file

SRC = "/home/adam/StabilityMatrix/Images/IgniteBoot/logo_keyframe_1280x768.png"
OUT_RAW = "/home/adam/StabilityMatrix/Images/IgniteBoot/ignite_boot_brand_raw.mp4"
OUT_GAME = "/home/adam/Dokumenty/Projekty/Ignite/public/assets/video/ignite_boot_brand.mp4"
IMG2VID = "/home/adam/StabilityMatrix/Images/Img2Vid"
OUTPUTS = "/home/adam/StabilityMatrix/Packages/FramePack/outputs"
SECONDS = 10.0

PROMPT = (
    "Cinematic racing game brand logo sting on pure black background. "
    "Sharp chrome Ignite wordmark stays perfectly readable and unwarped at all times, "
    "letters never melt or morph. Violent orange yellow flames erupt and roar around the logo, "
    "cyan energy speed streaks whip past, flying embers and sparks, "
    "heavy slam impact flash then hold, aggressive high contrast trailer energy, "
    "text locked sharp in center, 4k crisp typography."
)
N_PROMPT = (
    "blurry text, warped letters, unreadable logo, melting text, morphing letters, "
    "extra words, misspelled text, watermark, low contrast, soft focus on text, "
    "distorted chrome, gibberish letters"
)


def newest_mp4_after(t0: float) -> str | None:
    files = []
    for folder in (IMG2VID, OUTPUTS):
        for p in glob.glob(folder + "/*.mp4"):
            try:
                if os.path.getmtime(p) >= t0 - 1:
                    files.append(p)
            except OSError:
                pass
    if not files:
        return None
    return max(files, key=os.path.getmtime)


def encode_game(src: str) -> None:
    os.makedirs(os.path.dirname(OUT_GAME), exist_ok=True)
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-i",
            src,
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            "18",
            "-preset",
            "medium",
            "-movflags",
            "+faststart",
            "-an",
            OUT_GAME,
        ]
    )
    print("GAME", OUT_GAME, os.path.getsize(OUT_GAME), flush=True)


client = Client("http://127.0.0.1:7860/")
print("SUBMIT brand boot I2V", flush=True)
t0 = time.time()
mtime_gate = time.time()

job = client.submit(
    handle_file(SRC),
    PROMPT,
    N_PROMPT,
    260731,
    SECONDS,
    9,
    25,
    1.0,
    10.0,
    0.0,
    6,
    True,
    14,
    api_name="/process",
)

path = None
last_partial = None
while not job.done():
    time.sleep(8)
    partial = newest_mp4_after(mtime_gate)
    if partial and partial != last_partial:
        last_partial = partial
        print(
            "PARTIAL",
            os.path.basename(partial),
            os.path.getsize(partial),
            f"+{round(time.time() - t0)}s",
            flush=True,
        )

try:
    result = job.result()
    print("DONE in", round(time.time() - t0, 1), "s", flush=True)
    print("RESULT", result, flush=True)
    video = result[0] if isinstance(result, (list, tuple)) else result
    if isinstance(video, dict):
        path = video.get("video") or video.get("path")
    elif isinstance(video, str):
        path = video
except Exception as e:
    print("PREDICT_ERR", e, flush=True)

if not path or not os.path.isfile(path):
    path = newest_mp4_after(mtime_gate)
    if path:
        print("FALLBACK Img2Vid", path, flush=True)

if not path or not os.path.isfile(path):
    raise SystemExit("NO VIDEO FOUND")

shutil.copy2(path, OUT_RAW)
print("RAW", OUT_RAW, os.path.getsize(OUT_RAW), flush=True)
encode_game(OUT_RAW)
