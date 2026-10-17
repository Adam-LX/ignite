import * as THREE from "three";

import { PLAYFIELD_SURFACE_Y } from "../arenaConstants";

const MARK_POOL = 128;
const SMOKE_POOL = 64;
const DROP_INTERVAL = 0.04;

type Mark = { mesh: THREE.Mesh; life: number; maxLife: number };
type Smoke = {
	mesh: THREE.Points;
	positions: Float32Array;
	life: number;
	maxLife: number;
};

/**
 * Ślady opon + dym przy drift / mocnym ślizgu — feedback jak w RL.
 */
export class SkidMarksVfx {
	private readonly root = new THREE.Group();
	private readonly marks: Mark[] = [];
	private readonly smokes: Smoke[] = [];
	private markHead = 0;
	private smokeHead = 0;
	private dropAcc = 0;
	private readonly markTex: THREE.CanvasTexture;
	private readonly tmp = new THREE.Vector3();

	constructor(scene: THREE.Scene) {
		this.root.name = "skidMarks";
		scene.add(this.root);
		this.markTex = buildSkidTexture();

		for (let i = 0; i < MARK_POOL; i++) {
			const mat = new THREE.MeshBasicMaterial({
				map: this.markTex,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				blending: THREE.NormalBlending,
				toneMapped: false,
			});
			const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.85), mat);
			mesh.rotation.x = -Math.PI / 2;
			mesh.visible = false;
			mesh.renderOrder = 2;
			this.root.add(mesh);
			this.marks.push({ mesh, life: 0, maxLife: 1 });
		}

		for (let i = 0; i < SMOKE_POOL; i++) {
			const positions = new Float32Array(24);
			const geo = new THREE.BufferGeometry();
			geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
			const mat = new THREE.PointsMaterial({
				color: 0xd8d0c4,
				size: 0.28,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				blending: THREE.NormalBlending,
				sizeAttenuation: true,
			});
			const mesh = new THREE.Points(geo, mat);
			mesh.visible = false;
			mesh.frustumCulled = false;
			this.root.add(mesh);
			this.smokes.push({ mesh, positions, life: 0, maxLife: 1 });
		}
	}

	/**
	 * Wywołuj co klatkę z auta na ziemi.
	 * @param slip 0–1 (driftBlend / lateral slip)
	 */
	emit(
		worldPos: THREE.Vector3,
		forward: THREE.Vector3,
		slip: number,
		speed: number,
		dt: number,
		onGround: boolean,
	): void {
		if (!onGround || slip < 0.18 || speed < 4) {
			this.dropAcc = 0;
			return;
		}
		this.dropAcc += dt;
		if (this.dropAcc < DROP_INTERVAL) return;
		this.dropAcc = 0;

		const intensity = THREE.MathUtils.clamp(slip * (speed / 24), 0.28, 1);
		this.stampMark(worldPos, forward, intensity);
		if (intensity > 0.35) this.puffSmoke(worldPos, intensity);
	}

	private stampMark(
		worldPos: THREE.Vector3,
		forward: THREE.Vector3,
		intensity: number,
	): void {
		const slot = this.marks[this.markHead]!;
		this.markHead = (this.markHead + 1) % MARK_POOL;
		this.tmp.copy(forward).setY(0);
		if (this.tmp.lengthSq() < 1e-6) this.tmp.set(0, 0, 1);
		this.tmp.normalize();
		const yaw = Math.atan2(this.tmp.x, this.tmp.z);

		slot.mesh.position.set(
			worldPos.x,
			PLAYFIELD_SURFACE_Y + 0.038,
			worldPos.z,
		);
		slot.mesh.rotation.z = -yaw;
		slot.mesh.scale.set(0.85 + intensity * 0.35, 1.05 + intensity * 0.4, 1);
		slot.mesh.visible = true;
		/** RL tire marks zostają dłużej — czytelny drift path. */
		slot.maxLife = 4.2 + intensity * 2.8;
		slot.life = slot.maxLife;
		(slot.mesh.material as THREE.MeshBasicMaterial).opacity =
			0.28 + intensity * 0.32;
	}

	private puffSmoke(worldPos: THREE.Vector3, intensity: number): void {
		const slot = this.smokes[this.smokeHead]!;
		this.smokeHead = (this.smokeHead + 1) % SMOKE_POOL;
		for (let i = 0; i < 8; i++) {
			const i3 = i * 3;
			const a = Math.random() * Math.PI * 2;
			const r = Math.random() * 0.35;
			slot.positions[i3] = Math.cos(a) * r;
			slot.positions[i3 + 1] = 0.05 + Math.random() * 0.1;
			slot.positions[i3 + 2] = Math.sin(a) * r;
		}
		(
			slot.mesh.geometry.getAttribute("position") as THREE.BufferAttribute
		).needsUpdate = true;
		slot.mesh.position.copy(worldPos);
		slot.mesh.position.y = PLAYFIELD_SURFACE_Y + 0.08;
		slot.mesh.visible = true;
		slot.maxLife = 0.55 + intensity * 0.35;
		slot.life = slot.maxLife;
		(slot.mesh.material as THREE.PointsMaterial).opacity = 0.36 + intensity * 0.34;
		(slot.mesh.material as THREE.PointsMaterial).size = 0.2 + intensity * 0.18;
	}

	update(dt: number): void {
		for (const slot of this.marks) {
			if (slot.life <= 0) continue;
			slot.life -= dt;
			const t = slot.life / slot.maxLife;
			(slot.mesh.material as THREE.MeshBasicMaterial).opacity =
				(0.28 + 0.32 * t) * Math.pow(t, 0.85);
			if (slot.life <= 0) {
				slot.mesh.visible = false;
			}
		}
		for (const slot of this.smokes) {
			if (slot.life <= 0) continue;
			slot.life -= dt;
			const t = slot.life / slot.maxLife;
			for (let i = 0; i < 8; i++) {
				const i3 = i * 3;
				slot.positions[i3 + 1]! += dt * (0.9 + (1 - t) * 1.4);
				slot.positions[i3]! *= 1 + dt * 1.2;
				slot.positions[i3 + 2]! *= 1 + dt * 1.2;
			}
			(
				slot.mesh.geometry.getAttribute("position") as THREE.BufferAttribute
			).needsUpdate = true;
			(slot.mesh.material as THREE.PointsMaterial).opacity = 0.4 * t;
			if (slot.life <= 0) slot.mesh.visible = false;
		}
	}

	dispose(): void {
		for (const m of this.marks) {
			m.mesh.geometry.dispose();
			(m.mesh.material as THREE.Material).dispose();
		}
		for (const s of this.smokes) {
			s.mesh.geometry.dispose();
			(s.mesh.material as THREE.Material).dispose();
		}
		this.markTex.dispose();
		this.root.removeFromParent();
	}
}

function buildSkidTexture(): THREE.CanvasTexture {
	const size = 64;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;
	ctx.clearRect(0, 0, size, size);
	const g = ctx.createLinearGradient(0, 0, size, 0);
	g.addColorStop(0, "rgba(20,24,18,0)");
	g.addColorStop(0.28, "rgba(20,24,18,0.28)");
	g.addColorStop(0.5, "rgba(20,24,18,0.42)");
	g.addColorStop(0.72, "rgba(20,24,18,0.28)");
	g.addColorStop(1, "rgba(20,24,18,0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}
