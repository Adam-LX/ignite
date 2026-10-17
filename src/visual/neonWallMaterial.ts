import * as THREE from "three";
import { resolveArenaNeonHex } from "../arena/arenaNeonAccent";
import {
	getCachedMeshyTexture,
	getMeshyArenaManifest,
	resolveMeshyTexture,
} from "./meshyArenaAssets";

const WALL_BASE = 0x060a14;
const CEILING_BASE = 0x050812;

const TEAM_GRID = {
	blue: 0x55e0ff,
	orange: 0xff9955,
} as const;

/** Kolorowe bandy (jak stare MeshStandard) — nasycone, nie carbon. */
const BAND_BASE = {
	blue: 0x0044cc,
	orange: 0xcc4400,
} as const;

/** Jaśniejszy „emit” na szwach / krawędzi. */
const BAND_GLOW = {
	blue: 0x66eeff,
	orange: 0xffaa55,
} as const;

const surfaceMaterials: THREE.ShaderMaterial[] = [];
let atmosphereLineBoost = 0;

export type NeonSurfaceKind = "wall" | "ceiling";
export type NeonTeam = "blue" | "orange" | "accent";

const SURFACE_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vPanelUv;

uniform float uPanelScale;

void main() {
	vec4 wp = modelMatrix * vec4(position, 1.0);
	vWorldPos = wp.xyz;
	vWorldNormal = normalize(mat3(modelMatrix) * normal);
	vPanelUv = wp.xz * uPanelScale;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SURFACE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uGridColor;
uniform vec3 uBaseColor;
uniform float uGridScale;
uniform float uBaseOpacity;
uniform float uLineBoost;
uniform float uEmissiveBoost;
uniform float uPulseAmp;
uniform float uCeilingMode;
uniform float uBandMode;
uniform float uBandWash;
uniform float uFadeY0;
uniform float uFadeY1;
uniform float uHeightFade;
uniform sampler2D uPanelTex;
uniform float uPanelMix;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vPanelUv;

float hexDist(vec2 p) {
	p = abs(p);
	return max(p.x * 0.866025 + p.y * 0.5, p.y);
}

vec2 hexUv(vec3 worldPos, vec3 n) {
	vec2 hp;
	if (uCeilingMode > 0.5 || abs(n.y) > 0.72) {
		hp = worldPos.xz;
	} else {
		vec3 up = vec3(0.0, 1.0, 0.0);
		vec3 t = cross(n, up);
		float tLen = length(t);
		if (tLen < 0.08) {
			t = vec3(1.0, 0.0, 0.0);
		} else {
			t /= tLen;
		}
		hp = vec2(dot(worldPos, t), worldPos.y);
	}
	return hp * uGridScale;
}

void main() {
	vec3 n = normalize(vWorldNormal);
	vec2 hp = hexUv(vWorldPos, n);
	hp.x *= 1.1547;
	float row = floor(hp.y);
	hp.x += mod(row, 2.0) * 0.5;
	vec2 cell = fract(hp) - 0.5;
	float hd = hexDist(cell);
	float fw = max(fwidth(hd) * 1.35, 0.012);
	/** Tylko obrys — pierścień przy krawędzi komórki, zero fill. */
	float edge = 0.455;
	float hexLine = 1.0 - smoothstep(0.0, fw, abs(hd - edge));

	float cellId = dot(floor(hp + vec2(row * 0.01, 0.0)), vec2(0.37, 0.61));
	float pulse =
		0.62 +
		uPulseAmp *
			sin(uTime * 2.05 + vWorldPos.y * 0.14 + cellId * 2.4);
	float wave =
		0.55 +
		0.45 * sin(uTime * 1.55 - length(floor(hp)) * 0.42 + vWorldPos.x * 0.03);

	float line = hexLine * pulse * wave;
	vec3 col = uBaseColor;

	if (uBandMode > 0.5) {
		/** Gradient wysokości: ciemniej przy murawie, żywszy pod LED. */
		float h = clamp(vWorldPos.y / 12.0, 0.0, 1.0);
		col *= 0.72 + 0.38 * h;
		/** Lekki „panel” w środku heksa — nie fill, tylko mikrotekstura. */
		float micro = smoothstep(0.48, 0.2, hd) * 0.07;
		col += uGridColor * micro;
		/** Poziome żebra — banda ma rytm, nie jest płaskim blobem. */
		float rib = abs(fract(vWorldPos.y * 1.05 + 0.15) - 0.5);
		float ribLine = (1.0 - smoothstep(0.0, 0.035, rib)) * 0.16;
		col += uGridColor * ribLine;
		/** Fresnel na krawędzi rampy / ściany. */
		vec3 viewDir = normalize(cameraPosition - vWorldPos);
		float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 2.2);
		col += uGridColor * fres * 0.28;
		/** Miękki emissive wash (stary feel MeshStandard), bez mydła. */
		col += uGridColor * uBandWash * (0.55 + 0.2 * pulse);
	}

	col = mix(col, uGridColor, line * 0.72);
	col += uGridColor * line * uEmissiveBoost;

	/** Per-panel variance — nie jednolity ekran LED. */
	float panelHash = fract(sin(dot(floor(hp), vec2(12.9898, 78.233))) * 43758.5453);
	col *= mix(0.88, 1.12, panelHash);
	/** Rzadki chase wzdłuż linii heksów. */
	float chase = 0.5 + 0.5 * sin(uTime * 1.1 + cellId * 3.1 + vWorldPos.y * 0.08);
	col += uGridColor * line * chase * 0.12 * uPulseAmp;

	vec3 panel = texture2D(uPanelTex, vPanelUv).rgb;
	col = mix(col, panel * 0.7 + uBaseColor * 0.3, uPanelMix * (1.0 - hexLine));

	/** Linie heksów zawsze czytelniejsze niż baza (glass nie gubi obrysu). */
	float baseA = uBaseOpacity;
	float lineA = clamp(uLineBoost * pulse, 0.0, 0.95);

	/** Nad LED: baza znika szybko; hex obrys zostaje czytelny wyżej. */
	if (uHeightFade > 0.5) {
		float span = max(uFadeY1 - uFadeY0, 0.001);
		float t = clamp((vWorldPos.y - uFadeY0) / span, 0.0, 1.0);
		float baseFade = 1.0 - smoothstep(0.0, 0.45, t);
		baseFade *= baseFade;
		float lineFade = 1.0 - smoothstep(0.05, 0.92, t);
		baseA *= baseFade;
		lineA *= lineFade;
		col = mix(col * (0.4 + 0.6 * baseFade), col, hexLine);
	}

	float alpha = mix(baseA, max(baseA, lineA), hexLine);
	gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`;

export type NeonSurfaceOpts = {
	kind: NeonSurfaceKind;
	team?: NeonTeam;
	gridColor?: number;
	baseColor?: number;
	/** 0–1 — rampa/banda solidniejsza, glass ściana/sufit prześwituje. */
	opacity?: number;
	gridScale?: number;
	lineBoost?: number;
	emissiveBoost?: number;
	pulseAmp?: number;
	usePanelTex?: boolean;
	opaque?: boolean;
	bandMode?: boolean;
	bandWash?: number;
	heightFade?: boolean;
	side?: THREE.Side;
};

function blankPanelTex(): THREE.DataTexture {
	const tex = new THREE.DataTexture(new Uint8Array([8, 12, 22, 255]), 1, 1);
	tex.needsUpdate = true;
	return tex;
}

function resolveGridHex(team: NeonTeam, override?: number): number {
	if (override != null) return override;
	if (team === "blue") return TEAM_GRID.blue;
	if (team === "orange") return TEAM_GRID.orange;
	return resolveArenaNeonHex();
}

/** Emissive hex grid — ściany / rampy / sufit. */
export function createNeonSurfaceMaterial(
	opts: NeonSurfaceOpts,
): THREE.ShaderMaterial {
	const kind = opts.kind;
	const team = opts.team ?? "accent";
	const isCeiling = kind === "ceiling";
	const manifest = getMeshyArenaManifest();
	const wantPanel = opts.usePanelTex !== false && !isCeiling;
	const hasPanel = wantPanel && !!manifest?.wallPanel;
	const cached = hasPanel ? getCachedMeshyTexture("wallPanel") : null;
	const panelTex =
		cached ??
		(hasPanel
			? new THREE.TextureLoader().load(resolveMeshyTexture("wallPanel", ""))
			: blankPanelTex());
	panelTex.wrapS = THREE.RepeatWrapping;
	panelTex.wrapT = THREE.RepeatWrapping;
	panelTex.colorSpace = THREE.SRGBColorSpace;
	panelTex.needsUpdate = true;

	const baseHex =
		opts.baseColor ??
		(isCeiling
			? CEILING_BASE
			: team === "blue"
				? BAND_BASE.blue
				: team === "orange"
					? BAND_BASE.orange
					: WALL_BASE);
	const opaque = opts.opaque === true;
	const baseOpacity =
		opts.opacity ?? (isCeiling ? 0.08 : hasPanel ? 0.14 : 0.1);
	const lineBoost = opts.lineBoost ?? (isCeiling ? 0.28 : 0.22);
	const emissiveBoost = opts.emissiveBoost ?? (isCeiling ? 0.68 : 0.58);
	const gridScale = opts.gridScale ?? (isCeiling ? 0.34 : 0.48);
	const pulseAmp = opts.pulseAmp ?? 0.22;

	const mat = new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uGridColor: {
				value: new THREE.Color(resolveGridHex(team, opts.gridColor)),
			},
			uBaseColor: {
				value: new THREE.Color(baseHex),
			},
			uGridScale: { value: gridScale },
			uBaseOpacity: { value: baseOpacity },
			uLineBoost: { value: lineBoost },
			uEmissiveBoost: { value: emissiveBoost },
			uPulseAmp: { value: pulseAmp },
			uCeilingMode: { value: isCeiling ? 1 : 0 },
			uBandMode: { value: opts.bandMode ? 1 : 0 },
			uBandWash: { value: opts.bandWash ?? 0.18 },
			uFadeY0: { value: 0 },
			uFadeY1: { value: 1 },
			uHeightFade: { value: opts.heightFade ? 1 : 0 },
			uPanelTex: { value: panelTex },
			uPanelMix: { value: hasPanel ? 0.18 : 0 },
			uPanelScale: { value: 0.038 },
		},
		vertexShader: SURFACE_VERTEX,
		fragmentShader: SURFACE_FRAGMENT,
		transparent: !opaque,
		depthWrite: opaque,
		side: opts.side ?? THREE.DoubleSide,
		toneMapped: opts.bandMode ? true : false,
		fog: false,
	});
	mat.userData.baseLineBoost = lineBoost;
	mat.userData.baseOpacity = baseOpacity;
	mat.userData.basePulseAmp = pulseAmp;
	mat.userData.baseEmissiveBoost = emissiveBoost;
	mat.userData.team = team;
	mat.userData.neonSurface = true;
	mat.userData.opaqueBand = opaque;
	mat.userData.bandMode = !!opts.bandMode;
	surfaceMaterials.push(mat);
	return mat;
}

/** Legacy — accent glass wall. */
export function createNeonWallMaterial(): THREE.ShaderMaterial {
	return createNeonSurfaceMaterial({
		kind: "wall",
		team: "accent",
		opacity: 0.08,
		lineBoost: 0.55,
		emissiveBoost: 0.7,
		pulseAmp: 0.25,
	});
}

type LookOpts = {
	opacity: number;
	lineBoost: number;
	emissiveBoost: number;
	pulseAmp: number;
};

function applyLook(mat: THREE.ShaderMaterial, opts: LookOpts): void {
	mat.uniforms.uBaseOpacity.value = opts.opacity;
	mat.uniforms.uLineBoost.value = opts.lineBoost;
	mat.uniforms.uEmissiveBoost.value = opts.emissiveBoost;
	mat.uniforms.uPulseAmp.value = opts.pulseAmp;
	mat.userData.baseOpacity = opts.opacity;
	mat.userData.baseLineBoost = opts.lineBoost;
	mat.userData.basePulseAmp = opts.pulseAmp;
}

/** Kolorowa banda / rampa — nasycony team + hex szwy + żebra. */
const BAND_LOOK = {
	opacity: 1,
	lineBoost: 0.42,
	emissiveBoost: 0.68,
	pulseAmp: 0.26,
} as const;

/** Górna ściana — gęstsza skorupa stadionu + mocny hex. */
const GLASS_LOOK = {
	opacity: 0.055,
	lineBoost: 1.05,
	emissiveBoost: 1.35,
	pulseAmp: 0.38,
} as const;

const CEILING_LOOK = {
	opacity: 0.06,
	lineBoost: 1.08,
	emissiveBoost: 1.4,
	pulseAmp: 0.38,
} as const;

const bandMats: Record<"blue" | "orange", THREE.ShaderMaterial | null> = {
	blue: null,
	orange: null,
};
const glassMats: Record<"blue" | "orange", THREE.ShaderMaterial | null> = {
	blue: null,
	orange: null,
};
let ceilingMat: THREE.ShaderMaterial | null = null;

/**
 * Bandy + rampy: żywy blue/orange (stary feel) + hex szwy, żebra, fresnel.
 */
export function neonTeamBandMaterial(
	team: "blue" | "orange",
): THREE.ShaderMaterial {
	let mat = bandMats[team];
	if (!mat) {
		mat = createNeonSurfaceMaterial({
			kind: "wall",
			team,
			baseColor: BAND_BASE[team],
			gridColor: BAND_GLOW[team],
			...BAND_LOOK,
			gridScale: 0.52,
			usePanelTex: false,
			opaque: true,
			bandMode: true,
			bandWash: 0.2,
			side: THREE.FrontSide,
		});
		bandMats[team] = mat;
	} else {
		applyLook(mat, BAND_LOOK);
		mat.uniforms.uBaseColor.value.setHex(BAND_BASE[team]);
		mat.uniforms.uGridColor.value.setHex(BAND_GLOW[team]);
		mat.uniforms.uBandMode.value = 1;
		mat.uniforms.uBandWash.value = 0.2;
		mat.transparent = false;
		mat.depthWrite = true;
		mat.toneMapped = true;
		mat.side = THREE.FrontSide;
	}
	return mat;
}

/** Górna klatka nad LED — glass hex zanikający w skybox. */
export function neonTeamGlassMaterial(
	team: "blue" | "orange",
): THREE.ShaderMaterial {
	let mat = glassMats[team];
	if (!mat) {
		mat = createNeonSurfaceMaterial({
			kind: "wall",
			team,
			baseColor: WALL_BASE,
			...GLASS_LOOK,
			gridScale: 0.42,
			usePanelTex: false,
			opaque: false,
			heightFade: true,
		});
		glassMats[team] = mat;
	} else {
		applyLook(mat, GLASS_LOOK);
		mat.uniforms.uHeightFade.value = 1;
		mat.transparent = true;
		mat.depthWrite = false;
		mat.depthTest = true;
	}
	return mat;
}

/** Zakres zaniku glass (światowe Y) — od LED w górę. */
export function setNeonGlassFadeRange(y0: number, y1: number): void {
	for (const team of ["blue", "orange"] as const) {
		const mat = glassMats[team];
		if (!mat) continue;
		mat.uniforms.uFadeY0.value = y0;
		mat.uniforms.uFadeY1.value = y1;
		mat.uniforms.uHeightFade.value = 1;
	}
}

/** @deprecated alias → band (rampy). */
export function neonTeamWallMaterial(
	team: "blue" | "orange",
): THREE.ShaderMaterial {
	return neonTeamBandMaterial(team);
}

export function neonCeilingHexMaterial(): THREE.ShaderMaterial {
	if (!ceilingMat) {
		ceilingMat = createNeonSurfaceMaterial({
			kind: "ceiling",
			team: "accent",
			...CEILING_LOOK,
			gridScale: 0.32,
			usePanelTex: false,
		});
	} else {
		applyLook(ceilingMat, CEILING_LOOK);
		ceilingMat.transparent = true;
		ceilingMat.depthWrite = false;
	}
	return ceilingMat;
}

export function setNeonWallAtmosphereBoost(boost: number): void {
	// Cap a bit lower to keep band readability in night + flood scenes.
	atmosphereLineBoost = THREE.MathUtils.clamp(boost, 0, 1.25);
}

/** Menu orbit — cichsza siatka (bez „god ray” smug przez kadr). */
export function setNeonWallMenuCalm(calm: boolean): void {
	for (const mat of surfaceMaterials) {
		const base = (mat.userData.baseLineBoost as number | undefined) ?? 0.24;
		const baseOpacity =
			(mat.userData.baseOpacity as number | undefined) ?? 0.26;
		const basePulse =
			(mat.userData.basePulseAmp as number | undefined) ?? 0.38;
		if (calm) {
			mat.uniforms.uBaseOpacity.value = baseOpacity * 0.55;
			mat.uniforms.uPulseAmp.value = basePulse * 0.3;
			mat.userData.menuCalm = true;
			mat.userData.baseLineBoostMenu = base * 0.35;
		} else {
			mat.uniforms.uBaseOpacity.value = baseOpacity;
			mat.uniforms.uPulseAmp.value = basePulse;
			mat.userData.menuCalm = false;
			delete mat.userData.baseLineBoostMenu;
		}
	}
}

/** Kolor neonu band z aktywnej mapy — tylko accent (team blue/orange bez zmian). */
export function setArenaNeonAccent(accent?: string): void {
	const hex = resolveArenaNeonHex(accent);
	const color = new THREE.Color(hex);
	for (const mat of surfaceMaterials) {
		if (mat.userData.team === "blue" || mat.userData.team === "orange") {
			continue;
		}
		mat.uniforms.uGridColor.value.copy(color);
	}
}

export function updateNeonWallMaterials(
	timeSec: number,
	cameraPos?: THREE.Vector3,
): void {
	const camMul =
		cameraPos != null
			? THREE.MathUtils.clamp(
					1 / (1 + Math.hypot(cameraPos.x, cameraPos.z) / 130),
					0.7,
					1,
				)
			: 1;
	for (const mat of surfaceMaterials) {
		mat.uniforms.uTime.value = timeSec;
		const base =
			(mat.userData.baseLineBoostMenu as number | undefined) ??
			(mat.userData.baseLineBoost as number | undefined) ??
			0.24;
		mat.uniforms.uLineBoost.value = base * (1 + atmosphereLineBoost * 0.55);

		// Keep emissive a bit tamer in periphery to reduce “neon wash” noise.
		const baseEmissive =
			(mat.userData.baseEmissiveBoost as number | undefined) ?? 0.45;
		const calmMul = mat.userData.menuCalm ? 0.72 : 1;
		mat.uniforms.uEmissiveBoost.value = baseEmissive * camMul * calmMul;
	}
}
