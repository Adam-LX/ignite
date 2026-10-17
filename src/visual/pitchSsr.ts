/**
 * Planar reflections na murawie — WYŁĄCZONE w runtime.
 * ReflectorForSSRPass dawał duchy boostów / czarne półkule na murawie.
 * Wet look = pitchWetness (Physical clearcoat + IBL), nie osobny mirror RT.
 */

import * as THREE from "three";
import { ReflectorForSSRPass } from "three/examples/jsm/objects/ReflectorForSSRPass.js";

import type { GraphicsQuality } from "../util/graphicsProfile";
import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "./arenaConstants";

export type PitchSsrPreset = {
	enabled: boolean;
	resolutionScale: number;
	opacity: number;
	maxDistance: number;
	reflectorOpacity: number;
};

const PRESETS: Record<GraphicsQuality, PitchSsrPreset> = {
	high: {
		enabled: false,
		resolutionScale: 0.55,
		opacity: 0.22,
		maxDistance: 48,
		reflectorOpacity: 0.13,
	},
	medium: {
		enabled: false,
		resolutionScale: 0.4,
		opacity: 0.18,
		maxDistance: 40,
		reflectorOpacity: 0.09,
	},
	low: {
		enabled: false,
		resolutionScale: 0.5,
		opacity: 0,
		maxDistance: 40,
		reflectorOpacity: 0,
	},
	deck: {
		enabled: false,
		resolutionScale: 0.5,
		opacity: 0,
		maxDistance: 40,
		reflectorOpacity: 0,
	},
};

export function getPitchSsrPreset(quality: GraphicsQuality): PitchSsrPreset {
	return PRESETS[quality];
}

let reflector: ReflectorForSSRPass | null = null;
let mountedScene: THREE.Scene | null = null;
let lastQuality: GraphicsQuality | null = null;
let lastPixelW = 0;
let lastPixelH = 0;

function disposeReflector(obj: ReflectorForSSRPass): void {
	obj.removeFromParent();
	obj.geometry?.dispose();
	const mat = obj.material;
	if (mat instanceof THREE.Material) mat.dispose();
	obj.getRenderTarget()?.dispose();
}

/** No-op gdy preset OFF — czyści leftover mesh z hot-reload. */
export function mountPitchSsr(
	scene: THREE.Scene,
	quality: GraphicsQuality,
	_pixelWidth: number,
	_pixelHeight: number,
): ReflectorForSSRPass | null {
	const preset = getPitchSsrPreset(quality);
	if (!preset.enabled) {
		disposePitchSsr();
		const leftover = scene.getObjectByName("pitchSsrReflector");
		if (leftover) leftover.removeFromParent();
		return null;
	}

	/** Martwy kod ścieżki enabled — zostawiony gdy kiedyś wrócimy z lepszym mirror. */
	const w = Math.max(1, Math.floor(_pixelWidth * preset.resolutionScale));
	const h = Math.max(1, Math.floor(_pixelHeight * preset.resolutionScale));
	if (
		reflector &&
		mountedScene === scene &&
		lastQuality === quality &&
		lastPixelW === w &&
		lastPixelH === h
	) {
		return reflector;
	}
	disposePitchSsr();
	const geo = new THREE.PlaneGeometry(
		RL_ARENA.WIDTH * 1.02,
		RL_ARENA.LENGTH * 1.02,
	);
	const ground = new ReflectorForSSRPass(geo, {
		clipBias: 0.0003,
		textureWidth: w,
		textureHeight: h,
		color: 0x1a2818,
		useDepthTexture: true,
	});
	ground.name = "pitchSsrReflector";
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = PLAYFIELD_SURFACE_Y + 0.014;
	ground.visible = false;
	scene.add(ground);
	reflector = ground;
	mountedScene = scene;
	lastQuality = quality;
	lastPixelW = w;
	lastPixelH = h;
	return null;
}

export function getPitchSsrReflector(): ReflectorForSSRPass | null {
	return null;
}

export function updatePitchSsrMirror(
	_renderer: THREE.WebGLRenderer,
	_scene: THREE.Scene,
	_camera: THREE.Camera,
): void {
	/** SSR OFF — zero extra pass przed kickoffem / klatką. */
}

export function resizePitchSsr(
	scene: THREE.Scene,
	quality: GraphicsQuality,
	pixelWidth: number,
	pixelHeight: number,
): ReflectorForSSRPass | null {
	return mountPitchSsr(scene, quality, pixelWidth, pixelHeight);
}

export function disposePitchSsr(): void {
	if (reflector) {
		disposeReflector(reflector);
		reflector = null;
	}
	mountedScene = null;
	lastQuality = null;
	lastPixelW = 0;
	lastPixelH = 0;
}

export function hidePitchSsr(): void {
	if (reflector) reflector.visible = false;
}
