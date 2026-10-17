import * as THREE from "three";

import { PLAYFIELD_SURFACE_Y } from "../arenaConstants";

const POOL = 10;

type Mark = {
	mesh: THREE.Mesh;
	life: number;
	maxLife: number;
};

/** Decal na murawie po mocnym uderzeniu — depth-bias, dłuższy wear. */
export class ImpactGroundMarkVfx {
	private readonly root = new THREE.Group();
	private readonly pool: Mark[] = [];
	private head = 0;

	constructor(scene: THREE.Scene) {
		this.root.name = "impactGroundMarks";
		scene.add(this.root);

		const tex = buildMarkTexture();
		for (let i = 0; i < POOL; i++) {
			const mat = new THREE.MeshBasicMaterial({
				map: tex,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				blending: THREE.MultiplyBlending,
				polygonOffset: true,
				polygonOffsetFactor: -2,
				polygonOffsetUnits: -2,
			});
			const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 28), mat);
			mesh.rotation.x = -Math.PI / 2;
			mesh.renderOrder = 1;
			mesh.visible = false;
			mesh.name = "impactGroundDecal";
			this.root.add(mesh);
			this.pool.push({ mesh, life: 0, maxLife: 0.4 });
		}
	}

	trigger(worldPos: THREE.Vector3, impact: number): void {
		const slot = this.pool[this.head]!;
		this.head = (this.head + 1) % POOL;

		const scale = THREE.MathUtils.clamp(0.55 + impact * 0.035, 0.7, 1.65);
		slot.mesh.position.set(
			worldPos.x,
			PLAYFIELD_SURFACE_Y + 0.012,
			worldPos.z,
		);
		slot.mesh.scale.setScalar(scale);
		slot.mesh.visible = true;
		slot.maxLife = THREE.MathUtils.clamp(0.55 + impact * 0.02, 0.55, 1.35);
		slot.life = slot.maxLife;
		(slot.mesh.material as THREE.MeshBasicMaterial).opacity = 0.42;
	}

	update(dt: number): void {
		for (const slot of this.pool) {
			if (slot.life <= 0) continue;
			slot.life -= dt;
			const mat = slot.mesh.material as THREE.MeshBasicMaterial;
			mat.opacity = 0.42 * Math.max(0, slot.life / slot.maxLife);
			if (slot.life <= 0) {
				slot.mesh.visible = false;
				mat.opacity = 0;
			}
		}
	}

	dispose(): void {
		for (const slot of this.pool) {
			slot.mesh.geometry.dispose();
			(slot.mesh.material as THREE.Material).dispose();
		}
		this.root.removeFromParent();
	}
}

function buildMarkTexture(): THREE.CanvasTexture {
	const size = 96;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D unavailable");
	const g = ctx.createRadialGradient(
		size / 2,
		size / 2,
		0,
		size / 2,
		size / 2,
		size / 2,
	);
	g.addColorStop(0, "rgba(0,0,0,0.62)");
	g.addColorStop(0.35, "rgba(20,18,10,0.4)");
	g.addColorStop(0.7, "rgba(0,0,0,0.16)");
	g.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);
	ctx.globalCompositeOperation = "multiply";
	for (let i = 0; i < 7; i++) {
		const a = (i / 7) * Math.PI;
		ctx.strokeStyle = "rgba(0,0,0,0.18)";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(size / 2, size / 2);
		ctx.lineTo(
			size / 2 + Math.cos(a) * size * 0.42,
			size / 2 + Math.sin(a) * size * 0.42,
		);
		ctx.stroke();
	}
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}
