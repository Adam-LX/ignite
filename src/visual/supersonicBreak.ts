import * as THREE from "three";

export const SUPERSONIC_MPS = 22;

export type SupersonicPresentation = {
	flash: number;
	streak: number;
	bloom: number;
	fovBoost: number;
	shake: number;
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
		if (this.elapsed >= 0.55) {
			this.active = false;
		}
	}

	isActive(): boolean {
		return this.active;
	}

	getPresentation(): SupersonicPresentation {
		if (!this.active) {
			return { flash: 0, streak: 0, bloom: 0, fovBoost: 0, shake: 0 };
		}
		const t = this.elapsed;
		const flash =
			t < 0.06 ? 1 - t / 0.06 : Math.max(0, 0.18 * (1 - (t - 0.06) / 0.2));
		const streak = t < 0.04 ? t / 0.04 : t < 0.35 ? 1 - (t - 0.04) / 0.31 : 0;
		const bloom =
			t < 0.08 ? t / 0.08 : Math.max(0, 1 - (t - 0.08) / 0.35) * 0.55;
		const fovBoost = t < 0.12 ? THREE.MathUtils.lerp(7, 2, t / 0.12) : 0;
		const shake = t < 0.2 ? THREE.MathUtils.lerp(0.35, 0.05, t / 0.2) : 0;
		return { flash, streak, bloom, fovBoost, shake };
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
		THREE.MathUtils.clamp(presentation.flash * 0.75, 0, 1),
	);
	flashEl.style.setProperty(
		"--streak",
		String(THREE.MathUtils.clamp(presentation.streak, 0, 1)),
	);

	if (presentation.flash > 0.35 || presentation.streak > 0.5) {
		bannerEl.classList.add("show");
	} else if (presentation.streak <= 0.08) {
		bannerEl.classList.remove("show");
	}
}
