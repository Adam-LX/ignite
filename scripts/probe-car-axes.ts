/**
 * Hub Y PO ensureMeshyGltfAxes, PRZED reposition hubów (prawdziwy sygnał góry/dołu).
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { FileLoader } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
	countMeshVerticesInYBands,
	ensureMeshyGltfAxes,
} from "../src/visual/trellisCarOrientation";

const ROOT = join(import.meta.dirname, "..");
const publicDir = join(ROOT, "public");
const OUT = join(ROOT, "public/assets/cars/.work/diag");

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

const WHEEL_NAMES = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"] as const;

function renameWheels(root: THREE.Object3D): void {
	const map: Record<string, string> = {
		wheel_fl: "wheel_FL",
		wheel_fr: "wheel_FR",
		wheel_rl: "wheel_RL",
		wheel_rr: "wheel_RR",
		WheelFrontL: "wheel_FL",
		WheelFrontR: "wheel_FR",
		WheelRearL: "wheel_RL",
		WheelRearR: "wheel_RR",
	};
	root.traverse((obj) => {
		const next = map[obj.name] ?? map[obj.name.toLowerCase()];
		if (next) obj.name = next;
	});
}

function hubStats(root: THREE.Object3D) {
	const body = root.getObjectByName("body");
	const bb =
		body instanceof THREE.Object3D
			? new THREE.Box3().setFromObject(body)
			: new THREE.Box3().setFromObject(root);
	const p = new THREE.Vector3();
	let hubY = 0;
	let n = 0;
	for (const name of WHEEL_NAMES) {
		const h = root.getObjectByName(name);
		if (!h) continue;
		h.getWorldPosition(p);
		hubY += p.y;
		n += 1;
	}
	hubY = n ? hubY / n : NaN;
	const h = bb.max.y - bb.min.y;
	const rel = h > 1e-6 ? (hubY - bb.min.y) / h : NaN;
	const bands = countMeshVerticesInYBands(root);
	const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
	return {
		hubY: +hubY.toFixed(3),
		bodyY: [+bb.min.y.toFixed(3), +bb.max.y.toFixed(3)] as [number, number],
		hubsRelFromBottom: +rel.toFixed(3),
		denseBottom: bands.lower > bands.upper,
		bands: { lower: bands.lower, upper: bands.upper },
		size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)] as [
			number,
			number,
			number,
		],
		flat: size.z > size.y * 1.15 && size.z > size.x * 0.85,
	};
}

const ids =
	process.argv.slice(2).length > 0
		? process.argv.slice(2)
		: [
				"muscle",
				"truck",
				"hatch",
				"buggy",
				"blade",
				"phantom",
				"bruiser",
				"bruiserNeo",
				"sleek",
			];

mkdirSync(OUT, { recursive: true });
const loader = new GLTFLoader();
const rows: unknown[] = [];

for (const id of ids) {
	const buf = readFileSync(join(publicDir, `assets/cars/${id}.glb`));
	const gltf = await loader.parseAsync(
		buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
		"",
	);
	const root = gltf.scene;
	renameWheels(root);
	const size0 = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());

	ensureMeshyGltfAxes(root, id);
	root.updateMatrixWorld(true);
	const chosen = hubStats(root);
	const pitch = root.rotation.x;

	root.rotation.x = pitch + Math.PI;
	root.updateMatrixWorld(true);
	const flipped = hubStats(root);
	root.rotation.x = pitch;

	/** Prawidłowy dół = huby bliżej minY body (przed snap). */
	const preferFlip =
		flipped.hubsRelFromBottom < chosen.hubsRelFromBottom - 0.05;
	const row = {
		id,
		rawSize: [+size0.x.toFixed(2), +size0.y.toFixed(2), +size0.z.toFixed(2)],
		pitchDeg: Math.round((pitch * 180) / Math.PI),
		chosen,
		flipped,
		preferFlip,
		verdict: !chosen.flat
			? "NOT_FLAT"
			: preferFlip
				? "NEED_INVERT"
				: chosen.hubsRelFromBottom > 0.45
					? "HUBS_HIGH"
					: "OK",
	};
	rows.push(row);
	console.log(
		`${row.verdict.padEnd(12)} ${id} pitch=${row.pitchDeg} hubsRel=${chosen.hubsRelFromBottom} denseBot=${chosen.denseBottom} flat=${chosen.flat} flipHubsRel=${flipped.hubsRelFromBottom}`,
	);
}

writeFileSync(join(OUT, "probe-axes.json"), `${JSON.stringify(rows, null, 2)}\n`);
