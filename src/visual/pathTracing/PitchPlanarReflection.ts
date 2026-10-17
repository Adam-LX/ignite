/**
 * Planar reflections na murawie — THREE.Reflector + maska warstw.
 * Layer 0 = geometria „twarda”; layer 1 = additive VFX (boost, trails) — NIE w odbiciu.
 * Włączane gdy Path tracing ON (albo high + PT).
 */

import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";

import { isPathTraceLookEnabled } from "../../util/presentationPrefs";
import type { GraphicsQuality } from "../../util/graphicsProfile";
import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "../arenaConstants";
import { getPitchWetness } from "../pitchWetness";
import { resolveHybridReflectionWeights } from "../reflections/PitchHybridReflection";

/** Layer reserved for additive / soft VFX excluded from planar reflection. */
export const VFX_REFLECTION_EXCLUDE_LAYER = 1;

let reflector: Reflector | null = null;
let mountedScene: THREE.Scene | null = null;
let lastKey = "";

export function classifySceneForPitchReflection(scene: THREE.Scene): void {
	/** NIE używaj layers.set — zdejmuje layer 0 i chowa obiekty przed kamerą. */
	scene.traverse((obj) => {
		if (obj instanceof THREE.Points || obj instanceof THREE.Sprite) {
			obj.userData.skipPitchReflection = true;
			return;
		}
		if (obj instanceof THREE.InstancedMesh) {
			obj.userData.skipPitchReflection = true;
			return;
		}
		if (!(obj instanceof THREE.Mesh)) return;
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		let additive = false;
		for (const m of mats) {
			if (
				m &&
				(m.blending === THREE.AdditiveBlending ||
					m.blending === THREE.MultiplyBlending)
			) {
				additive = true;
				break;
			}
		}
		const n = obj.name || "";
		if (
			additive ||
			/boost|trail|spark|flame|haze|streak|afterimage|beam|laser|pyro|gobo|contactShadow|ContactShadow/i.test(
				n,
			)
		) {
			obj.userData.skipPitchReflection = true;
		}
	});
}

function resolutionFor(quality: GraphicsQuality, w: number, h: number): {
	tw: number;
	th: number;
	opacity: number;
} {
	/** Tylko PT ON montuje reflector — tu zawsze spektakl. */
	const wet = THREE.MathUtils.clamp(getPitchWetness(), 0, 1);
	const hybrid = resolveHybridReflectionWeights(quality);
	if (quality === "high") {
		return {
			tw: Math.max(640, Math.floor(w * 0.55)),
			th: Math.max(640, Math.floor(h * 0.55)),
			/** Trawa najpierw — planar tylko lekki gloss, nie tafla. */
			opacity: Math.min(
				0.16,
				(0.08 + wet * 0.05) * hybrid.planarOpacityMul,
			),
		};
	}
	if (quality === "medium") {
		return {
			tw: Math.max(384, Math.floor(w * 0.42)),
			th: Math.max(384, Math.floor(h * 0.42)),
			opacity: Math.min(
				0.12,
				(0.06 + wet * 0.04) * hybrid.planarOpacityMul,
			),
		};
	}
	return { tw: 256, th: 256, opacity: 0.08 };
}

export function mountPitchPlanarReflection(
	scene: THREE.Scene,
	quality: GraphicsQuality,
	pixelWidth: number,
	pixelHeight: number,
): Reflector | null {
	const want =
		isPathTraceLookEnabled() &&
		(quality === "high" || quality === "medium");
	if (!want) {
		disposePitchPlanarReflection();
		return null;
	}

	const { tw, th, opacity } = resolutionFor(quality, pixelWidth, pixelHeight);
	if (opacity <= 0) {
		disposePitchPlanarReflection();
		return null;
	}

	const key = `${quality}:${tw}x${th}`;
	if (reflector && mountedScene === scene && lastKey === key) {
		const mat = reflector.material as THREE.ShaderMaterial;
		if (mat.uniforms.uOpacity) mat.uniforms.uOpacity.value = opacity;
		return reflector;
	}

	disposePitchPlanarReflection();
	classifySceneForPitchReflection(scene);

	const geo = new THREE.PlaneGeometry(
		RL_ARENA.WIDTH * 1.01,
		RL_ARENA.LENGTH * 1.01,
	);
	const ground = new Reflector(geo, {
		clipBias: 0.003,
		textureWidth: tw,
		textureHeight: th,
		color: 0x2a4a32,
		multisample: 0,
	});
	ground.name = "pitchPlanarReflector";
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = PLAYFIELD_SURFACE_Y + 0.012;
	ground.renderOrder = 1;
	ground.camera.layers.disableAll();
	ground.camera.layers.enable(0);
	/** Łańcuch: najpierw hide VFX, potem natywny Reflector (odbicie). Nie nadpisuj bez call. */
	const reflectorBefore = ground.onBeforeRender.bind(ground);
	const hideStack: THREE.Object3D[] = [];
	ground.onBeforeRender = function (
		renderer,
		scene,
		camera,
		geometry,
		material,
		group,
	) {
		hideStack.length = 0;
		scene.traverse((obj) => {
			if (!obj.visible) return;
			if (obj === ground) return;
			if (obj.userData?.skipPitchReflection === true) {
				obj.visible = false;
				hideStack.push(obj);
			}
		});
		reflectorBefore(renderer, scene, camera, geometry, material, group);
	};
	ground.onAfterRender = function () {
		for (const o of hideStack) o.visible = true;
		hideStack.length = 0;
	};
	const mat = ground.material as THREE.ShaderMaterial;
	mat.transparent = true;
	mat.depthWrite = false;
	mat.uniforms.uOpacity = { value: opacity };
	mat.onBeforeCompile = (shader) => {
		shader.uniforms.uOpacity = mat.uniforms.uOpacity!;
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"void main() {",
				"uniform float uOpacity;\nvoid main() {",
			)
			.replace(
				"gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );",
				"gl_FragColor = vec4( blendOverlay( base.rgb, color ), uOpacity );",
			);
	};
	mat.needsUpdate = true;
	mat.uniforms.color.value.setRGB(0.45, 0.62, 0.32);

	scene.add(ground);
	reflector = ground;
	mountedScene = scene;
	lastKey = key;
	return ground;
}

export function updatePitchPlanarReflection(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
): void {
	if (!reflector || !reflector.visible) return;
	/** Re-classify sporadycznie — nowe VFX spawny. */
	if ((renderer.info.render.frame & 31) === 0) {
		classifySceneForPitchReflection(scene);
	}
	void camera;
}

export function resizePitchPlanarReflection(
	scene: THREE.Scene,
	quality: GraphicsQuality,
	pixelWidth: number,
	pixelHeight: number,
): Reflector | null {
	lastKey = "";
	return mountPitchPlanarReflection(scene, quality, pixelWidth, pixelHeight);
}


/**
 * Po GPU RT (framebuffer już z beauty): narysuj tylko planar wet na wierzch.
 * autoClear=false — nie wyciera RT. Po capture odbicia chowa resztę meshy,
 * żeby nie nadpisać aut/piłki z RT.
 */
export function compositePitchPlanarOverRt(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
): boolean {
	if (!reflector || !reflector.visible) return false;

	const prevAutoClear = renderer.autoClear;
	const prevAutoClearColor = renderer.autoClearColor;
	const prevAutoClearDepth = renderer.autoClearDepth;
	const prevAutoClearStencil = renderer.autoClearStencil;
	renderer.autoClear = false;
	renderer.autoClearColor = false;
	renderer.autoClearDepth = false;
	renderer.autoClearStencil = false;

	const hideAfterReflect: THREE.Object3D[] = [];
	const prevBefore = reflector.onBeforeRender;
	const prevAfter = reflector.onAfterRender;

	reflector.onBeforeRender = function (r, s, c, geometry, material, group) {
		prevBefore.call(this, r, s, c, geometry, material, group);
		s.traverse((obj) => {
			if (obj === reflector) return;
			if (!obj.visible) return;
			if (
				obj instanceof THREE.Mesh ||
				obj instanceof THREE.InstancedMesh ||
				obj instanceof THREE.Points ||
				obj instanceof THREE.Sprite ||
				obj instanceof THREE.Line
			) {
				obj.visible = false;
				hideAfterReflect.push(obj);
			}
		});
	};
	reflector.onAfterRender = function (r, s, c, geometry, material, group) {
		for (const o of hideAfterReflect) o.visible = true;
		hideAfterReflect.length = 0;
		prevAfter?.call(this, r, s, c, geometry, material, group);
	};

	try {
		renderer.render(scene, camera);
	} finally {
		reflector.onBeforeRender = prevBefore;
		reflector.onAfterRender = prevAfter;
		renderer.autoClear = prevAutoClear;
		renderer.autoClearColor = prevAutoClearColor;
		renderer.autoClearDepth = prevAutoClearDepth;
		renderer.autoClearStencil = prevAutoClearStencil;
	}
	return true;
}

export function disposePitchPlanarReflection(): void {
	if (!reflector) return;
	reflector.removeFromParent();
	reflector.geometry.dispose();
	const mat = reflector.material;
	if (mat instanceof THREE.Material) mat.dispose();
	reflector.getRenderTarget()?.dispose();
	reflector = null;
	mountedScene = null;
	lastKey = "";
}

export function setPitchPlanarReflectionVisible(v: boolean): void {
	if (reflector) reflector.visible = v;
}
