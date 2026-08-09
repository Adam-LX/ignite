#!/usr/bin/env node
/**
 * Latest F9 clip → frames + summary for humans/agents.
 * Usage: npm run clip:review
 */
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIP_DIR = join(ROOT, "data/gameplay-clips");
const FRAMES_DIR = join(CLIP_DIR, "_frames");
const META_PATH = join(CLIP_DIR, "latest.json");
const FRAME_COUNT = 6;

function die(msg, code = 1) {
	console.error(`[clip:review] ${msg}`);
	process.exit(code);
}

function fmtBytes(n) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
	return `${(n / 1024 ** 2).toFixed(1)} MiB`;
}

function summarizeInputs(inputsPath) {
	if (!existsSync(inputsPath)) return null;
	let raw;
	try {
		raw = JSON.parse(readFileSync(inputsPath, "utf8"));
	} catch {
		return { error: "invalid JSON" };
	}
	const samples = Array.isArray(raw)
		? raw
		: Array.isArray(raw.samples)
			? raw.samples
			: Array.isArray(raw.frames)
				? raw.frames
				: [];
	if (!samples.length) {
		return { samples: 0 };
	}
	const durationMs =
		typeof samples[samples.length - 1]?.t === "number"
			? samples[samples.length - 1].t
			: null;
	let boost = 0;
	let jump = 0;
	let throttleSum = 0;
	let throttleN = 0;
	for (const s of samples) {
		if (s.boost) boost++;
		if (s.jump) jump++;
		if (typeof s.throttle === "number") {
			throttleSum += Math.abs(s.throttle);
			throttleN++;
		}
	}
	const mid = samples[Math.floor(samples.length / 2)];
	return {
		samples: samples.length,
		durationMs,
		boostFrac: boost / samples.length,
		jumpFrac: jump / samples.length,
		avgAbsThrottle: throttleN ? throttleSum / throttleN : null,
		midSample: mid
			? {
					t: mid.t,
					throttle: mid.throttle,
					steer: mid.steer,
					boost: !!mid.boost,
					jump: !!mid.jump,
					gamepad: !!mid.gamepad,
				}
			: null,
	};
}

function extractFrames(videoPath) {
	mkdirSync(FRAMES_DIR, { recursive: true });
	for (const f of readdirSync(FRAMES_DIR)) {
		if (f.startsWith("review-") || f.startsWith("frame-")) {
			rmSync(join(FRAMES_DIR, f), { force: true });
		}
	}

	let duration = 0;
	try {
		const out = execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-show_entries",
				"format=duration",
				"-of",
				"default=noprint_wrappers=1:nokey=1",
				videoPath,
			],
			{ encoding: "utf8" },
		).trim();
		duration = Number(out) || 0;
	} catch {
		die("ffprobe failed — is ffmpeg installed?");
	}

	const pattern = join(FRAMES_DIR, "review-%02d.jpg");
	const fps =
		duration > 0.5 ? Math.max(0.2, (FRAME_COUNT - 1) / duration) : 1;
	try {
		execFileSync(
			"ffmpeg",
			[
				"-y",
				"-i",
				videoPath,
				"-vf",
				`fps=${fps.toFixed(4)}`,
				"-frames:v",
				String(FRAME_COUNT),
				"-q:v",
				"3",
				pattern,
			],
			{ stdio: ["ignore", "ignore", "pipe"] },
		);
	} catch (e) {
		die(`ffmpeg extract failed: ${e?.stderr?.toString?.() || e}`);
	}

	const frames = readdirSync(FRAMES_DIR)
		.filter((f) => f.startsWith("review-") && f.endsWith(".jpg"))
		.sort()
		.map((f) => join(FRAMES_DIR, f));
	return { duration, frames };
}

function main() {
	if (!existsSync(META_PATH)) {
		die(`brak ${META_PATH} — nagraj F9 w meczu`);
	}
	const meta = JSON.parse(readFileSync(META_PATH, "utf8"));
	const videoName = meta.video || "latest.mp4";
	const videoPath = join(CLIP_DIR, videoName);
	if (!existsSync(videoPath)) {
		const webm = join(CLIP_DIR, "latest.webm");
		if (existsSync(webm)) {
			die(`brak ${videoName}, jest latest.webm — ustaw meta.video`);
		}
		die(`brak wideo: ${videoPath}`);
	}

	const inputsName = meta.inputs || "latest.inputs.json";
	const inputsPath = join(CLIP_DIR, inputsName);
	const inputSummary = summarizeInputs(inputsPath);
	const { duration, frames } = extractFrames(videoPath);
	const vstat = statSync(videoPath);

	const summary = {
		updatedAt: meta.updatedAt ?? null,
		baseName: meta.baseName ?? null,
		video: videoPath,
		videoBytes: vstat.size,
		durationSec: duration,
		frames,
		inputs: inputSummary,
		videosCopy: meta.videosCopy ?? null,
		hint: "Agent: Read frames in data/gameplay-clips/_frames/review-*.jpg",
	};

	const summaryPath = join(CLIP_DIR, "latest.review.json");
	writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

	console.log("=== Ignite clip:review ===");
	console.log(`video:    ${videoPath} (${fmtBytes(vstat.size)})`);
	console.log(`duration: ${duration.toFixed(2)} s`);
	console.log(`updated:  ${meta.updatedAt ?? "?"}`);
	console.log(`base:     ${meta.baseName ?? "?"}`);
	if (meta.videosCopy) console.log(`copy:     ${meta.videosCopy}`);
	if (inputSummary) {
		console.log(
			`inputs:   ${inputSummary.samples ?? 0} samples` +
				(inputSummary.durationMs != null
					? `, ~${(inputSummary.durationMs / 1000).toFixed(1)}s log`
					: ""),
		);
		if (inputSummary.boostFrac != null) {
			console.log(
				`  boost ${(inputSummary.boostFrac * 100).toFixed(0)}% · jump ${(inputSummary.jumpFrac * 100).toFixed(0)}%` +
					(inputSummary.avgAbsThrottle != null
						? ` · |throttle|≈${inputSummary.avgAbsThrottle.toFixed(2)}`
						: ""),
			);
		}
		if (inputSummary.midSample) {
			const m = inputSummary.midSample;
			console.log(
				`  mid t=${m.t} thr=${m.throttle} str=${m.steer} boost=${m.boost} jump=${m.jump} pad=${m.gamepad}`,
			);
		}
	} else {
		console.log("inputs:   (brak)");
	}
	console.log(`frames:   ${frames.length} → ${FRAMES_DIR}/review-*.jpg`);
	for (const f of frames) console.log(`  - ${f}`);
	console.log(`summary:  ${summaryPath}`);
}

main();
