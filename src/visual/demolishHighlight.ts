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
	label: string;
};

/** Kinowy moment przy mocnym car-car — demo lub wreck. */
export class DemolishHighlight {
	private active = false;
	private elapsed = 0;
	private cooldown = 0;
	private intensity = 0;
	private label = "DEMOLISH!";

	trigger(impact: number, role: DemolishRole): void {
		if (impact < DEMOLISH_IMPACT_MIN || this.cooldown > 0) return;
		this.active = true;
		this.elapsed = 0;
		this.cooldown = 1.85;
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

	getPresentation(): DemolishPresentation {
		if (!this.active) {
			return {
				flash: 0,
				streak: 0,
				bloom: 0,
				fovBoost: 0,
				shake: 0,
				label: "",
			};
		}

		const t = this.elapsed;
		const k = this.intensity;
		const flash =
			t < 0.04
				? (1 - t / 0.04) * k
				: Math.max(0, 0.32 * k * (1 - (t - 0.04) / 0.24));
		const streak =
			t < 0.03 ? (t / 0.03) * k : t < 0.45 ? k * (1 - (t - 0.03) / 0.42) : 0;
		const bloom =
			t < 0.08
				? (t / 0.08) * k * 0.9
				: Math.max(0, k * (1 - (t - 0.08) / 0.48) * 0.75);
		const fovBoost = t < 0.16 ? THREE.MathUtils.lerp(10 * k, 2.5, t / 0.16) : 0;
		const shake = t < 0.32 ? THREE.MathUtils.lerp(0.62 * k, 0.1, t / 0.32) : 0;

		return {
			flash,
			streak,
			bloom,
			fovBoost,
			shake,
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

	if (presentation.label) {
		bannerEl.textContent = presentation.label;
	}

	if (presentation.flash > 0.25 || presentation.streak > 0.4) {
		bannerEl.classList.add("show");
	} else if (presentation.streak <= 0.1) {
		bannerEl.classList.remove("show");
	}
}
