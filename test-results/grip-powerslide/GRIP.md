# Grip / Powerslide Audit

Wynik: **PASS**

| Case | Pass | Detail |
|------|------|--------|
| grip_no_shift | ✓ | halfLife=0.033s lat@0.5s=0.00 (want sticky <0.35s / <1.5) |
| powerslide_hold | ✓ | halfLife=0.633s lat@0.5s=5.86 (want slide >0.28s / >4.0) |
| powerslide_exit | ✓ | lat@1.5s=0.00 vs slide 2.02 (exit recovers grip) |
| constants | ✓ | lateral=10.2 drift=1.05 exit=0.12s |

fwdKeep grip=1.36 slide=1.16
