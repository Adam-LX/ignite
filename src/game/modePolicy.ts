import type { GameModeId } from "./modes";

/** Keep in sync with `MATCH_RULES.durationSec` in modes.ts — avoid import cycle. */
const CORE_MATCH_SEC = 300;
const EXPERIMENTAL_MATCH_SEC = 7 * 60;

export type ModeFamily = "coreSoccar" | "experimental" | "lab";

export type ModeFeatures = {
	/** Rumble-style power-ups (Ignition FFA only in core playlists). */
	powerUps: boolean;
	/** Periodic rush phases — faster ball, boost regen. */
	ignitionRush: boolean;
	/** Team charge bar → short overcharge window. */
	teamOvercharge: boolean;
	/** Field zones with temporary buffs. */
	ignitionZones: boolean;
	/** Body style affects handling (v0.8+). */
	bodyTraits: boolean;
	/** Weekly rotating mutator rules. */
	weeklyMutator: boolean;
	/** Sphere possession — no goals, score while ball on opp half. */
	meridian: boolean;
};

export type ModePolicy = {
	family: ModeFamily;
	features: ModeFeatures;
	matchDurationSec: number;
	/** Show “experimental” badge in menu. */
	experimentalBadge: boolean;
};

const CORE_FEATURES: ModeFeatures = {
	powerUps: false,
	ignitionRush: false,
	teamOvercharge: false,
	ignitionZones: false,
	bodyTraits: false,
	weeklyMutator: false,
	meridian: false,
};

const FFA_IGNITION_FEATURES: ModeFeatures = {
	powerUps: true,
	ignitionRush: false,
	teamOvercharge: false,
	ignitionZones: false,
	bodyTraits: false,
	weeklyMutator: false,
	meridian: false,
};

const EXPERIMENTAL_SOCcar_FEATURES: ModeFeatures = {
	powerUps: false,
	ignitionRush: true,
	teamOvercharge: true,
	ignitionZones: true,
	bodyTraits: true,
	weeklyMutator: false,
	meridian: false,
};

const MERIDIAN_FEATURES: ModeFeatures = {
	powerUps: false,
	ignitionRush: false,
	teamOvercharge: false,
	ignitionZones: false,
	bodyTraits: false,
	weeklyMutator: false,
	meridian: true,
};

const LAB_FEATURES: ModeFeatures = {
	...EXPERIMENTAL_SOCcar_FEATURES,
	weeklyMutator: true,
};

const POLICIES: Record<GameModeId, ModePolicy> = {
	"1v1": {
		family: "coreSoccar",
		features: CORE_FEATURES,
		matchDurationSec: CORE_MATCH_SEC,
		experimentalBadge: false,
	},
	"2v2": {
		family: "coreSoccar",
		features: CORE_FEATURES,
		matchDurationSec: CORE_MATCH_SEC,
		experimentalBadge: false,
	},
	"3v3": {
		family: "coreSoccar",
		features: CORE_FEATURES,
		matchDurationSec: CORE_MATCH_SEC,
		experimentalBadge: false,
	},
	"4v4": {
		family: "coreSoccar",
		features: CORE_FEATURES,
		matchDurationSec: CORE_MATCH_SEC,
		experimentalBadge: false,
	},
	ignitionRush2v2: {
		family: "experimental",
		features: EXPERIMENTAL_SOCcar_FEATURES,
		matchDurationSec: EXPERIMENTAL_MATCH_SEC,
		experimentalBadge: true,
	},
	ignition1v1: {
		family: "experimental",
		features: FFA_IGNITION_FEATURES,
		matchDurationSec: CORE_MATCH_SEC,
		experimentalBadge: true,
	},
	ignition: {
		family: "experimental",
		features: FFA_IGNITION_FEATURES,
		matchDurationSec: CORE_MATCH_SEC,
		experimentalBadge: true,
	},
	weeklyLab2v2: {
		family: "lab",
		features: LAB_FEATURES,
		matchDurationSec: EXPERIMENTAL_MATCH_SEC,
		experimentalBadge: true,
	},
	meridian2v2: {
		family: "experimental",
		features: MERIDIAN_FEATURES,
		matchDurationSec: CORE_MATCH_SEC,
		experimentalBadge: true,
	},
};

export type ModeMenuSection = {
	id: ModeFamily;
	titleKey: string;
	modes: GameModeId[];
};

/** Dwa zestawy kart w menu głównym (nie mylić z ModeFamily). */
export type ModeMenuDeck = "core" | "experimental";

export function getModePolicy(mode: GameModeId): ModePolicy {
	return POLICIES[mode];
}

export function getMatchDurationSec(mode: GameModeId): number {
	return getModePolicy(mode).matchDurationSec;
}

export function isExperimentalPlaylistMode(mode: GameModeId): boolean {
	const family = getModePolicy(mode).family;
	return family === "experimental" || family === "lab";
}

export function menuModeSections(): ModeMenuSection[] {
	return [
		{
			id: "coreSoccar",
			titleKey: "menu.playlist.core",
			modes: ["1v1", "2v2", "3v3", "4v4"],
		},
		{
			id: "experimental",
			titleKey: "menu.playlist.experimental",
			modes: ["ignitionRush2v2", "meridian2v2", "ignition1v1", "ignition"],
		},
		{
			id: "lab",
			titleKey: "menu.playlist.lab",
			modes: ["weeklyLab2v2"],
		},
	];
}

/** Flat carousel order — core first, then experimental, then lab. */
export function menuModeOrder(): GameModeId[] {
	return menuModeSections().flatMap((section) => section.modes);
}

export function menuModeSectionsForDeck(deck: ModeMenuDeck): ModeMenuSection[] {
	if (deck === "core") {
		return menuModeSections().filter((section) => section.id === "coreSoccar");
	}
	return menuModeSections().filter(
		(section) => section.id === "experimental" || section.id === "lab",
	);
}

export function menuModeOrderForDeck(deck: ModeMenuDeck): GameModeId[] {
	return menuModeSectionsForDeck(deck).flatMap((section) => section.modes);
}

export function modeMenuDeckForMode(mode: GameModeId): ModeMenuDeck {
	return isExperimentalPlaylistMode(mode) ? "experimental" : "core";
}
