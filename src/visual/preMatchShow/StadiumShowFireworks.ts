/**
 * Aerial fireworks for prematch — shell rises, then RGB burst (team cyan/magenta + gold).
 * Pooled; hitch-aware (max concurrent shells, short life).
 */
import * as THREE from "three";

import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "../arenaConstants";

const MAX_SHELLS = 8;
const SPARKS = 42;
const SHELL_LIFE = 0.55;
const BURST_LIFE = 1.15;

type Shell = {
	mesh: THREE.Points;
	pos: Float32Array;
	vel: Float32Array;
	life: number;
	maxLife: number;
	phase: "rise" | "burst" | "dead";
	color: THREE.Color;
};

const PALETTE = [
	new THREE.Color(0.15, 1.4, 1.7), // cyan
	new THREE.Color(1.6, 0.12, 1.35), // magenta
	new THREE.Color(1.7, 0.95, 0.15), // gold
	new THREE.Color(1.55, 0.35, 0.08), // orange
	new THREE.Color(0.35, 1.1, 0.55), // lime
	new THREE.Color(1.2, 0.2, 0.55), // hot pink
];

export class StadiumShowFireworks {
	readonly root = new THREE.Group();
	private readonly shells: Shell[] = [];
	private cooldown = 0;
	private readonly _origin = new THREE.Vector3();
	private readonly baseMat: THREE.PointsMaterial;

	constructor() {
		this.root.name = "stadiumShowFireworks";
		this.baseMat = new THREE.PointsMaterial({
			color: 0xffffff,
			size: 0.55,
			transparent: true,
			opacity: 0,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			sizeAttenuation: true,
			toneMapped: false,
		});
		for (let i = 0; i < MAX_SHELLS; i++) {
			const pos = new Float32Array(SPARKS * 3);
			const vel = new Float32Array(SPARKS * 3);
			const geo = new THREE.BufferGeometry();
			geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
			const mat = this.baseMat.clone();
			const mesh = new THREE.Points(geo, mat);
			mesh.visible = false;
			mesh.frustumCulled = false;
			mesh.renderOrder = 30;
			this.root.add(mesh);
			this.shells.push({
				mesh,
				pos,
				vel,
				life: 0,
				maxLife: BURST_LIFE,
				phase: "dead",
				color: PALETTE[i % PALETTE.length]!.clone(),
			});
		}
	}

	/** Wystrzał z murawy / trybun — rise + explode. */
	launch(
		kind: "mid" | "blue" | "orange" | "side" = "mid",
		strength = 1,
	): void {
		const slot = this.shells.find((s) => s.phase === "dead");
		if (!slot) return;
		const hl = RL_ARENA.HALF_LENGTH;
		const hw = RL_ARENA.HALF_WIDTH;
		if (kind === "blue") {
			this._origin.set(
				(Math.random() - 0.5) * hw * 0.35,
				PLAYFIELD_SURFACE_Y + 1.2,
				-hl * 0.72,
			);
		} else if (kind === "orange") {
			this._origin.set(
				(Math.random() - 0.5) * hw * 0.35,
				PLAYFIELD_SURFACE_Y + 1.2,
				hl * 0.72,
			);
		} else if (kind === "side") {
			const side = Math.random() < 0.5 ? -1 : 1;
			this._origin.set(
				side * hw * (0.55 + Math.random() * 0.25),
				PLAYFIELD_SURFACE_Y + 1.5,
				(Math.random() - 0.5) * hl * 0.55,
			);
		} else {
			this._origin.set(
				(Math.random() - 0.5) * hw * 0.45,
				PLAYFIELD_SURFACE_Y + 1.4,
				(Math.random() - 0.5) * hl * 0.35,
			);
		}

		slot.color.copy(PALETTE[(Math.random() * PALETTE.length) | 0]!);
		(slot.mesh.material as THREE.PointsMaterial).color.copy(slot.color);
		(slot.mesh.material as THREE.PointsMaterial).size = 0.42;
		(slot.mesh.material as THREE.PointsMaterial).opacity = 1;

		/** Jedna „kula” wznosząca — reszta iskier schowana w środku do burst. */
		for (let i = 0; i < SPARKS; i++) {
			const i3 = i * 3;
			slot.pos[i3] = this._origin.x;
			slot.pos[i3 + 1] = this._origin.y;
			slot.pos[i3 + 2] = this._origin.z;
			if (i === 0) {
				slot.vel[i3] = (Math.random() - 0.5) * 2;
				slot.vel[i3 + 1] = (22 + Math.random() * 10) * strength;
				slot.vel[i3 + 2] = (Math.random() - 0.5) * 2;
			} else {
				slot.vel[i3] = 0;
				slot.vel[i3 + 1] = 0;
				slot.vel[i3 + 2] = 0;
			}
		}
		(
			slot.mesh.geometry.getAttribute("position") as THREE.BufferAttribute
		).needsUpdate = true;
		slot.phase = "rise";
		slot.maxLife = SHELL_LIFE;
		slot.life = SHELL_LIFE;
		slot.mesh.visible = true;
	}

	/** Salwa DROP / celebration. */
	barrage(intensity = 1): void {
		this.launch("blue", 1.1 * intensity);
		this.launch("orange", 1.1 * intensity);
		this.launch("mid", 1.25 * intensity);
		this.launch("side", intensity);
		this.launch("side", intensity);
	}

	update(dt: number, showU: number, pulse: number): void {
		this.cooldown = Math.max(0, this.cooldown - dt);
		/** Auto salwy w climax + celebration. */
		const party = showU >= 0.48 && showU < 0.9;
		if (party && this.cooldown <= 0 && pulse > 0.28) {
			const drop = showU < 0.7;
			this.cooldown = drop ? 0.22 - pulse * 0.06 : 0.32 - pulse * 0.05;
			const roll = Math.random();
			if (roll < 0.28) this.launch("blue", 0.95 + pulse);
			else if (roll < 0.56) this.launch("orange", 0.95 + pulse);
			else if (roll < 0.78) this.launch("mid", 1.05 + pulse);
			else this.launch("side", 0.9 + pulse * 0.5);
		}

		for (const slot of this.shells) {
			if (slot.phase === "dead") {
				slot.mesh.visible = false;
				continue;
			}
			slot.life -= dt;
			const mat = slot.mesh.material as THREE.PointsMaterial;

			if (slot.phase === "rise") {
				/** Tylko spark 0 leci w górę. */
				slot.pos[0]! += slot.vel[0]! * dt;
				slot.pos[1]! += slot.vel[1]! * dt;
				slot.pos[2]! += slot.vel[2]! * dt;
				slot.vel[1]! -= 18 * dt;
				for (let i = 1; i < SPARKS; i++) {
					const i3 = i * 3;
					slot.pos[i3] = slot.pos[0]!;
					slot.pos[i3 + 1] = slot.pos[1]!;
					slot.pos[i3 + 2] = slot.pos[2]!;
				}
				mat.opacity = 0.85;
				mat.size = 0.5;
				(
					slot.mesh.geometry.getAttribute(
						"position",
					) as THREE.BufferAttribute
				).needsUpdate = true;

				if (slot.life <= 0 || slot.vel[1]! < 4) {
					this.explode(slot);
				}
				continue;
			}

			/** burst */
			const t = 1 - slot.life / slot.maxLife;
			for (let i = 0; i < SPARKS; i++) {
				const i3 = i * 3;
				slot.pos[i3]! += slot.vel[i3]! * dt;
				slot.pos[i3 + 1]! += slot.vel[i3 + 1]! * dt;
				slot.pos[i3 + 2]! += slot.vel[i3 + 2]! * dt;
				slot.vel[i3]! *= 1 - 1.2 * dt;
				slot.vel[i3 + 1]! -= 14 * dt;
				slot.vel[i3 + 2]! *= 1 - 1.2 * dt;
				if (slot.pos[i3 + 1]! < PLAYFIELD_SURFACE_Y + 0.2) {
					slot.pos[i3 + 1] = PLAYFIELD_SURFACE_Y + 0.2;
					slot.vel[i3 + 1]! *= -0.15;
				}
			}
			(
				slot.mesh.geometry.getAttribute("position") as THREE.BufferAttribute
			).needsUpdate = true;
			mat.opacity = 0.95 * (1 - t) ** 1.05;
			mat.size = 0.62 * (1 - t * 0.55);
			if (slot.life <= 0) {
				slot.phase = "dead";
				slot.mesh.visible = false;
			}
		}
	}

	private explode(slot: Shell): void {
		const cx = slot.pos[0]!;
		const cy = slot.pos[1]!;
		const cz = slot.pos[2]!;
		for (let i = 0; i < SPARKS; i++) {
			const i3 = i * 3;
			const theta = Math.random() * Math.PI * 2;
			const phi = Math.acos(2 * Math.random() - 1);
			const spd = 8 + Math.random() * 18;
			slot.pos[i3] = cx;
			slot.pos[i3 + 1] = cy;
			slot.pos[i3 + 2] = cz;
			slot.vel[i3] = Math.sin(phi) * Math.cos(theta) * spd;
			slot.vel[i3 + 1] = Math.cos(phi) * spd * 0.85 + 2;
			slot.vel[i3 + 2] = Math.sin(phi) * Math.sin(theta) * spd;
		}
		(
			slot.mesh.geometry.getAttribute("position") as THREE.BufferAttribute
		).needsUpdate = true;
		slot.phase = "burst";
		slot.maxLife = BURST_LIFE;
		slot.life = BURST_LIFE;
		(slot.mesh.material as THREE.PointsMaterial).opacity = 1;
		(slot.mesh.material as THREE.PointsMaterial).size = 0.7;
	}

	dispose(): void {
		for (const slot of this.shells) {
			slot.mesh.geometry.dispose();
			(slot.mesh.material as THREE.Material).dispose();
		}
		this.baseMat.dispose();
		this.root.removeFromParent();
	}
}
