import type * as THREE from "three";
import type { GameModeId, ScoringTeam } from "../game/modes";
import { getModeSpec } from "../game/modes";
import { teamForSlot } from "../net/protocol";
import { getObjectSize } from "../util/ThreeJSHelpers";
import { loadCarModel } from "../visual/carVisuals";
import {
	getAllCarIds,
	getCarEntry,
	getDefaultCarId,
	loadCarCatalog,
	pickRandomCarId,
	resolveCarId,
} from "./CarCatalog";
import { getMatchCarId } from "./duelContract";
import { PlayerInventory } from "./PlayerInventory";

export async function loadTeamCarTemplates(
	humanVisualTeam: ScoringTeam,
): Promise<{
	blueTemplate: THREE.Group;
	orangeTemplate: THREE.Group;
}> {
	const equipped = resolveCarId(PlayerInventory.getEquippedCarId());
	const inv = PlayerInventory.get();
	const carIds = inv.unlocked
		.filter((i) => i.kind === "car")
		.map((i) => i.itemId)
		.filter((id) => getAllCarIds().includes(id));
	const botPool = carIds.length > 0 ? carIds : [getDefaultCarId()];

	const pickBot = (): string => pickRandomCarId(botPool);

	const blueId = humanVisualTeam === "blue" ? equipped : pickBot();
	const orangeId = humanVisualTeam === "orange" ? equipped : pickBot();

	const [blueTemplate, orangeTemplate] = await Promise.all([
		loadCarModel(blueId, "blue"),
		loadCarModel(orangeId, "orange"),
	]);

	return { blueTemplate, orangeTemplate };
}

/** Domyślne szablony (menu preview bez wyposażonego auta gracza). */
export async function loadDefaultCarTemplates(): Promise<{
	blueTemplate: THREE.Group;
	orangeTemplate: THREE.Group;
}> {
	const id = getDefaultCarId();
	const [blueTemplate, orangeTemplate] = await Promise.all([
		loadCarModel(id, "blue"),
		loadCarModel(id, "orange"),
	]);
	return { blueTemplate, orangeTemplate };
}

function visualTeamForSlot(slot: number, mode: GameModeId): ScoringTeam {
	const spec = getModeSpec(mode);
	if (spec.isFFA) {
		return slot % 2 === 0 ? "blue" : "orange";
	}
	return teamForSlot(slot, mode);
}

function shuffleCarIds(ids: string[]): string[] {
	const shuffled = [...ids];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]!] = [shuffled[j]!, shuffled[i]!];
	}
	return shuffled;
}

/** Boty korzystają z pełnego katalogu — nie z odblokowanych aut gracza. */
export function pickBotCarIds(botCount: number, humanCarId: string): string[] {
	const catalog = getAllCarIds().filter((id) => getCarEntry(id));
	if (catalog.length === 0) {
		return Array.from({ length: botCount }, () => getDefaultCarId());
	}

	const shuffled = shuffleCarIds(catalog);
	const picks: string[] = [];

	for (let i = 0; i < botCount; i++) {
		if (i < shuffled.length) {
			picks.push(shuffled[i]!);
			continue;
		}
		let id = shuffled[i % shuffled.length]!;
		if (catalog.length > 1 && id === picks[i - 1]) {
			const alt = shuffled[(i + 1) % shuffled.length]!;
			id = alt !== picks[i - 1] ? alt : shuffled[(i + 2) % shuffled.length]!;
		}
		picks.push(id);
	}

	if (catalog.length > 1 && botCount === 1 && picks[0] === humanCarId) {
		picks[0] = shuffled.find((id) => id !== humanCarId) ?? picks[0]!;
	}

	return picks;
}

export type MatchCarTemplateOpts = {
	/** Nadpisania carId z lobby (ludzie + boty z serwera). */
	carIdBySlot?: ReadonlyMap<number, string>;
	/** Sloty ludzi — lokalny humanSlot dostaje equipped jeśli brak override. */
	humanSlots?: ReadonlySet<number>;
};

/** Osobny model auta na każdy slot — gracz ma equipped, boty losują / lobby. */
export async function loadMatchCarTemplates(
	mode: GameModeId,
	humanSlot: number,
	opts?: MatchCarTemplateOpts,
): Promise<Map<number, THREE.Group>> {
	await loadCarCatalog();
	const spec = getModeSpec(mode);
	const humanCarId = resolveCarId(getMatchCarId());
	const overrides = opts?.carIdBySlot;
	const humanSlots = opts?.humanSlots ?? new Set([humanSlot]);

	const botSlots = Array.from({ length: spec.playerCount }, (_, slot) => slot).filter(
		(slot) => !humanSlots.has(slot),
	);
	const botCarIds = pickBotCarIds(botSlots.length, humanCarId);

	const carIdBySlot = new Map<number, string>();
	for (let slot = 0; slot < spec.playerCount; slot++) {
		const fromLobby = overrides?.get(slot);
		if (fromLobby) {
			carIdBySlot.set(slot, resolveCarId(fromLobby));
			continue;
		}
		if (slot === humanSlot) {
			carIdBySlot.set(slot, humanCarId);
			continue;
		}
		if (humanSlots.has(slot)) {
			carIdBySlot.set(slot, getDefaultCarId());
			continue;
		}
		const botIdx = botSlots.indexOf(slot);
		carIdBySlot.set(slot, botCarIds[botIdx] ?? getDefaultCarId());
	}

	console.info(
		`[Ignite] Auta meczu (gracz=${humanCarId}):`,
		[...carIdBySlot.entries()]
			.sort(([a], [b]) => a - b)
			.map(([slot, carId]) => `slot ${slot}=${carId}`)
			.join(", "),
	);
	if (!getCarEntry(humanCarId)) {
		console.error(`[Ignite] Brak katalogu dla auta gracza: ${humanCarId}`);
	}

	const entries = await Promise.all(
		[...carIdBySlot.entries()].map(async ([slot, carId]) => {
			const team = visualTeamForSlot(slot, mode);
			const template = await loadCarModel(carId, team);
			return [slot, template] as const;
		}),
	);

	return new Map(entries);
}

export function maxCarHalfHeight(templates: Iterable<THREE.Group>): number {
	let max = 0;
	for (const template of templates) {
		max = Math.max(max, getObjectSize(template).y * 0.5);
	}
	return max;
}
