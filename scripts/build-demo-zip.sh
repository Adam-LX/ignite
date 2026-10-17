#!/usr/bin/env bash
# Buduje web demo (VITE_IGNITE_DEMO=1) i pakuje zip pod znajomych / itch.
#
#   ./scripts/build-demo-zip.sh
#   OUT=release/ignite-demo.zip ./scripts/build-demo-zip.sh
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

OUT="${OUT:-${ROOT}/release/ignite-demo-web.zip}"
STAGING="${ROOT}/.build/demo-web"
mkdir -p "$(dirname "$OUT")" "${ROOT}/.build"

echo "[demo] bake donation (opcjonalne)…"
SKIP_DONATION_BAKE="${SKIP_DONATION_BAKE:-0}" bash scripts/bake-donation.sh || true

echo "[demo] vite build VITE_IGNITE_DEMO=1…"
rm -rf "${STAGING}"
export VITE_IGNITE_DEMO=1
if command -v steam-run >/dev/null 2>&1 && [[ -x node_modules/.bin/vite ]]; then
  steam-run ./node_modules/.bin/tsc --noEmit || true
  steam-run env VITE_IGNITE_DEMO=1 ./node_modules/.bin/vite build --outDir "${STAGING}"
else
  nix develop -c bash -lc "VITE_IGNITE_DEMO=1 npm run build:web -- --outDir ${STAGING}" \
    || VITE_IGNITE_DEMO=1 npx vite build --outDir "${STAGING}"
fi

cat > "${STAGING}/CZYTAJ-MNIE.txt" <<'EOF'
Ignite — DEMO (web)

Jak grać:
  1. Rozpakuj zip
  2. Odpal lokalny serwer statyczny w tym folderze, np.:
       python3 -m http.server 8080
     albo: npx serve .
  3. Otwórz http://localhost:8080

Ograniczenia demo:
  - tryb 1v1
  - 2 auta (octane, muscle)
  - arena standard
  - mecz max 10 minut
  - krótki tutorial przy pierwszym starcie

Online z kumplem: pełny build (nie demo zip) + relay — patrz README.

Sterowanie: W/S jazda · A/D skręt · LPM boost · PPM skok · Spacja Ball Cam
Wsparcie: tip jar w README Codeberg (Ko-fi / Patronite / crypto w grze: C)
EOF

# Śmieci / preview niepotrzebne w paczce znajomych
rm -rf "${STAGING}/_preview" "${STAGING}/promo"
rm -f "${OUT}"
if command -v zip >/dev/null 2>&1; then
  (
    cd "${STAGING}"
    zip -qr "${OUT}" .
  )
else
  python3 - <<PY
import zipfile
from pathlib import Path
root = Path("${STAGING}")
out = Path("${OUT}")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    for p in root.rglob("*"):
        if p.is_file():
            zf.write(p, p.relative_to(root).as_posix())
print(f"zipped {out}")
PY
fi
echo "[demo] OK → ${OUT} ($(du -h "${OUT}" | awk '{print $1}'))"
