import * as THREE from "three";

import {
	rainGlintStrengthForQuality,
	resolveGraphicsSettings,
} from "../util/graphicsProfile";
import { PLAYFIELD_SURFACE_Y } from "./arenaConstants";

const STREAK_W = 64;
const STREAK_H = 128;
const MAX_FLOOD_LIGHTS = 4;
const SPLASH_MAX = 220;

/** Smuga deszczu — czytelna igła, nie niewidoczny hairline. */
function fillOvalStreak(
	data: Uint8Array,
	w: number,
	h: number,
): void {
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const nx = ((x + 0.5) / w) * 2 - 1;
			const ny = ((y + 0.5) / h) * 2 - 1;
			const d = Math.hypot(nx * 2.55, ny * 0.88);
			const radial = 1 - THREE.MathUtils.smoothstep(d, 0.08, 1.02);
			const tip = Math.sin(Math.PI * ((y + 0.5) / h));
			const a = Math.round(255 * radial * tip * 0.9);
			const i = (y * w + x) * 4;
			data[i] = 210;
			data[i + 1] = 232;
			data[i + 2] = 255;
			data[i + 3] = a;
		}
	}
}

function createStreakDataTexture(): THREE.DataTexture {
	const data = new Uint8Array(4 * STREAK_W * STREAK_H);
	fillOvalStreak(data, STREAK_W, STREAK_H);
	const tex = new THREE.DataTexture(data, STREAK_W, STREAK_H);
	tex.needsUpdate = true;
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.magFilter = THREE.LinearFilter;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.generateMipmaps = true;
	return tex;
}

function createStreakTexture(): THREE.Texture {
	if (typeof document === "undefined") {
		return createStreakDataTexture();
	}

	try {
		const canvas = document.createElement("canvas");
		canvas.width = STREAK_W;
		canvas.height = STREAK_H;
		const ctx = canvas.getContext("2d");
		if (!ctx) return createStreakDataTexture();

		const img = ctx.createImageData(STREAK_W, STREAK_H);
		fillOvalStreak(img.data as unknown as Uint8Array, STREAK_W, STREAK_H);
		ctx.putImageData(img, 0, 0);

		const tex = new THREE.CanvasTexture(canvas);
		tex.needsUpdate = true;
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.magFilter = THREE.LinearFilter;
		tex.minFilter = THREE.LinearMipmapLinearFilter;
		tex.generateMipmaps = true;
		return tex;
	} catch {
		return createStreakDataTexture();
	}
}

const rainVertexShader = /* glsl */ `
uniform float uSize;
uniform float uScale;

varying vec3 vWorldPosition;

void main() {
	vec4 worldPos = modelMatrix * vec4(position, 1.0);
	vWorldPosition = worldPos.xyz;
	vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
	/** Cap blisko kamery — widać deszcz, bez fat-blobów. */
	float raw = uSize * (uScale / max(-mvPosition.z, 0.1));
	gl_PointSize = clamp(raw, 2.0, 64.0);
	gl_Position = projectionMatrix * mvPosition;
}
`;

const rainFragmentShader = /* glsl */ `
uniform sampler2D map;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uRainIntensity;
uniform float uGlintStrength;
uniform int uLightCount;
uniform vec3 uLightPos[4];

varying vec3 vWorldPosition;

void main() {
	vec2 uv = gl_PointCoord;
	vec4 tex = texture2D(map, uv);

	vec2 centered = uv - 0.5;
	float oval = 1.0 - smoothstep(0.12, 0.46, length(centered * vec2(2.75, 0.95)));
	float softX = 1.0 - smoothstep(0.04, 0.32, abs(centered.x));
	float softY = 1.0 - smoothstep(0.03, 0.48, abs(centered.y));
	float soft = oval * softX * softY;
	float mask = tex.a * soft;
	if (mask < 0.012) discard;

	vec3 viewDir = normalize(cameraPosition - vWorldPosition);
	float glint = 0.0;
	for (int i = 0; i < 4; i++) {
		if (i >= uLightCount) break;
		vec3 lightDir = normalize(uLightPos[i] - vWorldPosition);
		float align = max(dot(viewDir, lightDir), 0.0);
		glint += pow(align, 28.0) + 0.5 * pow(align, 8.0);
	}
	glint = min(glint, 2.8) * uGlintStrength * uRainIntensity;

	vec3 base = uColor * tex.rgb;
	vec3 sparkle = vec3(0.9, 0.96, 1.0) * glint;
	float nearGround = 1.0 - smoothstep(0.5, 8.0, max(vWorldPosition.y, 0.0));
	sparkle += vec3(0.78, 0.9, 1.0) * nearGround * nearGround * 0.55
		* uRainIntensity * uGlintStrength;
	float alpha = mask * uOpacity;
	vec3 col = (base * (0.6 + 0.4 * uRainIntensity) + sparkle) * alpha;
	gl_FragColor = vec4(col, alpha);
}
`;

const mistVertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
	vUv = uv;
	vec4 worldPos = modelMatrix * vec4(position, 1.0);
	vWorldPosition = worldPos.xyz;
	gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const mistFragmentShader = /* glsl */ `
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorldPosition;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	float a = hash(i);
	float b = hash(i + vec2(1.0, 0.0));
	float c = hash(i + vec2(0.0, 1.0));
	float d = hash(i + vec2(1.0, 1.0));
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
	vec2 p = vUv * 2.0 - 1.0;
	float radial = 1.0 - smoothstep(0.35, 1.05, length(p * vec2(0.85, 1.05)));
	float n = noise(vWorldPosition.xz * 0.045 + vec2(uTime * 0.04, uTime * 0.028));
	n = 0.55 + 0.45 * noise(vWorldPosition.xz * 0.09 - vec2(uTime * 0.03, 0.0) + n);
	float veil = radial * n;
	float alpha = veil * uOpacity;
	if (alpha < 0.004) discard;
	vec3 col = mix(vec3(0.55, 0.7, 0.82), vec3(0.78, 0.88, 0.95), n);
	gl_FragColor = vec4(col, alpha);
}
`;

const splashVertexShader = /* glsl */ `
uniform float uSize;
uniform float uScale;
attribute float aLife;
attribute float aSeed;
varying float vLife;
varying float vSeed;

void main() {
	vLife = aLife;
	vSeed = aSeed;
	vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
	float grow = mix(0.55, 1.45, clamp(1.0 - vLife, 0.0, 1.0));
	gl_PointSize = uSize * grow * (uScale / max(-mvPosition.z, 0.1));
	gl_Position = projectionMatrix * mvPosition;
}
`;

const splashFragmentShader = /* glsl */ `
uniform float uOpacity;
varying float vLife;
varying float vSeed;

void main() {
	vec2 c = gl_PointCoord - 0.5;
	float r = length(c);
	float core = 1.0 - smoothstep(0.0, 0.14, r);
	float ring = smoothstep(0.06, 0.18, r) * (1.0 - smoothstep(0.18, 0.38, r));
	float mask = core * 0.85 + ring * 0.55;
	mask *= (0.55 + 0.2 * sin(vSeed * 9.0));
	mask *= smoothstep(0.0, 0.1, vLife) * smoothstep(0.0, 0.45, vLife);
	if (mask < 0.03) discard;
	vec3 col = mix(vec3(0.65, 0.82, 0.95), vec3(0.92, 0.96, 1.0), core);
	float a = mask * uOpacity * 0.55;
	gl_FragColor = vec4(col * a, a);
}
`;

type RainUniforms = {
	uSize: { value: number };
	uScale: { value: number };
	map: { value: THREE.Texture };
	uColor: { value: THREE.Color };
	uOpacity: { value: number };
	uRainIntensity: { value: number };
	uGlintStrength: { value: number };
	uLightCount: { value: number };
	uLightPos: { value: THREE.Vector3[] };
};

/**
 * Deszcz 3D — smukłe igły + delikatne flashy na murawie
 * + niska mgiełka nad trawą przy ulewie.
 */
export class WeatherSystem {
	readonly rainParticles: THREE.Points;
	readonly splashParticles: THREE.Points;
	readonly groundMist: THREE.Mesh;
	isRaining = false;
	intensity = 0;
	/**
	 * Docelowa intensywność deszczu.
	 * Pozwala uniknąć skoków jasności przy przełączaniu deszczu.
	 */
	private targetIntensity = 0;
	private readonly velocities: Float32Array;
	private readonly particleCount: number;
	private readonly streakTexture: THREE.Texture;
	private readonly material: THREE.ShaderMaterial;
	private readonly uniforms: RainUniforms;
	private readonly splashMaterial: THREE.ShaderMaterial;
	private readonly mistMaterial: THREE.ShaderMaterial;
	private readonly splashPositions: Float32Array;
	private readonly splashLife: Float32Array;
	private readonly splashSeed: Float32Array;
	private readonly splashDuration: Float32Array;
	private splashCursor = 0;
	private mistTime = 0;
	private readonly glintBase: number;
	private readonly lightScratch = [
		new THREE.Vector3(),
		new THREE.Vector3(),
		new THREE.Vector3(),
		new THREE.Vector3(),
	];

	constructor(scene: THREE.Scene, particleCount = 20_000) {
		this.particleCount = particleCount;
		const geometry = new THREE.BufferGeometry();
		const positions = new Float32Array(particleCount * 3);
		this.velocities = new Float32Array(particleCount);

		for (let i = 0; i < particleCount; i++) {
			positions[i * 3] = (Math.random() - 0.5) * 800;
			positions[i * 3 + 1] = Math.random() * 400;
			positions[i * 3 + 2] = (Math.random() - 0.5) * 800;
			this.velocities[i] = 1 + Math.random() * 2.5;
		}

		geometry.setAttribute(
			"position",
			new THREE.BufferAttribute(positions, 3),
		);

		this.streakTexture = createStreakTexture();
		this.glintBase = rainGlintStrengthForQuality(
			resolveGraphicsSettings().quality,
		);

		const lightPos = [
			new THREE.Vector3(0, 40, 0),
			new THREE.Vector3(0, 40, 0),
			new THREE.Vector3(0, 40, 0),
			new THREE.Vector3(0, 40, 0),
		];

		this.uniforms = {
			uSize: { value: 3.8 },
			uScale: { value: 240 },
			map: { value: this.streakTexture },
			uColor: { value: new THREE.Color(0xffffff) },
			uOpacity: { value: 0.72 },
			uRainIntensity: { value: 0 },
			uGlintStrength: { value: this.glintBase },
			uLightCount: { value: 0 },
			uLightPos: { value: lightPos },
		};

		this.material = new THREE.ShaderMaterial({
			uniforms: this.uniforms,
			vertexShader: rainVertexShader,
			fragmentShader: rainFragmentShader,
			transparent: true,
			depthWrite: false,
			depthTest: true,
			blending: THREE.AdditiveBlending,
			toneMapped: false,
		});

		this.rainParticles = new THREE.Points(geometry, this.material);
		this.rainParticles.name = "weather-rain";
		this.rainParticles.visible = false;
		this.rainParticles.frustumCulled = false;
		scene.add(this.rainParticles);

		this.splashPositions = new Float32Array(SPLASH_MAX * 3);
		this.splashLife = new Float32Array(SPLASH_MAX);
		this.splashSeed = new Float32Array(SPLASH_MAX);
		this.splashDuration = new Float32Array(SPLASH_MAX);
		for (let i = 0; i < SPLASH_MAX; i++) {
			this.splashLife[i] = 0;
			this.splashSeed[i] = Math.random();
			this.splashDuration[i] = 0.18;
			this.splashPositions[i * 3 + 1] = -40;
		}
		const splashGeo = new THREE.BufferGeometry();
		splashGeo.setAttribute(
			"position",
			new THREE.BufferAttribute(this.splashPositions, 3),
		);
		splashGeo.setAttribute(
			"aLife",
			new THREE.BufferAttribute(this.splashLife, 1),
		);
		splashGeo.setAttribute(
			"aSeed",
			new THREE.BufferAttribute(this.splashSeed, 1),
		);
		this.splashMaterial = new THREE.ShaderMaterial({
			uniforms: {
				uSize: { value: 9 },
				uScale: { value: 140 },
				uOpacity: { value: 0.45 },
			},
			vertexShader: splashVertexShader,
			fragmentShader: splashFragmentShader,
			transparent: true,
			depthWrite: false,
			depthTest: true,
			blending: THREE.AdditiveBlending,
			toneMapped: false,
		});
		this.splashParticles = new THREE.Points(splashGeo, this.splashMaterial);
		this.splashParticles.name = "weather-rain-splash";
		this.splashParticles.visible = false;
		this.splashParticles.frustumCulled = false;
		this.splashParticles.renderOrder = 3;
		scene.add(this.splashParticles);

		this.mistMaterial = new THREE.ShaderMaterial({
			uniforms: {
				uOpacity: { value: 0 },
				uTime: { value: 0 },
			},
			vertexShader: mistVertexShader,
			fragmentShader: mistFragmentShader,
			transparent: true,
			depthWrite: false,
			depthTest: true,
			blending: THREE.NormalBlending,
			side: THREE.DoubleSide,
			toneMapped: false,
		});
		const mistGeo = new THREE.PlaneGeometry(220, 280, 1, 1);
		mistGeo.rotateX(-Math.PI / 2);
		this.groundMist = new THREE.Mesh(mistGeo, this.mistMaterial);
		this.groundMist.name = "weather-ground-mist";
		this.groundMist.position.y = PLAYFIELD_SURFACE_Y + 0.85;
		this.groundMist.visible = false;
		this.groundMist.frustumCulled = false;
		this.groundMist.renderOrder = 2;
		scene.add(this.groundMist);
	}

	/**
	 * Pozycje jupiterów / flood (world) — max 4 dla specular glint na kroplach.
	 */
	setFloodLights(lights: readonly THREE.Object3D[]): void {
		const n = Math.min(MAX_FLOOD_LIGHTS, lights.length);
		this.uniforms.uLightCount.value = n;
		for (let i = 0; i < n; i++) {
			lights[i]!.getWorldPosition(this.lightScratch[i]!);
			this.uniforms.uLightPos.value[i]!.copy(this.lightScratch[i]!);
		}
	}

	toggleRain(): boolean {
		this.setRaining(!this.isRaining);
		return this.isRaining;
	}

	setRaining(on: boolean): void {
		this.isRaining = on;
		this.rainParticles.visible = on;
		this.splashParticles.visible = on;
		this.groundMist.visible = on;
		if (on) {
			// Start odczywalny, ale bez “przepalenia” (0.85 dawało skok).
			this.intensity = Math.max(this.intensity, 0.22);
			this.targetIntensity = Math.max(this.targetIntensity, 0.85);
		} else {
			this.targetIntensity = 0;
		}
		this.uniforms.uRainIntensity.value = this.intensity;
		this.uniforms.uOpacity.value = 0.55 + 0.35 * this.intensity;
		if (!on) {
			this.clearSplashes();
			this.mistMaterial.uniforms.uOpacity!.value = 0;
		}
	}

	/**
	 * Start meczu — losowo deszcz albo sucho.
	 * @returns true gdy pada.
	 */
	rollMatchWeather(chance = 0.5): boolean {
		const on = Math.random() < chance;
		this.setRaining(on);
		if (on) {
			// Testy oczekują, że intensity jest od razu > 0.5 — ustawiamy docelową
			// (ramp-up nadal jest bezpieczny, ale tu chcemy “match start” od razu).
			this.intensity = 0.62 + Math.random() * 0.38;
			this.targetIntensity = this.intensity;
			this.uniforms.uRainIntensity.value = this.intensity;
			this.uniforms.uOpacity.value = 0.55 + 0.35 * this.intensity;
		} else {
			this.intensity = 0;
			this.targetIntensity = 0;
			this.uniforms.uRainIntensity.value = 0;
			this.uniforms.uOpacity.value = 0.55;
		}
		return on;
	}

	private clearSplashes(): void {
		for (let i = 0; i < SPLASH_MAX; i++) {
			this.splashLife[i] = 0;
			this.splashPositions[i * 3 + 1] = -40;
		}
		const geo = this.splashParticles.geometry;
		(geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate =
			true;
		(geo.getAttribute("aLife") as THREE.BufferAttribute).needsUpdate = true;
	}

	private spawnSplash(wx: number, wz: number): void {
		const i = this.splashCursor;
		this.splashCursor = (this.splashCursor + 1) % SPLASH_MAX;
		this.splashPositions[i * 3] = wx;
		this.splashPositions[i * 3 + 1] = PLAYFIELD_SURFACE_Y + 0.04;
		this.splashPositions[i * 3 + 2] = wz;
		this.splashDuration[i] = 0.14 + Math.random() * 0.16;
		this.splashLife[i] = 1;
		this.splashSeed[i] = Math.random();
	}

	/**
	 * @param camera — lokalne pudło (±400) jest wycentrowane na kamerze XZ.
	 */
	update(delta: number, camera?: THREE.Camera): void {
		const dt = Math.min(Math.max(delta, 0), 0.1);
		this.mistTime += dt;
		this.mistMaterial.uniforms.uTime!.value = this.mistTime;

		if (!this.isRaining) {
			this.intensity = Math.max(0, this.intensity - dt * 1.5);
			this.uniforms.uRainIntensity.value = this.intensity;
			this.uniforms.uOpacity.value = 0.55 + 0.35 * this.intensity;
			this.mistMaterial.uniforms.uOpacity!.value = Math.max(
				0,
				this.mistMaterial.uniforms.uOpacity!.value - dt * 0.45,
			);
			this.tickSplashes(dt);
			if (this.intensity <= 0.001) {
				this.rainParticles.visible = false;
				this.splashParticles.visible = false;
				this.groundMist.visible = false;
			}
			return;
		}

		// RAMP toward targetIntensity (bez skoków w obie strony).
		const upTarget = Math.max(0, this.targetIntensity);
		if (this.intensity < upTarget) {
			this.intensity = Math.min(upTarget, this.intensity + dt * 1.5);
		} else {
			this.intensity = Math.max(upTarget, this.intensity - dt * 1.5);
		}
		this.rainParticles.visible = true;
		this.splashParticles.visible = true;
		this.groundMist.visible = true;
		this.uniforms.uRainIntensity.value = this.intensity;
		this.uniforms.uOpacity.value = 0.55 + 0.35 * this.intensity;
		this.uniforms.uGlintStrength.value = this.glintBase;
		this.splashMaterial.uniforms.uOpacity!.value =
			0.32 + 0.38 * this.intensity;
		/** Delikatna mgiełka — max ~0.18, nie zasłania boiska. */
		const mistTarget = 0.06 + 0.12 * this.intensity;
		this.mistMaterial.uniforms.uOpacity!.value = THREE.MathUtils.lerp(
			this.mistMaterial.uniforms.uOpacity!.value as number,
			mistTarget,
			1 - Math.exp(-dt * 1.8),
		);

		const cx = camera?.position.x ?? 0;
		const cz = camera?.position.z ?? 0;
		this.rainParticles.position.set(cx, 0, cz);
		this.groundMist.position.x = cx;
		this.groundMist.position.z = cz;

		const attr = this.rainParticles.geometry.getAttribute(
			"position",
		) as THREE.BufferAttribute;
		const positions = attr.array as Float32Array;

		/** Mniej flashy — czytelne igły, nie „śnieg” na murawie. */
		const splashChance = 0.04 + 0.1 * this.intensity;

		for (let i = 0; i < this.particleCount; i++) {
			const i3 = i * 3;
			const speed = this.velocities[i]!;
			positions[i3]! -= speed * dt * 20;
			positions[i3 + 1]! -= speed * dt * 250;
			positions[i3 + 2]! -= speed * dt * 10;

			if (positions[i3 + 1]! < 0) {
				if (Math.random() < splashChance) {
					this.spawnSplash(cx + positions[i3]!, cz + positions[i3 + 2]!);
				}
				positions[i3] = (Math.random() - 0.5) * 800;
				positions[i3 + 1] = 360 + Math.random() * 40;
				positions[i3 + 2] = (Math.random() - 0.5) * 800;
			}
		}

		attr.needsUpdate = true;
		this.tickSplashes(dt);
	}

	private tickSplashes(dt: number): void {
		let any = false;
		for (let i = 0; i < SPLASH_MAX; i++) {
			const life = this.splashLife[i]!;
			if (life <= 0) continue;
			const dur = Math.max(this.splashDuration[i]!, 0.05);
			const next = life - dt / dur;
			if (next <= 0) {
				this.splashLife[i] = 0;
				this.splashPositions[i * 3 + 1] = -40;
			} else {
				this.splashLife[i] = next;
				any = true;
			}
		}
		const geo = this.splashParticles.geometry;
		(geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate =
			true;
		(geo.getAttribute("aLife") as THREE.BufferAttribute).needsUpdate = true;
		if (!this.isRaining && !any) {
			this.splashParticles.visible = false;
		}
	}

	dispose(): void {
		this.rainParticles.parent?.remove(this.rainParticles);
		this.rainParticles.geometry.dispose();
		this.material.dispose();
		this.streakTexture.dispose();
		this.splashParticles.parent?.remove(this.splashParticles);
		this.splashParticles.geometry.dispose();
		this.splashMaterial.dispose();
		this.groundMist.parent?.remove(this.groundMist);
		this.groundMist.geometry.dispose();
		this.mistMaterial.dispose();
	}
}
