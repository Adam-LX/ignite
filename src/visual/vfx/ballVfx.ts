import * as THREE from "three";

import type GameObject from "../../GameObject";
import { createBallMaterial } from "../materials";
import { PlasmaBallTrail } from "../Trail";

/**
 * Efekty piłki — materiał PBR + przestrzenny ogon plazmowy (THREE.Points).
 */
export class BallVfx {
	private readonly plasmaTrail: PlasmaBallTrail;
	private readonly ballMaterial = createBallMaterial();
	private ballMaterialApplied = false;
	private readonly scratchVel = new THREE.Vector3();
	private readonly scratchPos = new THREE.Vector3();
	private readonly warmupVel = new THREE.Vector3(0, 0, 24);

	constructor(
		_ballMesh: THREE.Object3D,
		scene: THREE.Scene,
		_ballRadius: number,
	) {
		this.plasmaTrail = new PlasmaBallTrail(scene);
	}

	warmup(): void {
		this.plasmaTrail.warmup();
	}

	/** Materiał piłki + trail — przed pierwszym uderzeniem. */
	primeGpuDraw(ball: GameObject): THREE.Object3D[] {
		if (!this.ballMaterialApplied) {
			this.applyOpaqueBallMaterial(ball.threeJSGroup);
		}
		const pos = ball.getPosition();
		this.plasmaTrail.primeGpuDraw(pos, this.warmupVel);
		return [ball.threeJSGroup, ...this.plasmaTrail.getDrawables()];
	}

	clearGpuWarmup(ball: GameObject): void {
		this.plasmaTrail.warmup();
		this.scratchVel.set(0, 0, 0);
		this.plasmaTrail.update(ball.getPosition(), this.scratchVel, 0);
	}

	resetTrail(): void {
		this.plasmaTrail.warmup();
	}

	update(ball: GameObject, dt: number): void {
		const vel = this.scratchVel.copy(ball.getVelocity());
		const pos = this.scratchPos.copy(ball.getPosition());

		if (!this.ballMaterialApplied) {
			this.applyOpaqueBallMaterial(ball.threeJSGroup);
		}

		this.plasmaTrail.update(pos, vel, dt);
	}

	private applyOpaqueBallMaterial(root: THREE.Object3D): void {
		root.visible = true;
		root.traverse((child) => {
			if (child instanceof THREE.Light) {
				child.visible = false;
				child.intensity = 0;
				return;
			}
			child.visible = true;
			if (!(child instanceof THREE.Mesh)) return;
			if (child.userData.ballOpaque) return;

			const prev = child.material;
			if (prev !== this.ballMaterial) {
				if (Array.isArray(prev)) {
					for (const m of prev) {
						if (m !== this.ballMaterial) m.dispose();
					}
				} else if (
					prev instanceof THREE.Material &&
					prev !== this.ballMaterial
				) {
					prev.dispose();
				}
			}

			child.material = this.ballMaterial;
			child.castShadow = true;
			child.receiveShadow = true;
			child.renderOrder = 0;
			child.userData.ballOpaque = true;
		});
		this.ballMaterialApplied = true;
	}

	dispose(): void {
		this.plasmaTrail.dispose();
	}
}
