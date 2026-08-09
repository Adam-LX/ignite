/**
 * Stadium floodlight gobo (cookie) — SM/Comfy → SpotLight.map.
 * Cookie MUSI być jasne (białe tło + ciemny wzór) — czarne tło = czarne półkule na murawie.
 */

import * as THREE from "three";

import { assetUrl } from "../util/assetUrl";
import { STADIUM_PYLON_SPECS } from "./stadiumPylons";

const GOBO_URL = assetUrl("/assets/textures/stadium_light_gobo.png");
/** Modulacja hex na murawie — ciaśniejsze snopy, wyższa intensywność bez wash. */
export const PYLON_GOBO_INTENSITY = 1.0;
const CORNER_GOBO_INTENSITY_MUL = 1.2;
/** Cztery narożne jupitery (nie mid-goal pylony). */
const PYLON_GOBO_COUNT = 4;
/** Zimny / ciepły naprzemiennie wg strony boiska (x). */
const GOBO_TINT_COOL = 0xb8d8ff;
const GOBO_TINT_WARM = 0xffd0a8;

let sharedGobo: THREE.Texture | null = null;
let loadPromise: Promise<THREE.Texture | null> | null = null;

/** Proceduralny cookie: jasny środek + hex linie (bezpieczny fallback). */
function makeSoftGoboTexture(): THREE.CanvasTexture {
	const size = 256;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, size, size);
	const cx = size / 2;
	const cy = size / 2;
	ctx.strokeStyle = "rgba(0,0,0,0.22)";
	ctx.lineWidth = 2;
	const R = 22;
	for (let row = -5; row <= 5; row++) {
		for (let col = -5; col <= 5; col++) {
			const ox = cx + col * R * 1.55 + (row % 2) * R * 0.775;
			const oy = cy + row * R * 1.35;
			ctx.beginPath();
			for (let k = 0; k < 6; k++) {
				const ang = Math.PI / 6 + (k * Math.PI) / 3;
				const x = ox + Math.cos(ang) * R * 0.7;
				const y = oy + Math.sin(ang) * R * 0.7;
				if (k === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.closePath();
			ctx.stroke();
		}
	}
	const g = ctx.createRadialGradient(cx, cy, size * 0.15, cx, cy, size * 0.5);
	g.addColorStop(0, "rgba(255,255,255,0)");
	g.addColorStop(1, "rgba(255,255,255,0.15)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.NoColorSpace;
	tex.wrapS = THREE.ClampToEdgeWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.needsUpdate = true;
	return tex;
}

/**
 * Cookie SpotLight: jasne tło + ciemny hex.
 * Czarne narożniki PNG → białe; miękki brim koła (bez czarnych stożków na murawie).
 */
function brightenGoboTexture(src: THREE.Texture): THREE.Texture {
	const img = src.image as
		| HTMLImageElement
		| HTMLCanvasElement
		| ImageBitmap
		| undefined;
	if (!img || typeof document === "undefined") return makeSoftGoboTexture();
	const w =
		"naturalWidth" in img
			? img.naturalWidth
			: "width" in img
				? Number(img.width)
				: 0;
	const h =
		"naturalHeight" in img
			? img.naturalHeight
			: "height" in img
				? Number(img.height)
				: 0;
	if (w < 8 || h < 8) return makeSoftGoboTexture();

	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) return makeSoftGoboTexture();
	ctx.drawImage(img as CanvasImageSource, 0, 0);
	const data = ctx.getImageData(0, 0, w, h);
	const px = data.data;
	const cx = (w - 1) * 0.5;
	const cy = (h - 1) * 0.5;
	const rMax = Math.min(cx, cy);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			const dx = (x - cx) / rMax;
			const dy = (y - cy) / rMax;
			const r = Math.hypot(dx, dy);
			/** Poza kołem cookie = pełne światło (białe). */
			if (r > 1.02) {
				px[i] = 255;
				px[i + 1] = 255;
				px[i + 2] = 255;
				px[i + 3] = 255;
				continue;
			}
			const lum = (px[i]! + px[i + 1]! + px[i + 2]!) / 3;
			/** Ciemny hex → lekko przyciemnij; tło koła → jasne. */
			let v = Math.round(255 - lum * 0.28);
			if (r > 0.88) {
				const edge = (r - 0.88) / 0.14;
				v = Math.round(v + (255 - v) * Math.min(1, edge));
			}
			px[i] = v;
			px[i + 1] = v;
			px[i + 2] = v;
			px[i + 3] = 255;
		}
	}
	ctx.putImageData(data, 0, 0);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.NoColorSpace;
	tex.wrapS = THREE.ClampToEdgeWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = true;
	tex.needsUpdate = true;
	return tex;
}

function loadGoboTexture(): Promise<THREE.Texture | null> {
	if (sharedGobo) return Promise.resolve(sharedGobo);
	if (loadPromise) return loadPromise;
	/** Vitest/node: często jest stub `document` bez createElementNS — TextureLoader pada. */
	const canLoadImage =
		typeof document !== "undefined" &&
		typeof document.createElementNS === "function";
	if (!canLoadImage) {
		return Promise.resolve(null);
	}
	loadPromise = new Promise((resolve) => {
		new THREE.TextureLoader().load(
			`${GOBO_URL}?v=3`,
			(tex) => {
				sharedGobo = brightenGoboTexture(tex);
				tex.dispose();
				resolve(sharedGobo);
			},
			undefined,
			() => {
				sharedGobo = makeSoftGoboTexture();
				resolve(sharedGobo);
			},
		);
	});
	return loadPromise;
}

function attachCookie(spot: THREE.SpotLight, map: THREE.Texture | null): void {
	if (!map) return;
	spot.map = map;
	spot.matrixWorldNeedsUpdate = true;
}

/**
 * 4 SpotLighty z narożnych pylonów — cookie bez shadow map (shadow = czarne stożki).
 * Dają cztery czytelne plamy/odbicia na murawie.
 */
export async function installStadiumLightGobos(
	scene: THREE.Scene,
	cornerSpots: readonly THREE.SpotLight[],
): Promise<THREE.SpotLight[]> {
	const map = await loadGoboTexture();
	const gobos: THREE.SpotLight[] = [];

	const pylonCount = Math.min(PYLON_GOBO_COUNT, STADIUM_PYLON_SPECS.length);
	for (let i = 0; i < pylonCount; i++) {
		const spec = STADIUM_PYLON_SPECS[i]!;
		const top = new THREE.Vector3(spec.x, spec.height + 1.1, spec.z);
		/** Cel bliżej środka połowy — wyraźniejszy specular pool na trawie. */
		const target = new THREE.Vector3(
			spec.target[0] * 0.5,
			0,
			spec.target[2] * 0.5,
		);
		const tint = spec.x < 0 ? GOBO_TINT_COOL : GOBO_TINT_WARM;
		const spot = new THREE.SpotLight(
			tint,
			map ? PYLON_GOBO_INTENSITY : 0,
			155,
			Math.PI / 6.2,
			0.68,
			1.55,
		);
		spot.name = `jupiterGoboSpot${i + 1}`;
		spot.position.copy(top);
		spot.target.position.copy(target);
		/** Nigdy castShadow — SpotLight shadow frustum = czarne półkule na pitchu. */
		spot.castShadow = false;
		spot.userData.goboBaseIntensity = PYLON_GOBO_INTENSITY;
		spot.userData.goboBaseColor = tint;
		attachCookie(spot, map);
		scene.add(spot);
		scene.add(spot.target);
		gobos.push(spot);
	}

	for (const corner of cornerSpots) {
		attachCookie(corner, map);
		if (map) {
			corner.intensity *= CORNER_GOBO_INTENSITY_MUL;
			corner.penumbra = Math.max(corner.penumbra, 0.62);
			corner.decay = Math.max(corner.decay, 1.45);
		}
	}

	return gobos;
}

export function updateStadiumGoboSpots(
	gobos: readonly THREE.SpotLight[],
	timeSec: number,
	mul = 1,
): void {
	const breathe = 0.94 + 0.06 * Math.sin(timeSec * 0.7);
	for (let i = 0; i < gobos.length; i++) {
		const spot = gobos[i]!;
		const base =
			typeof spot.userData.goboBaseIntensity === "number"
				? spot.userData.goboBaseIntensity
				: PYLON_GOBO_INTENSITY;
		const flicker = 1 + 0.03 * Math.sin(timeSec * 1.7 + i * 1.9);
		spot.intensity = base * breathe * flicker * mul;
		/** Nie nadpisuj tintu — atmosphere / flood nie mają tu wracać do bieli. */
		const tint = spot.userData.goboBaseColor;
		if (typeof tint === "number") spot.color.setHex(tint);
	}
}
