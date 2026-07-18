import * as THREE from "three";
import { RL_CAR } from "../util/rlConstants";
import { PLAYFIELD_SURFACE_Y } from "./arenaConstants";

const WHEEL_NAMES = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"] as const;

/** Domyślny promień opony przy pustych hubach (zgodny z wheelMount). */
const DEFAULT_HUB_CONTACT_RADIUS = 0.125;

/** Lekki luz nad murawą — bez zapadania opon w trawę / z-fighting. */
export const WHEEL_GROUND_CLEARANCE = 0.022;

/** Linia styku opon z murawą (wizual + spawn). */
export function surfaceContactY(): number {
	return PLAYFIELD_SURFACE_Y + WHEEL_GROUND_CLEARANCE;
}

/** Docelowa linia styku opon — wspólna z PLAYFIELD_SURFACE_Y (fizyka + wizual). */
export function wheelGroundTargetY(
	root: THREE.Object3D,
	blenderPrepped = false,
): number {
	if (blenderPrepped) {
		return surfaceContactY();
	}
	return bodyGroundY(root) + WHEEL_GROUND_CLEARANCE;
}

/** @deprecated Użyj resolveShowcasePivotY(displayRoot, scale) */
export function showcaseCarPivotY(): number {
	return surfaceContactY() + RL_CAR.hitboxHalfY;
}

/** Y środka rigid body na kickoff — hitbox nad murawą. */
export function defaultSpawnCenterY(): number {
	return surfaceContactY() + RL_CAR.hitboxHalfY;
}

function isRimMesh(obj: THREE.Object3D): boolean {
	if (!(obj instanceof THREE.Mesh)) return false;
	const n = obj.name.toLowerCase();
	if (n.includes("_rim") || n.endsWith("rim")) return true;
	return obj.geometry instanceof THREE.TorusGeometry;
}

function isUnderWheelHierarchy(obj: THREE.Object3D, root: THREE.Object3D): boolean {
	let cur: THREE.Object3D | null = obj;
	while (cur && cur !== root) {
		if ((WHEEL_NAMES as readonly string[]).includes(cur.name)) return true;
		cur = cur.parent;
	}
	return false;
}

/** Najniższy punkt kontaktu opon (nie felgi) — tylko widoczna geometria kosmetyczna. */
export function wheelContactMinY(root: THREE.Object3D): number | null {
	let minY = Infinity;
	let found = false;

	for (const name of WHEEL_NAMES) {
		const hub = root.getObjectByName(name);
		if (!hub) continue;
		hub.updateMatrixWorld(true);
		const cosmetic = hub.getObjectByName(`cosmetic_rim_${name}`);
		const measureRoot = cosmetic ?? hub;
		const box = visibleWorldBounds(measureRoot);
		if (!box) continue;
		minY = Math.min(minY, box.min.y);
		found = true;
	}

	return found ? minY : null;
}

export function visibleWorldBounds(root: THREE.Object3D): THREE.Box3 | null {
	const box = new THREE.Box3();
	let found = false;
	root.traverse((node) => {
		if (!(node instanceof THREE.Mesh) || !node.visible) return;
		node.geometry?.computeBoundingBox();
		const gb = node.geometry?.boundingBox;
		if (!gb) return;
		const worldBox = gb.clone().applyMatrix4(node.matrixWorld);
		box.union(worldBox);
		found = true;
	});
	return found && !box.isEmpty() ? box : null;
}

export function bodyGroundY(root: THREE.Object3D): number {
	const body = root.getObjectByName("body");
	const measure = body ?? root;
	measure.updateMatrixWorld(true);
	return new THREE.Box3().setFromObject(measure).min.y;
}

export function visualLowestY(root: THREE.Object3D): number {
	root.updateMatrixWorld(true);
	return new THREE.Box3().setFromObject(root).min.y;
}

const _groundSample = new THREE.Vector3();
const _shellWorld = new THREE.Vector3();

/** Dno karoserii — percentyl wierzchołków, nie bbox (Trellis ma baked koła w meshu). */
export function bodyGroundLocalY(body: THREE.Mesh, car: THREE.Object3D): number {
	body.updateMatrixWorld(true);
	car.updateMatrixWorld(true);
	const invCar = car.matrixWorld.clone().invert();
	const pos = body.geometry.attributes.position;
	if (!pos) {
		return new THREE.Box3().setFromObject(body).min.clone().applyMatrix4(invCar).y;
	}
	const ys: number[] = [];
	for (let i = 0; i < pos.count; i++) {
		_groundSample.fromBufferAttribute(pos, i);
		_groundSample.applyMatrix4(body.matrixWorld);
		_groundSample.applyMatrix4(invCar);
		ys.push(_groundSample.y);
	}
	ys.sort((a, b) => a - b);
	const maxY = ys[ys.length - 1]!;
	// Wierzchołki kół wbake’owanych w body leżą poniżej „skorupy” — bierz min Y w pasie nadwozia.
	const shellCutoff = maxY - 0.72;
	const shellYs = ys.filter((y) => y >= shellCutoff);
	if (shellYs.length >= Math.max(48, ys.length * 0.08)) {
		return shellYs[0]!;
	}
	const idx = Math.min(ys.length - 1, Math.max(0, Math.floor(ys.length * 0.08)));
	return ys[idx]!;
}

/** World-Y dna skorupy nadwozia (bez wbake'owanych opon). */
export function bodyShellGroundWorldY(
	body: THREE.Mesh,
	car: THREE.Object3D,
): number {
	const localY = bodyGroundLocalY(body, car);
	_shellWorld.set(0, localY, 0);
	car.localToWorld(_shellWorld);
	return _shellWorld.y;
}

/** Kosmetyczne felgi zamontowane — Trellis ma często wbake'owane koła w meshu body. */
function hasMountedCosmeticRims(root: THREE.Object3D): boolean {
	return root.getObjectByName("cosmetic_rim_wheel_FL") != null;
}

/**
 * Podnosi mesh body gdy nadwozie jest niżej niż linia kół.
 * Przy felgach kosmetycznych mierzy skorupę (nie bbox z wbake'owanymi oponami),
 * żeby nie odrywać baked kół od hubów ani nie topić auta w murawie.
 */
export function clampBodyAboveWheelLine(root: THREE.Object3D): void {
	const body = root.getObjectByName("body");
	if (!(body instanceof THREE.Mesh)) return;
	root.updateMatrixWorld(true);
	const wheelY = wheelContactMinY(root);
	if (wheelY == null) return;
	body.updateMatrixWorld(true);

	const bodyMin = hasMountedCosmeticRims(root)
		? bodyShellGroundWorldY(body, root)
		: new THREE.Box3().setFromObject(body).min.y;
	if (bodyMin >= wheelY - 0.002) return;
	body.position.y += wheelY - bodyMin;
}

/** Podnosi chrome/spoiler poniżej linii kół (Trellis). */
export function raiseMeshesBelowWheelLine(root: THREE.Object3D): void {
	root.updateMatrixWorld(true);
	const wheelY = wheelContactMinY(root);
	if (wheelY == null) return;

	const skipBody = hasMountedCosmeticRims(root);
	const meshes: THREE.Mesh[] = [];
	root.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return;
		if (isUnderWheelHierarchy(obj, root)) return;
		if (skipBody && obj.name === "body") return;
		meshes.push(obj);
	});

	for (const mesh of meshes) {
		mesh.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(mesh);
		if (box.isEmpty() || box.min.y >= wheelY - 0.002) continue;
		mesh.position.y += wheelY - box.min.y;
	}
}

/**
 * Per-hub snap kosmetycznych felg — nie przesuwa hubów już na ziemi,
 * gdy jeden hub ma złą geometrię / stray mesh (np. blade).
 * Zwraca max |delta| zastosowany na hubie.
 */
export function snapCosmeticHubsToGround(
	root: THREE.Object3D,
	groundY: number,
): number {
	let maxSnap = 0;
	const worldPos = new THREE.Vector3();

	for (const name of WHEEL_NAMES) {
		const hub = root.getObjectByName(name);
		if (!hub) continue;
		const cosmetic = hub.getObjectByName(`cosmetic_rim_${name}`);
		if (!cosmetic) continue;
		hub.updateMatrixWorld(true);
		cosmetic.updateMatrixWorld(true);
		const box = visibleWorldBounds(cosmetic);
		if (!box) continue;
		const delta = groundY - box.min.y;
		if (Math.abs(delta) < 1e-5) continue;
		maxSnap = Math.max(maxSnap, Math.abs(delta));
		hub.getWorldPosition(worldPos);
		worldPos.y += delta;
		if (hub.parent) hub.parent.worldToLocal(worldPos);
		hub.position.copy(worldPos);
	}

	return maxSnap;
}

/** Wyrównuje dno wszystkich kół do jednej linii murawy. */
export function snapAllWheelsToGround(
	root: THREE.Object3D,
	groundY: number,
): void {
	let contact = wheelContactMinY(root);
	if (contact == null) {
		const hubLine = wheelHubLineY(root);
		if (hubLine != null) {
			// Puste huby Blender — przybliżenie: środek huba ≈ ground + promień
			contact = hubLine - DEFAULT_HUB_CONTACT_RADIUS;
		}
	}
	if (contact == null) return;
	const deltaWorld = groundY - contact;
	if (Math.abs(deltaWorld) < 1e-5) return;

	const worldPos = new THREE.Vector3();
	for (const name of WHEEL_NAMES) {
		const wheel = root.getObjectByName(name);
		if (!wheel) continue;
		wheel.getWorldPosition(worldPos);
		worldPos.y += deltaWorld;
		if (wheel.parent) wheel.parent.worldToLocal(worldPos);
		wheel.position.copy(worldPos);
	}
}

function wheelHubLineY(root: THREE.Object3D): number | null {
	let sum = 0;
	let count = 0;
	const pos = new THREE.Vector3();
	for (const name of WHEEL_NAMES) {
		const hub = root.getObjectByName(name);
		if (!hub) continue;
		hub.getWorldPosition(pos);
		sum += pos.y;
		count += 1;
	}
	return count > 0 ? sum / count : null;
}

/** Dno modelu (local) = y 0 — punkt odniesienia dla hitboxa i skali menu. */
export function normalizeCarGroundToOrigin(car: THREE.Object3D): void {
	car.position.y -= visualLowestY(car);
}

/** Pełny pipeline wyrównania auta po skali hitboxa. */
export function finalizeCarGroundAlign(
	car: THREE.Object3D,
	meshyBody: boolean,
): void {
	stripBrokenWheelRims(car);
	/**
	 * Najpierw dno modelu na Y=0 — dopiero potem snap do murawy.
	 * Gdy AABB jest w −Y (częsty wynik Rx=−90°), snap do PLAYFIELD_SURFACE_Y
	 * zostawiał huby wysoko, a normalize podnosił tylko nadwozie.
	 */
	normalizeCarGroundToOrigin(car);
	snapAllWheelsToGround(car, wheelGroundTargetY(car, meshyBody));
	clampBodyAboveWheelLine(car);
	raiseMeshesBelowWheelLine(car);
	normalizeCarGroundToOrigin(car);
}

/**
 * Pivot menu/garażu — kompensuje skalę (scale mnoży offset dna modelu).
 * displayRoot: sklonowany octaneCarDisplay (scale ustawiany na mesh).
 */
export function resolveShowcasePivotY(
	displayRoot: THREE.Object3D,
	_scale = 1,
): number {
	void _scale;
	displayRoot.updateMatrixWorld(true);
	const minY = visualLowestY(displayRoot);
	return surfaceContactY() - minY;
}

/**
 * Pivot Y niezależny od obrotu showcase — AABB obracanego auta oscyluje
 * i daje „rozdwojenie” / pływanie (Print Screen = OK).
 */
export function resolveShowcasePivotYStable(
	heroPivot: THREE.Object3D,
	displayRoot: THREE.Object3D,
): number {
	const spin = heroPivot.getObjectByName("menuHeroSpin");
	const savedSpinY =
		spin instanceof THREE.Object3D ? spin.rotation.y : 0;
	if (spin instanceof THREE.Object3D) spin.rotation.y = 0;
	heroPivot.updateMatrixWorld(true);
	const pivotY = resolveShowcasePivotY(displayRoot);
	if (spin instanceof THREE.Object3D) spin.rotation.y = savedSpinY;
	return pivotY;
}

export function measureWheelRadius(wheel: THREE.Object3D): number {
	wheel.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(wheel);
	const size = box.getSize(new THREE.Vector3());
	return Math.max(size.y, size.z) * 0.5;
}

/** Wyrzuca torusy / neonowe obręcze z GLB — opony zostają bez dokładanych „pierścieni”. */
export function stripBrokenWheelRims(root: THREE.Object3D): void {
	for (const name of WHEEL_NAMES) {
		const wheel = root.getObjectByName(name);
		if (!wheel) continue;

		const toRemove: THREE.Mesh[] = [];
		wheel.traverse((child) => {
			if (isRimMesh(child)) toRemove.push(child as THREE.Mesh);
		});
		for (const rim of toRemove) {
			wheel.remove(rim);
			rim.geometry.dispose();
			const mats = Array.isArray(rim.material) ? rim.material : [rim.material];
			for (const m of mats) m.dispose();
		}
	}
}
