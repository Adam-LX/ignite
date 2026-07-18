import * as THREE from "three";

import {
	type CarBodyStyle,
	getCarEntry,
	resolveCarId,
} from "./CarCatalog";

export type BodyTraitHook =
	| "none"
	| "ramHit"
	| "aeroSnap"
	| "pivotBoost"
	| "shockwaveDemo";

export type CarBodyTraits = {
	bodyStyle: CarBodyStyle;
	hook: BodyTraitHook;
	/** wide — mnożnik impulsu frontal hit poniżej limitu prędkości. */
	ramHitImpulseMul: number;
	ramHitMaxSpeedUu: number;
	ramHitMinForwardDot: number;
	/** low — wzmocnienie bocznej prędkości przy zejściu ze ściany. */
	aeroSnapCurveMul: number;
	/** hatch — mnożnik deadzone dodge poniżej limitu prędkości. */
	pivotDodgeDeadzoneMul: number;
	pivotMaxSpeedUu: number;
	/** tall — peak radial impulse (N·s / mass scale) po demolce. */
	shockwaveImpulse: number;
	shockwaveRadius: number;
	traitNameKey: string;
	traitDescKey: string;
};

const BASELINE: CarBodyTraits = {
	bodyStyle: "standard",
	hook: "none",
	ramHitImpulseMul: 1,
	ramHitMaxSpeedUu: 1200,
	ramHitMinForwardDot: 0.72,
	aeroSnapCurveMul: 1,
	pivotDodgeDeadzoneMul: 1,
	pivotMaxSpeedUu: 900,
	shockwaveImpulse: 0,
	shockwaveRadius: 8,
	traitNameKey: "garage.trait.standard",
	traitDescKey: "garage.trait.standard.desc",
};

const BY_STYLE: Record<CarBodyStyle, CarBodyTraits> = {
	standard: BASELINE,
	wide: {
		...BASELINE,
		bodyStyle: "wide",
		hook: "ramHit",
		ramHitImpulseMul: 1.08,
		traitNameKey: "garage.trait.ramHit",
		traitDescKey: "garage.trait.ramHit.desc",
	},
	low: {
		...BASELINE,
		bodyStyle: "low",
		hook: "aeroSnap",
		aeroSnapCurveMul: 1.12,
		traitNameKey: "garage.trait.aeroSnap",
		traitDescKey: "garage.trait.aeroSnap.desc",
	},
	hatch: {
		...BASELINE,
		bodyStyle: "hatch",
		hook: "pivotBoost",
		pivotDodgeDeadzoneMul: 0.85,
		traitNameKey: "garage.trait.pivotBoost",
		traitDescKey: "garage.trait.pivotBoost.desc",
	},
	tall: {
		...BASELINE,
		bodyStyle: "tall",
		hook: "shockwaveDemo",
		shockwaveImpulse: 3.4,
		shockwaveRadius: 8.5,
		traitNameKey: "garage.trait.shockwaveDemo",
		traitDescKey: "garage.trait.shockwaveDemo.desc",
	},
};

export function getTraitsForBodyStyle(style: CarBodyStyle): CarBodyTraits {
	return BY_STYLE[style] ?? BASELINE;
}

/** Data-driven hooks z katalogu — nigdy hardcode per carId. */
export function getTraitsForCar(carId: string): CarBodyTraits {
	const entry = getCarEntry(resolveCarId(carId));
	const style = entry?.bodyStyle ?? "standard";
	return getTraitsForBodyStyle(style);
}

/** wide / RamHit — frontal contact poniżej limitu UU/s. */
export function ramHitImpulseScale(
	traits: CarBodyTraits,
	forwardDotHit: number,
	speedUu: number,
): number {
	if (traits.hook !== "ramHit") return 1;
	if (speedUu >= traits.ramHitMaxSpeedUu) return 1;
	if (forwardDotHit < traits.ramHitMinForwardDot) return 1;
	return traits.ramHitImpulseMul;
}

/** hatch / PivotBoost — effective dodge deadzone. */
export function pivotDodgeDeadzone(
	traits: CarBodyTraits,
	baseDeadzone: number,
	speedUu: number,
): number {
	if (traits.hook !== "pivotBoost") return baseDeadzone;
	if (speedUu >= traits.pivotMaxSpeedUu) return baseDeadzone;
	return baseDeadzone * traits.pivotDodgeDeadzoneMul;
}

type ImpulseCar = {
	getPosition: () => { x: number; y: number; z: number };
	rapierRigidBody: {
		applyImpulse: (
			impulse: { x: number; y: number; z: number },
			wakeUp: boolean,
		) => void;
		mass: () => number;
	};
};

/**
 * tall / ShockwaveDemo — radial knockback wokół punktu demolki.
 * Pomija atakującego; lekki impuls w poziomie.
 */
export function applyShockwaveDemoImpulse(
	cars: readonly ImpulseCar[],
	epicenter: THREE.Vector3,
	traits: CarBodyTraits,
	skip: ImpulseCar | null,
): number {
	if (traits.hook !== "shockwaveDemo" || traits.shockwaveImpulse <= 0) {
		return 0;
	}
	const r = traits.shockwaveRadius;
	const r2 = r * r;
	let hitCount = 0;
	for (const car of cars) {
		if (car === skip) continue;
		const p = car.getPosition();
		const dx = p.x - epicenter.x;
		const dy = p.y - epicenter.y;
		const dz = p.z - epicenter.z;
		const d2 = dx * dx + dy * dy + dz * dz;
		if (d2 < 1e-6 || d2 > r2) continue;
		const dist = Math.sqrt(d2);
		const falloff = 1 - dist / r;
		const strength = traits.shockwaveImpulse * falloff * falloff;
		const inv = 1 / dist;
		const mass = Math.max(1, car.rapierRigidBody.mass());
		car.rapierRigidBody.applyImpulse(
			{
				x: dx * inv * strength * mass,
				y: dy * inv * strength * mass * 0.35,
				z: dz * inv * strength * mass,
			},
			true,
		);
		hitCount += 1;
	}
	return hitCount;
}
