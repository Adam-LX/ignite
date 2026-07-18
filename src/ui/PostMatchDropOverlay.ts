import { getArenaEntry } from "../arena/ArenaCatalog";
import { t } from "../i18n";
import { applyStaticI18n } from "../i18n/staticDom";
import { getCarEntry } from "../meta/CarCatalog";
import type { DropResult } from "../meta/DropTable";

export class PostMatchDropOverlay {
	private readonly root: HTMLElement;
	private visible = false;
	private hideTimer: number | null = null;
	private onGarage: (() => void) | null = null;
	private onDismiss: (() => void) | null = null;

	constructor() {
		const el = document.createElement("div");
		el.id = "post-match-drop";
		el.className = "post-match-drop hidden";
		el.setAttribute("role", "dialog");
		el.setAttribute("aria-modal", "true");
		el.setAttribute("aria-labelledby", "post-match-drop-title");
		document.body.appendChild(el);
		this.root = el;
		this.renderShell();
	}

	setCallbacks(onGarage: () => void, onDismiss: () => void): void {
		this.onGarage = onGarage;
		this.onDismiss = onDismiss;
	}

	isVisible(): boolean {
		return this.visible;
	}

	showCar(carId: string): void {
		const entry = getCarEntry(carId);
		const name = entry ? t(entry.nameKey as never) : carId;
		this.open(t("drops.titleCar"), name);
	}

	showArena(arenaId: string): void {
		const entry = getArenaEntry(arenaId);
		const name = entry ? t(entry.nameKey as never) : arenaId;
		this.open(t("drops.titleArena"), name);
	}

	showDrop(drop: DropResult): void {
		if (drop.kind === "crate") return;
	}

	/** @deprecated użyj showCar */
	show(carId: string): void {
		this.showCar(carId);
	}

	private open(title: string, name: string): void {
		const titleEl = this.root.querySelector("#post-match-drop-title");
		const nameEl = this.root.querySelector("#post-match-drop-car");
		if (titleEl) titleEl.textContent = title;
		if (nameEl) nameEl.textContent = name;

		this.visible = true;
		this.root.classList.remove("hidden");
		void this.root.offsetWidth;
		this.root.classList.add("post-match-drop--open");
		applyStaticI18n(this.root);

		if (this.hideTimer !== null) {
			window.clearTimeout(this.hideTimer);
		}
		this.hideTimer = window.setTimeout(() => {
			this.hide(false);
		}, 4500);
	}

	hide(callDismiss = true): void {
		if (!this.visible) return;
		this.visible = false;
		this.root.classList.remove("post-match-drop--open");
		this.root.classList.add("hidden");
		if (this.hideTimer !== null) {
			window.clearTimeout(this.hideTimer);
			this.hideTimer = null;
		}
		if (callDismiss) this.onDismiss?.();
	}

	private renderShell(): void {
		this.root.innerHTML = `
      <div class="post-match-drop__panel">
        <p class="post-match-drop__kicker" data-i18n="drops.newUnlock">${t("drops.newUnlock")}</p>
        <h2 id="post-match-drop-title" class="post-match-drop__title">${t("drops.titleCar")}</h2>
        <p class="post-match-drop__car" id="post-match-drop-car">—</p>
        <div class="post-match-drop__actions">
          <button type="button" class="post-match-drop__btn post-match-drop__btn--primary" data-drop-garage data-i18n="drops.toGarage">${t("drops.toGarage")}</button>
          <button type="button" class="post-match-drop__btn" data-drop-continue data-i18n="drops.continue">${t("drops.continue")}</button>
        </div>
      </div>
    `;

		this.root
			.querySelector("[data-drop-garage]")
			?.addEventListener("click", () => {
				this.hide(false);
				this.onGarage?.();
			});
		this.root
			.querySelector("[data-drop-continue]")
			?.addEventListener("click", () => this.hide(true));
	}
}
