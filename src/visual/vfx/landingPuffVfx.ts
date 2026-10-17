import * as THREE from "three";

import type { ScoringTeam } from "../../game/modes";

const PUFF_DURATION = 0.42;

/** Pył / pierścień uderzenia przy lądowaniu auta. */
export class LandingPuffVfx {
	private readonly root = new THREE.Group();
	private readonly ring: THREE.Mesh;
	private readonly dust: THREE.Points;
	private readonly dustPositions: Float32Array;
	private life = 0;
	private intensity = 0;

	constructor(scene: THREE.Scene, team: ScoringTeam) {
		this.root.name = "landingPuff";
		scene.add(this.root);

		const ringColor = team === "blue" ? 0x8ed8ff : 0xffb080;
		const ringMat = new THREE.MeshBasicMaterial({
			color: ringColor,
			transparent: true,
			opacity: 0.68,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
		});
		this.ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.95, 48), ringMat);
		this.ring.rotation.x = -Math.PI / 2;
		this.root.add(this.ring);

		this.dustPositions = new Float32Array(54);
		const dustMat = new THREE.PointsMaterial({
			color: team === "blue" ? 0xc8ecff : 0xffdcc0,
			size: 0.22,
			transparent: true,
			opacity: 0.72,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			sizeAttenuation: true,
		});
		const dustGeo = new THREE.BufferGeometry();
		dustGeo.setAttribute(
			"position",
			new THREE.BufferAttribute(this.dustPositions, 3),
		);
		this.dust = new THREE.Points(dustGeo, dustMat);
		this.dust.frustumCulled = false;
		this.root.add(this.dust);

		this.root.visible = false;
	}

	trigger(worldPos: THREE.Vector3, intensity: number): void {
		if (intensity < 0.12) return;
		this.intensity = THREE.MathUtils.clamp(intensity, 0.15, 1);
		this.root.position.copy(worldPos);
		this.root.position.y = Math.max(0.06, worldPos.y - 0.42);
		this.root.visible = true;
		this.life = PUFF_DURATION;

		for (let i = 0; i < 18; i++) {
			const i3 = i * 3;
			const a = Math.random() * Math.PI * 2;
			const r = 0.12 + Math.random() * 0.85 * this.intensity;
			this.dustPositions[i3] = Math.cos(a) * r;
			this.dustPositions[i3 + 1] = 0.02 + Math.random() * 0.12;
			this.dustPositions[i3 + 2] = Math.sin(a) * r;
		}
		(
			this.dust.geometry.getAttribute("position") as THREE.BufferAttribute
		).needsUpdate = true;

		this.ring.scale.setScalar(0.25 + this.intensity * 0.2);
		(this.ring.material as THREE.MeshBasicMaterial).opacity =
			0.62 + this.intensity * 0.38;
	}

	update(dt: number): void {
		if (this.life <= 0) {
			this.root.visible = false;
			return;
		}
		this.life -= dt;
		const t = 1 - this.life / PUFF_DURATION;
		const scale = 0.25 + t * (5.2 + this.intensity * 4.2);
		this.ring.scale.setScalar(scale);
		(this.ring.material as THREE.MeshBasicMaterial).opacity =
			(0.62 + this.intensity * 0.38) * (1 - t) ** 1.35;

		const dustMat = this.dust.material as THREE.PointsMaterial;
		dustMat.opacity = 0.9 * this.intensity * (1 - t) ** 1.05;
		for (let i = 0; i < 18; i++) {
			const i3 = i * 3;
			this.dustPositions[i3 + 1] += dt * (1.4 + this.intensity * 2.8);
			this.dustPositions[i3] *= 1 + dt * 1.8;
			this.dustPositions[i3 + 2] *= 1 + dt * 1.8;
		}
		(
			this.dust.geometry.getAttribute("position") as THREE.BufferAttribute
		).needsUpdate = true;
	}

	dispose(): void {
		this.root.removeFromParent();
		this.ring.geometry.dispose();
		(this.ring.material as THREE.Material).dispose();
		this.dust.geometry.dispose();
		(this.dust.material as THREE.Material).dispose();
	}
}
