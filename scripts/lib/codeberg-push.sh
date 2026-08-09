#!/usr/bin/env bash
# Wewnętrzny helper — git clone + LFS push (uruchamiany przez publish_artifacts).
set -euo pipefail

work="$1"
staging="$2"
codeberg_user="$3"
codeberg_repo="$4"
version="$5"

git clone "git@codeberg.org:${codeberg_user}/${codeberg_repo}.git" "${work}"
cd "${work}"
git lfs install
git lfs track '*.zip' '*.deb' '*.tar.zst'
mkdir -p releases

cp "${staging}/DOWNLOADS.md" ./DOWNLOADS.md
cp "${staging}"/releases/* ./releases/

git add .gitattributes DOWNLOADS.md releases/
if git diff --cached --quiet; then
	echo "Brak zmian w plikach — tagi i tak zostaną zaktualizowane."
else
	git -c "user.name=${codeberg_user}" \
		-c "user.email=${codeberg_user}@noreply.codeberg.org" \
		commit -m "Release v${version} [skip ci]"
	git push origin main
fi

while IFS=: read -r _name tag; do
	[[ -n "${tag}" ]] || continue
	git tag -f "${tag}"
	git push -f origin "${tag}"
done <"${staging}/tags.list"
