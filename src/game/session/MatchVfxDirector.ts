import type * as THREE from "three";
import { CrowdImpostorsVfx } from "../../visual/stadium/crowdImpostors";
import { bindCrowdImpostors } from "../../visual/crowdSurge";
import { BallTurfDustVfx } from "../../visual/vfx/ballTurfDustVfx";
import { DemoDebrisVfx } from "../../visual/vfx/demoDebrisVfx";
import { DemolishShockwaveVfx } from "../../visual/vfx/demolishShockwaveVfx";
import { EpicSaveShockwaveVfx } from "../../visual/vfx/epicSaveShockwaveVfx";
import { FlipResetRingVfx } from "../../visual/vfx/flipResetRingVfx";
import { ImpactGroundMarkVfx } from "../../visual/vfx/impactGroundMark";
import { PostHitSparksVfx } from "../../visual/vfx/postHitSparksVfx";
import { PLAYFIELD_SURFACE_Y } from "../../visual/arenaConstants";

/**
 * Lazy juice VFX bag for match moments (flip reset, demo, post-hit, …).
 */
export class MatchVfxDirector {
	flipResetRing: FlipResetRingVfx | null = null;
	impactGroundMarks: ImpactGroundMarkVfx | null = null;
	demoDebris: DemoDebrisVfx | null = null;
	demolishShockwave: DemolishShockwaveVfx | null = null;
	epicSaveShockwave: EpicSaveShockwaveVfx | null = null;
	postHitSparks: PostHitSparksVfx | null = null;
	ballTurfDust: BallTurfDustVfx | null = null;
	crowdImpostors: CrowdImpostorsVfx | null = null;

	private prevBallVy = 0;
	private ballWasAirborne = false;

	ensureJuice(scene: THREE.Scene): void {
		if (!this.flipResetRing) {
			this.flipResetRing = new FlipResetRingVfx(scene);
		}
		if (!this.demoDebris) {
			this.demoDebris = new DemoDebrisVfx(scene);
		}
		if (!this.demolishShockwave) {
			this.demolishShockwave = new DemolishShockwaveVfx(scene);
		}
		if (!this.epicSaveShockwave) {
			this.epicSaveShockwave = new EpicSaveShockwaveVfx(scene);
		}
		if (!this.postHitSparks) {
			this.postHitSparks = new PostHitSparksVfx(scene);
		}
		if (!this.impactGroundMarks) {
			this.impactGroundMarks = new ImpactGroundMarkVfx(scene);
		}
		if (!this.ballTurfDust) {
			this.ballTurfDust = new BallTurfDustVfx(scene);
		}
		if (!this.crowdImpostors) {
			this.crowdImpostors = new CrowdImpostorsVfx(scene);
			bindCrowdImpostors(this.crowdImpostors);
		}
	}

	/** Bounce pyłu gdy piłka uderza w murawę. */
	sampleBallGround(
		pos: THREE.Vector3,
		vel: THREE.Vector3,
		ballRadius: number,
	): void {
		const clearance = pos.y - (PLAYFIELD_SURFACE_Y + ballRadius);
		const nearTurf = clearance < 0.35;
		const impact = Math.abs(this.prevBallVy);
		if (
			nearTurf &&
			this.ballWasAirborne &&
			this.prevBallVy < -3.8 &&
			vel.y > this.prevBallVy * 0.15
		) {
			this.ballTurfDust?.trigger(pos, impact);
		}
		this.ballWasAirborne = clearance > 0.2 || this.prevBallVy < -1;
		this.prevBallVy = vel.y;
	}

	update(dt: number): void {
		this.flipResetRing?.update(dt);
		this.demoDebris?.update(dt);
		this.demolishShockwave?.update(dt);
		this.epicSaveShockwave?.update(dt);
		this.postHitSparks?.update(dt);
		this.impactGroundMarks?.update(dt);
		this.ballTurfDust?.update(dt);
		this.crowdImpostors?.update(dt);
	}

	dispose(): void {
		this.flipResetRing?.dispose();
		this.impactGroundMarks?.dispose();
		this.demoDebris?.dispose();
		this.demolishShockwave?.dispose();
		this.epicSaveShockwave?.dispose();
		this.postHitSparks?.dispose();
		this.ballTurfDust?.dispose();
		this.crowdImpostors?.dispose();
		bindCrowdImpostors(null);
		this.flipResetRing = null;
		this.impactGroundMarks = null;
		this.demoDebris = null;
		this.demolishShockwave = null;
		this.epicSaveShockwave = null;
		this.postHitSparks = null;
		this.ballTurfDust = null;
		this.crowdImpostors = null;
	}
}
