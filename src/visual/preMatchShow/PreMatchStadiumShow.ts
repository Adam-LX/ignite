/**
 * Pre-match — TRANCE PIERDOLNIĘCIE (ASOT / Transmission cueing):
 * blackout → cyan/magenta scanners → liquid sky → HERO DROP → fireworks celebration.
 * Chromatic lasers + bloom punch + aerial fireworks + 138 BPM kick.
 * Hitch-aware: staggered pyro/fireworks, throttled atmosphere outside DROP.
 * Skip: dowolny klawisz / LMB / skok (po 0.35 s).
 */
import * as THREE from "three";

import { t as i18n } from "../../i18n";
import type Renderer from "../../Renderer";
import type Scene from "../../Scene";
import type { GameAudio } from "../../audio/GameAudio";
import { loadAudioBuffers } from "../../audio/AudioLoader";
import type { CarEntity } from "../../game/CarEntity";
import type GameObject from "../../GameObject";
import type Player from "../../util/Player";
import { RL_ARENA } from "../arenaConstants";
import {
	setGoalDotMatrixHype,
	setGoalDotMatrixPrematchCue,
	updateGoalDotMatrix,
} from "../goalBackboardVisual";
import { setPrematchLaserBlackout } from "../stadiumLighting";
import { resolveGraphicsSettings } from "../../util/graphicsProfile";
import { PitchEnergyField } from "./PitchEnergyField";
import { StadiumJupiterShafts } from "./StadiumJupiterShafts";
import { StadiumLaserRig } from "./StadiumLaserRig";
import { StadiumShowFx } from "./StadiumShowFx";
import { StadiumShowPyro } from "./StadiumShowPyro";
import { StadiumShowSmoke } from "./StadiumShowSmoke";
import { StadiumColorWash } from "./StadiumColorWash";
import { StadiumTranceScanners } from "./StadiumTranceScanners";
import { StadiumShowFireworks } from "./StadiumShowFireworks";
import {
	beginPrematchHitchProbe,
	endPrematchHitchProbe,
	markPrematchHitchSpan,
	notePrematchHitchTick,
	setPrematchHitchPhase,
	setPrematchHitchShowU,
} from "../../diagnostic/prematchHitchProbe";
import { carIsLicensedPreview } from "../../meta/CarCatalog";
import { getMatchCarId } from "../../meta/duelContract";

/** Kwestie „atmosferyczne” — nie cyfry / nie goal yell. */
const PREMATCH_COMMENTARY_URLS = [
	"/assets/audio/commentary/en/kickoff/kickoff_00_here_we_go.ogg",
	"/assets/audio/commentary/en/kickoff/kickoff_01_let_s_light_it_up.ogg",
	"/assets/audio/commentary/en/kickoff/kickoff_03_engines_hot_let_s_dance.ogg",
	"/assets/audio/commentary/en/idle_ball/idle_ball_00_anybody_gonna_touch_that.ogg",
	"/assets/audio/commentary/en/idle_ball/idle_ball_02_free_real_estate_on_that_ball.ogg",
	"/assets/audio/commentary/en/idle_ball/idle_ball_03_it_s_lonely_in_midfield.ogg",
	"/assets/audio/commentary/en/scramble/scramble_00_it_s_a_parking_lot_out_there.ogg",
	"/assets/audio/commentary/en/aerial/aerial_00_what_an_aerial.ogg",
	"/assets/audio/commentary/en/fifty_fifty/fifty_fifty_00_fifty_fifty_who_wants_it_more.ogg",
	"/assets/audio/commentary/en/player_hustle/player_hustle_00_look_at_that_hustle_closing_the_gap.ogg",
] as const;

export type PreMatchShowDeps = {
	scene: Scene;
	renderer: Renderer;
	audio: GameAudio;
	/** Human car — końcówka show lerpuje do pose kickoff chase. */
	humanPlayer?: Player;
	/** Piłka — reveal przed kickoffem. */
	ball?: GameObject;
	/** Auta — team intro spotlight. */
	cars?: CarEntity[];
};

/**
 * ~20 s — miejsce na intro/build/drop jak w pro laser cueing
 * (Pangolin: anticipation → build → hero drop → outro).
 */
const SHOW_DURATION_SEC_DEFAULT = 6;
function resolveShowDurationSec(): number {
	try {
		const q = new URLSearchParams(location.search).get("showSec");
		if (q) {
			const n = Number(q);
			if (Number.isFinite(n) && n >= 2 && n <= 60) return n;
		}
	} catch {
		/* ignore */
	}
	return SHOW_DURATION_SEC_DEFAULT;
}
const SHOW_DURATION_SEC = resolveShowDurationSec();
const SKIP_UNLOCK_SEC = 0.35;
/** Udział faz (suma = 1). Ostatnia = najazd na kickoff. */
const PHASE_ORBIT = 0.1;
const PHASE_FLYOVER = 0.4;
const PHASE_LED = 0.24;
const PHASE_SETTLE = 1 - PHASE_ORBIT - PHASE_FLYOVER - PHASE_LED;

/** Normalized show-U cue points (aligned with StadiumLaserRig modes). */
const CUE_BUILD = 0.12;
const CUE_LIQUID = 0.32;
const CUE_DROP = 0.5;
const CUE_RAIN = 0.7;
const CUE_BALL = 0.78;

const BASE_FOV = 58;

/**
 * Czy uruchomić show (wyłącz dla capture / probe / short boot).
 */
/** Czy loading już skompilował shadery show w tej sesji strony. */
let prematchShowGpuWarmed = false;
/** Czy widowisko już raz przeszło (rematch → skip). */
let prematchShowPlayed = false;

export function shouldRunPreMatchStadiumShow(): boolean {
	const g = globalThis as unknown as {
		__igniteCaptureCamLock?: boolean;
		__igniteSkipPreMatchShow?: boolean;
		__igniteBootClip?: unknown;
	};
	if (g.__igniteSkipPreMatchShow) return false;
	if (g.__igniteCaptureCamLock) return false;
	if (g.__igniteBootClip) return false;
	if (typeof location !== "undefined") {
		const q = new URLSearchParams(location.search);
		if (q.get("skipShow") === "1" || q.get("noshow") === "1") return false;
	}
	/** Rematch w tej sesji — show już było, od razu countdown. */
	if (prematchShowPlayed) return false;
	/**
	 * Licensed GTA packs = 150–317 draw calls. Show + dispose = gwarantowany
	 * FREEZE na kickoffie — pomiń widowisko, od razu countdown.
	 */
	try {
		if (carIsLicensedPreview(getMatchCarId())) return false;
	} catch {
		/* catalog jeszcze nie gotowy */
	}
	return true;
}

async function yieldFrames(n: number): Promise<void> {
	for (let i = 0; i < n; i++) {
		await new Promise<void>((r) => requestAnimationFrame(() => r()));
	}
}

/**
 * Prekompilacja shaderów widowiska podczas ekranu ładowania meczu
 * (nie na pierwszej klatce show — to był multi-second FREEZE).
 */
export async function warmupPrematchShowGpu(
	deps: PreMatchShowDeps,
): Promise<void> {
	if (prematchShowGpuWarmed) return;
	if (!shouldRunPreMatchStadiumShow()) {
		prematchShowGpuWarmed = true;
		return;
	}
	const show = new PreMatchStadiumShow(deps);
	try {
		/** Bez widocznego overlay podczas loadingu. */
		show.hideForGpuWarmup();
		await show.prewarm();
		prematchShowGpuWarmed = true;
	} finally {
		show.dispose();
	}
}

export function wasPrematchShowGpuWarmed(): boolean {
	return prematchShowGpuWarmed;
}

export async function runPreMatchStadiumShow(
	deps: PreMatchShowDeps,
): Promise<void> {
	if (!shouldRunPreMatchStadiumShow()) return;

	beginPrematchHitchProbe();
	deps.renderer.setRealtimeRtSuspended(true);
	const tConstruct = performance.now();
	const show = new PreMatchStadiumShow(deps);
	markPrematchHitchSpan("PreMatchStadiumShow.construct", tConstruct);
	try {
		setPrematchHitchPhase("show_run");
		await show.run();
		prematchShowPlayed = true;
	} finally {
		/**
		 * Soft teardown najpierw (1 klatka), GPU dispose rozłożony —
		 * sync dispose wszystkich shaderów = hitch na kickoffie.
		 */
		setPrematchHitchPhase("show_teardown");
		const tTear = performance.now();
		show.beginTeardown();
		markPrematchHitchSpan("beginTeardown", tTear);
		await yieldFrames(2);
		setPrematchHitchPhase("show_dispose");
		const tDisp = performance.now();
		/** Chunked GPU dispose — sync wszystkich ShaderMaterial = FREEZE na kickoffie. */
		await show.disposeAsync(yieldFrames);
		markPrematchHitchSpan("dispose", tDisp);
		await yieldFrames(1);
		deps.renderer.setRealtimeRtSuspended(false);
		endPrematchHitchProbe("after_show");
		/** Sync invalidate = BVH/env hitch w countdown — odłóż mocniej. */
		const renderer = deps.renderer;
		window.setTimeout(() => {
			try {
				renderer.invalidateRealtimeRtScene();
			} catch {
				/* match już zamknięty */
			}
		}, 5500);
	}
}

class PreMatchStadiumShow {
	private readonly deps: PreMatchShowDeps;
	private readonly root: THREE.Group;
	private readonly lasers: StadiumLaserRig;
	private readonly jupiters: StadiumJupiterShafts;
	private readonly pyro: StadiumShowPyro;
	private readonly fireworks: StadiumShowFireworks;
	private readonly smoke: StadiumShowSmoke;
	private readonly wash: StadiumColorWash;
	private readonly scanners: StadiumTranceScanners;
	private readonly energy: PitchEnergyField;
	private readonly fx: StadiumShowFx;
	private readonly overlay: HTMLElement;
	private readonly hintEl: HTMLElement;
	private readonly titleEl: HTMLElement;
	private readonly flashEl: HTMLElement;
	private readonly phaseLabelEl: HTMLElement;
	private disposed = false;
	private skipWanted = false;
	private elapsed = 0;
	private raf = 0;
	private reduceMotion = false;
	private lastAtmoKey = "";
	private frameTick = 0;
	private lastFovApplied = -1;
	private readonly hazeQualityScale: number;
	private readonly _eye = new THREE.Vector3();
	private readonly _look = new THREE.Vector3();
	private readonly _settleEye0 = new THREE.Vector3();
	private readonly _settleLook0 = new THREE.Vector3();
	private readonly _kickEye = new THREE.Vector3(0, 5.2, 14);
	private readonly _kickLook = new THREE.Vector3(0, 1.4, 0);
	private settleAnchored = false;
	private slamFired = false;
	private climaxFired = false;
	private liquidHazeFired = false;
	private midRainFired = false;
	/** 0=idle; 1..n = rozłożone bursty po cue (anty-hitch). */
	private rainStagger = 0;
	private dropStagger = 0;
	private tunnelWhooshFired = false;
	private flyWhooshFired = false;
	private teamIntroFired = false;
	private ballRevealFired = false;
	private buildWhooshFired = false;
	private preDropRiserFired = false;
	private fovPunch = 0;
	private shake = 0;
	private savedFov = BASE_FOV;
	/** Odłóż haze o 1–2 klatki po starcie (uniknij hitch na 1. frame). */
	private pendingStartHaze = false;
	/** GPU warmup: wycisz SFX show (bez dźwięków przy precompile). */
	private gpuWarmupSilent = false;
	private readonly detachInput: () => void;

	constructor(deps: PreMatchShowDeps) {
		this.deps = deps;
		this.reduceMotion =
			typeof matchMedia !== "undefined" &&
			matchMedia("(prefers-reduced-motion: reduce)").matches;
		const q = resolveGraphicsSettings().quality;
		this.hazeQualityScale =
			q === "low" || q === "deck" ? 0.55 : q === "medium" ? 0.8 : 1;
		this.root = new THREE.Group();
		this.root.name = "preMatchStadiumShow";
		deps.scene.threeJSScene.add(this.root);

		this.lasers = new StadiumLaserRig();
		this.root.add(this.lasers.root);
		this.jupiters = new StadiumJupiterShafts();
		this.root.add(this.jupiters.root);
		this.pyro = new StadiumShowPyro();
		this.root.add(this.pyro.root);
		this.fireworks = new StadiumShowFireworks();
		this.root.add(this.fireworks.root);
		this.smoke = new StadiumShowSmoke();
		this.root.add(this.smoke.root);
		this.wash = new StadiumColorWash();
		this.root.add(this.wash.root);
		this.scanners = new StadiumTranceScanners();
		this.root.add(this.scanners.root);
		this.energy = new PitchEnergyField();
		this.energy.setOpacityCap(
			q === "low" || q === "deck" ? 0.35 : q === "medium" ? 0.72 : 1,
		);
		this.root.add(this.energy.root);
		this.fx = new StadiumShowFx();
		this.root.add(this.fx.root);
		this.fx.bind(deps.ball, deps.cars);
		this.refreshKickoffPose();

		this.overlay = document.createElement("div");
		this.overlay.className = "prematch-show";
		this.overlay.innerHTML = `
			<div class="prematch-show__flash" data-flash aria-hidden="true"></div>
			<p class="prematch-show__title" data-title>${i18n("prematch.showTitle")}</p>
			<p class="prematch-show__phase" data-phase-label></p>
			<p class="prematch-show__hint" data-hint></p>
		`;
		this.hintEl = this.overlay.querySelector("[data-hint]")!;
		this.titleEl = this.overlay.querySelector("[data-title]")!;
		this.flashEl = this.overlay.querySelector("[data-flash]")!;
		this.phaseLabelEl = this.overlay.querySelector("[data-phase-label]")!;
		this.hintEl.textContent = i18n("prematch.skipHint");
		document.body.appendChild(this.overlay);

		const onSkip = (e: Event) => {
			if (this.elapsed < SKIP_UNLOCK_SEC) return;
			if (e instanceof KeyboardEvent && e.code === "Escape") {
				/* always ok */
			}
			this.skipWanted = true;
		};
		window.addEventListener("keydown", onSkip, true);
		window.addEventListener("pointerdown", onSkip, true);
		this.detachInput = () => {
			window.removeEventListener("keydown", onSkip, true);
			window.removeEventListener("pointerdown", onSkip, true);
		};
	}

	private refreshKickoffPose(): void {
		const player = this.deps.humanPlayer;
		if (!player) return;
		const pose = this.deps.renderer.computeKickoffCameraPose(player);
		if (!pose) return;
		this._kickEye.copy(pose.eye);
		this._kickLook.copy(pose.look);
	}

	async run(): Promise<void> {
		this.deps.audio.setStadiumShowMix(true);
		if (!this.reduceMotion) {
			this.deps.audio.startPrematchTranceBed();
		}
		void this.startCommentaryBed();
		setGoalDotMatrixHype(true);
		const cam = this.deps.renderer.threeJSCamera;
		this.savedFov = cam.fov;
		setPrematchLaserBlackout(true);
		this.deps.renderer.optics.setLaserShowPreserveColor(true);
		this.deps.renderer.optics.setSpectacle({ amount: 0 });
		/** Deep blackout — płótno pod chromatic lasers. */
		this.deps.renderer.optics.setAtmosphere({
			exposureOffset: -0.55,
			coolGrade: 0.1,
			warmGrade: 0.05,
			bloomBias: 0.025,
		});
		if (!prematchShowGpuWarmed) {
			await this.prewarm();
			prematchShowGpuWarmed = true;
		}
		this.overlay.style.display = "";
		this.overlay.classList.add("prematch-show--visible");
		/** Pre-haze po 2. ticku — nie w pierwszej widocznej klatce. */
		this.pendingStartHaze = true;

		await new Promise<void>((resolve) => {
			let last = performance.now();
			const tick = (now: number) => {
				if (this.disposed) {
					resolve();
					return;
				}
				notePrematchHitchTick(now);
				const dt = Math.min((now - last) / 1000, 0.05);
				last = now;
				this.elapsed += dt;
				this.update(dt, this.elapsed);
				this.deps.renderer.render(this.deps.scene, dt);
				if (this.skipWanted || this.elapsed >= SHOW_DURATION_SEC) {
					resolve();
					return;
				}
				this.raf = requestAnimationFrame(tick);
			};
			this.raf = requestAnimationFrame(tick);
		});
	}

	private update(dt: number, t: number): void {
		const musicPulse = this.deps.audio.getMusicPulse();
		const trancePulse = this.deps.audio.getPrematchTrancePulse();
		const pulse = Math.max(musicPulse, trancePulse);
		const laserPulse = Math.max(trancePulse, musicPulse * 0.55);
		const u = Math.min(1, t / SHOW_DURATION_SEC);
		setPrematchHitchShowU(u);
		if (this.pendingStartHaze && this.frameTick >= 2) {
			this.pendingStartHaze = false;
			this.smoke.burst("center", 0.35);
		}
		this.updateAtmosphere(u, pulse);
		this.updateCamera(t, dt, pulse);
		this.frameTick++;
		const odd = (this.frameTick & 1) === 1;
		this.smoke.update(dt, u, pulse, this.deps.renderer.threeJSCamera);
		/** Co 2. klatkę: wash / jupiter / energy / fx — lasers+scanners co klatkę (kick). */
		if (odd) {
			this.wash.update(t, u, pulse);
		}
		this.scanners.update(t, u, laserPulse);
		const smokeDensity = this.smoke.getDensity();
		this.lasers.update(
			t,
			u,
			laserPulse,
			this.deps.renderer.threeJSCamera,
			smokeDensity,
			this.hazeQualityScale,
		);
		if (!odd) {
			this.jupiters.update(
				t,
				u,
				laserPulse,
				this.deps.renderer.threeJSCamera,
				smokeDensity,
			);
		}
		let energyTarget = 0;
		if (u >= CUE_BUILD && u < 1) {
			const rise = THREE.MathUtils.smoothstep(u, CUE_BUILD, CUE_LIQUID);
			const peak = THREE.MathUtils.smoothstep(u, CUE_DROP, CUE_RAIN);
			energyTarget = Math.max(rise * 1.25, peak * 1.45);
			energyTarget *= 1 - THREE.MathUtils.smoothstep(u, 0.84, 0.98);
			const laserPeak =
				THREE.MathUtils.smoothstep(u, CUE_LIQUID, CUE_DROP) *
				(1 - THREE.MathUtils.smoothstep(u, CUE_RAIN, 0.9));
			energyTarget *= 1 - laserPeak * 0.08;
			energyTarget *= 0.85 + pulse * 0.45;
		}
		if (odd) {
			this.energy.update(dt * 2, {
				densityTarget: energyTarget,
				pulse,
				teamMix:
					u >= CUE_DROP && u < CUE_RAIN
						? 0.35 + Math.sin(t * 3.4) * 0.45
						: u >= CUE_BUILD
							? 0.45 + Math.sin(t * 1.1) * 0.28
							: 0.5 + Math.sin(t * 0.35) * 0.1,
			});
			this.fx.update(dt * 2, u, pulse);
			updateGoalDotMatrix(dt * 2, t);
		}
		this.pyro.update(dt, u, pulse);
		this.fireworks.update(dt, u, laserPulse);
		this.updateTitleBeats(u, pulse);
		this.updatePhaseSfx(u);
		const left = Math.max(0, SHOW_DURATION_SEC - t);
		this.overlay.style.opacity =
			u > 0.82
				? String(THREE.MathUtils.clamp((1 - u) / 0.18, 0, 1))
				: "1";
		const phase =
			u < CUE_BUILD
				? "orbit"
				: u < CUE_LIQUID
					? "build"
					: u < CUE_DROP
						? "liquid"
						: u < CUE_RAIN
							? "climax"
							: u < 0.88
								? "rain"
								: "settle";
		this.overlay.dataset.phase = phase;
		const phaseKey =
			phase === "orbit"
				? "prematch.phase.orbit"
				: phase === "build"
					? "prematch.phase.build"
					: phase === "liquid"
						? "prematch.phase.liquid"
						: phase === "climax"
							? "prematch.phase.climax"
							: phase === "rain"
								? "prematch.phase.rain"
								: "prematch.phase.settle";
		this.phaseLabelEl.textContent = i18n(phaseKey);
		if (t >= SKIP_UNLOCK_SEC) {
			this.hintEl.textContent = i18n("prematch.skipHint");
			this.overlay.classList.add("prematch-show--skippable");
		} else {
			this.hintEl.textContent = "";
		}
		this.overlay.dataset.left = left.toFixed(1);
	}

	/** Krzywa światła: blackout → build → DROP → rain → settle. */
	private updateAtmosphere(u: number, pulse: number): void {
		/** Soft build hit — not full drop yet. */
		if (!this.slamFired && u >= CUE_BUILD) {
			this.slamFired = true;
			this.fireFlash(0.55);
			this.fovPunch = 9;
			this.shake = 0.28;
			this.deps.renderer.pulseSpectacle(0.55);
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowSlam(0.9);
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowChoir(1.05, 1.6);
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowCrowdSwell(0.85, 1.5);
			this.titleEl.classList.add("prematch-show__title--slam");
			this.pyro.burst("goalBlue", 1.25);
			this.pyro.burst("goalOrange", 1.25);
			this.smoke.burst("field", 0.7);
			this.smoke.burst("side", 0.55);
			this.fireworks.launch("blue", 0.9);
			this.fireworks.launch("orange", 0.9);
			setGoalDotMatrixPrematchCue("build");
		}
		if (!this.liquidHazeFired && u >= CUE_LIQUID) {
			this.liquidHazeFired = true;
			this.smoke.burst("center", 0.65);
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowWhoosh(0.85);
			setGoalDotMatrixPrematchCue("liquid");
		}
		/** Build tension riser — ~1.2s before DROP (festival cueing). */
		if (!this.preDropRiserFired && u >= CUE_DROP - 0.06) {
			this.preDropRiserFired = true;
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowRiser(1.15, 1.15);
			this.smoke.burst("center", 0.45);
			this.fovPunch = Math.max(this.fovPunch, 3);
		}
		/** HERO DROP — sportowy hit (pyro + gold flash). */
		if (!this.climaxFired && u >= CUE_DROP) {
			this.climaxFired = true;
			this.dropStagger = 1;
			this.fireFlash(0.95);
			this.fovPunch = 18;
			this.shake = 0.72;
			this.deps.renderer.pulseSpectacle(1.15);
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowSlam(1.55);
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowChoir(1.7, 2.4);
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowCrowdSwell(1.65, 2.6);
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowWhoosh(1.35);
			this.titleEl.classList.remove("prematch-show__title--slam");
			void this.titleEl.offsetWidth;
			this.titleEl.classList.add("prematch-show__title--slam");
			/** Pyro + fireworks rozłożone — hitch-aware. */
			this.pyro.burst("goalBlue", 2.2);
			this.pyro.burst("goalOrange", 2.2);
			this.fireworks.launch("mid", 1.4);
			setGoalDotMatrixPrematchCue("climax");
		}
		if (this.dropStagger === 1) {
			this.dropStagger = 2;
			this.pyro.burst("roof", 1.9);
			this.smoke.burst("center", 0.85);
			this.fireworks.launch("blue", 1.2);
			this.fireworks.launch("orange", 1.2);
		} else if (this.dropStagger === 2) {
			this.dropStagger = 3;
			this.smoke.burst("field", 0.75);
			this.fireworks.barrage(1.15);
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowChoir(1.35, 1.9);
		} else if (this.dropStagger === 3) {
			this.dropStagger = 0;
			this.fireFlash(0.55);
			this.pyro.burst("roof", 1.2);
			this.fireworks.launch("side", 1.1);
			this.fireworks.launch("side", 1.1);
		}
		if (!this.tunnelWhooshFired && u >= CUE_DROP + 0.04) {
			this.tunnelWhooshFired = true;
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowWhoosh(1.05);
			/** Mid-drop second hit — Transmission-style double cue. */
			this.pyro.burst("roof", 0.85);
		}
		if (!this.midRainFired && u >= CUE_RAIN) {
			this.midRainFired = true;
			this.rainStagger = 1;
			this.fovPunch = Math.max(this.fovPunch, 7);
			this.shake = Math.max(this.shake, 0.35);
			this.deps.renderer.pulseSpectacle(0.85);
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowWhoosh(1.05);
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowChoir(1.45, 2.1);
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowCrowdSwell(1.25, 1.8);
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowSlam(1.05);
			this.smoke.burst("field", 0.7);
			this.fireworks.barrage(1.05);
			setGoalDotMatrixPrematchCue("rain");
		}
		if (this.rainStagger === 1) {
			this.rainStagger = 2;
			this.pyro.burst("goalBlue", 1.5);
			this.pyro.burst("goalOrange", 1.5);
			this.fireworks.launch("mid", 1.2);
		} else if (this.rainStagger === 2) {
			this.rainStagger = 0;
			this.fireFlash(0.5);
			this.pyro.burst("roof", 1.3);
			this.fireworks.launch("side", 1.15);
			this.fireworks.launch("side", 1.15);
		}

		let exposure = -0.45;
		let bloom = 0.012;
		let cool = 0.1;
		let warm = 0.02;
		if (u < CUE_BUILD) {
			exposure = THREE.MathUtils.lerp(-0.62, -0.48, u / CUE_BUILD);
			bloom = 0.01;
			cool = 0.16;
		} else if (u < CUE_DROP) {
			const p = (u - CUE_BUILD) / (CUE_DROP - CUE_BUILD);
			exposure = THREE.MathUtils.lerp(-0.45, -0.28, p);
			bloom = 0.018 + p * 0.035 + pulse * 0.015;
			cool = 0.1 - p * 0.04;
			warm = 0.02 + p * 0.06;
		} else if (u < CUE_RAIN) {
			const p = (u - CUE_DROP) / (CUE_RAIN - CUE_DROP);
			exposure = -0.12 - p * 0.02;
			bloom = 0.04 + pulse * 0.028;
			warm = 0.14 + pulse * 0.05;
			cool = 0.05;
		} else if (u < 0.88) {
			bloom = 0.05 + pulse * 0.03;
			cool = 0.05;
			warm = 0.14;
			exposure = -0.1;
		} else {
			const p = (u - 0.88) / 0.12;
			exposure = THREE.MathUtils.lerp(-0.2, 0, p);
			bloom = THREE.MathUtils.lerp(0.018, 0, p);
			cool = THREE.MathUtils.lerp(0.04, 0, p);
			warm = THREE.MathUtils.lerp(0.015, 0, p);
		}
		const key = `${exposure.toFixed(2)}_${cool.toFixed(2)}_${warm.toFixed(2)}_${bloom.toFixed(3)}`;
		if (key !== this.lastAtmoKey) {
			this.lastAtmoKey = key;
			this.deps.renderer.optics.setAtmosphere({
				exposureOffset: exposure,
				coolGrade: cool,
				warmGrade: warm,
				bloomBias: Math.min(bloom, 0.055),
			});
		}
	}

	/** Przyciemnij fill areny — lasery potrzebują ciemnego „płótna”. */
	private dimStadiumForLasers(on: boolean): void {
		setPrematchLaserBlackout(on);
	}

	private fireFlash(strength: number): void {
		this.flashEl.style.setProperty(
			"--flash-op",
			String(THREE.MathUtils.clamp(strength, 0, 1)),
		);
		this.flashEl.classList.remove("prematch-show__flash--ping");
		void this.flashEl.offsetWidth;
		this.flashEl.classList.add("prematch-show__flash--ping");
	}

	private updateTitleBeats(u: number, pulse: number): void {
		if (u > CUE_BUILD && u < 0.82 && pulse > 0.5) {
			this.titleEl.classList.add("prematch-show__title--pulse");
		} else {
			this.titleEl.classList.remove("prematch-show__title--pulse");
		}
	}

	private updatePhaseSfx(u: number): void {
		if (!this.flyWhooshFired && u >= PHASE_ORBIT) {
			this.flyWhooshFired = true;
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowWhoosh(0.85);
		}
		if (!this.buildWhooshFired && u >= CUE_BUILD) {
			this.buildWhooshFired = true;
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowWhoosh(0.7);
		}
		if (!this.teamIntroFired && u >= PHASE_ORBIT + PHASE_FLYOVER) {
			this.teamIntroFired = true;
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowWhoosh(0.75);
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowCrowdSwell(0.75, 1.2);
		}
		if (!this.ballRevealFired && u >= CUE_BALL) {
			this.ballRevealFired = true;
			if (!this.gpuWarmupSilent) this.deps.audio.playStadiumShowWhoosh(1.15);
			this.fireFlash(0.14);
			this.fovPunch = Math.max(this.fovPunch, 2.5);
		}
	}

	private updateCamera(t: number, dt: number, pulse: number): void {
		const u = Math.min(1, t / SHOW_DURATION_SEC);
		const hw = RL_ARENA.HALF_WIDTH;
		const hl = RL_ARENA.HALF_LENGTH;
		const cam = this.deps.renderer.threeJSCamera;
		const uOrbitEnd = PHASE_ORBIT;
		const uFlyEnd = uOrbitEnd + PHASE_FLYOVER;
		const uLedEnd = uFlyEnd + PHASE_LED;

		if (u < uOrbitEnd) {
			const p = u / uOrbitEnd;
			const ang = -1.05 + p * 1.9;
			const r = 52 - p * 6;
			/** Cinematic reveal — szeroki orbit z balkonu na tęczowe shafts. */
			this._look.set(0, 3.2 + p * 0.8, Math.sin(p * Math.PI) * hl * 0.08);
			this._eye.set(
				Math.sin(ang) * r,
				20 + Math.sin(p * Math.PI) * 5.5,
				Math.cos(ang) * r * 0.72,
			);
			this.settleAnchored = false;
			this.fovPunch = Math.max(this.fovPunch, 1.8 + p * 1.2);
		} else if (u < uFlyEnd) {
			const p = (u - uOrbitEnd) / PHASE_FLYOVER;
			/** Crane flyover — panorama rainbow fans / liquid sky. */
			const ang = -1.25 + p * 2.65;
			const r = 48 - p * 14;
			this._eye.set(
				Math.sin(ang) * r * 0.96,
				22 + Math.sin(p * Math.PI) * 7,
				Math.cos(ang) * r * 0.7,
			);
			this._look.set(
				Math.sin(p * Math.PI) * hw * 0.15,
				4.0 + p * 1.2,
				THREE.MathUtils.lerp(-hl * 0.35, hl * 0.35, p),
			);
			this.fovPunch = Math.max(this.fovPunch, 3.2);
			this.settleAnchored = false;
		} else if (u < uLedEnd) {
			const p = (u - uFlyEnd) / PHASE_LED;
			/** Hero side cam — DROP tunnel na pełnym kadrze. */
			const side = p < 0.5 ? 1 : -1;
			const q = p < 0.5 ? p * 2 : (p - 0.5) * 2;
			this._eye.set(
				side * hw * (0.78 + q * 0.22),
				19.5 + q * 3.5,
				THREE.MathUtils.lerp(-hl * 0.55, hl * 0.48, p),
			);
			this._look.set(
				-side * hw * 0.05,
				4.0 + Math.sin(p * Math.PI) * 1.4,
				THREE.MathUtils.lerp(-hl * 0.02, hl * 0.12, p),
			);
			this.settleAnchored = false;
		} else {
			if (!this.settleAnchored) {
				this._settleEye0.copy(this._eye);
				this._settleLook0.copy(this._look);
				this.settleAnchored = true;
			}
			this.refreshKickoffPose();
			const p = (u - uLedEnd) / PHASE_SETTLE;
			/** Smoothstep + slight ease-in so kickoff cam arrives cleanly. */
			const ease = p * p * (3 - 2 * p);
			this._eye.lerpVectors(this._settleEye0, this._kickEye, ease);
			this._look.lerpVectors(this._settleLook0, this._kickLook, ease);
		}

		/** Beat punch — FOV + mikro-shake synced to trance kick. */
		if (!this.reduceMotion && u < 0.86 && pulse > 0.3) {
			const dropBoost = u >= CUE_DROP && u < CUE_RAIN ? 1.55 : 1.15;
			this.fovPunch = Math.max(this.fovPunch, pulse * 3.4 * dropBoost);
			this.shake = Math.max(this.shake, pulse * 0.09 * dropBoost);
		}
		this.fovPunch = Math.max(0, this.fovPunch - dt * 12);
		this.shake = Math.max(0, this.shake - dt * 0.5);

		const shakeX = (Math.random() - 0.5) * this.shake;
		const shakeY = (Math.random() - 0.5) * this.shake * 0.7;
		cam.position.copy(this._eye);
		cam.position.x += shakeX;
		cam.position.y += shakeY;
		cam.up.set(0, 1, 0);
		cam.lookAt(this._look);
		const nextFov = this.savedFov + this.fovPunch;
		if (Math.abs(nextFov - this.lastFovApplied) > 0.01) {
			cam.fov = nextFov;
			cam.updateProjectionMatrix();
			this.lastFovApplied = nextFov;
		}
		cam.updateMatrixWorld(true);
	}

	private async startCommentaryBed(): Promise<void> {
		try {
			const bufs = await loadAudioBuffers([...PREMATCH_COMMENTARY_URLS]);
			const ready = bufs.filter((b): b is AudioBuffer => Boolean(b));
			if (ready.length === 0 || this.disposed) return;
			this.deps.audio.startPrematchCommentaryBed(ready);
		} catch {
			/* brak assetów — show bez bedu */
		}
	}

	/** Soft stop — zanim sync dispose GPU (yieldFrames między tym a dispose). */

	/**
	 * Shader compile + 1 cicha klatka PRZED widocznym show —
	 * bez tego pierwsza klatka RAF = multi-second FREEZE (pomiar GPU).
	 */
	async prewarm(): Promise<void> {
		this.gpuWarmupSilent = true;
		const gl = this.deps.renderer.threeJSRenderer;
		const scene = this.deps.scene.threeJSScene;
		const cam = this.deps.renderer.threeJSCamera;
		setPrematchLaserBlackout(true);
		this.deps.renderer.optics.setLaserShowPreserveColor(true);
		this.deps.renderer.optics.setSpectacle({ amount: 0 });
		this.deps.renderer.optics.setAtmosphere({
			exposureOffset: -0.55,
			coolGrade: 0.1,
			warmGrade: 0.05,
			bloomBias: 0.025,
		});
		const tCompile = performance.now();
		try {
			gl.compile(scene, cam);
		} catch {
			/* ignore */
		}
		markPrematchHitchSpan("prewarm.compile", tCompile);

		/**
		 * Wszystkie akty laserów (shafts/fans/liquid/tunnel/hotSweep) +
		 * pyro/smoke/scanners/wash/fx — żeby programy WebGL weszły do cache
		 * zanim zniknie loading.
		 */
		const samples = [
			0.04,
			CUE_BUILD + 0.02,
			CUE_LIQUID + 0.02,
			CUE_DROP + 0.02,
			CUE_RAIN + 0.02,
			0.88,
		];
		for (let i = 0; i < samples.length; i++) {
			const u = samples[i]!;
			/** Reset cue flags żeby każdy sample odpalił bursty GPU. */
			this.slamFired = false;
			this.climaxFired = false;
			this.liquidHazeFired = false;
			this.midRainFired = false;
			this.preDropRiserFired = false;
			this.tunnelWhooshFired = false;
			this.dropStagger = 0;
			this.rainStagger = 0;
			this.update(1 / 60, SHOW_DURATION_SEC * u);
			/** Extra bursty — wszystkie sloty pyro/smoke. */
			if (i === samples.length - 1) {
				this.pyro.burst("goalBlue", 1.2);
				this.pyro.burst("goalOrange", 1.2);
				this.pyro.burst("roof", 1.0);
				this.smoke.burst("center", 0.6);
				this.smoke.burst("field", 0.55);
				this.smoke.burst("side", 0.45);
				this.fireworks.barrage(1.0);
				this.fireFlash(0.4);
			}
			const tR = performance.now();
			this.deps.renderer.render(this.deps.scene, 1 / 60);
			markPrematchHitchSpan(`prewarm.act${i}`, tR);
			await new Promise<void>((r) => requestAnimationFrame(() => r()));
		}

		/** Spike optyki (bloom / grade) — te same passy co w DROP. */
		this.deps.renderer.optics.setAtmosphere({
			exposureOffset: -0.15,
			coolGrade: 0.08,
			warmGrade: 0.12,
			bloomBias: 0.06,
		});
		this.update(1 / 60, SHOW_DURATION_SEC * CUE_DROP);
		{
			const tR = performance.now();
			this.deps.renderer.render(this.deps.scene, 1 / 60);
			markPrematchHitchSpan("prewarm.opticsSpike", tR);
		}
		await new Promise<void>((r) => requestAnimationFrame(() => r()));

		this.gpuWarmupSilent = false;
		this.elapsed = 0;
		this.frameTick = 0;
		this.dropStagger = 0;
		this.rainStagger = 0;
		this.pendingStartHaze = false;
		this.slamFired = false;
		this.climaxFired = false;
		this.liquidHazeFired = false;
		this.midRainFired = false;
		this.preDropRiserFired = false;
		this.tunnelWhooshFired = false;
		this.flyWhooshFired = false;
		this.teamIntroFired = false;
		this.ballRevealFired = false;
		this.buildWhooshFired = false;
		this.deps.renderer.optics.setAtmosphere({
			exposureOffset: -0.55,
			coolGrade: 0.1,
			warmGrade: 0.05,
			bloomBias: 0.025,
		});
	}

	hideForGpuWarmup(): void {
		this.overlay.style.display = "none";
		this.overlay.style.opacity = "0";
		this.overlay.style.pointerEvents = "none";
	}

	/** Soft stop — zanim sync dispose GPU (yieldFrames między tym a dispose). */
	beginTeardown(): void {
		cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.overlay.style.opacity = "0";
		this.overlay.style.pointerEvents = "none";
		setPrematchLaserBlackout(false);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.teardownPresentation();
		this.lasers.dispose();
		this.jupiters.dispose();
		this.pyro.dispose();
		this.fireworks.dispose();
		this.smoke.dispose();
		this.wash.dispose();
		this.scanners.dispose();
		this.energy.dispose();
		this.fx.dispose();
		this.root.removeFromParent();
	}

	/**
	 * Dispose GPU w 3 chunkach + yield między nimi.
	 * Sync dispose wszystkich rigów = hitch ≥100 ms na show_dispose.
	 */
	async disposeAsync(
		yieldBetween: (n: number) => Promise<void>,
	): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.teardownPresentation();

		this.lasers.dispose();
		this.jupiters.dispose();
		this.pyro.dispose();
		await yieldBetween(1);

		this.fireworks.dispose();
		this.smoke.dispose();
		this.wash.dispose();
		await yieldBetween(1);

		this.scanners.dispose();
		this.energy.dispose();
		this.fx.dispose();
		this.root.removeFromParent();
	}

	/** Wspólny soft reset optics/audio/DOM przed dispose GPU. */
	private teardownPresentation(): void {
		cancelAnimationFrame(this.raf);
		this.detachInput();
		this.deps.audio.setStadiumShowMix(false);
		this.deps.audio.stopPrematchTranceBed();
		this.deps.audio.stopPrematchCommentaryBed();
		setGoalDotMatrixHype(false);
		this.dimStadiumForLasers(false);
		this.deps.renderer.optics.setLaserShowPreserveColor(false);
		this.deps.renderer.optics.setSpectacle({ amount: 0 });
		this.deps.renderer.optics.setAtmosphere({
			exposureOffset: 0,
			coolGrade: 0,
			warmGrade: 0,
			bloomBias: 0,
		});
		this.deps.renderer.resetGoalPresentation();
		const cam = this.deps.renderer.threeJSCamera;
		cam.fov = this.savedFov;
		cam.updateProjectionMatrix();
		this.overlay.style.opacity = "";
		this.overlay.remove();
		this.fx.restoreBallForKickoff();
	}
}
