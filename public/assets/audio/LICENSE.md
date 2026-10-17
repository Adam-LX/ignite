# Audio licenses — Ignite

Silnik (`engine_low.wav`, `engine_high.wav`) **bez zmian** — BigSoundBank / OpenGameArt CC0.

## SFX (2026-09 premium pack)

Źródła: **[Mixkit](https://mixkit.co/license/#sfxFree)** — Free Sound Effects License  
(royalty-free, commercial + personal OK, bez wymogu atrybucji; nie wolno redystrybuować assetów samych w sobie jako biblioteki).

| Plik w grze | Mixkit ID / źródło | Rola |
|-------------|-------------------|------|
| `countdown_1..5.ogg`, `countdown_tick.ogg` | #919 Start match countdown (cięcia + pitch) | Kickoff 5→1 |
| `countdown_go.ogg`, `kickoff.ogg` | #615 Basketball buzzer + #718 Car double horn | GO |
| `goal_blue.ogg`, `goal_orange.ogg`, `goal_crowd.ogg` | #432 / #368 / #461 crowd | Gol + tłum |
| `demolish.ogg`, `demolish_impact.ogg` | #1690 / #2198 | Demolka |
| `boost_loop.ogg`, `supersonic.ogg`, `boost_pad.ogg` | #1486 / #2183 | Boost (silnik nietknięty) |
| `impact_car_ball_*.ogg` | #522 / #363 / #2075 | Uderzenia piłki |
| `whoosh_short.ogg` | #1492 | Whoosh |

Starsze impacty murawy/ściany: Kenney CC0 + BigSoundBank CC0 (patrz `scripts/prepare_realistic_sfx.sh`).

Regeneracja: `FORCE_SFX=1 bash scripts/prepare_premium_sfx.sh`

## Muzyka

Patrz `MUSIC.md` / provenance ACE-Step w katalogu `music/`.

### Prematch

`music/prematch_heaven_bed.mp3` — oryginalny procedural synth (numpy) + LAME; mood reference Hardwell/Heaven **bez** ripu. Patrz `*.provenance.json`.
