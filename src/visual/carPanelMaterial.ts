import * as THREE from "three";

import { assetUrl } from "../util/assetUrl";

/** Neon trimów auta (0x00f0ff); piłka używa ~0x00e0ff w materials.ts. */
export const CAR_NEON_CYAN = 0x00f0ff;
export const CAR_NEON_BALL = 0x00e0ff;

const CAR_PANEL_JPG = assetUrl("/assets/textures/car_cyber_panel.jpg");
const CAR_PANEL_PNG = assetUrl("/assets/textures/car_cyber_panel.png");

let panelTexture: THREE.Texture | null = null;
let panelLoadFailed = false;

function configurePanel(tex: THREE.Texture): void {
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	tex.repeat.set(2.5, 2.5);
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.anisotropy = 8;
	tex.needsUpdate = true;
}

/** Proceduralny fallback — srebrne panele + cyan LED (do czasu ComfyUI). */
function createProceduralPanelTexture(): THREE.Texture {
	if (typeof document === "undefined") {
		const data = new Uint8Array([180, 186, 194, 255]);
		const tex = new THREE.DataTexture(data, 1, 1);
		configurePanel(tex);
		return tex;
	}

	const size = 512;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d")!;

	const bg = ctx.createLinearGradient(0, 0, size, size);
	bg.addColorStop(0, "#949aa4");
	bg.addColorStop(0.5, "#b8bcc4");
	bg.addColorStop(1, "#7a8088");
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, size, size);

	ctx.strokeStyle = "rgba(28, 32, 38, 0.55)";
	ctx.lineWidth = 2;
	const step = 64;
	for (let x = 0; x <= size; x += step) {
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, size);
		ctx.stroke();
	}
	for (let y = 0; y <= size; y += step) {
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(size, y);
		ctx.stroke();
	}

	ctx.strokeStyle = "rgba(0, 224, 255, 0.85)";
	ctx.lineWidth = 3;
	ctx.shadowColor = "#00e0ff";
	ctx.shadowBlur = 8;
	for (let i = 0; i < 4; i++) {
		const y = 48 + i * 112;
		ctx.beginPath();
		ctx.moveTo(16, y);
		ctx.lineTo(size - 16, y);
		ctx.stroke();
	}

	const tex = new THREE.CanvasTexture(canvas);
	configurePanel(tex);
	return tex;
}

export function getCarPanelTexture(): THREE.Texture {
	if (panelTexture) return panelTexture;
	if (panelLoadFailed || typeof document === "undefined") {
		panelTexture = createProceduralPanelTexture();
		return panelTexture;
	}

	const loader = new THREE.TextureLoader();
	panelTexture = loader.load(CAR_PANEL_JPG, configurePanel, undefined, () => {
		panelLoadFailed = true;
		panelTexture?.dispose();
		panelTexture = loader.load(CAR_PANEL_PNG, configurePanel, undefined, () => {
			panelTexture = createProceduralPanelTexture();
		});
	});
	configurePanel(panelTexture);
	return panelTexture;
}

export function createCarBodyClearcoatMaterial(): THREE.MeshPhysicalMaterial {
	return new THREE.MeshPhysicalMaterial({
		color: 0xdcdcdc,
		metalness: 0.95,
		roughness: 0.12,
		clearcoat: 1.0,
		clearcoatRoughness: 0.05,
		envMapIntensity: 1.65,
	});
}

export function createCarCarbonMaterial(): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color: 0x111111,
		metalness: 0.35,
		roughness: 0.5,
	});
}

export function createCarNeonTrimMaterial(): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color: CAR_NEON_CYAN,
		emissive: new THREE.Color(CAR_NEON_CYAN),
		emissiveIntensity: 2.0,
		metalness: 0.15,
		roughness: 0.35,
		toneMapped: false,
	});
}

export function createCarChromeMaterial(
	_team: "blue" | "orange",
): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color: 0xc8ccd4,
		map: getCarPanelTexture(),
		metalness: 0.92,
		roughness: 0.1,
		emissive: new THREE.Color(CAR_NEON_CYAN),
		emissiveIntensity: 0.04,
		envMapIntensity: 1.35,
	});
}

export function createCarAccentMaterial(
	team: "blue" | "orange",
): THREE.MeshStandardMaterial {
	const hex = team === "blue" ? 0x1ec8ee : 0xff5522;
	return new THREE.MeshStandardMaterial({
		color: hex,
		metalness: 0.75,
		roughness: 0.14,
		emissive: new THREE.Color(hex),
		emissiveIntensity: 0.35,
	});
}

export function createCarNeonStripMaterial(): THREE.MeshStandardMaterial {
	return createCarNeonTrimMaterial();
}

export function createCarGlassMaterial(): THREE.MeshPhysicalMaterial {
	return new THREE.MeshPhysicalMaterial({
		color: 0x040810,
		metalness: 0.15,
		roughness: 0.04,
		transparent: true,
		opacity: 0.82,
		clearcoat: 1,
	});
}

export function createCarRubberMaterial(): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color: 0x080808,
		roughness: 0.92,
		metalness: 0.02,
	});
}

export function createCarRimMaterial(): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color: 0xd0d4dc,
		metalness: 0.96,
		roughness: 0.08,
		emissive: new THREE.Color(CAR_NEON_CYAN).multiplyScalar(0.06),
	});
}
