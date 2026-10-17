/**
 * Diagnostyka orientacji + integralności mesha Trellis.
 * Orientacja: huby PO ensureMeshyGltfAxes, PRZED snap (prawdziwy dół).
 *   nix develop -c npm run diagnose:car-upright -- muscle truck buggy
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { FileLoader } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
	averageHubRelativeY,
	countMeshVerticesInYBands,
	ensureMeshyGltfAxes,
	scoreUndercarriageDown,
} from "../src/visual/trellisCarOrientation";

const FORCE_FLIP_IDS = new Set(["blade", "phantom"]);
const INVERT_SCORE_IDS = new Set(["bruiserNeo", "truck", "buggy"]);

const ROOT = join(import.meta.dirname, "..");
const publicDir = join(ROOT, "public");
const OUT_DIR = join(ROOT, "public/assets/cars/.work/diag");

(globalThis as unknown as { self: typeof globalThis }).self ??= globalThis;
(globalThis as unknown as { Image: unknown }).Image ??= class {
	width = 1;
	height = 1;
	onload: (() => void) | null = null;
	onerror: ((e: unknown) => void) | null = null;
	set src(_v: string) {
		queueMicrotask(() => this.onload?.());
	}
};

const orig = FileLoader.prototype.load;
FileLoader.prototype.load = function (
	url: string,
	onLoad?: (r: unknown) => void,
	onProgress?: (e: ProgressEvent) => void,
	onError?: (e: unknown) => void,
) {
	let disk: string | null = null;
	if (url.startsWith("/assets/") || url.startsWith("assets/")) {
		disk = join(publicDir, url.replace(/^\//, ""));
	} else if (url.startsWith("/")) {
		disk = join(publicDir, url.slice(1));
	}
	if (disk) {
		try {
			const buf = readFileSync(disk);
			onLoad?.(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
		} catch (e) {
			onError?.(e);
		}
		return this;
	}
	return orig.call(this, url, onLoad, onProgress, onError);
};

const WHEEL_RENAME: Record<string, string> = {
	wheel_fl: "wheel_FL",
	wheel_fr: "wheel_FR",
	wheel_rl: "wheel_RL",
	wheel_rr: "wheel_RR",
	WheelFrontL: "wheel_FL",
	WheelFrontR: "wheel_FR",
	WheelRearL: "wheel_RL",
	WheelRearR: "wheel_RR",
};

function renameWheels(root: THREE.Object3D): void {
	root.traverse((obj) => {
		const next = WHEEL_RENAME[obj.name] ?? WHEEL_RENAME[obj.name.toLowerCase()];
		if (next) obj.name = next;
	});
}

function countTriangles(root: THREE.Object3D): number {
	let n = 0;
	root.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh) || !obj.geometry) return;
		const idx = obj.geometry.index;
		if (idx) n += idx.count / 3;
		else {
			const pos = obj.geometry.attributes.position;
			if (pos) n += pos.count / 3;
		}
	});
	return Math.floor(n);
}

type DiagResult = {
	id: string;
	pass: boolean;
	orientOk: boolean;
	meshOk: boolean;
	hubsRel: number | null;
	underScore: number;
	denseBottom: boolean;
	flat: boolean;
	size: [number, number, number];
	triCount: number;
	rawTriCount: number | null;
	triRatio: number | null;
	pitchDeg: number;
	reasons: string[];
};

async function diagnose(id: string): Promise<DiagResult> {
	const reasons: string[] = [];
	const path = join(publicDir, `assets/cars/${id}.glb`);
	if (!existsSync(path)) {
		return {
			id,
			pass: false,
			orientOk: false,
			meshOk: false,
			hubsRel: null,
			underScore: 0,
			denseBottom: false,
			flat: false,
			size: [0, 0, 0],
			triCount: 0,
			rawTriCount: null,
			triRatio: null,
			pitchDeg: 0,
			reasons: [`brak ${path}`],
		};
	}

	const loader = new GLTFLoader();
	const buf = readFileSync(path);
	const gltf = await loader.parseAsync(
		buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
		"",
	);
	const root = gltf.scene;
	renameWheels(root);
	ensureMeshyGltfAxes(root, id);
	root.updateMatrixWorld(true);

	const sizeV = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
	const size: [number, number, number] = [
		+sizeV.x.toFixed(3),
		+sizeV.y.toFixed(3),
		+sizeV.z.toFixed(3),
	];
	const flat = sizeV.z > sizeV.y * 1.15 && sizeV.z > sizeV.x * 0.85;
	const hubsRel = averageHubRelativeY(root);
	const bands = countMeshVerticesInYBands(root);
	const denseBottom = bands.lower > bands.upper;
	const pitchDeg = Math.round((root.rotation.x * 180) / Math.PI);
	const underScore = scoreUndercarriageDown(root);
	root.rotation.x += Math.PI;
	root.updateMatrixWorld(true);
	const underScoreFlip = scoreUndercarriageDown(root);
	root.rotation.x -= Math.PI;
	root.updateMatrixWorld(true);

	const forceFlip = FORCE_FLIP_IDS.has(id);
	const invertScore = INVERT_SCORE_IDS.has(id);
	const orientOk =
		flat &&
		(forceFlip ||
			(invertScore
				? underScore <= underScoreFlip + 1e-6
				: underScore >= underScoreFlip - 1e-6));
	if (!flat) reasons.push(`nie płaskie AABB size=${size.join(",")}`);
	if (
		!forceFlip &&
		!invertScore &&
		underScore < underScoreFlip - 1e-6
	) {
		reasons.push(
			`podwozie źle (score=${underScore.toFixed(4)} < flip=${underScoreFlip.toFixed(4)})`,
		);
	}
	if (
		!forceFlip &&
		invertScore &&
		underScore > underScoreFlip + 1e-6
	) {
		reasons.push(
			`invert-score: oczekiwano gorszego under (score=${underScore.toFixed(4)} > flip=${underScoreFlip.toFixed(4)})`,
		);
	}

	const triCount = countTriangles(root);
	const rawPath = join(ROOT, "public/assets/cars/.work", `${id}_trellis_raw.glb`);
	let rawTriCount: number | null = null;
	let triRatio: number | null = null;
	if (existsSync(rawPath)) {
		const rawBuf = readFileSync(rawPath);
		const rawGltf = await loader.parseAsync(
			rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength),
			"",
		);
		rawTriCount = countTriangles(rawGltf.scene);
		triRatio = rawTriCount > 0 ? triCount / rawTriCount : null;
	}

	const meshOk =
		triCount >= 8000 && (triRatio == null || triRatio >= 0.55);
	if (triCount < 8000) reasons.push(`za mało tris (${triCount})`);
	if (triRatio != null && triRatio < 0.55) {
		reasons.push(
			`prep zjadł mesh (tris ${triCount}/${rawTriCount} = ${(triRatio * 100).toFixed(0)}%)`,
		);
	}

	return {
		id,
		pass: orientOk && meshOk,
		orientOk,
		meshOk,
		hubsRel: hubsRel != null ? +hubsRel.toFixed(3) : null,
		underScore: +underScore.toFixed(4),
		denseBottom,
		flat,
		size,
		triCount,
		rawTriCount,
		triRatio: triRatio != null ? +triRatio.toFixed(3) : null,
		pitchDeg,
		reasons,
	};
}

const ids =
	process.argv.slice(2).length > 0
		? process.argv.slice(2)
		: [
				"muscle",
				"sleek",
				"hatch",
				"truck",
				"blade",
				"buggy",
				"phantom",
				"bruiser",
				"bruiserNeo",
			];

mkdirSync(OUT_DIR, { recursive: true });
const results: DiagResult[] = [];
let failed = 0;

for (const id of ids) {
	const r = await diagnose(id);
	results.push(r);
	const mark = r.pass ? "PASS" : "FAIL";
	if (!r.pass) failed += 1;
	console.log(
		`${mark} ${id} orient=${r.orientOk ? "OK" : "BAD"} mesh=${r.meshOk ? "OK" : "BAD"} under=${r.underScore} hubsRel=${r.hubsRel} flat=${r.flat} pitch=${r.pitchDeg} size=${r.size.join(",")} tris=${r.triCount}${r.triRatio != null ? ` (${(r.triRatio * 100).toFixed(0)}% raw)` : ""}`,
	);
	if (r.reasons.length) console.log(`  → ${r.reasons.join("; ")}`);
}

writeFileSync(
	join(OUT_DIR, "last.json"),
	`${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`,
);

if (failed > 0) {
	console.error(`\ndiagnose-car-upright: ${failed}/${results.length} FAIL`);
	process.exit(1);
}
console.info(`\ndiagnose-car-upright: ${results.length}/${results.length} PASS`);
