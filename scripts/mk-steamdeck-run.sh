#!/usr/bin/env bash
# Skleja AppImage + nagłówek → jeden plik Ignite-*-SteamDeck.run
set -euo pipefail
cd "$(dirname "$0")/.."

APPIMAGE="${1:-}"
if [[ -z "${APPIMAGE}" ]]; then
	APPIMAGE="$(find release -maxdepth 1 -name 'Ignite-*-linux-amd64.AppImage' 2>/dev/null | head -1)"
fi

if [[ -z "${APPIMAGE}" || ! -f "${APPIMAGE}" ]]; then
	echo "Użycie: $0 [ścieżka/do/AppImage]" >&2
	echo "Najpierw: ./scripts/build-steamdeck.sh" >&2
	exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
EXPECTED_BYTES="$(wc -c <"${APPIMAGE}" | tr -d ' ')"
OUT="release/Ignite-${VERSION}-SteamDeck.run"
HEADER_TEMPLATE="steamdeck/self-extract.sh"
MARKER="__IGNITE_APPIMAGE_BELOW__"

if [[ ! -f "${HEADER_TEMPLATE}" ]]; then
	echo "Brak ${HEADER_TEMPLATE}" >&2
	exit 1
fi

echo "== Ignite — pakuję SteamDeck.run (${EXPECTED_BYTES} B) =="

sed \
	-e "s/@VERSION@/${VERSION}/g" \
	-e "s/@EXPECTED_BYTES@/${EXPECTED_BYTES}/g" \
	"${HEADER_TEMPLATE}" >"${OUT}.header"

{
	cat "${OUT}.header"
	printf '%s\n' "${MARKER}"
	cat "${APPIMAGE}"
} >"${OUT}.tmp"

chmod +x "${OUT}.tmp"
mv -f "${OUT}.tmp" "${OUT}"
rm -f "${OUT}.header"

RUN_BYTES="$(wc -c <"${OUT}" | tr -d ' ')"
echo ""
echo "Gotowe: ${OUT} ($(du -h "${OUT}" | cut -f1), ${RUN_BYTES} B)"
echo ""
echo "Steam Deck — pobierz ten jeden plik:"
echo "  chmod +x Ignite-*-SteamDeck.run"
echo "  ./Ignite-*-SteamDeck.run"
echo ""
echo "Steam → Dodaj grę spoza Steam → wskaż plik .run"
