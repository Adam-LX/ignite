/**
 * Konwersja assetów gry → bufor poziomów dot-matrix (0 / 1 / 2).
 * Auto: offscreen WebGL turntable. Bitmapy: logo / playlist / loading art.
 */
import * as THREE from "three";

import { assetUrl } from "../util/assetUrl";
import { loadCarThumbnailModel } from "./CarModel";

export type DotLevelBuffer = Uint8Array;

const CAR_RT_W = 112;
const CAR_RT_H = 64;

const IMAGE_SOURCES = [
	assetUrl("/assets/ui/menu/ignite_modern_logo.png"),
	assetUrl("/assets/textures/ignite_pitch_logo.png"),
	assetUrl("/assets/ui/menu/ignite_menu_emblem_concept.png"),
	assetUrl("/assets/ui/menu/playlists/ignition.webp"),
	assetUrl("/assets/ui/menu/playlists/1v1.webp"),
	assetUrl("/assets/ui/menu/playlists/2v2.webp"),
	assetUrl("/assets/ui/menu/playlists/meridian2v2.webp"),
	assetUrl("/assets/ignite_logo.png"),
] as const;

type CaptureState = {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	rt: THREE.WebGLRenderTarget;
	pixelBuf: Uint8Array;
	carRoot: THREE.Group | null;
	carYaw: number;
	images: (HTMLImageElement | ImageBitmap | null)[];
	ready: boolean;
};

let state: CaptureState | null = null;
let initPromise: Promise<void> | null = null;

function luminance(r: number, g: number, b: number): number {
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WebGL readPixels = bottom-up → flip do bufora rows×cols. */
function pixelsToLevels(
	src: Uint8Array,
	srcW: number,
	srcH: number,
	cols: number,
	rows: number,
	out: DotLevelBuffer,
	/** Próg jasności (0–255). */
	hi = 118,
	mid = 52,
): void {
	out.fill(0);
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const sx = Math.min(srcW - 1, Math.floor(((col + 0.5) / cols) * srcW));
			const syTop = Math.min(
				srcH - 1,
				Math.floor(((row + 0.5) / rows) * srcH),
			);
			/** flip Y z readPixels */
			const sy = srcH - 1 - syTop;
			const i = (sy * srcW + sx) * 4;
			const a = src[i + 3]!;
			if (a < 24) continue;
			const L = luminance(src[i]!, src[i + 1]!, src[i + 2]!);
			out[row * cols + col] = L >= hi ? 2 : L >= mid ? 1 : 0;
		}
	}
}

function imageToLevels(
	img: CanvasImageSource,
	cols: number,
	rows: number,
	out: DotLevelBuffer,
	hi = 140,
	mid = 60,
): void {
	if (typeof document === "undefined") {
		out.fill(0);
		return;
	}
	const c = document.createElement("canvas");
	c.width = cols;
	c.height = rows;
	const ctx = c.getContext("2d", { willReadFrequently: true });
	if (!ctx) {
		out.fill(0);
		return;
	}
	ctx.fillStyle = "#000";
	ctx.fillRect(0, 0, cols, rows);
	/** contain */
	const iw =
		"width" in img && typeof img.width === "number" ? img.width : cols;
	const ih =
		"height" in img && typeof img.height === "number" ? img.height : rows;
	const scale = Math.min(cols / Math.max(1, iw), rows / Math.max(1, ih));
	const dw = Math.max(1, Math.floor(iw * scale));
	const dh = Math.max(1, Math.floor(ih * scale));
	const dx = ((cols - dw) / 2) | 0;
	const dy = ((rows - dh) / 2) | 0;
	ctx.imageSmoothingEnabled = true;
	ctx.drawImage(img, dx, dy, dw, dh);
	const data = ctx.getImageData(0, 0, cols, rows).data;
	for (let i = 0; i < cols * rows; i++) {
		const o = i * 4;
		const a = data[o + 3]!;
		if (a < 28) {
			out[i] = 0;
			continue;
		}
		const L = luminance(data[o]!, data[o + 1]!, data[o + 2]!);
		out[i] = L >= hi ? 2 : L >= mid ? 1 : 0;
	}
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
	if (typeof Image === "undefined") return null;
	return new Promise((resolve) => {
		const img = new Image();
		img.decoding = "async";
		img.onload = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = url;
	});
}

function createCapture(): CaptureState {
	const renderer = new THREE.WebGLRenderer({
		antialias: false,
		alpha: true,
		preserveDrawingBuffer: true,
		powerPreference: "low-power",
	});
	renderer.setSize(CAR_RT_W, CAR_RT_H, false);
	renderer.setClearColor(0x000000, 0);
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	const scene = new THREE.Scene();
	const key = new THREE.DirectionalLight(0xffffff, 2.4);
	key.position.set(2.5, 4, 3);
	scene.add(key);
	scene.add(new THREE.AmbientLight(0xffffff, 0.55));
	const fill = new THREE.DirectionalLight(0x88ccff, 0.7);
	fill.position.set(-3, 1, -2);
	scene.add(fill);

	const camera = new THREE.PerspectiveCamera(32, CAR_RT_W / CAR_RT_H, 0.05, 40);
	camera.position.set(0, 0.55, 3.4);
	camera.lookAt(0, 0.25, 0);

	const rt = new THREE.WebGLRenderTarget(CAR_RT_W, CAR_RT_H, {
		type: THREE.UnsignedByteType,
		format: THREE.RGBAFormat,
	});

	return {
		renderer,
		scene,
		camera,
		rt,
		pixelBuf: new Uint8Array(CAR_RT_W * CAR_RT_H * 4),
		carRoot: null,
		carYaw: 0,
		images: [],
		ready: false,
	};
}

async function loadCarIntoScene(s: CaptureState): Promise<void> {
	try {
		const car = await loadCarThumbnailModel();
		car.position.set(0, 0, 0);
		car.rotation.set(0, 0, 0);
		/** Fit w kadrze turntable. */
		const box = new THREE.Box3().setFromObject(car);
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());
		car.position.sub(center);
		const maxDim = Math.max(size.x, size.y, size.z, 0.01);
		car.scale.multiplyScalar(1.85 / maxDim);
		car.position.y += 0.05;
		s.scene.add(car);
		s.carRoot = car;
	} catch (err) {
		console.warn("[Ignite] dot-matrix car capture unavailable", err);
	}
}

/** Start lazy — nie blokuje buildArena. */
export function ensureDotMatrixCapture(): Promise<void> {
	if (typeof document === "undefined") return Promise.resolve();
	if (state?.ready) return Promise.resolve();
	if (initPromise) return initPromise;

	initPromise = (async () => {
		let s: CaptureState;
		try {
			s = createCapture();
		} catch (err) {
			console.warn("[Ignite] dot-matrix WebGL unavailable", err);
			initPromise = null;
			return;
		}
		state = s;
		const imgs = await Promise.all(IMAGE_SOURCES.map((u) => loadImage(u)));
		s.images = imgs;
		await loadCarIntoScene(s);
		s.ready = true;
	})().catch((err) => {
		console.warn("[Ignite] dot-matrix capture init failed", err);
		initPromise = null;
	});

	return initPromise ?? Promise.resolve();
}

export function disposeDotMatrixCapture(): void {
	if (!state) return;
	state.rt.dispose();
	state.renderer.dispose();
	state.carRoot?.removeFromParent();
	state = null;
	initPromise = null;
}

export function isDotMatrixCaptureReady(): boolean {
	return !!state?.ready;
}

export function getDotMatrixImageCount(): number {
	return state?.images.filter(Boolean).length ?? 0;
}

/** Obrót auta + sample do out (cols×rows). */
export function sampleRotatingCar(
	cols: number,
	rows: number,
	dt: number,
	out: DotLevelBuffer,
	spinRadPerSec = 0.85,
): boolean {
	const s = state;
	if (!s?.ready || !s.carRoot) return false;

	s.carYaw += dt * spinRadPerSec;
	s.carRoot.rotation.y = s.carYaw;
	/** Lekki „showroom” tilt. */
	s.carRoot.rotation.x = Math.sin(s.carYaw * 0.5) * 0.08;

	s.renderer.setRenderTarget(s.rt);
	s.renderer.clear();
	s.renderer.render(s.scene, s.camera);
	s.renderer.readRenderTargetPixels(
		s.rt,
		0,
		0,
		CAR_RT_W,
		CAR_RT_H,
		s.pixelBuf,
	);
	s.renderer.setRenderTarget(null);

	pixelsToLevels(s.pixelBuf, CAR_RT_W, CAR_RT_H, cols, rows, out, 100, 40);
	return true;
}

/** Bitmapa z katalogu (logo / playlist). index rotuje modulo. */
export function sampleGameArt(
	cols: number,
	rows: number,
	artIndex: number,
	out: DotLevelBuffer,
): boolean {
	const s = state;
	if (!s?.ready) return false;
	const available = s.images.filter(Boolean) as HTMLImageElement[];
	if (available.length === 0) return false;
	const img = available[((artIndex % available.length) + available.length) % available.length]!;
	imageToLevels(img, cols, rows, out, 150, 55);
	return true;
}
