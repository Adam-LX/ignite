import * as THREE from "three";

import type { ScoringTeam } from "../../game/modes";
import type Player from "../../util/Player";
import { CAR_NEON_CYAN } from "../carPanelMaterial";

const EXHAUST_SOCKETS = ["exhaust_L", "exhaust_C", "exhaust_R"] as const;
/** Płomień + iskry — TYLKO Points (żadnego Cylinder/Plane = żółty klocek). */
const FLAME_COUNT = 96;
const SPARK_COUNT = 48;

const TEAM_PALETTE = {
	blue: {
		hot: new THREE.Color(0xe8f6ff),
		mid: new THREE.Color(0x7ec8ff),
		tail: new THREE.Color(0x1a4a8a),
		light: 0x88ccff,
	},
	orange: {
		hot: new THREE.Color(0xfff4b0),
		mid: new THREE.Color(0xff7a1a),
		tail: new THREE.Color(0x8a1400),
		light: 0xffaa44,
	},
} as const;

type ExhaustSocket = {
	localOffset: THREE.Vector3;
};

type Flame = {
	pos: THREE.Vector3;
	vel: THREE.Vector3;
	life: number;
	maxLife: number;
	size: number;
};

/**
 * Boost exhaust — sprite particles wzdłuż −forward.
 * Mesh volume (cylinder/planes) dawał „żółty klocek” wokół auta.
 */
export class BoostExhaustVfx {
	private readonly visualRoot: THREE.Object3D;
	private readonly sockets: ExhaustSocket[] = [];
	private readonly rearLight: THREE.PointLight;
	private readonly palette: (typeof TEAM_PALETTE)[ScoringTeam];
	private boostSmoothed = 0;
	private pulse = 0;
	private emitAcc = 0;
	private flameHead = 0;
	private sparkHead = 0;

	private readonly flames: Flame[] = [];
	private readonly flamePos: Float32Array;
	private readonly flameSize: Float32Array;
	private readonly flameGeo: THREE.BufferGeometry;
	private readonly flamePoints: THREE.Points;

	private readonly sparks: Flame[] = [];
	private readonly sparkPos: Float32Array;
	private readonly sparkGeo: THREE.BufferGeometry;
	private readonly sparkPoints: THREE.Points;

	private readonly _world = new THREE.Vector3();
	private readonly _back = new THREE.Vector3();
	private readonly _up = new THREE.Vector3();
	private readonly _right = new THREE.Vector3();
	private readonly _emit = new THREE.Vector3();

	constructor(
		visualRoot: THREE.Object3D,
		scene: THREE.Scene,
		team: ScoringTeam,
	) {
		this.visualRoot = visualRoot;
		this.palette = TEAM_PALETTE[team];

		for (const socketName of EXHAUST_SOCKETS) {
			const fallbackZ = socketName === "exhaust_C" ? -0.55 : -0.5;
			const fallbackX =
				socketName === "exhaust_L"
					? -0.22
					: socketName === "exhaust_R"
						? 0.22
						: 0;
			const localOffset = new THREE.Vector3(fallbackX, 0.12, fallbackZ);
			const socket = visualRoot.getObjectByName(socketName);
			if (socket) {
				socket.getWorldPosition(this._world);
				visualRoot.worldToLocal(this._world);
				localOffset.copy(this._world);
				localOffset.y = Math.max(0.08, Math.min(0.28, localOffset.y));
				if (localOffset.z > -0.25) localOffset.z = fallbackZ;
			}
			this.sockets.push({ localOffset });
		}

		this.rearLight = new THREE.PointLight(this.palette.light, 0, 10, 1.9);
		this.rearLight.position.set(0, 0.16, -0.58);
		this.rearLight.castShadow = false;
		visualRoot.add(this.rearLight);

		this.flamePos = new Float32Array(FLAME_COUNT * 3);
		this.flameSize = new Float32Array(FLAME_COUNT);
		for (let i = 0; i < FLAME_COUNT; i++) {
			this.flames.push({
				pos: new THREE.Vector3(0, -99, 0),
				vel: new THREE.Vector3(),
				life: 0,
				maxLife: 0.2,
				size: 0.12,
			});
			this.flamePos[i * 3 + 1] = -99;
			this.flameSize[i] = 0;
		}
		this.flameGeo = new THREE.BufferGeometry();
		this.flameGeo.setAttribute(
			"position",
			new THREE.BufferAttribute(this.flamePos, 3),
		);
		this.flameGeo.setAttribute(
			"size",
			new THREE.BufferAttribute(this.flameSize, 1),
		);
		const flameMat = new THREE.ShaderMaterial({
			uniforms: {
				uMap: { value: softSparkTexture() },
				uHot: { value: this.palette.hot.clone() },
				uMid: { value: this.palette.mid.clone() },
				uTail: { value: this.palette.tail.clone() },
				uOpacity: { value: 0 },
			},
			vertexShader: FLAME_VERT,
			fragmentShader: FLAME_FRAG,
			transparent: true,
			depthWrite: false,
			depthTest: true,
			blending: THREE.AdditiveBlending,
			toneMapped: false,
			fog: false,
		});
		this.flamePoints = new THREE.Points(this.flameGeo, flameMat);
		this.flamePoints.name = "boostExhaustFlame";
		this.flamePoints.frustumCulled = false;
		this.flamePoints.renderOrder = 18;
		scene.add(this.flamePoints);

		this.sparkPos = new Float32Array(SPARK_COUNT * 3);
		for (let i = 0; i < SPARK_COUNT; i++) {
			this.sparks.push({
				pos: new THREE.Vector3(0, -99, 0),
				vel: new THREE.Vector3(),
				life: 0,
				maxLife: 0.2,
				size: 0.06,
			});
			this.sparkPos[i * 3 + 1] = -99;
		}
		this.sparkGeo = new THREE.BufferGeometry();
		this.sparkGeo.setAttribute(
			"position",
			new THREE.BufferAttribute(this.sparkPos, 3),
		);
		const sparkMat = new THREE.PointsMaterial({
			color: this.palette.hot,
			size: 0.07,
			map: softSparkTexture(),
			transparent: true,
			opacity: 0.65,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			sizeAttenuation: true,
			toneMapped: false,
			alphaTest: 0.02,
		});
		this.sparkPoints = new THREE.Points(this.sparkGeo, sparkMat);
		this.sparkPoints.name = "boostExhaustSparks";
		this.sparkPoints.frustumCulled = false;
		this.sparkPoints.renderOrder = 19;
		scene.add(this.sparkPoints);
	}

	update(
		player: Player,
		boosting: boolean,
		dt: number,
		_camera?: THREE.Camera,
	): void {
		const target = boosting ? 1 : 0;
		this.boostSmoothed = THREE.MathUtils.damp(
			this.boostSmoothed,
			target,
			14,
			dt,
		);
		this.pulse = THREE.MathUtils.damp(this.pulse, boosting ? 1 : 0, 10, dt);

		const speed = player.getVelocity().length();
		const airborne = !player.isOnGround();
		const intensity =
			this.boostSmoothed * (0.6 + Math.min(1, speed / 24) * 0.4);
		const active = intensity > 0.02;

		this._back.copy(player.getForward()).multiplyScalar(-1);
		if (this._back.lengthSq() < 1e-8) this._back.set(0, 0, -1);
		else this._back.normalize();
		this._up.copy(player.getUpward());
		if (this._up.lengthSq() < 1e-8) this._up.set(0, 1, 0);
		else this._up.normalize();
		this._up.addScaledVector(this._back, -this._up.dot(this._back));
		if (this._up.lengthSq() < 1e-8) this._up.set(0, 1, 0);
		else this._up.normalize();
		this._right.crossVectors(this._up, this._back).normalize();

		if (active) {
			this.emitAcc += dt;
			const rate = airborne ? 0.006 : 0.009;
			while (this.emitAcc >= rate) {
				this.emitAcc -= rate;
				this.spawnFlame(speed, airborne);
				if (Math.random() < 0.55) this.spawnSpark(speed);
			}
		}

		this.stepParticles(this.flames, this.flamePos, this.flameSize, dt, true);
		this.stepParticles(this.sparks, this.sparkPos, null, dt, false);

		this.flameGeo.attributes.position!.needsUpdate = true;
		this.flameGeo.attributes.size!.needsUpdate = true;
		this.sparkGeo.attributes.position!.needsUpdate = true;

		const flameMat = this.flamePoints.material as THREE.ShaderMaterial;
		flameMat.uniforms.uOpacity!.value = active
			? Math.min(0.95, 0.55 + this.pulse * 0.4)
			: 0;
		this.flamePoints.visible = this.boostSmoothed > 0.04;
		this.sparkPoints.visible = this.boostSmoothed > 0.05;
		(this.sparkPoints.material as THREE.PointsMaterial).opacity =
			0.35 + this.pulse * 0.45;

		this.rearLight.intensity = active
			? 0.95 + this.pulse * 0.75 + speed * 0.018
			: 0;
		this.rearLight.distance = airborne ? 7 : 9;

		const underglow = this.visualRoot.getObjectByName("underglowLight") as
			| THREE.SpotLight
			| undefined;
		if (underglow) {
			if (active) {
				underglow.intensity = 1.05 + this.pulse * 1.2;
				underglow.color.setHex(this.palette.light);
			} else {
				underglow.intensity = 1.2;
				underglow.color.setHex(CAR_NEON_CYAN);
			}
		}
	}

	private emitterWorld(socketIdx: number): THREE.Vector3 {
		const off = this.sockets[socketIdx % this.sockets.length]!.localOffset;
		this._emit.copy(off);
		this.visualRoot.localToWorld(this._emit);
		return this._emit;
	}

	private spawnFlame(speed: number, airborne: boolean): void {
		const socketIdx = this.flameHead % this.sockets.length;
		this.flameHead++;
		const f = this.flames[this.flameHead % FLAME_COUNT]!;
		const emit = this.emitterWorld(socketIdx);
		f.pos.copy(emit);
		f.pos.addScaledVector(this._back, 0.05 + Math.random() * 0.12);
		f.pos.addScaledVector(this._right, (Math.random() - 0.5) * 0.1);
		f.pos.addScaledVector(this._up, (Math.random() - 0.5) * 0.06);
		const thrust = (airborne ? 9 : 6.5) + speed * 0.12 + this.pulse * 4;
		f.vel.set(
			this._back.x * thrust + (Math.random() - 0.5) * 1.4,
			this._back.y * thrust + (Math.random() - 0.5) * 1.1,
			this._back.z * thrust + (Math.random() - 0.5) * 1.4,
		);
		f.maxLife = 0.1 + Math.random() * 0.16 + this.pulse * 0.06;
		f.life = f.maxLife;
		f.size = 0.14 + Math.random() * 0.16 + this.pulse * 0.1;
	}

	private spawnSpark(speed: number): void {
		const socketIdx = this.sparkHead % this.sockets.length;
		this.sparkHead++;
		const s = this.sparks[this.sparkHead % SPARK_COUNT]!;
		const emit = this.emitterWorld(socketIdx);
		s.pos.copy(emit);
		s.pos.addScaledVector(this._back, 0.15 + Math.random() * 0.3);
		const spread = 3.2 + Math.random() * 5 + speed * 0.05;
		s.vel.set(
			this._back.x * spread + (Math.random() - 0.5) * 3.2,
			this._back.y * spread + (Math.random() - 0.5) * 2.2 + 0.2,
			this._back.z * spread + (Math.random() - 0.5) * 3.2,
		);
		s.maxLife = 0.14 + Math.random() * 0.22;
		s.life = s.maxLife;
		s.size = 0.05;
	}

	private stepParticles(
		list: Flame[],
		posArr: Float32Array,
		sizeArr: Float32Array | null,
		dt: number,
		flameDrag: boolean,
	): void {
		for (let i = 0; i < list.length; i++) {
			const p = list[i]!;
			if (p.life <= 0) {
				posArr[i * 3 + 1] = -99;
				if (sizeArr) sizeArr[i] = 0;
				continue;
			}
			p.life -= dt;
			p.pos.addScaledVector(p.vel, dt);
			if (flameDrag) {
				p.vel.multiplyScalar(0.92);
				p.vel.addScaledVector(this._back, 14 * dt);
			} else {
				p.vel.y -= 9 * dt;
				p.vel.multiplyScalar(0.96);
			}
			const fade = Math.max(0, p.life / p.maxLife);
			if (fade < 0.02) {
				posArr[i * 3 + 1] = -99;
				if (sizeArr) sizeArr[i] = 0;
				continue;
			}
			posArr[i * 3] = p.pos.x;
			posArr[i * 3 + 1] = p.pos.y;
			posArr[i * 3 + 2] = p.pos.z;
			if (sizeArr) sizeArr[i] = p.size * (0.45 + fade * 0.9);
		}
	}

	dispose(): void {
		this.rearLight.removeFromParent();
		this.rearLight.dispose();
		this.flamePoints.removeFromParent();
		this.flameGeo.dispose();
		(this.flamePoints.material as THREE.Material).dispose();
		this.sparkPoints.removeFromParent();
		this.sparkGeo.dispose();
		(this.sparkPoints.material as THREE.PointsMaterial).dispose();
	}
}

const FLAME_VERT = /* glsl */ `
attribute float size;
uniform float uOpacity;
varying float vLife;
varying vec2 vUv;

void main() {
	vUv = vec2(0.0);
	vLife = size;
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	gl_PointSize = size * (280.0 / max(-mv.z, 0.5));
	gl_Position = projectionMatrix * mv;
}
`;

const FLAME_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uHot;
uniform vec3 uMid;
uniform vec3 uTail;
uniform float uOpacity;
varying float vLife;

void main() {
	vec2 uv = gl_PointCoord;
	float a = texture2D(uMap, uv).a;
	if (a < 0.02) discard;
	float t = clamp(vLife * 4.0, 0.0, 1.0);
	vec3 col = mix(uTail, uMid, t);
	col = mix(col, uHot, t * t);
	float alpha = a * uOpacity * clamp(vLife * 5.0, 0.0, 1.0);
	gl_FragColor = vec4(col, alpha);
}
`;

let _sparkTex: THREE.CanvasTexture | null = null;

function softSparkTexture(): THREE.CanvasTexture {
	if (_sparkTex) return _sparkTex;
	const size = 64;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D unavailable");
	const g = ctx.createRadialGradient(
		size / 2,
		size / 2,
		0,
		size / 2,
		size / 2,
		size / 2,
	);
	g.addColorStop(0, "rgba(255,255,255,1)");
	g.addColorStop(0.25, "rgba(255,240,180,0.9)");
	g.addColorStop(0.55, "rgba(255,140,40,0.35)");
	g.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);
	_sparkTex = new THREE.CanvasTexture(canvas);
	_sparkTex.colorSpace = THREE.NoColorSpace;
	return _sparkTex;
}
