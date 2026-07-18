import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import type GameObject from "../GameObject";
import { ramHitImpulseScale } from "../meta/carBodyTraits";
import { RL_ARENA } from "../visual/arenaConstants";
import {
	GOAL_MOUTH_HALF_WIDTH,
	getGoalPocketAabb,
	isBallInsideGoalFrame,
	whichGoalPocket,
} from "../visual/goalPocket";
import {
	getMeridianSphere,
	isMeridianArenaActive,
} from "../visual/meridianArena";
import type Player from "./Player";
import { RL_BALL, RL_CAR, WORLD_GRAVITY } from "./rlConstants";
import { mpsToUu, rlBallCarExtraImpulseFactor, uuToMps } from "./rlPhysics";

const _hitDir = new THREE.Vector3();
const _carVel = new THREE.Vector3();
const _ballVel = new THREE.Vector3();
const _relVel = new THREE.Vector3();
const _contactPoint = new THREE.Vector3();
const _impulse = new THREE.Vector3();
const _surfaceN = new THREE.Vector3();
const _surfaceR = new THREE.Vector3();
const _surfaceW = new THREE.Vector3();
const _surfaceVc = new THREE.Vector3();
const _surfaceSlip = new THREE.Vector3();
const _surfaceImpulse = new THREE.Vector3();
const _surfaceCenter = new THREE.Vector3();
const _surfaceContact = new THREE.Vector3();
const _surfaceCross = new THREE.Vector3();
const _carVelA = new THREE.Vector3();
const _carVelB = new THREE.Vector3();
const _carRel = new THREE.Vector3();
const _carNormal = new THREE.Vector3();

type Vec3Snap = { x: number; y: number; z: number };
const ballPreStepLinvel = new WeakMap<RAPIER.RigidBody, Vec3Snap>();
const ballPreStepAngvel = new WeakMap<RAPIER.RigidBody, Vec3Snap>();

/** Zapisz v/ω piłki tuż przed advancePhysics — smish używa prędkości przed krokiem Rapier. */
export function snapshotBallKinematics(ball: GameObject): void {
	const body = ball.rapierRigidBody;
	const lv = body.linvel();
	const av = body.angvel();
	ballPreStepLinvel.set(body, { x: lv.x, y: lv.y, z: lv.z });
	ballPreStepAngvel.set(body, { x: av.x, y: av.y, z: av.z });
}

const MAX_BALL_SPEED = RL_BALL.maxSpeed;
const MAX_CAR_SPEED = RL_CAR.maxSpeed + 1;

/** Mnożnik limitu prędkości piłki (Ignition Rush) — 1 = baseline. */
let matchBallSpeedMul = 1;

export function setMatchBallSpeedMul(mul: number): void {
	matchBallSpeedMul =
		Number.isFinite(mul) && mul > 0 ? THREE.MathUtils.clamp(mul, 1, 1.45) : 1;
}

export function getMatchBallSpeedMul(): number {
	return matchBallSpeedMul;
}

function ballMaxSpeed(): number {
	const base = MAX_BALL_SPEED * matchBallSpeedMul;
	return isMeridianArenaActive() ? base * 1.85 : base;
}

function isFiniteVec3(v: { x: number; y: number; z: number }): boolean {
	return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function clampLinvel(body: RAPIER.RigidBody, maxSpeed: number): void {
	const v = body.linvel();
	if (!isFiniteVec3(v)) {
		body.setLinvel({ x: 0, y: 0, z: 0 }, true);
		body.setAngvel({ x: 0, y: 0, z: 0 }, true);
		return;
	}
	const speed = Math.hypot(v.x, v.y, v.z);
	if (speed > maxSpeed) {
		const s = maxSpeed / speed;
		body.setLinvel({ x: v.x * s, y: v.y * s, z: v.z * s }, true);
	}
}

function clampBallVertSpeed(body: RAPIER.RigidBody, maxVy: number): void {
	const v = body.linvel();
	if (!isFiniteVec3(v) || Math.abs(v.y) <= maxVy) return;
	body.setLinvel({ x: v.x, y: Math.sign(v.y) * maxVy, z: v.z }, true);
}

/** Kierunek impulsu Psyonix + loft z kąta (RocketSim + RL 9-zone grid). */
function resolvePsyonixHitDir(
	player: Player,
	ballPos: THREE.Vector3,
	relVel: THREE.Vector3,
	out: THREE.Vector3,
): void {
	const carPos = player.getPosition();
	const forward = player.getForward();
	const up = player.getUpward();

	out.subVectors(ballPos, carPos);
	const localY = out.dot(up);
	out.y *= RL_BALL.psyonixVertScale;
	if (out.lengthSq() < 1e-8) {
		out.copy(forward);
		return;
	}
	out.normalize();
	out.addScaledVector(
		forward,
		-out.dot(forward) * (1 - RL_BALL.psyonixForwardRetain),
	);
	if (out.lengthSq() < 1e-8) {
		out.copy(forward);
	} else {
		out.normalize();
	}

	const ballBelow = THREE.MathUtils.clamp(
		-localY / (RL_BALL.radius + RL_CAR.hitboxHalfY),
		0,
		1,
	);
	const noseUp = THREE.MathUtils.clamp(forward.y, 0, 1);
	let loft =
		ballBelow * RL_BALL.groundLoftFromBelow + noseUp * RL_BALL.pitchLoftScale;

	const climb = THREE.MathUtils.clamp(-relVel.dot(up), 0, 16) * 0.062;
	loft += climb;
	if (player.isFlipping()) loft += 0.24;

	if (loft > 1e-4) {
		out.addScaledVector(up, loft);
		out.normalize();
	}
}

/** Korekta w wnęce — boki, tył i sufit; front (światło) zostaje otwarty. */
function enforceGoalPocketBounds(
	body: RAPIER.RigidBody,
	pos: THREE.Vector3,
	radius: number,
): boolean {
	const pocket = whichGoalPocket(pos, radius);
	if (!pocket) return false;

	const box = getGoalPocketAabb(pocket, radius);
	const hl = RL_ARENA.HALF_LENGTH;
	const backZ =
		pocket === "orange"
			? hl + RL_ARENA.GOAL_DEPTH - radius
			: -hl - RL_ARENA.GOAL_DEPTH + radius;

	const v = body.linvel();
	let nx = pos.x;
	let ny = pos.y;
	let nz = pos.z;
	let vx = v.x;
	let vy = v.y;
	let vz = v.z;
	let corrected = false;

	if (nx > box.maxX) {
		nx = box.maxX;
		vx = -Math.abs(vx) * 0.35;
		corrected = true;
	} else if (nx < box.minX) {
		nx = box.minX;
		vx = Math.abs(vx) * 0.35;
		corrected = true;
	}

	if (pocket === "orange") {
		if (nz > backZ) {
			nz = backZ;
			vz = -Math.abs(vz) * 0.35;
			corrected = true;
		}
	} else if (nz < backZ) {
		nz = backZ;
		vz = Math.abs(vz) * 0.35;
		corrected = true;
	}

	if (ny > box.maxY) {
		ny = box.maxY;
		vy = -Math.abs(vy) * 0.35;
		corrected = true;
	}

	if (ny < box.minY) {
		ny = box.minY;
		vy = Math.max(vy, 0);
		corrected = true;
	}

	if (!corrected) return false;

	body.setTranslation({ x: nx, y: ny, z: nz }, true);
	body.setLinvel({ x: vx, y: vy, z: vz }, true);
	return true;
}

/** Zapobiega znikaniu auta (NaN / teleport poza arenę) po uderzeniu w piłkę. */
export function stabilizePlayerPhysics(player: Player): void {
	const body = player.rapierRigidBody;
	const t = body.translation();
	const pos = player.getPosition();

	player.threeJSGroup.visible = true;
	player.threeJSGroup.traverse((obj) => {
		obj.visible = true;
	});

	const sphere = getMeridianSphere();
	const inBounds = sphere
		? (() => {
				const dist = Math.hypot(
					t.x - sphere.center.x,
					t.y - sphere.center.y,
					t.z - sphere.center.z,
				);
				return dist <= sphere.radius + 8 && t.y >= -2;
			})()
		: Math.abs(t.x) <= RL_ARENA.HALF_WIDTH + 8 &&
			Math.abs(t.z) <= RL_ARENA.HALF_LENGTH + RL_ARENA.GOAL_DEPTH + 8 &&
			t.y >= -2 &&
			t.y <= RL_ARENA.HEIGHT + 6;

	if (isFiniteVec3(t) && inBounds) {
		player.recoveryPos.copy(t);
	}

	if (!isFiniteVec3(t)) {
		body.setTranslation(
			{
				x: player.recoveryPos.x,
				y: player.recoveryPos.y,
				z: player.recoveryPos.z,
			},
			true,
		);
		body.setLinvel({ x: 0, y: 0, z: 0 }, true);
		body.setAngvel({ x: 0, y: 0, z: 0 }, true);
		return;
	}

	if (!sphere) {
		enforceGoalPocketBounds(body, pos, 0.95);
	}

	const outOfBounds = sphere
		? Math.hypot(
				t.x - sphere.center.x,
				t.y - sphere.center.y,
				t.z - sphere.center.z,
			) >
				sphere.radius + 20 || t.y < -4
		: Math.abs(t.x) > RL_ARENA.HALF_WIDTH + 8 ||
			Math.abs(t.z) > RL_ARENA.HALF_LENGTH + RL_ARENA.GOAL_DEPTH + 8 ||
			t.y < -4 ||
			t.y > RL_ARENA.HEIGHT + 6;

	if (outOfBounds) {
		body.setTranslation(
			{
				x: player.recoveryPos.x,
				y: player.recoveryPos.y,
				z: player.recoveryPos.z,
			},
			true,
		);
		body.setLinvel({ x: 0, y: 0, z: 0 }, true);
		body.setAngvel({ x: 0, y: 0, z: 0 }, true);
		return;
	}

	clampLinvel(body, MAX_CAR_SPEED);

	const av = body.angvel();
	if (!isFiniteVec3(av)) {
		body.setAngvel({ x: 0, y: 0, z: 0 }, true);
		return;
	}
	const spin = Math.hypot(av.x, av.y, av.z);
	if (spin > 14) {
		const s = 14 / spin;
		body.setAngvel({ x: av.x * s, y: av.y * s, z: av.z * s }, true);
	}
}

export type CarBallHit = {
	impact: number;
	point: THREE.Vector3;
	/** Auto, które wygenerowało najmocniejszy hit w klatce. */
	player: Player | null;
};

/**
 * Dodatkowy impuls Psyonix (Rocket League) — nałożony na kolizję Rapier.
 * J = m · |Δv| · s(|Δv|) · n, kierunek n z geometrii hitbox ↔ piłka.
 */
export function applyCarBallHits(
	world: RAPIER.World,
	player: Player,
	ball: GameObject,
): CarBallHit {
	const result: CarBallHit = { impact: 0, point: _contactPoint, player: null };
	let extraApplied = false;

	world.contactPair(player.rapierCollider, ball.rapierCollider, () => {
		if (extraApplied) return;

		_carVel.copy(player.rapierRigidBody.linvel());
		_ballVel.copy(ball.rapierRigidBody.linvel());
		_relVel.copy(_ballVel).sub(_carVel);

		const relSpeedUu = Math.min(
			mpsToUu(_relVel.length()),
			RL_BALL.psyonixMaxRelSpeedUu,
		);
		if (relSpeedUu < mpsToUu(RL_BALL.minApproachSpeed)) return;

		const ballPos = ball.getPosition();
		const carPos = player.getPosition();
		resolvePsyonixHitDir(player, ballPos, _relVel, _hitDir);

		const closing = -_relVel.dot(_hitDir);
		/** Tylko zbliżanie — bez spamu impulsu przy ślizgu / dribble overlap. */
		if (closing < RL_BALL.minApproachSpeed * 0.35) return;
		if (relSpeedUu < mpsToUu(RL_BALL.minApproachSpeed)) return;

		let factor =
			rlBallCarExtraImpulseFactor(relSpeedUu) * RL_BALL.extraForceScale;
		/** Soft touch / dribble — niższy impuls przy wolnych kontaktach. */
		if (relSpeedUu < RL_BALL.softTouchSpeedUu) {
			const t = relSpeedUu / RL_BALL.softTouchSpeedUu;
			factor *= THREE.MathUtils.lerp(RL_BALL.softTouchScaleMin, 1, t);
		}
		/** Domknij skalę do closing — unikaj „rakiety” przy lekkim tapnięciu. */
		factor *= THREE.MathUtils.clamp(closing / 5.5, 0.35, 1);
		if (isMeridianArenaActive()) factor *= 1.95;
		if (player.isBoosting()) factor *= RL_BALL.boostHitMul;
		if (player.isFlipping()) factor *= RL_BALL.flipHitMul;
		if (player.bodyTraitsEnabled) {
			const fwd = player.getForward();
			const fl = fwd.length();
			const forwardDot =
				fl > 1e-6 ? Math.max(0, fwd.dot(_hitDir) / fl) : 0;
			factor *= ramHitImpulseScale(
				player.bodyTraits,
				forwardDot,
				mpsToUu(_carVel.length()),
			);
		}

		const addedSpeed = uuToMps(relSpeedUu) * factor;
		result.impact = Math.max(addedSpeed, closing, _carVel.length() * 0.35);
		result.player = player;
		result.point.copy(ballPos).add(carPos).multiplyScalar(0.5);

		const ballBody = ball.rapierRigidBody;
		ballBody.wakeUp();

		_impulse.copy(_hitDir).multiplyScalar(addedSpeed * RL_BALL.mass);
		ballBody.applyImpulse(
			{ x: _impulse.x, y: _impulse.y, z: _impulse.z },
			true,
		);
		extraApplied = true;

		clampLinvel(ballBody, ballMaxSpeed());
		clampBallVertSpeed(
			ballBody,
			player.isBoosting()
				? RL_BALL.maxBoostHitVertSpeed
				: RL_BALL.maxHitVertSpeed,
		);
		clampLinvel(player.rapierRigidBody, MAX_CAR_SPEED);

		if (addedSpeed > 6) {
			const push = Math.min(0.12, addedSpeed * 0.01);
			ballBody.setTranslation(
				{
					x: ballPos.x + _hitDir.x * push,
					y: ballPos.y + Math.abs(_hitDir.y) * push * 0.15,
					z: ballPos.z + _hitDir.z * push,
				},
				true,
			);
		}

		ball.threeJSGroup.visible = true;
		player.threeJSGroup.visible = true;
	});

	return result;
}

export type CarCarHit = {
	impact: number;
	point: THREE.Vector3;
	attacker: Player | null;
	victim: Player | null;
};

function scoreCarCarImpact(velA: THREE.Vector3, velB: THREE.Vector3): number {
	_carRel.copy(velA).sub(velB);
	const relSpeed = _carRel.length();
	const speedA = velA.length();
	const speedB = velB.length();
	return relSpeed * 0.68 + Math.max(speedA, speedB) * 0.32;
}

function applyCarCarPairHit(
	world: RAPIER.World,
	playerA: Player,
	playerB: Player,
	best: CarCarHit,
): void {
	world.contactPair(
		playerA.rapierCollider,
		playerB.rapierCollider,
		(manifold, flipped) => {
			if (manifold.numSolverContacts() < 1) return;

			const raw = manifold.normal();
			_carNormal.set(raw.x, raw.y, raw.z);
			if (flipped) _carNormal.multiplyScalar(-1);
			if (_carNormal.lengthSq() < 1e-8) return;

			_carVelA.copy(playerA.rapierRigidBody.linvel());
			_carVelB.copy(playerB.rapierRigidBody.linvel());
			const impact = scoreCarCarImpact(_carVelA, _carVelB);
			if (impact <= best.impact) return;

			const alongA =
				_carVelA.x * _carNormal.x +
				_carVelA.y * _carNormal.y +
				_carVelA.z * _carNormal.z;
			const alongB =
				_carVelB.x * _carNormal.x +
				_carVelB.y * _carNormal.y +
				_carVelB.z * _carNormal.z;
			const attacker = alongA >= alongB ? playerA : playerB;
			const victim = attacker === playerA ? playerB : playerA;

			const cp = manifold.solverContactPoint(0);
			best.impact = impact;
			best.attacker = attacker;
			best.victim = victim;
			best.point.set(cp.x, cp.y, cp.z);
		},
	);
}

/** Najmocniejsze car-car w klatce — do demolish highlightu. */
export function applyCarCarHitsAll(
	world: RAPIER.World,
	players: Player[],
): CarCarHit {
	const best: CarCarHit = {
		impact: 0,
		point: _contactPoint.clone(),
		attacker: null,
		victim: null,
	};

	for (let i = 0; i < players.length; i++) {
		for (let j = i + 1; j < players.length; j++) {
			applyCarCarPairHit(world, players[i]!, players[j]!, best);
		}
	}

	return best;
}

/** Wszystkie auta — zwraca najmocniejsze uderzenie w tej klatce. */
export function applyCarBallHitsAll(
	world: RAPIER.World,
	players: Player[],
	ball: GameObject,
): CarBallHit {
	let best: CarBallHit = {
		impact: 0,
		point: _contactPoint.clone(),
		player: null,
	};
	for (const player of players) {
		const hit = applyCarBallHits(world, player, ball);
		if (hit.impact > best.impact) {
			best = {
				impact: hit.impact,
				point: hit.point.clone(),
				player: hit.player,
			};
		}
	}
	return best;
}

/** Czy piłka jest w świetle bramki (szerokość) — do fizyki muru za linią. */
export function isInGoalMouthX(x: number, ballRadius: number): boolean {
	return Math.abs(x) + ballRadius <= GOAL_MOUTH_HALF_WIDTH + 0.08;
}

/** Czy piłka jest w otworze bramki (szerokość + wysokość pod poprzeczką). */
export function isInGoalMouth(pos: THREE.Vector3, ballRadius: number): boolean {
	return isBallInsideGoalFrame(pos, ballRadius);
}

/** Twarde limity areny — korekta pozycji i odbicie prędkości po przeniknięciu ściany. */
function enforceBallArenaBounds(
	body: RAPIER.RigidBody,
	pos: THREE.Vector3,
	ballRadius: number,
): void {
	// Meridian: twardy clamp prostokątnej klatki RL blokował piłkę/autą na HEIGHT.
	if (isMeridianArenaActive()) return;

	const margin = ballRadius + 0.15;
	const maxX = RL_ARENA.HALF_WIDTH - margin;
	const maxY = RL_ARENA.HEIGHT - margin;
	const minY = ballRadius;
	const inGoalMouth = isInGoalMouth(pos, ballRadius);
	const hl = RL_ARENA.HALF_LENGTH;
	const goalBack = hl + RL_ARENA.GOAL_DEPTH + margin;

	const v = body.linvel();
	let nx = pos.x;
	let ny = pos.y;
	let nz = pos.z;
	let vx = v.x;
	let vy = v.y;
	let vz = v.z;
	let corrected = false;

	if (nx > maxX) {
		nx = maxX;
		if (vx > 0) vx = -vx * RL_BALL.wallBounceRetain;
		corrected = true;
	} else if (nx < -maxX) {
		nx = -maxX;
		if (vx < 0) vx = -vx * RL_BALL.wallBounceRetain;
		corrected = true;
	}

	if (inGoalMouth) {
		if (enforceGoalPocketBounds(body, pos, margin)) return;

		// W świetle bramki na murawie: tylko tylna ściana wnęki.
		const pastOrangeLine = nz > hl - ballRadius * 0.35;
		const pastBlueLine = nz < -hl + ballRadius * 0.35;
		if (pastOrangeLine && nz > goalBack) {
			nz = goalBack;
			vz = -Math.abs(vz) * 0.35;
			corrected = true;
		} else if (pastBlueLine && nz < -goalBack) {
			nz = -goalBack;
			vz = Math.abs(vz) * 0.35;
			corrected = true;
		}
	} else {
		const maxZ = hl - margin;
		if (nz > maxZ) {
			nz = maxZ;
			if (vz > 0) vz = -vz * RL_BALL.wallBounceRetain;
			corrected = true;
		} else if (nz < -maxZ) {
			nz = -maxZ;
			if (vz < 0) vz = -vz * RL_BALL.wallBounceRetain;
			corrected = true;
		}
	}

	if (ny > maxY) {
		ny = maxY;
		if (vy > 0) vy = -vy * RL_BALL.ceilingBounceRetain;
		corrected = true;
	} else if (ny < minY) {
		ny = minY;
		if (vy < 0) vy = -vy * RL_BALL.floorBounceRetain;
		corrected = true;
	}

	if (!corrected) return;

	body.setTranslation({ x: nx, y: ny, z: nz }, true);
	body.setLinvel({ x: vx, y: vy, z: vz }, true);
}

export function isArenaCollider(collider: RAPIER.Collider): boolean {
	const body = collider.parent();
	return Boolean(body?.isFixed());
}

/** CR zależny od powierzchni (murawa tłumi, ściany żywsze). */
export function bounceRestitutionForNormal(ny: number): number {
	if (isMeridianArenaActive()) return 0.96;
	if (ny > 0.7) return RL_BALL.floorBounceRetain;
	if (ny < -0.7) return RL_BALL.ceilingBounceRetain;
	return RL_BALL.restitution;
}

export type BallSurfaceKind = "floor" | "wall" | "ceiling";

export function classifyBallSurfaceFromNormal(ny: number): BallSurfaceKind {
	if (ny > 0.65) return "floor";
	if (ny < -0.65) return "ceiling";
	return "wall";
}

/**
 * Odbicie smish — normalny impuls + tarcie styczne (slip + spin ω).
 * Uruchamiane po Rapier; piłka ma restitution 0 w silniku.
 */
function resolveSmishBallContact(
	body: RAPIER.RigidBody,
	normal: THREE.Vector3,
	ballRadius: number,
	restitution: number,
): void {
	const mass = RL_BALL.mass;
	const moi = RL_BALL.moiScale * mass * ballRadius * ballRadius;
	const mu = RL_BALL.bounceFrictionMu;
	const yScale = moi / (moi + mass * ballRadius * ballRadius);

	const t = body.translation();
	_surfaceCenter.set(t.x, t.y, t.z);
	_surfaceR.copy(normal).multiplyScalar(ballRadius);

	const lv = body.linvel();
	const av = body.angvel();
	const preLv = ballPreStepLinvel.get(body);
	const preAv = ballPreStepAngvel.get(body);
	if (preLv) {
		_surfaceVc.set(preLv.x, preLv.y, preLv.z);
		_surfaceW.set(preAv?.x ?? av.x, preAv?.y ?? av.y, preAv?.z ?? av.z);
	} else {
		_surfaceVc.set(lv.x, lv.y, lv.z);
		_surfaceW.set(av.x, av.y, av.z);
	}
	_surfaceCross.copy(_surfaceR).cross(_surfaceW);
	_surfaceVc.add(_surfaceCross);

	const vn = _surfaceVc.dot(normal);
	if (vn > -0.12) return;

	const jn = -mass * (1 + restitution) * vn;

	_surfaceSlip.copy(_surfaceVc).addScaledVector(normal, -vn);
	const slipMag = _surfaceSlip.length();
	let jtX = 0;
	let jtY = 0;
	let jtZ = 0;
	if (slipMag > 1e-5) {
		const cap = Math.min(1, (yScale * Math.abs(vn)) / slipMag);
		const jt = -mass * cap * mu;
		jtX = _surfaceSlip.x * jt;
		jtY = _surfaceSlip.y * jt;
		jtZ = _surfaceSlip.z * jt;
	}

	_surfaceImpulse.set(
		normal.x * jn + jtX,
		normal.y * jn + jtY,
		normal.z * jn + jtZ,
	);

	_surfaceContact.copy(_surfaceCenter).add(_surfaceR);
	body.applyImpulseAtPoint(
		{
			x: _surfaceImpulse.x,
			y: _surfaceImpulse.y,
			z: _surfaceImpulse.z,
		},
		{ x: _surfaceContact.x, y: _surfaceContact.y, z: _surfaceContact.z },
		true,
	);
}

/**
 * Pełne odbicia arena↔piłka (smish) — po kroku Rapier, przed tarcie toczenia.
 */
export function applyBallArenaSurfaceContacts(
	world: RAPIER.World,
	ball: GameObject,
	ballRadius: number,
): void {
	const ballCollider = ball.rapierCollider;
	const body = ball.rapierRigidBody;
	let resolved = false;

	world.contactPairsWith(ballCollider, (other) => {
		if (!isArenaCollider(other)) return;

		world.contactPair(ballCollider, other, (manifold, flipped) => {
			if (manifold.numSolverContacts() < 1) return;

			const raw = manifold.normal();
			_surfaceN.set(raw.x, raw.y, raw.z);
			if (flipped) _surfaceN.multiplyScalar(-1);
			if (_surfaceN.lengthSq() < 1e-8) return;
			_surfaceN.normalize();

			const e = bounceRestitutionForNormal(_surfaceN.y);
			resolveSmishBallContact(body, _surfaceN, ballRadius, e);
			resolved = true;
		});
	});

	// Rapier czasem nie zgłasza solver contact z murawą — fallback z pre-step vy.
	if (!resolved) {
		const pre = ballPreStepLinvel.get(body);
		const t = body.translation();
		if (pre && pre.y < -0.35 && t.y <= ballRadius + 0.1) {
			_surfaceN.set(0, 1, 0);
			resolveSmishBallContact(
				body,
				_surfaceN,
				ballRadius,
				RL_BALL.floorBounceRetain,
			);
		}
	}
}

/** Dynamiczne tarcie piłki — Rocket Science #4: slide 230 uu/s² na murawie. */
export function updateBallPhysics(
	ball: GameObject,
	ballRadius: number,
	dt: number,
	world?: RAPIER.World,
): void {
	const pos = ball.getPosition();
	const body = ball.rapierRigidBody;
	const meridian = isMeridianArenaActive();

	if (world) {
		applyBallArenaSurfaceContacts(world, ball, ballRadius);
	}

	if (meridian) {
		/** Prawie zero grawitacji → szybkie 3D ricochety w sferze. */
		const lift = -WORLD_GRAVITY * RL_BALL.mass * 0.82;
		body.addForce({ x: 0, y: lift, z: 0 }, true);
		body.setLinearDamping(0.001);
		body.setAngularDamping(0.02);
		enforceBallArenaBounds(body, pos, ballRadius);
		const av = body.angvel();
		const spin = Math.hypot(av.x, av.y, av.z);
		const maxSpin = RL_BALL.maxSpinRad * 1.5;
		if (spin > maxSpin) {
			const s = maxSpin / spin;
			body.setAngvel({ x: av.x * s, y: av.y * s, z: av.z * s }, true);
		}
		clampLinvel(body, ballMaxSpeed());
		return;
	}

	const v = body.linvel();
	const horizSpeed = Math.hypot(v.x, v.z);
	const onGround =
		pos.y <= ballRadius + 0.08 &&
		Math.abs(v.y) < 0.35 &&
		horizSpeed < RL_BALL.maxSpeed;

	if (onGround) {
		body.setLinearDamping(RL_BALL.groundLinearDamp);
		body.setAngularDamping(RL_BALL.groundAngularDamp);

		if (Math.abs(v.y) < 0.3) {
			if (horizSpeed > uuToMps(565)) {
				const decel = RL_BALL.groundSlideDecel * dt;
				const scale =
					Math.max(0, horizSpeed - decel) / Math.max(horizSpeed, 0.001);
				body.setLinvel({ x: v.x * scale, y: v.y, z: v.z * scale }, true);
			} else if (horizSpeed > 0.05) {
				const scale = Math.max(0, 1 - RL_BALL.groundRollDecel * dt);
				body.setLinvel({ x: v.x * scale, y: v.y, z: v.z * scale }, true);
			}
		}
	} else {
		body.setLinearDamping(RL_BALL.airLinearDamp);
		body.setAngularDamping(RL_BALL.airAngularDamp);
	}

	enforceBallArenaBounds(body, pos, ballRadius);

	const av = body.angvel();
	const spin = Math.hypot(av.x, av.y, av.z);
	if (spin > RL_BALL.maxSpinRad) {
		const s = RL_BALL.maxSpinRad / spin;
		body.setAngvel({ x: av.x * s, y: av.y * s, z: av.z * s }, true);
	}

	clampLinvel(body, ballMaxSpeed());
}
