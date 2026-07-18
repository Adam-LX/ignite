# Ball Physics Audit

Wynik: **PASS**

| Case | Pass | Detail |
|------|------|--------|
| drop_bounce | ✓ | peakY=1.62 (want 1.55–2.4, CR≈0.6) |
| soft_hit | ✓ | peakHoriz=8.27 first=3.28 vy=0.00 |
| flip_hit | ✓ | maxHoriz=28.14 flipped=false (want solid shot ≥10) |
| ground_roll | ✓ | horiz@2s=3.13 (want 2.8–6.5) |
| wall_bounce | ✓ | minX=29.86 vx=-3.63 |

Referencja: smish / RocketSim — CR≈0.6, Psyonix impulse, soft dribble, żywe bounce.
