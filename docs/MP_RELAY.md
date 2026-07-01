# Ignite — hostowanie relay multiplayer

Publiczny relay = **serwer pokojów** (`roomServer.ts`) + opcjonalnie **Cloudflare Tunnel** (quick lub named).

Binaria desktop: endpoint w `dist/mp-endpoint.json` (bake przy buildzie). Dev: `localhost:8765`.

---

## Szybki start (LAN / lokalnie)

```bash
# Terminal 1
npm run mp:server

# Terminal 2
npm run dev
```

Menu → **Online 1v1** → Host / Dołącz. W LAN gość wpisuje `192.168.x.x:8765`.

---

## Quick tunnel (Cloudflare, bez domeny)

```bash
./scripts/bake-mp-endpoint.sh
```

1. Uruchamia `npm run mp:server` na porcie `8765`
2. Startuje `cloudflared tunnel --url http://127.0.0.1:8765`
3. Zapisuje `wss://….trycloudflare.com` do:
   - `data/mp-public-endpoint.env`
   - `public/mp-endpoint.json`

Build desktop z publicznym relay:

```bash
./scripts/bake-mp-endpoint.sh   # przed buildem
npm run build:web:desktop
```

Bez tunelu (tylko LAN):

```bash
./scripts/bake-mp-endpoint.sh --skip-tunnel
SKIP_MP_BAKE=1 npm run build:web:desktop   # albo SKIP_MP_BAKE=1 przy buildzie
```

---

## Named tunnel (stały hostname)

Wymaga konta Cloudflare + skonfigurowanego tunelu.

```bash
export IGNITE_NAMED_TUNNEL=ignite-mp
export IGNITE_NAMED_TUNNEL_HOST=wss://mp.twoja-domena.pl
./scripts/bake-mp-endpoint.sh
```

`bake-mp-endpoint.sh` uruchamia `cloudflared tunnel run ignite-mp`.

---

## Daemon (utrzymanie relay 24/7)

```bash
./scripts/mp-relay-daemon.sh start          # pętla bake co 5 min
./scripts/mp-relay-daemon.sh status
./scripts/mp-relay-daemon.sh stop
```

Logi: `data/mp-relay-daemon.log` · PID: `data/mp-relay-daemon.pid`

Tylko lokalny serwer (bez internetu):

```bash
./scripts/mp-relay-daemon.sh start --skip-tunnel
```

---

## Zmienne środowiskowe

| Zmienna | Opis |
|---------|------|
| `IGNITE_MP_PORT` | Port serwera (domyślnie `8765`) |
| `IGNITE_MP_SERVER` | Wymuś istniejący publiczny `wss://` (pomija nowy tunnel) |
| `IGNITE_NAMED_TUNNEL` | Nazwa tunelu Cloudflare |
| `IGNITE_NAMED_TUNNEL_HOST` | Stały publiczny URL `wss://…` |
| `SKIP_MP_BAKE` | `1` = pomiń bake w `build:web:desktop` |

---

## HTTP API serwera

| Endpoint | Opis |
|----------|------|
| `GET /status` | Gracze online, mecze, bot gen |
| `GET /rooms` | Otwarte pokoje (bez gościa) |
| `GET /policy` | Globalny mózg botów (federacja — każdy relay) |
| `POST /policy/sync` | Merge wag botów (+ pull z innych relayów) |
| `GET /ranked/leaderboard` | Top ELO |
| `GET /ranked/player?clientId=` | Profil ranked |

WebSocket: protokół w `src/net/protocol.ts` (`createRoom`, `joinRoom`, `snapshot`, `reportMatch`, `rematch`).

---

## Ranked ELO

Plik: `data/ranked-elo.json` (auto-tworzony). Tylko **host** raportuje wynik; forfeit przy disconnect w trakcie meczu ranked.

---

## Dystrybucja binarek

- **GitHub Releases** — pełne buildy (win/deb/SteamDeck/src)
- **Codeberg** — kod źródłowy; LFS quota — binaria tylko GitHub

---

## Testy

```bash
npm test                              # vitest: WS flow + ranked HTTP
npm run test:e2e                      # autostart 1v1 offline
npm run test:e2e:online             # 2 klienty Playwright + mp:server
```
