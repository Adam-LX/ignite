import {
	getAllCarIds,
	getDefaultCarId,
	resolveCarId,
} from "./CarCatalog";
import { getEquippedCarId, isCarUnlocked } from "./PlayerInventory";

const STORAGE_KEY = "ignite.teamPit.v1";
export const TEAM_PIT_SLOT_COUNT = 3;

export type TeamPitSlotIndex = 0 | 1 | 2;

export type TeamPitState = {
	/** 3 karoserie na pit (local party preview). */
	slots: [string, string, string];
	focusSlot: TeamPitSlotIndex;
};

function sanitizeCarId(id: unknown, fallback: string): string {
	if (typeof id !== "string" || !id) return fallback;
	const resolved = resolveCarId(id);
	if (!getAllCarIds().includes(resolved)) return fallback;
	if (!isCarUnlocked(resolved)) return fallback;
	return resolved;
}

function defaultState(): TeamPitState {
	const equipped = getEquippedCarId();
	const unlocked = getAllCarIds().filter((id) => isCarUnlocked(id));
	const pick = (i: number) =>
		unlocked[i] ?? unlocked[0] ?? equipped ?? getDefaultCarId();
	return {
		slots: [equipped, pick(1), pick(2)],
		focusSlot: 0,
	};
}

let memoryPit: TeamPitState | null = null;

function readState(): TeamPitState {
	if (memoryPit) return {
		slots: [...memoryPit.slots] as [string, string, string],
		focusSlot: memoryPit.focusSlot,
	};
	const fallback = defaultState();
	if (typeof localStorage === "undefined") return fallback;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return fallback;
		const data = JSON.parse(raw) as Partial<TeamPitState>;
		const slotsRaw = Array.isArray(data.slots) ? data.slots : [];
		const slots: [string, string, string] = [
			sanitizeCarId(slotsRaw[0], fallback.slots[0]),
			sanitizeCarId(slotsRaw[1], fallback.slots[1]),
			sanitizeCarId(slotsRaw[2], fallback.slots[2]),
		];
		const focus =
			data.focusSlot === 1 || data.focusSlot === 2 ? data.focusSlot : 0;
		return { slots, focusSlot: focus };
	} catch {
		return fallback;
	}
}

function writeState(state: TeamPitState): void {
	memoryPit = {
		slots: [...state.slots] as [string, string, string],
		focusSlot: state.focusSlot,
	};
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		/* private mode */
	}
}

export function getTeamPit(): TeamPitState {
	return readState();
}

export function getTeamPitFocusCarId(): string {
	const state = readState();
	return state.slots[state.focusSlot];
}

/** Ustaw karoserię w slocie; slot 0 = auto meczowe gdy syncEquipped. */
export function setTeamPitSlot(
	slot: TeamPitSlotIndex,
	carId: string,
	opts?: { focus?: boolean; syncEquipped?: boolean },
): TeamPitState {
	const state = readState();
	const id = sanitizeCarId(carId, state.slots[slot]);
	state.slots[slot] = id;
	if (opts?.focus !== false) state.focusSlot = slot;
	writeState(state);
	return state;
}

export function setTeamPitFocus(slot: TeamPitSlotIndex): TeamPitState {
	const state = readState();
	state.focusSlot = slot;
	writeState(state);
	return state;
}

/** Po equip głównego auta — trzymaj slot 0 w sync. */
export function syncTeamPitEquippedCar(carId: string): TeamPitState {
	return setTeamPitSlot(0, carId, { focus: true });
}

export function resetTeamPitForTests(): void {
	memoryPit = null;
	if (typeof localStorage !== "undefined") {
		localStorage.removeItem(STORAGE_KEY);
	}
}
