import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

const path = process.argv[2] ?? "public/assets/models/car.glb";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buf = readFileSync(join(root, path));

const draco = new DRACOLoader();
draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

const gltf = await new Promise((resolve, reject) => {
	loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", resolve, reject);
});

function dump(obj, indent = "") {
	const p = obj.position;
	const s = obj.scale;
	const r = obj.rotation;
	console.log(
		`${indent}${obj.name || "(root)"} type=${obj.type} pos=(${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}) scale=(${s.x.toFixed(3)},${s.y.toFixed(3)},${s.z.toFixed(3)})`,
	);
	if (obj instanceof THREE.Mesh) {
		obj.geometry.computeBoundingBox();
		const bb = obj.geometry.boundingBox;
		if (bb) {
			const sz = new THREE.Vector3();
			bb.getSize(sz);
			console.log(`${indent}  geo size: ${sz.x.toFixed(3)} x ${sz.y.toFixed(3)} x ${sz.z.toFixed(3)}`);
		}
	}
	for (const c of obj.children) dump(c, indent + "  ");
}

gltf.scene.updateMatrixWorld(true);
dump(gltf.scene);
const box = new THREE.Box3().setFromObject(gltf.scene);
console.log("world box:", box.min.toArray().map((n) => n.toFixed(3)), box.max.toArray().map((n) => n.toFixed(3)));
