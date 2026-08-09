import * as THREE from "three";

/** Minimalny impact (m/s skala) do highlightu demolish. */
export const DEMOLISH_IMPACT_MIN = 10.5;

export type DemolishRole = "attacker" | "victim";

export type DemolishPresentation = {
	flash: number;
	streak: number;
	bloom: number;
	fovBoost: number;
	shake: number;
	chromatic: number;
	label: string;
};

/** Kinowy moment przy mocnym car-car — demo lub wreck. */
export class DemolishHighlight {
	private active = false;
	private elapsed = 0;
	private cooldown = 0;
	private intensity = 0;
	private label = "DEMOLISH!";
	private attackerSlow = false;

	trigger(impact: number, role: DemolishRole): void {
		if (impact < DEMOLISH_IMPACT_MIN || this.cooldown > 0) return;
		this.active = true;
		this.elapsed = 0;
		this.cooldown = 1.85;
		this.attackerSlow = role === "attacker";
		this.intensity = THREE.MathUtils.clamp(
			(impact - DEMOLISH_IMPACT_MIN) / 14,
			0.4,
			1,
		);
		if (role === "attacker") {
			this.label = impact >= 16.5 ? "BOOM!" : "DEMOLISH!";
		} else {
			this.label = impact >= 16.5 ? "TOTAL WRECK" : "WRECKED";
		}
	}

	update(dt: number): void {
		this.cooldown = Math.max(0, this.cooldown - dt);
		if (!this.active) return;
		this.elapsed += dt;
		if (this.elapsed >= 0.78) {
			this.active = false;
		}
	}

	isActive(): boolean {
		return this.active;
	}

	getSimTimeScale(): number {
		if (!this.attackerSlow || !this.active || this.elapsed > 0.14) return 1;
		return THREE.MathUtils.lerp(0.32, 1, this.elapsed / 0.14);
	}

	getPresentation(): DemolishPresentation {
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
			t < 0.035
				? (1 - t / 0.035) * k * 1.15
				: Math.max(0, 0.38 * k * (1 - (t - 0.035) / 0.22));
		const streak =
			t < 0.025
				? (t / 0.025) * k * 1.1
				: t < 0.5
					? k * (1 - (t - 0.025) / 0.47)
					: 0;
		const bloom =
			t < 0.07
				? (t / 0.07) * k * 1.05
				: Math.max(0, k * (1 - (t - 0.07) / 0.45) * 0.88);
		const fovBoost = t < 0.18 ? THREE.MathUtils.lerp(12 * k, 3, t / 0.18) : 0;
		const shake = t < 0.38 ? THREE.MathUtils.lerp(0.78 * k, 0.12, t / 0.38) : 0;
		const chromatic =
			t < 0.06
				? (t / 0.06) * k * 1.2
				: Math.max(0, k * (1 - (t - 0.06) / 0.28) * 0.95);

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

export function applyDemolishOverlay(presentation: DemolishPresentation): void {
	const flashEl = document.getElementById("demolish-flash");
	const bannerEl = document.getElementById("demolish-banner");
	if (!flashEl || !bannerEl) return;

	if (presentation.flash <= 0.01 && presentation.streak <= 0.01) {
		flashEl.style.opacity = "0";
		bannerEl.classList.remove("show");
		return;
	}

	flashEl.style.opacity = String(
		THREE.MathUtils.clamp(presentation.flash * 0.92, 0, 1),
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

	if (presentation.flash > 0.25 || presentation.streak > 0.4) {
		bannerEl.classList.add("show");
	} else if (presentation.streak <= 0.1) {
		bannerEl.classList.remove("show");
	}
}
