/** Rozszerzony monitoring FPS / freeze / hitch na czas raportów. */

const MAX = 240;
const frameMs: number[] = [];
let last = 0;

let hitchCount = 0; // > 50ms
let severeHitchCount = 0; // > 100ms
let freezeCount = 0; // > 250ms gap
let longestFrameMs = 0;
let matchStartMs = 0;

const HITCH_MS = 50;
const SEVERE_MS = 100;
const FREEZE_MS = 250;

export function resetFrameStats(): void {
	frameMs.length = 0;
	last = 0;
	hitchCount = 0;
	severeHitchCount = 0;
	freezeCount = 0;
	longestFrameMs = 0;
	matchStartMs = performance.now();
}

export function noteFrameTime(nowMs: number): void {
	if (last > 0) {
		const dt = nowMs - last;
		if (dt > 0 && dt < 5000) {
			frameMs.push(dt);
			if (frameMs.length > MAX) frameMs.splice(0, frameMs.length - MAX);
			if (dt > longestFrameMs) longestFrameMs = dt;
			if (dt >= FREEZE_MS) freezeCount++;
			else if (dt >= SEVERE_MS) severeHitchCount++;
			else if (dt >= HITCH_MS) hitchCount++;
		}
	}
	last = nowMs;
}

export function getFrameStatsSummary(): {
	samples: number;
	avgFps: number | null;
	avgFrameMs: number | null;
	maxFrameMs: number | null;
	p95FrameMs: number | null;
	hitchCount: number;
	severeHitchCount: number;
	freezeCount: number;
	longestFrameMs: number;
	matchElapsedSec: number | null;
} {
	const elapsed =
		matchStartMs > 0
			? Math.round(((performance.now() - matchStartMs) / 1000) * 10) / 10
			: null;
	if (frameMs.length === 0) {
		return {
			samples: 0,
			avgFps: null,
			avgFrameMs: null,
			maxFrameMs: null,
			p95FrameMs: null,
			hitchCount,
			severeHitchCount,
			freezeCount,
			longestFrameMs: Math.round(longestFrameMs * 10) / 10,
			matchElapsedSec: elapsed,
		};
	}
	const sorted = [...frameMs].sort((a, b) => a - b);
	const sum = sorted.reduce((a, b) => a + b, 0);
	const avg = sum / sorted.length;
	const p95 =
		sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
	return {
		samples: sorted.length,
		avgFps: Math.round(1000 / avg),
		avgFrameMs: Math.round(avg * 10) / 10,
		maxFrameMs: Math.round(sorted[sorted.length - 1]! * 10) / 10,
		p95FrameMs: Math.round(p95 * 10) / 10,
		hitchCount,
		severeHitchCount,
		freezeCount,
		longestFrameMs: Math.round(longestFrameMs * 10) / 10,
		matchElapsedSec: elapsed,
	};
}
