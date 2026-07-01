import * as THREE from "three";

import type { ScoringTeam } from "../game/modes";
import { RL_ARENA } from "../visual/arenaConstants";
import type { BotRole } from "./AIManager";

const _shotLine = new THREE.Vector3();
const _botToBall = new THREE.Vector3();
const _goalDir = new THREE.Vector3();
const _botForward = new THREE.Vector3();

export type JumpForBallContext = {
	role: import("./AIManager").BotRole;
	clearanceActive?: boolean;
};

/** Piłka leci w stronę własnej bramki (lub wisi blisko niej). */
export function ballThreatensOwnGoal(
	ballPos: THREE.Vector3,
	ballVel: THREE.Vector3,
	ownGoal: THREE.Vector3,
	minVelTowardGoal = 1.0,
): boolean {
	_goalDir.copy(ownGoal).sub(ballPos);
	_goalDir.y = 0;
	const distToGoal = _goalDir.length();
	if (distToGoal < 0.01) return true;
	_goalDir.normalize();

	const velToward = ballVel.x * _goalDir.x + ballVel.z * _goalDir.z;
	if (velToward >= minVelTowardGoal) return true;

	return distToGoal < 14 && ballPos.y > 0.85;
}

/** Bot przed piłką na linii do własnej bramki — typowa pozycja obrony. */
export function isBlockingOwnGoal(
	botPos: THREE.Vector3,
	ballPos: THREE.Vector3,
	ownGoal: THREE.Vector3,
): boolean {
	return isBetweenBallAndGoal(botPos, ballPos, ownGoal);
}

/**
 * Skok do piłki w powietrzu — atak (strzał) albo obrona (blok / clearance).
 * Heurystyka celowa; sieć ML nie dokłada jumpów.
 */
export function shouldJumpForBall(
	botPos: THREE.Vector3,
	botForward: THREE.Vector3,
	ballPos: THREE.Vector3,
	ballVel: THREE.Vector3,
	enemyGoal: THREE.Vector3,
	ownGoal: THREE.Vector3,
	ctx: JumpForBallContext,
): boolean {
	const horizDist = Math.hypot(ballPos.x - botPos.x, ballPos.z - botPos.z);
	const maxDist = ctx.role === "goalie" || ctx.clearanceActive ? 5.8 : 4.6;
	if (horizDist >= maxDist) return false;
	if (ballPos.y >= 4.8) return false;

	const defending =
		ctx.clearanceActive ||
		ctx.role === "goalie" ||
		ballThreatensOwnGoal(ballPos, ballVel, ownGoal);

	if (defending) {
		if (!ballThreatensOwnGoal(ballPos, ballVel, ownGoal, 0.6)) {
			if (ctx.role !== "goalie" && !ctx.clearanceActive) return false;
		}
		if (ballPos.y < 1.05 && !isBallAirborne(ballPos, ballVel, 0.95)) {
			return false;
		}
		return (
			isBlockingOwnGoal(botPos, ballPos, ownGoal) ||
			ctx.role === "goalie" ||
			ctx.clearanceActive ||
			horizDist < 3.2
		);
	}

	if (!isBallAirborne(ballPos, ballVel, 1.55)) return false;

	_botForward.copy(botForward);
	_botForward.y = 0;
	if (_botForward.lengthSq() < 1e-6) return false;
	_botForward.normalize();

	_botToBall.copy(enemyGoal).sub(botPos);
	_botToBall.y = 0;
	if (_botToBall.lengthSq() < 0.01) return false;
	_botToBall.normalize();

	const towardEnemy = _botForward.dot(_botToBall) > 0.45;

	_goalDir.copy(ownGoal).sub(botPos);
	_goalDir.y = 0;
	const towardOwn =
		_goalDir.lengthSq() > 0.01 && _botForward.dot(_goalDir.normalize()) > 0.65;

	return towardEnemy && !towardOwn;
}

export type RoleMember = {
	slotIndex: number;
	distToIntercept: number;
	isHuman: boolean;
};

/** Bot za piłką względem bramki przeciwnika — dobra pozycja do strzału. */
export function isBehindBall(
	botPos: THREE.Vector3,
	ballPos: THREE.Vector3,
	enemyGoal: THREE.Vector3,
): boolean {
	_shotLine.copy(enemyGoal).sub(ballPos);
	_shotLine.y = 0;
	if (_shotLine.lengthSq() < 0.01) return true;
	_shotLine.normalize();

	_botToBall.copy(ballPos).sub(botPos);
	_botToBall.y = 0;
	return _botToBall.dot(_shotLine) > 0;
}

/** Bot przed piłką na linii do bramki — powinien okrążyć piłkę. */
export function isBetweenBallAndGoal(
	botPos: THREE.Vector3,
	ballPos: THREE.Vector3,
	enemyGoal: THREE.Vector3,
): boolean {
	_shotLine.copy(enemyGoal).sub(ballPos);
	_shotLine.y = 0;
	if (_shotLine.lengthSq() < 0.01) return false;
	_shotLine.normalize();

	_botToBall.copy(botPos).sub(ballPos);
	_botToBall.y = 0;
	if (_botToBall.lengthSq() < 0.25) return false;

	return _botToBall.dot(_shotLine) > 0.15;
}

/** Piłka praktycznie stoi — boty powinny jechać po nią, nie na REPOSITION. */
export function isBallIdle(ballVel: THREE.Vector3, maxSpeed = 1.15): boolean {
	return ballVel.lengthSq() < maxSpeed * maxSpeed;
}

/** Wolna / niegroźna piłka — wszyscy mają jechać po nią, nie stać w obronie. */
export function isLooseBall(ballVel: THREE.Vector3): boolean {
	return isBallIdle(ballVel) || ballVel.length() < 2.4;
}

/**
 * Piłka faktycznie w powietrzu — nie wystarczy lekki odbiór od ziemi.
 * Używane do wejścia w AERIAL i lotów ofensywnych.
 */
export function isBallAirborne(
	ballPos: THREE.Vector3,
	ballVel: THREE.Vector3,
	minY = 1.9,
): boolean {
	const y = ballPos.y;
	if (y < minY) return false;
	if (y >= minY + 0.7) return true;
	if (y < 1.25 && ballVel.y <= 0.35) return false;
	if (ballVel.y > 0.45) return true;
	return y >= 2.35 && ballVel.y > -3;
}

/**
 * Okrążenie piłki — tylko blisko i przy ruchomej piłce.
 * Z daleka (spawn) bot jest „przed piłką” geometrycznie, ale ma jechać do niej.
 */
export function shouldRepositionAroundBall(
	botPos: THREE.Vector3,
	ballPos: THREE.Vector3,
	ballVel: THREE.Vector3,
	enemyGoal: THREE.Vector3,
	engageRadius: number,
): boolean {
	const distBall = botPos.distanceTo(ballPos);
	if (isBallIdle(ballVel)) return false;
	if (distBall > engageRadius * 0.92) return false;
	if (distBall < 3.5) return false;
	return isBetweenBallAndGoal(botPos, ballPos, enemyGoal);
}

export function enemyGoalForTeam(
	team: ScoringTeam | null,
	ballPos: THREE.Vector3,
): THREE.Vector3 {
	if (!team) {
		const toBlue = ballPos.distanceToSquared(
			new THREE.Vector3(0, 0, RL_ARENA.HALF_LENGTH),
		);
		const toOrange = ballPos.distanceToSquared(
			new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH),
		);
		return toBlue < toOrange
			? new THREE.Vector3(0, 0, RL_ARENA.HALF_LENGTH)
			: new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH);
	}
	return team === "blue"
		? new THREE.Vector3(0, 0, RL_ARENA.HALF_LENGTH)
		: new THREE.Vector3(0, 0, -RL_ARENA.HALF_LENGTH);
}

/** Przypisanie ról botów w drużynie (ludzie pomijani). */
export function assignBotRolesForTeam(
	members: RoleMember[],
	teamSize: number,
): Map<number, BotRole> {
	const roles = new Map<number, BotRole>();
	const bots = members.filter((m) => !m.isHuman);
	if (bots.length === 0) return roles;

	if (bots.length === 1 || teamSize <= 1) {
		roles.set(bots[0]!.slotIndex, "striker");
		return roles;
	}

	const sorted = [...members].sort(
		(a, b) => a.distToIntercept - b.distToIntercept,
	);
	let botOrder = 0;
	for (let i = 0; i < sorted.length; i++) {
		const m = sorted[i]!;
		if (m.isHuman) continue;

		let role: BotRole;
		if (botOrder === 0) {
			role = "striker";
		} else if (
			sorted.length >= 3 &&
			i === sorted.length - 1 &&
			bots.length >= 2
		) {
			role = "goalie";
		} else {
			role = "support";
		}
		roles.set(m.slotIndex, role);
		botOrder++;
	}
	return roles;
}

/** FFA — kilku najbliższych piłce atakuje, reszta wspiera z boku. */
export function assignBotRolesFFA(
	peers: Array<{
		slotIndex: number;
		position: THREE.Vector3;
		isHuman: boolean;
	}>,
	intercepts: Map<number, THREE.Vector3>,
): Map<number, BotRole> {
	const roles = new Map<number, BotRole>();
	const bots = peers
		.filter((p) => !p.isHuman)
		.map((p) => ({
			slotIndex: p.slotIndex,
			dist: p.position.distanceTo(intercepts.get(p.slotIndex) ?? p.position),
		}))
		.sort((a, b) => a.dist - b.dist);

	const strikerCount = Math.max(2, Math.ceil(bots.length / 3));
	for (let i = 0; i < bots.length; i++) {
		roles.set(bots[i]!.slotIndex, i < strikerCount ? "striker" : "support");
	}
	return roles;
}
