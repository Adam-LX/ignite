#!/usr/bin/env bash
# Gemini w działającym Vivaldi — bez drugiej instancji, bez przywracania sesji (YT itd.).
#
#   ./scripts/gemini-open-vivaldi.sh
#   ./scripts/gemini-open-vivaldi.sh "pytanie"     # otwiera Gemini + kopiuje prompt do schowka
set -euo pipefail

PROMPT="${*:-}"

vivaldi-launch --new-tab --disable-features=WebContentsForceDark \
  "https://gemini.google.com/app"

if [[ -n "$PROMPT" ]] && command -v wl-copy >/dev/null; then
  printf '%s' "$PROMPT" | wl-copy
  echo "Prompt w schowku — wklej Ctrl+V w Gemini."
elif [[ -n "$PROMPT" ]]; then
  echo "$PROMPT"
  echo "---"
  echo "(brak wl-copy — skopiuj prompt ręcznie)"
fi
