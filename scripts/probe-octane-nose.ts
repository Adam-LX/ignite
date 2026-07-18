/**
 * Porównanie yaw Puls (car.glb): raw vs FORCE vs auto.
 */
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FileLoader } from "three";
import { createGltfLoader } from "../src/util/gltfLoader";
import {
	bakeCarRootTransform,
	centerCarOnHorizontalOrigin,
	ensureMeshyGltfAxes,
	ensureMeshyCarNosePlusZ,
	flattenCarContentToRoot,
	meshyRearTowardPlusZ,
} from "../src/visual/trellisCarOrientation";

const ROOT = join(import.meta.dirname, "..");
const publicDir = join(ROOT, "public");

(globalThis as unknown as { self: typeof globalThis }).self ??= globalThis;
(globalThis as unknown as { Image: unknown }).Image ??= class {
	onload: (() => void) | null = null;
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
			onLoad?.(
				buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
			);
		} catch (e) {
			onError?.(e);
		}
		return this;
	}
	return orig.call(this, url, onLoad, onProgress, onError);
};

function ensureBodyName(root: THREE.Object3D): void {
	if (root.getObjectByName("body")) return;
	let best: THREE.Mesh | null = null;
	let bestN = 0;
	root.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const n = o.geometry?.attributes.position?.count ?? 0;
		if (n > bestN) {
			bestN = n;
			best = o;
		}
	});
	if (best) best.name = "body";
}

function summary(label: string, root: THREE.Object3D): void {
	ensureBodyName(root);
	root.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(root);
	console.log(
		label.padEnd(36),
		JSON.stringify({
			rearPlusZ: meshyRearTowardPlusZ(root),
			z: [+box.min.z.toFixed(2), +box.max.z.toFixed(2)],
		}),
	);
}

const loader = createGltfLoader();
const gltf = await loader.loadAsync("/assets/models/car.glb");
const raw = gltf.scene.clone(true);
ensureBodyName(raw);

summary("RAW (as exported)", raw.clone(true));

{
	const c = raw.clone(true);
	ensureMeshyGltfAxes(c, "octane");
	bakeCarRootTransform(c);
	flattenCarContentToRoot(c);
	centerCarOnHorizontalOrigin(c);
	summary("axes+bake (no nose yaw)", c);
}

{
	const c = raw.clone(true);
	ensureMeshyGltfAxes(c, "octane");
	c.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI);
	bakeCarRootTransform(c);
	flattenCarContentToRoot(c);
	centerCarOnHorizontalOrigin(c);
	const afterForce = meshyRearTowardPlusZ(c);
	summary("FORCE 180 then bake", c);
	if (afterForce) {
		c.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI);
		bakeCarRootTransform(c);
		summary("FORCE + finalize (2nd flip)", c);
	} else {
		summary("FORCE + finalize SKIP", c);
	}
}

{
	const c = raw.clone(true);
	ensureMeshyGltfAxes(c, "octane");
	const flipped = ensureMeshyCarNosePlusZ(c);
	bakeCarRootTransform(c);
	flattenCarContentToRoot(c);
	centerCarOnHorizontalOrigin(c);
	summary(`AUTO nose (${flipped ? "flipped" : "kept"})`, c);
}
