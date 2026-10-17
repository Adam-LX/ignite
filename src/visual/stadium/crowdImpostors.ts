import * as THREE from "three";

import { RL_ARENA } from "../arenaConstants";

const FANS_PER_SIDE = 18;

/**
 * Tanie impostory publiczności na trybunach — billboardy zamiast pustego stadionu.
 */
export class CrowdImpostorsVfx {
	private readonly root = new THREE.Group();
	private readonly sprites: THREE.Sprite[] = [];
	private pulse = 0;

	constructor(scene: THREE.Scene) {
		this.root.name = "crowdImpostors";
		scene.add(this.root);
		const tex = buildCrowdTexture();
		const hw = RL_ARENA.HALF_WIDTH + 4.5;
		const hl = RL_ARENA.HALF_LENGTH + 2.5;
		const y = 6.5;

		const places: { x: number; z: number }[] = [];
		for (let i = 0; i < FANS_PER_SIDE; i++) {
			const t = (i + 0.5) / FANS_PER_SIDE;
			places.push({ x: -hw, z: THREE.MathUtils.lerp(-hl, hl, t) });
			places.push({ x: hw, z: THREE.MathUtils.lerp(-hl, hl, t) });
			places.push({ x: THREE.MathUtils.lerp(-hw, hw, t), z: -hl });
			places.push({ x: THREE.MathUtils.lerp(-hw, hw, t), z: hl });
		}

		for (const p of places) {
			const mat = new THREE.SpriteMaterial({
				map: tex,
				transparent: true,
				opacity: 0.72,
				depthWrite: false,
				color: new THREE.Color().setHSL(Math.random() * 0.08 + 0.55, 0.35, 0.55),
			});
			const spr = new THREE.Sprite(mat);
			spr.position.set(p.x, y + Math.random() * 1.2, p.z);
			const s = 1.6 + Math.random() * 1.1;
			spr.scale.set(s * 0.7, s, 1);
			this.root.add(spr);
			this.sprites.push(spr);
		}
	}

	/** Surge przy golu / demo — fale „wstawania”. */
	surge(strength = 1): void {
		this.pulse = Math.max(this.pulse, THREE.MathUtils.clamp(strength, 0.4, 1.5));
	}

	update(dt: number): void {
		if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 0.85);
		const t = performance.now() * 0.001;
		for (let i = 0; i < this.sprites.length; i++) {
			const spr = this.sprites[i]!;
			const bob = Math.sin(t * 2.2 + i * 0.37) * 0.08;
			const cheer = this.pulse * (0.25 + 0.35 * Math.sin(t * 9 + i));
			spr.position.y =
				6.5 + (i % 5) * 0.15 + bob + cheer;
			(spr.material as THREE.SpriteMaterial).opacity = 0.62 + this.pulse * 0.28;
		}
	}

	dispose(): void {
		for (const spr of this.sprites) {
			(spr.material as THREE.SpriteMaterial).map?.dispose();
			(spr.material as THREE.Material).dispose();
		}
		this.root.removeFromParent();
	}
}

function buildCrowdTexture(): THREE.CanvasTexture {
	const c = document.createElement("canvas");
	c.width = 64;
	c.height = 96;
	const ctx = c.getContext("2d")!;
	ctx.clearRect(0, 0, 64, 96);
	ctx.fillStyle = "rgba(30,40,60,0.9)";
	ctx.beginPath();
	ctx.ellipse(32, 70, 18, 22, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = "rgba(220,200,180,0.95)";
	ctx.beginPath();
	ctx.arc(32, 38, 14, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = "rgba(80,120,200,0.85)";
	ctx.fillRect(18, 48, 28, 36);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}
