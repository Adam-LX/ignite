/**
 * GET /__ignite/jumbotron?id=VIDEO_ID → audio/wideo (public/jumbotron, potem yt-dlp).
 * Same-origin, żeby Web Audio mogło zdekodować ścieżkę filmu (pogłos).
 */
import { execFile } from "node:child_process";
import {
	createReadStream,
	existsSync,
	mkdirSync,
	renameSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const execFileAsync = promisify(execFile);
const YT_ID = /^[a-zA-Z0-9_-]{11}$/;
const tmpCache = join(tmpdir(), "ignite-jumbotron");
const inflight = new Map<string, Promise<string>>();

function publicCache(): string {
	return join(process.cwd(), "public", "jumbotron");
}

function mimeFor(file: string): string {
	if (file.endsWith(".webm")) return "audio/webm";
	if (file.endsWith(".m4a")) return "audio/mp4";
	if (file.endsWith(".mp3")) return "audio/mpeg";
	return "video/mp4";
}

function findCached(id: string): string | null {
	for (const dir of [publicCache(), tmpCache]) {
		for (const ext of ["webm", "m4a", "mp3", "mp4"]) {
			const p = join(dir, `${id}.${ext}`);
			if (existsSync(p) && statSync(p).size > 8000) return p;
		}
	}
	return null;
}

async function ensureMedia(id: string): Promise<string> {
	const hit = findCached(id);
	if (hit) return hit;
	const pending = inflight.get(id);
	if (pending) return pending;
	const job = (async () => {
		const dir = publicCache();
		mkdirSync(dir, { recursive: true });
		mkdirSync(tmpCache, { recursive: true });
		const dest = join(dir, `${id}.webm`);
		const part = `${dest}.part`;
		try {
			if (existsSync(part)) unlinkSync(part);
			await execFileAsync(
				"yt-dlp",
				[
					"--no-playlist",
					"--no-warnings",
					"--no-progress",
					"-f",
					"251/140/ba",
					"-o",
					part,
					`https://www.youtube.com/watch?v=${id}`,
				],
				{ timeout: 180_000 },
			);
			const from = existsSync(part)
				? part
				: existsSync(`${part}.webm`)
					? `${part}.webm`
					: `${part}.mp4`;
			if (!existsSync(from) || statSync(from).size < 8000) {
				throw new Error("yt-dlp empty output");
			}
			const ext = from.endsWith(".mp4")
				? ".mp4"
				: from.endsWith(".m4a")
					? ".m4a"
					: ".webm";
			const finalPath = join(dir, `${id}${ext}`);
			renameSync(from, finalPath);
			return finalPath;
		} catch (err) {
			try {
				if (existsSync(part)) unlinkSync(part);
			} catch {
				/* */
			}
			throw err;
		} finally {
			inflight.delete(id);
		}
	})();
	inflight.set(id, job);
	return job;
}

function sendFile(
	req: IncomingMessage,
	res: ServerResponse,
	file: string,
): void {
	const { size } = statSync(file);
	const range = req.headers.range;
	res.setHeader("Content-Type", mimeFor(file));
	res.setHeader("Accept-Ranges", "bytes");
	res.setHeader("Cache-Control", "private, max-age=86400");
	if (range) {
		const m = /bytes=(\d*)-(\d*)/.exec(range);
		let start = m?.[1] ? Number(m[1]) : 0;
		let end = m?.[2] ? Number(m[2]) : size - 1;
		if (!Number.isFinite(start) || start < 0) start = 0;
		if (!Number.isFinite(end) || end >= size) end = size - 1;
		if (start > end) {
			res.statusCode = 416;
			res.end();
			return;
		}
		res.statusCode = 206;
		res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
		res.setHeader("Content-Length", String(end - start + 1));
		createReadStream(file, { start, end }).pipe(res);
		return;
	}
	res.setHeader("Content-Length", String(size));
	createReadStream(file).pipe(res);
}

function jumbotronMiddleware(
	req: IncomingMessage,
	res: ServerResponse,
	next: () => void,
): void {
	const raw = req.url ?? "";
	const pathOnly = raw.split("?")[0];
	if (pathOnly !== "/__ignite/jumbotron") {
		next();
		return;
	}
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.statusCode = 405;
		res.end();
		return;
	}
	const id = new URL(raw, "http://local").searchParams.get("id") ?? "";
	if (!YT_ID.test(id)) {
		res.statusCode = 400;
		res.end("bad id");
		return;
	}
	void ensureMedia(id)
		.then((file) => {
			if (req.method === "HEAD") {
				const { size } = statSync(file);
				res.setHeader("Content-Type", mimeFor(file));
				res.setHeader("Content-Length", String(size));
				res.end();
				return;
			}
			sendFile(req, res, file);
		})
		.catch((err) => {
			console.warn("[ignite-jumbotron]", err);
			res.statusCode = 502;
			res.end("jumbotron fetch failed");
		});
}

export function igniteJumbotronPlugin(): Plugin {
	return {
		name: "ignite-jumbotron",
		configureServer(server) {
			server.middlewares.use(jumbotronMiddleware);
		},
		configurePreviewServer(server) {
			server.middlewares.use(jumbotronMiddleware);
		},
	};
}
