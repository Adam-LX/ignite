# Ignite obok streamu Nyx / Crypto TV (24/7)

Diagnoza i poprawki z 2026-10-17 (agent NixBot). Stream Nyx (Chromium scena na Xvfb `:2` → ffmpeg RTMP)
działa non-stop na tym samym GPU (16 GiB). Ignite **nie może** zabrać sceny ani strażnika.

## Dlaczego ikona Ignite „nic nie robiła” (17.10)

1. **Wiszący lock launchera** — `scripts/ignite-launch.sh` trzyma `~/.cache/ignite-launch.lock` na fd 9.
   Vite (setsid) i relay MP **dziedziczyły fd 9**. 10:42 `nix develop` dociągał paczki (~4 min) →
   launcher po 45 s: `FAIL: Vite nie wstał` i wyszedł, ale `npm run dev` dalej trzymał lock.
   Każde kolejne kliknięcie (11:09) wisiało w `flock 9` w nieskończoność („inny launcher już startuje Vite — czekam…”).
   **Fix:** dzieci startują z `9>&-`, lock zamykany (`exec 9>&-`) przed Electronem, czekanie na Vite 240 s
   (`IGNITE_VITE_WAIT_SEC`) + powiadomienie „przygotowuję środowisko”.
2. **Burza tuneli cloudflared** — równoległe `bake-mp-endpoint.sh --ensure` (launcher + `predev` + `vite.config.ts`)
   postawiły **90 quick tuneli** `cloudflared → :8765` (~2 GB RAM, 90 różnych URL-i). Ubite ręcznie.
   **Fix:** `flock data/mp-tunnel.lock` + w `--ensure` nie stawiaj nowego tunelu, gdy cloudflared → :8765 już żyje.
3. **VRAM** — przy streamie: Basal (basal-serve) ~10 GiB, scena + ffmpeg ~0,5–1 GiB, a `gemma4:e2b`
   (Ollama) ~1,8 GiB. Wolne: 0,4–0,6 GiB z gemmą, 1,3–2,2 GiB bez niej. nyx-guard (`NYX_VRAM_MIN_FREE_MIB=3200`)
   co ~40–70 s robi `ollama stop`, a **inj-stake-http (`~/.local/share/inj-stake-info/server.py`)**
   ładuje ją z powrotem (mowa Nyx v786: `_nyx_ai_call_ollama_e2b_draft` keep_alive 8m +
   `_nyx_ai_e2b_speech_judge` keep_alive 4m). Pętla unload/reload; nyx-guard **nie zabija Ignite**
   (scrub tylko obcych przeglądarek na `:2`, OOM-ofiary = Basal/llama-server).
   **Fix w launcherze:** `vram_preflight` — gdy wolne < `IGNITE_VRAM_NEED_MIB` (1800) + `IGNITE_VRAM_FLOOR_MIB` (600),
   najpierw `ollama stop` (wyłącz: `IGNITE_UNLOAD_OLLAMA=0`), a jak dalej mało → powiadomienie i **brak startu**
   (stream ma priorytet). Wymuszenie na własne ryzyko: `IGNITE_SKIP_VRAM_CHECK=1`.

Log startu: `~/.cache/ignite-launch.log` · log Vite: `.ignite-dev.log` · kopie skryptów sprzed zmian:
`backup/20261017-launcher-fix/`.

## Telebimy = stream Crypto TV

`src/visual/jumbotronFeed.ts`: domyślny feed `IGNITE_TV_DEFAULT_YT = "LDzslQh7rEQ"` (live @CryptoTVPL,
17.10: `isLiveNow`, `playableInEmbed`), embed `youtube-nocookie.com/embed/<id>` (mute, enablejsapi, origin).
Live → bez rewind i bez PA z yt-dlp (`jumbotronShouldAttachPa`). Działa w dev (origin `http://127.0.0.1:5173`)
i w paczce (Electron serwuje `dist/` z `http://127.0.0.1:<port>`, więc YouTube dostaje origin http).
**ID live zmienia się przy każdym nowym starcie transmisji** — wtedy podmień stałą albo
`?jumbotron=yt:VIDEO_ID` / `localStorage['ignite.jumbotron']='yt:VIDEO_ID'`. Bieżące ID: `/tmp/nyx-yt/live-video-id.txt`.

## Release

Licencjonowane auta (`public/assets/cars/_licensed_preview/`) **nie wchodzą** do paczek:
`package.json` → `build.files` ma `!dist/**/_licensed_preview/**`, a build release usuwa je z `dist/`.
