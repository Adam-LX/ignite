/**
 * Pakiet klatek JPEG z F9 → MP4 (ffmpeg image2).
 * Format: IGN F | u16 ver | u16 fps | u32 count | (u32 len + jpeg)*
 */
import { execFile } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const IGNITE_FRAMES_MIME = "application/x-ignite-frames";
const MAGIC = Buffer.from("IGNF");

/** TMPDIR z martwego nix-shella → ENOENT przy mkdtemp (klipy F9 nie zapisują się). */
function resolveClipTmpRoot() {
	for (const cand of [tmpdir(), "/tmp", process.cwd()]) {
		try {
			if (cand && existsSync(cand)) {
				const probe = join(cand, `.ignite-clip-probe-${process.pid}`);
				writeFileSync(probe, "ok");
				rmSync(probe, { force: true });
				return cand;
			}
		} catch {
			/* try next */
		}
	}
	return "/tmp";
}

export function isIgniteFramesPack(buf) {
	return Buffer.isBuffer(buf) && buf.length >= 12 && buf.subarray(0, 4).equals(MAGIC);
}

export function packIgniteFrames(frames, fps) {
	const parts = [MAGIC];
	const hdr = Buffer.alloc(8);
	hdr.writeUInt16LE(1, 0);
	hdr.writeUInt16LE(Math.max(1, Math.min(60, fps | 0)), 2);
	hdr.writeUInt32LE(frames.length, 4);
	parts.push(hdr);
	for (const frame of frames) {
		const body = Buffer.isBuffer(frame) ? frame : Buffer.from(frame);
		const len = Buffer.alloc(4);
		len.writeUInt32LE(body.length, 0);
		parts.push(len, body);
	}
	return Buffer.concat(parts);
}

export function unpackIgniteFrames(buf) {
	if (!isIgniteFramesPack(buf)) {
		throw new Error("Nieprawidłowy pakiet klatek");
	}
	const ver = buf.readUInt16LE(4);
	if (ver !== 1) throw new Error(`Nieznana wersja frames v${ver}`);
	const fps = buf.readUInt16LE(6);
	const count = buf.readUInt32LE(8);
	let off = 12;
	const frames = [];
	for (let i = 0; i < count; i++) {
		if (off + 4 > buf.length) throw new Error("Obcięty pakiet klatek");
		const len = buf.readUInt32LE(off);
		off += 4;
		if (off + len > buf.length) throw new Error("Obcięta klatka");
		frames.push(buf.subarray(off, off + len));
		off += len;
	}
	return { fps, frames };
}

/**
 * @param {Buffer} pack
 * @param {string} mp4Path
 * @returns {Promise<{ ok: boolean; path?: string; error?: string; frameCount?: number }>}
 */
export async function encodeIgniteFramesToMp4(pack, mp4Path) {
	let fps;
	let frames;
	try {
		({ fps, frames } = unpackIgniteFrames(pack));
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : "unpack fail",
		};
	}
	if (frames.length < 3) {
		return { ok: false, error: `Za mało klatek (${frames.length})` };
	}

	const tmp = mkdtempSync(join(resolveClipTmpRoot(), "ignite-clip-"));
	try {
		for (let i = 0; i < frames.length; i++) {
			const name = `f${String(i).padStart(5, "0")}.jpg`;
			writeFileSync(join(tmp, name), frames[i]);
		}
		await execFileAsync(
			"ffmpeg",
			[
				"-y",
				"-framerate",
				String(fps),
				"-i",
				join(tmp, "f%05d.jpg"),
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
			{ timeout: 180_000 },
		);
		if (!existsSync(mp4Path) || statSync(mp4Path).size < 1024) {
			return { ok: false, error: "ffmpeg zwrócił puste MP4", frameCount: frames.length };
		}
		return { ok: true, path: mp4Path, frameCount: frames.length };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? `ffmpeg: ${err.message}` : "ffmpeg fail",
			frameCount: frames.length,
		};
	} finally {
		try {
			rmSync(tmp, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
}

export function ensureDir(dir) {
	mkdirSync(dir, { recursive: true });
}
