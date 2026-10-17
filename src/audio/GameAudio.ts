import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { Audio } from "three";
import {
	type BallSurfaceKind,
	classifyBallSurfaceFromNormal,
} from "../util/rlContacts";
import { loadAudioBuffers } from "./AudioLoader";
import {
	AUDIO_PATHS,
	type AudioAssetKey,
	BALL_SURFACE_POOLS,
	countdownTickPath,
	IMPACT_POOLS,
	type ImpactKind,
	MATCH_MUSIC_TRACKS,
	PREMATCH_MUSIC_BPM,
	PREMATCH_MUSIC_URL,
} from "./AudioManifest";
import { playMenuUiCue, type MenuUiCue } from "./MenuUiAudio";
import { MusicBeatAnalyzer } from "./MusicBeatAnalyzer";

function jumbotronPaUrls(videoId: string): string[] {
	return [
		`/jumbotron/${videoId}.webm`,
		`/jumbotron/${videoId}.m4a`,
		`/jumbotron/${videoId}.mp3`,
		`/jumbotron/${videoId}.mp4`,
		`/__ignite/jumbotron?id=${encodeURIComponent(videoId)}`,
	];
}

/** Mix PA jumbotronu — film czytelny gdy widać; LED = duck. */
export const JUMBOTRON_PA_MIX = {
	masterOpen: 1.15,
	masterHidden: 0.07,
	rampSec: 0.4,
	/** Dry był 0.055 — niesłyszalne na tle muzyki/SFX. */
	dry: 0.32,
	wet: 0.4,
	/** Mniej „telefonicznego” cutu — dialog/PA ma przejść. */
	toneCutDb: -2,
} as const;

export type ColliderTag = "player" | "ball" | "world";

type ScoringTeam = "blue" | "orange";

const GOAL_DUCK_VOLUME = 0.07;
const GOAL_DUCK_MS = 2200;
const IMPACT_DUCK_MS = 380;
const IMPACT_DUCK_VOLUME = 0.12;
const SPATIAL_IMPACT_POOL = 16;
/** Muzyka w tle — SFX boiska muszą dominować. */
const MUSIC_BASE_VOLUME = 0.22;
/** Minimalny impact z fizyki gry (applyCarBallHits) zanim zagra dźwięk. */
const GAMEPLAY_BALL_HIT_MIN = 1.8;

type SpatialImpactSlot = {
	anchor: THREE.Object3D;
	sfx: THREE.PositionalAudio;
	busyUntil: number;
};

/** Spatial + music audio z sample'ami CC0 (fallback proceduralny gdy brak plików). */
export class GameAudio {
	readonly listener: THREE.AudioListener;

	private readonly colliderTags = new Map<number, ColliderTag>();
	private readonly impactCooldown = new Map<string, number>();
	private readonly sfxRoot = new THREE.Group();
	private readonly buffers = new Map<string, AudioBuffer>();
	private readonly impactPools = new Map<ImpactKind, AudioBuffer[]>();
	private readonly ballSurfacePools = new Map<BallSurfaceKind, AudioBuffer[]>();
	private readonly spatialImpactPool: SpatialImpactSlot[] = [];
	private spatialPoolReady = false;
	private readonly _contactPosA = new THREE.Vector3();
	private readonly _contactPosB = new THREE.Vector3();
	private arenaEchoInput?: GainNode;
	private arenaEchoWet?: GainNode;
	private arenaEchoFeedback?: GainNode;
	private jumbotronVideoId: string | null = null;
	private jumbotronGen = 0;
	private jumbotronBufSrc: AudioBufferSourceNode | null = null;
	private jumbotronMaster: GainNode | null = null;
	private jumbotronNodes: AudioNode[] = [];
	/** Preferencja duck — stosuj po async connect (master może jeszcze nie istnieć). */
	private jumbotronFilmOpenDesired = false;
	private commentarySource: AudioBufferSourceNode | null = null;
	/** Proceduralne napięcie skrzynki — anulowane przy stop / hide. */
	private crateTensionStoppers: Array<() => void> = [];

	private unlocked = false;
	private unlockPromise: Promise<void> | null = null;
	private detachUnlockGestures: (() => void) | null = null;
	private loading: Promise<void> | null = null;
	private engineReady = false;
	private musicDuckUntil = 0;
	private impactDuckUntil = 0;
	private musicMuted = false;
	/** Master mute — wycisza SFX+muzykę (skrót M). */
	private masterMuted = false;
	/** Pre-match show — cichsza muzyka + „stadionowy” mix. */
	private stadiumShowMix = false;
	private stadiumShowMusicSend: GainNode | null = null;
	private stadiumShowLowpass: BiquadFilterNode | null = null;
	/** Prematch — przytłumiony bed komentatora w tle (lowpass + mokry echo). */
	private prematchBed: {
		buffers: AudioBuffer[];
		idx: number;
		stopped: boolean;
		master: GainNode;
		lp: BiquadFilterNode;
		hp: BiquadFilterNode;
		dry: GainNode;
		wet: GainNode;
		source: AudioBufferSourceNode | null;
		timer: number | null;
	} | null = null;
	/**
	 * Prematch trance bed — procedural kick/pad/arp @ TRANCE_BPM
	 * (ASOT-style energy under laser cues).
	 */
	private prematchTrance: {
		stopped: boolean;
		bpm: number;
		startedAt: number;
		master: GainNode;
		padGain: GainNode | null;
		kickTimer: number | null;
		padOsc: OscillatorNode[];
		arpTimer: number | null;
		/** Głośny plik bed (Heaven-style oryginał). */
		musicSource: AudioBufferSourceNode | null;
		musicGain: GainNode | null;
	} | null = null;
	private prematchMusicBuffer: AudioBuffer | null = null;

	/** Trance festival BPM for prematch laser sync (bed = 140). */
	static readonly PREMATCH_TRANCE_BPM = PREMATCH_MUSIC_BPM;

	private engineLow?: Audio;
	private engineHigh?: Audio;
	private boostAudio?: THREE.PositionalAudio;
	/** Powerslide / wall scrape — proceduralne loopy (gain 0 = off). */
	private slideNoise?: AudioBufferSourceNode;
	private slideGain?: GainNode;
	private slideFilter?: BiquadFilterNode;
	private slideTargetVol = 0;
	private wallScrapeTargetVol = 0;
	private matchMusic?: Audio;
	private matchMusicSource: AudioBufferSourceNode | null = null;
	private musicAdvanceTimer = 0;
	private pendingMatchMusicAdvance = false;
	private matchMusicSessionStarted = false;
	private readonly musicBuffers: AudioBuffer[] = [];
	private musicTrackIndex = 0;
	private engineAnchor?: THREE.Object3D;
	private analyser?: AnalyserNode;
	private readonly beatAnalyzer = new MusicBeatAnalyzer(512);
	private analyserReady = false;
	private readonly menuUiGate = new Map<string, number>();

	constructor() {
		this.listener = new THREE.AudioListener();
		this.sfxRoot.name = "spatialSfxRoot";
		this.listener.setMasterVolume(1);

		const onGesture = () => {
			void this.unlock();
		};
		/** Trzymaj listenery do skutku — `once` gubi gest gdy AudioContext jeszcze suspended. */
		for (const type of [
			"pointerdown",
			"mousedown",
			"keydown",
			"touchstart",
			"click",
		] as const) {
			window.addEventListener(type, onGesture, { capture: true });
		}
		this.detachUnlockGestures = () => {
			for (const type of [
				"pointerdown",
				"mousedown",
				"keydown",
				"touchstart",
				"click",
			] as const) {
				window.removeEventListener(type, onGesture, { capture: true });
			}
			this.detachUnlockGestures = null;
		};
	}

	attachToCamera(camera: THREE.PerspectiveCamera): void {
		if (this.listener.parent !== camera) {
			this.listener.removeFromParent();
			camera.add(this.listener);
		}
	}

	attachEngineAnchor(object: THREE.Object3D, scene: THREE.Scene): void {
		this.engineAnchor = object;
		if (this.sfxRoot.parent !== scene) {
			scene.add(this.sfxRoot);
		}
		if (this.unlocked) {
			this.startEngine();
		}
	}

	registerCollider(handle: number, tag: ColliderTag): void {
		this.colliderTags.set(handle, tag);
	}

	getColliderTag(handle: number): ColliderTag {
		return this.colliderTags.get(handle) ?? "world";
	}

	/** @deprecated Listener podąża za kamerą automatycznie po attachToCamera. */
	setListener(_position: THREE.Vector3, _forward: THREE.Vector3): void {}

	updateEngine(speed: number, throttle: number, boosting: boolean): void {
		if (!this.engineReady && this.unlocked) {
			this.startEngine();
		}
		if (!this.engineReady) return;

		const load = Math.abs(throttle);
		const rate = THREE.MathUtils.clamp(
			0.62 + speed / 34 + load * 0.24 + (boosting ? 0.34 : 0),
			0.55,
			2.75,
		);
		const vol = THREE.MathUtils.clamp(
			0.3 + load * 0.34 + Math.min(speed / 38, 0.58),
			0.24,
			0.94,
		);

		if (this.engineLow) {
			this.engineLow.setPlaybackRate(rate * 0.92);
			this.engineLow.setVolume(vol * 0.9);
		}
		if (this.engineHigh) {
			this.engineHigh.setPlaybackRate(rate * 1.08);
			this.engineHigh.setVolume(vol * (0.42 + Math.min(speed / 52, 0.62)));
		}
		if (this.boostAudio) {
			this.boostAudio.setVolume(boosting ? 0.42 + load * 0.24 : 0.0001);
			if (boosting) {
				this.boostAudio.setPlaybackRate(
					THREE.MathUtils.clamp(0.9 + speed / 60, 0.85, 1.6),
				);
			}
		}

		this.updateMusicDuck();
	}

	/**
	 * Powerslide screech + wall grind — ciągły feedback jak w RL.
	 * Wołaj z ticka meczu (human car).
	 */
	updateSurfaceFx(opts: {
		driftBlend: number;
		onWall: boolean;
		speedMps: number;
	}): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		this.ensureSlideLoop();

		const speedT = THREE.MathUtils.clamp(opts.speedMps / 22, 0, 1);
		const drift =
			opts.driftBlend > 0.32
				? THREE.MathUtils.clamp(
						(opts.driftBlend - 0.32) * 1.45 * (0.45 + speedT * 0.7),
						0,
						0.38,
					)
				: 0;
		const wall =
			opts.onWall && opts.speedMps > 6.5
				? THREE.MathUtils.clamp(0.08 + speedT * 0.28, 0, 0.34)
				: 0;
		this.slideTargetVol = Math.max(drift, wall * 0.85);
		this.wallScrapeTargetVol = wall;

		if (this.slideGain && this.slideFilter) {
			const now = ctx.currentTime;
			const vol = Math.max(0.0001, this.slideTargetVol);
			this.slideGain.gain.setTargetAtTime(vol, now, 0.06);
			const cutoff =
				this.wallScrapeTargetVol > drift
					? 900 + speedT * 1400
					: 1400 + speedT * 2200;
			this.slideFilter.frequency.setTargetAtTime(cutoff, now, 0.08);
		}
	}

	private ensureSlideLoop(): void {
		if (this.slideNoise || !this.unlocked) return;
		const ctx = this.listener.context;
		const out = this.listener.getInput();
		const len = Math.floor(ctx.sampleRate * 0.45);
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const data = buf.getChannelData(0);
		let prev = 0;
		for (let i = 0; i < len; i++) {
			const white = Math.random() * 2 - 1;
			prev = prev * 0.92 + white * 0.08;
			data[i] = prev;
		}
		const src = ctx.createBufferSource();
		src.buffer = buf;
		src.loop = true;
		const filter = ctx.createBiquadFilter();
		filter.type = "bandpass";
		filter.frequency.value = 1800;
		filter.Q.value = 0.7;
		const gain = ctx.createGain();
		gain.gain.value = 0.0001;
		src.connect(filter);
		filter.connect(gain);
		gain.connect(out);
		src.start();
		this.slideNoise = src;
		this.slideFilter = filter;
		this.slideGain = gain;
	}

	/** Boom + warp przy pierścieniu supersonic pod autem — zsynchronizowane z VFX. */
	playSupersonicBreak(carPos?: THREE.Vector3): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;

		const now = ctx.currentTime;
		const out = this.listener.getInput();

		const warp = ctx.createOscillator();
		warp.type = "sawtooth";
		warp.frequency.setValueAtTime(520, now);
		warp.frequency.exponentialRampToValueAtTime(72, now + 0.11);
		warp.frequency.exponentialRampToValueAtTime(168, now + 0.24);
		const warpFilter = ctx.createBiquadFilter();
		warpFilter.type = "lowpass";
		warpFilter.frequency.setValueAtTime(3200, now);
		warpFilter.frequency.exponentialRampToValueAtTime(240, now + 0.2);
		warpFilter.Q.value = 1.35;
		const warpGain = ctx.createGain();
		warpGain.gain.setValueAtTime(0.0001, now);
		warpGain.gain.exponentialRampToValueAtTime(0.44, now + 0.006);
		warpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
		warp.connect(warpFilter);
		warpFilter.connect(warpGain);
		warpGain.connect(out);
		if (this.arenaEchoInput) warpGain.connect(this.arenaEchoInput);
		warp.start(now);
		warp.stop(now + 0.34);

		const sub = ctx.createOscillator();
		sub.type = "sine";
		sub.frequency.setValueAtTime(148, now);
		sub.frequency.exponentialRampToValueAtTime(34, now + 0.22);
		const subGain = ctx.createGain();
		subGain.gain.setValueAtTime(0.0001, now);
		subGain.gain.exponentialRampToValueAtTime(1.15, now + 0.01);
		subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.52);
		sub.connect(subGain);
		subGain.connect(out);
		if (this.arenaEchoInput) subGain.connect(this.arenaEchoInput);
		sub.start(now);
		sub.stop(now + 0.55);

		const len = Math.floor(ctx.sampleRate * 0.14);
		const noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
		const noiseData = noiseBuf.getChannelData(0);
		for (let i = 0; i < len; i++) {
			const t = i / len;
			noiseData[i] = (Math.random() * 2 - 1) * (1 - t) ** 2.8;
		}
		const noise = ctx.createBufferSource();
		noise.buffer = noiseBuf;
		const crackBand = ctx.createBiquadFilter();
		crackBand.type = "bandpass";
		crackBand.frequency.setValueAtTime(1800, now);
		crackBand.frequency.exponentialRampToValueAtTime(420, now + 0.08);
		crackBand.Q.value = 0.85;
		const crackGain = ctx.createGain();
		crackGain.gain.setValueAtTime(0.0001, now);
		crackGain.gain.exponentialRampToValueAtTime(0.58, now + 0.004);
		crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
		noise.connect(crackBand);
		crackBand.connect(crackGain);
		crackGain.connect(out);
		noise.start(now);
		noise.stop(now + 0.18);

		const ping = ctx.createOscillator();
		ping.type = "triangle";
		ping.frequency.setValueAtTime(640, now + 0.012);
		ping.frequency.exponentialRampToValueAtTime(180, now + 0.1);
		const pingGain = ctx.createGain();
		pingGain.gain.setValueAtTime(0.0001, now + 0.012);
		pingGain.gain.exponentialRampToValueAtTime(0.36, now + 0.02);
		pingGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
		ping.connect(pingGain);
		pingGain.connect(out);
		ping.start(now + 0.012);
		ping.stop(now + 0.16);

		this.playSupersonicChirp(ctx, now, out);

		if (this.buffers.get(AUDIO_PATHS.supersonic)) {
			this.playListenerSfx(AUDIO_PATHS.supersonic, 0.28, 0.95);
		}

		if (carPos) {
			this.playBodyThump(0.62, carPos);
		}
		this.duckMusicForImpact(0.62);
	}

	/** Ćwierknięcie supersonic — krótki sweep w górę, długie wybrzmienie w echo areny. */
	private playSupersonicChirp(
		ctx: AudioContext,
		now: number,
		out: AudioNode,
	): void {
		const t0 = now + 0.022;
		const ringEnd = t0 + 1.15;

		const chirp = ctx.createOscillator();
		chirp.type = "triangle";
		chirp.frequency.setValueAtTime(680, t0);
		chirp.frequency.exponentialRampToValueAtTime(2920, t0 + 0.07);
		chirp.frequency.exponentialRampToValueAtTime(1680, t0 + 0.24);
		chirp.frequency.exponentialRampToValueAtTime(1120, ringEnd);

		const chirpGain = ctx.createGain();
		chirpGain.gain.setValueAtTime(0.0001, t0);
		chirpGain.gain.exponentialRampToValueAtTime(0.36, t0 + 0.014);
		chirpGain.gain.exponentialRampToValueAtTime(0.24, t0 + 0.09);
		chirpGain.gain.exponentialRampToValueAtTime(0.0001, ringEnd);

		const chirp2 = ctx.createOscillator();
		chirp2.type = "sine";
		chirp2.frequency.setValueAtTime(1180, t0 + 0.01);
		chirp2.frequency.exponentialRampToValueAtTime(3480, t0 + 0.055);
		chirp2.frequency.exponentialRampToValueAtTime(1960, t0 + 0.2);
		chirp2.frequency.exponentialRampToValueAtTime(1380, ringEnd);

		const chirp2Gain = ctx.createGain();
		chirp2Gain.gain.setValueAtTime(0.0001, t0 + 0.01);
		chirp2Gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.022);
		chirp2Gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.72);

		const ring = ctx.createOscillator();
		ring.type = "sine";
		ring.frequency.setValueAtTime(1260, t0 + 0.06);
		ring.frequency.exponentialRampToValueAtTime(940, t0 + 0.95);

		const ringGain = ctx.createGain();
		ringGain.gain.setValueAtTime(0.0001, t0 + 0.06);
		ringGain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.1);
		ringGain.gain.exponentialRampToValueAtTime(0.0001, ringEnd + 0.08);

		const chirpFilter = ctx.createBiquadFilter();
		chirpFilter.type = "highpass";
		chirpFilter.frequency.value = 520;
		chirpFilter.Q.value = 0.6;

		const connectWithRingout = (
			source: AudioNode,
			gain: GainNode,
			echoMix = 0.55,
		): void => {
			source.connect(gain);
			gain.connect(chirpFilter);
			chirpFilter.connect(out);
			if (this.arenaEchoInput) {
				const send = ctx.createGain();
				send.gain.value = echoMix;
				gain.connect(send);
				send.connect(this.arenaEchoInput);
			}
		};

		connectWithRingout(chirp, chirpGain, 0.62);
		connectWithRingout(chirp2, chirp2Gain, 0.48);
		connectWithRingout(ring, ringGain, 0.78);

		chirp.start(t0);
		chirp.stop(ringEnd + 0.02);
		chirp2.start(t0 + 0.01);
		chirp2.stop(t0 + 0.75);
		ring.start(t0 + 0.06);
		ring.stop(ringEnd + 0.1);
	}

	playGoal(team: ScoringTeam): void {
		const path =
			team === "blue" ? AUDIO_PATHS.goalBlue : AUDIO_PATHS.goalOrange;
		this.playListenerSfx(path, 0.98, 1);
		if (this.buffers.get(AUDIO_PATHS.goalCrowd)) {
			this.playListenerSfx(AUDIO_PATHS.goalCrowd, 0.42, 1);
		}
		this.playGoalCrowdSwell(team);
		this.musicDuckUntil = performance.now() + GOAL_DUCK_MS;
		this.updateMusicDuck();
	}

	/**
	 * Kwestia komentatora — dry do listenera + send do arenaEcho (delay/feedback).
	 * Duck muzyki jak przy golu. Nowa kwestia przerywa poprzednią (kickoff 5→1).
	 */
	playCommentary(buffer: AudioBuffer, volume = 0.88): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;

		this.stopCommentary();

		this.setupArenaEcho();
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		const gain = ctx.createGain();
		gain.gain.value = volume;
		source.connect(gain);
		gain.connect(this.listener.getInput());
		if (this.arenaEchoInput) {
			const send = ctx.createGain();
			/** Lekki slap — radio-net z boiska, nie mokry stadium wash. */
			send.gain.value = 0.48;
			gain.connect(send);
			send.connect(this.arenaEchoInput);
		}
		this.commentarySource = source;
		source.onended = () => {
			if (this.commentarySource === source) this.commentarySource = null;
		};
		source.start();
		this.musicDuckUntil = performance.now() + Math.min(GOAL_DUCK_MS, 1400);
		this.updateMusicDuck();
	}

	/** Natychmiast ucisz komentarz meczowy. */
	stopCommentary(): void {
		if (!this.commentarySource) return;
		try {
			this.commentarySource.stop();
		} catch {
			/* already ended */
		}
		this.commentarySource = null;
	}

	/**
	 * Prematch stadium show — cichy, stłumiony głos komentatora w tle
	 * (lowpass + mocny send do arenaEcho = pogłos trybun).
	 */
	startPrematchCommentaryBed(buffers: AudioBuffer[]): void {
		this.stopPrematchCommentaryBed();
		if (!this.unlocked || buffers.length === 0) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;

		this.setupArenaEcho();
		const master = ctx.createGain();
		master.gain.value = 0.0001;
		const lp = ctx.createBiquadFilter();
		lp.type = "lowpass";
		lp.frequency.value = 980;
		lp.Q.value = 0.65;
		const hp = ctx.createBiquadFilter();
		hp.type = "highpass";
		hp.frequency.value = 180;
		hp.Q.value = 0.5;
		const dry = ctx.createGain();
		/** Ciszej pod Heaven bedem — muzyka ma być wyraźna. */
		dry.gain.value = 0.035;
		const wet = ctx.createGain();
		wet.gain.value = 0.55;

		master.connect(hp);
		hp.connect(lp);
		lp.connect(dry);
		lp.connect(wet);
		dry.connect(this.listener.getInput());
		if (this.arenaEchoInput) {
			wet.connect(this.arenaEchoInput);
		} else {
			wet.connect(this.listener.getInput());
		}

		const now = ctx.currentTime;
		master.gain.setValueAtTime(0.0001, now);
		master.gain.exponentialRampToValueAtTime(0.12, now + 1.4);

		this.prematchBed = {
			buffers: buffers.filter(Boolean),
			idx: Math.floor(Math.random() * buffers.length),
			stopped: false,
			master,
			lp,
			hp,
			dry,
			wet,
			source: null,
			timer: null,
		};
		this.playNextPrematchBedClip();
	}

	stopPrematchCommentaryBed(): void {
		const bed = this.prematchBed;
		if (!bed) return;
		bed.stopped = true;
		if (bed.timer != null) {
			window.clearTimeout(bed.timer);
			bed.timer = null;
		}
		if (bed.source) {
			try {
				bed.source.stop();
			} catch {
				/* */
			}
			bed.source = null;
		}
		const ctx = this.listener.context;
		const now = ctx.currentTime;
		try {
			bed.master.gain.cancelScheduledValues(now);
			bed.master.gain.setValueAtTime(Math.max(0.0001, bed.master.gain.value), now);
			bed.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
		} catch {
			/* */
		}
		window.setTimeout(() => {
			try {
				bed.master.disconnect();
				bed.lp.disconnect();
				bed.hp.disconnect();
				bed.dry.disconnect();
				bed.wet.disconnect();
			} catch {
				/* */
			}
		}, 500);
		this.prematchBed = null;
	}

	/**
	 * Procedural trance bed @ 138 BPM — kick + filtered pad + soft arp.
	 * Pulse drives lasers even when playlist analyser is quiet.
	 */
	startPrematchTranceBed(bpm = GameAudio.PREMATCH_TRANCE_BPM): void {
		this.stopPrematchTranceBed();
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;

		this.setupArenaEcho();
		const master = ctx.createGain();
		master.gain.value = 0.0001;
		const out = this.listener.getInput();
		master.connect(out);
		if (this.arenaEchoInput) {
			const wet = ctx.createGain();
			/** Stadionowy pogłos — nie gasi bedu. */
			wet.gain.value = 0.35;
			master.connect(wet);
			wet.connect(this.arenaEchoInput);
		}

		const now = ctx.currentTime;
		/** Głośno i wyraźnie — to główny soundtrack show. */
		const targetGain = 0.92;
		master.gain.setValueAtTime(0.0001, now);
		master.gain.exponentialRampToValueAtTime(targetGain, now + 0.45);

		let musicSource: AudioBufferSourceNode | null = null;
		let musicGain: GainNode | null = null;
		const buf = this.prematchMusicBuffer;
		if (buf) {
			musicGain = ctx.createGain();
			musicGain.gain.value = 1;
			musicSource = ctx.createBufferSource();
			musicSource.buffer = buf;
			musicSource.loop = true;
			musicSource.connect(musicGain);
			musicGain.connect(master);
			try {
				musicSource.start(0);
			} catch {
				musicSource = null;
			}
			if (import.meta.env.DEV) {
				console.info(
					`[audio] prematch Heaven bed ON (${bpm} BPM, gain→${targetGain})`,
				);
			}
		} else if (import.meta.env.DEV) {
			console.warn(
				"[audio] prematch Heaven bed missing — procedural fallback",
			);
		}

		/** Procedural pad/kick tylko gdy brak pliku — pulse i tak z zegara BPM. */
		const padOsc: OscillatorNode[] = [];
		let padGain: GainNode | null = null;
		if (!musicSource) {
			padGain = ctx.createGain();
			padGain.gain.value = 0.14;
			const padLp = ctx.createBiquadFilter();
			padLp.type = "lowpass";
			padLp.frequency.value = 900;
			for (const f of [65, 98, 130]) {
				const osc = ctx.createOscillator();
				osc.type = "sawtooth";
				osc.frequency.value = f;
				const g = ctx.createGain();
				g.gain.value = 0.2;
				osc.connect(g);
				g.connect(padLp);
				osc.start();
				padOsc.push(osc);
			}
			padLp.connect(padGain);
			padGain.connect(master);
		}

		this.prematchTrance = {
			stopped: false,
			bpm,
			startedAt: now,
			master,
			padGain,
			kickTimer: null,
			padOsc,
			arpTimer: null,
			musicSource,
			musicGain,
		};

		/** Cichy click metronomu tylko dla spójności gdy brak pliku. */
		if (!musicSource) {
			const beatSec = 60 / bpm;
			const fireKick = () => {
				const bed = this.prematchTrance;
				if (!bed || bed.stopped) return;
				const t0 = ctx.currentTime;
				const thump = ctx.createOscillator();
				thump.type = "sine";
				thump.frequency.setValueAtTime(78, t0);
				thump.frequency.exponentialRampToValueAtTime(38, t0 + 0.18);
				const tg = ctx.createGain();
				tg.gain.setValueAtTime(0.0001, t0);
				tg.gain.exponentialRampToValueAtTime(0.42, t0 + 0.008);
				tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
				thump.connect(tg);
				tg.connect(master);
				thump.start(t0);
				thump.stop(t0 + 0.3);
				bed.kickTimer = window.setTimeout(fireKick, beatSec * 1000);
			};
			fireKick();
		}
	}

	stopPrematchTranceBed(): void {
		const bed = this.prematchTrance;
		if (!bed) return;
		bed.stopped = true;
		if (bed.kickTimer != null) {
			window.clearTimeout(bed.kickTimer);
			bed.kickTimer = null;
		}
		if (bed.arpTimer != null) {
			window.clearTimeout(bed.arpTimer);
			bed.arpTimer = null;
		}
		if (bed.musicSource) {
			try {
				bed.musicSource.stop();
			} catch {
				/* */
			}
			bed.musicSource = null;
		}
		for (const osc of bed.padOsc) {
			try {
				osc.stop();
			} catch {
				/* */
			}
		}
		const ctx = this.listener.context;
		const now = ctx.currentTime;
		try {
			bed.master.gain.cancelScheduledValues(now);
			bed.master.gain.setValueAtTime(
				Math.max(0.0001, bed.master.gain.value),
				now,
			);
			bed.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
		} catch {
			/* */
		}
		window.setTimeout(() => {
			try {
				bed.master.disconnect();
				bed.padGain?.disconnect();
				bed.musicGain?.disconnect();
			} catch {
				/* */
			}
		}, 500);
		this.prematchTrance = null;
	}

	getPrematchTrancePulse(): number {
		const bed = this.prematchTrance;
		if (!bed || bed.stopped) return 0;
		const ctx = this.listener.context;
		const beatSec = 60 / bed.bpm;
		const phase = ((ctx.currentTime - bed.startedAt) / beatSec) % 1;
		/** Sharp attack, fast decay — laser punch on downbeats. */
		return Math.exp(-phase * 9) * (phase < 0.5 ? 1 : 0.35);
	}

	private playNextPrematchBedClip(): void {
		const bed = this.prematchBed;
		if (!bed || bed.stopped || bed.buffers.length === 0) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;

		const buf = bed.buffers[bed.idx % bed.buffers.length]!;
		bed.idx = (bed.idx + 1) % bed.buffers.length;
		const source = ctx.createBufferSource();
		source.buffer = buf;
		source.connect(bed.master);
		bed.source = source;
		source.onended = () => {
			if (this.prematchBed !== bed || bed.stopped) return;
			bed.source = null;
			/** Luka między kwestiami — jak distant PA, nie radio-spam. */
			const gapMs = 1400 + Math.random() * 2200;
			bed.timer = window.setTimeout(() => {
				bed.timer = null;
				this.playNextPrematchBedClip();
			}, gapMs);
		};
		try {
			source.start();
		} catch {
			bed.source = null;
		}
	}

	playBoostPadPickup(point: THREE.Vector3, big: boolean): void {
		if (!this.unlocked) return;
		if (this.buffers.get(AUDIO_PATHS.boostPad)) {
			const listenerPos = new THREE.Vector3();
			this.listener.getWorldPosition(listenerPos);
			const dist = listenerPos.distanceTo(point);
			const distAtten = THREE.MathUtils.clamp(1 - (dist - 6) / 55, 0.28, 1);
			const vol = (big ? 0.55 : 0.38) * distAtten;
			this.playListenerSfx(AUDIO_PATHS.boostPad, vol, big ? 0.92 : 1.08);
			return;
		}
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		const now = ctx.currentTime;
		const out = this.listener.getInput();
		const listenerPos = new THREE.Vector3();
		this.listener.getWorldPosition(listenerPos);
		const dist = listenerPos.distanceTo(point);
		const distAtten = THREE.MathUtils.clamp(1 - (dist - 6) / 55, 0.28, 1);
		const base = big ? 640 : 980;
		const vol = (big ? 0.34 : 0.24) * distAtten;

		const ping = ctx.createOscillator();
		ping.type = "sine";
		ping.frequency.setValueAtTime(base, now);
		ping.frequency.exponentialRampToValueAtTime(base * 1.75, now + 0.045);
		ping.frequency.exponentialRampToValueAtTime(base * 0.62, now + 0.2);
		const pingG = ctx.createGain();
		pingG.gain.setValueAtTime(0.0001, now);
		pingG.gain.exponentialRampToValueAtTime(vol, now + 0.006);
		pingG.gain.exponentialRampToValueAtTime(0.0001, now + (big ? 0.26 : 0.18));
		ping.connect(pingG);
		pingG.connect(out);
		ping.start(now);
		ping.stop(now + (big ? 0.28 : 0.2));

		const shimmer = ctx.createOscillator();
		shimmer.type = "triangle";
		shimmer.frequency.setValueAtTime(base * 2.4, now + 0.008);
		shimmer.frequency.exponentialRampToValueAtTime(base * 3.6, now + 0.14);
		const shG = ctx.createGain();
		shG.gain.setValueAtTime(0.0001, now + 0.008);
		shG.gain.exponentialRampToValueAtTime(vol * 0.55, now + 0.018);
		shG.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
		shimmer.connect(shG);
		shG.connect(out);
		shimmer.start(now + 0.008);
		shimmer.stop(now + 0.22);

		/** Mały pad — krótki spatial tick; big — thump + click. */
		this.playBodyThump(big ? 0.42 : 0.14, point);
		if (big) {
			this.duckMusicForImpact(0.28);
			const click = ctx.createOscillator();
			click.type = "square";
			click.frequency.setValueAtTime(180, now);
			click.frequency.exponentialRampToValueAtTime(70, now + 0.08);
			const clickG = ctx.createGain();
			clickG.gain.setValueAtTime(0.0001, now);
			clickG.gain.exponentialRampToValueAtTime(0.18 * distAtten, now + 0.005);
			clickG.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
			click.connect(clickG);
			clickG.connect(out);
			click.start(now);
			click.stop(now + 0.14);
		}
	}

	/** Liftoff — krótki „pop” + sub (1. skok). */
	playJump(intensity = 1, point?: THREE.Vector3): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		const now = ctx.currentTime;
		const out = this.listener.getInput();
		const i = THREE.MathUtils.clamp(intensity, 0.35, 1);

		const pop = ctx.createOscillator();
		pop.type = "triangle";
		pop.frequency.setValueAtTime(220 + i * 80, now);
		pop.frequency.exponentialRampToValueAtTime(90, now + 0.09);
		const popG = ctx.createGain();
		popG.gain.setValueAtTime(0.0001, now);
		popG.gain.exponentialRampToValueAtTime(0.11 * i, now + 0.006);
		popG.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
		pop.connect(popG);
		popG.connect(out);
		pop.start(now);
		pop.stop(now + 0.14);

		const sub = ctx.createOscillator();
		sub.type = "sine";
		sub.frequency.setValueAtTime(95, now);
		sub.frequency.exponentialRampToValueAtTime(48, now + 0.11);
		const subG = ctx.createGain();
		subG.gain.setValueAtTime(0.0001, now);
		subG.gain.exponentialRampToValueAtTime(0.16 * i, now + 0.008);
		subG.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
		sub.connect(subG);
		subG.connect(out);
		sub.start(now);
		sub.stop(now + 0.18);

		if (point) this.playBodyThump(0.12 * i, point);
	}

	/** Dodge / flip — whoosh + metaliczny click. */
	playDodge(point?: THREE.Vector3): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		const now = ctx.currentTime;
		const out = this.listener.getInput();

		const whoosh = ctx.createOscillator();
		whoosh.type = "sawtooth";
		whoosh.frequency.setValueAtTime(380, now);
		whoosh.frequency.exponentialRampToValueAtTime(95, now + 0.2);
		const bp = ctx.createBiquadFilter();
		bp.type = "bandpass";
		bp.frequency.setValueAtTime(900, now);
		bp.Q.value = 0.85;
		const wG = ctx.createGain();
		wG.gain.setValueAtTime(0.0001, now);
		wG.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
		wG.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
		whoosh.connect(bp);
		bp.connect(wG);
		wG.connect(out);
		whoosh.start(now);
		whoosh.stop(now + 0.26);

		const click = ctx.createOscillator();
		click.type = "square";
		click.frequency.setValueAtTime(640, now);
		click.frequency.exponentialRampToValueAtTime(180, now + 0.07);
		const cG = ctx.createGain();
		cG.gain.setValueAtTime(0.0001, now);
		cG.gain.exponentialRampToValueAtTime(0.08, now + 0.005);
		cG.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
		click.connect(cG);
		cG.connect(out);
		click.start(now);
		click.stop(now + 0.1);

		if (point) this.playBodyThump(0.22, point);
	}

	/** Double jump (bez flipa) — wyższy, krótszy pop. */
	playDoubleJump(point?: THREE.Vector3): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		const now = ctx.currentTime;
		const out = this.listener.getInput();

		const pop = ctx.createOscillator();
		pop.type = "sine";
		pop.frequency.setValueAtTime(340, now);
		pop.frequency.exponentialRampToValueAtTime(140, now + 0.08);
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, now);
		g.gain.exponentialRampToValueAtTime(0.1, now + 0.005);
		g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
		pop.connect(g);
		g.connect(out);
		pop.start(now);
		pop.stop(now + 0.12);

		if (point) this.playBodyThump(0.1, point);
	}

	/** Lądowanie — thud zależny od siły (0–1). */
	playLanding(intensity: number, point?: THREE.Vector3): void {
		if (!this.unlocked || intensity < 0.12) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		const now = ctx.currentTime;
		const out = this.listener.getInput();
		const i = THREE.MathUtils.clamp(intensity, 0.12, 1);

		const thud = ctx.createOscillator();
		thud.type = "triangle";
		thud.frequency.setValueAtTime(140 - i * 40, now);
		thud.frequency.exponentialRampToValueAtTime(48, now + 0.1 + i * 0.06);
		const tG = ctx.createGain();
		tG.gain.setValueAtTime(0.0001, now);
		tG.gain.exponentialRampToValueAtTime(0.08 + i * 0.2, now + 0.006);
		tG.gain.exponentialRampToValueAtTime(0.0001, now + 0.14 + i * 0.1);
		thud.connect(tG);
		tG.connect(out);
		thud.start(now);
		thud.stop(now + 0.28);

		const noiseLen = Math.floor(ctx.sampleRate * (0.05 + i * 0.04));
		const nBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
		const data = nBuf.getChannelData(0);
		for (let k = 0; k < data.length; k++) {
			data[k] = (Math.random() * 2 - 1) * (1 - k / data.length);
		}
		const noise = ctx.createBufferSource();
		noise.buffer = nBuf;
		const hp = ctx.createBiquadFilter();
		hp.type = "lowpass";
		hp.frequency.value = 800 + i * 600;
		const nG = ctx.createGain();
		nG.gain.setValueAtTime(0.0001, now);
		nG.gain.exponentialRampToValueAtTime(0.06 + i * 0.1, now + 0.004);
		nG.gain.exponentialRampToValueAtTime(0.0001, now + 0.08 + i * 0.05);
		noise.connect(hp);
		hp.connect(nG);
		nG.connect(out);
		noise.start(now);
		noise.stop(now + 0.14);

		if (point && i > 0.35) this.playBodyThump(i * 0.45, point);
	}

	/**
	 * Uderzenie auta w piłkę — z fizyki gry (siła zależna od prędkości / kąta).
	 * Soft touch też słyszalny (cichy thump); mocne strzały duckują muzykę.
	 */
	playBallHit(impact: number, point: THREE.Vector3): void {
		if (!this.unlocked || impact < 0.85) return;
		if (impact < GAMEPLAY_BALL_HIT_MIN) {
			const soft = THREE.MathUtils.clamp((impact - 0.85) / 1.2, 0.05, 0.35);
			this.playSpatialImpact("carBall", soft * 0.55, point, 0.55);
			return;
		}
		const intensity = THREE.MathUtils.clamp((impact - 2) / 22, 0.08, 1);
		this.playSpatialImpact("carBall", intensity, point, 1.22);
		/** Mocny hit = krótki thump; nie dubluj przy każdym ticku (brzmiało jak trawa/hamowanie). */
		if (intensity >= 0.45) {
			this.duckMusicForImpact(intensity);
			this.playBodyThump(intensity * 0.35, point);
		}
	}

	playQuickChatPing(): void {
		this.playListenerSfx(AUDIO_PATHS.countdownTick, 0.2, 1.4);
	}

	/** Drop skrzynki — narastający buzz/szum przy spadku + thud przy lądowaniu. */
	playCrateDropImpact(): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		const now = ctx.currentTime;
		const out = this.listener.getInput();
		const fall = 0.52;

		// Narastający buzz (spin energy).
		const buzz = ctx.createOscillator();
		buzz.type = "sawtooth";
		buzz.frequency.setValueAtTime(70, now);
		buzz.frequency.exponentialRampToValueAtTime(520, now + fall * 0.85);
		buzz.frequency.exponentialRampToValueAtTime(180, now + fall);
		const buzzLp = ctx.createBiquadFilter();
		buzzLp.type = "bandpass";
		buzzLp.frequency.setValueAtTime(400, now);
		buzzLp.frequency.exponentialRampToValueAtTime(2200, now + fall * 0.8);
		buzzLp.Q.value = 3.2;
		const buzzG = ctx.createGain();
		buzzG.gain.setValueAtTime(0.0001, now);
		buzzG.gain.exponentialRampToValueAtTime(0.11, now + 0.08);
		buzzG.gain.exponentialRampToValueAtTime(0.16, now + fall * 0.75);
		buzzG.gain.exponentialRampToValueAtTime(0.0001, now + fall + 0.06);
		buzz.connect(buzzLp);
		buzzLp.connect(buzzG);
		buzzG.connect(out);
		buzz.start(now);
		buzz.stop(now + fall + 0.08);

		// Szum / whoosh.
		const noise = ctx.createBufferSource();
		const nBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * (fall + 0.08)), ctx.sampleRate);
		const data = nBuf.getChannelData(0);
		for (let i = 0; i < data.length; i++) {
			const t = i / data.length;
			data[i] = (Math.random() * 2 - 1) * (0.25 + t * 0.9) * (1 - t * 0.35);
		}
		noise.buffer = nBuf;
		const hp = ctx.createBiquadFilter();
		hp.type = "highpass";
		hp.frequency.setValueAtTime(600, now);
		hp.frequency.exponentialRampToValueAtTime(2800, now + fall);
		const ng = ctx.createGain();
		ng.gain.setValueAtTime(0.0001, now);
		ng.gain.exponentialRampToValueAtTime(0.09, now + fall * 0.55);
		ng.gain.exponentialRampToValueAtTime(0.0001, now + fall + 0.05);
		noise.connect(hp);
		hp.connect(ng);
		ng.connect(out);
		noise.start(now);
		noise.stop(now + fall + 0.06);

		// Thud przy lądowaniu.
		const land = now + fall * 0.92;
		const sub = ctx.createOscillator();
		sub.type = "sine";
		sub.frequency.setValueAtTime(120, land);
		sub.frequency.exponentialRampToValueAtTime(42, land + 0.28);
		const subG = ctx.createGain();
		subG.gain.setValueAtTime(0.0001, land);
		subG.gain.exponentialRampToValueAtTime(0.4, land + 0.02);
		subG.gain.exponentialRampToValueAtTime(0.0001, land + 0.38);
		sub.connect(subG);
		subG.connect(out);
		sub.start(land);
		sub.stop(land + 0.4);

		const thud = ctx.createOscillator();
		thud.type = "triangle";
		thud.frequency.setValueAtTime(200, land);
		thud.frequency.exponentialRampToValueAtTime(65, land + 0.16);
		const thudG = ctx.createGain();
		thudG.gain.setValueAtTime(0.0001, land);
		thudG.gain.exponentialRampToValueAtTime(0.18, land + 0.012);
		thudG.gain.exponentialRampToValueAtTime(0.0001, land + 0.22);
		thud.connect(thudG);
		thudG.connect(out);
		thud.start(land);
		thud.stop(land + 0.24);

		this.musicDuckUntil = performance.now() + fall * 1000 + 280;
		this.updateMusicDuck();
	}

	/** Narastające napięcie przed otwarciem (suspense). */
	playCrateSuspenseRise(durationSec = 1.55): void {
		this.stopCrateTension();
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		const now = ctx.currentTime;
		const out = this.listener.getInput();
		const dur = Math.max(0.4, durationSec);

		const drone = ctx.createOscillator();
		drone.type = "sawtooth";
		drone.frequency.setValueAtTime(92, now);
		drone.frequency.exponentialRampToValueAtTime(210, now + dur);
		const droneFilter = ctx.createBiquadFilter();
		droneFilter.type = "lowpass";
		droneFilter.frequency.setValueAtTime(320, now);
		droneFilter.frequency.exponentialRampToValueAtTime(2400, now + dur);
		droneFilter.Q.value = 6;
		const droneG = ctx.createGain();
		droneG.gain.setValueAtTime(0.0001, now);
		droneG.gain.exponentialRampToValueAtTime(0.055, now + 0.12);
		droneG.gain.exponentialRampToValueAtTime(0.12, now + dur * 0.85);
		droneG.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.08);
		drone.connect(droneFilter);
		droneFilter.connect(droneG);
		droneG.connect(out);
		drone.start(now);
		drone.stop(now + dur + 0.1);

		const pulse = ctx.createOscillator();
		pulse.type = "sine";
		pulse.frequency.setValueAtTime(220, now);
		pulse.frequency.exponentialRampToValueAtTime(540, now + dur);
		const pulseG = ctx.createGain();
		pulseG.gain.setValueAtTime(0.0001, now);
		// Ręczne „bicie serca” — krótkie peak'i rosnące w czasie.
		const beats = Math.max(4, Math.floor(dur * 4.5));
		for (let i = 0; i < beats; i++) {
			const t = now + (i / beats) * dur;
			const peak = 0.02 + (i / beats) * 0.07;
			pulseG.gain.setValueAtTime(0.0001, t);
			pulseG.gain.exponentialRampToValueAtTime(peak, t + 0.03);
			pulseG.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
		}
		pulse.connect(pulseG);
		pulseG.connect(out);
		pulse.start(now);
		pulse.stop(now + dur + 0.05);

		const hiss = ctx.createBufferSource();
		const hBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
		const hData = hBuf.getChannelData(0);
		for (let i = 0; i < hData.length; i++) {
			const t = i / hData.length;
			hData[i] = (Math.random() * 2 - 1) * (0.15 + t * 0.85) * 0.35;
		}
		hiss.buffer = hBuf;
		const bp = ctx.createBiquadFilter();
		bp.type = "bandpass";
		bp.frequency.setValueAtTime(1400, now);
		bp.frequency.exponentialRampToValueAtTime(4200, now + dur);
		bp.Q.value = 0.9;
		const hg = ctx.createGain();
		hg.gain.setValueAtTime(0.0001, now);
		hg.gain.exponentialRampToValueAtTime(0.045, now + dur * 0.7);
		hg.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.05);
		hiss.connect(bp);
		bp.connect(hg);
		hg.connect(out);
		hiss.start(now);
		hiss.stop(now + dur + 0.02);

		this.crateTensionStoppers.push(() => {
			try {
				drone.stop();
			} catch {
				/* ended */
			}
			try {
				pulse.stop();
			} catch {
				/* ended */
			}
			try {
				hiss.stop();
			} catch {
				/* ended */
			}
		});

		this.musicDuckUntil = performance.now() + dur * 1000 + 200;
		this.updateMusicDuck();
	}

	/** Charge przed wybuchem — szybki riser + drżenie. */
	playCrateCharge(durationSec = 0.62): void {
		this.stopCrateTension();
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		const now = ctx.currentTime;
		const out = this.listener.getInput();
		const dur = Math.max(0.25, durationSec);

		const riser = ctx.createOscillator();
		riser.type = "sawtooth";
		riser.frequency.setValueAtTime(180, now);
		riser.frequency.exponentialRampToValueAtTime(980, now + dur);
		const rf = ctx.createBiquadFilter();
		rf.type = "bandpass";
		rf.frequency.setValueAtTime(600, now);
		rf.frequency.exponentialRampToValueAtTime(2800, now + dur);
		rf.Q.value = 4.5;
		const rg = ctx.createGain();
		rg.gain.setValueAtTime(0.0001, now);
		rg.gain.exponentialRampToValueAtTime(0.14, now + dur * 0.75);
		rg.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.05);
		riser.connect(rf);
		rf.connect(rg);
		rg.connect(out);
		riser.start(now);
		riser.stop(now + dur + 0.06);

		const sub = ctx.createOscillator();
		sub.type = "sine";
		sub.frequency.setValueAtTime(55, now);
		sub.frequency.exponentialRampToValueAtTime(90, now + dur);
		const sg = ctx.createGain();
		sg.gain.setValueAtTime(0.0001, now);
		sg.gain.exponentialRampToValueAtTime(0.22, now + dur * 0.6);
		sg.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.04);
		sub.connect(sg);
		sg.connect(out);
		sub.start(now);
		sub.stop(now + dur + 0.05);

		this.crateTensionStoppers.push(() => {
			try {
				riser.stop();
			} catch {
				/* ended */
			}
			try {
				sub.stop();
			} catch {
				/* ended */
			}
		});

		this.musicDuckUntil = performance.now() + dur * 1000 + 180;
		this.updateMusicDuck();
	}

	stopCrateTension(): void {
		for (const stop of this.crateTensionStoppers) {
			try {
				stop();
			} catch {
				/* already stopped */
			}
		}
		this.crateTensionStoppers = [];
	}

	/** Otwarcie skrzynki — dłuższa, głośniejsza fanfara + body + shimmer. */
	playCrateReveal(rarity: "common" | "rare" | "epic" | "legendary" = "rare"): void {
		this.stopCrateTension();
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		const now = ctx.currentTime;
		const out = this.listener.getInput();
		const bright =
			rarity === "legendary"
				? 1
				: rarity === "epic"
					? 0.92
					: rarity === "rare"
						? 0.82
						: 0.68;
		const sustain = rarity === "legendary" ? 1.85 : rarity === "epic" ? 1.55 : 1.35;

		// Body hit — głęboki sub, dłuższy decay.
		const sub = ctx.createOscillator();
		sub.type = "sine";
		sub.frequency.setValueAtTime(78, now);
		sub.frequency.exponentialRampToValueAtTime(36, now + 0.55);
		const subG = ctx.createGain();
		subG.gain.setValueAtTime(0.0001, now);
		subG.gain.exponentialRampToValueAtTime(0.72 * bright, now + 0.03);
		subG.gain.exponentialRampToValueAtTime(0.28 * bright, now + 0.35);
		subG.gain.exponentialRampToValueAtTime(0.0001, now + sustain * 0.85);
		sub.connect(subG);
		subG.connect(out);
		sub.start(now);
		sub.stop(now + sustain);

		const thud = ctx.createOscillator();
		thud.type = "triangle";
		thud.frequency.setValueAtTime(160, now);
		thud.frequency.exponentialRampToValueAtTime(55, now + 0.28);
		const thudG = ctx.createGain();
		thudG.gain.setValueAtTime(0.0001, now);
		thudG.gain.exponentialRampToValueAtTime(0.38 * bright, now + 0.018);
		thudG.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
		thud.connect(thudG);
		thudG.connect(out);
		thud.start(now);
		thud.stop(now + 0.48);

		const freqs =
			rarity === "legendary"
				? [392, 523.25, 659.25, 784, 1046.5]
				: rarity === "epic"
					? [349.23, 440, 554.37, 698.46]
					: [329.63, 415.3, 493.88, 659.25];
		for (let i = 0; i < freqs.length; i++) {
			const o = ctx.createOscillator();
			o.type = i === 0 ? "triangle" : "sine";
			const t0 = now + i * 0.055;
			o.frequency.setValueAtTime(freqs[i]!, t0);
			const g = ctx.createGain();
			const peak = 0.28 * bright * (1 - i * 0.08);
			g.gain.setValueAtTime(0.0001, t0);
			g.gain.exponentialRampToValueAtTime(peak, t0 + 0.045);
			g.gain.exponentialRampToValueAtTime(peak * 0.55, t0 + sustain * 0.45);
			g.gain.exponentialRampToValueAtTime(0.0001, t0 + sustain);
			o.connect(g);
			g.connect(out);
			o.start(t0);
			o.stop(t0 + sustain + 0.05);
		}

		// Whoosh / confetti noise — dłuższy.
		const noiseLen = Math.max(0.55, sustain * 0.55);
		const noise = ctx.createBufferSource();
		const nBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * noiseLen), ctx.sampleRate);
		const data = nBuf.getChannelData(0);
		for (let i = 0; i < data.length; i++) {
			const t = i / data.length;
			data[i] = (Math.random() * 2 - 1) * (1 - t) ** 1.15;
		}
		noise.buffer = nBuf;
		const bp = ctx.createBiquadFilter();
		bp.type = "bandpass";
		bp.frequency.setValueAtTime(1400, now);
		bp.frequency.exponentialRampToValueAtTime(3200, now + noiseLen * 0.4);
		bp.Q.value = 0.55;
		const ng = ctx.createGain();
		ng.gain.setValueAtTime(0.0001, now);
		ng.gain.exponentialRampToValueAtTime(0.28 * bright, now + 0.03);
		ng.gain.exponentialRampToValueAtTime(0.0001, now + noiseLen);
		noise.connect(bp);
		bp.connect(ng);
		ng.connect(out);
		noise.start(now);
		noise.stop(now + noiseLen + 0.02);

		// Shimmer / sparkle tail.
		const shimmer = ctx.createOscillator();
		shimmer.type = "sine";
		shimmer.frequency.setValueAtTime(1240, now + 0.08);
		shimmer.frequency.exponentialRampToValueAtTime(2200, now + sustain * 0.7);
		const shG = ctx.createGain();
		shG.gain.setValueAtTime(0.0001, now + 0.08);
		shG.gain.exponentialRampToValueAtTime(0.09 * bright, now + 0.18);
		shG.gain.exponentialRampToValueAtTime(0.0001, now + sustain);
		shimmer.connect(shG);
		shG.connect(out);
		shimmer.start(now + 0.08);
		shimmer.stop(now + sustain + 0.02);

		this.musicDuckUntil = performance.now() + sustain * 1000 + 400;
		this.updateMusicDuck();
	}

	/** Warstwa uderzeniowa pod sample gola — sub + szum tłumu. */
	private playGoalCrowdSwell(team: ScoringTeam): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;

		const now = ctx.currentTime;
		const out = this.listener.getInput();

		const sub = ctx.createOscillator();
		sub.type = "sine";
		sub.frequency.setValueAtTime(team === "blue" ? 92 : 78, now);
		sub.frequency.exponentialRampToValueAtTime(34, now + 0.38);
		const subGain = ctx.createGain();
		subGain.gain.setValueAtTime(0.0001, now);
		subGain.gain.exponentialRampToValueAtTime(1.28, now + 0.018);
		subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
		sub.connect(subGain);
		subGain.connect(out);
		sub.start(now);
		sub.stop(now + 0.95);

		const len = Math.floor(ctx.sampleRate * 0.85);
		const noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
		const noiseData = noiseBuf.getChannelData(0);
		for (let i = 0; i < len; i++) {
			const t = i / len;
			noiseData[i] = (Math.random() * 2 - 1) * (1 - t) ** 1.45 * 0.72;
		}
		const noise = ctx.createBufferSource();
		noise.buffer = noiseBuf;
		const band = ctx.createBiquadFilter();
		band.type = "bandpass";
		band.frequency.value = team === "blue" ? 920 : 760;
		band.Q.value = 0.55;
		const crowdGain = ctx.createGain();
		crowdGain.gain.setValueAtTime(0.0001, now);
		crowdGain.gain.exponentialRampToValueAtTime(0.72, now + 0.05);
		crowdGain.gain.exponentialRampToValueAtTime(0.38, now + 0.35);
		crowdGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
		noise.connect(band);
		band.connect(crowdGain);
		crowdGain.connect(out);
		noise.start(now);
		noise.stop(now + 1.2);

		/** Drugi pas — szerszy „roar” areny, dłużej niż punch sample. */
		const roarLen = Math.floor(ctx.sampleRate * 1.15);
		const roarBuf = ctx.createBuffer(1, roarLen, ctx.sampleRate);
		const roarData = roarBuf.getChannelData(0);
		for (let i = 0; i < roarLen; i++) {
			const t = i / roarLen;
			roarData[i] = (Math.random() * 2 - 1) * (1 - t) ** 1.1 * 0.4;
		}
		const roar = ctx.createBufferSource();
		roar.buffer = roarBuf;
		const roarBand = ctx.createBiquadFilter();
		roarBand.type = "lowpass";
		roarBand.frequency.value = team === "blue" ? 1400 : 1180;
		roarBand.Q.value = 0.4;
		const roarGain = ctx.createGain();
		roarGain.gain.setValueAtTime(0.0001, now);
		roarGain.gain.exponentialRampToValueAtTime(0.48, now + 0.1);
		roarGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.35);
		roar.connect(roarBand);
		roarBand.connect(roarGain);
		roarGain.connect(out);
		roar.start(now);
		roar.stop(now + 1.4);
	}

	playKickoff(): void {
		this.playCountdownIgnite();
	}

	/** Demolish boom — sample Mixkit + lekki procedural thump. */
	playDemolishBoom(intensity = 1): void {
		if (!this.unlocked) return;
		const k = THREE.MathUtils.clamp(intensity, 0.45, 1.35);
		this.duckMusicForImpact(0.55 * k);
		if (this.buffers.get(AUDIO_PATHS.demolish)) {
			this.playListenerSfx(AUDIO_PATHS.demolish, 0.72 * k, 0.92 + k * 0.08);
		}
		if (this.buffers.get(AUDIO_PATHS.demolishImpact)) {
			this.playListenerSfx(
				AUDIO_PATHS.demolishImpact,
				0.45 * k,
				0.95 + Math.random() * 0.08,
			);
		}
		if (
			!this.buffers.get(AUDIO_PATHS.demolish) &&
			!this.buffers.get(AUDIO_PATHS.demolishImpact)
		) {
			this.playDemolishBoomProcedural(k);
		}
	}

	private playDemolishBoomProcedural(k: number): void {
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		const now = ctx.currentTime;
		const out = this.listener.getInput();

		const thump = ctx.createOscillator();
		thump.type = "sine";
		thump.frequency.setValueAtTime(88, now);
		thump.frequency.exponentialRampToValueAtTime(38, now + 0.22);
		const thumpGain = ctx.createGain();
		thumpGain.gain.setValueAtTime(0.0001, now);
		thumpGain.gain.exponentialRampToValueAtTime(0.42 * k, now + 0.018);
		thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
		thump.connect(thumpGain);
		thumpGain.connect(out);
		thump.start(now);
		thump.stop(now + 0.34);
	}

	/**
	 * Ignite Quake — sub-bass rumble + floor noise (trzęsienie stadionu).
	 * Osobno od demolish boom — dłuższy, niższy, „ziemia się trzęsie”.
	 */
	playIgniteQuake(intensity = 1): void {
		if (!this.unlocked) return;
		const k = THREE.MathUtils.clamp(intensity, 0.35, 1.35);
		this.duckMusicForImpact(0.42 * k);
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		const now = ctx.currentTime;
		const out = this.listener.getInput();

		const sub = ctx.createOscillator();
		sub.type = "sine";
		sub.frequency.setValueAtTime(52, now);
		sub.frequency.exponentialRampToValueAtTime(24, now + 0.55);
		const subGain = ctx.createGain();
		subGain.gain.setValueAtTime(0.0001, now);
		subGain.gain.exponentialRampToValueAtTime(0.55 * k, now + 0.03);
		subGain.gain.exponentialRampToValueAtTime(0.22 * k, now + 0.22);
		subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);
		sub.connect(subGain);
		subGain.connect(out);
		sub.start(now);
		sub.stop(now + 0.75);

		const rumble = ctx.createOscillator();
		rumble.type = "triangle";
		rumble.frequency.setValueAtTime(38, now);
		rumble.frequency.exponentialRampToValueAtTime(18, now + 0.45);
		const rumbleGain = ctx.createGain();
		rumbleGain.gain.setValueAtTime(0.0001, now);
		rumbleGain.gain.exponentialRampToValueAtTime(0.28 * k, now + 0.04);
		rumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.58);
		rumble.connect(rumbleGain);
		rumbleGain.connect(out);
		rumble.start(now);
		rumble.stop(now + 0.6);

		const noiseBuf = ctx.createBuffer(
			1,
			Math.floor(ctx.sampleRate * 0.42),
			ctx.sampleRate,
		);
		const data = noiseBuf.getChannelData(0);
		for (let i = 0; i < data.length; i++) {
			const env = 1 - i / data.length;
			data[i] = (Math.random() * 2 - 1) * env * env;
		}
		const noise = ctx.createBufferSource();
		noise.buffer = noiseBuf;
		const low = ctx.createBiquadFilter();
		low.type = "lowpass";
		low.frequency.value = 180;
		low.Q.value = 0.7;
		const noiseGain = ctx.createGain();
		noiseGain.gain.setValueAtTime(0.0001, now);
		noiseGain.gain.exponentialRampToValueAtTime(0.32 * k, now + 0.02);
		noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
		noise.connect(low);
		low.connect(noiseGain);
		noiseGain.connect(out);
		noise.start(now);
		noise.stop(now + 0.5);
	}

	/**
	 * Kickoff 5…1 — sample Mixkit (stadium bleep), fallback procedural.
	 * Im bliżej 1, tym wyższy sample (countdown_5 → countdown_1).
	 */
	playCountdownTick(step: number): void {
		const path = countdownTickPath(step);
		if (this.unlocked && this.buffers.get(path)) {
			this.playListenerSfx(path, 0.78, 1);
		} else if (this.unlocked && this.buffers.get(AUDIO_PATHS.countdownTick)) {
			const s = THREE.MathUtils.clamp(Math.round(step), 1, 5);
			const rate = 0.86 + ((6 - s) / 5) * 0.32;
			this.playListenerSfx(AUDIO_PATHS.countdownTick, 0.72, rate);
		} else {
			this.playCountdownBeep(step);
		}
		const tension = THREE.MathUtils.clamp((6 - step) / 5, 0.2, 1);
		this.duckMusicForImpact(0.18 + tension * 0.16);
	}

	playCountdownIgnite(): void {
		/** Buzzer+horn kickoff + GO sample — sync z HUD FOV punch. */
		if (this.unlocked) {
			if (this.buffers.get(AUDIO_PATHS.kickoff)) {
				this.playListenerSfx(AUDIO_PATHS.kickoff, 0.82, 1);
			}
			if (this.buffers.get(AUDIO_PATHS.countdownGo)) {
				this.playListenerSfx(AUDIO_PATHS.countdownGo, 0.55, 1);
			}
			this.duckMusicForImpact(0.52);
		}
		if (
			!this.buffers.get(AUDIO_PATHS.kickoff) &&
			!this.buffers.get(AUDIO_PATHS.countdownGo)
		) {
			this.playCountdownGo();
		}
	}

	/** Flip reset — krótki crystal ping (RL Season 22 cue). */
	playFlipResetCue(): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		const now = ctx.currentTime;
		const out = this.listener.getInput();

		const osc = ctx.createOscillator();
		osc.type = "sine";
		osc.frequency.setValueAtTime(880, now);
		osc.frequency.exponentialRampToValueAtTime(1320, now + 0.06);
		osc.frequency.exponentialRampToValueAtTime(660, now + 0.18);
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0.0001, now);
		gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
		gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
		osc.connect(gain);
		gain.connect(out);
		osc.start(now);
		osc.stop(now + 0.24);

		const click = ctx.createOscillator();
		click.type = "triangle";
		click.frequency.setValueAtTime(2400, now);
		click.frequency.exponentialRampToValueAtTime(400, now + 0.08);
		const clickGain = ctx.createGain();
		clickGain.gain.setValueAtTime(0.0001, now);
		clickGain.gain.exponentialRampToValueAtTime(0.09, now + 0.008);
		clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
		click.connect(clickGain);
		clickGain.connect(out);
		click.start(now);
		click.stop(now + 0.12);
	}

	/** Meridian — przecięcie równika (whoosh + click). */
	playMeridianCross(team: "blue" | "orange" = "blue"): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;

		const now = ctx.currentTime;
		const out = this.listener.getInput();
		const base = team === "blue" ? 620 : 480;

		const whoosh = ctx.createOscillator();
		whoosh.type = "sawtooth";
		whoosh.frequency.setValueAtTime(base * 1.4, now);
		whoosh.frequency.exponentialRampToValueAtTime(base * 0.35, now + 0.18);
		const whooshGain = ctx.createGain();
		whooshGain.gain.setValueAtTime(0.0001, now);
		whooshGain.gain.exponentialRampToValueAtTime(0.28, now + 0.012);
		whooshGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
		const whooshFilter = ctx.createBiquadFilter();
		whooshFilter.type = "bandpass";
		whooshFilter.frequency.setValueAtTime(1400, now);
		whooshFilter.Q.value = 0.7;
		whoosh.connect(whooshFilter);
		whooshFilter.connect(whooshGain);
		whooshGain.connect(out);
		whoosh.start(now);
		whoosh.stop(now + 0.24);

		const click = ctx.createOscillator();
		click.type = "square";
		click.frequency.setValueAtTime(base * 2.1, now + 0.02);
		click.frequency.exponentialRampToValueAtTime(base * 0.8, now + 0.08);
		const clickGain = ctx.createGain();
		clickGain.gain.setValueAtTime(0.0001, now + 0.02);
		clickGain.gain.exponentialRampToValueAtTime(0.18, now + 0.028);
		clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
		click.connect(clickGain);
		clickGain.connect(out);
		click.start(now + 0.02);
		click.stop(now + 0.12);
	}

	/** Metaliczny „clang” przy słupku / poprzeczce. */
	playPostHit(point: THREE.Vector3): void {
		if (!this.unlocked) return;
		this.playSpatialImpact("ballWall", 0.72, point, 1.35);
		this.duckMusicForImpact(0.35);
	}

	/** Jednorazowy sygnał przy spadku boosta poniżej 20%. */
	playBoostLowWarning(): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		const startAt = ctx.currentTime + 0.01;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = "sine";
		osc.frequency.setValueAtTime(880, startAt);
		osc.frequency.exponentialRampToValueAtTime(520, startAt + 0.12);
		gain.gain.setValueAtTime(0.0001, startAt);
		gain.gain.exponentialRampToValueAtTime(0.09, startAt + 0.012);
		gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.14);
		osc.connect(gain);
		gain.connect(this.listener.getInput());
		osc.start(startAt);
		osc.stop(startAt + 0.16);
	}

	/** Wczytaj wszystkie bufory audio przed startem (bez odtwarzania). */
	async preloadAssets(): Promise<void> {
		await this.ensureLoaded();
	}

	/**
	 * Lekki warmup po preload — przy poluzowanym autoplay (Electron) od razu start muzyki.
	 */
	async warmupAudio(): Promise<void> {
		await this.ensureLoaded();
		const ctx = this.listener.context;
		if (ctx.state !== "running") {
			try {
				await ctx.resume();
			} catch {
				/* browser gesture gate */
			}
		}
		if (ctx.state === "running") {
			await this.unlock();
			return;
		}

		const kickoff = this.buffers.get(AUDIO_PATHS.kickoff);
		if (kickoff) this.playBufferSilent(kickoff, 0.0001);

		const impact = this.impactPools.get("carBall")?.[0];
		if (impact) this.playBufferSilent(impact, 0.0001);
	}

	/** Prekompilacja ścieżki PositionalAudio — bez alokacji przy pierwszym uderzeniu. */
	warmupSpatialImpacts(): void {
		if (!this.unlocked) return;
		this.ensureSpatialPool();
		const hidden = new THREE.Vector3(0, -800, 0);
		for (const kind of ["carBall", "ballWall", "carWall"] as ImpactKind[]) {
			this.playSpatialImpact(kind, 0.35, hidden, 0.0001);
		}
	}

	private playBufferSilent(buffer: AudioBuffer, volume: number): void {
		const sfx = new Audio(this.listener);
		sfx.setBuffer(buffer);
		sfx.setVolume(volume);
		sfx.play();
		sfx.onEnded = () => sfx.disconnect();
	}

	/**
	 * Klasyczny countdown beep — krótki, czytelny, bez areny-echo wash.
	 * `step` = cyfra 5…1 — wyżej bliżej startu.
	 */
	private playCountdownBeep(step: number): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;

		const now = ctx.currentTime;
		const out = this.listener.getInput();
		const s = THREE.MathUtils.clamp(Math.round(step), 1, 5);
		const tension = (6 - s) / 5;
		const beepHz = 620 + tension * 460;
		const attackVol = 0.24 + tension * 0.16;
		const ringSec = 0.12 + tension * 0.05;

		const beep = ctx.createOscillator();
		beep.type = "sine";
		beep.frequency.setValueAtTime(beepHz, now);
		const beepGain = ctx.createGain();
		beepGain.gain.setValueAtTime(0.0001, now);
		beepGain.gain.exponentialRampToValueAtTime(attackVol, now + 0.003);
		beepGain.gain.exponentialRampToValueAtTime(0.0001, now + ringSec);
		beep.connect(beepGain);
		beepGain.connect(out);
		beep.start(now);
		beep.stop(now + ringSec + 0.02);

		const harm = ctx.createOscillator();
		harm.type = "triangle";
		harm.frequency.setValueAtTime(beepHz * 2, now);
		const harmGain = ctx.createGain();
		harmGain.gain.setValueAtTime(0.0001, now);
		harmGain.gain.exponentialRampToValueAtTime(attackVol * 0.14, now + 0.002);
		harmGain.gain.exponentialRampToValueAtTime(0.0001, now + ringSec * 0.7);
		harm.connect(harmGain);
		harmGain.connect(out);
		harm.start(now);
		harm.stop(now + ringSec);
	}

	/** GO — niski thump eksplozji + chord, duck muzyki. */
	private playCountdownGo(): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;

		const now = ctx.currentTime;
		const out = this.listener.getInput();
		this.duckMusicForImpact(0.55);

		const boomBuf = ctx.createBuffer(
			1,
			Math.floor(ctx.sampleRate * 0.28),
			ctx.sampleRate,
		);
		const boomData = boomBuf.getChannelData(0);
		for (let i = 0; i < boomData.length; i++) {
			const t = i / boomData.length;
			boomData[i] = (Math.random() * 2 - 1) * (1 - t) ** 2.4;
		}
		const boomSrc = ctx.createBufferSource();
		boomSrc.buffer = boomBuf;
		const boomFilter = ctx.createBiquadFilter();
		boomFilter.type = "lowpass";
		boomFilter.frequency.setValueAtTime(280, now);
		boomFilter.frequency.exponentialRampToValueAtTime(90, now + 0.22);
		const boomGain = ctx.createGain();
		boomGain.gain.setValueAtTime(0.0001, now);
		boomGain.gain.exponentialRampToValueAtTime(0.55, now + 0.012);
		boomGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
		boomSrc.connect(boomFilter);
		boomFilter.connect(boomGain);
		boomGain.connect(out);
		boomSrc.start(now);
		boomSrc.stop(now + 0.35);

		const sub = ctx.createOscillator();
		sub.type = "sine";
		sub.frequency.setValueAtTime(55, now);
		sub.frequency.exponentialRampToValueAtTime(32, now + 0.28);
		const subG = ctx.createGain();
		subG.gain.setValueAtTime(0.0001, now);
		subG.gain.exponentialRampToValueAtTime(0.36, now + 0.01);
		subG.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
		sub.connect(subG);
		subG.connect(out);
		sub.start(now);
		sub.stop(now + 0.4);

		const freqs = [523.25, 659.25, 783.99, 1046.5];
		for (let i = 0; i < freqs.length; i++) {
			const osc = ctx.createOscillator();
			osc.type = i === 0 ? "triangle" : "sine";
			osc.frequency.setValueAtTime(freqs[i]!, now + 0.04);
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.0001, now + 0.04);
			g.gain.exponentialRampToValueAtTime(0.16 - i * 0.024, now + 0.055);
			g.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);
			osc.connect(g);
			g.connect(out);
			osc.start(now + 0.04);
			osc.stop(now + 0.65);
		}

		const sparkle = ctx.createOscillator();
		sparkle.type = "sine";
		sparkle.frequency.setValueAtTime(1680, now + 0.05);
		sparkle.frequency.exponentialRampToValueAtTime(720, now + 0.32);
		const sg = ctx.createGain();
		sg.gain.setValueAtTime(0.0001, now + 0.05);
		sg.gain.exponentialRampToValueAtTime(0.1, now + 0.06);
		sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
		sparkle.connect(sg);
		sg.connect(out);
		sparkle.start(now + 0.05);
		sparkle.stop(now + 0.4);
	}

	/** Przed kickoffem — następny utwór z playlisty (rotacja między meczami). */
	beginMatchMusic(): void {
		if (this.musicBuffers.length <= 1) return;
		if (this.matchMusicSessionStarted) {
			this.musicTrackIndex =
				(this.musicTrackIndex + 1) % this.musicBuffers.length;
			if (!this.unlocked) {
				this.pendingMatchMusicAdvance = true;
				return;
			}
			if (this.matchMusicSource) {
				this.playMusicTrack(this.musicTrackIndex);
			}
		}
		this.matchMusicSessionStarted = true;
	}

	/**
	 * Pre-match stadium show — przyciszenie + cieplejszy „pogłos trybun”.
	 */
	setStadiumShowMix(active: boolean): void {
		this.stadiumShowMix = active;
		if (this.arenaEchoWet) {
			this.arenaEchoWet.gain.value = active ? 0.72 : 0.32;
		}
		if (this.arenaEchoFeedback) {
			this.arenaEchoFeedback.gain.value = active ? 0.52 : 0.34;
		}

		if (this.stadiumShowMusicSend) {
			try {
				this.stadiumShowMusicSend.disconnect();
			} catch {
				/* */
			}
			this.stadiumShowMusicSend = null;
		}
		if (this.stadiumShowLowpass) {
			try {
				this.stadiumShowLowpass.disconnect();
			} catch {
				/* */
			}
			this.stadiumShowLowpass = null;
		}

		if (
			active &&
			this.matchMusicSource &&
			this.arenaEchoInput &&
			this.unlocked
		) {
			try {
				const ctx = this.listener.context;
				const lp = ctx.createBiquadFilter();
				lp.type = "lowpass";
				lp.frequency.value = 2200;
				lp.Q.value = 0.7;
				const send = ctx.createGain();
				send.gain.value = 0.7;
				this.matchMusicSource.connect(lp);
				lp.connect(send);
				send.connect(this.arenaEchoInput);
				this.stadiumShowLowpass = lp;
				this.stadiumShowMusicSend = send;
			} catch {
				/* source już disconnected */
			}
		}

		this.applyMusicVolume();
	}

	/**
	 * Pogłos stadionowy TYLKO ze ścieżki filmu na jumbotronie.
	 * Komentator / SFX / echo areny bez zmian. YT iframe zostaje mute.
	 */
	attachJumbotronFilm(videoId: string): void {
		this.detachJumbotronFilm();
		this.jumbotronVideoId = videoId;
		const gen = ++this.jumbotronGen;
		if (!this.unlocked) return;
		void this.connectJumbotronPa(videoId, gen);
	}

	/** Duck PA gdy LED ma ekran (film schowany). */
	setJumbotronFilmOpen(open: boolean): void {
		this.jumbotronFilmOpenDesired = open;
		const g = this.jumbotronMaster;
		if (!g) return;
		const ctx = this.listener.context;
		const now = ctx.currentTime;
		g.gain.cancelScheduledValues(now);
		g.gain.setValueAtTime(g.gain.value, now);
		g.gain.linearRampToValueAtTime(
			open ? JUMBOTRON_PA_MIX.masterOpen : JUMBOTRON_PA_MIX.masterHidden,
			now + JUMBOTRON_PA_MIX.rampSec,
		);
	}

	private async connectJumbotronPa(
		videoId: string,
		gen: number,
	): Promise<void> {
		try {
			const ctx = this.listener.context as AudioContext;
			if (ctx.state === "suspended") return;
			const buf = await decodeJumbotronClip(ctx, videoId);
			if (
				!buf ||
				this.jumbotronGen !== gen ||
				this.jumbotronVideoId !== videoId
			) {
				return;
			}
			this.stopJumbotronGraph();
			const src = ctx.createBufferSource();
			src.buffer = buf;
			src.loop = true;

			/** Kompresja: ścina „głośnego koleś”, podciąga cichszą dziennikarkę */
			const comp = ctx.createDynamicsCompressor();
			comp.threshold.value = -28;
			comp.knee.value = 18;
			comp.ratio.value = 5.5;
			comp.attack.value = 0.008;
			comp.release.value = 0.22;

			const hp = ctx.createBiquadFilter();
			hp.type = "highpass";
			hp.frequency.value = 160;
			hp.Q.value = 0.7;

			const lp = ctx.createBiquadFilter();
			lp.type = "lowpass";
			lp.frequency.value = 3400;
			lp.Q.value = 0.35;

			const tone = ctx.createBiquadFilter();
			tone.type = "peaking";
			tone.frequency.value = 2200;
			tone.Q.value = 0.9;
			tone.gain.value = JUMBOTRON_PA_MIX.toneCutDb;

			const master = ctx.createGain();
			master.gain.value = 0.04;
			this.jumbotronMaster = master;

			const dry = ctx.createGain();
			dry.gain.value = JUMBOTRON_PA_MIX.dry;
			const tapGains = [0.14, 0.1, 0.065, 0.035];
			const tapTimes = [0.085, 0.17, 0.34, 0.68];
			const conv = ctx.createConvolver();
			conv.buffer = makeStadiumImpulse(ctx);
			const wet = ctx.createGain();
			wet.gain.value = JUMBOTRON_PA_MIX.wet;
			const out = this.listener.getInput();

			src.connect(hp);
			hp.connect(comp);
			comp.connect(tone);
			tone.connect(lp);
			lp.connect(master);

			master.connect(dry);
			dry.connect(out);
			for (let i = 0; i < tapTimes.length; i++) {
				const d = ctx.createDelay(1.2);
				d.delayTime.value = tapTimes[i]!;
				const g = ctx.createGain();
				g.gain.value = tapGains[i]!;
				master.connect(d);
				d.connect(g);
				g.connect(out);
				this.jumbotronNodes.push(d, g);
			}
			const wetSend = ctx.createGain();
			wetSend.gain.value = 1;
			master.connect(wetSend);
			wetSend.connect(conv);
			conv.connect(wet);
			wet.connect(out);

			src.start();
			this.jumbotronBufSrc = src;
			this.jumbotronNodes.push(
				src,
				hp,
				comp,
				tone,
				lp,
				master,
				dry,
				wetSend,
				conv,
				wet,
			);
			/** Po async decode — zastosuj stash (mogło przyjść setJumbotronFilmOpen wcześniej). */
			this.setJumbotronFilmOpen(this.jumbotronFilmOpenDesired);
		} catch (err) {
			console.warn("[ignite] jumbotron PA", err);
		}
	}

	private stopJumbotronGraph(): void {
		try {
			this.jumbotronBufSrc?.stop();
		} catch {
			/* */
		}
		for (const node of this.jumbotronNodes) {
			try {
				node.disconnect();
			} catch {
				/* */
			}
		}
		this.jumbotronBufSrc = null;
		this.jumbotronMaster = null;
		this.jumbotronNodes = [];
	}

	detachJumbotronFilm(): void {
		this.jumbotronGen += 1;
		this.stopJumbotronGraph();
		this.jumbotronVideoId = null;
	}

	/** Pre-match: ascending riser before DROP. */
	playStadiumShowRiser(intensity = 1, durationSec = 1.1): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		const k = THREE.MathUtils.clamp(intensity, 0.4, 1.5);
		const dur = THREE.MathUtils.clamp(durationSec, 0.5, 2.0);
		const now = ctx.currentTime;
		const out = this.listener.getInput();

		const osc = ctx.createOscillator();
		osc.type = "sawtooth";
		osc.frequency.setValueAtTime(90, now);
		osc.frequency.exponentialRampToValueAtTime(720 * k, now + dur);
		const bp = ctx.createBiquadFilter();
		bp.type = "bandpass";
		bp.frequency.setValueAtTime(400, now);
		bp.frequency.exponentialRampToValueAtTime(2400, now + dur);
		bp.Q.value = 0.7;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, now);
		g.gain.exponentialRampToValueAtTime(0.16 * k, now + dur * 0.55);
		g.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.05);
		osc.connect(bp);
		bp.connect(g);
		g.connect(out);
		osc.start(now);
		osc.stop(now + dur + 0.08);

		const len = Math.floor(ctx.sampleRate * dur);
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const data = buf.getChannelData(0);
		for (let i = 0; i < len; i++) {
			const t = i / len;
			data[i] = (Math.random() * 2 - 1) * t * t * 0.7;
		}
		const noise = ctx.createBufferSource();
		noise.buffer = buf;
		const np = ctx.createBiquadFilter();
		np.type = "highpass";
		np.frequency.setValueAtTime(300, now);
		np.frequency.exponentialRampToValueAtTime(2000, now + dur);
		const ng = ctx.createGain();
		ng.gain.setValueAtTime(0.0001, now);
		ng.gain.exponentialRampToValueAtTime(0.14 * k, now + dur * 0.7);
		ng.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.04);
		noise.connect(np);
		np.connect(ng);
		ng.connect(out);
		noise.start(now);
		noise.stop(now + dur + 0.05);
	}

	/** Pre-match: camera whoosh / przelot. */
	playStadiumShowWhoosh(intensity = 1): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		const k = THREE.MathUtils.clamp(intensity, 0.4, 1.4);
		const now = ctx.currentTime;
		const out = this.listener.getInput();

		const whoosh = ctx.createOscillator();
		whoosh.type = "sawtooth";
		whoosh.frequency.setValueAtTime(520 * k, now);
		whoosh.frequency.exponentialRampToValueAtTime(70, now + 0.38);
		const bp = ctx.createBiquadFilter();
		bp.type = "bandpass";
		bp.frequency.setValueAtTime(1800, now);
		bp.frequency.exponentialRampToValueAtTime(420, now + 0.35);
		bp.Q.value = 0.55;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, now);
		g.gain.exponentialRampToValueAtTime(0.22 * k, now + 0.02);
		g.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
		whoosh.connect(bp);
		bp.connect(g);
		g.connect(out);
		whoosh.start(now);
		whoosh.stop(now + 0.45);

		const len = Math.floor(ctx.sampleRate * 0.35);
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const data = buf.getChannelData(0);
		for (let i = 0; i < len; i++) {
			const t = i / len;
			data[i] = (Math.random() * 2 - 1) * (1 - t) ** 1.2 * 0.55;
		}
		const noise = ctx.createBufferSource();
		noise.buffer = buf;
		const np = ctx.createBiquadFilter();
		np.type = "highpass";
		np.frequency.value = 600;
		const ng = ctx.createGain();
		ng.gain.setValueAtTime(0.0001, now);
		ng.gain.exponentialRampToValueAtTime(0.18 * k, now + 0.015);
		ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
		noise.connect(np);
		np.connect(ng);
		ng.connect(out);
		noise.start(now);
		noise.stop(now + 0.36);
	}

	/** Pre-match: light slam / blackout drop. */
	playStadiumShowSlam(intensity = 1): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		const k = THREE.MathUtils.clamp(intensity, 0.5, 1.5);
		this.duckMusicForImpact(0.35 * k);
		const now = ctx.currentTime;
		const out = this.listener.getInput();

		const thump = ctx.createOscillator();
		thump.type = "sine";
		thump.frequency.setValueAtTime(72, now);
		thump.frequency.exponentialRampToValueAtTime(28, now + 0.28);
		const tg = ctx.createGain();
		tg.gain.setValueAtTime(0.0001, now);
		tg.gain.exponentialRampToValueAtTime(0.55 * k, now + 0.012);
		tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
		thump.connect(tg);
		tg.connect(out);
		thump.start(now);
		thump.stop(now + 0.42);

		const click = ctx.createOscillator();
		click.type = "square";
		click.frequency.setValueAtTime(240, now);
		click.frequency.exponentialRampToValueAtTime(90, now + 0.08);
		const cg = ctx.createGain();
		cg.gain.setValueAtTime(0.0001, now);
		cg.gain.exponentialRampToValueAtTime(0.12 * k, now + 0.004);
		cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
		click.connect(cg);
		cg.connect(out);
		click.start(now);
		click.stop(now + 0.12);
	}

	/** Pre-match: crowd swell / trybuny. */
	playStadiumShowCrowdSwell(intensity = 1, durationSec = 1.4): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		const k = THREE.MathUtils.clamp(intensity, 0.4, 1.4);
		const dur = THREE.MathUtils.clamp(durationSec, 0.6, 2.4);
		const now = ctx.currentTime;
		const out = this.listener.getInput();

		const len = Math.floor(ctx.sampleRate * dur);
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const data = buf.getChannelData(0);
		for (let i = 0; i < len; i++) {
			const t = i / len;
			const env = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.85;
			data[i] = (Math.random() * 2 - 1) * env * 0.62;
		}
		const noise = ctx.createBufferSource();
		noise.buffer = buf;
		const band = ctx.createBiquadFilter();
		band.type = "bandpass";
		band.frequency.value = 880;
		band.Q.value = 0.45;
		const lp = ctx.createBiquadFilter();
		lp.type = "lowpass";
		lp.frequency.value = 2400;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, now);
		g.gain.exponentialRampToValueAtTime(0.5 * k, now + 0.12);
		g.gain.exponentialRampToValueAtTime(0.28 * k, now + dur * 0.45);
		g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
		noise.connect(band);
		band.connect(lp);
		lp.connect(g);
		g.connect(out);
		noise.start(now);
		noise.stop(now + dur + 0.05);
	}


	/**
	 * Prematch: Hardwell-style festival choir stab („ahh” / chór na DROP).
	 * Oryginalna synteza formantowa — nie sample z setu / Heaven.
	 */
	playStadiumShowChoir(intensity = 1, durationSec = 1.85): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;
		this.setupArenaEcho();
		const k = THREE.MathUtils.clamp(intensity, 0.5, 1.8);
		const dur = THREE.MathUtils.clamp(durationSec, 0.8, 3.2);
		const now = ctx.currentTime;
		const out = this.listener.getInput();

		const master = ctx.createGain();
		master.gain.setValueAtTime(0.0001, now);
		master.gain.exponentialRampToValueAtTime(0.78 * k, now + 0.04);
		master.gain.setValueAtTime(0.72 * k, now + dur * 0.35);
		master.gain.exponentialRampToValueAtTime(0.0001, now + dur);
		master.connect(out);
		if (this.arenaEchoInput) {
			const send = ctx.createGain();
			send.gain.value = 0.85;
			master.connect(send);
			send.connect(this.arenaEchoInput);
		}

		/** Major festival stack — C major-ish, nie melodia Heaven. */
		const partials: { f: number; g: number }[] = [
			{ f: 130.81, g: 0.22 },
			{ f: 164.81, g: 0.28 },
			{ f: 196.0, g: 0.32 },
			{ f: 261.63, g: 0.45 },
			{ f: 329.63, g: 0.4 },
			{ f: 392.0, g: 0.28 },
			{ f: 523.25, g: 0.22 },
			{ f: 659.25, g: 0.14 },
		];
		const detune = [-0.08, 0, 0.07];

		for (const p of partials) {
			for (const d of detune) {
				const osc = ctx.createOscillator();
				osc.type = "sawtooth";
				const f0 = p.f * 2 ** (d / 12);
				osc.frequency.setValueAtTime(f0, now);
				/** Lekki vibrato — „żywy” chór. */
				const lfo = ctx.createOscillator();
				lfo.type = "sine";
				lfo.frequency.value = 5.2 + Math.random() * 1.4;
				const lfoG = ctx.createGain();
				lfoG.gain.value = f0 * 0.004;
				lfo.connect(lfoG);
				lfoG.connect(osc.frequency);
				lfo.start(now);
				lfo.stop(now + dur + 0.05);

				const form = ctx.createBiquadFilter();
				form.type = "bandpass";
				form.frequency.value = 780 + Math.random() * 220;
				form.Q.value = 2.2;
				const form2 = ctx.createBiquadFilter();
				form2.type = "bandpass";
				form2.frequency.value = 1250;
				form2.Q.value = 1.4;
				const g = ctx.createGain();
				g.gain.value = (p.g / detune.length) * 0.55;
				osc.connect(form);
				form.connect(form2);
				form2.connect(g);
				g.connect(master);
				osc.start(now);
				osc.stop(now + dur + 0.05);
			}
		}

		/** Breath / air noise under choir. */
		const nLen = Math.floor(ctx.sampleRate * Math.min(dur, 2.2));
		const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
		const nd = nBuf.getChannelData(0);
		for (let i = 0; i < nLen; i++) {
			const u = i / nLen;
			nd[i] = (Math.random() * 2 - 1) * (1 - u) ** 0.6 * 0.35;
		}
		const noise = ctx.createBufferSource();
		noise.buffer = nBuf;
		const nhp = ctx.createBiquadFilter();
		nhp.type = "bandpass";
		nhp.frequency.value = 1600;
		nhp.Q.value = 0.6;
		const ng = ctx.createGain();
		ng.gain.setValueAtTime(0.0001, now);
		ng.gain.exponentialRampToValueAtTime(0.22 * k, now + 0.05);
		ng.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.9);
		noise.connect(nhp);
		nhp.connect(ng);
		ng.connect(master);
		noise.start(now);
		noise.stop(now + dur);
	}

	endMatchMusic(keepPlaying = false): void {
		if (!keepPlaying) {
			this.stopMusicSource();
		}
		this.matchMusicSessionStarted = false;
		this.pendingMatchMusicAdvance = false;
	}

	/** 0..1 — spike basu (do neonów w menu / prematch lasers). */
	getMusicPulse(): number {
		const trance = this.getPrematchTrancePulse();
		if (!this.analyser || this.musicMuted || !this.unlocked) {
			return trance;
		}
		const music = this.beatAnalyzer.tick(this.analyser);
		return Math.max(music, trance);
	}

	/** Upewnij się, że playlista gra w menu (po unlock) — zawsze od pierwszego tracku. */
	ensureMenuMusic(): void {
		void this.unlock().then(() => {
			if (!this.unlocked || this.musicBuffers.length === 0) return;
			if (!this.matchMusic) {
				this.matchMusic = new Audio(this.listener);
			}
			if (!this.matchMusic.isPlaying || this.musicTrackIndex !== 0) {
				this.playMusicTrack(0);
			}
		});
	}

	/** Menu — zmiana trybu (←→, cyfry). */
	playMenuNav(accent?: string, soft = false): void {
		this.playMenuUi(soft ? "navSoft" : "nav", soft ? 120 : 90, accent);
	}

	/** Menu — spin karty trybu. */
	playMenuSpin(accent?: string): void {
		this.playMenuUi("spin", 520, accent);
	}

	/** Menu — GRAJ / Enter. */
	playMenuLaunch(): void {
		this.playMenuUi("launch", 420);
		this.duckMusicForImpact(0.28);
	}

	/** Menu — hover kafelka / przycisku (wyłączone — zbyt „klikowe”). */
	playMenuHover(_accent?: string): void {}

	/** Menu — klik w nav (garaż, ustawienia…). */
	playMenuConfirm(accent?: string): void {
		this.playMenuUi("confirm", 110, accent);
	}

	private playMenuUi(cue: MenuUiCue, minGapMs: number, accent?: string): void {
		if (!this.menuUiReady(cue, minGapMs)) return;
		playMenuUiCue(this.listener.context, this.listener.getInput(), cue, {
			accent,
			echo: this.arenaEchoInput,
		});
	}

	private menuUiReady(key: string, minGapMs: number): boolean {
		if (!this.unlocked) return false;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return false;
		const now = performance.now();
		if (now - (this.menuUiGate.get(key) ?? 0) < minGapMs) return false;
		this.menuUiGate.set(key, now);
		return true;
	}

	toggleMusicMute(): boolean {
		this.musicMuted = !this.musicMuted;
		this.applyMusicVolume();
		return this.musicMuted;
	}

	isMusicMuted(): boolean {
		return this.musicMuted;
	}

	/** Wycisza cały output gry (SFX + muzyka + UI). M przełącza. */
	setMasterMuted(muted: boolean): void {
		this.masterMuted = muted;
		this.listener.setMasterVolume(muted ? 0 : 1);
		if (!muted) this.applyMusicVolume();
	}

	toggleMasterMute(): boolean {
		this.setMasterMuted(!this.masterMuted);
		return this.masterMuted;
	}

	isMasterMuted(): boolean {
		return this.masterMuted;
	}

	/** Następny utwór z playlisty (skrót `]`). */
	nextMusicTrack(): void {
		void this.skipMusicTrack(1);
	}

	/** Poprzedni utwór (skrót `[`). */
	prevMusicTrack(): void {
		void this.skipMusicTrack(-1);
	}

	getMusicTrackLabel(index = this.musicTrackIndex): string {
		const path = MATCH_MUSIC_TRACKS[index];
		if (!path) return `track ${index + 1}`;
		const file = path.split("/").pop() ?? path;
		return file.replace(/\.mp3$/i, "").replace(/^match_/, "");
	}

	getMusicTrackInfo(): { index: number; total: number; label: string } {
		return {
			index: this.musicTrackIndex + 1,
			total: Math.max(1, this.musicBuffers.length),
			label: this.getMusicTrackLabel(),
		};
	}

	handleContactForce(
		event: RAPIER.TempContactForceEvent,
		world: RAPIER.World,
	): void {
		if (!this.unlocked) return;

		const force = event.totalForceMagnitude();
		if (force < 8) return;

		const h1 = event.collider1();
		const h2 = event.collider2();
		const k1 = this.getColliderTag(h1);
		const k2 = this.getColliderTag(h2);

		const kind = this.classifyImpact(k1, k2);
		if (!kind) return;

		const pairKey = h1 < h2 ? `${h1}-${h2}` : `${h2}-${h1}`;
		const now = performance.now();
		const last = this.impactCooldown.get(pairKey) ?? 0;
		const minGap = kind === "ballWall" ? 42 : 65;
		if (now - last < minGap) return;
		this.impactCooldown.set(pairKey, now);

		const minForce = kind === "ballWall" ? 6.5 : 11;
		const intensity = THREE.MathUtils.clamp((force - minForce) / 72, 0.1, 1);
		const pos = this.contactPosition(world, h1, h2);
		let surface: BallSurfaceKind | undefined;
		if (kind === "ballWall") {
			const dir = event.maxForceDirection();
			surface = classifyBallSurfaceFromNormal(dir.y);
		}
		this.playSpatialImpact(
			kind,
			intensity,
			pos,
			kind === "ballWall" ? 1.02 : 1.0,
			surface,
		);
		if (kind === "ballWall" && intensity >= 0.62) {
			this.duckMusicForImpact(intensity * 0.45);
			this.playBodyThump(intensity * 0.28, pos);
		}
	}

	private async unlock(): Promise<void> {
		if (this.unlocked) return;
		if (this.unlockPromise) {
			await this.unlockPromise;
			return;
		}
		this.unlockPromise = (async () => {
			const ctx = this.listener.context;
			if (ctx.state === "suspended") {
				try {
					await ctx.resume();
				} catch {
					return;
				}
			}
			if (ctx.state !== "running") return;

			this.setupAnalyser();
			await this.ensureLoaded();
			this.setupArenaEcho();
			this.startEngine();
			this.startMusic();
			if (this.pendingMatchMusicAdvance && this.musicBuffers.length > 1) {
				this.pendingMatchMusicAdvance = false;
				this.playMusicTrack(this.musicTrackIndex);
			}
			this.unlocked = true;
			this.detachUnlockGestures?.();
			this.warmupSpatialImpacts();
			if (this.jumbotronVideoId && !this.jumbotronBufSrc) {
				void this.connectJumbotronPa(
					this.jumbotronVideoId,
					this.jumbotronGen,
				);
			}
		})();
		try {
			await this.unlockPromise;
		} finally {
			this.unlockPromise = null;
		}
	}

	private async ensureLoaded(): Promise<void> {
		if (!this.loading) {
			this.loading = this.loadAllAssets();
		}
		await this.loading;
	}

	private async loadAllAssets(): Promise<void> {
		const coreKeys = Object.keys(AUDIO_PATHS) as AudioAssetKey[];
		const coreUrls = coreKeys.map((k) => AUDIO_PATHS[k]);
		const coreBufs = await loadAudioBuffers(coreUrls);
		for (let i = 0; i < coreKeys.length; i++) {
			const buf = coreBufs[i];
			if (buf) this.buffers.set(AUDIO_PATHS[coreKeys[i]], buf);
		}

		for (const kind of Object.keys(IMPACT_POOLS) as ImpactKind[]) {
			const urls = IMPACT_POOLS[kind];
			const bufs = (await loadAudioBuffers(urls)).filter(
				(b): b is AudioBuffer => b !== null,
			);
			if (bufs.length > 0) this.impactPools.set(kind, bufs);
		}

		for (const surface of Object.keys(
			BALL_SURFACE_POOLS,
		) as BallSurfaceKind[]) {
			const urls = BALL_SURFACE_POOLS[surface];
			const bufs = (await loadAudioBuffers(urls)).filter(
				(b): b is AudioBuffer => b !== null,
			);
			if (bufs.length > 0) this.ballSurfacePools.set(surface, bufs);
		}

		const musicBufs = await loadAudioBuffers([...MATCH_MUSIC_TRACKS]);
		for (const buf of musicBufs) {
			if (buf) this.musicBuffers.push(buf);
		}
		/** Już w AUDIO_PATHS → buffers; osobny uchwyt pod show. */
		this.prematchMusicBuffer =
			this.buffers.get(AUDIO_PATHS.prematchHeaven) ?? null;
		if (import.meta.env.DEV) {
			console.info(
				`[audio] match playlist: ${this.musicBuffers.length}/${MATCH_MUSIC_TRACKS.length} tracks; prematchHeaven=${Boolean(this.prematchMusicBuffer)} url=${PREMATCH_MUSIC_URL}`,
			);
		}
	}

	private startEngine(): void {
		if (!this.engineLow) {
			const lowBuf =
				this.buffers.get(AUDIO_PATHS.engineLow) ??
				this.createEngineLoopBuffer();
			this.engineLow = new Audio(this.listener);
			this.engineLow.setBuffer(lowBuf);
			this.engineLow.setLoop(true);
			this.engineLow.setVolume(0.0001);
			this.engineLow.play();

			const highBuf = this.buffers.get(AUDIO_PATHS.engineHigh);
			if (highBuf) {
				this.engineHigh = new Audio(this.listener);
				this.engineHigh.setBuffer(highBuf);
				this.engineHigh.setLoop(true);
				this.engineHigh.setVolume(0.0001);
				this.engineHigh.play();
			}
		}

		this.startBoostLoop();
		this.engineReady = this.engineLow !== undefined;
	}

	private startBoostLoop(): void {
		if (this.boostAudio || !this.engineAnchor) return;

		const boostBuf =
			this.buffers.get(AUDIO_PATHS.boostLoop) ?? this.createBoostNoiseBuffer();
		this.boostAudio = new THREE.PositionalAudio(this.listener);
		this.boostAudio.setBuffer(boostBuf);
		this.boostAudio.setLoop(true);
		this.boostAudio.setRefDistance(5.5);
		this.boostAudio.setMaxDistance(70);
		this.boostAudio.setVolume(0.0001);
		this.engineAnchor.add(this.boostAudio);
		this.boostAudio.play();
	}

	private startMusic(): void {
		if (this.musicBuffers.length === 0) {
			const fallback = this.buffers.get(AUDIO_PATHS.matchMusic);
			if (fallback) this.musicBuffers.push(fallback);
		}
		if (this.musicBuffers.length === 0) return;

		if (!this.matchMusic) {
			this.matchMusic = new Audio(this.listener);
		}
		this.playMusicTrack(this.musicTrackIndex);
	}

	private stopMusicSource(): void {
		window.clearTimeout(this.musicAdvanceTimer);
		this.musicAdvanceTimer = 0;
		if (this.matchMusicSource) {
			try {
				this.matchMusicSource.onended = null;
				this.matchMusicSource.stop();
			} catch {
				/* już zatrzymany */
			}
			this.matchMusicSource.disconnect();
			this.matchMusicSource = null;
		}
		if (this.matchMusic?.isPlaying) {
			this.matchMusic.stop();
		}
	}

	private async skipMusicTrack(delta: number): Promise<void> {
		if (this.musicBuffers.length <= 1) return;
		const n = this.musicBuffers.length;
		this.musicTrackIndex = (this.musicTrackIndex + delta + n) % n;
		await this.ensureLoaded();
		if (!this.unlocked) {
			await this.unlock();
			return;
		}
		if (!this.matchMusic) {
			this.matchMusic = new Audio(this.listener);
		}
		this.playMusicTrack(this.musicTrackIndex);
	}

	private hookMusicSourceEnded(
		source: AudioBufferSourceNode,
		buf: AudioBuffer,
	): void {
		const advance = (): void => {
			if (this.matchMusicSource !== source) return;
			this.playMusicTrack(this.musicTrackIndex + 1);
		};
		source.onended = () => {
			window.clearTimeout(this.musicAdvanceTimer);
			this.musicAdvanceTimer = 0;
			if (this.matchMusic) this.matchMusic.isPlaying = false;
			advance();
		};
		this.musicAdvanceTimer = window.setTimeout(
			advance,
			buf.duration * 1000 + 300,
		);
	}

	private playMusicTrack(index: number): void {
		if (!this.matchMusic || this.musicBuffers.length === 0) return;

		const normalized =
			((index % this.musicBuffers.length) + this.musicBuffers.length) %
			this.musicBuffers.length;
		const buf = this.musicBuffers[normalized];
		if (!buf) return;

		this.musicTrackIndex = normalized;
		this.stopMusicSource();
		this.matchMusic.setBuffer(buf);
		this.matchMusic.setLoop(false);
		this.applyMusicVolume();
		this.matchMusic.play();

		const source = this.matchMusic.source as AudioBufferSourceNode | null;
		if (source) {
			this.matchMusicSource = source;
			this.hookMusicSourceEnded(source, buf);
		}

		if (import.meta.env.DEV) {
			console.info(
				`[audio] match track ${normalized + 1}/${this.musicBuffers.length}: ${MATCH_MUSIC_TRACKS[normalized]}`,
			);
		}
	}

	private duckMusicForImpact(intensity: number): void {
		if (intensity < 0.42) return;
		this.impactDuckUntil = Math.max(
			this.impactDuckUntil,
			performance.now() + IMPACT_DUCK_MS * (0.48 + intensity * 0.38),
		);
		this.updateMusicDuck();
	}

	private updateMusicDuck(): void {
		if (!this.matchMusic) return;
		if (this.musicMuted) {
			this.matchMusic.setVolume(0);
			return;
		}
		const now = performance.now();
		const goalDucking = now < this.musicDuckUntil;
		const impactDucking = now < this.impactDuckUntil;
		const base = this.stadiumShowMix
			? MUSIC_BASE_VOLUME * 0.22
			: MUSIC_BASE_VOLUME;
		const target = goalDucking
			? GOAL_DUCK_VOLUME
			: impactDucking
				? IMPACT_DUCK_VOLUME
				: base;
		const current = this.matchMusic.getVolume();
		this.matchMusic.setVolume(THREE.MathUtils.lerp(current, target, 0.08));
	}

	private applyMusicVolume(): void {
		if (!this.matchMusic) return;
		if (this.musicMuted) {
			this.matchMusic.setVolume(0);
			return;
		}
		const now = performance.now();
		const goalDucking = now < this.musicDuckUntil;
		const impactDucking = now < this.impactDuckUntil;
		const base = this.stadiumShowMix
			? MUSIC_BASE_VOLUME * 0.22
			: MUSIC_BASE_VOLUME;
		this.matchMusic.setVolume(
			goalDucking
				? GOAL_DUCK_VOLUME
				: impactDucking
					? IMPACT_DUCK_VOLUME
					: base,
		);
	}

	private setupAnalyser(): void {
		if (this.analyserReady) return;
		const ctx = this.listener.context;
		const input = this.listener.getInput();
		this.analyser = ctx.createAnalyser();
		this.analyser.fftSize = 1024;
		this.analyser.smoothingTimeConstant = 0.35;
		this.analyser.minDecibels = -82;
		this.analyser.maxDecibels = -8;
		input.disconnect();
		input.connect(this.analyser);
		this.analyser.connect(ctx.destination);
		this.analyserReady = true;
	}

	private playListenerSfx(path: string, volume: number, rate = 1): void {
		const buf = this.buffers.get(path);
		if (!buf || !this.unlocked) return;

		const sfx = new Audio(this.listener);
		sfx.setBuffer(buf);
		sfx.setVolume(volume);
		sfx.setPlaybackRate(rate);
		sfx.play();
		sfx.onEnded = () => sfx.disconnect();
	}

	private pickImpactBuffer(
		kind: ImpactKind,
		intensity: number,
		surface?: BallSurfaceKind,
	): AudioBuffer | null {
		if (kind === "ballWall" && surface) {
			const pool = this.ballSurfacePools.get(surface);
			if (pool && pool.length > 0) {
				const tier = Math.min(
					pool.length - 1,
					Math.floor(intensity * pool.length),
				);
				return pool[tier] ?? pool[0] ?? null;
			}
		}

		const pool = this.impactPools.get(kind);
		if (pool && pool.length > 0) {
			const tier = Math.min(
				pool.length - 1,
				Math.floor(intensity * pool.length),
			);
			return pool[tier] ?? pool[0] ?? null;
		}
		return this.createImpactBuffer(intensity, kind, surface);
	}

	private impactVolume(
		kind: ImpactKind,
		intensity: number,
		volumeScale: number,
		surface?: BallSurfaceKind,
	): number {
		let base =
			kind === "carBall"
				? 0.42 + intensity * 0.95
				: kind === "ballWall"
					? 0.28 + intensity * 0.68
					: 0.26 + intensity * 0.52;
		if (kind === "ballWall" && surface === "floor") base *= 0.88;
		if (kind === "ballWall" && surface === "ceiling") base *= 0.92;
		return THREE.MathUtils.clamp(base * volumeScale, 0.0001, 1);
	}

	private impactPlaybackRate(
		kind: ImpactKind,
		intensity: number,
		surface?: BallSurfaceKind,
	): number {
		if (kind === "carBall") {
			/** Wyżej przy mocnych hitach = punch, nie zwolniony „szurf po trawie”. */
			return THREE.MathUtils.clamp(0.98 + intensity * 0.18, 0.95, 1.2);
		}
		if (kind === "ballWall") {
			const base =
				surface === "floor"
					? 0.82 + intensity * 0.1
					: surface === "ceiling"
						? 0.98 + intensity * 0.14
						: 0.9 + intensity * 0.18;
			return THREE.MathUtils.clamp(base, 0.76, 1.22);
		}
		return THREE.MathUtils.clamp(0.88 + intensity * 0.18, 0.82, 1.18);
	}

	private playSpatialImpact(
		kind: ImpactKind,
		intensity: number,
		pos: THREE.Vector3,
		volumeScale = 1,
		surface?: BallSurfaceKind,
	): void {
		const buffer = this.pickImpactBuffer(kind, intensity, surface);
		if (!buffer) return;

		this.ensureSpatialPool();
		const now = performance.now();
		const slot =
			this.spatialImpactPool.find(
				(s) => !s.sfx.isPlaying && s.busyUntil <= now,
			) ??
			this.spatialImpactPool.reduce((oldest, s) =>
				s.busyUntil < oldest.busyUntil ? s : oldest,
			);

		slot.busyUntil = now + 620;
		slot.anchor.position.copy(pos);
		slot.sfx.setBuffer(buffer);
		slot.sfx.setRefDistance(kind === "carBall" ? 9 : 7.5);
		slot.sfx.setRolloffFactor(0.78);
		slot.sfx.setMaxDistance(110);
		slot.sfx.setPlaybackRate(
			this.impactPlaybackRate(kind, intensity, surface) *
				(0.97 + Math.random() * 0.06),
		);
		slot.sfx.setVolume(
			this.impactVolume(kind, intensity, volumeScale, surface),
		);
		if (slot.sfx.isPlaying) {
			slot.sfx.stop();
		}
		slot.sfx.play();
	}

	private ensureSpatialPool(): void {
		if (this.spatialPoolReady) return;
		while (this.spatialImpactPool.length < SPATIAL_IMPACT_POOL) {
			const anchor = new THREE.Object3D();
			this.sfxRoot.add(anchor);
			const sfx = new THREE.PositionalAudio(this.listener);
			anchor.add(sfx);
			this.spatialImpactPool.push({ anchor, sfx, busyUntil: 0 });
		}
		this.spatialPoolReady = true;
	}

	/** Proceduralny fallback gdy brak plików silnika. */
	private createEngineLoopBuffer(): AudioBuffer {
		const ctx = this.listener.context;
		const sampleRate = ctx.sampleRate;
		const len = Math.floor(sampleRate * 2.4);
		const buf = ctx.createBuffer(2, len, sampleRate);

		for (let ch = 0; ch < 2; ch++) {
			const data = buf.getChannelData(ch);
			let noise = 0;
			for (let i = 0; i < len; i++) {
				const t = i / sampleRate;
				const white = Math.random() * 2 - 1;
				noise = noise * 0.985 + white * 0.015;
				const rumble =
					Math.sin(2 * Math.PI * 46 * t) * 0.42 +
					Math.sin(2 * Math.PI * 92 * t) * 0.28 +
					Math.sin(2 * Math.PI * 138 * t) * 0.14 +
					Math.sin(2 * Math.PI * 184 * t) * 0.08;
				const idlePulse = 0.82 + Math.sin(2 * Math.PI * 3.2 * t) * 0.18;
				data[i] = (rumble * idlePulse + noise * 0.35) * 0.72;
			}
		}
		return buf;
	}

	private createBoostNoiseBuffer(): AudioBuffer {
		const ctx = this.listener.context;
		const len = Math.floor(ctx.sampleRate * 1.5);
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const data = buf.getChannelData(0);
		for (let i = 0; i < len; i++) {
			data[i] = (Math.random() * 2 - 1) * 0.4;
		}
		return buf;
	}

	private createImpactBuffer(
		intensity: number,
		kind: ImpactKind,
		surface?: BallSurfaceKind,
	): AudioBuffer {
		const ctx = this.listener.context;
		const dur =
			kind === "carBall"
				? 0.1 + intensity * 0.16
				: kind === "ballWall"
					? 0.08 + intensity * 0.12
					: 0.07 + intensity * 0.08;
		const len = Math.floor(ctx.sampleRate * dur);
		const buf = ctx.createBuffer(2, len, ctx.sampleRate);

		const thumpHz =
			kind === "carBall"
				? 88 - intensity * 18
				: kind === "ballWall" && surface === "floor"
					? 72
					: kind === "ballWall" && surface === "ceiling"
						? 128
						: 102;
		const crackGain = 0.32 + intensity * 0.45;

		for (let ch = 0; ch < 2; ch++) {
			const data = buf.getChannelData(ch);
			for (let i = 0; i < len; i++) {
				const t = i / ctx.sampleRate;
				const env = Math.exp(
					-t * (kind === "carWall" ? 16 : 11 + intensity * 7),
				);
				const thump =
					Math.sin(2 * Math.PI * thumpHz * t * (1 - t * 0.35)) *
					(kind === "carBall" ? 0.82 : 0.55);
				const crack = (Math.random() * 2 - 1) * Math.exp(-t * 42) * crackGain;
				data[i] = (thump + crack) * env;
			}
		}
		return buf;
	}

	/** Niskie uderzenie + echo stadionu — daje „moc” bez sci-fi piu-piu. */
	private playBodyThump(intensity: number, point: THREE.Vector3): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state !== "running") return;

		const listenerPos = new THREE.Vector3();
		this.listener.getWorldPosition(listenerPos);
		const dist = listenerPos.distanceTo(point);
		const distAtten = THREE.MathUtils.clamp(1 - (dist - 8) / 70, 0.35, 1);
		const vol = THREE.MathUtils.clamp(
			(0.14 + intensity * 0.42) * distAtten,
			0.04,
			0.62,
		);
		const startAt = ctx.currentTime;

		const osc = ctx.createOscillator();
		const oscGain = ctx.createGain();
		osc.type = "sine";
		osc.frequency.setValueAtTime(95 - intensity * 22, startAt);
		osc.frequency.exponentialRampToValueAtTime(
			42,
			startAt + 0.07 + intensity * 0.05,
		);
		oscGain.gain.setValueAtTime(0.0001, startAt);
		oscGain.gain.exponentialRampToValueAtTime(vol, startAt + 0.006);
		oscGain.gain.exponentialRampToValueAtTime(
			0.0001,
			startAt + 0.11 + intensity * 0.07,
		);

		const noiseLen = Math.floor(ctx.sampleRate * (0.04 + intensity * 0.03));
		const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
		const noiseData = noiseBuf.getChannelData(0);
		for (let i = 0; i < noiseLen; i++) {
			noiseData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (noiseLen * 0.22));
		}
		const noise = ctx.createBufferSource();
		noise.buffer = noiseBuf;
		const noiseGain = ctx.createGain();
		noiseGain.gain.setValueAtTime(0.0001, startAt);
		noiseGain.gain.exponentialRampToValueAtTime(vol * 0.55, startAt + 0.003);
		noiseGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.05);

		const dry = this.listener.getInput();
		osc.connect(oscGain);
		noise.connect(noiseGain);
		oscGain.connect(dry);
		noiseGain.connect(dry);
		if (this.arenaEchoInput) {
			oscGain.connect(this.arenaEchoInput);
			noiseGain.connect(this.arenaEchoInput);
		}

		osc.start(startAt);
		osc.stop(startAt + 0.2);
		noise.start(startAt);
		noise.stop(startAt + 0.08);
	}

	private setupArenaEcho(): void {
		if (this.arenaEchoInput) return;
		const ctx = this.listener.context;
		const input = ctx.createGain();
		input.gain.value = 1;

		const delay = ctx.createDelay(0.35);
		delay.delayTime.value = 0.13;
		const feedback = ctx.createGain();
		feedback.gain.value = 0.34;
		const wet = ctx.createGain();
		wet.gain.value = 0.32;

		input.connect(delay);
		delay.connect(feedback);
		feedback.connect(delay);
		delay.connect(wet);
		wet.connect(this.listener.getInput());

		this.arenaEchoInput = input;
		this.arenaEchoWet = wet;
		this.arenaEchoFeedback = feedback;
	}

	private classifyImpact(a: ColliderTag, b: ColliderTag): ImpactKind | null {
		const tags = new Set([a, b]);
		// car↔ball — z applyCarBallHitsAll (playBallHit), nie z contact force
		if (tags.has("player") && tags.has("ball")) return null;
		if (tags.has("ball")) return "ballWall";
		if (tags.has("player")) return "carWall";
		return null;
	}

	private contactPosition(
		world: RAPIER.World,
		h1: number,
		h2: number,
	): THREE.Vector3 {
		this.colliderCenter(world, h1, this._contactPosA);
		this.colliderCenter(world, h2, this._contactPosB);
		return this._contactPosA.add(this._contactPosB).multiplyScalar(0.5);
	}

	private colliderCenter(
		world: RAPIER.World,
		handle: number,
		out: THREE.Vector3,
	): THREE.Vector3 {
		const collider = world.getCollider(handle);
		const body = collider.parent();
		if (!body) return out.set(0, 0, 0);
		const t = body.translation();
		return out.set(t.x, t.y, t.z);
	}
}

async function decodeJumbotronClip(
	ctx: AudioContext,
	videoId: string,
): Promise<AudioBuffer | null> {
	for (const url of jumbotronPaUrls(videoId)) {
		try {
			const res = await fetch(url);
			if (!res.ok) continue;
			const raw = await res.arrayBuffer();
			const copy = raw.slice(0);
			return await ctx.decodeAudioData(copy);
		} catch {
			/* kolejny URL */
		}
	}
	console.warn("[ignite] jumbotron PA: brak same-origin clipu", videoId);
	return null;
}

/** Proceduralny IR hali — wczesne odbicia + ogon ~2.6 s. */
function makeStadiumImpulse(ctx: AudioContext): AudioBuffer {
	const dur = 2.65;
	const rate = ctx.sampleRate;
	const n = Math.floor(rate * dur);
	const buf = ctx.createBuffer(2, n, rate);
	for (let ch = 0; ch < 2; ch++) {
		const data = buf.getChannelData(ch);
		for (let i = 0; i < n; i++) {
			const t = i / rate;
			const env = Math.exp(-t * 1.85) * (1 - i / n);
			const early =
				t < 0.12
					? (Math.random() * 2 - 1) * Math.exp(-t * 18) * 1.15
					: 0;
			const slap =
				t > 0.22 && t < 0.38
					? (Math.random() * 2 - 1) * Math.exp(-(t - 0.22) * 14) * 0.45
					: 0;
			data[i] =
				(Math.random() * 2 - 1) * env * 0.42 +
				early * (ch === 0 ? 1 : 0.78) +
				slap * (ch === 0 ? 0.7 : 1);
		}
	}
	return buf;
}
