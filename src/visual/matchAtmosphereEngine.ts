import * as THREE from "three";
import { resolveArenaNeonHex } from "../arena/arenaNeonAccent";
import type { ScoringTeam } from "../game/modes";
import type { MatchPhase } from "../modes/MatchController";

/** Wewnętrzne stany emocjonalne areny — szersze niż MatchPhase. */
export type AtmospherePhase =
	| "pre_match"
	| "countdown"
	| "kickoff"
	| "rally"
	| "goal_blue"
	| "goal_orange"
	| "replay"
	| "overtime"
	| "post_match";

export type MatchAtmosphereSyncContext = {
	kickoff: boolean;
	overtime: boolean;
	scoringTeam: ScoringTeam | null;
	/** 0–1 — upływ meczu (dusk → neon). */
	timeline: number;
	timeRemainingSec: number;
	/** |blue − orange| */
	scoreDelta: number;
};

/** Sterowanie światłem, post-FX i cząsteczkami areny. */
export type MatchAtmosphereDrive = {
	tension: number;
	timeline: number;
	particlePulse: number;
	exposureOffset: number;
	hemiSkyTint: number;
	hemiWarmth: number;
	coolGrade: number;
	warmGrade: number;
	ledTension: number;
	neonLineBoost: number;
	bloomBias: number;
};

const DUSK = {
	sky: new THREE.Color(0x2a2848),
	ground: new THREE.Color(0x121810),
	intensity: 0.26,
} as const;

const NEON = {
	sky: new THREE.Color(0x3a68a8),
	ground: new THREE.Color(0x1a3848),
	intensity: 0.42,
} as const;

const OVERTIME = {
	sky: new THREE.Color(0x5a2038),
	ground: new THREE.Color(0x281018),
	intensity: 0.48,
} as const;

const _lerpSky = new THREE.Color();
const _lerpGround = new THREE.Color();
const _arenaAccent = new THREE.Color();
let arenaAccentKey = "cyan";

export function setMatchAtmosphereArenaAccent(accent?: string): void {
	arenaAccentKey = accent ?? "cyan";
}

export function computeMatchTension(
	timeline: number,
	timeRemainingSec: number,
	scoreDelta: number,
): number {
	const lateGame = THREE.MathUtils.clamp((timeline - 0.7) / 0.3, 0, 1);
	const crunch =
		timeRemainingSec <= 30
			? THREE.MathUtils.clamp(1 - timeRemainingSec / 30, 0, 1)
			: 0;
	const closeGame = scoreDelta <= 1 ? 1 - scoreDelta * 0.35 : 0;
	const clutch = crunch * closeGame;
	return THREE.MathUtils.clamp(
		Math.max(clutch, lateGame * 0.72) + timeline * 0.18,
		0,
		1,
	);
}

export function mapMatchPhaseToAtmosphere(
	phase: MatchPhase,
	ctx: Pick<MatchAtmosphereSyncContext, "kickoff" | "overtime" | "scoringTeam">,
): AtmospherePhase {
	switch (phase) {
		case "countdown":
			return "countdown";
		case "finished":
			return "post_match";
		case "goal_replay":
		case "goal_pause":
			return "replay";
		case "goal_bounce":
			return ctx.scoringTeam === "orange" ? "goal_orange" : "goal_blue";
		case "playing":
			if (ctx.overtime) return "overtime";
			if (ctx.kickoff) return "kickoff";
			return "rally";
		default:
			return "rally";
	}
}

type PhaseRecipe = Omit<MatchAtmosphereDrive, "tension" | "timeline">;

function phaseRecipe(
	phase: AtmospherePhase,
	phaseAge: number,
	impulse: number,
): PhaseRecipe {
	const countdownPulse = 0.35 + 0.45 * Math.sin(phaseAge * 4.2);
	const overtimePulse = 0.55 + 0.45 * Math.sin(phaseAge * 6.8);

	switch (phase) {
		case "pre_match":
			return {
				particlePulse: 0.12,
				exposureOffset: -0.04,
				hemiSkyTint: 0.08,
				hemiWarmth: 0,
				coolGrade: 0.22,
				warmGrade: 0,
				ledTension: 0.05,
				neonLineBoost: 0.35,
				bloomBias: 0,
			};
		case "countdown":
			return {
				particlePulse: countdownPulse,
				exposureOffset: -0.02 + impulse * 0.06,
				hemiSkyTint: 0.15 + impulse * 0.1,
				hemiWarmth: 0.05,
				coolGrade: 0.35 + impulse * 0.2,
				warmGrade: 0.08,
				ledTension: 0.2 + impulse * 0.25,
				neonLineBoost: 0.45,
				bloomBias: impulse * 0.08,
			};
		case "kickoff":
			return {
				particlePulse: 0.45 + impulse * 0.25,
				exposureOffset: -0.02 + impulse * 0.04,
				hemiSkyTint: 0.22,
				hemiWarmth: 0.18 + impulse * 0.15,
				coolGrade: 0.04,
				warmGrade: 0.14 + impulse * 0.18,
				ledTension: 0.38 + impulse * 0.25,
				neonLineBoost: 0.58,
				bloomBias: 0.03 + impulse * 0.05,
			};
		case "goal_blue":
			return {
				particlePulse: 0.85 + impulse * 0.4,
				exposureOffset: 0.06 + impulse * 0.1,
				hemiSkyTint: 0.42,
				hemiWarmth: 0.16,
				coolGrade: 0.32 + impulse * 0.22,
				warmGrade: 0.12,
				ledTension: 0.9,
				neonLineBoost: 0.88,
				bloomBias: 0.12 + impulse * 0.12,
			};
		case "goal_orange":
			return {
				particlePulse: 0.85 + impulse * 0.4,
				exposureOffset: 0.08 + impulse * 0.12,
				hemiSkyTint: 0.38,
				hemiWarmth: 0.48 + impulse * 0.28,
				coolGrade: 0.06,
				warmGrade: 0.42 + impulse * 0.28,
				ledTension: 0.9,
				neonLineBoost: 0.88,
				bloomBias: 0.14 + impulse * 0.14,
			};
		case "replay":
			return {
				particlePulse: 0.28,
				exposureOffset: -0.06,
				hemiSkyTint: 0.22,
				hemiWarmth: 0.05,
				coolGrade: 0.48,
				warmGrade: 0.04,
				ledTension: 0.35,
				neonLineBoost: 0.4,
				bloomBias: -0.04,
			};
		case "overtime":
			return {
				particlePulse: overtimePulse + impulse * 0.25,
				exposureOffset: 0.04 + overtimePulse * 0.04,
				hemiSkyTint: 0.55,
				hemiWarmth: 0.58,
				coolGrade: 0.08,
				warmGrade: 0.38 + overtimePulse * 0.18,
				ledTension: 0.95,
				neonLineBoost: 0.92,
				bloomBias: 0.1,
			};
		case "post_match":
			return {
				particlePulse: 0.18,
				exposureOffset: -0.08,
				hemiSkyTint: 0.12,
				hemiWarmth: 0,
				coolGrade: 0.3,
				warmGrade: 0,
				ledTension: 0.15,
				neonLineBoost: 0.3,
				bloomBias: -0.06,
			};
		default:
			return {
				particlePulse: 0.18,
				exposureOffset: -0.04,
				hemiSkyTint: 0.18,
				hemiWarmth: 0.08,
				coolGrade: 0.04,
				warmGrade: 0.06,
				ledTension: 0.2,
				neonLineBoost: 0.42,
				bloomBias: -0.02,
			};
	}
}

function blendTimelineIntoRecipe(
	recipe: PhaseRecipe,
	timeline: number,
	tension: number,
): PhaseRecipe {
	const neonMix = THREE.MathUtils.clamp(timeline * 0.85 + tension * 0.35, 0, 1);
	return {
		particlePulse: recipe.particlePulse + neonMix * 0.1,
		exposureOffset: recipe.exposureOffset + neonMix * 0.02,
		hemiSkyTint: THREE.MathUtils.clamp(
			recipe.hemiSkyTint + neonMix * 0.22,
			0,
			1,
		),
		hemiWarmth: recipe.hemiWarmth + neonMix * 0.08,
		coolGrade: recipe.coolGrade + neonMix * 0.04,
		warmGrade: recipe.warmGrade + neonMix * 0.06,
		ledTension: THREE.MathUtils.clamp(
			recipe.ledTension + tension * 0.45 + neonMix * 0.12,
			0,
			1,
		),
		neonLineBoost: recipe.neonLineBoost + neonMix * 0.22,
		bloomBias: recipe.bloomBias + neonMix * 0.03,
	};
}

function emptyDrive(): MatchAtmosphereDrive {
	return {
		tension: 0,
		timeline: 0,
		particlePulse: 0,
		exposureOffset: 0,
		hemiSkyTint: 0,
		hemiWarmth: 0,
		coolGrade: 0,
		warmGrade: 0,
		ledTension: 0,
		neonLineBoost: 0,
		bloomBias: 0,
	};
}

function lerpDrive(
	current: MatchAtmosphereDrive,
	target: MatchAtmosphereDrive,
	alpha: number,
): MatchAtmosphereDrive {
	const out = { ...current };
	for (const key of Object.keys(target) as (keyof MatchAtmosphereDrive)[]) {
		out[key] = THREE.MathUtils.lerp(current[key], target[key], alpha);
	}
	return out;
}

/** Orchestrator faz meczu — timeline dusk→neon + napięcie od wyniku/czasu. */
export class MatchAtmosphereEngine {
	private phase: AtmospherePhase = "pre_match";
	private phaseAge = 0;
	private impulsePulse = 0;
	private tension = 0;
	private timeline = 0;
	private drive: MatchAtmosphereDrive = emptyDrive();

	syncFromMatchPhase(
		matchPhase: MatchPhase,
		ctx: MatchAtmosphereSyncContext,
	): void {
		const next = mapMatchPhaseToAtmosphere(matchPhase, ctx);
		if (next !== this.phase) {
			this.onPhaseEnter(next);
			this.phase = next;
			this.phaseAge = 0;
		}
		this.timeline = THREE.MathUtils.clamp(ctx.timeline, 0, 1);
		this.tension = computeMatchTension(
			this.timeline,
			ctx.timeRemainingSec,
			ctx.scoreDelta,
		);
	}

	private onPhaseEnter(phase: AtmospherePhase): void {
		switch (phase) {
			case "countdown":
				this.impulsePulse = 0.55;
				break;
			case "kickoff":
				this.impulsePulse = 0.85;
				break;
			case "goal_blue":
			case "goal_orange":
				this.impulsePulse = 1;
				break;
			case "overtime":
				this.impulsePulse = 0.75;
				break;
			default:
				break;
		}
	}

	update(dt: number): MatchAtmosphereDrive {
		this.phaseAge += dt;
		this.impulsePulse = Math.max(0, this.impulsePulse - dt * 2.6);

		const recipe = blendTimelineIntoRecipe(
			phaseRecipe(this.phase, this.phaseAge, this.impulsePulse),
			this.timeline,
			this.tension,
		);

		const target: MatchAtmosphereDrive = {
			tension: this.tension,
			timeline: this.timeline,
			...recipe,
		};

		const smooth = 1 - Math.exp(-5.5 * dt);
		this.drive = lerpDrive(this.drive, target, smooth);
		this.drive.tension = this.tension;
		this.drive.timeline = this.timeline;
		return this.drive;
	}

	getDrive(): MatchAtmosphereDrive {
		return { ...this.drive };
	}

	getPhase(): AtmospherePhase {
		return this.phase;
	}

	reset(): void {
		this.phase = "pre_match";
		this.phaseAge = 0;
		this.impulsePulse = 0;
		this.tension = 0;
		this.timeline = 0;
		this.drive = emptyDrive();
	}
}

export type MatchAtmosphereHemiColors = {
	sky: THREE.Color;
	ground: THREE.Color;
	intensity: number;
};

/** Paleta hemi dla stadiumLighting — dusk/neon/overtime blend. */
export function sampleAtmosphereHemi(
	drive: MatchAtmosphereDrive,
	phase: AtmospherePhase,
): MatchAtmosphereHemiColors {
	const neonMix = THREE.MathUtils.clamp(
		drive.hemiSkyTint + drive.timeline * 0.35,
		0,
		1,
	);
	const overtimeMix = phase === "overtime" ? 0.65 : 0;

	_lerpSky.copy(DUSK.sky).lerp(NEON.sky, neonMix);
	_lerpGround.copy(DUSK.ground).lerp(NEON.ground, neonMix);

	const accentMix = neonMix * 0.42;
	if (accentMix > 0.01) {
		_arenaAccent.setHex(resolveArenaNeonHex(arenaAccentKey));
		_lerpSky.lerp(_arenaAccent, accentMix);
		_lerpGround.lerp(_arenaAccent, accentMix * 0.28);
	}

	if (overtimeMix > 0) {
		_lerpSky.lerp(OVERTIME.sky, overtimeMix);
		_lerpGround.lerp(OVERTIME.ground, overtimeMix);
	}

	const warmth = drive.hemiWarmth;
	if (warmth > 0.02) {
		_lerpSky.lerp(new THREE.Color(0xff8844), warmth * 0.22);
		_lerpGround.lerp(new THREE.Color(0x442818), warmth * 0.18);
	}

	const intensity = THREE.MathUtils.lerp(
		DUSK.intensity,
		NEON.intensity,
		neonMix,
	);
	return {
		sky: _lerpSky.clone(),
		ground: _lerpGround.clone(),
		intensity:
			intensity + drive.tension * 0.14 + (phase === "overtime" ? 0.08 : 0),
	};
}
