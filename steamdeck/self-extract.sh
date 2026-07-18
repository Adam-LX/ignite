#!/usr/bin/env bash
# Nagłówek self-extracting Ignite-SteamDeck.run — nie uruchamiaj bezpośrednio.
# @VERSION@ i @EXPECTED_BYTES@ podstawiane przy buildzie.
set -euo pipefail

readonly IGNITE_VERSION="@VERSION@"
readonly EXPECTED_BYTES=@EXPECTED_BYTES@
readonly APPIMAGE_BASENAME="Ignite-${IGNITE_VERSION}-linux-amd64.AppImage"
readonly MARKER="__IGNITE_APPIMAGE_BELOW__"
readonly INSTALL_ROOT="${XDG_DATA_HOME:-${HOME}/.local/share}/ignite"

resolve_run_file() {
	local src="${BASH_SOURCE[0]:-$0}"
	if [[ "${src}" != /* ]]; then
		src="$(cd "$(dirname "${src}")" && pwd)/$(basename "${src}")"
	fi
	printf '%s\n' "${src}"
}

payload_start_line() {
	local run_file="$1"
	awk -v m="${MARKER}" '$0 == m { print NR + 1; exit }' "${run_file}"
}

install_cached_appimage() {
	local run_file="$1"
	local dest="${INSTALL_ROOT}/${APPIMAGE_BASENAME}"
	local stamp="${INSTALL_ROOT}/.installed-version"
	local start tmp

	mkdir -p "${INSTALL_ROOT}"

	if [[ -f "${dest}" && -f "${stamp}" && "$(cat "${stamp}")" == "${IGNITE_VERSION}" ]]; then
		printf '%s\n' "${dest}"
		return 0
	fi

	start="$(payload_start_line "${run_file}")"
	if [[ -z "${start}" ]]; then
		echo "Ignite: uszkodzony plik .run (brak znacznika payload)." >&2
		exit 1
	fi

	local mb=$(( (EXPECTED_BYTES + 524287) / 1048576 ))
	echo "Ignite — pierwsze uruchomienie, przygotowuję grę (~${mb} MB)…" >&2

	tmp="$(mktemp "${INSTALL_ROOT}/.ignite-XXXXXX.part")"
	trap 'rm -f "${tmp}"' EXIT

	tail -n +"${start}" "${run_file}" >"${tmp}"

	local size
	size="$(wc -c <"${tmp}" | tr -d ' ')"
	if [[ "${size}" -ne "${EXPECTED_BYTES}" ]]; then
		echo "Ignite: błąd rozpakowania (oczekiwano ${EXPECTED_BYTES} B, jest ${size} B)." >&2
		exit 1
	fi

	chmod +x "${tmp}"
	if ! head -c 4 "${tmp}" | grep -q $'^\x7fELF'; then
		echo "Ignite: rozpakowany plik nie wygląda na AppImage." >&2
		exit 1
	fi

	mv -f "${tmp}" "${dest}"
	trap - EXIT
	printf '%s\n' "${IGNITE_VERSION}" >"${stamp}"
	printf '%s\n' "${dest}"
}

main() {
	local run_file appimage
	run_file="$(resolve_run_file)"
	appimage="$(install_cached_appimage "${run_file}")"
	export STEAM_DECK=1
	exec "${appimage}" --no-sandbox "$@"
}

main "$@"
exit 0
