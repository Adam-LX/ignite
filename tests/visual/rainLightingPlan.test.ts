import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
	rainGlintStrengthForQuality,
	rainParticleCountForQuality,
} from "../../src/util/graphicsProfile";
import { WeatherSystem } from "../../src/visual/WeatherSystem";
import {
	LIGHTING_FILM_DUSK,
	LIGHTING_FILM_NIGHT,
} from "../../src/visual/lighting";
import { PYLON_GOBO_INTENSITY } from "../../src/visual/stadiumGobo";

describe("rain / film lighting plan", () => {
	it("glint off on low, on for higher profiles", () => {
		expect(rainGlintStrengthForQuality("low")).toBe(0);
		expect(rainGlintStrengthForQuality("medium")).toBeGreaterThan(0);
		expect(rainGlintStrengthForQuality("high")).toBe(1);
		expect(rainParticleCountForQuality("low")).toBeLessThan(
			rainParticleCountForQuality("high"),
		);
	});

	it("jupiter film intensities are readable without wash", () => {
		for (const v of LIGHTING_FILM_DUSK.jupiterIntensities) {
			expect(v).toBeGreaterThanOrEqual(0.35);
			expect(v).toBeLessThanOrEqual(0.6);
		}
		for (const v of LIGHTING_FILM_NIGHT.jupiterIntensities) {
			expect(v).toBeGreaterThanOrEqual(0.22);
			expect(v).toBeLessThanOrEqual(0.55);
		}
		expect(PYLON_GOBO_INTENSITY).toBeGreaterThanOrEqual(0.65);
		expect(PYLON_GOBO_INTENSITY).toBeLessThanOrEqual(1.0);
	});

	it("WeatherSystem uses soft oval ShaderMaterial + flood glint hooks", () => {
		const scene = new THREE.Scene();
		const weather = new WeatherSystem(scene, 64);
		const mat = weather.rainParticles.material as THREE.ShaderMaterial;
		expect(mat.isShaderMaterial).toBe(true);
		expect(mat.blending).toBe(THREE.AdditiveBlending);
		expect(mat.uniforms.map.value).toBeTruthy();
		expect(mat.uniforms.uLightPos.value).toHaveLength(4);
		expect(mat.fragmentShader).toContain("smoothstep");
		expect(mat.fragmentShader).toContain("uLightPos");

		const light = new THREE.DirectionalLight();
		light.position.set(40, 50, -30);
		scene.add(light);
		weather.setFloodLights([light]);
		expect(mat.uniforms.uLightCount.value).toBe(1);

		weather.setRaining(true);
		weather.update(0.016, new THREE.PerspectiveCamera());
		expect(weather.intensity).toBeGreaterThan(0);
		expect(mat.uniforms.uRainIntensity.value).toBe(weather.intensity);

		weather.setRaining(false);
		const rolled = weather.rollMatchWeather(1);
		expect(rolled).toBe(true);
		expect(weather.isRaining).toBe(true);
		expect(weather.intensity).toBeGreaterThan(0.5);
		const dry = weather.rollMatchWeather(0);
		expect(dry).toBe(false);
		expect(weather.isRaining).toBe(false);

		weather.dispose();
	});
});

