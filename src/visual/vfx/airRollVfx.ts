/**
 * Air-roll VFX — wyłączone (animowane pierścienie przy Q/E były zbędne).
 * Klasa zostaje jako no-op, żeby nie ruszać wiring w carVisuals.
 */
export class AirRollVfx {
	constructor(_parent?: unknown) {
		/* disabled */
	}

	update(_roll: number, _airborne: boolean, _dt: number): void {
		/* disabled */
	}

	dispose(): void {
		/* no resources */
	}
}
