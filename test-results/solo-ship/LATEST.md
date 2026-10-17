# Solo ship gate (headless) — PASS

Log: `/home/adam/Dokumenty/Projekty/Ignite/test-results/solo-ship/gate-headless-20260914T141815Z.log`

| Check | Result |
|-------|--------|
| audit:ball | PASS |
| audit:physics | PASS |
| probe:aerial | PASS |
| tests ai + diagnostic | PASS |
| kickoff drive | PASS |
| train:bots:smoke | PASS |
| probe 1v1 (4×75s) | PASS |
| probe 2v2 (3×60s) | PASS |

### Probe 1v1

## Agregat

- Gole blue/orange: 0.25 / 0
- Ball touches: 9.25
- Kickoff first contact: 2.43 s
- Kickoff >4 s rate: 0%
- Avg boost fuel: 0.21
- Pad seeks / pickups: 11.5 / 7.75
- Recovery fail: 0%
- Whiffs: 0.75 · boost waste: 0.16 s
- Wall / ceiling sec (śr./auto): 4.8 / 1.24
- Goalie goal-zone share: — (striker 0.06)
- Goalie mid-chase rate: —
- Aerial sec/min (śr./auto): 1.05
- Ball peak Y (śr.): 17.5

### Probe 2v2

## Agregat

- Gole blue/orange: 0 / 0.33
- Ball touches: 24.67
- Kickoff first contact: 2.44 s
- Kickoff >4 s rate: 0%
- Avg boost fuel: 0.28
- Pad seeks / pickups: 46 / 19.67
- Recovery fail: 1%
- Whiffs: 3.67 · boost waste: 0.53 s
- Wall / ceiling sec (śr./auto): 5.71 / 0.26
- Goalie goal-zone share: — (striker 0.07)
- Goalie mid-chase rate: —
- Aerial sec/min (śr./auto): 1.83
- Ball peak Y (śr.): 16.51

## Wnioski

_Brak alertów — metryki w normie._

## Następny krok

Agent czyta ten plik + JSON i proponuje patche. Po akceptacji: re-probe `--matches 2`.

Bez zewnętrznych testerów: ten gate + F9 klipy. Pełny gate z kamerą: `npm run ship:solo`.
