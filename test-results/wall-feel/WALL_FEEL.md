# Wall Ride Feel Probe

Wynik: **PASS**

| Case | Pass | Detail |
|------|------|--------|
| entry_smooth | ✓ | maxYJump=0.112 firstWallY=0.24 maxY=14.85 entrySep=1.47 |
| wall_climb_hold | ✓ | wallFrames=90/90 climbMaxY=17.76 avg|vn|=0.013 |
| wall_jump_detach | ✓ | maxSep=2.550 leftWall=true glued=false preOnWall=true wheels=4 upDotNmin=0.54 |
| wall_jump_repeat | ✓ | sep1=1.100 sep2=0.814 (drugi skok po ~0.8s) |
| wall_descent | ✓ | descended=17.77 minY=0.23 stuckFrames=0 maxJerk=0.228 |
| ramp_exit_to_grass | ✓ | reachedGrass=true exitMaxJerk=0.077 |

## Interpretacja
- `wall_jump_detach`: skok musi odsunąć auto od ściany (sep > 0.55 m), nie kleić z powrotem.
- `wall_descent`: zjazd w dół bez zawieszenia w połowie ściany.
- `entry/exit`: bez progów (jerk) na styku murawa↔banda.
