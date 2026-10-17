import { describe, expect, it, beforeEach } from "vitest";
import * as THREE from "three";

import { tagSceneForRealtimeRt } from "../../src/visual/pathTracing/pathTraceSceneFilter";
import { disposeArenaRtProxy } from "../../src/visual/pathTracing/ArenaRtProxy";
import {
	resetPresentationPrefsForTests,
	isPathTraceLookEnabled,
	isGpuRealtimeRtEnabled,
	setPathTraceLookEnabled,
	setGpuRealtimeRtEnabled,
} from "../../src/util/presentationPrefs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("pathTraceSceneFilter (real scene graph)", () => {
	it("keeps pitch/car/ball in BVH; excludes stadium parent and grass instance", () => {
		const scene = new THREE.Scene();
		const stadium = new THREE.Group();
		stadium.name = "full_rl_stadium";

		const floor = new THREE.Mesh(
			new THREE.PlaneGeometry(80, 100, 32, 40),
			new THREE.MeshStandardMaterial(),
		);
		floor.name = "pitchFloor";
		stadium.add(floor);

		const decor = new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial(),
		);
		decor.name = "meshy_raw_wall";
		stadium.add(decor);

		const grass = new THREE.InstancedMesh(
			new THREE.BoxGeometry(0.1, 0.2, 0.1),
			new THREE.MeshStandardMaterial(),
			10,
		);
		grass.name = "grassBlades";
		stadium.add(grass);
		scene.add(stadium);

		const car = new THREE.Group();
		car.name = "playerCar";
		car.userData.isCar = true;
		const body = new THREE.Mesh(
			new THREE.BoxGeometry(1, 0.4, 2),
			new THREE.MeshStandardMaterial(),
		);
		body.name = "chassis";
		car.add(body);
		scene.add(car);

		const ball = new THREE.Mesh(
			new THREE.SphereGeometry(0.5),
			new THREE.MeshStandardMaterial(),
		);
		ball.name = "ball";
		ball.userData.isBall = true;
		scene.add(ball);

		const proxy = new THREE.Mesh(
			new THREE.BoxGeometry(80, 40, 100),
			new THREE.MeshStandardMaterial({ color: 0xffaa00 }),
		);
		proxy.name = "arenaRtProxy_shell";
		proxy.userData.arenaRtProxy = true;
		scene.add(proxy);

		const tagged = tagSceneForRealtimeRt(scene);
		expect(floor.userData.rtExclude).toBe(false);
		expect(body.userData.rtExclude).toBe(false);
		expect(ball.userData.rtExclude).toBe(false);
		expect(decor.userData.rtExclude).toBe(true);
		expect(grass.userData.rtExclude).toBe(true);
		expect(proxy.userData.rtExclude).toBe(true);
		expect(tagged.dynamic.length).toBeGreaterThanOrEqual(1);
		expect(tagged.staticVerts).toBeGreaterThan(0);
		/** Pusty BVH = white-out — compile guard w MatchRealtimeRT wymaga ≥800. */
		expect(tagged.staticVerts).toBeGreaterThanOrEqual(800);
	});

	it("disposeArenaRtProxy removes leftover proxy meshes", () => {
		const scene = new THREE.Scene();
		const g = new THREE.Group();
		g.name = "arenaRtProxy";
		g.userData.arenaRtProxy = true;
		const m = new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial(),
		);
		m.userData.arenaRtProxy = true;
		g.add(m);
		scene.add(g);
		disposeArenaRtProxy(scene);
		expect(scene.getObjectByName("arenaRtProxy")).toBeUndefined();
	});

	it("keeps wallRamp / wallUpper / ceiling in BVH allowlist", () => {
		const scene = new THREE.Scene();
		for (const name of ["wallRamp", "wallUpper", "ceiling"]) {
			const m = new THREE.Mesh(
				new THREE.BoxGeometry(2, 2, 2),
				new THREE.MeshStandardMaterial(),
			);
			m.name = name;
			scene.add(m);
		}
		tagSceneForRealtimeRt(scene);
		for (const name of ["wallRamp", "wallUpper", "ceiling"]) {
			const m = scene.getObjectByName(name) as THREE.Mesh;
			expect(m.userData.rtExclude).toBe(false);
		}
	});
});

describe("presentation prefs: film vs gpu RT", () => {
	beforeEach(() => {
		const store = new Map<string, string>();
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: {
				getItem: (k: string) => store.get(k) ?? null,
				setItem: (k: string, v: string) => {
					store.set(k, String(v));
				},
				removeItem: (k: string) => {
					store.delete(k);
				},
				clear: () => store.clear(),
			},
		});
		resetPresentationPrefsForTests();
	});

	it("pathTraceLook defaults ON; gpuRealtimeRt defaults OFF", () => {
		expect(isPathTraceLookEnabled()).toBe(true);
		expect(isGpuRealtimeRtEnabled()).toBe(false);
	});

	it("v5 migrates legacy v4 and forces gpuRealtimeRt off", () => {
		localStorage.setItem(
			"ignite.presentation.v4",
			JSON.stringify({
				uiVignette: false,
				cinematicCamera: "on",
				commentator: false,
				pathTraceLook: true,
				gpuRealtimeRt: true,
			}),
		);
		expect(isGpuRealtimeRtEnabled()).toBe(false);
		expect(isPathTraceLookEnabled()).toBe(true);
		expect(localStorage.getItem("ignite.presentation.v5")).toBeTruthy();
		expect(localStorage.getItem("ignite.presentation.v4")).toBeNull();
	});

	it("can enable gpuRealtimeRt explicitly", () => {
		setGpuRealtimeRtEnabled(true);
		expect(isGpuRealtimeRtEnabled()).toBe(true);
		setPathTraceLookEnabled(false);
		expect(isPathTraceLookEnabled()).toBe(false);
	});
});

describe("IgniteRtDirector architecture (source contracts)", () => {
	it("Renderer uses IgniteRtDirector not raw MatchRealtimeRT.renderFrame", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/Renderer.ts"),
			"utf8",
		);
		expect(src).toContain("IgniteRtDirector");
		expect(src).toContain("prepareAndMaybeRenderRt");
		expect(src).not.toMatch(/realtimeRt\.renderFrame/);
	});

	it("MatchRealtimeRT requires gpuRealtimeRt and uses NoToneMapping", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/pathTracing/MatchRealtimeRT.ts"),
			"utf8",
		);
		expect(src).toContain("isGpuRealtimeRtEnabled");
		expect(src).toContain("NoToneMapping");
		expect(src).toContain("MAX_COMPILE_MS");
		expect(src).toContain("MAX_HITCH_STREAK");
		expect(src).toContain("BVH too empty");
		expect(src).not.toContain("ensureArenaRtProxy");
		expect(src).toContain("this.suspended === v");
	});

		it("IgniteRtDirector defers env bake (no planarFrame=8 hitch)", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/pathTracing/IgniteRtDirector.ts"),
			"utf8",
		);
		expect(src).toContain("envBakeDue");
		expect(src).not.toContain("planarFrame === 8");
		expect(src).not.toMatch(/this\.planarFrame = 0;/);
	});

	it("IgniteRtDirector composites planar wet over GPU RT; film fallback when RT off/warming", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/pathTracing/IgniteRtDirector.ts"),
			"utf8",
		);
		expect(src).toContain("mountPitchPlanarReflection");
		expect(src).toContain("isGpuRealtimeRtEnabled");
		expect(src).toContain("film-hybrid");
		expect(src).toContain("compositePitchPlanarOverRt");
		expect(src).toContain("this.realtime.renderFrame");
		/** RT success → usedRealtimeRt true; warming/fail → false + film-hybrid. */
		expect(src).toContain("usedRealtimeRt: true");
		expect(src).toContain("usedRealtimeRt: false");
	});

	it("PitchPlanarReflection chains Reflector onBeforeRender and exports composit", () => {
		const src = readFileSync(
			resolve(
				__dirname,
				"../../src/visual/pathTracing/PitchPlanarReflection.ts",
			),
			"utf8",
		);
		expect(src).toContain("reflectorBefore");
		expect(src).toContain("compositePitchPlanarOverRt");
		expect(src).toContain("autoClearColor = false");
	});

	it("pathTraceLacquer does not lacquer stadium meshy by name", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/pathTracing/pathTraceLacquer.ts"),
			"utf8",
		);
		expect(src).not.toMatch(/meshy/i);
		expect(src).toContain("isCar");
		expect(src).toContain("isBall");
	});

	it("PitchPlanarReflection hides VFX without layers.set on scene meshes", () => {
		const src = readFileSync(
			resolve(
				__dirname,
				"../../src/visual/pathTracing/PitchPlanarReflection.ts",
			),
			"utf8",
		);
		expect(src).toContain("skipPitchReflection");
		expect(src).toContain("onBeforeRender");
		expect(src).not.toMatch(/layers\.set\(VFX/);
	});
});

describe("repairSceneLayers", () => {
	it("re-enables layer 0 without wiping other layers", async () => {
		const { repairSceneLayers } = await import(
			"../../src/visual/pathTracing/repairSceneLayers"
		);
		const scene = new THREE.Scene();
		const m = new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshBasicMaterial(),
		);
		m.layers.set(2);
		expect(m.layers.isEnabled(0)).toBe(false);
		scene.add(m);
		repairSceneLayers(scene);
		expect(m.layers.isEnabled(0)).toBe(true);
		expect(m.layers.isEnabled(2)).toBe(true);
	});
});

describe("skybox IBL under pathTraceLook", () => {
	beforeEach(() => {
		const store = new Map<string, string>();
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: {
				getItem: (k: string) => store.get(k) ?? null,
				setItem: (k: string, v: string) => {
					store.set(k, String(v));
				},
				removeItem: (k: string) => {
					store.delete(k);
				},
				clear: () => store.clear(),
			},
		});
		resetPresentationPrefsForTests();
	});

	it("raises base environment intensity when PT look ON", async () => {
		const { getBaseEnvironmentIntensity } = await import(
			"../../src/visual/skybox"
		);
		setPathTraceLookEnabled(true);
		const on = getBaseEnvironmentIntensity();
		setPathTraceLookEnabled(false);
		const off = getBaseEnvironmentIntensity();
		expect(on).toBeGreaterThan(off);
		expect(on).toBeGreaterThanOrEqual(1.0);
		expect(on).toBeLessThanOrEqual(1.15);
		expect(off).toBeLessThan(0.8);
	});
});

describe("pitch wetness A/B spectacle", () => {
	it("source contracts: PT forces spectacle wet; OFF is dry competitive", () => {
		const src = readFileSync(
			resolve(__dirname, "../../src/visual/pitchWetness.ts"),
			"utf8",
		);
		expect(src).toContain("WET_SPECTACLE");
		expect(src).toContain("DRY_COMPETITIVE");
		expect(src).toMatch(/0\.42 \+ t \* 0\.4/);
		expect(src).toMatch(/t \* 0\.35/);
		expect(src).toContain("clearcoat: 0.1");
		expect(src).toContain("liftPitchAlbedo");
	});
});
