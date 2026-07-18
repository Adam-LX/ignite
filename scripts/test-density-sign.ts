import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { countMeshVerticesInYBands } from "../src/visual/trellisCarOrientation";

(globalThis as any).self = globalThis;
(globalThis as any).Image = class { width=1;height=1;onload:any; set src(_v:string){queueMicrotask(()=>this.onload?.())} };

for (const id of ["bruiser", "muscle", "blade"]) {
  const buf = readFileSync(`public/assets/cars/${id}.glb`);
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength), "");
  for (const sign of [-1, 1]) {
    const root = gltf.scene.clone(true);
    root.rotation.order = "XYZ";
    root.rotation.x = sign * Math.PI / 2;
    root.updateMatrixWorld(true);
    const b = countMeshVerticesInYBands(root);
    console.log(id, `rot=${sign*90}`, b, "denseBottom", b.lower > b.upper);
  }
}
