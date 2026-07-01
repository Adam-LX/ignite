/** Wejście KBM + gamepad (Steam Deck / Xbox). LPM/RT boost, PPM/A skok + flip, B = Ball Cam. */
import * as THREE from "three";

import type { ControlInput } from "./ControlInput";
import { applyDeadzone, GAMEPAD, readTrigger } from "./gamepadLayout";

export type AutopilotDriveOverride = {
	forward: number;
	yaw: number;
	boost: boolean;
};

type InputFlags = {
	forward: boolean;
	backward: boolean;
	left: boolean;
	right: boolean;
	jump: boolean;
	boost: boolean;
	q: boolean;
	e: boolean;
	r: boolean;
};

const KEY_CODE_TO_FLAG: Partial<Record<string, keyof InputFlags>> = {
	KeyW: "forward",
	KeyS: "backward",
	KeyA: "left",
	KeyD: "right",
	KeyQ: "q",
	KeyE: "e",
	KeyR: "r",
};

class GameInput implements ControlInput {
	private static humanInstance: GameInput | null = null;

	private readonly inputs: InputFlags = {
		forward: false,
		backward: false,
		left: false,
		right: false,
		jump: false,
		boost: false,
		q: false,
		e: false,
		r: false,
	};

	private shift = false;
	private gamepadShift = false;
	private leftMouse = false;
	private rightMouseHeld = false;
	private replaySkipQueued = false;
	private jumpEdgeCount = 0;
	private recoverQueued = false;
	private ballCamToggleQueued = false;
	private autopilotDrive: AutopilotDriveOverride | null = null;

	private gamepadForward = 0;
	private gamepadYaw = 0;
	private gamepadRoll = 0;
	private gamepadBoost = false;
	private gamepadActive = false;
	private prevJumpBtn = false;
	private prevBallCamBtn = false;

	static createHuman(_root: HTMLElement): GameInput {
		if (!GameInput.humanInstance) {
			GameInput.humanInstance = new GameInput();
		}
		return GameInput.humanInstance;
	}

	private constructor() {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.code === "Space") {
				e.preventDefault();
				if (!e.repeat) {
					this.ballCamToggleQueued = true;
				}
				return;
			}
			this.applyKeyCode(e.code, true);
			this.applyLegacyKey(e.key, true);
			this.shift = e.shiftKey;
		};

		const onKeyUp = (e: KeyboardEvent) => {
			if (e.code === "Space") return;
			this.applyKeyCode(e.code, false);
			this.applyLegacyKey(e.key, false);
			this.shift = e.shiftKey;
		};

		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		document.addEventListener("keydown", onKeyDown, true);
		document.addEventListener("keyup", onKeyUp, true);

		const onDown = (e: MouseEvent) => {
			if (e.button === 0) {
				this.leftMouse = true;
				this.inputs.boost = true;
			}
			if (e.button === 2) {
				e.preventDefault();
				this.replaySkipQueued = true;
				this.rightMouseHeld = true;
				this.inputs.jump = true;
				this.jumpEdgeCount = Math.min(3, this.jumpEdgeCount + 1);
				this.recoverQueued = true;
			}
		};
		const onUp = (e: MouseEvent) => {
			if (e.button === 0) {
				this.leftMouse = false;
				this.inputs.boost = false;
			}
			if (e.button === 2) {
				this.rightMouseHeld = false;
				this.replaySkipQueued = false;
				this.inputs.jump = false;
			}
		};
		const resetAll = () => {
			this.resetInputs();
		};

		window.addEventListener("mousedown", onDown, true);
		window.addEventListener("mouseup", onUp, true);
		window.addEventListener("blur", resetAll);
		window.addEventListener("mouseleave", resetAll);
		document.addEventListener("visibilitychange", () => {
			if (document.hidden) resetAll();
		});
		window.addEventListener("contextmenu", (e) => e.preventDefault(), true);

		window.addEventListener("gamepadconnected", (e) => {
			console.info("[Ignite] Gamepad:", e.gamepad.id);
		});
	}

	/** Wołaj raz na klatkę z pętli gry. */
	pollGamepad(): void {
		if (this.autopilotDrive) return;

		const pad = this.findPad();
		if (!pad) {
			this.gamepadActive = false;
			this.gamepadForward = 0;
			this.gamepadYaw = 0;
			this.gamepadRoll = 0;
			this.gamepadBoost = false;
			this.gamepadShift = false;
			return;
		}

		const ly = applyDeadzone(-(pad.axes[GAMEPAD.axisLeftY] ?? 0));
		const lx = applyDeadzone(-(pad.axes[GAMEPAD.axisLeftX] ?? 0));
		const rx = applyDeadzone(pad.axes[GAMEPAD.axisRightX] ?? 0);

		this.gamepadForward = ly;
		this.gamepadYaw = lx;
		this.gamepadRoll = rx;
		this.gamepadBoost = readTrigger(
			pad.buttons[GAMEPAD.r2],
			pad.axes[GAMEPAD.axisR2],
		);
		this.gamepadShift = pad.buttons[GAMEPAD.l1]?.pressed ?? false;

		this.gamepadActive =
			Math.abs(ly) > 0.05 ||
			Math.abs(lx) > 0.05 ||
			Math.abs(rx) > 0.05 ||
			this.gamepadBoost ||
			this.gamepadShift ||
			pad.buttons.some((b) => b.pressed);

		const jumpNow = pad.buttons[GAMEPAD.faceSouth]?.pressed ?? false;
		if (jumpNow && !this.prevJumpBtn) {
			this.jumpEdgeCount = Math.min(3, this.jumpEdgeCount + 1);
			this.recoverQueued = true;
		}
		this.rightMouseHeld = this.rightMouseHeld || jumpNow;
		if (!jumpNow && !this.inputs.jump) {
			this.rightMouseHeld = false;
			this.replaySkipQueued = false;
		}
		this.prevJumpBtn = jumpNow;

		const camNow = pad.buttons[GAMEPAD.faceEast]?.pressed ?? false;
		if (camNow && !this.prevBallCamBtn) {
			this.ballCamToggleQueued = true;
		}
		this.prevBallCamBtn = camNow;
	}

	isGamepadActive(): boolean {
		return this.gamepadActive;
	}

	private findPad(): Gamepad | null {
		if (typeof navigator.getGamepads !== "function") return null;
		const pads = navigator.getGamepads();
		for (const pad of pads) {
			if (pad?.connected) return pad;
		}
		return null;
	}

	private resetInputs(): void {
		this.inputs.forward = false;
		this.inputs.backward = false;
		this.inputs.left = false;
		this.inputs.right = false;
		this.inputs.jump = false;
		this.inputs.boost = false;
		this.inputs.q = false;
		this.inputs.e = false;
		this.inputs.r = false;
		this.leftMouse = false;
		this.rightMouseHeld = false;
		this.replaySkipQueued = false;
		this.shift = false;
	}

	private applyKeyCode(code: string, down: boolean): void {
		const flag = KEY_CODE_TO_FLAG[code];
		if (flag) {
			this.inputs[flag] = down;
		}
	}

	private applyLegacyKey(key: string, down: boolean): void {
		switch (key.toLowerCase()) {
			case "w":
				this.inputs.forward = down;
				break;
			case "s":
				this.inputs.backward = down;
				break;
			case "a":
				this.inputs.left = down;
				break;
			case "d":
				this.inputs.right = down;
				break;
			case "q":
				this.inputs.q = down;
				break;
			case "e":
				this.inputs.e = down;
				break;
			case "r":
				this.inputs.r = down;
				break;
		}
	}

	setAutopilotDrive(drive: AutopilotDriveOverride | null): void {
		this.autopilotDrive = drive;
	}

	isAutopilotActive(): boolean {
		return this.autopilotDrive !== null;
	}

	isKeyDown(key: string): boolean {
		switch (key.toLowerCase()) {
			case "w":
				return this.inputs.forward;
			case "s":
				return this.inputs.backward;
			case "a":
				return this.inputs.left;
			case "d":
				return this.inputs.right;
			case "q":
				return this.inputs.q;
			case "e":
				return this.inputs.e;
			case "r":
				return this.inputs.r;
			default:
				return false;
		}
	}

	isShiftDown(): boolean {
		return this.shift || this.gamepadShift;
	}

	isBoosting(): boolean {
		if (this.autopilotDrive) return this.autopilotDrive.boost;
		return this.leftMouse || this.inputs.boost || this.gamepadBoost;
	}

	isJumpHeld(): boolean {
		return this.rightMouseHeld || this.inputs.jump;
	}

	peekJump(): boolean {
		return this.jumpEdgeCount > 0;
	}

	consumeRecover(): boolean {
		if (!this.recoverQueued) return false;
		this.recoverQueued = false;
		return true;
	}

	consumeJump(): boolean {
		if (this.jumpEdgeCount <= 0) return false;
		this.jumpEdgeCount--;
		this.recoverQueued = false;
		return true;
	}

	queueJump(): void {
		this.jumpEdgeCount = Math.min(3, this.jumpEdgeCount + 1);
		this.recoverQueued = true;
	}

	consumeBallCamToggle(): boolean {
		if (!this.ballCamToggleQueued) return false;
		this.ballCamToggleQueued = false;
		return true;
	}

	/** PPM podczas replay — pomiń powtórkę (nie zużywa skoku w meczu). */
	consumeReplaySkip(): boolean {
		if (!this.replaySkipQueued) return false;
		this.replaySkipQueued = false;
		return true;
	}

	forward(): number {
		if (this.autopilotDrive) return this.autopilotDrive.forward;
		const kb = Number(this.inputs.forward) - Number(this.inputs.backward);
		if (this.gamepadActive && Math.abs(this.gamepadForward) > 0.05) {
			return THREE.MathUtils.clamp(this.gamepadForward, -1, 1);
		}
		return kb;
	}

	yaw(): number {
		if (this.autopilotDrive) return this.autopilotDrive.yaw;
		const kb = Number(this.inputs.left) - Number(this.inputs.right);
		if (this.gamepadActive && Math.abs(this.gamepadYaw) > 0.05) {
			return THREE.MathUtils.clamp(this.gamepadYaw, -1, 1);
		}
		return kb;
	}

	roll(): number {
		const kb = Number(this.inputs.q) - Number(this.inputs.e);
		if (this.gamepadActive && Math.abs(this.gamepadRoll) > 0.05) {
			return THREE.MathUtils.clamp(this.gamepadRoll, -1, 1);
		}
		return kb;
	}

	hasFlipDirection(): boolean {
		const deadzone = 0.2;
		return (
			Math.abs(this.forward()) > deadzone || Math.abs(this.yaw()) > deadzone
		);
	}

	releaseAll(): void {
		this.resetInputs();
		this.jumpEdgeCount = 0;
		this.recoverQueued = false;
		this.ballCamToggleQueued = false;
		this.autopilotDrive = null;
		this.gamepadActive = false;
		this.gamepadForward = 0;
		this.gamepadYaw = 0;
		this.gamepadRoll = 0;
		this.gamepadBoost = false;
		this.gamepadShift = false;
		this.prevJumpBtn = false;
		this.prevBallCamBtn = false;
	}
}

if (typeof window !== "undefined") {
	GameInput.createHuman(document.body);
}

export default GameInput;
