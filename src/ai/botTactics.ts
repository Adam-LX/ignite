import * as THREE from "three";

import type { ScoringTeam } from "../game/modes";
import type { SpawnRole } from "../modes/MatchController";
import { RL_ARENA } from "../visual/arenaConstants";
import {
	isMeridianArenaActive,
	meridianSphereRadius,
} from "../visual/meridianArena";
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
	spawnRole?: SpawnRole;
};

function botRoleFromSpawn(spawnRole?: SpawnRole): BotRole | null {
	switch (spawnRole) {
		case "offensive_corner":
			return "striker";
		case "center_back":
		case "defensive":
			/** Meridian: possession, nie bramki — goalie camp zabija tempo. */
			return isMeridianArenaActive() ? "support" : "goalie";
		default:
			return null;
	}
}

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

/**
 * Cel podejścia / strzału — logika sytuacyjna (RL-like):
 * - clearance gdy groźba własnej bramki
 * - okrążenie gdy bot jest przed piłką na linii strzału
 * - shadow z tyłu piłki → przebicie w stronę bramki przeciwnika
 */
export function computeStrikeApproachTarget(
	botPos: THREE.Vector3,
	ballPos: THREE.Vector3,
	ballVel: THREE.Vector3,
	enemyGoal: THREE.Vector3,
	ownGoal: THREE.Vector3,
	out: THREE.Vector3,
): void {
	const dist = botPos.distanceTo(ballPos);

	_shotLine.copy(enemyGoal).sub(ballPos);
	_shotLine.y = 0;
	if (_shotLine.lengthSq() < 0.01) {
		out.copy(ballPos);
		out.y = Math.max(0, ballPos.y * 0.4);
		return;
	}
	_shotLine.normalize();

	/** Clearance — podejdź z linii własnej bramki i wypchnij w bok / w górę boiska. */
	if (ballThreatensOwnGoal(ballPos, ballVel, ownGoal, 0.65)) {
		_goalDir.copy(ballPos).sub(ownGoal);
		_goalDir.y = 0;
		if (_goalDir.lengthSq() < 0.01) _goalDir.copy(_shotLine);
		else _goalDir.normalize();
		const clearAlong =
			_shotLine.dot(_goalDir) > 0.15 ? _shotLine : _goalDir;
		if (dist > 3.8) {
			out.copy(ballPos).addScaledVector(clearAlong, -2.4);
		} else {
			out.copy(ballPos).addScaledVector(clearAlong, 1.35);
		}
		out.y = Math.max(0, ballPos.y * 0.35);
		return;
	}

	/** Przed piłką — okrąż, żeby wejść z tyłu (nie pchaj w własną połowę). */
	if (isBetweenBallAndGoal(botPos, ballPos, enemyGoal) && dist < 20) {
		_botToBall.copy(botPos).sub(ballPos);
		_botToBall.y = 0;
		const cross =
			_botToBall.x * _shotLine.z - _botToBall.z * _shotLine.x;
		const side = cross >= 0 ? 1 : -1;
		const latX = -_shotLine.z * side;
		const latZ = _shotLine.x * side;
		const arc = THREE.MathUtils.clamp(4.2 + dist * 0.12, 4, 7);
		out.set(
			ballPos.x - _shotLine.x * 3.2 + latX * arc,
			0,
			ballPos.z - _shotLine.z * 3.2 + latZ * arc,
		);
		return;
	}

	/** Daleko — intercept + lekki shadow z tyłu. */
	if (dist > 14) {
		const t = dist / Math.max(ballVel.length() + 12, 16);
		out.copy(ballPos).addScaledVector(ballVel, Math.min(t, 1.1));
		out.addScaledVector(_shotLine, -2.4);
		out.y = ballPos.y > 1.6 ? ballPos.y * 0.55 : 0;
		return;
	}

	/** Środek — shadow z tyłu piłki. */
	if (dist > 2.6) {
		const behind = THREE.MathUtils.clamp(dist * 0.38, 2.0, 5.2);
		out.copy(ballPos).addScaledVector(_shotLine, -behind);
		out.y = ballPos.y > 1.8 ? ballPos.y * 0.7 : 0;
		return;
	}

	/** Blisko — przebij przez piłkę w bramkę. */
	out.copy(ballPos).addScaledVector(_shotLine, 1.25);
	out.y = Math.min(ballPos.y, 1.15);
}

/** Nos w stronę bramki przeciwnika przez piłkę — gotowość do dodge/strzału. */
export function isAlignedForShot(
	botPos: THREE.Vector3,
	botForward: THREE.Vector3,
	ballPos: THREE.Vector3,
	enemyGoal: THREE.Vector3,
	maxCross = 0.28,
): boolean {
	_shotLine.copy(enemyGoal).sub(ballPos);
	_shotLine.y = 0;
	if (_shotLine.lengthSq() < 0.01) return false;
	_shotLine.normalize();

	_botToBall.copy(ballPos).sub(botPos);
	_botToBall.y = 0;
	if (_botToBall.lengthSq() < 0.05) return false;
	_botToBall.normalize();

	_botForward.copy(botForward);
	_botForward.y = 0;
	if (_botForward.lengthSq() < 1e-6) return false;
	_botForward.normalize();

	const towardBall = _botForward.dot(_botToBall) > 0.55;
	const towardGoal = _botForward.dot(_shotLine) > 0.4;
	const behind = _botToBall.dot(_shotLine) > 0.25;
	const cross = Math.abs(
		_botForward.x * _shotLine.z - _botForward.z * _shotLine.x,
	);
	return towardBall && towardGoal && behind && cross < maxCross;
}

/** Wolna / niegroźna piłka — wszyscy mają jechać po nią, nie stać w obronie. */
export function isLooseBall(ballVel: THREE.Vector3): boolean {
	return isBallIdle(ballVel) || ballVel.length() < 2.4;
}

/**
 * Piłka faktycznie w powietrzu — nie wystarczy lekki odbiór od ziemi.
 * Używane do wejścia w AERIAL i lotów ofensywnych.
 *
 * Meridian: world-Y jest bezużyteczne (środek sfery ma y≈R) — „powietrze”
 * = znaczący luz od skorupy do środka.
 */
export function isBallAirborne(
	ballPos: THREE.Vector3,
	ballVel: THREE.Vector3,
	minY = 1.9,
): boolean {
	if (isMeridianArenaActive()) {
		const R = meridianSphereRadius();
		const dx = ballPos.x;
		const dy = ballPos.y - R;
		const dz = ballPos.z;
		const dist = Math.hypot(dx, dy, dz);
		const clearance = R - dist;
		return clearance > 5.5;
	}
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

	if (teamSize <= 1) {
		roles.set(bots[0]!.slotIndex, "striker");
		return roles;
	}

	if (bots.length === 1) {
		const bot = bots[0]!;
		roles.set(bot.slotIndex, botRoleFromSpawn(bot.spawnRole) ?? "support");
		return roles;
	}

	/** Meridian 2v2: wszyscy gonią possession — bez goalie. */
	if (isMeridianArenaActive()) {
		const sorted = [...bots].sort(
			(a, b) => a.distToIntercept - b.distToIntercept,
		);
		for (let i = 0; i < sorted.length; i++) {
			roles.set(sorted[i]!.slotIndex, i === 0 ? "striker" : "support");
		}
		return roles;
	}

	for (const bot of bots) {
		const fromSpawn = botRoleFromSpawn(bot.spawnRole);
		if (fromSpawn) roles.set(bot.slotIndex, fromSpawn);
	}

	const sorted = [...members].sort(
		(a, b) => a.distToIntercept - b.distToIntercept,
	);
	let botOrder = 0;
	for (let i = 0; i < sorted.length; i++) {
		const m = sorted[i]!;
		if (m.isHuman || roles.has(m.slotIndex)) continue;

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

/** Snapshot pada boostu dla AI (bez zależności od BoostPadManager). */
export type BotBoostPadInfo = {
	x: number;
	z: number;
	big: boolean;
	active: boolean;
};

/**
 * Najbliższy aktywny pad — preferuj big gdy fuel niski.
 * Zwraca null gdy brak padów w zasięgu / wszystkie na CD.
 */
export function pickNearestBoostPad(
	botX: number,
	botZ: number,
	pads: readonly BotBoostPadInfo[],
	opts?: { maxDist?: number; preferBig?: boolean },
): { x: number; z: number; big: boolean; dist: number } | null {
	const maxDist = opts?.maxDist ?? 55;
	const preferBig = opts?.preferBig ?? false;
	const pool =
		preferBig && pads.some((p) => p.active && p.big)
			? pads.filter((p) => p.big)
			: pads;
	let best: { x: number; z: number; big: boolean; dist: number } | null = null;
	let bestDist = Number.POSITIVE_INFINITY;

	for (const pad of pool) {
		if (!pad.active) continue;
		const dist = Math.hypot(pad.x - botX, pad.z - botZ);
		if (dist > maxDist) continue;
		if (dist < bestDist) {
			bestDist = dist;
			best = { x: pad.x, z: pad.z, big: pad.big, dist };
		}
	}
	return best;
}

/**
 * Czy bot powinien zejść z piłki po pad (ekonomia RL — brak passive regen).
 * Krytycznie niski fuel ma pierwszeństwo nad chase loose ball.
 */
export function shouldSeekBoostPad(
	fuel: number,
	opts: {
		kickoffChase: boolean;
		ownGoalThreat: boolean;
		looseBall: boolean;
		role: BotRole;
		ballDist: number;
	},
): boolean {
	if (opts.kickoffChase || opts.ownGoalThreat) return false;

	/** Pusty tank — zawsze pad (nawet przy piłce pod nosem). */
	if (fuel < 0.14) return true;

	if (opts.looseBall && opts.ballDist < 14) return false;
	if (fuel >= 0.45) return false;

	if (opts.role === "goalie" || opts.role === "support") {
		return fuel < 0.36;
	}
	/** Striker — sucho albo piłka nie jest w zasięgu pressu. */
	return fuel < 0.26 || (fuel < 0.38 && opts.ballDist > 20);
}

/** Piłka na środku / tuż po GO — faza kickoff chase (sieć ML wyłączona). */
export function isKickoffChasePhase(
	ballPos: THREE.Vector3,
	ballVel: THREE.Vector3,
	kickoffActive: boolean,
	kickoffDelay: number,
): boolean {
	if (kickoffActive || kickoffDelay > 0) return true;
	const centerDist = Math.hypot(ballPos.x, ballPos.z);
	return centerDist < 5 && isBallIdle(ballVel, 2.8);
}

/** Kto jedzie na piłkę przy kickoffie (bramkarz zostaje tylko w dużych składach). */
export function shouldChaseKickoffBall(
	role: BotRole,
	isFFA: boolean,
	teamSize: number,
): boolean {
	if (isFFA || teamSize <= 1) return true;
	return role === "striker" || role === "support";
}
