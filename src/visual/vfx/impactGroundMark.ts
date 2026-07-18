import * as THREE from "three";

const POOL = 6;

type Mark = {
	mesh: THREE.Mesh;
	life: number;
};

/** Krótki decal na murawie po mocnym uderzeniu — premium feedback bez pełnego SSR. */
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
			});
			const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 24), mat);
			mesh.rotation.x = -Math.PI / 2;
			mesh.renderOrder = 1;
			mesh.visible = false;
			this.root.add(mesh);
			this.pool.push({ mesh, life: 0 });
		}
	}

	trigger(worldPos: THREE.Vector3, impact: number): void {
		const slot = this.pool[this.head]!;
		this.head = (this.head + 1) % POOL;

		const scale = THREE.MathUtils.clamp(0.55 + impact * 0.035, 0.7, 1.45);
		slot.mesh.position.set(worldPos.x, 0.058, worldPos.z);
		slot.mesh.scale.setScalar(scale);
		slot.mesh.visible = true;
		slot.life = THREE.MathUtils.clamp(0.35 + impact * 0.012, 0.45, 0.75);
		(slot.mesh.material as THREE.MeshBasicMaterial).opacity = 0.42;
	}

	update(dt: number): void {
		for (const slot of this.pool) {
			if (slot.life <= 0) continue;
			slot.life -= dt;
			const mat = slot.mesh.material as THREE.MeshBasicMaterial;
			mat.opacity = 0.42 * (slot.life / 0.75);
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
	const size = 64;
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
	g.addColorStop(0, "rgba(0,0,0,0.55)");
	g.addColorStop(0.45, "rgba(0,0,0,0.28)");
	g.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}
