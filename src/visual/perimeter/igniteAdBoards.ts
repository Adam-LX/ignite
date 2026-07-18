/**
 * Reklamy Ign!te na kolorowym pasie rampy (niebieskim/pomarańczowym).
 * Tylko długie boki — zero reklam przy bramkach / końcach.
 */

import * as THREE from "three";
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

let sharedMat: THREE.MeshStandardMaterial | null = null;
let loadPromise: Promise<THREE.MeshStandardMaterial> | null = null;

function loadAdMaterial(): Promise<THREE.MeshStandardMaterial> {
	if (sharedMat) return Promise.resolve(sharedMat);
	if (loadPromise) return loadPromise;
	loadPromise = new Promise((resolve, reject) => {
		new THREE.TextureLoader().load(
			LOGO_URL,
			(tex) => {
				tex.colorSpace = THREE.SRGBColorSpace;
				tex.anisotropy = 8;
				tex.wrapS = THREE.ClampToEdgeWrapping;
				tex.wrapT = THREE.ClampToEdgeWrapping;
				const mat = new THREE.MeshStandardMaterial({
					name: "igniteAdBoardMat",
					map: tex,
					emissiveMap: tex,
					emissive: new THREE.Color(0xffffff),
					emissiveIntensity: 0.4,
					color: new THREE.Color(0xffffff),
					metalness: 0.45,
					roughness: 0.4,
					transparent: true,
					alphaTest: 0.1,
					side: THREE.DoubleSide,
					depthWrite: false,
					polygonOffset: true,
					polygonOffsetFactor: -2,
					polygonOffsetUnits: -2,
					envMapIntensity: 0.9,
				});
				sharedMat = mat;
				resolve(mat);
			},
			undefined,
			reject,
		);
	});
	return loadPromise;
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
		const t = startT + (endT - startT) * u;
		const x = seg.ax + (seg.bx - seg.ax) * t;
		const z = seg.az + (seg.bz - seg.az) * t;
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

/** Pozycje startu reklam na jednym boku (0..1 wzdłuż segmentu). */
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

export function clearIgniteAdBoards(stadium: THREE.Object3D): void {
	const old = stadium.getObjectByName("igniteAdBoards");
	if (!old) return;
	old.removeFromParent();
	disposeGroup(old);
}

export function mountIgniteAdBoards(stadium: THREE.Group): void {
	clearIgniteAdBoards(stadium);
	const sides = buildPerimeterSegments().filter((s) => s.kind === "side");
	if (sides.length === 0) return;

	const group = new THREE.Group();
	group.name = "igniteAdBoards";
	stadium.add(group);

	void loadAdMaterial()
		.then((mat) => {
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
