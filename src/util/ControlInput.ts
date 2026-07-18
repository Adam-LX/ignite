/** Wspólny interfejs wejścia dla gracza i botów. */
export type ControlInput = {
	forward(): number;
	yaw(): number;
	roll(): number;
	isBoosting(): boolean;
	isShiftDown(): boolean;
	isJumpHeld(): boolean;
	consumeJump(): boolean;
	peekJump(): boolean;
	consumeRecover(): boolean;
	hasFlipDirection(): boolean;
};
