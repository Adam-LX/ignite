import * as THREE from "three";
import { AIManager } from "../ai/AIManager";
import { BotLearning } from "../ai/learning/BotLearning";
import type { GameAudio } from "../audio/GameAudio";
import { HOVER_SAFE_MODE } from "../debug/config";
import type { PhysicsTelemetry } from "../diagnostic/physicsTelemetry";
import type GameObject from "../GameObject";
import { t } from "../i18n";
import type { PowerUpHudState } from "../modes/IgnitionManager";
import { IgnitionManager } from "../modes/IgnitionManager";
import { MatchController, type MatchPhase } from "../modes/MatchController";
import type { NetworkControlInput } from "../net/NetworkControlInput";
import type { OnlineRole } from "../net/protocol";
import { SNAPSHOT_RATE_HZ } from "../net/protocol";
import type { RoomClient } from "../net/RoomClient";
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
import type { RlHud, RlHudState } from "../ui/RlHud";
import type { ControlInput } from "../util/ControlInput";
import type GameInput from "../util/GameInput";
import Player from "../util/Player";
import {
	applyCarBallHitsAll,
	applyCarCarHitsAll,
	snapshotBallKinematics,
	stabilizePlayerPhysics,
	updateBallPhysics,
} from "../util/rlContacts";
import { getObjectSize } from "../util/ThreeJSHelpers";
import { updateCyberpunkAmbience } from "../visual/arena";
import type { BallShadow } from "../visual/ballShadow";
import type { BallFloorIndicator } from "../visual/ballTracking/BallFloorIndicator";
import {
	CarVisuals,
	cloneCarMesh,
	disposeCarMeshGroup,
	loadCarModel,
} from "../visual/carVisuals";
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
	ownGoalForTeam,
} from "../visual/epicSaveHighlight";
import {
	applyGoalSpectacleOverlay,
	GoalSpectacle,
} from "../visual/goalSpectacle";
import { MatchMomentsController } from "../visual/matchMoments/MatchMomentsController";
import { applyMatchMomentOverlay } from "../visual/matchMoments/matchMoments";
import {
	triggerBallHitFlash,
	updateBallMaterialView,
} from "../visual/materials";
import {
	applyPowerShotOverlay,
	POWER_SHOT_IMPACT_MIN,
	PowerShotHighlight,
} from "../visual/powerShotHighlight";
import { triggerGoalFlood } from "../visual/stadiumLighting";
import {
	applySupersonicOverlay,
	SUPERSONIC_MPS,
	SupersonicBreak,
} from "../visual/supersonicBreak";
import type { BallVfx } from "../visual/vfx/ballVfx";
import type { BallWallMarkVfx } from "../visual/vfx/ballWallMark";
import type { HitVfx } from "../visual/vfx/hitVfx";
import { CarEntity } from "./CarEntity";
import { GoalReplayPlayer, GoalReplayRecorder } from "./GoalReplay";
import type { GameModeId, ScoringTeam } from "./modes";
import { getModeSpec, isIgnitionMode } from "./modes";

export type OnlineSessionConfig = {
	role: OnlineRole;
	localSlot: number;
	roomClient: RoomClient;
	remoteInput: NetworkControlInput;
	ranked: boolean;
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
	ballWallMarkVfx: BallWallMarkVfx;
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
	readonly humanCar: CarEntity;
	readonly online: OnlineSessionConfig | null;

	private carHalfHeight = 1.35;
	private lastCountdownSoundKey = "";
	private readonly replayRecorder = new GoalReplayRecorder();
	private readonly replayPlayer = new GoalReplayPlayer();
	private replaySessionActive = false;
	private snapshotAccumulator = 0;
	private netTick = 0;
	private readonly stateInterpolator = new StateInterpolator();
	private lastGuestKickoffKey = "";
	private lastMatchPhase = "countdown";
	private rankedReportSent = false;
	private rankedEloLine: string | null = null;
	private readonly goalSpectacle = new GoalSpectacle();
	private readonly lastGoalSpectaclePos = new THREE.Vector3();
	private readonly supersonicBreak = new SupersonicBreak();
	private readonly powerShotHighlight = new PowerShotHighlight();
	private readonly demolishHighlight = new DemolishHighlight();
	private readonly epicSaveHighlight = new EpicSaveHighlight();
	private readonly matchMoments = new MatchMomentsController();
	private lastGuestBlueScore = 0;
	private lastGuestOrangeScore = 0;

	private constructor(
		readonly mode: GameModeId,
		humanCar: CarEntity,
		match: MatchController,
		ai: AIManager,
		ignition: IgnitionManager,
		cars: CarEntity[],
		carHalfHeight: number,
		online: OnlineSessionConfig | null = null,
	) {
		this.humanCar = humanCar;
		this.match = match;
		this.ai = ai;
		this.ignition = ignition;
		this.cars.push(...cars);
		this.carHalfHeight = carHalfHeight;
		this.online = online;
	}

	static async create(
		mode: GameModeId,
		deps: GameSessionDeps,
	): Promise<GameSession> {
		deps.scene.purgeMenuDecorations();

		const match = new MatchController(deps.scene.threeJSScene, mode);
		const ai = new AIManager();
		const ignition = new IgnitionManager(isIgnitionMode(mode), {
			botsUsePowerUps: mode !== "ignition1v1",
		});
		ignition.bindBall(deps.ball);
		const spec = getModeSpec(mode);

		const blueTemplate = await loadCarModel("blue");
		const orangeTemplate = await loadCarModel("orange");
		const carHalfHeight = getObjectSize(blueTemplate).y * 0.5;
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
				const mesh = cloneCarMesh(
					spawn.visualTeam === "blue" ? blueTemplate : orangeTemplate,
				);
				const player = new Player(deps.scene, mesh as unknown as THREE.Mesh);
				const visuals = new CarVisuals(
					player.threeJSGroup,
					player.visualRoot,
					deps.scene.threeJSScene,
					spawn.visualTeam,
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

				ignition.registerSlot(spawn.slotIndex);

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
			disposeCarMeshGroup(blueTemplate);
			disposeCarMeshGroup(orangeTemplate);
			throw err;
		}

		disposeCarMeshGroup(blueTemplate);
		disposeCarMeshGroup(orangeTemplate);
		deps.scene.purgeMenuDecorations();

		if (!humanCar) {
			throw new Error("Brak humanCar — slot 0 musi być graczem");
		}

		for (const car of cars) {
			car.player.syncWithRigidBody();
		}

		const octaneInScene = countOctaneCarsInScene(deps.scene.threeJSScene);
		if (octaneInScene < spec.playerCount) {
			throw new Error(
				`W scenie jest ${octaneInScene} modeli aut, oczekiwano ${spec.playerCount}. Odśwież stronę (Ctrl+Shift+R).`,
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

		return new GameSession(
			mode,
			humanCar,
			match,
			ai,
			ignition,
			cars,
			carHalfHeight,
			null,
		);
	}

	static async createOnline(
		deps: GameSessionDeps,
		online: OnlineSessionConfig,
	): Promise<GameSession> {
		const mode: GameModeId = "1v1";
		deps.scene.purgeMenuDecorations();

		const match = new MatchController(deps.scene.threeJSScene, mode);
		const ai = new AIManager();
		const ignition = new IgnitionManager(false);
		ignition.bindBall(deps.ball);
		const spec = getModeSpec(mode);

		const blueTemplate = await loadCarModel("blue");
		const orangeTemplate = await loadCarModel("orange");
		const carHalfHeight = getObjectSize(blueTemplate).y * 0.5;
		const spawns = match.initSpawns(carHalfHeight);

		const cars: CarEntity[] = [];
		let humanCar: CarEntity | null = null;

		try {
			for (let i = 0; i < spec.playerCount; i++) {
				const spawn = spawns[i]!;
				const isLocalHuman = spawn.slotIndex === online.localSlot;
				const mesh = cloneCarMesh(
					spawn.visualTeam === "blue" ? blueTemplate : orangeTemplate,
				);
				const player = new Player(deps.scene, mesh as unknown as THREE.Mesh);
				const visuals = new CarVisuals(
					player.threeJSGroup,
					player.visualRoot,
					deps.scene.threeJSScene,
					spawn.visualTeam,
				);

				ignition.registerSlot(spawn.slotIndex);

				const car = new CarEntity(deps.scene, player, visuals, spawn, true);
				cars.push(car);

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
			disposeCarMeshGroup(blueTemplate);
			disposeCarMeshGroup(orangeTemplate);
			throw err;
		}

		disposeCarMeshGroup(blueTemplate);
		disposeCarMeshGroup(orangeTemplate);
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
			`[Ignite] Online 1v1 (${online.role}, slot ${online.localSlot})`,
		);

		const session = new GameSession(
			mode,
			humanCar,
			match,
			ai,
			ignition,
			cars,
			carHalfHeight,
			online,
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
					this.online.remoteInput.applyFrame(frame);
				}
			},
			onSnapshot: (snapshot) => {
				if (this.online?.role === "guest") {
					this.stateInterpolator.push(snapshot);
				}
			},
			onRankedResult: (before, after, delta) => {
				const sign = delta >= 0 ? "+" : "";
				this.rankedEloLine = t("match.rankedDelta", {
					before,
					after,
					sign,
					delta,
				});
			},
		});
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
		return this.online.remoteInput;
	}

	destroy(deps: GameSessionDeps): void {
		for (const car of this.cars) {
			car.player.disposeHoverDebug?.();
			car.visuals.dispose();
			deps.scene.removeGameObject(car.player);
		}
		this.cars.length = 0;
	}

	private static readonly _ballVelScratch = new THREE.Vector3();
	private static readonly _preHitBallVel = new THREE.Vector3();
	private static readonly _preHitBallPos = new THREE.Vector3();

	private fireGoalSpectacle(
		deps: GameSessionDeps,
		team: ScoringTeam,
		goalPos: THREE.Vector3,
	): void {
		this.lastGoalSpectaclePos.copy(goalPos);
		this.goalSpectacle.trigger(team, goalPos);
		triggerGoalFlood(team);
		triggerCrowdSurge("goal_wave", { team, intensity: 1.05 });
		deps.renderer.addCameraShake(0.82);
		deps.audio.playGoal(team);
	}

	private pulseCrowdForMoment(): void {
		if (this.matchMoments.highlight.isActive()) {
			triggerCrowdSurge("match_moment", { intensity: 0.88 });
		}
	}

	private applyGoalSpectacleFrame(deps: GameSessionDeps, dt: number): void {
		this.goalSpectacle.update(dt);
		this.supersonicBreak.update(dt);
		this.powerShotHighlight.update(dt);
		this.demolishHighlight.update(dt);
		this.epicSaveHighlight.update(dt);
		this.matchMoments.highlight.update(dt);
		const goal = this.goalSpectacle.getPresentation();
		const sonic = this.supersonicBreak.getPresentation();
		const power = this.powerShotHighlight.getPresentation();
		const demolish = this.demolishHighlight.getPresentation();
		const epicSave = this.epicSaveHighlight.getPresentation();
		const moment = this.matchMoments.highlight.getPresentation();
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
			moment.shake,
		);

		if (
			this.goalSpectacle.isActive() ||
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
		applyEpicSaveOverlay(epicSave);
		applyMatchMomentOverlay(moment);
	}

	private tickSupersonicBreak(deps: GameSessionDeps, speedMps: number): void {
		if (this.supersonicBreak.sampleCrossing(speedMps)) {
			triggerCrowdSurge("supersonic", { intensity: 0.82 });
			const pos = this.humanCar.player.getPosition();
			this.humanCar.visuals.burstSupersonic(pos);
			deps.audio.playSupersonicBreak(pos);
		}
	}

	tick(
		deps: GameSessionDeps,
		dt: number,
		nowSec: number,
		gameplayFrozen = false,
	): void {
		if (this.online?.role === "guest") {
			this.tickGuest(deps, dt, nowSec, gameplayFrozen);
			return;
		}

		if (gameplayFrozen) {
			this.tickFrozen(deps, dt, nowSec);
			return;
		}

		if (this.match.isReplayActive()) {
			this.tickGoalReplay(deps, dt, nowSec);
			return;
		}

		this.goalSpectacle.update(dt);
		const physicsDt =
			this.match.getPhase() === "goal_bounce"
				? dt * this.goalSpectacle.getSimTimeScale()
				: dt;

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
			(fixedDt) => {
				for (const car of this.cars) {
					car.player.integrateHover(fixedDt);
				}
			},
			() => {
				for (const car of this.cars) {
					car.player.finalizeHoverStep();
				}
			},
		);
		const simDt = physicsStep.fixedDt * Math.max(1, physicsStep.steps);

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
		if (hit.impact > 4) deps.hitVfx.trigger(hit.point, hit.impact);
		if (hit.impact > 0) {
			deps.audio.playBallHit(hit.impact, hit.point);
			triggerBallHitFlash(THREE.MathUtils.clamp(hit.impact / 28, 0.25, 1));
		}
		const humanHitBall = hit.player === this.humanCar.player;
		if (hit.player && hit.impact > 0) {
			const hitter = this.cars.find((c) => c.player === hit.player);
			if (hitter) {
				this.match.noteBallTouchImpact(hitter.slotIndex, hit.impact, matchTime);
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
			const toward = ballVelTowardOwnGoal(
				preHitBallPos,
				preHitBallVel,
				ownGoal,
			);
			triggerCrowdSurge("epic_save", {
				intensity: THREE.MathUtils.clamp(0.75 + toward * 0.04, 0.75, 1.15),
			});
			this.epicSaveHighlight.trigger(hit.impact, toward);
			deps.renderer.addCameraShake(
				THREE.MathUtils.clamp(0.14 + toward * 0.018, 0.14, 0.48),
			);
		} else if (hit.impact >= POWER_SHOT_IMPACT_MIN && humanHitBall) {
			triggerCrowdSurge("power_shot", {
				intensity: THREE.MathUtils.clamp((hit.impact - 12) / 16, 0.65, 1.1),
			});
			this.powerShotHighlight.trigger(hit.impact);
			deps.renderer.addCameraShake(
				THREE.MathUtils.clamp((hit.impact - 12) * 0.022, 0.12, 0.55),
			);
		}
		if (humanHitBall && hit.impact >= 3 && !epicSaveContext) {
			this.matchMoments.onHumanBallHit({
				impact: hit.impact,
				ballY: preHitBallPos.y,
				inAir: !this.humanCar.player.isOnGround(),
				flipping: this.humanCar.player.isFlipping(),
				onWall: this.humanCar.player.isOnWallOrRamp(),
			});
			this.pulseCrowdForMoment();
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
			const humanAttacker = carHit.attacker === this.humanCar.player;
			const humanVictim = carHit.victim === this.humanCar.player;
			if (humanAttacker || humanVictim) {
				const humanSpeed = this.humanCar.player.getVelocity().length();
				if (humanAttacker && humanSpeed >= SUPERSONIC_MPS) {
					triggerCrowdSurge("demolish", { intensity: 1.05 });
					this.matchMoments.onHumanDemo(carHit.impact, humanSpeed);
					this.pulseCrowdForMoment();
				} else {
					if (humanAttacker) {
						triggerCrowdSurge("demolish", { intensity: 0.92 });
					}
					this.demolishHighlight.trigger(
						carHit.impact,
						humanAttacker ? "attacker" : "victim",
					);
				}
				deps.hitVfx.trigger(carHit.point, carHit.impact);
				deps.renderer.addCameraShake(
					THREE.MathUtils.clamp((carHit.impact - 9) * 0.035, 0.18, 0.65),
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
			this.replayRecorder.record(
				this.match.getMatchTime(),
				deps.ball,
				this.cars,
			);
			const goalMoment = this.match.consumeGoalMomentSnapshot();
			if (goalMoment) {
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
			this.fireGoalSpectacle(deps, scored, deps.ball.getPosition());
			this.ignition.resetAll();
			BotLearning.get().onGoal(scored, this.cars);
		}

		const snap = this.match.getHudSnapshot(this.cars);
		if (this.lastMatchPhase !== "finished" && snap.phase === "finished") {
			BotLearning.get().onMatchEnd(snap.blueScore, snap.orangeScore, this.cars);
			if (
				this.online?.role === "host" &&
				this.online.ranked &&
				!this.rankedReportSent
			) {
				this.rankedReportSent = true;
				this.online.roomClient.reportMatch(snap.blueScore, snap.orangeScore);
			}
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
			},
			dt,
		);

		updateBallPhysics(
			deps.ball,
			deps.ballRadius,
			simDt,
			deps.scene.rapierWorld,
		);
		for (const car of this.cars) {
			car.player.afterPhysics(simDt);
			stabilizePlayerPhysics(car.player);
			car.visuals.update(
				car.player,
				car.isHuman ? deps.humanInput.isBoosting() : car.isBoosting(),
				dt,
			);
		}
		this.updateCarPowerUpVisuals(deps, ballPos, dt);

		deps.physicsTelemetry?.tick(this.humanCar.player, {
			renderDt: dt,
			fixedDt: physicsStep.fixedDt,
			steps: physicsStep.steps,
		});

		deps.scene.focusShadowOn(this.humanCar.player.getPosition());
		this.updateBallTracking(deps, dt, ballPos, ballVel);
		updateCyberpunkAmbience(
			nowSec,
			dt,
			deps.scene.lighting,
			deps.scene.threeJSScene,
		);

		const speedMps = human.getVelocity().length();
		this.tickSupersonicBreak(deps, speedMps);
		deps.audio.updateEngine(
			speedMps,
			deps.humanInput.forward(),
			deps.humanInput.isBoosting(),
		);

		deps.renderer.followPlayer(
			this.humanCar.player,
			dt,
			deps.humanInput.isBoosting(),
			deps.ball.getPosition(),
		);

		if (this.match.shouldRecordReplay()) {
			this.replayRecorder.record(
				this.match.getMatchTime(),
				deps.ball,
				this.cars,
			);
		}

		this.sendNetworkSnapshot(deps, dt);
		this.applyGoalSpectacleFrame(deps, dt);
	}

	private tickGuest(
		deps: GameSessionDeps,
		dt: number,
		nowSec: number,
		gameplayFrozen: boolean,
	): void {
		if (!gameplayFrozen) {
			const snap = this.stateInterpolator.sample();
			if (snap?.match.kickoffTick == null) {
				this.online?.roomClient.sendInputFromGameInput(deps.humanInput);
			}
		}

		const snapshot = this.stateInterpolator.sample();
		if (!snapshot) {
			this.tickFrozen(deps, dt, nowSec);
			return;
		}

		applyWorldSnapshot(snapshot, deps.ball, this.cars);

		for (const car of this.cars) {
			const boosting =
				car.slotIndex === this.humanCar.slotIndex
					? deps.humanInput.isBoosting()
					: (snapshot.cars.find((c) => c.slot === car.slotIndex)?.boosting ??
						false);
			car.visuals.update(car.player, boosting, dt);
		}

		if (deps.humanInput.consumeBallCamToggle()) {
			deps.renderer.toggleBallCam();
		}

		const spec = getModeSpec(this.mode);
		const human = this.humanCar.player;
		const m = snapshot.match;
		this.syncGuestKickoffAudio(deps, m);

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
			},
			dt,
		);

		const ballVel = snapshotBallVelocity(snapshot);
		deps.scene.focusShadowOn(this.humanCar.player.getPosition());
		this.updateBallTracking(deps, dt, ballPos, ballVel);
		updateCyberpunkAmbience(
			nowSec,
			dt,
			deps.scene.lighting,
			deps.scene.threeJSScene,
		);

		const speedMps = human.getVelocity().length();
		this.tickSupersonicBreak(deps, speedMps);
		deps.audio.updateEngine(
			speedMps,
			deps.humanInput.forward(),
			deps.humanInput.isBoosting(),
		);

		if (m.replayActive) {
			deps.renderer.followReplayBall(ballPos, ballVel, dt);
		} else {
			deps.renderer.followPlayer(
				this.humanCar.player,
				dt,
				deps.humanInput.isBoosting(),
				ballPos,
			);
		}

		this.applyGoalSpectacleFrame(deps, dt);
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
			deps.renderer.addCameraShake(0.42);
		} else if (m.kickoffTick !== null) {
			deps.audio.playCountdownTick(m.kickoffTick);
		}
	}

	private startGoalReplayClip(deps: GameSessionDeps): void {
		const goalT = this.match.getGoalEventTime();
		const clip = this.replayRecorder.buildClip(
			goalT - this.match.getReplayPreSec(),
			goalT + this.match.getReplayPostSec(),
		);
		deps.ballVfx.resetTrail();
		this.replayPlayer.setClip(clip, this.cars, {
			goalCrossTime: this.match.getReplayPreSec(),
		});
		const scoringTeam = this.match.getLastScoringTeam();
		if (scoringTeam) {
			this.goalSpectacle.triggerForReplay(
				scoringTeam,
				this.lastGoalSpectaclePos,
			);
		}
		this.replaySessionActive = true;
		if (!this.replayPlayer.isPlaying) {
			this.match.finishReplay();
			this.replaySessionActive = false;
		}
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
			this.replaySessionActive = false;
			this.replayPlayer.stop();
		}

		const replayDone = this.replayPlayer.update(dt, deps.ball, this.cars);
		if (replayDone) {
			this.match.finishReplay();
			this.replaySessionActive = false;
			this.replayPlayer.stop();
		}

		for (const car of this.cars) {
			car.visuals.update(car.player, false, dt);
		}
		const replayBallPos = this.replayPlayer.ballPosition(new THREE.Vector3());
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
			},
			dt,
		);

		const ballPos = this.replayPlayer.ballPosition(new THREE.Vector3());
		const ballVel = this.replayPlayer.ballVelocity(new THREE.Vector3());
		this.updateBallTracking(deps, dt, ballPos, ballVel);
		updateCyberpunkAmbience(
			nowSec,
			dt,
			deps.scene.lighting,
			deps.scene.threeJSScene,
		);
		deps.renderer.followReplayBall(ballPos, ballVel, dt);
		this.sendNetworkSnapshot(deps, dt);
		this.applyGoalSpectacleFrame(deps, dt);
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
			deps.renderer.addCameraShake(0.42);
		} else if (snap.kickoffTick !== null) {
			deps.audio.playCountdownTick(snap.kickoffTick);
		}
	}

	private tickFrozen(deps: GameSessionDeps, dt: number, nowSec: number): void {
		const spec = getModeSpec(this.mode);
		const snap = this.match.getHudSnapshot(this.cars);
		this.syncKickoffCountdownAudio(deps, snap);
		const human = this.humanCar.player;

		for (const car of this.cars) {
			car.player.syncWithRigidBody();
			car.freezeInPlace();
			car.visuals.update(car.player, false, dt);
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
			},
			dt,
		);

		this.updateBallTracking(
			deps,
			dt,
			deps.ball.getPosition(),
			GameSession._ballVelScratch.set(
				deps.ball.rapierRigidBody.linvel().x,
				deps.ball.rapierRigidBody.linvel().y,
				deps.ball.rapierRigidBody.linvel().z,
			),
		);
		updateCyberpunkAmbience(
			nowSec,
			dt,
			deps.scene.lighting,
			deps.scene.threeJSScene,
		);

		deps.renderer.followPlayer(
			this.humanCar.player,
			dt,
			false,
			deps.ball.getPosition(),
		);

		this.sendNetworkSnapshot(deps, dt);
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
			})),
		};
	}
}

function countOctaneCarsInScene(scene: THREE.Scene): number {
	let count = 0;
	scene.traverse((obj) => {
		if (obj.name === "octaneCar") count++;
	});
	return count;
}
