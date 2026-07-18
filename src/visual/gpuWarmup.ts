import * as THREE from "three";

import type GameObject from "../GameObject";
import type Renderer from "../Renderer";
import type Scene from "../Scene";
import { resolveGraphicsSettings } from "../util/graphicsProfile";
import type { BallShadow } from "./ballShadow";
import {
	resetBallHitFlash,
	updateBallHitFlash,
	warmupBallGpuTexture,
} from "./materials";
import {
	clearPowerUpPickupGpuWarmup,
	primePowerUpPickupGpu,
} from "./powerUpPickupModel";
import type { BallVfx } from "./vfx/ballVfx";
import type { BallWallMarkVfx } from "./vfx/ballWallMark";
import { glowTexture } from "./vfx/glowTexture";
import type { HitVfx } from "./vfx/hitVfx";

function warmupFrameCount(): number {
	return resolveGraphicsSettings().warmupFrames;
}
const WARMUP_DT = 1 / 60;
const HIDDEN = new THREE.Vector3(0, -800, 0);

function yieldToBrowser(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export type GameplayGpuWarmupDeps = {
	ball: GameObject;
	ballVfx: BallVfx;
	hitVfx: HitVfx;
	ballShadow: BallShadow;
	ballWallMarkVfx: BallWallMarkVfx;
};

export async function warmupGpu(
	renderer: Renderer,
	scene: Scene,
): Promise<void> {
	await yieldToBrowser();
	const gl = renderer.threeJSRenderer;
	gl.initTexture(glowTexture());
	warmupBallGpuTexture(gl);
	warmupRenderFrame(renderer, scene);
}

export function warmupRenderFrame(renderer: Renderer, scene: Scene): void {
	renderer.render(scene);
}

/** Lekki warmup shaderów VFX — bez compile(), bloom-spike i PointLight. */
export async function warmupGameplayGpu(
	renderer: Renderer,
	scene: Scene,
	deps: GameplayGpuWarmupDeps,
): Promise<void> {
	const { ball, ballVfx, hitVfx, ballShadow, ballWallMarkVfx } = deps;
	const ballPos = ball.getPosition();
	const prevVel = ball.rapierRigidBody.linvel();
	const warmupVel = new THREE.Vector3(0, 0, 22);

	warmupBallGpuTexture(renderer.threeJSRenderer);
	ballVfx.primeGpuDraw(ball);
	hitVfx.primeGpuDraw(HIDDEN);
	ballWallMarkVfx.primeGpuDraw(HIDDEN, warmupVel);
	const powerUpWarmup = primePowerUpPickupGpu(scene.threeJSScene);

	await yieldToBrowser();

	for (let i = 0; i < warmupFrameCount(); i++) {
		ballVfx.update(ball, WARMUP_DT);
		hitVfx.update(WARMUP_DT);
		updateBallHitFlash(WARMUP_DT);
		ballShadow.update(ballPos);
		warmupRenderFrame(renderer, scene);
		await yieldToBrowser();
	}

	hitVfx.clearGpuWarmup();
	ballVfx.clearGpuWarmup(ball);
	ballWallMarkVfx.clearGpuWarmup();
	clearPowerUpPickupGpuWarmup(scene.threeJSScene, powerUpWarmup);
	resetBallHitFlash();
	ball.rapierRigidBody.setLinvel(prevVel, true);
	ball.syncWithRigidBody();
}
