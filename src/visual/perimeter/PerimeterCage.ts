import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import { RL_ARENA } from "../arenaConstants";
import {
	makeArenaCuboidCollider,
	makeArenaTrimeshCollider,
} from "../arenaPhysics";
import {
	arenaCeilingMaterial,
	flatRampShadowMaterial,
	neonWallMaterial,
} from "../materials";
import { RAMP_RUN, RAMP_TOP_Y, WALL_THICKNESS } from "./constants";
import { perimeterGeometry } from "./PerimeterGeometry";
import { perimeterLEDs } from "./PerimeterLEDs";
import { perimeterShadows } from "./PerimeterShadows";
import { buildPerimeterWallGeometry } from "./perimeterWallMesh";
import type { PerimeterSegment, RibbonMeshData, RibbonVertex } from "./types";

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

const SHARED_MATS = new Set<THREE.Material>([
	...perimeterGeometry.rampMaterials,
	perimeterLEDs.material,
	flatRampShadowMaterial(),
]);

function addRibbonMesh(
	parent: THREE.Group,
	data: RibbonMeshData,
	materials: THREE.Material[],
	name: string,
	renderOrder = 0,
): THREE.Mesh {
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
	geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
	for (const g of data.groups) {
		if (g.count > 0) geo.addGroup(g.start, g.count, g.materialIndex);
	}
	geo.computeVertexNormals();

	const mesh = new THREE.Mesh(
		geo,
		materials.length === 1 ? materials[0] : materials,
	);
	mesh.name = name;
	mesh.castShadow = false;
	mesh.receiveShadow = name === "wallRamp";
	mesh.frustumCulled = false;
	mesh.renderOrder = renderOrder;
	parent.add(mesh);
	return mesh;
}

function addRampCollider(
	world: RAPIER.World,
	positions: Float32Array,
	indices: Uint32Array,
): void {
	const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
	world.createCollider(
		makeArenaTrimeshCollider(positions, indices, "ramp"),
		body,
	);
}

function addFixedBox(
	world: RAPIER.World,
	x: number,
	y: number,
	z: number,
	hx: number,
	hy: number,
	hz: number,
	rotX = 0,
	rotY = 0,
	rotZ = 0,
	surface: "wall" | "goal" = "wall",
): void {
	const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
	world.createCollider(makeArenaCuboidCollider(hx, hy, hz, surface), body);
	body.setTranslation({ x, y, z }, true);
	if (rotX !== 0 || rotY !== 0 || rotZ !== 0) {
		_euler.set(rotX, rotY, rotZ);
		_quat.setFromEuler(_euler);
		body.setRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w }, true);
	}
}

function wallInnerAnchor(seg: PerimeterSegment): { x: number; z: number } {
	const midX = (seg.ax + seg.bx) * 0.5;
	const midZ = (seg.az + seg.bz) * 0.5;
	return {
		x: midX + seg.outX * RAMP_RUN,
		z: midZ + seg.outZ * RAMP_RUN,
	};
}

function addPerimeterWalls(
	stadium: THREE.Group,
	ribbon: RibbonVertex[],
	height: number,
): void {
	const existing = stadium.getObjectByName("arenaWallShell");
	if (existing) {
		existing.removeFromParent();
		if (existing instanceof THREE.Mesh) {
			existing.geometry.dispose();
		}
	}

	const geo = buildPerimeterWallGeometry(ribbon, height);
	const mesh = new THREE.Mesh(geo, neonWallMaterial());
	mesh.name = "arenaWallShell";
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	mesh.frustumCulled = false;
	mesh.renderOrder = 1;
	stadium.add(mesh);
}

function addWallCollider(
	world: RAPIER.World,
	seg: PerimeterSegment,
	height: number,
): void {
	const wallH = height - RAMP_TOP_Y;
	const wy = RAMP_TOP_Y + wallH * 0.5;
	const inner = wallInnerAnchor(seg);
	const anchorPhys = {
		x: inner.x + seg.outX * (WALL_THICKNESS * 0.5),
		z: inner.z + seg.outZ * (WALL_THICKNESS * 0.5),
	};
	const rotY = Math.atan2(seg.bx - seg.ax, seg.bz - seg.az);
	const halfH = wallH / 2;

	if (seg.kind === "corner") {
		addFixedBox(
			world,
			anchorPhys.x,
			wy,
			anchorPhys.z,
			WALL_THICKNESS,
			halfH,
			seg.length / 2,
			0,
			rotY,
			0,
			"wall",
		);
		return;
	}
	if (seg.kind === "side") {
		addFixedBox(
			world,
			anchorPhys.x,
			wy,
			anchorPhys.z,
			WALL_THICKNESS,
			halfH,
			seg.length / 2,
			0,
			0,
			0,
			"wall",
		);
		return;
	}
	// Odcinek końcowy idzie wzdłuż osi X — bez obrotu ±90° (inaczej ściana ma 7 m głębokości w Z).
	addFixedBox(
		world,
		anchorPhys.x,
		wy,
		anchorPhys.z,
		seg.length / 2,
		halfH,
		WALL_THICKNESS,
		0,
		0,
		0,
		"wall",
	);
}

function stripLevitatingLines(root: THREE.Object3D): void {
	const remove: THREE.Object3D[] = [];
	root.traverse((obj) => {
		if (
			obj.name === "neonWire" ||
			obj.name === "rampSeamLed" ||
			obj.name === "rampSeamLedMidline"
		) {
			remove.push(obj);
		}
	});
	for (const obj of remove) {
		obj.removeFromParent();
		if (obj instanceof THREE.LineSegments || obj instanceof THREE.Mesh) {
			obj.geometry.dispose();
		}
	}
}

function disposeGroupMeshes(group: THREE.Object3D): void {
	group.traverse((child) => {
		if (child instanceof THREE.Mesh) {
			child.geometry.dispose();
			const mats = Array.isArray(child.material)
				? child.material
				: [child.material];
			for (const m of mats) {
				if (!SHARED_MATS.has(m)) m.dispose();
			}
		}
	});
}

const CAGE_GROUPS = [
	"proceduralRamps",
	"rampGroundShadows",
	"perimeterNeonLeds",
	"perimeterLedLights",
] as const;

/** Składa geometrię, LED-y, cienie i ściany w kompletną klatkę areny. */
export function buildProceduralArenaCage(
	stadium: THREE.Group,
	world: RAPIER.World,
	height = RL_ARENA.HEIGHT,
): PerimeterSegment[] {
	stripLevitatingLines(stadium);
	perimeterLEDs.clearLights();
	perimeterGeometry.ensureBumpMaps();

	for (const name of CAGE_GROUPS) {
		const existing = stadium.getObjectByName(name);
		if (existing) {
			disposeGroupMeshes(existing);
			existing.removeFromParent();
		}
	}

	const {
		segments,
		ribbon,
		mesh: rampMesh,
	} = perimeterGeometry.buildFromEdges();

	const rampGroup = new THREE.Group();
	rampGroup.name = "proceduralRamps";
	stadium.add(rampGroup);

	addRibbonMesh(
		rampGroup,
		rampMesh,
		[...perimeterGeometry.rampMaterials],
		"wallRamp",
		0,
	);
	addRampCollider(world, rampMesh.positions, rampMesh.indices);

	const shadowGroup = new THREE.Group();
	shadowGroup.name = "rampGroundShadows";
	stadium.add(shadowGroup);
	perimeterShadows.addToGroup(shadowGroup, ribbon);

	perimeterLEDs.addToScene(stadium, ribbon);

	for (const seg of segments) {
		addWallCollider(world, seg, height);
	}

	addPerimeterWalls(stadium, ribbon, height);
	addArenaCeiling(stadium, height);

	return segments;
}

function addArenaCeiling(stadium: THREE.Group, height: number): void {
	const existing = stadium.getObjectByName("arenaCeiling");
	if (existing) {
		existing.removeFromParent();
		if (existing instanceof THREE.Mesh) existing.geometry.dispose();
	}

	const mesh = new THREE.Mesh(
		new THREE.BoxGeometry(RL_ARENA.WIDTH + 0.4, 0.35, RL_ARENA.LENGTH + 0.4),
		arenaCeilingMaterial(),
	);
	mesh.name = "arenaCeiling";
	mesh.position.set(0, height - 0.18, 0);
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	mesh.renderOrder = 0;
	stadium.add(mesh);
}

export { disposeGroupMeshes, stripLevitatingLines };
