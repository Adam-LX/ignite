# Code signing (Windows / Linux) — przygotowanie pod Steam / SmartScreen

Bez podpisu Windows: **SmartScreen** straszy „nieznany wydawca” → ogromny drop konwersji, nawet przy darmowym downloadzie.

## Windows (EV lub OV code signing)

1. Kup certyfikat **Code Signing** (np. DigiCert, Sectigo, SSL.com) na firmę / jednoosobową działalność.
2. Zainstaluj cert w store albo użyj tokena USB (EV często wymaga hardware).
3. Przy `electron-builder --win`:

```bash
export CSC_LINK=/path/to/cert.p12          # lub CSC_LINK=base64...
export CSC_KEY_PASSWORD='...'
# opcjonalnie timestamp:
# export CSC_TIMESTAMP_SERVER=http://timestamp.digicert.com
npm run build:win
```

4. Weryfikacja:

```bash
# na Windows:
signtool verify /pa /v Ignite-*.exe
```

**Steam:** Valve i tak podpisuje/pakuje depoty inaczej; podpis lokalnego `.exe`/zip nadal pomaga poza Steamem (GH Releases) i buduje zaufanie.

## Linux

- `.deb` / AppImage: podpis GPG paczki (opcjonalnie) + checksumy SHA256 w `DOWNLOADS.md`.
- Steam Deck / Proton: ważniejsza jest **kompatybilność** niż podpis Win.

## Co zrobić teraz (bez certu)

- [ ] Założyć / mieć dane firmy pod OV/EV (adres, KRS/NIP jeśli PL)
- [ ] **Kupić cert teraz (lead time S4)** — ~$70–400/rok OV; EV drożej · nie czekaj na „idealny build”
- [ ] Trzymać sekrety poza git (`CSC_*` tylko w CI secrets / lokalnym env)
- [ ] Nie publikować niepodpisanego builda jako „Steam-ready”

**Akcja Adam (S4 lead-time):** zamów Code Signing OV + Steam Direct fee równolegle do S0 QA.

## CI (później)

GitHub Actions / lokalny runner:

```yaml
env:
  CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
  CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

Dopiero gdy sekrety są ustawione — odhacz `ROADMAP.md` → „Podpis Win/Linux”.
