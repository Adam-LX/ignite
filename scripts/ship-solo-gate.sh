#!/usr/bin/env bash
# Solo ship gate — gdy brak zewnętrznych testerów (np. Pan Kamil).
# Exit 0 = można wysłać demo znajomym; 1 = zablokuj ship.
#
#   ./scripts/ship-solo-gate.sh
#   SKIP_CHASE_SURVEY=1 ./scripts/ship-solo-gate.sh
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
OUT="${ROOT}/test-results/solo-ship"
mkdir -p "${OUT}"
RUN="${OUT}/gate-$(date -u +%Y%m%dT%H%M%SZ).log"
exec > >(tee "${RUN}") 2>&1

run() {
	local label="$1"
	shift
	echo ""
	echo "=== ${label} ==="
	if "$@"; then
		echo "[OK] ${label}"
	else
		echo "[FAIL] ${label}"
		exit 1
	fi
}

node_bin() {
	if command -v steam-run >/dev/null 2>&1 && [[ -x node_modules/.bin/$1 ]]; then
		steam-run ./node_modules/.bin/"$1" "${@:2}"
	else
		./node_modules/.bin/"$1" "${@:2}"
	fi
}

# Vite (chase + endurance)
if ! curl -sf --max-time 2 "http://127.0.0.1:5173/" >/dev/null; then
	echo "[solo-gate] start Vite…"
	if command -v steam-run >/dev/null 2>&1; then
		steam-run ./node_modules/.bin/vite --host 127.0.0.1 --port 5173 \
			>/tmp/ignite-solo-vite.log 2>&1 &
	else
		./node_modules/.bin/vite --host 127.0.0.1 --port 5173 \
			>/tmp/ignite-solo-vite.log 2>&1 &
	fi
	for _ in $(seq 1 90); do
		curl -sf --max-time 1 "http://127.0.0.1:5173/" >/dev/null && break
		sleep 1
	done
fi

run "feel:gate (ball + camera tests)" bash -c '
  set -e
  steam-run ./node_modules/.bin/vite-node scripts/runBallPhysicsAudit.ts
  steam-run ./node_modules/.bin/vitest run tests/visual/cameraFollow.test.ts tests/visual/CarGrounding.test.ts tests/visual/carWheelGround.test.ts --reporter=dot
'

run "audit:physics" steam-run ./node_modules/.bin/vitest run tests/physics --reporter=dot
run "audit:chase" steam-run node scripts/audit-chase-camera.mjs --path=autostart

if [[ "${SKIP_CHASE_SURVEY:-0}" != "1" ]]; then
	run "audit:chase survey" steam-run node scripts/audit-chase-camera.mjs --path=autostart --survey --soft-pixels
fi

run "kickoff drive" steam-run ./node_modules/.bin/vite-node scripts/runKickoffDriveTest.ts
run "probe:matches 1v1" steam-run ./node_modules/.bin/vite-node scripts/runMatchProbe.ts -- --mode 1v1 --matches 4 --seconds 75 --seed 11
run "relay smoke" steam-run node scripts/smoke-public-relay.mjs
run "session endurance" steam-run node scripts/session-endurance-smoke.mjs

# Wall-ceiling: known exceptions — log only
echo ""
echo "=== audit:wall-ceiling (informational; known exceptions OK) ==="
steam-run ./node_modules/.bin/vite-node scripts/runWallCeilingAudit.ts || true

cat > "${OUT}/LATEST.md" <<EOF
# Solo ship gate — PASS

Log: \`${RUN}\`

Bez zewnętrznych testerów źródło prawdy:
1. Ten gate (zielony)
2. Twoje F9 klipy (jeśli coś czujesz źle — jedna zmiana, re-gate)
3. Demo zip: \`npm run build:demo\`

Gdy Pan Kamil wróci: kamera Ball/Free Cam ma priorytet nad „ultra” bez repro.
EOF

echo ""
echo "[solo-gate] PASS → ${OUT}/LATEST.md"
