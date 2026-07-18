import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { FileLoader } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
	averageHubRelativeY,
	ensureMeshyGltfAxes,
} from "../src/visual/trellisCarOrientation";

const publicDir = join(import.meta.dirname, "../public");
(globalThis as unknown as { self: typeof globalThis }).self ??= globalThis;
(globalThis as unknown as { Image: unknown }).Image ??= class {
	width = 1;
	height = 1;
	onload: (() => void) | null = null;
	set src(_v: string) {
		queueMicrotask(() => this.onload?.());
	}
};

const orig = FileLoader.prototype.load;
FileLoader.prototype.load = function (url, onLoad, onProgress, onError) {
	let disk: string | null = null;
	if (typeof url === "string" && url.startsWith("/")) {
		disk = join(publicDir, url.replace(/^\//, ""));
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

function rename(root: THREE.Object3D) {
	const m: Record<string, string> = {
		wheel_fl: "wheel_FL",
		wheel_fr: "wheel_FR",
		wheel_rl: "wheel_RL",
		wheel_rr: "wheel_RR",
	};
	root.traverse((o) => {
		const n = m[o.name.toLowerCase()];
		if (n) o.name = n;
	});
}

const axis = new THREE.Vector3(0, 1, 0);
const loader = new GLTFLoader();

for (const id of ["muscle", "truck", "buggy", "hatch", "bruiser"]) {
	const buf = readFileSync(join(publicDir, `assets/cars/${id}.glb`));
	const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

	const root = (await loader.parseAsync(ab, "")).scene;
	rename(root);
	ensureMeshyGltfAxes(root, id);
	const a = averageHubRelativeY(root);
	root.rotateOnWorldAxis(axis, Math.PI);
	root.updateMatrixWorld(true);
	const b = averageHubRelativeY(root);

	const r2 = (await loader.parseAsync(ab.slice(0), "")).scene;
	rename(r2);
	ensureMeshyGltfAxes(r2, id);
	r2.rotation.y += Math.PI;
	r2.updateMatrixWorld(true);
	const c = averageHubRelativeY(r2);

	console.log(
		`${id} axes=${a?.toFixed(3)} worldYaw=${b?.toFixed(3)} eulerYaw=${c?.toFixed(3)}`,
	);
}
