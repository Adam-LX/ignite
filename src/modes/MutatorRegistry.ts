import * as THREE from "three";

import embeddedMutators from "../../public/assets/content/weekly-mutators.json";
import type GameObject from "../GameObject";
import { assetUrl } from "../util/assetUrl";

export type MutatorBallShape = "sphere" | "cube";

export type MutatorEffects = {
	ballShape?: MutatorBallShape;
	ballScaleMul?: number;
	ballSpeedMul?: number;
	carGravityMul?: number;
	boostRegenMul?: number;
	boostForceMul?: number;
};

export type WeeklyMutatorDef = {
	id: string;
	nameKey: string;
	descKey: string;
	effects: MutatorEffects;
};

export type WeeklyMutatorsCatalog = {
	schemaVersion: number;
	mutators: WeeklyMutatorDef[];
};

const CATALOG_URL = assetUrl("/assets/content/weekly-mutators.json");

const FALLBACK: WeeklyMutatorsCatalog = normalizeCatalog(embeddedMutators) ?? {
	schemaVersion: 1,
	mutators: [
		{
			id: "doubleBoost",
			nameKey: "mutator.doubleBoost.name",
			descKey: "mutator.doubleBoost.desc",
			effects: { boostRegenMul: 2 },
		},
	],
};

let cached: WeeklyMutatorsCatalog | null = null;

function asFiniteMul(raw: unknown, fallback = 1): number {
	const n = typeof raw === "number" ? raw : Number(raw);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return n;
}

function normalizeEffects(raw: unknown): MutatorEffects {
	if (!raw || typeof raw !== "object") return {};
	const e = raw as Record<string, unknown>;
	const out: MutatorEffects = {};
	if (e.ballShape === "cube" || e.ballShape === "sphere") {
		out.ballShape = e.ballShape;
	}
	if (e.ballScaleMul != null) out.ballScaleMul = asFiniteMul(e.ballScaleMul);
	if (e.ballSpeedMul != null) out.ballSpeedMul = asFiniteMul(e.ballSpeedMul);
	if (e.carGravityMul != null) out.carGravityMul = asFiniteMul(e.carGravityMul);
	if (e.boostRegenMul != null) out.boostRegenMul = asFiniteMul(e.boostRegenMul);
	if (e.boostForceMul != null) out.boostForceMul = asFiniteMul(e.boostForceMul);
	return out;
}

function normalizeCatalog(raw: unknown): WeeklyMutatorsCatalog | null {
	if (!raw || typeof raw !== "object") return null;
	const data = raw as Record<string, unknown>;
	if (!Array.isArray(data.mutators) || data.mutators.length === 0) return null;
	const mutators: WeeklyMutatorDef[] = [];
	for (const entry of data.mutators) {
		if (!entry || typeof entry !== "object") continue;
		const m = entry as Record<string, unknown>;
		if (typeof m.id !== "string" || !m.id) continue;
		if (typeof m.nameKey !== "string" || typeof m.descKey !== "string") continue;
		mutators.push({
			id: m.id,
			nameKey: m.nameKey,
			descKey: m.descKey,
			effects: normalizeEffects(m.effects),
		});
	}
	if (mutators.length === 0) return null;
	return {
		schemaVersion:
			typeof data.schemaVersion === "number" ? data.schemaVersion : 1,
		mutators,
	};
}

export function getMutatorsCatalogSync(): WeeklyMutatorsCatalog {
	return cached ?? FALLBACK;
}

export async function loadMutatorsCatalog(): Promise<WeeklyMutatorsCatalog> {
	if (cached) return cached;
	try {
		const res = await fetch(CATALOG_URL);
		if (res.ok) {
			const parsed = normalizeCatalog(await res.json());
			if (parsed) {
				cached = parsed;
				return cached;
			}
		}
	} catch {
		/* offline / file:// — fallback */
	}
	cached = FALLBACK;
	return cached;
}

/** ISO week key shared by all clients in the same calendar week (UTC). */
export function isoWeekKey(date: Date = new Date()): string {
	const utc = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);
	const day = utc.getUTCDay() || 7;
	utc.setUTCDate(utc.getUTCDate() + 4 - day);
	const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
	const week = Math.ceil(
		((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
	);
	return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Deterministic index from week key — same build week → same mutator. */
export function mutatorIndexForWeek(
	weekKey: string,
	count: number,
	seed = 0,
): number {
	if (count <= 0) return 0;
	let hash = seed >>> 0;
	for (let i = 0; i < weekKey.length; i++) {
		hash = (Math.imul(hash ^ weekKey.charCodeAt(i), 0x5bd1e995) >>> 0) + i;
	}
	return hash % count;
}

export function getWeeklyMutator(
	date: Date = new Date(),
	catalog: WeeklyMutatorsCatalog = getMutatorsCatalogSync(),
): WeeklyMutatorDef {
	const list = catalog.mutators;
	const week = isoWeekKey(date);
	const idx = mutatorIndexForWeek(week, list.length);
	return list[idx]!;
}

export function getWeeklyMutatorId(date?: Date): string {
	return getWeeklyMutator(date).id;
}

const CUBE_CHILD = "igniteMutatorCubeBall";

type BallMutatorBackup = {
	scale: THREE.Vector3;
	hidden: THREE.Object3D[];
	cube: THREE.Object3D | null;
};

let ballBackup: BallMutatorBackup | null = null;

/** Apply visual mutator effects to the shared match ball (restored on clear). */
export function applyMutatorBallVisual(
	ball: GameObject,
	effects: MutatorEffects,
	ballRadius: number,
): void {
	clearMutatorBallVisual(ball);

	const group = ball.threeJSGroup;
	ballBackup = {
		scale: group.scale.clone(),
		hidden: [],
		cube: null,
	};

	const scaleMul = effects.ballScaleMul ?? 1;
	if (scaleMul !== 1) {
		group.scale.multiplyScalar(scaleMul);
	}

	if (effects.ballShape === "cube") {
		const size = ballRadius * 2 * (scaleMul === 1 ? 1 : 1);
		group.traverse((child: THREE.Object3D) => {
			if (child instanceof THREE.Mesh && child.name !== CUBE_CHILD) {
				child.visible = false;
				ballBackup!.hidden.push(child);
			}
		});
		const cube = new THREE.Mesh(
			new THREE.BoxGeometry(size, size, size),
			new THREE.MeshStandardMaterial({
				color: 0xffc14a,
				metalness: 0.35,
				roughness: 0.4,
				emissive: 0x4a2800,
				emissiveIntensity: 0.35,
			}),
		);
		cube.name = CUBE_CHILD;
		cube.castShadow = true;
		group.add(cube);
		ballBackup.cube = cube;
	}
}

export function clearMutatorBallVisual(ball: GameObject | null): void {
	if (!ballBackup) return;
	const group = ball?.threeJSGroup;
	if (group) {
		group.scale.copy(ballBackup.scale);
		for (const mesh of ballBackup.hidden) {
			mesh.visible = true;
		}
		if (ballBackup.cube) {
			group.remove(ballBackup.cube);
			ballBackup.cube.traverse((obj) => {
				if (obj instanceof THREE.Mesh) {
					obj.geometry.dispose();
					const mat = obj.material;
					if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
					else mat.dispose();
				}
			});
		}
	}
	ballBackup = null;
}

/** Runtime multipliers applied each tick while the mutator is active. */
export function resolveMutatorTickEffects(effects: MutatorEffects): {
	ballSpeedMul: number;
	carGravityMul: number;
	boostRegenMul: number;
	boostForceMul: number;
} {
	return {
		ballSpeedMul: effects.ballSpeedMul ?? 1,
		carGravityMul: effects.carGravityMul ?? 1,
		boostRegenMul: effects.boostRegenMul ?? 1,
		boostForceMul: effects.boostForceMul ?? 1,
	};
}

/** Test helper — reset fetch cache. */
export function resetMutatorsCatalogForTests(): void {
	cached = null;
}
