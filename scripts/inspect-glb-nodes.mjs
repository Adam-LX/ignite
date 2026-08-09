import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";

async function dump(rel) {
	const loader = new GLTFLoader();
	const filePath = path.join(root, "public", rel);
	const buf = readFileSync(filePath);
	const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
	console.log(`\n=== ${rel} ===`);
	gltf.scene.updateMatrixWorld(true);
	gltf.scene.traverse((o) => {
		if (!o.name && o.type === "Group" && o.children.length === 0) return;
		const box = new THREE.Box3().setFromObject(o);
		const size = box.getSize(new THREE.Vector3());
		const pos = new THREE.Vector3();
		o.getWorldPosition(pos);
		if (o.type === "Mesh" || /wheel|tire|rim|hub|body/i.test(o.name) || Math.max(size.x, size.y, size.z) > 0.4) {
			console.log(
				`${o.type}:${o.name || "(unnamed)"} worldY=${pos.y.toFixed(3)} size=${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)}`,
			);
		}
	});
}

await dump("assets/cars/hatch.glb");
await dump("assets/items/wheels/rally.glb");
await dump("assets/items/wheels/factory.glb");
