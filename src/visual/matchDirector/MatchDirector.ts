import * as THREE from "three";

import type { CinematicCameraMode } from "../../util/presentationPrefs";

export type DirectorShotKind = "goal" | "epicSave" | "demo" | "flipReset";

const PRIORITY: Record<DirectorShotKind, number> = {
	goal: 40,
	epicSave: 30,
	demo: 20,
	flipReset: 10,
};

const DURATION_ON: Record<DirectorShotKind, number> = {
	goal: 2.85,
	epicSave: 1.45,
	demo: 1.15,
	flipReset: 1.05,
};

const DURATION_REDUCED: Record<DirectorShotKind, number> = {
	goal: 1.35,
	epicSave: 0.85,
	demo: 0.7,
	flipReset: 0.65,
};

const GLOBAL_COOLDOWN_SEC = 2;
const BLEND_SEC = 0.4;

export type DirectorShotRequest = {
	kind: DirectorShotKind;
	focus: THREE.Vector3;
	/** Opcjonalny hint pozycji oka (np. za atakującym). */
	eyeHint?: THREE.Vector3;
};

export type DirectorCameraPose = {
	active: boolean;
	blend: number;
	eye: THREE.Vector3;
	lookAt: THREE.Vector3;
	shakeMul: number;
	kind: DirectorShotKind | null;
	/** full orbit only when mode=on and kind=goal */
	allowOrbit: boolean;
};

/**
 * Auto-kamera na momenty meczu — priorytet + cooldown 2 s.
 * Tryb `reduced`: krótsze cięcia, bez orbity.
 */
export class MatchDirector {
	private mode: CinematicCameraMode = "on";
	private activeKind: DirectorShotKind | null = null;
	private elapsed = 0;
	private duration = 0;
	private cooldownLeft = 0;
	private blend = 0;
	private readonly focus = new THREE.Vector3();
	private readonly eye = new THREE.Vector3();
	private readonly lookAt = new THREE.Vector3();
	private readonly _tmp = new THREE.Vector3();
	private orbitAngle = 0;

	setMode(mode: CinematicCameraMode): void {
		this.mode = mode;
		if (mode === "off") this.cancel();
	}

	getMode(): CinematicCameraMode {
		return this.mode;
	}

	isActive(): boolean {
		return this.activeKind !== null && this.mode !== "off";
	}

	cancel(): void {
		this.activeKind = null;
		this.elapsed = 0;
		this.duration = 0;
		this.blend = 0;
		this.orbitAngle = 0;
	}

	/**
	 * Próba strzału. False gdy off / cooldown / niższy priorytet.
	 * Goal zawsze przejmuje aktywny niższy shot.
	 */
	request(shot: DirectorShotRequest): boolean {
		if (this.mode === "off") return false;

		const pri = PRIORITY[shot.kind];
		if (this.activeKind) {
			if (pri <= PRIORITY[this.activeKind]) return false;
		} else if (this.cooldownLeft > 0 && shot.kind !== "goal") {
			return false;
		}

		this.activeKind = shot.kind;
		this.elapsed = 0;
		this.duration =
			this.mode === "reduced"
				? DURATION_REDUCED[shot.kind]
				: DURATION_ON[shot.kind];
		this.focus.copy(shot.focus);
		this.lookAt.copy(shot.focus);
		this.orbitAngle = 0;
		if (shot.eyeHint) {
			this.eye.copy(shot.eyeHint);
		} else {
			this.computeDefaultEye(shot.kind);
		}
		return true;
	}

	update(dt: number): DirectorCameraPose {
		if (this.cooldownLeft > 0) {
			this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
		}

		if (!this.activeKind || this.mode === "off") {
			this.blend = Math.max(0, this.blend - dt / BLEND_SEC);
			return this.pose(false);
		}

		this.elapsed += dt;
		const t = this.elapsed;
		if (t < BLEND_SEC) {
			this.blend = Math.min(1, t / BLEND_SEC);
		} else if (t > this.duration - BLEND_SEC) {
			this.blend = Math.max(
				0,
				(this.duration - t) / BLEND_SEC,
			);
		} else {
			this.blend = 1;
		}

		this.updateEyeForKind(this.activeKind, dt);

		if (t >= this.duration) {
			this.cooldownLeft = GLOBAL_COOLDOWN_SEC;
			this.activeKind = null;
			this.blend = 0;
			return this.pose(false);
		}

		return this.pose(true);
	}

	/** Test helper — pozostały cooldown. */
	getCooldownLeft(): number {
		return this.cooldownLeft;
	}

	private pose(active: boolean): DirectorCameraPose {
		return {
			active,
			blend: this.blend,
			eye: this.eye.clone(),
			lookAt: this.lookAt.clone(),
			shakeMul: active ? 0.55 + this.blend * 0.45 : 0,
			kind: this.activeKind,
			allowOrbit:
				active &&
				this.mode === "on" &&
				this.activeKind === "goal",
		};
	}

	private computeDefaultEye(kind: DirectorShotKind): void {
		const elev =
			kind === "goal" ? 5.8 : kind === "epicSave" ? 4.2 : 3.6;
		const dist =
			kind === "goal" ? 12 : kind === "demo" ? 9 : 8;
		this.eye.set(
			this.focus.x + dist * 0.65,
			this.focus.y + elev,
			this.focus.z + dist * 0.55,
		);
	}

	private updateEyeForKind(kind: DirectorShotKind, dt: number): void {
		this.lookAt.copy(this.focus);
		if (kind === "goal" && this.mode === "on") {
			this.orbitAngle += dt * (Math.PI / 2.6);
			const a = Math.min(this.orbitAngle, Math.PI);
			const r = 11 + Math.sin(a * 0.5) * 2;
			const y = 5.5 + Math.sin(a * 0.85) * 1.4;
			this.eye.set(
				this.focus.x + Math.sin(a) * r,
				this.focus.y + y,
				this.focus.z + Math.cos(a) * r,
			);
			return;
		}
		if (kind === "epicSave" || kind === "flipReset") {
			this._tmp.set(0, 0.35 * dt, 0);
			this.eye.add(this._tmp);
			return;
		}
		if (kind === "demo") {
			this.eye.lerp(
				this._tmp.set(
					this.focus.x + 7,
					this.focus.y + 3.2,
					this.focus.z + 5,
				),
				1 - Math.exp(-2.5 * dt),
			);
		}
	}
}
