import * as THREE from "three";
import { AIManager } from "../ai/AIManager";
import { ballThreatensOwnGoal } from "../ai/botTactics";
import { BotLearning } from "../ai/learning/BotLearning";
import { ArenaRuntime } from "../arena/ArenaRuntime";
import { BoostPadManager } from "../arena/BoostPadManager";
import type { GameAudio } from "../audio/GameAudio";
import { MatchBanterTracker } from "../audio/MatchBanterTracker";
import { MatchCommentator } from "../audio/MatchCommentator";
import { HOVER_SAFE_MODE } from "../debug/config";
import type { PhysicsTelemetry } from "../diagnostic/physicsTelemetry";
import type GameObject from "../GameObject";
import type { GameModeId, ScoringTeam } from "../game/modes";
import { getModePolicy } from "../game/modePolicy";
import { getModeSpec, MATCH_RULES, modeHasPowerUps } from "../game/modes";
import { IgnitionRushController } from "../modes/IgnitionRushController";
import { IgnitionZonesController } from "../modes/IgnitionZones";
import {
	MeridianController,
	halfForBallZ,
	type MeridianLivePossession,
} from "../modes/MeridianController";
import {
	applyMutatorBallVisual,
	clearMutatorBallVisual,
	getWeeklyMutator,
	resolveMutatorTickEffects,
	type WeeklyMutatorDef,
} from "../modes/MutatorRegistry";
import { TeamOvercharge } from "../modes/TeamOvercharge";
import { t } from "../i18n";
import {
	loadMatchCarTemplates,
	maxCarHalfHeight,
} from "../meta/loadTeamCarTemplates";
import {
	applyShockwaveDemoImpulse,
	getTraitsForCar,
} from "../meta/carBodyTraits";
import { processMatchEnd, queueRankedResult } from "../meta/MatchEndMeta";
import { MatchCoachTracker } from "../meta/MatchCoachTracker";
import { getBaseEnvironmentIntensity } from "../visual/skybox";
import { resolveGraphicsSettings } from "../util/graphicsProfile";
import type { PowerUpHudState } from "../modes/IgnitionManager";
import { IgnitionManager } from "../modes/IgnitionManager";
import { MatchController, type MatchPhase } from "../modes/MatchController";
import { guestPredictionActive } from "../net/GuestCarPredictor";
import { GuestReconcilePool } from "../net/guestReconcile";
import type { NetworkControlInputPool } from "../net/NetworkControlInputPool";
import type { OnlineRole } from "../net/protocol";
import { SNAPSHOT_RATE_HZ } from "../net/protocol";
import type { RoomClient } from "../net/RoomClient";
import { effectiveRanked, RANKED_UI_ENABLED } from "../net/rankedFeature";
import { StateInterpolator } from "../net/StateInterpolator";
import {
	applyWorldSnapshot,
	buildWorldSnapshot,
	snapshotBallPosition,
	snapshotBallVelocity,
} from "../net/snapshotCodec";
import type Renderer from "../Renderer";
import type Scene from "../Scene";
import type { BallOffScreenIndicator } from "../ui/BallOffScreenIndicator";
import type { MatchMinimap, MinimapEntity } from "../ui/MatchMinimap";
import type { MatchScoreboardOverlay } from "../ui/MatchScoreboardOverlay";
import { type QuickChatId, QuickChatOverlay } from "../ui/QuickChatOverlay";
import type { RlHud, RlHudState } from "../ui/RlHud";
import type { ControlInput } from "../util/ControlInput";
import type GameInput from "../util/GameInput";
import Player from "../util/Player";
import { getCinematicCameraMode } from "../util/presentationPrefs";
import {
	getEquippedGoalExplosionId,
	getEquippedPaintId,
} from "../meta/PlayerInventory";
import {
	applyCarBallHitsAll,
	applyCarCarHitsAll,
	setMatchBallSpeedMul,
	snapshotBallKinematics,
	stabilizePlayerPhysics,
	updateBallPhysics,
} from "../util/rlContacts";
import { getStadiumLeds, updateCyberpunkAmbience } from "../visual/arena";
import { pulseArenaBallFocus } from "../visual/arenaBallFocus";
import type { BallShadow } from "../visual/ballShadow";
import type { BallFloorIndicator } from "../visual/ballTracking/BallFloorIndicator";
import { mountCarNeonUnderglow } from "../visual/carNeonUnderglow";
import {
	CarVisuals,
	cloneCarMesh,
	disposeCarMeshGroup,
} from "../visual/carVisuals";
import { resolveCarIdFromVisual } from "../visual/wheelMount";
import { triggerCrowdSurge } from "../visual/crowdSurge";
import {
	applyDemolishOverlay,
	DEMOLISH_IMPACT_MIN,
	DemolishHighlight,
} from "../visual/demolishHighlight";
import {
	applyEpicSaveOverlay,
	ballVelTowardOwnGoal,
	EpicSaveHighlight,
	evaluateEpicSave,
	evaluateTeamSave,
	ownGoalForTeam,
} from "../visual/epicSaveHighlight";
import { triggerGoalNetRipple } from "../visual/goalNetMaterial";
import { MatchDirector } from "../visual/matchDirector/MatchDirector";
import {
	applyGoalSpectacleOverlay,
	clearGoalSpectacleOverlay,
	emptyGoalPresentation,
	GoalSpectacle,
} from "../visual/goalSpectacle";
import { MatchAtmosphereEngine } from "../visual/matchAtmosphereEngine";
import { MatchMomentsController } from "../visual/matchMoments/MatchMomentsController";
import { applyMatchMomentOverlay } from "../visual/matchMoments/matchMoments";
import { computeMatchTension } from "../visual/matchTension";
import {
	triggerBallHitFlash,
	updateBallMaterialView,
} from "../visual/materials";
import {
	applyPostHitOverlay,
	PostHitHighlight,
} from "../visual/postHitHighlight";
import {
	applyPowerShotOverlay,
	POWER_SHOT_IMPACT_MIN,
	PowerShotHighlight,
} from "../visual/powerShotHighlight";
import {
	applySaveAnticipationOverlay,
	SaveAnticipation,
} from "../visual/saveAnticipation";
import { cancelGoalFlood, triggerGoalFlood } from "../visual/stadiumLighting";
import {
	applySupersonicOverlay,
	SUPERSONIC_MPS,
	SupersonicBreak,
} from "../visual/supersonicBreak";
import type { BallVfx } from "../visual/vfx/ballVfx";
import type { BallWallMarkVfx } from "../visual/vfx/ballWallMark";
import { BoostPadVfx } from "../visual/vfx/boostPadVfx";
import { IgnitionZoneVfx } from "../visual/vfx/ignitionZoneVfx";
import { MeridianCrossVfx } from "../visual/vfx/meridianCrossVfx";
import { DemoDebrisVfx } from "../visual/vfx/demoDebrisVfx";
import {
	constrainBodyToMeridianSphere,
	setupMeridianArena,
	teardownMeridianArena,
	updateMeridianArenaVisuals,
} from "../visual/meridianArena";
import { DemolishShockwaveVfx } from "../visual/vfx/demolishShockwaveVfx";
import { EpicSaveShockwaveVfx } from "../visual/vfx/epicSaveShockwaveVfx";
import { FlipResetRingVfx } from "../visual/vfx/flipResetRingVfx";
import type { HitVfx } from "../visual/vfx/hitVfx";
import { ImpactGroundMarkVfx } from "../visual/vfx/impactGroundMark";
import { PostHitSparksVfx } from "../visual/vfx/postHitSparksVfx";
import type { PowerUpActivationVfx } from "../visual/vfx/powerUpActivationVfx";
import { CarEntity } from "./CarEntity";
import { GoalReplayPlayer, GoalReplayRecorder } from "./GoalReplay";
import {
	GoalInputRecorder,
	type GoalReplayClipPayload,
	GoalReplayPhysicsPlayer,
} from "./InputReplay";

export type OnlineSessionConfig = {
	role: OnlineRole;
	localSlot: number;
	mode: GameModeId;
	roomClient: RoomClient;
	remoteInputs: NetworkControlInputPool;
	ranked: boolean;
	/** Sloty zajęte przez ludzi (reszta = boty u hosta). */
	humanSlots?: ReadonlySet<number>;
};

export type GameSessionDeps = {
	scene: Scene;
	renderer: Renderer;
	ball: GameObject;
	ballRadius: number;
	ballShadow: BallShadow;
	ballFloorIndicator: BallFloorIndicator;
	ballOffScreen: BallOffScreenIndicator;
	ballVfx: BallVfx;
	hitVfx: HitVfx;
	powerUpActivationVfx: PowerUpActivationVfx;
	ballWallMarkVfx: BallWallMarkVfx;
	minimap: MatchMinimap;
	scoreboardOverlay: MatchScoreboardOverlay;
	hud: RlHud;
	audio: GameAudio;
	humanInput: GameInput;
	physicsTelemetry: PhysicsTelemetry | null;
};

export class GameSession {
	readonly cars: CarEntity[] = [];
	readonly match: MatchController;
	readonly ai: AIManager;
	readonly ignition: IgnitionManager;
	readonly rush: IgnitionRushController;
	readonly overcharge: TeamOvercharge;
	readonly zones: IgnitionZonesController;
	readonly meridian: MeridianController;
	readonly weeklyMutator: WeeklyMutatorDef | null;
	readonly humanCar: CarEntity;
	readonly online: OnlineSessionConfig | null;

	private carHalfHeight = 1.35;
	private lastCountdownSoundKey = "";
	private readonly replayRecorder = new GoalReplayRecorder();
	private readonly inputRecorder = new GoalInputRecorder();
	private readonly replayPlayer = new GoalReplayPlayer();
	private readonly physicsReplayPlayer = new GoalReplayPhysicsPlayer();
	private usePhysicsReplay = false;
	private guestReplayClip: GoalReplayClipPayload | null = null;
	private replaySessionActive = false;
	private snapshotAccumulator = 0;
	private netTick = 0;
	private readonly stateInterpolator = new StateInterpolator();
	private readonly guestReconcile = new GuestReconcilePool();
	private lastGuestKickoffKey = "";
	private lastMatchPhase = "countdown";
	private rankedReportSent = false;
	private rankedEloLine: string | null = null;
	private readonly goalSpectacle = new GoalSpectacle();
	private readonly matchDirector = new MatchDirector();
	private readonly lastGoalSpectaclePos = new THREE.Vector3();
	private readonly supersonicBreak = new SupersonicBreak();
	private readonly powerShotHighlight = new PowerShotHighlight();
	private readonly demolishHighlight = new DemolishHighlight();
	private readonly epicSaveHighlight = new EpicSaveHighlight();
	private readonly matchMoments = new MatchMomentsController();
	private readonly saveAnticipation = new SaveAnticipation();
	private readonly postHitHighlight = new PostHitHighlight();
	private readonly matchAtmosphere = new MatchAtmosphereEngine();
	private flipResetRing: FlipResetRingVfx | null = null;
	private impactGroundMarks: ImpactGroundMarkVfx | null = null;
	private demoDebris: DemoDebrisVfx | null = null;
	private demolishShockwave: DemolishShockwaveVfx | null = null;
	private epicSaveShockwave: EpicSaveShockwaveVfx | null = null;
	private postHitSparks: PostHitSparksVfx | null = null;
	private boostPadVfx: BoostPadVfx | null = null;
	private ignitionZoneVfx: IgnitionZoneVfx | null = null;
	private meridianCrossVfx: MeridianCrossVfx | null = null;
	private readonly boostPads = new BoostPadManager();
	private quickChat: QuickChatOverlay | null = null;
	private quickChatDeps: GameSessionDeps | null = null;
	private wasBoostLow = false;
	private lastGuestBlueScore = 0;
	private lastGuestOrangeScore = 0;
	private wasGuestReplayActive = false;
	private lastRushActive = false;
	private lastMeridianHalf: "blue" | "orange" | "neutral" = "neutral";
	private lastMeridianLive: MeridianLivePossession | null = null;
	private meridianLeadTeam: "blue" | "orange" | "tie" | null = null;
	private dribbleTouchSlot: number | null = null;
	private dribbleTouchAt = -1;
	private commentator: MatchCommentator | null = null;
	private readonly banter = new MatchBanterTracker();
	private lastOvertimeBanner = false;
	private lastFinishedComment = false;
	private clock60Fired = false;
	private clock30Fired = false;
	private prevClockTimeSec = Number.POSITIVE_INFINITY;
	private readonly coach = new MatchCoachTracker();
	private static readonly _coachOwnGoal = new THREE.Vector3();
	private static readonly _coachToBall = new THREE.Vector3();

	private constructor(
		readonly mode: GameModeId,
		humanCar: CarEntity,
		match: MatchController,
		ai: AIManager,
		ignition: IgnitionManager,
		rush: IgnitionRushController,
		overcharge: TeamOvercharge,
		zones: IgnitionZonesController,
		meridian: MeridianController,
		weeklyMutator: WeeklyMutatorDef | null,
		cars: CarEntity[],
		carHalfHeight: number,
		online: OnlineSessionConfig | null = null,
	) {
		this.humanCar = humanCar;
		this.match = match;
		this.ai = ai;
		this.ignition = ignition;
		this.rush = rush;
		this.overcharge = overcharge;
		this.zones = zones;
		this.meridian = meridian;
		this.weeklyMutator = weeklyMutator;
		this.cars.push(...cars);
		this.carHalfHeight = carHalfHeight;
		this.online = online;
	}

	static async create(
		mode: GameModeId,
		deps: GameSessionDeps,
	): Promise<GameSession> {
		deps.scene.purgeMenuDecorations();
		deps.renderer.endGoalOrbit();
		deps.renderer.threeJSCamera.up.set(0, 1, 0);

		const match = new MatchController(deps.scene.threeJSScene, mode);
		const ai = new AIManager();
		const policy = getModePolicy(mode);
		const rush = new IgnitionRushController(policy.features.ignitionRush);
		const overcharge = new TeamOvercharge(policy.features.teamOvercharge);
		const zones = new IgnitionZonesController(policy.features.ignitionZones);
		const meridian = new MeridianController(policy.features.meridian);
		const weeklyMutator = policy.features.weeklyMutator
			? getWeeklyMutator()
			: null;
		const powerUps = modeHasPowerUps(mode);
		const ignition = new IgnitionManager(powerUps, {
			botsUsePowerUps: powerUps,
		});
		ignition.bindBall(deps.ball);
		ignition.onActivate((event) => {
			deps.powerUpActivationVfx.trigger(
				event.kind,
				event.position,
				event.forward,
			);
		});
		const spec = getModeSpec(mode);

		if (policy.features.meridian) {
			setupMeridianArena(deps.scene);
		}

		const slotTemplates = await loadMatchCarTemplates(mode, 0);
		const carHalfHeight = maxCarHalfHeight(slotTemplates.values());
		const spawns = match.initSpawns(carHalfHeight);

		if (spawns.length !== spec.playerCount) {
			throw new Error(
				`Niezgodność spawnów: ${spawns.length} pozycji vs ${spec.playerCount} graczy (${mode})`,
			);
		}

		const cars: CarEntity[] = [];
		let humanCar: CarEntity | null = null;

		try {
			for (let i = 0; i < spec.playerCount; i++) {
				const spawn = spawns[i]!;
				const isHuman = spawn.slotIndex === 0;
				const template = slotTemplates.get(spawn.slotIndex);
				if (!template) {
					throw new Error(
						`Brak szablonu auta dla slotu ${spawn.slotIndex}`,
					);
				}
				const mesh = cloneCarMesh(template);
				mountCarNeonUnderglow(mesh);
				const player = new Player(deps.scene, mesh as unknown as THREE.Mesh);
				if (policy.features.bodyTraits) {
					const carId =
						resolveCarIdFromVisual(mesh) ??
						(typeof mesh.userData.carId === "string"
							? mesh.userData.carId
							: "octane");
					player.setBodyTraits(getTraitsForCar(carId), true);
				}
				const visuals = new CarVisuals(
					player.threeJSGroup,
					player.visualRoot,
					deps.scene.threeJSScene,
					spawn.visualTeam,
					spawn.displayName,
					isHuman,
				);

				if (!isHuman) {
					for (const obj of [player.threeJSGroup, player.visualRoot]) {
						obj.traverse((child) => {
							if (child instanceof THREE.Mesh) {
								child.castShadow = false;
							}
						});
					}
					ai.registerBot(spawn.slotIndex, spawn.team);
				}

				if (powerUps) {
					ignition.registerSlot(spawn.slotIndex);
				}

				const car = new CarEntity(deps.scene, player, visuals, spawn, isHuman);
				cars.push(car);
				if (!isHuman) car.primeKickoff(ai);

				deps.audio.registerCollider(player.rapierCollider.handle, "player");

				if (isHuman) {
					humanCar = car;
					deps.audio.attachEngineAnchor(
						player.threeJSGroup,
						deps.scene.threeJSScene,
					);
				}
			}
		} catch (err) {
			for (const car of cars) {
				car.visuals.dispose();
				deps.scene.removeGameObject(car.player);
			}
			for (const template of slotTemplates.values()) {
				disposeCarMeshGroup(template);
			}
			throw err;
		}

		for (const template of slotTemplates.values()) {
			disposeCarMeshGroup(template);
		}
		deps.scene.purgeMenuDecorations();

		if (!humanCar) {
			throw new Error("Brak humanCar — slot 0 musi być graczem");
		}

		for (const car of cars) {
			car.player.syncWithRigidBody();
		}

		const carsInScene = countMatchCarsInScene(deps.scene.threeJSScene);
		if (carsInScene < spec.playerCount) {
			throw new Error(
				`W scenie jest ${carsInScene} modeli aut, oczekiwano ${spec.playerCount}. Odśwież stronę (Ctrl+Shift+R).`,
			);
		}

		console.info(
			`[Ignite] ${mode}: ${cars.length} aut w scenie`,
			cars
				.map(
					(c) => `${c.displayName} (z=${c.player.getPosition().z.toFixed(0)}m)`,
				)
				.join(", "),
		);

		match.scoring.ensurePlayers(cars);

		if (weeklyMutator) {
			applyMutatorBallVisual(
				deps.ball,
				weeklyMutator.effects,
				deps.ballRadius,
			);
			console.info(
				`[Ignite] Weekly mutator: ${weeklyMutator.id}`,
				weeklyMutator.effects,
			);
		}

		deps.renderer.snapChaseCamera(
			humanCar.player,
			deps.ball.getPosition(),
		);

		return new GameSession(
			mode,
			humanCar,
			match,
			ai,
			ignition,
			rush,
			overcharge,
			zones,
			meridian,
			weeklyMutator,
			cars,
			carHalfHeight,
			null,
		);
	}

	static async createOnline(
		deps: GameSessionDeps,
		online: OnlineSessionConfig,
	): Promise<GameSession> {
		const mode = online.mode;
		deps.scene.purgeMenuDecorations();

		const match = new MatchController(deps.scene.threeJSScene, mode);
		const ai = new AIManager();
		const policy = getModePolicy(mode);
		const rush = new IgnitionRushController(policy.features.ignitionRush);
		const overcharge = new TeamOvercharge(policy.features.teamOvercharge);
		const zones = new IgnitionZonesController(policy.features.ignitionZones);
		const meridian = new MeridianController(policy.features.meridian);
		const weeklyMutator = policy.features.weeklyMutator
			? getWeeklyMutator()
			: null;
		const ignition = new IgnitionManager(modeHasPowerUps(mode), {
			botsUsePowerUps: false,
		});
		ignition.bindBall(deps.ball);
		ignition.onActivate((event) => {
			deps.powerUpActivationVfx.trigger(
				event.kind,
				event.position,
				event.forward,
			);
		});
		const spec = getModeSpec(mode);

		if (policy.features.meridian) {
			setupMeridianArena(deps.scene);
		}

		const humanSlots =
			online.humanSlots ??
			online.roomClient.humanSlots() ??
			new Set([online.localSlot]);
		const lobby = online.roomClient.lastStartLobby ?? online.roomClient.lobby;
		const carIdBySlot = new Map<number, string>();
		if (lobby) {
			for (const s of lobby.slots) {
				carIdBySlot.set(s.slot, s.carId);
			}
		}

		const slotTemplates = await loadMatchCarTemplates(mode, online.localSlot, {
			humanSlots,
			carIdBySlot: carIdBySlot.size > 0 ? carIdBySlot : undefined,
		});
		const carHalfHeight = maxCarHalfHeight(slotTemplates.values());
		const spawns = match.initSpawns(carHalfHeight);

		const cars: CarEntity[] = [];
		let humanCar: CarEntity | null = null;
		const nameBySlot = new Map<number, string>();
		if (lobby) {
			for (const s of lobby.slots) {
				nameBySlot.set(s.slot, s.name);
			}
		}

		try {
			for (let i = 0; i < spec.playerCount; i++) {
				const spawn = spawns[i]!;
				const isLocalHuman = spawn.slotIndex === online.localSlot;
				const isHumanSlot = humanSlots.has(spawn.slotIndex);
				/** Host: boty isHuman=false + AI. Gość: flagi lokalne; remote z snapshotu. */
				const isHumanEntity =
					online.role === "guest"
						? isLocalHuman
						: isHumanSlot;
				const template = slotTemplates.get(spawn.slotIndex);
				if (!template) {
					throw new Error(
						`Brak szablonu auta dla slotu ${spawn.slotIndex}`,
					);
				}
				const mesh = cloneCarMesh(template);
				mountCarNeonUnderglow(mesh);
				const player = new Player(deps.scene, mesh as unknown as THREE.Mesh);
				if (policy.features.bodyTraits) {
					const carId =
						resolveCarIdFromVisual(mesh) ??
						(typeof mesh.userData.carId === "string"
							? mesh.userData.carId
							: "octane");
					player.setBodyTraits(getTraitsForCar(carId), true);
				}
				const displayName =
					nameBySlot.get(spawn.slotIndex) ??
					(isHumanSlot
						? spawn.displayName
						: `Bot ${spawn.slotIndex + 1}`);
				const visuals = new CarVisuals(
					player.threeJSGroup,
					player.visualRoot,
					deps.scene.threeJSScene,
					spawn.visualTeam,
					displayName,
					isLocalHuman,
				);

				if (!isHumanEntity && online.role === "host") {
					for (const obj of [player.threeJSGroup, player.visualRoot]) {
						obj.traverse((child) => {
							if (child instanceof THREE.Mesh) {
								child.castShadow = false;
							}
						});
					}
					ai.registerBot(spawn.slotIndex, spawn.team);
				}

				ignition.registerSlot(spawn.slotIndex);

				const car = new CarEntity(
					deps.scene,
					player,
					visuals,
					spawn,
					isHumanEntity,
				);
				cars.push(car);
				if (!isHumanEntity && online.role === "host") {
					car.primeKickoff(ai);
				}

				deps.audio.registerCollider(player.rapierCollider.handle, "player");

				if (isLocalHuman) {
					humanCar = car;
					deps.audio.attachEngineAnchor(
						player.threeJSGroup,
						deps.scene.threeJSScene,
					);
				}
			}
		} catch (err) {
			for (const car of cars) {
				car.visuals.dispose();
				deps.scene.removeGameObject(car.player);
			}
			for (const template of slotTemplates.values()) {
				disposeCarMeshGroup(template);
			}
			throw err;
		}

		for (const template of slotTemplates.values()) {
			disposeCarMeshGroup(template);
		}
		deps.scene.purgeMenuDecorations();

		if (!humanCar) {
			throw new Error(
				`Brak humanCar — slot ${online.localSlot} musi być lokalnym graczem`,
			);
		}

		for (const car of cars) {
			car.player.syncWithRigidBody();
		}

		console.info(
			`[Ignite] Online ${mode} (${online.role}, slot ${online.localSlot})`,
		);

		match.scoring.ensurePlayers(cars);

		if (weeklyMutator) {
			applyMutatorBallVisual(
				deps.ball,
				weeklyMutator.effects,
				deps.ballRadius,
			);
			console.info(
				`[Ignite] Weekly mutator: ${weeklyMutator.id}`,
				weeklyMutator.effects,
			);
		}

		const session = new GameSession(
			mode,
			humanCar,
			match,
			ai,
			ignition,
			rush,
			overcharge,
			zones,
			meridian,
			weeklyMutator,
			cars,
			carHalfHeight,
			{
				...online,
				humanSlots,
				ranked: effectiveRanked(online.ranked),
			},
		);
		session.bindOnlineCallbacks();
		return session;
	}

	bindOnlineCallbacks(): void {
		if (!this.online) return;
		this.online.roomClient.setCallbacks({
			onInputFrame: (frame, fromSlot) => {
				if (
					this.online?.role === "host" &&
					fromSlot !== this.online.localSlot
				) {
					this.online.remoteInputs.applyFrame(fromSlot, frame);
				}
			},
			onGoalReplayClip: (clip) => {
				if (this.online?.role === "guest") {
					this.guestReplayClip = clip;
				}
			},
			onSnapshot: (snapshot) => {
				if (this.online?.role === "guest") {
					this.stateInterpolator.push(snapshot);
					const humanSlot = this.online.localSlot;
					const humanSnap = snapshot.cars.find((c) => c.slot === humanSlot);
					if (humanSnap) {
						this.guestReconcile.ingestAuthority(
							humanSlot,
							humanSnap,
							this.humanCar,
						);
					}
				}
			},
			onRankedResult: RANKED_UI_ENABLED
				? (before, after, delta) => {
						queueRankedResult(before, after, delta);
						const sign = delta >= 0 ? "+" : "";
						this.rankedEloLine = t("match.rankedDelta", {
							before,
							after,
							sign,
							delta,
						});
						this.rankedReportSent = true;
					}
				: undefined,
			onMatchForfeit: (loserSlot) => {
				this.applyOnlineForfeit(loserSlot);
			},
		});
	}

	requestForfeit(): void {
		if (!this.online || this.match.getPhase() === "finished") return;
		this.online.roomClient.sendForfeit();
	}

	private applyOnlineForfeit(loserSlot: number): void {
		if (this.match.getPhase() === "finished") return;
		this.match.applyOnlineForfeit(loserSlot);
		this.rankedReportSent = true;
		this.replaySessionActive = false;
		this.replayPlayer.stop();
	}

	private onlineModeLabel(base: string): string {
		if (!this.online) return base;
		const tag = this.online.ranked ? t("match.rankedTag") : "";
		return `${base} · Online${tag}`;
	}

	private rematchHudFlags(
		phase: MatchPhase,
	): Pick<RlHudState, "rematchHost" | "rematchGuestWait"> {
		if (!this.online || phase !== "finished") {
			return {};
		}
		if (this.online.role === "host") {
			return { rematchHost: true };
		}
		return { rematchGuestWait: true };
	}

	private rankedHudFields(): Pick<RlHudState, "isRanked" | "rankedElo"> {
		if (!this.online?.ranked) {
			return { isRanked: false, rankedElo: null };
		}
		return {
			isRanked: true,
			rankedElo: this.online.roomClient.elo,
		};
	}

	private powerUpHudFields(): Pick<RlHudState, "powerUp"> {
		const disabled: PowerUpHudState = {
			enabled: false,
			held: null,
			pickProgress: 0,
			pickSecondsLeft: 0,
			activeKind: null,
			activeProgress: 0,
			activeSecondsLeft: 0,
		};
		if (
			HOVER_SAFE_MODE ||
			!this.ignition.isEnabled() ||
			this.online?.role === "guest"
		) {
			return { powerUp: disabled };
		}
		return { powerUp: this.ignition.getHudState(this.humanCar.slotIndex) };
	}

	/** Rush / Overcharge / Weekly mutator — fizyka + VFX wejścia w fazę. */
	private applyExperimentalModeEffects(
		deps: GameSessionDeps,
		matchPlaying: boolean,
	): void {
		const rushMul = matchPlaying ? this.rush.getBallSpeedMul() : 1;
		const mutTick = this.weeklyMutator
			? resolveMutatorTickEffects(this.weeklyMutator.effects)
			: null;
		/** Soft-cap Lab×Rush — unikaj absurdalnych stacków. */
		const ballMul = Math.min(1.45, rushMul * (mutTick?.ballSpeedMul ?? 1));
		setMatchBallSpeedMul(ballMul);

		const rushActive = this.rush.isRushActive();
		const rushRegen = this.rush.getBoostRegenMul();
		for (const car of this.cars) {
			const team = car.team ?? car.visualTeam;
			const oc = this.overcharge.isActive(team);
			const regenRaw =
				rushRegen * (oc ? 1.15 : 1) * (mutTick?.boostRegenMul ?? 1);
			car.player.boostRegenMul = Math.min(2.0, regenRaw);
			car.player.boostForceMul = Math.min(
				1.35,
				(oc ? 1.12 : 1) * (mutTick?.boostForceMul ?? 1),
			);
			if (mutTick && mutTick.carGravityMul !== 1) {
				car.player.gravityScale = Math.max(
					0.4,
					car.player.gravityScale * mutTick.carGravityMul,
				);
			}
		}

		if (rushActive && !this.lastRushActive && matchPlaying) {
			triggerCrowdSurge("power_shot", { intensity: 0.85 });
			pulseArenaBallFocus(deps.ball.getPosition(), 0.55, 1.6);
		}
		this.lastRushActive = rushActive;
	}

	private tickMeridian(
		deps: GameSessionDeps,
		dt: number,
		ballPos: THREE.Vector3,
		scoringActive: boolean,
		nowSec: number,
	): void {
		if (!this.meridian.enabled) {
			this.lastMeridianLive = null;
			return;
		}
		if (!this.meridianCrossVfx) {
			this.meridianCrossVfx = new MeridianCrossVfx(deps.scene.threeJSScene);
		}
		this.lastMeridianHalf = halfForBallZ(ballPos.z);
		const tick = this.meridian.update(dt, ballPos, scoringActive);
		if (tick.blueDelta > 0 || tick.orangeDelta > 0) {
			this.match.addPossessionPoints(tick.blueDelta, tick.orangeDelta);
		}
		if (tick.cross) {
			const p = tick.cross.position;
			this.meridianCrossVfx.trigger(p.x, p.y, p.z, tick.cross.scoringTeam);
			deps.audio.playMeridianCross(tick.cross.scoringTeam);
		}
		this.meridianCrossVfx.update(dt);
		updateMeridianArenaVisuals(nowSec, ballPos);
		const scores = this.match.getScores();
		this.lastMeridianLive = this.meridian.getLivePossession(
			scores.blue,
			scores.orange,
		);
		this.tickMeridianLeadCall(deps, scores.blue, scores.orange, scoringActive);
	}

	private tickMeridianLeadCall(
		deps: GameSessionDeps,
		blue: number,
		orange: number,
		scoringActive: boolean,
	): void {
		if (!scoringActive) {
			this.meridianLeadTeam = null;
			return;
		}
		const lead: "blue" | "orange" | "tie" =
			blue === orange ? "tie" : blue > orange ? "blue" : "orange";
		if (this.meridianLeadTeam === null) {
			this.meridianLeadTeam = lead;
			return;
		}
		if (lead === this.meridianLeadTeam) return;
		const prev = this.meridianLeadTeam;
		this.meridianLeadTeam = lead;
		if (lead === "tie") return;
		if (prev === lead) return;
		void this.getCommentator(deps.audio).trigger(
			lead === "blue" ? "blue_ahead" : "orange_ahead",
		);
	}

	private constrainMeridianBodies(deps: GameSessionDeps): void {
		if (!this.meridian.enabled) return;
		constrainBodyToMeridianSphere(
			deps.ball.rapierRigidBody,
			deps.ballRadius + 0.08,
			{ softKill: 0.25, bounceRetain: 0.94 },
		);
		for (const car of this.cars) {
			const body = car.player.rapierRigidBody;
			if (!body) continue;
			body.enableCcd(true);
			body.setSoftCcdPrediction(0.65);
			constrainBodyToMeridianSphere(body, 0.08);
		}
	}

	private experimentalHudFields(): Pick<
		RlHudState,
		"rush" | "overcharge" | "zoneBuff" | "mutator" | "meridianHalf" | "meridianLive"
	> {
		const rushSnap = this.rush.snapshot();
		const ocSnap = this.overcharge.snapshot();
		const zoneBuff = this.zones.enabled
			? this.zones.getBuff(this.humanCar.slotIndex)
			: null;
		return {
			rush: this.rush.enabled
				? {
						active: rushSnap.rushActive,
						nextInSec: rushSnap.nextRushInSec,
						phaseLeftSec: rushSnap.rushActive
							? Math.max(
									0,
									this.rush.rushDurationSec - rushSnap.phaseElapsedSec,
								)
							: null,
					}
				: null,
			overcharge: this.overcharge.enabled
				? {
						blue: ocSnap.blueCharge,
						orange: ocSnap.orangeCharge,
						activeTeam: ocSnap.activeTeam,
						activeLeftSec: ocSnap.activeLeftSec,
					}
				: null,
			zoneBuff: zoneBuff
				? { kind: zoneBuff.kind, leftSec: zoneBuff.leftSec }
				: null,
			mutator: this.weeklyMutator
				? {
						id: this.weeklyMutator.id,
						nameKey: this.weeklyMutator.nameKey,
					}
				: null,
			meridianHalf: this.meridian.enabled ? this.lastMeridianHalf : null,
			meridianLive: this.meridian.enabled ? this.lastMeridianLive : null,
		};
	}

	private noteOverchargeCharge(
		team: ScoringTeam | null | undefined,
		reason: "save" | "demo" | "dribble",
	): void {
		if (!team || !this.overcharge.enabled) return;
		this.overcharge.addCharge(team, reason);
	}

	private tickCoach(
		deps: GameSessionDeps,
		dt: number,
		ballPos: THREE.Vector3,
		ballVel: THREE.Vector3,
	): void {
		const human = this.humanCar.player;
		const pos = human.getPosition();
		GameSession._coachToBall.copy(ballPos).sub(pos);
		const ballDist = GameSession._coachToBall.length();
		const closeSpeed =
			ballDist > 0.05
				? -human.getVelocity().dot(GameSession._coachToBall.normalize())
				: 0;
		const team = this.humanCar.team ?? this.humanCar.visualTeam;
		const ownGoal = team
			? ownGoalForTeam(team)
			: GameSession._coachOwnGoal.set(0, 0, 0);
		const ownGoalDist = pos.distanceTo(ownGoal);
		const ownGoalThreat = team
			? ballThreatensOwnGoal(ballPos, ballVel, ownGoal, 2.0)
			: false;
		this.coach.tick({
			dt,
			ballDist,
			closeSpeed,
			boostFuel: human.getBoostFuel(),
			boosting: deps.humanInput.isBoosting(),
			speedMps: human.getVelocity().length(),
			grounded: human.isOnGround(),
			ownGoalThreat,
			ownGoalDist,
		});
	}

	private updateCarPowerUpVisuals(
		_deps: GameSessionDeps,
		ballPos: THREE.Vector3,
		dt: number,
	): void {
		if (this.online?.role === "guest") {
			for (const car of this.cars) {
				car.visuals.updatePowerUp(null, null, dt);
			}
			return;
		}
		if (HOVER_SAFE_MODE || !this.ignition.isEnabled()) {
			for (const car of this.cars) {
				car.visuals.updatePowerUp(null, null, dt);
			}
			return;
		}
		for (const car of this.cars) {
			car.visuals.updatePowerUp(
				this.ignition.getHudState(car.slotIndex),
				ballPos,
				dt,
			);
		}
	}

	private getControlForSlot(
		slot: number,
		deps: GameSessionDeps,
	): ControlInput | undefined {
		if (!this.online) {
			return slot === 0 ? deps.humanInput : undefined;
		}
		if (slot === this.online.localSlot) {
			return deps.humanInput;
		}
		const humans =
			this.online.humanSlots ?? this.online.roomClient.humanSlots();
		if (!humans.has(slot)) {
			/** Bot — AI przez CarEntity.control bez humanInput. */
			return undefined;
		}
		return this.online.remoteInputs.forSlot(slot);
	}

	destroy(deps: GameSessionDeps): void {
		setMatchBallSpeedMul(1);
		clearMutatorBallVisual(deps.ball);
		this.flipResetRing?.dispose();
		this.flipResetRing = null;
		this.impactGroundMarks?.dispose();
		this.impactGroundMarks = null;
		this.demoDebris?.dispose();
		this.demoDebris = null;
		this.demolishShockwave?.dispose();
		this.demolishShockwave = null;
		this.epicSaveShockwave?.dispose();
		this.epicSaveShockwave = null;
		this.postHitSparks?.dispose();
		this.postHitSparks = null;
		this.boostPadVfx?.dispose();
		this.boostPadVfx = null;
		this.ignitionZoneVfx?.dispose();
		this.ignitionZoneVfx = null;
		this.meridianCrossVfx?.dispose();
		this.meridianCrossVfx = null;
		if (this.meridian.enabled) {
			teardownMeridianArena(deps.scene);
		}
		this.quickChat?.dispose();
		this.quickChat = null;
		this.quickChatDeps = null;
		for (const car of this.cars) {
			car.player.disposeHoverDebug?.();
			car.visuals.dispose();
			deps.scene.removeGameObject(car.player);
		}
		this.cars.length = 0;
		this.stateInterpolator.clear();
		this.guestReconcile.reset();
	}

	private ensureJuiceVfx(deps: GameSessionDeps): void {
		if (!this.flipResetRing) {
			this.flipResetRing = new FlipResetRingVfx(deps.scene.threeJSScene);
		}
		if (!this.demoDebris) {
			this.demoDebris = new DemoDebrisVfx(deps.scene.threeJSScene);
		}
		if (!this.demolishShockwave) {
			this.demolishShockwave = new DemolishShockwaveVfx(
				deps.scene.threeJSScene,
			);
		}
		if (!this.epicSaveShockwave) {
			this.epicSaveShockwave = new EpicSaveShockwaveVfx(
				deps.scene.threeJSScene,
			);
		}
		if (!this.postHitSparks) {
			this.postHitSparks = new PostHitSparksVfx(deps.scene.threeJSScene);
		}
		if (!this.impactGroundMarks) {
			this.impactGroundMarks = new ImpactGroundMarkVfx(deps.scene.threeJSScene);
		}
	}

	private ensureArenaJuice(deps: GameSessionDeps): void {
		if (!this.boostPadVfx) {
			this.boostPadVfx = new BoostPadVfx(deps.scene.threeJSScene);
			this.boostPadVfx.setArenaAccent(
				ArenaRuntime.get().atmosphere?.neonAccent,
			);
			this.boostPads.onPickup((event) => {
				this.boostPadVfx!.triggerPickup(event);
				deps.audio.playBoostPadPickup(event.position, event.big);
			});
		}
		if (!this.ignitionZoneVfx && this.zones.enabled) {
			this.ignitionZoneVfx = new IgnitionZoneVfx(deps.scene.threeJSScene);
			this.ignitionZoneVfx.setZones(this.zones.zones);
		}
		if (!this.quickChat) {
			this.quickChatDeps = deps;
			this.quickChat = new QuickChatOverlay((id) => this.onQuickChat(id));
		}
	}

	private onQuickChat(id: QuickChatId): void {
		const deps = this.quickChatDeps;
		if (!deps || !this.quickChat) return;
		this.quickChat.showBubble(id, this.humanCar.visualTeam);
		deps.audio.playQuickChatPing();
	}

	private tickBoostPads(deps: GameSessionDeps, dt: number): void {
		if (this.boostPads.getPadStates().length === 0) return;
		if (this.match.getPhase() === "countdown") return;
		this.ensureArenaJuice(deps);
		this.boostPads.update(
			dt,
			this.cars.map((c) => c.player),
		);
		this.boostPadVfx!.update(dt, this.boostPads.getPadStates());
	}

	private tickIgnitionZones(deps: GameSessionDeps, dt: number): void {
		if (!this.zones.enabled) return;
		this.ensureArenaJuice(deps);
		if (!this.ignitionZoneVfx) return;
		if (this.zones.consumeLayoutDirty()) {
			this.ignitionZoneVfx.setZones(this.zones.zones);
		}
		const active = new Set<"lowGrav" | "magnetic">();
		for (const car of this.cars) {
			const buff = this.zones.getBuff(car.slotIndex);
			if (buff) active.add(buff.kind);
		}
		this.ignitionZoneVfx.update(dt, active);
	}

	private tickQuickChat(deps: GameSessionDeps, dt: number): void {
		this.ensureArenaJuice(deps);
		const chat = this.quickChat!;
		chat.setOpen(deps.humanInput.isQuickChatHeld());
		const ndc = GameSession._chatNdc
			.copy(this.humanCar.player.getPosition())
			.project(deps.renderer.threeJSCamera);
		const el = document.getElementById("game-container");
		const screen =
			ndc.z < 1 && el
				? {
						x: ((ndc.x + 1) / 2) * el.clientWidth,
						y: ((1 - ndc.y) / 2) * el.clientHeight,
					}
				: null;
		chat.update(dt, screen);
	}

	private juiceHudFields(
		phase: MatchPhase,
		timeRemainingSec: number,
		isOvertime: boolean,
	): Pick<RlHudState, "onFire" | "matchTension"> {
		return {
			onFire: this.matchMoments.getHumanGoalStreak() >= 2,
			matchTension: computeMatchTension(phase, timeRemainingSec, isOvertime),
		};
	}

	private updateSceneJuice(
		deps: GameSessionDeps,
		dt: number,
		ballPos: THREE.Vector3,
		ballVel: THREE.Vector3,
		phase: MatchPhase,
		_timeRemainingSec: number,
		_isOvertime: boolean,
	): void {
		const touchTeam = this.match.getLastTouchTeam(this.cars);
		deps.ballVfx.setTeamTint(touchTeam);
		deps.ballFloorIndicator.setTeamTint(touchTeam);
		deps.ballOffScreen.setTeamTint(touchTeam);
		this.humanCar.visuals.setGoalStreak(this.matchMoments.getHumanGoalStreak());
		this.saveAnticipation.sample(this.humanCar.team, ballPos, ballVel, dt);
		this.flipResetRing?.update(dt);
		this.demoDebris?.update(dt);
		this.demolishShockwave?.update(dt);
		this.epicSaveShockwave?.update(dt);
		this.postHitSparks?.update(dt);
		this.impactGroundMarks?.update(dt);
		this.updateMinimap(deps, ballPos, phase);
		this.updateScoreboardOverlay(deps);
	}

	private updateMinimap(
		deps: GameSessionDeps,
		ballPos: THREE.Vector3,
		phase: MatchPhase,
	): void {
		if (deps.humanInput.consumeMinimapToggle()) {
			deps.minimap.toggleUserEnabled();
		}
		const active =
			phase !== "finished" &&
			phase !== "countdown" &&
			!getModeSpec(this.mode).isFFA &&
			!this.meridian.enabled;
		deps.minimap.setVisible(active);
		if (!active || !deps.minimap.isUserEnabled()) return;

		const entities: MinimapEntity[] = this.cars.map((car) => {
			const pos = car.player.getPosition();
			return {
				x: pos.x,
				z: pos.z,
				team: car.team,
				isHuman: car.isHuman,
			};
		});
		entities.push({
			x: ballPos.x,
			z: ballPos.z,
			team: null,
			isHuman: false,
			isBall: true,
		});
		deps.minimap.draw(
			entities,
			this.match.getLastTouchTeam(this.cars),
			this.humanCar.team,
		);
	}

	private tickBoostLowWarning(deps: GameSessionDeps): void {
		const fuel = this.humanCar.player.getBoostFuel();
		const nowLow = fuel <= 0.2;
		if (nowLow && !this.wasBoostLow) {
			deps.audio.playBoostLowWarning();
		}
		this.wasBoostLow = nowLow;
	}

	private updateScoreboardOverlay(deps: GameSessionDeps): void {
		deps.scoreboardOverlay.update(
			this.match.scoring.getRows(this.cars),
			deps.humanInput.isScoreboardHeld(),
			this.humanCar.slotIndex,
		);
	}

	private static readonly _ballVelScratch = new THREE.Vector3();
	private static readonly _preHitBallVel = new THREE.Vector3();
	private static readonly _preHitBallPos = new THREE.Vector3();
	private static readonly _postHitBallVel = new THREE.Vector3();
	private static readonly _chatNdc = new THREE.Vector3();

	private fireGoalSpectacle(
		deps: GameSessionDeps,
		team: ScoringTeam,
		goalPos: THREE.Vector3,
		opts?: {
			scorerSlot: number | null;
		},
	): void {
		this.lastGoalSpectaclePos.copy(goalPos);
		const cine = getCinematicCameraMode();
		const scorerIsHuman =
			opts?.scorerSlot != null &&
			opts.scorerSlot === this.humanCar.slotIndex;
		this.goalSpectacle.trigger(team, goalPos, {
			reduced: cine === "reduced",
			durationSec: cine === "off" ? 0.85 : undefined,
			explosionId: scorerIsHuman
				? getEquippedGoalExplosionId()
				: "default",
			paintId: scorerIsHuman
				? getEquippedPaintId("goalExplosion")
				: null,
		});
		this.matchDirector.setMode(cine);
		if (cine !== "off") {
			this.matchDirector.request({ kind: "goal", focus: goalPos });
		}
		pulseArenaBallFocus(goalPos, 1, 3.4);
		deps.renderer.endGoalOrbit();
		if (cine === "on") {
			deps.renderer.beginGoalOrbit(goalPos);
		}
		triggerGoalFlood(team);
		triggerCrowdSurge("goal_wave", { team, intensity: 1.42 });
		triggerGoalNetRipple(team === "blue" ? "orange" : "blue", 1.65);
		deps.renderer.addCameraShake(cine === "off" ? 0.14 : 0.28);
		deps.renderer.pulseCinematicFx(cine === "off" ? 0.4 : 0.85);
		deps.renderer.pulseSpectacle(cine === "off" ? 0.55 : 1.05);
		if (team === "blue") {
			deps.renderer.pulseCoolGrade(cine === "off" ? 0.22 : 0.62);
		} else {
			deps.renderer.pulseWarmGrade(cine === "off" ? 0.2 : 0.55);
		}
		deps.audio.playGoal(team);
		void this.getCommentator(deps.audio).trigger("goal");
	}

	private getCommentator(audio: GameAudio): MatchCommentator {
		if (!this.commentator) {
			this.commentator = new MatchCommentator(audio);
			void this.commentator.ensureLoaded();
		}
		return this.commentator;
	}

	/**
	 * Zegar meczu: 60 s / 30 s one-shot (bez VO cyfr 10→1).
	 * Tylko regulation (nie OT) w fazie playing.
	 */
	private tickClockCommentary(
		audio: GameAudio,
		timeRemainingSec: number,
		phase: string,
		isOvertime: boolean,
	): void {
		if (phase !== "playing" || isOvertime) {
			this.prevClockTimeSec = Number.POSITIVE_INFINITY;
			return;
		}

		const prev = this.prevClockTimeSec;
		this.prevClockTimeSec = timeRemainingSec;

		if (!this.clock60Fired && prev > 60 && timeRemainingSec <= 60) {
			this.clock60Fired = true;
			void this.getCommentator(audio).trigger("clock_60");
		}
		if (!this.clock30Fired && prev > 30 && timeRemainingSec <= 30) {
			this.clock30Fired = true;
			void this.getCommentator(audio).trigger("clock_30");
		}
	}

	/** DEV audit: wyłącz spektakl gola i snappnij chase (survey boiska). */
	forceChaseForAudit(
		deps: GameSessionDeps,
		x: number,
		y: number,
		z: number,
		yaw: number,
		ballWorld: THREE.Vector3,
	): void {
		if (this.goalSpectacle.isActive()) {
			this.goalSpectacle.forceEnd();
		}
		deps.renderer.endGoalOrbit();
		this.humanCar.player.resetKickoffPose(x, y, z, yaw);
		const body = deps.ball.rapierRigidBody;
		if (body) {
			body.setTranslation(
				{ x: ballWorld.x, y: ballWorld.y, z: ballWorld.z },
				true,
			);
			body.setLinvel({ x: 0, y: 0, z: 0 }, true);
			body.setAngvel({ x: 0, y: 0, z: 0 }, true);
		}
		for (const car of this.cars) {
			if (car === this.humanCar) continue;
			car.freezeInPlace();
		}
		deps.renderer.snapChaseCamera(this.humanCar.player, ballWorld);
	}

	/** Po zwolnieniu holdu kickoffu — odliczanie audio od świeżego „Five”. */
	resetKickoffAudioSync(): void {
		this.lastCountdownSoundKey = "";
		this.lastGuestKickoffKey = "";
	}

	private applyMatchCamera(
		deps: GameSessionDeps,
		dt: number,
		boosting: boolean,
		ballPos: THREE.Vector3,
		ballVel: THREE.Vector3,
		allowGoalOrbit: boolean,
	): void {
		const cine = getCinematicCameraMode();
		this.matchDirector.setMode(cine);

		/**
		 * Kickoff / countdown: twardy snap chase co klatkę.
		 * SmoothDamp z pozycji orbity menu (~30 m) zostawiał kadr „z góry”
		 * (YOU na środku, auto z boku) mimo jednorazowego snapu po starcie.
		 */
		if (
			this.match.getPhase() === "countdown" ||
			this.match.isKickoffCountdownActive()
		) {
			deps.renderer.snapChaseCamera(this.humanCar.player, ballPos);
			return;
		}

		if (
			this.goalSpectacle.isPresentationActive() &&
			this.goalSpectacle.canSkip() &&
			deps.humanInput.isJumpHeld()
		) {
			this.goalSpectacle.skip();
			deps.renderer.endGoalOrbit();
		}

		const specPose = this.goalSpectacle.getCameraPose();
		const useSpectacleCam =
			cine !== "off" &&
			specPose !== null &&
			this.goalSpectacle.isPresentationActive();

		deps.renderer.followPlayer(
			this.humanCar.player,
			dt,
			boosting,
			ballPos,
			allowGoalOrbit &&
				cine === "on" &&
				!useSpectacleCam &&
				this.goalSpectacle.isActive()
				? this.goalSpectacle.goalPos
				: null,
			ballVel,
		);

		const dir = this.matchDirector.update(dt);
		if (useSpectacleCam && specPose) {
			deps.renderer.blendCameraTo(specPose.eye, specPose.lookAt, 1, dt);
		} else if (dir.active && dir.blend > 0.02 && dir.kind !== "goal") {
			deps.renderer.blendCameraTo(dir.eye, dir.lookAt, dir.blend, dt);
		}
	}

	private pulseCrowdForMoment(): void {
		if (this.matchMoments.highlight.isActive()) {
			triggerCrowdSurge("match_moment", { intensity: 0.88 });
		}
	}

	private applyGoalSpectacleFrame(
		deps: GameSessionDeps,
		dt: number,
		speedMps = 0,
		boosting = false,
		ballPos?: THREE.Vector3,
		ballVel?: THREE.Vector3,
	): number {
		this.goalSpectacle.update(dt);
		this.supersonicBreak.update(dt);
		this.powerShotHighlight.update(dt);
		this.demolishHighlight.update(dt);
		this.epicSaveHighlight.update(dt);
		this.matchMoments.highlight.update(dt);
		this.postHitHighlight.update(dt);
		const goal = this.match.isReplayActive()
			? emptyGoalPresentation()
			: this.goalSpectacle.getPresentation();
		const sonic = this.supersonicBreak.getPresentation();
		const power = this.powerShotHighlight.getPresentation();
		const demolish = this.demolishHighlight.getPresentation();
		const epicSave = this.epicSaveHighlight.getPresentation();
		const moment = this.matchMoments.highlight.getPresentation();
		const postHit = this.postHitHighlight.getPresentation();
		const cinematicPulse = Math.max(
			goal.flash,
			sonic.streak,
			power.flash,
			demolish.flash,
			epicSave.flash,
			moment.flash,
			postHit.flash,
		);
		const dofFocus = Math.max(
			goal.dofFocus,
			power.streak * 0.12,
			sonic.streak * 0.08,
			/** Lekki bokeh tylko przy prędkości — murawa zostaje ostra. */
			THREE.MathUtils.clamp((speedMps - 18) / 40, 0, 0.14) *
				(boosting ? 1.05 : 0.85),
		);
		deps.renderer.setGoalDofStrength(dofFocus);
		const focusPos = this.humanCar.player.getPosition();
		if (ballPos && ballVel) {
			/** Focus na aucie → rozmycie jupiterów na niebie / w tle. */
			deps.renderer.updatePremiumBallFx(ballPos, ballVel, focusPos);
		} else {
			GameSession._ballVelScratch.set(0, 0, 0);
			deps.renderer.updatePremiumBallFx(
				focusPos,
				GameSession._ballVelScratch,
				focusPos,
			);
		}
		deps.renderer.updateCinematicFx(dt, speedMps, boosting, cinematicPulse);

		// Odbicia / post-process flary od jupiterów.
		const speedNorm = THREE.MathUtils.clamp(speedMps / 28, 0, 1);
		const driveOptics = speedNorm * 0.5 + (boosting ? 0.45 : 0.22);
		deps.scene.threeJSScene.environmentIntensity =
			getBaseEnvironmentIntensity() +
			speedNorm * 0.1 +
			(boosting ? 0.12 : 0);
		const flaresOn = resolveGraphicsSettings().quality !== "low";
		deps.scene.lensFlares.setEnabled(flaresOn);
		deps.scene.lensFlares.setDriveIntensity(0.85 + driveOptics * 0.45);
		deps.renderer.setLensFlares(
			flaresOn
				? deps.scene.lensFlares.collectLights(deps.renderer.threeJSCamera)
				: [],
			0.95 + driveOptics * 0.45,
		);
		if (goal.coolGrade > 0.02 || goal.warmGrade > 0.02) {
			if (goal.coolGrade >= goal.warmGrade) {
				deps.renderer.pulseCoolGrade(goal.coolGrade * 0.85);
			} else {
				deps.renderer.pulseWarmGrade(goal.warmGrade * 0.85);
			}
		}
		const bloom = Math.max(
			goal.bloom,
			sonic.bloom,
			power.bloom,
			demolish.bloom,
			epicSave.bloom,
			moment.bloom,
		);
		const fovBoost = Math.max(
			goal.fovBoost,
			sonic.fovBoost,
			power.fovBoost,
			demolish.fovBoost,
			epicSave.fovBoost,
			moment.fovBoost,
		);
		const shake = Math.max(
			goal.shake,
			sonic.shake,
			power.shake,
			demolish.shake,
			epicSave.shake,
			postHit.shake,
			moment.shake,
		);

		if (
			this.goalSpectacle.isPresentationActive() ||
			this.supersonicBreak.isActive() ||
			this.powerShotHighlight.isActive() ||
			this.demolishHighlight.isActive() ||
			this.epicSaveHighlight.isActive() ||
			this.matchMoments.highlight.isActive()
		) {
			deps.renderer.applyGoalPresentation(bloom, fovBoost, shake);
		} else {
			deps.renderer.resetGoalPresentation();
		}

		applyGoalSpectacleOverlay(goal);
		applySupersonicOverlay(sonic);
		applyPowerShotOverlay(power);
		applyDemolishOverlay(demolish);
		if (demolish.chromatic > 0.05) {
			deps.renderer.pulseChromaticAberration(demolish.chromatic);
		}
		if (goal.chromatic > 0.05 && !this.match.isReplayActive()) {
			deps.renderer.pulseChromaticAberration(goal.chromatic);
		}
		if (power.chromatic > 0.05) {
			deps.renderer.pulseChromaticAberration(power.chromatic);
		}
		if (sonic.chromatic > 0.05) {
			deps.renderer.pulseChromaticAberration(sonic.chromatic);
		}
		if (epicSave.chromatic > 0.05) {
			deps.renderer.pulseChromaticAberration(epicSave.chromatic);
		}
		if (postHit.chromatic > 0.05) {
			deps.renderer.pulseChromaticAberration(postHit.chromatic);
		}
		applyEpicSaveOverlay(epicSave);
		applyMatchMomentOverlay(moment);
		applySaveAnticipationOverlay(this.saveAnticipation.getPresentation());
		applyPostHitOverlay(postHit);
		return Math.max(cinematicPulse, goal.flash * 0.95 + goal.bloom * 0.35);
	}

	private tickArenaAmbience(
		deps: GameSessionDeps,
		nowSec: number,
		dt: number,
		spectaclePulse: number,
		ballPos?: THREE.Vector3,
	): void {
		const hud = this.match.getHudSnapshot(this.cars);
		const scores = this.match.getScores();
		const scoreDelta = Math.abs(scores.blue - scores.orange);

		this.matchAtmosphere.syncFromMatchPhase(this.match.getPhase(), {
			kickoff:
				this.match.isKickoffDriveLocked() || this.match.isKickoffActive(),
			overtime: hud.isOvertime || hud.overtimeBanner,
			scoringTeam: hud.goalTeam,
			timeline: THREE.MathUtils.clamp(
				this.match.getMatchTime() / MATCH_RULES.durationSec,
				0,
				1,
			),
			timeRemainingSec: hud.timeRemainingSec,
			scoreDelta,
		});

		const drive = this.matchAtmosphere.update(dt);
		deps.renderer.setAtmospherePresentation(
			drive.exposureOffset,
			drive.coolGrade,
			drive.warmGrade,
			drive.bloomBias,
		);

		updateCyberpunkAmbience(
			nowSec,
			dt,
			deps.scene.lighting,
			deps.scene.threeJSScene,
			spectaclePulse,
			drive,
			this.matchAtmosphere.getPhase(),
			ballPos,
		);
	}

	private tickSupersonicBreak(deps: GameSessionDeps, speedMps: number): void {
		if (this.supersonicBreak.sampleCrossing(speedMps)) {
			triggerCrowdSurge("supersonic", { intensity: 0.82 });
			const pos = this.humanCar.player.getPosition();
			pulseArenaBallFocus(pos, 0.78, 2.4);
			this.humanCar.visuals.burstSupersonic(pos);
			deps.renderer.pulseChromaticAberration(0.72);
			deps.audio.playSupersonicBreak(pos);
		}
	}

	tick(
		deps: GameSessionDeps,
		dt: number,
		nowSec: number,
		gameplayFrozen = false,
		opts?: { skipCamera?: boolean },
	): void {
		if (this.online?.role === "guest") {
			this.tickGuest(deps, dt, nowSec, gameplayFrozen, opts);
			return;
		}

		if (gameplayFrozen) {
			this.tickFrozen(deps, dt, nowSec, opts);
			return;
		}

		if (this.match.isReplayActive()) {
			this.tickGoalReplay(deps, dt, nowSec);
			return;
		}

		this.goalSpectacle.update(dt);
		let physicsDt =
			this.match.getPhase() === "goal_bounce"
				? dt * this.goalSpectacle.getSimTimeScale()
				: dt;
		physicsDt *= this.powerShotHighlight.getSimTimeScale();
		physicsDt *= this.demolishHighlight.getSimTimeScale();
		physicsDt *= this.epicSaveHighlight.getSimTimeScale();

		const ballPos = deps.ball.getPosition();
		const ballVel = GameSession._ballVelScratch.set(
			deps.ball.rapierRigidBody.linvel().x,
			deps.ball.rapierRigidBody.linvel().y,
			deps.ball.rapierRigidBody.linvel().z,
		);
		const spec = getModeSpec(this.mode);
		const carsFrozen = this.match.isCarsFrozen();
		const kickoffCountdown = this.match.isKickoffCountdownActive();
		const kickoffDriveLocked = this.match.isKickoffDriveLocked();
		const botCtx = this.buildAIContext(
			ballPos,
			ballVel,
			carsFrozen,
			kickoffCountdown,
			kickoffDriveLocked,
			spec.isFFA,
			spec.teamSize,
		);

		this.ai.beginFrame(botCtx, dt);
		const matchPlaying = this.match.getPhase() === "playing";
		const scoringActive =
			matchPlaying &&
			!kickoffCountdown &&
			!kickoffDriveLocked &&
			!this.match.isKickoffActive();
		this.rush.update(dt, matchPlaying);
		this.overcharge.update(dt, matchPlaying);
		this.zones.update(dt, this.cars, deps.ball, matchPlaying);
		this.tickMeridian(deps, dt, ballPos, scoringActive, nowSec);
		this.applyExperimentalModeEffects(deps, matchPlaying);
		if (matchPlaying && scoringActive) {
			const banterEvent = this.banter.update(
				dt,
				ballPos,
				ballVel,
				this.cars,
				true,
				{
					humanTouched: false,
					humanImpact: 0,
					humanWhiff: false,
					blueScore: this.match.getScores().blue,
					orangeScore: this.match.getScores().orange,
				},
			);
			if (banterEvent) {
				void this.getCommentator(deps.audio).trigger(banterEvent);
			}
		} else {
			this.banter.reset();
		}
		if (!HOVER_SAFE_MODE) {
			this.ignition.update(
				dt,
				this.cars,
				deps.ball,
				carsFrozen || kickoffDriveLocked,
			);
		}

		for (const car of this.cars) {
			car.player.updateBallSteerContext(ballPos);
		}

		const controlOrder = [...this.cars].sort((a, b) =>
			this.online
				? a.slotIndex - b.slotIndex
				: Number(a.isHuman) - Number(b.isHuman),
		);
		for (const car of controlOrder) {
			const input = this.online
				? this.getControlForSlot(car.slotIndex, deps)
				: car.isHuman
					? deps.humanInput
					: undefined;
			car.control(
				dt,
				botCtx,
				this.ai,
				!HOVER_SAFE_MODE && this.ignition.isEnabled() ? this.ignition : null,
				input,
			);
			if (carsFrozen || kickoffDriveLocked) {
				car.freezeInPlace();
			}
		}

		if (deps.humanInput.consumeBallCamToggle()) {
			deps.renderer.toggleBallCam();
		}

		snapshotBallKinematics(deps.ball);
		const physicsStep = deps.scene.advancePhysics(
			physicsDt,
			(fixedDt, substep, substepCount) => {
				if (carsFrozen || kickoffDriveLocked) return;
				for (const car of this.cars) {
					car.player.integrateHover(fixedDt, substep, substepCount);
				}
			},
			(_fixedDt, substep, substepCount) => {
				if (carsFrozen || kickoffDriveLocked) return;
				for (const car of this.cars) {
					car.player.finalizeHoverStep(substep, substepCount);
				}
				/** Meridian: clamp po każdym substepie — mniej tunelowania przez skorupę. */
				this.constrainMeridianBodies(deps);
			},
		);
		const simDt = physicsStep.fixedDt * Math.max(1, physicsStep.steps);

		this.constrainMeridianBodies(deps);

		if (carsFrozen || kickoffDriveLocked) {
			for (const car of this.cars) {
				car.freezeInPlace();
			}
		}

		const matchTime = this.match.getMatchTime();
		this.matchMoments.setMatchTime(matchTime);
		this.matchMoments.sampleSurfaces(
			deps.scene.rapierWorld,
			deps.ball,
			matchTime,
		);

		const preHitBallVel = GameSession._preHitBallVel.set(
			deps.ball.rapierRigidBody.linvel().x,
			deps.ball.rapierRigidBody.linvel().y,
			deps.ball.rapierRigidBody.linvel().z,
		);
		const preHitBallPos = GameSession._preHitBallPos.copy(
			deps.ball.getPosition(),
		);
		const hit = applyCarBallHitsAll(
			deps.scene.rapierWorld,
			this.cars.map((c) => c.player),
			deps.ball,
		);
		if (hit.impact > 4) {
			const hitter = hit.player
				? this.cars.find((c) => c.player === hit.player)
				: undefined;
			deps.hitVfx.trigger(hit.point, hit.impact, {
				team: hitter?.visualTeam,
			});
		}
		if (hit.impact > 0) {
			deps.audio.playBallHit(hit.impact, hit.point);
			triggerBallHitFlash(THREE.MathUtils.clamp(hit.impact / 28, 0.25, 1));
		}
		const humanHitBall = hit.player === this.humanCar.player;
		if (humanHitBall && hit.impact > 0.5) {
			this.banter.noteHumanTouch(hit.impact);
		}
		if (humanHitBall && hit.impact > 0.4) {
			this.coach.noteBallHit(hit.impact);
		}
		if (hit.player && hit.impact > 0) {
			const hitter = this.cars.find((c) => c.player === hit.player);
			if (hitter) {
				this.match.noteBallTouchImpact(hitter.slotIndex, hit.impact, matchTime);
				if (
					this.overcharge.enabled &&
					hit.impact >= 2.2 &&
					this.dribbleTouchSlot === hitter.slotIndex &&
					matchTime - this.dribbleTouchAt < 1.35
				) {
					this.noteOverchargeCharge(hitter.team ?? hitter.visualTeam, "dribble");
				}
				this.dribbleTouchSlot = hitter.slotIndex;
				this.dribbleTouchAt = matchTime;
				const postPos = deps.ball.getPosition();
				const postVel = GameSession._postHitBallVel.set(
					deps.ball.rapierRigidBody.linvel().x,
					deps.ball.rapierRigidBody.linvel().y,
					deps.ball.rapierRigidBody.linvel().z,
				);
				this.match.scoring.onBallHit(
					hitter,
					postPos,
					postVel,
					hit.impact,
					matchTime,
				);
				this.match.scoring.onDefensiveClear(
					hitter,
					preHitBallPos,
					preHitBallVel,
					hit.impact,
					matchTime,
				);
				if (
					evaluateTeamSave(
						hitter.team ?? hitter.visualTeam,
						preHitBallPos,
						preHitBallVel,
						hit.impact,
					)
				) {
					this.noteOverchargeCharge(
						hitter.team ?? hitter.visualTeam,
						"save",
					);
				}
			}
		}
		const epicSaveContext =
			humanHitBall &&
			evaluateEpicSave(
				this.humanCar.team,
				preHitBallPos,
				preHitBallVel,
				hit.impact,
				true,
			);
		if (epicSaveContext) {
			const ownGoal = ownGoalForTeam(this.humanCar.team!);
			this.matchDirector.setMode(getCinematicCameraMode());
			this.matchDirector.request({
				kind: "epicSave",
				focus: preHitBallPos,
				eyeHint: this.humanCar.player.getPosition().clone().add(
					new THREE.Vector3(0, 3.5, 0),
				),
			});
			const toward = ballVelTowardOwnGoal(
				preHitBallPos,
				preHitBallVel,
				ownGoal,
			);
			triggerCrowdSurge("epic_save", {
				intensity: THREE.MathUtils.clamp(0.75 + toward * 0.04, 0.75, 1.15),
			});
			this.epicSaveHighlight.trigger(hit.impact, toward);
			this.ensureJuiceVfx(deps);
			this.epicSaveShockwave!.trigger(preHitBallPos, hit.impact + toward);
			pulseArenaBallFocus(preHitBallPos, 0.88, 2.5);
			void this.getCommentator(deps.audio).trigger("epic_save");
			this.banter.noteHumanSave();
			deps.renderer.pulseChromaticAberration(
				THREE.MathUtils.clamp(0.5 + toward * 0.05, 0.5, 0.95),
			);
			deps.renderer.pulseCoolGrade(0.72);
			deps.renderer.addCameraShake(
				THREE.MathUtils.clamp(0.18 + toward * 0.022, 0.18, 0.55),
			);
		} else if (hit.impact >= POWER_SHOT_IMPACT_MIN && humanHitBall) {
			triggerCrowdSurge("power_shot", {
				intensity: THREE.MathUtils.clamp((hit.impact - 12) / 16, 0.65, 1.1),
			});
			this.powerShotHighlight.trigger(hit.impact);
			deps.ballVfx.triggerPowerShotBoost(hit.impact);
			pulseArenaBallFocus(preHitBallPos, 0.72, 2.1);
			this.ensureJuiceVfx(deps);
			this.impactGroundMarks!.trigger(preHitBallPos, hit.impact);
			deps.hitVfx.trigger(preHitBallPos, hit.impact * 1.2, {
				team: this.humanCar.visualTeam,
			});
			void this.getCommentator(deps.audio).trigger("power_shot");
			if (hit.impact >= POWER_SHOT_IMPACT_MIN + 8) {
				void this.getCommentator(deps.audio).trigger("big_boom");
			}
			deps.renderer.pulseChromaticAberration(
				THREE.MathUtils.clamp((hit.impact - 12) * 0.08, 0.45, 1.1),
			);
			deps.renderer.pulseWarmGrade(
				THREE.MathUtils.clamp(
					(hit.impact - POWER_SHOT_IMPACT_MIN) / 12,
					0.55,
					1,
				),
			);
			deps.renderer.addCameraShake(
				THREE.MathUtils.clamp((hit.impact - 12) * 0.026, 0.14, 0.62),
			);
		}
		if (humanHitBall && hit.impact >= 3 && !epicSaveContext) {
			const hitMoment = this.matchMoments.onHumanBallHit({
				impact: hit.impact,
				ballY: preHitBallPos.y,
				inAir: !this.humanCar.player.isOnGround(),
				flipping: this.humanCar.player.isFlipping(),
				onWall: this.humanCar.player.isOnWallOrRamp(),
			});
			if (hitMoment?.id === "flip_reset") {
				this.ensureJuiceVfx(deps);
				this.flipResetRing!.trigger(preHitBallPos);
				this.matchDirector.setMode(getCinematicCameraMode());
				this.matchDirector.request({
					kind: "flipReset",
					focus: preHitBallPos,
				});
				void this.getCommentator(deps.audio).trigger("flip_reset");
			} else if (hitMoment?.id === "aerial") {
				void this.getCommentator(deps.audio).trigger("aerial");
			}
			this.pulseCrowdForMoment();
		}
		if (hit.impact > 0 && hit.player) {
			const hitter = this.cars.find((c) => c.player === hit.player);
			if (hitter?.team) {
				deps.ballVfx.setTeamTint(hitter.team);
				getStadiumLeds()?.pulseBallHit(hitter.team, hit.impact);
			}
		}
		if (humanHitBall && hit.impact >= 8 && hit.impact < POWER_SHOT_IMPACT_MIN) {
			deps.renderer.addCameraShake(
				THREE.MathUtils.clamp((hit.impact - 8) * 0.014, 0.06, 0.28),
			);
		}
		if (hit.impact > 10) {
			deps.renderer.addCameraShake(
				THREE.MathUtils.clamp((hit.impact - 10) * 0.018, 0.08, 0.45),
			);
		}

		const carHit = applyCarCarHitsAll(
			deps.scene.rapierWorld,
			this.cars.map((c) => c.player),
		);
		if (
			carHit.impact >= DEMOLISH_IMPACT_MIN &&
			carHit.attacker &&
			carHit.victim
		) {
			const attackerCar = this.cars.find((c) => c.player === carHit.attacker);
			if (
				attackerCar?.player.bodyTraitsEnabled &&
				attackerCar.player.bodyTraits.hook === "shockwaveDemo"
			) {
				applyShockwaveDemoImpulse(
					this.cars.map((c) => c.player),
					carHit.point,
					attackerCar.player.bodyTraits,
					carHit.attacker,
				);
			}
			this.noteOverchargeCharge(
				attackerCar?.team ?? attackerCar?.visualTeam,
				"demo",
			);
			const humanAttacker = carHit.attacker === this.humanCar.player;
			const humanVictim = carHit.victim === this.humanCar.player;
			if (humanAttacker || humanVictim) {
				this.banter.noteHumanDemo(humanAttacker);
				const victimCar = this.cars.find((c) => c.player === carHit.victim);
				const victimTeam = victimCar?.visualTeam ?? "orange";
				const humanSpeed = this.humanCar.player.getVelocity().length();
				this.matchDirector.setMode(getCinematicCameraMode());
				this.matchDirector.request({
					kind: "demo",
					focus: carHit.point,
					eyeHint: carHit.attacker.getPosition().clone().add(
						new THREE.Vector3(0, 2.8, 0),
					),
				});
				if (humanAttacker && humanSpeed >= SUPERSONIC_MPS) {
					triggerCrowdSurge("demolish", { intensity: 1.05 });
					this.matchMoments.onHumanDemo(carHit.impact, humanSpeed);
					this.pulseCrowdForMoment();
				} else if (humanAttacker) {
					triggerCrowdSurge("demolish", { intensity: 0.92 });
				}
				this.ensureJuiceVfx(deps);
				this.demoDebris!.trigger(carHit.point, victimTeam, carHit.impact);
				this.demolishShockwave!.trigger(
					carHit.point,
					victimTeam,
					carHit.impact,
				);
				victimCar?.visuals.triggerDemolishFlash(carHit.impact);
				if (humanAttacker) {
					attackerCar?.visuals.triggerDemolishFlash(carHit.impact * 0.65);
				}
				this.demolishHighlight.trigger(
					carHit.impact,
					humanAttacker ? "attacker" : "victim",
				);
				void this.getCommentator(deps.audio).trigger("demolish");
				deps.hitVfx.trigger(carHit.point, carHit.impact * 1.35, {
					team: attackerCar?.visualTeam,
				});
				deps.renderer.pulseSpectacle(
					THREE.MathUtils.clamp((carHit.impact - 9) * 0.08, 0.45, 0.95),
				);
				deps.renderer.addCameraShake(
					THREE.MathUtils.clamp((carHit.impact - 9) * 0.042, 0.22, 0.78),
				);
			}
		}

		const scored = this.match.update(
			physicsDt,
			deps.scene.rapierWorld,
			deps.ball,
			this.cars,
			deps.ballRadius,
			this.carHalfHeight,
		);
		if (scored !== null) {
			this.recordReplaySamples(deps, this.match.getMatchTime());
			const humanTeam = this.humanCar.team ?? this.humanCar.visualTeam;
			if (humanTeam && scored !== humanTeam && !spec.isFFA) {
				const ownGoal = ownGoalForTeam(humanTeam);
				this.coach.noteGoalConceded({
					ownGoalDist: this.humanCar.player
						.getPosition()
						.distanceTo(ownGoal),
					boostFuel: this.humanCar.player.getBoostFuel(),
				});
			}
			const goalMoment = this.match.consumeGoalMomentSnapshot();
			let scorerSlot: number | null = null;
			if (goalMoment) {
				scorerSlot = goalMoment.touch.scorerSlot;
				this.matchMoments.onGoal({
					scoringTeam: goalMoment.scoringTeam,
					touch: goalMoment.touch,
					cars: this.cars,
					humanCar: this.humanCar,
					mode: this.mode,
					isOvertime: goalMoment.isOvertime,
					isGoldenGoal: goalMoment.isGoldenGoal,
					isKickoffWindow: goalMoment.isKickoffWindow,
					timeRemainingSec: goalMoment.timeRemainingSec,
					matchEndsAfterGoal: goalMoment.matchEndsAfterGoal,
					ignition: this.ignition,
				});
				const moment = this.matchMoments.highlight.getPresentation();
				if (moment.shake > 0) {
					deps.renderer.addCameraShake(moment.shake);
				}
				this.pulseCrowdForMoment();
			}
			this.fireGoalSpectacle(deps, scored, deps.ball.getPosition(), {
				scorerSlot,
			});
			this.ignition.resetAll();
			BotLearning.get().onGoal(scored, this.cars);
		}

		const snap = this.match.getHudSnapshot(this.cars);
		if (snap.overtimeBanner && !this.lastOvertimeBanner) {
			void this.getCommentator(deps.audio).trigger("overtime");
		}
		this.lastOvertimeBanner = snap.overtimeBanner;

		if (snap.phase === "playing" || snap.phase === "countdown") {
			this.tickCoach(deps, physicsDt, ballPos, ballVel);
		}

		this.tickClockCommentary(
			deps.audio,
			snap.timeRemainingSec,
			snap.phase,
			snap.isOvertime,
		);

		if (this.lastMatchPhase !== "finished" && snap.phase === "finished") {
			if (!this.lastFinishedComment) {
				this.lastFinishedComment = true;
				void this.getCommentator(deps.audio).trigger("match_end");
			}
			BotLearning.get().onMatchEnd(snap.blueScore, snap.orangeScore, this.cars);
			if (
				this.online?.role === "host" &&
				this.online.ranked &&
				!this.rankedReportSent
			) {
				this.rankedReportSent = true;
				this.online.roomClient.reportMatch(snap.blueScore, snap.orangeScore);
			}
			processMatchEnd({
				blueScore: snap.blueScore,
				orangeScore: snap.orangeScore,
				humanTeam: this.humanCar.team ?? this.humanCar.visualTeam,
				modeId: this.mode,
				online: Boolean(this.online),
				ranked: Boolean(this.online?.ranked),
				coachHints: this.coach.summarize(),
			});
			this.coach.reset();
		}
		this.lastMatchPhase = snap.phase;
		this.syncKickoffCountdownAudio(deps, snap);
		const human = this.humanCar.player;
		deps.hud.update(
			{
				boost: human.getBoostFuel(),
				speedMps: human.getVelocity().length(),
				ballCam: deps.renderer.isBallCamEnabled(),
				boosting: deps.humanInput.isBoosting(),
				blueScore: snap.blueScore,
				orangeScore: snap.orangeScore,
				goalTeam: this.match.consumeLastGoal(),
				resetCountdown: snap.resetCountdown,
				matchTimeSec: snap.timeRemainingSec,
				matchPhase: snap.phase,
				countdownSec: snap.countdownSec,
				kickoffTick: snap.kickoffTick,
				kickoffIgnite: snap.kickoffIgnite,
				overtimeBanner: snap.overtimeBanner,
				isOvertime: snap.isOvertime,
				isFFA: snap.isFFA,
				ffaScores: snap.ffaScores,
				goalScorerName: snap.goalScorerName,
				winnerLabel: snap.winnerLabel,
				modeLabel: this.onlineModeLabel(spec.label),
				rankedSubtitle: this.rankedEloLine,
				replayActive: snap.replayActive,
				goalSpectacle: this.goalSpectacle.isActive(),
				...this.rematchHudFlags(snap.phase),
				...this.powerUpHudFields(),
				...this.experimentalHudFields(),
				...this.rankedHudFields(),
				...this.juiceHudFields(
					snap.phase,
					snap.timeRemainingSec,
					snap.isOvertime,
				),
			},
			dt,
		);

		updateBallPhysics(
			deps.ball,
			deps.ballRadius,
			simDt,
			deps.scene.rapierWorld,
		);
		const liveBallPos = deps.ball.getPosition();
		const liveBallVel = GameSession._ballVelScratch.set(
			deps.ball.rapierRigidBody.linvel().x,
			deps.ball.rapierRigidBody.linvel().y,
			deps.ball.rapierRigidBody.linvel().z,
		);
		if (
			this.postHitHighlight.sample(
				liveBallPos,
				liveBallVel,
				deps.ballRadius,
				dt,
			)
		) {
			this.ensureJuiceVfx(deps);
			this.postHitSparks!.trigger(
				liveBallPos,
				this.postHitHighlight.getImpact(),
			);
			deps.hitVfx.trigger(
				liveBallPos,
				this.postHitHighlight.getImpact() * 0.95,
			);
			triggerCrowdSurge("match_moment", { intensity: 0.82 });
			deps.renderer.addCameraShake(0.34);
			deps.renderer.pulseChromaticAberration(0.58);
			deps.audio.playPostHit(liveBallPos);
			void this.getCommentator(deps.audio).trigger("post_hit");
			void this.getCommentator(deps.audio).trigger("near_miss");
		}
		this.updateSceneJuice(
			deps,
			dt,
			liveBallPos,
			liveBallVel,
			snap.phase,
			snap.timeRemainingSec,
			snap.isOvertime,
		);
		this.tickBoostLowWarning(deps);

		this.tickBoostPads(deps, dt);
		this.tickIgnitionZones(deps, dt);
		this.tickQuickChat(deps, dt);

		for (const car of this.cars) {
			car.player.afterPhysics(simDt);
			stabilizePlayerPhysics(car.player);
			const landing = car.player.consumeLandingPulse();
			if (landing > 0) {
				car.visuals.triggerLanding(car.player.getPosition(), landing);
				if (car.isHuman && landing > 0.35) {
					deps.renderer.addCameraShake(
						THREE.MathUtils.clamp(landing * 0.26, 0.08, 0.32),
					);
				}
			}
			car.visuals.update(
				car.player,
				car.isHuman ? deps.humanInput.isBoosting() : car.isBoosting(),
				dt,
				deps.renderer.threeJSCamera,
			);
		}
		this.updateCarPowerUpVisuals(deps, liveBallPos, dt);

		deps.physicsTelemetry?.tick(this.humanCar.player, {
			renderDt: dt,
			fixedDt: physicsStep.fixedDt,
			steps: physicsStep.steps,
		});

		deps.scene.focusShadowOn(this.humanCar.player.getPosition());
		this.updateBallTracking(deps, dt, liveBallPos, liveBallVel);

		const speedMps = human.getVelocity().length();
		this.tickSupersonicBreak(deps, speedMps);
		deps.audio.updateEngine(
			speedMps,
			deps.humanInput.forward(),
			deps.humanInput.isBoosting(),
		);

		this.applyMatchCamera(
			deps,
			dt,
			deps.humanInput.isBoosting(),
			deps.ball.getPosition(),
			liveBallVel,
			snap.phase === "goal_bounce",
		);

		if (this.match.shouldRecordReplay()) {
			this.recordReplaySamples(deps, this.match.getMatchTime());
		}

		this.sendNetworkSnapshot(deps, dt);
		const atmospherePulse = this.applyGoalSpectacleFrame(
			deps,
			dt,
			speedMps,
			deps.humanInput.isBoosting(),
			liveBallPos,
			liveBallVel,
		);
		this.tickArenaAmbience(deps, nowSec, dt, atmospherePulse, liveBallPos);
	}

	private tickGuest(
		deps: GameSessionDeps,
		dt: number,
		nowSec: number,
		gameplayFrozen: boolean,
		opts?: { skipCamera?: boolean },
	): void {
		if (!gameplayFrozen) {
			const snap = this.stateInterpolator.sample();
			if (snap?.match.kickoffTick == null) {
				this.online?.roomClient.sendInputFromGameInput(deps.humanInput);
			}
		}

		const snapshot = this.stateInterpolator.sample();
		if (!snapshot) {
			this.tickFrozen(deps, dt, nowSec, opts);
			return;
		}

		const m = snapshot.match;
		this.match.syncGuestReplayPhase(m.replayActive);
		if (m.replayActive) {
			this.tickGoalReplay(deps, dt, nowSec);
			return;
		}

		const humanSlot = this.online?.localSlot ?? this.humanCar.slotIndex;
		const predictHuman = guestPredictionActive(snapshot.match);

		applyWorldSnapshot(snapshot, deps.ball, this.cars, this.match, {
			skipSlots: predictHuman ? [humanSlot] : undefined,
		});

		if (predictHuman) {
			this.humanCar.player.control(deps.humanInput, dt);
			this.guestReconcile.reconcile(this.humanCar.slotIndex, this.humanCar, dt);
		} else {
			const humanSnap = snapshot.cars.find((c) => c.slot === humanSlot);
			if (humanSnap) {
				this.guestReconcile.ingestAuthority(
					humanSlot,
					humanSnap,
					this.humanCar,
				);
			}
		}

		for (const car of this.cars) {
			const boosting =
				car.slotIndex === this.humanCar.slotIndex
					? deps.humanInput.isBoosting()
					: (snapshot.cars.find((c) => c.slot === car.slotIndex)?.boosting ??
						false);
			car.visuals.update(car.player, boosting, dt, deps.renderer.threeJSCamera);
		}

		if (deps.humanInput.consumeBallCamToggle()) {
			deps.renderer.toggleBallCam();
		}

		const spec = getModeSpec(this.mode);
		const human = this.humanCar.player;
		this.syncGuestKickoffAudio(deps, m);

		if (m.overtimeBanner && !this.lastOvertimeBanner) {
			void this.getCommentator(deps.audio).trigger("overtime");
		}
		this.lastOvertimeBanner = m.overtimeBanner;
		this.tickClockCommentary(
			deps.audio,
			m.timeRemainingSec,
			m.phase,
			m.isOvertime,
		);
		if (m.phase === "finished" && !this.lastFinishedComment) {
			this.lastFinishedComment = true;
			void this.getCommentator(deps.audio).trigger("match_end");
		}

		const ballPos = snapshotBallPosition(snapshot);
		if (m.blueScore > this.lastGuestBlueScore) {
			this.fireGoalSpectacle(deps, "blue", ballPos);
		} else if (m.orangeScore > this.lastGuestOrangeScore) {
			this.fireGoalSpectacle(deps, "orange", ballPos);
		}
		this.lastGuestBlueScore = m.blueScore;
		this.lastGuestOrangeScore = m.orangeScore;

		const guestGoalTeam = this.goalSpectacle.isActive()
			? this.goalSpectacle.getTeam()
			: null;

		deps.hud.update(
			{
				boost: human.getBoostFuel(),
				speedMps: human.getVelocity().length(),
				ballCam: deps.renderer.isBallCamEnabled(),
				boosting: deps.humanInput.isBoosting(),
				blueScore: m.blueScore,
				orangeScore: m.orangeScore,
				goalTeam: guestGoalTeam,
				resetCountdown: m.resetCountdown,
				matchTimeSec: m.timeRemainingSec,
				matchPhase: m.phase,
				countdownSec: m.countdownSec,
				kickoffTick: m.kickoffTick,
				kickoffIgnite: m.kickoffIgnite,
				overtimeBanner: m.overtimeBanner,
				isOvertime: m.isOvertime,
				isFFA: false,
				ffaScores: [],
				goalScorerName: m.goalScorerName,
				winnerLabel: m.winnerLabel,
				modeLabel: this.onlineModeLabel(spec.label),
				rankedSubtitle: this.rankedEloLine,
				replayActive: m.replayActive,
				goalSpectacle: this.goalSpectacle.isActive(),
				...this.rematchHudFlags(m.phase),
				...this.powerUpHudFields(),
				...this.experimentalHudFields(),
				...this.rankedHudFields(),
				...this.juiceHudFields(m.phase, m.timeRemainingSec, m.isOvertime),
			},
			dt,
		);

		const ballVel = snapshotBallVelocity(snapshot);
		this.updateSceneJuice(
			deps,
			dt,
			ballPos,
			ballVel,
			m.phase,
			m.timeRemainingSec,
			m.isOvertime,
		);
		this.tickBoostLowWarning(deps);
		deps.scene.focusShadowOn(this.humanCar.player.getPosition());
		this.updateBallTracking(deps, dt, ballPos, ballVel);

		const speedMps = human.getVelocity().length();
		this.tickSupersonicBreak(deps, speedMps);
		deps.audio.updateEngine(
			speedMps,
			deps.humanInput.forward(),
			deps.humanInput.isBoosting(),
		);

		if (m.replayActive) {
			deps.renderer.followReplayBall(ballPos, ballVel, dt);
		} else if (!opts?.skipCamera) {
			if (this.wasGuestReplayActive) {
				deps.renderer.snapChaseCamera(human, ballPos);
			}
			this.applyMatchCamera(
				deps,
				dt,
				deps.humanInput.isBoosting(),
				ballPos,
				ballVel,
				m.phase === "goal_bounce",
			);
		}
		this.wasGuestReplayActive = m.replayActive;

		const atmospherePulse = this.applyGoalSpectacleFrame(
			deps,
			dt,
			speedMps,
			deps.humanInput.isBoosting(),
			ballPos,
			ballVel,
		);
		this.tickArenaAmbience(deps, nowSec, dt, atmospherePulse, ballPos);
	}

	private syncGuestKickoffAudio(
		deps: GameSessionDeps,
		m: ReturnType<typeof buildWorldSnapshot>["match"],
	): void {
		const key = m.kickoffIgnite
			? "ignite"
			: m.kickoffTick !== null
				? `t${m.kickoffTick}`
				: "";
		if (!key) {
			this.lastGuestKickoffKey = "";
			return;
		}
		if (key === this.lastGuestKickoffKey) return;
		this.lastGuestKickoffKey = key;
		if (m.kickoffIgnite) {
			deps.audio.playCountdownIgnite();
			deps.renderer.pulseKickoffIgnite();
			void this.getCommentator(deps.audio).trigger("countdown_go");
		} else if (m.kickoffTick !== null) {
			deps.audio.playCountdownTick(m.kickoffTick);
		}
	}

	private recordReplaySamples(deps: GameSessionDeps, t: number): void {
		if (!this.match.shouldRecordReplay()) return;
		this.replayRecorder.record(t, deps.ball, this.cars);
		this.inputRecorder.record(t, this.cars, (slot) =>
			this.getControlForSlot(slot, deps),
		);
	}

	private startGoalReplayClip(deps: GameSessionDeps): void {
		const goalT = this.match.getGoalEventTime();
		const fromT = goalT - this.match.getReplayPreSec();
		const toT = goalT + this.match.getReplayPostSec();
		const goalCrossTime = this.replayRecorder.getClipGoalCrossTime(
			fromT,
			toT,
			goalT,
		);

		const guestClip =
			this.online?.role === "guest" ? this.guestReplayClip : null;
		const anchor = this.replayRecorder.getAnchorFrame(fromT, toT);
		const inputClip =
			guestClip ??
			(anchor
				? this.inputRecorder.buildClip(fromT, toT, anchor, goalCrossTime)
				: null);

		/**
		 * Lokalnie: zawsze wizualny klip (wierny strzałowi).
		 * Physics replay tylko online (host sync / guest clip) — resymulacja
		 * AI/inputów często gubi moment strzału (piłka „stoi”).
		 */
		const preferPhysics =
			!!guestClip ||
			(this.online?.role === "host" &&
				!!inputClip &&
				inputClip.inputs.length >= 2);

		if (preferPhysics && inputClip && inputClip.inputs.length >= 2) {
			this.physicsReplayPlayer.setClip(inputClip, this.cars, deps.ball, {
				goalCrossTime,
			});
			this.usePhysicsReplay = this.physicsReplayPlayer.isPlaying;
			if (this.usePhysicsReplay && this.online?.role === "host") {
				this.online.roomClient.sendGoalReplayClip(inputClip);
			}
		} else {
			this.usePhysicsReplay = false;
			const clip = this.replayRecorder.buildClip(fromT, toT, goalT);
			this.replayPlayer.setClip(clip, this.cars, { goalCrossTime });
			if (
				this.online?.role === "host" &&
				inputClip &&
				inputClip.inputs.length >= 2
			) {
				/** Host i tak wysyła input-clip dla gościa. */
				this.online.roomClient.sendGoalReplayClip(inputClip);
			}
		}

		deps.ballVfx.resetTrail();
		cancelGoalFlood(deps.scene.lighting);
		clearGoalSpectacleOverlay();
		deps.renderer.resetGoalPresentation();
		const replayDuration = this.usePhysicsReplay
			? this.physicsReplayPlayer.getDuration()
			: this.replayPlayer.getDuration();
		const scoringTeam = this.match.getLastScoringTeam();
		if (scoringTeam) {
			const goalCrossNorm =
				replayDuration > 0.01
					? THREE.MathUtils.clamp(goalCrossTime / replayDuration, 0.15, 0.92)
					: 0.72;
			this.goalSpectacle.triggerForReplay(
				scoringTeam,
				this.lastGoalSpectaclePos,
				goalCrossNorm,
			);
		}
		this.replaySessionActive = true;
		deps.renderer.endGoalOrbit();
		deps.renderer.beginReplayCamera(goalCrossTime, replayDuration);
		if (!this.usePhysicsReplay && !this.replayPlayer.isPlaying) {
			this.match.finishReplay();
			this.finishGoalReplaySession(deps);
			return;
		}
		if (this.usePhysicsReplay && !this.physicsReplayPlayer.isPlaying) {
			this.match.finishReplay();
			this.finishGoalReplaySession(deps);
			return;
		}
	}

	private finishGoalReplaySession(deps: GameSessionDeps): void {
		this.replaySessionActive = false;
		this.replayPlayer.stop();
		this.physicsReplayPlayer.stop();
		this.usePhysicsReplay = false;
		this.guestReplayClip = null;
		this.goalSpectacle.endReplay();
		clearGoalSpectacleOverlay();
		deps.renderer.resetGoalPresentation();
		deps.renderer.snapChaseCamera(
			this.humanCar.player,
			deps.ball.getPosition(),
		);
	}

	private tickGoalReplay(
		deps: GameSessionDeps,
		dt: number,
		nowSec: number,
	): void {
		if (!this.replaySessionActive) {
			this.startGoalReplayClip(deps);
		}

		if (deps.humanInput.consumeReplaySkip()) {
			this.match.skipReplay();
			this.finishGoalReplaySession(deps);
			return;
		}

		let replayDone: boolean;
		if (this.usePhysicsReplay) {
			replayDone = this.physicsReplayPlayer.update(
				dt,
				{ scene: deps.scene, ball: deps.ball, ballRadius: deps.ballRadius },
				this.cars,
			);
		} else {
			replayDone = this.replayPlayer.update(dt, deps.ball, this.cars);
		}
		if (replayDone) {
			this.match.finishReplay();
			this.finishGoalReplaySession(deps);
			return;
		}

		for (const car of this.cars) {
			car.visuals.update(car.player, false, dt, deps.renderer.threeJSCamera);
		}
		const replayBallPos = this.usePhysicsReplay
			? this.physicsReplayPlayer.ballPosition(new THREE.Vector3(), deps.ball)
			: this.replayPlayer.ballPosition(new THREE.Vector3());
		this.updateCarPowerUpVisuals(deps, replayBallPos, dt);

		const snap = this.match.getHudSnapshot(this.cars);
		const spec = getModeSpec(this.mode);
		deps.hud.update(
			{
				boost: this.humanCar.player.getBoostFuel(),
				speedMps: 0,
				ballCam: deps.renderer.isBallCamEnabled(),
				boosting: false,
				blueScore: snap.blueScore,
				orangeScore: snap.orangeScore,
				goalTeam: null,
				resetCountdown: snap.resetCountdown,
				matchTimeSec: snap.timeRemainingSec,
				matchPhase: snap.phase,
				countdownSec: snap.countdownSec,
				kickoffTick: snap.kickoffTick,
				kickoffIgnite: snap.kickoffIgnite,
				overtimeBanner: snap.overtimeBanner,
				isOvertime: snap.isOvertime,
				isFFA: snap.isFFA,
				ffaScores: snap.ffaScores,
				goalScorerName: null,
				winnerLabel: snap.winnerLabel,
				modeLabel: this.onlineModeLabel(spec.label),
				rankedSubtitle: this.rankedEloLine,
				replayActive: true,
				goalSpectacle: this.goalSpectacle.isActive(),
				...this.rematchHudFlags(snap.phase),
				...this.powerUpHudFields(),
				...this.experimentalHudFields(),
				...this.rankedHudFields(),
				...this.juiceHudFields(
					snap.phase,
					snap.timeRemainingSec,
					snap.isOvertime,
				),
			},
			dt,
		);

		const ballPos = this.usePhysicsReplay
			? this.physicsReplayPlayer.ballPosition(new THREE.Vector3(), deps.ball)
			: this.replayPlayer.ballPosition(new THREE.Vector3());
		const ballVel = this.usePhysicsReplay
			? this.physicsReplayPlayer.ballVelocity(new THREE.Vector3(), deps.ball)
			: this.replayPlayer.ballVelocity(new THREE.Vector3());
		const replayProgress = this.usePhysicsReplay
			? this.physicsReplayPlayer.getProgress()
			: this.replayPlayer.getProgress();
		const replayGoalTeam =
			this.goalSpectacle.consumeReplayGoalCross(replayProgress);
		if (replayGoalTeam) {
			this.match.triggerReplayGoalVfx(replayGoalTeam);
		}
		this.updateSceneJuice(
			deps,
			dt,
			ballPos,
			ballVel,
			snap.phase,
			snap.timeRemainingSec,
			snap.isOvertime,
		);
		this.updateBallTracking(deps, dt, ballPos, ballVel);
		deps.renderer.followReplayBall(ballPos, ballVel, dt, replayProgress);
		this.sendNetworkSnapshot(deps, dt);
		const atmospherePulse = this.applyGoalSpectacleFrame(
			deps,
			dt,
			0,
			false,
			ballPos,
			ballVel,
		);
		this.tickArenaAmbience(deps, nowSec, dt, atmospherePulse, ballPos);
	}

	private syncKickoffCountdownAudio(
		deps: GameSessionDeps,
		snap: ReturnType<MatchController["getHudSnapshot"]>,
	): void {
		const key = snap.kickoffIgnite
			? "ignite"
			: snap.kickoffTick !== null
				? `t${snap.kickoffTick}`
				: "";
		if (!key) {
			this.lastCountdownSoundKey = "";
			return;
		}
		if (key === this.lastCountdownSoundKey) return;
		this.lastCountdownSoundKey = key;
		if (snap.kickoffIgnite) {
			deps.audio.playCountdownIgnite();
			deps.renderer.pulseKickoffIgnite();
			void this.getCommentator(deps.audio).trigger("countdown_go");
		} else if (snap.kickoffTick !== null) {
			deps.audio.playCountdownTick(snap.kickoffTick);
		}
	}

	private tickFrozen(
		deps: GameSessionDeps,
		dt: number,
		nowSec: number,
		opts?: { skipCamera?: boolean },
	): void {
		const spec = getModeSpec(this.mode);
		const snap = this.match.getHudSnapshot(this.cars);
		this.syncKickoffCountdownAudio(deps, snap);
		const human = this.humanCar.player;

		for (const car of this.cars) {
			car.player.syncWithRigidBody();
			car.freezeInPlace();
			car.visuals.update(car.player, false, dt, deps.renderer.threeJSCamera);
		}
		this.updateCarPowerUpVisuals(deps, deps.ball.getPosition(), dt);

		deps.hud.update(
			{
				boost: human.getBoostFuel(),
				speedMps: 0,
				ballCam: deps.renderer.isBallCamEnabled(),
				boosting: false,
				blueScore: snap.blueScore,
				orangeScore: snap.orangeScore,
				goalTeam: null,
				resetCountdown: snap.resetCountdown,
				matchTimeSec: snap.timeRemainingSec,
				matchPhase: snap.phase,
				countdownSec: snap.countdownSec,
				kickoffTick: snap.kickoffTick,
				kickoffIgnite: snap.kickoffIgnite,
				overtimeBanner: snap.overtimeBanner,
				isOvertime: snap.isOvertime,
				isFFA: snap.isFFA,
				ffaScores: snap.ffaScores,
				goalScorerName: null,
				winnerLabel: snap.winnerLabel,
				modeLabel: this.onlineModeLabel(spec.label),
				rankedSubtitle: this.rankedEloLine,
				replayActive: snap.replayActive,
				...this.rematchHudFlags(snap.phase),
				...this.powerUpHudFields(),
				...this.experimentalHudFields(),
				...this.rankedHudFields(),
				...this.juiceHudFields(
					snap.phase,
					snap.timeRemainingSec,
					snap.isOvertime,
				),
			},
			dt,
		);

		const frozenBallPos = deps.ball.getPosition();
		const frozenBallVel = GameSession._ballVelScratch.set(
			deps.ball.rapierRigidBody.linvel().x,
			deps.ball.rapierRigidBody.linvel().y,
			deps.ball.rapierRigidBody.linvel().z,
		);
		this.updateSceneJuice(
			deps,
			dt,
			frozenBallPos,
			frozenBallVel,
			snap.phase,
			snap.timeRemainingSec,
			snap.isOvertime,
		);

		this.updateBallTracking(deps, dt, frozenBallPos, frozenBallVel);

		if (!opts?.skipCamera) {
			this.applyMatchCamera(
				deps,
				dt,
				false,
				deps.ball.getPosition(),
				frozenBallVel,
				snap.phase === "goal_bounce",
			);
		}

		this.sendNetworkSnapshot(deps, dt);
		const atmospherePulse = this.applyGoalSpectacleFrame(
			deps,
			dt,
			0,
			false,
			frozenBallPos,
			frozenBallVel,
		);
		this.tickArenaAmbience(deps, nowSec, dt, atmospherePulse, frozenBallPos);
	}

	private sendNetworkSnapshot(deps: GameSessionDeps, dt: number): void {
		if (this.online?.role !== "host") return;
		this.snapshotAccumulator += dt;
		const interval = 1 / SNAPSHOT_RATE_HZ;
		while (this.snapshotAccumulator >= interval) {
			this.snapshotAccumulator -= interval;
			this.online.roomClient.sendSnapshot(
				buildWorldSnapshot(++this.netTick, deps.ball, this.cars, this.match),
			);
		}
	}

	private updateBallTracking(
		deps: GameSessionDeps,
		dt: number,
		ballPos: THREE.Vector3,
		ballVel: THREE.Vector3,
	): void {
		deps.ballShadow.update(ballPos);
		deps.ballFloorIndicator.update(ballPos, ballVel);
		updateBallMaterialView(deps.renderer.threeJSCamera, dt);
		deps.ballVfx.update(deps.ball, dt);
		deps.hitVfx.update(dt);
		deps.powerUpActivationVfx.update(dt);
		deps.ballWallMarkVfx.updateBallProximity(ballPos, ballVel, dt);
		deps.ballOffScreen.update(
			ballPos,
			deps.renderer.threeJSCamera,
			deps.renderer.isBallCamEnabled(),
			dt,
		);
	}

	private buildAIContext(
		ballPos: THREE.Vector3,
		ballVel: THREE.Vector3,
		carsFrozen: boolean,
		kickoffCountdown: boolean,
		kickoffDriveLocked: boolean,
		isFFA: boolean,
		teamSize: number,
	) {
		return {
			ballPos,
			ballVel,
			kickoffActive: this.match.isKickoffActive(),
			kickoffCountdown,
			kickoffDriveLocked,
			carsFrozen,
			isFFA,
			teamSize,
			peers: this.cars.map((c) => ({
				slotIndex: c.slotIndex,
				team: c.team,
				position: c.player.getPosition(),
				isHuman: c.isHuman,
				spawnRole: c.spawnRole,
			})),
			boostPads: this.boostPads.getPadStates().map((p) => ({
				x: p.x,
				z: p.z,
				big: p.big,
				active: p.active,
			})),
		};
	}
}

function countMatchCarsInScene(scene: THREE.Scene): number {
	let count = 0;
	scene.traverse((obj) => {
		if (obj.name !== "octaneCarDisplay") return;
		if (typeof obj.userData.carId === "string") count++;
	});
	return count;
}
