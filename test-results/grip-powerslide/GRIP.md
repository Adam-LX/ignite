# Grip / Powerslide Audit

Wynik: **PASS**

| Case | Pass | Detail |
|------|------|--------|
| grip_no_shift | ✓ | halfLife=0.017s lat@0.5s=0.00 (want sticky <0.35s / <1.5) |
| powerslide_hold | ✓ | halfLife=0.433s lat@0.5s=4.54 (want slide >0.28s / >4.0) |
| powerslide_exit | ✓ | lat@1.5s=0.00 vs slide 0.93 (exit recovers grip) |
| constants | ✓ | lateral=14.5 drift=1.55 exit=0.14s |

fwdKeep grip=1.42 slide=1.18
