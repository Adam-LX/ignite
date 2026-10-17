import * as THREE from "three";

const SPARK_COUNT = 40;
const LIFE = 0.48;

let softSparkTex: THREE.Texture | null = null;

function softSparkTexture(): THREE.Texture {
	if (softSparkTex) return softSparkTex;
	const s = 64;
	const canvas = document.createElement("canvas");
	canvas.width = s;
	canvas.height = s;
	const ctx = canvas.getContext("2d")!;
	const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
	g.addColorStop(0, "rgba(255,245,210,1)");
	g.addColorStop(0.35, "rgba(255,220,140,0.65)");
	g.addColorStop(0.7, "rgba(255,180,80,0.12)");
	g.addColorStop(1, "rgba(255,160,60,0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, s, s);
	softSparkTex = new THREE.CanvasTexture(canvas);
	softSparkTex.colorSpace = THREE.SRGBColorSpace;
	softSparkTex.generateMipmaps = false;
	softSparkTex.minFilter = THREE.LinearFilter;
	softSparkTex.magFilter = THREE.LinearFilter;
	return softSparkTex;
}

/**
 * Miękkie iskry przy starcie dodge/flip (bez płaskiej karty-ribbona).
 */
export class DodgeFlipVfx {
	private readonly root = new THREE.Group();
	private readonly sparks: THREE.Points;
	private readonly positions: Float32Array;
	private readonly velocities: Float32Array;
	private life = 0;

	constructor(scene: THREE.Scene) {
		this.root.name = "dodgeFlipVfx";
		scene.add(this.root);

		this.positions = new Float32Array(SPARK_COUNT * 3);
		this.velocities = new Float32Array(SPARK_COUNT * 3);
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
		const mat = new THREE.PointsMaterial({
			map: softSparkTexture(),
			color: 0xfff8e0,
			size: 0.32,
			transparent: true,
			opacity: 0,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			sizeAttenuation: true,
			toneMapped: false,
		});
		this.sparks = new THREE.Points(geo, mat);
		this.sparks.frustumCulled = false;
		this.root.add(this.sparks);
		this.root.visible = false;
	}

	trigger(worldPos: THREE.Vector3, axis: THREE.Vector3): void {
		this.root.position.copy(worldPos);
		this.root.visible = true;
		this.life = LIFE;

		const n = axis.clone().normalize();
		for (let i = 0; i < SPARK_COUNT; i++) {
			const i3 = i * 3;
			const jitter = new THREE.Vector3(
				(Math.random() - 0.5) * 2,
				(Math.random() - 0.5) * 2,
				(Math.random() - 0.5) * 2,
			)
				.addScaledVector(n, (Math.random() - 0.25) * 1.2)
				.normalize()
				.multiplyScalar(5.5 + Math.random() * 12);
			this.positions[i3] = (Math.random() - 0.5) * 0.3;
			this.positions[i3 + 1] = (Math.random() - 0.5) * 0.3;
			this.positions[i3 + 2] = (Math.random() - 0.5) * 0.3;
			this.velocities[i3] = jitter.x;
			this.velocities[i3 + 1] = jitter.y;
			this.velocities[i3 + 2] = jitter.z;
		}
		(
			this.sparks.geometry.getAttribute("position") as THREE.BufferAttribute
		).needsUpdate = true;
		(this.sparks.material as THREE.PointsMaterial).opacity = 1;
	}

	update(dt: number): void {
		if (this.life <= 0) {
			this.root.visible = false;
			return;
		}
		this.life -= dt;
		const t = 1 - this.life / LIFE;
		for (let i = 0; i < SPARK_COUNT; i++) {
			const i3 = i * 3;
			this.positions[i3]! += this.velocities[i3]! * dt;
			this.positions[i3 + 1]! += this.velocities[i3 + 1]! * dt;
			this.positions[i3 + 2]! += this.velocities[i3 + 2]! * dt;
			this.velocities[i3]! *= 0.95;
			this.velocities[i3 + 1]! -= 16 * dt;
			this.velocities[i3 + 2]! *= 0.95;
		}
		(
			this.sparks.geometry.getAttribute("position") as THREE.BufferAttribute
		).needsUpdate = true;
		(this.sparks.material as THREE.PointsMaterial).opacity =
			1 * (1 - t) ** 1.2;
		(this.sparks.material as THREE.PointsMaterial).size =
			0.36 * (1 - t * 0.35);
	}

	dispose(): void {
		this.sparks.geometry.dispose();
		(this.sparks.material as THREE.Material).dispose();
		this.root.removeFromParent();
	}
}
