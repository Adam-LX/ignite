# Ignite — Content Freeze (AAA Core floor)

**Status:** locked for Core completeness · 2026-07-19  
**Steam publish:** later (not a blocker for product quality).

## Launch floor (minimum)

| Slot | Minimum | Current |
|------|---------|---------|
| Cars | 6 distinct | 8+ in `data/content/cars.design.json` |
| Arenas | 3 character maps | standard / compact / wide / vault |
| Core modes | 1v1, 2v2 | ✅ |
| Experimental hak | 1 (Ignition Rush) | ✅ `ignitionRush2v2` |
| Bots | Easy / Normal / Hard | via learning tuning |
| Languages | PL + EN | ✅ |

## Demo build (engineering ready, publish later)

```bash
VITE_IGNITE_DEMO=1 npm run dev
# or ?demo=1 / localStorage ignite.demo=1
```

Limits (`src/game/demoBuild.ts`):
- Modes: `1v1` only
- Cars: octane, muscle
- Arena: standard
- Match cap: 10 minutes

## Do not add before Coming Soon

- New modes “for volume”
- Training Gym / replay share as blockers
- Meridian / battle pass / seasons
- Extra cars beyond polish of the 6–8 floor

## Exit

First 15 minutes with 3 non-dev players without hand-holding.
