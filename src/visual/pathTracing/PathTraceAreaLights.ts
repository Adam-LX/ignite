/**
 * ShapedAreaLight (three-gpu-pathtracer) — soft stadium fill widziany przez BVH PT.
 * Raster Three.js ich nie liczy bez RectAreaLightUniformsLib → GI tylko w warstwie PT.
 */

import * as THREE from "three";
import { ShapedAreaLight } from "three-gpu-pathtracer";

import { isPathTraceLookEnabled } from "../../util/presentationPrefs";
import type { GraphicsQuality } from "../../util/graphicsProfile";
import { RL_ARENA } from "../arenaConstants";

const lights: ShapedAreaLight[] = [];
let mountedScene: THREE.Scene | null = null;

export function syncPathTraceAreaLights(
	scene: THREE.Scene,
	quality: GraphicsQuality,
): void {
	const want =
		isPathTraceLookEnabled() &&
		(quality === "high" || quality === "medium");
	if (!want) {
		disposePathTraceAreaLights();
		return;
	}
	if (mountedScene === scene && lights.length > 0) {
		tuneIntensity(quality);
		return;
	}
	disposePathTraceAreaLights();

	const y = 28;
	const hx = RL_ARENA.WIDTH * 0.32;
	const hz = RL_ARENA.LENGTH * 0.28;
	const specs: Array<[number, number, number]> = [
		[-hx, y, -hz],
		[hx, y, -hz],
		[-hx, y, hz],
		[hx, y, hz],
	];
	const count = quality === "high" ? 4 : 2;
	for (let i = 0; i < count; i++) {
		const [x, yy, z] = specs[i]!;
		const al = new ShapedAreaLight(0xe8f0ff, 18, 14, 10);
		al.name = `pathTraceAreaLight_${i}`;
		al.position.set(x, yy, z);
		al.lookAt(0, 0, 0);
		al.isCircular = false;
		scene.add(al);
		lights.push(al);
	}
	mountedScene = scene;
	tuneIntensity(quality);
}

function tuneIntensity(quality: GraphicsQuality): void {
	const base = quality === "high" ? 28 : 18;
	for (const al of lights) {
		al.intensity = base;
	}
}

export function disposePathTraceAreaLights(): void {
	for (const al of lights) {
		al.removeFromParent();
	}
	lights.length = 0;
	mountedScene = null;
}
