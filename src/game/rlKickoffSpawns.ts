import * as THREE from "three";
import { ArenaRuntime } from "../arena/ArenaRuntime";
import type { CarSpawn, SpawnRole } from "../modes/MatchController";
import { RL_ARENA } from "../visual/arenaConstants";
import { defaultSpawnCenterY } from "../visual/carWheelGround";
import { botDisplayName } from "./botDisplayNames";
import type { GameModeId, ScoringTeam } from "./modes";
import { getModeSpec } from "./modes";

/**
 * Oficjalne pozycje kickoff Rocket League (RLBot wiki useful-game-values).
 * Pole RL: 10240×8192 uu → skalowane do areny Ignite (120×80 m).
 */
const RL_HALF_LENGTH_M = 51.2;
const RL_HALF_WIDTH_M = 40.96;

type RlKickoffSlot = {
	xUu: number;
	zUu: number;
	yawPi: number;
	role: SpawnRole;
};

function scaleRlXZ(xUu: number, zUu: number): { x: number; z: number } {
	const arenaScale = ArenaRuntime.getSpawnScale();
	return {
		x: (xUu / 100) * (RL_ARENA.HALF_WIDTH / RL_HALF_WIDTH_M) * arenaScale,
		z: (zUu / 100) * (RL_ARENA.HALF_LENGTH / RL_HALF_LENGTH_M) * arenaScale,
	};
}

/** Blue — z ujemne, patrzą w stronę centrum (+Z). */
const BLUE_KICKOFF: Record<string, RlKickoffSlot> = {
	rightCorner: {
		xUu: -2048,
		zUu: -2560,
		yawPi: 0.25,
		role: "offensive_corner",
	},
	leftCorner: { xUu: 2048, zUu: -2560, yawPi: 0.75, role: "offensive_corner" },
	backRight: { xUu: -256, zUu: -3840, yawPi: 0.5, role: "defensive" },
	backLeft: { xUu: 256, zUu: -3840, yawPi: 0.5, role: "defensive" },
	farBack: { xUu: 0, zUu: -4608, yawPi: 0.5, role: "center_back" },
};

/** Orange — lustrzane odbicie Z względem blue (pozycja z; yaw patrzy w centrum). */
const ORANGE_KICKOFF: Record<string, RlKickoffSlot> = {
	rightCorner: { xUu: 2048, zUu: 2560, yawPi: -0.75, role: "offensive_corner" },
	leftCorner: { xUu: -2048, zUu: 2560, yawPi: 0.75, role: "offensive_corner" },
	backRight: { xUu: 256, zUu: 3840, yawPi: -0.5, role: "defensive" },
	backLeft: { xUu: -256, zUu: 3840, yawPi: -0.5, role: "defensive" },
	farBack: { xUu: 0, zUu: 4608, yawPi: -0.5, role: "center_back" },
};

/**
 * 1v1 / 2v2 corner: diagonal mirror (blue rightCorner ↔ orange rightCorner),
 * nie ten sam pas X (leftCorner orange = ten sam X co blue right).
 */
const MODE_LAYOUT: Record<1 | 2 | 3 | 4, { blue: string[]; orange: string[] }> =
	{
		1: { blue: ["rightCorner"], orange: ["rightCorner"] },
		2: {
			blue: ["rightCorner", "farBack"],
			orange: ["rightCorner", "farBack"],
		},
		3: {
			blue: ["rightCorner", "leftCorner", "farBack"],
			orange: ["leftCorner", "rightCorner", "farBack"],
		},
		4: {
			blue: ["rightCorner", "leftCorner", "backRight", "backLeft"],
			orange: ["leftCorner", "rightCorner", "backLeft", "backRight"],
		},
	};

function slotToSpawn(
	slot: RlKickoffSlot,
	slotIndex: number,
	team: ScoringTeam,
	teamSlot: number,
	_carHalfHeight: number,
): CarSpawn {
	const { x, z } = scaleRlXZ(slot.xUu, slot.zUu);
	const y = defaultSpawnCenterY();
	const isHuman = team === "blue" && teamSlot === 0;
	const displayName = botDisplayName(team, teamSlot, isHuman);
	return {
		slotIndex,
		team,
		displayName,
		position: new THREE.Vector3(x, y, z),
		yaw: slot.yawPi * Math.PI,
		visualTeam: team,
		spawnRole: slot.role,
	};
}

export function buildRlKickoffSpawns(
	mode: GameModeId,
	carHalfHeight: number,
): CarSpawn[] {
	const spec = getModeSpec(mode);
	const teamSize = spec.teamSize as 1 | 2 | 3 | 4;
	const layout = MODE_LAYOUT[teamSize];
	if (!layout) throw new Error(`Brak layoutu RL kickoff dla ${mode}`);

	const spawns: CarSpawn[] = [];
	let slotIndex = 0;

	for (let i = 0; i < layout.blue.length; i++) {
		const key = layout.blue[i]!;
		const slot = BLUE_KICKOFF[key];
		if (!slot) throw new Error(`Nieznany slot blue: ${key}`);
		spawns.push(slotToSpawn(slot, slotIndex++, "blue", i, carHalfHeight));
	}

	for (let i = 0; i < layout.orange.length; i++) {
		const key = layout.orange[i]!;
		const slot = ORANGE_KICKOFF[key];
		if (!slot) throw new Error(`Nieznany slot orange: ${key}`);
		spawns.push(slotToSpawn(slot, slotIndex++, "orange", i, carHalfHeight));
	}

	return spawns;
}
