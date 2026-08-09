#!/usr/bin/env bash
# Pętla: audyt chase → (FAIL) diagnostyka → agent patchuje kamerę → repeat.
# Tylko metryki kamery — bez zmian materiałów / IBL / CSS look.
#
#   bash scripts/chase-camera-fix-loop.sh
#   bash scripts/chase-camera-fix-loop.sh --max 8 --path menu
#
# Exit 0 gdy PASS. Zapisuje test-results/chase-camera/LOOP.md
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="$ROOT/test-results/chase-camera"
mkdir -p "$OUT"

MAX=12
PATH_MODE=menu
TARGET=vite
while [[ $# -gt 0 ]]; do
	case "$1" in
		--max) MAX="$2"; shift 2 ;;
		--path) PATH_MODE="$2"; shift 2 ;;
		--target) TARGET="$2"; shift 2 ;;
		*) echo "Unknown arg: $1" >&2; exit 2 ;;
	esac
done

CHROMIUM="${CHROMIUM_PATH:-/run/current-system/sw/bin/chromium}"
export CHROMIUM_PATH="$CHROMIUM"

# Vite musi żyć
if ! curl -sf "http://127.0.0.1:5173/" >/dev/null; then
	echo "[loop] start Vite…"
	nix develop -c npm run dev >/tmp/ignite-vite-chase.log 2>&1 &
	for _ in $(seq 1 60); do
		curl -sf "http://127.0.0.1:5173/" >/dev/null && break
		sleep 0.5
	done
fi

LOOP_MD="$OUT/LOOP.md"
{
	echo "# Chase camera fix loop"
	echo ""
	echo "Started: $(date -Iseconds)"
	echo "target=$TARGET path=$PATH_MODE max=$MAX"
	echo ""
} >"$LOOP_MD"

for i in $(seq 1 "$MAX"); do
	echo ""
	echo "======== ITER $i / $MAX ========"
	echo "## Iter $i" >>"$LOOP_MD"
	echo "" >>"$LOOP_MD"

	set +e
	node scripts/audit-chase-camera.mjs --target="$TARGET" --path="$PATH_MODE"
	code=$?
	set -e

	if [[ "$code" -eq 0 ]]; then
		echo "**PASS** at iter $i" >>"$LOOP_MD"
		echo "[loop] PASS at iter $i"
		cat "$OUT/LATEST.md" >>"$LOOP_MD" || true
		exit 0
	fi

	echo "**FAIL** (exit $code)" >>"$LOOP_MD"
	if [[ -f "$OUT/LATEST.json" ]]; then
		node -e '
			const r=require("./test-results/chase-camera/LATEST.json");
			console.log("fails:", (r.fails||[]).join(", "));
			console.log("dist:", r.audit?.dist);
			console.log("ndc:", JSON.stringify(r.audit?.ndc));
			console.log("cam:", JSON.stringify(r.audit?.cam));
			console.log("hints:", (r.hints||[]).join(" | "));
		' >>"$LOOP_MD" 2>/dev/null || true
	fi
	echo "" >>"$LOOP_MD"

	# Sentinel dla agenta Cursor (/loop)
	echo "AGENT_LOOP_TICK_chase_camera {\"iter\":$i,\"prompt\":\"Przeczytaj test-results/chase-camera/LATEST.json i LATEST.md. Napraw TYLKO kamerę (Renderer/GameSession/main/cameraFollow/menuCinematic/crateBackdrop) — bez materiałów, IBL, CSS look, post. Potem puść ponownie: node scripts/audit-chase-camera.mjs --path=$PATH_MODE\"}"

	# Bez agenta: spróbuj deterministyczny patch helper (no-op jeśli brak)
	if [[ -f scripts/apply-chase-camera-hotfix.mjs ]]; then
		node scripts/apply-chase-camera-hotfix.mjs --iter="$i" || true
	fi

	sleep 1
done

echo "**EXHAUSTED** po $MAX iteracjach" >>"$LOOP_MD"
echo "[loop] FAIL — wyczerpano $MAX iteracji"
exit 1
