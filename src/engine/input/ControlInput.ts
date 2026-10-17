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
	/**
	 * KBM: dodge tylko ze świeżym WASD (trzymane W z jazdy ≠ flip).
	 * Pad / boty: pomijają — stick trzymany + 2×jump to dodge.
	 */
	kbmDodgeFilter?(): boolean;
};
