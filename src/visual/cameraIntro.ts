import * as THREE from "three";
import type Renderer from "../Renderer";
import type Player from "../util/Player";
import { sampleChaseCameraTargets } from "./cameraFollow";

const INTRO_DURATION_SEC = 1.75;

const _lookFrom = new THREE.Vector3();
const _lookCur = new THREE.Vector3();
const _flatOrbit = new THREE.Vector3();

/** Kinowe przejście kamery menu → chase cam za autem. */
export class CameraIntroTransition {
	private elapsed = 0;
	private active = false;
	private readonly fromPos = new THREE.Vector3();
	private readonly fromLook = new THREE.Vector3();

	start(fromPos: THREE.Vector3, fromLookAt: THREE.Vector3): void {
		this.fromPos.copy(fromPos);
		this.fromLook.copy(fromLookAt);
		this.elapsed = 0;
		this.active = true;
	}

	isActive(): boolean {
		return this.active;
	}

	/** @returns true dopóki trwa animacja */
	update(
		dt: number,
		renderer: Renderer,
		player: Player,
		ballPos: THREE.Vector3,
	): boolean {
		if (!this.active) return false;

		this.elapsed += dt;
		const t = THREE.MathUtils.clamp(this.elapsed / INTRO_DURATION_SEC, 0, 1);
		const eased = t * t * (3 - 2 * t);

		const rot = player.rapierRigidBody.rotation();
		const carQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
		const carPos = player.getPosition();
		_flatOrbit.set(0, 0, 1).applyQuaternion(carQuat);
		_flatOrbit.y = 0;
		if (_flatOrbit.lengthSq() > 1e-6) {
			_flatOrbit.normalize();
		} else {
			_flatOrbit.set(0, 0, 1);
		}
		const { targetPos, lookAt } = sampleChaseCameraTargets(
			carPos,
			_flatOrbit,
			ballPos,
			renderer.isBallCamEnabled(),
		);

		const cam = renderer.threeJSCamera;
		cam.position.lerpVectors(this.fromPos, targetPos, eased);
		_lookCur.lerpVectors(this.fromLook, lookAt, eased);
		cam.up.set(0, 1, 0);
		cam.lookAt(_lookCur);

		if (t >= 1) {
			this.active = false;
			renderer.snapChaseCamera(player, ballPos);
			return false;
		}
		return true;
	}

	captureFromCamera(camera: THREE.PerspectiveCamera): void {
		this.fromPos.copy(camera.position);
		camera.getWorldDirection(_lookFrom);
		this.fromLook.copy(camera.position).addScaledVector(_lookFrom, 12);
	}
}
