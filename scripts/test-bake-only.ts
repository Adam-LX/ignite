import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  ensureMeshyGltfAxes,
  countMeshVerticesInYBands,
  ensureTrellisCarUpright,
} from "../src/visual/trellisCarOrientation";
import { repositionEmptyWheelHubsFromBody } from "../src/visual/wheelMount";

(globalThis as any).self = globalThis;
(globalThis as any).Image = class { width=1;height=1;onload:any; set src(_v:string){queueMicrotask(()=>this.onload?.())} };

const buf = readFileSync("public/assets/cars/bruiser.glb");
const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength), "");
const root = gltf.scene as THREE.Group;
root.userData.carId = "bruiser";
ensureMeshyGltfAxes(root);
ensureTrellisCarUpright(root, "bruiser");
console.log("after bake", countMeshVerticesInYBands(root), "rot", root.rotation.toArray().slice(0,3));
const body = root.getObjectByName("body")!;
let box = new THREE.Box3().setFromObject(body);
console.log("body", box.min.toArray().map(v=>+v.toFixed(3)), box.max.toArray().map(v=>+v.toFixed(3)));
for (const n of ["wheel_FL","wheel_RL"]) {
  const h=root.getObjectByName(n)!; const p=new THREE.Vector3(); h.getWorldPosition(p);
  console.log("pre-rehub", n, "local", h.position.toArray().map(v=>+v.toFixed(3)), "world", p.toArray().map(v=>+v.toFixed(3)));
}
repositionEmptyWheelHubsFromBody(root, "bruiser");
box = new THREE.Box3().setFromObject(body);
console.log("body after rehub", box.min.toArray().map(v=>+v.toFixed(3)), box.max.toArray().map(v=>+v.toFixed(3)));
for (const n of ["wheel_FL","wheel_FR","wheel_RL","wheel_RR"]) {
  const h=root.getObjectByName(n)!; const p=new THREE.Vector3(); h.getWorldPosition(p);
  console.log("rehub", n, "local", h.position.toArray().map(v=>+v.toFixed(3)), "world", p.toArray().map(v=>+v.toFixed(3)));
}
