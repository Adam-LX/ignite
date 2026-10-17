# Solo ship — brak zewnętrznych testerów

Gdy **Pan Kamil** / playtesterzy odpadają, **nie blokuj** demo dla znajomych na „czekam na feedback”.

## Źródło prawdy (kolejność)

1. **`npm run ship:solo`** — feel + chase (+ survey `--soft-pixels`) + physics + kickoff + probe 1v1 + relay smoke + endurance (~90 s headless).
2. **Twoje F9** — jeśli coś wygląda źle, jedna zmiana kamery/fizyki → ponowny gate. Bez „ultra” na ślepo.
3. Gdy Pan Kamil wróci — jego klipy Ball/Free Cam mają wagę (jak zawsze); do tego czasu nie czekaj.

## Definition of done (demo / znajomi)

| Gate | Komenda / artefakt |
|------|-------------------|
| Feel / kamera | `ship:solo` (chase + survey PASS) |
| Bot nie-roślina | `probe:matches` bez `zero_scoring` |
| Stabilność sesji | endurance: brak crash / black-bar / top-down |
| Online | `test:e2e:public-relay:smoke` |
| Paczka | `npm run build:demo` → `release/ignite-demo-web.zip` + tip jar w README |

Opcjonalnie (Ty, 15–20 min): 2× 1v1 vs bot. Subiektywne — nie blokuje zipa gdy gate zielony.

## Headless notes

- Survey: `--soft-pixels` (SwiftShader często „grass” na aucie mimo OK `ndc`/`dist`).
- `audit:wall-ceiling`: znane wyjątki w `docs/WALL_CEILING.md` — informacyjnie.

## Poza scope

Nie dokładaj contentu (`CONTENT-FREEZE`). Tip jar OK. Bez Kickstarter.
