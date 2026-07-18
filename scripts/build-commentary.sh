#!/usr/bin/env bash
# Bake komentatora: phrases.yaml → XTTS (:9004) → stadium OGG + manifest.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export SWOS_TTS_URL="${SWOS_TTS_URL:-http://127.0.0.1:9004}"

echo "→ Ignite commentary bake @ $SWOS_TTS_URL"
if ! curl -fsS --max-time 3 "$SWOS_TTS_URL/health" >/dev/null 2>&1; then
	echo "TTS nie odpowiada na $SWOS_TTS_URL" >&2
	echo "Uruchom kontener tts-swos-tts (port 9004), np.:" >&2
	echo "  docker run -d --name ignite-tts -p 9004:9004 \\" >&2
	echo "    -v \$SWOS_VOICES:/voices:ro -v ignite-tts-models:/models \\" >&2
	echo "    -e COQUI_TOS_AGREED=1 -e TTS_HOME=/models -e VOICE_ASSET_DIR=/voices \\" >&2
	echo "    --device nvidia.com/gpu=all tts-swos-tts:latest" >&2
	exit 1
fi

PY="${IGNITE_PYTHON:-python3}"
if ! "$PY" -c "import yaml" 2>/dev/null; then
	export PYTHONPATH="${PYTHONPATH:-}:/nix/store/8y32jrqnknxj6hakyg8x64y75gbl8jry-python3.13-pyyaml-6.0.3/lib/python3.13/site-packages"
fi

if ! "$PY" -c "import yaml" 2>/dev/null; then
	exec nix-shell -p python3Packages.pyyaml --run "python3 '$ROOT/scripts/build_commentary.py'"
fi

exec "$PY" "$ROOT/scripts/build_commentary.py" "$@"
