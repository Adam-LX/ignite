# Ignite → Steam (bramki operacyjne + oś komercyjna)

**Teza:** RL nie ma na Steamie → dziura gatunku. Cel: **dobra gra** (Very Positive), nie vanity hit.

*(Szczegółowy plan faz S0–S8 trzymany lokalnie poza gitem — ten plik = publiczna checklista.)*

## Oś (agresywna)

| Faza | Cel | ~tygodnie |
|------|-----|-----------|
| **S0** | Stab + feel lock | 0–3 |
| **S1** | Core 1v1/2v2 + boty | 2–7 |
| **S2** | Online friend path (bots opt-in) | 3–8 |
| **S3** | Hak store (Rush) + fantasy | 4–10 |
| **S4** | AppID, podpis, depot, Deck | 6–12 |
| **S5** | Content floor + **demo** | 8–14 |
| **S6** | Coming Soon ≥ 4 tyg | 12–16 |
| **S7** | Launch Win+Linux | 16–18 |
| **S8** | Hotfix 30 dni + 1 drop | +4 |

**Zasady:** Feel > content > spectacle. Core świetny sam. Gym/replay/Meridian **po** Launch. Cena **$7.99–$9.99**.

## Bramki

| Brama | Faza | Status |
|-------|------|--------|
| Feel 8/10 + playtester ≥7/10 | S0–S1 | ☐ |
| P0 stabilność (freeze, pasy, crash) = 0 | S0 | 🔄 prime VFX + countdown hold + FS boot |
| Online 1v1/2v2 friend path ≤ 2 min, bots opt-in | S2 | 🔄 |
| Store page + trailer draft | S3–S4 | 🔄 pitch draft: [`STORE-PITCH.md`](STORE-PITCH.md) |
| AppID + internal Steam build | S4 | ☐ · stub `steam/steam_appid.txt` (480) |
| Demo build flag | S5 | ☐ |
| Code signing Win | S4 | ☐ · [`CODE-SIGNING.md`](CODE-SIGNING.md) — **kup cert (lead time)** |
| Coming Soon ≥ 4 tyg przed Release | S6 | ☐ |
| Review build P0=0 | S6 | ☐ |
| Launch Win+Linux (+ Deck path) | S7 | ☐ |

## Kryterium „kliknij Release”

- [ ] Feel ≥ 8/10 + P0 stab = 0 + online friend path
- [ ] Coming Soon live ≥ 4 tygodnie
- [ ] Demo na stronie ALBO zaplanowany free weekend T+7
- [ ] Trailer final + capsules zaakceptowane
- [ ] Hotfix channel gotowy (48 h)

## Cena

**$7.99–$9.99** start. Nie $19.99.

## Czego nie robić przed Coming Soon

- Nowe tryby „dla objętości”
- Training Gym / replay share jako blocker
- Meridian / battle pass / sezon
- Refactor fizyki bez regresji audytów

## Taski inżynierskie Steam (S4+)

1. Partner account + AppID ← **Adam (Valve lead time)**
2. `steam/steam_appid.txt` (dev stub 480) + `scripts/steam-upload-depot.sh`
3. Steamworks overlay / 5–10 achievements (po AppID)
4. `scripts/build-steamdeck.sh` w checklist release
5. Demo: build flag + `modePolicy` limited playlist
6. Store pitch draft: [`STORE-PITCH.md`](STORE-PITCH.md)

## Komercja (oczekiwania)

Coming Soon = wishlist, nie cash.  
Sukces = **Very Positive + „dobra gra”**, nie vanity wishlist.  
Hit = bonus; nie plan finansowy.
