/**
 * Prematch stadium smoke — gęsty, realistyczny haze jak na laser show /
 * RLCS walkout: miękkie billboardy + warstwy volume fog, nie „wata” i nie duch.
 */
import * as THREE from "three";

import { PLAYFIELD_SURFACE_Y, RL_ARENA } from "../arenaConstants";

type Puff = {
	mesh: THREE.Mesh;
	mat: THREE.MeshBasicMaterial;
	vx: number;
	vy: number;
	vz: number;
	spin: number;
	life: number;
	maxLife: number;
	grow: number;
	baseScale: number;
	peakOpacity: number;
	stretch: number;
};

type HazeLayer = {
	mesh: THREE.Mesh;
	mat: THREE.ShaderMaterial;
	baseY: number;
	yAmp: number;
	rotSpeed: number;
	driftPhase: number;
	opacityMul: number;
	scaleMul: number;
};

const POOL = 64;
const _camUp = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();

let softSmokeTex: THREE.Texture | null = null;
let wispySmokeTex: THREE.Texture | null = null;

const HAZE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
	vUv = uv;
	vec4 wp = modelMatrix * vec4(position, 1.0);
	vWorld = wp.xyz;
	gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/**
 * Volume haze — miękkie smugi + turbulence, alpha czytelna pod laserami.
 * Normal blending (nie additive) → szary dym łapie światło, nie wypala bloom.
 */
const HAZE_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTint;
uniform float uOpacity;
uniform float uTime;
uniform float uPulse;
uniform float uDensity;
varying vec2 vUv;
varying vec3 vWorld;

float hash21(vec2 p) {
	p = fract(p * vec2(127.1, 311.7));
	p += dot(p, p + 19.19);
	return fract(p.x * p.y);
}
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	float a = hash21(i);
	float b = hash21(i + vec2(1.0, 0.0));
	float c = hash21(i + vec2(0.0, 1.0));
	float d = hash21(i + vec2(1.0, 1.0));
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < 5; i++) {
		v += a * noise(p);
		p = p * 2.07 + vec2(1.7, 9.2);
		a *= 0.5;
	}
	return v;
}

void main() {
	vec2 drift = vec2(uTime * 0.018, -uTime * 0.012);
	vec2 swirl = vec2(
		sin(uTime * 0.11 + vWorld.z * 0.02),
		cos(uTime * 0.09 + vWorld.x * 0.018)
	) * 0.04;

	vec2 uv1 = vUv * 1.55 + drift + swirl;
	vec2 uv2 = vUv * 2.4 - drift * 1.35 + vec2(0.41, -0.27);
	vec2 uv3 = vUv * 3.6 + drift * 0.55 + vec2(-0.18, 0.33);

	float texA = texture2D(uMap, uv1).a;
	float texB = texture2D(uMap, uv2).a;
	float texC = texture2D(uMap, uv3).a;

	float turb = fbm(vWorld.xz * 0.042 + drift * 2.8);
	float filament = smoothstep(0.22, 0.78, turb);
	float pockets = smoothstep(0.35, 0.85, fbm(vWorld.xz * 0.09 - drift * 1.6));

	float body = texA * 0.5 + texB * 0.32 + texC * 0.22;
	body *= mix(0.55, 1.15, filament);
	body *= mix(0.7, 1.05, pockets);
	body = pow(max(body, 0.0), 0.92);

	float radial = 1.0 - smoothstep(22.0, 58.0, length(vWorld.xz));
	float height =
		smoothstep(0.15, 1.6, vWorld.y) *
		(1.0 - smoothstep(8.0, 16.0, vWorld.y));

	float dens = clamp(uDensity, 0.0, 1.05);
	float pulse = 0.9 + uPulse * 0.16;
	float alpha = body * uOpacity * dens * radial * height * pulse;
	/** Cienki hazer — cap niski, żeby look-up nie robił mleka. */
	alpha *= mix(0.35, 0.85, filament);
	alpha = pow(max(alpha, 0.0), 1.35);
	alpha = clamp(alpha, 0.0, 0.08);
	if (alpha < 0.01) discard;

	vec3 smoke = mix(vec3(0.28, 0.34, 0.48), uTint, 0.18);
	smoke = mix(smoke, vec3(0.4, 0.48, 0.62), filament * 0.2);
	gl_FragColor = vec4(smoke, alpha);
}
`;

/** Miękki puff — radial falloff + turbulence (klasyczny game smoke). */
function softSmokeTexture(): THREE.Texture {
	if (softSmokeTex) return softSmokeTex;
	const s = 256;
	const canvas = document.createElement("canvas");
	canvas.width = s;
	canvas.height = s;
	const ctx = canvas.getContext("2d")!;
	ctx.clearRect(0, 0, s, s);

	const img = ctx.createImageData(s, s);
	const data = img.data;
	const cx = s * 0.5;
	const cy = s * 0.5;
	for (let y = 0; y < s; y++) {
		for (let x = 0; x < s; x++) {
			const dx = (x - cx) / cx;
			const dy = (y - cy) / cy;
			const r = Math.hypot(dx, dy);
			const n1 =
				Math.sin(x * 0.055 + y * 0.028) * 0.45 +
				Math.sin(x * 0.028 - y * 0.07) * 0.35 +
				Math.sin((x + y) * 0.042) * 0.28;
			const n2 =
				Math.sin(x * 0.11 - y * 0.09) * 0.38 +
				Math.sin(y * 0.14 + x * 0.05) * 0.32 +
				Math.sin((x - y) * 0.08) * 0.22;
			const filament = (n1 * 0.55 + n2 * 0.45) * 0.5 + 0.5;
			const falloff = Math.max(0, 1 - r * 1.05);
			const soft = Math.pow(falloff, 1.55);
			let a = soft * (0.55 + filament * 0.55);
			/** Lekkie dziury — organiczny kształt, nie pełne koło. */
			if (r < 0.32 && filament < 0.42) a *= 0.55;
			a = Math.min(1, Math.max(0, a));
			const i = (y * s + x) * 4;
			const g = 175 + filament * 45;
			data[i] = g;
			data[i + 1] = g + 3;
			data[i + 2] = g + 8;
			data[i + 3] = Math.floor(a * 255);
		}
	}
	ctx.putImageData(img, 0, 0);
	softSmokeTex = new THREE.CanvasTexture(canvas);
	softSmokeTex.colorSpace = THREE.SRGBColorSpace;
	softSmokeTex.generateMipmaps = true;
	softSmokeTex.minFilter = THREE.LinearMipmapLinearFilter;
	softSmokeTex.magFilter = THREE.LinearFilter;
	return softSmokeTex;
}

/** Haze sheet — gęste, miękkie smugi z turbulence. */
function wispySmokeTexture(): THREE.Texture {
	if (wispySmokeTex) return wispySmokeTex;
	const s = 512;
	const canvas = document.createElement("canvas");
	canvas.width = s;
	canvas.height = s;
	const ctx = canvas.getContext("2d")!;
	ctx.clearRect(0, 0, s, s);
	const img = ctx.createImageData(s, s);
	const data = img.data;
	for (let y = 0; y < s; y++) {
		for (let x = 0; x < s; x++) {
			const nx = x / s;
			const ny = y / s;
			const band =
				Math.sin(nx * 7.5 + ny * 2.2) * 0.32 +
				Math.sin(nx * 3.6 - ny * 6.2) * 0.28 +
				Math.sin((nx + ny) * 9.5) * 0.22 +
				Math.sin(ny * 12.0 + nx * 2.8) * 0.24 +
				Math.sin(nx * 15.0 - ny * 4.0) * 0.18;
			const blob =
				Math.sin(nx * 4.2 + ny * 5.1) * 0.2 +
				Math.sin(nx * 8.0 - ny * 3.3) * 0.15;
			let v = (band + blob) * 0.5 + 0.55;
			v = Math.pow(Math.max(0, v - 0.28), 1.45);
			/** Rozrzedź — cienkie pasma, nie pełny sheet. */
			v *= 0.55;
			const edgeX = Math.sin(nx * Math.PI);
			const edgeY = Math.sin(ny * Math.PI);
			v *= edgeX * edgeY;
			v = Math.min(1, v);
			const i = (y * s + x) * 4;
			const g = 200 + v * 40;
			data[i] = g;
			data[i + 1] = g + 2;
			data[i + 2] = g + 6;
			data[i + 3] = Math.floor(Math.min(200, v * 255));
		}
	}
	ctx.putImageData(img, 0, 0);
	wispySmokeTex = new THREE.CanvasTexture(canvas);
	wispySmokeTex.colorSpace = THREE.SRGBColorSpace;
	wispySmokeTex.wrapS = THREE.RepeatWrapping;
	wispySmokeTex.wrapT = THREE.RepeatWrapping;
	wispySmokeTex.generateMipmaps = true;
	wispySmokeTex.minFilter = THREE.LinearMipmapLinearFilter;
	wispySmokeTex.magFilter = THREE.LinearFilter;
	return wispySmokeTex;
}

export class StadiumShowSmoke {
	readonly root = new THREE.Group();
	private readonly puffs: Puff[] = [];
	private readonly layers: HazeLayer[] = [];
	private emitAcc = 0;
	private density = 0;
	private time = 0;
	private puffFrame = 0;
	private readonly _origin = new THREE.Vector3();
	private readonly softTex: THREE.Texture;
	private readonly wispyTex: THREE.Texture;
	private readonly puffGeo: THREE.PlaneGeometry;

	constructor() {
		this.root.name = "stadiumShowSmoke";
		/** Nowe tekstury — zresetuj cache gdy plik się przeładowuje w HMR. */
		softSmokeTex = null;
		wispySmokeTex = null;
		this.softTex = softSmokeTexture();
		this.wispyTex = wispySmokeTexture();
		this.puffGeo = new THREE.PlaneGeometry(1, 1);

		for (let i = 0; i < POOL; i++) {
			const mat = new THREE.MeshBasicMaterial({
				map: this.softTex,
				color: 0x5a6578,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				depthTest: true,
				blending: THREE.NormalBlending,
				side: THREE.DoubleSide,
				toneMapped: false,
			});
			const mesh = new THREE.Mesh(this.puffGeo, mat);
			mesh.visible = false;
			mesh.frustumCulled = false;
			mesh.renderOrder = 22;
			this.root.add(mesh);
			this.puffs.push({
				mesh,
				mat,
				vx: 0,
				vy: 0,
				vz: 0,
				spin: 0,
				life: 0,
				maxLife: 3.2,
				grow: 2.0,
				baseScale: 4,
				peakOpacity: 0.16,
				stretch: 1.4,
			});
		}

		const layerDefs: Omit<HazeLayer, "mesh" | "mat">[] = [
			{
				baseY: PLAYFIELD_SURFACE_Y + 0.55,
				yAmp: 0.18,
				rotSpeed: 0.045,
				driftPhase: 0.0,
				opacityMul: 0.07,
				scaleMul: 2.0,
			},
			{
				baseY: PLAYFIELD_SURFACE_Y + 1.4,
				yAmp: 0.28,
				rotSpeed: -0.038,
				driftPhase: 1.2,
				opacityMul: 0.06,
				scaleMul: 1.85,
			},
			{
				baseY: 2.6,
				yAmp: 0.35,
				rotSpeed: 0.032,
				driftPhase: 2.4,
				opacityMul: 0.05,
				scaleMul: 1.7,
			},
			{
				baseY: 3.8,
				yAmp: 0.4,
				rotSpeed: -0.03,
				driftPhase: 0.7,
				opacityMul: 0.04,
				scaleMul: 1.55,
			},
			{
				baseY: 5.0,
				yAmp: 0.35,
				rotSpeed: 0.024,
				driftPhase: 3.1,
				opacityMul: 0.03,
				scaleMul: 1.4,
			},
			/** Placeholder high layers — wyłączone w update (look-up milk). */
			{
				baseY: 8.8,
				yAmp: 0.5,
				rotSpeed: -0.02,
				driftPhase: 1.8,
				opacityMul: 0.0,
				scaleMul: 1.2,
			},
			{
				baseY: 11.2,
				yAmp: 0.5,
				rotSpeed: 0.016,
				driftPhase: 2.7,
				opacityMul: 0.0,
				scaleMul: 1.1,
			},
		];

		const hw = RL_ARENA.HALF_WIDTH;
		const hl = RL_ARENA.HALF_LENGTH;
		for (let i = 0; i < layerDefs.length; i++) {
			const def = layerDefs[i]!;
			const tint = new THREE.Color().setHSL(0.55, 0.02, 0.92);
			const mat = new THREE.ShaderMaterial({
				uniforms: {
					uMap: { value: this.wispyTex },
					uTint: { value: tint },
					uOpacity: { value: def.opacityMul },
					uTime: { value: 0 },
					uPulse: { value: 0 },
					uDensity: { value: 0 },
				},
				vertexShader: HAZE_VERT,
				fragmentShader: HAZE_FRAG,
				transparent: true,
				depthWrite: false,
				depthTest: false,
				blending: THREE.NormalBlending,
				side: THREE.DoubleSide,
				toneMapped: false,
			});
			const mesh = new THREE.Mesh(
				new THREE.PlaneGeometry(
					hw * 2 * def.scaleMul,
					hl * 2 * def.scaleMul,
				),
				mat,
			);
			mesh.rotation.x = -Math.PI / 2;
			mesh.rotation.z = (i * 0.41) % Math.PI;
			mesh.position.y = def.baseY;
			mesh.renderOrder = 17 + i;
			mesh.frustumCulled = false;
			this.root.add(mesh);
			this.layers.push({ mesh, mat, ...def });
		}
	}

	burst(
		kind: "goalBlue" | "goalOrange" | "side" | "field" | "center" | "roof",
		strength = 1,
	): void {
		/** Mniej puffów naraz — unikamy hitcha przy cue. */
		const mapped = kind === "roof" ? "field" : kind;
		const n = Math.floor(10 + strength * 12);
		for (let i = 0; i < n; i++) {
			this.spawnPuff(mapped, 0.85 + strength * 0.45 + Math.random() * 0.3);
		}
	}

	private spawnPuff(
		kind: "goalBlue" | "goalOrange" | "side" | "field" | "center",
		strength: number,
	): void {
		const slot = this.puffs.find((p) => p.life <= 0);
		if (!slot) return;
		const hl = RL_ARENA.HALF_LENGTH;
		const hw = RL_ARENA.HALF_WIDTH;
		if (kind === "goalBlue") {
			this._origin.set(
				(Math.random() - 0.5) * 12,
				0.8 + Math.random() * 3.5,
				-hl * 0.82,
			);
		} else if (kind === "goalOrange") {
			this._origin.set(
				(Math.random() - 0.5) * 12,
				0.8 + Math.random() * 3.5,
				hl * 0.82,
			);
		} else if (kind === "side") {
			const side = Math.random() < 0.5 ? -1 : 1;
			this._origin.set(
				side * hw * 0.86,
				0.7 + Math.random() * 3.5,
				(Math.random() - 0.5) * hl * 0.9,
			);
		} else if (kind === "field") {
			this._origin.set(
				(Math.random() - 0.5) * hw * 1.55,
				0.6 + Math.random() * 2.2,
				(Math.random() - 0.5) * hl * 1.55,
			);
		} else {
			this._origin.set(
				(Math.random() - 0.5) * 18,
				0.7 + Math.random() * 2.0,
				(Math.random() - 0.5) * 16,
			);
		}
		slot.mesh.position.copy(this._origin);
		slot.life = (3.2 + Math.random() * 2.4) * (0.85 + strength * 0.1);
		slot.maxLife = slot.life;
		slot.baseScale = 4.2 + strength * 2.2 + Math.random() * 2.0;
		slot.grow = 1.6 + Math.random() * 1.1;
		slot.peakOpacity = 0.055 + Math.random() * 0.035 + strength * 0.018;
		slot.stretch = 1.25 + Math.random() * 0.7;
		slot.vx = (Math.random() - 0.5) * 1.2;
		slot.vy = 0.25 + Math.random() * 0.55 * strength;
		slot.vz = (Math.random() - 0.5) * 1.2;
		slot.spin = (Math.random() - 0.5) * 0.28;
		if (kind === "goalBlue") slot.vz += 0.65;
		if (kind === "goalOrange") slot.vz -= 0.65;
		const shade = 0.42 + Math.random() * 0.12;
		slot.mat.color.setRGB(shade * 0.85, shade * 0.92, shade * 1.05);
		slot.mat.opacity = 0;
		slot.mesh.visible = true;
		slot.mesh.scale.set(
			slot.baseScale * 0.22 * slot.stretch,
			slot.baseScale * 0.22,
			1,
		);
	}

	update(dt: number, showU: number, pulse: number, camera: THREE.Camera): void {
		camera.updateMatrixWorld(true);
		_camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
		this.time += dt;

		let target = 0;
		if (showU < 1) {
			const rise = THREE.MathUtils.smoothstep(showU, 0.02, 0.2);
			const peak = THREE.MathUtils.smoothstep(showU, 0.26, 0.68);
			target = Math.max(rise * 0.32, peak * 0.42);
			const fade = 1 - THREE.MathUtils.smoothstep(showU, 0.84, 0.98);
			target *= fade;
			target *= 0.88 + pulse * 0.15;
		}
		this.density = THREE.MathUtils.lerp(
			this.density,
			target,
			1 - Math.exp(-dt * 2.8),
		);

		for (let i = 0; i < this.layers.length; i++) {
			const L = this.layers[i]!;
			/** Górne warstwy OFF — look-up przez stos = mleko. */
			const highLayer = L.baseY > PLAYFIELD_SURFACE_Y + 5.5;
			const breathe =
				0.88 +
				0.1 * Math.sin(showU * 4.2 + L.driftPhase) +
				pulse * 0.06;
			const layerMul = highLayer ? 0 : 1;
			L.mat.uniforms.uOpacity!.value = L.opacityMul * breathe * layerMul;
			L.mat.uniforms.uDensity!.value = this.density;
			L.mat.uniforms.uTime!.value = this.time * 0.7 + L.driftPhase;
			L.mat.uniforms.uPulse!.value = pulse;
			L.mesh.position.y =
				L.baseY +
				Math.sin(showU * 3.5 + L.driftPhase) * L.yAmp * this.density +
				pulse * L.yAmp * 0.2;
			L.mesh.rotation.z += L.rotSpeed * dt * (0.55 + this.density * 0.55);
			L.mesh.position.x = Math.sin(showU * 1.6 + L.driftPhase) * 2.0;
			L.mesh.position.z =
				Math.cos(showU * 1.3 + L.driftPhase * 0.7) * 2.3;
			L.mesh.visible = !highLayer && this.density > 0.02;
		}

		this.emitAcc += dt;
		const emitting = showU < 0.88 && this.density > 0.05;
		const emitRate = emitting
			? Math.max(0.14, 0.22 - pulse * 0.02)
			: 99;
		if (emitting && this.emitAcc >= emitRate) {
			this.emitAcc = 0;
			const roll = Math.random();
			if (roll < 0.2) this.spawnPuff("goalBlue", 0.85 + this.density);
			else if (roll < 0.4) this.spawnPuff("goalOrange", 0.85 + this.density);
			else if (roll < 0.55) this.spawnPuff("side", 0.75 + this.density);
			else if (roll < 0.9) this.spawnPuff("field", 0.9 + this.density);
			else this.spawnPuff("center", 0.8 + this.density);
		}

		this.puffFrame++;
		const orient = (this.puffFrame & 1) === 0;
		for (const p of this.puffs) {
			if (p.life <= 0) {
				p.mesh.visible = false;
				continue;
			}
			p.life -= dt;
			const lifeT = 1 - p.life / p.maxLife;
			p.mesh.position.x += p.vx * dt;
			p.mesh.position.y += p.vy * dt;
			p.mesh.position.z += p.vz * dt;
			p.vy += 0.22 * dt;
			p.vx *= 0.988;
			p.vz *= 0.988;

			const scale = p.baseScale * (0.28 + lifeT * p.grow);
			p.mesh.scale.set(scale * p.stretch, scale * 0.78, 1);

			/** lookAt co 2. klatkę — duży koszt CPU przy puli puffów. */
			if (orient) {
				_mat4.lookAt(p.mesh.position, camera.position, _camUp);
				_quat.setFromRotationMatrix(_mat4);
				p.mesh.quaternion.copy(_quat);
				p.mesh.rotateZ(p.spin * lifeT * 2.0);
			}

			const fadeIn = THREE.MathUtils.smoothstep(lifeT, 0, 0.18);
			const fadeOut = 1 - THREE.MathUtils.smoothstep(lifeT, 0.45, 1);
			p.mat.opacity =
				fadeIn *
				fadeOut *
				p.peakOpacity *
				(0.7 + this.density * 0.55) *
				(0.88 + pulse * 0.14);
		}
	}

	getDensity(): number {
		return this.density;
	}

	dispose(): void {
		for (const p of this.puffs) {
			p.mat.dispose();
		}
		this.puffGeo.dispose();
		for (const L of this.layers) {
			L.mesh.geometry.dispose();
			L.mat.dispose();
		}
		this.root.removeFromParent();
	}
}
