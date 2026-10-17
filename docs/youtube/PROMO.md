# Ignite — automatyczne promo (Electron + screencast)

Gotowe narzędzia w `scripts/` — **nie pisz nowego capture**, użyj tych.

## Wymagania

1. **Vite** na `:5173` (`npm run dev` / `./run.sh`)
2. **Audio Exile:** `/tmp/ignite-exile/exile.mp3`  
   (jeśli brak — sprawdź wcześniejsze promo / skopiuj beat pod tę ścieżkę)
3. **Playwright** + **Electron** przez `nix shell nixpkgs#electron` (skrypt odpala sam)
4. Wyjście: `~/Wideo/` (+ symlinki `ignite-promo-LATEST.mp4`, `IPV.mp4`)

## Który skrypt

| Skrypt | Styl | Długość (domyślnie) | Kiedy |
|--------|------|---------------------|--------|
| `scripts/capture-promo-ben-style.mjs` | Jak [Play Video #1](https://www.youtube.com/watch?v=ZXs8oWOVYmQ) — menu → mecz, logo, letterbox, aerial/gol/Tab/pause | ~175 s | **Główne promo / IPV** |
| `scripts/capture-promo-exile-beat.mjs` | Boot + spin kart + loading + spektakl + COMING SOON | ~200 s | Dłuższy cut z naciskiem na menu |
| `scripts/capturePromoStill.mjs` | Jedna klatka PNG (Chromium) | — | Thumb / keyart |

**Preferuj `ben-style`** na upload.

Aktualna choreografia (v2):
- **Menu:** szybkie spotlight kart → Friends (fab + tab Party) → Garage flash → LAB peek → PLAY → **1v1**
- **Mecz:** cold aerial → wall ride → bump → flip train → Tab → rain bumper → ceiling pinch → hero orbit → goal-line clear → slap shot → kickoff freeze  
  (nie stary układ kickoff→pass→aerial→rain→pause)

## Uruchomienie (Ben style)

```bash
cd ~/Dokumenty/Projekty/Ignite

# terminal 1
npm run dev

# terminal 2 — pełny cut ~3 min
IGNITE_PROMO_SEC=175 node scripts/capture-promo-ben-style.mjs
```

Skrócony test (np. smoke):

```bash
IGNITE_PROMO_SEC=60 IGNITE_BOOT_WAIT_MS=4000 node scripts/capture-promo-ben-style.mjs
```

Exile-beat:

```bash
IGNITE_PROMO_SEC=200 node scripts/capture-promo-exile-beat.mjs
```

Still:

```bash
node scripts/capturePromoStill.mjs 'http://127.0.0.1:5173/?graphics=high' ~/Wideo/ignite-promo-still.png
```

## Zmienne środowiskowe

| Env | Domyślnie | Opis |
|-----|-----------|------|
| `IGNITE_PROMO_SEC` | ~175 / ~200 | Długość choreografii (s) |
| `IGNITE_PROMO_BPM` | `113` | BPM Exile (takty) |
| `IGNITE_PROMO_AUDIO` | `/tmp/ignite-exile/exile.mp3` | Ścieżka do muzyki |
| `IGNITE_PROMO_AUDIO_OFFSET` | `0` | Start audio (s) |
| `IGNITE_BOOT_WAIT_MS` | `5000` / `8000` | Czekanie przed screencastem |
| `IGNITE_CDP_PORT` | `9241` / `9236` | Port CDP Electron |
| `IGNITE_PROMO_ENC_DUR` | auto | Nadpisanie długości enkodera |

## Output

Po sukcesie:

- `~/Wideo/ignite-promo-benstyle-<stamp>.mp4` (lub `ignite-promo-exile-v8-<stamp>.mp4`)
- Symlinki: `~/Wideo/ignite-promo-LATEST.mp4`, `~/Wideo/IPV.mp4`
- Kopia dla Bena (VPN share): `~/.local/share/ben-vpn-share/IPV.mp4`

## Update / „what's new” (YouTube #3)

1. Odpal **ben-style** na aktualnym `master` / release branch (widać nowe menu, mecze, UI).
2. Opcjonalnie wytnij 60–90 s w CapCut/DaVinci (menu dock + 1–2 ujęcia meczu + end card).
3. Tytuł / opis: szablon w [VIDEOS.md](./VIDEOS.md) §3 — podbij wersję (`v0.3.37`).
4. Thumb: still z `capturePromoStill.mjs` albo klatka z `ffmpeg -ss … -i LATEST …`.

Ręczny trailer (OBS): [TRAILER.md](./TRAILER.md).
