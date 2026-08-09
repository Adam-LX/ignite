/**
 * Centrum boiska — płaska płytka z logo (bez prostokątnego glow / „ramki”).
 * Nad linią środkową (wyżej Y + wyższy renderOrder niż pitch overlay).
 */

import * as THREE from "three";
import { assetUrl } from "../util/assetUrl";
import { PLAYFIELD_SURFACE_Y } from "./arenaConstants";

const LOGO_URL = assetUrl("/assets/textures/ignite_pitch_logo.png");
/**
 * Długość napisu wzdłuż Z (blue↔orange). Koło musi dominować —
 * logo ma siedzieć W ŚRODKU kolorowych półkul, nie je zasłaniać.
 */
const LENGTH_M = 11.5;
/** Overlay @ +0.01 — logo nad liniami, pod mocnym glow. */
const SURFACE_Y = PLAYFIELD_SURFACE_Y + 0.028;
/** Yaw: tekst wzdłuż Z (prostopadle do linii środkowej na osi X). */
const YAW_FLAT = Math.PI / 2;
const EMISSIVE_BASE = 0.42;
const EMISSIVE_PULSE = 0.1;

let badgeRoot: THREE.Group | null = null;
let badgeMat: THREE.MeshStandardMaterial | null = null;
let loadGen = 0;

function disposeRoot(root: THREE.Object3D): void {
	const disposedTex = new Set<THREE.Texture>();
	root.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return;
		obj.geometry?.dispose();
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		for (const m of mats) {
			if (!(m instanceof THREE.Material)) continue;
			const std = m as THREE.MeshStandardMaterial & {
				map?: THREE.Texture | null;
				emissiveMap?: THREE.Texture | null;
			};
			for (const tex of [std.map, std.emissiveMap]) {
				if (tex && !disposedTex.has(tex)) {
					disposedTex.add(tex);
					tex.dispose();
				}
			}
			m.dispose();
		}
	});
}

export function disposePitchIgniteBadge(): void {
	loadGen += 1;
	badgeMat = null;
	if (!badgeRoot) return;
	badgeRoot.removeFromParent();
	disposeRoot(badgeRoot);
	badgeRoot = null;
}

/**
 * Wytnij czarne tło PNG tylko gdy asset nie ma własnego alpha
 * (stare logo na czarnym kwadracie). Nowoczesne logo ma już
 * przezroczystość + ciemny bieżnik — punch zniszczyłby detale.
 */
function punchLogoBackdrop(tex: THREE.Texture): void {
	const img = tex.image as
		| HTMLImageElement
		| HTMLCanvasElement
		| ImageBitmap
		| null;
	if (!img || typeof document === "undefined") return;

	const w =
		"width" in img
			? (img as HTMLImageElement).width ||
				(img as ImageBitmap).width ||
				0
			: 0;
	const h =
		"height" in img
			? (img as HTMLImageElement).height ||
				(img as ImageBitmap).height ||
				0
			: 0;
	if (w < 8 || h < 8) return;

	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.drawImage(img as CanvasImageSource, 0, 0);
	const data = ctx.getImageData(0, 0, w, h);
	const px = data.data;

	let transparent = 0;
	const sampleStep = 16;
	for (let y = 0; y < h; y += sampleStep) {
		for (let x = 0; x < w; x += sampleStep) {
			if (px[(y * w + x) * 4 + 3]! < 16) transparent += 1;
		}
	}
	const samples = Math.ceil(w / sampleStep) * Math.ceil(h / sampleStep);
	/** Asset już ma alpha — nie ruszaj ciemnych detali (bieżnik). */
	if (transparent / Math.max(1, samples) > 0.08) {
		tex.image = canvas;
		tex.needsUpdate = true;
		return;
	}

	for (let i = 0; i < px.length; i += 4) {
		const r = px[i]!;
		const g = px[i + 1]!;
		const b = px[i + 2]!;
		const a = px[i + 3]!;
		const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		/** Ciemne tło / półprzezroczysty brud → pełna dziura. */
		if (lum < 28 || (lum < 48 && a < 220)) {
			px[i + 3] = 0;
		} else if (a > 0 && lum < 70) {
			/** Miękki falloff krawędzi — bez twardego „pudełka”. */
			px[i + 3] = Math.min(a, Math.floor(((lum - 28) / 42) * a));
		}
	}
	ctx.putImageData(data, 0, 0);
	tex.image = canvas;
	tex.needsUpdate = true;
}

function loadLogoTexture(): Promise<THREE.Texture> {
	return new Promise((resolve, reject) => {
		const loader = new THREE.TextureLoader();
		loader.load(
			LOGO_URL,
			(tex) => {
				punchLogoBackdrop(tex);
				tex.colorSpace = THREE.SRGBColorSpace;
				tex.anisotropy = 16;
				tex.generateMipmaps = true;
				tex.minFilter = THREE.LinearMipmapLinearFilter;
				tex.magFilter = THREE.LinearFilter;
				tex.premultiplyAlpha = true;
				tex.needsUpdate = true;
				resolve(tex);
			},
			undefined,
			reject,
		);
	});
}

/** Async mount — plane na murawie, bez colliders. */
export async function mountPitchIgniteBadge(
	parent: THREE.Object3D,
): Promise<THREE.Group | null> {
	disposePitchIgniteBadge();
	const gen = loadGen;
	try {
		const tex = await loadLogoTexture();
		if (gen !== loadGen) {
			tex.dispose();
			return null;
		}

		const img = tex.image as { width?: number; height?: number };
		const iw = Math.max(1, img.width ?? 1024);
		const ih = Math.max(1, img.height ?? 560);
		const depthM = LENGTH_M * (ih / iw);

		const mat = new THREE.MeshStandardMaterial({
			name: "pitchIgniteBadgeMat",
			map: tex,
			emissiveMap: tex,
			emissive: new THREE.Color(0xffffff),
			emissiveIntensity: EMISSIVE_BASE,
			color: new THREE.Color(0xffffff),
			metalness: 0.02,
			roughness: 0.55,
			transparent: true,
			alphaTest: 0.2,
			depthWrite: false,
			depthTest: true,
			side: THREE.DoubleSide,
			envMapIntensity: 0.15,
			toneMapped: false,
		});
		badgeMat = mat;

		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(LENGTH_M, depthM),
			mat,
		);
		mesh.name = "pitchIgniteBadgeMesh";
		mesh.rotation.x = -Math.PI / 2;
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		mesh.frustumCulled = false;
		/** Nad pitch overlay (renderOrder 4) — linia środkowa nie przecina logo. */
		mesh.renderOrder = 6;

		const root = new THREE.Group();
		root.name = "pitchIgniteBadge";
		root.rotation.y = YAW_FLAT;
		root.position.y = SURFACE_Y;
		root.add(mesh);
		parent.add(root);
		badgeRoot = root;
		return root;
	} catch (err) {
		console.warn("[pitchIgniteBadge] load failed", err);
		return null;
	}
}

export function updatePitchIgniteBadge(timeSec: number): void {
	if (!badgeMat) return;
	badgeMat.emissiveIntensity =
		EMISSIVE_BASE + EMISSIVE_PULSE * (0.5 + 0.5 * Math.sin(timeSec * 1.7));
}

export function getPitchIgniteBadge(): THREE.Group | null {
	return badgeRoot;
}

/** Połowa szerokości logo wzdłuż osi X boiska (dla przerwy w linii środkowej). */
export function getPitchIgniteBadgeMidlineGapM(): number {
	/** ignite_pitch_logo.png — trimmed modern mark ≈ 2048×898. */
	return (LENGTH_M * (898 / 2048)) * 0.55;
}
