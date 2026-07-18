#!/usr/bin/env bash
# Wpisuje portfele do public/donation.json z prywatnego data/donation.env (nie w repo).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

ENV_FILE="${ROOT}/data/donation.env"
OUT="${ROOT}/public/donation.json"

if [[ "${SKIP_DONATION_BAKE:-}" == "1" ]]; then
	exit 0
fi

mkdir -p "${ROOT}/data" "${ROOT}/public"

if [[ ! -f "${ENV_FILE}" ]]; then
	echo "bake-donation: brak ${ENV_FILE} — portfele wyłączone (to OK dla forków / CI)." >&2
	rm -f "${OUT}"
	exit 0
fi

python3 - "${ENV_FILE}" "${OUT}" <<'PY'
import json
import sys
from pathlib import Path

env_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])

vals: dict[str, str] = {}
for raw in env_path.read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    vals[key.strip()] = value.strip().strip('"').strip("'")

wallets = []
for symbol, env_key, label in (
    ("INJ", "DONATION_INJ", "Injective"),
    ("ETH", "DONATION_ETH", "Ethereum"),
    ("BTC", "DONATION_BTC", "Bitcoin"),
):
    wallets.append(
        {
            "symbol": symbol,
            "label": label,
            "address": vals.get(env_key, ""),
        }
    )

payload = {
    "wallets": wallets,
    "verifyUrl": vals.get("DONATION_VERIFY_URL", "https://codeberg.org/Adam-LX"),
}

out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
active = sum(1 for w in wallets if w["address"])
print(f"bake-donation: {out_path} ({active}/3 adresów)")
PY
