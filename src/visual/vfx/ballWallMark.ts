import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import type { ColliderTag, GameAudio } from "../../audio/GameAudio";
import type GameObject from "../../GameObject";
import { RL_BALL } from "../../util/rlConstants";
import { RL_ARENA } from "../arenaConstants";
import type { HitVfx } from "./hitVfx";

const MAX_MARKS = 48;
const MARK_LIFE = 1.35;
const MARK_MIN_FORCE = 7;
const COOLDOWN_MS = 36;

/** Od tej odległości marker zaczyna się pojawiać (jak RL). */
const PROX_START = 5.8;
/** Pełna jasność tuż przy ścianie. */
const PROX_FULL = 1.35;
const WALL_SURFACE_INSET = 0.055;
const LIVE_MARK_BASE = 1.05;

type WallMark = {
	mesh: THREE.Mesh;
	life: number;
	maxLife: number;
	baseScale: number;
};

type WallCandidate = {
	dist: number;
	normal: THREE.Vector3;
	point: THREE.Vector3;
};

let markTex: THREE.Texture | null = null;

/** RL-style ring — jasny środek, neonowa obwódka, miękki zanik. */
function wallMarkTexture(): THREE.Texture {
	if (markTex) return markTex;

	const size = 128;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;

	const cx = size / 2;
	const cy = size / 2;
	const ring = ctx.createRadialGradient(
		cx,
		cy,
		size * 0.08,
		cx,
		cy,
		size * 0.5,
	);
	ring.addColorStop(0, "rgba(180, 255, 255, 0.95)");
	ring.addColorStop(0.22, "rgba(120, 240, 255, 0.72)");
	ring.addColorStop(0.42, "rgba(60, 200, 255, 0.38)");
	ring.addColorStop(0.58, "rgba(40, 160, 255, 0.55)");
	ring.addColorStop(0.72, "rgba(20, 120, 220, 0.22)");
	ring.addColorStop(1, "rgba(0, 0, 0, 0)");
	ctx.fillStyle = ring;
	ctx.fillRect(0, 0, size, size);

	const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.14);
	core.addColorStop(0, "rgba(255, 255, 255, 0.9)");
	core.addColorStop(0.55, "rgba(200, 250, 255, 0.35)");
	core.addColorStop(1, "rgba(0, 0, 0, 0)");
	ctx.globalCompositeOperation = "lighter";
	ctx.fillStyle = core;
	ctx.fillRect(0, 0, size, size);

	markTex = new THREE.CanvasTexture(canvas);
	markTex.colorSpace = THREE.SRGBColorSpace;
	markTex.minFilter = THREE.LinearFilter;
	markTex.magFilter = THREE.LinearFilter;
	markTex.generateMipmaps = false;
	return markTex;
}

function classifyBallWall(k1: ColliderTag, k2: ColliderTag): boolean {
	const tags = new Set([k1, k2]);
	return tags.has("ball") && !tags.has("player");
}

function createMarkMaterial(tex: THREE.Texture): THREE.MeshBasicMaterial {
	return new THREE.MeshBasicMaterial({
		map: tex,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		opacity: 0,
		side: THREE.DoubleSide,
	});
}

/**
 * Ślad piłki na ścianie (jak w Rocket League):
 * - żywy marker gdy piłka jest blisko klatki
 * - trwały ring po uderzeniu
 */
export class BallWallMarkVfx {
	private readonly marks: WallMark[] = [];
	private readonly markGeo = new THREE.PlaneGeometry(1, 1);
	private readonly liveMark: THREE.Mesh;
	private readonly scratchNormal = new THREE.Vector3();
	private readonly scratchPos = new THREE.Vector3();
	private readonly scratchVel = new THREE.Vector3();
	private readonly scratchQuat = new THREE.Quaternion();
	private readonly wallProbe: WallCandidate = {
		dist: Number.POSITIVE_INFINITY,
		normal: new THREE.Vector3(),
		point: new THREE.Vector3(),
	};
	private readonly cooldown = new Map<string, number>();
	private liveAlpha = 0;
	private liveScale = LIVE_MARK_BASE;

	constructor(
		private readonly scene: THREE.Scene,
		private readonly sparkVfx: HitVfx | null = null,
	) {
		const tex = wallMarkTexture();
		this.liveMark = new THREE.Mesh(this.markGeo, createMarkMaterial(tex));
		this.liveMark.visible = false;
		this.liveMark.renderOrder = 12;
		this.scene.add(this.liveMark);

		for (let i = 0; i < MAX_MARKS; i++) {
			const mesh = new THREE.Mesh(this.markGeo, createMarkMaterial(tex));
			mesh.visible = false;
			mesh.renderOrder = 11;
			this.scene.add(mesh);
			this.marks.push({ mesh, life: 0, maxLife: 0, baseScale: 1 });
		}
	}

	warmup(): void {
		this.scratchPos.set(0, -500, 0);
		this.spawnImpact(this.scratchPos, this.scratchNormal.set(0, 0, 1), 0.4);
		this.update(0.02);
		this.clearGpuWarmup();
	}

	primeGpuDraw(ballPos: THREE.Vector3, ballVel: THREE.Vector3): THREE.Object3D {
		this.scratchPos
			.copy(ballPos)
			.setX(RL_ARENA.HALF_WIDTH - RL_BALL.radius - 1.8);
		this.updateBallProximity(this.scratchPos, ballVel, 1 / 60);
		this.spawnImpact(this.scratchPos, this.scratchNormal.set(-1, 0, 0), 0.65);
		this.updateImpactMarks(0.02);
		return this.liveMark;
	}

	clearGpuWarmup(): void {
		for (const slot of this.marks) {
			slot.life = 0;
			slot.mesh.visible = false;
		}
		this.liveMark.visible = false;
		this.liveAlpha = 0;
		this.cooldown.clear();
	}

	handleContactForce(
		event: RAPIER.TempContactForceEvent,
		_world: RAPIER.World,
		audio: GameAudio,
		ball: GameObject,
	): void {
		const force = event.totalForceMagnitude();
		if (force < MARK_MIN_FORCE) return;

		const h1 = event.collider1();
		const h2 = event.collider2();
		const k1 = audio.getColliderTag(h1);
		const k2 = audio.getColliderTag(h2);
		if (!classifyBallWall(k1, k2)) return;

		const pairKey = h1 < h2 ? `${h1}-${h2}` : `${h2}-${h1}`;
		const now = performance.now();
		const last = this.cooldown.get(pairKey) ?? 0;
		if (now - last < COOLDOWN_MS) return;
		this.cooldown.set(pairKey, now);

		const intensity = THREE.MathUtils.clamp(
			(force - MARK_MIN_FORCE) / 68,
			0.12,
			1,
		);
		const ballPos = ball.getPosition();
		const wall = this.findNearestWall(ballPos, RL_BALL.radius);
		if (wall) {
			this.spawnImpact(wall.point, wall.normal, Math.max(intensity, 0.55));
			if (this.sparkVfx && force >= 18) {
				this.sparkVfx.trigger(wall.point, intensity * 22, {
					normal: wall.normal,
				});
			}
			return;
		}

		const dir = event.maxForceDirection();
		this.scratchNormal.set(dir.x, dir.y, dir.z);
		if (this.scratchNormal.lengthSq() < 1e-6) {
			this.estimateWallNormal(ballPos, this.scratchNormal);
		} else {
			this.scratchNormal.normalize();
		}
		this.scratchPos.copy(ballPos);
		this.spawnImpact(this.scratchPos, this.scratchNormal, intensity);
		if (this.sparkVfx && force >= 18) {
			this.sparkVfx.trigger(this.scratchPos, intensity * 22, {
				normal: this.scratchNormal,
			});
		}
	}

	/** Co klatkę — marker podąża za piłką przy ścianie / suficie. */
	updateBallProximity(
		ballPos: THREE.Vector3,
		ballVel: THREE.Vector3,
		dt: number,
	): void {
		this.updateImpactMarks(dt);

		const wall = this.findNearestWall(ballPos, RL_BALL.radius);
		if (!wall || wall.dist > PROX_START) {
			this.liveAlpha = THREE.MathUtils.damp(this.liveAlpha, 0, 14, dt);
			if (this.liveAlpha < 0.02) {
				this.liveMark.visible = false;
			} else {
				const mat = this.liveMark.material as THREE.MeshBasicMaterial;
				mat.opacity = this.liveAlpha;
			}
			return;
		}

		const proximity =
			1 - THREE.MathUtils.smoothstep(wall.dist, PROX_FULL, PROX_START);
		this.scratchVel.copy(ballVel);
		const approach = Math.max(0, -this.scratchVel.dot(wall.normal));
		const speedBoost = THREE.MathUtils.clamp(approach / 18, 0, 0.45);
		const targetAlpha = THREE.MathUtils.clamp(
			proximity * (0.42 + speedBoost),
			0,
			0.92,
		);
		this.liveAlpha = THREE.MathUtils.damp(this.liveAlpha, targetAlpha, 18, dt);

		const sizeMul =
			THREE.MathUtils.lerp(0.72, 1.18, proximity) * (1 + speedBoost * 0.15);
		this.liveScale = THREE.MathUtils.damp(
			this.liveScale,
			LIVE_MARK_BASE * sizeMul,
			12,
			dt,
		);

		this.applyLiveMark(wall.point, wall.normal, dt);
	}

	update(dt: number): void {
		this.updateImpactMarks(dt);
		this.liveAlpha = THREE.MathUtils.damp(this.liveAlpha, 0, 14, dt);
		if (this.liveAlpha < 0.02) this.liveMark.visible = false;
	}

	private applyLiveMark(
		point: THREE.Vector3,
		normal: THREE.Vector3,
		_dt: number,
	): void {
		this.orientMark(this.liveMark, point, normal);
		this.liveMark.visible = true;
		const mat = this.liveMark.material as THREE.MeshBasicMaterial;
		mat.opacity = this.liveAlpha;
		mat.color.setRGB(0.78, 0.96, 1);
		this.liveMark.scale.set(this.liveScale, this.liveScale, 1);
	}

	private findNearestWall(
		ballPos: THREE.Vector3,
		ballRadius: number,
	): WallCandidate | null {
		const { HALF_WIDTH, HALF_LENGTH, HEIGHT } = RL_ARENA;
		const px = ballPos.x;
		const py = ballPos.y;
		const pz = ballPos.z;
		const clampY = THREE.MathUtils.clamp(py, 0.2, HEIGHT - 0.2);

		let bestDist = PROX_START + 1;

		const consider = (
			dist: number,
			nx: number,
			ny: number,
			nz: number,
			sx: number,
			sy: number,
			sz: number,
		): void => {
			if (dist < 0 || dist > PROX_START || dist >= bestDist) return;
			bestDist = dist;
			this.wallProbe.dist = dist;
			this.wallProbe.normal.set(nx, ny, nz);
			this.wallProbe.point.set(sx, sy, sz);
		};

		consider(HALF_WIDTH - px - ballRadius, -1, 0, 0, HALF_WIDTH, clampY, pz);
		consider(px + HALF_WIDTH - ballRadius, 1, 0, 0, -HALF_WIDTH, clampY, pz);
		consider(HALF_LENGTH - pz - ballRadius, 0, 0, -1, px, clampY, HALF_LENGTH);
		consider(pz + HALF_LENGTH - ballRadius, 0, 0, 1, px, clampY, -HALF_LENGTH);
		consider(HEIGHT - py - ballRadius, 0, -1, 0, px, HEIGHT, pz);

		if (bestDist > PROX_START) return null;
		return this.wallProbe;
	}

	private estimateWallNormal(pos: THREE.Vector3, out: THREE.Vector3): void {
		const ax = Math.abs(pos.x) / RL_ARENA.HALF_WIDTH;
		const az = Math.abs(pos.z) / RL_ARENA.HALF_LENGTH;
		const ay = pos.y / RL_ARENA.HEIGHT;
		if (ay > Math.max(ax, az) && pos.y > RL_ARENA.HEIGHT * 0.45) {
			out.set(0, -1, 0);
			return;
		}
		if (ax > az) {
			out.set(Math.sign(pos.x) || 1, 0, 0).multiplyScalar(-1);
		} else {
			out.set(0, 0, Math.sign(pos.z) || 1).multiplyScalar(-1);
		}
	}

	private orientMark(
		mesh: THREE.Mesh,
		point: THREE.Vector3,
		normal: THREE.Vector3,
	): void {
		const n = this.scratchNormal.copy(normal).normalize();
		this.scratchQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
		mesh.position.copy(point).addScaledVector(n, WALL_SURFACE_INSET);
		mesh.quaternion.copy(this.scratchQuat);
	}

	private spawnImpact(
		point: THREE.Vector3,
		normal: THREE.Vector3,
		intensity: number,
	): void {
		const slot = this.marks.find((m) => m.life <= 0);
		if (!slot) return;

		this.orientMark(slot.mesh, point, normal);

		const size = THREE.MathUtils.lerp(0.55, 1.55, intensity);
		slot.baseScale = size;
		slot.mesh.scale.set(size, size, 1);
		slot.maxLife = MARK_LIFE * (0.75 + intensity * 0.45);
		slot.life = slot.maxLife;
		slot.mesh.visible = true;

		const mat = slot.mesh.material as THREE.MeshBasicMaterial;
		mat.opacity = THREE.MathUtils.lerp(0.5, 0.98, intensity);
		mat.color.setRGB(0.75 + intensity * 0.2, 0.95 + intensity * 0.05, 1);
	}

	private updateImpactMarks(dt: number): void {
		for (const slot of this.marks) {
			if (slot.life <= 0) continue;
			slot.life -= dt;
			if (slot.life <= 0) {
				slot.mesh.visible = false;
				continue;
			}

			const t = slot.life / slot.maxLife;
			const mat = slot.mesh.material as THREE.MeshBasicMaterial;
			mat.opacity = t * t * 0.92;
			const grow = 1 + (1 - t) * 0.12;
			slot.mesh.scale.set(slot.baseScale * grow, slot.baseScale * grow, 1);
		}
	}

	dispose(): void {
		for (const slot of this.marks) {
			this.scene.remove(slot.mesh);
			(slot.mesh.material as THREE.Material).dispose();
		}
		this.scene.remove(this.liveMark);
		(this.liveMark.material as THREE.Material).dispose();
		this.markGeo.dispose();
	}
}
