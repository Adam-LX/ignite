import * as THREE from "three";

import { PLAYFIELD_SURFACE_Y } from "../arenaConstants";

const POOL = 48;

type Stamp = { mesh: THREE.Mesh; life: number; maxLife: number };

/**
 * Dynamiczne zużycie trawy — tylko przy drift / mocnym ślizgu.
 */
export class GrassWearVfx {
	private readonly root = new THREE.Group();
	private readonly pool: Stamp[] = [];
	private head = 0;
	private acc = 0;
	private readonly tex: THREE.CanvasTexture;

	constructor(scene: THREE.Scene) {
		this.root.name = "grassWear";
		scene.add(this.root);
		this.tex = buildWearTexture();
		for (let i = 0; i < POOL; i++) {
			const mat = new THREE.MeshBasicMaterial({
				map: this.tex,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				blending: THREE.NormalBlending,
				toneMapped: false,
			});
			const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.38, 16), mat);
			mesh.rotation.x = -Math.PI / 2;
			mesh.visible = false;
			mesh.renderOrder = 1;
			this.root.add(mesh);
			this.pool.push({ mesh, life: 0, maxLife: 1 });
		}
	}

	emit(
		worldPos: THREE.Vector3,
		speed: number,
		onGround: boolean,
		dt: number,
		driftBlend = 0,
	): void {
		if (!onGround || speed < 8 || driftBlend < 0.28) {
			this.acc = 0;
			return;
		}
		this.acc += dt * (0.28 + Math.min(1.2, driftBlend * speed / 24));
		if (this.acc < 0.18) return;
		this.acc = 0;
		const slot = this.pool[this.head]!;
		this.head = (this.head + 1) % POOL;
		slot.mesh.position.set(
			worldPos.x + (Math.random() - 0.5) * 0.4,
			PLAYFIELD_SURFACE_Y + 0.03,
			worldPos.z + (Math.random() - 0.5) * 0.4,
		);
		const s = 0.28 + Math.min(0.32, speed / 55);
		slot.mesh.scale.setScalar(s);
		slot.mesh.visible = true;
		slot.maxLife = 2.8;
		slot.life = slot.maxLife;
		(slot.mesh.material as THREE.MeshBasicMaterial).opacity = 0.22;
	}

	update(dt: number): void {
		for (const slot of this.pool) {
			if (slot.life <= 0) continue;
			slot.life -= dt;
			(slot.mesh.material as THREE.MeshBasicMaterial).opacity =
				0.15 * (slot.life / slot.maxLife);
			if (slot.life <= 0) slot.mesh.visible = false;
		}
	}

	dispose(): void {
		for (const s of this.pool) {
			s.mesh.geometry.dispose();
			(s.mesh.material as THREE.Material).dispose();
		}
		this.tex.dispose();
		this.root.removeFromParent();
	}
}

function buildWearTexture(): THREE.CanvasTexture {
	const size = 64;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;
	ctx.clearRect(0, 0, size, size);
	const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
	g.addColorStop(0, "rgba(32, 52, 26, 0.35)");
	g.addColorStop(0.5, "rgba(32, 52, 26, 0.12)");
	g.addColorStop(1, "rgba(32, 52, 26, 0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}
