import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import { RL_ARENA } from "../visual/arenaConstants";
import { buildPerimeterSegments } from "../visual/arenaPerimeter";
import { WORLD_GRAVITY } from "./rlConstants";

const CAR_HALF = { x: 0.9, y: 0.35, z: 1.45 };
const RAMP_TOP_Y = RL_ARENA.RAMP_SIZE / Math.SQRT2;

function addFloor(world: RAPIER.World): void {
	const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
	world.createCollider(
		RAPIER.ColliderDesc.cuboid(
			RL_ARENA.HALF_WIDTH + 5,
			0.1,
			RL_ARENA.HALF_LENGTH + 5,
		).setFriction(0.95),
		body,
	);
	body.setTranslation({ x: 0, y: -0.05, z: 0 }, true);
}

function rampWedgeMesh(
	seg: ReturnType<typeof buildPerimeterSegments>[number],
): {
	verts: Float32Array;
	indices: Uint32Array;
} {
	const run = RL_ARENA.RAMP_SIZE / Math.SQRT2;

	const ix0 = seg.ax;
	const iz0 = seg.az;
	const ix1 = seg.bx;
	const iz1 = seg.bz;
	const wx0 = seg.ax + seg.outX * run;
	const wz0 = seg.az + seg.outZ * run;
	const wx1 = seg.bx + seg.outX * run;
	const wz1 = seg.bz + seg.outZ * run;

	const verts = new Float32Array([
		ix0,
		0,
		iz0,
		wx0,
		0,
		wz0,
		ix1,
		0,
		iz1,
		wx1,
		0,
		wz1,
		wx0,
		RAMP_TOP_Y,
		wz0,
		wx1,
		RAMP_TOP_Y,
		wz1,
	]);

	const indices = new Uint32Array([
		0, 2, 5, 0, 5, 4, 1, 3, 5, 1, 5, 4, 0, 1, 3, 0, 3, 2,
	]);

	return { verts, indices };
}

function addRampColliderFromSegment(
	world: RAPIER.World,
	seg: ReturnType<typeof buildPerimeterSegments>[number],
): void {
	const { verts, indices } = rampWedgeMesh(seg);
	const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
	world.createCollider(
		RAPIER.ColliderDesc.trimesh(verts, indices)
			.setFriction(0.92)
			.setRestitution(0.35),
		body,
	);
}

/** Headless symulacja wjazdu auta (30 m/s) na lewą rampę boczną. */
export async function debugWallRideSimulation(): Promise<void> {
	await RAPIER.init();

	const world = new RAPIER.World({ x: 0, y: WORLD_GRAVITY, z: 0 });
	addFloor(world);

	const segments = buildPerimeterSegments();
	const rampSeg =
		segments.find((s) => s.kind === "side" && s.cx < 0 && s.cz < -10) ??
		segments[0];

	addRampColliderFromSegment(world, rampSeg);

	const wallH = RL_ARENA.HEIGHT - RAMP_TOP_Y;
	const wy = RAMP_TOP_Y + wallH * 0.5;
	const midX = (rampSeg.ax + rampSeg.bx) * 0.5 + rampSeg.outX * 0.275;
	const midZ = (rampSeg.az + rampSeg.bz) * 0.5 + rampSeg.outZ * 0.275;
	const wallBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
	world.createCollider(
		RAPIER.ColliderDesc.cuboid(
			0.275,
			wallH / 2,
			rampSeg.length / 2,
		).setFriction(0.92),
		wallBody,
	);
	wallBody.setTranslation({ x: midX, y: wy, z: midZ }, true);

	const carBody = world.createRigidBody(
		RAPIER.RigidBodyDesc.dynamic()
			.setLinearDamping(0.05)
			.setAngularDamping(0.4)
			.setCcdEnabled(true),
	);
	world.createCollider(
		RAPIER.ColliderDesc.cuboid(CAR_HALF.x, CAR_HALF.y, CAR_HALF.z)
			.setMass(1.58)
			.setFriction(0.85)
			.setRestitution(0.05),
		carBody,
	);

	const startX = rampSeg.cx + 14;
	const startZ = rampSeg.cz;
	carBody.setTranslation({ x: startX, y: 0.6, z: startZ }, true);
	carBody.setRotation({ x: 0, y: Math.PI / 2, z: 0, w: 1 }, true);
	carBody.setLinvel({ x: -30, y: 0, z: 0 }, true);

	const down = new THREE.Vector3(0, -1, 0);
	const forward = new THREE.Vector3(-1, 0, 0);
	const origin = new THREE.Vector3();
	const normal = new THREE.Vector3();
	let minY = Infinity;
	let maxY = -Infinity;
	let penetrated = false;
	let bounced = false;
	let rampHits = 0;
	let prevVx = -30;

	console.log("[debugWallRide] start ramp seg", {
		kind: rampSeg.kind,
		ax: rampSeg.ax,
		az: rampSeg.az,
		bx: rampSeg.bx,
		bz: rampSeg.bz,
		cx: rampSeg.cx,
		cz: rampSeg.cz,
		length: rampSeg.length,
	});

	for (let frame = 0; frame < 240; frame++) {
		world.step();

		const t = carBody.translation();
		const v = carBody.linvel();
		minY = Math.min(minY, t.y);
		maxY = Math.max(maxY, t.y);

		if (v.x > 5 && prevVx < -5) bounced = true;
		prevVx = v.x;

		if (t.y < -2 || t.y > RL_ARENA.HEIGHT + 5) penetrated = true;

		origin.set(t.x, t.y + 0.15, t.z);
		const downRay = new RAPIER.Ray(
			{ x: origin.x, y: origin.y, z: origin.z },
			{ x: down.x, y: down.y, z: down.z },
		);
		const downHit = world.castRayAndGetNormal(
			downRay,
			3,
			true,
			undefined,
			undefined,
			undefined,
			carBody,
		);

		const fwdRay = new RAPIER.Ray(
			{ x: t.x, y: t.y + 0.2, z: t.z },
			{ x: forward.x, y: forward.y, z: forward.z },
		);
		const fwdHit = world.castRayAndGetNormal(
			fwdRay,
			4,
			true,
			undefined,
			undefined,
			undefined,
			carBody,
		);

		if (downHit && frame % 20 === 0) {
			normal.set(downHit.normal.x, downHit.normal.y, downHit.normal.z);
			console.log(
				`[debugWallRide] f=${frame} y=${t.y.toFixed(3)} surfaceNormal=(${normal.x.toFixed(3)}, ${normal.y.toFixed(3)}, ${normal.z.toFixed(3)}) v=(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}) x=${t.x.toFixed(2)}`,
			);
		}

		if (fwdHit && fwdHit.normal.y > 0.45 && Math.abs(fwdHit.normal.x) > 0.35) {
			rampHits++;
			if (frame <= 60 || t.y > 0.55) {
				normal.set(fwdHit.normal.x, fwdHit.normal.y, fwdHit.normal.z);
				console.log(
					`[debugWallRide] RAMP f=${frame} surfaceNormal=(${normal.x.toFixed(3)}, ${normal.y.toFixed(3)}, ${normal.z.toFixed(3)}) y=${t.y.toFixed(3)}`,
				);
			}
		}
	}

	const end = carBody.translation();
	const pass =
		!penetrated &&
		minY > -0.5 &&
		maxY < RL_ARENA.HEIGHT &&
		maxY > 1.0 &&
		rampHits > 0;
	console.log("[debugWallRide] result", {
		pass,
		endY: end.y,
		minY,
		maxY,
		bounced,
		penetrated,
		rampHits,
		endX: end.x,
		endZ: end.z,
	});
}
