/**
 * Krótki clip z canvasu gry (max 30 s) + overlay inputu (przyciski).
 * Hotkey: F9 (toggle).
 *
 * Capture: JPEG klatki z present canvas (toDataURL) — NIE MediaRecorder
 * (na NVIDIA/Wayland dawał czarne MP4 mimo OK duration).
 * Zapis: pakiet IGN F → ffmpeg → ~/Wideo/*.mp4
 * Electron: fallback capturePage gdy canvas readback czarny.
 */

import { assetUrl } from "../core/assetUrl";

const MAX_MS = 30_000;
const WATERMARK_TEXT = "REAL GAMEPLAY FOOTAGE";
const LOGO_URL = assetUrl("assets/ignite_logo.png");
const INPUT_LOG_HZ = 20;
const CAPTURE_FPS = 10;
const MAX_CAPTURE_W = 1280;
const JPEG_QUALITY = 0.72;
const IGNITE_FRAMES_MIME = "application/x-ignite-frames";

export type ClipInputSample = {
	t: number;
	w: boolean;
	a: boolean;
	s: boolean;
	d: boolean;
	boost: boolean;
	jump: boolean;
	drift: boolean;
	airRollL: boolean;
	airRollR: boolean;
	recover: boolean;
	throttle: number;
	steer: number;
	roll: number;
	gamepad: boolean;
	lmb: boolean;
	rmb: boolean;
};

export type ClipInputProvider = () => Omit<ClipInputSample, "t"> | null;

export type ClipRecorderStatus =
	| { kind: "idle" }
	| { kind: "recording"; elapsedMs: number; maxMs: number }
	| { kind: "saving" }
	| { kind: "saved"; path: string }
	| { kind: "error"; message: string };

type StatusListener = (status: ClipRecorderStatus) => void;

type DesktopClipBridge = {
	saveGameplayClip?: (payload: {
		bytes: ArrayBuffer;
		baseName: string;
		inputLogJson?: string;
		mime?: string;
	}) => Promise<{ ok: boolean; path?: string; error?: string }>;
	/** Zrzut tego co widać w oknie (compositor) — omija czarny readback canvas. */
	captureGameplayFrame?: () => Promise<ArrayBuffer | null>;
};

function desktopBridge(): DesktopClipBridge | undefined {
	return (window as unknown as { __igniteDesktop?: DesktopClipBridge })
		.__igniteDesktop;
}

function loadLogo(): Promise<HTMLImageElement | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.decoding = "async";
		img.onload = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = LOGO_URL;
	});
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
	const comma = dataUrl.indexOf(",");
	const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function packFrames(frames: Uint8Array[], fps: number): ArrayBuffer {
	const magic = new TextEncoder().encode("IGNF");
	let total = 4 + 8;
	for (const f of frames) total += 4 + f.byteLength;
	const buf = new ArrayBuffer(total);
	const view = new DataView(buf);
	const u8 = new Uint8Array(buf);
	u8.set(magic, 0);
	view.setUint16(4, 1, true);
	view.setUint16(6, Math.max(1, Math.min(60, fps | 0)), true);
	view.setUint32(8, frames.length, true);
	let off = 12;
	for (const f of frames) {
		view.setUint32(off, f.byteLength, true);
		off += 4;
		u8.set(f, off);
		off += f.byteLength;
	}
	return buf;
}

export class GameplayClipRecorder {
	private startedAt = 0;
	private maxTimer: number | null = null;
	private tickTimer: number | null = null;
	private listeners = new Set<StatusListener>();
	private status: ClipRecorderStatus = { kind: "idle" };
	private composite: HTMLCanvasElement | null = null;
	private compositeCtx: CanvasRenderingContext2D | null = null;
	private logo: HTMLImageElement | null = null;
	private sourceCanvas: HTMLCanvasElement | null = null;
	private inputProvider: ClipInputProvider | null = null;
	private inputLog: ClipInputSample[] = [];
	private lastInputLogAt = 0;
	private lastSample: ClipInputSample | null = null;
	private lastPaintAt = 0;
	private frames: Uint8Array[] = [];
	private blackStreak = 0;
	private useScreenCapture = false;
	private frameInFlight = false;
	/** Gdy capturePage jeszcze leci — nie gub slotu 10 Hz (ciężkie bramki/GPU). */
	private pendingPaint = false;
	private abortedBlack = false;

	constructor(
		private readonly getCanvas: () => HTMLCanvasElement | null,
		private readonly prepareSource: (() => void) | null = null,
	) {}

	setInputProvider(provider: ClipInputProvider | null): void {
		this.inputProvider = provider;
	}

	onFrameRendered(): void {
		if (!this.isRecording()) return;
		const now = performance.now();
		const elapsedMs = now - this.startedAt;
		this.sampleInput(elapsedMs);
		if (now - this.lastPaintAt < 1000 / CAPTURE_FPS - 0.5) return;
		if (this.frameInFlight) {
			this.pendingPaint = true;
			return;
		}
		this.lastPaintAt = now;
		void this.paintFrame();
	}

	onStatus(listener: StatusListener): () => void {
		this.listeners.add(listener);
		listener(this.status);
		return () => this.listeners.delete(listener);
	}

	getStatus(): ClipRecorderStatus {
		return this.status;
	}

	isRecording(): boolean {
		return this.status.kind === "recording";
	}

	toggle(): void {
		if (this.isRecording() || this.status.kind === "saving") {
			this.stop();
			return;
		}
		void this.start();
	}

	async start(): Promise<void> {
		if (this.isRecording() || this.status.kind === "saving") return;

		const canvas = this.getCanvas();
		if (!canvas || canvas.width < 2 || canvas.height < 2) {
			this.setStatus({ kind: "error", message: "Brak canvasu do nagrania" });
			return;
		}

		this.logo = await loadLogo();
		this.sourceCanvas = canvas;
		const scale = Math.min(1, MAX_CAPTURE_W / canvas.width);
		const cw = Math.max(2, Math.round(canvas.width * scale));
		const ch = Math.max(2, Math.round(canvas.height * scale));
		/** Parzyste wymiary — x264 yuv420. */
		const ew = cw - (cw % 2);
		const eh = ch - (ch % 2);

		this.composite = document.createElement("canvas");
		this.composite.width = ew;
		this.composite.height = eh;
		this.composite.style.cssText =
			"position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:2147483646";
		document.body.appendChild(this.composite);
		this.compositeCtx = this.composite.getContext("2d", {
			alpha: false,
			desynchronized: false,
			willReadFrequently: true,
		});
		if (!this.compositeCtx) {
			this.setStatus({ kind: "error", message: "Brak kontekstu 2D" });
			return;
		}

		this.compositeCtx.fillStyle = "#0b1424";
		this.compositeCtx.fillRect(0, 0, ew, eh);

		this.frames = [];
		this.inputLog = [];
		this.lastInputLogAt = 0;
		this.lastSample = null;
		this.lastPaintAt = 0;
		this.blackStreak = 0;
		this.useScreenCapture = false;
		this.frameInFlight = false;
		this.pendingPaint = false;
		this.abortedBlack = false;

		this.setStatus({
			kind: "recording",
			elapsedMs: 0,
			maxMs: MAX_MS,
		});
		this.startedAt = performance.now();
		await this.paintFrame();

		this.tickTimer = window.setInterval(() => {
			if (!this.isRecording()) return;
			const elapsedMs = performance.now() - this.startedAt;
			this.setStatus({ kind: "recording", elapsedMs, maxMs: MAX_MS });
			if (elapsedMs >= MAX_MS) this.stop();
		}, 200);

		this.maxTimer = window.setTimeout(() => this.stop(), MAX_MS + 50);
	}

	stop(): void {
		if (this.maxTimer != null) {
			window.clearTimeout(this.maxTimer);
			this.maxTimer = null;
		}
		if (this.tickTimer != null) {
			window.clearInterval(this.tickTimer);
			this.tickTimer = null;
		}
		if (this.status.kind !== "recording") {
			this.teardown();
			return;
		}
		this.setStatus({ kind: "saving" });
		void this.finishSave();
	}

	private sampleInput(elapsedMs: number): void {
		const raw = this.inputProvider?.() ?? null;
		if (!raw) {
			this.lastSample = null;
			return;
		}
		const sample: ClipInputSample = { t: Math.round(elapsedMs), ...raw };
		this.lastSample = sample;
		const minDt = 1000 / INPUT_LOG_HZ;
		if (elapsedMs - this.lastInputLogAt >= minDt - 0.5) {
			this.inputLog.push(sample);
			this.lastInputLogAt = elapsedMs;
		}
	}

	/** Średnia luma z kilku punktów — wykrywa czarny readback. */
	private sampleLuma(): number {
		const ctx = this.compositeCtx;
		const dst = this.composite;
		if (!ctx || !dst) return 0;
		const pts: [number, number][] = [
			[0.25, 0.3],
			[0.5, 0.5],
			[0.75, 0.45],
			[0.4, 0.7],
			[0.65, 0.65],
		];
		let sum = 0;
		for (const [fx, fy] of pts) {
			const x = Math.min(dst.width - 1, Math.max(0, Math.floor(dst.width * fx)));
			const y = Math.min(dst.height - 1, Math.max(0, Math.floor(dst.height * fy)));
			const d = ctx.getImageData(x, y, 1, 1).data;
			sum += d[0] * 0.2126 + d[1] * 0.7152 + d[2] * 0.0722;
		}
		return sum / pts.length;
	}

	private async paintFrame(): Promise<void> {
		if (this.abortedBlack) return;
		this.prepareSource?.();
		const src = this.getCanvas() ?? this.sourceCanvas;
		const ctx = this.compositeCtx;
		const dst = this.composite;
		if (!src || !ctx || !dst) return;
		if (src.width < 2 || src.height < 2) return;

		this.sourceCanvas = src;
		ctx.save();
		ctx.globalCompositeOperation = "copy";
		try {
			ctx.drawImage(src, 0, 0, dst.width, dst.height);
		} catch {
			ctx.fillStyle = "#0b1424";
			ctx.fillRect(0, 0, dst.width, dst.height);
		}
		ctx.globalCompositeOperation = "source-over";
		ctx.restore();

		/** Luma PRZED overlay — czerwone REC fałszowałoby „nie czarne”. */
		const luma = this.sampleLuma();
		const looksBlack = luma < 14;
		const cap = desktopBridge()?.captureGameplayFrame;

		/**
		 * Canvas JPEG synchronicznie (10 Hz). capturePage tylko gdy present
		 * jest czarny — inaczej IPC/GPU żre sloty → „Za mało klatek”.
		 */
		if (looksBlack && cap) {
			this.blackStreak++;
			if (this.frameInFlight) {
				this.pendingPaint = true;
				return;
			}
			this.frameInFlight = true;
			this.useScreenCapture = true;
			try {
				const ab = await cap();
				if (ab && ab.byteLength > 800) {
					this.frames.push(new Uint8Array(ab));
					this.blackStreak = 0;
				} else if (this.blackStreak >= 8 && this.frames.length === 0) {
					this.abortedBlack = true;
					this.stopWithError(
						"Capture czarny — hard-reload Electron i F9",
					);
					return;
				}
			} catch {
				if (this.blackStreak >= 8 && this.frames.length === 0) {
					this.abortedBlack = true;
					this.stopWithError("capturePage fail — hard-reload Electron");
					return;
				}
			} finally {
				this.frameInFlight = false;
				if (this.pendingPaint && this.isRecording()) {
					this.pendingPaint = false;
					this.lastPaintAt = performance.now();
					void this.paintFrame();
				}
			}
			return;
		}

		if (looksBlack) {
			this.blackStreak++;
			if (this.blackStreak >= 5 && this.frames.length === 0) {
				this.abortedBlack = true;
				this.stopWithError(
					"Capture czarny w przeglądarce — odpal Electron i F9",
				);
				return;
			}
			return;
		}

		this.blackStreak = 0;
		this.drawRecOverlay(ctx, dst.width, dst.height);
		this.drawWatermark(ctx, dst.width, dst.height);
		if (this.lastSample) {
			this.drawInputHud(ctx, dst.width, dst.height, this.lastSample);
		}
		this.pushCanvasJpeg(ctx, dst);
	}

	private pushCanvasJpeg(
		_ctx: CanvasRenderingContext2D,
		dst: HTMLCanvasElement,
	): void {
		try {
			const dataUrl = dst.toDataURL("image/jpeg", JPEG_QUALITY);
			const bytes = dataUrlToBytes(dataUrl);
			if (bytes.byteLength > 400) this.frames.push(bytes);
		} catch {
			/* skip frame */
		}
	}

	private stopWithError(message: string): void {
		if (this.maxTimer != null) {
			window.clearTimeout(this.maxTimer);
			this.maxTimer = null;
		}
		if (this.tickTimer != null) {
			window.clearInterval(this.tickTimer);
			this.tickTimer = null;
		}
		this.teardown();
		this.setStatus({ kind: "error", message });
	}

	private drawRecOverlay(
		ctx: CanvasRenderingContext2D,
		w: number,
		h: number,
	): void {
		const pad = Math.max(16, Math.round(w * 0.02));
		const fontPx = Math.max(28, Math.round(h * 0.055));
		const blinkOn = Math.floor(performance.now() / 450) % 2 === 0;
		const elapsed = this.startedAt
			? Math.min(MAX_MS, performance.now() - this.startedAt)
			: 0;
		const sec = Math.ceil(elapsed / 1000);
		const label = `● REC  ${sec}s / 30s`;

		ctx.save();
		ctx.font = `900 ${fontPx}px Orbitron, ui-sans-serif, system-ui, sans-serif`;
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
		const tw = ctx.measureText(label).width;
		const boxPadX = Math.round(fontPx * 0.45);
		const boxPadY = Math.round(fontPx * 0.28);
		const boxW = tw + boxPadX * 2;
		const boxH = fontPx + boxPadY * 2;
		ctx.fillStyle = "rgba(140, 0, 18, 0.88)";
		ctx.strokeStyle = blinkOn ? "#ff6a7a" : "rgba(255,120,140,0.45)";
		ctx.lineWidth = 3;
		ctx.beginPath();
		if (typeof ctx.roundRect === "function") {
			ctx.roundRect(pad, pad, boxW, boxH, 10);
		} else {
			ctx.rect(pad, pad, boxW, boxH);
		}
		ctx.fill();
		ctx.stroke();
		ctx.globalAlpha = blinkOn ? 1 : 0.55;
		ctx.lineWidth = Math.max(3, fontPx * 0.08);
		ctx.strokeStyle = "rgba(0,0,0,0.75)";
		ctx.fillStyle = "#ffffff";
		ctx.strokeText(label, pad + boxPadX, pad + boxPadY);
		ctx.fillText(label, pad + boxPadX, pad + boxPadY);
		ctx.restore();
	}

	private drawWatermark(
		ctx: CanvasRenderingContext2D,
		w: number,
		h: number,
	): void {
		const pad = Math.max(12, Math.round(w * 0.012));
		const logoH = Math.max(36, Math.round(h * 0.08));
		const blinkOn = Math.floor(performance.now() / 550) % 2 === 0;
		const fontPx = Math.max(14, Math.round(h * 0.028));
		const textGap = Math.round(fontPx * 0.45);

		let logoBottom = pad + logoH;
		if (this.logo && this.logo.naturalWidth > 0) {
			const aspect = this.logo.naturalWidth / this.logo.naturalHeight;
			const logoW = logoH * aspect;
			ctx.save();
			ctx.globalAlpha = 0.82;
			ctx.drawImage(this.logo, w - pad - logoW, pad, logoW, logoH);
			ctx.restore();
			logoBottom = pad + logoH;
		}

		ctx.save();
		ctx.font = `900 ${fontPx}px Orbitron, sans-serif`;
		ctx.textAlign = "right";
		ctx.textBaseline = "top";
		ctx.globalAlpha = blinkOn ? 0.95 : 0.28;
		ctx.lineWidth = Math.max(2, fontPx * 0.12);
		ctx.strokeStyle = "rgba(0,0,0,0.85)";
		ctx.fillStyle = "#ffb347";
		const tx = w - pad;
		const ty = logoBottom + textGap;
		ctx.strokeText(WATERMARK_TEXT, tx, ty);
		ctx.fillText(WATERMARK_TEXT, tx, ty);
		ctx.restore();
	}

	private drawInputHud(
		ctx: CanvasRenderingContext2D,
		w: number,
		h: number,
		s: ClipInputSample,
	): void {
		const pad = Math.max(10, Math.round(w * 0.012));
		const key = Math.max(28, Math.round(h * 0.038));
		const gap = Math.max(4, Math.round(key * 0.14));
		const panelW = key * 4 + gap * 3 + pad * 2;
		const panelH = key * 3 + gap * 2 + pad * 2 + Math.round(key * 0.85);
		const x0 = pad;
		const y0 = h - pad - panelH;

		ctx.save();
		ctx.fillStyle = "rgba(4, 8, 14, 0.72)";
		ctx.strokeStyle = "rgba(120, 200, 255, 0.35)";
		ctx.lineWidth = 2;
		ctx.beginPath();
		if (typeof ctx.roundRect === "function") {
			ctx.roundRect(x0, y0, panelW, panelH, 10);
		} else {
			ctx.rect(x0, y0, panelW, panelH);
		}
		ctx.fill();
		ctx.stroke();

		const drawKey = (
			label: string,
			on: boolean,
			cx: number,
			cy: number,
			kw = key,
			kh = key,
		) => {
			ctx.fillStyle = on ? "rgba(255, 180, 40, 0.95)" : "rgba(30, 40, 55, 0.9)";
			ctx.strokeStyle = on ? "#ffe090" : "rgba(160, 180, 210, 0.35)";
			ctx.lineWidth = on ? 2.5 : 1.5;
			ctx.beginPath();
			if (typeof ctx.roundRect === "function") {
				ctx.roundRect(cx, cy, kw, kh, 6);
			} else {
				ctx.rect(cx, cy, kw, kh);
			}
			ctx.fill();
			ctx.stroke();
			ctx.fillStyle = on ? "#1a1000" : "rgba(220, 230, 245, 0.75)";
			ctx.font = `800 ${Math.round(kh * 0.38)}px ui-sans-serif, system-ui, sans-serif`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(label, cx + kw / 2, cy + kh / 2 + 1);
		};

		const row1 = y0 + pad;
		const row2 = row1 + key + gap;
		const col0 = x0 + pad;
		drawKey("Q", s.airRollL, col0, row1);
		drawKey("W", s.w, col0 + key + gap, row1);
		drawKey("E", s.airRollR, col0 + (key + gap) * 2, row1);
		drawKey("A", s.a, col0, row2);
		drawKey("S", s.s, col0 + key + gap, row2);
		drawKey("D", s.d, col0 + (key + gap) * 2, row2);

		const actY = row2 + key + gap;
		const actW = Math.round(key * 1.15);
		drawKey("BOOST", s.boost, col0, actY, actW, Math.round(key * 0.72));
		drawKey(
			"JUMP",
			s.jump,
			col0 + actW + gap,
			actY,
			actW,
			Math.round(key * 0.72),
		);
		drawKey(
			"DRIFT",
			s.drift,
			col0 + (actW + gap) * 2,
			actY,
			actW,
			Math.round(key * 0.72),
		);

		const infoY = actY + Math.round(key * 0.72) + gap + 2;
		ctx.font = `700 ${Math.max(11, Math.round(key * 0.28))}px ui-monospace, monospace`;
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
		ctx.fillStyle = "rgba(200, 220, 255, 0.88)";
		const bits = [
			s.lmb ? "LMB" : "",
			s.rmb ? "RMB" : "",
			s.recover ? "R" : "",
			s.gamepad ? "PAD" : "KBM",
		].filter(Boolean);
		ctx.fillText(bits.join(" · ") || "—", col0, infoY);

		const barX = col0 + (key + gap) * 3 + gap;
		const barW = Math.max(8, Math.round(key * 0.28));
		const barH = key * 2 + gap;
		const drawAxis = (val: number, bx: number, label: string) => {
			ctx.fillStyle = "rgba(20, 28, 40, 0.95)";
			ctx.fillRect(bx, row1, barW, barH);
			ctx.strokeStyle = "rgba(160,180,210,0.35)";
			ctx.strokeRect(bx, row1, barW, barH);
			const mid = row1 + barH / 2;
			const mag = Math.min(1, Math.abs(val)) * (barH / 2 - 2);
			ctx.fillStyle = val >= 0 ? "#5dff9a" : "#ff6b6b";
			if (val >= 0) ctx.fillRect(bx + 2, mid - mag, barW - 4, mag);
			else ctx.fillRect(bx + 2, mid, barW - 4, mag);
			ctx.fillStyle = "rgba(220,230,245,0.7)";
			ctx.font = `700 ${Math.max(9, Math.round(key * 0.22))}px ui-sans-serif`;
			ctx.textAlign = "center";
			ctx.fillText(label, bx + barW / 2, row1 + barH + 10);
		};
		drawAxis(s.throttle, barX, "T");
		drawAxis(-s.steer, barX + barW + gap, "Y");
		drawAxis(s.roll, barX + (barW + gap) * 2, "R");

		ctx.restore();
	}

	private buildInputLogJson(): string {
		return JSON.stringify(
			{
				version: 1,
				hz: INPUT_LOG_HZ,
				durationMs: this.inputLog.at(-1)?.t ?? 0,
				samples: this.inputLog,
				capture: this.useScreenCapture ? "screen" : "canvas-jpeg",
				frames: this.frames.length,
			},
			null,
			2,
		);
	}

	private async finishSave(): Promise<void> {
		/** Daj ostatniej async klatce (capturePage) domknąć. */
		for (let i = 0; i < 25 && this.frameInFlight; i++) {
			await new Promise((r) => window.setTimeout(r, 40));
		}
		await new Promise((r) => window.setTimeout(r, 60));
		await this.paintFrame();

		const frames = this.frames;
		const inputLogJson =
			this.inputLog.length > 0 ? this.buildInputLogJson() : undefined;
		this.frames = [];
		this.teardown();

		if (frames.length < 3) {
			const msg = `Za mało klatek (${frames.length}) — nagraj ≥2 s`;
			this.reportClipError(msg);
			this.setStatus({ kind: "error", message: msg });
			return;
		}

		const stamp = new Date()
			.toISOString()
			.replace(/[:.]/g, "-")
			.slice(0, 19);
		const baseName = `ignite-clip-${stamp}`;
		const bytes = packFrames(frames, CAPTURE_FPS);
		const markSaved = (path: string) => {
			this.setStatus({ kind: "saved", path });
			window.setTimeout(() => {
				if (this.status.kind === "saved") {
					this.setStatus({ kind: "idle" });
				}
			}, 4500);
		};

		const tryVite = async (): Promise<string | null> => {
			try {
				const res = await fetch(
					`/__ignite/save-clip?name=${encodeURIComponent(baseName)}&mime=${encodeURIComponent(IGNITE_FRAMES_MIME)}`,
					{
						method: "POST",
						headers: { "Content-Type": "application/octet-stream" },
						body: bytes,
					},
				);
				const json = (await res.json()) as {
					ok?: boolean;
					path?: string;
					error?: string;
				};
				if (json.ok && inputLogJson) {
					try {
						await fetch(
							`/__ignite/save-clip-meta?name=${encodeURIComponent(baseName)}`,
							{
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: inputLogJson,
							},
						);
					} catch {
						/* meta opcjonalne */
					}
				}
				if (json.ok && json.path) return json.path;
				this.reportClipError(`vite: ${json.error ?? "Zapis MP4 nieudany"}`);
				return null;
			} catch (err) {
				this.reportClipError(
					`vite throw: ${err instanceof Error ? err.message : "fetch fail"}`,
				);
				return null;
			}
		};

		const tryElectron = async (): Promise<string | null> => {
			const save = desktopBridge()?.saveGameplayClip;
			if (!save) return null;
			try {
				const result = await save({
					bytes,
					baseName,
					inputLogJson,
					mime: IGNITE_FRAMES_MIME,
				});
				if (result.ok && result.path) return result.path;
				this.reportClipError(
					`electron: ${result.error ?? "Zapis MP4 nieudany"}`,
				);
				return null;
			} catch (err) {
				this.reportClipError(
					`electron throw: ${err instanceof Error ? err.message : "Zapis fail"}`,
				);
				return null;
			}
		};

		/** Dev (Vite URL): najpierw HTTP — duże IGNF nie giną w IPC. */
		const isDevHost = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
		const path = isDevHost
			? (await tryVite()) ?? (await tryElectron())
			: (await tryElectron()) ?? (await tryVite());

		if (path) {
			markSaved(path);
			return;
		}
		this.setStatus({
			kind: "error",
			message: "Zapis MP4 nieudany — patrz data/gameplay-clips/last-error.txt",
		});
	}

	/** Diagnostyka — agent / Adam widzi powód bez zgadywania. */
	private reportClipError(message: string): void {
		console.error("[ignite-clip]", message);
		try {
			void fetch("/__ignite/save-clip-error", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					at: new Date().toISOString(),
					message,
				}),
			});
		} catch {
			/* ignore */
		}
	}

	private teardown(): void {
		if (this.composite?.parentElement) {
			this.composite.parentElement.removeChild(this.composite);
		}
		this.composite = null;
		this.compositeCtx = null;
		this.sourceCanvas = null;
		this.lastSample = null;
	}

	private setStatus(next: ClipRecorderStatus): void {
		this.status = next;
		for (const listener of this.listeners) listener(next);
	}
}
