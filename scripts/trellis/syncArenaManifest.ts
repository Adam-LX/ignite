/**
 * Skan manifestów per mapa w public/assets/arenas/
 *   npm run trellis:sync-arena-manifests
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const ARENAS_DIR = resolve(ROOT, "public/assets/arenas");

function scanManifests(): void {
	const entries = readdirSync(ARENAS_DIR, { withFileTypes: true });
	for (const ent of entries) {
		if (!ent.isDirectory()) continue;
		const arenaId = ent.name;
		const manifestPath = join(ARENAS_DIR, arenaId, "manifest.json");
		if (!existsSync(manifestPath)) continue;

		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
			string,
			string
		>;
		manifest.updatedAt = new Date().toISOString();

		const propsDir = join(ARENAS_DIR, arenaId, "props");
		if (existsSync(propsDir)) {
			for (const f of readdirSync(propsDir)) {
				if (f.endsWith(".glb")) {
					const key = `prop_${f.replace(/\.glb$/, "")}`;
					manifest[key] = `/assets/arenas/${arenaId}/props/${f}`;
				}
			}
		}

		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
		console.info(`Synced ${arenaId}/manifest.json`);
	}
}

scanManifests();
