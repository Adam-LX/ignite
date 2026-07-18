import {
	getArenaEntry,
	getDefaultArenaId,
	resolveArenaId,
} from "./ArenaCatalog";
import {
	type ArenaDefinition,
	type ArenaDimensions,
	type ArenaPerimeterEdge,
	flattenArenaDimensions,
	getGoalWingX,
	getPerimeterEdgesForDefinition,
	STANDARD_ARENA_DEFINITION,
} from "./ArenaDefinition";

let activeId = getDefaultArenaId();
let activeDefinition: ArenaDefinition = STANDARD_ARENA_DEFINITION;

function syncActive(): void {
	const id = resolveArenaId(activeId);
	activeId = id;
	activeDefinition = getArenaEntry(id) ?? STANDARD_ARENA_DEFINITION;
}

/** Aktywna mapa w runtime — wymiary, obwód, manifest. */
export const ArenaRuntime = {
	setActive(arenaId: string): ArenaDefinition {
		activeId = resolveArenaId(arenaId);
		activeDefinition = getArenaEntry(activeId) ?? STANDARD_ARENA_DEFINITION;
		return activeDefinition;
	},

	getId(): string {
		return activeId;
	},

	get(): ArenaDefinition {
		return activeDefinition;
	},

	getDimensions(): ArenaDimensions {
		return flattenArenaDimensions(activeDefinition.dimensions);
	},

	getPerimeterEdges(): ArenaPerimeterEdge[] {
		return getPerimeterEdgesForDefinition(activeDefinition);
	},

	getGoalWingX(): number {
		return getGoalWingX(this.getDimensions());
	},

	getSpawnScale(): number {
		return activeDefinition.spawns.scaleFromStandard;
	},

	areBoostPadsEnabled(): boolean {
		return activeDefinition.boostPads.enabled;
	},

	getManifestPath(): string {
		return activeDefinition.manifest;
	},
};

/** Inicjalizacja po załadowaniu katalogu. */
export function initArenaRuntime(arenaId?: string): ArenaDefinition {
	if (arenaId) activeId = arenaId;
	syncActive();
	return activeDefinition;
}

/** Reset do standard (testy). */
export function resetArenaRuntime(): void {
	activeId = getDefaultArenaId();
	activeDefinition = STANDARD_ARENA_DEFINITION;
}
