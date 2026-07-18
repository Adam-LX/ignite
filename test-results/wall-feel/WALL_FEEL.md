# Wall Ride Feel Probe

Wynik: **PASS**

| Case | Pass | Detail |
|------|------|--------|
| entry_smooth | ✓ | maxYJump=0.204 firstWallY=0.30 maxY=38.90 entrySep=4.80 |
| wall_climb_hold | ✓ | wallFrames=90/90 climbMaxY=37.46 avg|vn|=0.112 |
| wall_jump_detach | ✓ | maxSep=1.336 leftWall=true glued=false preOnWall=true wheels=4 upDotNmin=0.47 |
| wall_jump_repeat | ✓ | sep1=0.679 sep2=0.642 (drugi skok po ~0.8s) |
| wall_descent | ✓ | descended=17.77 minY=0.23 stuckFrames=0 maxJerk=0.236 |
| ramp_exit_to_grass | ✓ | reachedGrass=true exitMaxJerk=0.092 |

## Interpretacja
- `wall_jump_detach`: skok musi odsunąć auto od ściany (sep > 0.55 m), nie kleić z powrotem.
- `wall_descent`: zjazd w dół bez zawieszenia w połowie ściany.
- `entry/exit`: bez progów (jerk) na styku murawa↔banda.
