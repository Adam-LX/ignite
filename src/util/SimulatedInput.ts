import type { ControlInput } from "./ControlInput";

/** Wejście bota — boolean per klawisz (jak gracz) + opcjonalne osie analogowe. */
export type SimulatedInput = {
	forward: boolean;
	backward: boolean;
	left: boolean;
	right: boolean;
	jump: boolean;
	boost: boolean;
	/** Analogowy gaz −1..1 (nadpisuje forward/backward gdy ustawiony). */
	forwardAxis?: number;
	/** Analogowy skręt −1..1 (nadpisuje left/right gdy ustawiony). */
	yawAxis?: number;
};

export function createEmptySimulatedInput(): SimulatedInput {
	return {
		forward: false,
		backward: false,
		left: false,
		right: false,
		jump: false,
		boost: false,
	};
}

/** Adapter SimulatedInput → ControlInput dla RocketCar.control(). */
export class SimulatedControlInput implements ControlInput {
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
		return 0;
	}

	isBoosting(): boolean {
		return this.input.boost;
	}

	isShiftDown(): boolean {
		return false;
	}

	isJumpHeld(): boolean {
		return this.input.jump;
	}

	consumeRecover(): boolean {
		return false;
	}
	peekJump(): boolean {
		return this.input.jump;
	}

	consumeJump(): boolean {
		return this.input.jump;
	}

	hasFlipDirection(): boolean {
		return (
			this.input.forward ||
			this.input.backward ||
			this.input.left ||
			this.input.right
		);
	}
}
