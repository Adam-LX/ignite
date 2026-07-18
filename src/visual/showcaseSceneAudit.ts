import * as THREE from "three";

/** Jedno auto showcase w scenie (menuHeroCar → octaneCarDisplay). */
export function countShowcaseHeroCars(scene: THREE.Scene): number {
	let n = 0;
	for (const child of scene.children) {
		if (child.name !== "menuShowcase") continue;
		if (child.getObjectByName("menuHeroCar")) n++;
	}
	return n;
}

export function countBodyMeshesUnder(root: THREE.Object3D): number {
	let n = 0;
	root.traverse((node) => {
		if (node instanceof THREE.Mesh && node.name === "body" && node.visible) {
			n++;
		}
	});
	return n;
}

/** Ukryja przezroczyste „bańki” / zduplikowane meshe karoserii z GLB w podglądzie. */
export function hideShowcaseGhostMeshes(root: THREE.Object3D): void {
	const body = root.getObjectByName("body");
	let bodyBox: THREE.Box3 | null = null;
	if (body instanceof THREE.Mesh) {
		body.updateMatrixWorld(true);
		bodyBox = new THREE.Box3().setFromObject(body);
	}

	const bodyMeshes: THREE.Mesh[] = [];
	root.traverse((node) => {
		if (node instanceof THREE.Mesh && node.name === "body" && node.visible) {
			bodyMeshes.push(node);
		}
	});
	if (bodyMeshes.length > 1) {
		bodyMeshes.sort(
			(a, b) =>
				new THREE.Box3().setFromObject(b).getSize(new THREE.Vector3()).length() -
				new THREE.Box3().setFromObject(a).getSize(new THREE.Vector3()).length(),
		);
		for (let i = 1; i < bodyMeshes.length; i++) {
			bodyMeshes[i]!.visible = false;
		}
	}

	root.traverse((node) => {
		if (!(node instanceof THREE.Mesh)) return;
		/** Karoseria — nigdy nie chowaj (Trellis bywa z transmission / opacity). */
		if (node.name === "body") return;
		if (/window|glass|wind|rim|wheel|tire/i.test(node.name)) return;

		if (node.name !== "body" && bodyBox && !bodyBox.isEmpty()) {
			node.updateMatrixWorld(true);
			const box = new THREE.Box3().setFromObject(node);
			const bodySize = bodyBox.getSize(new THREE.Vector3());
			const nodeSize = box.getSize(new THREE.Vector3());
			const bodyVol = bodySize.x * bodySize.y * bodySize.z;
			const nodeVol = nodeSize.x * nodeSize.y * nodeSize.z;
			if (nodeVol > bodyVol * 0.45) {
				node.visible = false;
				return;
			}
		}

		const mats = Array.isArray(node.material)
			? node.material
			: [node.material];
		for (const mat of mats) {
			if (!mat) continue;
			const transparent =
				mat.transparent &&
				"opacity" in mat &&
				(mat as THREE.Material & { opacity: number }).opacity < 0.92;
			const transmission =
				"transmission" in mat &&
				(typeof (mat as THREE.MeshPhysicalMaterial).transmission ===
					"number") &&
				(mat as THREE.MeshPhysicalMaterial).transmission > 0.05;
			if (transparent || transmission) {
				node.visible = false;
				return;
			}
		}
	});
}

/** @deprecated Diagnostyka — nie używać w normalnym showcase (niszczy lakier). */
export function calmShowcaseCarMaterials(root: THREE.Object3D): void {
	root.traverse((node) => {
		if (!(node instanceof THREE.Mesh)) return;
		const mats = Array.isArray(node.material)
			? node.material
			: [node.material];
		for (const mat of mats) {
			if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
			mat.envMapIntensity = 0;
			mat.metalness = Math.min(mat.metalness, 0.55);
			mat.roughness = Math.max(mat.roughness, 0.35);
			if (mat instanceof THREE.MeshPhysicalMaterial) {
				mat.clearcoat = 0;
				mat.clearcoatRoughness = 1;
				mat.iridescence = 0;
				mat.transmission = 0;
				mat.sheen = 0;
			}
		}
	});
}

export function disableShowcaseShadowReceiving(root: THREE.Object3D): void {
	root.traverse((node) => {
		if (node instanceof THREE.Mesh) node.receiveShadow = false;
	});
}

export type ShowcaseEnvironmentSnapshot = {
	environment: THREE.Texture | null;
	intensity: number;
};

export function muteShowcaseEnvironment(
	scene: THREE.Scene,
): ShowcaseEnvironmentSnapshot {
	const snap: ShowcaseEnvironmentSnapshot = {
		environment: scene.environment,
		intensity: scene.environmentIntensity ?? 1,
	};
	scene.environment = null;
	scene.environmentIntensity = 0;
	return snap;
}

export function restoreShowcaseEnvironment(
	scene: THREE.Scene,
	snap: ShowcaseEnvironmentSnapshot,
): void {
	scene.environment = snap.environment;
	scene.environmentIntensity = snap.intensity;
}

export function logShowcaseSceneAudit(scene: THREE.Scene, hero: THREE.Object3D): void {
	const bodies = countBodyMeshesUnder(hero);
	const heroes = countShowcaseHeroCars(scene);
	const spin = hero.getObjectByName("menuHeroSpin");
	const ySamples: number[] = [];
	if (spin) {
		const saved = spin.rotation.y;
		for (let i = 0; i < 8; i++) {
			spin.rotation.y = (Math.PI / 4) * i;
			hero.updateMatrixWorld(true);
			ySamples.push(hero.position.y);
		}
		spin.rotation.y = saved;
	}
	const ySpread =
		ySamples.length > 0
			? Math.max(...ySamples) - Math.min(...ySamples)
			: 0;
	const canvasOnly = document.body.classList.contains("showcase-canvas-only");
	console.info(
		`[Ignite showcase audit] menuHeroCar=${heroes} bodyMeshes=${bodies} env=${scene.environment ? "on" : "off"} menuSpin=${spin ? 1 : 0} heroYSpread=${ySpread.toFixed(5)} canvasOnly=${canvasOnly}`,
	);
	if (bodies > 1) {
		console.warn("[Ignite showcase audit] więcej niż jedna karoseria — możliwy duplikat GLB");
	}
	if (heroes > 1) {
		console.warn("[Ignite showcase audit] więcej niż jeden menuHeroCar w scenie");
	}
	if (ySpread > 0.002) {
		console.warn(
			`[Ignite showcase audit] hero Y oscyluje przy obrocie (${ySpread.toFixed(4)}) — pivot bug`,
		);
	}
}
