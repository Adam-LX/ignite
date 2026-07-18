import type * as THREE from "three";

export type RampTeam = "blue" | "orange";

export type PerimeterEdge = {
	ax: number;
	az: number;
	bx: number;
	bz: number;
};

export type PerimeterSegment = PerimeterEdge & {
	length: number;
	cx: number;
	cy: number;
	cz: number;
	rampPos: THREE.Vector3;
	rampQuat: THREE.Quaternion;
	team: RampTeam;
	kind: "side" | "end" | "corner";
	outX: number;
	outZ: number;
};

export type RibbonVertex = {
	x: number;
	z: number;
	outX: number;
	outZ: number;
	run: number;
};

export type RibbonMeshData = {
	positions: Float32Array;
	indices: Uint32Array;
	groups: { start: number; count: number; materialIndex: number }[];
};
