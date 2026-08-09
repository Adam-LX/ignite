# Ignite — publiczny relay MP

Relay to `server/roomServer.ts` (WebSocket + HTTP `/status`, `/rooms`, ranked).

## Produkcja (VPS)

**Generator:** `./scripts/vps-relay-setup.sh --host wss://mp.twoja-domena.pl` → `data/vps-relay/DEPLOY.md` + unit systemd.

1. VPS (Hetzner/DO) z Node 20+.
2. Sklonuj repo, zbuduj serwer: `npm run build:mp-server`.
3. Uruchom: `IGNITE_MP_PORT=8765 node dist-server/roomServer.js` (ścieżka z buildu).
4. TLS: Cloudflare Tunnel (`cloudflared tunnel`) lub nginx reverse proxy → `wss://relay.example.com`.
5. Zapisz endpoint w buildzie:

```bash
export IGNITE_MP_SERVER="wss://relay.example.com"
bash scripts/bake-mp-endpoint.sh --skip-tunnel
```

Albo ręcznie `public/mp-endpoint.json`:

```json
{
  "server": "wss://relay.example.com",
  "local": "localhost:8765"
}
```

## Zmienne CI / release

| Zmienna | Opis |
|---------|------|
| `IGNITE_MP_SERVER` | Stały publiczny relay (priorytet w `bake-mp-endpoint.sh`) |
| `SKIP_MP_BAKE=1` | Pomiń tunnel w buildzie desktop |
| `IGNITE_MP_PORT` | Port lokalny serwera (domyślnie 8765) |

## Healthcheck

```bash
curl -sf "https://relay.example.com/status"
curl -sf "https://relay.example.com/rooms"
```

## Ranked ELO backup

Plik `data/ranked-elo.json` na serwerze — backup cron (poza repo).

## Dev (bez VPS)

```bash
npm run dev:mp          # lokalny roomServer
# opcjonalnie quick tunnel — nie commituj URL do repo
bash scripts/bake-mp-endpoint.sh
```

**Release build** (`npm run build:web:desktop`) używa `--release` — bez tunelu Cloudflare.
Przed publikacją ustaw stały relay:

```bash
export IGNITE_MP_SERVER="wss://relay.example.com"
export IGNITE_MP_BAKE_POLICY=1   # opcjonalnie: dopisz VPS do policy-relays.json
bash scripts/bake-mp-endpoint.sh --release
npm run build:web:desktop
```

| Zmienna | Opis |
|---------|------|
| `IGNITE_MP_BAKE_POLICY` | `1` = dopisz relay do `policy-relays.json` (tylko stały VPS) |

## E2E online

```bash
IGNITE_MP_SERVER=wss://relay.example.com npm run test:e2e:online
```
