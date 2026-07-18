import * as THREE from "three";

const MACH_THRESHOLD = 35;

/** Pierścień sonic boom przy bardzo szybkiej piłce. */
export class BallMachConeVfx {
	private readonly ring: THREE.Mesh;
	private life = 0;
	private wasMach = false;

	constructor(scene: THREE.Scene) {
		const mat = new THREE.MeshBasicMaterial({
			color: 0xa8f0ff,
			transparent: true,
			opacity: 0.75,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		});
		this.ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.6, 48), mat);
		this.ring.rotation.x = -Math.PI / 2;
		this.ring.visible = false;
		scene.add(this.ring);
	}

	update(ballPos: THREE.Vector3, speedMps: number, dt: number): void {
		const mach = speedMps >= MACH_THRESHOLD;
		if (mach && !this.wasMach) {
			this.ring.position.copy(ballPos);
			this.ring.visible = true;
			this.life = 0.35;
			this.ring.scale.setScalar(0.5);
		}
		this.wasMach = mach;

		if (this.life <= 0) {
			this.ring.visible = false;
			return;
		}
		this.life -= dt;
		const t = 1 - this.life / 0.35;
		this.ring.position.copy(ballPos);
		this.ring.scale.setScalar(0.5 + t * 5);
		(this.ring.material as THREE.MeshBasicMaterial).opacity =
			0.75 * (1 - t) ** 1.5;
	}

	dispose(): void {
		this.ring.geometry.dispose();
		(this.ring.material as THREE.Material).dispose();
		this.ring.removeFromParent();
	}
}
