/**
 * Audyt orientacji bruiser — każdy krok pipeline.
 *   nix develop -c npx vite-node scripts/audit-bruiser-orientation.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import {
	ensureMeshyGltfAxes,
	ensureTrellisCarUpright,
} from "../src/visual/trellisCarOrientation";
import { loadCarModel, loadCarThumbnailModel } from "../src/visual/CarModel";

const ROOT = join(import.meta.dirname, "..");
const publicDir = join(ROOT, "public");

if (typeof globalThis.self === "undefined") {
	(globalThis as unknown as { self: typeof globalThis }).self = globalThis;
}
if (typeof globalThis.Image === "undefined") {
	(globalThis as unknown as { Image: unknown }).Image = class {
		width = 1;
		height = 1;
		onload: (() => void) | null = null;
		onerror: ((err: unknown) => void) | null = null;
		set src(_v: string) {
			this.width = 1;
			this.height = 1;
			queueMicrotask(() => this.onload?.());
		}
	};
}

const orig = THREE.FileLoader.prototype.load;
THREE.FileLoader.prototype.load = function (
	url: string,
	onLoad?: (data: unknown) => void,
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

function report(label: string, root: THREE.Object3D): void {
	root.updateMatrixWorld(true);
	const body = root.getObjectByName("body");
	const bb = body
		? new THREE.Box3().setFromObject(body)
		: new THREE.Box3().setFromObject(root);
	const bc = bb.getCenter(new THREE.Vector3());
	const hubs: Record<string, number[]> = {};
	let hubAvgY = 0;
	let hubN = 0;
	for (const n of ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"]) {
		const h = root.getObjectByName(n);
		if (!h) continue;
		const p = new THREE.Vector3();
		h.getWorldPosition(p);
		hubs[n] = [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)];
		hubAvgY += p.y;
		hubN++;
	}
	hubAvgY = hubN ? hubAvgY / hubN : 0;
	const above = bb.max.y - hubAvgY;
	const below = hubAvgY - bb.min.y;
	const size = bb.getSize(new THREE.Vector3());
	console.log(
		JSON.stringify(
			{
				label,
				bodyCenterY: +bc.y.toFixed(3),
				bodyMinY: +bb.min.y.toFixed(3),
				bodyMaxY: +bb.max.y.toFixed(3),
				hubAvgY: +hubAvgY.toFixed(3),
				massAboveHub: +above.toFixed(3),
				massBelowHub: +below.toFixed(3),
				verdict:
					above < below * 0.72
						? "UPSIDE_DOWN (more mass below hubs)"
						: "OK (more mass above hubs)",
				size: [+size.x.toFixed(3), +size.y.toFixed(3), +size.z.toFixed(3)],
				hubs,
				rootRotDeg: [
					Math.round((root.rotation.x * 180) / Math.PI),
					Math.round((root.rotation.y * 180) / Math.PI),
					Math.round((root.rotation.z * 180) / Math.PI),
				],
			},
			null,
			2,
		),
	);
}

// Używa prawdziwego ensureMeshyGltfAxes z src (nie lokalnej kopii).

const buf = readFileSync(join(ROOT, "public/assets/cars/bruiser.glb"));
const loader = new GLTFLoader();
const gltf = await loader.parseAsync(
	buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
	"",
);
const raw = gltf.scene as THREE.Group;
raw.userData.carId = "bruiser";
report("1_RAW_GLB", raw);

const afterAxes = raw.clone(true);
afterAxes.userData.carId = "bruiser";
ensureMeshyGltfAxes(afterAxes);
report("2_AFTER_ensureMeshyGltfAxes", afterAxes);

const afterUpright = afterAxes.clone(true);
afterUpright.userData.carId = "bruiser";
const flipped = ensureTrellisCarUpright(afterUpright, "bruiser");
report(`3_AFTER_ensureTrellisCarUpright(flipped=${flipped})`, afterUpright);

report("4_AXES_ONLY_control", afterAxes);

const thumb = await loadCarThumbnailModel("bruiser");
report("5_loadCarThumbnailModel", thumb);

const full = await loadCarModel("bruiser", "blue");
report("6_loadCarModel", full);

const muscle = await loadCarThumbnailModel("muscle");
report("7_muscle_thumbnail_CONTROL", muscle);
