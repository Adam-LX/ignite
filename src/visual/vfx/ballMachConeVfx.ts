import * as THREE from "three";

const MACH_THRESHOLD = 35;
const RING_LIFE = 0.32;

/** Sonic boom — 3 pierścienie przy bardzo szybkiej piłce. */
export class BallMachConeVfx {
	private readonly rings: THREE.Mesh[] = [];
	private life = 0;
	private wasMach = false;

	constructor(scene: THREE.Scene) {
		for (let i = 0; i < 3; i++) {
			const mat = new THREE.MeshBasicMaterial({
				color: i === 0 ? 0xffffff : i === 1 ? 0xa8f0ff : 0x55c8ff,
				transparent: true,
				opacity: 0.7,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				side: THREE.DoubleSide,
				toneMapped: false,
			});
			const inner = 0.55 + i * 0.18;
			const ring = new THREE.Mesh(
				new THREE.RingGeometry(inner, inner + 0.55, 48),
				mat,
			);
			ring.rotation.x = -Math.PI / 2;
			ring.visible = false;
			ring.frustumCulled = false;
			ring.renderOrder = 20 + i;
			scene.add(ring);
			this.rings.push(ring);
		}
	}

	update(ballPos: THREE.Vector3, speedMps: number, dt: number): void {
		const mach = speedMps >= MACH_THRESHOLD;
		if (mach && !this.wasMach) {
			for (const ring of this.rings) {
				ring.position.copy(ballPos);
				ring.visible = true;
				ring.scale.setScalar(0.4);
			}
			this.life = RING_LIFE;
		}
		this.wasMach = mach;

		if (this.life <= 0) {
			for (const ring of this.rings) ring.visible = false;
			return;
		}
		this.life -= dt;
		const t = 1 - this.life / RING_LIFE;
		for (let i = 0; i < this.rings.length; i++) {
			const ring = this.rings[i]!;
			const delay = i * 0.12;
			const localT = THREE.MathUtils.clamp((t - delay) / (1 - delay), 0, 1);
			ring.position.copy(ballPos);
			ring.scale.setScalar(0.4 + localT * (2.8 + i * 0.9));
			(ring.material as THREE.MeshBasicMaterial).opacity =
				(0.72 - i * 0.14) * (1 - localT) ** 1.35;
			ring.visible = localT < 1 && localT >= 0;
		}
	}

	dispose(): void {
		for (const ring of this.rings) {
			ring.geometry.dispose();
			(ring.material as THREE.Material).dispose();
			ring.removeFromParent();
		}
	}
}
