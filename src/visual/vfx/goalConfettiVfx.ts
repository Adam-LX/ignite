import * as THREE from "three";

const COUNT = 220;
const LIFE = 2.4;

type Bit = {
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	spin: number;
	life: number;
	maxLife: number;
};

/** Confetti / streamers przy golu. */
export class GoalConfettiVfx {
	private readonly root = new THREE.Group();
	private readonly mesh: THREE.InstancedMesh;
	private readonly bits: Bit[] = [];
	private readonly dummy = new THREE.Object3D();
	private active = false;
	private life = 0;

	constructor(scene: THREE.Scene) {
		this.root.name = "goalConfetti";
		scene.add(this.root);
		const geo = new THREE.PlaneGeometry(0.12, 0.22);
		const mat = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: 0.92,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		this.mesh = new THREE.InstancedMesh(geo, mat, COUNT);
		this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.mesh.frustumCulled = false;
		this.mesh.visible = false;
		this.root.add(this.mesh);
		for (let i = 0; i < COUNT; i++) {
			this.bits.push({
				x: 0,
				y: 0,
				z: 0,
				vx: 0,
				vy: 0,
				vz: 0,
				spin: 0,
				life: 0,
				maxLife: 1,
			});
		}
	}

	trigger(worldPos: THREE.Vector3, team: "blue" | "orange"): void {
		this.root.position.copy(worldPos);
		this.root.position.y += 1.2;
		this.mesh.visible = true;
		this.active = true;
		this.life = LIFE;

		const a = new THREE.Color(team === "blue" ? 0x4aa8ff : 0xff8a3a);
		const b = new THREE.Color(team === "blue" ? 0xd8f4ff : 0xffe0a8);
		const c = new THREE.Color(0xffffff);
		for (let i = 0; i < COUNT; i++) {
			const bit = this.bits[i]!;
			const ang = Math.random() * Math.PI * 2;
			const spd = 4 + Math.random() * 14;
			bit.x = (Math.random() - 0.5) * 0.5;
			bit.y = Math.random() * 0.4;
			bit.z = (Math.random() - 0.5) * 0.5;
			bit.vx = Math.cos(ang) * spd;
			bit.vy = 6 + Math.random() * 12;
			bit.vz = Math.sin(ang) * spd;
			bit.spin = (Math.random() - 0.5) * 14;
			bit.maxLife = 1.2 + Math.random() * 1.2;
			bit.life = bit.maxLife;
			const pick = Math.random();
			this.mesh.setColorAt(i, pick < 0.45 ? a : pick < 0.8 ? b : c);
		}
		if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
	}

	update(dt: number): void {
		if (!this.active) return;
		this.life -= dt;
		let alive = 0;
		for (let i = 0; i < COUNT; i++) {
			const bit = this.bits[i]!;
			if (bit.life <= 0) {
				this.dummy.scale.setScalar(0);
				this.dummy.updateMatrix();
				this.mesh.setMatrixAt(i, this.dummy.matrix);
				continue;
			}
			alive++;
			bit.life -= dt;
			bit.vy -= 11 * dt;
			bit.vx *= 0.985;
			bit.vz *= 0.985;
			bit.x += bit.vx * dt;
			bit.y += bit.vy * dt;
			bit.z += bit.vz * dt;
			const fade = THREE.MathUtils.clamp(bit.life / bit.maxLife, 0, 1);
			const ang = bit.spin * (1 - fade);
			this.dummy.position.set(bit.x, bit.y, bit.z);
			this.dummy.rotation.set(ang, ang * 0.7, ang * 1.3);
			this.dummy.scale.setScalar(0.7 + fade * 0.5);
			this.dummy.updateMatrix();
			this.mesh.setMatrixAt(i, this.dummy.matrix);
		}
		this.mesh.instanceMatrix.needsUpdate = true;
		(this.mesh.material as THREE.MeshBasicMaterial).opacity =
			0.85 * THREE.MathUtils.clamp(this.life / LIFE, 0, 1);
		if (alive === 0 || this.life <= 0) {
			this.active = false;
			this.mesh.visible = false;
		}
	}

	dispose(): void {
		this.mesh.geometry.dispose();
		(this.mesh.material as THREE.Material).dispose();
		this.root.removeFromParent();
	}
}
