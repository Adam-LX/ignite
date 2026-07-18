import * as THREE from "three";

import type { ScoringTeam } from "../../game/modes";
import { ballPaletteForTeam } from "../ballTeamVisual";

const FLOOR_Y = 0.02;
const BASE_SCALE = 1.0;
const HEIGHT_FACTOR = 0.15;
const ARROW_SPEED_MIN = 0.8;

/** RL-style neonowy pierścień na murawie + strzałka kierunku lotu. */
export class BallFloorIndicator {
	readonly root = new THREE.Group();
	private readonly ring: THREE.Mesh;
	private readonly arrow: THREE.Mesh;
	private readonly scratchVel = new THREE.Vector3();

	constructor(ballRadius: number) {
		this.root.name = "ballFloorIndicator";

		const inner = ballRadius * 0.68;
		const outer = ballRadius * 1.08;
		const ringGeo = new THREE.RingGeometry(inner, outer, 48);
		const ringMat = new THREE.MeshBasicMaterial({
			color: 0x44ffee,
			transparent: true,
			opacity: 0.72,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		this.ring = new THREE.Mesh(ringGeo, ringMat);
		this.ring.rotation.x = -Math.PI / 2;
		this.ring.renderOrder = 4;
		this.ring.frustumCulled = false;

		const arrowShape = new THREE.Shape();
		arrowShape.moveTo(0, ballRadius * 0.35);
		arrowShape.lineTo(-ballRadius * 0.14, -ballRadius * 0.08);
		arrowShape.lineTo(0, ballRadius * 0.02);
		arrowShape.lineTo(ballRadius * 0.14, -ballRadius * 0.08);
		arrowShape.closePath();
		const arrowGeo = new THREE.ShapeGeometry(arrowShape);
		const arrowMat = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: 0.95,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		this.arrow = new THREE.Mesh(arrowGeo, arrowMat);
		this.arrow.rotation.x = -Math.PI / 2;
		this.arrow.position.y = 0.004;
		this.arrow.renderOrder = 5;
		this.arrow.frustumCulled = false;
		this.arrow.visible = false;

		this.root.add(this.ring, this.arrow);
	}

	private teamRingColor = 0x44ffee;
	private teamArrowColor = 0xffffff;

	setTeamTint(team: ScoringTeam | null): void {
		const palette = ballPaletteForTeam(team);
		this.teamRingColor = palette.emissive;
		this.teamArrowColor = palette.trailCore;
	}

	update(ballPos: THREE.Vector3, ballVel: THREE.Vector3): void {
		this.root.position.set(ballPos.x, FLOOR_Y, ballPos.z);

		const height = Math.max(0, ballPos.y);
		const heightFade = THREE.MathUtils.clamp(1 - height / 14, 0.25, 1);
		const scale = (BASE_SCALE + height * HEIGHT_FACTOR) * heightFade;
		this.ring.scale.set(scale, scale, 1);
		(this.ring.material as THREE.MeshBasicMaterial).opacity = 0.72 * heightFade;
		(this.ring.material as THREE.MeshBasicMaterial).color.setHex(
			this.teamRingColor,
		);

		this.scratchVel.copy(ballVel);
		this.scratchVel.y = 0;
		const speed = this.scratchVel.length();
		if (speed >= ARROW_SPEED_MIN) {
			this.arrow.visible = true;
			this.arrow.rotation.z = -Math.atan2(this.scratchVel.x, this.scratchVel.z);
			this.arrow.scale.set(scale * 0.85, scale * 0.85, 1);
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
		this.arrow.geometry.dispose();
		(this.arrow.material as THREE.Material).dispose();
	}
}
