import * as THREE from "three";

import { ExplosionKit } from "./explosionKit";

const SHARD_COUNT = 128;
const SMOKE_COUNT = 56;
const MAX_LIFE = 0.72;

type ShardSlot = {
	active: boolean;
	life: number;
	pos: THREE.Vector3;
	vel: THREE.Vector3;
	rot: THREE.Euler;
	rotVel: THREE.Vector3;
	scale: number;
};

/** Odłamki + dym przy demolish — InstancedMesh (jeden draw call) + quarks burst. */
export class DemoDebrisVfx {
	private readonly root = new THREE.Group();
	private readonly shards: THREE.InstancedMesh;
	private readonly smoke: THREE.Points;
	private readonly smokePositions: Float32Array;
	private readonly smokeVel: THREE.Vector3[] = [];
	private readonly slots: ShardSlot[] = [];
	private readonly explosion: ExplosionKit;
	private readonly _matrix = new THREE.Matrix4();
	private readonly _quat = new THREE.Quaternion();
	private readonly _scale = new THREE.Vector3();
	private readonly _euler = new THREE.Euler();
	private life = 0;
	private smokeLife = 0;

	constructor(scene: THREE.Scene) {
		this.root.name = "demoDebris";
		scene.add(this.root);
		this.explosion = new ExplosionKit(scene);

		const shardGeo = new THREE.BoxGeometry(0.05, 0.04, 0.07);
		const shardMat = new THREE.MeshBasicMaterial({
			color: 0xff8844,
			transparent: true,
			opacity: 0.92,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		this.shards = new THREE.InstancedMesh(shardGeo, shardMat, SHARD_COUNT);
		this.shards.frustumCulled = false;
		this.shards.renderOrder = 14;
		this.root.add(this.shards);

		for (let i = 0; i < SHARD_COUNT; i++) {
			this.slots.push({
				active: false,
				life: 0,
				pos: new THREE.Vector3(),
				vel: new THREE.Vector3(),
				rot: new THREE.Euler(),
				rotVel: new THREE.Vector3(),
				scale: 1,
			});
			this._matrix.makeScale(0, 0, 0);
			this.shards.setMatrixAt(i, this._matrix);
		}
		this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

		this.smokePositions = new Float32Array(SMOKE_COUNT * 3);
		const smokeGeo = new THREE.BufferGeometry();
		smokeGeo.setAttribute(
			"position",
			new THREE.BufferAttribute(this.smokePositions, 3),
		);
		const smokeMat = new THREE.PointsMaterial({
			color: 0xffaa66,
			size: 0.34,
			transparent: true,
			opacity: 0.88,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			sizeAttenuation: true,
		});
		this.smoke = new THREE.Points(smokeGeo, smokeMat);
		this.smoke.frustumCulled = false;
		this.smoke.renderOrder = 13;
		this.root.add(this.smoke);
		for (let i = 0; i < SMOKE_COUNT; i++) {
			this.smokeVel.push(new THREE.Vector3());
		}

		this.root.visible = false;
	}

	trigger(worldPos: THREE.Vector3, team: "blue" | "orange", impact = 14): void {
		const color = team === "blue" ? 0x66ddff : 0xff8844;
		const hot = team === "blue" ? 0xd8f8ff : 0xffcc88;
		(this.shards.material as THREE.MeshBasicMaterial).color.setHex(
			Math.random() > 0.35 ? hot : color,
		);
		(this.smoke.material as THREE.PointsMaterial).color.setHex(
			team === "blue" ? 0x9ed8ff : 0xffaa66,
		);

		const k = THREE.MathUtils.clamp((impact - 10) / 10, 0.5, 1.5);
		this.life = MAX_LIFE;
		this.smokeLife = MAX_LIFE * 0.92;
		this.root.position.set(0, 0, 0);
		this.root.visible = true;
		this.explosion.trigger(
			worldPos,
			"demo",
			new THREE.Color(team === "blue" ? 0x66ddff : 0xff8844),
		);

		for (let i = 0; i < SHARD_COUNT; i++) {
			const slot = this.slots[i]!;
			slot.active = true;
			slot.life = 0.48 + Math.random() * 0.38;
			slot.scale = 0.65 + Math.random() * 1.1;
			slot.pos.set(
				worldPos.x + (Math.random() - 0.5) * 0.9,
				worldPos.y + 0.12 + Math.random() * 0.55,
				worldPos.z + (Math.random() - 0.5) * 0.9,
			);
			const theta = Math.random() * Math.PI * 2;
			const phi = Math.acos(2 * Math.random() - 1);
			const spd = (16 + Math.random() * 32) * k;
			slot.vel.set(
				Math.sin(phi) * Math.cos(theta) * spd,
				Math.abs(Math.cos(phi)) * spd * 0.75 + 4 + Math.random() * 6,
				Math.sin(phi) * Math.sin(theta) * spd,
			);
			slot.rot.set(
				Math.random() * Math.PI,
				Math.random() * Math.PI,
				Math.random() * Math.PI,
			);
			slot.rotVel.set(
				(Math.random() - 0.5) * 14,
				(Math.random() - 0.5) * 14,
				(Math.random() - 0.5) * 14,
			);
		}

		for (let i = 0; i < SMOKE_COUNT; i++) {
			const i3 = i * 3;
			const a = Math.random() * Math.PI * 2;
			const r = 0.1 + Math.random() * 0.45;
			this.smokePositions[i3] = worldPos.x + Math.cos(a) * r;
			this.smokePositions[i3 + 1] = worldPos.y + 0.08 + Math.random() * 0.2;
			this.smokePositions[i3 + 2] = worldPos.z + Math.sin(a) * r;
			const vel = this.smokeVel[i]!;
			vel.set(
				(Math.random() - 0.5) * 4 * k,
				2.5 + Math.random() * 5 * k,
				(Math.random() - 0.5) * 4 * k,
			);
		}
		(
			this.smoke.geometry.getAttribute("position") as THREE.BufferAttribute
		).needsUpdate = true;
	}

	update(dt: number): void {
		this.explosion.update(dt);
		if (this.life <= 0) {
			this.root.visible = false;
			return;
		}
		this.life -= dt;
		this.smokeLife = Math.max(0, this.smokeLife - dt);
		const globalFade = THREE.MathUtils.clamp(this.life / MAX_LIFE, 0, 1);

		let anyShard = false;
		for (let i = 0; i < SHARD_COUNT; i++) {
			const slot = this.slots[i]!;
			if (!slot.active || slot.life <= 0) {
				this._matrix.makeScale(0, 0, 0);
				this.shards.setMatrixAt(i, this._matrix);
				continue;
			}

			slot.life -= dt;
			if (slot.life <= 0) {
				slot.active = false;
				this._matrix.makeScale(0, 0, 0);
				this.shards.setMatrixAt(i, this._matrix);
				continue;
			}

			anyShard = true;
			slot.pos.addScaledVector(slot.vel, dt);
			slot.vel.y -= 25 * dt;
			slot.vel.multiplyScalar(0.985);
			slot.rot.x += slot.rotVel.x * dt;
			slot.rot.y += slot.rotVel.y * dt;
			slot.rot.z += slot.rotVel.z * dt;

			const fade = (slot.life / 0.86) * globalFade;
			const s = slot.scale * fade;
			this._euler.copy(slot.rot);
			this._quat.setFromEuler(this._euler);
			this._scale.set(s, s * 0.8, s * 1.1);
			this._matrix.compose(slot.pos, this._quat, this._scale);
			this.shards.setMatrixAt(i, this._matrix);
		}
		this.shards.instanceMatrix.needsUpdate = true;
		(this.shards.material as THREE.MeshBasicMaterial).opacity =
			0.92 * globalFade;

		if (this.smokeLife > 0) {
			for (let i = 0; i < SMOKE_COUNT; i++) {
				const i3 = i * 3;
				const vel = this.smokeVel[i]!;
				this.smokePositions[i3]! += vel.x * dt;
				this.smokePositions[i3 + 1]! += vel.y * dt;
				this.smokePositions[i3 + 2]! += vel.z * dt;
				vel.y += 1.8 * dt;
				vel.multiplyScalar(0.97);
			}
			(
				this.smoke.geometry.getAttribute("position") as THREE.BufferAttribute
			).needsUpdate = true;
			(this.smoke.material as THREE.PointsMaterial).opacity =
				0.88 * (this.smokeLife / (MAX_LIFE * 0.92));
			this.smoke.visible = true;
		} else {
			this.smoke.visible = false;
		}

		this.shards.visible = anyShard;
		if (!anyShard && this.smokeLife <= 0) {
			this.root.visible = false;
		}
	}

	dispose(): void {
		this.explosion.dispose();
		this.shards.geometry.dispose();
		(this.shards.material as THREE.Material).dispose();
		this.smoke.geometry.dispose();
		(this.smoke.material as THREE.Material).dispose();
		this.root.removeFromParent();
	}
}
