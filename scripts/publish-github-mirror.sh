#!/usr/bin/env bash
# Jednorazowy mirror kodu na github.com/Adam-LX/ignite (orphan commit, bez LFS/releases).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

GITHUB_USER="${GITHUB_USER:-Adam-LX}"
GITHUB_REPO="${GITHUB_MIRROR_REPO:-ignite}"
GITHUB_REMOTE="${GITHUB_REMOTE:-git@github.com:${GITHUB_USER}/${GITHUB_REPO}.git}"
CODEBERG_USER="${CODEBERG_USER:-Adam-LX}"
CODEBERG_REPO="${CODEBERG_REPO:-ignite}"

read_version() {
	node -p "require('${ROOT}/package.json').version"
}

usage() {
	cat <<EOF
Użycie: $(basename "$0") [--dry-run]

  Wypycha aktualny stan drzewa jako jeden commit na ${GITHUB_REMOTE}
  (bez releases/, bez .gitattributes, bez pointerów LFS).

  Kanoniczne źródło: codeberg.org/${CODEBERG_USER}/${CODEBERG_REPO}
EOF
}

main() {
	local dry=0 version tmp
	for arg in "$@"; do
		case "${arg}" in
			-h | --help) usage; exit 0 ;;
			--dry-run) dry=1 ;;
			*) echo "Nieznany argument: ${arg}" >&2; usage >&2; exit 1 ;;
		esac
	done

	version=$(read_version)
	tmp=$(mktemp -d)
	trap "rm -rf '${tmp}'" EXIT

	echo "== GitHub mirror v${version} → ${GITHUB_REMOTE} =="

	rsync -a \
		--exclude .git \
		--exclude releases \
		--exclude node_modules \
		--exclude dist \
		--exclude release \
		--exclude .venv-music \
		--exclude docker \
		--exclude "data/*.pid" \
		--exclude data/ranked-elo.json \
		--exclude "data/*-endpoint.env" \
		--exclude "docs/.~lock*" \
		--exclude "audio/match_*.mp3" \
		--exclude "T4.glb" \
		"${ROOT}/" "${tmp}/"

	rm -f "${tmp}/.gitattributes"

	cd "${tmp}"
	git init -b main -q
	git -c filter.lfs.required=false -c filter.lfs.process= add -A

	if git grep -l "git-lfs.github.com" "$(git ls-files)" 2>/dev/null | head -3 | grep -q .; then
		echo "Błąd: w mirrorze zostały pointery LFS:" >&2
		git grep -l "git-lfs.github.com" "$(git ls-files)" >&2
		exit 1
	fi

	git -c "user.name=${GITHUB_USER}" \
		-c "user.email=${GITHUB_USER}@users.noreply.github.com" \
		commit -qm "v${version}: source mirror (canonical: codeberg.org/${CODEBERG_USER}/${CODEBERG_REPO})"

	if [[ "${dry}" == "1" ]]; then
		echo "Dry-run OK — commit w ${tmp}"
		trap - EXIT
		return 0
	fi

	git push --force "${GITHUB_REMOTE}" main
	echo ""
	echo "Mirror: https://github.com/${GITHUB_USER}/${GITHUB_REPO}"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	main "$@"
fi
