import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import type GameObject from "../GameObject";
import { ramHitImpulseScale } from "../meta/carBodyTraits";
import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "../visual/arenaConstants";
import {
	GOAL_MOUTH_HALF_WIDTH,
	getGoalPocketAabb,
	isBallInsideGoalFrame,
	isInsideGoalPocket,
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
const _carUp = new THREE.Vector3();
const _carQuat = new THREE.Quaternion();
const _pocketProbe = new THREE.Vector3();
const _surfaceSlip = new THREE.Vector3();
const _surfaceImpulse = new THREE.Vector3();
const _surfaceCenter = new THREE.Vector3();
const _surfaceContact = new THREE.Vector3();
const _surfaceCross = new THREE.Vector3();
const _carVelA = new THREE.Vector3();
const _carVelB = new THREE.Vector3();
const _carRel = new THREE.Vector3();
const _carNormal = new THREE.Vector3();
const _magnusForce = new THREE.Vector3();
const _bestSurfaceN = new THREE.Vector3();

type Vec3Snap = { x: number; y: number; z: number };
const ballPreStepLinvel = new WeakMap<RAPIER.RigidBody, Vec3Snap>();
const ballPreStepAngvel = new WeakMap<RAPIER.RigidBody, Vec3Snap>();
/** Ostatni Psyonix hit (s, performance.now/1000 lub monotoniczny zegar gry). */
const carBallHitAt = new WeakMap<object, number>();
let ballSimClock = 0;

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

	/** Hood carry — piłka na masce (localY > 0, niski loft). */
	const hoodNorm = localY / (RL_BALL.radius + RL_CAR.hitboxHalfY);
	if (hoodNorm > 0 && hoodNorm < RL_BALL.hoodCarryLocalYMax) {
		loft *= RL_BALL.hoodCarryLoftMul;
	}

	const climb = THREE.MathUtils.clamp(-relVel.dot(up), 0, 16) * 0.085;
	loft += climb;
	if (player.isFlipping()) loft += 0.22;

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

/**
 * Anti-sink w kieszeni bramki.
 * minY = pełna wysokość ride (nie 0.95× — to nadal wyglądało jak tonięcie).
 * Próg up łagodniejszy — lekko przechylone auto też nie wpada w płytę.
 */
function enforceGoalPocketFloorSupport(
	body: RAPIER.RigidBody,
	pos: { x: number; y: number; z: number },
): void {
	_pocketProbe.set(pos.x, pos.y, pos.z);
	if (!isInsideGoalPocket(_pocketProbe, 0.45)) return;

	const rot = body.rotation();
	_carQuat.set(rot.x, rot.y, rot.z, rot.w);
	_carUp.set(0, 1, 0).applyQuaternion(_carQuat);
	if (_carUp.y < 0.45) return;

	const minY = PLAYFIELD_SURFACE_Y + RL_CAR.hitboxHalfY + 0.06;
	if (pos.y >= minY - 0.002) return;

	body.setTranslation({ x: pos.x, y: minY, z: pos.z }, true);
	const v = body.linvel();
	if (v.y < 0.15) {
		body.setLinvel({ x: v.x, y: Math.max(0, v.y), z: v.z }, true);
	}
}

/** Zapobiega znikaniu auta (NaN / teleport poza arenę) po uderzeniu w piłkę. */
export function stabilizePlayerPhysics(player: Player): void {
	const body = player.rapierRigidBody;
	const t = body.translation();

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

	/**
	 * AABB kieszeni (stary margin≈0.95) robił próg/ślizg — NIE wraca.
	 * Miękki support tylko gdy auto jest w miarę na kołach i tonie w podłodze
	 * (klip: pół auta w pomarańczowej płycie bramki).
	 */
	enforceGoalPocketFloorSupport(body, t);

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

		const lastHit = carBallHitAt.get(player) ?? -Infinity;
		const softContact = relSpeedUu < RL_BALL.softTouchSpeedUu;
		const cooldown = softContact
			? RL_BALL.softHitCooldownSec
			: RL_BALL.hitCooldownSec;
		if (ballSimClock - lastHit < cooldown) {
			/** Nowy twardy hit (duży closing) przebija cooldown. */
			if (closing < 4.5) return;
		}

		let factor =
			rlBallCarExtraImpulseFactor(relSpeedUu) * RL_BALL.extraForceScale;
		/** Soft touch / dribble — niższy impuls przy wolnych kontaktach. */
		if (relSpeedUu < RL_BALL.softTouchSpeedUu) {
			const t = relSpeedUu / RL_BALL.softTouchSpeedUu;
			factor *= THREE.MathUtils.lerp(RL_BALL.softTouchScaleMin, 1, t);
		}
		/** Domknij skalę do closing — twarde hity pełną mocą, soft nie wybucha. */
		factor *= THREE.MathUtils.clamp(
			closing / RL_BALL.closingScaleDiv,
			RL_BALL.closingScaleMin,
			1,
		);
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

		let addedSpeed = uuToMps(relSpeedUu) * factor;
		/** Twardy hit: dołóż inelastic share (jak Bullet w RL przy masywnym aucie). */
		if (relSpeedUu >= RL_BALL.softTouchSpeedUu) {
			addedSpeed += closing * RL_BALL.hardHitInelasticGain;
		}
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
		carBallHitAt.set(player, ballSimClock);

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
		const a = players[i]!;
		if (a.isDemolished()) continue;
		for (let j = i + 1; j < players.length; j++) {
			const b = players[j]!;
			if (b.isDemolished()) continue;
			applyCarCarPairHit(world, a, b, best);
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
		if (player.isDemolished()) continue;
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

/** CR zależny od powierzchni — rl_ball_sym: 0.6 wszędzie (Meridian = tryb specjalny). */
export function bounceRestitutionForNormal(ny: number): number {
	if (isMeridianArenaActive()) return 0.96;
	if (ny > 0.7) return RL_BALL.floorBounceRetain;
	if (ny < -0.7) return RL_BALL.ceilingBounceRetain;
	return RL_BALL.wallBounceRetain;
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

	/**
	 * Miękki kontakt z murawą — bez smish impulse co klatkę.
	 * Inaczej Coulomb μ zjada prędkość toczenia (ground_roll → 0).
	 */
	const isFloor = normal.y > 0.7;
	if (isFloor && -vn < RL_BALL.groundSettleVy) return;

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
 * Jeden impuls na klatkę (najsilniejszy kontakt) — unikaj multi-collider double-hit.
 */
export function applyBallArenaSurfaceContacts(
	world: RAPIER.World,
	ball: GameObject,
	ballRadius: number,
): void {
	const ballCollider = ball.rapierCollider;
	const body = ball.rapierRigidBody;

	let bestVn = 0;
	let bestE: number = RL_BALL.restitution;
	let found = false;

	world.contactPairsWith(ballCollider, (other) => {
		if (!isArenaCollider(other)) return;

		world.contactPair(ballCollider, other, (manifold, flipped) => {
			if (manifold.numSolverContacts() < 1) return;

			const raw = manifold.normal();
			_surfaceN.set(raw.x, raw.y, raw.z);
			if (flipped) _surfaceN.multiplyScalar(-1);
			if (_surfaceN.lengthSq() < 1e-8) return;
			_surfaceN.normalize();

			const pre = ballPreStepLinvel.get(body);
			const lv = body.linvel();
			const vx = pre?.x ?? lv.x;
			const vy = pre?.y ?? lv.y;
			const vz = pre?.z ?? lv.z;
			const vn = vx * _surfaceN.x + vy * _surfaceN.y + vz * _surfaceN.z;
			if (vn >= -0.12) return;
			if (!found || vn < bestVn) {
				found = true;
				bestVn = vn;
				bestE = bounceRestitutionForNormal(_surfaceN.y);
				_bestSurfaceN.copy(_surfaceN);
			}
		});
	});

	if (found) {
		resolveSmishBallContact(body, _bestSurfaceN, ballRadius, bestE);
		return;
	}

	// Rapier czasem nie zgłasza solver contact z murawą — fallback z pre-step vy.
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

/** Dynamiczne tarcie piłki — Rocket Science #4: slide 230 uu/s² na murawie. */
export function updateBallPhysics(
	ball: GameObject,
	ballRadius: number,
	dt: number,
	world?: RAPIER.World,
): void {
	ballSimClock += dt;
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

	/** rl_ball_sym air drag: v *= (1+DRAG)^dt — także przy kontakcie z ziemią. */
	{
		const drag = RL_BALL.airDrag as number;
		if (drag !== 0 && dt > 0) {
			const factor = (1 + drag) ** dt;
			const v0 = body.linvel();
			body.setLinvel(
				{ x: v0.x * factor, y: v0.y * factor, z: v0.z * factor },
				true,
			);
		}
	}

	const v = body.linvel();
	const horizSpeed = Math.hypot(v.x, v.z);
	const nearTurf = pos.y <= ballRadius + 0.06;
	const onGround =
		nearTurf && Math.abs(v.y) < 0.35 && horizSpeed < RL_BALL.maxSpeed;

	if (onGround) {
		body.setLinearDamping(RL_BALL.groundLinearDamp);
		body.setAngularDamping(RL_BALL.groundAngularDamp);

		/**
		 * Settle tylko przy realnym kontakcie (y≈r) — wcześniej zerowanie vy
		 * w paśmie r+0.08 zamrażało piłkę w powietrzu (fałszywy „ground”).
		 */
		const seated = pos.y <= ballRadius + 0.02;
		if (seated && Math.abs(v.y) < RL_BALL.groundSettleVy) {
			if (v.y < 0) {
				body.setLinvel({ x: v.x, y: 0, z: v.z }, true);
			}
			const vG = body.linvel();
			const hz = Math.hypot(vG.x, vG.z);
			if (hz > uuToMps(565)) {
				const decel = RL_BALL.groundSlideDecel * dt;
				const scale = Math.max(0, hz - decel) / Math.max(hz, 0.001);
				body.setLinvel({ x: vG.x * scale, y: 0, z: vG.z * scale }, true);
			} else if (hz > 0.05) {
				const scale = Math.max(0, 1 - RL_BALL.groundRollDecel * dt);
				body.setLinvel({ x: vG.x * scale, y: 0, z: vG.z * scale }, true);
			}
		}
	} else {
		body.setLinearDamping(RL_BALL.airLinearDamp);
		body.setAngularDamping(RL_BALL.airAngularDamp);

		const speed = Math.hypot(v.x, v.y, v.z);
		const av = body.angvel();
		const spin = Math.hypot(av.x, av.y, av.z);
		if (speed > 2.5 && spin > 0.35 && RL_BALL.magnusScale > 0) {
			/** ω × v — wyłączone w baseline (magnusScale=0); zostawione pod tryby. */
			_magnusForce.set(
				av.y * v.z - av.z * v.y,
				av.z * v.x - av.x * v.z,
				av.x * v.y - av.y * v.x,
			);
			const crossLen = _magnusForce.length();
			if (crossLen > 1e-5) {
				_magnusForce.multiplyScalar(
					(RL_BALL.magnusScale * spin * speed * dt) / crossLen,
				);
				body.setLinvel(
					{
						x: v.x + _magnusForce.x,
						y: v.y + _magnusForce.y,
						z: v.z + _magnusForce.z,
					},
					true,
				);
			}
		}
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
