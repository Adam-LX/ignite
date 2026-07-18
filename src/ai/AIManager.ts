import * as THREE from "three";
import type { ScoringTeam } from "../game/modes";
import type { IgnitionManager } from "../modes/IgnitionManager";
import type Player from "../util/Player";
import { RL_CAR } from "../util/rlConstants";
import {
	type BehaviorContext,
	BotBehavior,
	type BotDrive,
	type BotPeer,
	computeIntercept,
} from "./BotBehavior";
import { assignBotRolesFFA, assignBotRolesForTeam } from "./botTactics";
import { BotLearning } from "./learning/BotLearning";

export type BotRole = "striker" | "support" | "goalie";

export type AIWorldContext = {
	ballPos: THREE.Vector3;
	ballVel: THREE.Vector3;
	kickoffActive: boolean;
	kickoffCountdown: boolean;
	kickoffDriveLocked: boolean;
	carsFrozen: boolean;
	isFFA: boolean;
	teamSize: number;
	peers: BotPeer[];
	boostPads?: BehaviorContext["boostPads"];
};

type TeamMember = {
	slotIndex: number;
	team: ScoringTeam;
	distToIntercept: number;
	isHuman: boolean;
	spawnRole?: import("../modes/MatchController").SpawnRole;
};

export class AIManager {
	private readonly behaviors = new Map<number, BotBehavior>();
	private readonly roles = new Map<number, BotRole>();
	private readonly intercepts = new Map<number, THREE.Vector3>();

	registerBot(slotIndex: number, team: ScoringTeam | null): BotBehavior {
		const behavior = new BotBehavior(team, slotIndex);
		this.behaviors.set(slotIndex, behavior);
		this.roles.set(slotIndex, "striker");
		this.intercepts.set(slotIndex, new THREE.Vector3());
		return behavior;
	}

	getBehavior(slotIndex: number): BotBehavior | undefined {
		return this.behaviors.get(slotIndex);
	}

	getRole(slotIndex: number): BotRole {
		return this.roles.get(slotIndex) ?? "striker";
	}

	beginFrame(ctx: AIWorldContext, _dt: number): void {
		this.assignRoles(ctx);
	}

	think(
		slotIndex: number,
		player: Player,
		ctx: AIWorldContext,
		ignition: IgnitionManager | null,
		dt: number,
	): BotDrive {
		const behavior = this.behaviors.get(slotIndex);
		if (!behavior) {
			return { forward: 0, yaw: 0, boost: false };
		}

		const role = this.roles.get(slotIndex) ?? "striker";
		const intercept = this.intercepts.get(slotIndex) ?? ctx.ballPos;

		const behaviorCtx: BehaviorContext = {
			...ctx,
			intercept,
		};

		return behavior.think(player, role, behaviorCtx, ignition, dt);
	}

	private assignRoles(ctx: AIWorldContext): void {
		const learning = BotLearning.get();
		for (const peer of ctx.peers) {
			const intercept = computeIntercept(
				ctx.ballPos,
				ctx.ballVel,
				peer.position,
				RL_CAR.maxSpeed * learning.getInterceptLead(peer.slotIndex),
				this.intercepts.get(peer.slotIndex) ?? new THREE.Vector3(),
			);
			if (ctx.isFFA) {
				const lane = ((peer.slotIndex % 5) - 2) * 3.5;
				intercept.x += lane;
			}
			this.intercepts.set(peer.slotIndex, intercept);
		}

		if (ctx.isFFA) {
			for (const [slot, role] of assignBotRolesFFA(
				ctx.peers,
				this.intercepts,
			)) {
				this.roles.set(slot, role);
			}
			return;
		}

		const teams: ScoringTeam[] = ["blue", "orange"];
		for (const team of teams) {
			const members: TeamMember[] = ctx.peers
				.filter((p) => p.team === team)
				.map((p) => ({
					slotIndex: p.slotIndex,
					team,
					distToIntercept: p.position.distanceTo(
						this.intercepts.get(p.slotIndex) ?? ctx.ballPos,
					),
					isHuman: p.isHuman,
					spawnRole: p.spawnRole,
				}));

			if (members.length === 0) continue;

			for (const [slot, role] of assignBotRolesForTeam(members, ctx.teamSize)) {
				this.roles.set(slot, role);
			}
		}
	}

	resetKickoff(slotIndex: number): void {
		this.behaviors.get(slotIndex)?.resetKickoff();
	}
}
