#!/usr/bin/env bash
# Eksport oczyszczonego drzewa źródeł — maksymalna prywatność (audyt przed publikacją).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IGNORE="${ROOT}/.source-exportignore"

# shellcheck source=scripts/lib/privacy-audit.sh
source "${ROOT}/scripts/lib/privacy-audit.sh"

export_clean_source() {
	local version="${1:-$(node -p "require('${ROOT}/package.json').version")}"
	local out="${ROOT}/release/Ignite-${version}-src.tar.zst"
	local root_name="ignite-${version}-src"

	[[ -f "${IGNORE}" ]] || {
		echo "Brak ${IGNORE}" >&2
		exit 1
	}

	command -v rsync >/dev/null 2>&1 || {
		echo "Brak rsync" >&2
		exit 1
	}
	command -v zstd >/dev/null 2>&1 || {
		echo "Brak zstd — uruchom: nix develop" >&2
		exit 1
	}

	echo "== Eksport źródeł (v${version}) ==" >&2
	local tmp
	tmp=$(mktemp -d)
	mkdir -p "${ROOT}/release"

	rsync -a \
		--exclude-from="${IGNORE}" \
		"${ROOT}/" "${tmp}/${root_name}/"

	audit_privacy_tree "${tmp}/${root_name}" "${root_name}"

	tar -C "${tmp}" -cf - "${root_name}" | zstd -19 -T0 -f -o "${out}"
	rm -rf "${tmp}"

	audit_privacy_tarball "${out}"

	local size
	size=$(du -h "${out}" | cut -f1)
	echo "Gotowe: ${out} (${size})" >&2
	printf '%s\n' "${out}"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	export_clean_source "${1:-}"
fi
