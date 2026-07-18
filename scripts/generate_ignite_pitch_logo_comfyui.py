#!/usr/bin/env python3
"""Logo IGN!TE: Wallpoet base → ComfyUI img2img (graffiti) → PNG z alpha."""

from __future__ import annotations

import json
import mimetypes
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

COMFY = "http://127.0.0.1:8188"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets/textures/ignite_pitch_logo.png"
RAW = ROOT / "public/assets/textures/_ignite_pitch_logo_raw.png"
BASE = ROOT / "public/assets/textures/_ignite_pitch_logo_base.png"
FONT = ROOT / "src/assets/fonts/Wallpoet-Regular.ttf"

PROMPT = (
    "A single graphic design of the word 'IGN!TE' (with an exclamation mark instead of the letter I). "
    "Isolated on a perfectly flat, pure white background. Black and white monochrome street graffiti style, "
    "overlapping throw-up lettering, spray paint drips, thick dark outlines. "
    "No 3d elements, no cars, no stadium, no background scene. Flat 2D vector art style. "
    "Keep the exact spelling IGN!TE fully readable."
)

NEG = (
    "unreadable, illegible, abstract blobs, wrong spelling, missing letters, extra letters, "
    "brick wall, concrete wall, texture background, photorealistic, 3d render, car, stadium, "
    "grass, field, watermark, blurry, low quality, deformed, color, colorful, vignette, "
    "gray background, black background, dark background, scene, perspective, photo"
)

# Prefer full SDXL over turbo/lightning for img2img letter fidelity.
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


def post_multipart(url: str, fields: dict[str, str], file_field: str, filename: str, data: bytes):
    boundary = f"----IgniteBoundary{int(time.time() * 1000)}"
    parts: list[bytes] = []
    for k, v in fields.items():
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
        )
    ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    parts.append(
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
            f"Content-Type: {ctype}\r\n\r\n"
        ).encode()
        + data
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def pick_ckpt() -> str:
    info = get_json(f"{COMFY}/object_info/CheckpointLoaderSimple", timeout=60)
    names = info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
    if not names:
        raise RuntimeError("Brak checkpointów w ComfyUI")
    for pref in CKPT_PREF:
        if pref in names:
            return pref
    return names[0]


def is_turbo(ckpt: str) -> bool:
    n = ckpt.lower()
    return "turbo" in n or "lightning" in n


def _stroke_fill_text(
    draw: ImageDraw.ImageDraw,
    xy,
    text,
    font,
    *,
    outline: int,
    stroke=(8, 8, 8),
    fill=(255, 255, 255),
) -> None:
    """Throw-up: gruby czarny obrys + biały fill (czytelne counters)."""
    x, y = xy
    for ox in range(-outline, outline + 1, 1):
        for oy in range(-outline, outline + 1, 1):
            if ox * ox + oy * oy > outline * outline:
                continue
            draw.text((x + ox, y + oy), text, font=font, fill=stroke)
    draw.text((x, y), text, font=font, fill=fill)


def render_base(path: Path, size: int = 1024) -> None:
    """Czytelne IGN!TE (Wallpoet throw-up) + dripy — kotwica dla img2img."""
    im = Image.new("RGB", (size, size), (255, 255, 255))
    draw = ImageDraw.Draw(im)
    left, bang, right = "IGN", "!", "TE"
    font_size = 236
    font = ImageFont.truetype(str(FONT), font_size)
    gap = max(14, font_size // 14)

    def measure(s: str):
        b = draw.textbbox((0, 0), s, font=font)
        return b[2] - b[0], b[3] - b[1], b

    while font_size > 80:
        font = ImageFont.truetype(str(FONT), font_size)
        gap = max(14, font_size // 14)
        w_l, _, _ = measure(left)
        w_b, _, _ = measure(bang)
        w_r, _, _ = measure(right)
        total_w = w_l + gap + w_b + gap + w_r
        h_max = max(measure(left)[1], measure(bang)[1], measure(right)[1])
        if total_w <= size * 0.86 and h_max <= size * 0.38:
            break
        font_size -= 4

    w_l, h_l, b_l = measure(left)
    w_b, h_b, b_b = measure(bang)
    w_r, h_r, b_r = measure(right)
    total_w = w_l + gap + w_b + gap + w_r
    h_max = max(h_l, h_b, h_r)
    x0 = (size - total_w) / 2
    y_mid = size / 2 - size * 0.04

    parts = [
        (left, x0, y_mid - h_l / 2 - b_l[1]),
        (bang, x0 + w_l + gap, y_mid - h_b / 2 - b_b[1]),
        (right, x0 + w_l + gap + w_b + gap, y_mid - h_r / 2 - b_r[1]),
    ]
    outline = max(22, font_size // 7)
    for text, x, y in parts:
        _stroke_fill_text(draw, (x, y), text, font, outline=outline)

    bang_cx = x0 + w_l + gap + w_b / 2
    drip_y = y_mid + h_max * 0.48
    for cx, length, thick in (
        (x0 + w_l * 0.55, 52, 5),
        (bang_cx, 118, 6),
        (x0 + w_l + gap + w_b + gap + w_r * 0.58, 68, 5),
    ):
        draw.ellipse(
            [cx - thick - 2, drip_y, cx + thick + 2, drip_y + thick * 2],
            fill=(10, 10, 10),
        )
        draw.rectangle(
            [cx - thick // 2, drip_y + thick, cx + thick // 2, drip_y + length],
            fill=(10, 10, 10),
        )
        draw.ellipse(
            [
                cx - thick - 3,
                drip_y + length - 4,
                cx + thick + 3,
                drip_y + length + thick * 2 + 4,
            ],
            fill=(10, 10, 10),
        )

    im = im.filter(ImageFilter.SMOOTH)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG")
    print(f"base={path} font_px={font_size} outline={outline}")


def upload_image(path: Path) -> str:
    data = path.read_bytes()
    resp = post_multipart(
        f"{COMFY}/upload/image",
        {"overwrite": "true", "type": "input"},
        "image",
        path.name,
        data,
    )
    name = resp.get("name") or path.name
    print(f"uploaded={name}")
    return name


def workflow(ckpt: str, image_name: str, seed: int, denoise: float = 0.42) -> dict:
    turbo = is_turbo(ckpt)
    steps = 8 if turbo else 26
    cfg = 2.0 if turbo else 5.5
    sampler = "dpmpp_sde" if turbo else "dpmpp_2m"
    return {
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": ckpt},
        },
        "10": {
            "class_type": "LoadImage",
            "inputs": {"image": image_name},
        },
        "11": {
            "class_type": "VAEEncode",
            "inputs": {"pixels": ["10", 0], "vae": ["4", 2]},
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
                "denoise": denoise,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["11", 0],
            },
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "ignite_pitch_logo", "images": ["8", 0]},
        },
    }


def wait_image(prompt_id: str, timeout_s: float = 300) -> tuple[str, str, str]:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        time.sleep(1.5)
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
    """Przepisz PNG bez chunków tEXt/iTXt/zTXt/eXIf (ComfyUI wkłada tu prompt/workflow)."""
    with Image.open(path) as im:
        # Nowy obraz + paste — bez kopiowania im.info / text / exif.
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


def whitish_to_alpha(src: Path, dest: Path, threshold: int = 248) -> None:
    """Usuń tylko tło (flood z narożników) — zachowaj biały fill liter."""
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()

    def lum_at(x: int, y: int) -> float:
        r, g, b, _ = px[x, y]
        return (r + g + b) / 3.0

    # Flood-fill tła z narożników (białe / jasne)
    bg = [[False] * w for _ in range(h)]
    stack = [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)]
    for sx, sy in stack:
        if lum_at(sx, sy) < threshold - 20:
            # ciemne tło — fallback: traktuj jasne jako bg
            pass
    # Jeśli narożniki ciemne → klasyczne usuwanie ciemnego tła
    corner_avg = sum(lum_at(x, y) for x, y in stack) / 4.0
    if corner_avg < 80:
        out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        opx = out.load()
        for y in range(h):
            for x in range(w):
                r, g, b, _a = px[x, y]
                lum = (r + g + b) / 3.0
                if lum < 40:
                    continue
                t = (lum - 40) / 215.0
                ink = int(255 * (1.0 - t * 0.15))
                alpha = int(min(255, (lum - 35) * 1.35))
                opx[x, y] = (ink, ink, ink, alpha)
    else:
        from collections import deque

        q: deque[tuple[int, int]] = deque()
        for sx, sy in [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2)]:
            if lum_at(sx, sy) >= threshold - 8:
                bg[sy][sx] = True
                q.append((sx, sy))
        while q:
            x, y = q.popleft()
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nx < 0 or ny < 0 or nx >= w or ny >= h or bg[ny][nx]:
                    continue
                if lum_at(nx, ny) >= threshold - 8:
                    bg[ny][nx] = True
                    q.append((nx, ny))

        out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        opx = out.load()
        for y in range(h):
            for x in range(w):
                if bg[y][x]:
                    continue
                r, g, b, _a = px[x, y]
                lum = (r + g + b) / 3.0
                # Antialiasing przy krawędzi tła
                if lum > 230:
                    opx[x, y] = (255, 255, 255, 255)
                elif lum > 200:
                    soft = int(max(0, min(255, (255 - lum) * 8)))
                    # miękkie przejście obrysu
                    opx[x, y] = (r, g, b, 255)
                else:
                    opx[x, y] = (r, g, b, 255)

    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    pad = max(8, min(out.size) // 40)
    canvas = Image.new("RGBA", (out.width + pad * 2, out.height + pad * 2), (0, 0, 0, 0))
    canvas.paste(out, (pad, pad), out)
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, format="PNG", optimize=True)
    strip_png_metadata(dest)
    print(f"Saved transparent logo: {dest} ({canvas.size[0]}×{canvas.size[1]})")


def main() -> int:
    print("ComfyUI: checking…")
    get_json(f"{COMFY}/system_stats", timeout=30)
    ckpt = pick_ckpt()
    print(f"ckpt={ckpt}")
    render_base(BASE)
    image_name = upload_image(BASE)
    seed = int(time.time()) % (2**31 - 1)
    denoise = 0.28 if is_turbo(ckpt) else 0.30
    wf = workflow(ckpt, image_name, seed, denoise=denoise)
    print(f"queue img2img seed={seed} denoise={denoise}…")
    resp = post_json(f"{COMFY}/prompt", {"prompt": wf})
    prompt_id = resp["prompt_id"]
    print(f"prompt_id={prompt_id}")
    filename, sub, typ = wait_image(prompt_id)
    print(f"output={filename}")
    download(filename, sub, typ, RAW)
    whitish_to_alpha(RAW, OUT)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        raise SystemExit(1)
