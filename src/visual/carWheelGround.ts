import * as THREE from "three";
import { RL_CAR } from "../util/rlConstants";
import { PLAYFIELD_SURFACE_Y } from "./arenaConstants";
import {
	measureTireContactMinY,
	RIDE_CLEARANCE,
} from "./CarGrounding";

const WHEEL_NAMES = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"] as const;

/** Domyślny promień opony przy pustych hubach (zgodny z wheelMount). */
const DEFAULT_HUB_CONTACT_RADIUS = 0.125;

/** @deprecated Użyj RIDE_CLEARANCE z CarGrounding — alias kompatybilności. */
export const WHEEL_GROUND_CLEARANCE = RIDE_CLEARANCE;

/**
 * @deprecated Usunięte — jeden kontrakt w fitCarVisualToHitbox / RIDE_CLEARANCE.
 */
export const MATCH_VISUAL_Y_LIFT = 0;

/**
 * Dno opon względem środka hitboxa (local Y).
 * Wyżej niż −hitboxHalfY, żeby wizual nie tonął przy sprężonym hoverze.
 */
export function hitboxWheelContactLocalY(): number {
	return -RL_CAR.hitboxHalfY + WHEEL_GROUND_CLEARANCE;
}

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

/** Najniższy punkt kontaktu opon — delegacja do CarGrounding. */
export function wheelContactMinY(root: THREE.Object3D): number | null {
	return measureTireContactMinY(root);
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
	const minY = ys[0]!;
	const maxY = ys[ys.length - 1]!;
	const height = Math.max(maxY - minY, 1e-4);
	/**
	 * Wierzchołki wbake'owanych opon leżą w dolnych ~20–25% wysokości AABB.
	 * Stały cutoff `maxY-0.72` na niskim Fantomie brał całe dno (= kule).
	 */
	const shellCutoff = minY + height * 0.22;
	const shellYs = ys.filter((y) => y >= shellCutoff);
	if (shellYs.length >= Math.max(48, ys.length * 0.08)) {
		return shellYs[0]!;
	}
	const idx = Math.min(ys.length - 1, Math.max(0, Math.floor(ys.length * 0.12)));
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

/**
 * Podnosi mesh body gdy nadwozie jest niżej niż linia kół.
 * WYŁĄCZONE: osobny lift body vs huby rozrywał Trellis (koła „oderwane”, dziury).
 * Align robi wyłącznie `fitCarVisualToHitbox` na całym root.
 */
export function clampBodyAboveWheelLine(_root: THREE.Object3D): void {
	/* no-op — patrz CarGrounding.fitCarVisualToHitbox */
}

/** Podnosi chrome/spoiler poniżej linii kół (Trellis). */
export function raiseMeshesBelowWheelLine(_root: THREE.Object3D): void {
	/* no-op — per-mesh Y rozrywa karoserię na fragmenty */
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

/**
 * Dno modelu (local) = y 0 — punkt odniesienia dla hitboxa i skali menu.
 * Trellis: bbox obejmuje wbake'owane kule opon — bierzemy skorupę / kontakt kół.
 */
export function normalizeCarGroundToOrigin(car: THREE.Object3D): void {
	car.updateMatrixWorld(true);
	const contact = wheelContactMinY(car);
	if (contact != null) {
		car.position.y -= contact;
		return;
	}
	const body = car.getObjectByName("body");
	if (body instanceof THREE.Mesh) {
		car.position.y -= bodyShellGroundWorldY(body, car);
		return;
	}
	car.position.y -= visualLowestY(car);
}

/** Pełny pipeline wyrównania auta po skali hitboxa. */
export function finalizeCarGroundAlign(
	car: THREE.Object3D,
	_meshyBody: boolean,
): void {
	stripBrokenWheelRims(car);
	/** Tylko całościowy offset — bez snap hubów / per-mesh raise. */
	normalizeCarGroundToOrigin(car);
}

/**
 * Pivot menu/garażu — kompensuje skalę (scale mnoży offset dna modelu).
 * displayRoot: sklonowany octaneCarDisplay (scale ustawiany na mesh).
 */
/**
 * Kontakt showcase: felgi → puste huby → skorupa body (bez wbake'owanych kul Trellis).
 */
export function showcaseContactMinY(displayRoot: THREE.Object3D): number {
	displayRoot.updateMatrixWorld(true);
	const wheel = wheelContactMinY(displayRoot);
	if (wheel != null) return wheel;
	const body = displayRoot.getObjectByName("body");
	if (body instanceof THREE.Mesh) {
		const car =
			displayRoot.getObjectByName("octaneCar") ??
			displayRoot.children[0] ??
			displayRoot;
		return bodyShellGroundWorldY(body, car);
	}
	return visualLowestY(displayRoot);
}

export function resolveShowcasePivotY(
	displayRoot: THREE.Object3D,
	_scale = 1,
): number {
	void _scale;
	displayRoot.updateMatrixWorld(true);
	const minY = showcaseContactMinY(displayRoot);
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
	const savedPivotY = heroPivot.position.y;
	heroPivot.position.y = 0;
	if (spin instanceof THREE.Object3D) spin.rotation.y = 0;
	heroPivot.updateMatrixWorld(true);
	const pivotY = resolveShowcasePivotY(displayRoot);
	if (spin instanceof THREE.Object3D) spin.rotation.y = savedSpinY;
	heroPivot.position.y = savedPivotY;
	return pivotY;
}

export function measureWheelRadius(wheel: THREE.Object3D): number {
	wheel.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(wheel);
	const size = box.getSize(new THREE.Vector3());
	return Math.max(size.y, size.z) * 0.5;
}

/**
 * Usuwa tylko anonimowe torusy / śmieci neonowe pod hubem.
 * Kanoniczne felgi Meshy (`wheel_FL_rim` itd.) zostają — inaczej widać
 * same szare cylindry opon.
 */
export function stripBrokenWheelRims(root: THREE.Object3D): void {
	for (const name of WHEEL_NAMES) {
		const wheel = root.getObjectByName(name);
		if (!wheel) continue;

		const stockRimName = `${name}_rim`;
		const toRemove: THREE.Mesh[] = [];
		wheel.traverse((child) => {
			if (child === wheel) return;
			if (!(child instanceof THREE.Mesh)) return;
			const n = child.name.toLowerCase();
			if (child.name === stockRimName || n.endsWith("_rim") || n.includes("_rim")) {
				return;
			}
			if (child.geometry instanceof THREE.TorusGeometry) {
				toRemove.push(child);
			}
		});
		for (const rim of toRemove) {
			rim.removeFromParent();
			rim.geometry.dispose();
			const mats = Array.isArray(rim.material) ? rim.material : [rim.material];
			for (const m of mats) m.dispose();
		}
	}
}
