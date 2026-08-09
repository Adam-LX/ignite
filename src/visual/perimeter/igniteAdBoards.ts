/**
 * Reklamy Ign!te na kolorowym pasie rampy (niebieskim/pomarańczowym).
 * Tylko długie boki — zero reklam przy bramkach / końcach.
 * Mix: logo + canvas Field Energy / mutator / circuit (bez nowych meshów).
 */

import * as THREE from "three";
import { t, type I18nKey } from "../../i18n";
import { getWeeklyMutator } from "../../modes/MutatorRegistry";
import { assetUrl } from "../../util/assetUrl";
import {
	RAMP_BASE_Y,
	rampCurveHeight,
	rampCurveRun,
	rampSurfaceNormal,
} from "./constants";
import { buildPerimeterSegments } from "./segments";
import type { PerimeterSegment } from "./types";

const LOGO_URL = assetUrl("/assets/textures/ignite_pitch_logo.png");
const AD_WIDTH_M = 9.5;
/** Odstęp między reklamami na jednym boku. */
const AD_GAP_M = 32;
const BAND_T0 = 0.38;
const BAND_T1 = 0.78;
const LIFT = 0.05;
const CURVE_STEPS = 10;

const CIRCUIT_NAMES = [
	"MERIDIAN CIRCUIT",
	"NIGHT GRID",
	"IGNITE ARENA",
	"PULSE LANE",
] as const;

type AdVariant = "logo" | "fieldEnergy" | "mutator" | "circuit";

let logoMat: THREE.MeshStandardMaterial | null = null;
let logoLoadPromise: Promise<THREE.MeshStandardMaterial> | null = null;
const canvasMats: THREE.MeshStandardMaterial[] = [];

function makeBoardMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		name: "igniteAdBoardMat",
		map,
		emissiveMap: map,
		emissive: new THREE.Color(0xffffff),
		emissiveIntensity: 0.42,
		color: new THREE.Color(0xffffff),
		metalness: 0.45,
		roughness: 0.45,
		transparent: true,
		alphaTest: 0.1,
		side: THREE.DoubleSide,
		depthWrite: false,
		polygonOffset: true,
		polygonOffsetFactor: -2,
		polygonOffsetUnits: -2,
		envMapIntensity: 0.55,
	});
}

function loadLogoMaterial(): Promise<THREE.MeshStandardMaterial> {
	if (logoMat) return Promise.resolve(logoMat);
	if (logoLoadPromise) return logoLoadPromise;
	if (typeof document === "undefined") {
		logoMat = new THREE.MeshStandardMaterial({
			name: "igniteAdBoardMatHeadless",
			color: new THREE.Color(0x8899aa),
			metalness: 0.4,
			roughness: 0.5,
		});
		return Promise.resolve(logoMat);
	}
	logoLoadPromise = new Promise((resolve, reject) => {
		new THREE.TextureLoader().load(
			LOGO_URL,
			(tex) => {
				tex.colorSpace = THREE.SRGBColorSpace;
				tex.anisotropy = 8;
				tex.wrapS = THREE.ClampToEdgeWrapping;
				tex.wrapT = THREE.ClampToEdgeWrapping;
				logoMat = makeBoardMaterial(tex);
				resolve(logoMat);
			},
			undefined,
			reject,
		);
	});
	return logoLoadPromise;
}

function createCanvasAdTexture(
	lines: string[],
	accent: string,
): THREE.CanvasTexture | null {
	if (typeof document === "undefined") return null;
	const w = 1024;
	const h = 256;
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;

	const grad = ctx.createLinearGradient(0, 0, w, h);
	grad.addColorStop(0, "#061018");
	grad.addColorStop(0.45, "#0a2436");
	grad.addColorStop(1, "#12080a");
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, w, h);

	ctx.strokeStyle = accent;
	ctx.lineWidth = 10;
	ctx.strokeRect(18, 18, w - 36, h - 36);

	ctx.fillStyle = accent;
	ctx.globalAlpha = 0.18;
	ctx.fillRect(0, h * 0.72, w, h * 0.28);
	ctx.globalAlpha = 1;

	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = "#f4fbff";
	const primary = lines[0] ?? "IGNITE";
	const secondary = lines[1];
	ctx.font = `700 ${secondary ? 64 : 78}px Orbitron, sans-serif`;
	ctx.fillText(primary.slice(0, 28), w / 2, secondary ? h * 0.4 : h * 0.5);
	if (secondary) {
		ctx.font = "600 42px Orbitron, sans-serif";
		ctx.fillStyle = accent;
		ctx.fillText(secondary.slice(0, 36), w / 2, h * 0.68);
	}

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 8;
	tex.needsUpdate = true;
	return tex;
}

function canvasMaterial(
	lines: string[],
	accentHex: number,
): THREE.MeshStandardMaterial | null {
	const tex = createCanvasAdTexture(
		lines,
		`#${accentHex.toString(16).padStart(6, "0")}`,
	);
	if (!tex) return null;
	const mat = makeBoardMaterial(tex);
	canvasMats.push(mat);
	return mat;
}

function pointOnRamp(
	x: number,
	z: number,
	outX: number,
	outZ: number,
	t: number,
): THREE.Vector3 {
	const run = rampCurveRun(t);
	const y = RAMP_BASE_Y + rampCurveHeight(t);
	const n = rampSurfaceNormal(t, outX, outZ);
	return new THREE.Vector3(
		x + outX * run + n.x * LIFT,
		y + n.y * LIFT,
		z + outZ * run + n.z * LIFT,
	);
}

function buildAdOnSegment(
	seg: PerimeterSegment,
	startT: number,
	widthAlong: number,
): THREE.BufferGeometry | null {
	if (widthAlong < 1 || seg.length < widthAlong + 0.5) return null;
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	const endT = Math.min(1, startT + widthAlong / seg.length);
	if (endT - startT < 0.02) return null;

	for (let i = 0; i <= CURVE_STEPS; i++) {
		const u = i / CURVE_STEPS;
		const tSeg = startT + (endT - startT) * u;
		const x = seg.ax + (seg.bx - seg.ax) * tSeg;
		const z = seg.az + (seg.bz - seg.az) * tSeg;
		const p0 = pointOnRamp(x, z, seg.outX, seg.outZ, BAND_T0);
		const p1 = pointOnRamp(x, z, seg.outX, seg.outZ, BAND_T1);
		positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
		uvs.push(u, 0, u, 1);
	}

	for (let i = 0; i < CURVE_STEPS; i++) {
		const a = i * 2;
		const b = a + 1;
		const c = a + 3;
		const d = a + 2;
		indices.push(a, d, c, a, c, b);
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
	geo.setIndex(indices);
	geo.computeVertexNormals();
	return geo;
}

function adStartsOnSide(segLen: number): number[] {
	if (segLen < AD_WIDTH_M + 4) return [];
	const stride = AD_WIDTH_M + AD_GAP_M;
	const starts: number[] = [];
	if (segLen < stride + AD_WIDTH_M) {
		starts.push((segLen - AD_WIDTH_M) * 0.5);
		return starts;
	}
	let d = AD_GAP_M * 0.5;
	while (d + AD_WIDTH_M <= segLen - 2) {
		starts.push(d);
		d += stride;
	}
	return starts;
}

function disposeGroup(group: THREE.Object3D): void {
	group.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return;
		obj.geometry.dispose();
	});
}

function disposeCanvasMats(): void {
	for (const mat of canvasMats) {
		mat.map?.dispose();
		mat.emissiveMap?.dispose();
		mat.dispose();
	}
	canvasMats.length = 0;
}

function variantForIndex(idx: number): AdVariant {
	const cycle: AdVariant[] = ["logo", "fieldEnergy", "mutator", "circuit"];
	return cycle[idx % cycle.length]!;
}

function materialForVariant(
	variant: AdVariant,
	logo: THREE.MeshStandardMaterial,
	idx: number,
): THREE.MeshStandardMaterial {
	if (variant === "logo") return logo;
	if (variant === "fieldEnergy") {
		return (
			canvasMaterial(["FIELD ENERGY", "RUSH · OVERCHARGE · ZONES"], 0x3dffe8) ??
			logo
		);
	}
	if (variant === "mutator") {
		const mut = getWeeklyMutator();
		let name = mut.id;
		try {
			name = t(mut.nameKey as I18nKey);
		} catch {
			/* key missing */
		}
		return (
			canvasMaterial(["WEEKLY LAB", name.toUpperCase()], 0xffb347) ?? logo
		);
	}
	const circuit = CIRCUIT_NAMES[idx % CIRCUIT_NAMES.length]!;
	return canvasMaterial([circuit, "IGNITE CIRCUIT"], 0x7ab8ff) ?? logo;
}

export function clearIgniteAdBoards(stadium: THREE.Object3D): void {
	const old = stadium.getObjectByName("igniteAdBoards");
	if (!old) return;
	old.removeFromParent();
	disposeGroup(old);
	disposeCanvasMats();
}

export function mountIgniteAdBoards(stadium: THREE.Group): void {
	clearIgniteAdBoards(stadium);
	const sides = buildPerimeterSegments().filter((s) => s.kind === "side");
	if (sides.length === 0) return;

	const group = new THREE.Group();
	group.name = "igniteAdBoards";
	stadium.add(group);

	void loadLogoMaterial()
		.then((logo) => {
			if (group.parent !== stadium) return;
			let idx = 0;
			for (const seg of sides) {
				for (const startM of adStartsOnSide(seg.length)) {
					const geo = buildAdOnSegment(
						seg,
						startM / seg.length,
						AD_WIDTH_M,
					);
					if (!geo) continue;
					const variant = variantForIndex(idx);
					const mat = materialForVariant(variant, logo, idx);
					const mesh = new THREE.Mesh(geo, mat);
					mesh.name = `igniteAdBoard_${idx++}`;
					mesh.castShadow = false;
					mesh.receiveShadow = false;
					mesh.frustumCulled = true;
					mesh.renderOrder = 5;
					group.add(mesh);
				}
			}
		})
		.catch((err) => {
			console.warn("[igniteAdBoards] load failed", err);
			group.removeFromParent();
		});
}
