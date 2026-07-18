import { t } from "../i18n";
import { applyStaticI18n } from "../i18n/staticDom";
import {
	type CarCatalogEntry,
	getCarCatalogSync,
	getCarEntry,
	getCarRarity,
	loadCarCatalog,
} from "../meta/CarCatalog";
import {
	equipCar,
	getEquippedCarId,
	isCarUnlocked,
} from "../meta/PlayerInventory";
import { mountCarThumbnail, primeCarThumbnails } from "./carThumbnail";

export type InventoryEquipListener = (carId: string) => void;

/** Ekwipunek w stylu RL — grid, detail panel, subtelny equipped (Gemini v0.3 UI). */
export class GarageOverlay {
	private readonly root: HTMLElement;
	private visible = false;
	private keyHandler: ((e: KeyboardEvent) => void) | null = null;
	private onClose: (() => void) | null = null;
	private onEquip: InventoryEquipListener | null = null;
	private selectedId: string | null = null;

	constructor() {
		const el = document.createElement("div");
		el.id = "inventory-overlay";
		el.className = "inventory-overlay hidden";
		el.setAttribute("role", "dialog");
		el.setAttribute("aria-modal", "true");
		el.setAttribute("aria-labelledby", "inventory-title");
		document.body.appendChild(el);
		this.root = el;
		this.renderShell();
	}

	setOnClose(fn: () => void): void {
		this.onClose = fn;
	}

	setOnEquip(fn: InventoryEquipListener): void {
		this.onEquip = fn;
	}

	isVisible(): boolean {
		return this.visible;
	}

	async show(): Promise<void> {
		await loadCarCatalog();
		this.selectedId = getEquippedCarId();
		this.visible = true;
		document.body.classList.add("inventory-open");
		this.root.classList.remove("hidden");
		void this.root.offsetWidth;
		this.root.classList.add("inventory-overlay--open");
		await this.refresh();
		this.bindKeyboard();
		this.root.querySelector<HTMLButtonElement>("[data-inv-close]")?.focus();
	}

	hide(): void {
		if (!this.visible) return;
		this.visible = false;
		document.body.classList.remove("inventory-open");
		this.root.classList.remove("inventory-overlay--open");
		this.root.classList.add("hidden");
		if (this.keyHandler) {
			window.removeEventListener("keydown", this.keyHandler);
			this.keyHandler = null;
		}
		this.onClose?.();
	}

	private renderShell(): void {
		this.root.innerHTML = `
      <div class="inventory-overlay__scanlines" aria-hidden="true"></div>
      <div class="inventory-shell">
        <header class="inventory-head">
          <div class="inventory-head__brand">
            <span class="inventory-head__kicker" data-i18n="inventory.kicker">${t("inventory.kicker")}</span>
            <h1 id="inventory-title" data-i18n="inventory.title">${t("inventory.title")}</h1>
          </div>
          <button type="button" class="inventory-head__close" data-inv-close data-i18n-aria="inventory.close" aria-label="${t("inventory.close")}">×</button>
        </header>
        <div class="inventory-body">
          <nav class="inventory-tabs" role="tablist">
            <button type="button" class="inventory-tabs__btn inventory-tabs__btn--active" data-tab="bodies" role="tab" data-i18n="inventory.tab.bodies">${t("inventory.tab.bodies")}</button>
            <button type="button" class="inventory-tabs__btn inventory-tabs__btn--soon" data-tab="boost" role="tab" disabled data-i18n="inventory.tab.boost">${t("inventory.tab.boost")}</button>
          </nav>
          <div class="inventory-grid-wrap">
            <div class="inventory-grid" id="inventory-grid" role="list"></div>
          </div>
          <aside class="inventory-detail" aria-live="polite">
            <p class="inventory-detail__label" data-i18n="inventory.detail">${t("inventory.detail")}</p>
            <h2 class="inventory-detail__name" id="inventory-detail-name">—</h2>
            <p class="inventory-detail__meta" id="inventory-detail-meta"></p>
            <p class="inventory-detail__hitbox" data-i18n="inventory.hitbox">${t("inventory.hitbox")}</p>
            <button type="button" class="inventory-detail__equip" id="inventory-equip-btn" data-i18n="inventory.equip">${t("inventory.equip")}</button>
            <span class="inventory-detail__equipped-note hidden" id="inventory-equipped-note" data-i18n="inventory.equippedSubtle">${t("inventory.equippedSubtle")}</span>
          </aside>
        </div>
        <footer class="inventory-foot">
          <span data-i18n="inventory.hint">${t("inventory.hint")}</span>
        </footer>
      </div>
    `;

		this.root
			.querySelector("[data-inv-close]")
			?.addEventListener("click", () => {
				this.hide();
			});

		this.root
			.querySelector("#inventory-equip-btn")
			?.addEventListener("click", () => {
				if (!this.selectedId) return;
				if (!isCarUnlocked(this.selectedId)) return;
				if (this.selectedId === getEquippedCarId()) return;
				if (equipCar(this.selectedId)) {
					this.onEquip?.(this.selectedId);
					void this.refresh();
				}
			});
	}

	private async refresh(): Promise<void> {
		applyStaticI18n(this.root);
		const grid = this.root.querySelector("#inventory-grid");
		if (!grid) return;

		const equipped = getEquippedCarId();
		if (!this.selectedId || !getCarEntry(this.selectedId)) {
			this.selectedId = equipped;
		}

		const cars = getCarCatalogSync().cars;
		grid.replaceChildren(
			...cars.map((entry) => this.renderCard(entry, equipped)),
		);

		void primeCarThumbnails(cars.map((c) => c.id)).then(() => {
			for (let i = 0; i < cars.length; i += 1) {
				const thumb = grid.children[i]?.querySelector<HTMLElement>(
					"[data-inv-thumb]",
				);
				if (thumb) void mountCarThumbnail(thumb, cars[i]!.id);
			}
		});

		this.updateDetail();
	}

	private renderCard(
		entry: CarCatalogEntry,
		equippedId: string,
	): HTMLButtonElement {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "inventory-card";
		btn.role = "listitem";
		btn.dataset.carId = entry.id;

		const unlocked = isCarUnlocked(entry.id);
		const isEquipped = entry.id === equippedId;
		const isSelected = entry.id === this.selectedId;
		const rarity = getCarRarity(entry.id);

		if (!unlocked) btn.classList.add("inventory-card--locked");
		if (isEquipped) btn.classList.add("inventory-card--equipped");
		if (isSelected) btn.classList.add("inventory-card--selected");

		const name = t(entry.nameKey as never);
		btn.innerHTML = `
      <span class="inventory-card__thumb inventory-card__thumb--${entry.id}" data-inv-thumb aria-hidden="true"></span>
      ${isEquipped ? '<span class="inventory-card__dot" aria-hidden="true"></span>' : ""}
      ${!unlocked ? '<span class="inventory-card__lock" aria-hidden="true">🔒</span>' : ""}
      <span class="inventory-card__name">${name}</span>
      <span class="inventory-card__rarity inventory-card__rarity--${rarity}" aria-hidden="true"></span>
    `;

		btn.addEventListener("click", () => {
			if (!unlocked) return;
			this.selectedId = entry.id;
			void this.refresh();
		});

		return btn;
	}

	private updateDetail(): void {
		const entry = this.selectedId ? getCarEntry(this.selectedId) : null;
		const nameEl = this.root.querySelector("#inventory-detail-name");
		const metaEl = this.root.querySelector("#inventory-detail-meta");
		const equipBtn = this.root.querySelector<HTMLButtonElement>(
			"#inventory-equip-btn",
		);
		const noteEl = this.root.querySelector("#inventory-equipped-note");

		if (!entry || !nameEl || !metaEl || !equipBtn || !noteEl) return;

		const unlocked = isCarUnlocked(entry.id);
		const equipped = entry.id === getEquippedCarId();
		const rarity = getCarRarity(entry.id);

		nameEl.textContent = t(entry.nameKey as never);
		metaEl.textContent = unlocked
			? t(`inventory.rarity.${rarity}` as never)
			: t("inventory.locked");

		equipBtn.disabled = !unlocked || equipped;
		equipBtn.classList.toggle("inventory-detail__equip--muted", equipped);
		noteEl.classList.toggle("hidden", !equipped);
	}

	private bindKeyboard(): void {
		if (this.keyHandler) return;
		this.keyHandler = (e: KeyboardEvent) => {
			if (!this.visible) return;
			if (e.key === "Escape") {
				e.preventDefault();
				this.hide();
			}
		};
		window.addEventListener("keydown", this.keyHandler);
	}
}
