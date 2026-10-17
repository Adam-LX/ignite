import { onLocaleChange } from "../i18n";
import { nextLoadingTip } from "./loadingTips";

/** SM FramePack montaż: aerial / boost / gol. */
const CINEMATIC_SRC = "/assets/video/ignite_boot_cinematic.mp4?v=6";
/** Fallback jeśli cinematic brak / error. */
const BRAND_SRC = "/assets/video/ignite_boot_brand.mp4?v=1080p1";
/** Match loading loop (nie cold boot). */
const CARS_SRC = "/assets/video/ignite_intro.mp4";
const MIN_BOOT_MS = 4200;
const MIN_MATCH_MS = 420;
const FADE_MS = 380;
const CREEP_PER_SEC = 0.045;
const BOOT_CLASS = "boot-intro--cinematic-sm";
const LOGO_IN_CLASS = "boot-intro--logo-in";

function bootVideoSrc(): string {
	try {
		const p = new URLSearchParams(location.search);
		if (p.get("brandIntro") === "0") return BRAND_SRC;
		if (p.get("carsIntro") === "1") return CARS_SRC;
	} catch {
		/* */
	}
	/** Domyślnie SM FramePack game cinematic. */
	return CINEMATIC_SRC;
}

function queryParams(): URLSearchParams {
	try {
		return new URLSearchParams(location.search);
	} catch {
		return new URLSearchParams();
	}
}

/** 3D wykop piłki — domyślnie. `?videoIntro=1` → SM cinematic mp4. */
export function wantsOldIntro3d(
	params = queryParams(),
): boolean {
	if (wantsSkipAllIntro(params)) return false;
	if (params.get("videoIntro") === "1" || params.get("cinematicIntro") === "1") {
		return false;
	}
	if (params.get("oldIntro") === "0") return false;
	return true;
}

function wantsSkipAllIntro(params = queryParams()): boolean {
	return (
		params.get("skipIntro") === "1" ||
		!!params.get("autostart") ||
		!!params.get("onlineE2e") ||
		params.get("garageAudit") === "1"
	);
}

/** Fullscreen intro + gradientowy pasek — maskuje boot i loading meczu. */
export class BootIntroOverlay {
	private readonly root: HTMLElement | null;
	private readonly video: HTMLVideoElement | null;
	private readonly statusEl: HTMLElement | null;
	private readonly tipEl: HTMLElement | null;
	private readonly fillEl: HTMLElement | null;
	private readonly pctEl: HTMLElement | null;
	private visible = false;
	private shownAt = 0;
	private minVisibleMs = MIN_BOOT_MS;
	private displayProgress = 0;
	private targetProgress = 0;
	private rafId = 0;
	private lastFrame = 0;
	private cinematic = false;
	/** Brand AI mp4 (plays once) vs cars loop / 3D. */
	private brandMode = false;
	private brandEnded = false;
	private resolveBrandEnded: (() => void) | null = null;
	private whenBrandEnded = Promise.resolve();
	/** FX startuje z timeline wideo (~1s przed końcem), nie po hide(). */
	private brandNearEnd = Promise.resolve();
	private resolveBrandNearEnd: (() => void) | null = null;
	private brandFxStarted = false;
	private brandFxDone: Promise<void> = Promise.resolve();
	private brandNearEndLeadSec = 1.5;
	private brandNearEndTimer = 0;

	constructor() {
		this.root = document.getElementById("loading");
		this.video = document.getElementById(
			"boot-intro-video",
		) as HTMLVideoElement | null;
		this.statusEl = document.getElementById("loading-status");
		this.tipEl = this.ensureTipEl();
		this.fillEl = document.getElementById("boot-intro-fill");
		this.pctEl = document.getElementById("boot-intro-pct");
		this.refreshTip();
		onLocaleChange(() => this.refreshTip());

		if (this.video) {
			this.video.addEventListener("ended", () => this.markBrandEnded());
			this.video.addEventListener("error", () => this.markBrandEnded());
		}

		if (wantsOldIntro3d()) {
			this.enterCinematicMode();
			return;
		}

		/** SM FramePack mp4 gdy 3D wyłączone (domyślnie). */
		if (this.video && !wantsSkipAllIntro()) {
			this.video.src = bootVideoSrc();
			this.video.loop = bootVideoSrc() === CARS_SRC;
			this.video.preload = "auto";
			if (bootVideoSrc() === CINEMATIC_SRC) {
				this.root?.classList.add(BOOT_CLASS);
			}
			/** Preload cars pod GRAJ — bez decode hitch przy starcie meczu. */
			try {
				const pre = document.createElement("video");
				pre.preload = "auto";
				pre.muted = true;
				pre.src = CARS_SRC;
				pre.load();
			} catch {
				/* */
			}
		}
	}

	private resetBrandGate(): void {
		this.brandEnded = false;
		this.brandFxStarted = false;
		this.brandFxDone = Promise.resolve();
		this.whenBrandEnded = new Promise<void>((r) => {
			this.resolveBrandEnded = r;
		});
		this.brandNearEnd = new Promise<void>((r) => {
			this.resolveBrandNearEnd = r;
		});
	}

	private markBrandNearEnd(): void {
		this.resolveBrandNearEnd?.();
		this.resolveBrandNearEnd = null;
	}

	private markBrandEnded(): void {
		if (this.brandEnded) return;
		this.brandEnded = true;
		this.markBrandNearEnd();
		this.resolveBrandEnded?.();
		this.resolveBrandEnded = null;
	}

	/** Nasłuch timeline od startu brand — FX nie czeka na hide()/pasek. */
	private armBrandNearEndWatch(): void {
		const video = this.video;
		if (!video) {
			this.markBrandNearEnd();
			return;
		}
		const lead = this.brandNearEndLeadSec;
		let done = false;
		let raf = 0;
		let worker: Worker | null = null;
		const finish = (): void => {
			if (done) return;
			done = true;
			cancelAnimationFrame(raf);
			if (this.brandNearEndTimer) {
				window.clearTimeout(this.brandNearEndTimer);
				this.brandNearEndTimer = 0;
			}
			worker?.terminate();
			worker = null;
			video.removeEventListener("timeupdate", onTime);
			video.removeEventListener("playing", scheduleTimer);
			this.markBrandNearEnd();
		};
		const onTime = (): void => {
			const d = video.duration;
			if (video.ended || this.brandEnded) {
				finish();
				return;
			}
			if (
				Number.isFinite(d) &&
				d > 0 &&
				video.currentTime >= d - lead
			) {
				finish();
			}
		};
		const scheduleTimer = (): void => {
			const d = video.duration;
			if (!Number.isFinite(d) || d <= 0) return;
			const ms = Math.max(0, (d - lead - video.currentTime) * 1000);
			if (this.brandNearEndTimer) {
				window.clearTimeout(this.brandNearEndTimer);
			}
			this.brandNearEndTimer = window.setTimeout(finish, ms);
			/** Worker timer — odporny na zablokowany main thread (boot/SwiftShader). */
			try {
				worker?.terminate();
				const blob = new Blob(
					[
						`setTimeout(() => postMessage("near"), ${Math.ceil(ms)});`,
					],
					{ type: "text/javascript" },
				);
				const url = URL.createObjectURL(blob);
				worker = new Worker(url);
				URL.revokeObjectURL(url);
				worker.onmessage = () => finish();
			} catch {
				/* private mode / CSP */
			}
		};
		const tick = (): void => {
			onTime();
			if (!done) raf = requestAnimationFrame(tick);
		};
		video.addEventListener("timeupdate", onTime);
		video.addEventListener("playing", scheduleTimer);
		if ("requestVideoFrameCallback" in video) {
			const v = video as HTMLVideoElement & {
				requestVideoFrameCallback: (cb: () => void) => number;
			};
			const loop = (): void => {
				onTime();
				if (!done) v.requestVideoFrameCallback(loop);
			};
			v.requestVideoFrameCallback(loop);
		}
		if (!video.paused && video.readyState >= 2) scheduleTimer();
		raf = requestAnimationFrame(tick);
	}

	/** Odpal soft outro + logo slam gdy wideo blisko końca. */
	private kickBrandFxWhenNearEnd(): void {
		void this.brandNearEnd.then(() => {
			this.root?.classList.add(LOGO_IN_CLASS);
			if (!this.brandMode || this.brandFxStarted) return;
			this.brandFxStarted = true;
			this.brandFxDone = this.playBrandDisintegrate().catch(() => {});
		});
	}

	/** Czeka aż brand video dobiegnie (lub error / już ended). */
	waitBrandComplete(): Promise<void> {
		if (!this.brandMode || this.brandEnded) return Promise.resolve();
		return this.whenBrandEnded;
	}

	start(mode: "boot" | "match" = "boot"): void {
		if (!this.root) return;
		this.minVisibleMs = mode === "match" ? MIN_MATCH_MS : MIN_BOOT_MS;
		this.visible = true;
		this.shownAt = performance.now();
		this.displayProgress = 0;
		this.targetProgress = 0.04;
		this.brandMode = false;

		const keepOld3d =
			mode === "boot" && (this.cinematic || wantsOldIntro3d());
		this.root.classList.remove("hidden", "boot-intro--out");
		if (!keepOld3d) {
			this.root.classList.remove("boot-intro--cinematic");
			this.cinematic = false;
		}
		this.root.style.display = "flex";
		this.paintProgress();
		this.startLoop();

		if (keepOld3d) {
			this.enterCinematicMode();
			return;
		}

		if (this.video) {
			if (mode === "boot" && !wantsSkipAllIntro()) {
				this.brandMode = true;
				this.resetBrandGate();
				this.root.classList.add(BOOT_CLASS);
				this.root.classList.remove(LOGO_IN_CLASS, "boot-intro--brand");
				this.video.src = bootVideoSrc();
				this.video.loop = false;
				this.video.style.visibility = "";
				this.video.style.opacity = "";
				this.video.currentTime = 0;
				const onMeta = (): void => {
					if (
						this.video &&
						Number.isFinite(this.video.duration) &&
						this.video.duration > 0
					) {
						this.minVisibleMs = Math.max(
							MIN_BOOT_MS,
							this.video.duration * 1000,
						);
					}
				};
				this.video.addEventListener("loadedmetadata", onMeta, {
					once: true,
				});
				this.video.addEventListener(
					"error",
					() => {
						if (!this.video || !this.brandMode) return;
						/** Cinematic missing → stary brand mp4. */
						if (!this.video.src.includes("ignite_boot_brand")) {
							this.video.src = BRAND_SRC;
							void this.video.play().catch(() => this.markBrandEnded());
						} else {
							this.markBrandEnded();
						}
					},
					{ once: true },
				);
				this.armBrandNearEndWatch();
				this.kickBrandFxWhenNearEnd();
				void this.video.play().catch(() => this.markBrandEnded());
				return;
			}

			/** Match loading — cars loop; nie przeładowuj src jeśli już cars (anti-hitch). */
			this.root.classList.remove(BOOT_CLASS, LOGO_IN_CLASS, "boot-intro--brand");
			const alreadyCars = this.video.src.includes("ignite_intro");
			if (!alreadyCars) {
				this.video.src = CARS_SRC;
			}
			this.video.style.visibility = "";
			this.video.loop = true;
			if (!alreadyCars) this.video.currentTime = 0;
			void this.video.play().catch(() => {});
		}
	}

	/**
	 * Boot z 3D intro: ukryj video/logo marki.
	 * Timing min. widoczności bierze na siebie cinematic (logo hold).
	 */
	enterCinematicMode(): void {
		if (!this.root) return;
		this.cinematic = true;
		this.brandMode = false;
		this.minVisibleMs = 0;
		this.root.classList.add("boot-intro--cinematic");
		this.root.classList.remove("boot-intro--cinematic-ready");
		this.root.classList.remove("boot-intro--brand", BOOT_CLASS, LOGO_IN_CLASS);
		document.documentElement.classList.add("ignite-boot-cinematic");
		if (this.video) {
			this.video.pause();
			this.video.removeAttribute("src");
			this.video.load();
			this.video.style.visibility = "hidden";
		}
	}

	/** Po morph piłka→logo: pokaż pasek ładowania pod logo. */
	revealCinematicProgress(): void {
		if (!this.root) return;
		this.cinematic = true;
		this.root.classList.add(
			"boot-intro--cinematic",
			"boot-intro--cinematic-ready",
		);
		document.documentElement.classList.add(
			"ignite-boot-cinematic",
			"ignite-boot-cinematic-ready",
		);
		if (this.video) {
			this.video.pause();
			this.video.style.visibility = "hidden";
		}
	}

	setStatus(text: string): void {
		if (this.statusEl) this.statusEl.textContent = text;
		this.refreshTip();
	}

	private refreshTip(): void {
		if (this.tipEl) this.tipEl.textContent = nextLoadingTip();
	}

	private ensureTipEl(): HTMLElement | null {
		let tip = document.getElementById("loading-tip");
		if (tip) return tip;
		const ui = this.statusEl?.parentElement;
		if (!ui || !this.statusEl) return null;
		tip = document.createElement("p");
		tip.id = "loading-tip";
		tip.className = "boot-intro__tip";
		this.statusEl.insertAdjacentElement("afterend", tip);
		return tip;
	}

	setProgress(fraction: number): void {
		const clamped = Math.max(this.targetProgress, Math.min(1, fraction));
		this.targetProgress = clamped;
	}

	isVisible(): boolean {
		return this.visible;
	}

	private startLoop(): void {
		cancelAnimationFrame(this.rafId);
		this.lastFrame = performance.now();
		const tick = (now: number) => {
			if (!this.visible) return;
			const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
			this.lastFrame = now;

			const cap = Math.min(0.96, this.targetProgress + CREEP_PER_SEC * dt);
			if (cap > this.targetProgress && this.targetProgress < 0.94) {
				this.targetProgress = cap;
			}

			const delta = this.targetProgress - this.displayProgress;
			const step = delta * Math.min(1, dt * 4.2);
			this.displayProgress += step;
			this.paintProgress();

			this.rafId = requestAnimationFrame(tick);
		};
		this.rafId = requestAnimationFrame(tick);
	}

	private stopLoop(): void {
		cancelAnimationFrame(this.rafId);
		this.rafId = 0;
	}

	private paintProgress(): void {
		const pct = Math.round(this.displayProgress * 100);
		if (this.fillEl) {
			this.fillEl.style.width = `${pct}%`;
		}
		if (this.pctEl) {
			this.pctEl.textContent = `${pct}%`;
		}
		const bar = this.root?.querySelector(".boot-intro__bar");
		if (bar) bar.setAttribute("aria-valuenow", String(pct));
	}

	/**
	 * Soft premium outro: wideo jeszcze żyje → delikatny pył → fade do czerni.
	 * Bez twardego „freeze → burst” ani grubych kwadratów.
	 */
	private async playBrandDisintegrate(): Promise<void> {
		const root = this.root;
		const video = this.video;
		if (!root || !video || video.readyState < 2) return;

		const vw = video.videoWidth || 1920;
		const vh = video.videoHeight || 1080;
		if (vw < 8 || vh < 8) return;

		const canvas = document.createElement("canvas");
		canvas.className = "boot-intro__disintegrate";
		canvas.setAttribute("aria-hidden", "true");
		const rect = root.getBoundingClientRect();
		const cw = Math.max(2, Math.floor(rect.width));
		const ch = Math.max(2, Math.floor(rect.height));
		const fxScale = Math.min(1, 1280 / Math.max(cw, ch));
		const fw = Math.max(2, Math.floor(cw * fxScale));
		const fh = Math.max(2, Math.floor(ch * fxScale));
		canvas.width = fw;
		canvas.height = fh;
		canvas.style.width = "100%";
		canvas.style.height = "100%";
		root.appendChild(canvas);
		const ctx = canvas.getContext("2d", { alpha: true });
		if (!ctx) {
			canvas.remove();
			return;
		}

		const coverDraw = (target: CanvasRenderingContext2D): void => {
			const scale = Math.max(fw / vw, fh / vh);
			const dw = vw * scale;
			const dh = vh * scale;
			const ox = (fw - dw) / 2;
			const oy = (fh - dh) / 2;
			target.drawImage(video, ox, oy, dw, dh);
		};

		const snap = document.createElement("canvas");
		snap.width = fw;
		snap.height = fh;
		const sctx = snap.getContext("2d", { alpha: false });
		if (!sctx) {
			canvas.remove();
			return;
		}
		try {
			coverDraw(sctx);
		} catch {
			canvas.remove();
			return;
		}

		const step = Math.max(14, Math.round(Math.min(fw, fh) / 36));
		type P = {
			x: number;
			y: number;
			vx: number;
			vy: number;
			s: number;
			r: number;
			g: number;
			b: number;
		};
		const parts: P[] = [];
		const img = sctx.getImageData(0, 0, fw, fh);
		const data = img.data;
		const cx = fw * 0.5;
		const cy = fh * 0.48;
		const maxParts = 420;
		for (let y = 0; y < fh && parts.length < maxParts; y += step) {
			for (let x = 0; x < fw && parts.length < maxParts; x += step) {
				const i = (y * fw + x) * 4;
				const r = data[i]!;
				const g = data[i + 1]!;
				const b = data[i + 2]!;
				const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
				if (lum < 22) continue;
				const dx = x + step * 0.5 - cx;
				const dy = y + step * 0.5 - cy;
				const dist = Math.hypot(dx, dy) + 1;
				const burst = 40 + Math.random() * 110;
				parts.push({
					x: x + step * 0.5,
					y: y + step * 0.5,
					vx: (dx / dist) * burst + (Math.random() - 0.5) * 18,
					vy: (dy / dist) * burst * 0.4 - 20 - Math.random() * 55,
					s: Math.max(1.2, step * 0.38),
					r,
					g,
					b,
				});
			}
		}

		const ui = root.querySelector(".boot-intro__ui") as HTMLElement | null;
		if (ui) {
			ui.style.transition = "opacity 0.7s ease";
			ui.style.opacity = "0";
		}

		/** Video zostaje na pełnej jasności dłużej — FX tylko dokłada. */
		video.style.opacity = "1";
		video.style.transition = "none";

		const DUR = 1.35;
		const LIVE_UNTIL = 0.72;
		const t0 = performance.now();
		let videoHidden = false;

		await new Promise<void>((resolve) => {
			const tick = (now: number): void => {
				const t = Math.min(1, (now - t0) / 1000 / DUR);
				const ease = t * t * (3 - 2 * t);

				ctx.clearRect(0, 0, fw, fh);

				if (t < LIVE_UNTIL && !video.ended) {
					/** Płynny fade wideo w drugiej połowie live-okna. */
					const fadeVid = Math.max(
						0,
						(t - LIVE_UNTIL * 0.45) / (LIVE_UNTIL * 0.55),
					);
					video.style.opacity = String(1 - fadeVid * 0.92);
				} else if (!videoHidden) {
					videoHidden = true;
					video.style.opacity = "0";
					video.style.visibility = "hidden";
					video.pause();
				}

				const partIn = Math.min(1, Math.max(0, (t - 0.12) / 0.35));
				const drift = Math.max(0, (ease - 0.18) / 0.82);
				const fade =
					1 - Math.pow(Math.max(0, (t - 0.42) / 0.58), 1.05);
				for (let i = 0; i < parts.length; i++) {
					const p = parts[i]!;
					const px = p.x + p.vx * drift * 0.42;
					const py = p.y + p.vy * drift * 0.42 + drift * drift * 55;
					const a = partIn * fade * 0.85;
					if (a < 0.04) continue;
					ctx.globalAlpha = a;
					ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
					const sz = p.s * (1 - drift * 0.35);
					ctx.beginPath();
					ctx.arc(px, py, sz * 0.55, 0, Math.PI * 2);
					ctx.fill();
				}
				ctx.globalAlpha = 1;

				/** Soft black veil na końcu — bez twardego cuta. */
				if (t > 0.55) {
					ctx.globalAlpha = Math.pow((t - 0.55) / 0.45, 1.15);
					ctx.fillStyle = "#000";
					ctx.fillRect(0, 0, fw, fh);
					ctx.globalAlpha = 1;
				}

				if (t >= 1) {
					resolve();
					return;
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});

		canvas.remove();
		video.style.opacity = "";
		video.style.transition = "";
		video.style.visibility = "hidden";
		if (ui) {
			ui.style.opacity = "";
			ui.style.transition = "";
		}
	}

	async hide(): Promise<void> {
		if (!this.visible || !this.root) return;

		this.targetProgress = 1;
		const finishBar = async () => {
			/** Szybkie domknięcie — bez wieloklatkowego lerpu przy GRAJ. */
			if (this.displayProgress >= 0.82) {
				this.displayProgress = 1;
				this.paintProgress();
				return;
			}
			let frames = 0;
			while (this.displayProgress < 0.995 && frames < 12) {
				this.displayProgress += (1 - this.displayProgress) * 0.28;
				this.paintProgress();
				frames++;
				await new Promise((r) => requestAnimationFrame(r));
			}
			this.displayProgress = 1;
			this.paintProgress();
		};
		await finishBar();

		if (this.brandMode) {
			/**
			 * FX startuje z timeline (~1s przed końcem). Tu tylko
			 * synchronizujemy hide z near-end + domknięciem FX —
			 * nigdy nie odpalamy dezintegracji „po” zamarzniętym ended.
			 */
			await this.brandNearEnd;
			this.root.classList.add(LOGO_IN_CLASS);
			if (!this.brandFxStarted) {
				this.brandFxStarted = true;
				this.brandFxDone = this.playBrandDisintegrate().catch(() => {});
			}
			await this.brandFxDone;
		} else {
			const wait = this.minVisibleMs - (performance.now() - this.shownAt);
			if (wait > 0) {
				await new Promise((resolve) => setTimeout(resolve, wait));
			}
			this.root.classList.add("boot-intro--out");
			await new Promise((resolve) => setTimeout(resolve, FADE_MS));
		}

		this.stopLoop();
		this.root.classList.add("hidden");
		this.root.style.display = "none";
		this.root.classList.remove("boot-intro--out", "boot-intro--cinematic");
		this.root.classList.remove("boot-intro--cinematic-ready");
		this.root.classList.remove("boot-intro--brand", BOOT_CLASS, LOGO_IN_CLASS);
		document.documentElement.classList.remove(
			"ignite-boot-cinematic",
			"ignite-boot-cinematic-ready",
		);
		this.cinematic = false;
		this.brandMode = false;
		if (this.video) {
			this.video.pause();
			this.video.style.visibility = "";
			this.video.style.opacity = "";
			this.video.style.transition = "";
		}
		this.visible = false;
	}
}

export const bootIntro = new BootIntroOverlay();

export const LOADING_PROGRESS: Record<string, number> = {
	"loading.status.physics": 0.1,
	"loading.status.scene": 0.2,
	"loading.status.meshyArena": 0.34,
	"loading.status.sky": 0.44,
	"loading.status.arena": 0.54,
	"loading.status.models": 0.64,
	"loading.status.audio": 0.76,
	"loading.status.menu3d": 0.86,
	"loading.status.gpuWarmup": 0.94,
	"loading.status.match": 0.42,
	"loading.status.matchOnline": 0.42,
	"loading.status.gpuHeavy": 0.84,
	"loading.status.prematchShaders": 0.86,
	"loading.status.vfxShaders": 0.88,
};
