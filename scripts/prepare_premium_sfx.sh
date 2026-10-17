#!/usr/bin/env bash
# Premium SFX z Mixkit (licencja komercyjna Free SFX) — countdown, GO, gole, demolka, boost.
# Silnik (engine_*.wav) NIE jest ruszany.
# Uruchom: FORCE_SFX=1 bash scripts/prepare_premium_sfx.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${ROOT}/data/sfx-src/mixkit"
OUT="${ROOT}/public/assets/audio/sfx"
mkdir -p "${SRC}" "${OUT}"

if ! command -v ffmpeg >/dev/null 2>&1; then
	echo "Brak ffmpeg" >&2
	exit 1
fi

fetch() {
	local id="$1" name="$2"
	local dest="${SRC}/${name}.wav"
	if [[ -f "${dest}" && -s "${dest}" && "${FORCE_SFX:-0}" != "1" ]]; then
		return 0
	fi
	echo "Mixkit #${id} → ${name}"
	curl -fsSL "https://assets.mixkit.co/active_storage/sfx/${id}/${id}.wav" -o "${dest}"
}

to_ogg() {
	local in="$1" out="$2"
	shift 2
	ffmpeg -y -hide_banner -loglevel error -i "${in}" "$@" -ac 1 -ar 44100 -c:a libvorbis -q:a 7 "${out}"
}

echo "== Pobieranie Mixkit (commercial Free SFX License) =="
fetch 919 start_match_countdown
fetch 615 basketball_buzzer
fetch 718 car_double_horn
fetch 461 huge_crowd_cheering
fetch 432 stadium_joy_crowd
fetch 368 cheering_crowd_whistle
fetch 1690 short_explosion
fetch 2198 big_cinematic_impact
fetch 1486 fast_rocket_whoosh
fetch 1492 air_woosh
fetch 2183 electricity_power_up
fetch 522 soccer_ball_kick
fetch 363 soccer_ball_quick_kick
fetch 2075 sports_ball_hit

echo "== Cięcie / normalizacja =="
ffmpeg -y -hide_banner -loglevel error -i "${SRC}/start_match_countdown.wav" \
	-ss 0.00 -t 0.25 -af "afade=t=out:st=0.18:d=0.07,loudnorm=I=-10:TP=-1:LRA=6" \
	-ac 1 -ar 44100 /tmp/ignite_cd_base.wav

mk_tick() {
	local step="$1" rate="$2"
	ffmpeg -y -hide_banner -loglevel error -i /tmp/ignite_cd_base.wav \
		-af "asetrate=44100*${rate},aresample=44100,loudnorm=I=-10:TP=-1:LRA=6" \
		-ac 1 -ar 44100 -c:a libvorbis -q:a 7 "${OUT}/countdown_${step}.ogg"
}
mk_tick 5 0.90
mk_tick 4 0.97
mk_tick 3 1.00
mk_tick 2 1.08
mk_tick 1 1.18
cp -f "${OUT}/countdown_3.ogg" "${OUT}/countdown_tick.ogg"

ffmpeg -y -hide_banner -loglevel error \
	-i "${SRC}/basketball_buzzer.wav" -i "${SRC}/car_double_horn.wav" \
	-filter_complex "[0:a]atrim=0:0.85,afade=t=out:st=0.65:d=0.2,volume=1.15[a0];\
[1:a]atrim=0:0.55,afade=t=out:st=0.4:d=0.15,volume=0.55,adelay=40|40[a1];\
[a0][a1]amix=inputs=2:duration=longest,loudnorm=I=-11:TP=-1:LRA=8[out]" \
	-map "[out]" -ac 1 -ar 44100 -c:a libvorbis -q:a 7 "${OUT}/kickoff.ogg"

to_ogg "${SRC}/basketball_buzzer.wav" "${OUT}/countdown_go.ogg" -t 0.9 \
	-af "afade=t=out:st=0.7:d=0.2,loudnorm=I=-11:TP=-1:LRA=7"
to_ogg "${SRC}/huge_crowd_cheering.wav" "${OUT}/goal_crowd.ogg" -ss 0.4 -t 2.4 \
	-af "afade=t=in:d=0.05,afade=t=out:st=1.9:d=0.5,loudnorm=I=-12:TP=-1.2:LRA=9"
to_ogg "${SRC}/stadium_joy_crowd.wav" "${OUT}/goal_blue.ogg" -ss 0.8 -t 2.2 \
	-af "afade=t=in:d=0.04,afade=t=out:st=1.7:d=0.45,highpass=f=120,loudnorm=I=-11:TP=-1:LRA=9"
to_ogg "${SRC}/cheering_crowd_whistle.wav" "${OUT}/goal_orange.ogg" -ss 1.2 -t 2.2 \
	-af "afade=t=in:d=0.04,afade=t=out:st=1.7:d=0.45,highpass=f=100,asetrate=44100*0.97,aresample=44100,loudnorm=I=-11:TP=-1:LRA=9"
to_ogg "${SRC}/short_explosion.wav" "${OUT}/demolish.ogg" -ss 0.05 -t 1.15 \
	-af "afade=t=out:st=0.85:d=0.3,loudnorm=I=-10:TP=-1:LRA=8"
to_ogg "${SRC}/big_cinematic_impact.wav" "${OUT}/demolish_impact.ogg" -t 1.0 \
	-af "afade=t=out:st=0.7:d=0.3,loudnorm=I=-10:TP=-1:LRA=8"
to_ogg "${SRC}/electricity_power_up.wav" "${OUT}/boost_pad.ogg" \
	-af "loudnorm=I=-12:TP=-1.2:LRA=7"
to_ogg "${SRC}/fast_rocket_whoosh.wav" "${OUT}/boost_loop.ogg" -ss 0.8 -t 1.6 \
	-af "afade=t=in:d=0.08,afade=t=out:st=1.45:d=0.15,loudnorm=I=-13:TP=-1.5:LRA=7"
to_ogg "${SRC}/fast_rocket_whoosh.wav" "${OUT}/supersonic.ogg" -ss 0.2 -t 1.35 \
	-af "afade=t=in:d=0.03,afade=t=out:st=1.05:d=0.3,loudnorm=I=-11:TP=-1:LRA=7"
to_ogg "${SRC}/air_woosh.wav" "${OUT}/whoosh_short.ogg" \
	-af "loudnorm=I=-14:TP=-1.5:LRA=7"
to_ogg "${SRC}/soccer_ball_kick.wav" "${OUT}/impact_car_ball_0.ogg" -ss 0.15 -t 0.55 \
	-af "afade=t=out:st=0.4:d=0.15,loudnorm=I=-12:TP=-1.2:LRA=7"
to_ogg "${SRC}/soccer_ball_quick_kick.wav" "${OUT}/impact_car_ball_1.ogg" -ss 0.3 -t 0.5 \
	-af "afade=t=out:st=0.35:d=0.15,loudnorm=I=-12:TP=-1.2:LRA=7"
to_ogg "${SRC}/sports_ball_hit.wav" "${OUT}/impact_car_ball_2.ogg" -ss 0.1 -t 0.45 \
	-af "afade=t=out:st=0.3:d=0.15,loudnorm=I=-12:TP=-1.2:LRA=7"

echo "done — engine_*.wav nietknięte"
ls -lh "${OUT}"/countdown_*.ogg "${OUT}"/kickoff.ogg "${OUT}"/demolish.ogg "${OUT}"/boost_pad.ogg
