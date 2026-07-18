import type { ControlInput } from "./ControlInput";

export type BotDriveState = {
	forward: number;
	yaw: number;
	boost: boolean;
};

/** Wirtualne wejście bota — bez listenerów klawiatury/myszy. */
export class BotControlInput implements ControlInput {
	private drive: BotDriveState = { forward: 0, yaw: 0, boost: false };
	private jumpEdgeCount = 0;

	setDrive(drive: BotDriveState): void {
		this.drive = drive;
	}

	queueJump(): void {
		this.jumpEdgeCount = Math.min(3, this.jumpEdgeCount + 1);
	}

	forward(): number {
		return this.drive.forward;
	}

	yaw(): number {
		return this.drive.yaw;
	}

	roll(): number {
		return 0;
	}

	isBoosting(): boolean {
		return this.drive.boost;
	}

	isShiftDown(): boolean {
		return false;
	}

	isJumpHeld(): boolean {
		return false;
	}

	consumeRecover(): boolean {
		return false;
	}
	peekJump(): boolean {
		return this.jumpEdgeCount > 0;
	}

	consumeJump(): boolean {
		if (this.jumpEdgeCount <= 0) return false;
		this.jumpEdgeCount--;
		return true;
	}

	hasFlipDirection(): boolean {
		return (
			Math.abs(this.drive.forward) > 0.01 || Math.abs(this.drive.yaw) > 0.01
		);
	}
}
