import {
	getAllArenaIds,
	getArenaCatalogSync,
	getDefaultArenaId,
} from "../arena/ArenaCatalog";
import {
	getAllCarIds,
	getCarCatalogSync,
	getCarEntry,
	getDefaultCarId,
	getDefaultWheelIdForCar,
	resolveCarId,
} from "./CarCatalog";
import {
	ALL_COSMETIC_KINDS,
	CAR_BODY_COSMETIC_KINDS,
	getItemCatalogSync,
	instanceKey,
	isCarBodyCosmeticKind,
	listCatalogIds,
	makeCosmeticRef,
	type CarBodyCosmeticKind,
	type CosmeticInstance,
	type CosmeticKind,
	type CosmeticRef,
	type ItemProvenance,
} from "./CosmeticCatalog";

const STORAGE_KEY = "ignite.inventory.v6";
export const INVENTORY_SCHEMA_VERSION = 6;
const LEGACY_V5_KEY = "ignite.inventory.v5";
const LEGACY_V4_KEY = "ignite.inventory.v4";
const LEGACY_V3_KEY = "ignite.inventory.v3";
const LEGACY_V2_KEY = "ignite.inventory.v2";
const LEGACY_V1_KEY = "ignite.inventory.v1";

export type EquippedSlot = { itemId: string; paintId: string | null };

export type CarBodyLoadout = Record<CarBodyCosmeticKind, EquippedSlot>;

export type PlayerInventoryData = {
	schemaVersion: 6;
	unlocked: CosmeticInstance[];
	equipped: Record<CosmeticKind, EquippedSlot>;
	/** Felgi / topper / decal per auto — jak preset w RL. */
	carBody: Record<string, CarBodyLoadout>;
	newInstances: string[];
	matchesSinceDrop: number;
	/** Optional BO3 duel challenge (v0.11) — ignored by older builds. */
	duelContract?: {
		weekKey: string;
		carId: string;
		wins: number;
		losses: number;
		status: "active" | "won" | "lost";
		rewardKey?: string;
	} | null;
};

let garageCustomizeCarId: string | null = null;

export function setGarageCustomizeCarId(carId: string | null): void {
	garageCustomizeCarId = carId ? resolveCarId(carId) : null;
}

/** Auto edytowane w garażu (podgląd + zakładki kół itd.). */
export function getGarageCustomizeCarId(): string {
	return garageCustomizeCarId ?? getEquippedCarId();
}

function defaultCarBodyLoadout(): CarBodyLoadout {
	return {
		wheel: { itemId: "default", paintId: null },
		topper: { itemId: "default", paintId: null },
		decal: { itemId: "default", paintId: null },
	};
}

function buildDefaultCarBodyMap(
	seed?: Partial<CarBodyLoadout>,
): Record<string, CarBodyLoadout> {
	const base = { ...defaultCarBodyLoadout(), ...seed };
	const out: Record<string, CarBodyLoadout> = {};
	for (const carId of getAllCarIds()) {
		out[carId] = {
			wheel: { ...base.wheel },
			topper: { ...base.topper },
			decal: { ...base.decal },
		};
	}
	return out;
}

function ensureCarBody(
	inv: PlayerInventoryData,
	carId: string,
): CarBodyLoadout {
	const id = resolveCarId(carId);
	if (!inv.carBody[id]) {
		inv.carBody[id] = defaultCarBodyLoadout();
	}
	return inv.carBody[id];
}

function withDefaultProvenance(ref: CosmeticRef): CosmeticInstance {
	return {
		...ref,
		provenance: { source: "default", unlockedAt: Date.now() },
	};
}

function defaultUnlockedCars(): CosmeticInstance[] {
	return getCarCatalogSync()
		.cars.filter((c) => c.defaultUnlocked)
		.map((c) => withDefaultProvenance(makeCosmeticRef("car", c.id, null)));
}

function defaultUnlockedArenas(): CosmeticInstance[] {
	return getArenaCatalogSync()
		.arenas.filter((a) => a.defaultUnlocked)
		.map((a) => withDefaultProvenance(makeCosmeticRef("arena", a.id, null)));
}

function defaultUnlockedForKind(kind: CosmeticKind): CosmeticInstance[] {
	if (kind === "car") return defaultUnlockedCars();
	if (kind === "arena") return defaultUnlockedArenas();
	const catalog = getItemCatalogSync();
	const list =
		kind === "trail"
			? catalog.trails
			: kind === "wheel"
				? catalog.wheels
				: kind === "topper"
					? catalog.toppers
					: kind === "decal"
						? catalog.decals
						: catalog.goalExplosions;
	return list
		.filter((e) => e.defaultUnlocked)
		.map((e) => withDefaultProvenance(makeCosmeticRef(kind, e.id, null)));
}

function defaultEquipped(): Record<CosmeticKind, EquippedSlot> {
	const cars = defaultUnlockedCars();
	const arenas = defaultUnlockedArenas();
	return {
		car: { itemId: cars[0]?.itemId ?? getDefaultCarId(), paintId: null },
		arena: { itemId: arenas[0]?.itemId ?? getDefaultArenaId(), paintId: null },
		trail: { itemId: "default", paintId: null },
		wheel: { itemId: "default", paintId: null },
		topper: { itemId: "default", paintId: null },
		decal: { itemId: "default", paintId: null },
		goalExplosion: { itemId: "default", paintId: null },
	};
}

export function createDefaultInventory(): PlayerInventoryData {
	const unlocked: CosmeticInstance[] = [];
	for (const kind of ALL_COSMETIC_KINDS) {
		unlocked.push(...defaultUnlockedForKind(kind));
	}
	return finalizeInventory({
		schemaVersion: INVENTORY_SCHEMA_VERSION,
		unlocked,
		equipped: defaultEquipped(),
		carBody: buildDefaultCarBodyMap(),
		newInstances: [],
		matchesSinceDrop: 0,
	});
}

function mergeDefaultInstances(list: CosmeticInstance[]): CosmeticInstance[] {
	const out = [...list];
	const seen = new Set(out.map(instanceKey));
	for (const kind of ALL_COSMETIC_KINDS) {
		for (const inst of defaultUnlockedForKind(kind)) {
			const key = instanceKey(inst);
			if (!seen.has(key)) {
				out.push(inst);
				seen.add(key);
			}
		}
	}
	return out;
}

function migrateV3(raw: Record<string, unknown>): PlayerInventoryData {
	const base = createDefaultInventory();
	const unlocked: CosmeticInstance[] = [];

	if (raw.unlocked && typeof raw.unlocked === "object") {
		for (const kind of ALL_COSMETIC_KINDS) {
			const ids = (raw.unlocked as Record<string, unknown>)[kind];
			if (!Array.isArray(ids)) continue;
			const valid = new Set(listCatalogIds(kind));
			for (const id of ids) {
				const itemId = String(id);
				if (valid.has(itemId)) {
					unlocked.push(makeCosmeticRef(kind, itemId, null));
				}
			}
		}
	}

	base.unlocked = mergeDefaultInstances(unlocked);

	if (raw.equipped && typeof raw.equipped === "object") {
		for (const kind of ALL_COSMETIC_KINDS) {
			const eq = (raw.equipped as Record<string, unknown>)[kind];
			if (typeof eq === "string") {
				base.equipped[kind] = { itemId: eq, paintId: null };
			}
		}
	}

	if (raw.newIds && typeof raw.newIds === "object") {
		const newInstances: string[] = [];
		for (const kind of ALL_COSMETIC_KINDS) {
			const ids = (raw.newIds as Record<string, unknown>)[kind];
			if (!Array.isArray(ids)) continue;
			for (const id of ids) {
				newInstances.push(instanceKey(makeCosmeticRef(kind, String(id), null)));
			}
		}
		base.newInstances = newInstances;
	}

	base.matchesSinceDrop =
		typeof raw.matchesSinceDrop === "number" && raw.matchesSinceDrop >= 0
			? Math.floor(raw.matchesSinceDrop)
			: 0;

	return sanitizeInventory(base);
}

function migrateV2(raw: Record<string, unknown>): PlayerInventoryData {
	const v3Like: Record<string, unknown> = {
		schemaVersion: 3,
		unlocked: {
			car: [],
			arena: [],
			trail: [],
			wheel: [],
			topper: [],
			decal: [],
			goalExplosion: [],
		},
		equipped: {},
		newIds: {},
		matchesSinceDrop: raw.matchesSinceDrop,
	};

	const validCars = new Set(getAllCarIds());
	const validArenas = new Set(getAllArenaIds());

	const unlockedCars = Array.isArray(raw.unlockedCarIds)
		? raw.unlockedCarIds.filter((id) => validCars.has(String(id)))
		: defaultUnlockedCars().map((i) => i.itemId);
	for (const id of defaultUnlockedCars().map((i) => i.itemId)) {
		if (!unlockedCars.includes(id)) unlockedCars.push(id);
	}

	const unlockedArenas = Array.isArray(raw.unlockedArenaIds)
		? raw.unlockedArenaIds.filter((id) => validArenas.has(String(id)))
		: defaultUnlockedArenas().map((i) => i.itemId);
	for (const id of defaultUnlockedArenas().map((i) => i.itemId)) {
		if (!unlockedArenas.includes(id)) unlockedArenas.push(id);
	}

	(v3Like.unlocked as Record<string, string[]>).car = unlockedCars.map(String);
	(v3Like.unlocked as Record<string, string[]>).arena =
		unlockedArenas.map(String);

	if (Array.isArray(raw.unlockedTrailIds)) {
		(v3Like.unlocked as Record<string, string[]>).trail =
			raw.unlockedTrailIds.map(String);
	}

	(v3Like.equipped as Record<string, string>).car =
		typeof raw.equippedCarId === "string" ? raw.equippedCarId : "octane";
	(v3Like.equipped as Record<string, string>).arena =
		typeof raw.equippedArenaId === "string"
			? raw.equippedArenaId
			: getDefaultArenaId();
	if (typeof raw.equippedTrailId === "string") {
		(v3Like.equipped as Record<string, string>).trail = raw.equippedTrailId;
	}

	return migrateV3(v3Like);
}

function sanitizeProvenance(raw: unknown): ItemProvenance {
	if (!raw || typeof raw !== "object") {
		return { source: "unknown" };
	}
	const data = raw as Record<string, unknown>;
	const source =
		data.source === "default" ||
		data.source === "match_drop" ||
		data.source === "duel_contract" ||
		data.source === "dev" ||
		data.source === "unknown"
			? data.source
			: "unknown";
	const out: ItemProvenance = { source };
	if (typeof data.arenaId === "string" && data.arenaId) {
		out.arenaId = data.arenaId;
	}
	if (typeof data.season === "string" && data.season) {
		out.season = data.season;
	}
	if (typeof data.unlockedAt === "number" && Number.isFinite(data.unlockedAt)) {
		out.unlockedAt = data.unlockedAt;
	}
	return out;
}

function sanitizeInventory(raw: unknown): PlayerInventoryData {
	const base = createDefaultInventory();
	if (!raw || typeof raw !== "object") return base;

	const data = raw as Record<string, unknown>;
	if (data.schemaVersion === 2 || data.schemaVersion === 1) {
		return migrateV2(data);
	}
	if (data.schemaVersion === 3) {
		return migrateV3(data);
	}

	const validByKind = Object.fromEntries(
		ALL_COSMETIC_KINDS.map((k) => [k, new Set(listCatalogIds(k))]),
	) as Record<CosmeticKind, Set<string>>;

	const unlocked: CosmeticInstance[] = [];
	if (Array.isArray(data.unlocked)) {
		for (const entry of data.unlocked) {
			if (!entry || typeof entry !== "object") continue;
			const inst = entry as CosmeticInstance;
			if (!ALL_COSMETIC_KINDS.includes(inst.kind)) continue;
			if (!validByKind[inst.kind].has(inst.itemId)) continue;
			if (inst.kind === "arena" && inst.paintId) continue;
			const hadProvenance =
				"provenance" in (entry as object) &&
				(entry as CosmeticInstance).provenance != null;
			unlocked.push({
				kind: inst.kind,
				itemId: inst.itemId,
				paintId: inst.paintId ?? null,
				provenance: hadProvenance
					? sanitizeProvenance(inst.provenance)
					: { source: "unknown" },
			});
		}
	}

	const equipped = { ...base.equipped };
	if (data.equipped && typeof data.equipped === "object") {
		for (const kind of ALL_COSMETIC_KINDS) {
			const slot = (data.equipped as Record<string, unknown>)[kind];
			if (!slot || typeof slot !== "object") continue;
			const s = slot as EquippedSlot;
			if (typeof s.itemId !== "string") continue;
			if (!validByKind[kind].has(s.itemId)) continue;
			equipped[kind] = {
				itemId: s.itemId,
				paintId: kind === "arena" ? null : (s.paintId ?? null),
			};
		}
	}

	const merged = mergeDefaultInstances(unlocked);
	const unlockedKeys = new Set(merged.map(instanceKey));

	for (const kind of ALL_COSMETIC_KINDS) {
		const slot = equipped[kind];
		if (!isEquippedSlotOwned(kind, slot, unlockedKeys, merged)) {
			const fallback = merged.find((i) => i.kind === kind);
			if (fallback) {
				equipped[kind] = {
					itemId: fallback.itemId,
					paintId: fallback.paintId,
				};
			}
		}
	}

	const carBody = mergeCarBodyCatalog(parseCarBodyMap(data.carBody, equipped));

	const newInstances = Array.isArray(data.newInstances)
		? data.newInstances
				.filter((k) => typeof k === "string" && unlockedKeys.has(k))
				.map(String)
		: [];

	return finalizeInventory({
		schemaVersion: INVENTORY_SCHEMA_VERSION,
		unlocked: merged,
		equipped,
		carBody,
		newInstances,
		matchesSinceDrop:
			typeof data.matchesSinceDrop === "number" && data.matchesSinceDrop >= 0
				? Math.floor(data.matchesSinceDrop)
				: 0,
		duelContract: sanitizeDuelContractField(data.duelContract),
	});
}

function sanitizeDuelContractField(
	raw: unknown,
): PlayerInventoryData["duelContract"] {
	if (raw == null) return undefined;
	if (!raw || typeof raw !== "object") return undefined;
	const d = raw as Record<string, unknown>;
	if (typeof d.weekKey !== "string" || typeof d.carId !== "string") {
		return undefined;
	}
	if (d.status !== "active" && d.status !== "won" && d.status !== "lost") {
		return undefined;
	}
	return {
		weekKey: d.weekKey,
		carId: d.carId,
		wins:
			typeof d.wins === "number" && d.wins >= 0 ? Math.floor(d.wins) : 0,
		losses:
			typeof d.losses === "number" && d.losses >= 0
				? Math.floor(d.losses)
				: 0,
		status: d.status,
		rewardKey: typeof d.rewardKey === "string" ? d.rewardKey : undefined,
	};
}

function mergeCarBodyCatalog(
	carBody: Record<string, CarBodyLoadout>,
): Record<string, CarBodyLoadout> {
	const out: Record<string, CarBodyLoadout> = { ...carBody };
	for (const carId of getAllCarIds()) {
		if (!out[carId]) {
			out[carId] = defaultCarBodyLoadout();
		}
	}
	return out;
}

/** Karoseria: unlock jest na itemId (paint=null); equipped może mieć paint. */
function isEquippedSlotOwned(
	kind: CosmeticKind,
	slot: EquippedSlot,
	unlockedKeys: Set<string>,
	unlocked: CosmeticInstance[],
): boolean {
	const exact = instanceKey(makeCosmeticRef(kind, slot.itemId, slot.paintId));
	if (unlockedKeys.has(exact)) return true;
	const base = instanceKey(makeCosmeticRef(kind, slot.itemId, null));
	if (unlockedKeys.has(base)) return true;
	return unlocked.some((i) => i.kind === kind && i.itemId === slot.itemId);
}

/** Lustrzane pola equipped.wheel/topper/decal = loadout auta na mecz. */
function syncLegacyEquippedMirrors(inv: PlayerInventoryData): void {
	const matchCar = resolveCarId(inv.equipped.car.itemId);
	const body = inv.carBody[matchCar] ?? defaultCarBodyLoadout();
	for (const kind of CAR_BODY_COSMETIC_KINDS) {
		inv.equipped[kind] = { ...body[kind] };
	}
}

function finalizeInventory(inv: PlayerInventoryData): PlayerInventoryData {
	inv.schemaVersion = INVENTORY_SCHEMA_VERSION;
	inv.carBody = mergeCarBodyCatalog(inv.carBody);
	syncLegacyEquippedMirrors(inv);
	return inv;
}

function parseCarBodyMap(
	raw: unknown,
	globalEquipped: Record<CosmeticKind, EquippedSlot>,
): Record<string, CarBodyLoadout> {
	const seed: Partial<CarBodyLoadout> = {
		wheel: { ...globalEquipped.wheel },
		topper: { ...globalEquipped.topper },
		decal: { ...globalEquipped.decal },
	};
	const out = buildDefaultCarBodyMap(seed);
	if (!raw || typeof raw !== "object") return out;

	const validByKind = Object.fromEntries(
		CAR_BODY_COSMETIC_KINDS.map((k) => [k, new Set(listCatalogIds(k))]),
	) as Record<CarBodyCosmeticKind, Set<string>>;

	for (const [carId, bodyRaw] of Object.entries(raw as Record<string, unknown>)) {
		if (!getAllCarIds().includes(carId)) continue;
		if (!bodyRaw || typeof bodyRaw !== "object") continue;
		const slot = out[carId] ?? defaultCarBodyLoadout();
		for (const kind of CAR_BODY_COSMETIC_KINDS) {
			const kindRaw = (bodyRaw as Record<string, unknown>)[kind];
			if (!kindRaw || typeof kindRaw !== "object") continue;
			const s = kindRaw as EquippedSlot;
			if (typeof s.itemId !== "string") continue;
			if (!validByKind[kind].has(s.itemId)) continue;
			slot[kind] = {
				itemId: s.itemId,
				paintId: s.paintId ?? null,
			};
		}
		out[carId] = slot;
	}
	return out;
}

let memoryFallback: PlayerInventoryData | null = null;

function writeStorage(data: PlayerInventoryData): void {
	const clean = finalizeInventory(sanitizeInventory(data));
	memoryFallback = cloneInv(clean);
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
	} catch {
		/* private mode */
	}
}

function readStorage(): PlayerInventoryData {
	if (memoryFallback) return cloneInv(memoryFallback);
	if (typeof localStorage === "undefined") {
		memoryFallback = createDefaultInventory();
		return cloneInv(memoryFallback);
	}
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			const v5 = localStorage.getItem(LEGACY_V5_KEY);
			if (v5) return sanitizeInventory(JSON.parse(v5));
			const v4 = localStorage.getItem(LEGACY_V4_KEY);
			if (v4) return sanitizeInventory(JSON.parse(v4));
			const v3 = localStorage.getItem(LEGACY_V3_KEY);
			if (v3) return sanitizeInventory(JSON.parse(v3));
			const v2 = localStorage.getItem(LEGACY_V2_KEY);
			if (v2) return sanitizeInventory(JSON.parse(v2));
			const v1 = localStorage.getItem(LEGACY_V1_KEY);
			if (v1) return sanitizeInventory(JSON.parse(v1));
			return createDefaultInventory();
		}
		return sanitizeInventory(JSON.parse(raw));
	} catch {
		return createDefaultInventory();
	}
}

function cloneInv(data: PlayerInventoryData): PlayerInventoryData {
	return {
		...data,
		unlocked: data.unlocked.map((i) => ({
			...i,
			provenance: i.provenance ? { ...i.provenance } : undefined,
		})),
		equipped: Object.fromEntries(
			ALL_COSMETIC_KINDS.map((k) => [
				k,
				{ ...data.equipped[k] },
			]),
		) as Record<CosmeticKind, EquippedSlot>,
		carBody: Object.fromEntries(
			Object.entries(data.carBody).map(([carId, body]) => [
				carId,
				{
					wheel: { ...body.wheel },
					topper: { ...body.topper },
					decal: { ...body.decal },
				},
			]),
		),
		newInstances: [...data.newInstances],
		duelContract: data.duelContract
			? { ...data.duelContract }
			: data.duelContract,
	};
}

export function getPlayerInventory(): PlayerInventoryData {
	return readStorage();
}

export function savePlayerInventory(data: PlayerInventoryData): void {
	writeStorage(data);
}

export function getUnlockedInstances(kind?: CosmeticKind): CosmeticInstance[] {
	const inv = readStorage();
	if (!kind) return [...inv.unlocked];
	return inv.unlocked.filter((i) => i.kind === kind);
}

export function isInstanceUnlocked(ref: CosmeticRef): boolean {
	const key = instanceKey(ref);
	return readStorage().unlocked.some((i) => instanceKey(i) === key);
}

export function isCosmeticUnlocked(ref: CosmeticRef): boolean {
	return isInstanceUnlocked(ref);
}

export function isCarUnlocked(carId: string): boolean {
	return isInstanceUnlocked(makeCosmeticRef("car", carId, null));
}

export function isArenaUnlocked(arenaId: string): boolean {
	return isInstanceUnlocked(makeCosmeticRef("arena", arenaId, null));
}

export function unlockInstance(
	ref: CosmeticRef,
	markNew = true,
	provenance?: ItemProvenance,
): boolean {
	const inv = readStorage();
	if (isInstanceUnlocked(ref)) return false;
	inv.unlocked.push({
		kind: ref.kind,
		itemId: ref.itemId,
		paintId: ref.paintId ?? null,
		provenance: provenance ?? {
			source: "unknown",
			unlockedAt: Date.now(),
		},
	});
	const key = instanceKey(ref);
	if (markNew && !inv.newInstances.includes(key)) {
		inv.newInstances.push(key);
	}
	writeStorage(inv);
	return true;
}

export function unlockCosmetic(
	ref: CosmeticRef,
	markNew = true,
	provenance?: ItemProvenance,
): boolean {
	return unlockInstance(ref, markNew, provenance);
}

export function getInstanceProvenance(
	ref: CosmeticRef,
): ItemProvenance | undefined {
	const key = instanceKey(ref);
	return readStorage().unlocked.find((i) => instanceKey(i) === key)?.provenance;
}

export function unlockCar(carId: string): boolean {
	if (!carId || !getCarEntry(carId)) return false;
	unlockCosmetic(makeCosmeticRef("car", carId, null), false);
	const inv = readStorage();
	if (!isCarUnlocked(carId)) return false;
	ensureCarBody(inv, carId);
	const bundledWheel = getDefaultWheelIdForCar(carId);
	if (bundledWheel !== "default") {
		unlockInstance(makeCosmeticRef("wheel", bundledWheel, null), false);
	}
	writeStorage(inv);
	return true;
}

export function unlockArena(arenaId: string): boolean {
	return unlockCosmetic(makeCosmeticRef("arena", arenaId, null));
}

export function equipCosmetic(
	ref: CosmeticRef,
	carId?: string | null,
): boolean {
	if (ref.kind === "car") {
		return equipCar(ref.itemId, ref.paintId ?? null);
	}
	if (!isInstanceUnlocked(ref)) return false;
	const inv = readStorage();
	if (isCarBodyCosmeticKind(ref.kind)) {
		const targetCar = resolveCarId(carId ?? getGarageCustomizeCarId());
		const body = ensureCarBody(inv, targetCar);
		body[ref.kind] = {
			itemId: ref.itemId,
			paintId: ref.paintId ?? null,
		};
	} else {
		inv.equipped[ref.kind] = {
			itemId: ref.itemId,
			paintId: ref.paintId ?? null,
		};
	}
	const key = instanceKey(ref);
	inv.newInstances = inv.newInstances.filter((k) => k !== key);
	writeStorage(inv);
	return true;
}

/** Wybór karoserii = aktywne auto w meczu. Odblokowuje z katalogu przy pierwszym wyborze. */
export function equipCar(carId: string, paintId: string | null = null): boolean {
	if (!carId || !getCarEntry(carId)) return false;
	if (!isCarUnlocked(carId)) unlockCar(carId);
	if (!isCarUnlocked(carId)) return false;

	const inv = readStorage();
	inv.equipped.car = { itemId: carId, paintId };
	ensureCarBody(inv, carId);
	const key = instanceKey(makeCosmeticRef("car", carId, paintId));
	const baseKey = instanceKey(makeCosmeticRef("car", carId, null));
	inv.newInstances = inv.newInstances.filter((k) => k !== key && k !== baseKey);
	writeStorage(inv);
	setGarageCustomizeCarId(carId);
	return getEquippedCarId() === carId;
}

export function equipArena(arenaId: string): boolean {
	return equipCosmetic(makeCosmeticRef("arena", arenaId, null));
}

export function getEquippedSlot(
	kind: CosmeticKind,
	carId?: string | null,
): EquippedSlot {
	if (isCarBodyCosmeticKind(kind)) {
		const id = resolveCarId(carId ?? getEquippedCarId());
		const body = readStorage().carBody[id] ?? defaultCarBodyLoadout();
		return { ...body[kind] };
	}
	return { ...readStorage().equipped[kind] };
}

export function getCarBodyLoadout(carId: string): CarBodyLoadout {
	const id = resolveCarId(carId);
	const body = readStorage().carBody[id] ?? defaultCarBodyLoadout();
	return {
		wheel: { ...body.wheel },
		topper: { ...body.topper },
		decal: { ...body.decal },
	};
}

export function getEquippedCosmetic(
	kind: CosmeticKind,
	carId?: string | null,
): CosmeticRef {
	const slot = getEquippedSlot(kind, carId);
	return makeCosmeticRef(kind, slot.itemId, slot.paintId);
}

export function getEquippedCosmeticId(kind: CosmeticKind): string {
	return getEquippedSlot(kind).itemId;
}

export function getEquippedPaintId(
	kind: CosmeticKind,
	carId?: string | null,
): string | null {
	return getEquippedSlot(kind, carId).paintId;
}

export function getEquippedCarId(): string {
	return getEquippedCosmeticId("car");
}

export function getEquippedArenaId(): string {
	return getEquippedCosmeticId("arena");
}

export function getEquippedTrailId(): string {
	return getEquippedCosmeticId("trail");
}

export function getEquippedWheelId(carId?: string | null): string {
	return getEquippedSlot("wheel", carId).itemId;
}

export function getEquippedTopperId(carId?: string | null): string {
	return getEquippedSlot("topper", carId).itemId;
}

export function getEquippedDecalId(carId?: string | null): string {
	return getEquippedSlot("decal", carId).itemId;
}

export function getEquippedGoalExplosionId(): string {
	return getEquippedCosmeticId("goalExplosion");
}

/** Ten sam item (np. felgi) na wszystkie odblokowane karoserie. */
export function applyCarBodyCosmeticToAllUnlockedCars(
	ref: CosmeticRef,
): boolean {
	if (!isCarBodyCosmeticKind(ref.kind)) return false;
	if (!isInstanceUnlocked(ref)) return false;
	const inv = readStorage();
	for (const inst of inv.unlocked.filter((i) => i.kind === "car")) {
		const body = ensureCarBody(inv, inst.itemId);
		body[ref.kind] = {
			itemId: ref.itemId,
			paintId: ref.paintId ?? null,
		};
	}
	markCosmeticSeen(ref);
	writeStorage(inv);
	return true;
}

/** Zamiana pełnego loadoutu body (koła + topper + decal) między dwoma autami. */
export function swapCarBodyLoadoutBetweenCars(
	carA: string,
	carB: string,
): void {
	const inv = readStorage();
	const a = resolveCarId(carA);
	const b = resolveCarId(carB);
	if (a === b) return;
	const bodyA = ensureCarBody(inv, a);
	const bodyB = ensureCarBody(inv, b);
	const snapshot: CarBodyLoadout = {
		wheel: { ...bodyA.wheel },
		topper: { ...bodyA.topper },
		decal: { ...bodyA.decal },
	};
	for (const kind of CAR_BODY_COSMETIC_KINDS) {
		bodyA[kind] = { ...bodyB[kind] };
		bodyB[kind] = { ...snapshot[kind] };
	}
	writeStorage(inv);
}

/** Kopiuje loadout body z jednego auta na drugie (np. przenieś felgi). */
export function copyCarBodyLoadout(fromCarId: string, toCarId: string): void {
	const inv = readStorage();
	const from = resolveCarId(fromCarId);
	const to = resolveCarId(toCarId);
	if (from === to) return;
	const src = ensureCarBody(inv, from);
	const dst = ensureCarBody(inv, to);
	for (const kind of CAR_BODY_COSMETIC_KINDS) {
		dst[kind] = { ...src[kind] };
	}
	writeStorage(inv);
}

export function isCosmeticNew(ref: CosmeticRef): boolean {
	return readStorage().newInstances.includes(instanceKey(ref));
}

export function markCosmeticSeen(ref: CosmeticRef): void {
	const inv = readStorage();
	const key = instanceKey(ref);
	inv.newInstances = inv.newInstances.filter((k) => k !== key);
	writeStorage(inv);
}

export function countNewCosmetics(): number {
	return readStorage().newInstances.length;
}

export function incrementMatchesSinceDrop(): number {
	const inv = readStorage();
	inv.matchesSinceDrop += 1;
	writeStorage(inv);
	return inv.matchesSinceDrop;
}

export function resetMatchesSinceDrop(): void {
	const inv = readStorage();
	inv.matchesSinceDrop = 0;
	writeStorage(inv);
}

export function getMatchesSinceDrop(): number {
	return readStorage().matchesSinceDrop;
}

export function resetPlayerInventoryForTests(): void {
	memoryFallback = null;
	if (typeof localStorage !== "undefined") {
		localStorage.removeItem(STORAGE_KEY);
		localStorage.removeItem(LEGACY_V5_KEY);
		localStorage.removeItem(LEGACY_V4_KEY);
		localStorage.removeItem(LEGACY_V3_KEY);
		localStorage.removeItem(LEGACY_V2_KEY);
		localStorage.removeItem(LEGACY_V1_KEY);
	}
}

/** @deprecated alias */
export const PlayerInventory = {
	get: getPlayerInventory,
	save: savePlayerInventory,
	getEquippedCarId,
	getEquippedArenaId,
	getEquippedCosmetic,
	getEquippedPaintId,
	equipCar,
	equipArena,
	unlockCar,
	unlockArena,
	isUnlocked: isCarUnlocked,
	isArenaUnlocked,
	incrementMatchesSinceDrop,
	resetMatchesSinceDrop,
	getMatchesSinceDrop,
	resetForTests: resetPlayerInventoryForTests,
};
