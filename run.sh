#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

for p in 5173 5174 5175 5176; do
  lsof -ti:"${p}" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
done
sleep 1
if lsof -ti:5173 >/dev/null 2>&1; then
  echo "Błąd: port 5173 nadal zajęty. Uruchom: lsof -ti:5173 | xargs kill -9"
  exit 1
fi

echo ""
echo "  Ignite dev → http://localhost:5173"
echo "  Zapis pliku = auto-reload · Ctrl+Shift+R = twardy reload"
echo ""

if command -v npm >/dev/null 2>&1; then
  [ -d node_modules ] || npm install
  exec npm run dev:force
fi

if [ -f flake.nix ] && git ls-files --error-unmatch flake.nix >/dev/null 2>&1; then
  exec nix develop -c npm run dev:force
fi

exec nix shell nixpkgs#nodejs_22 -c bash -c "npm install && npm run dev:force"
