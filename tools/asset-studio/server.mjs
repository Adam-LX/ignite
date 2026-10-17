/**
 * Ignite Asset Studio — local Vite UI + write API for arena manifests.
 * Port 5178. Writes only under public/assets/arenas/.
 *
 * Usage: npm run assets:studio
 */
import { createServer as createViteServer } from "vite";
import {
	createReadStream,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ARENAS = join(ROOT, "public/assets/arenas");
const CATALOG = join(ARENAS, "arena-catalog.json");
const PORT = Number(process.env.ASSET_STUDIO_PORT || 5178);
/** 0.0.0.0 — żeby działało i 127.0.0.1, i localhost (::1). Dev-only. */
const HOST = process.env.ASSET_STUDIO_HOST || "0.0.0.0";

/** Slots shown in the UI (manifest keys → label + folder hint). */
export const SLOT_DEFS = [
	{ key: "grassColor", label: "Murawa (color)", kind: "image", dir: "textures" },
	{ key: "grassNormal", label: "Murawa (normal)", kind: "image", dir: "textures" },
	{ key: "grassRoughness", label: "Murawa (roughness)", kind: "image", dir: "textures" },
	{ key: "wallPanel", label: "Ściana", kind: "image", dir: "textures" },
	{ key: "bannerPanel", label: "Banner panel", kind: "image", dir: "textures" },
	{ key: "bannerBlue", label: "Banner blue", kind: "image", dir: "textures" },
	{ key: "bannerOrange", label: "Banner orange", kind: "image", dir: "textures" },
	{ key: "ceilingPanel", label: "Sufit", kind: "image", dir: "textures" },
	{ key: "ballAlbedo", label: "Piłka (albedo)", kind: "image", dir: "textures" },
	{ key: "ballModel", label: "Piłka (GLB)", kind: "glb", dir: "props" },
	{ key: "goalFrame", label: "Bramka (GLB)", kind: "glb", dir: "props" },
	{ key: "goalConcept", label: "Bramka (concept PNG)", kind: "image", dir: "concepts" },
];

function json(res, status, body) {
	const data = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	res.end(data);
}

function readCatalog() {
	return JSON.parse(readFileSync(CATALOG, "utf8"));
}

function arenaDir(id) {
	const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
	if (!safe || safe !== id) return null;
	const dir = resolve(ARENAS, safe);
	const rel = relative(ARENAS, dir);
	if (rel.startsWith("..") || rel.includes("..")) return null;
	return dir;
}

function readManifest(id) {
	const dir = arenaDir(id);
	if (!dir) return null;
	const path = join(dir, "manifest.json");
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, "utf8"));
}

function publicUrlFor(absFile) {
	const rel = relative(join(ROOT, "public"), absFile).replace(/\\/g, "/");
	return `/${rel}`;
}

async function readBody(req) {
	const chunks = [];
	for await (const c of req) chunks.push(c);
	return Buffer.concat(chunks);
}

/** Minimal multipart parser (single file field "file" + field "slot"). */
function parseMultipart(buf, boundary) {
	const parts = {};
	const sep = Buffer.from(`--${boundary}`);
	let start = buf.indexOf(sep) + sep.length;
	while (start < buf.length) {
		if (buf[start] === 45 && buf[start + 1] === 45) break; // --
		if (buf[start] === 13) start++;
		if (buf[start] === 10) start++;
		const next = buf.indexOf(sep, start);
		if (next < 0) break;
		let part = buf.subarray(start, next);
		if (part.length >= 2 && part[part.length - 2] === 13) {
			part = part.subarray(0, part.length - 2);
		}
		const headerEnd = part.indexOf("\r\n\r\n");
		if (headerEnd < 0) {
			start = next + sep.length;
			continue;
		}
		const header = part.subarray(0, headerEnd).toString("utf8");
		const body = part.subarray(headerEnd + 4);
		const nameMatch = /name="([^"]+)"/.exec(header);
		const fileMatch = /filename="([^"]*)"/.exec(header);
		if (nameMatch) {
			if (fileMatch && fileMatch[1]) {
				parts[nameMatch[1]] = {
					filename: fileMatch[1],
					data: body,
					contentType: /Content-Type:\s*(\S+)/i.exec(header)?.[1] || "",
				};
			} else {
				parts[nameMatch[1]] = body.toString("utf8").trim();
			}
		}
		start = next + sep.length;
	}
	return parts;
}

function ensureUnderArenas(absPath) {
	const norm = normalize(resolve(absPath));
	const base = normalize(ARENAS);
	if (!norm.startsWith(base + "/") && norm !== base) {
		throw new Error("path escape blocked");
	}
	return norm;
}

async function handleApi(req, res, url) {
	const path = url.pathname;

	if (req.method === "GET" && path === "/api/health") {
		return json(res, 200, { ok: true, arenas: ARENAS, port: PORT });
	}

	if (req.method === "GET" && path === "/api/slots") {
		return json(res, 200, { slots: SLOT_DEFS });
	}

	if (req.method === "GET" && path === "/api/arenas") {
		const catalog = readCatalog();
		const arenas = (catalog.arenas || []).map((a) => ({
			id: a.id,
			nameKey: a.nameKey,
			manifest: a.manifest,
			defaultUnlocked: a.defaultUnlocked,
			folder: join(ARENAS, a.id),
		}));
		return json(res, 200, { arenas });
	}

	const one = /^\/api\/arenas\/([^/]+)$/.exec(path);
	if (req.method === "GET" && one) {
		const id = decodeURIComponent(one[1]);
		const dir = arenaDir(id);
		if (!dir || !existsSync(dir)) return json(res, 404, { error: "arena not found" });
		const manifest = readManifest(id);
		if (!manifest) return json(res, 404, { error: "manifest missing" });
		const catalog = readCatalog();
		const meta = (catalog.arenas || []).find((a) => a.id === id) || { id };
		const slots = SLOT_DEFS.map((s) => {
			const value = manifest[s.key] ?? null;
			return {
				...s,
				value,
				previewUrl: value || null,
			};
		});
		return json(res, 200, {
			id,
			meta,
			manifest,
			slots,
			folder: dir,
		});
	}

	const putManifest = /^\/api\/arenas\/([^/]+)\/manifest$/.exec(path);
	if (req.method === "PUT" && putManifest) {
		const id = decodeURIComponent(putManifest[1]);
		const dir = arenaDir(id);
		if (!dir || !existsSync(dir)) return json(res, 404, { error: "arena not found" });
		const raw = await readBody(req);
		let body;
		try {
			body = JSON.parse(raw.toString("utf8"));
		} catch {
			return json(res, 400, { error: "invalid JSON" });
		}
		const manifest = body.manifest && typeof body.manifest === "object" ? body.manifest : body;
		manifest.updatedAt = new Date().toISOString();
		const out = join(dir, "manifest.json");
		ensureUnderArenas(out);
		writeFileSync(out, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
		return json(res, 200, { ok: true, manifest, path: out });
	}

	const postFile = /^\/api\/arenas\/([^/]+)\/file$/.exec(path);
	if (req.method === "POST" && postFile) {
		const id = decodeURIComponent(postFile[1]);
		const dir = arenaDir(id);
		if (!dir || !existsSync(dir)) return json(res, 404, { error: "arena not found" });
		const ctype = req.headers["content-type"] || "";
		const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
		if (!m) return json(res, 400, { error: "expected multipart" });
		const boundary = m[1] || m[2];
		const buf = await readBody(req);
		const parts = parseMultipart(buf, boundary);
		const slotKey = typeof parts.slot === "string" ? parts.slot : "";
		const file = parts.file;
		if (!slotKey || !file?.data?.length) {
			return json(res, 400, { error: "need slot + file" });
		}
		const def = SLOT_DEFS.find((s) => s.key === slotKey);
		if (!def) return json(res, 400, { error: `unknown slot ${slotKey}` });

		const origExt = extname(file.filename || "").toLowerCase() || (def.kind === "glb" ? ".glb" : ".png");
		const allowed =
			def.kind === "glb"
				? [".glb", ".gltf"]
				: [".png", ".jpg", ".jpeg", ".webp", ".gif"];
		if (!allowed.includes(origExt)) {
			return json(res, 400, { error: `bad extension ${origExt}` });
		}

		const sub = join(dir, def.dir);
		mkdirSync(sub, { recursive: true });
		const baseName = `${slotKey}${origExt}`;
		const abs = ensureUnderArenas(join(sub, baseName));
		writeFileSync(abs, file.data);

		const manifest = readManifest(id) || {};
		const urlPath = publicUrlFor(abs);
		manifest[slotKey] = urlPath;
		if (slotKey === "goalFrame") {
			manifest.prop_goalFrame = urlPath;
		}
		manifest.updatedAt = new Date().toISOString();
		const manPath = ensureUnderArenas(join(dir, "manifest.json"));
		writeFileSync(manPath, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");

		return json(res, 200, {
			ok: true,
			slot: slotKey,
			path: abs,
			url: urlPath,
			manifest,
		});
	}

	return json(res, 404, { error: "not found" });
}

async function main() {
	if (!existsSync(CATALOG)) {
		console.error("[asset-studio] missing", CATALOG);
		process.exit(1);
	}

	const vite = await createViteServer({
		root: __dirname,
		appType: "spa",
		configFile: false,
		resolve: {
			alias: {
				three: join(ROOT, "node_modules/three"),
			},
		},
		server: {
			middlewareMode: true,
			fs: { allow: [ROOT, __dirname] },
		},
		publicDir: false,
		clearScreen: false,
	});

	const publicAssets = join(ROOT, "public");

	const server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

			if (url.pathname.startsWith("/api/")) {
				return await handleApi(req, res, url);
			}

			// Serve game assets for previews (same paths as Ignite)
			if (url.pathname.startsWith("/assets/")) {
				const file = resolve(publicAssets, "." + url.pathname);
				const rel = relative(publicAssets, file);
				if (rel.startsWith("..") || !existsSync(file) || !statSync(file).isFile()) {
					res.writeHead(404);
					return res.end("not found");
				}
				const ext = extname(file).toLowerCase();
				const types = {
					".png": "image/png",
					".jpg": "image/jpeg",
					".jpeg": "image/jpeg",
					".webp": "image/webp",
					".gif": "image/gif",
					".glb": "model/gltf-binary",
					".gltf": "model/gltf+json",
					".json": "application/json",
				};
				res.writeHead(200, {
					"Content-Type": types[ext] || "application/octet-stream",
					"Cache-Control": "no-cache",
				});
				return createReadStream(file).pipe(res);
			}

			vite.middlewares(req, res, async () => {
				try {
					const index = readFileSync(join(__dirname, "index.html"), "utf8");
					const html = await vite.transformIndexHtml(url.pathname, index);
					res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
					res.end(html);
				} catch (e) {
					vite.ssrFixStacktrace(e);
					res.writeHead(500);
					res.end(String(e));
				}
			});
		} catch (e) {
			console.error(e);
			res.writeHead(500);
			res.end(String(e?.message || e));
		}
	});

	server.listen(PORT, HOST, () => {
		const urlFile = join(ROOT, "data/asset-studio.url");
		try {
			mkdirSync(dirname(urlFile), { recursive: true });
			writeFileSync(urlFile, `http://127.0.0.1:${PORT}\n`, "utf8");
		} catch {
			/* ignore */
		}
		console.log("");
		console.log(`  Asset Studio  →  http://127.0.0.1:${PORT}`);
		console.log(`                  http://localhost:${PORT}`);
		console.log(`  Writes under  →  ${ARENAS}`);
		console.log(`  Keep this terminal open. Ctrl+C to stop.`);
		console.log("");
	});
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
