import * as THREE from "three";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

import { usesDirectRender } from "./visual/garagePresentationPolicy";
import type Scene from "./Scene";
import type { GraphicsSettings } from "./util/graphicsProfile";
import { resolveGraphicsSettings } from "./util/graphicsProfile";
import type Player from "./util/Player";
import {
	BASE_FOV,
	type ChaseCameraState,
	createChaseCameraState,
	horizontalFovToVertical,
	resetChaseCameraHeading,
	sampleChaseCameraTargets,
	updateChaseCamera,
} from "./visual/cameraFollow";
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

const CLEAR_COLOR = 0x0b1424;

class Renderer {
	threeJSRenderer: THREE.WebGLRenderer;
	threeJSCamera: THREE.PerspectiveCamera;
	cameraForward: THREE.Vector3;
	private readonly cinematicFx: CinematicPostFx;
	/** pmndrs/postprocessing — cinematic look + lens flare (menu/legacy hooks). */
	private readonly premiumPost: PremiumPostStack;
	/** UnrealBloom — Visual Valhalla neon glow w meczu. */
	private readonly postProcessor: PostProcessor;
	private readonly labelRenderer: CSS2DRenderer;
	private readonly renderContainer: HTMLElement;
	private readonly presentCanvas: HTMLCanvasElement;
	private readonly presentCtx: CanvasRenderingContext2D;

	private readonly baseHorizontalFov = BASE_FOV;
	private readonly chaseState: ChaseCameraState;
	/** Kamera startuje w Ball Cam; Spacja przełącza Car Cam. */
	private isBallCam = true;

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
			// drawImage z ukrytego WebGL → widoczny canvas 2D (Wayland bez ghostingu).
			preserveDrawingBuffer: true,
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
		const ctx = this.presentCanvas.getContext("2d", { alpha: false });
		if (!ctx) {
			throw new Error("FlyBall: brak kontekstu 2D dla prezentacji showcase");
		}
		this.presentCtx = ctx;

		this.labelRenderer = new CSS2DRenderer();
		this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
		this.labelRenderer.domElement.className = "car-name-tag-layer";
		container.appendChild(this.labelRenderer.domElement);

		const aspect = window.innerWidth / window.innerHeight;
		this.threeJSCamera = new THREE.PerspectiveCamera(
			horizontalFovToVertical(this.baseHorizontalFov, aspect),
			aspect,
			0.1,
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
		this.premiumPost.setBloomStrength(this.bloomStrengthForPass());
		this.postProcessor = new PostProcessor(
			this.threeJSRenderer,
			new THREE.Scene(),
			this.threeJSCamera,
		);
		this.postProcessor.setBloomStrength(this.unrealBloomStrength());

		window.addEventListener("resize", () =>
			this.setSize(window.innerWidth, window.innerHeight),
		);
		this.setSize(window.innerWidth, window.innerHeight);
	}

	private isShowcasePresentation(): boolean {
		return this.menuPresentationActive || this.garagePresentationActive;
	}

	render(scene: Scene) {
		this.threeJSRenderer.setClearColor(CLEAR_COLOR, 1);
		this.premiumPost.setScene(scene.threeJSScene, this.threeJSCamera);
		this.postProcessor.setScene(scene.threeJSScene, this.threeJSCamera);

		if (usesDirectRender(this.menuPresentationActive, this.garagePresentationActive)) {
			this.renderShowcase(scene);
			return;
		}

		this.threeJSRenderer.toneMapping = THREE.NoToneMapping;
		this.threeJSRenderer.toneMappingExposure = this.menuPresentationActive
			? this.baseExposure * 1.12
			: this.baseExposure;
		this.threeJSCamera.updateMatrixWorld(true);
		this.threeJSRenderer.resetState();
		this.postProcessor.render();
		/**
		 * Mecz też przez canvas 2D (blit) — na Electron/Wayland surowy WebGL
		 * potrafi pokazać stary kadr (orbita menu), podczas gdy threeJSCamera
		 * już jest w chase. Wygląd ten sam, jedna ścieżka prezentacji.
		 */
		this.blitShowcaseToPresentCanvas(this.threeJSRenderer.domElement);
		this.labelRenderer.render(scene.threeJSScene, this.threeJSCamera);
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

	/** Compositor Wayland widzi tylko canvas 2D — bez „rozdwojenia” WebGL+HTML. */
	private blitShowcaseToPresentCanvas(source: HTMLCanvasElement): void {
		const w = source.width;
		const h = source.height;
		if (w < 1 || h < 1) return;
		if (this.presentCanvas.width !== w || this.presentCanvas.height !== h) {
			this.presentCanvas.width = w;
			this.presentCanvas.height = h;
		}
		this.presentCtx.globalCompositeOperation = "copy";
		this.presentCtx.drawImage(source, 0, 0, w, h);
		this.presentCtx.globalCompositeOperation = "source-over";
	}

	private setShowcasePresentMode(active: boolean): void {
		const glCanvas = this.threeJSRenderer.domElement;
		/**
		 * NIGDY `display:none` na WebGL — Electron/Chromium czyści / zamraża
		 * drawing buffer → blit pokazuje stary kadr (orbita menu) mimo chase.
		 * Canvas zostaje w layoutcie, tylko niewidoczny pod present 2D.
		 */
		glCanvas.style.display = "block";
		glCanvas.style.position = "absolute";
		glCanvas.style.inset = "0";
		glCanvas.style.width = "100%";
		glCanvas.style.height = "100%";
		glCanvas.style.opacity = "0";
		glCanvas.style.pointerEvents = "none";
		glCanvas.style.zIndex = "0";
		this.presentCanvas.style.display = "block";
		this.presentCanvas.style.position = "relative";
		this.presentCanvas.style.zIndex = "1";
		this.presentCanvas.style.pointerEvents = active ? "auto" : "auto";
		void active;
	}

	setSize(width: number, height: number) {
		const w = Math.max(1, Math.floor(width));
		const h = Math.max(1, Math.floor(height));
		/** Najpierw DPR → drawing buffer, potem composer bierze getDrawingBufferSize. */
		this.threeJSRenderer.setSize(w, h, false);
		this.premiumPost.setSize(w, h);
		this.postProcessor.resize(w, h);
		this.presentCanvas.width = this.threeJSRenderer.domElement.width;
		this.presentCanvas.height = this.threeJSRenderer.domElement.height;
		this.presentCanvas.style.width = `${w}px`;
		this.presentCanvas.style.height = `${h}px`;
		this.labelRenderer.setSize(w, h);
		this.threeJSCamera.aspect = w / h;
		this.threeJSCamera.fov = horizontalFovToVertical(
			this.chaseState.currentHorizontalFov,
			this.threeJSCamera.aspect,
		);
		this.threeJSCamera.updateProjectionMatrix();
	}

	/** Odśwież rozmiar composera po przełączeniu menu ↔ mecz / zmianie DPR. */
	private syncComposerRenderTarget(): void {
		this.setSize(window.innerWidth, window.innerHeight);
	}

	private bloomStrengthForPass(): number {
		// UnrealBloom ~0.12–0.2 → pmndrs Bloom intensity ~0.35–0.65
		return this.baseBloomStrength * 3.2;
	}

	/** Bazowa intensywność UnrealBloom — wieczór, neon bez white-out. */
	private unrealBloomStrength(): number {
		return THREE.MathUtils.clamp(this.baseBloomStrength * 4.2, 0.32, 0.72);
	}

	private baseExposure = 0.74;
	private baseBloomStrength = 0.12;
	private menuPresentationActive = false;
	private garagePresentationActive = false;
	private showcaseSavedPixelRatio: number | null = null;
	private goalFovBoost = 0;
	private cinematicPulse = 0;
	private readonly premiumInput: PremiumFxInput = {
		focusUv: new THREE.Vector2(0.5, 0.5),
		dofStrength: 0,
		motionBlurDir: new THREE.Vector2(0, 0),
		motionBlurStrength: 0,
	};
	private readonly ballProjA = new THREE.Vector3();
	private readonly ballProjB = new THREE.Vector3();
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
		this.threeJSRenderer.toneMappingExposure =
			this.baseExposure + exposureOffset;
		this.cinematicFx.setSustainedGrades(coolGrade, warmGrade);
		if (this.goalFovBoost <= 0.01) {
			this.premiumPost.setBloomStrength(
				this.bloomStrengthForPass() + bloomBias * 0.35,
			);
			this.postProcessor.setBloomStrength(
				this.unrealBloomStrength() + bloomBias * 0.9,
			);
		}
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

		const speed = ballVel.length();
		this.ballProjB.copy(ballPos).addScaledVector(ballVel, 1 / 60);
		this.ballProjB.project(this.threeJSCamera);
		this.ballProjA.copy(ballPos).project(this.threeJSCamera);
		const dx = this.ballProjB.x - this.ballProjA.x;
		const dy = this.ballProjB.y - this.ballProjA.y;
		const len = Math.hypot(dx, dy);
		if (len > 1e-5) {
			this.premiumInput.motionBlurDir.set(dx / len, dy / len);
		}

		this.premiumInput.motionBlurStrength = THREE.MathUtils.clamp(
			(speed - 22) / 38,
			0,
			0.55,
		);
		this.premiumInput.dofStrength = this.pendingDofStrength;
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
	}

	/** Krótki burst rozjechania RGB — menu, gole, supersonic. */
	pulseChromaticAberration(strength = 1): void {
		this.cinematicFx.pulseChromatic(strength);
	}

	/** Post-process lens flares (jupiter / corner spots). */
	setLensFlares(
		lights: import("./visual/shaders/lensFlarePost").LensFlareLight[],
		intensity = 0.85,
	): void {
		this.premiumPost.setLensFlares(lights, intensity);
	}

	/**
	 * Spektakl gola/demo — bloom + cinematic chroma (bez winiety).
	 */
	pulseSpectacle(strength = 1): void {
		const s = THREE.MathUtils.clamp(strength, 0, 1.4);
		this.premiumPost.setBloomStrength(this.bloomStrengthForPass() + s * 0.85);
		this.postProcessor.setBloomStrength(
			Math.min(0.95, this.unrealBloomStrength() + s * 0.45),
		);
		this.cinematicFx.pulseChromatic(0.65 + s * 0.7);
		this.premiumPost.pulseSpectacle(s);
		window.setTimeout(() => {
			if (this.goalFovBoost <= 0.01) {
				this.premiumPost.setBloomStrength(this.bloomStrengthForPass());
				this.postProcessor.setBloomStrength(this.unrealBloomStrength());
			}
		}, 1100);
	}

	applyGoalPresentation(bloom: number, fovBoost: number, shake: number): void {
		this.premiumPost.setBloomStrength(
			this.bloomStrengthForPass() + bloom * 0.55,
		);
		/** UnrealBloom — miękki bump (wcześniej +0.85 → washout ~1.3). */
		this.postProcessor.setBloomStrength(
			Math.min(0.95, this.unrealBloomStrength() + bloom * 0.35),
		);
		this.goalFovBoost = fovBoost;
		if (shake > 0.01) {
			this.addCameraShake(shake);
		}
	}

	resetGoalPresentation(): void {
		this.premiumPost.setBloomStrength(this.bloomStrengthForPass());
		this.postProcessor.setBloomStrength(this.unrealBloomStrength());
		this.goalFovBoost = 0;
		this.pendingDofStrength = 0;
	}

	setMenuBloomPresentation(active: boolean): void {
		this.menuPresentationActive = active;
		this.syncShowcaseShadowMaps(active, this.garagePresentationActive);
		this.applyMenuPresentationState(false);
		if (!active && !this.garagePresentationActive) {
			this.clearMenuShowcaseFx();
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
		/**
		 * Zawsze present-canvas na wierzchu (menu i mecz).
		 * Source WebGL zostaje ukryty — Wayland/Electron inaczej trzyma ghost kadru.
		 */
		this.setShowcasePresentMode(true);
		if (showcase) {
			if (labelEl.parentElement) {
				labelEl.remove();
			}
			if (this.showcaseSavedPixelRatio === null) {
				this.showcaseSavedPixelRatio = this.threeJSRenderer.getPixelRatio();
			}
			this.threeJSRenderer.setPixelRatio(1);
			/** Menu orbit: cienie jak w meczu. Garaż: off (ghost przy obrocie). */
			const menuOrbit =
				this.menuPresentationActive && !this.garagePresentationActive;
			this.threeJSRenderer.shadowMap.enabled = menuOrbit;
			if (menuOrbit) {
				this.threeJSRenderer.shadowMap.needsUpdate = true;
			}
		} else {
			if (!labelEl.parentElement) {
				this.renderContainer.appendChild(labelEl);
			}
			labelEl.style.display = "";
			labelEl.style.visibility = "visible";
			if (this.showcaseSavedPixelRatio !== null) {
				this.threeJSRenderer.setPixelRatio(this.showcaseSavedPixelRatio);
				this.showcaseSavedPixelRatio = null;
				this.threeJSRenderer.shadowMap.enabled = true;
			}
		}
	}

	private syncShowcaseShadowMaps(menuActive: boolean, garageActive: boolean): void {
		if (menuActive || garageActive) return;
		this.threeJSRenderer.shadowMap.autoUpdate = true;
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
			this.premiumPost.setBloomEnabled(false);
			this.postProcessor.setBloomEnabled(false);
			this.threeJSRenderer.toneMapping = THREE.ACESFilmicToneMapping;
			this.threeJSRenderer.toneMappingExposure = this.baseExposure;
			this.syncComposerRenderTarget();
			return;
		}
		if (this.menuPresentationActive) {
			/** Menu: UnrealBloom + lekko wyższa ekspozycja (orbita z góry przygasza kadr). */
			this.premiumPost.setBloomEnabled(false);
			this.postProcessor.setBloomEnabled(true);
			this.postProcessor.setBloomStrength(this.unrealBloomStrength() * 1.05);
			this.postProcessor.setBloomThreshold(0.82);
			this.threeJSRenderer.toneMapping = THREE.ACESFilmicToneMapping;
			this.threeJSRenderer.toneMappingExposure = this.baseExposure * 1.12;
			this.syncComposerRenderTarget();
			return;
		}
		this.premiumPost.setBloomEnabled(true);
		this.postProcessor.setBloomEnabled(true);
		this.premiumPost.setBloomStrength(this.bloomStrengthForPass());
		this.postProcessor.setBloomStrength(this.unrealBloomStrength());
		this.postProcessor.setBloomThreshold(0.97);
		this.threeJSRenderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.threeJSRenderer.toneMappingExposure = this.baseExposure;
		this.syncComposerRenderTarget();
	}

	addCameraShake(intensity: number): void {
		this.chaseState.shakeIntensity = Math.min(
			0.72,
			Math.max(this.chaseState.shakeIntensity, intensity),
		);
	}

	toggleBallCam(): void {
		this.isBallCam = !this.isBallCam;
	}

	setBallCamEnabled(enabled: boolean): void {
		this.isBallCam = enabled;
	}

	isBallCamEnabled(): boolean {
		return this.isBallCam;
	}

	focusCanvas(): void {
		this.threeJSRenderer.domElement.focus({ preventScroll: true });
	}

	getChaseOrbitForward(): THREE.Vector3 {
		return this.chaseState.lastFlatForward;
	}

	resetChaseCamera(carQuat: THREE.Quaternion): void {
		resetChaseCameraHeading(this.chaseState, carQuat);
	}

	/** Steam Deck / słabsze GPU — niższy DPR i bloom. */
	applyGraphicsSettings(settings: GraphicsSettings): void {
		this.threeJSRenderer.setPixelRatio(
			Math.min(window.devicePixelRatio, settings.pixelRatioCap),
		);
		this.baseBloomStrength = settings.bloomStrength;
		this.applyMenuPresentationState();
		this.cinematicFx.setPremiumScale(settings.quality);
		this.premiumPost.setBloomStrength(this.bloomStrengthForPass());
		this.postProcessor.setBloomStrength(this.unrealBloomStrength());
		this.setSize(window.innerWidth, window.innerHeight);
	}

	/** @deprecated Użyj `applyGraphicsSettings(resolveGraphicsSettings())`. */
	applyDeckGraphicsProfile(): void {
		this.applyGraphicsSettings(resolveGraphicsSettings());
	}

	/** Natychmiastowy TPP za autem (linia piłka→auto) — kickoff / intro / reset po golu. */
	snapChaseCamera(player: Player, ballPos: THREE.Vector3): void {
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
		this.resetChaseCamera(carQuat);

		const { targetPos, lookAt } = sampleChaseCameraTargets(
			carPos,
			this.chaseState.lastFlatForward,
			ballPos,
			this.isBallCam,
		);

		this.chaseState.shakeIntensity = 0;
		this.chaseState.initialized = true;
		this.chaseState.posVelocity.set(0, 0, 0);
		this.chaseState.smoothedLookAt.copy(lookAt);
		this.threeJSCamera.position.copy(targetPos);
		this.threeJSCamera.up.set(0, 1, 0);
		this.threeJSCamera.lookAt(lookAt);

		const verticalFov = horizontalFovToVertical(
			this.baseHorizontalFov,
			this.threeJSCamera.aspect,
		);
		if (Math.abs(this.threeJSCamera.fov - verticalFov) > 0.02) {
			this.threeJSCamera.fov = verticalFov;
			this.chaseState.currentHorizontalFov = this.baseHorizontalFov;
			this.threeJSCamera.updateProjectionMatrix();
		}
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
		 */
		if (this.threeJSCamera.position.distanceToSquared(carPos) > 10 * 10) {
			this.snapChaseCamera(player, ballPos);
			return;
		}

		const velocity = player.getVelocity();
		const speed = velocity.length();
		const speedXZ = Math.hypot(velocity.x, velocity.z);
		const wheelsGrounded = player.getWheelsGroundedCount();
		const rot = player.rapierRigidBody.rotation();
		const carQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);

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
			this.goalFovBoost,
			player.isFlipping(),
			velocity,
		);
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
		this.goalFovBoost = Math.max(this.goalFovBoost, 10);
	}

	endGoalOrbit(): void {
		this.goalOrbitActive = false;
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
		this.chaseState.shakeIntensity = 0.2;
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

	/** FOV + shake przy kickoff IGNITE. */
	pulseKickoffIgnite(): void {
		this.goalFovBoost = 14;
		this.chaseState.shakeIntensity = 0.55;
		this.pulseCinematicFx(1.25);
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

		const goalFovPulse = (1 - crossWindow) * 6 + crossWindow * 14;
		const orbitFov = orbitWindow * 6;
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
				0.65,
			);
			this.goalFovBoost = Math.max(this.goalFovBoost, 16);
			this.pulseCinematicFx(1.05);
		}

		this.chaseState.shakeIntensity = THREE.MathUtils.lerp(
			this.chaseState.shakeIntensity,
			crossWindow > 0.4 && speed > 2 ? 0.28 : 0,
			0.12,
		);
	}
}

export default Renderer;
