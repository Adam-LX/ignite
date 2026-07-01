import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { RL_ARENA } from "./arenaConstants";
import { makeArenaCuboidCollider } from "./arenaPhysics";
import { createGoalNetMaterial } from "./goalNetMaterial";
import { goalFrameMaterial, RL } from "./materials";
import type { StadiumLeds } from "./stadiumLed";

const POST_HALF_X = 0.09;
const CROSSBAR_HALF_Y = 0.07;
const BACK_WALL_HALF = 0.1;
const SIDE_WALL_HALF_X = 0.11;
const POCKET_CEILING_HALF_Y = 0.07;
/** Kolizje wnętrza zaczynają się dopiero za linią bramkową. */
const POCKET_LIP = 0.45;
/** Promień rury ramy = promień sferycznego łącza (POST_HALF_X). */
const FRAME_TUBE_RADIUS = POST_HALF_X;
const FRAME_BEVEL = 0.045;

function addGoalCollider(
	world: RAPIER.World,
	x: number,
	y: number,
	z: number,
	hx: number,
	hy: number,
	hz: number,
): void {
	const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
	world.createCollider(makeArenaCuboidCollider(hx, hy, hz, "goal"), body);
	body.setTranslation({ x, y, z }, true);
}

/**
 * Fizyka bramki RL — słupki i poprzeczka na linii; tylna ściana w głębi.
 * Brak kolizji na linii bramkowej między słupkami (piłka wjeżdża płasko).
 */
export function buildGoalPhysics(world: RAPIER.World): void {
	const { HALF_LENGTH, GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH } = RL_ARENA;
	const halfW = GOAL_WIDTH / 2;
	const innerD = GOAL_DEPTH - POCKET_LIP - 0.08;
	const innerHy = GOAL_HEIGHT * 0.5 - 0.05;

	for (const zSign of [-1, 1] as const) {
		const lineZ = zSign * HALF_LENGTH;
		const backZ = lineZ + zSign * GOAL_DEPTH;
		const frameZ = lineZ + zSign * 0.05;
		const pocketCenterZ = lineZ + zSign * (POCKET_LIP + innerD * 0.5);
		const pocketHalfZ = innerD * 0.5;

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

		addGoalCollider(
			world,
			0,
			GOAL_HEIGHT * 0.5,
			backZ - zSign * BACK_WALL_HALF,
			halfW - POST_HALF_X * 1.5,
			GOAL_HEIGHT * 0.5,
			BACK_WALL_HALF,
		);

		// Boczne ściany wnęki — bez nich auto wylatuje „na miasto”.
		for (const sx of [-1, 1]) {
			addGoalCollider(
				world,
				sx * (halfW - SIDE_WALL_HALF_X),
				innerHy,
				pocketCenterZ,
				SIDE_WALL_HALF_X,
				innerHy,
				pocketHalfZ,
			);
		}

		addGoalCollider(
			world,
			0,
			GOAL_HEIGHT - POCKET_CEILING_HALF_Y,
			pocketCenterZ,
			halfW - POST_HALF_X * 1.2,
			POCKET_CEILING_HALF_Y,
			pocketHalfZ,
		);
	}
}

export type GoalPocketSide = "blue" | "orange";

/** Dolna krawędź poprzeczki (środek ramy − połowa wysokości belki). */
const CROSSBAR_BEAM_H = FRAME_TUBE_RADIUS * 1.55;
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
		emissiveIntensity: 1.0,
		transparent: true,
		opacity: 0.5,
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
	const y = 0.014;

	const floor = new THREE.Group();
	floor.name = `goalPocketFloor_${team}`;
	parent.add(floor);

	// Prostokąt wnęki — od linii bramkowej do tyłu.
	const pocketCenterZ = lineZ + zSign * (GOAL_DEPTH * 0.5);
	const pocket = new THREE.Mesh(
		new THREE.PlaneGeometry(GOAL_WIDTH - 0.15, GOAL_DEPTH),
		mat,
	);
	pocket.rotation.x = -Math.PI / 2;
	pocket.position.set(0, y, pocketCenterZ);
	pocket.renderOrder = 2;
	pocket.receiveShadow = true;
	floor.add(pocket);
}

function netMaterial(team: "blue" | "orange"): THREE.ShaderMaterial {
	return createGoalNetMaterial(team);
}

function frameMatForTeam(
	team: "blue" | "orange",
	leds: StadiumLeds,
): THREE.MeshStandardMaterial {
	return team === "blue" ? leds.goalBlueFrameMat : leds.goalOrangeFrameMat;
}

function addFrameBeam(
	parent: THREE.Object3D,
	geo: THREE.BufferGeometry,
	mat: THREE.Material,
	x: number,
	y: number,
	z: number,
	ry = 0,
): THREE.Mesh {
	const mesh = new THREE.Mesh(geo, mat);
	mesh.position.set(x, y, z);
	mesh.rotation.y = ry;
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	mesh.renderOrder = 7;
	parent.add(mesh);
	return mesh;
}

function roundedBeam(
	w: number,
	h: number,
	d: number,
	bevel = FRAME_BEVEL,
): RoundedBoxGeometry {
	return new RoundedBoxGeometry(w, h, d, 4, bevel);
}

/** Neonowa rama RL — słupki, poprzeczka, sferyczne łącza w narożnikach. */
function buildGoalFrame(
	parent: THREE.Group,
	team: "blue" | "orange",
	lineZ: number,
	zSign: 1 | -1,
	leds: StadiumLeds,
): void {
	const { GOAL_WIDTH, GOAL_HEIGHT } = RL_ARENA;
	const halfW = GOAL_WIDTH / 2;
	const mat = frameMatForTeam(team, leds);
	const frameZ = lineZ + zSign * 0.08;
	const tubeR = FRAME_TUBE_RADIUS;
	const postH = GOAL_HEIGHT - tubeR;
	const crossW = GOAL_WIDTH - tubeR * 2;
	const jointGeo = new THREE.SphereGeometry(tubeR, 16, 14);

	const frame = new THREE.Group();
	frame.name = `goalFrame_${team}`;
	parent.add(frame);

	for (const x of [-halfW, halfW]) {
		addFrameBeam(
			frame,
			roundedBeam(tubeR * 2, postH, tubeR * 2),
			mat,
			x,
			postH * 0.5,
			frameZ,
		);
		addFrameBeam(
			frame,
			roundedBeam(0.28, 0.06, 0.22, 0.028),
			mat,
			x,
			0.03,
			frameZ + zSign * 0.04,
		);

		const joint = new THREE.Mesh(jointGeo, mat);
		joint.position.set(x, GOAL_HEIGHT, frameZ);
		joint.renderOrder = 7;
		frame.add(joint);
	}

	addFrameBeam(
		frame,
		roundedBeam(crossW, tubeR * 1.55, tubeR * 2),
		mat,
		0,
		GOAL_HEIGHT,
		frameZ,
	);
}

function addNetPlane(
	parent: THREE.Object3D,
	w: number,
	h: number,
	x: number,
	y: number,
	z: number,
	mat: THREE.Material,
	rotX = 0,
	rotY = 0,
	segsW = 28,
	segsH = 20,
): void {
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h, segsW, segsH), mat);
	mesh.position.set(x, y, z);
	mesh.rotation.set(rotX, rotY, 0);
	mesh.renderOrder = 6;
	parent.add(mesh);
}

function buildGoalInterior(
	parent: THREE.Group,
	team: "blue" | "orange",
	lineZ: number,
	zSign: 1 | -1,
): void {
	const { GOAL_WIDTH, GOAL_HEIGHT, GOAL_DEPTH } = RL_ARENA;
	const halfW = GOAL_WIDTH / 2;
	const innerW = GOAL_WIDTH - 0.28;
	const innerH = GOAL_HEIGHT - 0.1;
	const innerD = GOAL_DEPTH - POCKET_LIP - 0.08;
	const backZ = lineZ + zSign * GOAL_DEPTH;
	const midZ = lineZ + zSign * (POCKET_LIP + innerD * 0.5);
	const net = netMaterial(team);

	const interior = new THREE.Group();
	interior.name = `goalInterior_${team}`;
	parent.add(interior);

	buildGoalPocketFloor(interior, team, lineZ, zSign);

	addNetPlane(
		interior,
		innerW - 0.35,
		innerH - 0.25,
		0,
		innerH * 0.5,
		backZ - zSign * 0.18,
		net,
		0,
		zSign < 0 ? Math.PI : 0,
	);
	for (const sx of [-1, 1]) {
		addNetPlane(
			interior,
			innerD - 0.25,
			innerH - 0.25,
			sx * (halfW - 0.28),
			innerH * 0.5,
			midZ,
			net,
			0,
			sx < 0 ? Math.PI / 2 : -Math.PI / 2,
		);
	}
	addNetPlane(
		interior,
		innerW - 0.35,
		innerD - 0.25,
		0,
		innerH - 0.2,
		midZ,
		net,
		-Math.PI / 2,
		0,
	);
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

		buildGoalFrame(goal, team, lineZ, zSign, leds);
		buildGoalInterior(goal, team, lineZ, zSign);
	}
}

/** Precompute materiałów ramek (wymaga StadiumLeds). */
export function primeGoalFrameMaterials(leds: StadiumLeds): void {
	goalFrameMaterial(RL.goalBlue);
	goalFrameMaterial(RL.goalOrange);
	void leds;
}
