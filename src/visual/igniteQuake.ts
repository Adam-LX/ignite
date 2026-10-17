/**
 * Ignite Quake — doznaniowe „trzęsienie ziemi” stadionu.
 * Niskoczęstotliwościowy rumble (nie random shake z RL Camera Shake),
 * FOV kick, vignette, sub-boom. Tylko na big moments.
 */
import * as THREE from "three";

export type IgniteQuakeKind =
	| "goal"
	| "demolish"
	| "kickoff"
	| "epic"
	| "impact"
	| "signature";

export type IgniteQuakePresentation = {
	/** Envelope 0–1 (siła doznania). */
	amount: number;
	/** Offset kamery (world, metry) — low-freq sine, nie biały szum. */
	offset: THREE.Vector3;
	fovKick: number;
	chromatic: number;
	bloom: number;
	vignette: number;
	dust: number;
	/** CSS overlay class hint. */
	overlayHard: boolean;
};

const KIND_PEAK: Record<IgniteQuakeKind, number> = {
	goal: 0.92,
	demolish: 0.72,
	kickoff: 0.78,
	epic: 0.62,
	impact: 0.38,
	signature: 1.05,
};

const KIND_DURATION: Record<IgniteQuakeKind, number> = {
	goal: 0.68,
	demolish: 0.5,
	kickoff: 0.42,
	epic: 0.46,
	impact: 0.28,
	signature: 0.82,
};

const _offset = new THREE.Vector3();

export class IgniteQuake {
	private life = 0;
	private maxLife = 0.5;
	private peak = 0;
	private kind: IgniteQuakeKind = "impact";
	private clock = 0;
	private readonly applied = new THREE.Vector3();

	/**
	 * Trigger / stack. Silniejszy kind wygrywa peak; life odświeża się.
	 */
	trigger(kind: IgniteQuakeKind, intensity = 1): void {
		const k = THREE.MathUtils.clamp(intensity, 0.35, 1.4);
		const peak = KIND_PEAK[kind] * k;
		const dur = KIND_DURATION[kind];
		if (peak >= this.peak * 0.85 || this.life <= 0) {
			this.kind = kind;
			this.peak = Math.max(this.peak * 0.55, peak);
			this.maxLife = dur;
			this.life = dur;
		} else {
			this.peak = Math.max(this.peak, peak * 0.75);
			this.life = Math.max(this.life, dur * 0.65);
			this.maxLife = Math.max(this.maxLife, dur);
		}
	}

	reset(): void {
		this.life = 0;
		this.peak = 0;
		this.clock = 0;
		this.applied.set(0, 0, 0);
	}

	isActive(): boolean {
		return this.life > 0.001;
	}

	update(dt: number): IgniteQuakePresentation {
		this.clock += dt;
		if (this.life <= 0) {
			this.peak = 0;
			return {
				amount: 0,
				offset: _offset.set(0, 0, 0),
				fovKick: 0,
				chromatic: 0,
				bloom: 0,
				vignette: 0,
				dust: 0,
				overlayHard: false,
			};
		}
		this.life = Math.max(0, this.life - dt);
		const u = this.life / Math.max(1e-4, this.maxLife);
		/** Attack szybki, decay z „aftershock” (druga fala). */
		const attack = 1 - Math.exp(-(1 - u) * 14);
		const aftershock =
			u < 0.55 ? Math.sin((0.55 - u) * Math.PI * 2.2) * 0.35 * u : 0;
		const env = this.peak * Math.max(0, attack * (0.55 + 0.45 * u) + aftershock);

		/**
		 * Low-freq rumble — jak stadium bass / trzęsienie, nie Camera Shake RL.
		 * Dominanta pionowa + lekki yaw.
		 */
		const t = this.clock;
		const amp = env * 0.065;
		_offset.set(
			Math.sin(t * 17.3) * amp * 0.55 + Math.sin(t * 29.1) * amp * 0.22,
			Math.sin(t * 14.8) * amp * 1.15 + Math.sin(t * 37.0) * amp * 0.28,
			Math.sin(t * 15.6) * amp * 0.5 + Math.cos(t * 26.4) * amp * 0.2,
		);

		return {
			amount: env,
			offset: _offset,
			fovKick: env * (this.kind === "kickoff" ? 4.2 : 3.4),
			chromatic: env * 0.45,
			bloom: env * 0.58,
			vignette: env * 0.72,
			dust: env * 0.55,
			overlayHard: env > 0.62 || this.kind === "signature" || this.kind === "goal",
		};
	}

	/** Odejmij poprzedni offset przed springiem kamery (jak shakeApplied). */
	beginFrame(camera: THREE.Camera): void {
		if (this.applied.lengthSq() > 1e-12) {
			camera.position.sub(this.applied);
			this.applied.set(0, 0, 0);
		}
	}

	/** Nałóż świeży offset po chase. */
	applyToCamera(camera: THREE.Camera, offset: THREE.Vector3): void {
		if (offset.lengthSq() < 1e-12) return;
		this.applied.copy(offset);
		camera.position.add(this.applied);
	}
}

/** CSS / DOM overlay — vignette + pył. */
export function applyIgniteQuakeOverlay(p: IgniteQuakePresentation): void {
	const el = document.getElementById("ignite-quake");
	if (!el) return;
	if (p.amount < 0.02) {
		el.classList.remove("show", "hard");
		el.style.removeProperty("--quake");
		el.style.removeProperty("--quake-dust");
		return;
	}
	el.classList.add("show");
	el.classList.toggle("hard", p.overlayHard);
	el.style.setProperty("--quake", p.vignette.toFixed(3));
	el.style.setProperty("--quake-dust", p.dust.toFixed(3));
}
