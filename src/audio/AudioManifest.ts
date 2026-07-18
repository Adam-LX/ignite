/** Ścieżki assetów w `public/assets/audio/` — licencje: LICENSE.md, utwór meczowy: MUSIC.md */

import { assetUrl } from "../util/assetUrl";

/**
 * Rotacja muzyki meczowej — rap dominuje, instrumentale jako oddech.
 * Kolejność: naprzemiennie BPM/subgatunek, pierwszy = domyślny start.
 */
export const MATCH_MUSIC_TRACKS = [
	assetUrl("/assets/audio/music/match_msx.mp3"),
	assetUrl("/assets/audio/music/match_ignite_hiphop.mp3"),
	assetUrl("/assets/audio/music/match_ignite_grime.mp3"),
	assetUrl("/assets/audio/music/match_ignite_chrome.mp3"),
	assetUrl("/assets/audio/music/match_ignite_boom_bap.mp3"),
	assetUrl("/assets/audio/music/match_ignite_more_than.mp3"),
	assetUrl("/assets/audio/music/match_ignite_infinite.mp3"),
	assetUrl("/assets/audio/music/match_ignite_dnb_rap.mp3"),
	assetUrl("/assets/audio/music/match_ignite_apex.mp3"),
	assetUrl("/assets/audio/music/match_ignite_electro_rap.mp3"),
] as const;

export const AUDIO_PATHS = {
	engineLow: assetUrl("/assets/audio/sfx/engine_low.wav"),
	engineHigh: assetUrl("/assets/audio/sfx/engine_high.wav"),
	boostLoop: assetUrl("/assets/audio/sfx/boost_loop.ogg"),
	supersonic: assetUrl("/assets/audio/sfx/supersonic.ogg"),
	kickoff: assetUrl("/assets/audio/sfx/kickoff.ogg"),
	countdownTick: assetUrl("/assets/audio/sfx/countdown_tick.ogg"),
	goalBlue: assetUrl("/assets/audio/sfx/goal_blue.ogg"),
	goalOrange: assetUrl("/assets/audio/sfx/goal_orange.ogg"),
	matchMusic: MATCH_MUSIC_TRACKS[0],
} as const;

export type AudioAssetKey = keyof typeof AUDIO_PATHS;

export const IMPACT_POOLS = {
	carBall: [
		assetUrl("/assets/audio/sfx/impact_car_ball_0.ogg"),
		assetUrl("/assets/audio/sfx/impact_car_ball_1.ogg"),
		assetUrl("/assets/audio/sfx/impact_car_ball_2.ogg"),
	],
	ballWall: [
		assetUrl("/assets/audio/sfx/impact_ball_wall_0.ogg"),
		assetUrl("/assets/audio/sfx/impact_ball_wall_1.ogg"),
		assetUrl("/assets/audio/sfx/impact_ball_wall_2.ogg"),
	],
	carWall: [
		assetUrl("/assets/audio/sfx/impact_car_wall_0.ogg"),
		assetUrl("/assets/audio/sfx/impact_car_wall_1.ogg"),
	],
} as const;

/** Odbicia piłki wg materiału areny (realistyczne sample CC0). */
export const BALL_SURFACE_POOLS = {
	floor: [
		assetUrl("/assets/audio/sfx/impact_ball_floor_0.ogg"),
		assetUrl("/assets/audio/sfx/impact_ball_floor_1.ogg"),
		assetUrl("/assets/audio/sfx/impact_ball_floor_2.ogg"),
	],
	wall: IMPACT_POOLS.ballWall,
	ceiling: [
		assetUrl("/assets/audio/sfx/impact_ball_ceiling_0.ogg"),
		assetUrl("/assets/audio/sfx/impact_ball_ceiling_1.ogg"),
	],
} as const;

export type ImpactKind = keyof typeof IMPACT_POOLS;
