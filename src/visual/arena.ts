import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { ArenaRuntime } from "../arena/ArenaRuntime";
import { setActiveArenaAccentKey } from "../arena/arenaNeonAccent";
import { auditSceneLighting } from "../diagnostic/lightingAudit";
import { runPerimeterAudit } from "../diagnostic/perimeterAudit";
import type Scene from "../Scene";
import { updateArenaBallFocus } from "./arenaBallFocus";
import type { ArenaPerimeterEdge } from "./arenaConstants";
import {
	getArenaPerimeterEdges,
	PLAYFIELD_SURFACE_Y,
	RL_ARENA,
} from "./arenaConstants";
import {
	buildProceduralArenaCage,
	clearPerimeterPhysics,
	updateRampSeamLeds,
} from "./arenaPerimeter";
import { RAMP_RUN } from "./perimeter/constants";
import { makeArenaCuboidCollider, makeArenaTrimeshCollider } from "./arenaPhysics";
import { updateCrowdSurge } from "./crowdSurge";
import { updateGoalNetMaterials } from "./goalNetMaterial";
import {
	buildGoalPhysics,
	buildGoalVisuals,
	clearGoalPhysics,
	isBallInsideGoalFrame,
} from "./goalPocket";
import type {
	AtmospherePhase,
	MatchAtmosphereDrive,
} from "./matchAtmosphereEngine";
import { setMatchAtmosphereArenaAccent } from "./matchAtmosphereEngine";
import { GRASS_TILE_METERS, pitchFloorMaterial } from "./materials";
import {
	disposePitchIgniteBadge,
	mountPitchIgniteBadge,
	updatePitchIgniteBadge,
} from "./pitchIgniteBadge";
import {
	setArenaNeonAccent,
	setNeonWallAtmosphereBoost,
	updateNeonWallMaterials,
} from "./neonWallMaterial";
import { createPhysicsBodyRegistry } from "./physicsBodyRegistry";
import { type SkyDroneRig, setupSkyDrones, updateSkyDrones } from "./skyDrones";
import {
	setupStadiumAtmosphere,
	updateStadiumAtmosphere,
} from "./stadiumAtmosphere";
import { StadiumLeds } from "./stadiumLed";
import type { StadiumLightingRig } from "./stadiumLighting";
import {
	applyMatchAtmosphereLighting,
	updateGoalFlood,
	updateStadiumLighting,
} from "./stadiumLighting";
import { STADIUM_PYLON_SPECS } from "./stadiumPylons";

export {
	ARENA,
	getArenaPerimeterEdges,
	getArenaPerimeterVertices,
	RL_ARENA,
} from "./arenaConstants";
export {
	buildPerimeterSegments,
	buildProceduralArenaCage,
	getRlArenaOutlineEdges,
} from "./perimeter";

const GRASS_SHAPE_GAP_EPS = 0.2;

/** Ściany + hemi + VFX czytają ten sam akcent mapy. */
function syncArenaNeonAccent(accent?: string): void {
	setActiveArenaAccentKey(accent);
	setArenaNeonAccent(accent);
	setMatchAtmosphereArenaAccent(accent);
}

const PYLON_METAL = new THREE.MeshStandardMaterial({
	color: 0x080c12,
	roughness: 0.38,
	metalness: 0.92,
});

const PYLON_RING = new THREE.MeshStandardMaterial({
	color: 0x040608,
	emissive: 0x00ffff,
	emissiveIntensity: 3.0,
	roughness: 0.25,
	metalness: 0.85,
});

const PYLON_LAMP = new THREE.MeshStandardMaterial({
	color: 0xe8f4ff,
	emissive: 0xd0e8ff,
	emissiveIntensity: 4.5,
	roughness: 0.08,
	metalness: 0.2,
});

const GRASS_SEGMENTS_PER_METER = 0.65;
const GRASS_Y = PLAYFIELD_SURFACE_Y;
const OVERLAY_Y = PLAYFIELD_SURFACE_Y + 0.01;
/** Canvas 3000×2000 px = boisko 120 m (szer.) × 80 m (wys.) @ 25 px/m */
const OVERLAY_CANVAS_W = 3000;
const OVERLAY_CANVAS_H = 2000;
const OVERLAY_PXM = 25;
const OVERLAY_CIRCLE_R_M = 10.5;

let pitchOverlayMesh: THREE.Mesh | null = null;

let stadiumLeds: StadiumLeds | null = null;
let skyDroneRig: SkyDroneRig | null = null;
let skyDronesEnabled = true;

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

function resolveSkyDroneRig(scene?: THREE.Scene): SkyDroneRig | null {
	if (skyDroneRig) return skyDroneRig;
	if (!scene) return null;
	const cached = (scene.userData as { skyDroneRig?: SkyDroneRig }).skyDroneRig;
	if (cached) {
		skyDroneRig = cached;
		return cached;
	}
	return null;
}

function applySkyDronesVisibility(): void {
	const rig = skyDroneRig;
	if (!rig) return;
	rig.root.visible = skyDronesEnabled;
	for (const drone of rig.drones) {
		drone.rig.visible = skyDronesEnabled;
		drone.spot.visible = skyDronesEnabled;
		if (!skyDronesEnabled) drone.spot.intensity = 0;
	}
}

/** Przełącza widoczność dronów nad areną (debug / test oświetlenia). */
export function toggleSkyDrones(): boolean {
	skyDronesEnabled = !skyDronesEnabled;
	applySkyDronesVisibility();
	return skyDronesEnabled;
}

/** Menu showcase — wyłącz drony (glow sprite + spot beam = poświata). */
export function setSkyDronesEnabled(enabled: boolean): void {
	skyDronesEnabled = enabled;
	applySkyDronesVisibility();
}

export function areSkyDronesEnabled(): boolean {
	return skyDronesEnabled;
}

// ─── UV murawy — kafelkowanie grass_color.jpg w metrach świata ───────────────

function remapGrassUVs(geo: THREE.BufferGeometry): void {
	const pos = geo.attributes.position;
	if (!pos) return;

	const uv = new Float32Array(pos.count * 2);
	for (let i = 0; i < pos.count; i++) {
		uv[i * 2] = pos.getX(i) / GRASS_TILE_METERS;
		uv[i * 2 + 1] = -pos.getZ(i) / GRASS_TILE_METERS;
	}

	geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
	geo.setAttribute("uv2", new THREE.BufferAttribute(uv.slice(), 2));
	geo.computeVertexNormals();
}

function finalizeGrassMesh(mesh: THREE.Mesh): void {
	mesh.updateMatrix();
	mesh.geometry.applyMatrix4(mesh.matrix);
	mesh.position.set(0, 0, 0);
	mesh.rotation.set(0, 0, 0);
	mesh.scale.set(1, 1, 1);
	mesh.renderOrder = 0;
	remapGrassUVs(mesh.geometry);
}

function grassSegments(size: number): number {
	return Math.max(2, Math.round(size * GRASS_SEGMENTS_PER_METER));
}

function polygonBounds(edges: ArenaPerimeterEdge[]): {
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
} {
	let minX = Infinity;
	let maxX = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
	for (const e of edges) {
		for (const [x, z] of [
			[e.ax, e.az],
			[e.bx, e.bz],
		] as const) {
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minZ = Math.min(minZ, z);
			maxZ = Math.max(maxZ, z);
		}
	}
	return { minX, maxX, minZ, maxZ };
}

/** Kształt murawy — zamknięty wielokąt; otwory bramkowe zamykane cięciwą na linii. */
export function buildArenaGrassShape(
	edges: ArenaPerimeterEdge[] = getArenaPerimeterEdges(),
): THREE.Shape {
	const shape = new THREE.Shape();
	let lx = Number.NaN;
	let ly = Number.NaN;

	for (let i = 0; i < edges.length; i++) {
		const edge = edges[i]!;
		const ax = edge.ax;
		const ay = -edge.az;
		const bx = edge.bx;
		const by = -edge.bz;

		if (i === 0 || Number.isNaN(lx)) {
			shape.moveTo(ax, ay);
		} else if (Math.hypot(ax - lx, ay - ly) > GRASS_SHAPE_GAP_EPS) {
			/**
			 * Otwór bramkowy w obwodzie ramp — NIE moveTo (to robiło wcięcie / próg).
			 * Domknij cięciwą po linii bramkowej, żeby murawa była ciągła do światła.
			 */
			shape.lineTo(ax, ay);
		}
		shape.lineTo(bx, by);
		lx = bx;
		ly = by;
	}

	return shape;
}

/** Trimesh murawy — wielokąt boiska (wizualny / przyszła kolizja). */
export function buildPlayfieldFloorTrimesh(
	edges: ArenaPerimeterEdge[] = getArenaPerimeterEdges(),
): { positions: Float32Array; indices: Uint32Array } {
	const geo = new THREE.ShapeGeometry(buildArenaGrassShape(edges));
	const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
	const positions = new Float32Array(posAttr.count * 3);

	for (let i = 0; i < posAttr.count; i++) {
		positions[i * 3] = posAttr.getX(i);
		positions[i * 3 + 1] = PLAYFIELD_SURFACE_Y;
		positions[i * 3 + 2] = -posAttr.getY(i);
	}

	const srcIdx = geo.getIndex()!;
	const indices = new Uint32Array(srcIdx.count);
	for (let i = 0; i < srcIdx.count; i += 3) {
		indices[i] = srcIdx.getX(i);
		indices[i + 1] = srcIdx.getX(i + 2);
		indices[i + 2] = srcIdx.getX(i + 1);
	}

	geo.dispose();
	return { positions, indices };
}

function addPlayfieldFloorCollider(world: RAPIER.World): void {
	/** Trimesh = obwód boiska (łuki narożników) — AABB nachodził na rampy w cutoutach. */
	const { positions, indices } = buildPlayfieldFloorTrimesh();
	const body = trackArenaBody(
		world,
		world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
	);
	world.createCollider(
		makeArenaTrimeshCollider(positions, indices, "floor"),
		body,
	);
}

/** Meridian — sam floor bez ścian/bramek (collider). */
export function addExportedPlayfieldFloor(world: RAPIER.World): void {
	addPlayfieldFloorCollider(world);
}

function makeGrassShape(
	edges: ArenaPerimeterEdge[],
	matGrass: THREE.Material,
): THREE.Mesh {
	const { minX, maxX, minZ, maxZ } = polygonBounds(edges);
	const span = Math.max(maxX - minX, maxZ - minZ);
	const geo = new THREE.ShapeGeometry(
		buildArenaGrassShape(edges),
		grassSegments(span),
	);
	const mesh = new THREE.Mesh(geo, matGrass);
	mesh.rotation.x = -Math.PI / 2;
	finalizeGrassMesh(mesh);
	mesh.position.y = GRASS_Y;
	return mesh;
}

// ─── Fizyka Rapier — klatka 1:1 z geometrią wizualną ───────────────────────

const arenaPhysicsRegistry = createPhysicsBodyRegistry();

export function clearArenaPhysics(world: RAPIER.World): void {
	clearGoalPhysics(world);
	clearPerimeterPhysics(world);
	arenaPhysicsRegistry.clear(world);
}

function trackArenaBody(
	world: RAPIER.World,
	body: RAPIER.RigidBody,
): RAPIER.RigidBody {
	return arenaPhysicsRegistry.track(world, body);
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
	surface: "floor" | "wall" | "ceiling" | "goal" = "wall",
): void {
	const body = trackArenaBody(
		world,
		world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
	);
	world.createCollider(makeArenaCuboidCollider(hx, hy, hz, surface), body);
	body.setTranslation({ x, y, z }, true);
	if (rotX !== 0 || rotY !== 0 || rotZ !== 0) {
		_euler.set(rotX, rotY, rotZ);
		_quat.setFromEuler(_euler);
		body.setRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w }, true);
	}
}

function setupPhysicsCage(world: RAPIER.World, stadium: THREE.Group): void {
	clearArenaPhysics(world);
	const audit = runPerimeterAudit();
	if (!audit.ok) {
		throw new Error(`Perimeter audit failed: ${audit.errors.join("; ")}`);
	}

	const { HEIGHT, HALF_WIDTH, HALF_LENGTH } = RL_ARENA;

	addPlayfieldFloorCollider(world);

	// Sufit — miększy odbiór; sięga do inner face ścian (HALF+RAMP), nie tylko murawy
	addFixedBox(
		world,
		0,
		HEIGHT - 0.25,
		0,
		HALF_WIDTH + RAMP_RUN + 0.15,
		0.25,
		HALF_LENGTH + RAMP_RUN + 0.15,
		0,
		0,
		0,
		"ceiling",
	);

	buildProceduralArenaCage(stadium, world, HEIGHT);
	buildGoalPhysics(world);
}

/** Po Meridian — przywróć standardową klatkę fizyczną (+ ściany wizualne jeśli usunięte). */
export function restoreStandardPhysicsCage(
	world: RAPIER.World,
	stadium: THREE.Group,
): void {
	setupPhysicsCage(world, stadium);
}

/** Rysuje warstwy wektorowe overlay boiska (3000×2000 px, 25 px/m). */
function drawPitchOverlayContents(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
): void {
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.setTransform(1, 0, 0, 1, 0, 0);

	const PXM = OVERLAY_PXM;
	const centerX = canvas.width / 2;
	const centerY = canvas.height / 2;

	// --- 1. Bez globalnych gradientów — zielona trawa prześwituje poza strefami ---

	// --- 2. Wypełnienie koła centralnego (podbite nasycenie) ---
	const circleRadius = OVERLAY_CIRCLE_R_M * PXM;

	ctx.fillStyle = "rgba(0, 85, 255, 0.3)";
	ctx.beginPath();
	ctx.arc(
		centerX,
		centerY,
		circleRadius,
		Math.PI / 2,
		(Math.PI * 3) / 2,
		false,
	);
	ctx.fill();

	ctx.fillStyle = "rgba(255, 69, 0, 0.3)";
	ctx.beginPath();
	ctx.arc(centerX, centerY, circleRadius, -Math.PI / 2, Math.PI / 2, false);
	ctx.fill();

	// --- 3. Jednowarstwowe pola bramkowe — proste boki od słupków + łuk, alpha 0.45 ---
	const outerW = 14 * PXM;
	const outerD = 15 * PXM;

	ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
	ctx.lineWidth = 0.35 * PXM;

	ctx.save();
	ctx.translate(centerX - centerX, centerY);

	ctx.fillStyle = "rgba(0, 85, 255, 0.32)";
	ctx.beginPath();
	ctx.moveTo(0, -outerW);
	ctx.lineTo(outerD - outerW, -outerW);
	ctx.arc(outerD - outerW, 0, outerW, -Math.PI / 2, Math.PI / 2, false);
	ctx.lineTo(0, outerW);
	ctx.closePath();
	ctx.fill();
	ctx.stroke();
	ctx.restore();

	ctx.save();
	ctx.translate(centerX + centerX, centerY);

	ctx.fillStyle = "rgba(255, 69, 0, 0.32)";
	ctx.beginPath();
	ctx.moveTo(0, -outerW);
	ctx.lineTo(-(outerD - outerW), -outerW);
	ctx.arc(-(outerD - outerW), 0, outerW, -Math.PI / 2, Math.PI / 2, true);
	ctx.lineTo(0, outerW);
	ctx.closePath();
	ctx.fill();
	ctx.stroke();
	ctx.restore();

	// --- 4. Linie białe boiska ---
	ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
	ctx.lineWidth = 0.35 * PXM;

	ctx.beginPath();
	ctx.moveTo(centerX, 0);
	ctx.lineTo(centerX, canvas.height);
	ctx.stroke();

	ctx.beginPath();
	ctx.arc(centerX, centerY, circleRadius, 0, Math.PI * 2);
	ctx.stroke();

	// Logo 3D: pitchIgniteBadge (Trellis GLB) — bez 2D graffiti pod spodem.
}

/** Wektorowy overlay — 1 px/m relacja, canvas 120×80 m → tekstura obrócona na plane 80×120 m (XZ). */
function createPitchOverlayTexture(): THREE.CanvasTexture | null {
	if (typeof document === "undefined") return null;

	const canvas = document.createElement("canvas");
	canvas.width = OVERLAY_CANVAS_W;
	canvas.height = OVERLAY_CANVAS_H;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;

	drawPitchOverlayContents(ctx, canvas);

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapS = THREE.ClampToEdgeWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	// Canvas: 3000 px = 120 m (oś Z), 2000 px = 80 m (oś X); −90° → x=0 = blue (z−), x=W = orange (z+)
	tex.center.set(0.5, 0.5);
	tex.rotation = -Math.PI / 2;
	tex.needsUpdate = true;

	return tex;
}

function buildPitchOverlayMesh(): THREE.Mesh | null {
	const overlayTex = createPitchOverlayTexture();
	if (!overlayTex) return null;

	const overlayMaterial = new THREE.MeshBasicMaterial({
		map: overlayTex,
		transparent: true,
		opacity: 0.68,
		depthWrite: false,
		toneMapped: true,
	});

	const overlayMesh = new THREE.Mesh(
		new THREE.PlaneGeometry(RL_ARENA.WIDTH, RL_ARENA.LENGTH),
		overlayMaterial,
	);
	overlayMesh.name = "pitchVectorOverlay";
	overlayMesh.rotation.x = -Math.PI / 2;
	overlayMesh.position.y = OVERLAY_Y;
	overlayMesh.renderOrder = 2;
	overlayMesh.frustumCulled = false;
	return overlayMesh;
}

function buildPitchFloor(stadium: THREE.Group, matGrass: THREE.Material): void {
	const floor = makeGrassShape(getArenaPerimeterEdges(), matGrass);
	floor.name = "pitchFloor";
	floor.receiveShadow = true;
	floor.castShadow = false;
	floor.renderOrder = 0;
	stadium.add(floor);

	pitchOverlayMesh = buildPitchOverlayMesh();
	if (pitchOverlayMesh) stadium.add(pitchOverlayMesh);
	void mountPitchIgniteBadge(stadium);
}

function buildTechPylon(
	spec: (typeof STADIUM_PYLON_SPECS)[number],
): THREE.Group {
	const tower = new THREE.Group();
	tower.name = "energyPylon";
	tower.position.set(spec.x, 0, spec.z);

	const h = spec.height;
	const mast = new THREE.Mesh(new THREE.BoxGeometry(1.1, h, 1.1), PYLON_METAL);
	mast.position.y = h * 0.5;
	mast.castShadow = true;
	mast.receiveShadow = true;
	tower.add(mast);

	const legGeo = new THREE.BoxGeometry(0.35, h * 0.92, 0.35);
	for (const [lx, lz] of [
		[-2.4, -2.4],
		[2.4, -2.4],
		[-2.4, 2.4],
		[2.4, 2.4],
	] as const) {
		const leg = new THREE.Mesh(legGeo, PYLON_METAL);
		leg.position.set(lx * 0.55, h * 0.46, lz * 0.55);
		leg.castShadow = true;
		tower.add(leg);
	}

	const ringCount = 5;
	for (let i = 1; i <= ringCount; i++) {
		const t = i / (ringCount + 1);
		const ring = new THREE.Mesh(
			new THREE.TorusGeometry(1.8 + t * 1.6, 0.09, 10, 32),
			PYLON_RING,
		);
		ring.rotation.x = Math.PI / 2;
		ring.position.y = h * t;
		tower.add(ring);

		const brace = new THREE.Mesh(
			new THREE.BoxGeometry(3.6 + t * 2.2, 0.12, 0.12),
			PYLON_RING,
		);
		brace.position.y = h * t;
		brace.rotation.y = i * 0.7;
		tower.add(brace);

		const brace2 = brace.clone();
		brace2.rotation.y = i * 0.7 + Math.PI / 2;
		tower.add(brace2);
	}

	const crown = new THREE.Mesh(
		new THREE.BoxGeometry(2.6, 0.45, 2.6),
		PYLON_METAL,
	);
	crown.position.y = h + 0.2;
	tower.add(crown);

	const lamp = new THREE.Mesh(
		new THREE.CylinderGeometry(0.55, 0.85, 0.7, 12),
		PYLON_LAMP,
	);
	lamp.position.y = h + 0.75;
	lamp.castShadow = true;
	tower.add(lamp);

	const lampRing = new THREE.Mesh(
		new THREE.TorusGeometry(1.05, 0.06, 8, 24),
		PYLON_RING,
	);
	lampRing.rotation.x = Math.PI / 2;
	lampRing.position.y = h + 0.55;
	tower.add(lampRing);

	return tower;
}

function buildEnergyPylons(stadium: THREE.Group): void {
	const pylons = new THREE.Group();
	pylons.name = "energyPylons";
	for (const spec of STADIUM_PYLON_SPECS) {
		pylons.add(buildTechPylon(spec));
	}
	stadium.add(pylons);
}

function purgeLegacyRampMeshes(scene: THREE.Scene): void {
	const named: THREE.Object3D[] = [];
	const orphans: THREE.Object3D[] = [];
	scene.traverse((obj) => {
		if (
			obj.name === "wallRamp" ||
			obj.name === "proceduralRamps" ||
			obj.name === "rampGroundShadows" ||
			obj.name === "perimeterNeonLeds"
		) {
			named.push(obj);
		}
	});
	for (const obj of named) {
		obj.removeFromParent();
		obj.traverse((child) => {
			if (child instanceof THREE.Mesh) {
				child.geometry.dispose();
				const mats = Array.isArray(child.material)
					? child.material
					: [child.material];
				for (const m of mats) m.dispose();
			}
		});
	}

	scene.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh) || obj.name === "wallRamp") return;
		if (obj.parent?.name === "proceduralRamps") return;
		const mat = obj.material;
		if (!(mat instanceof THREE.MeshStandardMaterial)) return;
		if (
			mat.emissiveIntensity >= 1.8 &&
			(mat.emissive.getHex() === 0x00aaff || mat.emissive.getHex() === 0xff5500)
		) {
			const geo = obj.geometry;
			if (
				geo instanceof THREE.BoxGeometry ||
				geo instanceof THREE.PlaneGeometry
			) {
				const params = geo.parameters as {
					width?: number;
					height?: number;
					depth?: number;
				};
				const thin =
					(params.height !== undefined && params.height < 4) ||
					(params.depth !== undefined && params.depth < 4);
				if (thin && obj.position.y < 5 && obj.position.y > 0.01) {
					orphans.push(obj);
				}
			}
		}
	});
	for (const obj of orphans) {
		obj.removeFromParent();
	}
}

function purgeDuplicatePitchFloors(scene: THREE.Scene): void {
	const remove: THREE.Mesh[] = [];
	scene.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh) || obj.name !== "pitchFloor") return;
		if (obj.geometry instanceof THREE.ShapeGeometry) return;
		remove.push(obj);
	});
	for (const mesh of remove) {
		mesh.removeFromParent();
		mesh.geometry.dispose();
	}
}

function purgeLegacyNeonLines(scene: THREE.Scene): void {
	const remove: THREE.Object3D[] = [];
	scene.traverse((obj) => {
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

function purgeLegacyGrassBlades(scene: THREE.Scene): void {
	const remove: THREE.Object3D[] = [];
	scene.traverse((obj) => {
		if (obj instanceof THREE.InstancedMesh && obj.name === "grassBlades") {
			remove.push(obj);
		}
	});
	for (const obj of remove) {
		obj.removeFromParent();
		if (obj instanceof THREE.InstancedMesh) {
			obj.geometry.dispose();
			if (obj.material instanceof THREE.Material) obj.material.dispose();
		}
	}
}

function clearArenaRoots(scene: THREE.Scene): void {
	purgeLegacyRampMeshes(scene);
	purgeDuplicatePitchFloors(scene);
	purgeLegacyGrassBlades(scene);
	purgeLegacyNeonLines(scene);
	if (pitchOverlayMesh) {
		pitchOverlayMesh.geometry.dispose();
		const mat = pitchOverlayMesh.material;
		if (mat instanceof THREE.Material) {
			if (mat instanceof THREE.MeshBasicMaterial && mat.map) mat.map.dispose();
			mat.dispose();
		}
		pitchOverlayMesh = null;
	}
	disposePitchIgniteBadge();
	if (stadiumLeds) {
		stadiumLeds.dispose();
		stadiumLeds = null;
	}
	if (skyDroneRig) {
		skyDroneRig.root.removeFromParent();
		for (const drone of skyDroneRig.drones) {
			drone.spot.removeFromParent();
			drone.spot.target.removeFromParent();
		}
		skyDroneRig = null;
	}
	for (const name of [
		"stadium_root",
		"full_rl_stadium",
		"arena",
		"tribunes",
	] as const) {
		const old = scene.getObjectByName(name);
		if (old) old.removeFromParent();
	}
}

/** Fizyka areny bez pełnej wizualizacji — do testów headless. */
export function buildArenaPhysics(world: RAPIER.World): void {
	const stadium = new THREE.Group();
	setupPhysicsCage(world, stadium);
}

/** Pełna arena RL 1:1 — wizualizacja + fizyka Rapier. */
export function buildArena(scene: Scene): THREE.Group {
	clearArenaRoots(scene.threeJSScene);

	const stadium = new THREE.Group();
	stadium.name = "full_rl_stadium";

	stadiumLeds = new StadiumLeds();

	const matPitch = pitchFloorMaterial();

	buildPitchFloor(stadium, matPitch);
	buildGoalVisuals(stadium, stadiumLeds);
	buildEnergyPylons(stadium);

	scene.threeJSScene.add(stadium);
	setupPhysicsCage(scene.rapierWorld, stadium);
	skyDroneRig = setupSkyDrones(scene.threeJSScene);
	(scene.threeJSScene.userData as { skyDroneRig?: SkyDroneRig }).skyDroneRig =
		skyDroneRig;
	setupStadiumAtmosphere(scene.threeJSScene);
	syncArenaNeonAccent(ArenaRuntime.get().atmosphere?.neonAccent);
	applySkyDronesVisibility();
	auditSceneLighting(scene.threeJSScene);

	return stadium;
}

/** Przebudowa areny po zmianie mapy (menu — przed meczem). */
export async function rebuildArenaForActive(
	scene: Scene,
	reloadAssets = true,
): Promise<THREE.Group> {
	if (reloadAssets) {
		const { preloadMeshyArenaAssets } = await import("./meshyArenaAssets");
		await preloadMeshyArenaAssets(ArenaRuntime.getManifestPath());
	}
	syncArenaNeonAccent(ArenaRuntime.get().atmosphere?.neonAccent);
	return buildArena(scene);
}

export function spawnKickoff(
	team: "blue" | "orange",
	carHalfHeight = 1.35,
): THREE.Vector3 {
	const z =
		team === "blue" ? -RL_ARENA.HALF_LENGTH * 0.2 : RL_ARENA.HALF_LENGTH * 0.2;
	return new THREE.Vector3(0, carHalfHeight + 0.06, z);
}

export function updateCyberpunkAmbience(
	timeSec: number,
	dt = 1 / 60,
	_lighting?: StadiumLightingRig,
	scene?: THREE.Scene,
	atmospherePulse = 0,
	atmosphereDrive?: MatchAtmosphereDrive,
	atmospherePhase?: AtmospherePhase,
	ballPos?: THREE.Vector3,
): void {
	const combinedPulse = atmosphereDrive
		? Math.max(atmospherePulse, atmosphereDrive.particlePulse)
		: atmospherePulse;

	updateRampSeamLeds(timeSec);
	if (_lighting) {
		updateStadiumLighting(_lighting, timeSec);
		updateCrowdSurge(_lighting, dt, timeSec);
		updateGoalFlood(_lighting, dt);
		updateArenaBallFocus(_lighting, dt, atmosphereDrive?.tension ?? 0, ballPos);
		if (atmosphereDrive && atmospherePhase) {
			applyMatchAtmosphereLighting(
				_lighting,
				atmosphereDrive,
				atmospherePhase,
				dt,
			);
		}
	}
	if (atmosphereDrive) {
		getStadiumLeds()?.setMatchTension(atmosphereDrive.ledTension);
		setNeonWallAtmosphereBoost(atmosphereDrive.neonLineBoost);
	}
	const rig = resolveSkyDroneRig(scene);
	if (rig && skyDronesEnabled) updateSkyDrones(rig, timeSec, dt, ballPos);
	updateStadiumAtmosphere(timeSec, dt, combinedPulse);
	updateNeonWallMaterials(timeSec);
	updateGoalNetMaterials(timeSec, dt);
	updatePitchIgniteBadge(timeSec);
	stadiumLeds?.update(dt, timeSec);
}

/** Wykrywa gola — zwraca drużynę strzelającą. */
export function detectGoalScored(
	ballPos: THREE.Vector3,
	ballRadius: number,
): "blue" | "orange" | null {
	if (!isBallInsideGoalFrame(ballPos, ballRadius)) return null;

	const { HALF_LENGTH, GOAL_DEPTH } = RL_ARENA;
	const lineEps = ballRadius * 0.12;

	if (
		ballPos.z > HALF_LENGTH - lineEps &&
		ballPos.z < HALF_LENGTH + GOAL_DEPTH
	) {
		return "blue";
	}
	if (
		ballPos.z < -HALF_LENGTH + lineEps &&
		ballPos.z > -HALF_LENGTH - GOAL_DEPTH
	) {
		return "orange";
	}
	return null;
}

export function getStadiumLeds(): StadiumLeds | null {
	return stadiumLeds;
}
