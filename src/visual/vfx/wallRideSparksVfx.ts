import * as THREE from "three";

import { getActiveArenaNeonHex } from "../../arena/arenaNeonAccent";

const MAX = 112;

/** Iskry przy jeździe po ścianie / rampie — RL: gęste, krótkie, nie zasłaniają bounce. */
export class WallRideSparksVfx {
	private readonly points: THREE.Points;
	private readonly positions: Float32Array;
	private readonly life = new Float32Array(MAX);
	private readonly vel: THREE.Vector3[] = [];
	private write = 0;
	private readonly _tangent = new THREE.Vector3();
	private readonly _bitangent = new THREE.Vector3();
	private readonly _vel = new THREE.Vector3();
	private readonly _n = new THREE.Vector3();

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
			size: 0.1,
			transparent: true,
			opacity: 0.7,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			sizeAttenuation: true,
		});
		this.points = new THREE.Points(geo, mat);
		this.points.frustumCulled = false;
		scene.add(this.points);
	}

	emit(
		worldPos: THREE.Vector3,
		speed: number,
		dt: number,
		surfaceNormal?: THREE.Vector3,
		carVel?: THREE.Vector3,
	): void {
		if (speed < 5.0 || dt <= 0) return;
		const count = Math.min(18, Math.floor(speed / 2.8) + 2);
		if (surfaceNormal && surfaceNormal.lengthSq() > 1e-6) {
			this._n.copy(surfaceNormal).normalize();
		} else {
			this._n.set(0, 1, 0);
		}
		const n = this._n;
		if (carVel && carVel.lengthSq() > 0.5) {
			this._tangent.copy(carVel).addScaledVector(n, -carVel.dot(n));
			if (this._tangent.lengthSq() < 1e-6) this._tangent.set(1, 0, 0);
			else this._tangent.normalize();
		} else {
			this._tangent.set(1, 0, 0);
		}
		this._bitangent.crossVectors(n, this._tangent).normalize();
		for (let k = 0; k < count; k++) {
			const i = this.write++ % MAX;
			const i3 = i * 3;
			const streak = (Math.random() - 0.35) * 0.55;
			this.positions[i3] =
				worldPos.x +
				n.x * 0.1 +
				this._tangent.x * streak +
				this._bitangent.x * (Math.random() - 0.5) * 0.28;
			this.positions[i3 + 1] =
				worldPos.y +
				n.y * 0.1 +
				this._tangent.y * streak +
				0.04;
			this.positions[i3 + 2] =
				worldPos.z +
				n.z * 0.1 +
				this._tangent.z * streak +
				this._bitangent.z * (Math.random() - 0.5) * 0.28;
			this.life[i] = 0.1 + Math.random() * 0.16;
			this._vel
				.copy(this._tangent)
				.multiplyScalar(-(3.2 + Math.random() * 7.5) * (speed / 14))
				.addScaledVector(n, 1.2 + Math.random() * 2.8)
				.addScaledVector(this._bitangent, (Math.random() - 0.5) * 2.2);
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
			this.vel[i]!.y -= 14 * dt;
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
