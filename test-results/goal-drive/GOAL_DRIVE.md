# Goal drive audit v2

Generated: 2026-08-06T16:59:50.904Z

## Kryteria
- `no_flip_line_*`: w past∈[0,2] min(upY)≥0.75, brak upY<0.45
- `climb_back_*`: y≥3 przy onWall (tylna ćwiartka)
- `climb_ceiling_*`: y≥GOAL_HEIGHT−1.8 przy onWall/sufit
- `climb_rim_roof_*`: z kieszeni na dach (klip F9)

## Cases

### PASS — `dims_vs_rl`
Ignite 17.86×6.43×8.80 vs RL 17.86×6.43×8.80

### PASS — `no_flip_line_orange_x0`
minUp=1.00 flip=false samples=7

### PASS — `no_flip_line_orange_x4`
minUp=1.00 flip=false samples=7

### PASS — `no_flip_line_orange_x6.5`
minUp=1.00 flip=false samples=7

### PASS — `climb_back_orange`
maxY=6.13 wallAtHeight=true

### PASS — `climb_ceiling_orange`
maxY=6.05/4.63 ceilingHold=true

### PASS — `climb_rim_roof_orange`
maxY=6.53 roofTop≈6.87 onRoof=true

### PASS — `no_flip_line_blue_x0`
minUp=1.00 flip=false samples=7

### PASS — `no_flip_line_blue_x4`
minUp=1.00 flip=false samples=7

### PASS — `no_flip_line_blue_x6.5`
minUp=1.00 flip=false samples=7

### PASS — `climb_back_blue`
maxY=6.05 wallAtHeight=true

### PASS — `climb_ceiling_blue`
maxY=6.05/4.63 ceilingHold=true

### PASS — `climb_rim_roof_blue`
maxY=6.53 roofTop≈6.87 onRoof=true

## Summary
All cases passed.
