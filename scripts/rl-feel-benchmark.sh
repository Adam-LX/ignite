#!/usr/bin/env bash
# Multi-seed RL feel benchmark — agregat bez F9.
#
#   npm run rl:benchmark
#   SEEDS="11 22 33" npm run rl:benchmark
#   SEEDS_2V2="22" npm run rl:benchmark   # 2v2 tylko gate seed (44 = stalemate)
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
OUT="${ROOT}/test-results/rl-benchmark"
mkdir -p "${OUT}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="${OUT}/benchmark-${STAMP}.md"
SEEDS="${SEEDS:-11 22 33 44}"
SEEDS_2V2="${SEEDS_2V2:-22}"

nix_run() {
	nix-shell -p nodejs_22 --run "$1"
}

{
	echo "# RL feel benchmark — ${STAMP}"
	echo ""
	echo "Seeds 1v1: ${SEEDS}"
	echo "Seeds 2v2: ${SEEDS_2V2}"
	echo ""
} >"${REPORT}"

crit=0
for seed in ${SEEDS}; do
	echo "=== probe 1v1 seed=${seed} ==="
	nix_run "npm run probe:matches -- --mode 1v1 --matches 4 --seconds 75 --seed ${seed}" >/dev/null
	if grep -q '\[CRIT\]' "${ROOT}/data/match-probes/FINDINGS.md"; then
		crit=$((crit + 1))
	fi
	{
		echo "## 1v1 seed ${seed}"
		echo ""
		sed -n '/## Agregat/,/## Wnioski/p' "${ROOT}/data/match-probes/FINDINGS.md" | head -n -1
		echo ""
		sed -n '/## Wnioski/,$p' "${ROOT}/data/match-probes/FINDINGS.md"
		echo ""
	} >>"${REPORT}"
done

for seed in ${SEEDS_2V2}; do
	echo "=== probe 2v2 seed=${seed} ==="
	nix_run "npm run probe:matches -- --mode 2v2 --matches 3 --seconds 60 --seed ${seed}" >/dev/null
	if grep -q '\[CRIT\]' "${ROOT}/data/match-probes/FINDINGS.md"; then
		crit=$((crit + 1))
	fi
	{
		echo "## 2v2 seed ${seed}"
		echo ""
		sed -n '/## Agregat/,/## Wnioski/p' "${ROOT}/data/match-probes/FINDINGS.md" | head -n -1
		echo ""
		sed -n '/## Wnioski/,$p' "${ROOT}/data/match-probes/FINDINGS.md"
		echo ""
	} >>"${REPORT}"
done

echo "" >>"${REPORT}"
echo "CRIT total: ${crit}" >>"${REPORT}"
ln -sf "$(basename "${REPORT}")" "${OUT}/LATEST.md"
echo "[rl-benchmark] wrote ${REPORT} (crit=${crit})"
exit "${crit}"
