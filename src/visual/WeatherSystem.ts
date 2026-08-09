import * as THREE from "three";

import {
	rainGlintStrengthForQuality,
	resolveGraphicsSettings,
} from "../util/graphicsProfile";

const STREAK_W = 64;
const STREAK_H = 128;
const MAX_FLOOD_LIGHTS = 4;

/** Owalna smuga z miękkim falloffem — bez kwadratowych billboardów na screenie. */
function fillOvalStreak(
	data: Uint8Array,
	w: number,
	h: number,
): void {
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const nx = (x + 0.5) / w * 2 - 1;
			const ny = (y + 0.5) / h * 2 - 1;
			/** Elipsa wyższa niż szersza — look „kropli w ruchu”. */
			const d = Math.hypot(nx * 1.85, ny * 0.92);
			const radial = 1 - THREE.MathUtils.smoothstep(d, 0.12, 1.05);
			const tip = Math.sin(Math.PI * ((y + 0.5) / h));
			const a = Math.round(255 * radial * tip * 0.92);
			const i = (y * w + x) * 4;
			data[i] = 210;
			data[i + 1] = 235;
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
	gl_PointSize = uSize * (uScale / max(-mvPosition.z, 0.1));
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

	/** Proceduralny owal — gasi kwadratowe rogi billboardu Points. */
	vec2 centered = uv - 0.5;
	float oval = 1.0 - smoothstep(0.18, 0.48, length(centered * vec2(2.35, 1.05)));
	float softX = 1.0 - smoothstep(0.06, 0.38, abs(centered.x));
	float softY = 1.0 - smoothstep(0.04, 0.48, abs(centered.y));
	float soft = oval * softX * softY;
	float mask = tex.a * soft;
	if (mask < 0.012) discard;

	vec3 viewDir = normalize(cameraPosition - vWorldPosition);
	float glint = 0.0;
	for (int i = 0; i < 4; i++) {
		if (i >= uLightCount) break;
		vec3 lightDir = normalize(uLightPos[i] - vWorldPosition);
		float align = max(dot(viewDir, lightDir), 0.0);
		glint += pow(align, 28.0) + 0.55 * pow(align, 8.0);
	}
	glint = min(glint, 3.2) * uGlintStrength * uRainIntensity;

	vec3 base = uColor * tex.rgb;
	vec3 sparkle = vec3(0.9, 0.96, 1.0) * glint;
	vec3 col = (base * (0.55 + 0.45 * uRainIntensity) + sparkle) * mask * uOpacity;
	gl_FragColor = vec4(col, mask * uOpacity);
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
 * Deszcz 3D — Points + owalna smuga + soft-edge shader + glint od jupiterów.
 * Pudło śledzi kamerę żeby smugi były zawsze w kadrze chase.
 */
export class WeatherSystem {
	readonly rainParticles: THREE.Points;
	isRaining = false;
	intensity = 0;
	private readonly velocities: Float32Array;
	private readonly particleCount: number;
	private readonly streakTexture: THREE.Texture;
	private readonly material: THREE.ShaderMaterial;
	private readonly uniforms: RainUniforms;
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
			uSize: { value: 4.2 },
			uScale: { value: 260 },
			map: { value: this.streakTexture },
			uColor: { value: new THREE.Color(0xffffff) },
			uOpacity: { value: 0.75 },
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
		this.isRaining = !this.isRaining;
		this.rainParticles.visible = this.isRaining;
		if (this.isRaining) this.intensity = Math.max(this.intensity, 0.85);
		return this.isRaining;
	}

	setRaining(on: boolean): void {
		this.isRaining = on;
		this.rainParticles.visible = on;
		if (on) this.intensity = Math.max(this.intensity, 0.85);
		this.uniforms.uRainIntensity.value = this.intensity;
		this.uniforms.uOpacity.value = 0.55 + 0.35 * this.intensity;
	}

	/**
	 * Start meczu — losowo deszcz albo sucho.
	 * @returns true gdy pada.
	 */
	rollMatchWeather(chance = 0.5): boolean {
		const on = Math.random() < chance;
		this.setRaining(on);
		if (on) {
			this.intensity = 0.62 + Math.random() * 0.38;
			this.uniforms.uRainIntensity.value = this.intensity;
			this.uniforms.uOpacity.value = 0.55 + 0.35 * this.intensity;
		} else {
			this.intensity = 0;
			this.uniforms.uRainIntensity.value = 0;
			this.uniforms.uOpacity.value = 0.55;
		}
		return on;
	}

	/**
	 * @param camera — lokalne pudło (±400) jest wycentrowane na kamerze XZ.
	 */
	update(delta: number, camera?: THREE.Camera): void {
		const dt = Math.min(Math.max(delta, 0), 0.1);

		if (!this.isRaining) {
			this.intensity = Math.max(0, this.intensity - dt * 1.5);
			this.uniforms.uRainIntensity.value = this.intensity;
			this.uniforms.uOpacity.value = 0.55 + 0.35 * this.intensity;
			if (this.intensity <= 0.001) {
				this.rainParticles.visible = false;
			}
			return;
		}

		this.intensity = Math.min(1, this.intensity + dt * 1.5);
		this.rainParticles.visible = true;
		this.uniforms.uRainIntensity.value = this.intensity;
		this.uniforms.uOpacity.value = 0.55 + 0.35 * this.intensity;
		this.uniforms.uGlintStrength.value = this.glintBase;

		const cx = camera?.position.x ?? 0;
		const cz = camera?.position.z ?? 0;
		this.rainParticles.position.set(cx, 0, cz);

		const attr = this.rainParticles.geometry.getAttribute(
			"position",
		) as THREE.BufferAttribute;
		const positions = attr.array as Float32Array;

		for (let i = 0; i < this.particleCount; i++) {
			const i3 = i * 3;
			const speed = this.velocities[i]!;
			positions[i3]! -= speed * dt * 20;
			positions[i3 + 1]! -= speed * dt * 250;
			positions[i3 + 2]! -= speed * dt * 10;

			if (positions[i3 + 1]! < 0) {
				positions[i3] = (Math.random() - 0.5) * 800;
				positions[i3 + 1] = 360 + Math.random() * 40;
				positions[i3 + 2] = (Math.random() - 0.5) * 800;
			}
		}

		attr.needsUpdate = true;
	}

	dispose(): void {
		this.rainParticles.parent?.remove(this.rainParticles);
		this.rainParticles.geometry.dispose();
		this.material.dispose();
		this.streakTexture.dispose();
	}
}
