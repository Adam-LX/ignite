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

/** Proceduralny fallback — hex panele + cyan LED (bez ComfyUI / Meshy). */
function createProceduralPanelTexture(): THREE.Texture {
	if (typeof document === "undefined") {
		const data = new Uint8Array([180, 186, 194, 255]);
		const tex = new THREE.DataTexture(data, 1, 1);
		configurePanel(tex);
		return tex;
	}

	const size = 1024;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d");
	/** jsdom / node test — brak pełnego CanvasRenderingContext2D. */
	if (!ctx || typeof ctx.createLinearGradient !== "function") {
		const data = new Uint8Array([180, 186, 194, 255]);
		const tex = new THREE.DataTexture(data, 1, 1);
		configurePanel(tex);
		return tex;
	}

	const bg = ctx.createLinearGradient(0, 0, size, size);
	bg.addColorStop(0, "#6a7078");
	bg.addColorStop(0.35, "#c4c8d0");
	bg.addColorStop(0.55, "#e8eaee");
	bg.addColorStop(0.75, "#8a9098");
	bg.addColorStop(1, "#505860");
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, size, size);

	const hexR = 28;
	for (let row = 0; row < 22; row++) {
		for (let col = 0; col < 22; col++) {
			const cx = col * hexR * 1.75 + (row % 2) * hexR * 0.875 + 40;
			const cy = row * hexR * 1.52 + 40;
			ctx.strokeStyle = "rgba(12, 16, 22, 0.45)";
			ctx.lineWidth = 2;
			ctx.beginPath();
			for (let k = 0; k < 6; k++) {
				const a = (Math.PI / 3) * k - Math.PI / 6;
				const px = cx + Math.cos(a) * hexR;
				const py = cy + Math.sin(a) * hexR;
				if (k === 0) ctx.moveTo(px, py);
				else ctx.lineTo(px, py);
			}
			ctx.closePath();
			ctx.stroke();
			if ((row + col) % 5 === 0) {
				ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
				ctx.fill();
			}
		}
	}

	ctx.strokeStyle = "rgba(0, 240, 255, 0.9)";
	ctx.lineWidth = 3;
	ctx.shadowColor = "#00f0ff";
	ctx.shadowBlur = 14;
	for (let i = 0; i < 6; i++) {
		const y = 72 + i * 156;
		ctx.beginPath();
		ctx.moveTo(24, y);
		ctx.lineTo(size - 24, y + Math.sin(i) * 12);
		ctx.stroke();
	}
	ctx.shadowBlur = 0;

	ctx.fillStyle = "rgba(0, 200, 255, 0.15)";
	for (let i = 0; i < 80; i++) {
		const x = Math.random() * size;
		const y = Math.random() * size;
		ctx.fillRect(x, y, 2 + Math.random() * 6, 1);
	}

	const tex = new THREE.CanvasTexture(canvas);
	configurePanel(tex);
	return tex;
}

export function getCarPanelTexture(): THREE.Texture {
	if (panelTexture) return panelTexture;
	/** Najpierw procedural — TextureLoader zwraca czarny placeholder aż JPG się załaduje. */
	panelTexture = createProceduralPanelTexture();
	if (panelLoadFailed || typeof document === "undefined") {
		return panelTexture;
	}
	/** Node / vitest mock document — bez createElementNS TextureLoader pada. */
	if (typeof document.createElementNS !== "function") {
		return panelTexture;
	}

	const loader = new THREE.TextureLoader();
	const applyLoaded = (tex: THREE.Texture) => {
		configurePanel(tex);
		const prev = panelTexture;
		panelTexture = tex;
		prev?.dispose();
	};
	loader.load(CAR_PANEL_JPG, applyLoaded, undefined, () => {
		panelLoadFailed = true;
		loader.load(CAR_PANEL_PNG, applyLoaded, undefined, () => {
			panelLoadFailed = true;
		});
	});
	return panelTexture;
}

export function createCarBodyClearcoatMaterial(): THREE.MeshPhysicalMaterial {
	return new THREE.MeshPhysicalMaterial({
		color: 0xd8d4ce,
		/** Niski metal — nocny IBL + metal≈1 = czarny clearcoat. */
		metalness: 0.1,
		roughness: 0.36,
		clearcoat: 0.65,
		clearcoatRoughness: 0.14,
		envMapIntensity: 1.0,
		fog: false,
		toneMapped: true,
		emissive: new THREE.Color(0x181614),
		emissiveIntensity: 0.06,
	});
}

export function createCarCarbonMaterial(): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		/** Nie 0x111111 — na stadionie wygląda jak bug, nie carbon. */
		color: 0x2a2e34,
		metalness: 0.18,
		roughness: 0.55,
		emissive: new THREE.Color(0x101418),
		emissiveIntensity: 0.08,
		fog: false,
	});
}

export function createCarNeonTrimMaterial(): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color: CAR_NEON_CYAN,
		emissive: new THREE.Color(CAR_NEON_CYAN),
		emissiveIntensity: 2.45,
		metalness: 0.15,
		roughness: 0.35,
		toneMapped: false,
	});
}

export function createCarChromeMaterial(
	team: "blue" | "orange",
): THREE.MeshPhysicalMaterial {
	return createIridescentChromeMaterial(team);
}

/** Iridescent clearcoat — efekt „Meshy chrome” bez zewnętrznego asseta. */
export function createIridescentChromeMaterial(
	team: "blue" | "orange",
): THREE.MeshPhysicalMaterial {
	/** Neutral silver body — team tylko lekki emissive (nie solid cyan/orange). */
	const teamGlow = team === "blue" ? 0x4a90b8 : 0xc87848;
	return new THREE.MeshPhysicalMaterial({
		color: 0xc4c8ce,
		map: getCarPanelTexture(),
		metalness: 0.22,
		roughness: 0.4,
		clearcoat: 0.35,
		clearcoatRoughness: 0.28,
		iridescence: 0.08,
		iridescenceIOR: 1.4,
		iridescenceThicknessRange: [100, 420],
		envMapIntensity: 1.0,
		emissive: new THREE.Color(teamGlow),
		emissiveIntensity: 0.07,
		fog: false,
		toneMapped: true,
	});
}

export function createCarAccentMaterial(
	team: "blue" | "orange",
): THREE.MeshStandardMaterial {
	const hex = team === "blue" ? 0x36c8f0 : 0xff8a4a;
	return new THREE.MeshStandardMaterial({
		color: hex,
		metalness: 0.2,
		roughness: 0.4,
		emissive: new THREE.Color(hex),
		emissiveIntensity: 0.18,
		fog: false,
		toneMapped: true,
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
		metalness: 0.35,
		roughness: 0.28,
		emissive: new THREE.Color(CAR_NEON_CYAN).multiplyScalar(0.06),
		fog: false,
		toneMapped: false,
	});
}
