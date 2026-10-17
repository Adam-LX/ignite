/**
 * Scenariusze aerial smoke — wspólne dla hotkeya w meczu i headless probe.
 * Nie wymagają skillu: spawn w sytuacji, Ty tylko dokończ / obserwuj.
 */
import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "../visual/arenaConstants";
import { RAMP_RUN } from "../visual/perimeter/constants";

export type AerialSmokePose = {
	car: {
		x: number;
		y: number;
		z: number;
		yawY: number;
		pitch?: number;
		roll?: number;
		vel?: { x: number; y: number; z: number };
		angVel?: { x: number; y: number; z: number };
		boost?: number;
		jumpCount?: number;
		grounded?: boolean;
	};
	ball: {
		x: number;
		y: number;
		z: number;
		vel?: { x: number; y: number; z: number };
	};
};

export type AerialSmokeScenario = {
	id: string;
	label: string;
	/** Co sprawdzać / jak grać — krótka ściąga. */
	tip: string;
	build: () => AerialSmokePose;
};

function wallFaceX(): number {
	return RL_ARENA.HALF_WIDTH + RAMP_RUN - 0.55;
}

export const AERIAL_SMOKE_SCENARIOS: readonly AerialSmokeScenario[] = [
	{
		id: "midair_approach",
		label: "1 · Mid-air → piłka",
		tip: "Już w powietrzu po 1. skoku. Boost + air roll w piłkę. Sprawdź: czy auto nie „klei” niewidzialnej płaszczyzny.",
		build: () => ({
			car: {
				x: 0,
				y: 4.2,
				z: -18,
				yawY: 0,
				pitch: -0.18,
				vel: { x: 0, y: 2.2, z: 14 },
				boost: 0.85,
				jumpCount: 1,
			},
			ball: {
				x: 0.4,
				y: 6.5,
				z: -2,
				vel: { x: 0, y: -1.2, z: -3 },
			},
		}),
	},
	{
		id: "double_jump_window",
		label: "2 · Double-jump window",
		tip: "Tuż po odlocie — masz 2. skok. RMB = jump. Sprawdź: czy W nie zjada flipa / czy 2. skok odpala.",
		build: () => ({
			car: {
				x: 2,
				y: 2.15,
				z: -8,
				yawY: 0,
				vel: { x: 0, y: 8.5, z: 11 },
				boost: 0.7,
				jumpCount: 1,
			},
			ball: {
				x: 1.5,
				y: 5.8,
				z: 4,
				vel: { x: 0, y: 0.5, z: 0 },
			},
		}),
	},
	{
		id: "wall_leave_aerial",
		label: "3 · Wall leave → aerial",
		tip: "Na ścianie, skok w stronę piłki. Sprawdź: odklejenie, brak re-stick, air control po leave.",
		build: () => {
			const x = wallFaceX();
			return {
				car: {
					x,
					y: 9.5,
					z: -6,
					/** Nos w stronę boiska (−X), „góra” = ściana. */
					yawY: -Math.PI / 2,
					pitch: Math.PI / 2,
					roll: 0,
					vel: { x: -2, y: 6, z: 4 },
					boost: 0.9,
					jumpCount: 0,
					grounded: true,
				},
				ball: {
					x: x - 8,
					y: 11,
					z: 2,
					vel: { x: -2, y: -1, z: 1 },
				},
			};
		},
	},
	{
		id: "ceiling_pinch",
		label: "4 · Ceiling / high ball",
		tip: "Wysoko pod sufitem. Boost w dół/górę, nie wbij się w cove. Sprawdź: ceiling stick / odklejenie.",
		build: () => ({
			car: {
				x: 4,
				y: Math.max(18, RL_ARENA.HEIGHT - 8),
				z: 0,
				yawY: Math.PI,
				pitch: 0.35,
				vel: { x: -3, y: 1.5, z: 8 },
				boost: 1,
				jumpCount: 1,
			},
			ball: {
				x: 0,
				y: Math.max(16, RL_ARENA.HEIGHT - 10),
				z: 6,
				vel: { x: 0, y: -2, z: -1 },
			},
		}),
	},
	{
		id: "falling_recovery",
		label: "5 · Falling recovery",
		tip: "Bokiem/do góry kołami. Air roll na koła albo R recover. Sprawdź: soft landing, czy nie teleporteruje.",
		build: () => ({
			car: {
				x: -6,
				y: 7.5,
				z: 10,
				yawY: 0.4,
				pitch: 0.2,
				roll: Math.PI * 0.85,
				vel: { x: 2, y: -6, z: -4 },
				angVel: { x: 1.2, y: 0.4, z: -0.8 },
				boost: 0.35,
				jumpCount: 2,
			},
			ball: {
				x: 0,
				y: PLAYFIELD_SURFACE_Y + 0.95,
				z: 0,
				vel: { x: 0, y: 0, z: 0 },
			},
		}),
	},
	{
		id: "fast_aerial_launch",
		label: "6 · Fast aerial launch",
		tip: "Na murawie z prędkością — skocz → boost → 2. skok. Sprawdź: czy kickoff/W nie robi flipa zamiast aeriala.",
		build: () => ({
			car: {
				x: 0,
				y: PLAYFIELD_SURFACE_Y + 0.55,
				z: -28,
				yawY: 0,
				vel: { x: 0, y: 0, z: 22 },
				boost: 1,
				jumpCount: 0,
				grounded: true,
			},
			ball: {
				x: 0.2,
				y: 8.5,
				z: 8,
				vel: { x: 0, y: -0.5, z: -2 },
			},
		}),
	},
	{
		id: "lob_pop_midfield",
		label: "7 · Lob pop (backward flip)",
		tip: "Midfield — skok + backward dodge w piłkę. Sprawdź: pop Y > 1.85 m.",
		build: () => ({
			car: {
				x: 0,
				y: PLAYFIELD_SURFACE_Y + 0.55,
				z: -10,
				yawY: 0,
				vel: { x: 0, y: 0, z: 14 },
				boost: 0.85,
				jumpCount: 0,
				grounded: true,
			},
			ball: {
				x: 0,
				y: PLAYFIELD_SURFACE_Y + 0.55,
				z: -5.5,
				vel: { x: 0, y: 0, z: 0 },
			},
		}),
	},
] as const;
