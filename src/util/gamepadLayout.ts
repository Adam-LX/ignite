/** Standardowy układ pada (Steam Deck / Xbox) — indeksy W3C Gamepad API. */
export const GAMEPAD = {
	faceSouth: 0,
	faceEast: 1,
	faceWest: 2,
	faceNorth: 3,
	l1: 4,
	r1: 5,
	l2: 6,
	r2: 7,
	select: 8,
	start: 9,
	l3: 10,
	r3: 11,
	dpadUp: 12,
	dpadDown: 13,
	dpadLeft: 14,
	dpadRight: 15,
	axisLeftX: 0,
	axisLeftY: 1,
	axisRightX: 2,
	axisRightY: 3,
	/** Niektóre mapowania trzymają R2 na osi 4/5. */
	axisR2: 5,
} as const;

export const GAMEPAD_DEADZONE = 0.16;

export function applyDeadzone(
	value: number,
	deadzone = GAMEPAD_DEADZONE,
): number {
	if (Math.abs(value) < deadzone) return 0;
	const sign = Math.sign(value);
	const scaled = (Math.abs(value) - deadzone) / (1 - deadzone);
	return sign * Math.min(1, scaled);
}

export function readTrigger(
	button: GamepadButton | undefined,
	axisValue: number | undefined,
	threshold = 0.45,
): boolean {
	if (button?.pressed) return true;
	return (axisValue ?? 0) > threshold;
}
