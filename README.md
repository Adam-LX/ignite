# Ignite

Browserowa gra car soccer — sforkowana baza z [Wocket-Weague](https://github.com/Aebel-Shajan/Wocket-Weague) (MIT).

**Stack:** TypeScript · Vite · Three.js · Rapier3D

> Inspireacja: car soccer w przeglądarce. **Ignite nie jest powiązane z Epic Games, Psyonix ani Rocket League®.**

## Credits w grze

Klawisz **C** lub przycisk **©** w lewym dolnym rogu — pełna lista licencji audio i kodu.

## Sterowanie

| Klawisz | Akcja |
|---------|-------|
| W / S | Przód / tył |
| A / D | Skręt |
| Q / E | Roll w powietrzu |
| Spacja | Skok |
| Shift | Drift |

## Uruchomienie

```bash
cd Ignite   # katalog repozytorium
nix develop   # opcjonalnie — node 22 w shellu
npm install
npm run dev   # http://localhost:5173
```

Build produkcyjny: `npm run build` → `dist/`

## Multiplayer (online 1v1)

Host tworzy pokój, gość dołącza kodem. Symulacja działa u hosta; serwer pokojów tylko łączy graczy i przekazuje wejścia/snapshoty.

**Terminal 1 — serwer pokojów:**

```bash
npm run mp:server   # ws://localhost:8765
```

**Terminal 2 — gra:**

```bash
npm run dev
```

W menu: **Online 1v1** → Host (utwórz pokój) lub Dołącz (kod + adres hosta). W LAN gość wpisuje IP hosta, np. `192.168.1.10:8765`.

**Publiczny relay (Cloudflare):** [`docs/MP_RELAY.md`](docs/MP_RELAY.md) — bake endpoint, named tunnel, daemon.

Ograniczenia MVP: tylko 1v1, bez matchmakingu publicznego, wymagany dostęp do IP hosta (LAN / port-forward / relay).

## Globalne uczenie botów (federacja)

Mózg botów synchronizuje się **między relayami** — nie musisz grać na tym samym serwerze co ktoś inny.

1. **Pobieranie** — klient scala mózg z wielu źródeł równolegle:
   - `public/policy-relays.json` (lista publicznych relayów)
   - `public/mp-endpoint.json` (ostatni tunel z bake)
   - lokalny `hostname:8765` + seed `/assets/ai/bot-policy.json`
   - opcjonalnie env: `VITE_IGNITE_POLICY_FETCH_URLS`, `VITE_IGNITE_POLICY_CANONICAL_URL`

2. **Wysyłanie** — po golu/meczu klient **POST** na **wszystkie** relaye z listy (`sync`), nie tylko lokalny.

3. **Serwer pokojów** — przed merge robi `pull` z relayów; po meczu **wypycha na GitHub** (jeśli `GITHUB_TOKEN` w env).

### GitHub jako wspólna baza (odczyt dla wszystkich)

Plik na gałęzi **`bot-brain`** w repo release:

`https://raw.githubusercontent.com/Adam-LX/ignite-releases/bot-brain/global-bot-policy.json`

Każdy klient **pobiera** ten URL (w `policy-relays.json`). **Zapis** tylko z serwera/skryptu — token nigdy w przeglądarce.

**Pierwszy upload ręcznie:**

```bash
npm run mp:server          # kilka meczów vs boty
npm run publish:bot-policy # gh → gałąź bot-brain
```

**Auto-upload z serwera MP** (relay 24/7):

```bash
export GITHUB_TOKEN=ghp_...   # fine-grained: repo contents write
npm run mp:server
# po każdym syncu meczu → push na GitHub (max 1× / 90 s)
```

Inne repo/gałąź:

```bash
export IGNITE_BOT_POLICY_GITHUB_REPO=Adam-LX/moje-repo
export IGNITE_BOT_POLICY_GITHUB_BRANCH=bot-brain
npm run publish:bot-policy
```

Endpointy HTTP (na każdym relayu):

- `GET /policy` — pobierz mózg
- `POST /policy/sync` — wgraj wynik meczu/gola

Plik na dysku relay: `data/global-bot-policy.json`.

**Menu:** `F12 · 5.2` = federacja (≥2 relaye), `G` = jeden globalny, `L` = offline/cache.

Dodaj własny relay do listy (np. stały VPS):

```bash
# w public/policy-relays.json — bake-mp-endpoint.sh dopisuje automatycznie
# albo env przy buildzie:
VITE_IGNITE_POLICY_SYNC_URLS=https://twoj-relay.pl/policy/sync
VITE_IGNITE_POLICY_FETCH_URLS=https://twoj-relay.pl/policy
```

Trening offline (szybszy start mózgu):

```bash
npm run train:bots
npm run mp:server   # załaduje nowy seed przy pierwszym syncu
./scripts/bake-mp-endpoint.sh   # dopisze relay do policy-relays.json
```

## Muzyka meczowa

**Aktywny utwór:** `match_msx.mp3` (ACE-Step, MIT, seed 42) — patrz [`public/assets/audio/MUSIC.md`](public/assets/audio/MUSIC.md).

Regeneracja:

```bash
flyball-music ace-step up
npm run music:vocal
```

Licencje: [`public/assets/audio/LICENSE.md`](public/assets/audio/LICENSE.md)

## Publikacja (Codeberg)

**Repo:** [codeberg.org/Adam-LX/ignite](https://codeberg.org/Adam-LX/ignite) — kod gry + buildy w jednym monorepo (`origin`).

| Co | Gdzie |
|----|-------|
| Kod | `main` na Codeberg |
| Binaria (zip, deb, źródła) | `releases/` + tagi `v*-*` — tabela w [DOWNLOADS.md](DOWNLOADS.md) |
| Muzyka match (LFS) | `audio/` |

### Ręcznie (build lokalny)

```bash
nix develop -c ./scripts/publish-codeberg.sh all
# albo: win | linux | source
```

Skrypt: build → audyt prywatności → commit `releases/` + `DOWNLOADS.md` → push + tagi LFS.

### Automatycznie (CI)

**Push na `main`** (zmiany w kodzie) → Forgejo Actions → build → publikacja w tym samym repo.

Jednorazowa konfiguracja (token API z [ustawień Codeberg](https://codeberg.org/user/settings/applications)):

```bash
CODEBERG_TOKEN=<token> ./scripts/setup-codeberg-ci.sh
```

To włącza Actions i ustawia secret `CODEBERG_DEPLOY_KEY`. Workflow: `.forgejo/workflows/release.yml`.

Bez tokenu: w UI repo włącz **Units → Actions** i dodaj secret `CODEBERG_DEPLOY_KEY` (zawartość `~/.ssh/id_ed25519`).

```bash
git push origin main   # nie pierwszy push — repo już istnieje; scala historię z buildami
```

## Licencja

MIT — oryginalny projekt: [Aebel-Shajan/Wocket-Weague](https://github.com/Aebel-Shajan/Wocket-Weague)
