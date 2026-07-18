import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";

const publicDir = join(import.meta.dirname, "../public");
(globalThis as any).self = globalThis;
(globalThis as any).Image = class { width=1;height=1;onload:any; set src(_v:string){queueMicrotask(()=>this.onload?.())} };
const orig = THREE.FileLoader.prototype.load;
THREE.FileLoader.prototype.load = function(url, onLoad, onP, onE) {
  let disk: string | null = null;
  if (url.startsWith("/assets/") || url.startsWith("assets/")) disk = join(publicDir, url.replace(/^\//,""));
  else if (url.startsWith("/")) disk = join(publicDir, url.slice(1));
  if (disk) { try { const b=readFileSync(disk); onLoad?.(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)); } catch(e){onE?.(e);} return this; }
  return orig.call(this, url, onLoad, onP, onE);
};

import { loadCarThumbnailModel } from "../src/visual/CarModel";

const car = await loadCarThumbnailModel("bruiser");
const inner = car.children[0] as THREE.Object3D;
inner.updateMatrixWorld(true);
for (const n of ["wheel_FL","wheel_FR","wheel_RL","wheel_RR"]) {
  const h = inner.getObjectByName(n)!;
  const w = new THREE.Vector3(); h.getWorldPosition(w);
  console.log(n, "local", h.position.toArray().map(v=>+v.toFixed(3)), "world", w.toArray().map(v=>+v.toFixed(3)));
}
const body = inner.getObjectByName("body")!;
const box = new THREE.Box3().setFromObject(body);
console.log("body", box.min.toArray().map(v=>+v.toFixed(3)), box.max.toArray().map(v=>+v.toFixed(3)));
console.log("rot", inner.rotation.toArray().slice(0,3).map(r=>Math.round((r as number)*180/Math.PI)));
