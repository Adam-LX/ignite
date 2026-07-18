#!/usr/bin/env bash
# Pobiera kuratorowane assety audio (CC0 / komercyjnie dozwolone).
# Uruchom: ./scripts/fetch_audio_assets.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/assets/audio"
KENNEY="https://raw.githubusercontent.com/ETdoFresh/kenney.nl/master"

mkdir -p "$OUT/sfx" "$OUT/music"

fetch() {
	local url="$1"
	local dest="$2"
	if [[ -f "$dest" && -s "$dest" ]]; then
		echo "skip  $(basename "$dest")"
		return
	fi
	echo "get   $(basename "$dest")"
	curl -fsSL "$url" -o "$dest"
}

# BigSoundBank CC0 — silnik (niski warstwa)
fetch "https://bigsoundbank.com/UPLOAD/bwf-en/0291.wav" \
	"$OUT/sfx/engine_low.wav"

# OpenGameArt — CC0 racing engine loop (wysoka warstwa)
fetch "https://opengameart.org/sites/default/files/loop_2.wav" \
	"$OUT/sfx/engine_high.wav"

# Kenney CC0 — boost / whoosh
fetch "$KENNEY/kenney_digitalaudio/Audio/phaserUp5.ogg" \
	"$OUT/sfx/boost_loop.ogg"
fetch "$KENNEY/kenney_digitalaudio/Audio/powerUp1.ogg" \
	"$OUT/sfx/supersonic.ogg"
fetch "$KENNEY/kenney_digitalaudio/Audio/pepSound3.ogg" \
	"$OUT/sfx/kickoff.ogg"

# Kenney CC0 — uderzenia (nadpisywane przez prepare_realistic_sfx.sh)
fetch "$KENNEY/kenney_impactsounds/Audio/impactMetal_heavy_001.ogg" \
	"$OUT/sfx/impact_car_ball_0.ogg"
fetch "$KENNEY/kenney_impactsounds/Audio/impactMetal_heavy_003.ogg" \
	"$OUT/sfx/impact_car_ball_1.ogg"
fetch "$KENNEY/kenney_impactsounds/Audio/impactMetal_medium_002.ogg" \
	"$OUT/sfx/impact_car_ball_2.ogg"
fetch "$KENNEY/kenney_impactsounds/Audio/impactPlate_medium_001.ogg" \
	"$OUT/sfx/impact_ball_wall_0.ogg"
fetch "$KENNEY/kenney_impactsounds/Audio/impactPlate_medium_003.ogg" \
	"$OUT/sfx/impact_ball_wall_1.ogg"
fetch "$KENNEY/kenney_impactsounds/Audio/impactGeneric_light_002.ogg" \
	"$OUT/sfx/impact_car_wall_0.ogg"
fetch "$KENNEY/kenney_impactsounds/Audio/impactGeneric_light_004.ogg" \
	"$OUT/sfx/impact_car_wall_1.ogg"

# Kenney CC0 — jingle bramki
fetch "$KENNEY/kenney_musicjingles/Audio/Hit%20jingles/jingles_HIT12.ogg" \
	"$OUT/sfx/goal_blue.ogg"
fetch "$KENNEY/kenney_musicjingles/Audio/Hit%20jingles/jingles_HIT14.ogg" \
	"$OUT/sfx/goal_orange.ogg"

# Realistyczne klipy piłki / murawa / ściana (BigSoundBank CC0 + Kenney)
bash "$(dirname "$0")/prepare_realistic_sfx.sh"

# OpenGameArt CC0 — muzyka meczu (MintoDog — Neon sign Circuit, 145 BPM)
fetch "https://opengameart.org/sites/default/files/neon_sign_circuit_remake_bpm145.mp3" \
	"$OUT/music/match_loop.mp3"
fetch "https://opengameart.org/sites/default/files/neon_sign_circuit_climax_remake_bpm160.mp3" \
	"$OUT/music/match_climax.mp3"

echo "done — $(find "$OUT" -type f | wc -l) plików w public/assets/audio/"
