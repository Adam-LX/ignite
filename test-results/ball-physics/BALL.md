# Ball Physics Audit

Wynik: **PASS**

| Case | Pass | Detail |
|------|------|--------|
| drop_bounce | ✓ | peakY=1.91 (want 1.55–2.4, CR≈0.6) |
| soft_hit | ✓ | peakHoriz=2.95 first=2.95 vy=-0.00 |
| flip_hit | ✓ | maxHoriz=10.88 flipped=false (want solid shot ≥10) |
| ground_roll | ✓ | horiz@2s=3.34 (want 2.8–6.5) |
| wall_bounce | ✓ | minX=28.18 vx=-5.62 |

Referencja: smish / RocketSim — CR≈0.6, Psyonix impulse, soft dribble, żywe bounce.
