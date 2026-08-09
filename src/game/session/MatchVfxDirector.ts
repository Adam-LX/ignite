import type * as THREE from "three";
import { DemoDebrisVfx } from "../../visual/vfx/demoDebrisVfx";
import { DemolishShockwaveVfx } from "../../visual/vfx/demolishShockwaveVfx";
import { EpicSaveShockwaveVfx } from "../../visual/vfx/epicSaveShockwaveVfx";
import { FlipResetRingVfx } from "../../visual/vfx/flipResetRingVfx";
import { ImpactGroundMarkVfx } from "../../visual/vfx/impactGroundMark";
import { PostHitSparksVfx } from "../../visual/vfx/postHitSparksVfx";

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
	}

	update(dt: number): void {
		this.flipResetRing?.update(dt);
		this.demoDebris?.update(dt);
		this.demolishShockwave?.update(dt);
		this.epicSaveShockwave?.update(dt);
		this.postHitSparks?.update(dt);
		this.impactGroundMarks?.update(dt);
	}

	dispose(): void {
		this.flipResetRing = null;
		this.impactGroundMarks = null;
		this.demoDebris = null;
		this.demolishShockwave = null;
		this.epicSaveShockwave = null;
		this.postHitSparks = null;
	}
}
