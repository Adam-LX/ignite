const INTRO_SRC = "/assets/video/ignite_intro.mp4";
const MIN_BOOT_MS = 5200;
const MIN_MATCH_MS = 3800;
const FADE_MS = 520;
const CREEP_PER_SEC = 0.045;

/** Fullscreen intro + gradientowy pasek — maskuje boot i loading meczu. */
export class BootIntroOverlay {
	private readonly root: HTMLElement | null;
	private readonly video: HTMLVideoElement | null;
	private readonly statusEl: HTMLElement | null;
	private readonly fillEl: HTMLElement | null;
	private readonly pctEl: HTMLElement | null;
	private visible = false;
	private shownAt = 0;
	private minVisibleMs = MIN_BOOT_MS;
	private displayProgress = 0;
	private targetProgress = 0;
	private rafId = 0;
	private lastFrame = 0;

	constructor() {
		this.root = document.getElementById("loading");
		this.video = document.getElementById(
			"boot-intro-video",
		) as HTMLVideoElement | null;
		this.statusEl = document.getElementById("loading-status");
		this.fillEl = document.getElementById("boot-intro-fill");
		this.pctEl = document.getElementById("boot-intro-pct");
		if (this.video && !this.video.getAttribute("src")) {
			this.video.src = INTRO_SRC;
		}
	}

	start(mode: "boot" | "match" = "boot"): void {
		if (!this.root) return;
		this.minVisibleMs = mode === "match" ? MIN_MATCH_MS : MIN_BOOT_MS;
		this.visible = true;
		this.shownAt = performance.now();
		this.displayProgress = 0;
		this.targetProgress = 0.04;
		this.root.classList.remove("hidden", "boot-intro--out");
		this.root.style.display = "flex";
		this.paintProgress();
		this.startLoop();
		if (this.video) {
			this.video.loop = true;
			this.video.currentTime = 0;
			void this.video.play().catch(() => {});
		}
	}

	setStatus(text: string): void {
		if (this.statusEl) this.statusEl.textContent = text;
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

	async hide(): Promise<void> {
		if (!this.visible || !this.root) return;

		this.targetProgress = 1;
		const finishBar = async () => {
			while (this.displayProgress < 0.995) {
				this.displayProgress += (1 - this.displayProgress) * 0.14;
				this.paintProgress();
				await new Promise((r) => requestAnimationFrame(r));
			}
			this.displayProgress = 1;
			this.paintProgress();
		};
		await finishBar();

		const wait = this.minVisibleMs - (performance.now() - this.shownAt);
		if (wait > 0) {
			await new Promise((resolve) => setTimeout(resolve, wait));
		}

		this.root.classList.add("boot-intro--out");
		await new Promise((resolve) => setTimeout(resolve, FADE_MS));
		this.stopLoop();
		this.root.classList.add("hidden");
		this.root.style.display = "none";
		this.root.classList.remove("boot-intro--out");
		if (this.video) this.video.pause();
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
	"loading.status.vfxShaders": 0.88,
};
