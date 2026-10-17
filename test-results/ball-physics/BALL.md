# Ball Physics Audit

Wynik: **PASS**

| Case | Pass | Detail |
|------|------|--------|
| drop_bounce | ✓ | peakY=1.56 (want 1.45–2.05, CR=0.6) |
| soft_hit | ✓ | peakHoriz=2.97 first=2.97 vy=0.00 |
| flip_hit | ✓ | maxHoriz=12.78 flipped=false (want solid shot ≥10) |
| ground_roll | ✓ | horiz@2s=3.45 (want 2.8–6.5) |
| wall_bounce | ✓ | minX=31.21 vx=-4.04 |

Referencja: smish / RocketSim — CR≈0.6, Psyonix impulse, soft dribble, żywe bounce.
