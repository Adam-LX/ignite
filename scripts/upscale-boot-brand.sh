#!/usr/bin/env bash
# RealESRGAN animevideov3 x2 → 1080p premium H.264 for ignite_boot_brand.mp4
set -euo pipefail
WORK="${HOME}/StabilityMatrix/Images/IgniteBoot"
TOOLS="$WORK/tools"
RAW="${1:-$WORK/ignite_boot_brand_raw.mp4}"
GAME="$(cd "$(dirname "$0")/.." && pwd)/public/assets/video/ignite_boot_brand.mp4"
IN="$WORK/upscale_in"
OUT="$WORK/upscale_out"
HQ="$WORK/ignite_boot_brand_1080p.mp4"

[[ -x "$TOOLS/realesrgan-ncnn-vulkan" ]] || {
  echo "Missing $TOOLS/realesrgan-ncnn-vulkan" >&2
  exit 1
}

rm -rf "$IN" "$OUT"
mkdir -p "$IN" "$OUT"
ffmpeg -y -hide_banner -loglevel error -i "$RAW" -vsync 0 "$IN/%06d.png"
(cd "$TOOLS" && steam-run ./realesrgan-ncnn-vulkan -i "$IN" -o "$OUT" -n realesr-animevideov3 -s 2 -f png -j 2:4:2)
ffmpeg -y -hide_banner -loglevel error -stats \
  -framerate 30 -i "$OUT/%06d.png" \
  -vf "scale=1920:1080:flags=lanczos:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,unsharp=5:5:0.55:5:5:0.0" \
  -c:v libx264 -preset slow -profile:v high -level 4.2 \
  -crf 14 -pix_fmt yuv420p -movflags +faststart -an \
  "$HQ"
mkdir -p "$(dirname "$GAME")"
cp -f "$HQ" "$GAME"
rm -rf "$IN" "$OUT"
ffprobe -hide_banner "$GAME" 2>&1 | head -20
ls -lah "$GAME"
