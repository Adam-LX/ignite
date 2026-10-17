/**
 * Pyro / iskry dachowe na kulminację pre-match show.
 */
import * as THREE from "three";

import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "../arenaConstants";

type Burst = {
	points: THREE.Points;
	pos: Float32Array;
	vel: Float32Array;
	life: number;
	maxLife: number;
};

const MAX_BURSTS = 14;
const SPARKS = 40;

/**
 * Krótkie bursty iskier przy bramkach / dachu.
 */
export class StadiumShowPyro {
	readonly root = new THREE.Group();
	private readonly bursts: Burst[] = [];
	private readonly mat: THREE.PointsMaterial;
	private readonly geoPool: THREE.BufferGeometry[] = [];
	private cooldown = 0;
	private readonly _origin = new THREE.Vector3();

	constructor() {
		this.root.name = "stadiumShowPyro";
		this.mat = new THREE.PointsMaterial({
			color: 0xffd090,
			size: 0.48,
			transparent: true,
			opacity: 0,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			sizeAttenuation: true,
		});
		for (let i = 0; i < MAX_BURSTS; i++) {
			const pos = new Float32Array(SPARKS * 3);
			const vel = new Float32Array(SPARKS * 3);
			const geo = new THREE.BufferGeometry();
			geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
			const points = new THREE.Points(geo, this.mat.clone());
			points.visible = false;
			points.frustumCulled = false;
			points.renderOrder = 28;
			this.root.add(points);
			this.geoPool.push(geo);
			this.bursts.push({ points, pos, vel, life: 0, maxLife: 0.95 });
		}
	}

	/** Wystrzał przy bramce (side −1 / +1) lub dachu (0). */
	burst(kind: "goalBlue" | "goalOrange" | "roof", strength = 1): void {
		const slot = this.bursts.find((b) => b.life <= 0);
		if (!slot) return;
		const hl = RL_ARENA.HALF_LENGTH;
		const hw = RL_ARENA.HALF_WIDTH;
		if (kind === "goalBlue") {
			this._origin.set(0, 4.2, -hl * 0.92);
		} else if (kind === "goalOrange") {
			this._origin.set(0, 4.2, hl * 0.92);
		} else {
			this._origin.set(
				(Math.random() - 0.5) * hw * 0.6,
				RL_ARENA.HEIGHT - 2.5,
				(Math.random() - 0.5) * hl * 0.4,
			);
		}
		slot.life = slot.maxLife;
		const upBias = kind === "roof" ? -1 : 1;
		for (let i = 0; i < SPARKS; i++) {
			const i3 = i * 3;
			slot.pos[i3] = this._origin.x + (Math.random() - 0.5) * 1.2;
			slot.pos[i3 + 1] = this._origin.y + (Math.random() - 0.5) * 0.6;
			slot.pos[i3 + 2] = this._origin.z + (Math.random() - 0.5) * 1.2;
			slot.vel[i3] = (Math.random() - 0.5) * 22 * strength;
			slot.vel[i3 + 1] =
				(9 + Math.random() * 22) * strength * upBias +
				(kind === "roof" ? -10 : 6);
			slot.vel[i3 + 2] = (Math.random() - 0.5) * 22 * strength;
		}
		(
			slot.points.geometry.getAttribute("position") as THREE.BufferAttribute
		).needsUpdate = true;
		slot.points.visible = true;
		(slot.points.material as THREE.PointsMaterial).opacity = 0.95;
		(slot.points.material as THREE.PointsMaterial).color.set(
			kind === "goalOrange"
				? 0xff8a20
				: kind === "goalBlue"
					? 0x40c8ff
					: 0xffe050,
		);
	}

	update(dt: number, showU: number, pulse: number): void {
		this.cooldown = Math.max(0, this.cooldown - dt);
		/** Pyro od DROP przez celebration — rzadziej na climax (hitch budget). */
		const party = showU > 0.45 && showU < 0.92;
		if (party && this.cooldown <= 0 && pulse > 0.28) {
			this.cooldown = (showU < 0.7 ? 0.24 : 0.34) - pulse * 0.05;
			const roll = Math.random();
			if (roll < 0.3) this.burst("goalBlue", 0.85 + pulse * 0.9);
			else if (roll < 0.6) this.burst("goalOrange", 0.85 + pulse * 0.9);
			else this.burst("roof", 0.7 + pulse * 0.5);
		}

		for (const slot of this.bursts) {
			if (slot.life <= 0) {
				slot.points.visible = false;
				continue;
			}
			slot.life -= dt;
			const t = 1 - slot.life / slot.maxLife;
			for (let i = 0; i < SPARKS; i++) {
				const i3 = i * 3;
				slot.pos[i3]! += slot.vel[i3]! * dt;
				slot.pos[i3 + 1]! += slot.vel[i3 + 1]! * dt;
				slot.pos[i3 + 2]! += slot.vel[i3 + 2]! * dt;
				slot.vel[i3 + 1]! -= 22 * dt;
				if (slot.pos[i3 + 1]! < PLAYFIELD_SURFACE_Y + 0.15) {
					slot.pos[i3 + 1] = PLAYFIELD_SURFACE_Y + 0.15;
					slot.vel[i3 + 1]! *= -0.25;
				}
			}
			(
				slot.points.geometry.getAttribute("position") as THREE.BufferAttribute
			).needsUpdate = true;
			(slot.points.material as THREE.PointsMaterial).opacity =
				0.95 * (1 - t) ** 1.15;
			(slot.points.material as THREE.PointsMaterial).size =
				0.38 * (1 - t * 0.4);
		}
	}

	dispose(): void {
		for (const slot of this.bursts) {
			slot.points.geometry.dispose();
			(slot.points.material as THREE.Material).dispose();
		}
		this.mat.dispose();
		this.root.removeFromParent();
	}
}
