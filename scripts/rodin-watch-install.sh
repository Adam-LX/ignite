#!/usr/bin/env bash
# Czeka na GLB z Rodina w ~/Pobrane i odpala install-rodin-goal.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_HINT="$HOME/Pobrane/goalFrame-rodin.glb"
echo "Watching ~/Pobrane for Rodin .glb …"
for _ in $(seq 1 180); do
	if [[ -f "$DEST_HINT" ]] && (( $(stat -c%s "$DEST_HINT") > 400000 )); then
		echo "FOUND $DEST_HINT"
		"$ROOT/scripts/install-rodin-goal.sh" "$DEST_HINT"
		notify-send "Ignite" "Rodin GLB podpięty — Ctrl+Shift+R" 2>/dev/null || true
		exit 0
	fi
	NEW=$(find "$HOME/Pobrane" -maxdepth 1 -name '*.glb' -mmin -3 -size +400k 2>/dev/null | head -1 || true)
	if [[ -n "${NEW:-}" ]]; then
		echo "FOUND $NEW"
		cp -f "$NEW" "$DEST_HINT"
		"$ROOT/scripts/install-rodin-goal.sh" "$DEST_HINT"
		notify-send "Ignite" "Rodin GLB podpięty — Ctrl+Shift+R" 2>/dev/null || true
		exit 0
	fi
	sleep 2
done
echo "timeout"
exit 1
