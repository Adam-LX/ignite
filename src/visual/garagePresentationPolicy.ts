import * as THREE from "three";

/** Garaż — bez post-processu (temporal ghost przy obrocie auta). Menu = UnrealBloom jak mecz. */
export function usesDirectRender(
	_menuPresentation: boolean,
	garagePresentation: boolean,
): boolean {
	return garagePresentation;
}

export function shouldDisableBloomPass(
	_menuPresentation: boolean,
	garagePresentation: boolean,
): boolean {
	return garagePresentation;
}

export function shouldFreezeShadowMaps(
	_menuPresentation: boolean,
	garagePresentation: boolean,
): boolean {
	return garagePresentation;
}

export function showcaseBloomStrength(): number {
	return 0;
}

export function showcaseDof(): number {
	return 0;
}

/** Jedna widoczna karoseria — więcej = bug klonowania. */
export function countVisibleBodyMeshes(root: THREE.Object3D): number {
	let n = 0;
	root.traverse((node) => {
		if (node instanceof THREE.Mesh && node.name === "body" && node.visible) {
			n++;
		}
	});
	return n;
}

/** Stock opony ukryte gdy GLB felgi zamontowane. */
export function countVisibleStockTires(root: THREE.Object3D): number {
	const hubs = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"] as const;
	let n = 0;
	for (const hubName of hubs) {
		const hub = root.getObjectByName(hubName);
		if (!hub?.getObjectByName(`cosmetic_rim_${hubName}`)) continue;
		hub.traverse((node) => {
			if (!(node instanceof THREE.Mesh)) return;
			let p: THREE.Object3D | null = node;
			while (p && p !== hub) {
				if (p.name.startsWith("cosmetic_rim_")) return;
				p = p.parent;
			}
			if (node.visible) n++;
		});
	}
	return n;
}

/** @deprecated use showcaseDof */
export function garageShowcaseDof(): number {
	return showcaseDof();
}

/** @deprecated use showcaseBloomStrength */
export function garageBloomStrength(): number {
	return showcaseBloomStrength();
}

/** @deprecated use showcaseDof */
export function menuShowcaseDof(_garageMode: boolean): number {
	return showcaseDof();
}

/** @deprecated use usesDirectRender */
export function usesDirectRenderInGarage(garageMode: boolean): boolean {
	return garageMode;
}
