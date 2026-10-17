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
import { countMeshVerticesInYBands } from "../src/visual/trellisCarOrientation";

const car = await loadCarThumbnailModel("bruiser");
const inner = car.children[0] as THREE.Object3D;
inner.updateMatrixWorld(true);
const bands = countMeshVerticesInYBands(inner);
const body = inner.getObjectByName("body")!;
const box = new THREE.Box3().setFromObject(body);
const hubY = ["wheel_FL","wheel_RL"].map(n => {
  const p = new THREE.Vector3();
  inner.getObjectByName(n)!.getWorldPosition(p);
  return p.y;
});
const avgHub = (hubY[0]!+hubY[1]!)/2;
console.log(JSON.stringify({
  rotX: Math.round(inner.rotation.x * 180 / Math.PI),
  bands,
  denseBottom: bands.lower > bands.upper,
  bodyMin: +box.min.y.toFixed(3),
  bodyMax: +box.max.y.toFixed(3),
  avgHubY: +avgHub.toFixed(3),
  hubsNearBottom: avgHub < (box.min.y + box.max.y) * 0.5,
}));
