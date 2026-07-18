import { t } from "../i18n";
import { applyStaticI18n } from "../i18n/staticDom";

export class RankedResultOverlay {
	private readonly root: HTMLElement;
	private visible = false;
	private hideTimer: number | null = null;

	constructor() {
		const el = document.createElement("div");
		el.id = "ranked-result-overlay";
		el.className = "ranked-result-overlay hidden";
		el.setAttribute("role", "dialog");
		el.setAttribute("aria-modal", "true");
		el.setAttribute("aria-labelledby", "ranked-result-title");
		document.body.appendChild(el);
		this.root = el;
		this.renderShell();
	}

	isVisible(): boolean {
		return this.visible;
	}

	show(before: number, after: number, delta: number): void {
		const sign = delta >= 0 ? "+" : "";
		const deltaEl = this.root.querySelector("#ranked-result-delta");
		const eloEl = this.root.querySelector("#ranked-result-elo");
		if (deltaEl) {
			deltaEl.textContent = t("match.rankedDeltaShort", { sign, delta });
			deltaEl.classList.toggle("ranked-result-overlay__delta--up", delta >= 0);
			deltaEl.classList.toggle("ranked-result-overlay__delta--down", delta < 0);
		}
		if (eloEl) {
			eloEl.textContent = t("match.rankedEloAfter", { before, after });
		}

		this.visible = true;
		this.root.classList.remove("hidden");
		void this.root.offsetWidth;
		this.root.classList.add("ranked-result-overlay--open");
		applyStaticI18n(this.root);

		if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
		this.hideTimer = window.setTimeout(() => this.hide(), 5000);
	}

	hide(): void {
		if (!this.visible) return;
		this.visible = false;
		this.root.classList.remove("ranked-result-overlay--open");
		this.root.classList.add("hidden");
		if (this.hideTimer !== null) {
			window.clearTimeout(this.hideTimer);
			this.hideTimer = null;
		}
	}

	private renderShell(): void {
		this.root.innerHTML = `
      <div class="ranked-result-overlay__panel">
        <p class="ranked-result-overlay__kicker" data-i18n="match.rankedResult">${t("match.rankedResult")}</p>
        <h2 class="ranked-result-overlay__delta" id="ranked-result-delta">—</h2>
        <p class="ranked-result-overlay__elo" id="ranked-result-elo">—</p>
        <button type="button" class="ranked-result-overlay__btn" data-ranked-close data-i18n="drops.continue">${t("drops.continue")}</button>
      </div>
    `;
		this.root
			.querySelector("[data-ranked-close]")
			?.addEventListener("click", () => {
				this.hide();
			});
	}
}
