import type { ControlInput } from "./ControlInput";

/** Wejście bota — boolean per klawisz (jak gracz) + opcjonalne osie analogowe. */
export type SimulatedInput = {
	forward: boolean;
	backward: boolean;
	left: boolean;
	right: boolean;
	jump: boolean;
	boost: boolean;
	/** Powerslide / air-roll (Shift) — jak GameInput. */
	shift?: boolean;
	/** Analogowy gaz −1..1 (nadpisuje forward/backward gdy ustawiony). */
	forwardAxis?: number;
	/** Analogowy skręt −1..1 (nadpisuje left/right gdy ustawiony). */
	yawAxis?: number;
	/** Osobny roll −1..1 (Q/E); stackuje się z air-roll przez Shift+A/D. */
	rollAxis?: number;
};

export function createEmptySimulatedInput(): SimulatedInput {
	return {
		forward: false,
		backward: false,
		left: false,
		right: false,
		jump: false,
		boost: false,
		shift: false,
		rollAxis: 0,
	};
}

/** Adapter SimulatedInput → ControlInput dla RocketCar.control(). */
export class SimulatedControlInput implements ControlInput {
	private prevJump = false;
	private pendingJumps = 0;

	constructor(private readonly input: SimulatedInput) {}

	forward(): number {
		if (this.input.forwardAxis !== undefined) {
			return Math.max(-1, Math.min(1, this.input.forwardAxis));
		}
		if (this.input.forward) return 1;
		if (this.input.backward) return -1;
		return 0;
	}

	yaw(): number {
		if (this.input.yawAxis !== undefined) {
			return Math.max(-1, Math.min(1, this.input.yawAxis));
		}
		if (this.input.left && !this.input.right) return 1;
		if (this.input.right && !this.input.left) return -1;
		return 0;
	}

	roll(): number {
		const v = this.input.rollAxis ?? 0;
		return Math.max(-1, Math.min(1, v));
	}

	isBoosting(): boolean {
		return this.input.boost;
	}

	isShiftDown(): boolean {
		return this.input.shift === true;
	}

	isJumpHeld(): boolean {
		return this.input.jump;
	}

	consumeRecover(): boolean {
		return false;
	}
	peekJump(): boolean {
		this.syncJumpEdges();
		return this.pendingJumps > 0;
	}

	consumeJump(): boolean {
		this.syncJumpEdges();
		if (this.pendingJumps <= 0) return false;
		this.pendingJumps--;
		return true;
	}

	/** Rising edge jump — jak GameInput.jumpEdgeCount, nie trzyma level. */
	private syncJumpEdges(): void {
		const held = this.input.jump;
		if (held && !this.prevJump) {
			this.pendingJumps = Math.min(3, this.pendingJumps + 1);
		}
		this.prevJump = held;
	}

	hasFlipDirection(): boolean {
		return (
			this.input.forward ||
			this.input.backward ||
			this.input.left ||
			this.input.right ||
			Math.abs(this.input.forwardAxis ?? 0) > 0.2 ||
			Math.abs(this.input.yawAxis ?? 0) > 0.2
		);
	}
}
