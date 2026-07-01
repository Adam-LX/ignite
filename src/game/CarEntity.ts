import * as THREE from "three";
import type { AIManager, AIWorldContext } from "../ai/AIManager";
import type { IgnitionManager } from "../modes/IgnitionManager";
import type { CarSpawn } from "../modes/MatchController";
import type Scene from "../Scene";
import type { ControlInput } from "../util/ControlInput";
import type Player from "../util/Player";
import type { CarVisuals } from "../visual/carVisuals";
import type { ScoringTeam } from "./modes";

export class CarEntity {
	readonly player: Player;
	readonly visuals: CarVisuals;
	readonly slotIndex: number;
	readonly team: ScoringTeam | null;
	readonly displayName: string;
	readonly isHuman: boolean;
	readonly visualTeam: ScoringTeam;

	individualScore = 0;
	private powerUpKeyHeld = false;

	constructor(
		_scene: Scene,
		player: Player,
		visuals: CarVisuals,
		spawn: CarSpawn,
		isHuman: boolean,
	) {
		this.player = player;
		this.visuals = visuals;
		this.slotIndex = spawn.slotIndex;
		this.team = spawn.team;
		this.displayName = spawn.displayName;
		this.isHuman = isHuman;
		this.visualTeam = spawn.visualTeam;

		this.applySpawn(spawn);
		if (!isHuman) {
			this.attachBotDebugMarker();
		}
	}

	private attachBotDebugMarker(): void {
		const geom = new THREE.BoxGeometry(1, 1, 1);
		const mat = new THREE.MeshBasicMaterial({
			color: 0xff0000,
			wireframe: true,
		});
		const marker = new THREE.Mesh(geom, mat);
		marker.name = "BotDebugMarker";
		marker.position.y = 3.0;
		marker.frustumCulled = false;
		this.player.threeJSGroup.add(marker);
	}

	private applySpawn(spawn: CarSpawn): void {
		this.player.resetKickoffPose(
			spawn.position.x,
			spawn.position.y,
			spawn.position.z,
			spawn.yaw,
		);
		this.player.setRecoveryAnchor(spawn.position);
	}

	resetToSpawn(spawn: CarSpawn): void {
		this.applySpawn(spawn);
		this.player.boostFuel = 1;
	}

	primeKickoff(ai: AIManager): void {
		ai.resetKickoff(this.slotIndex);
	}

	freezeInPlace(): void {
		const body = this.player.rapierRigidBody;
		body.setLinvel({ x: 0, y: 0, z: 0 }, true);
		body.setAngvel({ x: 0, y: 0, z: 0 }, true);
	}

	control(
		dt: number,
		ctx: AIWorldContext,
		ai: AIManager,
		ignition: IgnitionManager | null,
		humanInput?: ControlInput,
	): void {
		if (this.isHuman && humanInput) {
			if (ctx.carsFrozen || ctx.kickoffDriveLocked) {
				return;
			}
			const rDown =
				"isKeyDown" in humanInput && typeof humanInput.isKeyDown === "function"
					? humanInput.isKeyDown("r")
					: false;
			if (rDown && !this.powerUpKeyHeld && ignition?.isEnabled()) {
				ignition.tryHumanActivate(
					this.slotIndex,
					this.player,
					this.team,
					ctx.isFFA,
				);
			}
			this.powerUpKeyHeld = rDown;
			this.player.control(humanInput, dt);
			return;
		}

		if (!ctx.carsFrozen && !ctx.kickoffDriveLocked) {
			ai.think(this.slotIndex, this.player, ctx, ignition, dt);
		}
	}

	isBoosting(): boolean {
		return this.player.isBoosting();
	}
}
