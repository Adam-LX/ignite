/** Proceduralne SFX menu — miękkie, cyfrowe (bez stuków i bez wysokich pisków). */

export type MenuUiCue =
	| "nav"
	| "navSoft"
	| "spin"
	| "launch"
	| "hover"
	| "confirm";

const ACCENT_TONE: Record<string, { start: number; end: number }> = {
	duel: { start: 468, end: 392 },
	team: { start: 428, end: 358 },
	chaos: { start: 398, end: 334 },
	ignition: { start: 368, end: 308 },
};

function accentTone(accent?: string): { start: number; end: number } {
	return ACCENT_TONE[accent ?? "team"] ?? ACCENT_TONE.team;
}

function softTone(
	ctx: AudioContext,
	out: AudioNode,
	now: number,
	startHz: number,
	endHz: number,
	attackSec: number,
	holdSec: number,
	releaseSec: number,
	volume: number,
	echo?: AudioNode,
	echoMix = 0.1,
): void {
	const dur = attackSec + holdSec + releaseSec;
	const t0 = now;
	const tPeak = t0 + attackSec;
	const tEnd = t0 + dur;

	const oscA = ctx.createOscillator();
	const oscB = ctx.createOscillator();
	const gain = ctx.createGain();
	const filter = ctx.createBiquadFilter();

	oscA.type = "sine";
	oscB.type = "sine";
	oscA.frequency.setValueAtTime(startHz, t0);
	oscA.frequency.exponentialRampToValueAtTime(
		Math.max(80, endHz),
		tEnd,
	);
	oscB.frequency.setValueAtTime(startHz * 1.006, t0);
	oscB.frequency.exponentialRampToValueAtTime(
		Math.max(80, endHz * 1.006),
		tEnd,
	);

	filter.type = "lowpass";
	filter.frequency.setValueAtTime(1800, t0);
	filter.frequency.exponentialRampToValueAtTime(900, tEnd);
	filter.Q.value = 0.35;

	gain.gain.setValueAtTime(0, t0);
	gain.gain.linearRampToValueAtTime(volume, tPeak);
	gain.gain.setValueAtTime(volume * 0.82, tPeak + holdSec);
	gain.gain.exponentialRampToValueAtTime(0.0001, tEnd);

	oscA.connect(filter);
	oscB.connect(filter);
	filter.connect(gain);
	gain.connect(out);
	if (echo) {
		const send = ctx.createGain();
		send.gain.value = echoMix;
		gain.connect(send);
		send.connect(echo);
	}

	oscA.start(t0);
	oscB.start(t0);
	oscA.stop(tEnd + 0.01);
	oscB.stop(tEnd + 0.01);
}

function softAir(
	ctx: AudioContext,
	out: AudioNode,
	now: number,
	durSec: number,
	startHz: number,
	endHz: number,
	volume: number,
	echo?: AudioNode,
): void {
	const len = Math.floor(ctx.sampleRate * durSec);
	const buf = ctx.createBuffer(1, len, ctx.sampleRate);
	const data = buf.getChannelData(0);
	for (let i = 0; i < len; i++) {
		const t = i / len;
		const env = Math.sin(Math.PI * t) ** 1.6;
		data[i] = (Math.random() * 2 - 1) * env * 0.35;
	}
	const src = ctx.createBufferSource();
	src.buffer = buf;
	const filter = ctx.createBiquadFilter();
	filter.type = "bandpass";
	filter.frequency.setValueAtTime(startHz, now);
	filter.frequency.exponentialRampToValueAtTime(Math.max(120, endHz), now + durSec);
	filter.Q.value = 0.45;
	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0, now);
	gain.gain.linearRampToValueAtTime(volume, now + 0.012);
	gain.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
	src.connect(filter);
	filter.connect(gain);
	gain.connect(out);
	if (echo) {
		const send = ctx.createGain();
		send.gain.value = 0.08;
		gain.connect(send);
		send.connect(echo);
	}
	src.start(now);
	src.stop(now + durSec + 0.01);
}

function playNavBlip(
	ctx: AudioContext,
	out: AudioNode,
	now: number,
	accent: string | undefined,
	volume: number,
	soft: boolean,
	echo?: AudioNode,
): void {
	const { start, end } = accentTone(accent);
	softTone(
		ctx,
		out,
		now,
		start,
		end,
		soft ? 0.008 : 0.01,
		soft ? 0.012 : 0.018,
		soft ? 0.038 : 0.048,
		volume,
		echo,
		soft ? 0.06 : 0.08,
	);
}

function playSpinWhoosh(
	ctx: AudioContext,
	out: AudioNode,
	now: number,
	accent: string | undefined,
	echo?: AudioNode,
): void {
	const { start, end } = accentTone(accent);
	softTone(ctx, out, now, start * 0.88, end * 1.35, 0.014, 0.04, 0.14, 0.07, echo, 0.12);
	softAir(ctx, out, now + 0.006, 0.18, 420, 1180, 0.045, echo);
}

function playLaunch(ctx: AudioContext, out: AudioNode, now: number, echo?: AudioNode): void {
	softTone(ctx, out, now, 220, 310, 0.016, 0.035, 0.12, 0.11, echo, 0.14);
	softTone(ctx, out, now + 0.022, 340, 480, 0.012, 0.02, 0.1, 0.07, echo, 0.1);
	softAir(ctx, out, now + 0.01, 0.16, 280, 860, 0.04, echo);
}

function playHover(ctx: AudioContext, out: AudioNode, now: number, accent?: string): void {
	const { start, end } = accentTone(accent);
	softTone(ctx, out, now, start * 1.04, end * 1.02, 0.006, 0.004, 0.022, 0.022, undefined);
}

function playConfirm(
	ctx: AudioContext,
	out: AudioNode,
	now: number,
	accent: string | undefined,
	echo?: AudioNode,
): void {
	const { start } = accentTone(accent);
	softTone(ctx, out, now, start, start * 1.12, 0.01, 0.016, 0.055, 0.065, echo);
	softTone(ctx, out, now + 0.018, start * 1.22, start * 1.28, 0.008, 0.012, 0.05, 0.045, echo);
}

export function playMenuUiCue(
	ctx: AudioContext,
	out: AudioNode,
	cue: MenuUiCue,
	opts?: { accent?: string; echo?: AudioNode },
): void {
	if (ctx.state === "suspended") return;
	const now = ctx.currentTime;
	const accent = opts?.accent;
	const echo = opts?.echo;

	switch (cue) {
		case "nav":
			playNavBlip(ctx, out, now, accent, 0.065, false, echo);
			break;
		case "navSoft":
			playNavBlip(ctx, out, now, accent, 0.038, true, echo);
			break;
		case "spin":
			playSpinWhoosh(ctx, out, now, accent, echo);
			break;
		case "launch":
			playLaunch(ctx, out, now, echo);
			break;
		case "hover":
			playHover(ctx, out, now, accent);
			break;
		case "confirm":
			playConfirm(ctx, out, now, accent, echo);
			break;
	}
}
