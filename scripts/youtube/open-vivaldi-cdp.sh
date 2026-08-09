#!/usr/bin/env bash
# Otwiera Vivaldi z CDP (port 9222), żeby Playwright mógł użyć Twojej sesji YT.
# NIE kopiuje haseł — tylko remote debugging do już zalogowanej przeglądarki.
set -euo pipefail

PORT="${YT_CDP_PORT:-9222}"
USER_DATA="${YT_VIVALDI_USER_DATA:-$HOME/.config/vivaldi}"

if curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
  echo "CDP już działa na :${PORT}"
  curl -s "http://127.0.0.1:${PORT}/json/version" | head -c 400
  echo
  exit 0
fi

VIVALDI="$(command -v vivaldi || true)"
if [[ -z "$VIVALDI" ]]; then
  echo "Brak vivaldi w PATH" >&2
  exit 1
fi

if pgrep -f '/opt/vivaldi/vivaldi' >/dev/null 2>&1 || pgrep -x vivaldi >/dev/null 2>&1; then
  if [[ "${1:-}" != "--restart" ]]; then
    echo "Vivaldi już działa BEZ CDP."
    echo "Uruchom ponownie z debugiem:"
    echo "  $0 --restart"
    echo "Zamknie Vivaldi i otworzy go z --remote-debugging-port=${PORT} (ta sama sesja / profil)."
    exit 2
  fi
  echo "Zamykam Vivaldi…"
  pkill -f '/opt/vivaldi/vivaldi' 2>/dev/null || pkill -x vivaldi 2>/dev/null || true
  for _ in $(seq 1 30); do
    pgrep -f '/opt/vivaldi/vivaldi' >/dev/null 2>&1 || break
    sleep 0.3
  done
  sleep 1
fi

echo "Start Vivaldi + CDP :${PORT} (profil: ${USER_DATA})"
# shellcheck disable=SC2086
nohup "$VIVALDI" \
  --remote-debugging-port="$PORT" \
  --remote-allow-origins=* \
  --user-data-dir="$USER_DATA" \
  "https://www.youtube.com/" \
  >/tmp/ignite-vivaldi-cdp.log 2>&1 &

for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
    echo "CDP OK"
    exit 0
  fi
  sleep 0.25
done

echo "CDP nie wstało — log: /tmp/ignite-vivaldi-cdp.log" >&2
tail -n 40 /tmp/ignite-vivaldi-cdp.log >&2 || true
exit 1
