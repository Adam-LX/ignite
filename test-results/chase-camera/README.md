# Chase camera audit

Automatyczna diagnoza „orbita menu zamiast chase” (YOU na środku, auto z boku, trawa z góry).

## Uruchomienie

```bash
# Vite (Playwright + system Chromium)
npm run audit:chase          # ?autostart=1v1
npm run audit:chase:menu     # menu → Start

# Electron (CDP) — wymaga Vite na :5173
bash scripts/audit-chase-electron.sh

# Pętla FAIL→hinty (dla agenta)
npm run audit:chase:loop
```

Wyniki: `test-results/chase-camera/LATEST.json`, `LATEST.md`, PNG.

## Kryteria PASS

- `dist(cam, car) ≤ 10`
- NDC auta w strefie chase (`|x|≤0.4`, `y∈[-0.85,0.15]`)
- piksel na projekcji auta **nie** jest trawą (dark = auto)
- WebGL source **nie** ma `display:none` (zamraża bufor w Electron)
- `body.in-match`, bez menu/garage presentation

## Znana przyczyna (Electron + Wayland)

`BrowserWindow({ fullscreen: true })` → WebGL pokazuje stary kadr mimo poprawnego `threeJSCamera`.
**Fix:** domyślnie `maximize()` zamiast exclusive fullscreen (`IGNITE_FULLSCREEN=1` wymusza FS).

## Scope napraw

Tylko kamera / prezentacja canvas — **bez** zmian materiałów, IBL, post-FX look.
