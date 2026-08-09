#!/usr/bin/env bash
# Wycina realistyczne klipy SFX z CC0 (BigSoundBank + Kenney) — piłka, murawa, ściana.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/public/assets/audio/sfx"
TMP="${ROOT}/data/sfx-src"
KENNEY="https://raw.githubusercontent.com/ETdoFresh/kenney.nl/master"

mkdir -p "${OUT}" "${TMP}"

if ! command -v ffmpeg >/dev/null 2>&1; then
	echo "Brak ffmpeg — uruchom w nix develop." >&2
	exit 1
fi

fetch_bsb() {
	local id="$1"
	local dest="$2"
	if [[ -f "${dest}" && -s "${dest}" && "${FORCE_SFX:-0}" != "1" ]]; then
		return 0
	fi
	echo "BSB #${id} → $(basename "${dest}")"
	curl -fsSL "https://bigsoundbank.com/UPLOAD/bwf-en/${id}.wav" -o "${dest}"
}

fetch_kenney() {
	local rel="$1"
	local dest="$2"
	if [[ -f "${dest}" && -s "${dest}" && "${FORCE_SFX:-0}" != "1" ]]; then
		return 0
	fi
	echo "Kenney → $(basename "${dest}")"
	curl -fsSL "${KENNEY}/${rel}" -o "${dest}"
}

to_ogg() {
	local in="$1"
	local out="$2"
	shift 2
	ffmpeg -y -hide_banner -loglevel error -i "${in}" "$@" -ac 1 -ar 44100 -c:a libvorbis -q:a 5 "${out}"
}

echo "== Pobieranie źródeł CC0 =="
fetch_bsb "1044" "${TMP}/ball_kicked.wav"
fetch_bsb "0584" "${TMP}/tennis_bounce.wav"
fetch_bsb "1825" "${TMP}/ball_wall_0.wav"
fetch_bsb "1826" "${TMP}/ball_wall_1.wav"
fetch_bsb "1797" "${TMP}/whoosh_short.wav"
fetch_kenney "kenney_impactsounds/Audio/impactPunch_medium_002.ogg" "${TMP}/punch_med.ogg"
fetch_kenney "kenney_impactsounds/Audio/impactSoft_medium_001.ogg" "${TMP}/soft_med.ogg"
fetch_kenney "kenney_impactsounds/Audio/impactWood_medium_002.ogg" "${TMP}/wood_med.ogg"

echo "== Wycinanie klipów =="
# Kopnięcia piłki (car ↔ ball) — 5 uderzeń z nagrania terenowego
to_ogg "${TMP}/ball_kicked.wav" "${OUT}/impact_car_ball_0.ogg" -ss 0.55 -t 1.65
to_ogg "${TMP}/ball_kicked.wav" "${OUT}/impact_car_ball_1.ogg" -ss 3.05 -t 1.55
to_ogg "${TMP}/ball_kicked.wav" "${OUT}/impact_car_ball_2.ogg" -ss 5.45 -t 1.55

# Odbicia od murawy — tenis / trawa (nagranie outdoor)
to_ogg "${TMP}/tennis_bounce.wav" "${OUT}/impact_ball_floor_0.ogg" -ss 0.25 -t 0.48
to_ogg "${TMP}/tennis_bounce.wav" "${OUT}/impact_ball_floor_1.ogg" -ss 1.05 -t 0.42
to_ogg "${TMP}/tennis_bounce.wav" "${OUT}/impact_ball_floor_2.ogg" -ss 1.82 -t 0.38

# Odbicia od ściany — realistyczne „ball on wall”
to_ogg "${TMP}/ball_wall_0.wav" "${OUT}/impact_ball_wall_0.ogg"
to_ogg "${TMP}/ball_wall_1.wav" "${OUT}/impact_ball_wall_1.ogg"
to_ogg "${TMP}/wood_med.ogg" "${OUT}/impact_ball_wall_2.ogg"

# Sufit — twardszy, krótszy rezonans
to_ogg "${TMP}/soft_med.ogg" "${OUT}/impact_ball_ceiling_0.ogg" -af "highpass=f=180,lowpass=f=4200"
to_ogg "${TMP}/wood_med.ogg" "${OUT}/impact_ball_ceiling_1.ogg" -af "highpass=f=220,lowpass=f=5000"

# Auto ↔ barierka
fetch_kenney "kenney_impactsounds/Audio/impactGeneric_light_002.ogg" "${OUT}/impact_car_wall_0.ogg"
fetch_kenney "kenney_impactsounds/Audio/impactGeneric_light_004.ogg" "${OUT}/impact_car_wall_1.ogg"

# Countdown — miękki stuk (nie sine beep)
cp -f "${TMP}/soft_med.ogg" "${OUT}/countdown_tick.ogg"

# Supersonic — whoosh zamiast powerUp „piu”
to_ogg "${TMP}/whoosh_short.wav" "${OUT}/supersonic.ogg" -af "highpass=f=120,lowpass=f=8000,volume=1.4"

# Boost — łagodniejszy phaser (mniej arcade)
fetch_kenney "kenney_digitalaudio/Audio/phaserUp3.ogg" "${OUT}/boost_loop.ogg"

# Kickoff — uderzenie + istniejący sample
fetch_kenney "kenney_impactsounds/Audio/impactPunch_heavy_001.ogg" "${OUT}/kickoff.ogg"

echo "done — $(find "${OUT}" -maxdepth 1 -type f | wc -l) plików w ${OUT}/"
