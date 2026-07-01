import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import "./style.css";
import "./menu.css";

import { BotLearning } from "./ai/learning/BotLearning";
import { GameAudio } from "./audio/GameAudio";
import { HOVER_DEBUG_RAYS, HOVER_SAFE_MODE } from "./debug/config";
import { bootMark } from "./diagnostic/bootTrace";
import { matchMark } from "./diagnostic/matchTrace";
import { PhysicsTelemetry } from "./diagnostic/physicsTelemetry";
import GameObject from "./GameObject";
import { GameSession } from "./game/GameSession";
import { GameState } from "./game/GameState";
import type { GameModeId } from "./game/modes";
import { getLocalizedModeSpec, getModeSpec, parseGameMode } from "./game/modes";
import { initI18n, onLocaleChange, t } from "./i18n";
import { applyStaticI18n } from "./i18n/staticDom";
import {
	parseOnlineE2eParams,
	runOnlineE2eAutostart,
} from "./net/onlineE2eAutostart";
import Renderer from "./Renderer";
import Scene from "./Scene";
import type { RigidBodyData } from "./types";
import { BallOffScreenIndicator } from "./ui/BallOffScreenIndicator";
import { CreditsPanel } from "./ui/CreditsPanel";
import { LiveMainMenuScene } from "./ui/LiveMainMenuScene";
import { MainMenu } from "./ui/MainMenu";
import {
	MultiplayerLobby,
	type OnlineLobbyResult,
} from "./ui/MultiplayerLobby";
import { RlHud } from "./ui/RlHud";
import GameInput from "./util/GameInput";
import { RL_BALL } from "./util/rlConstants";
import { getObjectSize, loadModel } from "./util/ThreeJSHelpers";
import {
	buildArena,
	toggleSkyDrones,
	updateCyberpunkAmbience,
} from "./visual/arena";
import { BallShadow } from "./visual/ballShadow";
import { BallFloorIndicator } from "./visual/ballTracking/BallFloorIndicator";
import { CameraIntroTransition } from "./visual/cameraIntro";
import { warmupGameplayGpu, warmupGpu } from "./visual/gpuWarmup";
import {
	bindGrassRenderer,
	enhanceBall,
	grassMaterial,
	refreshAllGrassTextures,
} from "./visual/materials";
import { preloadCyberpunkSkybox, resetCyberpunkSkybox } from "./visual/skybox";
import { setStadiumVolumetricsVisible } from "./visual/stadiumLighting";
import { BallVfx } from "./visual/vfx/ballVfx";
import { BallWallMarkVfx } from "./visual/vfx/ballWallMark";
import { HitVfx } from "./visual/vfx/hitVfx";

const BALL_RADIUS = RL_BALL.radius;
const BALL_DIAMETER = BALL_RADIUS * 2;

let menuRaf = 0;
let liveMenu: LiveMainMenuScene | null = null;
let cameraIntro: CameraIntroTransition | null = null;

function showError(error: unknown) {
	document.getElementById("loading")?.classList.add("hidden");
	const errorBox = document.getElementById("error");
	const errorMsg = document.getElementById("error-msg");
	if (errorBox && errorMsg) {
		errorBox.style.display = "flex";
		errorMsg.textContent =
			error instanceof Error
				? `${error.message}\n${error.stack ?? ""}`
				: String(error);
	}
	console.error(error);
}

function hideLoading() {
	const el = document.getElementById("loading");
	if (el) {
		el.classList.add("hidden");
		el.style.display = "none";
	}
}

function setLoadingStatus(
	key: Parameters<typeof t>[0],
	params?: Parameters<typeof t>[1],
): void {
	const el = document.getElementById("loading-status");
	if (el) el.textContent = t(key, params);
}

function fitScale(
	root: THREE.Object3D,
	targetSize: number,
	axis: "x" | "y" | "z" = "z",
): number {
	const size = getObjectSize(root);
	const current = axis === "x" ? size.x : axis === "y" ? size.y : size.z;
	if (current <= 0) return 1;
	const s = targetSize / current;
	root.scale.multiplyScalar(s);
	return s;
}

let running = true;
let activeRaf = 0;
let gameStarted = false;
let matchStarting = false;
let matchPaused = false;
let pauseClosing = false;
let pauseCloseTimer = 0;
let session: GameSession | null = null;
let mainMenu: MainMenu | null = null;
let mpLobby: MultiplayerLobby | null = null;
let activeOnline: OnlineLobbyResult | null = null;
let gameState = GameState.MENU_CINEMATIC;

const pauseOverlay = () => document.getElementById("match-pause");
const pauseResumeBtn = () => document.getElementById("match-pause-resume");
const pauseMenuBtn = () => document.getElementById("match-pause-menu");

type RuntimeDeps = {
	scene: Scene;
	renderer: Renderer;
	ball: GameObject;
	ballRadius: number;
	ballShadow: BallShadow;
	ballFloorIndicator: BallFloorIndicator;
	ballOffScreen: BallOffScreenIndicator;
	hud: RlHud;
	audio: GameAudio;
	humanInput: GameInput;
	hitVfx: HitVfx;
	ballVfx: BallVfx;
	ballWallMarkVfx: BallWallMarkVfx;
	physicsTelemetry: PhysicsTelemetry | null;
	credits: CreditsPanel;
};

let runtimeDeps: RuntimeDeps | null = null;

const PAUSE_CLOSE_MS = 420;

/** Pauza nie może blokować ticka/HUD podczas kickoffu. */
function shouldRunGameplayTick(session: GameSession): boolean {
	if (!matchPaused) return true;
	if (session.match.isKickoffCountdownActive()) {
		hideMatchPause(true);
		return true;
	}
	return false;
}

const gameContainer = () => document.getElementById("game-container");
const hudRoot = () => document.getElementById("hud");

function setPauseWorldFx(active: boolean): void {
	gameContainer()?.classList.toggle("game-paused", active);
	hudRoot()?.classList.toggle("hud-paused", active);
}

function resetPauseOverlayClasses(el: HTMLElement): void {
	el.classList.remove("pause-open", "pause-closing");
}

function showMatchPause(): void {
	if (matchPaused || pauseClosing) return;
	const el = pauseOverlay();
	if (!el) return;

	matchPaused = true;
	window.clearTimeout(pauseCloseTimer);
	resetPauseOverlayClasses(el);
	el.classList.remove("hidden");
	setPauseWorldFx(true);
	void el.offsetWidth;
	el.classList.add("pause-open");
}

function hideMatchPause(instant = false): void {
	const el = pauseOverlay();
	if (!el) return;
	if (!matchPaused && !pauseClosing && el.classList.contains("hidden")) return;

	window.clearTimeout(pauseCloseTimer);
	matchPaused = false;
	setPauseWorldFx(false);

	if (
		instant ||
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	) {
		pauseClosing = false;
		resetPauseOverlayClasses(el);
		el.classList.add("hidden");
		return;
	}

	if (pauseClosing) return;

	pauseClosing = true;
	el.classList.remove("pause-open");
	void el.offsetWidth;
	el.classList.add("pause-closing");

	const finish = (): void => {
		if (!pauseClosing) return;
		pauseClosing = false;
		resetPauseOverlayClasses(el);
		el.classList.add("hidden");
	};

	pauseCloseTimer = window.setTimeout(finish, PAUSE_CLOSE_MS);
	el.addEventListener(
		"animationend",
		(e) => {
			if (e.target !== el || e.animationName !== "pauseBackdropOut") return;
			finish();
		},
		{ once: true },
	);
}

function tryRequestRematch(): void {
	if (gameState !== GameState.PLAYING || !session?.online) return;
	if (session.online.role !== "host") return;
	const snap = session.match.getHudSnapshot(session.cars);
	if (snap.phase !== "finished") return;
	session.online.roomClient.requestRematch();
}

function bindRematchControl(): void {
	document.getElementById("match-rematch")?.addEventListener("click", () => {
		tryRequestRematch();
	});
}

function bindMatchPauseControls(deps: RuntimeDeps): void {
	pauseResumeBtn()?.addEventListener("click", () => {
		if (!matchPaused) return;
		hideMatchPause();
		deps.renderer.focusCanvas();
	});

	pauseMenuBtn()?.addEventListener("click", () => {
		if (!matchPaused) return;
		void returnToMainMenu(deps);
	});
}

async function returnToMainMenu(deps: RuntimeDeps): Promise<void> {
	if (matchStarting) return;
	matchStarting = true;
	hideMatchPause(true);
	deps.humanInput.releaseAll();
	deps.audio.endMatchMusic(true);
	cameraIntro = null;

	if (activeOnline) {
		activeOnline.roomClient.disconnect();
		activeOnline = null;
	}
	mpLobby?.disconnect();

	if (session) {
		session.destroy(deps);
		session = null;
	}

	deps.ball.threeJSGroup.visible = false;
	deps.ballShadow.mesh.visible = false;
	deps.ballFloorIndicator.root.visible = false;
	deps.ballOffScreen.hide();
	deps.ballVfx.resetTrail();
	document.getElementById("hud")?.classList.add("hidden");
	document.getElementById("match-end-banner")?.classList.remove("show");
	document.getElementById("match-end-sub")?.classList.remove("show");
	document.getElementById("match-rematch")?.classList.remove("show");
	document.getElementById("match-rematch")?.classList.add("hidden");
	document.getElementById("match-rematch-wait")?.classList.remove("show");
	document.getElementById("match-rematch-wait")?.classList.add("hidden");
	setStadiumVolumetricsVisible(deps.scene.lighting, false);

	deps.scene.purgeMenuDecorations();
	setLoadingStatus("loading.status.menu3d");
	liveMenu = new LiveMainMenuScene(deps.scene, deps.renderer);
	await liveMenu.init();

	gameState = GameState.MENU_CINEMATIC;
	mainMenu?.show();
	startMenuLoop();
	matchStarting = false;
}

function handleMatchEscape(): void {
	if (gameState !== GameState.PLAYING || !session || matchStarting) return;
	if (runtimeDeps?.credits.isOpen()) return;
	if (pauseClosing) return;
	if (session.match.isKickoffCountdownActive()) return;

	if (matchPaused) {
		hideMatchPause();
		runtimeDeps?.humanInput.releaseAll();
		runtimeDeps?.renderer.focusCanvas();
		return;
	}

	runtimeDeps?.humanInput.releaseAll();
	showMatchPause();
}

game().catch(showError);

function requestGameFullscreen(): void {
	if (document.fullscreenElement) return;
	const root = document.documentElement;
	if (root.requestFullscreen) {
		void root.requestFullscreen().catch(() => {});
	}
}

function stopMenuLoop(): void {
	cancelAnimationFrame(menuRaf);
	menuRaf = 0;
}

function startMenuLoop(): void {
	let lastTime = performance.now();
	let menuElapsed = 0;
	const loop = (now: number): void => {
		menuRaf = requestAnimationFrame(loop);
		if (!running || !liveMenu || gameState !== GameState.MENU_CINEMATIC) return;
		const dt = Math.min((now - lastTime) / 1000, 0.05);
		lastTime = now;
		menuElapsed += dt;
		liveMenu.update(dt, menuElapsed);
	};
	menuRaf = requestAnimationFrame(loop);
}

let musicToastTimer = 0;

function showMusicTrackToast(audio: GameAudio): void {
	const { index, total, label } = audio.getMusicTrackInfo();
	let el = document.getElementById("music-track-toast");
	if (!el) {
		el = document.createElement("div");
		el.id = "music-track-toast";
		document.body.appendChild(el);
	}
	el.textContent = `♪ ${label} (${index}/${total})`;
	el.classList.add("visible");
	window.clearTimeout(musicToastTimer);
	musicToastTimer = window.setTimeout(
		() => el?.classList.remove("visible"),
		2200,
	);
}

async function game() {
	if (gameStarted) return;
	gameStarted = true;
	initI18n();
	applyStaticI18n();
	onLocaleChange(() => applyStaticI18n());
	bootMark("start");
	setLoadingStatus("loading.status.physics");
	await RAPIER.init();
	if (!running) return;

	const container = document.getElementById("game-container");
	if (!container) throw new Error("Brak elementu #game-container");

	setLoadingStatus("loading.status.scene");
	const scene = new Scene();
	const renderer = new Renderer(container);

	resetCyberpunkSkybox();
	setLoadingStatus("loading.status.sky");
	await preloadCyberpunkSkybox(scene.threeJSScene);
	if (!running) return;

	setLoadingStatus("loading.status.arena");
	grassMaterial();
	buildArena(scene);
	if (!running) return;
	refreshAllGrassTextures(scene.threeJSScene);
	bindGrassRenderer(renderer.threeJSRenderer);

	setLoadingStatus("loading.status.models");
	const ballMesh = await loadModel("/assets/models/rocketLeagueBall.glb");
	enhanceBall(ballMesh);
	fitScale(ballMesh, BALL_DIAMETER, "x");
	const ballRadius = BALL_DIAMETER * 0.5;

	const ballCollider: RigidBodyData = {
		colliderDesc: RAPIER.ColliderDesc.ball(ballRadius)
			.setRestitution(0)
			.setMass(RL_BALL.mass)
			.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
			.setFriction(RL_BALL.groundFriction)
			.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
			.setContactForceEventThreshold(6),
		rigidBodyDesc: RAPIER.RigidBodyDesc.dynamic()
			.setLinearDamping(RL_BALL.airLinearDamp)
			.setAngularDamping(RL_BALL.airAngularDamp)
			.setCcdEnabled(true),
	};
	const ball = new GameObject(scene, ballMesh as THREE.Mesh, ballCollider);
	ball.rapierRigidBody.setTranslation(
		{ x: 0, y: ballRadius + 0.08, z: 0 },
		false,
	);
	ball.threeJSGroup.visible = false;
	const ballShadow = new BallShadow(ballRadius);
	ballShadow.mesh.visible = false;
	scene.threeJSScene.add(ballShadow.mesh);
	const ballFloorIndicator = new BallFloorIndicator(ballRadius);
	ballFloorIndicator.root.visible = false;
	scene.threeJSScene.add(ballFloorIndicator.root);
	const ballOffScreen = new BallOffScreenIndicator();
	const ballVfx = new BallVfx(
		ball.threeJSGroup,
		scene.threeJSScene,
		ballRadius,
	);
	ballVfx.warmup();
	const hitVfx = new HitVfx(scene.threeJSScene);
	hitVfx.warmup();
	const ballWallMarkVfx = new BallWallMarkVfx(scene.threeJSScene);
	ballWallMarkVfx.warmup();

	const input = GameInput.createHuman(container);
	const physicsTelemetry = import.meta.env.DEV ? new PhysicsTelemetry() : null;
	const hud = new RlHud();
	const credits = new CreditsPanel();
	const audio = new GameAudio();
	audio.attachToCamera(renderer.threeJSCamera);
	audio.registerCollider(ball.rapierCollider.handle, "ball");
	scene.onContactForce = (event) => {
		audio.handleContactForce(event, scene.rapierWorld);
		ballWallMarkVfx.handleContactForce(event, scene.rapierWorld, audio, ball);
	};

	setLoadingStatus("loading.status.audio");
	await audio.preloadAssets();
	void audio.warmupAudio();

	window.addEventListener("keydown", (e) => {
		if (e.repeat) return;
		if (e.code === "Escape") {
			handleMatchEscape();
			return;
		}
		if (e.code === "KeyR") {
			tryRequestRematch();
			return;
		}
		if (e.code === "KeyM") {
			audio.toggleMusicMute();
		} else if (e.code === "BracketRight") {
			audio.nextMusicTrack();
			showMusicTrackToast(audio);
		} else if (e.code === "BracketLeft") {
			audio.prevMusicTrack();
			showMusicTrackToast(audio);
		} else if (e.code === "KeyH") {
			const on = toggleSkyDrones();
			console.info(`[FlyBall] Sky drones: ${on ? "ON" : "OFF"}`);
		}
	});

	setLoadingStatus("loading.status.menu3d");
	liveMenu = new LiveMainMenuScene(scene, renderer);
	await liveMenu.init();
	void BotLearning.get()
		.init()
		.then(() => {
			mainMenu?.refreshBotLearning();
			if (import.meta.env.DEV) {
				(
					window as unknown as {
						__igniteBotProgress?: () => ReturnType<
							BotLearning["getProgressSummary"]
						>;
					}
				).__igniteBotProgress = () => BotLearning.get().getProgressSummary();
			}
		});

	setLoadingStatus("loading.status.gpuWarmup");
	await warmupGpu(renderer, scene);
	hideLoading();
	gameState = GameState.MENU_CINEMATIC;
	startMenuLoop();
	bootMark("menu ready");

	const deps: RuntimeDeps = {
		scene,
		renderer,
		ball,
		ballRadius,
		ballShadow,
		ballFloorIndicator,
		ballOffScreen,
		ballVfx,
		hitVfx,
		ballWallMarkVfx,
		hud,
		audio,
		humanInput: input,
		physicsTelemetry,
		credits,
	};
	runtimeDeps = deps;
	bindMatchPauseControls(deps);
	bindRematchControl();

	mainMenu = new MainMenu(
		(mode) => {
			gameState = GameState.PLAYING;
			stopMenuLoop();
			void startMatch(mode, deps);
		},
		credits,
		() => {
			mainMenu?.hide();
			mpLobby?.show();
		},
		audio,
	);

	mpLobby = new MultiplayerLobby(
		(result) => {
			activeOnline = result;
			mpLobby?.hide();
			gameState = GameState.PLAYING;
			stopMenuLoop();
			void startOnlineMatch(result, deps);
		},
		() => {
			mpLobby?.hide();
			mainMenu?.show();
		},
	);

	const autostartRaw = new URLSearchParams(location.search).get("autostart");
	if (autostartRaw) {
		const autostart = parseGameMode(autostartRaw);
		bootMark(`autostart ${autostart}`);
		gameState = GameState.PLAYING;
		stopMenuLoop();
		mainMenu?.hide();
		void startMatch(autostart, deps);
		return;
	}

	const onlineE2e = parseOnlineE2eParams(new URLSearchParams(location.search));
	if (onlineE2e) {
		bootMark(`online e2e ${onlineE2e.role}`);
		gameState = GameState.PLAYING;
		stopMenuLoop();
		mainMenu?.hide();
		void runOnlineE2eAutostart(onlineE2e, (result) => {
			activeOnline = result;
			void startOnlineMatch(result, deps);
		}).catch(showError);
	}
}

async function startMatch(mode: GameModeId, deps: RuntimeDeps): Promise<void> {
	if (matchStarting) return;
	matchStarting = true;
	matchMark(`start ${mode}`);
	matchPaused = false;
	pauseClosing = false;
	hideMatchPause(true);
	if (!(window as unknown as { __igniteDesktop?: unknown }).__igniteDesktop) {
		requestGameFullscreen();
	}

	const menuPose = liveMenu?.getMenuCameraPose();
	liveMenu?.dispose();
	liveMenu = null;
	deps.scene.purgeMenuDecorations();
	setStadiumVolumetricsVisible(deps.scene.lighting, true);

	if (activeRaf) {
		cancelAnimationFrame(activeRaf);
		activeRaf = 0;
	}
	if (session) {
		session.destroy(deps);
		session = null;
	}

	document.getElementById("hud")?.classList.remove("hidden");
	const scoreboard = document.getElementById("scoreboard");
	if (scoreboard) {
		scoreboard.classList.toggle("ffa-mode", getModeSpec(mode).isFFA);
	}

	setLoadingStatus("loading.status.match", {
		mode: getLocalizedModeSpec(mode).label,
	});
	await BotLearning.get().refreshFromGlobal();

	try {
		session = await GameSession.create(mode, deps);
	} catch (err) {
		showError(err);
		running = false;
		matchStarting = false;
		return;
	}
	matchMark("session ready");

	const humanRot = session.humanCar.player.rapierRigidBody.rotation();
	const spawnQuat = new THREE.Quaternion(
		humanRot.x,
		humanRot.y,
		humanRot.z,
		humanRot.w,
	);
	deps.renderer.resetChaseCamera(spawnQuat);

	if (menuPose) {
		deps.renderer.threeJSCamera.position.copy(menuPose.position);
		deps.renderer.threeJSCamera.up.set(0, 1, 0);
		deps.renderer.threeJSCamera.lookAt(menuPose.lookAt);
	}

	deps.audio.warmupSpatialImpacts();
	deps.audio.beginMatchMusic();
	deps.renderer.render(deps.scene);

	deps.ball.threeJSGroup.visible = true;
	deps.ballShadow.mesh.visible = true;
	deps.ballFloorIndicator.root.visible = true;
	deps.ballOffScreen.hide();

	setLoadingStatus("loading.status.vfxShaders");
	await warmupGameplayGpu(deps.renderer, deps.scene, {
		ball: deps.ball,
		ballVfx: deps.ballVfx,
		hitVfx: deps.hitVfx,
		ballShadow: deps.ballShadow,
		ballWallMarkVfx: deps.ballWallMarkVfx,
	});

	session.match.setCountdownHold(true);

	cameraIntro = new CameraIntroTransition();
	if (menuPose) {
		cameraIntro.start(menuPose.position, menuPose.lookAt);
	} else {
		cameraIntro.captureFromCamera(deps.renderer.threeJSCamera);
	}

	(window as unknown as { __igniteSession?: GameSession }).__igniteSession =
		session;

	if (HOVER_SAFE_MODE) {
		console.warn(
			"[HOVER DIAG] Safe Mode ON — boty wyłączone; skok PPM + aerial WASD. Spacja = Car Cam. " +
				`Raycast viz: ${HOVER_DEBUG_RAYS ? "TAK" : "NIE"}. Logi: [JUMP], [HOVER], [CRITICAL PHYSICS FAIL].`,
		);
	}

	deps.renderer.focusCanvas();

	const clock = new THREE.Clock();

	function gameLoop(): void {
		if (!running) return;
		activeRaf = requestAnimationFrame(gameLoop);
		const dt = Math.min(clock.getDelta(), 0.1);
		const nowSec = clock.elapsedTime;

		if (session) {
			if (!session.online || session.online.role === "host") {
				session.match.advanceCountdown(dt);
			}

			const introActive =
				cameraIntro?.update(
					dt,
					deps.renderer,
					session.humanCar.player,
					deps.ball.getPosition(),
				) ?? false;

			if (shouldRunGameplayTick(session)) {
				if (introActive) {
					deps.physicsTelemetry?.noteSteeringInput(deps.humanInput.yaw(), dt);
					try {
						session.tick(deps, dt, nowSec, true);
					} catch (err) {
						console.error("Ignite tick error:", err);
					}
				} else {
					if (session.match.isCountdownHeld()) {
						session.match.setCountdownHold(false);
					}
					deps.physicsTelemetry?.noteSteeringInput(deps.humanInput.yaw(), dt);
					try {
						session.tick(deps, dt, nowSec);
					} catch (err) {
						console.error("Ignite tick error:", err);
					}
				}
			}
		} else {
			updateCyberpunkAmbience(
				nowSec,
				dt,
				deps.scene.lighting,
				deps.scene.threeJSScene,
			);
		}

		try {
			deps.renderer.render(deps.scene);
		} catch (err) {
			console.error("Ignite render error:", err);
			showError(err);
			running = false;
			cancelAnimationFrame(activeRaf);
			return;
		}
	}

	activeRaf = requestAnimationFrame(gameLoop);
	matchStarting = false;
	matchMark("match live");
}

function wireOnlineRoomCallbacks(deps: RuntimeDeps): void {
	if (!activeOnline) return;
	activeOnline.roomClient.setCallbacks({
		onStartMatch: () => {
			if (gameState === GameState.PLAYING && session) {
				void reloadOnlineMatch(deps);
			}
		},
		onPeerLeft: () => {
			if (gameState === GameState.PLAYING && session) {
				void returnToMainMenu(deps);
			}
		},
		onDisconnect: () => {
			if (gameState === GameState.PLAYING && session) {
				void returnToMainMenu(deps);
			}
		},
	});
}

async function reloadOnlineMatch(deps: RuntimeDeps): Promise<void> {
	if (!activeOnline || matchStarting) return;
	matchStarting = true;
	hideMatchPause(true);
	matchPaused = false;
	cameraIntro = null;

	document.getElementById("match-end-banner")?.classList.remove("show");
	document.getElementById("match-end-sub")?.classList.remove("show");
	document.getElementById("match-rematch")?.classList.remove("show");
	document.getElementById("match-rematch")?.classList.add("hidden");
	document.getElementById("match-rematch-wait")?.classList.remove("show");
	document.getElementById("match-rematch-wait")?.classList.add("hidden");

	deps.humanInput.releaseAll();
	deps.audio.endMatchMusic(true);

	if (session) {
		session.destroy(deps);
		session = null;
	}

	try {
		session = await GameSession.createOnline(deps, {
			role: activeOnline.role,
			localSlot: activeOnline.localSlot,
			roomClient: activeOnline.roomClient,
			remoteInput: activeOnline.remoteInput,
			ranked: activeOnline.roomClient.ranked,
		});
	} catch (err) {
		showError(err);
		matchStarting = false;
		return;
	}

	wireOnlineRoomCallbacks(deps);

	if (activeOnline.role === "host") {
		session.match.setCountdownHold(true);
	}

	cameraIntro = new CameraIntroTransition();
	cameraIntro.captureFromCamera(deps.renderer.threeJSCamera);

	(window as unknown as { __igniteSession?: GameSession }).__igniteSession =
		session;

	deps.audio.beginMatchMusic();
	matchStarting = false;
	matchMark("online rematch");
}

async function startOnlineMatch(
	result: OnlineLobbyResult,
	deps: RuntimeDeps,
): Promise<void> {
	if (matchStarting) return;
	matchStarting = true;
	matchMark("start online 1v1");
	matchPaused = false;
	pauseClosing = false;
	hideMatchPause(true);
	if (!(window as unknown as { __igniteDesktop?: unknown }).__igniteDesktop) {
		requestGameFullscreen();
	}

	const menuPose = liveMenu?.getMenuCameraPose();
	liveMenu?.dispose();
	liveMenu = null;
	deps.scene.purgeMenuDecorations();
	setStadiumVolumetricsVisible(deps.scene.lighting, true);

	if (activeRaf) {
		cancelAnimationFrame(activeRaf);
		activeRaf = 0;
	}
	if (session) {
		session.destroy(deps);
		session = null;
	}

	document.getElementById("hud")?.classList.remove("hidden");
	const scoreboard = document.getElementById("scoreboard");
	if (scoreboard) {
		scoreboard.classList.remove("ffa-mode");
	}

	setLoadingStatus("loading.status.matchOnline");

	try {
		session = await GameSession.createOnline(deps, {
			role: result.role,
			localSlot: result.localSlot,
			roomClient: result.roomClient,
			remoteInput: result.remoteInput,
			ranked: result.ranked,
		});
	} catch (err) {
		showError(err);
		running = false;
		matchStarting = false;
		return;
	}

	wireOnlineRoomCallbacks(deps);

	const humanRot = session.humanCar.player.rapierRigidBody.rotation();
	const spawnQuat = new THREE.Quaternion(
		humanRot.x,
		humanRot.y,
		humanRot.z,
		humanRot.w,
	);
	deps.renderer.resetChaseCamera(spawnQuat);

	if (menuPose) {
		deps.renderer.threeJSCamera.position.copy(menuPose.position);
		deps.renderer.threeJSCamera.up.set(0, 1, 0);
		deps.renderer.threeJSCamera.lookAt(menuPose.lookAt);
	}

	deps.audio.warmupSpatialImpacts();
	deps.audio.beginMatchMusic();
	deps.renderer.render(deps.scene);

	deps.ball.threeJSGroup.visible = true;
	deps.ballShadow.mesh.visible = true;
	deps.ballFloorIndicator.root.visible = true;
	deps.ballOffScreen.hide();

	setLoadingStatus("loading.status.vfxShaders");
	await warmupGameplayGpu(deps.renderer, deps.scene, {
		ball: deps.ball,
		ballVfx: deps.ballVfx,
		hitVfx: deps.hitVfx,
		ballShadow: deps.ballShadow,
		ballWallMarkVfx: deps.ballWallMarkVfx,
	});

	if (result.role === "host") {
		session.match.setCountdownHold(true);
	}

	cameraIntro = new CameraIntroTransition();
	if (menuPose) {
		cameraIntro.start(menuPose.position, menuPose.lookAt);
	} else {
		cameraIntro.captureFromCamera(deps.renderer.threeJSCamera);
	}

	(window as unknown as { __igniteSession?: GameSession }).__igniteSession =
		session;
	deps.renderer.focusCanvas();

	const clock = new THREE.Clock();

	function gameLoop(): void {
		if (!running) return;
		activeRaf = requestAnimationFrame(gameLoop);
		const dt = Math.min(clock.getDelta(), 0.1);
		const nowSec = clock.elapsedTime;

		if (session) {
			if (!session.online || session.online.role === "host") {
				session.match.advanceCountdown(dt);
			}

			const introActive =
				cameraIntro?.update(
					dt,
					deps.renderer,
					session.humanCar.player,
					deps.ball.getPosition(),
				) ?? false;

			if (shouldRunGameplayTick(session)) {
				if (introActive) {
					deps.physicsTelemetry?.noteSteeringInput(deps.humanInput.yaw(), dt);
					try {
						session.tick(deps, dt, nowSec, true);
					} catch (err) {
						console.error("Ignite tick error:", err);
					}
				} else {
					if (session.match.isCountdownHeld()) {
						session.match.setCountdownHold(false);
					}
					deps.physicsTelemetry?.noteSteeringInput(deps.humanInput.yaw(), dt);
					try {
						session.tick(deps, dt, nowSec);
					} catch (err) {
						console.error("Ignite tick error:", err);
					}
				}
			}
		} else {
			updateCyberpunkAmbience(
				nowSec,
				dt,
				deps.scene.lighting,
				deps.scene.threeJSScene,
			);
		}

		try {
			deps.renderer.render(deps.scene);
		} catch (err) {
			console.error("Ignite render error:", err);
			showError(err);
			running = false;
			cancelAnimationFrame(activeRaf);
			return;
		}
	}

	activeRaf = requestAnimationFrame(gameLoop);
	matchStarting = false;
	matchMark("match live");
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		running = false;
		gameStarted = false;
		matchStarting = false;
		if (session) {
			session = null;
		}
		cancelAnimationFrame(activeRaf);
		stopMenuLoop();
		liveMenu?.dispose();
		liveMenu = null;
		activeRaf = 0;
		const el = document.getElementById("game-container");
		if (el) el.innerHTML = "";
	});
}
