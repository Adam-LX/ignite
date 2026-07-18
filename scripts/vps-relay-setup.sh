#!/usr/bin/env bash
# Generuje pliki systemd + instrukcję wdrożenia stałego relay MP na VPS.
# Nie wymaga root lokalnie — wypisuje gotowe komendy do skopiowania na serwer.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

RELAY_USER="${RELAY_USER:-ignite}"
RELAY_PORT="${IGNITE_MP_PORT:-8765}"
RELAY_HOST="${IGNITE_NAMED_TUNNEL_HOST:-wss://mp.example.com}"
REPO_URL="${RELAY_REPO_URL:-https://codeberg.org/Adam-LX/ignite.git}"
INSTALL_DIR="${RELAY_INSTALL_DIR:-/opt/ignite-relay}"

usage() {
	cat <<EOF
Użycie: $(basename "$0") [--host wss://mp.twoja-domena.pl]

Generuje:
  data/vps-relay/ignite-mp.service   — systemd unit
  data/vps-relay/cloudflared.service — opcjonalny named tunnel
  data/vps-relay/DEPLOY.md           — kroki na VPS

Po wdrożeniu na build release:
  export IGNITE_MP_SERVER="${RELAY_HOST}"
  export IGNITE_MP_BAKE_POLICY=1
  bash scripts/bake-mp-endpoint.sh --release
EOF
}

main() {
	local host="${RELAY_HOST}"
	for arg in "$@"; do
		case "${arg}" in
			--host)
				host="$2"
				shift 2
				;;
			-h | --help)
				usage
				exit 0
				;;
			*)
				echo "Nieznany argument: ${arg}" >&2
				usage >&2
				exit 1
				;;
		esac
	done

	local out="${ROOT}/data/vps-relay"
	mkdir -p "${out}"

	cat >"${out}/ignite-mp.service" <<UNIT
[Unit]
Description=Ignite MP roomServer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RELAY_USER}
WorkingDirectory=${INSTALL_DIR}
Environment=IGNITE_MP_PORT=${RELAY_PORT}
Environment=NODE_ENV=production
ExecStart=/usr/bin/node ${INSTALL_DIR}/electron/mp-server.cjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

	cat >"${out}/cloudflared.service" <<UNIT
[Unit]
Description=Cloudflare tunnel → Ignite MP
After=network-online.target ignite-mp.service
Requires=ignite-mp.service

[Service]
Type=simple
User=${RELAY_USER}
ExecStart=/usr/bin/cloudflared tunnel run ignite-mp
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

	cat >"${out}/DEPLOY.md" <<MD
# VPS relay — Ignite MP

Stały endpoint: \`${host}\`

## 1. Serwer (Hetzner / DO, Ubuntu 22+)

\`\`\`bash
sudo adduser --disabled-password --gecos "" ${RELAY_USER}
sudo mkdir -p ${INSTALL_DIR}
sudo chown ${RELAY_USER}:${RELAY_USER} ${INSTALL_DIR}

sudo -u ${RELAY_USER} git clone ${REPO_URL} ${INSTALL_DIR}
cd ${INSTALL_DIR}
sudo -u ${RELAY_USER} npm ci
sudo -u ${RELAY_USER} npm run build:mp-server
\`\`\`

## 2. systemd

\`\`\`bash
sudo cp ${INSTALL_DIR}/data/vps-relay/ignite-mp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ignite-mp
curl -sf http://127.0.0.1:${RELAY_PORT}/status
\`\`\`

## 3. TLS (Cloudflare named tunnel — zalecane)

\`\`\`bash
cloudflared tunnel create ignite-mp
cloudflared tunnel route dns ignite-mp mp.twoja-domena.pl
# config.yml → localhost:${RELAY_PORT}
sudo cp ${INSTALL_DIR}/data/vps-relay/cloudflared.service /etc/systemd/system/
sudo systemctl enable --now cloudflared
\`\`\`

Healthcheck publiczny:

\`\`\`bash
curl -sf "${host/https/wss}/status"
curl -sf "${host/https/wss}/rooms"
\`\`\`

## 4. Build desktop z stałym relay

\`\`\`bash
export IGNITE_MP_SERVER="${host}"
export IGNITE_MP_BAKE_POLICY=1
bash scripts/bake-mp-endpoint.sh --release
npm run publish:github
\`\`\`

Ranked ELO: backup \`${INSTALL_DIR}/data/ranked-elo.json\` (cron poza repo).
MD

	echo "Wygenerowano: ${out}/"
	echo "  ignite-mp.service"
	echo "  cloudflared.service"
	echo "  DEPLOY.md"
	echo ""
	echo "Następny krok: skopiuj DEPLOY.md na VPS lub ustaw IGNITE_NAMED_TUNNEL_HOST=${host}"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	main "$@"
fi
