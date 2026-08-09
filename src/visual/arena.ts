import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { ArenaRuntime } from "../arena/ArenaRuntime";
import { setActiveArenaAccentKey } from "../arena/arenaNeonAccent";
import { setActiveLightingFilm } from "./lighting";
import { auditSceneLighting } from "../diagnostic/lightingAudit";
import { runPerimeterAudit } from "../diagnostic/perimeterAudit";
import type Scene from "../Scene";
import { updateArenaBallFocus } from "./arenaBallFocus";
import type { ArenaPerimeterEdge } from "./arenaConstants";
import {
	getArenaPerimeterEdges,
	getArenaPerimeterVertices,
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
import type { GraphicsQuality } from "../util/graphicsProfile";
import { resolveGraphicsSettings } from "../util/graphicsProfile";
import {
	type GrassBladeField,
	buildGrassBlades,
	disposeGrassBlades,
	syncGrassBladeLighting,
	updateGrassBlades,
} from "./grassBlades";
import { GRASS_TILE_METERS, pitchFloorMaterial } from "./materials";
import { ensurePitchReflectionBaseline } from "./pitchWetness";
import {
	disposePitchIgniteBadge,
	getPitchIgniteBadgeMidlineGapM,
	mountPitchIgniteBadge,
	updatePitchIgniteBadge,
} from "./pitchIgniteBadge";
import { disposePitchSsr } from "./pitchSsr";
import {
	setArenaNeonAccent,
	setNeonWallAtmosphereBoost,
	updateNeonWallMaterials,
} from "./neonWallMaterial";
import { createPhysicsBodyRegistry } from "./physicsBodyRegistry";
import {
	type ArenaParallax,
	createArenaParallax,
	updateArenaParallax,
} from "./soccarShell";
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

function syncArenaAtmosphere(atmosphere?: {
	neonAccent?: string;
	lightingProfile?: string;
}): void {
	syncArenaNeonAccent(atmosphere?.neonAccent);
	setActiveLightingFilm(atmosphere?.lightingProfile);
}

const PYLON_METAL = new THREE.MeshStandardMaterial({
	color: 0x080c12,
	roughness: 0.38,
	metalness: 0.92,
});

const PYLON_RING = new THREE.MeshStandardMaterial({
	color: 0x040608,
	emissive: 0x00ffff,
	emissiveIntensity: 4.8,
	roughness: 0.22,
	metalness: 0.85,
});

const PYLON_LAMP = new THREE.MeshStandardMaterial({
	color: 0xe8f4ff,
	emissive: 0xd0e8ff,
	emissiveIntensity: 6.8,
	roughness: 0.06,
	metalness: 0.18,
});

const GRASS_SEGMENTS_PER_METER = 0.65;
const GRASS_Y = PLAYFIELD_SURFACE_Y;
const OVERLAY_Y = PLAYFIELD_SURFACE_Y + 0.01;
/** Canvas 3000×2000 px = boisko 120 m (szer.) × 80 m (wys.) @ 25 px/m */
const OVERLAY_CANVAS_W = 3000;
const OVERLAY_CANVAS_H = 2000;
const OVERLAY_PXM = 25;
/** Koło środkowe — czytelne półkule drużyn (RL ≈9.15 m; lekko większe pod logo). */
const OVERLAY_CIRCLE_R_M = 12.5;

let pitchOverlayMesh: THREE.Mesh | null = null;
let grassBladeField: GrassBladeField | null = null;
/** Parent stadium group — do rebuild źdźbeł przy zmianie quality. */
let arenaStadiumRoot: THREE.Group | null = null;

let stadiumLeds: StadiumLeds | null = null;
let skyDroneRig: SkyDroneRig | null = null;
let arenaParallax: ArenaParallax | null = null;
/** OFF do odwołania — 8× SpotLight + volumetrics = hitch w meczu. */
let skyDronesEnabled = false;

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
	/** Dev toggle — jeśli rig nie istnieje, nie włączaj (brak setup). */
	if (!skyDroneRig && !skyDronesEnabled) {
		console.info("[FlyBall] Sky drones: rig niezaładowany (OFF do odwołania)");
		return false;
	}
	skyDronesEnabled = !skyDronesEnabled;
	applySkyDronesVisibility();
	return skyDronesEnabled;
}

/** Menu showcase — wyłącz drony (glow sprite + spot beam = poświata). */
export function setSkyDronesEnabled(enabled: boolean): void {
	/** Do odwołania ignoruj włączanie z menu — tylko jawny toggleSkyDrones / dev. */
	if (enabled && !skyDroneRig) {
		skyDronesEnabled = false;
		return;
	}
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
			 * Otwór bramkowy — nie cięciwa na linii (szczelina / „dziury”).
			 * Wejdź w kieszeń GOAL_DEPTH, domknij tylną krawędź, wróć.
			 */
			const hl = RL_ARENA.HALF_LENGTH;
			const onGoalLine =
				Math.abs(Math.abs(ly) - hl) < 0.6 &&
				Math.abs(Math.abs(ay) - hl) < 0.6 &&
				Math.sign(ly || 1) === Math.sign(ay || 1);
			if (onGoalLine) {
				/** +0.85 overlap z seal — bez czarnej szczeliny na styku (klipy F9). */
				const depth = RL_ARENA.GOAL_DEPTH + 0.85;
				const pocketAy = ly < 0 ? ly - depth : ly + depth;
				shape.lineTo(lx, pocketAy);
				shape.lineTo(ax, pocketAy);
				shape.lineTo(ax, ay);
			} else {
				shape.lineTo(ax, ay);
			}
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

	// --- 2. Koło centralne — solidne półkule drużyn ---
	const circleRadius = OVERLAY_CIRCLE_R_M * PXM;

	function fillTeamHalf(
		color: string,
		startAng: number,
		endAng: number,
		ccw: boolean,
	): void {
		ctx.beginPath();
		ctx.moveTo(centerX, centerY);
		ctx.arc(centerX, centerY, circleRadius, startAng, endAng, ccw);
		ctx.closePath();
		ctx.fillStyle = color;
		ctx.fill();
	}

	fillTeamHalf(
		"rgba(40, 150, 255, 0.78)",
		Math.PI / 2,
		(Math.PI * 3) / 2,
		false,
	);
	fillTeamHalf(
		"rgba(255, 120, 30, 0.78)",
		-Math.PI / 2,
		Math.PI / 2,
		false,
	);

	// --- 3. Pola bramkowe — D w głąb boiska, BEZ kreski na linii bramkowej ---
	const outerW = 14 * PXM;
	const outerD = 15 * PXM;

	/** RL motif: warm amber lines (nie czysta biel). */
	const LINE_CORE = "rgba(255, 168, 72, 0.98)";
	const LINE_GLOW = "rgba(255, 120, 40, 0.35)";

	const strokePitchLine = (widthMul = 1): void => {
		ctx.lineCap = "butt";
		ctx.lineJoin = "miter";
		ctx.strokeStyle = LINE_GLOW;
		ctx.lineWidth = 0.55 * PXM * widthMul;
		ctx.stroke();
		ctx.strokeStyle = LINE_CORE;
		ctx.lineWidth = 0.26 * PXM * widthMul;
		ctx.stroke();
	};

	ctx.lineCap = "butt";
	ctx.lineJoin = "miter";

	/**
	 * Open D: łuk + krótkie boki. Fill z closePath; stroke BEZ odcinka na linii bramkowej
	 * (to dawało „podwójną” linię). Kierunki łuku = oryginalne (sprawdzone w grze).
	 */
	const drawGoalBox = (
		intoSign: 1 | -1,
		fill: string,
		anticlockwise: boolean,
	): void => {
		const R = outerW;
		const cx = intoSign * (outerD - R);

		const traceOpen = (): void => {
			ctx.beginPath();
			ctx.moveTo(0, -R);
			ctx.lineTo(cx, -R);
			ctx.arc(cx, 0, R, -Math.PI / 2, Math.PI / 2, anticlockwise);
			ctx.lineTo(0, R);
		};

		traceOpen();
		ctx.closePath();
		ctx.fillStyle = fill;
		ctx.fill();

		traceOpen();
		strokePitchLine();
	};

	ctx.save();
	ctx.translate(0, centerY);
	drawGoalBox(1, "rgba(48, 140, 255, 0.32)", false);
	ctx.restore();

	ctx.save();
	ctx.translate(canvas.width, centerY);
	drawGoalBox(-1, "rgba(255, 118, 28, 0.32)", true);
	ctx.restore();

	// --- 4. Linie — linia środkowa z przerwą pod logo (amber glow) ---
	const logoGapPx = getPitchIgniteBadgeMidlineGapM() * PXM;
	ctx.beginPath();
	ctx.moveTo(centerX, 0);
	ctx.lineTo(centerX, centerY - logoGapPx);
	ctx.moveTo(centerX, centerY + logoGapPx);
	ctx.lineTo(centerX, canvas.height);
	strokePitchLine();

	ctx.beginPath();
	ctx.arc(centerX, centerY, circleRadius, 0, Math.PI * 2);
	strokePitchLine(1.05);

	// Logo 3D: pitchIgniteBadge — nad overlay (Y + renderOrder).
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

	const overlayMaterial = new THREE.MeshStandardMaterial({
		map: overlayTex,
		emissiveMap: overlayTex,
		emissive: new THREE.Color(0xffaa55),
		emissiveIntensity: 0.55,
		transparent: true,
		opacity: 1,
		depthWrite: false,
		depthTest: true,
		toneMapped: false,
		metalness: 0,
		roughness: 1,
		polygonOffset: true,
		polygonOffsetFactor: -2,
		polygonOffsetUnits: -2,
	});

	const overlayMesh = new THREE.Mesh(
		new THREE.PlaneGeometry(RL_ARENA.WIDTH, RL_ARENA.LENGTH),
		overlayMaterial,
	);
	overlayMesh.name = "pitchVectorOverlay";
	overlayMesh.rotation.x = -Math.PI / 2;
	overlayMesh.position.y = OVERLAY_Y;
	overlayMesh.renderOrder = 4;
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

	mountGrassBlades(stadium);
}

function mountGrassBlades(stadium: THREE.Group): void {
	disposeGrassBlades(grassBladeField);
	grassBladeField = null;
	const quality = resolveGraphicsSettings().quality;
	const field = buildGrassBlades(quality, getArenaPerimeterVertices());
	if (!field) return;
	stadium.add(field.mesh);
	grassBladeField = field;
}

/** Rebuild źdźbeł po zmianie graphics quality (bez pełnego rebuild areny). */
export function rebuildGrassBladesForQuality(
	quality?: GraphicsQuality,
): void {
	const stadium = arenaStadiumRoot;
	if (!stadium) return;
	const q = quality ?? resolveGraphicsSettings().quality;
	disposeGrassBlades(grassBladeField);
	grassBladeField = null;
	if (q === "low") return;
	const field = buildGrassBlades(q, getArenaPerimeterVertices());
	if (!field) return;
	stadium.add(field.mesh);
	grassBladeField = field;
}

export function getGrassBladeField(): GrassBladeField | null {
	return grassBladeField;
}

function buildTechPylon(
	spec: (typeof STADIUM_PYLON_SPECS)[number],
): THREE.Group {
	const tower = new THREE.Group();
	tower.name = "energyPylon";
	tower.position.set(spec.x, 0, spec.z);

	const h = spec.height;
	/** Tapered mast — stadium fixture, nie box LEGO. */
	const mast = new THREE.Mesh(
		new THREE.CylinderGeometry(0.42, 0.78, h, 16),
		PYLON_METAL,
	);
	mast.position.y = h * 0.5;
	/**
	 * Bez castShadow — wysokie maszty + hard SM = ostre trójkąty/pasma
	 * na murawie (klip F9). Cienie = auto / piłka / bramki.
	 */
	mast.castShadow = false;
	mast.receiveShadow = true;
	tower.add(mast);

	/** Smukłe nogi ukośne. */
	const legGeo = new THREE.CylinderGeometry(0.12, 0.18, h * 0.88, 8);
	for (const [lx, lz] of [
		[-1.55, -1.55],
		[1.55, -1.55],
		[-1.55, 1.55],
		[1.55, 1.55],
	] as const) {
		const leg = new THREE.Mesh(legGeo, PYLON_METAL);
		leg.position.set(lx, h * 0.42, lz);
		leg.rotation.z = -0.22 * Math.sign(lx);
		leg.rotation.x = 0.22 * Math.sign(lz);
		leg.castShadow = false;
		tower.add(leg);
	}

	const ringCount = 5;
	for (let i = 1; i <= ringCount; i++) {
		const t = i / (ringCount + 1);
		const ringR = 0.95 + t * 0.85;
		const ring = new THREE.Mesh(
			new THREE.TorusGeometry(ringR, 0.07, 10, 40),
			PYLON_RING,
		);
		ring.rotation.x = Math.PI / 2;
		ring.position.y = h * t;
		ring.castShadow = false;
		tower.add(ring);
	}

	const crown = new THREE.Mesh(
		new THREE.CylinderGeometry(0.95, 1.15, 0.38, 16),
		PYLON_METAL,
	);
	crown.position.y = h + 0.18;
	crown.castShadow = false;
	tower.add(crown);

	const lamp = new THREE.Mesh(
		new THREE.CylinderGeometry(0.48, 0.72, 0.65, 14),
		PYLON_LAMP,
	);
	lamp.position.y = h + 0.72;
	lamp.castShadow = false;
	tower.add(lamp);

	const lampRing = new THREE.Mesh(
		new THREE.TorusGeometry(0.92, 0.055, 8, 28),
		PYLON_RING,
	);
	lampRing.rotation.x = Math.PI / 2;
	lampRing.position.y = h + 0.52;
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
	disposeGrassBlades(grassBladeField);
	grassBladeField = null;
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
	arenaStadiumRoot = null;
	if (pitchOverlayMesh) {
		pitchOverlayMesh.geometry.dispose();
		const mat = pitchOverlayMesh.material;
		if (mat instanceof THREE.Material) {
			if (
				(mat instanceof THREE.MeshBasicMaterial ||
					mat instanceof THREE.MeshStandardMaterial) &&
				mat.map
			) {
				mat.map.dispose();
			}
			mat.dispose();
		}
		pitchOverlayMesh = null;
	}
	disposePitchIgniteBadge();
	disposePitchSsr();
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
	if (arenaParallax) {
		arenaParallax.root.removeFromParent();
		arenaParallax = null;
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
	arenaStadiumRoot = stadium;

	stadiumLeds = new StadiumLeds();

	const matPitch = pitchFloorMaterial();
	ensurePitchReflectionBaseline();

	buildPitchFloor(stadium, matPitch);
	buildGoalVisuals(stadium, stadiumLeds);
	buildEnergyPylons(stadium);

	scene.threeJSScene.add(stadium);
	arenaParallax = createArenaParallax(scene.threeJSScene);
	setupPhysicsCage(scene.rapierWorld, stadium);
	if (skyDronesEnabled) {
		skyDroneRig = setupSkyDrones(scene.threeJSScene);
		(scene.threeJSScene.userData as { skyDroneRig?: SkyDroneRig }).skyDroneRig =
			skyDroneRig;
	} else {
		skyDroneRig = null;
		delete (scene.threeJSScene.userData as { skyDroneRig?: SkyDroneRig })
			.skyDroneRig;
	}
	setupStadiumAtmosphere(scene.threeJSScene);
	syncArenaAtmosphere(ArenaRuntime.get().atmosphere);
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
	syncArenaAtmosphere(ArenaRuntime.get().atmosphere);
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
	cameraPos?: THREE.Vector3,
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
		syncGrassBladeLighting(grassBladeField, _lighting);
	}
	updateGrassBlades(grassBladeField, timeSec, cameraPos);
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
	if (arenaParallax && cameraPos) {
		updateArenaParallax(arenaParallax, cameraPos);
	}
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
