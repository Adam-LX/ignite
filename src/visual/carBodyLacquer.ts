import * as THREE from "three";

/**
 * Lakier jak w miniaturze garażu: oryginalne albedo modelu (podbite),
 * bez płaskiego tinta blue/orange.
 */
/** Neutralny fallback gdy brak mapy — nie cool-cyan (wyglądało jak solid blue). */
export const SHOWCASE_BODY_HEX = 0xd8d4ce;
export const MIN_BODY_PAINT_LUMA = 0.28;
/** Neonowy blob vs. czarna sylwetka — pasmo emissive. */
export const BODY_EMISSIVE_MIN = 0.04;
export const BODY_EMISSIVE_MAX = 0.28;
/** Mecz — clearcoat + IBL; niski emissive (cyan skybox + wysoki emi = solid blue). */
export const BODY_EMISSIVE_MATCH = 0.08;
export const BODY_EMISSIVE_SHOWCASE = 0.06;
/** Trellis albedo ~luma 30–50/255 — po lift średnia ~0.78 (czytelne w nocy). */
export const ALBEDO_TARGET_MEAN_LUMA = 0.78;

/** Zostawione dla paint / akcentów drużyny (nie body GLB). */
export const TEAM_BODY_PAINT = {
	blue: 0x36c8f0,
	orange: 0xff8a4a,
} as const;

export function colorLuma(hex: number): number {
	const c = new THREE.Color(hex);
	return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

export function floorColorLuma(hex: number, minLuma = MIN_BODY_PAINT_LUMA): number {
	const c = new THREE.Color(hex);
	if (colorLuma(hex) >= minLuma) return hex;
	/** Podbij jasność w HSL — zachowaj hue (RGB-scale + gray fallback zabijał crimson → solid team). */
	const hsl = { h: 0, s: 0, l: 0 };
	c.getHSL(hsl);
	if (hsl.s < 0.04) {
		let l = Math.max(minLuma + 0.02, hsl.l);
		for (let i = 0; i < 6; i++) {
			c.setHSL(0, 0, l);
			if (colorLuma(c.getHex()) >= minLuma) return c.getHex();
			l = Math.min(0.85, l + 0.04);
		}
		c.setRGB(minLuma, minLuma, minLuma);
		return c.getHex();
	}
	let l = Math.max(minLuma + 0.02, hsl.l + 0.06);
	const s = Math.min(1, hsl.s * 1.05);
	for (let i = 0; i < 8; i++) {
		c.setHSL(hsl.h, s, Math.min(0.78, l));
		if (colorLuma(c.getHex()) >= minLuma) return c.getHex();
		l += 0.04;
	}
	c.setHSL(hsl.h, s, 0.55);
	return c.getHex();
}

/**
 * Podbij ciemne Trellis albedo do czytelnej średniej luminancji.
 * Bez tego color×map na nocnym IBL = czarna sylwetka.
 */
export function liftAlbedoTexture(
	src: THREE.Texture | null | undefined,
	targetMeanLuma = ALBEDO_TARGET_MEAN_LUMA,
): THREE.Texture | null {
	if (!src?.image || typeof document === "undefined") return null;
	if (typeof document.createElementNS !== "function") return null;
	const img = src.image as {
		width?: number;
		height?: number;
		videoWidth?: number;
		videoHeight?: number;
	};
	const w = img.width || img.videoWidth || 0;
	const h = img.height || img.videoHeight || 0;
	if (w < 2 || h < 2) return null;

	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (
		!ctx ||
		typeof ctx.drawImage !== "function" ||
		typeof ctx.getImageData !== "function"
	) {
		return null;
	}
	try {
		ctx.drawImage(img as CanvasImageSource, 0, 0);
	} catch {
		return null;
	}
	const data = ctx.getImageData(0, 0, w, h);
	const px = data.data;
	let sum = 0;
	let n = 0;
	for (let i = 0; i < px.length; i += 4) {
		if ((px[i + 3] ?? 0) < 8) continue;
		sum +=
			0.2126 * (px[i] ?? 0) +
			0.7152 * (px[i + 1] ?? 0) +
			0.0722 * (px[i + 2] ?? 0);
		n += 1;
	}
	const mean = n > 0 ? sum / n : 0;
	const target = targetMeanLuma * 255;
	const gain = mean > 1 ? Math.min(10, Math.max(1.15, target / mean)) : 4;
	let sumR = 0;
	let sumG = 0;
	let sumB = 0;
	if (gain > 1.05) {
		for (let i = 0; i < px.length; i += 4) {
			px[i] = Math.min(255, Math.round((px[i] ?? 0) * gain));
			px[i + 1] = Math.min(255, Math.round((px[i + 1] ?? 0) * gain));
			px[i + 2] = Math.min(255, Math.round((px[i + 2] ?? 0) * gain));
		}
		ctx.putImageData(data, 0, 0);
	}
	n = 0;
	for (let i = 0; i < px.length; i += 4) {
		if ((px[i + 3] ?? 0) < 8) continue;
		sumR += px[i] ?? 0;
		sumG += px[i + 1] ?? 0;
		sumB += px[i + 2] ?? 0;
		n += 1;
	}
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.flipY = src.flipY;
	tex.wrapS = src.wrapS;
	tex.wrapT = src.wrapT;
	tex.minFilter = src.minFilter;
	tex.magFilter = src.magFilter;
	tex.needsUpdate = true;
	tex.userData.lacquerLifted = true;
	if (n > 0) {
		tex.userData.avgColor = new THREE.Color(
			sumR / n / 255,
			sumG / n / 255,
			sumB / n / 255,
		);
	}
	return tex;
}

export type BodyLacquerOpts = {
	showcase?: boolean;
	emissiveIntensity?: number;
	albedoMap?: THREE.Texture | null;
	normalMap?: THREE.Texture | null;
	normalScale?: THREE.Vector2;
};

/**
 * Naturalny lakier GLB — clearcoat + lifted albedo (RL DNA).
 * Bez tinta drużyny (blue/orange).
 */
export function createNaturalBodyLacquerMaterial(
	opts: BodyLacquerOpts = {},
): THREE.MeshPhysicalMaterial {
	const showcase = opts.showcase === true;
	const emI =
		opts.emissiveIntensity ??
		(showcase ? BODY_EMISSIVE_SHOWCASE : BODY_EMISSIVE_MATCH);
	const lifted = liftAlbedoTexture(opts.albedoMap);
	/** Lekki warm fill — nie cool 0x2a3340 (pod cyan skyboxem = solid blue). */
	const avg =
		lifted?.userData?.avgColor instanceof THREE.Color
			? (lifted.userData.avgColor as THREE.Color).clone()
			: new THREE.Color(0x1a1816);
	const mat = new THREE.MeshPhysicalMaterial({
		/** Biały tint → widać oryginalne kolory mapy (jak w garażu). */
		color: lifted ? 0xffffff : SHOWCASE_BODY_HEX,
		metalness: showcase ? 0.12 : 0.12,
		roughness: showcase ? 0.34 : 0.32,
		clearcoat: showcase ? 0.62 : 0.78,
		clearcoatRoughness: showcase ? 0.14 : 0.1,
		/** Mecz: nie 2.15 — cyberpunk skybox bierze cały lakier w cyan. */
		envMapIntensity: showcase ? 1.2 : 1.05,
		/** Emissive z hue modelu — nie team cyan/orange. */
		emissive: avg,
		emissiveIntensity: emI,
		side: THREE.DoubleSide,
		transparent: false,
		opacity: 1,
		depthWrite: true,
		fog: false,
		/** Tone map jak reszta sceny — inaczej IBL/emissive wypala solid hue. */
		toneMapped: true,
	});
	mat.map = lifted;
	mat.metalnessMap = null;
	mat.roughnessMap = null;
	mat.emissiveMap = null;
	mat.aoMap = null;
	if (opts.normalMap) {
		mat.normalMap = opts.normalMap;
		if (opts.normalScale) mat.normalScale.copy(opts.normalScale);
	}
	mat.userData.naturalAlbedo = true;
	if (lifted) mat.userData.lacquerLifted = true;
	mat.needsUpdate = true;
	return mat;
}

/** @deprecated Użyj createNaturalBodyLacquerMaterial — team hex nie maluje body. */
export function createBodyLacquerMaterial(
	_paintHex: number,
	opts: BodyLacquerOpts = {},
): THREE.MeshPhysicalMaterial {
	return createNaturalBodyLacquerMaterial(opts);
}

/**
 * Kosmetyk paint na naturalnym body: **tint**, nie solid blob.
 * Zostawia albedo GLB; hue paint miesza się lekko w `color`.
 */
export function tintNaturalBodyLacquer(
	mat: THREE.MeshStandardMaterial,
	paintHex: number,
	strength = 0.32,
): void {
	const hex = floorColorLuma(paintHex);
	const paint = new THREE.Color(hex);
	mat.color.setHex(0xffffff).lerp(paint, THREE.MathUtils.clamp(strength, 0, 0.55));
	mat.emissive.copy(paint).multiplyScalar(0.2);
	mat.emissiveIntensity = Math.min(
		BODY_EMISSIVE_MATCH,
		Math.max(BODY_EMISSIVE_MIN, mat.emissiveIntensity || BODY_EMISSIVE_MATCH),
	);
	mat.metalness = Math.min(mat.metalness, 0.14);
	mat.roughness = THREE.MathUtils.clamp(mat.roughness || 0.32, 0.26, 0.4);
	mat.envMapIntensity = Math.min(mat.envMapIntensity || 1, 1.12);
	mat.fog = false;
	mat.toneMapped = true;
	mat.userData.naturalAlbedo = true;
	if (mat instanceof THREE.MeshPhysicalMaterial) {
		mat.iridescence = 0;
		mat.transmission = 0;
		mat.clearcoat = Math.min(Math.max(mat.clearcoat || 0.55, 0.55), 0.82);
		mat.clearcoatRoughness = Math.max(mat.clearcoatRoughness || 0.1, 0.08);
	}
	mat.needsUpdate = true;
}

/** Kosmetyk paint — solid tylko gdy brak naturalnego albedo (procedural / chrome). */
export function applyBodyLacquerToMaterial(
	mat: THREE.MeshStandardMaterial,
	paintHex: number,
	emissiveIntensity = BODY_EMISSIVE_MATCH,
): void {
	if (mat.userData.naturalAlbedo === true && mat.map) {
		tintNaturalBodyLacquer(mat, paintHex);
		return;
	}
	const hex = floorColorLuma(paintHex);
	mat.map = null;
	mat.metalnessMap = null;
	mat.roughnessMap = null;
	mat.emissiveMap = null;
	mat.aoMap = null;
	mat.color.setHex(hex);
	mat.emissive.setHex(hex).multiplyScalar(0.35);
	mat.emissiveIntensity = Math.min(emissiveIntensity, 0.14);
	mat.metalness = Math.min(mat.metalness, 0.14);
	mat.roughness = THREE.MathUtils.clamp(mat.roughness || 0.32, 0.26, 0.4);
	mat.envMapIntensity = Math.min(Math.max(mat.envMapIntensity || 1, 0.9), 1.15);
	mat.fog = false;
	mat.toneMapped = true;
	delete mat.userData.lacquerLifted;
	delete mat.userData.naturalAlbedo;
	if (mat instanceof THREE.MeshPhysicalMaterial) {
		mat.iridescence = 0;
		mat.transmission = 0;
		mat.clearcoat = 0.7;
		mat.clearcoatRoughness = 0.12;
	}
	mat.needsUpdate = true;
}

/** Glass / cabin — ciemny tint, nie mleczny blob Trellis. */
export function enhanceMeshyGlassNightSafe(
	src: THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
	const mat = src.clone();
	mat.map = null;
	mat.metalnessMap = null;
	mat.roughnessMap = null;
	mat.emissiveMap = null;
	mat.aoMap = null;
	mat.color.setHex(0x121820);
	mat.metalness = 0.85;
	mat.roughness = 0.12;
	mat.envMapIntensity = 1.35;
	mat.emissive.setHex(0x05080c);
	mat.emissiveIntensity = 0.06;
	mat.opacity = 0.92;
	mat.transparent = true;
	mat.depthWrite = true;
	mat.fog = false;
	mat.toneMapped = true;
	mat.side = THREE.FrontSide;
	if (mat instanceof THREE.MeshPhysicalMaterial) {
		mat.clearcoat = 1;
		mat.clearcoatRoughness = 0.05;
		mat.transmission = 0.15;
		mat.thickness = 0.35;
		mat.ior = 1.45;
		mat.iridescence = 0;
	}
	mat.userData.glass = true;
	mat.needsUpdate = true;
	return mat;
}

export function looksLikeGlassMesh(name: string, mat?: THREE.Material): boolean {
	const n = name.toLowerCase();
	if (
		n.includes("glass") ||
		n.includes("window") ||
		n.includes("windshield") ||
		n.includes("windscreen") ||
		n.includes("cabin") ||
		n.includes("canopy")
	) {
		return true;
	}
	if (mat instanceof THREE.MeshStandardMaterial) {
		const luma =
			0.2126 * mat.color.r + 0.7152 * mat.color.g + 0.0722 * mat.color.b;
		if (mat.transparent && mat.opacity < 0.95) return true;
		if (luma > 0.72 && mat.metalness < 0.25 && mat.roughness < 0.45) return true;
	}
	return false;
}

/** Trim / detale — zachowaj albedo, night-safe PBR (jak toneThumbnailMaterials). */
export function enhanceMeshyTrimNightSafe(
	src: THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
	const mat = src.clone();
	const lifted = liftAlbedoTexture(mat.map);
	if (lifted) {
		mat.map = lifted;
		mat.color.setHex(0xffffff);
		mat.userData.lacquerLifted = true;
	} else if (mat.map) {
		mat.color.multiplyScalar(1.75);
	} else {
		mat.color.multiplyScalar(1.35);
	}
	mat.metalnessMap = null;
	mat.roughnessMap = null;
	mat.emissiveMap = null;
	mat.aoMap = null;
	mat.metalness = Math.min(mat.metalness, 0.22);
	mat.roughness = Math.max(mat.roughness, 0.38);
	mat.envMapIntensity = THREE.MathUtils.clamp(
		mat.envMapIntensity || 1,
		0.9,
		1.25,
	);
	mat.emissiveIntensity = Math.min(mat.emissiveIntensity || 0, 0.08);
	mat.fog = false;
	mat.toneMapped = true;
	mat.side = THREE.DoubleSide;
	if (mat instanceof THREE.MeshPhysicalMaterial) {
		mat.iridescence = 0;
		mat.clearcoat = Math.min(mat.clearcoat || 0, 0.3);
		mat.transmission = 0;
	}
	mat.userData.naturalAlbedo = true;
	mat.needsUpdate = true;
	return mat;
}

/** Natural body: biały tint + lifted map (albo jasny fallback). */
export function isNaturalBodyLacquer(mat: THREE.MeshStandardMaterial): boolean {
	if (mat.userData.naturalAlbedo !== true) return false;
	if (mat.metalness > 0.2 || mat.fog !== false) {
		return false;
	}
	if (mat.emissiveIntensity < BODY_EMISSIVE_MIN || mat.emissiveIntensity > BODY_EMISSIVE_MAX) {
		return false;
	}
	if (mat.map) {
		return mat.userData.lacquerLifted === true && colorLuma(mat.color.getHex()) >= 0.55;
	}
	return colorLuma(mat.color.getHex()) >= MIN_BODY_PAINT_LUMA;
}

/** Paint solid albo natural — nie czarna sylwetka / nie solid cyan. */
export function isReadableBodyLacquer(mat: THREE.MeshStandardMaterial): boolean {
	if (mat.userData.naturalAlbedo === true) return isNaturalBodyLacquer(mat);
	const luma = colorLuma(mat.color.getHex());
	const mapOk = mat.map == null || mat.userData.lacquerLifted === true;
	return (
		mapOk &&
		mat.metalness <= 0.2 &&
		mat.fog === false &&
		luma >= MIN_BODY_PAINT_LUMA &&
		mat.emissiveIntensity >= BODY_EMISSIVE_MIN &&
		mat.emissiveIntensity <= BODY_EMISSIVE_MAX
	);
}
