# Wall Detail Audit

Wynik: **PASS** (0 fail, 1 warn)

wallFaceX=43.20 expectedHover=0.520 RAMP_TOP=3.25

| Check | Sev | Detail |
|-------|-----|--------|
| grass_clearance | ✓ ok | centerY=0.282 expected~0.52 ny=1.000 wheels=4 |
| wall_clearance | ✓ ok | avgGap=0.201 min=0.179 max=0.347 target~0.22 floatF=0 digF=0 |
| wall_attitude | ✓ ok | upDotMin=0.984 wallFrames=120/120 |
| wall_stick_sep | ✓ ok | maxSep=3.486 maxGapJerk=0.0478 |
| entry_speed_retain | ! warn | contactSpd=22.8 minSpd=1.8 maxY=38.9 bump=0.204 |
| entry_align | ✓ ok | upDotMin=0.932 lostWheelFrames=0 gapAtWall=1.029 |
| descent | ✓ ok | minY=1.56 stuckFrames=0 upDotMin=0.981 |
| wall_jump | ✓ ok | maxSep=1.172 leftWall=true |
| ceiling_approach | ✓ ok | maxY=39.32 arenaH=40 bounceEvents=0 sep=1.63 |
| corner_hold | ✓ ok | onWall=100/100 upDotMin=0.968 flipF=0 sep=2.63 maxZ=59.1 |
| coast_detach | ✓ ok | leftWall=true maxSep=7.56 minGap=0.18 |
