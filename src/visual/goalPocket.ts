import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import {
	PLAYFIELD_SURFACE_Y,
	RL_ARENA,
} from "./arenaConstants";
import {
	makeArenaCuboidCollider,
	makeArenaTrimeshCollider,
	type ArenaSurfaceKind,
} from "./arenaPhysics";
import { GOAL_MOUTH_INSET, GoalVisual } from "./GoalVisual";
import { goalFrameMaterial, RL } from "./materials";
import { GOAL_COVE_RUN, RAMP_RUN } from "./perimeter/constants";
import { createPhysicsBodyRegistry } from "./physicsBodyRegistry";
import { buildGoalInteriorShell } from "./soccarShell";
import { SOCCAR_GOAL } from "./soccarShell/profiles";
import type { StadiumLeds } from "./stadiumLed";

const POST_HALF_X = SOCCAR_GOAL.postHalfX;
const POST_HALF_Z = SOCCAR_GOAL.postHalfZ;
const CROSSBAR_HALF_Y = SOCCAR_GOAL.crossbarHalfY;
const CROSSBAR_HALF_Z = SOCCAR_GOAL.crossbarHalfZ;
const BACK_WALL_HALF = SOCCAR_GOAL.backWallHalf;
const SIDE_WALL_HALF_X = SOCCAR_GOAL.sideWallHalfX;
const POCKET_CEILING_HALF_Y = SOCCAR_GOAL.ceilingHalfY;
/**
 * Podłoga kieszeni — overlap z murawą (bez czarnej szczeliny na linii).
 * Dawniej POCKET_LIP=-1.15 = podwójna podłoga / próg; dodatni = tonięcie.
 * −0.35 ≈ wizualny lipIntoPitch (klip 04-17: dziury przy bramce).
 */
const POCKET_LIP = SOCCAR_GOAL.pocketLip;
/** Płaska strefa wlotu — ćwiartki dopiero w głębi (bez wywrotki na linii). */
const GOAL_MOUTH_CLEAR = SOCCAR_GOAL.mouthClear;
/**
 * Gruba płyta (nie 5 cm) — cienka + CCD off = tunelowanie w kieszeni (klip F9).
 * Top powierzchni = PLAYFIELD_SURFACE_Y.
 */
const POCKET_FLOOR_HALF_Y = SOCCAR_GOAL.floorHalfY;
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
	surface: ArenaSurfaceKind = "wall",
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
 * Tylko ćwiartki ściana→sufit w głębi kieszeni.
 * Floor→ściany usunięte: niewidoczna „misa” więziła auto i kazała czekać na ześlizg.
 * Podłoga + boki/tył są płaskie / pionowe — wyjazd spod poprzeczki od razu.
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
	const backInnerZ = lineZ + zSign * (GOAL_DEPTH - BACK_WALL_HALF * 2);
	const ceilY = GOAL_HEIGHT - POCKET_CEILING_HALF_Y * 2;
	const sideInner = halfW - SIDE_WALL_HALF_X * 2;
	const mouthEndZ = lineZ + zSign * GOAL_MOUTH_CLEAR;
	const coveFlatZ = backInnerZ - zSign * cove;

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
 * Fizyka bramki — płaski wlot i płaska podłoga w całej kieszeni,
 * pionowe boki/tył; ćwiartki tylko przy styku ze sufitem.
 */
export function buildGoalPhysics(world: RAPIER.World): void {
	clearGoalPhysics(world);
	const { HALF_LENGTH, GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH } = RL_ARENA;
	const halfW = GOAL_WIDTH / 2;
	const cove = Math.min(GOAL_COVE_RUN, GOAL_DEPTH * 0.22, GOAL_HEIGHT * 0.28);
	const floorY = PLAYFIELD_SURFACE_Y;
	const ceilY = GOAL_HEIGHT - POCKET_CEILING_HALF_Y * 2;

	for (const zSign of [-1, 1] as const) {
		const lineZ = zSign * HALF_LENGTH;
		const backZ = lineZ + zSign * GOAL_DEPTH;
		const frameZ = lineZ + zSign * 0.05;
		const backInnerZ = lineZ + zSign * (GOAL_DEPTH - BACK_WALL_HALF * 2);
		const mouthEndZ = lineZ + zSign * GOAL_MOUTH_CLEAR;

		for (const x of [-halfW, halfW]) {
			/** Słupki — grubość = wizualna rura (klip: auto w poprzeczce). */
			addGoalCollider(
				world,
				x,
				GOAL_HEIGHT * 0.5,
				frameZ + zSign * (POST_HALF_Z * 0.35),
				POST_HALF_X,
				GOAL_HEIGHT * 0.5,
				POST_HALF_Z,
				"goal",
			);
		}

		/**
		 * Poprzeczka — tylko górna rura (klip F9: pełny cuboid = ściana pod belką).
		 * Wjazd z kieszeni na dach: addGoalInteriorRoofRim.
		 */
		addGoalCollider(
			world,
			0,
			GOAL_HEIGHT + SOCCAR_GOAL.tubeR * 0.55,
			frameZ + zSign * (CROSSBAR_HALF_Z * 0.2),
			halfW - POST_HALF_X * 0.35,
			SOCCAR_GOAL.tubeR * 0.55,
			CROSSBAR_HALF_Z * 0.85,
			"goal",
		);

		/**
		 * Kołnierz zewnętrzny (mouthCollar) — bez tego auto wjeżdża w dekor
		 * i kamera siedzi w rurze (F9 ~5–13 s).
		 */
		const collarHx = SOCCAR_GOAL.collarR + 0.06;
		const collarX = halfW + SOCCAR_GOAL.collarOut;
		const collarY = GOAL_HEIGHT + SOCCAR_GOAL.tubeR * 0.55;
		const collarZ = frameZ + zSign * (SOCCAR_GOAL.tubeR * 0.85);
		for (const x of [-collarX, collarX]) {
			addGoalCollider(
				world,
				x,
				GOAL_HEIGHT * 0.52,
				collarZ,
				collarHx,
				GOAL_HEIGHT * 0.52,
				SOCCAR_GOAL.collarR + 0.1,
				"goal",
			);
		}
		addGoalCollider(
			world,
			0,
			collarY,
			collarZ,
			halfW + SOCCAR_GOAL.collarOut * 0.35,
			SOCCAR_GOAL.collarR + 0.08,
			SOCCAR_GOAL.collarR + 0.12,
			"goal",
		);
		/**
		 * Daszek — w głąb kieszeni (nie półka na void).
		 * Wcześniej krótki daszek = zjazd za bramkę w OOB (klip ~5 s).
		 */
		addGoalCollider(
			world,
			0,
			GOAL_HEIGHT + SOCCAR_GOAL.tubeR * 0.85,
			frameZ + zSign * (GOAL_DEPTH * 0.42),
			halfW + SOCCAR_GOAL.collarOut * 0.4,
			SOCCAR_GOAL.tubeR * 0.65,
			GOAL_DEPTH * 0.42 + SOCCAR_GOAL.tubeR,
			"ceiling",
		);

		/** Tylna ściana — rideable (wall). */
		const backTop = ceilY - cove;
		const backHy = Math.max(0.5, (backTop - floorY) * 0.5);
		addGoalCollider(
			world,
			0,
			floorY + backHy,
			backZ - zSign * BACK_WALL_HALF,
			halfW - POST_HALF_X * 1.5 - cove,
			backHy,
			BACK_WALL_HALF,
			"wall",
		);

		/**
		 * Boczne ściany (wall-ride ON):
		 * - wlot: pełna wysokość,
		 * - głębia: od podłogi do ceiling-cove.
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
				"wall",
			);
		}

		const sideDeepZ0 = mouthEndZ;
		const sideDeepZ1 = backInnerZ - zSign * cove;
		const sideDeepCenter = (sideDeepZ0 + sideDeepZ1) * 0.5;
		const sideDeepHalfZ = Math.abs(sideDeepZ1 - sideDeepZ0) * 0.5;
		const sideHy = Math.max(0.5, (backTop - floorY) * 0.5);
		if (sideDeepHalfZ > 0.25) {
			for (const sx of [-1, 1]) {
				addGoalCollider(
					world,
					sx * (halfW - SIDE_WALL_HALF_X),
					floorY + sideHy,
					sideDeepCenter,
					SIDE_WALL_HALF_X,
					sideHy,
					sideDeepHalfZ,
					"wall",
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
				"ceiling",
			);
		}

		/** Podłoga — pod słupki + overlap z murawą (top = murawa). */
		const floorZ0 = lineZ + zSign * POCKET_LIP;
		const floorZ1 = backInnerZ;
		const floorCenterZ = (floorZ0 + floorZ1) * 0.5;
		const floorHalfZ = Math.abs(floorZ1 - floorZ0) * 0.5;
		addGoalCollider(
			world,
			0,
			PLAYFIELD_SURFACE_Y - POCKET_FLOOR_HALF_Y,
			floorCenterZ,
			halfW + POST_HALF_X * 0.85,
			POCKET_FLOOR_HALF_Y,
			floorHalfZ,
			"floor",
		);

		addGoalPocketCoves(world, zSign, lineZ);
	}

	buildGoalWingSeals(world);
	buildGoalRoofAccess(world);
	addGoalInteriorRoofRim(world);
}

/**
 * Klip F9: auto wspina się po siatce kieszeni i utyka pod belką (90°).
 * Rim: ćwiartka + schodki z wnętrza → nad rurą na dach zewnętrzny.
 */
function addGoalInteriorRoofRim(world: RAPIER.World): void {
	const { HALF_LENGTH, GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH } = RL_ARENA;
	const gw = GOAL_WIDTH / 2;
	const roofTop = GOAL_HEIGHT + SOCCAR_GOAL.tubeR + 0.06;
	const rim = Math.min(1.45, SOCCAR_GOAL.tubeR * 3.2, GOAL_HEIGHT * 0.22);
	const sideInner = gw - SIDE_WALL_HALF_X * 2;
	const ceilY = GOAL_HEIGHT - POCKET_CEILING_HALF_Y * 2;

	for (const zSign of [-1, 1] as const) {
		const lineZ = zSign * HALF_LENGTH;
		const frameZ = lineZ + zSign * 0.05;
		const backInnerZ = lineZ + zSign * (GOAL_DEPTH - BACK_WALL_HALF * 2);
		const mouthEndZ = lineZ + zSign * GOAL_MOUTH_CLEAR;

		/**
		 * Schodki mouth: pewny wjazd (trimesh bywa śliski pod kątem).
		 * Od spodu sufitu kieszeni → dach, w stronę boiska.
		 */
		const stepN = 8;
		for (let i = 0; i < stepN; i++) {
			const t = (i + 0.5) / stepN;
			const y = ceilY + t * (roofTop - ceilY);
			const z = mouthEndZ - zSign * (t * rim * 1.15);
			addGoalCollider(
				world,
				0,
				y,
				z,
				gw - POST_HALF_X * 0.2,
				0.11,
				0.42,
				"ceiling",
			);
		}

		/**
		 * Poprzeczka / mouth: z głębi kieszeni w górę i w stronę boiska na dach.
		 */
		{
			const { positions, indices } = buildCoveStrip({
				origin: {
					x: 0,
					y: ceilY - rim * 0.05,
					z: mouthEndZ + zSign * 0.15,
				},
				into: { x: 0, y: 1, z: 0 },
				up: { x: 0, y: 0, z: -zSign },
				span: { x: (gw - POST_HALF_X * 0.35) * 2, y: 0, z: 0 },
				cove: rim,
				alongSteps: 10,
				steps: 14,
				flip: zSign > 0,
			});
			addGoalTrimesh(world, positions, indices);
		}

		/** Boki kieszeni → dach (klip ~11 s). */
		for (const xSign of [-1, 1] as const) {
			const spanZ0 = lineZ + zSign * 0.2;
			const spanZ1 = mouthEndZ + zSign * 0.8;
			const spanMid = (spanZ0 + spanZ1) * 0.5;
			const spanLen = Math.abs(spanZ1 - spanZ0);
			if (spanLen < 0.5) continue;

			for (let i = 0; i < 6; i++) {
				const t = (i + 0.5) / 6;
				const y = ceilY + t * (roofTop - ceilY);
				const x = xSign * (sideInner - t * rim * 0.95);
				addGoalCollider(
					world,
					x,
					y,
					spanMid,
					0.5,
					0.1,
					spanLen * 0.45,
					"ceiling",
				);
			}

			const { positions, indices } = buildCoveStrip({
				origin: {
					x: xSign * sideInner,
					y: ceilY - rim * 0.08,
					z: spanMid,
				},
				into: { x: 0, y: 1, z: 0 },
				up: { x: -xSign, y: 0, z: 0 },
				span: { x: 0, y: 0, z: spanLen },
				cove: rim * 1.1,
				alongSteps: 7,
				steps: 14,
				flip: xSign > 0,
			});
			addGoalTrimesh(world, positions, indices);
		}

		/** Narożniki tył→bok. */
		for (const xSign of [-1, 1] as const) {
			for (let i = 0; i < 6; i++) {
				const t = (i + 0.5) / 6;
				const y0 =
					ceilY + t * (roofTop - ceilY);
				const x0 = xSign * (sideInner - t * rim * 0.9);
				const z0 = backInnerZ - zSign * (t * rim * 0.65);
				addGoalCollider(
					world,
					x0,
					y0,
					z0,
					0.6,
					0.12,
					0.6,
					"ceiling",
				);
			}
		}

		/** Ciągła półka na dachu nad światłem — lądowanie z rimu. */
		addGoalCollider(
			world,
			0,
			roofTop - 0.1,
			frameZ + zSign * (GOAL_DEPTH * 0.2),
			gw + SOCCAR_GOAL.collarOut * 0.6,
			0.16,
			GOAL_DEPTH * 0.28 + SOCCAR_GOAL.tubeR,
			"ceiling",
		);
	}
}

/**
 * Wjazd ze ścian areny na dach bramki.
 * Inner face bandy = lineZ ± RAMP_RUN — wcześniejszy dach przy linii = 3 m dziury.
 */
function buildGoalRoofAccess(world: RAPIER.World): void {
	const {
		HALF_LENGTH,
		GOAL_WIDTH,
		GOAL_HEIGHT,
		GOAL_DEPTH,
		HALF_WIDTH,
		CORNER_CUT,
		HEIGHT,
	} = RL_ARENA;
	const gw = GOAL_WIDTH / 2;
	const wingX = HALF_WIDTH - CORNER_CUT;
	const roofTop = GOAL_HEIGHT + SOCCAR_GOAL.tubeR + 0.06;
	const roofHalfY = 0.2;
	const roofY = roofTop - roofHalfY;
	const cove = Math.min(1.55, RAMP_RUN * 0.45);

	for (const zSign of [-1, 1] as const) {
		const lineZ = zSign * HALF_LENGTH;
		/** Jak PerimeterCage — tu kończy się rampa / zaczyna pion. */
		const wallFaceZ = lineZ + zSign * RAMP_RUN;
		const frameZ = lineZ + zSign * 0.05;

		/**
		 * Płyta dachu: od face bandy → w głąb kieszeni + lekki lip w pole.
		 * Szerokość = skrzydła (ścieżka z narożnika / end-wall).
		 */
		const roofZ0 = lineZ - zSign * 0.4;
		const roofZ1 = wallFaceZ + zSign * 0.2;
		const roofZPocket = lineZ + zSign * (GOAL_DEPTH * 0.72);
		const zLo = Math.min(roofZ0, roofZ1, roofZPocket);
		const zHi = Math.max(roofZ0, roofZ1, roofZPocket);
		const roofZMid = (zLo + zHi) * 0.5;
		const roofHalfZ = (zHi - zLo) * 0.5 + 0.05;

		addGoalCollider(
			world,
			0,
			roofY,
			roofZMid,
			wingX + 0.55,
			roofHalfY,
			roofHalfZ,
			"ceiling",
		);

		/** Mostek na wysokości rury — łagodzi stopień poprzeczki. */
		addGoalCollider(
			world,
			0,
			GOAL_HEIGHT + SOCCAR_GOAL.tubeR * 0.2,
			frameZ + zSign * (GOAL_DEPTH * 0.22),
			gw + SOCCAR_GOAL.collarOuterOut + 0.25,
			SOCCAR_GOAL.tubeR * 0.5,
			GOAL_DEPTH * 0.28 + 0.6,
			"ceiling",
		);

		/**
		 * Backboard nad otworem — uzupełnia lukę perimeter (brak edge |x|<gw).
		 * Bez tego nie ma „tylnej” ściany nad bramką do wjazdu na dach.
		 */
		const boardBottom = roofTop - 0.05;
		const boardTop = Math.min(HEIGHT - 3.5, GOAL_HEIGHT + 16);
		const boardHy = Math.max(1, (boardTop - boardBottom) * 0.5);
		addGoalCollider(
			world,
			0,
			boardBottom + boardHy,
			wallFaceZ + zSign * 0.12,
			gw + 0.55,
			boardHy,
			0.28,
			"wall",
		);

		/**
		 * Cove banda końcowa → dach (pełna szerokość skrzydeł).
		 * into = w górę, up = w stronę boiska (na płytę).
		 */
		{
			const xSpan = (wingX + 0.4) * 2;
			const { positions, indices } = buildCoveStrip({
				origin: {
					x: 0,
					y: roofTop - cove * 0.12,
					z: wallFaceZ,
				},
				into: { x: 0, y: 1, z: 0 },
				up: { x: 0, y: 0, z: -zSign },
				span: { x: xSpan, y: 0, z: 0 },
				cove,
				alongSteps: 10,
				steps: 12,
				flip: zSign > 0,
			});
			addGoalTrimesh(world, positions, indices);
		}

		/**
		 * Cove z bocznej bandy (przy skrzydle) → dach.
		 * Face boku = ±(HALF_WIDTH + RAMP_RUN); półka łączy do wingX.
		 */
		for (const xSign of [-1, 1] as const) {
			const sideFaceX = xSign * (HALF_WIDTH + RAMP_RUN);
			const shelfX0 = xSign * (wingX - 0.2);
			const shelfX1 = sideFaceX - xSign * 0.05;
			const shelfMidX = (shelfX0 + shelfX1) * 0.5;
			const shelfHalfX = Math.abs(shelfX1 - shelfX0) * 0.5;
			if (shelfHalfX < 0.35) continue;

			/** Półka narożna — dojazd z boku na dach. */
			const shelfZ0 = lineZ - zSign * 0.25;
			const shelfZ1 = wallFaceZ + zSign * 0.15;
			const shelfZMid = (shelfZ0 + shelfZ1) * 0.5;
			const shelfHalfZ = Math.abs(shelfZ1 - shelfZ0) * 0.5 + 0.1;
			addGoalCollider(
				world,
				shelfMidX,
				roofY,
				shelfZMid,
				shelfHalfX + 0.1,
				roofHalfY,
				shelfHalfZ,
				"ceiling",
			);

			const spanZ0 = lineZ - zSign * (CORNER_CUT * 0.35);
			const spanZ1 = wallFaceZ;
			const spanMid = (spanZ0 + spanZ1) * 0.5;
			const spanLen = Math.abs(spanZ1 - spanZ0);
			if (spanLen < 0.8) continue;

			const { positions, indices } = buildCoveStrip({
				origin: {
					x: sideFaceX,
					y: roofTop - cove * 0.1,
					z: spanMid,
				},
				into: { x: 0, y: 1, z: 0 },
				up: { x: -xSign, y: 0, z: 0 },
				span: { x: 0, y: 0, z: spanLen },
				cove: cove * 1.05,
				alongSteps: 6,
				steps: 12,
				flip: xSign < 0,
			});
			addGoalTrimesh(world, positions, indices);
		}
	}
}

/** Uszczelnia skrzydła + tył za linią — brak wyjazdu OOB obok/za bramką (klip F9). */
function buildGoalWingSeals(world: RAPIER.World): void {
	const {
		HALF_LENGTH,
		GOAL_WIDTH,
		GOAL_HEIGHT,
		GOAL_DEPTH,
		HALF_WIDTH,
		CORNER_CUT,
	} = RL_ARENA;
	const gw = GOAL_WIDTH / 2;
	const wingX = HALF_WIDTH - CORNER_CUT;
	/** Głębokość za linią: cała kieszeń + rampa — wcześniej RAMP_RUN+0.45 = dziura. */
	const sealDepth = GOAL_DEPTH + RAMP_RUN + 1.2;
	/**
	 * Ściany skrzydeł KOŃCZĄ SIĘ pod płytą dachu — wcześniej przebijały deck
	 * i blokowały przejazd ze ściany na dach.
	 */
	const wingTop = GOAL_HEIGHT + SOCCAR_GOAL.tubeR - 0.12;
	const wingHy = wingTop * 0.5;

	for (const zSign of [-1, 1] as const) {
		const lineZ = zSign * HALF_LENGTH;
		const z0 = lineZ + zSign * 0.05;
		const z1 = lineZ + zSign * sealDepth;
		const zMid = (z0 + z1) * 0.5;
		const zHalf = Math.abs(z1 - z0) * 0.5;

		for (const xSign of [-1, 1] as const) {
			const xNear = xSign * gw;
			const xFar = xSign * wingX;
			const midX = (xNear + xFar) * 0.5;
			const halfX = Math.max(0.35, Math.abs(xFar - xNear) * 0.5);

			/** Podłoga skrzydła. */
			addGoalCollider(
				world,
				midX,
				PLAYFIELD_SURFACE_Y - 0.25,
				zMid,
				halfX + 0.15,
				0.25,
				zHalf,
				"floor",
			);

			/**
			 * Wypełnienie skrzydła pod dachem — bez wystawania ponad deck.
			 */
			addGoalCollider(
				world,
				midX,
				wingHy,
				zMid,
				halfX + POST_HALF_X * 0.6,
				wingHy,
				zHalf,
				"wall",
			);

			/** Docisk do słupka od zewnątrz (światło bramki nietknięte). */
			addGoalCollider(
				world,
				xNear + xSign * (POST_HALF_X * 1.15),
				wingHy,
				zMid,
				POST_HALF_X * 1.35,
				wingHy,
				zHalf,
				"goal",
			);
		}

		/**
		 * Zewnętrzna ściana za kieszenią — auto nie spada „za bramkę”
		 * po zjechaniu z daszka/kołnierza.
		 */
		const backZ = lineZ + zSign * (GOAL_DEPTH + 0.55);
		addGoalCollider(
			world,
			0,
			wingHy,
			backZ,
			wingX + 0.4,
			wingHy,
			0.45,
			"wall",
		);
		/** Dach nad voidem za portalem — spójny z deckiem. */
		addGoalCollider(
			world,
			0,
			GOAL_HEIGHT + SOCCAR_GOAL.tubeR + 0.15,
			lineZ + zSign * (GOAL_DEPTH * 0.55),
			gw + SOCCAR_GOAL.collarOuterOut + 0.4,
			0.28,
			GOAL_DEPTH * 0.55 + 0.4,
			"ceiling",
		);
	}
}

export type GoalPocketSide = "blue" | "orange";

/** Dolna krawędź poprzeczki (środek − halfY rury). */
export const GOAL_MOUTH_MAX_BALL_TOP_Y =
	RL_ARENA.GOAL_HEIGHT - CROSSBAR_HALF_Y;
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

/** Czy pozycja jest wewnątrz wnęki bramkowej (za linią, nie na murawie). */
export function whichGoalPocket(
	pos: THREE.Vector3,
	margin = 0.15,
): GoalPocketSide | null {
	const { HALF_LENGTH, GOAL_WIDTH, GOAL_DEPTH } = RL_ARENA;
	const halfW = GOAL_WIDTH / 2 + margin;
	if (Math.abs(pos.x) > halfW) return null;

	const hl = HALF_LENGTH;
	/** Tylko za linią — nie wyłączaj wall-ride na boisku przed bramką. */
	if (pos.z > hl + 0.04 && pos.z < hl + GOAL_DEPTH + margin) return "orange";
	if (pos.z < -hl - 0.04 && pos.z > -hl - GOAL_DEPTH - margin) return "blue";
	return null;
}

export function isInsideGoalPocket(
	pos: THREE.Vector3,
	margin = 0.15,
): boolean {
	return whichGoalPocket(pos, margin) != null;
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

function goalPocketSealMaterial(): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color: 0x050308,
		roughness: 1,
		metalness: 0,
		side: THREE.DoubleSide,
		depthWrite: true,
	});
}

function buildGoalPocketFloor(
	parent: THREE.Object3D,
	team: "blue" | "orange",
	lineZ: number,
	zSign: 1 | -1,
): void {
	const { GOAL_WIDTH, GOAL_DEPTH } = RL_ARENA;
	/**
	 * Bez osobnej neonowej płyty (klip 04-34: czerwony prostokąt + czarne szwy).
	 * Murawa już wypełnia kieszeń (grass shape). Tu tylko ciemny seal POD spodem,
	 * żeby near-plane / szwy nie pokazywały skyboxa.
	 */
	const sidePad = POST_HALF_X * 3.2 + 0.8;
	const backPad = 0.8;
	const floorW = GOAL_WIDTH + sidePad * 2;
	const floorD = GOAL_DEPTH + backPad + 0.4;
	const sealMat = goalPocketSealMaterial();

	const floor = new THREE.Group();
	floor.name = `goalPocketFloor_${team}`;
	parent.add(floor);

	const mouthZ = lineZ - zSign * GOAL_MOUTH_INSET;
	const floorZ0 = mouthZ - zSign * 0.25;
	const floorZ1 = mouthZ + zSign * (GOAL_DEPTH + backPad);
	const pocketCenterZ = (floorZ0 + floorZ1) * 0.5;

	const seal = new THREE.Mesh(
		new THREE.BoxGeometry(floorW, 0.35, floorD),
		sealMat,
	);
	seal.name = `goalPocketSeal_${team}`;
	/** Całkowicie pod murawą — wcześniej 0.85 box wystawał jak „ściana”. */
	seal.position.set(0, PLAYFIELD_SURFACE_Y - 0.55, pocketCenterZ);
	seal.renderOrder = 0;
	seal.receiveShadow = true;
	floor.add(seal);
	void team;
}

function addGoalGlowLight(
	parent: THREE.Object3D,
	team: "blue" | "orange",
	lineZ: number,
	zSign: 1 | -1,
): void {
	const color = team === "blue" ? RL.goalBlue : RL.goalOrange;
	/** Mouth fill — czytelna kieszeń, nie czarna dziura. */
	const mouth = new THREE.PointLight(color, 4.6, 26, 1.15);
	mouth.name = `goalGlow_${team}`;
	mouth.position.set(
		0,
		RL_ARENA.GOAL_HEIGHT * 0.42,
		lineZ + zSign * (1.2 - GOAL_MOUTH_INSET),
	);
	mouth.castShadow = false;
	parent.add(mouth);

	/** Soft uplight na belkę / posts — depth przy night film. */
	const rim = new THREE.PointLight(color, 2.6, 16, 1.4);
	rim.name = `goalRim_${team}`;
	rim.position.set(
		0,
		RL_ARENA.GOAL_HEIGHT * 0.95,
		lineZ + zSign * (RL_ARENA.GOAL_DEPTH * 0.28 - GOAL_MOUTH_INSET),
	);
	rim.castShadow = false;
	parent.add(rim);

	/** Fill wewnątrz kieszeni — siatka + tył widoczne z midfieldu. */
	const pocket = new THREE.PointLight(color, 2.2, 18, 1.35);
	pocket.name = `goalPocketFill_${team}`;
	pocket.position.set(
		0,
		RL_ARENA.GOAL_HEIGHT * 0.38,
		lineZ + zSign * (RL_ARENA.GOAL_DEPTH * 0.55 - GOAL_MOUTH_INSET),
	);
	pocket.castShadow = false;
	parent.add(pocket);

	/** Boczne spill — czytelne słupki nocą. */
	for (const sx of [-1, 1] as const) {
		const side = new THREE.PointLight(color, 1.35, 12, 1.65);
		side.name = `goalSide_${team}_${sx > 0 ? "r" : "l"}`;
		side.position.set(
			sx * (RL_ARENA.GOAL_WIDTH * 0.42),
			RL_ARENA.GOAL_HEIGHT * 0.55,
			lineZ + zSign * (0.6 - GOAL_MOUTH_INSET),
		);
		side.castShadow = false;
		parent.add(side);
	}
}

/** Rama SoccarShell — proceduralna, 1:1 z colliders. */
function buildGoalFrame(
	parent: THREE.Group,
	team: "blue" | "orange",
	lineZ: number,
	zSign: 1 | -1,
	leds: StadiumLeds,
): void {
	const neon =
		team === "blue" ? leds.goalBlueFrameMat : leds.goalOrangeFrameMat;
	const visual = new GoalVisual(team, neon);
	visual.mount(parent, lineZ, zSign);
	addGoalGlowLight(parent, team, lineZ, zSign);
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
	/** Panele 1:1 z colliders — bez Meshy floor / wall-fill. */
	buildGoalInteriorShell(interior, team);
}

/** Pełna bramka RL — rama neonowa + płaska podłoga kieszeni. */
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
