#!/usr/bin/env bash
# Headless solo ship — bez Vite/chase survey/steam-run (NixOS CI / agent).
#
#   npm run ship:solo:headless
#   SKIP_2V2_PROBE=1 npm run ship:solo:headless
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
OUT="${ROOT}/test-results/solo-ship"
mkdir -p "${OUT}"
RUN="${OUT}/gate-headless-$(date -u +%Y%m%dT%H%M%SZ).log"
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

nix_run() {
	nix-shell -p nodejs_22 --run "$1"
}

run "audit:ball" nix_run "npm run audit:ball"
run "audit:physics" nix_run "npm run audit:physics"
run "probe:aerial" nix_run "npm run probe:aerial"
run "tests:ai+diagnostic" nix_run "npx vitest run tests/ai tests/diagnostic --reporter=dot"
run "kickoff drive" nix_run "npx vite-node scripts/runKickoffDriveTest.ts"
run "train:bots:smoke" nix_run "env SKIP_BOT_POLICY_PUBLISH=1 npm run train:bots:smoke"
POLICY_GEN=$(nix_run "node -e \"const g=require('./public/assets/ai/bot-policy.json').generation; if(g<100){process.exit(1)} console.log(g)\"")
echo "[OK] bot-policy generation=${POLICY_GEN}"
run "probe:matches 1v1" nix_run "npm run probe:matches -- --mode 1v1 --matches 4 --seconds 75 --seed 11"
if grep -q '\[CRIT\]' "${ROOT}/data/match-probes/FINDINGS.md"; then
	echo "[FAIL] probe 1v1 — CRIT w FINDINGS.md"
	cat "${ROOT}/data/match-probes/FINDINGS.md"
	exit 1
fi
PROBE_1V1=$(sed -n '/## Agregat/,/## Wnioski/p' "${ROOT}/data/match-probes/FINDINGS.md" | head -n -1)

if [[ "${SKIP_2V2_PROBE:-0}" != "1" ]]; then
	run "probe:matches 2v2" nix_run "npm run probe:matches -- --mode 2v2 --matches 3 --seconds 60 --seed 22"
	if grep -q '\[CRIT\]' "${ROOT}/data/match-probes/FINDINGS.md"; then
		echo "[FAIL] probe 2v2 — CRIT w FINDINGS.md"
		cat "${ROOT}/data/match-probes/FINDINGS.md"
		exit 1
	fi
	PROBE_2V2=$(sed -n '/## Agregat/,/## Wnioski/p' "${ROOT}/data/match-probes/FINDINGS.md" | head -n -1)
fi

FINDINGS="${ROOT}/data/match-probes/FINDINGS.md"
PROBE_SUMMARY=""
if [[ -f "${FINDINGS}" ]]; then
	PROBE_SUMMARY=$(sed -n '/## Wnioski/,$p' "${FINDINGS}")
fi

GATE_STATUS="PASS"
if [[ -f "${FINDINGS}" ]] && grep -q '\[CRIT\]' "${FINDINGS}"; then
	GATE_STATUS="FAIL"
fi

cat > "${OUT}/LATEST.md" <<EOF
# Solo ship gate (headless) — ${GATE_STATUS}

Log: \`${RUN}\`

| Check | Result |
|-------|--------|
| audit:ball | PASS |
| audit:physics | PASS |
| probe:aerial | PASS |
| tests ai + diagnostic | PASS |
| kickoff drive | PASS |
| train:bots:smoke | PASS |
| probe 1v1 (4×75s) | PASS |
| probe 2v2 (3×60s) | ${SKIP_2V2_PROBE:-PASS} |

### Probe 1v1

${PROBE_1V1:-_(pominięto)_}

### Probe 2v2

${PROBE_2V2:-_(pominięto)_}

${PROBE_SUMMARY}

Bez zewnętrznych testerów: ten gate + F9 klipy. Pełny gate z kamerą: \`npm run ship:solo\`.
EOF

echo ""
echo "[solo-gate-headless] PASS → ${OUT}/LATEST.md"
