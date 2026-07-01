# Zewnętrzne zależności — Ignite

## Repo

| | |
|---|---|
| **Hosting** | [Codeberg — Adam-LX/ignite](https://codeberg.org/Adam-LX/ignite) |
| **Widoczność** | Publiczne (`private: false`) |
| **Runtime gry** | Brak — gra nie łączy się z Codeberg po instalacji |

Pobieranie buildów (`.deb`, `.zip`, źródła) wymaga dostępności Codeberg tylko w momencie instalacji.

## Runtime (przeglądarka / Electron)

Po buildzie **nie ma żadnych żądań HTTP do zewnętrznych usług**. Wszystko jest w bundlu `dist/`.

| Zasób | Źródło | Licencja | Uwagi |
|-------|--------|----------|-------|
| Orbitron (UI, logo boiska) | `src/assets/fonts/Orbitron-Variable.ttf` | [SIL OFL 1.1](src/assets/fonts/Orbitron-OFL.txt) | Komercja OK; wcześniej Google Fonts CDN — usunięte |
| Rapier3D WASM | npm `@dimforge/rapier3d-compat` | Apache-2.0 | W bundlu Vite |
| Three.js | npm `three` | MIT | W bundlu Vite |
| Audio SFX / muzyka | `public/assets/audio/` | CC0 / MIT / patrz LICENSE | Offline w paczce |
| Tekstury / modele | `public/assets/` | Własne / patrz repo | Offline w paczce |

## Build-time (nie trafia do gry)

| Narzędzie | Po co |
|-----------|-------|
| Node.js + npm | `npm install`, `vite`, `tsc` |
| Nix (`flake.nix`) | Opcjonalny dev shell |
| Codeberg | Publikacja release (LFS: zip, deb, tar.zst) |

## Usunięte zależności sieciowe

- ~~`fonts.googleapis.com` / `fonts.gstatic.com`~~ — zastąpione lokalnym fontem Orbitron (OFL).
