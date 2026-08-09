#!/usr/bin/env python3
"""Unikalne thumbnails kart playlist + koncept emblem dla Trellis (ComfyUI SDXL)."""

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
OUT_DIR = ROOT / "public/assets/ui/menu/playlists"
EMBLEM_CONCEPT = ROOT / "public/assets/ui/menu/ignite_menu_emblem_concept.png"

STYLE = (
    "Ignite AAA esports key art, stylized rocket-league-like car soccer, "
    "hyper-detailed neon cyber arena at night, volumetric godrays, "
    "chrome body reflections, dramatic low-angle hero composition, "
    "ultra crisp silhouette readable as a tiny UI thumbnail, "
    "saturated team colors blue vs orange, cinematic depth of field, "
    "no text, no UI chrome, no watermark, no logo letters, no collage"
)

NEG = (
    "text, letters, watermark, logo, UI, HUD, frame, border, collage, "
    "blurry, lowres, deformed cars, extra wheels, ugly, photoreal documentary, "
    "people, faces, hands, cluttered, muddy colors, purple haze cliché, "
    "flat lighting, boring crop, empty dull pitch"
)

# mode_id → (seed, prompt) — punchier hero shots for playlist plates
CARDS: dict[str, tuple[int, str]] = {
    "1v1": (
        22011,
        f"{STYLE}. Extreme close face-off: two rocket cars inches from a glowing ball, "
        "blue vs orange headlights cutting fog, empty cyber stadium, tension, square crop",
    ),
    "2v2": (
        22012,
        f"{STYLE}. Doubles mid-air pass: two blue cars boosting diagonally past orange rivals, "
        "neon cyan boards, motion blur streaks, teamwork energy, square crop",
    ),
    "3v3": (
        22013,
        f"{STYLE}. Classic aerial redirect over midfield: car flipping above the ball, "
        "grand stadium lights, epic night pitch, three-a-side scale, square crop",
    ),
    "4v4": (
        22014,
        f"{STYLE}. Chaos swarm: eight stylized rocket cars colliding around the ball, "
        "magenta-purple sparks, crowded frenzy, explosive neon debris, square crop",
    ),
    "ignitionRush2v2": (
        22015,
        f"{STYLE}. Overcharge rush: cars trailing molten orange plasma across power zones, "
        "explosive team boost, Ignition Rush vibe, square crop",
    ),
    "ignition1v1": (
        22016,
        f"{STYLE}. Rumble sandbox duel: lone car scooping glowing power-up orbs, "
        "experimental neon lab arena, orange ignition sparks, square crop",
    ),
    "ignition": (
        22017,
        f"{STYLE}. Free-for-all Ignition: wild cars racing any goal, rainbow trail chaos, "
        "last-touch energy ring around the ball, square crop",
    ),
    "weeklyLab2v2": (
        22018,
        f"{STYLE}. Weekly lab mutator: green energy field warping the pitch, "
        "holographic instruments, teal-lime neon science vibe, square crop",
    ),
    "meridian2v2": (
        22019,
        f"{STYLE}. Meridian sphere arena: translucent geodesic dome, cars skating curved walls, "
        "meridian energy line, no goals, square crop",
    ),
}

EMBLEM = (
    12001,
    "A single iconic 3D game emblem prop for Ignite: floating hexagonal crest with a stylized "
    "flame-ignition core and orbiting energy ring, orange-cyan neon trim, metallic sci-fi PBR materials, "
    "centered on pure white background, isolated object, no cars, no stadium, no text, no letters, "
    "product turntable lighting, game-ready collectible badge",
)

CKPT_PREF = (
    "juggernaut_xl.safetensors",
    "juggernautXL_v9Rdphoto2Lightning.safetensors",
    "DreamShaperXL_Turbo_dpmppSdeKarras_half_pruned_6.safetensors",
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
    # Modele są w /var/lib/comfyui/models/checkpoints — object_info przez lazy-proxy
    # bywa timeoutem (duży JSON). Preferujemy znany SDXL.
    return CKPT_PREF[0]


def is_turbo(ckpt: str) -> bool:
    n = ckpt.lower()
    return "turbo" in n or "lightning" in n


def workflow(ckpt: str, prompt: str, seed: int, prefix: str, size: int = 1024) -> dict:
    turbo = is_turbo(ckpt)
    steps = 8 if turbo else 22
    cfg = 2.0 if turbo else 5.5
    sampler = "dpmpp_sde" if turbo else "dpmpp_2m"
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"batch_size": 1, "height": size, "width": size},
        },
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["4", 1]}},
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
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": prefix, "images": ["8", 0]},
        },
    }


def wait_image(prompt_id: str, timeout_s: float = 240) -> tuple[str, str, str]:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        time.sleep(1.2)
        # keepalive — lazy-proxy nie ubija Contenera podczas długiego batcha
        try:
            get_json(f"{COMFY}/system_stats", timeout=5)
        except Exception:
            pass
        try:
            hist = get_json(f"{COMFY}/history/{prompt_id}", timeout=15)
        except Exception:
            continue
        entry = hist.get(prompt_id)
        if not entry:
            continue
        outputs = entry.get("outputs") or {}
        for node in outputs.values():
            for img in node.get("images") or []:
                return (
                    img["filename"],
                    img.get("subfolder", ""),
                    img.get("type", "output"),
                )
        status = entry.get("status") or {}
        if status.get("status_str") == "error":
            raise RuntimeError(f"ComfyUI error: {status}")
    raise TimeoutError(f"ComfyUI timeout ({timeout_s}s) prompt_id={prompt_id}")


def strip_png_metadata(path: Path) -> None:
    with Image.open(path) as im:
        clean = Image.new(im.mode, im.size)
        clean.paste(im)
    path.parent.mkdir(parents=True, exist_ok=True)
    clean.save(path, format="PNG", optimize=True)


def download(filename: str, subfolder: str, typ: str, dest: Path) -> None:
    q = urllib.parse.urlencode(
        {"filename": filename, "subfolder": subfolder, "type": typ}
    )
    with urllib.request.urlopen(f"{COMFY}/view?{q}", timeout=60) as resp:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(resp.read())
    strip_png_metadata(dest)


def free_comfy() -> None:
    try:
        post_json(
            f"{COMFY}/free",
            {"unload_models": True, "free_memory": True},
            timeout=30,
        )
        time.sleep(1.5)
    except Exception as e:
        print(f"warn: /free failed: {e}", file=sys.stderr)


def generate_one(
    ckpt: str,
    prompt: str,
    seed: int,
    dest: Path,
    prefix: str,
    *,
    force: bool = False,
) -> None:
    if not force and dest.exists() and dest.stat().st_size > 20_000:
        print(f"skip existing {dest.name}")
        return
    wf = workflow(ckpt, prompt, seed, prefix, size=1024)
    resp = post_json(f"{COMFY}/prompt", {"prompt": wf}, timeout=60)
    prompt_id = resp["prompt_id"]
    print(f"queued {dest.name} id={prompt_id}")
    filename, subfolder, typ = wait_image(prompt_id, timeout_s=360)
    download(filename, subfolder, typ, dest)
    print(f"saved {dest} ({dest.stat().st_size} B)")


def png_to_webp(png: Path, webp: Path, quality: int = 88) -> None:
    with Image.open(png) as im:
        rgb = im.convert("RGB")
        webp.parent.mkdir(parents=True, exist_ok=True)
        rgb.save(webp, format="WEBP", quality=quality, method=6)
    print(f"webp {webp.name} ({webp.stat().st_size} B)")


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv[1:]
    only = set(args)
    ckpt = pick_ckpt()
    print(f"ckpt={ckpt} force={force}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for mode_id, (seed, prompt) in CARDS.items():
        if only and mode_id not in only and "cards" not in only:
            continue
        png = OUT_DIR / f"{mode_id}.png"
        webp = OUT_DIR / f"{mode_id}.webp"
        generate_one(ckpt, prompt, seed, png, f"ignite_menu_{mode_id}", force=force)
        if png.exists():
            png_to_webp(png, webp)

    if not only or "emblem" in only:
        generate_one(
            ckpt,
            EMBLEM[1],
            EMBLEM[0],
            EMBLEM_CONCEPT,
            "ignite_menu_emblem",
            force=force,
        )

    free_comfy()
    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
