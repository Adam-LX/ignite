import * as THREE from "three";

import type Player from "../../util/Player";
import { getTrailEntry } from "../../meta/CosmeticCatalog";
import { getEquippedPaintId, getEquippedTrailId } from "../../meta/PlayerInventory";
import { applyPaintToTrailColors } from "../applyPaintCosmetic";

type TrailSegment = {
	mesh: THREE.Mesh;
	material: THREE.MeshBasicMaterial;
	life: number;
	maxLife: number;
};

/** RL: supersonic od 2200 uu/s, wyjście poniżej ~2100 uu/s. */
const SUPERSONIC_ENTER_MPS = 22;
const SUPERSONIC_EXIT_MPS = 21;

const MAX_SEGMENTS = 160;
const SEGMENT_INTERVAL = 0.2;
const SEGMENT_LIFE = 1.45;
const GROUND_LIFT = 0.035;
const REAR_AXLE_OFFSET = 0.62;
const SEGMENT_WIDTH = 0.34;
const SEGMENT_LENGTH = 1.12;

let ribbonTex: THREE.Texture | null = null;

const COLOR_BOOST_HEAD = new THREE.Color(0xb8ffff);
const COLOR_BOOST_CORE = new THREE.Color(0xffeeaa);
const COLOR_BOOST_MID = new THREE.Color(0xff7722);
const COLOR_BOOST_TAIL = new THREE.Color(0xcc4499);

/**
 * Tekstura smugi — kolorowy gradient wzdłuż + miękki zanik na szerokość.
 */
function ribbonTexture(): THREE.Texture {
	if (ribbonTex) return ribbonTex;

	const w = 128;
	const h = 64;
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d")!;

	const along = ctx.createLinearGradient(0, h, 0, 0);
	along.addColorStop(0, "rgba(140, 40, 120, 0)");
	along.addColorStop(0.12, "rgba(200, 70, 150, 0.12)");
	along.addColorStop(0.28, "rgba(255, 100, 50, 0.38)");
	along.addColorStop(0.48, "rgba(255, 200, 90, 0.82)");
	along.addColorStop(0.68, "rgba(200, 255, 255, 0.95)");
	along.addColorStop(0.86, "rgba(255, 255, 255, 0.72)");
	along.addColorStop(1, "rgba(160, 250, 255, 0.55)");
	ctx.fillStyle = along;
	ctx.fillRect(0, 0, w, h);

	const across = ctx.createLinearGradient(0, 0, w, 0);
	across.addColorStop(0, "rgba(255,255,255,0)");
	across.addColorStop(0.22, "rgba(255,255,255,0.08)");
	across.addColorStop(0.42, "rgba(255,255,255,0.55)");
	across.addColorStop(0.5, "rgba(255,255,255,1)");
	across.addColorStop(0.58, "rgba(255,255,255,0.55)");
	across.addColorStop(0.78, "rgba(255,255,255,0.08)");
	across.addColorStop(1, "rgba(255,255,255,0)");
	ctx.globalCompositeOperation = "destination-in";
	ctx.fillStyle = across;
	ctx.fillRect(0, 0, w, h);

	ribbonTex = new THREE.CanvasTexture(canvas);
	ribbonTex.colorSpace = THREE.SRGBColorSpace;
	ribbonTex.minFilter = THREE.LinearFilter;
	ribbonTex.magFilter = THREE.LinearFilter;
	ribbonTex.generateMipmaps = false;
	return ribbonTex;
}

/**
 * Smuga boost / supersonic — gruba przy aucie, cienka w tyle, gradient kolorów.
 */
export class BoostTrail {
	readonly root = new THREE.Group();
	private readonly segments: TrailSegment[] = [];
	private readonly segmentGeo = new THREE.PlaneGeometry(1, 1);
	private readonly colorHead = new THREE.Color(0xffcc66);
	private readonly colorTail = new THREE.Color(0xff6622);
	private readonly colorScratch = new THREE.Color();
	private readonly posScratch = new THREE.Vector3();
	private readonly trailForward = new THREE.Vector3();
	private readonly trailBack = new THREE.Vector3();
	private readonly trailUp = new THREE.Vector3();
	private readonly trailRight = new THREE.Vector3();
	private readonly orientMatrix = new THREE.Matrix4();
	private distAcc = 0;
	private supersonic = false;
	private stamping = false;
	private readonly lastStamp = new THREE.Vector3();

	constructor(scene: THREE.Scene) {
		const tex = ribbonTexture();
		for (let i = 0; i < MAX_SEGMENTS; i++) {
			const mat = new THREE.MeshBasicMaterial({
				map: tex,
				transparent: true,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				opacity: 0,
				side: THREE.DoubleSide,
			});
			const mesh = new THREE.Mesh(this.segmentGeo, mat);
			mesh.visible = false;
			mesh.renderOrder = 12;
			this.root.add(mesh);
			this.segments.push({ mesh, material: mat, life: 0, maxLife: 0 });
		}
		scene.add(this.root);
		this.applyTrailPreset(getEquippedTrailId());
	}

	applyTrailPreset(trailId: string): void {
		const entry = getTrailEntry(trailId);
		const painted = applyPaintToTrailColors(
			getEquippedPaintId("trail"),
			trailId,
		);
		COLOR_BOOST_HEAD.copy(painted.head);
		COLOR_BOOST_CORE.copy(painted.core);
		COLOR_BOOST_MID.copy(painted.mid);
		COLOR_BOOST_TAIL.copy(painted.tail);
		this.colorHead.copy(COLOR_BOOST_HEAD);
		this.colorTail.copy(COLOR_BOOST_TAIL);
		void entry;
	}

	update(player: Player, boosting: boolean, dt: number): void {
		const upY = Math.abs(player.getUpward().y);
		const onGround = player.isOnGround() && upY >= 0.42;
		const airborne = !onGround;
		const vel = player.getVelocity();
		const hSpeed = Math.hypot(vel.x, vel.z);
		this.updateSupersonic(hSpeed);

		const active = (boosting || this.supersonic) && (onGround || airborne);
		if (active) {
			const interval = airborne
				? SEGMENT_INTERVAL * (boosting ? 0.45 : 0.65)
				: boosting && !this.supersonic
					? SEGMENT_INTERVAL * 0.55
					: boosting
						? SEGMENT_INTERVAL * 0.72
						: SEGMENT_INTERVAL;
			const pos = player.getPosition();
			if (!this.stamping) {
				this.stamping = true;
				this.distAcc = interval;
				this.lastStamp.copy(pos);
			}
			this.distAcc += onGround
				? this.horizontalDist(pos, this.lastStamp)
				: this.posScratch.copy(pos).distanceTo(this.lastStamp);
			this.lastStamp.copy(pos);

			while (this.distAcc >= interval) {
				this.distAcc -= interval;
				this.stampSegment(player, boosting, this.supersonic, airborne);
			}
		} else {
			this.stamping = false;
			this.distAcc = 0;
		}

		for (const seg of this.segments) {
			if (seg.life <= 0) continue;
			seg.life -= dt;
			if (seg.life <= 0) {
				seg.mesh.visible = false;
				continue;
			}

			const t = seg.life / seg.maxLife;
			this.applySegmentAppearance(
				seg,
				t,
				boosting,
				this.supersonic,
				airborne,
				hSpeed,
			);
		}
	}

	/** t=1 świeży segment przy aucie, t=0 stary w tyle smugi. */
	private applySegmentAppearance(
		seg: TrailSegment,
		t: number,
		boosting: boolean,
		supersonic: boolean,
		airborne: boolean,
		hSpeed: number,
	): void {
		// t=1 przy aucie, t→0 w tyle — stopniowe zwężanie i zanik.
		const head = t ** 0.42;
		const tailFade = t * t * (0.22 + 0.78 * t);
		const widthMul = THREE.MathUtils.lerp(0.05, 0.92, head);
		const lengthMul = THREE.MathUtils.lerp(0.28, 0.92, head ** 0.55);
		const boostWide = boosting ? 1.06 : 1;
		const airScale = airborne ? 0.82 : 1;

		seg.mesh.scale.set(
			SEGMENT_WIDTH * widthMul * boostWide * airScale,
			SEGMENT_LENGTH * lengthMul * airScale,
			1,
		);

		if (boosting) {
			if (t > 0.62) {
				const u = (t - 0.62) / 0.38;
				this.colorScratch
					.copy(COLOR_BOOST_MID)
					.lerp(COLOR_BOOST_CORE, u * 0.85);
				this.colorScratch.lerp(COLOR_BOOST_HEAD, u * u);
			} else if (t > 0.28) {
				const u = (t - 0.28) / 0.34;
				this.colorScratch.copy(COLOR_BOOST_TAIL).lerp(COLOR_BOOST_MID, u);
			} else {
				const u = t / 0.28;
				this.colorScratch
					.copy(COLOR_BOOST_TAIL)
					.multiplyScalar(0.55 + u * 0.45);
			}
		} else if (supersonic) {
			this.colorScratch.copy(this.colorTail).lerp(this.colorHead, t ** 0.5);
		} else {
			this.colorScratch.copy(this.colorTail).lerp(this.colorHead, t ** 0.55);
		}

		seg.material.color.copy(this.colorScratch);

		const speedFactor = Math.min(1, hSpeed / SUPERSONIC_ENTER_MPS);
		const headGlow = 0.38 + 0.52 * speedFactor;
		const opacityBase = boosting ? 0.74 : supersonic ? 0.52 : 0.42;
		seg.material.opacity = opacityBase * headGlow * tailFade;
	}

	private updateSupersonic(hSpeed: number): void {
		if (this.supersonic) {
			if (hSpeed < SUPERSONIC_EXIT_MPS) this.supersonic = false;
		} else if (hSpeed >= SUPERSONIC_ENTER_MPS) {
			this.supersonic = true;
		}
	}

	private horizontalDist(
		a: THREE.Vector3 | { x: number; y: number; z: number },
		b: THREE.Vector3,
	): number {
		const dx = a.x - b.x;
		const dz = a.z - b.z;
		return Math.hypot(dx, dz);
	}

	private resolveTrailForward(
		player: Player,
		out: THREE.Vector3,
		airborne: boolean,
	): THREE.Vector3 {
		if (airborne) {
			out.copy(player.getForward());
			if (out.lengthSq() < 1e-4) {
				const v = player.getVelocity();
				if (v.lengthSq() > 1e-4) out.copy(v).normalize();
			}
			if (out.lengthSq() < 1e-4) out.set(0, 0, 1);
			return out.normalize();
		}

		out.copy(player.getForward());
		out.y = 0;
		if (out.lengthSq() < 1e-4) {
			const vel = player.getVelocity();
			out.set(vel.x, 0, vel.z);
		}
		if (out.lengthSq() < 1e-4) out.set(0, 0, 1);
		return out.normalize();
	}

	private orientGroundSegment(mesh: THREE.Mesh, forward: THREE.Vector3): void {
		mesh.rotation.order = "XYZ";
		mesh.rotation.x = -Math.PI / 2;
		mesh.rotation.y = 0;
		mesh.rotation.z = Math.atan2(forward.x, forward.z);
	}

	private orientAirSegment(
		mesh: THREE.Mesh,
		forward: THREE.Vector3,
		up: THREE.Vector3,
	): void {
		const f = this.trailForward.copy(forward).normalize();
		const u = this.trailUp.copy(up).normalize();
		const right = this.trailRight.crossVectors(u, f).normalize();
		this.orientMatrix.makeBasis(right, f, u);
		mesh.quaternion.setFromRotationMatrix(this.orientMatrix);
	}

	private stampSegment(
		player: Player,
		boosting: boolean,
		supersonic: boolean,
		airborne: boolean,
	): void {
		const slot = this.segments.find((s) => s.life <= 0);
		if (!slot) return;

		this.resolveTrailForward(player, this.trailForward, airborne);
		this.trailBack.copy(this.trailForward).multiplyScalar(-1);

		this.posScratch.copy(player.getPosition());

		if (airborne) {
			slot.mesh.position
				.copy(this.posScratch)
				.addScaledVector(this.trailBack, REAR_AXLE_OFFSET);
			this.orientAirSegment(slot.mesh, this.trailForward, player.getUpward());
		} else {
			const groundY = this.posScratch.y + GROUND_LIFT;
			slot.mesh.position.set(
				this.posScratch.x + this.trailBack.x * REAR_AXLE_OFFSET,
				groundY,
				this.posScratch.z + this.trailBack.z * REAR_AXLE_OFFSET,
			);
			this.orientGroundSegment(slot.mesh, this.trailForward);
		}

		slot.maxLife =
			SEGMENT_LIFE * (boosting ? 1.05 : 0.92) * (0.88 + Math.random() * 0.22);
		slot.life = slot.maxLife;
		slot.mesh.visible = true;

		this.applySegmentAppearance(
			slot,
			1,
			boosting,
			supersonic,
			airborne,
			player.getVelocity().length(),
		);
	}
}
