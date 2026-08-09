/**
 * Dev free-fly kamera w meczu.
 * Toggle: Ctrl+Shift+C
 * WASD — lot w poziomie (XZ), Q/E — góra/dół, Shift — szybciej, scroll — prędkość,
 * mysz (LPM = pointer lock) — look. Strzałki — look bez myszy.
 * R — widok z góry (top-down nad środkiem boiska).
 */
import * as THREE from "three";

import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "../visual/arenaConstants";

const MOVE_BASE = 42;
const LOOK_SENS = 0.0022;
const ARROW_LOOK = 1.6;
const FLOOR_Y = PLAYFIELD_SURFACE_Y + 0.85;

function ceilingY(): number {
	const h = RL_ARENA.HEIGHT;
	return Number.isFinite(h) ? Math.max(120, h * 3) : 120;
}

export class DevFreeCamera {
	private active = false;
	private yaw = 0;
	private pitch = -0.35;
	private speedMul = 1;
	private pointerLocked = false;
	private readonly keys = new Set<string>();
	private readonly onKeyDown: (e: KeyboardEvent) => void;
	private readonly onKeyUp: (e: KeyboardEvent) => void;
	private readonly onWheel: (e: WheelEvent) => void;
	private readonly onMouseMove: (e: MouseEvent) => void;
	private readonly onMouseDown: (e: MouseEvent) => void;
	private readonly onPointerLockChange: () => void;
	private needsSync = false;
	private badge: HTMLDivElement | null = null;
	private attached = false;

	private readonly _flatForward = new THREE.Vector3();
	private readonly _right = new THREE.Vector3();
	private readonly _euler = new THREE.Euler(0, 0, 0, "YXZ");
	private readonly _quat = new THREE.Quaternion();

	constructor() {
		this.onKeyDown = (e) => {
			if (e.code === "KeyC" && e.ctrlKey && e.shiftKey && !e.repeat) {
				/** Tylko w meczu — poza meczem Ctrl+Shift+C = crate preview. */
				if (!document.body.classList.contains("in-match")) return;
				e.preventDefault();
				e.stopPropagation();
				this.toggle();
				return;
			}
			if (!this.active) return;
			/**
			 * Shift+R = toggle deszczu (main.ts) — nie kradnij zdarzenia.
			 * Sam R = top-down w free-cam.
			 */
			if (e.code === "KeyR" && e.shiftKey) {
				return;
			}
			this.keys.add(e.code);
			/** Nie oddawaj sterowania do gry gdy free-cam. */
			if (
				e.code === "KeyW" ||
				e.code === "KeyA" ||
				e.code === "KeyS" ||
				e.code === "KeyD" ||
				e.code === "KeyQ" ||
				e.code === "KeyE" ||
				e.code === "KeyR" ||
				e.code === "Space" ||
				e.code === "PageUp" ||
				e.code === "PageDown" ||
				e.code.startsWith("Arrow")
			) {
				e.preventDefault();
				e.stopPropagation();
			}
		};
		this.onKeyUp = (e) => {
			this.keys.delete(e.code);
		};
		this.onWheel = (e) => {
			if (!this.active) return;
			e.preventDefault();
			this.speedMul = THREE.MathUtils.clamp(
				this.speedMul * (e.deltaY < 0 ? 1.15 : 1 / 1.15),
				0.2,
				12,
			);
			this.refreshBadge();
		};
		this.onMouseMove = (e) => {
			if (!this.active || !this.pointerLocked) return;
			this.yaw -= e.movementX * LOOK_SENS;
			this.pitch -= e.movementY * LOOK_SENS;
			this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
		};
		this.onMouseDown = (e) => {
			if (!this.active || e.button !== 0) return;
			const canvas = document.querySelector("canvas");
			canvas?.requestPointerLock?.();
		};
		this.onPointerLockChange = () => {
			this.pointerLocked = document.pointerLockElement != null;
			this.refreshBadge();
		};
	}

	/** Podłącz listenery (raz, w DEV). */
	attach(): void {
		if (this.attached) return;
		this.attached = true;
		window.addEventListener("keydown", this.onKeyDown, true);
		window.addEventListener("keyup", this.onKeyUp, true);
		window.addEventListener("wheel", this.onWheel, {
			passive: false,
			capture: true,
		});
		window.addEventListener("mousemove", this.onMouseMove);
		window.addEventListener("mousedown", this.onMouseDown);
		document.addEventListener("pointerlockchange", this.onPointerLockChange);
	}

	detach(): void {
		if (!this.attached) return;
		this.attached = false;
		this.setActive(false);
		window.removeEventListener("keydown", this.onKeyDown, true);
		window.removeEventListener("keyup", this.onKeyUp, true);
		window.removeEventListener("wheel", this.onWheel, true);
		window.removeEventListener("mousemove", this.onMouseMove);
		window.removeEventListener("mousedown", this.onMouseDown);
		document.removeEventListener("pointerlockchange", this.onPointerLockChange);
	}

	isActive(): boolean {
		return this.active;
	}

	toggle(): void {
		this.setActive(!this.active);
	}

	setActive(on: boolean): void {
		if (this.active === on) return;
		this.active = on;
		this.keys.clear();
		this.needsSync = on;
		if (!on && document.pointerLockElement) {
			document.exitPointerLock?.();
		}
		this.refreshBadge();
		console.info(
			`[DevFreeCamera] ${on ? "ON" : "OFF"} — Ctrl+Shift+C · WASD flat · QE up/down · R top-down · LPM look`,
		);
	}

	/** Zsynchronizuj yaw/pitch z bieżącej kamery przy wejściu. */
	syncFromCamera(camera: THREE.PerspectiveCamera): void {
		const dir = new THREE.Vector3();
		camera.getWorldDirection(dir);
		this.yaw = Math.atan2(dir.x, dir.z);
		this.pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
		this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
		this.needsSync = false;
	}

	/** Preset: wysoko nad środkiem, patrz w dół. */
	snapTopDown(camera: THREE.PerspectiveCamera): void {
		camera.position.set(0, Math.min(ceilingY(), 55), 0);
		this.yaw = 0;
		this.pitch = -Math.PI / 2 + 0.08;
		this.applyOrientation(camera);
	}

	update(camera: THREE.PerspectiveCamera, dt: number): void {
		if (!this.active) return;
		if (this.needsSync) this.syncFromCamera(camera);

		/** R bez Shifta — top-down (Shift+R zostaje na deszcz). */
		if (
			this.keys.has("KeyR") &&
			!this.keys.has("ShiftLeft") &&
			!this.keys.has("ShiftRight")
		) {
			this.keys.delete("KeyR");
			this.snapTopDown(camera);
			return;
		}

		if (this.keys.has("ArrowLeft")) this.yaw += ARROW_LOOK * dt;
		if (this.keys.has("ArrowRight")) this.yaw -= ARROW_LOOK * dt;
		if (this.keys.has("ArrowUp")) {
			this.pitch = Math.min(1.45, this.pitch + ARROW_LOOK * dt);
		}
		if (this.keys.has("ArrowDown")) {
			this.pitch = Math.max(-1.45, this.pitch - ARROW_LOOK * dt);
		}

		/**
		 * WASD = lot w poziomie (bez pitchu) — W nie wjeżdża pod murawę
		 * gdy chase zostawił kamerę z nosem w dół.
		 * Q/E / Space / PgUp/PgDn = światowe Y.
		 */
		this._flatForward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
		this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

		let mx = 0;
		let my = 0;
		let mz = 0;
		if (this.keys.has("KeyW")) mz += 1;
		if (this.keys.has("KeyS")) mz -= 1;
		if (this.keys.has("KeyD")) mx += 1;
		if (this.keys.has("KeyA")) mx -= 1;
		if (
			this.keys.has("KeyE") ||
			this.keys.has("Space") ||
			this.keys.has("PageUp")
		) {
			my += 1;
		}
		if (this.keys.has("KeyQ") || this.keys.has("PageDown")) {
			my -= 1;
		}

		const sprint =
			this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 3.2 : 1;
		const speed = MOVE_BASE * this.speedMul * sprint * dt;
		const len = Math.hypot(mx, my, mz);
		if (len > 1e-6) {
			mx /= len;
			my /= len;
			mz /= len;
			camera.position.addScaledVector(this._right, mx * speed);
			camera.position.y += my * speed;
			camera.position.addScaledVector(this._flatForward, mz * speed);
		}

		camera.position.y = THREE.MathUtils.clamp(
			camera.position.y,
			FLOOR_Y,
			ceilingY(),
		);

		this.applyOrientation(camera);
	}

	/** Euler YXZ → bez lookAt gimbal / cross(forward,up) przy zenith. */
	private applyOrientation(camera: THREE.PerspectiveCamera): void {
		this._euler.set(this.pitch, this.yaw, 0, "YXZ");
		this._quat.setFromEuler(this._euler);
		camera.quaternion.copy(this._quat);
		camera.up.set(0, 1, 0);
		camera.updateMatrixWorld(true);
	}

	private refreshBadge(): void {
		if (!this.active) {
			this.badge?.remove();
			this.badge = null;
			return;
		}
		if (!this.badge) {
			this.badge = document.createElement("div");
			this.badge.id = "dev-free-cam-badge";
			Object.assign(this.badge.style, {
				position: "fixed",
				top: "12px",
				left: "12px",
				zIndex: "99999",
				padding: "6px 10px",
				borderRadius: "6px",
				background: "rgba(0,0,0,0.72)",
				color: "#7dffb3",
				fontFamily: "ui-monospace, monospace",
				fontSize: "12px",
				pointerEvents: "none",
				letterSpacing: "0.02em",
			} as CSSStyleDeclaration);
			document.body.appendChild(this.badge);
		}
		const lock = this.pointerLocked ? "LOCK" : "LPM=lock";
		this.badge.textContent = `FREE CAM · ×${this.speedMul.toFixed(2)} · ${lock} · R=top · Ctrl+Shift+C`;
	}
}

let singleton: DevFreeCamera | null = null;

export function getDevFreeCamera(): DevFreeCamera {
	if (!singleton) {
		singleton = new DevFreeCamera();
		if (import.meta.env.DEV) {
			singleton.attach();
		}
	}
	return singleton;
}
