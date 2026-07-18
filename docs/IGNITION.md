# Ignite — tryby Ignition

> **Playlista:** tryby Ignition (`ignition1v1`, `ignition`) są w sekcji **Experimental** menu — obok Ignition Rush. Core Soccar (1v1–4v4) nie ma power-upów. Pełna architektura: [`MODE-PLAYLISTS.md`](MODE-PLAYLISTS.md).

## Dwa tryby

| Tryb | ID | Cel |
|------|-----|-----|
| **Ignition Test** | `ignition1v1` | Piaskownica: ty + 1 bot, test power-upów przed wdrożeniem |
| **Ignition** | `ignition` | Produkcyjny FFA 8 aut z pełnymi power-upami |

**Zasada workflow:** nowe power-upy i zmiany balansu najpierw w **Ignition Test**, po weryfikacji — w **Ignition**.

## Zasady power-upów (oba tryby)

Wzorowane na Rocket League Rumble ([Magnetizer](https://rocketleague.fandom.com/wiki/Rumble)):

- **Indywidualne losowanie** — każdy slot ma własny timer ~10 s; power-up nie jest współdzielony między graczami.
- **Jeden power-up na gracza** — trzymasz do użycia (klawisz **R**); po zużyciu timer startuje od nowa.
- **Efekt świata tylko po aktywacji** — inni gracze nie widzą wiązki magnesu, dopóki sami nie użyją swojego power-upu.
- **Magnetizer** — przyciąga piłkę do auta; siła rośnie im bliżej piłki; słabszy przy bardzo szybkiej piłce.

### Ignition Test (`ignition1v1`)

- Ty i bot — oboje macie własne losowanie power-upów.
- Bot **aktywuje** power-upy (`botsUsePowerUps: true`) — test rywalizacji 1v1 przed pełnym Ignition.
- Służy do testów mechaniki, VFX i zachowania botów przed release w `ignition`.

### Ignition (`ignition`)

- Wszyscy gracze (8 slotów) mają własne losowanie.
- Boty mogą aktywować power-upy (`botsUsePowerUps: true`).
- Wiele aktywnych magnesów sumuje przyciąganie (jak w RL).

## Pliki

- `src/modes/IgnitionManager.ts` — logika timerów, aktywacja, fizyka magnesu
- `src/visual/vfx/powerUpCarVfx.ts` — wiązki / kolce w świecie
- `src/visual/powerUpVisuals.ts` — kolory HUD
- `src/game/GameSession.ts` — konfiguracja trybu przy starcie meczu
