import type Player from "../util/Player";

const LOG_INTERVAL_MS = 300;
const ROTATION_SPIKE_THRESHOLD = 2.0;
const STEER_HOLD_ALERT_MS = 80;

export type PhysicsStepInfo = {
	renderDt: number;
	fixedDt: number;
	steps: number;
};

export class PhysicsTelemetry {
	private lastLogMs = 0;
	private prevAngVelY = 0;
	private steerHeldMs = 0;

	/** Wywołaj w control() — śledzi, jak długo trzymany jest skręt. */
	noteSteeringInput(yaw: number, dt: number): void {
		if (Math.abs(yaw) > 0.01) {
			this.steerHeldMs += dt * 1000;
		} else {
			this.steerHeldMs = 0;
		}
	}

	tick(player: Player, stepInfo: PhysicsStepInfo): void {
		const now = performance.now();
		if (now - this.lastLogMs < LOG_INTERVAL_MS) return;
		this.lastLogMs = now;

		const av = player.rapierRigidBody.angvel();
		const lv = player.rapierRigidBody.linvel();
		const linSpeed = Math.hypot(lv.x, lv.y, lv.z);

		const stepMode =
			stepInfo.steps === 0
				? "BRAK KROKU (akumulator)"
				: stepInfo.steps === 1
					? "1× stały krok"
					: `${stepInfo.steps}× stały krok`;

		console.info(
			`[TELEMETRY] DT (render): ${stepInfo.renderDt.toFixed(4)}s | DT (Rapier): ${stepInfo.fixedDt.toFixed(4)}s | ${stepMode}\n` +
				`  Angular Velocity Y: ${av.y.toFixed(3)} rad/s\n` +
				`  Linear Velocity: (${lv.x.toFixed(2)}, ${lv.y.toFixed(2)}, ${lv.z.toFixed(2)}) | ${linSpeed.toFixed(2)} m/s`,
		);

		if (
			Math.abs(this.prevAngVelY) < 0.15 &&
			Math.abs(av.y) > ROTATION_SPIKE_THRESHOLD &&
			this.steerHeldMs < STEER_HOLD_ALERT_MS
		) {
			console.warn(
				`[TELEMETRY_ALERT] Wykryto impulsową eksplozję rotacji! ` +
					`${this.prevAngVelY.toFixed(2)} → ${av.y.toFixed(2)} rad/s (steerHeld=${this.steerHeldMs.toFixed(0)}ms)`,
			);
		}

		this.prevAngVelY = av.y;
	}

	reset(): void {
		this.lastLogMs = 0;
		this.prevAngVelY = 0;
		this.steerHeldMs = 0;
	}
}
