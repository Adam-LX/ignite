import * as THREE from "three";

import { getArenaPerimeterEdges } from "../arenaConstants";

import { RAMP_CENTER_Y, RAMP_RUN } from "./constants";
import type { PerimeterEdge, PerimeterSegment, RampTeam } from "./types";

const _inward = new THREE.Vector3();

function teamFromMidZ(z: number): RampTeam {
	return z < 0 ? "blue" : "orange";
}

function classifySegment(
	dx: number,
	dz: number,
	len: number,
): PerimeterSegment["kind"] {
	if (Math.abs(dx) < len * 0.08) return "side";
	if (Math.abs(dz) < len * 0.08) return "end";
	return "corner";
}

function inwardFromMid(
	midX: number,
	midZ: number,
	dx: number,
	dz: number,
	len: number,
): THREE.Vector3 {
	const r = Math.hypot(midX, midZ);
	if (r > 0.5) {
		return _inward.set(-midX / r, 0, -midZ / r);
	}
	return _inward.set(-dz / len, 0, dx / len);
}

function buildRampFrame(
	midX: number,
	midZ: number,
	dx: number,
	dz: number,
	len: number,
): { pos: THREE.Vector3; quat: THREE.Quaternion } {
	const inward = inwardFromMid(midX, midZ, dx, dz, len);
	const tangent = new THREE.Vector3(dx / len, 0, dz / len);
	const slope = new THREE.Vector3(inward.x, 1, inward.z).normalize();
	const bitangent = new THREE.Vector3()
		.crossVectors(slope, tangent)
		.normalize();
	const rotMat = new THREE.Matrix4().makeBasis(tangent, bitangent, slope);
	const quat = new THREE.Quaternion().setFromRotationMatrix(rotMat);
	const pos = new THREE.Vector3(
		midX + inward.x * (RAMP_CENTER_Y - RAMP_RUN),
		RAMP_CENTER_Y,
		midZ + inward.z * (RAMP_CENTER_Y - RAMP_RUN),
	);
	return { pos, quat };
}

export function buildPerimeterSegments(
	edges: PerimeterEdge[] = getArenaPerimeterEdges(),
): PerimeterSegment[] {
	return edges.map((edge) => {
		const dx = edge.bx - edge.ax;
		const dz = edge.bz - edge.az;
		const length = Math.hypot(dx, dz);
		const midX = (edge.ax + edge.bx) * 0.5;
		const midZ = (edge.az + edge.bz) * 0.5;
		const inward = inwardFromMid(midX, midZ, dx, dz, length);
		const kind = classifySegment(dx, dz, length);
		const frame = buildRampFrame(midX, midZ, dx, dz, length);

		return {
			...edge,
			length,
			cx: frame.pos.x,
			cy: frame.pos.y,
			cz: frame.pos.z,
			rampPos: frame.pos,
			rampQuat: frame.quat,
			team: teamFromMidZ(midZ),
			kind,
			outX: -inward.x,
			outZ: -inward.z,
		};
	});
}
