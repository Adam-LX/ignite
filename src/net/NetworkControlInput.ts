import type { ControlInput } from "../util/ControlInput";
import type { InputFramePayload } from "./protocol";

/** Wejście z sieci — ostatnia ramka od zdalnego gracza + kolejka krawędzi (skok/recover). */
export class NetworkControlInput implements ControlInput {
	private frame: InputFramePayload | null = null;
	private pendingJumps = 0;
	private pendingRecover = false;

	applyFrame(frame: InputFramePayload): void {
		this.frame = frame;
		if (frame.jumpEdge) {
			this.pendingJumps = Math.min(4, this.pendingJumps + 1);
		}
		if (frame.recover) {
			this.pendingRecover = true;
		}
	}

	forward(): number {
		return this.frame?.forward ?? 0;
	}

	yaw(): number {
		return this.frame?.yaw ?? 0;
	}

	roll(): number {
		return this.frame?.roll ?? 0;
	}

	isBoosting(): boolean {
		return this.frame?.boost ?? false;
	}

	isShiftDown(): boolean {
		return false;
	}

	isJumpHeld(): boolean {
		return this.frame?.jumpHeld ?? false;
	}

	peekJump(): boolean {
		return this.pendingJumps > 0;
	}

	consumeJump(): boolean {
		if (this.pendingJumps <= 0) return false;
		this.pendingJumps--;
		return true;
	}

	consumeRecover(): boolean {
		if (!this.pendingRecover) return false;
		this.pendingRecover = false;
		return true;
	}

	hasFlipDirection(): boolean {
		const f = this.frame;
		if (!f) return false;
		return f.forward !== 0 || f.yaw !== 0;
	}
}
