# Ignite Editor (Asset Studio)

Uproszczony edytor w stylu Blendera — **duże czcionki**, 3 panele, viewport 3D.
Nie rzeźbi meshy: podpinasz tekstury/GLB do manifestu areny.

## Start

```bash
npm run assets:studio
```

Zostaw terminal otwarty. Otwórz:

- **http://127.0.0.1:5178**
- lub http://localhost:5178

Jeśli „nieosiągalna” — bez `assets:studio` nic nie nasłuchuje (`ss -ltn | grep 5178`).

## Jak używać (dla ludzi)

1. **Lewa** — wybierz arenę, potem „co zmieniasz” (murawa, ściana, bramka…)
2. **Środek** — obracaj widok (LPM), przesuwaj (PPM), zoom (kółko)
3. **Prawa** — wielki **UPUŚĆ TU** (albo wybierz plik)
4. W grze: hard-reload na 5173

## Czego nie robi

- Generacji Meshy/Trellis (CLI — [MESHY.md](MESHY.md))
- Edycji aut / UV / rzeźbienia
- Live hot-reload meczu

Kod: [`tools/asset-studio/`](../tools/asset-studio/).
