/**
 * Centrum boiska — płaska płytka z logo + emissive glow.
 * Orientacja: płasko na murawie, napis prostopadle do linii środkowej (wzdłuż Z).
 */

import * as THREE from "three";
import { assetUrl } from "../util/assetUrl";
import { PLAYFIELD_SURFACE_Y } from "./arenaConstants";

const LOGO_URL = assetUrl("/assets/textures/ignite_pitch_logo.png");
/** Długość napisu (wzdłuż Z — niebieska↔pomarańczowa). Koło R=10.5 m. */
const LENGTH_M = 15.2;
const SURFACE_Y = PLAYFIELD_SURFACE_Y + 0.012;
/** Yaw: tekst wzdłuż Z (prostopadle do linii środkowej na osi X). */
const YAW_FLAT = Math.PI / 2;
const EMISSIVE_BASE = 0.2;
const EMISSIVE_PULSE = 0.05;

let badgeRoot: THREE.Group | null = null;
let badgeMat: THREE.MeshStandardMaterial | null = null;
let loadGen = 0;

function disposeRoot(root: THREE.Object3D): void {
	root.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return;
		obj.geometry?.dispose();
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		for (const m of mats) {
			if (!(m instanceof THREE.Material)) continue;
			const std = m as THREE.MeshStandardMaterial;
			std.map?.dispose();
			std.emissiveMap?.dispose();
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

function loadLogoTexture(): Promise<THREE.Texture> {
	return new Promise((resolve, reject) => {
		const loader = new THREE.TextureLoader();
		loader.load(
			LOGO_URL,
			(tex) => {
				tex.colorSpace = THREE.SRGBColorSpace;
				tex.anisotropy = 8;
				tex.generateMipmaps = true;
				tex.minFilter = THREE.LinearMipmapLinearFilter;
				tex.magFilter = THREE.LinearFilter;
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
			metalness: 0.82,
			roughness: 0.22,
			transparent: true,
			alphaTest: 0.12,
			depthWrite: false,
			side: THREE.DoubleSide,
			envMapIntensity: 1.15,
		});
		badgeMat = mat;

		// Sam mesh: tylko płasko na XZ. Yaw na root — inaczej Euler stawia plane pionowo.
		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(LENGTH_M, depthM),
			mat,
		);
		mesh.name = "pitchIgniteBadgeMesh";
		mesh.rotation.x = -Math.PI / 2;
		mesh.castShadow = false;
		mesh.receiveShadow = true;
		mesh.frustumCulled = false;
		mesh.renderOrder = 3;

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
