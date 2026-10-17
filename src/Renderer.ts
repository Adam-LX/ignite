import * as THREE from "three";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer.js";

import {
	showcaseDof,
	usesDirectRender,
} from "./visual/garagePresentationPolicy";
import { renderJumbotronBroadcast } from "./visual/jumbotronBroadcast";
import type Scene from "./Scene";
import type { GraphicsSettings } from "./util/graphicsProfile";
import { resolveGraphicsSettings } from "./util/graphicsProfile";
import type Player from "./util/Player";
import {
	BASE_FOV,
	type ChaseCameraState,
	clampLookAtPitch,
	createChaseCameraState,
	horizontalFovToVertical,
	KICKOFF_CAM_DISTANCE,
	KICKOFF_CAM_HEIGHT,
	KICKOFF_LOOK_AHEAD,
	KICKOFF_LOOK_Y,
	resetChaseCameraHeading,
	sampleCountdownChaseCameraTargets,
	sampleLiveMatchChaseCameraTargets,
	updateChaseCamera,
	finalizeSoccarCamera,
	horizontalFovForAspect,
	tickBallCamBlendT,
} from "./visual/cameraFollow";
import {
	CHASE_RIG_BLEND_SEC,
	CHASE_RIG_TOAST_SEC,
	CHASE_RIGS,
	chaseRigBlendAlpha,
	chaseRigByIndex,
	CLASSIC_CHASE_RIG,
	lerpChaseRigParams,
	nextChaseRigIndex,
	type ChaseRigId,
	type ChaseRigLabelKey,
	type ChaseRigParams,
} from "./visual/cameraPresets";
import { RL_CAMERA } from "./util/rlConstants";
import {
	applyIgniteQuakeOverlay,
	IgniteQuake,
	type IgniteQuakeKind,
} from "./visual/igniteQuake";
import { computeCarNameTagAnchor } from "./visual/CarNameTag";
import {
	type CinematicPostFx,
	createCinematicPostFx,
	type PremiumFxInput,
} from "./visual/cinematicPostFx";
import { PostProcessor } from "./visual/PostProcessor";
import {
	createPremiumPostStack,
	type PremiumPostStack,
} from "./visual/premiumPostStack";
import {
	createMatchOpticsDirector,
	type MatchOpticsDirector,
} from "./visual/optics";
import {
	disposePitchSsr,
	getPitchSsrPreset,
	mountPitchSsr,
} from "./visual/pitchSsr";
import { applyPitchWetness } from "./visual/pitchWetness";
import { getGoalFloodMix } from "./visual/stadiumLighting";
import { IgniteRtDirector } from "./visual/pathTracing/IgniteRtDirector";
import { updatePathTraceDebugHud } from "./visual/pathTracing/pathTraceDebugHud";

const CLEAR_COLOR = 0x06040e;

class Renderer {
	threeJSRenderer: THREE.WebGLRenderer;
	threeJSCamera: THREE.PerspectiveCamera;
	cameraForward: THREE.Vector3;
	private readonly cinematicFx: CinematicPostFx;
	/** pmndrs/postprocessing — cinematic look + lens flare (menu/legacy hooks). */
	private readonly premiumPost: PremiumPostStack;
	/** Zunifikowane recepty: światła / cienie / bloom / flary / snopy / blur. */
	readonly optics: MatchOpticsDirector;
	/** Film hybrid + opcjonalny GPU RT (IgniteRtDirector). */
	private readonly rtDirector: IgniteRtDirector;
	/** UnrealBloom — legacy; match path = premium only. */
	private readonly postProcessor: PostProcessor;
	private readonly labelRenderer: CSS2DRenderer;
	private readonly jumbotronRenderer: CSS3DRenderer;
	private readonly renderContainer: HTMLElement;
	/** CSS2D dopiero po chase snap — inaczej YOU nad ghost orbitą. */
	private nameTagsArmed = true;
	private readonly presentCanvas: HTMLCanvasElement;
	private readonly presentCtx: CanvasRenderingContext2D;
	/** Po renderze — clip MP4 (blit musi być synchroniczny z drawing buffer). */
	private clipFrameHook: (() => void) | null = null;
	private clipCaptureActive = false;
	/** Scena meczu — planar SSR murawy (high). */
	private pitchSsrScene: THREE.Scene | null = null;

	private readonly baseHorizontalFov = BASE_FOV;
	private readonly chaseState: ChaseCameraState;
	/** Kamera startuje w Ball Cam; Spacja przełącza Car Cam. */
	private isBallCam = true;
	/** 0 = Free Cam, 1 = Ball Cam — płynny blend przy toggle (RL transitionSpeed). */
	private ballCamBlendT = 1;
	/** 0 = normal chase, 1 = look behind (MMB). */
	private lookBackBlendT = 0;
	private lookBackWanted = false;
	/** Alt chase rig (V) — classic domyślnie. */
	private altRigIndex = 0;
	private altRigFromIndex = 0;
	private altRigToIndex = 0;
	/** 0→1 przez CHASE_RIG_BLEND_SEC. */
	private altRigBlend = 1;
	private altRigToastLeft = 0;
	private altRigToastId: ChaseRigId | null = null;
	private effectiveChaseRig: ChaseRigParams = { ...CLASSIC_CHASE_RIG };
	/** 0 = kickoff look (niski lift), 1 = pełny meczowy horizon lift. */
	private countdownCamBlend = 0;
	/** Cooldown awaryjnego snapu (live) — bez spamowania co klatkę. */
	private frameRescueCooldown = 0;
	/** Mecz: cienie co N klatek (3 mapy × autoUpdate = hitch GPU). */
	private matchShadowFrame = 0;
	private jumbotronFrame = 0;
	/** Stadionowe trzęsienie — goal / demo / GO. */
	private readonly igniteQuake = new IgniteQuake();
	private quakeFovKick = 0;
	/** RL Demo Transition — lot death→spawn. */
	private demoCamActive = false;
	private demoCamT = 0;
	private demoCamDuration = 0.55;
	private readonly demoCamFrom = new THREE.Vector3();
	private readonly demoCamTo = new THREE.Vector3();
	private readonly demoCamEye = new THREE.Vector3();
	private readonly demoCamLook = new THREE.Vector3();

	constructor(container: HTMLElement = document.body) {
		this.renderContainer = container;
		this.chaseState = createChaseCameraState(BASE_FOV);
		this.threeJSRenderer = new THREE.WebGLRenderer({
			// MSAA w EffectComposer (mecz). Kontekst antialias + direct render
			// w menu/garażu = smuga „rozdwojenia” przy obrocie (Print Screen = OK).
			antialias: false,
			powerPreference: "high-performance",
			failIfMajorPerformanceCaveat: false,
			alpha: false,
			/**
			 * Clip bierze klatkę z present 2D (po blitie) — nie trzeba
			 * preserveDrawingBuffer (duży koszt GPU na NVIDIA/Wayland).
			 */
			preserveDrawingBuffer: false,
			stencil: false,
		});
		if (!this.threeJSRenderer.capabilities.isWebGL2) {
			console.warn("FlyBall: WebGL2 niedostępne, używam WebGL1");
		}
		this.threeJSRenderer.setClearColor(CLEAR_COLOR, 1);
		this.threeJSRenderer.shadowMap.enabled = true;
		this.threeJSRenderer.shadowMap.autoUpdate = true;
		this.threeJSRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
		// Showcase (menu/garaż): ACES na rendererze. Mecz: NoToneMapping — ACES w cinematic.
		this.threeJSRenderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.threeJSRenderer.toneMappingExposure = this.baseExposure;
		this.threeJSRenderer.outputColorSpace = THREE.SRGBColorSpace;
		container.appendChild(this.threeJSRenderer.domElement);
		this.threeJSRenderer.domElement.style.background = "#0b1424";
		this.threeJSRenderer.domElement.tabIndex = 0;
		this.threeJSRenderer.domElement.style.outline = "none";
		this.threeJSRenderer.domElement.className = "webgl-source-canvas";

		this.presentCanvas = document.createElement("canvas");
		this.presentCanvas.className = "webgl-present-canvas";
		this.presentCanvas.tabIndex = -1;
		container.appendChild(this.presentCanvas);
		const ctx = this.presentCanvas.getContext("2d", {
			alpha: false,
			/** Szybszy blit bez synchro z compositorem (mecz 60+). */
			desynchronized: true,
		} as CanvasRenderingContext2DSettings);
		if (!ctx) {
			throw new Error("FlyBall: brak kontekstu 2D dla prezentacji showcase");
		}
		this.presentCtx = ctx;

		this.labelRenderer = new CSS2DRenderer();
		this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
		this.labelRenderer.domElement.className = "car-name-tag-layer";
		container.appendChild(this.labelRenderer.domElement);

		this.jumbotronRenderer = new CSS3DRenderer();
		this.jumbotronRenderer.setSize(window.innerWidth, window.innerHeight);
		this.jumbotronRenderer.domElement.className = "jumbotron-layer";
		container.insertBefore(
			this.jumbotronRenderer.domElement,
			this.labelRenderer.domElement,
		);

		const aspect = window.innerWidth / window.innerHeight;
		this.threeJSCamera = new THREE.PerspectiveCamera(
			horizontalFovToVertical(
				horizontalFovForAspect(this.baseHorizontalFov, aspect),
				aspect,
			),
			aspect,
			0.35,
			2500,
		);
		this.cameraForward = new THREE.Vector3(0, 0, -1);

		this.cinematicFx = createCinematicPostFx();
		this.cinematicFx.setPremiumScale(resolveGraphicsSettings().quality);
		this.premiumPost = createPremiumPostStack(
			this.threeJSRenderer,
			new THREE.Scene(),
			this.threeJSCamera,
			this.cinematicFx,
		);
		this.optics = createMatchOpticsDirector(
			this.premiumPost,
			this.cinematicFx,
		);
		this.optics.setQuality(resolveGraphicsSettings().quality);
		this.rtDirector = new IgniteRtDirector(this.threeJSRenderer);
		this.premiumPost.setBloomStrength(this.bloomStrengthForPass());
		this.premiumPost.setMultisampling(resolveGraphicsSettings().quality);
		this.postProcessor = new PostProcessor(
			this.threeJSRenderer,
			new THREE.Scene(),
			this.threeJSCamera,
		);
		this.postProcessor.setBloomStrength(this.unrealBloomStrength());
		this.postProcessor.setAaQuality(resolveGraphicsSettings().quality);
		this.postProcessor.setBloomEnabled(false);

		window.addEventListener("resize", () =>
			this.setSize(window.innerWidth, window.innerHeight),
		);
		this.setSize(window.innerWidth, window.innerHeight);
	}

	private isShowcasePresentation(): boolean {
		return this.menuPresentationActive || this.garagePresentationActive;
	}

	render(scene: Scene, dt = 0) {
		/** Ultrawide / FS: aspect musi dogonić okno zanim cokolwiek narysujemy. */
		this.syncViewportIfNeeded();

		this.threeJSRenderer.setClearColor(CLEAR_COLOR, 1);
		this.premiumPost.setScene(scene.threeJSScene, this.threeJSCamera);
		this.postProcessor.setScene(scene.threeJSScene, this.threeJSCamera);

		const weather = scene.weather;
		if (weather && dt > 0) {
			weather.setFloodLights(scene.lighting.pitchLights);
			weather.update(dt, this.threeJSCamera);
		}
		/** Lens: lekki; główny deszcz = smugi 3D. */
		/** Lens = mokra soczewka (HEAD strength); 3D Points uzupełniają. */
		const rainAmount = (weather?.intensity ?? 0) * 1.0;
		const floodMix = getGoalFloodMix();
		const quality = resolveGraphicsSettings().quality;
		const qualityMul =
			quality === "high" ? 1 : quality === "medium" ? 0.78 : 0.58;
		/** Stały premium „breath” soczewki na high — bez wash. */
		const baselineLens =
			quality === "high" && !this.menuPresentationActive ? 0.15 : 0;
		const haloAmount =
			(rainAmount * 0.12 +
				floodMix * 0.18 +
				this.lensArtifactPulse * 0.3 +
				baselineLens) *
			qualityMul;
		const dirtAmount =
			(rainAmount * 0.16 +
				floodMix * 0.05 +
				this.lensArtifactPulse * 0.1 +
				baselineLens * 0.35) *
			qualityMul;
		const streakAmount =
			(floodMix * 0.14 +
				this.lensArtifactPulse * 0.34 +
				rainAmount * 0.04 +
				baselineLens * 0.55) *
			qualityMul;
		applyPitchWetness(rainAmount);
		this.premiumPost.updateRainLens(dt, rainAmount);
		this.premiumPost.updateLensArtifacts(dt, {
			haloAmount,
			dirtAmount,
			streakAmount,
		});
		this.premiumPost.updateMatchChroma(dt);
		/** postProcessor tylko gdy renderuje (menu legacy / direct nie); mecz = premium. */
		if (this.menuPresentationActive) {
			this.postProcessor.updateRainLens(dt, rainAmount);
			this.postProcessor.updateLensArtifacts(dt, {
				haloAmount: haloAmount * 0.78,
				dirtAmount: dirtAmount * 0.72,
				streakAmount: streakAmount * 0.75,
			});
			this.postProcessor.updateMatchChroma(dt);
		}

		if (usesDirectRender(this.menuPresentationActive, this.garagePresentationActive)) {
			this.renderShowcase(scene);
			this.notifyClipFrame();
			return;
		}

		this.threeJSRenderer.toneMapping = THREE.NoToneMapping;
		this.threeJSRenderer.toneMappingExposure = this.menuPresentationActive
			? this.baseExposure * 1.12
			: this.baseExposure;
		this.threeJSCamera.updateMatrixWorld(true);
		this.threeJSRenderer.resetState();
		/**
		 * Menu premium bywał zostawiał scissor/viewport na wycinku.
		 * setViewport/setScissor biorą CSS px (Three mnoży przez DPR) —
		 * NIGDY drawingBufferSize (to = podwójne DPR → auto/YOU w prawo).
		 */
		{
			const gl = this.threeJSRenderer;
			const css = gl.getSize(new THREE.Vector2());
			gl.setRenderTarget(null);
			gl.setViewport(0, 0, css.x, css.y);
			gl.setScissor(0, 0, css.x, css.y);
			gl.setScissorTest(false);
		}

		/**
		 * Mecz: zawsze UnrealBloom + OutputPass (ACES) — ten sam „żywy” look
		 * co Shift+R. Premium (cinematic/flares) bez tonemap tłumił kolory.
		 * Menu: premium stack (orbita + soft flares).
		 */
		if (this.menuPresentationActive) {
			this.optics.setMode("menu");
			this.optics.apply(this.threeJSRenderer);
			this.premiumPost.render(dt);
			this.blitShowcaseToPresentCanvas(this.threeJSRenderer.domElement);
		} else {
			/**
			 * Mecz: premium stack → blit→present (Wayland: bez ghostingu orbity).
			 */
			renderJumbotronBroadcast(
				this.threeJSRenderer,
				scene.threeJSScene,
			);
			this.tickMatchShadowMaps();
			this.optics.setMode("match", resolveGraphicsSettings().quality);
			const floodMix = getGoalFloodMix();
			this.optics.setFlood({
				active: floodMix > 0.01,
				mix: floodMix,
			});
			this.optics.apply(this.threeJSRenderer);
			if (!this.pitchSsrCleaned) this.syncPitchSsr(scene.threeJSScene);

			const rtFrame = this.rtDirector.prepareAndMaybeRenderRt(
				this.threeJSRenderer,
				scene.threeJSScene,
				this.threeJSCamera,
			);
			updatePathTraceDebugHud(
				rtFrame.usedRealtimeRt ||
					rtFrame.backend === "warming" ||
					rtFrame.backend === "film-hybrid",
				rtFrame.stats
					? {
							samples: rtFrame.usedRealtimeRt ? 1 : 0,
							spp: 1,
							rebuilt: rtFrame.stats.compiled,
							ms: rtFrame.stats.ms,
						}
					: null,
				rtFrame.backend,
			);
			if (!rtFrame.usedRealtimeRt) {
				this.premiumPost.render(dt);
			}
			this.blitShowcaseToPresentCanvas(this.threeJSRenderer.domElement);
		}
		this.syncLabelLayerToCanvas();
		this.jumbotronRenderer.domElement.style.visibility =
			this.menuPresentationActive ? "hidden" : "visible";
		if (!this.menuPresentationActive) {
			this.jumbotronFrame += 1;
			/** Co 2. klatkę — CSS3D jumbotron = mikro-hitch na słabszych GPU. */
			if ((this.jumbotronFrame & 1) === 1) {
				this.jumbotronRenderer.render(scene.threeJSScene, this.threeJSCamera);
			}
		}
		this.labelRenderer.render(scene.threeJSScene, this.threeJSCamera);
		this.notifyClipFrame();
	}

	private renderShowcase(scene: Scene): void {
		const glCanvas = this.threeJSRenderer.domElement;
		this.threeJSRenderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.threeJSRenderer.setRenderTarget(null);
		this.threeJSRenderer.resetState();
		this.threeJSRenderer.clear(true, true, true);
		this.threeJSRenderer.render(scene.threeJSScene, this.threeJSCamera);
		this.blitShowcaseToPresentCanvas(glCanvas);
	}

	private notifyClipFrame(): void {
		this.clipFrameHook?.();
	}

	/**
	 * Clip: NIE blitować ponownie z WebGL.
	 * Mecz już zrobił blit→present przed notifyClipFrame; drugi drawImage
	 * z oczyszczonego backbuffera (NVIDIA/Wayland) = zielone klatki w F9.
	 */
	blitForClipCapture(): void {
		/* presentCanvas jest aktualny — no-op */
	}

	/** Hook po klatce (clip recorder). */
	setClipFrameHook(hook: (() => void) | null): void {
		this.clipFrameHook = hook;
	}

	/** Włącz blit→present tylko podczas REC (inaczej desync meczowy). */
	setClipCaptureActive(active: boolean): void {
		this.clipCaptureActive = active;
		if (active) {
			this.enforceMatchPresentationStack();
		}
	}

	isClipCaptureActive(): boolean {
		return this.clipCaptureActive;
	}

	/** Compositor Wayland — blit do 2D (menu / mecz / clip). */
	private blitShowcaseToPresentCanvas(source: HTMLCanvasElement): void {
		const w = source.width;
		const h = source.height;
		if (w < 1 || h < 1) {
			/** Nie zostawiaj starego kadru orbity — wyczyść present. */
			this.clearPresentCanvas();
			return;
		}
		if (this.presentCanvas.width !== w || this.presentCanvas.height !== h) {
			this.presentCanvas.width = w;
			this.presentCanvas.height = h;
		}
		this.presentCtx.globalCompositeOperation = "copy";
		this.presentCtx.drawImage(source, 0, 0, w, h);
		this.presentCtx.globalCompositeOperation = "source-over";
	}

	private clearPresentCanvas(): void {
		const w = this.presentCanvas.width;
		const h = this.presentCanvas.height;
		if (w < 1 || h < 1) return;
		this.presentCtx.fillStyle = "#0b1424";
		this.presentCtx.fillRect(0, 0, w, h);
	}

	private setShowcasePresentMode(_active: boolean): void {
		const glCanvas = this.threeJSRenderer.domElement;
		/**
		 * Menu i mecz: present 2D na wierzchu (blit ze source).
		 * Source zostaje w layoutcie (opacity 0) — display:none zamraża WebGL.
		 */
		if (!this.presentCanvas.parentElement) {
			const jumboEl = this.jumbotronRenderer.domElement;
			if (jumboEl.parentElement === this.renderContainer) {
				this.renderContainer.insertBefore(this.presentCanvas, jumboEl);
			} else {
				const labelEl = this.labelRenderer.domElement;
				if (labelEl.parentElement === this.renderContainer) {
					this.renderContainer.insertBefore(this.presentCanvas, labelEl);
				} else {
					this.renderContainer.appendChild(this.presentCanvas);
				}
			}
		}

		glCanvas.style.display = "block";
		glCanvas.style.position = "absolute";
		glCanvas.style.inset = "0";
		glCanvas.style.width = "100%";
		glCanvas.style.height = "100%";
		glCanvas.style.opacity = "0";
		glCanvas.style.pointerEvents = "none";
		glCanvas.style.zIndex = "0";

		this.presentCanvas.style.display = "block";
		this.presentCanvas.style.position = "absolute";
		this.presentCanvas.style.inset = "0";
		this.presentCanvas.style.width = "100%";
		this.presentCanvas.style.height = "100%";
		this.presentCanvas.style.zIndex = "1";
		this.presentCanvas.style.opacity = "1";
		this.presentCanvas.style.pointerEvents = "auto";
	}

	/**
	 * Mecz: present na wierzchu (blit), source ukryty opacity 0.
	 * Nie czyść present tutaj co klatkę — tylko przy wejściu w mecz (caller).
	 */
	enforceMatchPresentationStack(): void {
		this.setShowcasePresentMode(true);
	}

	/** CSS2D musi mieć ten sam CSS-box co canvas — inaczej YOU obok auta. */
	private syncLabelLayerToCanvas(): void {
		const canvas =
			this.isShowcasePresentation() || !this.presentCanvas.parentElement
				? this.threeJSRenderer.domElement
				: this.presentCanvas;
		const rect = canvas.getBoundingClientRect();
		const w = Math.max(1, Math.round(rect.width));
		const h = Math.max(1, Math.round(rect.height));
		const el = this.labelRenderer.domElement;
		if (
			Math.abs(el.clientWidth - w) > 1 ||
			Math.abs(el.clientHeight - h) > 1
		) {
			this.labelRenderer.setSize(w, h);
			this.jumbotronRenderer.setSize(w, h);
		}
		el.style.left = "0";
		el.style.top = "0";
		el.style.width = "100%";
		el.style.height = "100%";
		const jumbo = this.jumbotronRenderer.domElement;
		jumbo.style.left = "0";
		jumbo.style.top = "0";
		jumbo.style.width = "100%";
		jumbo.style.height = "100%";
	}

	/** Ukryj CSS2D na przejściu menu→mecz — zanim chase/resync domknie kadr. */
	setNameTagsArmed(armed: boolean): void {
		this.nameTagsArmed = armed;
		const el = this.labelRenderer.domElement;
		el.style.visibility = armed ? "visible" : "hidden";
		el.style.opacity = armed ? "1" : "0";
	}

	isNameTagsArmed(): boolean {
		return this.nameTagsArmed;
	}

	/** Gdy okno/FS zmienia rozmiar (ultrawide) — aspect zanim narysujemy klatkę. */
	private syncViewportIfNeeded(): void {
		const w = Math.max(1, Math.floor(window.innerWidth));
		const h = Math.max(1, Math.floor(window.innerHeight));
		const gl = this.threeJSRenderer.domElement;
		const dpr = this.threeJSRenderer.getPixelRatio();
		const needW = Math.max(1, Math.floor(w * dpr));
		const needH = Math.max(1, Math.floor(h * dpr));
		if (
			gl.width !== needW ||
			gl.height !== needH ||
			Math.abs(this.threeJSCamera.aspect - w / h) > 0.001
		) {
			this.setSize(w, h);
		}
	}

	setSize(width: number, height: number) {
		/** GNOME/Electron bywa 0×H przy resize — NaN aspect zamraża kadr. */
		const w = Math.max(1, Math.floor(width || window.innerWidth || 1280));
		const h = Math.max(1, Math.floor(height || window.innerHeight || 720));
		if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) {
			return;
		}
		/** Najpierw DPR → drawing buffer, potem composer bierze getDrawingBufferSize. */
		this.threeJSRenderer.setSize(w, h, false);
		const db = this.threeJSRenderer.getDrawingBufferSize(new THREE.Vector2());
		this.rtDirector.setSize(db.x, db.y);
		const gl = this.threeJSRenderer.domElement;
		/**
		 * CSS zawsze 100% kontenera — stałe px + 100% w CSS = letterbox / czarne pasy
		 * gdy chrome okna / DPR zmienia się po wyjściu z menu (DPR=1 → full).
		 */
		gl.style.width = "100%";
		gl.style.height = "100%";
		this.premiumPost.setSize(w, h);
		this.postProcessor.resize(w, h);
		/**
		 * Ustawianie width/height czyści canvas 2D. Przy tym samym rozmiarze
		 * (ensureViewportSync ×3) kasowało świeży chase i zostawiało ghost orbity
		 * pod CSS2D (YOU na środku, auto z boku).
		 */
		if (
			this.presentCanvas.width !== gl.width ||
			this.presentCanvas.height !== gl.height
		) {
			this.presentCanvas.width = gl.width;
			this.presentCanvas.height = gl.height;
		}
		this.presentCanvas.style.width = "100%";
		this.presentCanvas.style.height = "100%";
		this.labelRenderer.setSize(w, h);
		this.jumbotronRenderer.setSize(w, h);
		const aspect = w / h;
		if (!Number.isFinite(aspect) || aspect < 0.2 || aspect > 8) {
			return;
		}
		this.threeJSCamera.aspect = aspect;
		this.threeJSCamera.fov = horizontalFovToVertical(
			horizontalFovForAspect(
				this.chaseState.currentHorizontalFov,
				this.threeJSCamera.aspect,
			),
			this.threeJSCamera.aspect,
		);
		this.threeJSCamera.updateProjectionMatrix();
		if (this.pitchSsrScene) {
			this.syncPitchSsr(this.pitchSsrScene);
			this.syncPitchPlanarReflection(this.pitchSsrScene);
		}
	}

	/** Planar wet reflections — OFF; nie wołaj getObjectByName co klatkę. */
	private pitchSsrCleaned = false;

	private syncPitchPlanarReflection(_scene: THREE.Scene): void {
		/** Planar mountuje IgniteRtDirector (film hybrid) — tu no-op. */
	}

	private syncPitchSsr(scene: THREE.Scene): void {
		this.pitchSsrScene = scene;
		const preset = getPitchSsrPreset(resolveGraphicsSettings().quality);
		if (!preset.enabled) {
			if (this.pitchSsrCleaned) return;
			disposePitchSsr();
			const leftover = scene.getObjectByName("pitchSsrReflector");
			if (leftover) leftover.removeFromParent();
			this.pitchSsrCleaned = true;
			return;
		}
		this.pitchSsrCleaned = false;
		const buf = this.threeJSRenderer.getDrawingBufferSize(new THREE.Vector2());
		mountPitchSsr(
			scene,
			resolveGraphicsSettings().quality,
			buf.x,
			buf.y,
		);
	}

	/**
	 * Po menu→mecz / fullscreen: podwójny sync (layout + DPR mogą dojść o 1 klatkę później).
	 */
	ensureViewportSync(): void {
		const apply = () =>
			this.setSize(window.innerWidth, window.innerHeight);
		apply();
		requestAnimationFrame(() => {
			apply();
			requestAnimationFrame(apply);
		});
	}

	/** Odśwież rozmiar composera po przełączeniu menu ↔ mecz / zmianie DPR. */
	private syncComposerRenderTarget(): void {
		this.setSize(window.innerWidth, window.innerHeight);
	}

	private bloomStrengthForPass(): number {
		// UnrealBloom ~0.12–0.2 → pmndrs Bloom intensity ~0.35–0.65
		return this.baseBloomStrength * 3.0;
	}

	/** Bazowa intensywność UnrealBloom — legacy path. */
	private unrealBloomStrength(): number {
		return THREE.MathUtils.clamp(this.baseBloomStrength * 0.55, 0.03, 0.075);
	}

	private baseExposure = 0.8;
	private baseBloomStrength = 0.05;
	private menuPresentationActive = false;
	private garagePresentationActive = false;
	private goalFovBoost = 0;
	private cinematicPulse = 0;
	private lensArtifactPulse = 0;
	private readonly premiumInput: PremiumFxInput = {
		focusUv: new THREE.Vector2(0.5, 0.5),
		dofStrength: 0,
		motionBlurDir: new THREE.Vector2(0, 0),
		motionBlurStrength: 0,
	};
	private readonly ballProjA = new THREE.Vector3();
	private pendingDofStrength = 0;
	private menuDofPulse = 0;

	updateCinematicFx(
		dt: number,
		speedMps = 0,
		boosting = false,
		pulse = 0,
	): void {
		const inMenuUi =
			this.menuPresentationActive || this.garagePresentationActive;
		if (inMenuUi) {
			pulse = 0;
			this.cinematicPulse = 0;
		} else if (pulse > 0) {
			this.cinematicPulse = Math.max(this.cinematicPulse, pulse);
		}
		this.cinematicFx.update(
			dt,
			speedMps,
			boosting,
			inMenuUi ? 0 : this.cinematicPulse,
			this.premiumInput,
		);
		this.premiumPost.update(dt);
		if (!inMenuUi) {
			this.cinematicPulse = Math.max(0, this.cinematicPulse - dt * 1.85);
			this.lensArtifactPulse = Math.max(0, this.lensArtifactPulse - dt * 1.7);
		}
		this.menuDofPulse = Math.max(0, this.menuDofPulse - dt * 2.6);
	}

	/** Kinowy DoF — focus na aucie w menu głównym. */
	updateMenuShowcaseFx(carPos: THREE.Vector3, baseDof = 0.2): void {
		this.ballProjA.copy(carPos).project(this.threeJSCamera);
		this.premiumInput.focusUv.set(
			(this.ballProjA.x + 1) * 0.5,
			(this.ballProjA.y + 1) * 0.5,
		);
		this.premiumInput.motionBlurStrength = 0;
		this.premiumInput.dofStrength = baseDof + this.menuDofPulse;
	}

	pulseMenuDofFocus(strength = 0.55): void {
		this.menuDofPulse = Math.max(this.menuDofPulse, strength);
	}

	clearMenuShowcaseFx(): void {
		this.menuDofPulse = 0;
		this.premiumInput.dofStrength = 0;
		this.premiumInput.motionBlurStrength = 0;
		this.premiumInput.focusUv.set(0.5, 0.5);
	}

	setAtmospherePresentation(
		exposureOffset: number,
		coolGrade: number,
		warmGrade: number,
		bloomBias: number,
	): void {
		if (this.menuPresentationActive || this.garagePresentationActive) return;
		this.optics.setAtmosphere({
			exposureOffset,
			coolGrade,
			warmGrade,
			bloomBias,
		});
	}

	/** DoF focus + motion blur. `focusWorld` = punkt ostrości (auto → bokeh na jupiterach). */
	updatePremiumBallFx(
		ballPos: THREE.Vector3,
		ballVel: THREE.Vector3,
		focusWorld: THREE.Vector3 = ballPos,
	): void {
		this.ballProjA.copy(focusWorld).project(this.threeJSCamera);
		this.premiumInput.focusUv.set(
			(this.ballProjA.x + 1) * 0.5,
			(this.ballProjA.y + 1) * 0.5,
		);

		/** Motion z OpticsRecipe (drive) — ball Fx tylko ustawia focus UV. */
		this.optics.fillPremiumFx(this.premiumInput, this.cameraForward);
		this.premiumInput.dofStrength = Math.max(
			this.premiumInput.dofStrength,
			this.pendingDofStrength,
		);
		void ballPos;
		void ballVel;
	}

	setGoalDofStrength(strength: number): void {
		this.pendingDofStrength = strength;
	}

	pulseCoolGrade(strength = 1): void {
		this.cinematicFx.pulseCool(strength);
	}

	pulseWarmGrade(strength = 1): void {
		this.cinematicFx.pulseWarm(strength);
	}

	pulseCinematicFx(strength = 1): void {
		this.cinematicPulse = Math.max(this.cinematicPulse, strength);
		this.lensArtifactPulse = Math.max(this.lensArtifactPulse, strength * 0.28);
	}

	/** Krótki burst rozjechania RGB — menu, gole, supersonic. */
	pulseChromaticAberration(strength = 1): void {
		this.cinematicFx.pulseChromatic(strength);
		this.lensArtifactPulse = Math.max(this.lensArtifactPulse, strength * 0.42);
	}

	/** Post-process lens flares (jupiter / corner spots) — mecz + menu. */
	setLensFlares(
		lights: import("./visual/shaders/lensFlarePost").LensFlareLight[],
		_intensity = 0.85,
	): void {
		this.optics.setLensFlareLights(lights);
		void _intensity;
	}

	/**
	 * Spektakl gola/demo — bloom + cinematic chroma (bez winiety).
	 */
	pulseSpectacle(strength = 1): void {
		const s = THREE.MathUtils.clamp(strength, 0, 1.4);
		this.optics.setSpectacle({ amount: s });
		this.premiumPost.pulseMatchChroma(0.75 + s * 0.55);
		this.cinematicFx.pulseChromatic(0.65 + s * 0.7);
		this.premiumPost.pulseSpectacle(s);
		this.lensArtifactPulse = Math.max(this.lensArtifactPulse, 0.32 + s * 0.42);
		window.setTimeout(() => {
			if (this.goalFovBoost <= 0.01) {
				this.optics.setSpectacle({ amount: 0 });
			}
		}, 1100);
	}

	applyGoalPresentation(bloom: number, fovBoost: number, shake: number): void {
		this.optics.setSpectacle({ amount: THREE.MathUtils.clamp(bloom, 0, 1.4) });
		/** Soft FOV punch — raw spectacle can peak high; keep readable chase. */
		this.goalFovBoost = THREE.MathUtils.clamp(fovBoost, 0, 8);
		this.lensArtifactPulse = Math.max(
			this.lensArtifactPulse,
			THREE.MathUtils.clamp(bloom * 0.7, 0, 1.1),
		);
		/** Envelope soft — nie odświeżaj full intensity co klatkę (trzęsienie przy golu). */
		if (shake > 0.01) {
			this.chaseState.shakeIntensity = Math.min(
				0.18,
				Math.max(this.chaseState.shakeIntensity * 0.9, shake * 0.32),
			);
		}
	}

	resetGoalPresentation(): void {
		this.optics.setSpectacle({ amount: 0 });
		this.goalFovBoost = 0;
		this.pendingDofStrength = 0;
		this.lensArtifactPulse = Math.min(this.lensArtifactPulse, 0.18);
	}

	setMenuBloomPresentation(active: boolean): void {
		this.menuPresentationActive = active;
		this.syncShowcaseShadowMaps(active, this.garagePresentationActive);
		this.applyMenuPresentationState(false);
		if (!active && !this.garagePresentationActive) {
			this.clearMenuShowcaseFx();
			/** Od razu wyrzuć kadr orbity z present — zanim async startMatch skończy. */
			this.clearPresentCanvas();
			this.enforceMatchPresentationStack();
		}
	}

	/** Wyczyść bufor 2D po przełączeniu menu↔garaż (Wayland trzyma „echo”). */
	resetShowcaseBlitSurface(): void {
		if (!this.isShowcasePresentation()) return;
		const w = this.presentCanvas.width;
		const h = this.presentCanvas.height;
		if (w > 0 && h > 0) {
			this.presentCtx.fillStyle = "#0b1424";
			this.presentCtx.fillRect(0, 0, w, h);
		}
		this.threeJSRenderer.resetState();
		this.threeJSRenderer.setRenderTarget(null);
	}

	setGaragePresentation(active: boolean): void {
		this.garagePresentationActive = active;
		this.syncShowcaseShadowMaps(this.menuPresentationActive, active);
		this.applyMenuPresentationState(this.menuPresentationActive);
	}

	private syncShowcasePresentation(): void {
		const showcase = this.isShowcasePresentation();
		const labelEl = this.labelRenderer.domElement;
		this.setShowcasePresentMode(showcase);
		if (showcase) {
			if (labelEl.parentElement) {
				labelEl.remove();
			}
			/**
			 * NIE zbijaj pixelRatio do 1 w menu.
			 * PR 1→device przy menu→mecz psuł EffectComposer (_pixelRatio stale)
			 * + bufor GL → YOU na środku (CSS2D), auto w orbicie (stary kadr).
			 */
			this.threeJSRenderer.shadowMap.enabled =
				this.menuPresentationActive && !this.garagePresentationActive;
			if (this.threeJSRenderer.shadowMap.enabled) {
				this.threeJSRenderer.shadowMap.needsUpdate = true;
			}
		} else {
			if (!labelEl.parentElement) {
				this.renderContainer.appendChild(labelEl);
			}
			labelEl.style.display = "";
			labelEl.style.visibility = "visible";
			this.threeJSRenderer.shadowMap.enabled = true;
		}
		/** Po zmianie trybu — zsynchronizuj composer PR + drawing buffer. */
		this.setSize(window.innerWidth, window.innerHeight);
	}

	private syncShowcaseShadowMaps(menuActive: boolean, garageActive: boolean): void {
		if (menuActive || garageActive) return;
		/** Wejście w mecz — reset throttle, pierwsza klatka z pełnym shadow pass. */
		this.matchShadowFrame = 0;
		this.threeJSRenderer.shadowMap.autoUpdate = false;
		this.threeJSRenderer.shadowMap.needsUpdate = true;
	}

	/**
	 * Stadionowe cienie: interval z OpticsRecipe.
	 */
	private tickMatchShadowMaps(): void {
		const sm = this.threeJSRenderer.shadowMap;
		if (!sm.enabled) return;
		const interval = this.optics.getShadowAutoUpdateEveryN();
		if (interval <= 1) {
			sm.autoUpdate = true;
			return;
		}
		sm.autoUpdate = false;
		this.matchShadowFrame += 1;
		sm.needsUpdate = this.matchShadowFrame % interval === 1;
	}

	/** Po zmianie modelu w menu/garażu — jednorazowa aktualizacja cieni. */
	refreshGarageShadowMaps(): void {
		if (
			!usesDirectRender(
				this.menuPresentationActive,
				this.garagePresentationActive,
			)
		) {
			return;
		}
		this.threeJSRenderer.shadowMap.needsUpdate = true;
	}

	private applyMenuPresentationState(skipComposerRebuild = false): void {
		this.syncShowcasePresentation();

		const inMenuUi = this.isShowcasePresentation();
		this.cinematicFx.setMenuPresentation(inMenuUi);
		if (inMenuUi) {
			this.cinematicFx.setSustainedGrades(0, 0);
		}

		if (skipComposerRebuild) {
			return;
		}

		if (this.garagePresentationActive) {
			this.optics.setMode("garage");
			this.postProcessor.setBloomEnabled(false);
			this.optics.apply(this.threeJSRenderer);
			this.premiumInput.dofStrength = showcaseDof();
			this.syncComposerRenderTarget();
			return;
		}
		if (this.menuPresentationActive) {
			this.optics.setMode("menu");
			this.postProcessor.setBloomEnabled(false);
			this.optics.apply(this.threeJSRenderer);
			this.syncComposerRenderTarget();
			return;
		}
		this.optics.setMode("match", resolveGraphicsSettings().quality);
		this.postProcessor.setBloomEnabled(false);
		this.optics.apply(this.threeJSRenderer);
		this.threeJSRenderer.toneMapping = THREE.NoToneMapping;
		this.syncComposerRenderTarget();
	}

	addCameraShake(intensity: number): void {
		this.chaseState.shakeIntensity = Math.min(
			0.22,
			Math.max(this.chaseState.shakeIntensity, intensity * 0.7),
		);
	}

	/**
	 * Ignajtowe trzęsienie ziemi — low-freq rumble + FOV/chroma/vignette.
	 * Nie mylić z ciągłym RL Camera Shake (pro: off).
	 */
	triggerIgniteQuake(kind: IgniteQuakeKind, intensity = 1): void {
		this.igniteQuake.trigger(kind, intensity);
	}

	/** Stadionowy rumble — wołaj po chase / snap / orbit (jedna klatka). */
	updateIgniteQuake(dt: number): void {
		this.tickIgniteQuake(dt);
	}

	/**
	 * RL Demo Transition — kamera leci z miejsca dema na spawn.
	 * durationSec ≈ Demo Transition Time (0 = snap).
	 */
	beginDemoRespawnCam(
		deathPos: THREE.Vector3,
		spawnPos: THREE.Vector3,
		durationSec = 0.55,
	): void {
		this.demoCamActive = true;
		this.demoCamT = 0;
		this.demoCamDuration = Math.max(0.01, durationSec);
		this.demoCamFrom.copy(deathPos).add(new THREE.Vector3(0, 4.2, 0));
		const toBallish = spawnPos.clone().add(new THREE.Vector3(0, 3.4, 0));
		/** Lekko za spawnem — widać pole przed respawnem. */
		const back = spawnPos.clone();
		back.z += spawnPos.z >= 0 ? 8 : -8;
		back.y += 5;
		this.demoCamTo.copy(back);
		this.demoCamLook.copy(toBallish);
	}

	endDemoRespawnCam(): void {
		this.demoCamActive = false;
		this.demoCamT = 0;
	}

	/**
	 * Soft handoff demo→chase: zostaw eye gdzie jest (bez teleportu),
	 * spring dogoni pose w kolejnych klatkach followPlayer.
	 */
	handoffDemoToChase(player: Player, ballPos: THREE.Vector3): void {
		this.endDemoRespawnCam();
		if (!player?.rapierRigidBody) return;
		const rot = player.rapierRigidBody.rotation();
		const carQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
		if (!this.chaseState.initialized) {
			this.resetChaseCamera(carQuat);
		}
		/** Soft handoff — nie snapuj Ball↔Free blend (pro transition ~1.3). */
		this.chaseState.shakeIntensity = 0;
		this.chaseState.shakeApplied.set(0, 0, 0);
		this.chaseState.posVelocity.set(0, 0, 0);
		this.chaseState.frameLookOffset.set(0, 0, 0);
		this.chaseState.framePan.set(0, 0, 0);
		this.chaseState.initialized = true;
		const look = new THREE.Vector3();
		this.threeJSCamera.getWorldDirection(look);
		const lookDist = Math.max(
			4,
			this.threeJSCamera.position.distanceTo(ballPos) * 0.55,
		);
		this.chaseState.smoothedLookAt
			.copy(this.threeJSCamera.position)
			.addScaledVector(look, lookDist);
		const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(carQuat).setY(0);
		if (fwd.lengthSq() > 1e-6) {
			this.chaseState.lastFlatForward.copy(fwd.normalize());
		}
	}

	isDemoRespawnCamActive(): boolean {
		return this.demoCamActive;
	}

	/** `true` gdy kamera demo przejęła kadr (nie wołaj chase). */
	updateDemoRespawnCam(dt: number): boolean {
		if (!this.demoCamActive) return false;
		this.demoCamT += dt;
		const u = Math.min(1, this.demoCamT / this.demoCamDuration);
		const ease = u * u * (3 - 2 * u);
		this.demoCamEye.lerpVectors(this.demoCamFrom, this.demoCamTo, ease);
		this.threeJSCamera.position.copy(this.demoCamEye);
		this.threeJSCamera.up.set(0, 1, 0);
		this.threeJSCamera.lookAt(this.demoCamLook);
		this.threeJSCamera.updateMatrixWorld(true);
		return true;
	}

	private tickIgniteQuake(dt: number): void {
		this.igniteQuake.beginFrame(this.threeJSCamera);
		const p = this.igniteQuake.update(dt);
		applyIgniteQuakeOverlay(p);
		this.quakeFovKick = THREE.MathUtils.damp(
			Math.max(this.quakeFovKick, p.fovKick),
			0,
			p.amount > 0.04 ? 2.2 : 12,
			dt,
		);
		if (p.amount < 0.01) return;
		this.igniteQuake.applyToCamera(this.threeJSCamera, p.offset);
		if (p.chromatic > 0.04) {
			this.pulseChromaticAberration(p.chromatic);
		}
		if (p.bloom > 0.08) {
			this.pulseCinematicFx(p.bloom * 0.55);
		}
	}

	toggleBallCam(): void {
		this.isBallCam = !this.isBallCam;
	}

	setBallCamEnabled(enabled: boolean): void {
		this.isBallCam = enabled;
		/**
		 * Nie snapuj blendT — tickBallCamBlendT + damp dają pro transition (~1.3).
		 * Stary bias ≥0.85/≤0.15 robił pop mid-toggle.
		 */
	}

	isBallCamEnabled(): boolean {
		return this.isBallCam;
	}

	/** Środkowy przycisk / R3 — widok do tyłu. */
	setLookBackHeld(held: boolean): void {
		this.lookBackWanted = held;
	}

	isLookBackHeld(): boolean {
		return this.lookBackWanted;
	}

	/** V / pad Select — cykl grywalnych rigów chase (nad Ball/Free). */
	cycleAltChaseRig(): ChaseRigId {
		this.altRigFromIndex = this.altRigIndex;
		this.altRigIndex = nextChaseRigIndex(this.altRigIndex);
		this.altRigToIndex = this.altRigIndex;
		this.altRigBlend = 0;
		this.chaseState.posVelocity.set(0, 0, 0);
		this.chaseState.frameLookOffset.set(0, 0, 0);
		this.chaseState.framePan.set(0, 0, 0);
		this.chaseState.ballOrbitReady = false;
		const preset = chaseRigByIndex(this.altRigIndex);
		this.altRigToastId = preset.id;
		this.altRigToastLeft = CHASE_RIG_TOAST_SEC;
		return preset.id;
	}

	getAltChaseRigId(): ChaseRigId {
		return chaseRigByIndex(this.altRigIndex).id;
	}

	/** HUD: krótki toast nazwy rigu po V. */
	getAltChaseRigToast(): { id: ChaseRigId; labelKey: ChaseRigLabelKey } | null {
		if (this.altRigToastLeft <= 0 || !this.altRigToastId) return null;
		const preset = CHASE_RIGS.find((r) => r.id === this.altRigToastId);
		if (!preset) return null;
		return { id: preset.id, labelKey: preset.labelKey };
	}

	private tickAltChaseRig(dt: number): ChaseRigParams {
		if (this.altRigToastLeft > 0) {
			this.altRigToastLeft = Math.max(0, this.altRigToastLeft - dt);
			if (this.altRigToastLeft <= 0) this.altRigToastId = null;
		}
		if (this.altRigBlend < 1) {
			this.altRigBlend = Math.min(
				1,
				this.altRigBlend + dt / CHASE_RIG_BLEND_SEC,
			);
		}
		const from = chaseRigByIndex(this.altRigFromIndex);
		const to = chaseRigByIndex(this.altRigToIndex);
		this.effectiveChaseRig = lerpChaseRigParams(
			from,
			to,
			chaseRigBlendAlpha(this.altRigBlend),
		);
		return this.effectiveChaseRig;
	}

	/** Tick blend/toast poza followPlayer (kickoff / free-cam). */
	updateAltChaseRig(dt: number): void {
		this.tickAltChaseRig(dt);
	}

	/** Odliczanie 5→1: 0=kickoff look, 1=mecz. */
	setCountdownCamBlend(blend: number): void {
		this.countdownCamBlend = THREE.MathUtils.clamp(blend, 0, 1);
	}

	focusCanvas(): void {
		this.threeJSRenderer.domElement.focus({ preventScroll: true });
	}

	/** Canvas do clipów / captury — zawsze present (mecz i menu blit’ują tu). */
	getCaptureCanvas(): HTMLCanvasElement {
		return this.presentCanvas;
	}

	getChaseOrbitForward(): THREE.Vector3 {
		return this.chaseState.lastFlatForward;
	}

	resetChaseCamera(carQuat: THREE.Quaternion): void {
		resetChaseCameraHeading(this.chaseState, carQuat);
	}

	/** Prematch show — zawieś GPU RT. */
	setRealtimeRtSuspended(v: boolean): void {
		this.rtDirector.setSuspended(v);
	}

	invalidateRealtimeRtScene(): void {
		this.rtDirector.invalidate();
	}

	/** Steam Deck / słabsze GPU — niższy DPR i bloom. */
	applyGraphicsSettings(settings: GraphicsSettings): void {
		this.rtDirector.syncEnabled();
		this.rtDirector.invalidate();
		this.threeJSRenderer.setPixelRatio(
			Math.min(window.devicePixelRatio, settings.pixelRatioCap),
		);
		this.baseBloomStrength = settings.bloomStrength;
		this.optics.setQuality(settings.quality);
		this.applyMenuPresentationState();
		this.postProcessor.setBloomEnabled(false);
		this.postProcessor.setAaQuality(settings.quality);
		this.premiumPost.setMultisampling(settings.quality);
		this.setSize(window.innerWidth, window.innerHeight);
	}

	/** @deprecated Użyj `applyGraphicsSettings(resolveGraphicsSettings())`. */
	applyDeckGraphicsProfile(): void {
		this.applyGraphicsSettings(resolveGraphicsSettings());
	}

	/**
	 * Po menu→mecz: wyczyść ghost orbity, wyrenderuj chase, pokaż source, tagi.
	 */
	resyncPresentAfterCameraSnap(scene: Scene): void {
		this.syncViewportIfNeeded();
		this.clearPresentCanvas();
		this.enforceMatchPresentationStack();
		this.threeJSRenderer.resetState();
		this.threeJSCamera.updateMatrixWorld(true);
		this.premiumPost.setScene(scene.threeJSScene, this.threeJSCamera);
		this.postProcessor.setScene(scene.threeJSScene, this.threeJSCamera);
		if (this.menuPresentationActive) {
			this.premiumPost.setMatchLook(false);
			this.premiumPost.render(0);
			this.blitShowcaseToPresentCanvas(this.threeJSRenderer.domElement);
		} else {
			this.premiumPost.setMatchLook(true);
			this.premiumPost.render(0);
			this.blitShowcaseToPresentCanvas(this.threeJSRenderer.domElement);
		}
		this.syncLabelLayerToCanvas();
		this.jumbotronRenderer.domElement.style.visibility =
			this.menuPresentationActive ? "hidden" : "visible";
		if (!this.menuPresentationActive) {
			this.jumbotronFrame += 1;
			/** Co 2. klatkę — CSS3D jumbotron = mikro-hitch na słabszych GPU. */
			if ((this.jumbotronFrame & 1) === 1) {
				this.jumbotronRenderer.render(scene.threeJSScene, this.threeJSCamera);
			}
		}
		this.labelRenderer.render(scene.threeJSScene, this.threeJSCamera);
		if (!this.isShowcasePresentation()) {
			this.setNameTagsArmed(true);
		}
	}

	/**
	 * Pose kickoff chase (eye + look) — bez mutacji kamery.
	 * Pre-match show lerpuje w to miejsce przed odliczaniem.
	 */
	computeKickoffCameraPose(
		player: Player,
	): { eye: THREE.Vector3; look: THREE.Vector3 } | null {
		if (!player?.rapierRigidBody) return null;
		const carPos = player.getPosition();
		if (
			!Number.isFinite(carPos.x) ||
			!Number.isFinite(carPos.y) ||
			!Number.isFinite(carPos.z)
		) {
			return null;
		}
		{
			const t = player.rapierRigidBody.translation();
			const q = player.rapierRigidBody.rotation();
			player.threeJSGroup.position.set(t.x, t.y, t.z);
			player.threeJSGroup.quaternion.set(q.x, q.y, q.z, q.w);
			player.threeJSGroup.updateMatrixWorld(true);
		}
		const visual = player.visualRoot;
		visual.updateMatrixWorld(true);
		const box = new THREE.Box3();
		computeCarNameTagAnchor(visual, box);
		const center = new THREE.Vector3();
		const size = new THREE.Vector3();
		if (box.isEmpty()) {
			center.copy(carPos);
			size.set(2.2, 1.1, 2.8);
		} else {
			box.getCenter(center);
			box.getSize(size);
		}
		const worldQuat = new THREE.Quaternion();
		visual.getWorldQuaternion(worldQuat);
		const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(worldQuat).setY(0);
		if (fwd.lengthSq() < 1e-6) {
			fwd.copy(this.chaseState.lastFlatForward).setY(0);
		}
		if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
		else fwd.normalize();

		const wide = THREE.MathUtils.clamp(
			(this.threeJSCamera.aspect - 1.75) / 0.9,
			0,
			1,
		);
		const dist = KICKOFF_CAM_DISTANCE - wide * 0.35;
		const height = Math.max(KICKOFF_CAM_HEIGHT, size.y * 0.42 + 0.95);
		const lookY = Math.max(0.2, size.y * 0.12 + KICKOFF_LOOK_Y);
		const lookAhead = KICKOFF_LOOK_AHEAD;
		return {
			eye: new THREE.Vector3(
				center.x - fwd.x * dist,
				center.y + height,
				center.z - fwd.z * dist,
			),
			look: new THREE.Vector3(
				center.x + fwd.x * lookAhead,
				center.y + lookY,
				center.z + fwd.z * lookAhead,
			),
		};
	}

	/** Natychmiastowy TPP za autem — kickoff / intro / reset po golu. */
	snapChaseCamera(
		player: Player,
		ballPos: THREE.Vector3,
		opts?: { kickoff?: boolean; matchBlend?: number },
	): void {
		if (!player?.rapierRigidBody) return;

		const carPos = player.getPosition();
		if (
			!Number.isFinite(carPos.x) ||
			!Number.isFinite(carPos.y) ||
			!Number.isFinite(carPos.z)
		) {
			return;
		}

		const rot = player.rapierRigidBody.rotation();
		const carQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
		const kickoff = opts?.kickoff === true;
		const matchBlend = opts?.matchBlend;
		/** Snap = twardy pose — bez pół-blendu z poprzedniego toggle. */
		this.ballCamBlendT = this.isBallCam ? 1 : 0;

		/**
		 * Kickoff: kadruj WIDOCZNY mesh (visualRoot), nie hitbox.
		 * Zero clampLookAtPitch / clampCameraInsideSoccar / framing loops —
		 * te trzy dawały YOU na trawie i auto w rogu na ultrawide.
		 */
		if (kickoff) {
			this.resetChaseCamera(carQuat);
			const pose = this.computeKickoffCameraPose(player);
			if (!pose) return;
			const visual = player.visualRoot;
			const worldQuat = new THREE.Quaternion();
			visual.getWorldQuaternion(worldQuat);
			const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(worldQuat).setY(0);
			if (fwd.lengthSq() < 1e-6) {
				fwd.copy(this.chaseState.lastFlatForward).setY(0);
			}
			if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
			else fwd.normalize();
			this.chaseState.lastFlatForward.copy(fwd);

			this.threeJSCamera.position.copy(pose.eye);
			const lookAt = pose.look;

			/** Nie zeruj shake — boom kickoffu żyje w finishKickoffCamJuice. */
			this.chaseState.shakeApplied.set(0, 0, 0);
			this.chaseState.initialized = true;
			this.chaseState.posVelocity.set(0, 0, 0);
			this.chaseState.frameLookOffset.set(0, 0, 0);
			this.chaseState.framePan.set(0, 0, 0);
			this.chaseState.smoothedLookAt.copy(lookAt);
			this.threeJSCamera.up.set(0, 1, 0);
			this.threeJSCamera.lookAt(lookAt);
			const kickoffHFov =
				(this.chaseState.currentHorizontalFov || this.baseHorizontalFov) +
				this.goalFovBoost;
			this.threeJSCamera.fov = horizontalFovToVertical(
				horizontalFovForAspect(kickoffHFov, this.threeJSCamera.aspect),
				this.threeJSCamera.aspect,
			);
			this.threeJSCamera.updateProjectionMatrix();
			this.threeJSCamera.updateMatrixWorld(true);
			finalizeSoccarCamera(this.threeJSCamera, carPos, this.chaseState);
			return;
		}

		if (!this.chaseState.initialized) {
			this.resetChaseCamera(carQuat);
		}
		const { targetPos, lookAt } =
			matchBlend != null
				? sampleCountdownChaseCameraTargets(
						carPos,
						this.chaseState.lastFlatForward,
						ballPos,
						this.isBallCam,
						matchBlend,
						this.threeJSCamera.aspect,
					)
				: sampleLiveMatchChaseCameraTargets(
						carPos,
						this.chaseState.lastFlatForward,
						ballPos,
						this.isBallCam,
					);

		this.chaseState.shakeIntensity = 0;
		this.chaseState.shakeApplied.set(0, 0, 0);
		this.chaseState.initialized = true;
		this.chaseState.posVelocity.set(0, 0, 0);
		this.chaseState.frameLookOffset.set(0, 0, 0);
		this.chaseState.framePan.set(0, 0, 0);
		this.chaseState.smoothedLookAt.copy(lookAt);
		this.threeJSCamera.position.copy(targetPos);
		this.threeJSCamera.up.set(0, 1, 0);
		this.threeJSCamera.lookAt(lookAt);

		this.threeJSCamera.updateMatrixWorld(true);
		this.threeJSCamera.updateProjectionMatrix();
		const ndc = carPos.clone().project(this.threeJSCamera);
		if (Math.abs(ndc.x) > 0.38 || ndc.y < -0.55 || ndc.y > 0.35) {
			this.threeJSCamera.position.y = Math.max(
				this.threeJSCamera.position.y,
				carPos.y + RL_CAMERA.height,
			);
			const fallbackLook = new THREE.Vector3(
				carPos.x,
				carPos.y + 0.9,
				carPos.z,
			);
			const toBall = new THREE.Vector3().subVectors(ballPos, carPos);
			toBall.y = 0;
			if (toBall.lengthSq() > 1e-4) {
				toBall.normalize();
				fallbackLook.addScaledVector(toBall, 3.0);
			}
			clampLookAtPitch(this.threeJSCamera.position, fallbackLook);
			this.chaseState.smoothedLookAt.copy(fallbackLook);
			this.threeJSCamera.lookAt(fallbackLook);
		}

		const verticalFov = horizontalFovToVertical(
			horizontalFovForAspect(
				this.baseHorizontalFov,
				this.threeJSCamera.aspect,
			),
			this.threeJSCamera.aspect,
		);
		if (Math.abs(this.threeJSCamera.fov - verticalFov) > 0.02) {
			this.threeJSCamera.fov = verticalFov;
			this.chaseState.currentHorizontalFov = this.baseHorizontalFov;
			this.threeJSCamera.updateProjectionMatrix();
		}

		finalizeSoccarCamera(this.threeJSCamera, carPos, this.chaseState);
		this.threeJSCamera.up.set(0, 1, 0);
		this.threeJSCamera.lookAt(this.chaseState.smoothedLookAt);
	}

	/**
	 * Po menu→mecz: jeśli kamera nadal w orbicie (y≈11, r≈38, look środek),
	 * zmuś kickoff snap. Inaczej countdown pokazuje auto w rogu.
	 */
	killMenuOrbitIfPresent(player: Player, ballPos: THREE.Vector3): void {
		if (!player?.rapierRigidBody) return;
		const carPos = player.getPosition();
		if (!Number.isFinite(carPos.x)) return;
		const cam = this.threeJSCamera;
		const dist = cam.position.distanceTo(carPos);
		const high = cam.position.y > carPos.y + 5.5;
		const far = dist > 14;
		cam.updateMatrixWorld(true);
		const ndc = carPos.clone().project(cam);
		const off =
			Number.isFinite(ndc.x) &&
			(Math.abs(ndc.x) > 0.22 || ndc.y < -0.7 || ndc.y > 0.35);
		if (!(high || far || off)) return;
		/** Tylko visualRoot snap — bez reaxis/hitbox look (to cofało kadr). */
		this.snapChaseCamera(player, ballPos, { kickoff: true, matchBlend: 0 });
	}

	/** Kamera za autem (quaternion) — lookAt na środek auta / piłkę z bezpiecznikiem NDC. */
	followPlayer(
		player: Player,
		dt: number,
		boosting = false,
		ballPos: THREE.Vector3,
		goalOrbitFocus: THREE.Vector3 | null = null,
		ballVel: THREE.Vector3 | null = null,
	) {
		if (this.goalOrbitActive && goalOrbitFocus) {
			this.followGoalOrbit(
				goalOrbitFocus,
				ballVel ?? this._goalOrbitVel.set(0, 0, 0),
				dt,
			);
			return;
		}
		if (!player?.rapierRigidBody) return;

		// Po menu / orbitach — zawsze światowy up (inaczej „z góry” / przechylenie).
		this.threeJSCamera.up.set(0, 1, 0);

		const carPos = player.getPosition();
		if (
			!Number.isFinite(carPos.x) ||
			!Number.isFinite(carPos.y) ||
			!Number.isFinite(carPos.z)
		) {
			return;
		}

		/**
		 * Awaryjny snap: poza menu kamera bywa zostawiona w orbicie (~30 m).
		 * Chase smoothDamp tego nie dogania w rozsądnym czasie.
		 * (Bez snap przy małym distXZ — to szarpało kickoff i dawało „lufę w trawę”.)
		 */
		const distSq = this.threeJSCamera.position.distanceToSquared(carPos);
		const distXZ = Math.hypot(
			this.threeJSCamera.position.x - carPos.x,
			this.threeJSCamera.position.z - carPos.z,
		);
		const heightAbove = this.threeJSCamera.position.y - carPos.y;
		if (distSq > 18 * 18 || (heightAbove > 10 && distXZ < 4)) {
			this.snapChaseCamera(
				player,
				ballPos,
				this.countdownCamBlend < 0.99
					? {
							kickoff: true,
							matchBlend: this.countdownCamBlend,
						}
					: undefined,
			);
			return;
		}

		const velocity = player.getVelocity();
		const speed = velocity.length();
		const speedXZ = Math.hypot(velocity.x, velocity.z);
		const wheelsGrounded = player.getWheelsGroundedCount();
		/** Nie ufaj samemu isOnGround — ray hit po skoku miga. */
		const onGround = !player.isAirborneForCamera();
		const rot = player.rapierRigidBody.rotation();
		const carQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);

		this.ballCamBlendT = tickBallCamBlendT(
			this.ballCamBlendT,
			this.isBallCam,
			dt,
		);
		this.lookBackBlendT = THREE.MathUtils.damp(
			this.lookBackBlendT,
			this.lookBackWanted ? 1 : 0,
			32,
			dt,
		);
		updateChaseCamera(
			this.threeJSCamera,
			carPos,
			carQuat,
			ballPos,
			this.isBallCam,
			dt,
			boosting,
			speed,
			this.chaseState,
			this.baseHorizontalFov,
			speedXZ,
			wheelsGrounded,
			this.goalFovBoost + this.quakeFovKick,
			player.isFlipping(),
			velocity,
			this.countdownCamBlend,
			onGround,
			this.effectiveChaseRig,
			this.ballCamBlendT,
			player.isOnWallOrRamp(),
			this.lookBackBlendT,
		);
		/** finalizeSoccarCamera jest już na końcu updateChaseCamera — nie dubluj. */

		/**
		 * Live: tylko ekstremalny rescue (auto poza kadrem).
		 * Podczas dodge / air — NIE: sideflip wychodzi z NDC → snap = zmiana rzutu.
		 */
		const flipOrAir =
			player.isFlipping() || player.isAirborneForCamera();
		if (this.countdownCamBlend >= 0.99 && !flipOrAir) {
			this.frameRescueCooldown = Math.max(0, this.frameRescueCooldown - dt);
			this.threeJSCamera.updateMatrixWorld(true);
			const ndc = carPos.clone().project(this.threeJSCamera);
			const absX = Math.abs(ndc.x);
			const lost =
				Number.isFinite(ndc.x) &&
				(absX > 0.94 ||
					ndc.y < -0.98 ||
					ndc.y > 0.98 ||
					ndc.z < -0.35 ||
					ndc.z > 1.12);
			if (lost && this.frameRescueCooldown <= 0) {
				this.frameRescueCooldown = 0.85;
				this.snapChaseCamera(player, ballPos);
			}
		}
	}

	private readonly _replayCamPos = new THREE.Vector3();
	private readonly _replayLook = new THREE.Vector3();
	private readonly _replayVelN = new THREE.Vector3(0, 0, 1);
	private readonly _replayChasePos = new THREE.Vector3();
	private readonly _replayChaseLook = new THREE.Vector3();
	private readonly _replayOrbitPos = new THREE.Vector3();
	private readonly _replayOrbitLook = new THREE.Vector3();
	private readonly _replayLastVelN = new THREE.Vector3(0, 0, 1);
	private replayOrbitAngle = 0;
	private replayGoalCrossNorm = 0.72;
	private replayCamBlend = 1;
	private replayGoalCrossPulsed = false;
	private replayCamBootstrapped = false;
	private goalOrbitAngle = 0;
	private readonly _goalOrbitVel = new THREE.Vector3();
	private goalOrbitActive = false;
	private readonly _goalOrbitFocus = new THREE.Vector3();

	/** Kinetyczna orbita po golu (przed replay). */
	beginGoalOrbit(focus: THREE.Vector3): void {
		this.goalOrbitActive = true;
		this.goalOrbitAngle = 0;
		this._goalOrbitFocus.copy(focus);
		/** Soft FOV punch — pro shake/FOV off; celebration nie wybucha FOV. */
		this.goalFovBoost = Math.max(this.goalFovBoost, 6);
	}

	endGoalOrbit(): void {
		this.goalOrbitActive = false;
		this.goalFovBoost = Math.min(this.goalFovBoost, 2);
	}

	/**
	 * Blend chase → cinematic pose (Match Director / Goal Spectacle).
	 * blend 0 = leave camera alone (caller already ran chase), 1 = full override.
	 */
	blendCameraTo(
		eye: THREE.Vector3,
		lookAt: THREE.Vector3,
		blend: number,
		dt: number,
	): void {
		const b = THREE.MathUtils.clamp(blend, 0, 1);
		if (b < 0.01) return;
		const lerp = Math.min(1, (1 - Math.exp(-14 * dt)) * Math.max(b, 0.35));
		this.threeJSCamera.position.lerp(eye, lerp);
		this.threeJSCamera.up.set(0, 1, 0);
		this.threeJSCamera.lookAt(lookAt);
	}

	/** Reset kamery powtórki — chase przed bramką, orbita po golu. */
	beginReplayCamera(goalCrossTime: number, clipDuration: number): void {
		this.replayOrbitAngle = 0;
		this.replayCamBlend = 1;
		this.replayGoalCrossPulsed = false;
		this.replayCamBootstrapped = false;
		this._replayLastVelN.set(0, 0, 1);
		this.replayGoalCrossNorm =
			clipDuration > 0.01
				? THREE.MathUtils.clamp(goalCrossTime / clipDuration, 0.12, 0.88)
				: 0.72;
		this.goalFovBoost = 4;
		this.chaseState.shakeIntensity = 0.12;
	}

	getReplayGoalCrossNorm(): number {
		return this.replayGoalCrossNorm;
	}

	followGoalOrbit(
		focus: THREE.Vector3,
		ballVel: THREE.Vector3,
		dt: number,
	): void {
		this._goalOrbitFocus.copy(focus);
		this.goalOrbitAngle += dt * 1.15;
		const orbitR = 11 + Math.sin(this.goalOrbitAngle * 0.5) * 2;
		const orbitY = 5.5 + Math.sin(this.goalOrbitAngle * 0.85) * 1.4;
		this._replayCamPos.set(
			focus.x + Math.sin(this.goalOrbitAngle) * orbitR,
			focus.y + orbitY,
			focus.z + Math.cos(this.goalOrbitAngle) * orbitR,
		);
		this._replayLook.copy(focus);
		if (ballVel.lengthSq() > 0.25) {
			this._replayLook.addScaledVector(ballVel.clone().normalize(), 3);
		}
		const lerp = 1 - Math.exp(-14 * dt);
		this.threeJSCamera.position.lerp(this._replayCamPos, lerp);
		this.threeJSCamera.up.set(0, 1, 0);
		this.threeJSCamera.lookAt(this._replayLook);
		const boosted = horizontalFovToVertical(
			this.baseHorizontalFov + this.goalFovBoost,
			this.threeJSCamera.aspect,
		);
		this.threeJSCamera.fov = boosted;
		this.threeJSCamera.updateProjectionMatrix();
	}

	/**
	 * Boom shake + FOV po kickoff snap (countdown nie woła updateChaseCamera,
	 * więc zwykły shake ginął w snapChaseCamera).
	 */
	finishKickoffCamJuice(dt: number): void {
		const hFov =
			(this.chaseState.currentHorizontalFov || this.baseHorizontalFov) +
			this.goalFovBoost;
		this.threeJSCamera.fov = horizontalFovToVertical(
			horizontalFovForAspect(hFov, this.threeJSCamera.aspect),
			this.threeJSCamera.aspect,
		);
		this.threeJSCamera.updateProjectionMatrix();
		this.goalFovBoost *= Math.exp(-6.5 * dt);

		/** RL pro: camera shake off — kickoff/countdown bez wstrząsu. */
		this.chaseState.shakeIntensity = 0;
		this.chaseState.shakeApplied.set(0, 0, 0);
	}

	/** GO — FOV punch + ignajtowe trzęsienie stadionu. */
	pulseKickoffIgnite(): void {
		this.goalFovBoost = Math.max(this.goalFovBoost, 4.6);
		this.pulseCinematicFx(0.28);
		this.triggerIgniteQuake("kickoff", 0.92);
	}

	/** Cyfra 5…1 — mocniejszy tick, kamera nadal bez shake. */
	pulseKickoffCountdownTick(step: number): void {
		const s = THREE.MathUtils.clamp(step, 1, 5);
		const tension = (6 - s) / 5;
		this.goalFovBoost = Math.max(this.goalFovBoost, 1.0 + tension * 1.35);
		this.pulseCinematicFx(0.06 + tension * 0.08);
	}

	/** Kamera cinematic podczas powtórki — chase za piłką przed golem, spokojna orbita po. */
	followReplayBall(
		ballPos: THREE.Vector3,
		ballVel: THREE.Vector3,
		dt: number,
		progress = 0,
	): void {
		const speed = ballVel.length();
		const cross = this.replayGoalCrossNorm;
		const crossWindow = THREE.MathUtils.smoothstep(
			cross - 0.1,
			cross + 0.05,
			progress,
		);
		const pastGoal = progress > cross + 0.02;
		const orbitWindow =
			pastGoal && speed > 1.5
				? THREE.MathUtils.smoothstep(cross, cross + 0.35, progress)
				: pastGoal
					? THREE.MathUtils.smoothstep(cross + 0.08, cross + 0.45, progress) * 0.45
					: 0;

		if (speed > 0.8) {
			this._replayVelN.copy(ballVel).multiplyScalar(1 / speed);
			this._replayLastVelN.copy(this._replayVelN);
		} else {
			this._replayVelN.copy(this._replayLastVelN);
		}

		const fastChase = speed > 2.5 && progress < cross + 0.12;
		const chaseWeight = fastChase
			? 1
			: THREE.MathUtils.clamp(1 - orbitWindow * 0.85, 0.18, 1);
		this.replayCamBlend = THREE.MathUtils.lerp(
			this.replayCamBlend,
			chaseWeight,
			1 - Math.exp(-6 * dt),
		);

		const dist = THREE.MathUtils.lerp(
			9.2,
			6.2,
			THREE.MathUtils.smoothstep(4, 28, speed),
		);
		const lift = THREE.MathUtils.lerp(
			3.2,
			5.4,
			THREE.MathUtils.smoothstep(4, 28, speed),
		);
		const lead = THREE.MathUtils.lerp(
			2.8,
			6.5,
			THREE.MathUtils.smoothstep(4, 24, speed),
		);
		this._replayChasePos
			.copy(ballPos)
			.addScaledVector(this._replayVelN, -dist)
			.add(new THREE.Vector3(0, lift, 0));
		this._replayChaseLook
			.copy(ballPos)
			.addScaledVector(this._replayVelN, lead);

		/** Wolniejsza, ciaśniejsza orbita — bez szaleństwa wokół stojącej piłki. */
		const orbitSpeed = speed > 2 ? 0.95 : 0.35;
		this.replayOrbitAngle += dt * orbitSpeed * Math.max(orbitWindow, 0.15);
		const orbitR = 9.5 + Math.sin(this.replayOrbitAngle * 0.35) * 1.6;
		const orbitY = 4.4 + Math.sin(this.replayOrbitAngle * 0.55) * 1.1;
		this._replayOrbitPos.set(
			ballPos.x + Math.sin(this.replayOrbitAngle) * orbitR,
			ballPos.y + orbitY,
			ballPos.z + Math.cos(this.replayOrbitAngle) * orbitR,
		);
		this._replayOrbitLook.copy(ballPos);
		if (speed > 1.2) {
			this._replayOrbitLook.addScaledVector(this._replayVelN, 2.5);
		}

		const blend = THREE.MathUtils.clamp(this.replayCamBlend, 0, 1);
		this._replayCamPos.lerpVectors(
			this._replayOrbitPos,
			this._replayChasePos,
			blend,
		);
		this._replayLook.lerpVectors(
			this._replayOrbitLook,
			this._replayChaseLook,
			blend,
		);

		if (!this.replayCamBootstrapped) {
			this.threeJSCamera.position.copy(this._replayChasePos);
			this.threeJSCamera.up.set(0, 1, 0);
			this.threeJSCamera.lookAt(this._replayChaseLook);
			this.replayCamBootstrapped = true;
		} else {
			const followSharp = THREE.MathUtils.lerp(
				8,
				18,
				THREE.MathUtils.smoothstep(2, 28, speed),
			);
			const lerp = 1 - Math.exp(-followSharp * dt);
			this.threeJSCamera.position.lerp(this._replayCamPos, lerp);
			this.threeJSCamera.up.set(0, 1, 0);
			this.threeJSCamera.lookAt(this._replayLook);
		}

		const goalFovPulse = (1 - crossWindow) * 4 + crossWindow * 9;
		const orbitFov = orbitWindow * 4;
		const targetFovBoost = Math.max(
			this.goalFovBoost * 0.35,
			goalFovPulse + orbitFov,
		);
		this.goalFovBoost = THREE.MathUtils.lerp(
			this.goalFovBoost,
			targetFovBoost,
			0.12,
		);
		const boosted = horizontalFovToVertical(
			this.baseHorizontalFov + this.goalFovBoost,
			this.threeJSCamera.aspect,
		);
		this.threeJSCamera.fov = boosted;
		this.threeJSCamera.updateProjectionMatrix();

		if (crossWindow > 0.55 && !this.replayGoalCrossPulsed && speed > 2) {
			this.replayGoalCrossPulsed = true;
			this.chaseState.shakeIntensity = Math.max(
				this.chaseState.shakeIntensity,
				0.14,
			);
			this.goalFovBoost = Math.max(this.goalFovBoost, 6);
			this.pulseCinematicFx(0.58);
		}

		this.chaseState.shakeIntensity = THREE.MathUtils.lerp(
			this.chaseState.shakeIntensity,
			crossWindow > 0.4 && speed > 2 ? 0.08 : 0,
			0.12,
		);
	}
}

export default Renderer;
