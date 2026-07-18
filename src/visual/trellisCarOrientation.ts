import * as THREE from "three";

const WHEEL_NAMES = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"] as const;

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();

/**
 * Po kładzeniu auta z glTF (długość na Y): wybierz ±90° X tak, by
 * **podwozie** (poziome face’y z normalną w dół) było na dole AABB.
 * Huby Blendera bywają przy dachu Trellis — nie są źródłem prawdy.
 */
export function countMeshVerticesInYBands(root: THREE.Object3D): {
	lower: number;
	upper: number;
} {
	const body = root.getObjectByName("body");
	const measure = body instanceof THREE.Mesh ? body : null;
	if (!measure?.geometry?.attributes.position) {
		return { lower: 0, upper: 0 };
	}
	measure.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(measure);
	const midY = (box.min.y + box.max.y) * 0.5;
	const pos = measure.geometry.attributes.position;
	let lower = 0;
	let upper = 0;
	for (let i = 0; i < pos.count; i++) {
		_v.fromBufferAttribute(pos, i).applyMatrix4(measure.matrixWorld);
		if (_v.y < midY) lower += 1;
		else upper += 1;
	}
	return { lower, upper };
}

/** Średnia wysokość hubów w [0..1] względem AABB body (0 = dół). */
export function averageHubRelativeY(root: THREE.Object3D): number | null {
	const body = root.getObjectByName("body");
	const measure = body ?? root;
	measure.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(measure);
	const h = box.max.y - box.min.y;
	if (h < 1e-8) return null;

	let hubSum = 0;
	let hubCount = 0;
	for (const name of WHEEL_NAMES) {
		const hub = root.getObjectByName(name);
		if (!hub) continue;
		hub.getWorldPosition(_v);
		hubSum += _v.y;
		hubCount += 1;
	}
	if (hubCount === 0) return null;
	return (hubSum / hubCount - box.min.y) / h;
}

/**
 * Im wyższy wynik, tym bardziej „podłoga na dole”:
 * powierzchnia poziomych trójkątów z normalną w −Y w dolnym paśmie AABB
 * minus taka sama powierzchnia w górnym paśmie (dach odwrócony).
 */
export function scoreUndercarriageDown(root: THREE.Object3D): number {
	const body = root.getObjectByName("body");
	if (!(body instanceof THREE.Mesh) || !body.geometry?.attributes.position) {
		return 0;
	}
	body.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(body);
	const h = box.max.y - box.min.y;
	if (h < 1e-8) return 0;
	const lowMax = box.min.y + h * 0.35;
	const highMin = box.max.y - h * 0.35;

	const geom = body.geometry;
	const pos = geom.attributes.position;
	const index = geom.index;

	let bottomDown = 0;
	let topDown = 0;

	const triCount = index ? index.count / 3 : pos.count / 3;
	for (let t = 0; t < triCount; t++) {
		const i0 = index ? index.getX(t * 3) : t * 3;
		const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
		const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
		_a.fromBufferAttribute(pos, i0).applyMatrix4(body.matrixWorld);
		_b.fromBufferAttribute(pos, i1).applyMatrix4(body.matrixWorld);
		_c.fromBufferAttribute(pos, i2).applyMatrix4(body.matrixWorld);
		_ab.subVectors(_b, _a);
		_ac.subVectors(_c, _a);
		_n.crossVectors(_ab, _ac);
		const area = _n.length() * 0.5;
		if (area < 1e-12) continue;
		_n.normalize();
		if (Math.abs(_n.y) < 0.55) continue;
		const cy = (_a.y + _b.y + _c.y) / 3;
		if (_n.y < -0.55 && cy <= lowMax) bottomDown += area;
		if (_n.y < -0.55 && cy >= highMin) topDown += area;
	}

	return bottomDown - topDown * 1.35;
}

function pickPitchUpright(
	root: THREE.Object3D,
	/** Gdy heurystyka myli dach z podłogą — bierz niższy score. */
	invertScore = false,
): void {
	root.rotation.order = "XYZ";

	root.rotation.x = -Math.PI / 2;
	root.updateMatrixWorld(true);
	const scoreNeg = scoreUndercarriageDown(root);
	const hubsNeg = averageHubRelativeY(root);
	const densNeg = countMeshVerticesInYBands(root);

	root.rotation.x = Math.PI / 2;
	root.updateMatrixWorld(true);
	const scorePos = scoreUndercarriageDown(root);
	const hubsPos = averageHubRelativeY(root);
	const densPos = countMeshVerticesInYBands(root);

	let pickPos = invertScore ? scorePos < scoreNeg : scorePos > scoreNeg;
	if (Math.abs(scorePos - scoreNeg) < 1e-5) {
		if (densPos.lower !== densNeg.lower) {
			/** Domyślnie gęstszy dół = podwozie; invert = gęstszy góra (kabina). */
			pickPos = invertScore
				? densPos.lower < densNeg.lower
				: densPos.lower > densNeg.lower;
		} else if (hubsPos != null && hubsNeg != null) {
			pickPos = invertScore ? hubsPos < hubsNeg : hubsPos > hubsNeg;
		}
	}

	root.rotation.x = pickPos ? Math.PI / 2 : -Math.PI / 2;
	root.updateMatrixWorld(true);
}

/**
 * Modele gdzie scoreUndercarriageDown woli dach (render-orient-audit).
 */
const INVERT_UNDERCARRIAGE_SCORE = new Set([
	"bruiserNeo",
	"truck",
	"buggy",
]);

/** blade/phantom: po auto +180° X. */
const FORCE_FLIP_AFTER_AXES = new Set(["blade", "phantom"]);

const FORCE_PITCH: Record<string, number> = {};
const FORCE_ROLL: Record<string, number> = {};

export function ensureMeshyGltfAxes(
	root: THREE.Object3D,
	carId?: string | null,
): void {
	root.updateMatrixWorld(true);
	const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
	const invert = !!(carId && INVERT_UNDERCARRIAGE_SCORE.has(carId));

	if (size.z >= size.x * 0.92 && size.z >= size.y * 0.92) {
		const score = scoreUndercarriageDown(root);
		root.rotation.order = "XYZ";
		root.rotation.x += Math.PI;
		root.updateMatrixWorld(true);
		const scoreFlip = scoreUndercarriageDown(root);
		const keepFlip = invert ? scoreFlip < score : scoreFlip > score;
		if (!keepFlip) {
			root.rotation.x -= Math.PI;
			root.updateMatrixWorld(true);
		}
	} else if (size.y >= size.x && size.y >= size.z) {
		pickPitchUpright(root, invert);
		if (carId && FORCE_ROLL[carId] != null) {
			root.rotation.z += FORCE_ROLL[carId]!;
			root.updateMatrixWorld(true);
		}
	} else if (size.x >= size.y && size.x >= size.z) {
		root.rotation.order = "XYZ";
		root.rotation.y += Math.PI / 2;
		root.updateMatrixWorld(true);
		pickPitchUpright(root, invert);
	}

	/** Twarde override’y — po WSZYSTKICH gałęziach (flat też). */
	if (carId && FORCE_PITCH[carId] != null) {
		root.rotation.order = "XYZ";
		root.rotation.x = FORCE_PITCH[carId]!;
		root.updateMatrixWorld(true);
	}
	if (carId && FORCE_FLIP_AFTER_AXES.has(carId)) {
		root.rotation.order = "XYZ";
		root.rotation.x += Math.PI;
		root.updateMatrixWorld(true);
	}
	if (carId && FORCE_ROLL[carId] != null && !(size.y >= size.x && size.y >= size.z)) {
		root.rotation.z += FORCE_ROLL[carId]!;
		root.updateMatrixWorld(true);
	}
}

/** Więcej masy nad linią kół → stoi; odwrotnie = dach w dół. */
export function bodyMassSkewInverted(root: THREE.Object3D): boolean {
	const body = root.getObjectByName("body");
	if (!(body instanceof THREE.Mesh)) return false;

	let hubSum = 0;
	let hubCount = 0;
	for (const name of WHEEL_NAMES) {
		const hub = root.getObjectByName(name);
		if (!hub) continue;
		hub.getWorldPosition(_v);
		hubSum += _v.y;
		hubCount += 1;
	}
	if (hubCount === 0) return false;

	const hubLineY = hubSum / hubCount;
	body.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(body);
	const above = box.max.y - hubLineY;
	const below = hubLineY - box.min.y;
	return above < below * 0.72;
}

/** 180° X gdy masa pod hubami. */
export function ensureTrellisCarUpright(
	root: THREE.Object3D,
	_carId?: string | null,
): boolean {
	void _carId;
	if (!bodyMassSkewInverted(root)) return false;
	root.rotation.x += Math.PI;
	root.updateMatrixWorld(true);
	return true;
}

/**
 * Trellis często ma odwrócone normale — FrontSide = „dziury” / widać wnętrze.
 * DoubleSide dopóki bake normali nie jest pewny.
 */
export function enforceBodyMaterialsFrontSide(root: THREE.Object3D): void {
	const body = root.getObjectByName("body");
	if (!(body instanceof THREE.Mesh)) return;
	const mats = Array.isArray(body.material) ? body.material : [body.material];
	for (const mat of mats) {
		mat.side = THREE.DoubleSide;
		mat.needsUpdate = true;
	}
}

const _noseSample = new THREE.Vector3();

/**
 * Tył auta = wyższy maxY / więcej masy w górnym paśmie (kabina, spoiler).
 * Zwraca true gdy ten tył leży od strony +Z (trzeba obrócić yaw o 180°).
 */
export function meshyRearTowardPlusZ(root: THREE.Object3D): boolean {
	const body = root.getObjectByName("body");
	if (!(body instanceof THREE.Mesh) || !body.geometry?.attributes.position) {
		return false;
	}
	body.updateMatrixWorld(true);
	root.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(body);
	const len = box.max.z - box.min.z;
	const h = box.max.y - box.min.y;
	if (len < 1e-4 || h < 1e-4) return false;

	const cz = (box.min.z + box.max.z) * 0.5;
	const band = len * 0.2;
	const yHigh = box.min.y + h * 0.62;
	const pos = body.geometry.attributes.position;

	const score = (sign: 1 | -1): number => {
		const zTarget = cz + sign * len * 0.4;
		let n = 0;
		let maxY = -Infinity;
		let highN = 0;
		for (let i = 0; i < pos.count; i++) {
			_noseSample
				.fromBufferAttribute(pos, i)
				.applyMatrix4(body.matrixWorld);
			if (Math.abs(_noseSample.z - zTarget) > band) continue;
			n += 1;
			maxY = Math.max(maxY, _noseSample.y);
			if (_noseSample.y >= yHigh) highN += 1;
		}
		if (n < 24) return 0;
		return maxY + (highN / n) * h * 0.85;
	};

	return score(1) > score(-1) + h * 0.02;
}

/**
 * Fizyka / boost / kamera: nos (niższy koniec) = +Z, tył (spoiler/kabina) = −Z.
 * @returns true gdy obrócono.
 */
export function ensureMeshyCarNosePlusZ(root: THREE.Object3D): boolean {
	/** Tył (wyższy) na +Z → obróć, żeby tył poszedł na −Z. */
	if (!meshyRearTowardPlusZ(root)) return false;
	root.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI);
	root.updateMatrixWorld(true);
	return true;
}

/**
 * Wypieka rotation/scale roota w dzieci i zeruje transform roota.
 * Bez tego ±90° X na aucie: boost leci w +Y, koła/światła w złych localach,
 * skręt A/D wokół „niewidzialnego” pivotu GLB.
 */
export function bakeCarRootTransform(root: THREE.Object3D): void {
	root.updateMatrix();
	const baked = root.matrix.clone();
	const children = root.children.slice();
	for (const child of children) {
		child.applyMatrix4(baked);
	}
	root.position.set(0, 0, 0);
	root.rotation.set(0, 0, 0);
	root.quaternion.identity();
	root.scale.set(1, 1, 1);
	root.updateMatrixWorld(true);
}

/**
 * Środkuje auto w XZ na AABB (body jeśli jest) — pivot fizyki = środek karoserii.
 */
export function centerCarOnHorizontalOrigin(root: THREE.Object3D): void {
	root.updateMatrixWorld(true);
	const body = root.getObjectByName("body");
	const measure = body ?? root;
	measure.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(measure);
	if (box.isEmpty()) return;
	const cx = (box.min.x + box.max.x) * 0.5;
	const cz = (box.min.z + box.max.z) * 0.5;
	if (Math.abs(cx) < 1e-6 && Math.abs(cz) < 1e-6) return;
	for (const child of root.children) {
		child.position.x -= cx;
		child.position.z -= cz;
	}
	root.updateMatrixWorld(true);
}

const PROMOTE_TO_ROOT = new Set([
	"body",
	"wheel_FL",
	"wheel_FR",
	"wheel_RL",
	"wheel_RR",
]);

/**
 * GLB Trellis: Scene → `car` → body/huby. Po bake huby zostają pod wrapperem,
 * sockety na rootcie — felgi dostają kosmiczne local offsety i kręcą się nad dachem.
 * `attach` przenosi body+huby na root z zachowaniem world transform.
 */
export function flattenCarContentToRoot(root: THREE.Object3D): void {
	root.updateMatrixWorld(true);
	const toPromote: THREE.Object3D[] = [];
	root.traverse((obj) => {
		if (obj === root) return;
		if (PROMOTE_TO_ROOT.has(obj.name) && obj.parent !== root) {
			toPromote.push(obj);
		}
	});
	for (const obj of toPromote) {
		root.attach(obj);
	}

	const wrappers = root.children.filter((child) => {
		if (child instanceof THREE.Mesh) return false;
		if (PROMOTE_TO_ROOT.has(child.name)) return false;
		if (/^headlight_|^exhaust_|teamAccents|cosmetic_/i.test(child.name)) {
			return false;
		}
		let hasMesh = false;
		child.traverse((c) => {
			if (c instanceof THREE.Mesh) hasMesh = true;
		});
		return !hasMesh;
	});
	for (const wrap of wrappers) {
		while (wrap.children.length > 0) {
			root.attach(wrap.children[0]!);
		}
		wrap.removeFromParent();
	}
	root.updateMatrixWorld(true);
}
