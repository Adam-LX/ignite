/**
 * Pre-match FX warstwa 2: gobo na murawie, reveal piłki, spotlight na auta.
 */
import * as THREE from "three";

import type GameObject from "../../GameObject";
import type { CarEntity } from "../../game/CarEntity";
import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "../arenaConstants";

const BLUE = new THREE.Color(0x66c8ff);
const ORANGE = new THREE.Color(0xffa34a);
const ICE = new THREE.Color(0xe8f6ff);

type GoboSpot = {
	light: THREE.SpotLight;
	target: THREE.Object3D;
	phase: number;
	speed: number;
	radius: number;
};

/**
 * Sweepujące snopy + reveal piłki + team intro.
 */
export class StadiumShowFx {
	readonly root = new THREE.Group();
	private readonly gobos: GoboSpot[] = [];
	private readonly ballLight: THREE.SpotLight;
	private readonly ballTarget: THREE.Object3D;
	private readonly carLights: THREE.SpotLight[] = [];
	private readonly carTargets: THREE.Object3D[] = [];
	private ball: GameObject | null = null;
	private cars: CarEntity[] = [];
	private ballReveal = 0;
	private carIntro = 0;
	private ballBaseY = 0.4;

	constructor() {
		this.root.name = "stadiumShowFx";

		for (let i = 0; i < 2; i++) {
			const target = new THREE.Object3D();
			this.root.add(target);
			const light = new THREE.SpotLight(
				i % 2 === 0 ? BLUE : ORANGE,
				0,
				90,
				0.32,
				0.55,
				1.2,
			);
			light.castShadow = false;
			light.position.set(
				(i < 2 ? -1 : 1) * RL_ARENA.HALF_WIDTH * 0.55,
				RL_ARENA.HEIGHT - 1.5,
				(i % 2 === 0 ? -1 : 1) * RL_ARENA.HALF_LENGTH * 0.35,
			);
			light.target = target;
			this.root.add(light);
			this.gobos.push({
				light,
				target,
				phase: i * 1.7,
				speed: 0.55 + i * 0.22,
				radius: 10 + (i % 2) * 4,
			});
		}

		this.ballTarget = new THREE.Object3D();
		this.root.add(this.ballTarget);
		this.ballLight = new THREE.SpotLight(ICE, 0, 40, 0.28, 0.4, 1);
		this.ballLight.castShadow = false;
		this.ballLight.position.set(0, RL_ARENA.HEIGHT - 2, 0);
		this.ballLight.target = this.ballTarget;
		this.root.add(this.ballLight);
	}

	bind(ball: GameObject | null | undefined, cars: CarEntity[] | undefined): void {
		this.ball = ball ?? null;
		this.cars = cars ?? [];
		for (const L of this.carLights) {
			L.removeFromParent();
			L.dispose();
		}
		for (const t of this.carTargets) t.removeFromParent();
		this.carLights.length = 0;
		this.carTargets.length = 0;

		const list = this.cars.slice(0, 8);
		for (const car of list) {
			const team = car.visualTeam ?? car.team ?? "blue";
			const target = new THREE.Object3D();
			this.root.add(target);
			const light = new THREE.SpotLight(
				team === "orange" ? ORANGE : BLUE,
				0,
				28,
				0.38,
				0.45,
				1.4,
			);
			light.castShadow = false;
			light.position.set(0, 12, 0);
			light.target = target;
			this.root.add(light);
			this.carLights.push(light);
			this.carTargets.push(target);
		}

		if (this.ball) {
			const p = this.ball.getPosition();
			this.ballBaseY = Math.max(PLAYFIELD_SURFACE_Y + 0.35, p.y);
			this.ball.threeJSGroup.visible = false;
		}
	}

	update(dt: number, showU: number, pulse: number): void {
		const hw = RL_ARENA.HALF_WIDTH;
		const hl = RL_ARENA.HALF_LENGTH;
		const floor = PLAYFIELD_SURFACE_Y + 0.05;

		/** Gobo: pełne widowisko — kolorowe snopy przez cały show. */
		let goboAmt = 0;
		if (showU > 0.1 && showU < 0.9) {
			goboAmt = THREE.MathUtils.smoothstep(showU, 0.08, 0.22);
			if (showU >= 0.26) goboAmt = Math.max(goboAmt, 0.9);
			if (showU > 0.46 && showU < 0.68) {
				goboAmt *= 0.85;
			}
			if (showU > 0.78) {
				goboAmt *= 1 - THREE.MathUtils.smoothstep(showU, 0.78, 0.9);
			}
			goboAmt *= 0.7 + pulse * 0.55;
		}
		for (const g of this.gobos) {
			const ang = showU * 14 * g.speed + g.phase;
			g.target.position.set(
				Math.sin(ang) * g.radius * (hw / 22),
				floor,
				Math.cos(ang * 0.85) * g.radius * (hl / 28),
			);
			g.target.position.x = THREE.MathUtils.clamp(
				g.target.position.x,
				-hw * 0.85,
				hw * 0.85,
			);
			g.target.position.z = THREE.MathUtils.clamp(
				g.target.position.z,
				-hl * 0.85,
				hl * 0.85,
			);
			/** Kolorowe gobo — warstwa widowiska pod laserami. */
			g.light.intensity = goboAmt * (3.2 + pulse * 1.5);
			g.light.angle = 0.26 + pulse * 0.05;
		}

		/** Team intro — po DROP, w rain (nie myje tunelu). */
		const carWin =
			THREE.MathUtils.smoothstep(showU, 0.66, 0.72) *
			(1 - THREE.MathUtils.smoothstep(showU, 0.8, 0.88));
		this.carIntro = THREE.MathUtils.lerp(this.carIntro, carWin, 1 - Math.exp(-dt * 6));
		for (let i = 0; i < this.carLights.length; i++) {
			const car = this.cars[i];
			const light = this.carLights[i]!;
			const target = this.carTargets[i]!;
			if (!car) {
				light.intensity = 0;
				continue;
			}
			const p = car.player.getPosition();
			target.position.set(p.x, PLAYFIELD_SURFACE_Y + 0.1, p.z);
			light.position.set(p.x, p.y + 9.5, p.z);
			/** Niższa intensywność — aerial lasers zostają bohaterem kadru. */
			light.intensity = this.carIntro * (3.5 + pulse * 1.5);
		}

		/** Ball reveal — podnosi się i dostaje snop tuż przed settle. */
		const revealT = THREE.MathUtils.smoothstep(showU, 0.78, 0.9);
		this.ballReveal = THREE.MathUtils.lerp(
			this.ballReveal,
			revealT,
			1 - Math.exp(-dt * 5),
		);
		if (this.ball) {
			const showBall = this.ballReveal > 0.05;
			this.ball.threeJSGroup.visible = showBall;
			const lift = THREE.MathUtils.lerp(0, 2.4, this.ballReveal);
			const spin = this.ballReveal * Math.PI * 2.2;
			this.ball.rapierRigidBody.setTranslation(
				{ x: 0, y: this.ballBaseY + lift, z: 0 },
				true,
			);
			this.ball.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
			this.ball.rapierRigidBody.setAngvel({ x: 0, y: spin * 0.35, z: 0 }, true);
			this.ball.threeJSGroup.rotation.y = spin;
			this.ballTarget.position.set(0, this.ballBaseY + lift, 0);
			this.ballLight.position.set(0, RL_ARENA.HEIGHT - 3, 0);
			this.ballLight.intensity = this.ballReveal * (22 + pulse * 12);
			this.ballLight.color.lerpColors(ICE, ORANGE, pulse * 0.35);
		} else {
			this.ballLight.intensity = 0;
		}
	}

	/** Po show — przywróć piłkę na kickoff (nie ruszaj aut). */
	restoreBallForKickoff(): void {
		if (!this.ball) return;
		this.ball.rapierRigidBody.setTranslation(
			{ x: 0, y: this.ballBaseY, z: 0 },
			true,
		);
		this.ball.rapierRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
		this.ball.rapierRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
		this.ball.threeJSGroup.visible = true;
		this.ball.threeJSGroup.rotation.set(0, 0, 0);
	}

	dispose(): void {
		for (const g of this.gobos) {
			g.light.dispose();
		}
		this.ballLight.dispose();
		for (const L of this.carLights) L.dispose();
		this.root.removeFromParent();
	}
}
