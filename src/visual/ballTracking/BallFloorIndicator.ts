import * as THREE from "three";

import type { ScoringTeam } from "../../game/modes";
import { ballPaletteForTeam } from "../ballTeamVisual";

const FLOOR_Y = 0.03;
const BASE_SCALE = 1.32;
const HEIGHT_FACTOR = 0.2;
const ARROW_SPEED_MIN = 0.65;

/** RL-style neonowy pierścień na murawie + strzałka kierunku lotu. */
export class BallFloorIndicator {
	readonly root = new THREE.Group();
	private readonly ring: THREE.Mesh;
	private readonly halo: THREE.Mesh;
	private readonly arrow: THREE.Mesh;
	private readonly scratchVel = new THREE.Vector3();

	constructor(ballRadius: number) {
		this.root.name = "ballFloorIndicator";

		const inner = ballRadius * 0.48;
		const outer = ballRadius * 1.35;
		const ringGeo = new THREE.RingGeometry(inner, outer, 56);
		const ringMat = new THREE.MeshBasicMaterial({
			color: 0x66ffee,
			transparent: true,
			opacity: 1,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide,
			toneMapped: false,
		});
		this.ring = new THREE.Mesh(ringGeo, ringMat);
		this.ring.rotation.x = -Math.PI / 2;
		this.ring.renderOrder = 4;
		this.ring.frustumCulled = false;

		const haloGeo = new THREE.RingGeometry(
			ballRadius * 1.2,
			ballRadius * 1.85,
			48,
		);
		const haloMat = new THREE.MeshBasicMaterial({
			color: 0x44aaff,
			transparent: true,
			opacity: 0.68,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide,
			toneMapped: false,
		});
		this.halo = new THREE.Mesh(haloGeo, haloMat);
		this.halo.rotation.x = -Math.PI / 2;
		this.halo.position.y = -0.002;
		this.halo.renderOrder = 3;
		this.halo.frustumCulled = false;

		const arrowShape = new THREE.Shape();
		arrowShape.moveTo(0, ballRadius * 0.42);
		arrowShape.lineTo(-ballRadius * 0.18, -ballRadius * 0.1);
		arrowShape.lineTo(0, ballRadius * 0.04);
		arrowShape.lineTo(ballRadius * 0.18, -ballRadius * 0.1);
		arrowShape.closePath();
		const arrowGeo = new THREE.ShapeGeometry(arrowShape);
		const arrowMat = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: 1,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide,
			toneMapped: false,
		});
		this.arrow = new THREE.Mesh(arrowGeo, arrowMat);
		this.arrow.rotation.x = -Math.PI / 2;
		this.arrow.position.y = 0.005;
		this.arrow.renderOrder = 5;
		this.arrow.frustumCulled = false;
		this.arrow.visible = false;

		this.root.add(this.halo, this.ring, this.arrow);
	}

	private teamRingColor = 0x66ffee;
	private teamArrowColor = 0xffffff;

	setTeamTint(team: ScoringTeam | null): void {
		const palette = ballPaletteForTeam(team);
		this.teamRingColor = palette.emissive;
		this.teamArrowColor = palette.trailCore;
	}

	update(ballPos: THREE.Vector3, ballVel: THREE.Vector3): void {
		this.root.position.set(ballPos.x, FLOOR_Y, ballPos.z);

		const height = Math.max(0, ballPos.y);
		const heightFade = THREE.MathUtils.clamp(1 - height / 16, 0.45, 1);
		const scale = (BASE_SCALE + height * HEIGHT_FACTOR) * heightFade;
		this.ring.scale.set(scale, scale, 1);
		this.halo.scale.set(scale * 1.05, scale * 1.05, 1);
		const ringMat = this.ring.material as THREE.MeshBasicMaterial;
		const haloMat = this.halo.material as THREE.MeshBasicMaterial;
		ringMat.opacity = 1 * heightFade;
		haloMat.opacity = 0.55 * heightFade;
		ringMat.color.setHex(this.teamRingColor);
		haloMat.color.setHex(this.teamRingColor);

		this.scratchVel.copy(ballVel);
		this.scratchVel.y = 0;
		const speed = this.scratchVel.length();
		if (speed >= ARROW_SPEED_MIN) {
			this.arrow.visible = true;
			this.arrow.rotation.z = -Math.atan2(this.scratchVel.x, this.scratchVel.z);
			this.arrow.scale.set(scale * 0.9, scale * 0.9, 1);
			(this.arrow.material as THREE.MeshBasicMaterial).color.setHex(
				this.teamArrowColor,
			);
		} else {
			this.arrow.visible = false;
		}
	}

	dispose(): void {
		this.ring.geometry.dispose();
		(this.ring.material as THREE.Material).dispose();
		this.halo.geometry.dispose();
		(this.halo.material as THREE.Material).dispose();
		this.arrow.geometry.dispose();
		(this.arrow.material as THREE.Material).dispose();
	}
}
