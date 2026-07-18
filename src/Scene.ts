import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import type GameObject from "./GameObject";
import { WORLD_GRAVITY } from "./util/rlConstants";
import { bindGrassRenderer } from "./visual/materials";
import {
	type StadiumLightingRig,
	setupStadiumLighting,
} from "./visual/stadiumLighting";
import {
	createStadiumLensFlares,
	type StadiumLensFlares,
} from "./visual/vfx/stadiumLensFlares";

const MENU_DECOR_NAMES = new Set([
	"menuShowcase",
	"menuShowcaseCar",
	"menuHeroCar",
	"menuSpotTarget",
	"menuShowcaseSpot",
	"menuShowcaseRim",
]);

function disposeObject3D(root: THREE.Object3D): void {
	root.traverse((node) => {
		if (node instanceof THREE.Mesh) {
			node.geometry?.dispose();
			const mats = Array.isArray(node.material)
				? node.material
				: [node.material];
			for (const mat of mats) {
				mat?.dispose();
			}
		}
	});
}

export function removeMenuDecorationsFromScene(scene: THREE.Scene): void {
	const remove: THREE.Object3D[] = [];
	for (const child of scene.children) {
		if (MENU_DECOR_NAMES.has(child.name)) {
			remove.push(child);
			continue;
		}
		if (child.name === "octaneCar" && child.parent === scene) {
			remove.push(child);
		}
	}
	for (const obj of remove) {
		obj.removeFromParent();
		disposeObject3D(obj);
	}
}

const MAX_FRAME_DT = 0.1;

/** Stały krok fizyki RL (Rocket League tick @ 120 Hz). */
export const PHYSICS_FIXED_DT = 1 / 120;

export type PhysicsStepResult = {
	steps: number;
	fixedDt: number;
};

export type PhysicsStepCallback = (
	dt: number,
	substep: number,
	substepCount: number,
) => void;

export type ContactForceHandler = (event: RAPIER.TempContactForceEvent) => void;

class Scene {
	threeJSScene: THREE.Scene;
	rapierWorld: RAPIER.World;
	gameObjects: GameObject[];
	lighting: StadiumLightingRig;
	lensFlares: StadiumLensFlares;
	private readonly eventQueue: RAPIER.EventQueue;
	onContactForce: ContactForceHandler | null = null;

	constructor() {
		this.threeJSScene = new THREE.Scene();
		this.threeJSScene.background = new THREE.Color(0x0b1424);
		this.rapierWorld = new RAPIER.World({ x: 0, y: WORLD_GRAVITY, z: 0 });
		this.gameObjects = [];
		this.eventQueue = new RAPIER.EventQueue(true);
		this.onContactForce = null;

		this.setupAtmosphere();
		this.lighting = setupStadiumLighting(this.threeJSScene);
		this.lensFlares = createStadiumLensFlares(
			this.threeJSScene,
			this.lighting,
		);
	}

	setupAtmosphere() {
		// Tło ustawia preloadCyberpunkSkybox() — mgła pod nocny stadion (murawa + neon).
		this.threeJSScene.fog = new THREE.FogExp2(0x1a0c28, 0.001);
	}

	/** Anizotropia murawy — wymaga WebGL renderera (RTX / max capabilities). */
	applyRendererCapabilities(renderer: THREE.WebGLRenderer): void {
		bindGrassRenderer(renderer);
	}

	focusShadowOn(_position: THREE.Vector3): void {
		// Cienie jupiterów są statyczne — patrz stadiumLighting.configureStaticArenaShadow.
	}

	/** Usuwa pozostałości live menu (showcase car, światła) przed kickoffem. */
	purgeMenuDecorations(): void {
		removeMenuDecorationsFromScene(this.threeJSScene);
	}

	removeGameObject(gameObject: GameObject): void {
		const idx = this.gameObjects.indexOf(gameObject);
		if (idx >= 0) this.gameObjects.splice(idx, 1);

		this.threeJSScene.remove(gameObject.threeJSGroup);

		if (gameObject.rapierCollider) {
			this.rapierWorld.removeCollider(gameObject.rapierCollider, true);
		}
		if (gameObject.rapierRigidBody) {
			this.rapierWorld.removeRigidBody(gameObject.rapierRigidBody);
		}
	}

	/**
	 * Aktualizacja fizyki na klatkę renderu — sub-stepping @ 120 Hz (RL tick).
	 * `control()` wołane raz @ 60 Hz; `preStep`/`postStep` per sub-krok.
	 */
	advancePhysics(
		frameDt: number,
		preStep?: PhysicsStepCallback,
		postStep?: PhysicsStepCallback,
	): PhysicsStepResult {
		const dt = Math.min(frameDt, MAX_FRAME_DT);
		/** Sub-step @ 120 Hz — cały świat Rapier; pre/post tylko dla aut (hover). */
		const steps = preStep ? Math.max(1, Math.round(dt / PHYSICS_FIXED_DT)) : 1;
		const fixedDt = dt / steps;

		for (let i = 0; i < steps; i++) {
			this.rapierWorld.timestep = fixedDt;
			preStep?.(fixedDt, i, steps);
			this.rapierWorld.step(this.eventQueue);
			postStep?.(fixedDt, i, steps);
		}

		this.eventQueue.drainContactForceEvents((event) => {
			this.onContactForce?.(event);
		});

		for (const gameObject of this.gameObjects) {
			gameObject.syncWithRigidBody();
			gameObject.rapierRigidBody.resetForces(false);
			gameObject.rapierRigidBody.resetTorques(false);
		}

		return { steps, fixedDt };
	}
}

export default Scene;
