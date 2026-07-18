import * as THREE from "three";

import { horizontalFovToVertical } from "./cameraFollow";

/** Blisko murawy — kadr boczny jak w meczu (nie „z góry” = mdłe kolory). */
const ORBIT_RADIUS = 38;
const BASE_HEIGHT = 9.2;
const HEIGHT_WAVE = 1.4;
const ORBIT_SPEED = 0.14;
const MENU_HORIZONTAL_FOV = 58;
/** Środek murawy — orbita pokazuje prawdziwy stadion, nie tylko auto. */
const LOOK_TARGET = new THREE.Vector3(0, 1.6, 0);
const SMOOTH_RATE = 5.2;
/** Garaż: orbita kamery (statyczna kamera + spin auta = trwały ghost Wayland). */
const GARAGE_ORBIT_SPEED = 0.26;
const GARAGE_ORBIT_RADIUS = Math.hypot(6.2, 7.4);
const GARAGE_ORBIT_HEIGHT_WAVE = 0.14;

const _lookScratch = new THREE.Vector3();
const _jitterOffset = new THREE.Vector3();
const _garagePosScratch = new THREE.Vector3();

/**
 * Kinowa orbita menu — niska, szybka, z luksusową inercją i micro-jitterem od myszy.
 */
export class MenuCinematicCamera {
	private menuTime = 0;
	private jitterPhase = 0;
	private readonly pointer = new THREE.Vector2();
	private garageMode = false;
	private garageBlend = 0;
	private garageIntroActive = false;
	private showcaseCalm = true;
	private readonly garagePosition = new THREE.Vector3(6.2, 2.35, 7.4);
	private readonly garageLookAt = new THREE.Vector3(0, 1.05, 0);
	private garageTurntable = 0;
	private garageOrbitTime = 0;
	private equipSpin = 0;
	private smoothedInit = false;
	private readonly rawPosition = new THREE.Vector3();
	private readonly smoothedPosition = new THREE.Vector3();
	private readonly rawLookAt = new THREE.Vector3();
	private readonly smoothedLookAt = new THREE.Vector3();

	update(camera: THREE.PerspectiveCamera, delta: number): void {
		if (this.garageMode) {
			this.garageBlend = 1;
			this.garageOrbitTime += delta * GARAGE_ORBIT_SPEED;
			const height =
				this.garagePosition.y +
				Math.sin(this.garageOrbitTime * 1.05) * GARAGE_ORBIT_HEIGHT_WAVE;
			this.rawPosition.set(
				this.garageLookAt.x +
					Math.cos(this.garageOrbitTime) * GARAGE_ORBIT_RADIUS,
				height,
				this.garageLookAt.z +
					Math.sin(this.garageOrbitTime) * GARAGE_ORBIT_RADIUS,
			);
			this.rawLookAt.copy(this.garageLookAt);
			this.smoothedPosition.copy(this.rawPosition);
			this.smoothedLookAt.copy(this.rawLookAt);
			camera.position.copy(this.smoothedPosition);
			camera.up.set(0, 1, 0);
			camera.lookAt(this.smoothedLookAt);
			const garageFov = horizontalFovToVertical(58, camera.aspect);
			if (Math.abs(camera.fov - garageFov) > 0.05) {
				camera.fov = garageFov;
				camera.updateProjectionMatrix();
			}
			return;
		}

		const garageTarget = this.garageMode ? 1 : 0;
		const blendRate = this.garageIntroActive ? 9.2 : 5.5;
		this.garageBlend = THREE.MathUtils.lerp(
			this.garageBlend,
			garageTarget,
			1 - Math.exp(-blendRate * delta),
		);

		if (
			this.garageIntroActive &&
			this.garageBlend > 0.001 &&
			this.garageBlend < 0.98 &&
			!this.showcaseCalm
		) {
			this.garageTurntable += delta * 0.38;
		}

		const orbitSpeed = this.showcaseCalm ? ORBIT_SPEED * 0.48 : ORBIT_SPEED;
		this.menuTime += delta * orbitSpeed;
		if (!this.showcaseCalm) {
			this.jitterPhase += delta;
		}
		if (this.equipSpin > 0) {
			this.equipSpin = Math.max(0, this.equipSpin - delta * 2.8);
		}

		const height = BASE_HEIGHT + Math.sin(this.menuTime * 0.95) * HEIGHT_WAVE;
		const radius = ORBIT_RADIUS + Math.sin(this.menuTime * 0.55) * 3.8;
		const parallaxMul = this.showcaseCalm ? 0.22 : 0.65;
		const parallaxX = this.pointer.x * 4.5 * parallaxMul;
		const parallaxZ = this.pointer.y * 3.2 * parallaxMul;
		this.rawPosition.set(
			Math.cos(this.menuTime) * radius + parallaxX,
			height,
			Math.sin(this.menuTime) * radius + parallaxZ,
		);

		this.rawLookAt.copy(LOOK_TARGET);
		this.rawLookAt.x +=
			Math.sin(this.menuTime * 0.7) * 4.5 + this.pointer.x * 1.1;
		this.rawLookAt.y += Math.sin(this.menuTime * 0.9) * 0.55;
		this.rawLookAt.z +=
			Math.cos(this.menuTime * 0.55) * 4.5 + this.pointer.y * 0.9;

		if (this.garageBlend > 0.001) {
			const parallaxMul = this.garageIntroActive ? 0 : this.showcaseCalm ? 0.35 : 1;
			const gx =
				this.garagePosition.x +
				Math.sin(this.garageTurntable) * 0.35 * (1 - this.garageBlend) +
				this.pointer.x * 0.45 * parallaxMul;
			const gz =
				this.garagePosition.z +
				Math.cos(this.garageTurntable) * 0.35 * (1 - this.garageBlend) +
				this.pointer.y * 0.35 * parallaxMul;
			_garagePosScratch.set(gx, this.garagePosition.y, gz);
			this.rawPosition.lerp(_garagePosScratch, this.garageBlend);
			this.rawLookAt.lerp(this.garageLookAt, this.garageBlend);
		}

		if (!this.smoothedInit) {
			this.smoothedPosition.copy(this.rawPosition);
			this.smoothedLookAt.copy(this.rawLookAt);
			this.smoothedInit = true;
		} else if (
			this.isGarageTransitioning() ||
			this.garageIntroActive ||
			(this.garageMode && this.garageBlend > 0.94)
		) {
			// Wygładzanie + blend = „rozdwojenie” na ekranie (Print Screen = OK).
			this.smoothedPosition.copy(this.rawPosition);
			this.smoothedLookAt.copy(this.rawLookAt);
		} else {
			const lerp = 1 - Math.exp(-SMOOTH_RATE * delta);
			this.smoothedPosition.lerp(this.rawPosition, lerp);
			this.smoothedLookAt.lerp(this.rawLookAt, lerp);
		}

		const ptrMag = this.pointer.length();
		const jitterAmt = this.showcaseCalm
			? 0
			: (0.01 + ptrMag * 0.022) * (1 - this.garageBlend * 0.85);
		_jitterOffset.set(
			Math.sin(this.jitterPhase * 47) * jitterAmt * (0.6 + this.pointer.x),
			Math.sin(this.jitterPhase * 53 + 1.2) * jitterAmt * 0.55,
			Math.cos(this.jitterPhase * 41) * jitterAmt * (0.6 + this.pointer.y),
		);

		camera.position.copy(this.smoothedPosition).add(_jitterOffset);
		camera.up.set(0, 1, 0);
		camera.lookAt(this.smoothedLookAt);

		const roll = this.showcaseCalm
			? 0
			: Math.sin(this.menuTime * 0.55) * 0.018 * (1 - this.garageBlend);
		camera.rotateZ(roll);

		const menuFov = horizontalFovToVertical(MENU_HORIZONTAL_FOV, camera.aspect);
		const garageFov = horizontalFovToVertical(58, camera.aspect);
		const verticalFov = THREE.MathUtils.lerp(
			menuFov,
			garageFov,
			this.garageBlend,
		);
		if (Math.abs(camera.fov - verticalFov) > 0.05) {
			camera.fov = verticalFov;
			camera.updateProjectionMatrix();
		}
	}

	getPose(): { position: THREE.Vector3; lookAt: THREE.Vector3 } {
		_lookScratch.copy(this.smoothedLookAt);
		return {
			position: this.smoothedPosition.clone(),
			lookAt: _lookScratch.clone(),
		};
	}

	setGarageMode(on: boolean): void {
		this.garageMode = on;
	}

	setGarageIntroActive(on: boolean): void {
		this.garageIntroActive = on;
	}

	/** Zamrożony kadr garażu po blendzie — zero ruchu kamery. */
	applyGarageHold(camera: THREE.PerspectiveCamera): void {
		this.garageBlend = 1;
		this.rawPosition.copy(this.garagePosition);
		this.rawLookAt.copy(this.garageLookAt);
		this.smoothedPosition.copy(this.rawPosition);
		this.smoothedLookAt.copy(this.rawLookAt);
		this.applyHeldPose(camera);
	}

	/** Bez delta — stosuje bieżący snap (menu/garaż) na kamerę. */
	applyHeldPose(camera: THREE.PerspectiveCamera): void {
		camera.position.copy(this.smoothedPosition);
		camera.up.set(0, 1, 0);
		camera.lookAt(this.smoothedLookAt);
		const menuFov = horizontalFovToVertical(MENU_HORIZONTAL_FOV, camera.aspect);
		const garageFov = horizontalFovToVertical(58, camera.aspect);
		const verticalFov = THREE.MathUtils.lerp(
			menuFov,
			garageFov,
			this.garageBlend,
		);
		if (Math.abs(camera.fov - verticalFov) > 0.05) {
			camera.fov = verticalFov;
			camera.updateProjectionMatrix();
		}
	}

	getGarageBlend(): number {
		return this.garageBlend;
	}

	isGarageTransitioning(): boolean {
		return this.garageBlend > 0.012 && this.garageBlend < 0.999;
	}

	snapToGarage(): void {
		this.garageMode = true;
		this.garageBlend = 1;
		this.equipSpin = 0;
		const dx = this.garagePosition.x - this.garageLookAt.x;
		const dz = this.garagePosition.z - this.garageLookAt.z;
		this.garageOrbitTime = Math.atan2(dz, dx);
		const height =
			this.garagePosition.y +
			Math.sin(this.garageOrbitTime * 1.05) * GARAGE_ORBIT_HEIGHT_WAVE;
		this.rawPosition.set(
			this.garageLookAt.x +
				Math.cos(this.garageOrbitTime) * GARAGE_ORBIT_RADIUS,
			height,
			this.garageLookAt.z +
				Math.sin(this.garageOrbitTime) * GARAGE_ORBIT_RADIUS,
		);
		this.rawLookAt.copy(this.garageLookAt);
		this.smoothedPosition.copy(this.rawPosition);
		this.smoothedLookAt.copy(this.rawLookAt);
		this.smoothedInit = true;
	}

	snapToMenu(): void {
		this.garageMode = false;
		this.garageBlend = 0;
		this.equipSpin = 0;
		this.applyMenuOrbitPose();
		this.smoothedPosition.copy(this.rawPosition);
		this.smoothedLookAt.copy(this.rawLookAt);
		this.smoothedInit = true;
	}

	private applyMenuOrbitPose(): void {
		const height = BASE_HEIGHT + Math.sin(this.menuTime * 2.1) * HEIGHT_WAVE;
		const radius = ORBIT_RADIUS + Math.sin(this.menuTime * 0.85) * 2.4;
		const parallaxMul = this.showcaseCalm ? 0.35 : 1;
		const parallaxX = this.pointer.x * 2.8 * parallaxMul;
		const parallaxZ = this.pointer.y * 2.2 * parallaxMul;
		this.rawPosition.set(
			Math.cos(this.menuTime) * radius + parallaxX,
			height,
			Math.sin(this.menuTime) * radius + parallaxZ,
		);
		this.rawLookAt.copy(LOOK_TARGET);
		this.rawLookAt.x +=
			Math.sin(this.menuTime * 1.1) * 2.4 + this.pointer.x * 0.6;
		this.rawLookAt.y += Math.sin(this.menuTime * 1.6) * 0.35;
		this.rawLookAt.z +=
			Math.cos(this.menuTime * 0.9) * 2.4 + this.pointer.y * 0.5;
	}

	triggerEquipSpin(): void {
		this.equipSpin = 0.35;
	}

	setShowcaseCalm(on: boolean): void {
		this.showcaseCalm = on;
	}

	reset(): void {
		this.garageMode = false;
		this.garageBlend = 0;
		this.garageTurntable = 0;
		this.garageOrbitTime = 0;
		this.menuTime = 0;
		this.jitterPhase = 0;
		this.pointer.set(0, 0);
		this.equipSpin = 0;
		this.smoothedInit = false;
	}

	/** Normalized pointer −1…1 for menu parallax. */
	setPointerNorm(x: number, y: number): void {
		this.pointer.set(
			THREE.MathUtils.clamp(x, -1, 1),
			THREE.MathUtils.clamp(y, -1, 1),
		);
	}

	getEquipSpinBoost(): number {
		return this.equipSpin;
	}
}
