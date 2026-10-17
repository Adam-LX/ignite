/**
 * Vite plugin: POST /__ignite/save-clip → ~/Wideo/*.mp4 (ffmpeg)
 * + publikacja data/gameplay-clips/latest.* dla agenta („zobacz klip”).
 * Obsługuje pakiet IGN F (JPEG klatki) oraz legacy WebM/MP4.
 */
import { execFile } from "node:child_process";
import {
	mkdirSync,
	unlinkSync,
	writeFileSync,
	existsSync,
	readFileSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Plugin } from "vite";
import { publishGameplayClipLatest } from "./publishGameplayClipLatest.mjs";

const execFileAsync = promisify(execFile);

function resolveVideosDir(): string {
	const home = homedir();
	for (const dir of [join(home, "Wideo"), join(home, "Videos")]) {
		if (existsSync(dir)) return dir;
	}
	const fallback = join(home, "Wideo");
	mkdirSync(fallback, { recursive: true });
	return fallback;
}

function readBody(req: import("http").IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

const pendingMeta = new Map<string, string>();

function publishLatest(
	repoRoot: string,
	baseName: string,
	videoPath: string,
	inputLogJson: string | null,
): void {
	try {
		publishGameplayClipLatest({
			repoRoot,
			videoPath,
			inputLogJson,
			baseName,
			videosPath: videoPath,
		});
	} catch (err) {
		console.warn("[ignite-clip] latest publish fail", err);
	}
}

export function igniteClipSavePlugin(): Plugin {
	return {
		name: "ignite-clip-save",
		configureServer(server) {
			const repoRoot = server.config.root || process.cwd();
			server.middlewares.use(async (req, res, next) => {
				const pathOnly = req.url?.split("?")[0];
				if (
					req.method === "POST" &&
					pathOnly === "/__ignite/save-clip-error"
				) {
					try {
						const body = await readBody(req);
						const dir = join(repoRoot, "data", "gameplay-clips");
						mkdirSync(dir, { recursive: true });
						writeFileSync(
							join(dir, "last-error.txt"),
							body.length > 0
								? body.toString("utf8")
								: `${new Date().toISOString()}\n(empty)\n`,
							"utf8",
						);
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify({ ok: true }));
					} catch (err) {
						res.statusCode = 500;
						res.end(
							JSON.stringify({
								ok: false,
								error: err instanceof Error ? err.message : "err log fail",
							}),
						);
					}
					return;
				}
				if (
					req.method === "POST" &&
					pathOnly === "/__ignite/save-clip-meta"
				) {
					try {
						const url = new URL(req.url!, "http://localhost");
						const baseName = (
							url.searchParams.get("name") || `ignite-clip-${Date.now()}`
						).replace(/[^\w.\-]+/g, "_");
						const body = await readBody(req);
						if (body.length < 2) {
							res.statusCode = 400;
							res.end(JSON.stringify({ ok: false, error: "empty meta" }));
							return;
						}
						const dir = resolveVideosDir();
						mkdirSync(dir, { recursive: true });
						const metaPath = join(dir, `${baseName}.inputs.json`);
						const json = body.toString("utf8");
						writeFileSync(metaPath, json);
						pendingMeta.set(baseName, json);

						const mp4 = join(dir, `${baseName}.mp4`);
						const webm = join(dir, `${baseName}.webm`);
						const videoPath = existsSync(mp4)
							? mp4
							: existsSync(webm)
								? webm
								: null;
						if (videoPath) {
							publishLatest(repoRoot, baseName, videoPath, json);
						}

						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify({ ok: true, path: metaPath }));
					} catch (err) {
						res.statusCode = 500;
						res.end(
							JSON.stringify({
								ok: false,
								error: err instanceof Error ? err.message : "meta fail",
							}),
						);
					}
					return;
				}

				if (req.method !== "POST" || pathOnly !== "/__ignite/save-clip") {
					next();
					return;
				}
				try {
					const url = new URL(req.url!, "http://localhost");
					const baseName = (
						url.searchParams.get("name") || `ignite-clip-${Date.now()}`
					).replace(/[^\w.\-]+/g, "_");
					const mime = (url.searchParams.get("mime") || "").toLowerCase();
					const body = await readBody(req);
					if (body.length < 64) {
						res.statusCode = 400;
						res.end(JSON.stringify({ ok: false, error: "empty body" }));
						return;
					}
					const dir = resolveVideosDir();
					mkdirSync(dir, { recursive: true });
					const mp4Path = join(dir, `${baseName}.mp4`);
					const webmPath = join(dir, `${baseName}.webm`);

					const metaFromPending = pendingMeta.get(baseName) ?? null;
					const metaFile = join(dir, `${baseName}.inputs.json`);
					const metaJson =
						metaFromPending ??
						(existsSync(metaFile)
							? readFileSync(metaFile, "utf8")
							: null);

					let savedPath = mp4Path;

					const isFrames =
						mime.includes("ignite-frames") ||
						(body.length >= 4 && body.subarray(0, 4).toString("ascii") === "IGNF");

					if (isFrames) {
						const { encodeIgniteFramesToMp4 } = await import(
							`${pathToFileURL(join(repoRoot, "scripts/igniteClipFrames.mjs")).href}?t=${Date.now()}`
						);
						const encoded = await encodeIgniteFramesToMp4(body, mp4Path);
						if (!encoded.ok) {
							res.statusCode = 500;
							res.end(
								JSON.stringify({
									ok: false,
									error: encoded.error ?? "encode fail",
								}),
							);
							return;
						}
						savedPath = mp4Path;
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify({ ok: true, path: savedPath }));
					} else if (mime.includes("mp4")) {
						writeFileSync(mp4Path, body);
						savedPath = mp4Path;
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify({ ok: true, path: savedPath }));
					} else {
						if (body.length < 80_000) {
							res.statusCode = 400;
							res.end(
								JSON.stringify({
									ok: false,
									error: `Wideo za małe (${body.length} B)`,
								}),
							);
							return;
						}
						writeFileSync(webmPath, body);
						try {
							await execFileAsync(
								"ffmpeg",
								[
									"-y",
									"-i",
									webmPath,
									"-c:v",
									"libx264",
									"-preset",
									"veryfast",
									"-crf",
									"20",
									"-pix_fmt",
									"yuv420p",
									"-movflags",
									"+faststart",
									"-an",
									mp4Path,
								],
								{ timeout: 120_000 },
							);
							savedPath = mp4Path;
							try {
								if (statSync(mp4Path).size < 64) {
									savedPath = webmPath;
								} else {
									unlinkSync(webmPath);
								}
							} catch {
								savedPath = webmPath;
							}
							res.setHeader("Content-Type", "application/json");
							res.end(JSON.stringify({ ok: true, path: savedPath }));
						} catch (err) {
							savedPath = webmPath;
							res.setHeader("Content-Type", "application/json");
							res.end(
								JSON.stringify({
									ok: true,
									path: webmPath,
									error:
										err instanceof Error
											? `ffmpeg: ${err.message}`
											: "ffmpeg fail",
								}),
							);
						}
					}

					publishLatest(repoRoot, baseName, savedPath, metaJson);
					pendingMeta.delete(baseName);
				} catch (err) {
					res.statusCode = 500;
					res.end(
						JSON.stringify({
							ok: false,
							error: err instanceof Error ? err.message : "save fail",
						}),
					);
				}
			});
		},
	};
}
