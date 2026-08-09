import { t, type I18nKey } from "../i18n";

const STORAGE_KEY = "ignite.tutorialDone";

type TutorialStep = {
	id: string;
	titleKey: I18nKey;
	bodyKey: I18nKey;
};

const STEPS: TutorialStep[] = [
	{
		id: "boost",
		titleKey: "tutorial.boost.title",
		bodyKey: "tutorial.boost.body",
	},
	{
		id: "jump",
		titleKey: "tutorial.jump.title",
		bodyKey: "tutorial.jump.body",
	},
	{
		id: "dodge",
		titleKey: "tutorial.dodge.title",
		bodyKey: "tutorial.dodge.body",
	},
	{
		id: "camera",
		titleKey: "tutorial.camera.title",
		bodyKey: "tutorial.camera.body",
	},
	{
		id: "kickoff",
		titleKey: "tutorial.kickoff.title",
		bodyKey: "tutorial.kickoff.body",
	},
	{
		id: "replay",
		titleKey: "tutorial.replay.title",
		bodyKey: "tutorial.replay.body",
	},
];

/** 90 s skippable first-session tutorial — AAA onboarding floor. */
export class TutorialOverlay {
	private readonly root: HTMLElement;
	private step = 0;
	private visible = false;
	private onDone: (() => void) | null = null;
	private openedAt = 0;

	constructor() {
		const el = document.createElement("div");
		el.id = "tutorial-overlay";
		el.className = "tutorial-overlay hidden";
		el.setAttribute("role", "dialog");
		el.setAttribute("aria-modal", "true");
		document.body.appendChild(el);
		this.root = el;
		this.root.addEventListener("click", (e) => {
			const tEl = e.target as HTMLElement;
			if (tEl.closest("[data-tutorial-next]")) this.next();
			if (tEl.closest("[data-tutorial-skip]")) this.finish(true);
		});
		window.addEventListener("keydown", (e) => {
			if (!this.visible) return;
			if (e.key === "Escape") {
				e.preventDefault();
				this.finish(true);
			}
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				this.next();
			}
		});
	}

	static isDone(): boolean {
		try {
			return localStorage.getItem(STORAGE_KEY) === "1";
		} catch {
			return false;
		}
	}

	static markDone(): void {
		try {
			localStorage.setItem(STORAGE_KEY, "1");
		} catch {
			/* private */
		}
	}

	/** Pokaż jeśli first-run; wywołaj onDone gdy zamknięte (skip lub koniec). */
	maybeStart(onDone: () => void): boolean {
		if (TutorialOverlay.isDone()) {
			onDone();
			return false;
		}
		this.onDone = onDone;
		this.step = 0;
		this.openedAt = performance.now();
		this.render();
		this.visible = true;
		this.root.classList.remove("hidden");
		return true;
	}

	forceShow(onDone?: () => void): void {
		this.onDone = onDone ?? null;
		this.step = 0;
		this.openedAt = performance.now();
		this.render();
		this.visible = true;
		this.root.classList.remove("hidden");
	}

	isVisible(): boolean {
		return this.visible;
	}

	private next(): void {
		if (this.step >= STEPS.length - 1) {
			this.finish(false);
			return;
		}
		this.step += 1;
		this.render();
	}

	private finish(skipped: boolean): void {
		TutorialOverlay.markDone();
		this.visible = false;
		this.root.classList.add("hidden");
		const elapsed = (performance.now() - this.openedAt) / 1000;
		console.info(
			`[tutorial] done skipped=${skipped} elapsed=${elapsed.toFixed(1)}s`,
		);
		const cb = this.onDone;
		this.onDone = null;
		cb?.();
	}

	private render(): void {
		const s = STEPS[this.step]!;
		const n = this.step + 1;
		const total = STEPS.length;
		this.root.innerHTML = `
      <div class="tutorial-overlay__panel glass-panel">
        <p class="tutorial-overlay__kicker">${t("tutorial.kicker", { n: String(n), total: String(total) })}</p>
        <h2 class="tutorial-overlay__title">${t(s.titleKey)}</h2>
        <p class="tutorial-overlay__body">${t(s.bodyKey)}</p>
        <div class="tutorial-overlay__actions">
          <button type="button" class="tutorial-overlay__skip" data-tutorial-skip>${t("tutorial.skip")}</button>
          <button type="button" class="tutorial-overlay__next ignite-cta-ground" data-tutorial-next>
            <span>${n >= total ? t("tutorial.done") : t("tutorial.next")}</span>
          </button>
        </div>
        <p class="tutorial-overlay__hint">${t("tutorial.hint")}</p>
      </div>
    `;
	}
}
