import { t } from "../i18n";
import type { CoachHint } from "../meta/MatchCoachTracker";

/** Krótki panel hintów Training Gym po meczu. */
export class CoachHintsOverlay {
	private readonly root: HTMLElement;
	private visible = false;
	private hideTimer: number | null = null;

	constructor() {
		const el = document.createElement("div");
		el.id = "coach-hints";
		el.className = "coach-hints hidden";
		el.setAttribute("role", "status");
		document.body.appendChild(el);
		this.root = el;
	}

	show(hints: CoachHint[]): void {
		if (hints.length === 0) return;
		const items = hints
			.map((h) => {
				const key = `coach.hint.${h.id}` as const;
				const text = t(key, { n: String(h.value) });
				return `<li class="coach-hints__item" data-id="${h.id}">${text}</li>`;
			})
			.join("");
		this.root.innerHTML = `
      <div class="coach-hints__panel">
        <p class="coach-hints__kicker">${t("coach.title")}</p>
        <ul class="coach-hints__list">${items}</ul>
      </div>
    `;
		this.visible = true;
		this.root.classList.remove("hidden");
		void this.root.offsetWidth;
		this.root.classList.add("coach-hints--open");
		if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
		this.hideTimer = window.setTimeout(() => this.hide(), 7000);
	}

	hide(): void {
		if (!this.visible) return;
		this.visible = false;
		this.root.classList.remove("coach-hints--open");
		this.root.classList.add("hidden");
		if (this.hideTimer !== null) {
			window.clearTimeout(this.hideTimer);
			this.hideTimer = null;
		}
	}

	isVisible(): boolean {
		return this.visible;
	}
}
