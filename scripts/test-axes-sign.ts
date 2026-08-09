import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

(globalThis as any).self = globalThis;
(globalThis as any).Image = class { width=1;height=1;onload:any; set src(_v:string){queueMicrotask(()=>this.onload?.())} };

const buf = readFileSync("public/assets/cars/bruiser.glb");
const loader = new GLTFLoader();
const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength), "");

function roofScore(root: THREE.Object3D): { topUp: number; topDn: number; botUp: number; botDn: number } {
  const body = root.getObjectByName("body") as THREE.Mesh;
  body.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(body);
  const h = box.max.y - box.min.y;
  const high = box.max.y - 0.22 * h;
  const low = box.min.y + 0.22 * h;
  const pos = body.geometry.attributes.position!;
  const nor = body.geometry.attributes.normal!;
  const idx = body.geometry.index;
  let topUp=0,topDn=0,botUp=0,botDn=0;
  const v = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Vector3();
  const face = (ia:number,ib:number,ic:number) => {
    c.set(0,0,0); n.set(0,0,0);
    for (const i of [ia,ib,ic]) {
      v.fromBufferAttribute(pos,i).applyMatrix4(body.matrixWorld); c.add(v);
      n.fromBufferAttribute(nor,i).transformDirection(body.matrixWorld).add(n);
    }
    c.multiplyScalar(1/3); n.normalize();
    if (Math.abs(n.y) < 0.55) return;
    if (c.y >= high) { if (n.y>0) topUp++; else topDn++; }
    if (c.y <= low) { if (n.y>0) botUp++; else botDn++; }
  };
  if (idx) for (let f=0;f<idx.count;f+=3) face(idx.getX(f),idx.getX(f+1),idx.getX(f+2));
  else for (let f=0;f<pos.count;f+=3) face(f,f+1,f+2);
  return { topUp, topDn, botUp, botDn };
}

for (const sign of [-1, 1] as const) {
  const root = gltf.scene.clone(true);
  root.rotation.order = "XYZ";
  root.rotation.x = sign * Math.PI / 2;
  root.updateMatrixWorld(true);
  const s = roofScore(root);
  const box = new THREE.Box3().setFromObject(root.getObjectByName("body")!);
  console.log(JSON.stringify({
    rotX_deg: sign * 90,
    ...s,
    roofAtTop: s.topUp > s.topDn,
    floorAtBottom: s.botDn > s.botUp,
    bodyMinY: +box.min.y.toFixed(3),
    bodyMaxY: +box.max.y.toFixed(3),
  }));
}
