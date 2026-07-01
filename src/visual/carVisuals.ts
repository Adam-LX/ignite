import * as THREE from "three";
import type { ScoringTeam } from "../game/modes";
import type { PowerUpHudState } from "../modes/IgnitionManager";
import type Player from "../util/Player";
import { loadCarModel as loadCarGlb } from "./CarModel";
import { mountCarNeonUnderglow } from "./carNeonUnderglow";
import { BoostExhaustVfx } from "./vfx/boostExhaustVfx";
import { BoostTrail } from "./vfx/boostTrail";
import { PowerUpCarVfx } from "./vfx/powerUpCarVfx";
import { SupersonicShockwave } from "./vfx/supersonicShockwave";
import { createHeadlightBeamMaterial } from "./volumetricBeam";

const HEADLIGHT_COLOR = 0xffffff;
const HEADLIGHT_INTENSITY = 3.2;
const HEADLIGHT_DISTANCE = 0;
const HEADLIGHT_ANGLE = Math.PI / 5.5;
const HEADLIGHT_PENUMBRA = 0.78;
const HEADLIGHT_AIM_DISTANCE = 24;
const BEAM_LENGTH = HEADLIGHT_AIM_DISTANCE;

/** @deprecated Skala 1 — mesh w metrach (Octane hitbox). */
export const CAR_VISUAL_SCALE = 1;

/** car.glb (Khronos CarConcept) — chrome + cyan underglow. */
export async function buildCarMesh(
	team: "blue" | "orange" = "blue",
): Promise<THREE.Group> {
	const car = await loadCarGlb(team);
	mountCarNeonUnderglow(car);
	return car;
}

export async function loadCarModel(
	team: "blue" | "orange" = "blue",
): Promise<THREE.Group> {
	return buildCarMesh(team);
}

/** Głęboki klon — osobne materiały (bez współdzielenia między autami). */
export function cloneCarMesh(source: THREE.Group): THREE.Group {
	const root = source.clone(true);
	root.traverse((node) => {
		if (node instanceof THREE.Mesh) {
			node.frustumCulled = false;
			node.visible = true;
			if (Array.isArray(node.material)) {
				node.material = node.material.map((m) => m.clone());
			} else if (node.material) {
				node.material = node.material.clone();
			}
		}
	});
	return root;
}

/** Zwalnia geometrię/materiały szablonu auta (nigdy nie dodawać do sceny). */
export function disposeCarMeshGroup(root: THREE.Group): void {
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

function createHeadlight(): THREE.SpotLight {
	const light = new THREE.SpotLight(
		HEADLIGHT_COLOR,
		HEADLIGHT_INTENSITY,
		HEADLIGHT_DISTANCE,
		HEADLIGHT_ANGLE,
		HEADLIGHT_PENUMBRA,
		1,
	);
	light.castShadow = false;
	light.decay = 1;
	return light;
}

export class CarVisuals {
	private readonly physicsRoot: THREE.Object3D;
	private readonly visualRoot: THREE.Object3D;
	private readonly scene: THREE.Scene;
	private readonly boostTrail: BoostTrail;
	private readonly boostExhaust: BoostExhaustVfx;
	private readonly supersonicShockwave: SupersonicShockwave;
	private readonly powerUpVfx: PowerUpCarVfx;
	private readonly leftLight: THREE.SpotLight;
	private readonly rightLight: THREE.SpotLight;
	private readonly leftBeam: THREE.Mesh;
	private readonly rightBeam: THREE.Mesh;
	private wheelSpin = 0;

	constructor(
		physicsRoot: THREE.Object3D,
		visualRoot: THREE.Object3D,
		scene: THREE.Scene,
		team: ScoringTeam,
	) {
		this.physicsRoot = physicsRoot;
		this.visualRoot = visualRoot;
		this.scene = scene;

		this.leftLight = createHeadlight();
		this.rightLight = createHeadlight();

		this.visualRoot.add(this.leftLight);
		this.visualRoot.add(this.rightLight);
		this.visualRoot.add(this.leftLight.target);
		this.visualRoot.add(this.rightLight.target);

		const beamGeo = new THREE.CylinderGeometry(
			0.12,
			3.2,
			BEAM_LENGTH,
			10,
			1,
			true,
		);
		const beamMat = createHeadlightBeamMaterial(0xe8f8ff);
		this.leftBeam = new THREE.Mesh(beamGeo, beamMat);
		this.rightBeam = new THREE.Mesh(beamGeo.clone(), beamMat.clone());
		for (const beam of [this.leftBeam, this.rightBeam]) {
			beam.rotation.x = Math.PI / 2;
			beam.position.z = BEAM_LENGTH * 0.5;
			beam.renderOrder = 6;
			beam.frustumCulled = false;
			beam.visible = false;
			this.visualRoot.add(beam);
		}

		this.boostTrail = new BoostTrail(scene);
		this.boostExhaust = new BoostExhaustVfx(visualRoot, scene, team);
		this.supersonicShockwave = new SupersonicShockwave(scene);
		this.powerUpVfx = new PowerUpCarVfx(visualRoot, scene);
	}

	burstSupersonic(worldPos: THREE.Vector3): void {
		this.supersonicShockwave.trigger(worldPos);
	}

	private syncLightFromSocket(
		light: THREE.SpotLight,
		beam: THREE.Mesh,
		socketName: string,
		defaultX: number,
	): void {
		const socket = this.visualRoot.getObjectByName(socketName);
		if (socket) {
			light.position.copy(socket.position);
			beam.position.copy(socket.position);
		} else {
			light.position.set(defaultX, 0.27, 0.6);
			beam.position.set(defaultX, 0.27, 0.6);
		}

		light.target.position.set(
			light.position.x,
			light.position.y,
			light.position.z + HEADLIGHT_AIM_DISTANCE,
		);
	}

	private updateHeadlights(): void {
		this.physicsRoot.updateMatrixWorld(true);

		this.syncLightFromSocket(
			this.leftLight,
			this.leftBeam,
			"headlight_L",
			-0.3,
		);
		this.syncLightFromSocket(
			this.rightLight,
			this.rightBeam,
			"headlight_R",
			0.3,
		);
	}

	private updateWheels(speed: number, dt: number): void {
		this.wheelSpin += (speed / 0.125) * dt;
		const names = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"] as const;
		for (const name of names) {
			const wheel = this.visualRoot.getObjectByName(name);
			if (wheel) {
				wheel.rotation.x = this.wheelSpin;
				continue;
			}
			const tire = this.visualRoot.getObjectByName(`${name}_tire`);
			if (tire) tire.rotation.x = this.wheelSpin;
		}
	}

	update(player: Player, boosting: boolean, dt: number): void {
		this.updateHeadlights();

		const speed = player.getVelocity().length();
		this.updateWheels(speed, dt);

		const fuel = player.getBoostFuel();
		const active = boosting && fuel > 0;
		this.boostTrail.update(player, active, dt);
		this.boostExhaust.update(player, active, dt);
		this.supersonicShockwave.update(dt);

		const headIntensity = active
			? HEADLIGHT_INTENSITY * 1.55
			: HEADLIGHT_INTENSITY;
		this.leftLight.intensity = headIntensity;
		this.rightLight.intensity = headIntensity;

		const beamOpacity = active ? 0.11 : 0.038;
		(this.leftBeam.material as THREE.ShaderMaterial).uniforms.uOpacity.value =
			beamOpacity;
		(this.rightBeam.material as THREE.ShaderMaterial).uniforms.uOpacity.value =
			beamOpacity;
		this.leftBeam.visible = active;
		this.rightBeam.visible = active;
	}

	updatePowerUp(
		state: PowerUpHudState | null,
		ballPos: THREE.Vector3 | null,
		dt: number,
	): void {
		this.powerUpVfx.update(
			state,
			this.physicsRoot.getWorldPosition(_powerUpWorldPos),
			ballPos,
			dt,
		);
	}

	dispose(): void {
		this.scene.remove(this.boostTrail.root);
		this.boostExhaust.dispose();
		this.supersonicShockwave.dispose();
		this.powerUpVfx.dispose();
		this.visualRoot.remove(this.leftLight);
		this.visualRoot.remove(this.rightLight);
		this.visualRoot.remove(this.leftLight.target);
		this.visualRoot.remove(this.rightLight.target);
		this.leftLight.dispose();
		this.rightLight.dispose();
		this.leftBeam.geometry.dispose();
		this.rightBeam.geometry.dispose();
		(this.leftBeam.material as THREE.Material).dispose();
		(this.rightBeam.material as THREE.Material).dispose();
		let streakGeoDisposed = false;
		for (const p of this.boostTrail.root.children) {
			if (p instanceof THREE.Sprite) {
				p.material.dispose();
			} else if (p instanceof THREE.Mesh) {
				(p.material as THREE.Material).dispose();
				if (!streakGeoDisposed) {
					p.geometry.dispose();
					streakGeoDisposed = true;
				}
			}
		}
	}
}

const _powerUpWorldPos = new THREE.Vector3();
