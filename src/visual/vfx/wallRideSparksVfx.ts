import * as THREE from "three";

import { getActiveArenaNeonHex } from "../../arena/arenaNeonAccent";

const MAX = 24;

/** Iskry przy jeździe po ścianie / rampie. */
export class WallRideSparksVfx {
	private readonly points: THREE.Points;
	private readonly positions: Float32Array;
	private readonly life = new Float32Array(MAX);
	private readonly vel: THREE.Vector3[] = [];
	private write = 0;

	constructor(scene: THREE.Scene) {
		this.positions = new Float32Array(MAX * 3);
		for (let i = 0; i < MAX; i++) {
			this.vel.push(new THREE.Vector3());
			this.positions[i * 3 + 1] = -900;
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
		const mat = new THREE.PointsMaterial({
			color: 0xffcc66,
			size: 0.14,
			transparent: true,
			opacity: 0.85,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			sizeAttenuation: true,
		});
		this.points = new THREE.Points(geo, mat);
		this.points.frustumCulled = false;
		scene.add(this.points);
	}

	private readonly _tangent = new THREE.Vector3();
	private readonly _vel = new THREE.Vector3();

	emit(
		worldPos: THREE.Vector3,
		speed: number,
		dt: number,
		surfaceNormal?: THREE.Vector3,
		carVel?: THREE.Vector3,
	): void {
		if (speed < 7 || dt <= 0) return;
		const count = Math.min(5, Math.floor(speed / 6.5));
		const n =
			surfaceNormal && surfaceNormal.lengthSq() > 1e-6
				? surfaceNormal.clone().normalize()
				: new THREE.Vector3(0, 1, 0);
		if (carVel && carVel.lengthSq() > 0.5) {
			this._tangent.copy(carVel).addScaledVector(n, -carVel.dot(n));
			if (this._tangent.lengthSq() < 1e-6) this._tangent.set(1, 0, 0);
			else this._tangent.normalize();
		} else {
			this._tangent.set(1, 0, 0);
		}
		for (let k = 0; k < count; k++) {
			const i = this.write++ % MAX;
			const i3 = i * 3;
			this.positions[i3] =
				worldPos.x + n.x * 0.12 + (Math.random() - 0.5) * 0.35;
			this.positions[i3 + 1] = worldPos.y + n.y * 0.12 + 0.06;
			this.positions[i3 + 2] =
				worldPos.z + n.z * 0.12 + (Math.random() - 0.5) * 0.35;
			this.life[i] = 0.18 + Math.random() * 0.14;
			this._vel
				.copy(this._tangent)
				.multiplyScalar(-(2 + Math.random() * 5) * (speed / 14))
				.addScaledVector(n, 1.5 + Math.random() * 3);
			this.vel[i]!.copy(this._vel);
		}
	}

	update(dt: number): void {
		(this.points.material as THREE.PointsMaterial).color.setHex(
			getActiveArenaNeonHex(),
		);
		let any = false;
		for (let i = 0; i < MAX; i++) {
			if (this.life[i] <= 0) continue;
			any = true;
			this.life[i] -= dt;
			const i3 = i * 3;
			this.positions[i3] += this.vel[i]!.x * dt;
			this.positions[i3 + 1] += this.vel[i]!.y * dt;
			this.positions[i3 + 2] += this.vel[i]!.z * dt;
			this.vel[i]!.y -= 12 * dt;
			if (this.life[i] <= 0) this.positions[i3 + 1] = -900;
		}
		(
			this.points.geometry.getAttribute("position") as THREE.BufferAttribute
		).needsUpdate = true;
		this.points.visible = any;
	}

	dispose(): void {
		this.points.geometry.dispose();
		(this.points.material as THREE.Material).dispose();
		this.points.removeFromParent();
	}
}
