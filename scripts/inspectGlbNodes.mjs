import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "public/assets/models/car.glb";
const buf = readFileSync(path);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));

console.log("=== nodes ===");
for (let i = 0; i < (json.nodes?.length ?? 0); i++) {
	const n = json.nodes[i];
	const t = n.translation ?? [0, 0, 0];
	const s = n.scale ?? [1, 1, 1];
	const r = n.rotation ?? [0, 0, 0, 1];
	console.log(
		`[${i}] ${n.name ?? "?"} mesh=${n.mesh ?? "-"} children=${JSON.stringify(n.children ?? [])} t=${t.map((x) => x.toFixed(3))} s=${s.map((x) => x.toFixed(3))}`,
	);
}

console.log("\n=== scene root ===", json.scenes?.[0]?.nodes);
