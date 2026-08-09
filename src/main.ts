import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import "./style.css";
import "./menu.css";
import "./menu-crate-garage.css";
import "./menu-apex.css";
import "./menu-showcase-compositor.css";
import "./menu-live-ui.css";

import { BotLearning } from "./ai/learning/BotLearning";
import { primeArenaCatalog } from "./arena/ArenaCatalog";
import { ArenaRuntime, initArenaRuntime } from "./arena/ArenaRuntime";
import { GameAudio } from "./audio/GameAudio";
import { MatchCommentator } from "./audio/MatchCommentator";
import { HOVER_DEBUG_RAYS, HOVER_SAFE_MODE } from "./debug/config";
import { getDevFreeCamera } from "./debug/DevFreeCamera";
import { bootMark } from "./diagnostic/bootTrace";
import { installAutoPlayerReport, autoReportAfterMatch } from "./diagnostic/autoPlayerReport";
import { installErrorRing } from "./diagnostic/errorRing";
import { noteFrameTime } from "./diagnostic/frameStats";
import { matchMark } from "./diagnostic/matchTrace";
import {
	beginMatchSession,
	endMatchSession,
	installMatchSessionWindowHooks,
	noteMatchEvent,
	noteMatchFrame,
	noteMatchHud,
} from "./diagnostic/matchSessionMonitor";
import {
	collectAndSendPlayerReport,
	copyReportToClipboard,
} from "./diagnostic/PlayerReport";
import { wireGameplayClips, type ClipWiring } from "./boot/clipWiring";
import {
	assembleGameSessionDeps,
	toRuntimeDeps,
	type RuntimeDeps,
} from "./boot/matchBootstrap";
import { PhysicsTelemetry } from "./diagnostic/physicsTelemetry";
import GameObject from "./GameObject";
import { GameSession } from "./game/GameSession";
import { GameState } from "./game/GameState";
import type { GameModeId } from "./game/modes";
import { getLocalizedModeSpec, getModeSpec, parseGameMode } from "./game/modes";
import { initI18n, onLocaleChange, t } from "./i18n";
import { applyStaticI18n } from "./i18n/staticDom";
import { primeCarCatalog } from "./meta/CarCatalog";
import {
	makeCosmeticRef,
	primeItemCatalog,
	type CosmeticRef,
} from "./meta/CosmeticCatalog";
import { primePaintCatalog } from "./meta/PaintCatalog";
import { resetMatchEndMeta, setMatchEndListener } from "./meta/MatchEndMeta";
import {
	buildGarageAuditLoadout,
	probeWheelAuditScene,
	sampleHeroWheelMeshes,
	type WheelAuditProbe,
} from "./visual/wheelAuditProbe";
import { RL_ARENA } from "./visual/arenaConstants";
import {
	getEquippedArenaId,
	getEquippedCarId,
	PlayerInventory,
	setGarageCustomizeCarId,
	unlockInstance,
} from "./meta/PlayerInventory";
import { getEquippedCarLoadout } from "./visual/carCosmetics";
import {
	parseOnlineE2eParams,
	runOnlineE2eAutostart,
} from "./net/onlineE2eAutostart";
import { effectiveRanked } from "./net/rankedFeature";
import Renderer from "./Renderer";
import Scene from "./Scene";
import type { RigidBodyData } from "./types";
import { BallOffScreenIndicator } from "./ui/BallOffScreenIndicator";
import { bootIntro, LOADING_PROGRESS } from "./ui/BootIntroOverlay";
import { pickCrashGag } from "./ui/crashGags";
import {
	beginIgniteBootCinematic,
	shouldPlayBootCinematic,
	type BootCinematicHandle,
} from "./ui/IgniteBootCinematic";
import { CreditsPanel } from "./ui/CreditsPanel";
import { TutorialOverlay } from "./ui/TutorialOverlay";
import { demoAllowsMode, isDemoBuild } from "./game/demoBuild";
import { LiveMainMenuScene } from "./ui/LiveMainMenuScene";
import { LoadoutOverlay } from "./ui/LoadoutOverlay";
import { MainMenu } from "./ui/MainMenu";
import { registerUiBackHandler, tryUiNavigateBack } from "./ui/uiNavigationStack";
import { MatchMinimap } from "./ui/MatchMinimap";
import { MatchScoreboardOverlay } from "./ui/MatchScoreboardOverlay";
import {
	MultiplayerLobby,
	type OnlineLobbyResult,
} from "./ui/MultiplayerLobby";
import { SocialOverlay } from "./ui/SocialOverlay";
import { PreMatchLobbyScene } from "./ui/PreMatchLobbyScene";
import { CrateRevealOverlay } from "./ui/CrateRevealOverlay";
import { PostMatchDropOverlay } from "./ui/PostMatchDropOverlay";
import { CoachHintsOverlay } from "./ui/CoachHintsOverlay";
import { RankedResultOverlay } from "./ui/RankedResultOverlay";
import { RlHud } from "./ui/RlHud";
import { SettingsOverlay } from "./ui/SettingsOverlay";
import GameInput from "./util/GameInput";
import { resolveGraphicsSettings } from "./util/graphicsProfile";
import { applyPresentationPrefs } from "./util/presentationPrefs";
import { RL_BALL } from "./util/rlConstants";
import { getObjectSize, loadModel } from "./util/ThreeJSHelpers";
import { CrateBackdropOrbit } from "./visual/crateBackdropOrbit";
import {
	buildArena,
	rebuildArenaForActive,
	rebuildGrassBladesForQuality,
	toggleSkyDrones,
} from "./visual/arena";
import { BallShadow } from "./visual/ballShadow";
import { BallFloorIndicator } from "./visual/ballTracking/BallFloorIndicator";
import { preloadCarMeshes } from "./visual/CarModel";
import { warmupGameplayGpu, warmupGpu } from "./visual/gpuWarmup";
import {
	bindGrassRenderer,
	enhanceBall,
	grassMaterial,
	refreshAllGrassTextures,
} from "./visual/materials";
import {
	getMeshyBallModelUrl,
	preloadMeshyArenaAssets,
	preloadMeshyBallModel,
} from "./visual/meshyArenaAssets";
import { preloadPowerUpPickupModels } from "./visual/powerUpPickupModel";
import { preloadCyberpunkSkybox, resetCyberpunkSkybox } from "./visual/skybox";
import { BallVfx } from "./visual/vfx/ballVfx";
import { BallWallMarkVfx } from "./visual/vfx/ballWallMark";
import { HitVfx } from "./visual/vfx/hitVfx";
import { PowerUpActivationVfx } from "./visual/vfx/powerUpActivationVfx";

const BALL_RADIUS = RL_BALL.radius;
const BALL_DIAMETER = BALL_RADIUS * 2;

let menuRaf = 0;
let menuLoopRenderer: Renderer | null = null;
let liveMenu: LiveMainMenuScene | null = null;

function showError(error: unknown) {
	document.documentElement.classList.remove("ignite-boot-cinematic");
	document.getElementById("ignite-boot-cinematic")?.remove();
	document.getElementById("loading")?.classList.add("hidden");
	void bootIntro.hide();
	const errorBox = document.getElementById("error");
	const errorMsg = document.getElementById("error-msg");
	if (errorBox && errorMsg) {
		errorBox.style.display = "flex";
		const title = errorBox.querySelector(".error-crash__title");
		const hint = errorBox.querySelector(".error-crash__hint");
		if (title) title.textContent = t("error.boot");
		if (hint) hint.textContent = t("error.hint");
		const gag = document.getElementById("error-gag");
		if (gag) {
			gag.textContent = pickCrashGag();
			gag.hidden = false;
		}
		errorMsg.textContent =
			error instanceof Error
				? `${error.message}\n${error.stack ?? ""}`
				: String(error);
		const reload = document.getElementById("error-reload");
		if (reload && !reload.dataset.bound) {
			reload.dataset.bound = "1";
			reload.addEventListener("click", () => location.reload());
		}
	}
	console.error(error);
}

async function hideLoading(): Promise<void> {
	await bootIntro.hide();
}

function showLoading(mode: "boot" | "match" = "match"): void {
	bootIntro.start(mode);
}

function setLoadingStatus(
	key: Parameters<typeof t>[0],
	params?: Parameters<typeof t>[1],
): void {
	bootIntro.setStatus(t(key, params));
	const progress = LOADING_PROGRESS[key];
	if (progress != null) bootIntro.setProgress(progress);
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
let settingsOverlay: SettingsOverlay | null = null;
let loadoutOverlay: LoadoutOverlay | null = null;
let postMatchDropOverlay: PostMatchDropOverlay | null = null;
let coachHintsOverlay: CoachHintsOverlay | null = null;
let crateRevealOverlay: CrateRevealOverlay | null = null;
let tutorialOverlay: TutorialOverlay | null = null;
let rankedResultOverlay: RankedResultOverlay | null = null;
let crateBackdropOrbit: CrateBackdropOrbit | null = null;
let crateBackdropWasMenuHidden = false;
let mpLobby: MultiplayerLobby | null = null;
let socialOverlay: SocialOverlay | null = null;
let preMatchLobby: PreMatchLobbyScene | null = null;
let activeOnline: OnlineLobbyResult | null = null;
let gameState = GameState.MENU_CINEMATIC;

function applyShowcaseLaunchFlags(): void {
	const params = new URLSearchParams(location.search);
	if (params.get("canvasOnly") === "1") {
		document.body.classList.add("showcase-canvas-only");
		console.info("[Ignite] ?canvasOnly=1 — sam WebGL, bez HUD HTML");
	}
	if (params.get("showcaseFrozen") === "1") {
		document.body.classList.add("showcase-frozen");
		console.info("[Ignite] ?showcaseFrozen=1 — bez obrotu auta/kamery");
	}
}

function setPresentationShell(mode: "menu" | "match"): void {
	document.body.classList.toggle("menu-active", mode === "menu");
	document.body.classList.toggle("in-match", mode === "match");
	socialOverlay?.setMatchStatus(mode === "match");
	const stack = document.getElementById("webgl-stack");
	/* WebGL w osobnym stacku — ostatni w DOM, izolacja od UI (Wayland ghost). */
	if (stack && mode === "menu") {
		document.body.appendChild(stack);
	}
	/** Mecz: blit→present (jak menu) — żywy source ghostował orbitę na Wayland. */
	if (mode === "match") {
		const source = document.querySelector<HTMLCanvasElement>(
			"canvas.webgl-source-canvas",
		);
		const present = document.querySelector<HTMLCanvasElement>(
			"canvas.webgl-present-canvas",
		);
		if (source) {
			source.style.opacity = "0";
			source.style.display = "block";
			source.style.pointerEvents = "none";
			source.style.zIndex = "0";
		}
		if (present) {
			present.style.display = "block";
			present.style.opacity = "1";
			present.style.pointerEvents = "auto";
			present.style.zIndex = "1";
		}
	}
}

const pauseOverlay = () => document.getElementById("match-pause");
const pauseResumeBtn = () => document.getElementById("match-pause-resume");
const pauseMenuBtn = () => document.getElementById("match-pause-menu");
const pauseSettingsBtn = () => document.getElementById("match-pause-settings");
const pauseReportBtn = () => document.getElementById("match-pause-report");
const pauseForfeitBtn = () => document.getElementById("match-pause-forfeit");

function updatePauseForfeitButton(): void {
	const btn = pauseForfeitBtn();
	if (!btn) return;
	const show =
		gameState === GameState.PLAYING &&
		session !== null &&
		Boolean(session.online) &&
		session.match.getPhase() !== "finished";
	btn.classList.toggle("hidden", !show);
}

function applyRuntimeGraphics(
	deps: Pick<RuntimeDeps, "scene" | "renderer">,
): void {
	const settings = resolveGraphicsSettings();
	deps.renderer.optics.bindLighting(deps.scene.lighting);
	deps.renderer.optics.setQuality(settings.quality);
	deps.renderer.applyGraphicsSettings(settings);
	rebuildGrassBladesForQuality(settings.quality);
}


let runtimeDeps: RuntimeDeps | null = null;

const PAUSE_CLOSE_MS = 420;

/** Pauza nie może blokować ticka/HUD podczas kickoffu. */
function shouldRunGameplayTick(session: GameSession): boolean {
	/** Tylko pełny freeze stilli — nagrywanie klipów boot zostawia fizykę. */
	if (
		(globalThis as unknown as { __igniteCaptureFreezePhysics?: boolean })
			.__igniteCaptureFreezePhysics
	) {
		return false;
	}
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
	updatePauseForfeitButton();
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

	pauseSettingsBtn()?.addEventListener("click", () => {
		if (!matchPaused) return;
		settingsOverlay?.show();
	});

	pauseReportBtn()?.addEventListener("click", () => {
		if (!matchPaused) return;
		void (async () => {
			const btn = pauseReportBtn();
			if (btn) btn.setAttribute("disabled", "true");
			try {
				const result = await collectAndSendPlayerReport({
					context: {
						source: "pause",
						mode: session?.mode ?? null,
						online: Boolean(session?.online),
					},
				});
				if (!result.ok) {
					await copyReportToClipboard(result.report);
				}
				settingsOverlay?.show();
			} finally {
				btn?.removeAttribute("disabled");
			}
		})();
	});

	pauseForfeitBtn()?.addEventListener("click", () => {
		if (!matchPaused || !session?.online) return;
		if (session.match.getPhase() === "finished") return;
		hideMatchPause(true);
		session.requestForfeit();
	});
}

function hideMetaOverlays(): void {
	crateRevealOverlay?.hide(false);
	postMatchDropOverlay?.hide(false);
	coachHintsOverlay?.hide();
	rankedResultOverlay?.hide();
	resetMatchEndMeta();
}

/** Zatrzymaj pętlę meczu (RAF) — inaczej walczy z setAnimationLoop menu. */
function stopMatchLoop(): void {
	if (activeRaf) {
		cancelAnimationFrame(activeRaf);
		activeRaf = 0;
	}
}

async function returnToMainMenu(deps: RuntimeDeps): Promise<void> {
	if (matchStarting) return;
	matchStarting = true;
	endMatchSession();
	autoReportAfterMatch({
		source: "returnToMainMenu",
		mode: session?.mode ?? null,
		online: Boolean(session?.online),
	});
	hideMatchPause(true);
	hideMetaOverlays();
	deps.humanInput.releaseAll();
	deps.audio.endMatchMusic(true);
	/** Natychmiast — zanim await liveMenu.init(); podwójny render = freeze. */
	stopMatchLoop();
	gameState = GameState.MENU_CINEMATIC;

	if (activeOnline) {
		activeOnline.roomClient.disconnect();
		activeOnline = null;
	}
	mpLobby?.disconnect();

	if (session) {
		const dying = session;
		session = null;
		dying.destroy(deps);
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
	deps.renderer.optics.bindLighting(deps.scene.lighting);
	deps.renderer.optics.setMode("menu");
	deps.renderer.optics.apply(deps.renderer.threeJSRenderer);

	deps.scene.purgeMenuDecorations();
	setLoadingStatus("loading.status.menu3d");
	liveMenu = new LiveMainMenuScene(deps.scene, deps.renderer);
	await liveMenu.init();
	if (import.meta.env.DEV) {
		(
			window as unknown as { __igniteLiveMenu?: LiveMainMenuScene }
		).__igniteLiveMenu = liveMenu;
	}

	gameState = GameState.MENU_CINEMATIC;
	setPresentationShell("menu");
	mainMenu?.show();
	startMenuLoop(deps.renderer);
	matchStarting = false;
}

function registerUiNavigation(): void {
	registerUiBackHandler(() => {
		if (!crateRevealOverlay?.isVisible()) return false;
		crateRevealOverlay.dismissViaBack();
		return true;
	});
	registerUiBackHandler(() => {
		if (!postMatchDropOverlay?.isVisible()) return false;
		postMatchDropOverlay.hide(false);
		return true;
	});
	registerUiBackHandler(() => {
		if (!rankedResultOverlay?.isVisible()) return false;
		rankedResultOverlay.hide();
		return true;
	});
	registerUiBackHandler(() => {
		if (!loadoutOverlay?.isVisible()) return false;
		loadoutOverlay.hide();
		return true;
	});
	registerUiBackHandler(() => {
		if (!settingsOverlay?.isVisible()) return false;
		settingsOverlay.hide();
		return true;
	});
	registerUiBackHandler(() => {
		if (!mpLobby?.isVisible()) return false;
		mpLobby.cancel();
		return true;
	});
	registerUiBackHandler(() => {
		if (!runtimeDeps?.credits.isOpen()) return false;
		runtimeDeps.credits.hide();
		return true;
	});
}

function handleMatchEscape(): void {
	if (tryUiNavigateBack()) return;
	if (gameState !== GameState.PLAYING || !session || matchStarting) return;
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

function ensureBootCover(): void {
	const desk = (
		window as unknown as {
			__igniteDesktop?: { enterBorderless?: () => Promise<boolean> };
		}
	).__igniteDesktop;
	if (desk?.enterBorderless) {
		void desk.enterBorderless();
	} else {
		requestGameFullscreen();
	}
}

/** Borderless cover / FS od razu przy intro — nie dopiero gdy menu gotowe. */
ensureBootCover();
/**
 * Jeśli będzie 3D intro: od razu czarne tło (bez video loading).
 * Wykop startuje w game() — przed RAPIER / loadingiem danych.
 * previewCrash — zero boot logo / intro (od razu ekran błędu).
 */
const previewCrash =
	typeof location !== "undefined" &&
	new URLSearchParams(location.search).get("previewCrash") === "1";
if (!previewCrash) {
	bootIntro.start("boot");
	if (shouldPlayBootCinematic()) {
		bootIntro.enterCinematicMode();
	}
}

function stopMenuLoop(): void {
	menuLoopRenderer?.threeJSRenderer.setAnimationLoop(null);
	menuLoopRenderer = null;
	cancelAnimationFrame(menuRaf);
	menuRaf = 0;
}

let garageAuditCarId: string | null = null;
let garageAuditWheelId: string | null = null;

/** Fake drop do szybkiego testu UI — bez meczu. */
function buildCratePreviewDrop(
	params: URLSearchParams = new URLSearchParams(),
): Extract<import("./meta/DropTable").DropResult, { kind: "crate" }> {
	const carId = params.get("car") ?? "blade";
	const count = Math.max(1, Math.min(5, Number(params.get("crates") ?? "1") || 1));
	const items: CosmeticRef[] = [];
	for (let i = 0; i < count; i++) {
		const ref =
			i === 0
				? makeCosmeticRef("car", carId, null)
				: makeCosmeticRef("wheel", "neon", null);
		unlockInstance(ref, false);
		items.push(ref);
	}
	return { kind: "crate", items };
}

function runCratePreview(
	overlay: CrateRevealOverlay,
	params: URLSearchParams = new URLSearchParams(location.search),
): void {
	mainMenu?.hide();
	document.body.classList.add("menu-active");
	overlay.showDrop(buildCratePreviewDrop(params));
	console.info(
		"[Ignite] cratePreview — Ctrl+Shift+C ponów · ?cratePreview=1&car=blade&crates=3",
	);
}

function setupCratePreviewHarness(overlay: CrateRevealOverlay): void {
	const win = window as unknown as {
		__igniteCratePreview?: (opts?: {
			car?: string;
			crates?: number;
		}) => void;
	};
	win.__igniteCratePreview = (opts) => {
		const p = new URLSearchParams(location.search);
		if (opts?.car) p.set("car", opts.car);
		if (opts?.crates != null) p.set("crates", String(opts.crates));
		runCratePreview(overlay, p);
	};

	window.addEventListener("keydown", (e) => {
		if (!(e.ctrlKey && e.shiftKey && e.code === "KeyC")) return;
		if (e.repeat) return;
		e.preventDefault();
		runCratePreview(overlay);
	});
}

async function setupGarageCarAudit(params: URLSearchParams): Promise<void> {
	const carId = params.get("car") ?? "buggy";
	const wheelId = params.get("wheel") ?? "default";
	garageAuditCarId = carId;
	garageAuditWheelId = wheelId;

	const { unlockAllGarageCarsForDev, unlockGarageCosmeticsForDev } =
		await import("./meta/devGarageUnlock");
	unlockGarageCosmeticsForDev();
	await unlockAllGarageCarsForDev();

	setGarageCustomizeCarId(carId);
	const loadout = buildGarageAuditLoadout(carId, wheelId);

	mainMenu?.hide();
	document.body.classList.add("garage-open", "menu-active");
	liveMenu?.setGarageMode(true);
	await liveMenu?.setPreviewCar(carId, null, loadout);
	await new Promise((r) => window.setTimeout(r, 1200));

	const win = window as unknown as {
		__igniteWheelAuditProbe?: () => WheelAuditProbe | null;
		__igniteWheelAuditMeshes?: () => ReturnType<typeof sampleHeroWheelMeshes>;
	};
	win.__igniteWheelAuditProbe = () => {
		if (!runtimeDeps?.scene.threeJSScene) return null;
		return probeWheelAuditScene(
			runtimeDeps.scene.threeJSScene,
			garageAuditCarId,
			garageAuditWheelId,
		);
	};
	win.__igniteWheelAuditMeshes = () => {
		if (!runtimeDeps?.scene.threeJSScene) return [];
		return sampleHeroWheelMeshes(runtimeDeps.scene.threeJSScene);
	};

	console.info("[Ignite] garageAudit ready", { carId, wheelId });
}

function startMenuLoop(renderer: Renderer): void {
	menuLoopRenderer = renderer;
	let lastTime = performance.now();
	let menuElapsed = 0;
	const onPointerMove = (e: PointerEvent) => {
		if (!liveMenu || gameState !== GameState.MENU_CINEMATIC) return;
		const nx = (e.clientX / window.innerWidth) * 2 - 1;
		const ny = (e.clientY / window.innerHeight) * 2 - 1;
		liveMenu.setPointerNorm(nx, ny);
	};
	window.addEventListener("pointermove", onPointerMove, { passive: true });
	window.addEventListener("ignite:menu-accent", ((e: CustomEvent<string>) => {
		liveMenu?.setMenuAccent(e.detail);
		liveMenu?.pulseModeSwitchFx(e.detail);
	}) as EventListener);

	renderer.threeJSRenderer.setAnimationLoop((now) => {
		if (!running || !liveMenu || gameState !== GameState.MENU_CINEMATIC) return;
		const t = now ?? performance.now();
		const dt = Math.min((t - lastTime) / 1000, 0.05);
		lastTime = t;
		menuElapsed += dt;
		liveMenu.update(dt, menuElapsed);
	});
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

function showAudioMuteToast(muted: boolean): void {
	let el = document.getElementById("music-track-toast");
	if (!el) {
		el = document.createElement("div");
		el.id = "music-track-toast";
		document.body.appendChild(el);
	}
	el.textContent = muted ? "🔇 Dźwięk gry wyciszony (M = włącz)" : "🔊 Dźwięk gry włączony";
	el.classList.add("visible");
	window.clearTimeout(musicToastTimer);
	musicToastTimer = window.setTimeout(
		() => el?.classList.remove("visible"),
		2200,
	);
}

function showOnlineDisconnectToast(message: string): void {
	let el = document.getElementById("music-track-toast");
	if (!el) {
		el = document.createElement("div");
		el.id = "music-track-toast";
		document.body.appendChild(el);
	}
	el.textContent = message;
	el.classList.add("visible");
	window.clearTimeout(musicToastTimer);
	musicToastTimer = window.setTimeout(
		() => el?.classList.remove("visible"),
		4200,
	);
}

async function game() {
	if (gameStarted) return;
	gameStarted = true;
	initI18n();
	applyPresentationPrefs();
	applyShowcaseLaunchFlags();
	applyStaticI18n();
	onLocaleChange(() => applyStaticI18n());

	if (new URLSearchParams(location.search).get("previewCrash") === "1") {
		showError(
			new Error(
				"Preview — sample stack\n    at mountWheelGlb (cosmeticGlb.ts)\n    at async applyAllCarCosmetics",
			),
		);
		return;
	}

	bootMark("start");
	installErrorRing();
	installAutoPlayerReport();
	installMatchSessionWindowHooks();

	/**
	 * Cold boot: 3D wykop piłki (domyślnie).
	 * `?videoIntro=1` — SM FramePack mp4. `?skipIntro=1` — pomija.
	 */
	let bootCinematic: BootCinematicHandle | null = null;
	if (shouldPlayBootCinematic()) {
		bootIntro.enterCinematicMode();
		bootCinematic = beginIgniteBootCinematic(document.body);
		await bootCinematic.whenLogoReady;
		bootIntro.revealCinematicProgress();
	}

	try {
	setLoadingStatus("loading.status.physics");
	await RAPIER.init();
	if (!running) return;

	const container = document.getElementById("game-container");
	if (!container) throw new Error("Brak elementu #game-container");

	setLoadingStatus("loading.status.scene");
	const scene = new Scene();
	const renderer = new Renderer(container);
	applyRuntimeGraphics({ scene, renderer });

	const clipWiring: ClipWiring = wireGameplayClips({ renderer });

	resetCyberpunkSkybox();
	setLoadingStatus("loading.status.meshyArena");
	await primeCarCatalog();
	await primeItemCatalog();
	if (import.meta.env.DEV) {
		const { unlockGarageCosmeticsForDev } = await import("./meta/devGarageUnlock");
		unlockGarageCosmeticsForDev();
	}
	await primePaintCatalog();
	await primeArenaCatalog();
	initArenaRuntime(getEquippedArenaId());
	await preloadMeshyArenaAssets();
	preloadCarMeshes();
	preloadPowerUpPickupModels();
	await preloadMeshyBallModel();
	if (!running) return;

	setLoadingStatus("loading.status.sky");
	await preloadCyberpunkSkybox(scene.threeJSScene, renderer.threeJSRenderer);
	if (!running) return;

	setLoadingStatus("loading.status.arena");
	grassMaterial();
	buildArena(scene);
	if (!running) return;
	refreshAllGrassTextures(scene.threeJSScene);
	bindGrassRenderer(renderer.threeJSRenderer);

	setLoadingStatus("loading.status.models");
	const meshyBallUrl = getMeshyBallModelUrl();
	const ballMesh = await loadModel(
		meshyBallUrl ?? "/assets/models/rocketLeagueBall.glb",
	);
	enhanceBall(ballMesh, !!meshyBallUrl);
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
	const minimap = new MatchMinimap();
	const scoreboardOverlay = new MatchScoreboardOverlay();
	const ballVfx = new BallVfx(
		ball.threeJSGroup,
		scene.threeJSScene,
		ballRadius,
		!!meshyBallUrl,
	);
	ballVfx.warmup();
	const hitVfx = new HitVfx(scene.threeJSScene);
	hitVfx.warmup();
	const powerUpActivationVfx = new PowerUpActivationVfx(scene.threeJSScene);
	const ballWallMarkVfx = new BallWallMarkVfx(scene.threeJSScene, hitVfx);
	ballWallMarkVfx.warmup();

	const input = GameInput.createHuman(container);
	clipWiring.bindInputProvider(input);
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

	const crateCommentator = new MatchCommentator(audio);
	void crateCommentator.ensureLoaded();

	setLoadingStatus("loading.status.audio");
	await audio.preloadAssets();
	void audio.warmupAudio();

	const deps: RuntimeDeps = toRuntimeDeps(
		assembleGameSessionDeps({
			scene,
			renderer,
			ball,
			ballRadius,
			ballShadow,
			ballFloorIndicator,
			ballOffScreen,
			ballVfx,
			hitVfx,
			powerUpActivationVfx,
			ballWallMarkVfx,
			minimap,
			scoreboardOverlay,
			hud,
			audio,
			humanInput: input,
			physicsTelemetry,
		}),
		credits,
	);
	runtimeDeps = deps;
	settingsOverlay = new SettingsOverlay({
		onGraphicsChange: () => {
			if (runtimeDeps) applyRuntimeGraphics(runtimeDeps);
		},
	});
	bindMatchPauseControls(deps);
	bindRematchControl();

	loadoutOverlay = new LoadoutOverlay();
	loadoutOverlay.setOnGarageUiOpened(() => {
		liveMenu?.notifyGarageUiOpened();
	});
	loadoutOverlay.setOnPrepareShow(() => {
		mainMenu?.hide();
	});
	loadoutOverlay.setOnEnterGarageScene(() => {
		liveMenu?.setGarageMode(true);
	});
	loadoutOverlay.setOnClose(() => {
		liveMenu?.setGarageMode(false);
	});
	loadoutOverlay.setOnAfterHide(() => {
		mainMenu?.show();
		mainMenu?.refreshEquippedChip();
		const activeId = getEquippedCarId();
		setGarageCustomizeCarId(activeId);
		void liveMenu?.setPreviewCar(
			activeId,
			PlayerInventory.getEquippedPaintId("car"),
			getEquippedCarLoadout(activeId),
			true,
		);
		ArenaRuntime.setActive(getEquippedArenaId());
		void rebuildArenaForActive(scene, true).then(() => {
			refreshAllGrassTextures(scene.threeJSScene);
		});
	});
	loadoutOverlay.setOnChange(({ kind, id, equipped, paintId }) => {
		const previewLoadout = loadoutOverlay?.isVisible()
			? loadoutOverlay.getPreviewLoadout(id)
			: undefined;
		if (kind === "car") {
			/** Podgląd klikniętej / pit-focus karoserii; equip robi LoadoutOverlay. */
			setGarageCustomizeCarId(id);
			liveMenu?.triggerEquipSpin();
			void liveMenu?.setPreviewCar(
				id,
				paintId ?? PlayerInventory.getEquippedPaintId("car"),
				previewLoadout ?? getEquippedCarLoadout(id),
				true,
			);
			if (equipped) mainMenu?.refreshEquippedChip();
			console.info(
				`[Ignite] Karoseria podgląd: ${id} (equipped=${equipped})`,
			);
			return;
		}
		if (kind === "arena") {
			void rebuildArenaForActive(scene, true).then(() => {
				refreshAllGrassTextures(scene.threeJSScene);
			});
			if (equipped) mainMenu?.refreshEquippedChip();
			console.info(`[FlyBall] Arena: ${id}`);
			return;
		}
		void liveMenu?.reloadHeroCar(previewLoadout);
		if (equipped) mainMenu?.refreshEquippedChip();
	});

	postMatchDropOverlay = new PostMatchDropOverlay();
	coachHintsOverlay = new CoachHintsOverlay();
	crateRevealOverlay = new CrateRevealOverlay();
	rankedResultOverlay = new RankedResultOverlay();

	crateRevealOverlay.setCallbacks(
		(ref: CosmeticRef) => {
			void loadoutOverlay?.show(ref);
		},
		() => {},
		(rarity) => {
			audio.playCrateReveal(rarity);
		},
		(active) => {
			if (active) {
				crateBackdropOrbit = new CrateBackdropOrbit();
				crateBackdropWasMenuHidden = Boolean(
					mainMenu && !document.getElementById("main-menu")?.classList.contains("hidden"),
				);
				if (gameState === GameState.MENU_CINEMATIC) {
					mainMenu?.hide();
					liveMenu?.setCrateBackdropMode(true);
					setPresentationShell("menu");
				}
			} else {
				crateBackdropOrbit = null;
				liveMenu?.setCrateBackdropMode(false);
				if (
					crateBackdropWasMenuHidden &&
					gameState === GameState.MENU_CINEMATIC
				) {
					mainMenu?.show();
				}
				crateBackdropWasMenuHidden = false;
			}
		},
		(phase) => {
			if (phase === "drop") {
				audio.playCrateDropImpact();
				window.setTimeout(() => {
					void crateCommentator.trigger("crate_drop");
				}, 480);
			} else if (phase === "suspense") {
				audio.playCrateSuspenseRise(1.55);
			} else if (phase === "charge") {
				audio.playCrateCharge(0.62);
			} else if (phase === "hide") {
				audio.stopCrateTension();
			}
		},
	);
	setupCratePreviewHarness(crateRevealOverlay);

	postMatchDropOverlay.setCallbacks(
		() => {
			void loadoutOverlay?.show();
		},
		() => {},
	);

	setMatchEndListener((event) => {
		noteMatchEvent("match-finished");
		endMatchSession();
		autoReportAfterMatch({
			source: "match-end",
			mode: session?.mode ?? null,
			online: Boolean(session?.online),
			hadDrop: Boolean(event.drop),
			coachHints: event.coachHints.length,
		});
		if (event.ranked) {
			rankedResultOverlay?.show(
				event.ranked.before,
				event.ranked.after,
				event.ranked.delta,
			);
		}
		if (event.drop?.kind === "crate") {
			crateRevealOverlay?.showDrop(event.drop);
		}
		if (event.coachHints.length > 0) {
			coachHintsOverlay?.show(event.coachHints);
		}
	});

	mainMenu = new MainMenu(
		(mode) => {
			if (isDemoBuild() && !demoAllowsMode(mode)) {
				console.warn(`[demo] mode ${mode} blocked — using 1v1`);
				mode = "1v1";
			}
			const launch = () => {
				gameState = GameState.PLAYING;
				setPresentationShell("match");
				stopMenuLoop();
				void startMatch(mode, deps);
			};
			if (!tutorialOverlay) tutorialOverlay = new TutorialOverlay();
			tutorialOverlay.maybeStart(launch);
		},
		credits,
		() => {
			mainMenu?.hide();
			mpLobby?.show(mainMenu?.getSelectedMode());
		},
		audio,
		settingsOverlay,
		() => {
			void loadoutOverlay?.show();
		},
	);
	mainMenu.show();
	if (isDemoBuild()) {
		console.info("[Ignite] DEMO build — limited playlist / 10 min match cap");
	}

	mpLobby = new MultiplayerLobby(
		(result) => {
			activeOnline = result;
			mpLobby?.hide();
			void enterPreMatchThenOnline(result, deps);
		},
		() => {
			mpLobby?.hide();
			setPresentationShell("menu");
			mainMenu?.show();
		},
	);

	socialOverlay = new SocialOverlay({
		getRoomCode: () => mpLobby?.getRoomCode() ?? null,
		getLobbyState: () => mpLobby?.getLobbyState() ?? null,
		ensureHostRoom: async () => {
			mainMenu?.hide();
			return (await mpLobby?.ensureHostRoom()) ?? null;
		},
		joinInviteRoom: async (roomCode) => {
			mainMenu?.hide();
			await mpLobby?.joinInviteRoom(roomCode);
		},
		subscribe: (cb) => mpLobby?.subscribeLobby(cb) ?? (() => {}),
	});

	registerUiNavigation();

	window.addEventListener("keydown", (e) => {
		if (e.repeat) return;
		if (e.code === "Escape") {
			handleMatchEscape();
			return;
		}
		if (e.code === "KeyR") {
			/**
			 * Deszcz: R w menu · Shift+R w meczu (sam R = power-up Ignition).
			 * Rematch tylko na sam R po końcu meczu (online host).
			 */
			const inMatch = document.body.classList.contains("in-match");
			if (!inMatch || e.shiftKey) {
				e.preventDefault();
				const on = runtimeDeps?.scene.weather.toggleRain() ?? false;
				console.info(`[Ignite] Rain: ${on ? "ON" : "OFF"}`);
				return;
			}
			tryRequestRematch();
			return;
		}
		if (e.code === "KeyM") {
			/** W meczu M = minimapa (GameInput). Mute tylko w menu/garażu. */
			if (document.body.classList.contains("in-match")) return;
			const muted = audio.toggleMasterMute();
			showAudioMuteToast(muted);
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
	gameState = GameState.MENU_CINEMATIC;
	setPresentationShell("menu");
	startMenuLoop(renderer);

	/** Zawsze w DEV — audyt kamery / Playwright / Electron CDP. */
	if (import.meta.env.DEV) {
		const { getDevFreeCamera } = await import("./debug/DevFreeCamera");
		(window as unknown as { __igniteFreeCam?: ReturnType<typeof getDevFreeCamera> }).__igniteFreeCam =
			getDevFreeCamera();
		const { getAerialSmokePack } = await import("./debug/AerialSmokePack");
		const aerialSmoke = getAerialSmokePack();
		aerialSmoke.attach();
		(
			window as unknown as {
				__igniteAerialSmoke?: ReturnType<typeof getAerialSmokePack>;
			}
		).__igniteAerialSmoke = aerialSmoke;
		(
			window as unknown as {
				__igniteLiveMenu?: LiveMainMenuScene;
			}
		).__igniteLiveMenu = liveMenu;
		(
			window as unknown as {
				__igniteRenderer?: Renderer;
				__igniteScene?: Scene;
				__igniteCameraAudit?: () => Record<string, unknown>;
			}
		).__igniteRenderer = renderer;
		(window as unknown as { __THREE?: typeof THREE }).__THREE = THREE;
		(window as unknown as { __igniteScene?: Scene }).__igniteScene = scene;
		(
			window as unknown as {
				__igniteCameraAudit?: () => Record<string, unknown>;
				__igniteCameraTeleport?: (opts: {
					x: number;
					y?: number;
					z: number;
					yaw?: number;
					ballCam?: boolean;
				}) => Record<string, unknown> | null;
			}
		).__igniteCameraAudit = () => {
			const sess = (
				window as unknown as { __igniteSession?: GameSession }
			).__igniteSession;
			const cam = renderer.threeJSCamera;
			const car = sess?.humanCar?.player?.getPosition?.();
			if (!sess || !car) {
				return {
					ok: false,
					reason: "no-session",
					cam: {
						x: cam.position.x,
						y: cam.position.y,
						z: cam.position.z,
						fov: cam.fov,
					},
					body: document.body.className,
				};
			}
			const dist = cam.position.distanceTo(car);
			cam.updateMatrixWorld(true);
			cam.updateProjectionMatrix();
			const ndc = car.clone().project(cam);
			const lookDir = new THREE.Vector3();
			cam.getWorldDirection(lookDir);
			const tags = [...document.querySelectorAll(".car-name-tag")].map(
				(el) => {
					const r = el.getBoundingClientRect();
					return {
						text: (el.textContent || "").trim(),
						nx: (r.x + r.width / 2) / window.innerWidth,
						ny: (r.y + r.height / 2) / window.innerHeight,
					};
				},
			);
			const you = tags.find((t) => /you|ty/i.test(t.text));
			const carScreen = {
				nx: (ndc.x + 1) * 0.5,
				ny: (1 - ndc.y) * 0.5,
			};
			const tagErr = you
				? Math.hypot(you.nx - carScreen.nx, you.ny - carScreen.ny)
				: null;
			/** Poziomy błąd — pion jest OK (plakietka nad dachem). */
			const tagErrX = you ? Math.abs(you.nx - carScreen.nx) : null;
			const pass =
				dist <= 10 &&
				Math.abs(ndc.x) <= 0.4 &&
				ndc.y >= -0.85 &&
				ndc.y <= 0.15 &&
				cam.position.y < car.y + 8;
			return {
				ok: pass,
				pass,
				dist,
				ndc: { x: ndc.x, y: ndc.y, z: ndc.z },
				carScreen,
				tagErr,
				tagErrX,
				tags,
				cam: {
					x: cam.position.x,
					y: cam.position.y,
					z: cam.position.z,
					fov: cam.fov,
					aspect: cam.aspect,
				},
				car: { x: car.x, y: car.y, z: car.z },
				lookDir: { x: lookDir.x, y: lookDir.y, z: lookDir.z },
				ballCam: renderer.isBallCamEnabled(),
				menuPresentation: (
					renderer as unknown as { menuPresentationActive?: boolean }
				).menuPresentationActive,
				garagePresentation: (
					renderer as unknown as { garagePresentationActive?: boolean }
				).garagePresentationActive,
				phase: sess.match?.getPhase?.() ?? null,
				body: document.body.className,
				inner: {
					w: window.innerWidth,
					h: window.innerHeight,
					dpr: window.devicePixelRatio,
				},
				canvases: (() => {
					const src = document.querySelector(
						"canvas.webgl-source-canvas",
					) as HTMLCanvasElement | null;
					const present = document.querySelector(
						"canvas.webgl-present-canvas",
					) as HTMLCanvasElement | null;
					const info = (c: HTMLCanvasElement | null) => {
						if (!c) return null;
						const cs = getComputedStyle(c);
						return {
							display: cs.display,
							visibility: cs.visibility,
							w: c.width,
							h: c.height,
							cssW: cs.width,
							cssH: cs.height,
						};
					};
					return { source: info(src), present: info(present) };
				})(),
			};
		};

		(
			window as unknown as {
				__igniteCameraTeleport?: (opts: {
					x: number;
					y?: number;
					z: number;
					yaw?: number;
					ballCam?: boolean;
				}) => Record<string, unknown> | null;
			}
		).__igniteCameraTeleport = (opts) => {
			const sess = (
				window as unknown as { __igniteSession?: GameSession }
			).__igniteSession;
			if (!sess?.humanCar?.player) return null;
			const y = opts.y ?? 0.45;
			const yaw = opts.yaw ?? 0;
			/** Piłka przed autem, clamp w polu — nie w bramce / nie na aucie. */
			const ahead = 22;
			const ballPos = new THREE.Vector3(
				THREE.MathUtils.clamp(opts.x + Math.sin(yaw) * ahead, -50, 50),
				1.2,
				THREE.MathUtils.clamp(opts.z + Math.cos(yaw) * ahead, -70, 70),
			);
			if (typeof opts.ballCam === "boolean") {
				renderer.setBallCamEnabled(opts.ballCam);
			}
			const deps = (
				window as unknown as {
					__igniteMatchDeps?: import("./game/GameSession").GameSessionDeps;
				}
			).__igniteMatchDeps;
			if (deps && typeof sess.forceChaseForAudit === "function") {
				sess.forceChaseForAudit(deps, opts.x, y, opts.z, yaw, ballPos);
			} else {
				sess.humanCar.player.resetKickoffPose(opts.x, y, opts.z, yaw);
				renderer.endGoalOrbit();
				renderer.snapChaseCamera(sess.humanCar.player, ballPos);
			}
			return (
				window as unknown as {
					__igniteCameraAudit?: () => Record<string, unknown>;
				}
			).__igniteCameraAudit?.() ?? null;
		};

		(
			window as unknown as {
				__igniteForceGoalShot?: (team?: "blue" | "orange") => boolean;
				__igniteReplayAudit?: () => Record<string, unknown> | null;
			}
		).__igniteForceGoalShot = (team = "blue") => {
			const ball = (
				window as unknown as {
					__igniteBall?: {
						rapierRigidBody: {
							setTranslation: (
								t: { x: number; y: number; z: number },
								w: boolean,
							) => void;
							setLinvel: (
								t: { x: number; y: number; z: number },
								w: boolean,
							) => void;
							setAngvel: (
								t: { x: number; y: number; z: number },
								w: boolean,
							) => void;
						};
					};
				}
			).__igniteBall;
			const sess = (
				window as unknown as { __igniteSession?: GameSession }
			).__igniteSession;
			if (!ball?.rapierRigidBody || !sess) return false;
			/** HALF_LENGTH ≈ 60 (arena 120) — czytaj z runtime jeśli dostępne. */
			const half =
				(
					window as unknown as {
						__igniteArenaHalfLength?: number;
					}
				).__igniteArenaHalfLength ?? 60;
			const toward = team === "blue" ? 1 : -1;
			const zLine = toward * half;
			ball.rapierRigidBody.setTranslation(
				{ x: 0, y: 1.15, z: zLine - toward * 6 },
				true,
			);
			ball.rapierRigidBody.setLinvel(
				{ x: 0, y: 2, z: toward * 32 },
				true,
			);
			ball.rapierRigidBody.setAngvel({ x: 2, y: 0, z: 0 }, true);
			return true;
		};

		(
			window as unknown as {
				__igniteReplayAudit?: () => Record<string, unknown> | null;
			}
		).__igniteReplayAudit = () => {
			const sess = (
				window as unknown as { __igniteSession?: GameSession }
			).__igniteSession;
			const ball = (
				window as unknown as {
					__igniteBall?: {
						getPosition: () => THREE.Vector3;
						rapierRigidBody: { linvel: () => { x: number; y: number; z: number } };
					};
				}
			).__igniteBall;
			if (!sess || !ball) return null;
			const pos = ball.getPosition();
			const vel = ball.rapierRigidBody.linvel();
			const cam = renderer.threeJSCamera.position;
			const phase = sess.match?.getPhase?.() ?? null;
			return {
				phase,
				replayActive: !!sess.match?.isReplayActive?.(),
				ball: { x: pos.x, y: pos.y, z: pos.z },
				vel: { x: vel.x, y: vel.y, z: vel.z },
				speed: Math.hypot(vel.x, vel.y, vel.z),
				cam: { x: cam.x, y: cam.y, z: cam.z },
				body: document.body.className,
			};
		};
	}

	if (new URLSearchParams(location.search).get("showcaseAudit") === "1") {
		/* __igniteRenderer już ustawione w DEV powyżej */
	}

	void BotLearning.get()
		.init()
		.then(() => {
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

	bootIntro.setProgress(1);
	if (bootCinematic) {
		await bootCinematic.finish();
		bootCinematic = null;
	}
	await hideLoading();
	bootMark("menu ready");

	const auditParams = new URLSearchParams(location.search);
	if (auditParams.get("garageAudit") === "1") {
		await setupGarageCarAudit(auditParams);
	}
	if (auditParams.get("cratePreview") === "1" && crateRevealOverlay) {
		runCratePreview(crateRevealOverlay, auditParams);
	}

	ensureBootCover();
	if (!(window as unknown as { __igniteDesktop?: unknown }).__igniteDesktop) {
		console.info(
			"[Ignite] Pełny ekran (aplikacja): nix develop -c npm run dev:desktop",
		);
	}

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
	} finally {
		bootCinematic?.skip();
		bootCinematic = null;
	}
}

async function startMatch(mode: GameModeId, deps: RuntimeDeps): Promise<void> {
	if (matchStarting) return;
	matchStarting = true;
	showLoading("match");
	setPresentationShell("match");
	matchMark(`start ${mode}`);
	matchPaused = false;
	pauseClosing = false;
	hideMatchPause(true);
	hideMetaOverlays();
	if (!(window as unknown as { __igniteDesktop?: unknown }).__igniteDesktop) {
		requestGameFullscreen();
	}

	liveMenu?.dispose();
	liveMenu = null;
	/** Upewnij się, że pętla menu / showcase nie trzyma kamery. */
	stopMenuLoop();
	stopMatchLoop();
	deps.renderer.setNameTagsArmed(false);
	deps.renderer.setMenuBloomPresentation(false);
	deps.renderer.setGaragePresentation(false);
	deps.renderer.enforceMatchPresentationStack();
	deps.scene.purgeMenuDecorations();
	/** Mecz: optyka z recepty (snopy/flary/bloom). */
	deps.renderer.optics.bindLighting(deps.scene.lighting);
	deps.renderer.optics.setMode("match", resolveGraphicsSettings().quality);
	deps.renderer.optics.apply(deps.renderer.threeJSRenderer);
	/** Po menu (DPR=1) — pełny resize composera, inaczej czarne pasy / zły kadr. */
	deps.renderer.ensureViewportSync();
	matchMark(
		`resize after menu ${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`,
		"render",
	);

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
	/** Trzymaj 5…1 aż warmup/snap skończą — inaczej freeze „przed odliczaniem”. */
	session.match.setCountdownHold(true);
	matchMark("session ready");
	beginMatchSession({
		mode,
		online: false,
		role: null,
		roomCode: null,
		ranked: false,
	});

	const humanRot = session.humanCar.player.rapierRigidBody.rotation();
	const spawnQuat = new THREE.Quaternion(
		humanRot.x,
		humanRot.y,
		humanRot.z,
		humanRot.w,
	);
	deps.renderer.resetChaseCamera(spawnQuat);
	/** Od razu chase — nie trzymaj pozycji orbity menu przez loading/warmup. */
	deps.renderer.snapChaseCamera(
		session.humanCar.player,
		deps.ball.getPosition(),
		{ kickoff: true },
	);

	deps.audio.warmupSpatialImpacts();
	deps.audio.beginMatchMusic();
	deps.renderer.render(deps.scene);

	deps.ball.threeJSGroup.visible = true;
	deps.ballShadow.mesh.visible = true;
	deps.ballFloorIndicator.root.visible = true;
	deps.ballOffScreen.hide();

	setLoadingStatus("loading.status.vfxShaders");
	await Promise.race([
		warmupGameplayGpu(deps.renderer, deps.scene, {
			ball: deps.ball,
			ballVfx: deps.ballVfx,
			hitVfx: deps.hitVfx,
			ballShadow: deps.ballShadow,
			ballWallMarkVfx: deps.ballWallMarkVfx,
		}),
		/** SwiftShader / słabe GPU — nie blokuj kickoffu w nieskończoność. */
		new Promise<void>((resolve) => setTimeout(resolve, 1800)),
	]);
	await hideLoading();

	/** Bez intro menu→chase — lerp zostawiał kadr w orbicie menu (~30 m). */
	deps.renderer.snapChaseCamera(
		session.humanCar.player,
		deps.ball.getPosition(),
		{ kickoff: true },
	);
	deps.renderer.killMenuOrbitIfPresent(
		session.humanCar.player,
		deps.ball.getPosition(),
	);
	deps.renderer.resyncPresentAfterCameraSnap(deps.scene);
	session.match.setCountdownHold(false);
	session.resetKickoffAudioSync();

	/** Ciężkie VFX padów — po starcie countdown, nie w loadingu GRAJ. */
	requestAnimationFrame(() => {
		session?.primeArenaVisuals(deps);
	});
	(window as unknown as { __igniteSession?: GameSession }).__igniteSession =
		session;
	(window as unknown as { __igniteBall?: typeof deps.ball }).__igniteBall =
		deps.ball;
	(window as unknown as { __igniteMatchDeps?: typeof deps }).__igniteMatchDeps =
		deps;
	(window as unknown as { __igniteArenaHalfLength?: number }).__igniteArenaHalfLength =
		RL_ARENA.HALF_LENGTH;

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
		/**
		 * Menu ma własne setAnimationLoop — nie renderuj tu po returnToMainMenu,
		 * inaczej dwa loopy walczą o GPU (freeze po „Menu” → GRAJ).
		 */
		if (gameState !== GameState.PLAYING || !session) {
			activeRaf = 0;
			return;
		}
		activeRaf = requestAnimationFrame(gameLoop);
		const dt = Math.min(clock.getDelta(), 0.1);
		const nowSec = clock.elapsedTime;
		noteFrameTime(performance.now());
		noteMatchFrame();
		try {
			const hud = session.match.getHudSnapshot(session.cars);
			noteMatchHud({
				phase: hud.phase,
				blueScore: hud.blueScore,
				orangeScore: hud.orangeScore,
				timeRemainingSec: hud.timeRemainingSec,
			});
		} catch {
			/* ignore */
		}

		if (!session.online || session.online.role === "host") {
			session.match.advanceCountdown(dt);
		}

		if (shouldRunGameplayTick(session)) {
			deps.physicsTelemetry?.noteSteeringInput(deps.humanInput.yaw(), dt);
			try {
				session.tick(deps, dt, nowSec);
			} catch (err) {
				console.error("Ignite tick error:", err);
			}
		}

		/** Bezpiecznik: kamera daleko od auta → snap.
		 * NIE podczas gola / powtórki / orbity — inaczej cinematic leci w chase.
		 * NIE podczas DEV free-cam (Ctrl+Shift+C). */
		const human = session.humanCar?.player;
		const phase = session.match?.getPhase?.() ?? "";
		const cinematicCam =
			phase === "goal_bounce" ||
			phase === "goal_replay" ||
			phase === "goal_pause" ||
			!!session.match?.isReplayActive?.();
		const freeCamOn =
			!(
				globalThis as unknown as { __igniteCaptureCamLock?: boolean }
			).__igniteCaptureCamLock && getDevFreeCamera().isActive();
		if (human?.rapierRigidBody && !cinematicCam && !freeCamOn) {
			const carPos = human.getPosition();
			const cam = deps.renderer.threeJSCamera;
			const distSq = cam.position.distanceToSquared(carPos);
			const heightAbove = cam.position.y - carPos.y;
			const inCountdown = session.match.getPhase() === "countdown";
			/** Menu orbit leftover: y≈11 / r≈38 — łap też po wysokości. */
			if (
				Number.isFinite(carPos.x) &&
				(distSq > 14 * 14 ||
					heightAbove > 5.2 ||
					(inCountdown && distSq > 10 * 10))
			) {
				deps.renderer.snapChaseCamera(
					human,
					deps.ball.getPosition(),
					inCountdown
						? {
								kickoff: true,
								matchBlend: 0,
							}
						: undefined,
				);
				if (inCountdown) {
					deps.renderer.killMenuOrbitIfPresent(
						human,
						deps.ball.getPosition(),
					);
				}
			}
		}

		/** Orbita dropu TYLKO poza aktywnym meczem — inaczej nadpisuje chase. */
		const matchPhase = session.match.getPhase?.();
		const allowCrateCam =
			matchPhase === "finished" || matchPhase === undefined;
		if (
			allowCrateCam &&
			crateRevealOverlay?.isVisible() &&
			crateBackdropOrbit
		) {
			crateBackdropOrbit.update(deps.renderer.threeJSCamera, dt);
		}

		try {
			deps.renderer.render(deps.scene, dt);
		} catch (err) {
			console.error("Ignite render error:", err);
			showError(err);
			running = false;
			stopMatchLoop();
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
		onPeerLeft: (reason) => {
			if (gameState === GameState.PLAYING && session) {
				const hostDrop =
					reason?.toLowerCase().includes("host") === true;
				showOnlineDisconnectToast(
					t(hostDrop ? "mp.status.hostLeftMatch" : "mp.status.peerLeftMatch"),
				);
				void returnToMainMenu(deps);
			}
		},
		onDisconnect: () => {
			if (gameState === GameState.PLAYING && session) {
				showOnlineDisconnectToast(t("mp.status.hostLeftMatch"));
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

	document.getElementById("match-end-banner")?.classList.remove("show");
	document.getElementById("match-end-sub")?.classList.remove("show");
	document.getElementById("match-rematch")?.classList.remove("show");
	document.getElementById("match-rematch")?.classList.add("hidden");
	document.getElementById("match-rematch-wait")?.classList.remove("show");
	document.getElementById("match-rematch-wait")?.classList.add("hidden");

	deps.humanInput.releaseAll();
	deps.audio.endMatchMusic(true);
	stopMatchLoop();

	if (session) {
		session.destroy(deps);
		session = null;
	}

	try {
		session = await GameSession.createOnline(deps, {
			role: activeOnline.role,
			localSlot: activeOnline.localSlot,
			mode: activeOnline.mode,
			roomClient: activeOnline.roomClient,
			remoteInputs: activeOnline.remoteInputs,
			ranked: effectiveRanked(activeOnline.roomClient.ranked),
			humanSlots: activeOnline.roomClient.humanSlots(),
		});
	} catch (err) {
		showError(err);
		matchStarting = false;
		return;
	}

	wireOnlineRoomCallbacks(deps);

	if (activeOnline.role === "host") {
		session.match.setCountdownHold(false);
		session.resetKickoffAudioSync();
	}

	deps.renderer.snapChaseCamera(
		session.humanCar.player,
		deps.ball.getPosition(),
		{ kickoff: true },
	);
	deps.renderer.killMenuOrbitIfPresent(
		session.humanCar.player,
		deps.ball.getPosition(),
	);
	deps.renderer.resyncPresentAfterCameraSnap(deps.scene);

	(window as unknown as { __igniteSession?: GameSession }).__igniteSession =
		session;
	(window as unknown as { __igniteBall?: typeof deps.ball }).__igniteBall =
		deps.ball;
	(window as unknown as { __igniteMatchDeps?: typeof deps }).__igniteMatchDeps =
		deps;
	(window as unknown as { __igniteArenaHalfLength?: number }).__igniteArenaHalfLength =
		RL_ARENA.HALF_LENGTH;

	deps.audio.beginMatchMusic();
	matchStarting = false;
	matchMark("online rematch");
}

async function enterPreMatchThenOnline(
	result: OnlineLobbyResult,
	deps: RuntimeDeps,
): Promise<void> {
	gameState = GameState.MENU_CINEMATIC;
	setPresentationShell("menu");
	preMatchLobby?.dispose(deps);
	preMatchLobby = new PreMatchLobbyScene();
	await preMatchLobby.run(result, deps, () => {
		gameState = GameState.PLAYING;
		setPresentationShell("match");
		stopMenuLoop();
		void startOnlineMatch(result, deps);
	});
}

async function startOnlineMatch(
	result: OnlineLobbyResult,
	deps: RuntimeDeps,
): Promise<void> {
	if (matchStarting) return;
	matchStarting = true;
	showLoading("match");
	setPresentationShell("match");
	matchMark("start online 1v1");
	matchPaused = false;
	pauseClosing = false;
	hideMatchPause(true);
	if (!(window as unknown as { __igniteDesktop?: unknown }).__igniteDesktop) {
		requestGameFullscreen();
	}

	liveMenu?.dispose();
	liveMenu = null;
	/** Upewnij się, że pętla menu / showcase nie trzyma kamery. */
	stopMenuLoop();
	stopMatchLoop();
	deps.renderer.setNameTagsArmed(false);
	deps.renderer.setMenuBloomPresentation(false);
	deps.renderer.setGaragePresentation(false);
	deps.renderer.enforceMatchPresentationStack();
	deps.scene.purgeMenuDecorations();
	/** Online: ta sama recepta optyki co lokalny mecz. */
	deps.renderer.optics.bindLighting(deps.scene.lighting);
	deps.renderer.optics.setMode("match", resolveGraphicsSettings().quality);
	deps.renderer.optics.apply(deps.renderer.threeJSRenderer);
	/** Po menu (DPR=1) — pełny resize composera, inaczej czarne pasy / zły kadr. */
	deps.renderer.ensureViewportSync();
	matchMark(
		`resize after menu (online) ${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`,
		"render",
	);

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
			mode: result.mode,
			roomClient: result.roomClient,
			remoteInputs: result.remoteInputs,
			ranked: effectiveRanked(result.ranked),
			humanSlots: result.roomClient.humanSlots(),
		});
	} catch (err) {
		showError(err);
		running = false;
		matchStarting = false;
		return;
	}
	if (result.role === "host") {
		session.match.setCountdownHold(true);
	}

	wireOnlineRoomCallbacks(deps);
	beginMatchSession({
		mode: result.mode,
		online: true,
		role: result.role,
		roomCode: result.roomCode,
		ranked: effectiveRanked(result.ranked),
	});
	matchMark("session ready online");

	const humanRot = session.humanCar.player.rapierRigidBody.rotation();
	const spawnQuat = new THREE.Quaternion(
		humanRot.x,
		humanRot.y,
		humanRot.z,
		humanRot.w,
	);
	deps.renderer.resetChaseCamera(spawnQuat);
	/** Od razu chase — nie trzymaj pozycji orbity menu przez loading/warmup. */
	deps.renderer.snapChaseCamera(
		session.humanCar.player,
		deps.ball.getPosition(),
		{ kickoff: true },
	);

	deps.audio.warmupSpatialImpacts();
	deps.audio.beginMatchMusic();
	deps.renderer.render(deps.scene);

	deps.ball.threeJSGroup.visible = true;
	deps.ballShadow.mesh.visible = true;
	deps.ballFloorIndicator.root.visible = true;
	deps.ballOffScreen.hide();

	setLoadingStatus("loading.status.vfxShaders");
	await Promise.race([
		warmupGameplayGpu(deps.renderer, deps.scene, {
			ball: deps.ball,
			ballVfx: deps.ballVfx,
			hitVfx: deps.hitVfx,
			ballShadow: deps.ballShadow,
			ballWallMarkVfx: deps.ballWallMarkVfx,
		}),
		new Promise<void>((resolve) => setTimeout(resolve, 1800)),
	]);
	await hideLoading();

	deps.renderer.snapChaseCamera(
		session.humanCar.player,
		deps.ball.getPosition(),
		{ kickoff: true },
	);
	deps.renderer.killMenuOrbitIfPresent(
		session.humanCar.player,
		deps.ball.getPosition(),
	);
	deps.renderer.resyncPresentAfterCameraSnap(deps.scene);
	session.match.setCountdownHold(false);
	session.resetKickoffAudioSync();
	requestAnimationFrame(() => {
		session?.primeArenaVisuals(deps);
	});
	if (result.role === "host") {
		session.match.setCountdownHold(false);
		session.resetKickoffAudioSync();
	}

	(window as unknown as { __igniteSession?: GameSession }).__igniteSession =
		session;
	(window as unknown as { __igniteBall?: typeof deps.ball }).__igniteBall =
		deps.ball;
	(window as unknown as { __igniteMatchDeps?: typeof deps }).__igniteMatchDeps =
		deps;
	(window as unknown as { __igniteArenaHalfLength?: number }).__igniteArenaHalfLength =
		RL_ARENA.HALF_LENGTH;
	deps.renderer.focusCanvas();

	const clock = new THREE.Clock();

	function gameLoop(): void {
		if (!running) return;
		if (gameState !== GameState.PLAYING || !session) {
			activeRaf = 0;
			return;
		}
		activeRaf = requestAnimationFrame(gameLoop);
		const dt = Math.min(clock.getDelta(), 0.1);
		const nowSec = clock.elapsedTime;
		noteFrameTime(performance.now());
		noteMatchFrame();
		try {
			const hud = session.match.getHudSnapshot(session.cars);
			noteMatchHud({
				phase: hud.phase,
				blueScore: hud.blueScore,
				orangeScore: hud.orangeScore,
				timeRemainingSec: hud.timeRemainingSec,
			});
		} catch {
			/* ignore */
		}

		if (!session.online || session.online.role === "host") {
			session.match.advanceCountdown(dt);
		}

		if (shouldRunGameplayTick(session)) {
			deps.physicsTelemetry?.noteSteeringInput(deps.humanInput.yaw(), dt);
			try {
				session.tick(deps, dt, nowSec);
			} catch (err) {
				console.error("Ignite tick error:", err);
			}
		}

		/** Bezpiecznik: kamera daleko od auta → snap.
		 * NIE podczas gola / powtórki / orbity — inaczej cinematic leci w chase.
		 * NIE podczas DEV free-cam (Ctrl+Shift+C). */
		const human = session.humanCar?.player;
		const phase = session.match?.getPhase?.() ?? "";
		const cinematicCam =
			phase === "goal_bounce" ||
			phase === "goal_replay" ||
			phase === "goal_pause" ||
			!!session.match?.isReplayActive?.();
		const freeCamOn =
			!(
				globalThis as unknown as { __igniteCaptureCamLock?: boolean }
			).__igniteCaptureCamLock && getDevFreeCamera().isActive();
		if (human?.rapierRigidBody && !cinematicCam && !freeCamOn) {
			const carPos = human.getPosition();
			const cam = deps.renderer.threeJSCamera;
			const distSq = cam.position.distanceToSquared(carPos);
			const heightAbove = cam.position.y - carPos.y;
			const inCountdown = session.match.getPhase() === "countdown";
			/** Menu orbit leftover: y≈11 / r≈38 — łap też po wysokości. */
			if (
				Number.isFinite(carPos.x) &&
				(distSq > 14 * 14 ||
					heightAbove > 5.2 ||
					(inCountdown && distSq > 10 * 10))
			) {
				deps.renderer.snapChaseCamera(
					human,
					deps.ball.getPosition(),
					inCountdown
						? {
								kickoff: true,
								matchBlend: 0,
							}
						: undefined,
				);
				if (inCountdown) {
					deps.renderer.killMenuOrbitIfPresent(
						human,
						deps.ball.getPosition(),
					);
				}
			}
		}

		/** Orbita dropu TYLKO poza aktywnym meczem — inaczej nadpisuje chase. */
		const matchPhase = session.match.getPhase?.();
		const allowCrateCam =
			matchPhase === "finished" || matchPhase === undefined;
		if (
			allowCrateCam &&
			crateRevealOverlay?.isVisible() &&
			crateBackdropOrbit
		) {
			crateBackdropOrbit.update(deps.renderer.threeJSCamera, dt);
		}

		try {
			deps.renderer.render(deps.scene, dt);
		} catch (err) {
			console.error("Ignite render error:", err);
			showError(err);
			running = false;
			stopMatchLoop();
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
		stopMatchLoop();
		stopMenuLoop();
		liveMenu?.dispose();
		liveMenu = null;
		const el = document.getElementById("game-container");
		if (el) el.innerHTML = "";
	});
}
