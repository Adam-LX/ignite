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

const MAX_SEGMENTS = 220;
const SEGMENT_INTERVAL = 0.09;
const SEGMENT_LIFE = 1.55;
const GROUND_LIFT = 0.035;
const REAR_AXLE_OFFSET = 0.62;
const SEGMENT_WIDTH = 0.28;
const SEGMENT_LENGTH = 0.85;

/** Jedna wstęga w powietrzu — stemple to pionowe kreski przy locie w górę. */
const AIR_MAX_POINTS = 72;
const AIR_STEP = 0.16;
const AIR_LIFE = 1.25;
const AIR_HALF_WIDTH = 0.42;

let ribbonTex: THREE.Texture | null = null;

/** RL default Octane flame: hot yellow → orange → dark red (nie magenta). */
const COLOR_BOOST_HEAD = new THREE.Color(0xfff6c8);
const COLOR_BOOST_CORE = new THREE.Color(0xffcc55);
const COLOR_BOOST_MID = new THREE.Color(0xff6a18);
const COLOR_BOOST_TAIL = new THREE.Color(0x7a1800);
/** RL supersonic: jasna biała smuga (nie team tint) — core bliżej pure white. */
const COLOR_SS_CORE = new THREE.Color(0xf8fbff);
const COLOR_SS_TAIL = new THREE.Color(0xd0daf0);

const AIR_RIBBON_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const AIR_RIBBON_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uBoost;
varying vec2 vUv;

float hash21(vec2 p) {
	p = fract(p * vec2(127.1, 311.7));
	p += dot(p, p + 19.19);
	return fract(p.x * p.y);
}

void main() {
	vec4 tex = texture2D(uMap, vUv);
	float edge = abs(vUv.x - 0.5) * 2.0;
	float soft = pow(1.0 - clamp(edge, 0.0, 1.0), 1.65);
	float along = vUv.y;
	float n = hash21(vec2(vUv.x * 8.0, along * 20.0 - uTime * 14.0));
	float flick = mix(0.85, 1.2, n);
	vec3 col = mix(uColor * 0.55, uColor, soft * (0.55 + along * 0.45));
	col = mix(col, vec3(1.1, 1.05, 0.95), soft * soft * uBoost * 0.45);
	float alpha = tex.a * uOpacity * soft * flick * (0.35 + along * 0.75);
	if (alpha < 0.01) discard;
	gl_FragColor = vec4(col, alpha);
}
`;

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
	along.addColorStop(0.18, "rgba(200, 70, 150, 0.04)");
	along.addColorStop(0.32, "rgba(255, 100, 50, 0.22)");
	along.addColorStop(0.5, "rgba(255, 200, 90, 0.7)");
	along.addColorStop(0.7, "rgba(200, 255, 255, 0.92)");
	along.addColorStop(0.88, "rgba(255, 255, 255, 0.7)");
	along.addColorStop(1, "rgba(160, 250, 255, 0.5)");
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
	private readonly trailAlong = new THREE.Vector3();
	private readonly trailMid = new THREE.Vector3();
	private readonly trailUp = new THREE.Vector3();
	private readonly trailRight = new THREE.Vector3();
	private readonly worldUp = new THREE.Vector3(0, 1, 0);
	private readonly worldX = new THREE.Vector3(1, 0, 0);
	private readonly orientMatrix = new THREE.Matrix4();
	private distAcc = 0;
	private supersonic = false;
	private stamping = false;
	private readonly lastStamp = new THREE.Vector3();
	private readonly airMesh: THREE.Mesh;
	private readonly airMat: THREE.ShaderMaterial;
	private readonly airGeo = new THREE.BufferGeometry();
	private readonly airPos = new Float32Array(AIR_MAX_POINTS * 2 * 3);
	private readonly airUv = new Float32Array(AIR_MAX_POINTS * 2 * 2);
	private readonly airPts: THREE.Vector3[] = [];
	private readonly airBorn: number[] = [];
	private airHead = 0;
	private airCount = 0;
	private airClock = 0;
	private readonly airLast = new THREE.Vector3();
	private airTracking = false;
	private readonly camRight = new THREE.Vector3();
	/** Światło smugi — fill na murawę / auta wokół (MeshBasic trail sam nie świeci). */
	private readonly trailHeadLight: THREE.PointLight;
	private readonly trailBodyLight: THREE.PointLight;
	private lightSmoothed = 0;

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
				toneMapped: false,
			});
			const mesh = new THREE.Mesh(this.segmentGeo, mat);
			mesh.name = "boostTrailSegment";
			mesh.visible = false;
			mesh.renderOrder = 12;
			mesh.userData.skipPitchReflection = true;
			this.root.add(mesh);
			this.segments.push({ mesh, material: mat, life: 0, maxLife: 0 });
		}

		for (let i = 0; i < AIR_MAX_POINTS; i++) {
			this.airPts.push(new THREE.Vector3());
			this.airBorn.push(0);
		}
		const idx = new Uint16Array((AIR_MAX_POINTS - 1) * 6);
		for (let i = 0; i < AIR_MAX_POINTS - 1; i++) {
			const a = i * 2;
			const o = i * 6;
			idx[o] = a;
			idx[o + 1] = a + 1;
			idx[o + 2] = a + 2;
			idx[o + 3] = a + 1;
			idx[o + 4] = a + 3;
			idx[o + 5] = a + 2;
		}
		this.airGeo.setAttribute(
			"position",
			new THREE.BufferAttribute(this.airPos, 3),
		);
		this.airGeo.setAttribute("uv", new THREE.BufferAttribute(this.airUv, 2));
		this.airGeo.setIndex(new THREE.BufferAttribute(idx, 1));
		this.airMat = new THREE.ShaderMaterial({
			uniforms: {
				uMap: { value: tex },
				uColor: { value: COLOR_BOOST_CORE.clone() },
				uOpacity: { value: 0.68 },
				uTime: { value: 0 },
				uBoost: { value: 1 },
			},
			vertexShader: AIR_RIBBON_VERT,
			fragmentShader: AIR_RIBBON_FRAG,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
			toneMapped: false,
		});
		this.airMesh = new THREE.Mesh(this.airGeo, this.airMat);
		this.airMesh.name = "boostAirRibbon";
		this.airMesh.visible = false;
		this.airMesh.renderOrder = 12;
		this.airMesh.frustumCulled = false;
		this.airMesh.userData.skipPitchReflection = true;
		this.root.add(this.airMesh);

		this.trailHeadLight = new THREE.PointLight(0xffcc55, 0, 9.5, 1.75);
		this.trailHeadLight.name = "boostTrailHeadLight";
		this.trailHeadLight.castShadow = false;
		this.trailHeadLight.userData.skipPitchReflection = true;
		this.root.add(this.trailHeadLight);

		this.trailBodyLight = new THREE.PointLight(0xff6a18, 0, 13, 2.05);
		this.trailBodyLight.name = "boostTrailBodyLight";
		this.trailBodyLight.castShadow = false;
		this.trailBodyLight.userData.skipPitchReflection = true;
		this.root.add(this.trailBodyLight);

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

	update(
		player: Player,
		boosting: boolean,
		dt: number,
		camera?: THREE.Camera,
	): void {
		const upY = Math.abs(player.getUpward().y);
		const firmlyFlat = player.isOnGround() && upY >= 0.82;
		const airborne = !firmlyFlat;
		const vel = player.getVelocity();
		const hSpeed = Math.hypot(vel.x, vel.z);
		this.updateSupersonic(hSpeed);
		this.airClock += dt;

		const active = boosting || this.supersonic;
		const pos = player.getPosition();

		if (active && airborne) {
			this.stamping = false;
			this.distAcc = 0;
			this.pushAirPoint(player, pos, camera);
		} else {
			this.airTracking = false;
			this.expireAirPoints();
			this.rebuildAirRibbon(camera, boosting);
		}

		if (active && firmlyFlat) {
			/**
			 * RL: pomarańczowa smuga przy boost na ziemi; biała przy SS.
			 * (Wcześniej tylko SS — ginął klasyczny ground flame trail.)
			 */
			const interval = boosting
				? this.supersonic
					? SEGMENT_INTERVAL * 0.48
					: SEGMENT_INTERVAL * 0.4
				: SEGMENT_INTERVAL * 0.82;
			if (!this.stamping) {
				this.stamping = true;
				this.distAcc = 0;
				this.lastStamp.copy(pos);
			} else {
				this.trailAlong.copy(pos).sub(this.lastStamp);
				this.trailAlong.y = 0;
				const moved = this.trailAlong.length();
				if (moved > 1e-5) {
					this.trailAlong.multiplyScalar(1 / moved);
					this.distAcc += moved;
					while (this.distAcc >= interval) {
						this.posScratch
							.copy(this.lastStamp)
							.addScaledVector(this.trailAlong, interval);
						this.stampRibbon(
							player,
							boosting,
							this.supersonic,
							true,
							camera,
							this.lastStamp,
							this.posScratch,
							this.trailAlong,
							interval,
						);
						this.lastStamp.copy(this.posScratch);
						this.distAcc -= interval;
					}
				}
			}
		} else {
			this.stamping = false;
			this.distAcc = 0;
		}

		if (active && airborne) {
			this.expireAirPoints();
			this.rebuildAirRibbon(camera, boosting);
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
				false,
				hSpeed,
			);
		}

		this.updateTrailLights(player, pos, firmlyFlat, boosting, active, hSpeed, dt);
	}

	/** Fill od smugi: head przy dyszach + body wzdłuż śladu na murawie. */
	private updateTrailLights(
		player: Player,
		pos: THREE.Vector3,
		firmlyFlat: boolean,
		boosting: boolean,
		active: boolean,
		hSpeed: number,
		dt: number,
	): void {
		this.lightSmoothed = THREE.MathUtils.damp(
			this.lightSmoothed,
			active ? 1 : 0,
			11,
			dt,
		);
		if (this.lightSmoothed < 0.01) {
			this.trailHeadLight.intensity = 0;
			this.trailBodyLight.intensity = 0;
			return;
		}

		this.trailBack.copy(player.getForward()).multiplyScalar(-REAR_AXLE_OFFSET);
		this.trailHeadLight.position.copy(pos).add(this.trailBack);
		this.trailHeadLight.position.y =
			(firmlyFlat ? pos.y : pos.y) + (firmlyFlat ? 0.42 : 0.28);

		this.trailAlong.copy(player.getForward()).normalize().multiplyScalar(-1);
		const bodyBack = firmlyFlat ? 2.6 : 1.8;
		this.trailBodyLight.position
			.copy(this.trailHeadLight.position)
			.addScaledVector(this.trailAlong, bodyBack);
		this.trailBodyLight.position.y = firmlyFlat
			? pos.y + 0.22
			: this.trailHeadLight.position.y - 0.05;

		if (boosting) {
			this.trailHeadLight.color.copy(COLOR_BOOST_CORE);
			this.trailBodyLight.color.copy(COLOR_BOOST_MID);
		} else if (this.supersonic) {
			this.trailHeadLight.color.copy(COLOR_SS_CORE);
			this.trailBodyLight.color.copy(COLOR_SS_TAIL);
		} else {
			this.trailHeadLight.color.copy(COLOR_BOOST_HEAD);
			this.trailBodyLight.color.copy(COLOR_BOOST_TAIL);
		}

		const speedNorm = Math.min(1, hSpeed / SUPERSONIC_ENTER_MPS);
		const boostMul = boosting ? 1 : this.supersonic ? 0.55 : 0.3;
		const groundMul = firmlyFlat ? 1.0 : 0.7;
		this.trailHeadLight.intensity =
			this.lightSmoothed *
			(0.85 + speedNorm * 0.45) *
			boostMul *
			groundMul;
		this.trailBodyLight.intensity =
			this.lightSmoothed *
			(0.4 + speedNorm * 0.25) *
			boostMul *
			(firmlyFlat ? 0.85 : 0.35);
		this.trailHeadLight.distance = firmlyFlat ? 7.5 : 6.5;
		this.trailBodyLight.distance = firmlyFlat ? 10 : 7;
	}

	private airAt(i: number): THREE.Vector3 {
		return this.airPts[(this.airHead + i) % AIR_MAX_POINTS];
	}

	private pushAirPoint(
		player: Player,
		pos: THREE.Vector3,
		_camera?: THREE.Camera,
	): void {
		this.trailBack.copy(player.getForward()).multiplyScalar(-REAR_AXLE_OFFSET);
		this.posScratch.copy(pos).add(this.trailBack);
		if (!this.airTracking) {
			this.airTracking = true;
			this.airLast.copy(this.posScratch);
			this.storeAirPoint(this.posScratch);
			return;
		}
		const dist = this.posScratch.distanceTo(this.airLast);
		if (dist < AIR_STEP) return;
		const n = Math.min(8, Math.floor(dist / AIR_STEP));
		for (let i = 1; i <= n; i++) {
			this.trailMid.lerpVectors(this.airLast, this.posScratch, i / n);
			this.storeAirPoint(this.trailMid);
		}
		this.airLast.copy(this.posScratch);
	}

	private storeAirPoint(p: THREE.Vector3): void {
		if (this.airCount === AIR_MAX_POINTS) {
			this.airHead = (this.airHead + 1) % AIR_MAX_POINTS;
			this.airCount--;
		}
		const slot = (this.airHead + this.airCount) % AIR_MAX_POINTS;
		this.airPts[slot].copy(p);
		this.airBorn[slot] = this.airClock;
		this.airCount++;
	}

	private expireAirPoints(): void {
		while (this.airCount > 0) {
			const born = this.airBorn[this.airHead];
			if (this.airClock - born < AIR_LIFE) break;
			this.airHead = (this.airHead + 1) % AIR_MAX_POINTS;
			this.airCount--;
		}
	}

	private rebuildAirRibbon(
		camera: THREE.Camera | undefined,
		boosting: boolean,
	): void {
		if (this.airCount < 2) {
			this.airMesh.visible = false;
			return;
		}
		if (camera) camera.updateMatrixWorld();
		const n = this.airCount;
		for (let i = 0; i < n; i++) {
			const p = this.airAt(i);
			if (i === 0) this.trailAlong.copy(this.airAt(1)).sub(p);
			else if (i === n - 1)
				this.trailAlong.copy(p).sub(this.airAt(i - 1));
			else this.trailAlong.copy(this.airAt(i + 1)).sub(this.airAt(i - 1));
			if (this.trailAlong.lengthSq() < 1e-8) this.trailAlong.set(0, 0, 1);
			else this.trailAlong.normalize();

			/**
			 * Camera-facing ribbon — zawsze „grubość” do kamery.
			 * World-up wstęga przy look-back (PPM) = płaska karta.
			 */
			if (camera) {
				this.camRight.copy(camera.position).sub(p);
				this.trailRight
					.crossVectors(this.trailAlong, this.camRight);
				if (this.trailRight.lengthSq() < 1e-8) {
					this.camRight.setFromMatrixColumn(camera.matrixWorld, 0);
					this.trailRight
						.crossVectors(this.trailAlong, this.camRight);
				}
			} else {
				this.trailRight
					.copy(this.worldUp)
					.addScaledVector(this.trailAlong, -this.trailAlong.y);
				if (this.trailRight.lengthSq() < 1e-6) {
					this.trailRight.copy(this.worldX);
				}
				this.trailRight
					.crossVectors(this.trailAlong, this.trailRight);
			}
			if (this.trailRight.lengthSq() < 1e-8) {
				this.trailRight.copy(this.worldX).cross(this.trailAlong);
			}
			this.trailRight.normalize();

			const age =
				this.airClock - this.airBorn[(this.airHead + i) % AIR_MAX_POINTS]!;
			const t = Math.max(0, 1 - age / AIR_LIFE);
			/** Age-based UV: świeży przy aucie = jasny koniec tekstury. */
			const uAlong = t * t * (0.15 + 0.85 * t);
			const w =
				AIR_HALF_WIDTH *
				(0.14 + 0.92 * t) *
				(boosting ? 1.28 : 0.95);
			const i2 = i * 2 * 3;
			this.airPos[i2] = p.x + this.trailRight.x * w;
			this.airPos[i2 + 1] = p.y + this.trailRight.y * w;
			this.airPos[i2 + 2] = p.z + this.trailRight.z * w;
			this.airPos[i2 + 3] = p.x - this.trailRight.x * w;
			this.airPos[i2 + 4] = p.y - this.trailRight.y * w;
			this.airPos[i2 + 5] = p.z - this.trailRight.z * w;
			const iu = i * 4;
			this.airUv[iu] = 0;
			this.airUv[iu + 1] = uAlong;
			this.airUv[iu + 2] = 1;
			this.airUv[iu + 3] = uAlong;
		}
		this.airGeo.setDrawRange(0, (n - 1) * 6);
		this.airGeo.attributes.position.needsUpdate = true;
		this.airGeo.attributes.uv.needsUpdate = true;
		this.airGeo.computeBoundingSphere();
		this.airMesh.visible = true;
		if (boosting) {
			this.airMat.uniforms.uColor!.value.copy(COLOR_BOOST_CORE);
			this.airMat.uniforms.uOpacity!.value = 0.62;
			this.airMat.uniforms.uBoost!.value = 1;
		} else if (this.supersonic) {
			this.airMat.uniforms.uColor!.value.copy(COLOR_SS_CORE);
			this.airMat.uniforms.uOpacity!.value = 0.5;
			this.airMat.uniforms.uBoost!.value = 0.2;
		} else {
			this.airMat.uniforms.uColor!.value.copy(COLOR_BOOST_HEAD);
			this.airMat.uniforms.uOpacity!.value = 0.34;
			this.airMat.uniforms.uBoost!.value = 0.25;
		}
		this.airMat.uniforms.uTime!.value = this.airClock;
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
		const lengthMul = airborne
			? THREE.MathUtils.lerp(0.94, 1.08, head)
			: THREE.MathUtils.lerp(0.28, 0.92, head ** 0.55);
		const boostWide = boosting ? 1.06 : 1;

		const along = (seg.mesh.userData.alongLen as number) ?? SEGMENT_LENGTH;
		seg.mesh.scale.set(
			SEGMENT_WIDTH * widthMul * boostWide * (airborne ? 1.35 : 1),
			along * lengthMul,
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
			/** RL: jasna biała smuga przy max speed (nie pomarańcz boost). */
			this.colorScratch.copy(COLOR_SS_CORE);
			if (t < 0.55) {
				this.colorScratch.lerp(COLOR_SS_TAIL, (0.55 - t) * 1.35);
			}
		} else {
			this.colorScratch.copy(this.colorTail).lerp(this.colorHead, t ** 0.55);
		}

		seg.material.color.copy(this.colorScratch);

		const speedFactor = Math.min(1, hSpeed / SUPERSONIC_ENTER_MPS);
		const headGlow = 0.38 + 0.52 * speedFactor;
/** RL tip: trail opacity ~60–70% — widać przeciwników za smugą; SS bielsza. */
		const opacityBase = boosting ? 0.48 : supersonic ? 0.46 : 0.26;
		seg.material.opacity = opacityBase * headGlow * tailFade;
	}

	private updateSupersonic(hSpeed: number): void {
		if (this.supersonic) {
			if (hSpeed < SUPERSONIC_EXIT_MPS) this.supersonic = false;
		} else if (hSpeed >= SUPERSONIC_ENTER_MPS) {
			this.supersonic = true;
		}
	}

	private orientGroundSegment(mesh: THREE.Mesh, forward: THREE.Vector3): void {
		mesh.rotation.order = "XYZ";
		mesh.rotation.x = -Math.PI / 2;
		mesh.rotation.y = 0;
		mesh.rotation.z = Math.atan2(forward.x, forward.z);
	}

	/**
	 * PlaneGeometry (XY): X = szerokość (stoi w world-up), Y = ścieżka lotu.
	 * Chase patrzy wzdłuż smugi i widzi pionowy pasek — nie krawędź karty kadłuba.
	 */
	private orientPathRibbon(
		mesh: THREE.Mesh,
		along: THREE.Vector3,
		_camera: THREE.Camera | undefined,
		ground: boolean,
	): void {
		this.trailForward.copy(along);
		if (this.trailForward.lengthSq() < 1e-8) this.trailForward.set(0, 0, 1);
		else this.trailForward.normalize();

		if (ground) {
			this.orientGroundSegment(mesh, this.trailForward);
			return;
		}

		this.trailUp
			.copy(this.worldUp)
			.addScaledVector(this.trailForward, -this.trailForward.y);
		if (this.trailUp.lengthSq() < 1e-6) {
			if (_camera) {
				this.trailUp.setFromMatrixColumn(_camera.matrixWorld, 0);
			} else {
				this.trailUp.copy(this.worldX);
			}
			this.trailUp.addScaledVector(
				this.trailForward,
				-this.trailUp.dot(this.trailForward),
			);
		}
		if (this.trailUp.lengthSq() < 1e-6) {
			this.trailUp.copy(this.worldX).cross(this.trailForward);
		}
		this.trailUp.normalize();
		this.trailRight
			.crossVectors(this.trailUp, this.trailForward)
			.normalize();
		this.trailUp
			.crossVectors(this.trailForward, this.trailRight)
			.normalize();
		this.orientMatrix.makeBasis(
			this.trailUp,
			this.trailForward,
			this.trailRight,
		);
		mesh.quaternion.setFromRotationMatrix(this.orientMatrix);
	}

	private stampRibbon(
		player: Player,
		boosting: boolean,
		supersonic: boolean,
		ground: boolean,
		camera: THREE.Camera | undefined,
		from: THREE.Vector3,
		to: THREE.Vector3,
		along: THREE.Vector3,
		interval: number,
	): void {
		const slot = this.segments.find((s) => s.life <= 0);
		if (!slot) return;

		this.trailBack.copy(along).normalize().multiplyScalar(-1);
		const alongLen = ground
			? SEGMENT_LENGTH
			: Math.max(interval * 1.18, 0.78);
		slot.mesh.userData.alongLen = alongLen;

		this.trailMid.lerpVectors(from, to, 0.5);
		if (ground) {
			slot.mesh.position.set(
				this.trailMid.x + this.trailBack.x * REAR_AXLE_OFFSET * 0.35,
				to.y + GROUND_LIFT,
				this.trailMid.z + this.trailBack.z * REAR_AXLE_OFFSET * 0.35,
			);
		} else {
			slot.mesh.position
				.copy(this.trailMid)
				.addScaledVector(this.trailBack, REAR_AXLE_OFFSET * 0.45);
		}

		this.orientPathRibbon(slot.mesh, along, camera, ground);

		slot.maxLife =
			SEGMENT_LIFE * (boosting ? 1.05 : 0.92) * (0.88 + Math.random() * 0.22);
		slot.life = slot.maxLife;
		slot.mesh.visible = true;

		this.applySegmentAppearance(
			slot,
			1,
			boosting,
			supersonic,
			!ground,
			player.getVelocity().length(),
		);
	}
}
