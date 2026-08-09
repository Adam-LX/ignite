import * as THREE from "three";

import {
	LIGHTING_AUDIT_THRESHOLD,
	LIGHTING_SAFE_LIMITS,
} from "../visual/lighting";

export type LightingAuditResult = {
	ok: boolean;
	critical: boolean;
	ambientSum: number;
	directionalSum: number;
	directionalMax: number;
	pointSum: number;
	pointCount: number;
	rebalanced: boolean;
	entries: LightingAuditEntry[];
};

export type LightingAuditEntry = {
	type: string;
	name: string;
	colorHex: string;
	intensity: number;
};

function lightLabel(light: THREE.Light): string {
	return light.name || light.type;
}

function collectLights(scene: THREE.Scene): THREE.Light[] {
	const lights: THREE.Light[] = [];
	scene.traverse((obj) => {
		if (obj instanceof THREE.Light) lights.push(obj);
	});
	return lights;
}

function rebalanceLight(light: THREE.Light): boolean {
	let changed = false;

	if (light instanceof THREE.AmbientLight) {
		if (light.intensity > LIGHTING_SAFE_LIMITS.ambientMax) {
			light.intensity = LIGHTING_SAFE_LIMITS.ambientMax;
			changed = true;
		}
	}

	if (light instanceof THREE.DirectionalLight) {
		if (light.intensity > LIGHTING_SAFE_LIMITS.directionalMax) {
			light.intensity = LIGHTING_SAFE_LIMITS.directionalMax;
			changed = true;
		}
	}

	if (light instanceof THREE.PointLight && light.intensity > 2.5) {
		light.intensity = 2.5;
		changed = true;
	}

	return changed;
}

/**
 * Fotometryczny audyt sceny — raportuje wszystkie światła i rebalance przy prześwietleniu.
 */
export function auditSceneLighting(
	scene: THREE.Scene,
	allowRebalance = true,
): LightingAuditResult {
	const lights = collectLights(scene);
	const entries: LightingAuditEntry[] = [];

	let ambientSum = 0;
	let directionalSum = 0;
	let directionalMax = 0;
	let pointSum = 0;
	let pointCount = 0;

	console.log("[LIGHT_AUDIT] === Scene Lighting Report ===");

	for (const light of lights) {
		const type = light.type.replace("Light", "");
		const colorHex = `#${light.color.getHexString()}`;
		const intensity = light.intensity;

		entries.push({ type, name: lightLabel(light), colorHex, intensity });

		console.log(
			`[LIGHT_AUDIT] ${type} | name="${lightLabel(light)}" | color=${colorHex} | intensity=${intensity.toFixed(3)}`,
		);

		if (light instanceof THREE.AmbientLight) ambientSum += intensity;
		if (light instanceof THREE.DirectionalLight) {
			directionalSum += intensity;
			directionalMax = Math.max(directionalMax, intensity);
		}
		if (light instanceof THREE.PointLight) {
			pointSum += intensity;
			pointCount++;
		}
	}

	const washOutScore = ambientSum + directionalMax;
	const critical = washOutScore > LIGHTING_AUDIT_THRESHOLD;

	console.log(
		`[LIGHT_AUDIT] Sum ambient=${ambientSum.toFixed(3)} | directional(total=${directionalSum.toFixed(3)}, max=${directionalMax.toFixed(3)}) | point(count=${pointCount}, sum=${pointSum.toFixed(3)})`,
	);

	let rebalanced = false;
	if (critical && allowRebalance) {
		console.warn(
			`[LIGHT_AUDIT] CRITICAL: Scena jest prześwietlona! (ambient+maxDirectional=${washOutScore.toFixed(3)} > ${LIGHTING_AUDIT_THRESHOLD}). Wartości zostaną automatycznie zbalansowane.`,
		);
		for (const light of lights) {
			if (rebalanceLight(light)) rebalanced = true;
		}
		if (rebalanced) {
			console.log(
				"[LIGHT_AUDIT] Auto-rebalance zastosowany — powtórny pomiar:",
			);
			return auditSceneLighting(scene, false);
		}
	} else if (critical) {
		console.warn(
			`[LIGHT_AUDIT] CRITICAL: Scena prześwietlona (ambient+maxDirectional=${washOutScore.toFixed(3)}), rebalance wyłączony.`,
		);
	} else {
		console.log(
			"[LIGHT_AUDIT] PASS — ekspozycja w bezpiecznym zakresie filmowym.",
		);
	}

	return {
		ok: !critical || rebalanced,
		critical,
		ambientSum,
		directionalSum,
		directionalMax,
		pointSum,
		pointCount,
		rebalanced,
		entries,
	};
}
