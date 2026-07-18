import * as THREE from "three";

/** Minimalny impact (skala gry) do kinowego highlightu. */
export const POWER_SHOT_IMPACT_MIN = 14.5;

export type PowerShotPresentation = {
	flash: number;
	streak: number;
	bloom: number;
	fovBoost: number;
	shake: number;
	chromatic: number;
	label: string;
};

/** Mocne uderzenie w piłkę — krótki „power shot” jak supersonic / goal punch. */
export class PowerShotHighlight {
	private active = false;
	private elapsed = 0;
	private cooldown = 0;
	private intensity = 0;
	private label = "POWER SHOT";

	trigger(impact: number): void {
		if (impact < POWER_SHOT_IMPACT_MIN || this.cooldown > 0) return;
		this.active = true;
		this.elapsed = 0;
		this.cooldown = 1.15;
		this.intensity = THREE.MathUtils.clamp(
			(impact - POWER_SHOT_IMPACT_MIN) / 18,
			0.35,
			1,
		);
		this.label = impact >= 22 ? "MEGA SHOT" : "POWER SHOT";
	}

	update(dt: number): void {
		this.cooldown = Math.max(0, this.cooldown - dt);
		if (!this.active) return;
		this.elapsed += dt;
		if (this.elapsed >= 0.72) {
			this.active = false;
		}
	}

	isActive(): boolean {
		return this.active;
	}

	/** Mikro-hitstop przy mocnym strzale. */
	getSimTimeScale(): number {
		if (!this.active || this.elapsed > 0.09) return 1;
		return THREE.MathUtils.lerp(0.24, 1, this.elapsed / 0.09);
	}

	getPresentation(): PowerShotPresentation {
		if (!this.active) {
			return {
				flash: 0,
				streak: 0,
				bloom: 0,
				fovBoost: 0,
				shake: 0,
				chromatic: 0,
				label: "",
			};
		}

		const t = this.elapsed;
		const k = this.intensity;
		const flash =
			t < 0.045
				? (1 - t / 0.045) * k * 1.12
				: Math.max(0, 0.32 * k * (1 - (t - 0.045) / 0.2));
		const streak =
			t < 0.03
				? (t / 0.03) * k * 1.08
				: t < 0.4
					? k * (1 - (t - 0.03) / 0.37)
					: 0;
		const bloom =
			t < 0.08
				? (t / 0.08) * k * 0.95
				: Math.max(0, k * (1 - (t - 0.08) / 0.4) * 0.78);
		const fovBoost = t < 0.15 ? THREE.MathUtils.lerp(10 * k, 2.2, t / 0.15) : 0;
		const shake = t < 0.3 ? THREE.MathUtils.lerp(0.62 * k, 0.1, t / 0.3) : 0;
		const chromatic =
			t < 0.055
				? (t / 0.055) * k * 1.05
				: Math.max(0, k * (1 - (t - 0.055) / 0.22) * 0.9);

		return {
			flash,
			streak,
			bloom,
			fovBoost,
			shake,
			chromatic,
			label: this.label,
		};
	}
}

export function applyPowerShotOverlay(
	presentation: PowerShotPresentation,
): void {
	const flashEl = document.getElementById("power-shot-flash");
	const bannerEl = document.getElementById("power-shot-banner");
	if (!flashEl || !bannerEl) return;

	if (presentation.flash <= 0.01 && presentation.streak <= 0.01) {
		flashEl.style.opacity = "0";
		bannerEl.classList.remove("show");
		return;
	}

	flashEl.style.opacity = String(
		THREE.MathUtils.clamp(presentation.flash * 0.88, 0, 1),
	);
	flashEl.style.setProperty(
		"--streak",
		String(THREE.MathUtils.clamp(presentation.streak, 0, 1)),
	);
	flashEl.style.setProperty(
		"--chromatic",
		String(THREE.MathUtils.clamp(presentation.chromatic, 0, 1)),
	);

	if (presentation.label) {
		bannerEl.textContent = presentation.label;
	}

	if (presentation.flash > 0.28 || presentation.streak > 0.45) {
		bannerEl.classList.add("show");
	} else if (presentation.streak <= 0.1) {
		bannerEl.classList.remove("show");
	}
}
