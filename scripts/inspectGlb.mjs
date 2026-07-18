import { readFileSync } from "node:fs";
import { join } from "node:path";

const path = process.argv[2] ?? "T4.glb";
const buf = readFileSync(path);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));

console.log("===", path, "===");
console.log("meshes:", json.meshes?.length ?? 0);
console.log("materials:", json.materials?.length ?? 0);
console.log("nodes:");
for (const n of json.nodes ?? []) {
	const parts = [n.name ?? "(unnamed)"];
	if (n.mesh !== undefined) parts.push(`mesh=${n.mesh}`);
	if (n.children) parts.push(`children=[${n.children.join(",")}]`);
	console.log(" ", parts.join(" "));
}
console.log("material names:");
for (let i = 0; i < (json.materials?.length ?? 0); i++) {
	const m = json.materials[i];
	console.log(`  [${i}]`, m.name ?? "(unnamed)", m.pbrMetallicRoughness ? "PBR" : "");
}
