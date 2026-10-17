/** Ścieżki assetów w `public/assets/audio/` — licencje: LICENSE.md, utwór meczowy: MUSIC.md */

import { assetUrl } from "../util/assetUrl";

/**
 * Rotacja muzyki meczowej / menu — pierwszy = start w main menu / boot.
 * `match_ignite_trance` = DJ scratching intro → full-on psytrance ~145 BPM (ACE-Step).
 * `match_ignite_breakbeat` = dirty breakbeat / big-beat instrumental ~140 BPM, ~4.5 min.
 */
/** Prematch stadium show — głośny euphoric bed (oryginał, nie rip Heaven). */
export const PREMATCH_MUSIC_URL = assetUrl(
	"/assets/audio/music/prematch_heaven_bed.mp3",
);
export const PREMATCH_MUSIC_BPM = 140;

export const MATCH_MUSIC_TRACKS = [
	assetUrl("/assets/audio/music/match_ignite_trance.mp3"),
	assetUrl("/assets/audio/music/match_ignite_breakbeat.mp3"),
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
	boostPad: assetUrl("/assets/audio/sfx/boost_pad.ogg"),
	supersonic: assetUrl("/assets/audio/sfx/supersonic.ogg"),
	kickoff: assetUrl("/assets/audio/sfx/kickoff.ogg"),
	countdownTick: assetUrl("/assets/audio/sfx/countdown_tick.ogg"),
	countdown1: assetUrl("/assets/audio/sfx/countdown_1.ogg"),
	countdown2: assetUrl("/assets/audio/sfx/countdown_2.ogg"),
	countdown3: assetUrl("/assets/audio/sfx/countdown_3.ogg"),
	countdown4: assetUrl("/assets/audio/sfx/countdown_4.ogg"),
	countdown5: assetUrl("/assets/audio/sfx/countdown_5.ogg"),
	countdownGo: assetUrl("/assets/audio/sfx/countdown_go.ogg"),
	goalBlue: assetUrl("/assets/audio/sfx/goal_blue.ogg"),
	goalOrange: assetUrl("/assets/audio/sfx/goal_orange.ogg"),
	goalCrowd: assetUrl("/assets/audio/sfx/goal_crowd.ogg"),
	demolish: assetUrl("/assets/audio/sfx/demolish.ogg"),
	demolishImpact: assetUrl("/assets/audio/sfx/demolish_impact.ogg"),
	whooshShort: assetUrl("/assets/audio/sfx/whoosh_short.ogg"),
	matchMusic: MATCH_MUSIC_TRACKS[0],
	prematchHeaven: PREMATCH_MUSIC_URL,
} as const;

export type AudioAssetKey = keyof typeof AUDIO_PATHS;

/** Kickoff 5→1 sample paths (sample-first; procedural fallback in GameAudio). */
export const COUNTDOWN_TICK_PATHS: readonly string[] = [
	AUDIO_PATHS.countdown1,
	AUDIO_PATHS.countdown2,
	AUDIO_PATHS.countdown3,
	AUDIO_PATHS.countdown4,
	AUDIO_PATHS.countdown5,
];

export function countdownTickPath(step: number): string {
	const s = Math.round(step);
	if (s <= 1) return AUDIO_PATHS.countdown1;
	if (s === 2) return AUDIO_PATHS.countdown2;
	if (s === 3) return AUDIO_PATHS.countdown3;
	if (s === 4) return AUDIO_PATHS.countdown4;
	return AUDIO_PATHS.countdown5;
}

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
