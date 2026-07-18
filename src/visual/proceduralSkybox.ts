import * as THREE from "three";

const WIDTH = 1024;
const HEIGHT = 512;

/** Fallback gdy brak cyberpunk_skybox.png — stonowany gradient synthwave. */
export function createProceduralCyberSkyboxTexture(): THREE.Texture {
	if (typeof document === "undefined") {
		const data = new Uint8Array([26, 12, 40, 255]);
		const tex = new THREE.DataTexture(data, 1, 1);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.needsUpdate = true;
		return tex;
	}

	const canvas = document.createElement("canvas");
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	const ctx = canvas.getContext("2d")!;

	const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
	grad.addColorStop(0, "#0a0618");
	grad.addColorStop(0.35, "#1a0840");
	grad.addColorStop(0.55, "#3a1888");
	grad.addColorStop(0.72, "#5522aa");
	grad.addColorStop(1, "#281040");
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, WIDTH, HEIGHT);

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.mapping = THREE.EquirectangularReflectionMapping;
	tex.needsUpdate = true;
	return tex;
}
