# Agenci — Ignite

Krótki indeks dla Cursor / NixBot / innych asystentów.

## Prematch & kickoff (aktywny fokus)

| Doc | Po co |
|-----|--------|
| [`docs/PREMATCH_SHOW.md`](docs/PREMATCH_SHOW.md) | Hub: look, choreografia, GPU warm, audio, preferencje |
| [`docs/PREMATCH_KICKOFF_FREEZE.md`](docs/PREMATCH_KICKOFF_FREEZE.md) | Hitch/freeze diagnosis + probe |
| [`docs/DEV-LOOP.md`](docs/DEV-LOOP.md) | Codzienny feel loop (F9, RL reference) |

Cursor rules: `.cursor/rules/ignite-prematch-show.mdc`, `ignite-prematch-freeze.mdc`, `ignite-rl-reference.mdc`.

## Start obok streamu Nyx (24/7) — czytaj zanim ruszysz launcher

[`docs/LAUNCH-WITH-STREAM.md`](docs/LAUNCH-WITH-STREAM.md): lock launchera (fd 9), burza tuneli cloudflared,
VRAM preflight (`IGNITE_VRAM_NEED_MIB`, `IGNITE_SKIP_VRAM_CHECK`), telebimy = live Crypto TV.
Nie dotykaj nyx-guard / ffmpeg / Xvfb `:2` / basal-serve. Licencjonowane auta nie idą do release.

## Preferencja: lokalnie vs cloud

- **Prematch / stadium show / hitch show** → lokalnie (NixBot), nie cloud PR, o ile Adam nie każe inaczej.
- Silnik feel / physics / garage — cloud OK gdy poproszone.

## Diagnostyka hitch

```text
?hitchProbe=1   → logi + window.__ignitePrematchHitch
?skipShow=1     → A/B bez show
?showSec=8      → krótki show
scripts/_hitch-probe-capture.mjs
```

## Muzyka

Nie commitować ripów z YouTube/DJ setów. Oryginały + `public/assets/audio/music/*.provenance.json`.

- Kickoff odliczanie **max punch** (shake/rays/boom/winieta) + naprzemienne napisy slide L/R (IGNITE→ARENA→READY→SET→FIRE→GO), fill jak loading — `docs/PREMATCH_SHOW.md` § Kickoff.
Prematch audio: bed `prematch_heaven_bed.mp3` + **`playStadiumShowChoir`** (Hardwell-style choir stabs, nie Heaven vocal) — `docs/PREMATCH_SHOW.md` § Audio.
