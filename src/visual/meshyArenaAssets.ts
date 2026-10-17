import * as THREE from "three";

import { ArenaRuntime } from "../arena/ArenaRuntime";
import { assetUrl } from "../util/assetUrl";
import { createGltfLoader } from "../util/gltfLoader";

export type MeshyArenaManifest = {
	grassColor?: string;
	grassNormal?: string;
	grassRoughness?: string;
	wallPanel?: string;
	ceilingPanel?: string;
	bannerPanel?: string;
	goalFrame?: string;
	ballAlbedo?: string;
	ballModel?: string;
	carModel?: string;
	carOrangeModel?: string;
	updatedAt?: string;
};

let manifest: MeshyArenaManifest | null = null;
let goalTemplate: THREE.Group | null = null;

const textureCache = new Map<string, THREE.Texture>();

function cacheKey(path: string): string {
	return assetUrl(path);
}

/** Wczytaj teksturę Meshy do cache (bez migotania przy pierwszym klatku). */
async function preloadTexture(path: string): Promise<void> {
	const url = cacheKey(path);
	if (textureCache.has(url)) return;
	const { TextureLoader } = await import("three");
	const loader = new TextureLoader();
	return new Promise((resolve, reject) => {
		loader.load(
			url,
			(tex) => {
				tex.colorSpace = THREE.SRGBColorSpace;
				textureCache.set(url, tex);
				resolve();
			},
			undefined,
			reject,
		);
	});
}

/** Tekstura z cache po preload — null gdy jeszcze nie załadowana. */
export function getCachedMeshyTexture(
	key: keyof Pick<
		MeshyArenaManifest,
		| "grassColor"
		| "grassNormal"
		| "grassRoughness"
		| "wallPanel"
		| "ceilingPanel"
		| "bannerPanel"
		| "ballAlbedo"
	>,
): THREE.Texture | null {
	const path = manifest?.[key];
	if (!path) return null;
	return textureCache.get(cacheKey(path)) ?? null;
}

export async function preloadMeshyArenaAssets(
	manifestPath?: string,
): Promise<void> {
	textureCache.clear();
	goalTemplate = null;

	const path =
		manifestPath ??
		ArenaRuntime.getManifestPath() ??
		"/assets/meshy/arena-manifest.json";

	try {
		const res = await fetch(assetUrl(path), {
			cache: "no-cache",
		});
		if (!res.ok) {
			manifest = null;
			return;
		}
		manifest = (await res.json()) as MeshyArenaManifest;
	} catch {
		manifest = null;
		return;
	}

	const texJobs: Promise<void>[] = [];
	for (const key of [
		"grassColor",
		"grassNormal",
		"grassRoughness",
		"wallPanel",
		"ceilingPanel",
		"bannerPanel",
		"ballAlbedo",
	] as const) {
		const path = manifest[key];
		if (path) texJobs.push(preloadTexture(path));
	}
	await Promise.allSettled(texJobs);

	if (manifest.goalFrame) {
		try {
			const loader = createGltfLoader();
			const gltf = await loader.loadAsync(assetUrl(manifest.goalFrame));
			gltf.scene.name = "meshyGoalFrame";
			goalTemplate = gltf.scene as THREE.Group;
		} catch (err) {
			console.warn("FlyBall: Meshy goal_frame.glb — pomijam", err);
			goalTemplate = null;
		}
	}

	const keys = Object.keys(manifest).filter((k) => k !== "updatedAt");
	if (keys.length > 0) {
		console.info(
			`FlyBall: Meshy arena — ${keys.length} assetów (${keys.join(", ")})`,
		);
	}
}

export function getMeshyArenaManifest(): MeshyArenaManifest | null {
	return manifest;
}

export function hasMeshyArenaAssets(): boolean {
	return manifest !== null && Object.keys(manifest).length > 1;
}

export function cloneMeshyGoalFrame(): THREE.Group | null {
	return goalTemplate?.clone(true) ?? null;
}

export function resolveMeshyTexture(
	key: keyof Pick<
		MeshyArenaManifest,
		| "grassColor"
		| "grassNormal"
		| "grassRoughness"
		| "wallPanel"
		| "ceilingPanel"
		| "bannerPanel"
		| "ballAlbedo"
	>,
	fallback: string,
): string {
	const path = manifest?.[key];
	return path ? assetUrl(path) : assetUrl(fallback);
}

export function getMeshyBallModelUrl(): string | null {
	const path = manifest?.ballModel;
	return path ? assetUrl(path) : null;
}

/** Prefetch GLB piłki Meshy — cache przed pierwszym spawnem. */
export async function preloadMeshyBallModel(): Promise<void> {
	const url = getMeshyBallModelUrl() ?? assetUrl("/assets/models/ball.glb");
	try {
		const loader = createGltfLoader();
		await loader.loadAsync(url);
	} catch (err) {
		console.warn("FlyBall: preload piłki — pomijam", err);
	}
}

export function getMeshyCarModelUrl(
	team: "blue" | "orange" = "blue",
): string | null {
	const path =
		team === "orange"
			? (manifest?.carOrangeModel ??
				manifest?.carModel?.replace(/car\.glb$/, "car_orange.glb"))
			: manifest?.carModel;
	if (path) return assetUrl(path);
	if (team === "orange") return assetUrl("/assets/models/car_orange.glb");
	return null;
}
