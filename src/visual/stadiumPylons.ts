/** Pozycje futurystycznych pylonów oświetleniowych wokół areny. */
export const STADIUM_PYLON_SPECS = [
	{ x: -62, z: -88, height: 54, target: [18, 0, 22] as const },
	{ x: 62, z: -88, height: 50, target: [-20, 0, 18] as const },
	{ x: -62, z: 88, height: 52, target: [15, 0, -25] as const },
	{ x: 62, z: 88, height: 48, target: [-18, 0, -20] as const },
	{ x: 0, z: -95, height: 56, target: [0, 0, 30] as const },
	{ x: 0, z: 95, height: 56, target: [0, 0, -30] as const },
] as const;
