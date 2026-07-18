import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import {
	PLAYFIELD_FLOOR_HALF_THICKNESS,
	PLAYFIELD_SURFACE_Y,
	RL_ARENA,
} from "./arenaConstants";
import {
	makeArenaCuboidCollider,
	makeArenaTrimeshCollider,
} from "./arenaPhysics";
import { GOAL_MOUTH_INSET, GoalVisual } from "./GoalVisual";
import { goalFrameMaterial, RL } from "./materials";
import { GOAL_COVE_RUN, RAMP_RUN } from "./perimeter/constants";
import { createPhysicsBodyRegistry } from "./physicsBodyRegistry";
import type { StadiumLeds } from "./stadiumLed";

const POST_HALF_X = 0.09;
const CROSSBAR_HALF_Y = 0.07;
const BACK_WALL_HALF = 0.1;
const SIDE_WALL_HALF_X = 0.11;
const POCKET_CEILING_HALF_Y = 0.07;
/**
 * Podłoga kieszeni mocno nachodzi na murawę — bez progu na linii bramkowej.
 * (Mały overlap + wcięcie shape = krawędź trimesha, o którą auto się potykało.)
 */
const POCKET_LIP = -1.15;
/** Płaska strefa wlotu — ćwiartki dopiero w głębi (bez wywrotki na linii). */
const GOAL_MOUTH_CLEAR = 2.8;
const POCKET_FLOOR_HALF_Y = PLAYFIELD_FLOOR_HALF_THICKNESS;
const FRAME_TUBE_RADIUS = POST_HALF_X;
const CROSSBAR_BEAM_H = FRAME_TUBE_RADIUS * 1.55;
const GOAL_COVE_STEPS = 8;

const goalPhysicsRegistry = createPhysicsBodyRegistry();

export function clearGoalPhysics(world: RAPIER.World): void {
	goalPhysicsRegistry.clear(world);
}

function addGoalCollider(
	world: RAPIER.World,
	x: number,
	y: number,
	z: number,
	hx: number,
	hy: number,
	hz: number,
	surface: "goal" | "floor" = "goal",
): void {
	const body = goalPhysicsRegistry.track(
		world,
		world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
	);
	world.createCollider(makeArenaCuboidCollider(hx, hy, hz, surface), body);
	body.setTranslation({ x, y, z }, true);
}

function addGoalTrimesh(
	world: RAPIER.World,
	positions: number[],
	indices: number[],
): void {
	if (positions.length < 9 || indices.length < 3) return;
	const body = goalPhysicsRegistry.track(
		world,
		world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
	);
	world.createCollider(
		makeArenaTrimeshCollider(
			new Float32Array(positions),
			new Uint32Array(indices),
			"ramp",
		),
		body,
	);
}

function buildCoveStrip(opts: {
	origin: { x: number; y: number; z: number };
	into: { x: number; y: number; z: number };
	up: { x: number; y: number; z: number };
	span: { x: number; y: number; z: number };
	cove: number;
	steps?: number;
	alongSteps?: number;
	flip?: boolean;
}): { positions: number[]; indices: number[] } {
	const steps = opts.steps ?? GOAL_COVE_STEPS;
	const alongSteps = opts.alongSteps ?? 4;
	const { origin, into, up, span, cove } = opts;
	const positions: number[] = [];
	const indices: number[] = [];

	for (let ai = 0; ai <= alongSteps; ai++) {
		const a = ai / alongSteps - 0.5;
		const bx = origin.x + span.x * a;
		const by = origin.y + span.y * a;
		const bz = origin.z + span.z * a;
		for (let si = 0; si <= steps; si++) {
			const t = si / steps;
			const th = t * Math.PI * 0.5;
			const run = cove * Math.sin(th);
			const h = cove * (1 - Math.cos(th));
			positions.push(
				bx + into.x * run + up.x * h,
				by + into.y * run + up.y * h,
				bz + into.z * run + up.z * h,
			);
		}
	}

	const stride = steps + 1;
	for (let ai = 0; ai < alongSteps; ai++) {
		for (let si = 0; si < steps; si++) {
			const i0 = ai * stride + si;
			const i1 = i0 + 1;
			const i2 = i0 + stride;
			const i3 = i2 + 1;
			if (opts.flip) {
				indices.push(i0, i1, i2, i1, i3, i2);
			} else {
				indices.push(i0, i2, i1, i1, i2, i3);
			}
		}
	}
	return { positions, indices };
}

/**
 * Ćwiartki tylko w głębi kieszeni — wlot (GOAL_MOUTH_CLEAR) zostaje płaski.
 * Floor→ściany + ściany→sufit → wall-ride na tył/sufit jak RL.
 */
function addGoalPocketCoves(
	world: RAPIER.World,
	zSign: 1 | -1,
	lineZ: number,
): void {
	const { GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH } = RL_ARENA;
	const cove = Math.min(GOAL_COVE_RUN, GOAL_DEPTH * 0.22, GOAL_HEIGHT * 0.28);
	if (cove < 0.4) return;

	const halfW = GOAL_WIDTH / 2 - POST_HALF_X * 1.25;
	const floorY = PLAYFIELD_SURFACE_Y;
	const backInnerZ = lineZ + zSign * (GOAL_DEPTH - BACK_WALL_HALF * 2);
	const ceilY = GOAL_HEIGHT - POCKET_CEILING_HALF_Y * 2;
	const sideInner = halfW - SIDE_WALL_HALF_X * 2;
	const mouthEndZ = lineZ + zSign * GOAL_MOUTH_CLEAR;
	const coveFlatZ = backInnerZ - zSign * cove;

	/** Floor → back wall */
	{
		const { positions, indices } = buildCoveStrip({
			origin: { x: 0, y: floorY, z: coveFlatZ },
			into: { x: 0, y: 0, z: zSign },
			up: { x: 0, y: 1, z: 0 },
			span: { x: (halfW - cove) * 2, y: 0, z: 0 },
			cove,
			flip: zSign < 0,
		});
		addGoalTrimesh(world, positions, indices);
	}

	/** Floor → side walls — tylko za mouth clear */
	for (const xSign of [-1, 1] as const) {
		const spanLen = Math.abs(coveFlatZ - mouthEndZ);
		if (spanLen < 0.4) continue;
		const midZ = (mouthEndZ + coveFlatZ) * 0.5;
		const { positions, indices } = buildCoveStrip({
			origin: {
				x: xSign * (sideInner - cove),
				y: floorY,
				z: midZ,
			},
			into: { x: xSign, y: 0, z: 0 },
			up: { x: 0, y: 1, z: 0 },
			span: { x: 0, y: 0, z: spanLen },
			cove,
			alongSteps: 5,
			flip: xSign > 0,
		});
		addGoalTrimesh(world, positions, indices);
	}

	/** Back wall → ceiling */
	{
		const { positions, indices } = buildCoveStrip({
			origin: { x: 0, y: ceilY - cove, z: backInnerZ },
			into: { x: 0, y: 1, z: 0 },
			up: { x: 0, y: 0, z: -zSign },
			span: { x: (halfW - cove) * 2, y: 0, z: 0 },
			cove,
			flip: zSign < 0,
		});
		addGoalTrimesh(world, positions, indices);
	}

	/** Side → ceiling — za mouth clear */
	for (const xSign of [-1, 1] as const) {
		const spanLen = Math.abs(coveFlatZ - mouthEndZ);
		if (spanLen < 0.4) continue;
		const midZ = (mouthEndZ + coveFlatZ) * 0.5;
		const { positions, indices } = buildCoveStrip({
			origin: {
				x: xSign * sideInner,
				y: ceilY - cove,
				z: midZ,
			},
			into: { x: 0, y: 1, z: 0 },
			up: { x: -xSign, y: 0, z: 0 },
			span: { x: 0, y: 0, z: spanLen },
			cove,
			alongSteps: 5,
			flip: xSign > 0,
		});
		addGoalTrimesh(world, positions, indices);
	}
}

/**
 * Fizyka bramki RL — płaski wlot, ćwiartki w głębi pod wall-ride tył/sufit.
 */
export function buildGoalPhysics(world: RAPIER.World): void {
	clearGoalPhysics(world);
	const { HALF_LENGTH, GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH } = RL_ARENA;
	const halfW = GOAL_WIDTH / 2;
	const cove = Math.min(GOAL_COVE_RUN, GOAL_DEPTH * 0.22, GOAL_HEIGHT * 0.28);

	for (const zSign of [-1, 1] as const) {
		const lineZ = zSign * HALF_LENGTH;
		const backZ = lineZ + zSign * GOAL_DEPTH;
		const frameZ = lineZ + zSign * 0.05;
		const backInnerZ = lineZ + zSign * (GOAL_DEPTH - BACK_WALL_HALF * 2);
		const floorY = PLAYFIELD_SURFACE_Y;
		const mouthEndZ = lineZ + zSign * GOAL_MOUTH_CLEAR;

		for (const x of [-halfW, halfW]) {
			addGoalCollider(
				world,
				x,
				GOAL_HEIGHT * 0.5,
				frameZ,
				POST_HALF_X,
				GOAL_HEIGHT * 0.5,
				0.07,
			);
		}

		addGoalCollider(
			world,
			0,
			GOAL_HEIGHT,
			frameZ,
			halfW - POST_HALF_X,
			CROSSBAR_HALF_Y,
			0.07,
		);

		/** Tylna ściana — od czubka floor-cove do startu ceiling-cove. */
		const backHy = Math.max(0.5, (GOAL_HEIGHT - cove * 2) * 0.5);
		addGoalCollider(
			world,
			0,
			floorY + cove + backHy,
			backZ - zSign * BACK_WALL_HALF,
			halfW - POST_HALF_X * 1.5 - cove,
			backHy,
			BACK_WALL_HALF,
		);

		/**
		 * Boczne ściany:
		 * - w strefie wlotu: pełna wysokość (płaski korytarz),
		 * - w głębi: wcięte o cove pod ćwiartki.
		 */
		const sideMouthZ1 = mouthEndZ;
		const sideMouthCenter = (lineZ + sideMouthZ1) * 0.5;
		const sideMouthHalfZ = Math.abs(sideMouthZ1 - lineZ) * 0.5;
		for (const sx of [-1, 1]) {
			addGoalCollider(
				world,
				sx * (halfW - SIDE_WALL_HALF_X),
				GOAL_HEIGHT * 0.5,
				sideMouthCenter,
				SIDE_WALL_HALF_X,
				GOAL_HEIGHT * 0.5,
				Math.max(0.2, sideMouthHalfZ),
			);
		}

		const sideDeepZ0 = mouthEndZ;
		const sideDeepZ1 = backInnerZ - zSign * cove;
		const sideDeepCenter = (sideDeepZ0 + sideDeepZ1) * 0.5;
		const sideDeepHalfZ = Math.abs(sideDeepZ1 - sideDeepZ0) * 0.5;
		const sideHy = Math.max(0.5, (GOAL_HEIGHT - cove * 2) * 0.5);
		if (sideDeepHalfZ > 0.25) {
			for (const sx of [-1, 1]) {
				addGoalCollider(
					world,
					sx * (halfW - SIDE_WALL_HALF_X),
					floorY + cove + sideHy,
					sideDeepCenter,
					SIDE_WALL_HALF_X,
					sideHy,
					sideDeepHalfZ,
				);
			}
		}

		/** Sufit — zaczyna się za wlotem (nie nad linią). */
		const ceilZ0 = mouthEndZ;
		const ceilZ1 = backInnerZ - zSign * cove;
		const ceilCenterZ = (ceilZ0 + ceilZ1) * 0.5;
		const ceilHalfZ = Math.abs(ceilZ1 - ceilZ0) * 0.5;
		if (ceilHalfZ > 0.25) {
			addGoalCollider(
				world,
				0,
				GOAL_HEIGHT - POCKET_CEILING_HALF_Y,
				ceilCenterZ,
				halfW - POST_HALF_X * 1.2 - cove,
				POCKET_CEILING_HALF_Y,
				ceilHalfZ,
			);
		}

		/** Podłoga — ciągła do startu floor→back cove. */
		const floorZ0 = lineZ + zSign * POCKET_LIP;
		const floorZ1 = backInnerZ - zSign * cove;
		const floorCenterZ = (floorZ0 + floorZ1) * 0.5;
		const floorHalfZ = Math.abs(floorZ1 - floorZ0) * 0.5;
		addGoalCollider(
			world,
			0,
			PLAYFIELD_SURFACE_Y - POCKET_FLOOR_HALF_Y,
			floorCenterZ,
			halfW - POST_HALF_X * 1.2 - cove,
			POCKET_FLOOR_HALF_Y,
			floorHalfZ,
			"floor",
		);

		addGoalPocketCoves(world, zSign, lineZ);
	}

	buildGoalWingSeals(world);
}

/** Uszczelnia skrzydła za linią bramkową — słupek styka się z bandą, brak wyjazdu obok. */
function buildGoalWingSeals(world: RAPIER.World): void {
	const { HALF_LENGTH, GOAL_WIDTH, GOAL_HEIGHT, HALF_WIDTH, CORNER_CUT } =
		RL_ARENA;
	const gw = GOAL_WIDTH / 2;
	const wingX = HALF_WIDTH - CORNER_CUT;
	const sealDepth = RAMP_RUN + 0.45;

	for (const zSign of [-1, 1] as const) {
		const lineZ = zSign * HALF_LENGTH;
		/** Start ściśle za linią — bez wystawania na boisko / w światło bramki. */
		const z0 = lineZ + zSign * 0.1;
		const z1 = lineZ + zSign * sealDepth;
		const zMid = (z0 + z1) * 0.5;
		const zHalf = Math.abs(z1 - z0) * 0.5;

		for (const xSign of [-1, 1] as const) {
			const xNear = xSign * gw;
			const xFar = xSign * wingX;
			const midX = (xNear + xFar) * 0.5;
			const halfX = Math.abs(xFar - xNear) * 0.5;

			addGoalCollider(world, midX, 0.28, zMid, halfX, 0.28, zHalf);

			/** Słupek uszczelki na zewnątrz od światła (nie w |x|<gw). */
			addGoalCollider(
				world,
				xNear + xSign * (POST_HALF_X * 2.2),
				GOAL_HEIGHT * 0.42,
				zMid,
				POST_HALF_X * 1.1,
				GOAL_HEIGHT * 0.42,
				zHalf,
			);
		}
	}
}

export type GoalPocketSide = "blue" | "orange";

/** Dolna krawędź poprzeczki (środek ramy − połowa wysokości belki). */
export const GOAL_MOUTH_MAX_BALL_TOP_Y =
	RL_ARENA.GOAL_HEIGHT - CROSSBAR_BEAM_H * 0.5;
/** Wewnętrzna szerokość między słupkami (od wewnętrznej krawędzi rur). */
export const GOAL_MOUTH_HALF_WIDTH = RL_ARENA.GOAL_WIDTH / 2 - POST_HALF_X;
const GOAL_FRAME_SLACK = 0.06;

/**
 * Czy cała piłka mieści się w otworze bramki (słupki + poprzeczka).
 * Gol NIE liczy się nad poprzeczką ani obok słupków.
 */
export function isBallInsideGoalFrame(
	pos: THREE.Vector3,
	ballRadius: number,
	slack = GOAL_FRAME_SLACK,
): boolean {
	if (Math.abs(pos.x) + ballRadius > GOAL_MOUTH_HALF_WIDTH + slack)
		return false;
	if (pos.y + ballRadius > GOAL_MOUTH_MAX_BALL_TOP_Y + slack) return false;
	// Piłka na murawie ma bottom ≈ 0 — poprzedni próg +slack odrzucał ją z bramki.
	if (pos.y - ballRadius < -slack) return false;
	return true;
}

/** Czy pozycja jest wewnątrz wnęki bramkowej (nie tylko w świetle na murawie). */
export function whichGoalPocket(
	pos: THREE.Vector3,
	margin = 0.15,
): GoalPocketSide | null {
	const { HALF_LENGTH, GOAL_WIDTH, GOAL_DEPTH } = RL_ARENA;
	const halfW = GOAL_WIDTH / 2 + margin;
	if (Math.abs(pos.x) > halfW) return null;

	const hl = HALF_LENGTH;
	if (pos.z > hl - margin && pos.z < hl + GOAL_DEPTH + margin) return "orange";
	if (pos.z < -hl + margin && pos.z > -hl - GOAL_DEPTH - margin) return "blue";
	return null;
}

export function getGoalPocketAabb(side: GoalPocketSide, margin = 0.15) {
	const { HALF_LENGTH, GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH } = RL_ARENA;
	const zSign = side === "orange" ? 1 : -1;
	const lineZ = zSign * HALF_LENGTH;
	const lipZ = lineZ + zSign * POCKET_LIP;
	const backZ = lineZ + zSign * GOAL_DEPTH;
	const halfW = GOAL_WIDTH / 2 - margin;

	return {
		minX: -halfW,
		maxX: halfW,
		minY: margin,
		maxY: GOAL_HEIGHT - margin * 0.5,
		minZ: Math.min(lipZ, backZ),
		maxZ: Math.max(lipZ, backZ),
	};
}

function goalPocketFloorMaterial(
	team: "blue" | "orange",
): THREE.MeshStandardMaterial {
	const isBlue = team === "blue";
	return new THREE.MeshStandardMaterial({
		color: isBlue ? 0x0055ff : 0xff3300,
		emissive: isBlue ? 0x00aaff : 0xff6600,
		emissiveIntensity: 2.4,
		transparent: true,
		opacity: 0.55,
		roughness: 1.0,
		metalness: 0,
		side: THREE.DoubleSide,
		depthWrite: true,
		polygonOffset: true,
		polygonOffsetFactor: -2,
		polygonOffsetUnits: -2,
	});
}

function buildGoalPocketFloor(
	parent: THREE.Object3D,
	team: "blue" | "orange",
	lineZ: number,
	zSign: 1 | -1,
): void {
	const { GOAL_WIDTH, GOAL_DEPTH } = RL_ARENA;
	const mat = goalPocketFloorMaterial(team);
	const y = PLAYFIELD_SURFACE_Y + 0.002;

	const floor = new THREE.Group();
	floor.name = `goalPocketFloor_${team}`;
	parent.add(floor);

	const mouthZ = lineZ - zSign * GOAL_MOUTH_INSET;
	const pocketCenterZ = mouthZ + zSign * (GOAL_DEPTH * 0.5);
	const pocket = new THREE.Mesh(
		new THREE.PlaneGeometry(GOAL_WIDTH, GOAL_DEPTH),
		mat,
	);
	pocket.rotation.x = -Math.PI / 2;
	pocket.position.set(0, y, pocketCenterZ);
	pocket.renderOrder = 2;
	pocket.receiveShadow = true;
	floor.add(pocket);
}

function addGoalGlowLight(
	parent: THREE.Object3D,
	team: "blue" | "orange",
	lineZ: number,
	zSign: 1 | -1,
): void {
	const color = team === "blue" ? RL.goalBlue : RL.goalOrange;
	const light = new THREE.PointLight(color, 7.2, 22, 1.15);
	light.name = `goalGlow_${team}`;
	light.position.set(
		0,
		RL_ARENA.GOAL_HEIGHT * 0.45,
		lineZ + zSign * (1.8 - GOAL_MOUTH_INSET),
	);
	parent.add(light);
}

/** Neonowa rama RL — GoalVisual (Meshy frame + kod siatki) lub proceduralny fallback. */
function buildGoalFrame(
	parent: THREE.Group,
	team: "blue" | "orange",
	lineZ: number,
	zSign: 1 | -1,
	leds: StadiumLeds,
): void {
	const visual = new GoalVisual(team);
	visual.mount(parent, lineZ, zSign);
	addGoalGlowLight(parent, team, lineZ, zSign);
	void leds;
}

function buildGoalInterior(
	parent: THREE.Group,
	team: "blue" | "orange",
	lineZ: number,
	zSign: 1 | -1,
): void {
	const interior = new THREE.Group();
	interior.name = `goalInterior_${team}`;
	parent.add(interior);
	buildGoalPocketFloor(interior, team, lineZ, zSign);
}

/** Pełna bramka RL — rama neonowa + wnętrze z zaokrągleniami. */
export function buildGoalVisuals(
	stadium: THREE.Group,
	leds: StadiumLeds,
): void {
	const { HALF_LENGTH } = RL_ARENA;

	for (const zSign of [-1, 1] as const) {
		const team = zSign > 0 ? "orange" : "blue";
		const lineZ = zSign * HALF_LENGTH;

		const goal = new THREE.Group();
		goal.name = `goal_${team}`;
		stadium.add(goal);

		buildGoalInterior(goal, team, lineZ, zSign);
		buildGoalFrame(goal, team, lineZ, zSign, leds);
	}
}

/** Precompute materiałów ramek (wymaga StadiumLeds). */
export function primeGoalFrameMaterials(leds: StadiumLeds): void {
	goalFrameMaterial(RL.goalBlue);
	goalFrameMaterial(RL.goalOrange);
	void leds;
}
