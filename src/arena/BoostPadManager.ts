import * as THREE from "three";

import type Player from "../util/Player";
import { type BoostPadSpec, resolveBoostPadLayout } from "./boostPadLayout";

export type BoostPadPickupEvent = {
	padIndex: number;
	player: Player;
	amount: number;
	big: boolean;
	position: THREE.Vector3;
};

type PadRuntime = BoostPadSpec & {
	index: number;
	cooldown: number;
};

export class BoostPadManager {
	private readonly pads: PadRuntime[];
	private readonly listeners = new Set<(e: BoostPadPickupEvent) => void>();
	private readonly _pos = new THREE.Vector3();

	constructor(layout?: BoostPadSpec[]) {
		this.pads = (layout ?? resolveBoostPadLayout()).map((spec, index) => ({
			...spec,
			index,
			cooldown: 0,
		}));
	}

	onPickup(listener: (e: BoostPadPickupEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	reset(): void {
		for (const pad of this.pads) pad.cooldown = 0;
	}

	update(dt: number, players: Player[]): void {
		for (const pad of this.pads) {
			if (pad.cooldown > 0) pad.cooldown = Math.max(0, pad.cooldown - dt);
		}
		for (const player of players) {
			this._pos.copy(player.getPosition());
			if (this._pos.y > 2.8) continue;
			for (const pad of this.pads) {
				if (pad.cooldown > 0) continue;
				const dx = this._pos.x - pad.x;
				const dz = this._pos.z - pad.z;
				if (dx * dx + dz * dz > pad.radius * pad.radius) continue;
				player.addBoostFuel(pad.amount);
				pad.cooldown = pad.respawnSec;
				const event: BoostPadPickupEvent = {
					padIndex: pad.index,
					player,
					amount: pad.amount,
					big: pad.big,
					position: new THREE.Vector3(pad.x, 0.12, pad.z),
				};
				for (const fn of this.listeners) fn(event);
				break;
			}
		}
	}

	getPadStates(): ReadonlyArray<{
		index: number;
		x: number;
		z: number;
		big: boolean;
		active: boolean;
		respawnRatio: number;
	}> {
		return this.pads.map((pad) => ({
			index: pad.index,
			x: pad.x,
			z: pad.z,
			big: pad.big,
			active: pad.cooldown <= 0,
			respawnRatio:
				pad.cooldown <= 0
					? 1
					: 1 - pad.cooldown / Math.max(pad.respawnSec, 1e-6),
		}));
	}
}
