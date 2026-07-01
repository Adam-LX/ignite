# Muzyka meczowa Ignite

## Aktywna tracklista (rotacja w meczu)

| # | Plik | Preset | Inspiracja |
|---|------|--------|------------|
| 1 | `music/match_msx.mp3` | `prodigy_vocal`, seed 42 | Prodigy / Ignite (EN, aktywny od początku) |
| 2 | `music/match_ignite_infinite.mp3` | `ignite_infinite_grid`, seed 101 | chiptune × synthwave (Lukhash vibe) |
| 3 | `music/match_ignite_chrome.mp3` | `ignite_chrome_overdrive`, seed 202 | Moroder chrome racing |
| 4 | `music/match_ignite_apex.mp3` | `ignite_apex_rush`, seed 303 | big beat / Apollo 440 vibe |
| 5 | `music/match_ignite_hiphop.mp3` | `ignite_hip_hop_slipstream`, seed 404 | dynamic hip hop / trap racing |

Rotacja: `AudioManifest.ts` → `MATCH_MUSIC_TRACKS`, odtwarzanie w `GameAudio.ts` (kolejny utwór po zakończeniu).

**Skróty w grze:** `[` poprzedni · `]` następny · `M` wycisz

### Alternatywy (poza rotacją)

| Plik | Uwagi |
|------|--------|
| `music/match_vocal_prodigy_pl.mp3` | preset `prodigy_vocal_pl`, seed 42 |
| ~~Extended~~ | `match_extended.mp3` — z chiptune, **nie używamy** |

Workflow: [`scripts/music/WORKFLOW.md`](../../scripts/music/WORKFLOW.md)

### Regeneracja EN (match_msx)

```bash
flyball-music ace-step up
npm run music:vocal:en
```

### Generacja nowej tracklisty Ignite

```bash
flyball-music ace-step up
flyball-music ace-step health   # poczekaj aż OK
npm run music:ignite:all        # lub pojedynczo: music:ignite:infinite / chrome / apex / hiphop
```

Presety: `scripts/music/styles/ignite_*.yaml` — oryginalne teksty/prompty, nie kopie YT.

### Regeneracja PL

```bash
flyball-music ace-step up
flyball-music vocal --style prodigy_vocal_pl --duration 90 --seed 42 \
  --out public/assets/audio/music/match_vocal_prodigy_pl.mp3
```

---

## Studio (poza grą)

```bash
flyball-music studio    # http://127.0.0.1:8799
```

---

## Licencja

ACE-Step 1.5 — **MIT**, komercja OK. Oryginalny tekst (PL/EN) w presetach — nie kopia YT.
