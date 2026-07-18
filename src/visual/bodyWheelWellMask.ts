import * as THREE from "three";

import {
	resolveCarIdFromVisual,
	resolveCarWheelDiameterM,
	WHEEL_HUB_NAMES,
} from "./wheelMount";

const HUB_MASK_CACHE_KEY = "flyball-hub-mask-v2";
const HUB_COUNT = 4;
/** Lekko powyżej felgi — tylko wbake'owane opony, nie cała skorupa. */
const RADIUS_SCALE = 0.58;
const AXIAL_HALF_SCALE = 0.4;

type HubMaskEntry = {
	center: THREE.Vector3;
	radius: number;
	axialHalf: number;
	axis: THREE.Vector3;
	active: boolean;
};

type HubMaskMaterialState = {
	enabled: boolean;
	hubs: HubMaskEntry[];
	uniforms: Record<string, THREE.IUniform> | null;
	installed: boolean;
};

const _world = new THREE.Vector3();
const _invBody = new THREE.Matrix4();

function _invBodyMatrix(body: THREE.Object3D): THREE.Matrix4 {
	return _invBody.copy(body.matrixWorld).invert();
}

function hubMaskState(mat: THREE.Material): HubMaskMaterialState {
	const key = "hubMaskState";
	if (!mat.userData[key]) {
		mat.userData[key] = {
			enabled: false,
			hubs: [],
			uniforms: null,
			installed: false,
		} satisfies HubMaskMaterialState;
	}
	return mat.userData[key] as HubMaskMaterialState;
}

function syncHubMaskUniforms(mat: THREE.Material): void {
	const state = hubMaskState(mat);
	const u = state.uniforms;
	if (!u) return;

	u.uHubMaskEnabled.value = state.enabled ? 1 : 0;
	for (let i = 0; i < HUB_COUNT; i++) {
		const hub = state.hubs[i];
		if (hub?.active) {
			u[`uHubCenter${i}`].value.copy(hub.center);
			u[`uHubRadius${i}`].value = hub.radius;
			u[`uHubAxial${i}`].value = hub.axialHalf;
			u[`uHubAxis${i}`].value.copy(hub.axis);
			u[`uHubActive${i}`].value = 1;
		} else {
			u[`uHubActive${i}`].value = 0;
		}
	}
}

function installHubMaskShader(mat: THREE.MeshStandardMaterial): void {
	const state = hubMaskState(mat);
	if (state.installed) return;
	state.installed = true;

	mat.customProgramCacheKey = () =>
		`${HUB_MASK_CACHE_KEY}:${mat.type}:${mat.name}`;

	mat.onBeforeCompile = (shader) => {
		shader.uniforms.uHubMaskEnabled = { value: 0 };
		for (let i = 0; i < HUB_COUNT; i++) {
			shader.uniforms[`uHubCenter${i}`] = { value: new THREE.Vector3() };
			shader.uniforms[`uHubRadius${i}`] = { value: 0.15 };
			shader.uniforms[`uHubAxial${i}`] = { value: 0.06 };
			shader.uniforms[`uHubAxis${i}`] = { value: new THREE.Vector3(1, 0, 0) };
			shader.uniforms[`uHubActive${i}`] = { value: 0 };
		}
		state.uniforms = shader.uniforms;

		shader.vertexShader = `varying vec3 vFlyballBodyLocal;\n${shader.vertexShader}`;
		shader.vertexShader = shader.vertexShader.replace(
			"#include <begin_vertex>",
			`#include <begin_vertex>
			vFlyballBodyLocal = transformed;`,
		);

		let fragDecl = `varying vec3 vFlyballBodyLocal;
uniform float uHubMaskEnabled;
`;
		for (let i = 0; i < HUB_COUNT; i++) {
			fragDecl += `uniform float uHubActive${i};
uniform vec3 uHubCenter${i};
uniform float uHubRadius${i};
uniform float uHubAxial${i};
uniform vec3 uHubAxis${i};
`;
		}

		let discardBlock = `if (uHubMaskEnabled > 0.5) {
`;
		for (let i = 0; i < HUB_COUNT; i++) {
			discardBlock += `  if (uHubActive${i} > 0.5) {
    vec3 d${i} = vFlyballBodyLocal - uHubCenter${i};
    float axial${i} = abs(dot(d${i}, normalize(uHubAxis${i})));
    vec3 radialVec${i} = d${i} - normalize(uHubAxis${i}) * dot(d${i}, normalize(uHubAxis${i}));
    float radial${i} = length(radialVec${i});
    if (radial${i} < uHubRadius${i} && axial${i} < uHubAxial${i}) discard;
  }
`;
		}
		discardBlock += `}
`;

		shader.fragmentShader = `${fragDecl}${shader.fragmentShader}`;
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <opaque_fragment>",
			`${discardBlock}
#include <opaque_fragment>`,
		);

		syncHubMaskUniforms(mat);
	};
}

function collectActiveHubs(
	car: THREE.Object3D,
	body: THREE.Mesh,
	carId?: string | null,
	requireCosmeticRim = true,
): HubMaskEntry[] {
	const resolvedId = carId ?? resolveCarIdFromVisual(car);
	const out: HubMaskEntry[] = [];

	for (const hubName of WHEEL_HUB_NAMES) {
		const hub = car.getObjectByName(hubName);
		if (!hub) continue;
		if (requireCosmeticRim && !hub.getObjectByName(`cosmetic_rim_${hubName}`)) {
			continue;
		}

		hub.getWorldPosition(_world);
		const center = _world.clone();
		body.worldToLocal(center);

		const diameter = resolveCarWheelDiameterM(resolvedId, hubName);
		const radius = diameter * RADIUS_SCALE;
		const axialHalf = diameter * AXIAL_HALF_SCALE;

		/**
		 * Odrzucaj tylko huby ewidentnie oderwane od nadwozia.
		 * Wcześniejszy test geometry.boundingBox + mały pad omijał huby w nadkolach
		 * → maska off → wbake'owane koła + felgi (podwójne koła w meczu).
		 */
		body.geometry?.computeBoundingBox();
		const bb = body.geometry?.boundingBox;
		if (bb) {
			const pad = Math.max(radius, axialHalf, 0.2) * 3.5;
			const cx = (bb.min.x + bb.max.x) * 0.5;
			const cy = (bb.min.y + bb.max.y) * 0.5;
			const cz = (bb.min.z + bb.max.z) * 0.5;
			const extent = Math.max(
				bb.max.x - bb.min.x,
				bb.max.y - bb.min.y,
				bb.max.z - bb.min.z,
			);
			const dist = Math.hypot(center.x - cx, center.y - cy, center.z - cz);
			if (dist > extent * 0.5 + pad) {
				continue;
			}
		}

		const axis = new THREE.Vector3(1, 0, 0)
			.transformDirection(hub.matrixWorld)
			.transformDirection(_invBodyMatrix(body))
			.normalize();
		if (!Number.isFinite(axis.x) || axis.lengthSq() < 1e-8) continue;

		out.push({
			center,
			radius,
			axialHalf,
			axis,
			active: true,
		});
	}

	return out;
}

function findCarRoot(root: THREE.Object3D): THREE.Object3D {
	if (root.getObjectByName("octaneCar")) return root.getObjectByName("octaneCar")!;
	let node: THREE.Object3D | null = root;
	while (node) {
		if (node.name === "octaneCar" || node.name === "octaneCarDisplay") {
			const inner = node.getObjectByName("octaneCar");
			return inner ?? node;
		}
		node = node.parent;
	}
	return root;
}

function applyMaskToBodyMaterials(
	body: THREE.Mesh,
	hubs: HubMaskEntry[],
): void {
	const mats = Array.isArray(body.material) ? body.material : [body.material];
	for (const mat of mats) {
		if (
			!(mat instanceof THREE.MeshStandardMaterial) &&
			!(mat instanceof THREE.MeshPhysicalMaterial)
		) {
			continue;
		}
		const state = hubMaskState(mat);
		state.enabled = hubs.length > 0;
		state.hubs = hubs;
		installHubMaskShader(mat);
		syncHubMaskUniforms(mat);
		if (!state.uniforms) mat.needsUpdate = true;
	}
}

/** Ukrywa baked koła w meshu body w strefie hubów z cosmetic_rim_*. */
export function applyBodyWheelWellMask(
	root: THREE.Object3D,
	carId?: string | null,
): boolean {
	const car = findCarRoot(root);
	const body = car.getObjectByName("body");
	if (!(body instanceof THREE.Mesh)) return false;

	body.updateMatrixWorld(true);
	const hubs = collectActiveHubs(car, body, carId, true);
	applyMaskToBodyMaterials(body, hubs);
	return hubs.length > 0;
}

/** Miniaturki / podgląd bez felg — maska na pustych hubach (baked koła w body). */
export function applyBodyWheelWellMaskForEmptyHubs(
	root: THREE.Object3D,
	carId?: string | null,
): boolean {
	const car = findCarRoot(root);
	const body = car.getObjectByName("body");
	if (!(body instanceof THREE.Mesh)) return false;

	body.updateMatrixWorld(true);
	const hubs = collectActiveHubs(car, body, carId, false);
	if (hubs.length === 0) return false;
	applyMaskToBodyMaterials(body, hubs);
	return true;
}

export function clearBodyWheelWellMask(root: THREE.Object3D): void {
	const car = findCarRoot(root);
	const body = car.getObjectByName("body");
	if (!(body instanceof THREE.Mesh)) return;

	const mats = Array.isArray(body.material) ? body.material : [body.material];
	for (const mat of mats) {
		const state = hubMaskState(mat);
		state.enabled = false;
		state.hubs = [];
		syncHubMaskUniforms(mat);
	}
}

/** Po snapie kół — odśwież centra masek w lokalnym układzie body. */
export function refreshBodyWheelWellMaskIfMounted(root: THREE.Object3D): void {
	const car = findCarRoot(root);
	const hasRim = WHEEL_HUB_NAMES.some(
		(hubName) =>
			car.getObjectByName(hubName)?.getObjectByName(`cosmetic_rim_${hubName}`) !=
			null,
	);
	if (!hasRim) return;
	applyBodyWheelWellMask(root);
}
