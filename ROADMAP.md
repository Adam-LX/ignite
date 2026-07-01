# Ignite — roadmap

Stan: **v0.0.6** · MP ranked · rematch · HUD · replay online · E2E online.

---

## Faza 0–9 — DONE

Kickoff, desktop, testy, publish 0.0.5, MP lobby + relay, ranked ELO, boty, E2E autostart 1v1.

---

## Faza 10 — Stabilizacja (P0) → v0.0.6

- [ ] Commit + tag `v0.0.6`
- [ ] Build win/deb/SteamDeck + GitHub Releases
- [x] HUD meczu (skosy, scoreboard glass)
- [x] Arena lighting (hemisphere, mgła, puls jupiterów)
- [x] Wersja `0.0.6` w package.json

## Faza 11 — Online produkt (P1) — **DONE**

- [x] Ranked forfeit przy disconnect
- [x] Rematch online (R + przycisk HUD)
- [x] Testy WS: join, forfeit, rematch, HTTP `/ranked/*`
- [x] E2E Playwright: 2 klienty (`npm run test:e2e:online`)
- [x] Dokumentacja hostowania relay (`docs/MP_RELAY.md`)

## Faza 12 — Fizyka / feel (P1)

- [x] Replay online (host snapshoty + kamera gościa)
- [ ] Dalszy balans piłki + regresja botów

## Faza 13+ — 2v2 lokalne · estetyka lobby · Codeberg LFS docs

---

**Zasada:** jedna faza = jeden commit logiczny. Testy po każdej zmianie fizyki.
