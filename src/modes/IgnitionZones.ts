import * as THREE from "three";

import { resolveBoostPadLayout } from "../arena/boostPadLayout";
import type { CarEntity } from "../game/CarEntity";
import type GameObject from "../GameObject";
import { RL_BALL } from "../util/rlConstants";
import { RL_ARENA } from "../visual/arenaConstants";

export type IgnitionZoneKind = "lowGrav" | "magnetic";

export type IgnitionZoneSpec = {
	id: string;
	kind: IgnitionZoneKind;
	x: number;
	z: number;
	radius: number;
};

export type IgnitionZoneBuff = {
	kind: IgnitionZoneKind;
	/** Strefa aktywna tylko gdy auto jest w środku — leftSec = nieskończoność w praktyce. */
	leftSec: number;
};

export type IgnitionZonesSnapshot = {
	zones: IgnitionZoneSpec[];
	humanBuff: IgnitionZoneBuff | null;
};

const ZONE_RADIUS = 4.2;
const LOW_GRAV_SCALE = 0.55;
const MAGNETIC_PULL_PEAK = 140;
const MAGNETIC_RADIUS = 14;
const MAGNETIC_MIN_DIST = 1.1;
/** Po respawnie krótka niewrażliwość, żeby auto nie „trzymało” strefy. */
const RESPAWN_ARM_SEC = 0.45;
const MIN_ZONE_SEP = ZONE_RADIUS * 2.6;

type Candidate = { x: number; z: number };

function arenaCandidates(): Candidate[] {
	const hw = RL_ARENA.HALF_WIDTH;
	const hl = RL_ARENA.HALF_LENGTH;
	const mx = hw * 0.42;
	const mz = hl * 0.28;
	const spots: Candidate[] = [
		{ x: -mx, z: mz },
		{ x: mx, z: -mz },
		{ x: mx, z: mz * 0.55 },
		{ x: -mx, z: -mz * 0.55 },
		{ x: -mx * 0.55, z: 0 },
		{ x: mx * 0.55, z: 0 },
		{ x: 0, z: mz * 0.72 },
		{ x: 0, z: -mz * 0.72 },
		{ x: -mx * 0.85, z: mz * 0.2 },
		{ x: mx * 0.85, z: -mz * 0.2 },
	];
	return spots;
}

function clearOfBoostPads(c: Candidate, radius: number): boolean {
	const pads = resolveBoostPadLayout();
	const minGap = radius + 2.8;
	for (const pad of pads) {
		const dx = c.x - pad.x;
		const dz = c.z - pad.z;
		if (dx * dx + dz * dz < (minGap + pad.radius) ** 2) return false;
	}
	return true;
}

function farFromZones(
	c: Candidate,
	zones: readonly IgnitionZoneSpec[],
	exceptId?: string,
): boolean {
	for (const z of zones) {
		if (exceptId && z.id === exceptId) continue;
		const dx = c.x - z.x;
		const dz = c.z - z.z;
		if (dx * dx + dz * dz < MIN_ZONE_SEP * MIN_ZONE_SEP) return false;
	}
	return true;
}

function pickCandidate(
	seed: number,
	zones: readonly IgnitionZoneSpec[],
	exceptId?: string,
	avoid?: Candidate,
): Candidate {
	const candidates = arenaCandidates().filter((c) =>
		clearOfBoostPads(c, ZONE_RADIUS),
	);
	const pool = candidates.length > 0 ? candidates : arenaCandidates();
	const shuffled = [...pool].sort(
		(a, b) =>
			((a.x * 12.9898 + a.z * 78.233 + seed) % 1) -
			((b.x * 12.9898 + b.z * 78.233 + seed) % 1),
	);
	for (let i = 0; i < shuffled.length; i++) {
		const c = shuffled[(Math.abs(seed) + i) % shuffled.length]!;
		if (avoid && Math.hypot(c.x - avoid.x, c.z - avoid.z) < ZONE_RADIUS * 1.5) {
			continue;
		}
		if (!farFromZones(c, zones, exceptId)) continue;
		return c;
	}
	const fallback = shuffled[Math.abs(seed) % shuffled.length]!;
	return { x: -fallback.x, z: -fallback.z };
}

/** Deterministyczny wybór 2 pozycji startowych. */
export function pickIgnitionZoneLayout(seed = 1): IgnitionZoneSpec[] {
	const a = pickCandidate(seed, []);
	const b = pickCandidate(seed * 7 + 3, [
		{ id: "tmp", kind: "lowGrav", x: a.x, z: a.z, radius: ZONE_RADIUS },
	]);
	return [
		{
			id: "zone-lowGrav",
			kind: "lowGrav",
			x: a.x,
			z: a.z,
			radius: ZONE_RADIUS,
		},
		{
			id: "zone-magnetic",
			kind: "magnetic",
			x: b.x,
			z: b.z,
			radius: ZONE_RADIUS,
		},
	];
}

/**
 * 2 strefy — buff tylko w środku. Po wyjechaniu strefa znika i respawnuje
 * w losowym miejscu boiska (Experimental / Lab).
 */
export class IgnitionZonesController {
	readonly enabled: boolean;
	private _zones: IgnitionZoneSpec[];
	private layoutDirty = false;
	private relocateSerial = 0;
	private readonly layoutSeed: number;

	/** slot → zoneId gdy auto jest w środku. */
	private readonly insideBySlot = new Map<number, string>();
	private readonly armLeftSec = new Map<string, number>();
	private readonly _ballPos = new THREE.Vector3();
	private readonly _carPos = new THREE.Vector3();
	private readonly _pull = new THREE.Vector3();

	constructor(enabled: boolean, seed = 0xc0_ff_ee) {
		this.enabled = enabled;
		this.layoutSeed = seed >>> 0;
		this._zones = enabled ? pickIgnitionZoneLayout(this.layoutSeed) : [];
	}

	get zones(): readonly IgnitionZoneSpec[] {
		return this._zones;
	}

	/** True gdy layout się zmienił od ostatniego consume (VFX refresh). */
	consumeLayoutDirty(): boolean {
		const dirty = this.layoutDirty;
		this.layoutDirty = false;
		return dirty;
	}

	reset(seed = this.layoutSeed): void {
		this.insideBySlot.clear();
		this.armLeftSec.clear();
		this._zones = this.enabled ? pickIgnitionZoneLayout(seed >>> 0) : [];
		this.layoutDirty = true;
		this.relocateSerial = 0;
	}

	getBuff(slotIndex: number): IgnitionZoneBuff | null {
		const zoneId = this.insideBySlot.get(slotIndex);
		if (!zoneId) return null;
		const zone = this._zones.find((z) => z.id === zoneId);
		if (!zone) return null;
		return { kind: zone.kind, leftSec: 99 };
	}

	update(
		dt: number,
		cars: CarEntity[],
		ball: GameObject | null,
		matchPlaying: boolean,
	): void {
		if (!this.enabled || !matchPlaying) {
			for (const car of cars) {
				car.player.gravityScale = 1;
			}
			this.insideBySlot.clear();
			return;
		}

		for (const [id, left] of [...this.armLeftSec.entries()]) {
			const next = left - dt;
			if (next <= 0) this.armLeftSec.delete(id);
			else this.armLeftSec.set(id, next);
		}

		const toRelocate = new Set<string>();

		for (const car of cars) {
			this._carPos.copy(car.player.getPosition());
			const prevZoneId = this.insideBySlot.get(car.slotIndex) ?? null;
			let nowZoneId: string | null = null;

			if (this._carPos.y <= 3.2) {
				for (const zone of this._zones) {
					if ((this.armLeftSec.get(zone.id) ?? 0) > 0) continue;
					const dx = this._carPos.x - zone.x;
					const dz = this._carPos.z - zone.z;
					if (dx * dx + dz * dz <= zone.radius * zone.radius) {
						nowZoneId = zone.id;
						break;
					}
				}
			}

			if (prevZoneId && prevZoneId !== nowZoneId) {
				/** Wyjechał — kandydat do relocate (tylko gdy nikt nie został). */
				toRelocate.add(prevZoneId);
				this.insideBySlot.delete(car.slotIndex);
			} else if (nowZoneId) {
				this.insideBySlot.set(car.slotIndex, nowZoneId);
			} else {
				this.insideBySlot.delete(car.slotIndex);
			}

			const activeId = this.insideBySlot.get(car.slotIndex);
			const active = activeId
				? this._zones.find((z) => z.id === activeId)
				: undefined;
			car.player.gravityScale =
				active?.kind === "lowGrav" ? LOW_GRAV_SCALE : 1;
		}

		for (const zoneId of toRelocate) {
			let occupied = false;
			for (const id of this.insideBySlot.values()) {
				if (id === zoneId) {
					occupied = true;
					break;
				}
			}
			if (!occupied) this.relocateZone(zoneId);
		}

		if (ball) {
			this.applyMagneticPull(dt, cars, ball);
		}
	}

	private relocateZone(zoneId: string): void {
		const idx = this._zones.findIndex((z) => z.id === zoneId);
		if (idx < 0) return;
		const prev = this._zones[idx]!;
		this.relocateSerial += 1;
		const nextPos = pickCandidate(
			(this.layoutSeed + this.relocateSerial * 97_331) >>> 0,
			this._zones,
			zoneId,
			{ x: prev.x, z: prev.z },
		);
		this._zones[idx] = {
			...prev,
			x: nextPos.x,
			z: nextPos.z,
		};
		this.armLeftSec.set(zoneId, RESPAWN_ARM_SEC);
		/** Wyrzuć wszystkich nadal „przypiętych” do starej pozycji. */
		for (const [slot, id] of [...this.insideBySlot.entries()]) {
			if (id === zoneId) this.insideBySlot.delete(slot);
		}
		this.layoutDirty = true;
	}

	private applyMagneticPull(
		dt: number,
		cars: CarEntity[],
		ball: GameObject,
	): void {
		this._ballPos.copy(ball.getPosition());
		const body = ball.rapierRigidBody;
		for (const car of cars) {
			const buff = this.getBuff(car.slotIndex);
			if (buff?.kind !== "magnetic") continue;

			this._carPos.copy(car.player.getPosition());
			this._pull.subVectors(this._carPos, this._ballPos);
			const dist = this._pull.length();
			if (dist < MAGNETIC_MIN_DIST || dist > MAGNETIC_RADIUS) continue;
			this._pull.multiplyScalar(1 / dist);
			const closeness = 1 - dist / MAGNETIC_RADIUS;
			const strength = MAGNETIC_PULL_PEAK * closeness * closeness * dt;
			body.applyImpulse(
				{
					x: this._pull.x * strength * RL_BALL.mass,
					y: this._pull.y * strength * RL_BALL.mass * 0.55,
					z: this._pull.z * strength * RL_BALL.mass,
				},
				true,
			);
		}
	}

	snapshot(humanSlot: number): IgnitionZonesSnapshot {
		return {
			zones: this._zones.map((z) => ({ ...z })),
			humanBuff: this.getBuff(humanSlot),
		};
	}
}
