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
	IMPACT_POOLS,
	type ImpactKind,
	MATCH_MUSIC_TRACKS,
} from "./AudioManifest";
import { MusicBeatAnalyzer } from "./MusicBeatAnalyzer";

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

	private unlocked = false;
	private loading: Promise<void> | null = null;
	private engineReady = false;
	private musicDuckUntil = 0;
	private impactDuckUntil = 0;
	private musicMuted = false;

	private engineLow?: Audio;
	private engineHigh?: Audio;
	private boostAudio?: THREE.PositionalAudio;
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

	constructor() {
		this.listener = new THREE.AudioListener();
		this.sfxRoot.name = "spatialSfxRoot";

		const unlock = () => {
			void this.unlock();
		};
		window.addEventListener("keydown", unlock, { once: true });
		window.addEventListener("pointerdown", unlock, { once: true });
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
			this.boostAudio.setVolume(boosting ? 0.28 + load * 0.18 : 0.0001);
			if (boosting) {
				this.boostAudio.setPlaybackRate(
					THREE.MathUtils.clamp(0.9 + speed / 60, 0.85, 1.6),
				);
			}
		}

		this.updateMusicDuck();
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
		this.playListenerSfx(path, 0.82, 1);
		this.playGoalCrowdSwell(team);
		this.musicDuckUntil = performance.now() + GOAL_DUCK_MS;
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
		sub.frequency.exponentialRampToValueAtTime(34, now + 0.32);
		const subGain = ctx.createGain();
		subGain.gain.setValueAtTime(0.0001, now);
		subGain.gain.exponentialRampToValueAtTime(1.15, now + 0.02);
		subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);
		sub.connect(subGain);
		subGain.connect(out);
		sub.start(now);
		sub.stop(now + 0.75);

		const len = Math.floor(ctx.sampleRate * 0.55);
		const noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
		const noiseData = noiseBuf.getChannelData(0);
		for (let i = 0; i < len; i++) {
			const t = i / len;
			noiseData[i] = (Math.random() * 2 - 1) * (1 - t) ** 1.8 * 0.55;
		}
		const noise = ctx.createBufferSource();
		noise.buffer = noiseBuf;
		const band = ctx.createBiquadFilter();
		band.type = "bandpass";
		band.frequency.value = team === "blue" ? 920 : 760;
		band.Q.value = 0.65;
		const crowdGain = ctx.createGain();
		crowdGain.gain.setValueAtTime(0.0001, now);
		crowdGain.gain.exponentialRampToValueAtTime(0.42, now + 0.06);
		crowdGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
		noise.connect(band);
		band.connect(crowdGain);
		crowdGain.connect(out);
		noise.start(now);
		noise.stop(now + 0.9);
	}

	/**
	 * Uderzenie auta w piłkę — z fizyki gry (siła zależna od prędkości / kąta).
	 * Głośniejsze i niższe przy mocnych strzałach.
	 */
	playBallHit(impact: number, point: THREE.Vector3): void {
		if (!this.unlocked || impact < GAMEPLAY_BALL_HIT_MIN) return;
		const intensity = THREE.MathUtils.clamp((impact - 2) / 22, 0.08, 1);
		this.playSpatialImpact("carBall", intensity, point, 1.08);
		if (intensity >= 0.45) {
			this.duckMusicForImpact(intensity);
			this.playBodyThump(intensity * 0.72, point);
		}
	}

	playKickoff(): void {
		this.playCountdownIgnite();
	}

	playCountdownTick(step: number): void {
		const tick = this.buffers.get(AUDIO_PATHS.countdownTick);
		if (tick) {
			const rate = THREE.MathUtils.clamp(0.8 + step * 0.04, 0.8, 1.08);
			this.playListenerSfx(AUDIO_PATHS.countdownTick, 0.28, rate);
			return;
		}
		this.playCountdownThump(step);
	}

	playCountdownIgnite(): void {
		this.playIgniteBoom();
	}

	/** IGN!TE — niski uderzeniowy „boom!” + opcjonalny sample kickoff. */
	private playIgniteBoom(): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;

		const now = ctx.currentTime;
		const out = this.listener.getInput();

		const sub = ctx.createOscillator();
		sub.type = "sine";
		sub.frequency.setValueAtTime(118, now);
		sub.frequency.exponentialRampToValueAtTime(38, now + 0.24);
		const subGain = ctx.createGain();
		subGain.gain.setValueAtTime(0.0001, now);
		subGain.gain.exponentialRampToValueAtTime(1.05, now + 0.016);
		subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.58);
		sub.connect(subGain);
		subGain.connect(out);
		sub.start(now);
		sub.stop(now + 0.62);

		const len = Math.floor(ctx.sampleRate * 0.4);
		const noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
		const noiseData = noiseBuf.getChannelData(0);
		for (let i = 0; i < len; i++) {
			const t = i / len;
			noiseData[i] = (Math.random() * 2 - 1) * (1 - t) ** 2.4;
		}
		const noise = ctx.createBufferSource();
		noise.buffer = noiseBuf;
		const band = ctx.createBiquadFilter();
		band.type = "bandpass";
		band.frequency.setValueAtTime(320, now);
		band.frequency.exponentialRampToValueAtTime(72, now + 0.18);
		band.Q.value = 0.65;
		const noiseGain = ctx.createGain();
		noiseGain.gain.setValueAtTime(0.0001, now);
		noiseGain.gain.exponentialRampToValueAtTime(0.62, now + 0.008);
		noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
		noise.connect(band);
		band.connect(noiseGain);
		noiseGain.connect(out);
		noise.start(now);
		noise.stop(now + 0.44);

		const crack = ctx.createOscillator();
		crack.type = "triangle";
		crack.frequency.setValueAtTime(480, now + 0.018);
		crack.frequency.exponentialRampToValueAtTime(160, now + 0.14);
		const crackGain = ctx.createGain();
		crackGain.gain.setValueAtTime(0.0001, now + 0.018);
		crackGain.gain.exponentialRampToValueAtTime(0.42, now + 0.028);
		crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
		crack.connect(crackGain);
		crackGain.connect(out);
		crack.start(now + 0.018);
		crack.stop(now + 0.26);

		if (this.buffers.get(AUDIO_PATHS.kickoff)) {
			this.playListenerSfx(AUDIO_PATHS.kickoff, 0.32, 1.05);
		}
	}

	/** Wczytaj wszystkie bufory audio przed startem (bez odtwarzania). */
	async preloadAssets(): Promise<void> {
		await this.ensureLoaded();
	}

	/**
	 * Lekki warmup po preload — bez blokowania na AudioContext.resume() (wymaga gestu).
	 */
	async warmupAudio(): Promise<void> {
		await this.ensureLoaded();
		const ctx = this.listener.context;
		if (ctx.state !== "running") {
			void ctx.resume().catch(() => {});
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

	private playCountdownThump(step: number): void {
		if (!this.unlocked) return;
		const ctx = this.listener.context;
		if (ctx.state === "suspended") return;

		const startAt = ctx.currentTime;
		const vol = THREE.MathUtils.clamp(0.22 + step * 0.04, 0.22, 0.48);
		const len = Math.floor(ctx.sampleRate * 0.09);
		const noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
		const data = noiseBuf.getChannelData(0);
		for (let i = 0; i < len; i++) {
			const t = i / len;
			data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 14) * (1 - t * 0.35);
		}
		const noise = ctx.createBufferSource();
		noise.buffer = noiseBuf;
		const band = ctx.createBiquadFilter();
		band.type = "bandpass";
		band.frequency.value = 180 + step * 28;
		band.Q.value = 0.55;
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0.0001, startAt);
		gain.gain.exponentialRampToValueAtTime(vol, startAt + 0.008);
		gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.1);
		noise.connect(band);
		band.connect(gain);
		gain.connect(this.listener.getInput());
		noise.start(startAt);
		noise.stop(startAt + 0.12);
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

	endMatchMusic(keepPlaying = false): void {
		if (!keepPlaying) {
			this.stopMusicSource();
		}
		this.matchMusicSessionStarted = false;
		this.pendingMatchMusicAdvance = false;
	}

	/** 0..1 — spike basu (do neonów w menu). */
	getMusicPulse(): number {
		if (!this.analyser || this.musicMuted || !this.unlocked) return 0;
		return this.beatAnalyzer.tick(this.analyser);
	}

	/** Upewnij się, że playlista gra w menu (po unlock). */
	ensureMenuMusic(): void {
		if (!this.unlocked || this.musicBuffers.length === 0) return;
		if (!this.matchMusic) {
			this.matchMusic = new Audio(this.listener);
		}
		if (!this.matchMusic.isPlaying) {
			this.playMusicTrack(this.musicTrackIndex);
		}
	}

	toggleMusicMute(): boolean {
		this.musicMuted = !this.musicMuted;
		this.applyMusicVolume();
		return this.musicMuted;
	}

	isMusicMuted(): boolean {
		return this.musicMuted;
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
		const ctx = this.listener.context;
		if (ctx.state === "suspended") {
			await ctx.resume();
		}
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
		this.warmupSpatialImpacts();
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
		if (import.meta.env.DEV) {
			console.info(
				`[audio] match playlist: ${this.musicBuffers.length}/${MATCH_MUSIC_TRACKS.length} tracks`,
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
		if (intensity < 0.35) return;
		this.impactDuckUntil = Math.max(
			this.impactDuckUntil,
			performance.now() + IMPACT_DUCK_MS * (0.55 + intensity * 0.45),
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
		const target = goalDucking
			? GOAL_DUCK_VOLUME
			: impactDucking
				? IMPACT_DUCK_VOLUME
				: MUSIC_BASE_VOLUME;
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
		this.matchMusic.setVolume(
			goalDucking
				? GOAL_DUCK_VOLUME
				: impactDucking
					? IMPACT_DUCK_VOLUME
					: MUSIC_BASE_VOLUME,
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
				? 0.34 + intensity * 0.88
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
			return THREE.MathUtils.clamp(0.92 - intensity * 0.22, 0.72, 1.02);
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
