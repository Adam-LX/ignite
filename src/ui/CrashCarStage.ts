import * as THREE from "three";

import { loadCarThumbnailModel } from "../visual/CarModel";

let mounted = false;
let raf = 0;
let renderer: THREE.WebGLRenderer | null = null;

/** Żywy bruiser z pipeline gry — bez PNG / czarnego kwadratu. */
export async function mountCrashCarStage(): Promise<void> {
	if (mounted || typeof document === "undefined") return;
	const canvas = document.getElementById(
		"error-crash-canvas",
	) as HTMLCanvasElement | null;
	if (!canvas) return;
	mounted = true;

	const fallback = document.querySelector(
		".error-crash__car-fallback",
	) as HTMLElement | null;

	try {
		const w = 720;
		const h = 360;
		renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
			alpha: false,
			powerPreference: "low-power",
		});
		/** Kolor tła ekranu #error — bez „pudełka” canvasu. */
		renderer.setClearColor(0x0c141e, 1);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
		renderer.setSize(w, h, false);
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.15;

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(32, w / h, 0.05, 60);

		scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x1a2230, 0.95));
		const key = new THREE.DirectionalLight(0xffffff, 1.65);
		key.position.set(3.5, 7, 4);
		scene.add(key);
		const fill = new THREE.DirectionalLight(0x99bbff, 0.5);
		fill.position.set(-5, 2.5, -2);
		scene.add(fill);
		const rim = new THREE.DirectionalLight(0xffaa66, 0.7);
		rim.position.set(-2, 3.5, 6);
		scene.add(rim);

		const car = await loadCarThumbnailModel("bruiser");
		scene.add(car);
		car.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(car);
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());
		car.position.sub(center);
		car.position.y += size.y * 0.5;
		car.rotation.y = -Math.PI * 0.3;

		const fit = Math.max(size.x, size.y, size.z);
		camera.position.set(fit * 1.35, fit * 0.48, fit * 2.05);
		camera.lookAt(0, size.y * 0.28, 0);

		if (fallback) fallback.style.display = "none";
		canvas.style.display = "block";

		const t0 = performance.now();
		const tick = (now: number) => {
			if (!renderer) return;
			const t = (now - t0) / 1000;
			car.rotation.y = -Math.PI * 0.3 + Math.sin(t * 0.55) * 0.12;
			renderer.render(scene, camera);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
	} catch (err) {
		console.warn("[Ignite] crash car stage failed", err);
		mounted = false;
		if (fallback) fallback.style.display = "block";
		canvas.style.display = "none";
	}
}

export function disposeCrashCarStage(): void {
	if (raf) cancelAnimationFrame(raf);
	raf = 0;
	renderer?.dispose();
	renderer = null;
	mounted = false;
}
