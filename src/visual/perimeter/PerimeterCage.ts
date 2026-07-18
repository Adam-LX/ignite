import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import { RL_ARENA } from "../arenaConstants";
import {
	makeArenaCuboidCollider,
	makeArenaTrimeshCollider,
} from "../arenaPhysics";
import {
	arenaCeilingEdgeMaterial,
	arenaCeilingMaterial,
	flatRampShadowMaterial,
	neonWallMaterial,
} from "../materials";
import { createPhysicsBodyRegistry } from "../physicsBodyRegistry";
import { RAMP_RUN, WALL_THICKNESS, CEILING_COVE_RUN } from "./constants";
import { perimeterGeometry } from "./PerimeterGeometry";
import { perimeterLEDs } from "./PerimeterLEDs";
import { perimeterShadows } from "./PerimeterShadows";
import {
	clearIgniteAdBoards,
	mountIgniteAdBoards,
} from "./igniteAdBoards";
import { buildPerimeterWallGeometry } from "./perimeterWallMesh";
import type { PerimeterSegment, RibbonMeshData, RibbonVertex } from "./types";

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

const perimeterPhysicsRegistry = createPhysicsBodyRegistry();

export function clearPerimeterPhysics(world: RAPIER.World): void {
	perimeterPhysicsRegistry.clear(world);
}

function trackPerimeterBody(world: RAPIER.World, body: RAPIER.RigidBody): void {
	perimeterPhysicsRegistry.track(world, body);
}

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
	trackPerimeterBody(world, body);
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
	surface: "wall" | "goal" | "ceiling" = "wall",
): void {
	const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
	trackPerimeterBody(world, body);
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
	/**
	 * Od podłogi do startu cove (nie pełne HEIGHT).
	 * Inner face = outer ramp; half-extent = WALL_THICKNESS/2 (NIE pełne WALL_THICKNESS —
	 * dawniej box wchodził ~0.27 m w boisko i robił „korek” na końcu segmentu / narożniku).
	 */
	const ceilingBottom = height - 0.5;
	const wallTop = Math.max(4, ceilingBottom - CEILING_COVE_RUN);
	const wallH = wallTop;
	const wy = wallH * 0.5;
	const halfThick = WALL_THICKNESS * 0.5;
	const halfLen = seg.length * 0.5 + 0.06; /* overlap szwu */
	const inner = wallInnerAnchor(seg);
	const anchorPhys = {
		x: inner.x + seg.outX * halfThick,
		z: inner.z + seg.outZ * halfThick,
	};
	/** Lokalne Z wzdłuż segmentu — też dla „side/end” przy łuku (nie AABB). */
	const rotY = Math.atan2(seg.bx - seg.ax, seg.bz - seg.az);

	addFixedBox(
		world,
		anchorPhys.x,
		wy,
		anchorPhys.z,
		halfThick,
		wallH * 0.5,
		halfLen,
		0,
		rotY,
		0,
		"wall",
	);
}

/**
 * Cove = ćwiartka okręgu ściana→sufit (nie box 45°).
 * Box robił półkę na y≈ceilingBottom−cove i zatrzymywał wspinaczkę.
 * Sufit (arena.ts): center Y = height−0.25, hy=0.25 → spód = height−0.5.
 *
 * t=0: styczna pionowa (kontynuacja ściany), t=1: styczna pozioma (sufit).
 */
function addCeilingCoveCollider(
	world: RAPIER.World,
	seg: PerimeterSegment,
	height: number,
): void {
	const cove = CEILING_COVE_RUN;
	const ceilingBottom = height - 0.5;
	const y0 = ceilingBottom - cove;
	const dx = seg.bx - seg.ax;
	const dz = seg.bz - seg.az;
	const steps = 10;
	const alongSteps = Math.max(1, Math.ceil(seg.length / 2.5));

	const positions: number[] = [];
	const indices: number[] = [];

	for (let ai = 0; ai <= alongSteps; ai++) {
		const a = ai / alongSteps;
		const px = seg.ax + dx * a + seg.outX * RAMP_RUN;
		const pz = seg.az + dz * a + seg.outZ * RAMP_RUN;
		for (let si = 0; si <= steps; si++) {
			const t = si / steps;
			const th = t * Math.PI * 0.5;
			const into = cove * (1 - Math.cos(th));
			const y = y0 + cove * Math.sin(th);
			positions.push(px - seg.outX * into, y, pz - seg.outZ * into);
		}
	}

	const stride = steps + 1;
	for (let ai = 0; ai < alongSteps; ai++) {
		for (let si = 0; si < steps; si++) {
			const i0 = ai * stride + si;
			const i1 = i0 + 1;
			const i2 = i0 + stride;
			const i3 = i2 + 1;
			/** CCW gdy patrzymy wzdłuż normalnej do boiska. */
			indices.push(i0, i2, i1, i1, i2, i3);
		}
	}

	const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
	trackPerimeterBody(world, body);
	world.createCollider(
		makeArenaTrimeshCollider(
			new Float32Array(positions),
			new Uint32Array(indices),
			"ceiling",
		),
		body,
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
	clearIgniteAdBoards(stadium);

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
		addCeilingCoveCollider(world, seg, height);
	}

	addPerimeterWalls(stadium, ribbon, height);
	addArenaCeiling(stadium, height);
	mountIgniteAdBoards(stadium);

	return segments;
}

function addArenaCeiling(stadium: THREE.Group, height: number): void {
	const existing = stadium.getObjectByName("arenaCeiling");
	if (existing) {
		existing.removeFromParent();
		existing.traverse((child) => {
			if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
				child.geometry.dispose();
			}
		});
	}

	const group = new THREE.Group();
	group.name = "arenaCeiling";

	const w = RL_ARENA.WIDTH + RAMP_RUN * 2 + 0.3;
	const d = RL_ARENA.LENGTH + RAMP_RUN * 2 + 0.3;
	const y = height - 0.12;

	const panel = new THREE.Mesh(
		new THREE.PlaneGeometry(w, d),
		arenaCeilingMaterial(),
	);
	panel.rotation.x = Math.PI / 2;
	panel.position.set(0, y, 0);
	panel.castShadow = false;
	panel.receiveShadow = false;
	panel.renderOrder = 2;
	group.add(panel);

	/** Subtelna ramka — widać granicę sufitu bez zasłaniania boiska. */
	const hw = w * 0.5;
	const hd = d * 0.5;
	const edgeGeo = new THREE.BufferGeometry().setFromPoints([
		new THREE.Vector3(-hw, y, -hd),
		new THREE.Vector3(hw, y, -hd),
		new THREE.Vector3(hw, y, hd),
		new THREE.Vector3(-hw, y, hd),
		new THREE.Vector3(-hw, y, -hd),
	]);
	const edge = new THREE.Line(edgeGeo, arenaCeilingEdgeMaterial());
	edge.frustumCulled = false;
	edge.renderOrder = 3;
	group.add(edge);

	stadium.add(group);
}

export { disposeGroupMeshes, stripLevitatingLines };
