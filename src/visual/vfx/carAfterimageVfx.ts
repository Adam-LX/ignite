import * as THREE from "three";

const GHOSTS = 10;
const INTERVAL = 0.04;
const LIFE = 0.28;
const SPEED_MIN = 18;

type Ghost = {
	mesh: THREE.Mesh;
	life: number;
	maxLife: number;
};

/**
 * Afterimage przy prędkości — miękkie sprite’y za autem.
 * NIE BoxGeometry: przy boost addytywne boxy = „żółty klocek” wokół auta.
 * Przy boost: OFF (flame trail wystarczy).
 */
export class CarAfterimageVfx {
	private readonly ghosts: Ghost[] = [];
	private acc = 0;
	private readonly geo: THREE.PlaneGeometry;
	private readonly tex: THREE.CanvasTexture;
	private head = 0;
	private readonly _behind = new THREE.Vector3();

	constructor(scene: THREE.Scene) {
		this.tex = softGhostTexture();
		this.geo = new THREE.PlaneGeometry(1, 1);
		for (let i = 0; i < GHOSTS; i++) {
			const mat = new THREE.MeshBasicMaterial({
				map: this.tex,
				color: 0xffc878,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
				toneMapped: false,
			});
			const mesh = new THREE.Mesh(this.geo, mat);
			mesh.visible = false;
			mesh.frustumCulled = false;
			mesh.renderOrder = 11;
			scene.add(mesh);
			this.ghosts.push({ mesh, life: 0, maxLife: LIFE });
		}
	}

	updateFromCar(
		pos: THREE.Vector3,
		quat: THREE.Quaternion,
		speed: number,
		boosting: boolean,
		dt: number,
		velocity?: THREE.Vector3,
		camera?: THREE.Camera,
	): void {
		this.update(dt);
		/** Boost ma flame — box/ghost stack przy boost = klocek. */
		if (boosting) {
			this.acc = 0;
			this.hideAll();
			return;
		}
		if (speed < SPEED_MIN) {
			this.acc = 0;
			return;
		}
		this.acc += dt;
		if (this.acc < INTERVAL) return;
		this.acc = 0;

		if (velocity && velocity.lengthSq() > 1) {
			this._behind.copy(velocity).normalize().multiplyScalar(-1);
		} else {
			this._behind
				.set(0, 0, 1)
				.applyQuaternion(quat)
				.normalize()
				.multiplyScalar(-1);
		}

		const slot = this.ghosts[this.head]!;
		this.head = (this.head + 1) % GHOSTS;
		slot.mesh.position.copy(pos);
		slot.mesh.position.addScaledVector(this._behind, 0.45);
		slot.mesh.position.y += 0.08;

		if (camera) {
			slot.mesh.quaternion.copy(camera.quaternion);
		} else {
			slot.mesh.quaternion.copy(quat);
		}

		const s = 0.7 + Math.min(0.9, speed / 40);
		slot.mesh.scale.set(s * 1.1, s * 0.7, 1);
		slot.mesh.visible = true;
		slot.maxLife = LIFE;
		slot.life = LIFE;
		const hot = speed > 28;
		(slot.mesh.material as THREE.MeshBasicMaterial).color.set(
			hot ? 0xffe0a8 : 0x9ef0ff,
		);
		(slot.mesh.material as THREE.MeshBasicMaterial).opacity = hot ? 0.18 : 0.1;
	}

	private hideAll(): void {
		for (const g of this.ghosts) {
			g.life = 0;
			g.mesh.visible = false;
			(g.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
		}
	}

	private update(dt: number): void {
		for (const g of this.ghosts) {
			if (g.life <= 0) continue;
			g.life -= dt;
			const t = Math.max(0, g.life / g.maxLife);
			const mat = g.mesh.material as THREE.MeshBasicMaterial;
			mat.opacity = Math.min(mat.opacity * Math.max(0, 1 - dt * 5.5), 0.2 * t);
			if (g.life <= 0) {
				g.mesh.visible = false;
			}
		}
	}

	dispose(): void {
		for (const g of this.ghosts) {
			g.mesh.removeFromParent();
			(g.mesh.material as THREE.Material).dispose();
		}
		this.geo.dispose();
		this.tex.dispose();
	}
}

let _ghostTex: THREE.CanvasTexture | null = null;

function softGhostTexture(): THREE.CanvasTexture {
	if (_ghostTex) return _ghostTex;
	const size = 128;
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
	g.addColorStop(0, "rgba(255,255,255,0.85)");
	g.addColorStop(0.35, "rgba(255,220,160,0.35)");
	g.addColorStop(0.7, "rgba(255,160,60,0.08)");
	g.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);
	_ghostTex = new THREE.CanvasTexture(canvas);
	_ghostTex.colorSpace = THREE.NoColorSpace;
	return _ghostTex;
}
