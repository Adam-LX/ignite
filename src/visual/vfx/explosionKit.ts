import * as THREE from "three";
import {
	ApplyForce,
	BatchedRenderer,
	Bezier,
	ColorOverLife,
	ConstantColor,
	ConstantValue,
	Gradient,
	IntervalValue,
	ParticleSystem,
	PiecewiseBezier,
	PointEmitter,
	RenderMode,
	SizeOverLife,
	SphereEmitter,
	Vector3 as QVector3,
	Vector4 as QVector4,
} from "three.quarks";

import { glowTexture } from "./glowTexture";

export type ExplosionPreset = "goal" | "demo" | "crate";

type BurstHandle = {
	sparks: ParticleSystem;
	embers: ParticleSystem;
	smoke: ParticleSystem;
};

function fadeSize(): SizeOverLife {
	return new SizeOverLife(
		new PiecewiseBezier([[new Bezier(1, 0.85, 0.4, 0), 0]]),
	);
}

function rgba(r: number, g: number, b: number, a: number): QVector4 {
	return new QVector4(r, g, b, a);
}

/**
 * Wspólny kit wybuchów (three.quarks) — gole / demo / crate.
 */
export class ExplosionKit {
	private readonly batch = new BatchedRenderer();
	private readonly root = new THREE.Group();
	private readonly bursts = new Map<ExplosionPreset, BurstHandle>();
	private activeUntil = 0;
	private elapsed = 0;

	constructor(scene: THREE.Scene) {
		this.root.name = "explosionKit";
		scene.add(this.root);
		scene.add(this.batch);

		this.bursts.set("goal", this.makeBurst("goal"));
		this.bursts.set("demo", this.makeBurst("demo"));
		this.bursts.set("crate", this.makeBurst("crate"));

		for (const handle of this.bursts.values()) {
			this.stopHandle(handle);
		}
	}

	trigger(
		worldPos: THREE.Vector3,
		preset: ExplosionPreset,
		tint?: THREE.Color,
	): void {
		const handle = this.bursts.get(preset);
		if (!handle) return;

		this.root.position.copy(worldPos);
		this.applyTint(handle, tint);
		this.restartHandle(handle);
		this.elapsed = 0;
		this.activeUntil = preset === "crate" ? 2.8 : preset === "demo" ? 1.6 : 2.2;
	}

	update(dt: number): void {
		this.elapsed += dt;
		this.batch.update(dt);
		if (this.elapsed > this.activeUntil) {
			for (const handle of this.bursts.values()) {
				this.stopHandle(handle);
			}
		}
	}

	dispose(): void {
		for (const handle of this.bursts.values()) {
			this.batch.deleteSystem(handle.sparks);
			this.batch.deleteSystem(handle.embers);
			this.batch.deleteSystem(handle.smoke);
			handle.sparks.dispose();
			handle.embers.dispose();
			handle.smoke.dispose();
		}
		this.bursts.clear();
		this.root.removeFromParent();
		this.batch.removeFromParent();
	}

	private makeBurst(preset: ExplosionPreset): BurstHandle {
		const map = glowTexture();
		const sparkCount = preset === "crate" ? 90 : preset === "demo" ? 70 : 120;
		const emberCount = preset === "crate" ? 40 : 55;
		const smokeCount = preset === "demo" ? 25 : 45;
		const speedHi = preset === "crate" ? 22 : preset === "demo" ? 24 : 32;

		const sparks = new ParticleSystem({
			duration: 0.35,
			looping: false,
			prewarm: false,
			worldSpace: true,
			shape: new SphereEmitter({
				radius: 0.15,
				thickness: 1,
				arc: Math.PI * 2,
			}),
			startLife: new IntervalValue(0.35, 0.85),
			startSpeed: new IntervalValue(14, speedHi),
			startSize: new IntervalValue(0.12, 0.38),
			startColor: new ConstantColor(rgba(1, 0.95, 0.85, 1)),
			emissionOverTime: new ConstantValue(0),
			emissionBursts: [
				{
					time: 0,
					count: new ConstantValue(sparkCount),
					cycle: 1,
					interval: 0.01,
					probability: 1,
				},
			],
			material: new THREE.MeshBasicMaterial({
				map,
				transparent: true,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			}),
			renderMode: RenderMode.BillBoard,
			behaviors: [
				new ApplyForce(new QVector3(0, -6.5, 0), new ConstantValue(1)),
				fadeSize(),
				new ColorOverLife(
					new Gradient(
						[
							[new QVector3(1, 1, 1), 0],
							[new QVector3(1, 0.4, 0.08), 1],
						],
						[
							[1, 0],
							[0, 1],
						],
					),
				),
			],
		});

		const embers = new ParticleSystem({
			duration: 0.4,
			looping: false,
			worldSpace: true,
			shape: new SphereEmitter({
				radius: 0.35,
				thickness: 1,
				arc: Math.PI * 2,
			}),
			startLife: new IntervalValue(0.55, 1.35),
			startSpeed: new IntervalValue(4, 12),
			startSize: new IntervalValue(0.25, 0.7),
			startColor: new ConstantColor(rgba(1, 0.55, 0.15, 0.95)),
			emissionOverTime: new ConstantValue(0),
			emissionBursts: [
				{
					time: 0.02,
					count: new ConstantValue(emberCount),
					cycle: 1,
					interval: 0.01,
					probability: 1,
				},
			],
			material: new THREE.MeshBasicMaterial({
				map,
				transparent: true,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
			}),
			renderMode: RenderMode.BillBoard,
			behaviors: [
				new ApplyForce(new QVector3(0, -3.2, 0), new ConstantValue(1)),
				fadeSize(),
			],
		});

		const smoke = new ParticleSystem({
			duration: 0.5,
			looping: false,
			worldSpace: true,
			shape: new PointEmitter(),
			startLife: new IntervalValue(0.9, 1.8),
			startSpeed: new IntervalValue(1.2, 3.5),
			startSize: new IntervalValue(0.8, 2.2),
			startColor: new ConstantColor(rgba(0.35, 0.38, 0.45, 0.35)),
			emissionOverTime: new ConstantValue(0),
			emissionBursts: [
				{
					time: 0.05,
					count: new ConstantValue(smokeCount),
					cycle: 1,
					interval: 0.01,
					probability: 1,
				},
			],
			material: new THREE.MeshBasicMaterial({
				map,
				transparent: true,
				blending: THREE.NormalBlending,
				depthWrite: false,
			}),
			renderMode: RenderMode.BillBoard,
			behaviors: [
				new ApplyForce(new QVector3(0, 1.4, 0), new ConstantValue(1)),
				new SizeOverLife(
					new PiecewiseBezier([[new Bezier(0.7, 1.1, 1.5, 1.9), 0]]),
				),
				new ColorOverLife(
					new Gradient(
						[
							[new QVector3(0.4, 0.42, 0.48), 0],
							[new QVector3(0.2, 0.22, 0.28), 1],
						],
						[
							[0.4, 0],
							[0, 1],
						],
					),
				),
			],
		});

		for (const sys of [sparks, embers, smoke]) {
			this.root.add(sys.emitter);
			this.batch.addSystem(sys);
		}

		return { sparks, embers, smoke };
	}

	private applyTint(handle: BurstHandle, tint?: THREE.Color): void {
		const c = tint ?? new THREE.Color(0xffaa55);
		handle.embers.startColor = new ConstantColor(rgba(c.r, c.g, c.b, 0.95));
	}

	private restartHandle(handle: BurstHandle): void {
		for (const sys of [handle.sparks, handle.embers, handle.smoke]) {
			sys.stop();
			sys.restart();
			sys.play();
		}
	}

	private stopHandle(handle: BurstHandle): void {
		for (const sys of [handle.sparks, handle.embers, handle.smoke]) {
			sys.stop();
			sys.endEmit();
		}
	}
}
