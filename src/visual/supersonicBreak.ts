import * as THREE from "three";

export const SUPERSONIC_MPS = 22;

export type SupersonicPresentation = {
	flash: number;
	streak: number;
	bloom: number;
	fovBoost: number;
	shake: number;
	radialBlur: number;
	chromatic: number;
};

/** Krótki moment przy pierwszym wejściu w supersonic. */
export class SupersonicBreak {
	private active = false;
	private elapsed = 0;
	private wasSupersonic = false;

	reset(): void {
		this.active = false;
		this.elapsed = 0;
		this.wasSupersonic = false;
	}

	/** Wykrywa zbocze narastające — true tylko w klatce przełamania progu. */
	sampleCrossing(speedMps: number): boolean {
		const isSupersonic = speedMps >= SUPERSONIC_MPS;
		const broke = isSupersonic && !this.wasSupersonic;
		this.wasSupersonic = isSupersonic;
		if (broke) {
			this.active = true;
			this.elapsed = 0;
		}
		return broke;
	}

	update(dt: number): void {
		if (!this.active) return;
		this.elapsed += dt;
		if (this.elapsed >= 0.65) {
			this.active = false;
		}
	}

	isActive(): boolean {
		return this.active;
	}

	getPresentation(): SupersonicPresentation {
		if (!this.active) {
			return {
				flash: 0,
				streak: 0,
				bloom: 0,
				fovBoost: 0,
				shake: 0,
				radialBlur: 0,
				chromatic: 0,
			};
		}
		const t = this.elapsed;
		const flash =
			t < 0.05 ? 1.18 - t / 0.05 : Math.max(0, 0.32 * (1 - (t - 0.05) / 0.22));
		const streak = t < 0.05 ? t / 0.05 : t < 0.42 ? 1 - (t - 0.05) / 0.37 : 0;
		const bloom = t < 0.1 ? t / 0.1 : Math.max(0, 1 - (t - 0.1) / 0.4) * 0.78;
		const fovBoost = t < 0.16 ? THREE.MathUtils.lerp(10, 2.8, t / 0.16) : 0;
		const shake = t < 0.24 ? THREE.MathUtils.lerp(0.52, 0.08, t / 0.24) : 0;
		const radialBlur = t < 0.22 ? (1 - t / 0.22) * 0.18 : 0;
		const chromatic = t < 0.12 ? (1 - t / 0.12) * 0.85 : 0;
		return { flash, streak, bloom, fovBoost, shake, radialBlur, chromatic };
	}
}

export function applySupersonicOverlay(
	presentation: SupersonicPresentation,
): void {
	const flashEl = document.getElementById("supersonic-flash");
	const bannerEl = document.getElementById("supersonic-banner");
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
		"--radial-blur",
		String(THREE.MathUtils.clamp(presentation.radialBlur, 0, 1)),
	);
	flashEl.style.setProperty(
		"--chromatic",
		String(THREE.MathUtils.clamp(presentation.chromatic, 0, 1)),
	);

	if (presentation.flash > 0.28 || presentation.streak > 0.42) {
		bannerEl.classList.add("show");
	} else if (presentation.streak <= 0.08) {
		bannerEl.classList.remove("show");
	}
}
