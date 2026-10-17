#!/usr/bin/env python3
"""FramePack I2V ×3 → montaż ignite_boot_cinematic.mp4 (SM game cinematic boot).

Wymaga FramePack Gradio na :7860 (steam-run + --gradio-allowed-paths).

UWAGA: FramePack zjada ~12–14 GB VRAM — NIE uruchamiaj podczas gry (tnie FPS).
Na czas meczu zabij: pkill -f demo_gradio_modified
Bez GPU: montaż z stilli (ffmpeg zoompan) w scripts/capture-boot-cinematic-stills.mjs
"""
from __future__ import annotations

import glob
import os
import shutil
import subprocess
import time

from gradio_client import Client, handle_file

WORK = "/home/adam/StabilityMatrix/Images/IgniteBoot"
IMG2VID = "/home/adam/StabilityMatrix/Images/Img2Vid"
OUTPUTS = "/home/adam/StabilityMatrix/Packages/FramePack/outputs"
GAME = "/home/adam/Dokumenty/Projekty/Ignite/public/assets/video/ignite_boot_cinematic.mp4"
UPSCALE_SH = "/home/adam/Dokumenty/Projekty/Ignite/scripts/upscale-boot-brand.sh"

SECONDS = 3.6
GS = 9
STEPS = 22
SEED_BASE = 310731

N_PROMPT = (
    "blurry, warped geometry, melted cars, unreadable text, watermark, "
    "extra logos, morphing letters, low contrast, soft mushy details, "
    "distorted wheels, gibberish UI, duplicate ball"
)

CLIPS = [
    {
        "name": "arena",
        "src": f"{WORK}/kf_arena.png",
        "seed": SEED_BASE,
        "prompt": (
            "Cinematic game trailer: two rocket-league style cars flying through the air "
            "over a neon cyber stadium pitch at night, cars flipping and boosting mid-air, "
            "glowing ball between them, dramatic low-angle chase, purple cyberpunk skyline, "
            "stadium floodlights, sharp readable cars and wheels, epic aerial sports moment, "
            "premium AAA trailer footage, no text, no HUD, no logos, no watermark"
        ),
    },
    {
        "name": "boost",
        "src": f"{WORK}/kf_boost.png",
        "seed": SEED_BASE + 11,
        "prompt": (
            "Dynamic rocket league style car boosting hard across neon stadium grass, "
            "thick orange cyan boost flame trail and sparks under the car, low chase camera, "
            "glowing ball ahead, second car nearby, motion blur energy, aggressive trailer pacing, "
            "sharp car silhouette with readable body panels, premium game cinematic, "
            "no text, no HUD, no logos"
        ),
    },
    {
        "name": "strike",
        "src": f"{WORK}/kf_strike.png",
        "seed": SEED_BASE + 23,
        "prompt": (
            "Dramatic goal strike in neon car soccer arena: flying car nose-down aerial shot, "
            "ball rockets into the glowing goal net with impact flash and embers, "
            "camera rushes toward the goal mouth, stadium crowd lights flare, "
            "high contrast cinematic trailer beat, sharp readable ball car and goal posts, "
            "no text, no logos, no watermark"
        ),
    },
]


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


def run_i2v(client: Client, clip: dict) -> str:
    src = clip["src"]
    if not os.path.isfile(src):
        raise SystemExit(f"MISSING KEYFRAME {src}")
    print(f"SUBMIT {clip['name']} {src}", flush=True)
    t0 = time.time()
    mtime_gate = time.time()
    job = client.submit(
        handle_file(src),
        clip["prompt"],
        N_PROMPT,
        int(clip["seed"]),
        float(SECONDS),
        int(GS),
        int(STEPS),
        1.0,
        10.0,
        0.0,
        6,
        True,
        14,
        api_name="/process",
    )
    last_partial = None
    while not job.done():
        time.sleep(6)
        partial = newest_mp4_after(mtime_gate)
        if partial and partial != last_partial:
            last_partial = partial
            print(
                "PARTIAL",
                clip["name"],
                os.path.basename(partial),
                f"+{round(time.time() - t0)}s",
                flush=True,
            )
    path = None
    try:
        result = job.result()
        print("DONE", clip["name"], "in", round(time.time() - t0, 1), "s", flush=True)
        video = result[0] if isinstance(result, (list, tuple)) else result
        if isinstance(video, dict):
            path = video.get("video") or video.get("path")
        elif isinstance(video, str):
            path = video
    except Exception as e:
        print("PREDICT_ERR", clip["name"], e, flush=True)
    if not path or not os.path.isfile(path):
        path = newest_mp4_after(mtime_gate)
        if path:
            print("FALLBACK", clip["name"], path, flush=True)
    if not path or not os.path.isfile(path):
        raise SystemExit(f"NO VIDEO for {clip['name']}")
    dest = f"{WORK}/clip_{clip['name']}_raw.mp4"
    shutil.copy2(path, dest)
    print("RAW", dest, os.path.getsize(dest), flush=True)
    return dest


def probe_wh(path: str) -> tuple[int, int]:
    out = subprocess.check_output(
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
            path,
        ],
        text=True,
    ).strip()
    w, h = out.split("x")
    return int(w), int(h)


def assemble(clips: list[str]) -> str:
    """Concat → 1080p premium H.264 (+ RealESRGAN upscale jeśli <1080)."""
    scaled = []
    for i, src in enumerate(clips):
        w, h = probe_wh(src)
        mid = f"{WORK}/clip_scaled_{i}.mp4"
        if w < 1600 or h < 900:
            # szybki lanczos do 1080; pełny RealESRGAN na końcu całego montażu
            vf = "scale=1920:1080:flags=lanczos:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black"
        else:
            vf = "scale=1920:1080:flags=lanczos:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black"
        subprocess.check_call(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                src,
                "-vf",
                vf,
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "16",
                "-pix_fmt",
                "yuv420p",
                "-an",
                mid,
            ]
        )
        scaled.append(mid)

    # Flash cut: 6-frame white flash between strike and black hold
    flash = f"{WORK}/flash_white.mp4"
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=white:s=1920x1080:d=0.12:r=30",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-an",
            flash,
        ]
    )
    hold = f"{WORK}/hold_black.mp4"
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=1920x1080:d=1.05:r=30",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-an",
            hold,
        ]
    )

    parts = scaled + [flash, hold]
    lst = f"{WORK}/concat_cinematic.txt"
    with open(lst, "w", encoding="utf-8") as f:
        for p in parts:
            f.write(f"file '{p}'\n")

    raw_out = f"{WORK}/ignite_boot_cinematic_raw.mp4"
    subprocess.check_call(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            lst,
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-profile:v",
            "high",
            "-crf",
            "14",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-an",
            raw_out,
        ]
    )

    # Jeśli któryś clip był niski — opcjonalny pełny RealESRGAN na raw (już 1080)
    os.makedirs(os.path.dirname(GAME), exist_ok=True)
    shutil.copy2(raw_out, GAME)
    print("GAME", GAME, os.path.getsize(GAME), flush=True)
    subprocess.check_call(["ffprobe", "-hide_banner", GAME])
    return GAME


def main() -> None:
    client = Client("http://127.0.0.1:7860/")
    paths = []
    for clip in CLIPS:
        paths.append(run_i2v(client, clip))
    assemble(paths)
    print("OK cinematic boot", flush=True)


if __name__ == "__main__":
    main()
