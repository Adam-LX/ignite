import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = process.argv[2] ?? join(root, "T4.glb");

const buf = readFileSync(path);
const loader = new GLTFLoader();
const gltf = await new Promise((resolve, reject) => {
	loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", resolve, reject);
});

const scene = gltf.scene;
scene.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(scene);
const size = box.getSize(new THREE.Vector3());
const center = box.getCenter(new THREE.Vector3());

console.log(JSON.stringify({ path, size, center, min: box.min, max: box.max }, null, 2));

scene.traverse((o) => {
	if (o instanceof THREE.Mesh) {
		const mats = Array.isArray(o.material) ? o.material : [o.material];
		console.log("mesh:", o.name || "(unnamed)", "tris:", o.geometry.index?.count ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3);
		for (const m of mats) {
			console.log("  mat:", m.name, m.type, "map:", !!m.map);
		}
	}
});
