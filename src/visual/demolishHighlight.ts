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
		this.cooldown = 1.35;
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
		/** RL: demo transition 0 + shake off — krótki punch, szybki powrót. */
		if (this.elapsed >= 0.4) {
			this.active = false;
		}
	}

	isActive(): boolean {
		return this.active;
	}

	getSimTimeScale(): number {
		if (!this.attackerSlow || !this.active || this.elapsed > 0.07) return 1;
		return THREE.MathUtils.lerp(0.55, 1, this.elapsed / 0.07);
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
			t < 0.03
				? (1 - t / 0.03) * k * 0.95
				: Math.max(0, 0.28 * k * (1 - (t - 0.03) / 0.16));
		const streak =
			t < 0.02
				? (t / 0.02) * k * 1.0
				: t < 0.32
					? k * (1 - (t - 0.02) / 0.3)
					: 0;
		const bloom =
			t < 0.05
				? (t / 0.05) * k * 0.95
				: Math.max(0, k * (1 - (t - 0.05) / 0.28) * 0.72);
		const fovBoost = t < 0.12 ? THREE.MathUtils.lerp(3.8 * k, 0.9, t / 0.12) : 0;
		const shake = t < 0.16 ? THREE.MathUtils.lerp(0.14 * k, 0.03, t / 0.16) : 0;
		const chromatic =
			t < 0.04
				? (t / 0.04) * k * 0.75
				: Math.max(0, k * (1 - (t - 0.04) / 0.18) * 0.55);

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
		THREE.MathUtils.clamp(presentation.flash * 0.72, 0, 1),
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
