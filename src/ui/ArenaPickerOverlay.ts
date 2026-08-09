import {
	getArenaCatalogSync,
	getArenaEntry,
	loadArenaCatalog,
} from "../arena/ArenaCatalog";
import type { ArenaDefinition } from "../arena/ArenaDefinition";
import { getPerimeterEdgesForDefinition } from "../arena/ArenaDefinition";
import { ArenaRuntime } from "../arena/ArenaRuntime";
import { t } from "../i18n";
import { applyStaticI18n } from "../i18n/staticDom";
import {
	equipArena,
	getEquippedArenaId,
	isArenaUnlocked,
} from "../meta/PlayerInventory";

export type ArenaEquipListener = (arenaId: string) => void;

/** Wybór mapy — grid z minimapą SVG. */
export class ArenaPickerOverlay {
	private readonly root: HTMLElement;
	private visible = false;
	private keyHandler: ((e: KeyboardEvent) => void) | null = null;
	private onClose: (() => void) | null = null;
	private onEquip: ArenaEquipListener | null = null;
	private selectedId: string | null = null;

	constructor() {
		const el = document.createElement("div");
		el.id = "arena-picker-overlay";
		el.className = "inventory-overlay hidden";
		el.setAttribute("role", "dialog");
		el.setAttribute("aria-modal", "true");
		el.setAttribute("aria-labelledby", "arena-picker-title");
		document.body.appendChild(el);
		this.root = el;
		this.renderShell();
	}

	setOnClose(fn: () => void): void {
		this.onClose = fn;
	}

	setOnEquip(fn: ArenaEquipListener): void {
		this.onEquip = fn;
	}

	isVisible(): boolean {
		return this.visible;
	}

	async show(): Promise<void> {
		await loadArenaCatalog();
		this.selectedId = getEquippedArenaId();
		this.visible = true;
		document.body.classList.add("inventory-open");
		this.root.classList.remove("hidden");
		void this.root.offsetWidth;
		this.root.classList.add("inventory-overlay--open");
		await this.refresh();
		this.bindKeyboard();
		this.root.querySelector<HTMLButtonElement>("[data-arena-close]")?.focus();
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
      <div class="inventory-overlay__backdrop" data-arena-close></div>
      <div class="inventory-overlay__panel inventory-overlay__panel--wide">
        <header class="inventory-overlay__header">
          <h2 id="arena-picker-title" data-i18n="arena.picker.title">${t("arena.picker.title")}</h2>
          <button type="button" class="inventory-overlay__close" data-arena-close aria-label="Close">×</button>
        </header>
        <div class="inventory-overlay__body">
          <div class="arena-picker-grid" data-arena-grid></div>
          <aside class="inventory-detail" data-arena-detail></aside>
        </div>
      </div>`;
		this.root
			.querySelector("[data-arena-close]")
			?.addEventListener("click", () => this.hide());
	}

	private bindKeyboard(): void {
		if (this.keyHandler) return;
		this.keyHandler = (e: KeyboardEvent) => {
			if (e.key === "Escape") this.hide();
		};
		window.addEventListener("keydown", this.keyHandler);
	}

	private minimapSvg(arena: ArenaDefinition): string {
		const edges = getPerimeterEdgesForDefinition(arena);
		let minX = Infinity;
		let maxX = -Infinity;
		let minZ = Infinity;
		let maxZ = -Infinity;
		for (const e of edges) {
			for (const p of [
				[e.ax, e.az],
				[e.bx, e.bz],
			] as const) {
				minX = Math.min(minX, p[0]);
				maxX = Math.max(maxX, p[0]);
				minZ = Math.min(minZ, p[1]);
				maxZ = Math.max(maxZ, p[1]);
			}
		}
		const pad = 4;
		const w = maxX - minX + pad * 2;
		const h = maxZ - minZ + pad * 2;
		const lines = edges
			.map(
				(e) =>
					`<line x1="${e.ax - minX + pad}" y1="${e.az - minZ + pad}" x2="${e.bx - minX + pad}" y2="${e.bz - minZ + pad}" />`,
			)
			.join("");
		return `<svg viewBox="0 0 ${w} ${h}" class="arena-minimap" preserveAspectRatio="xMidYMid meet">${lines}</svg>`;
	}

	private async refresh(): Promise<void> {
		const grid = this.root.querySelector("[data-arena-grid]");
		const detail = this.root.querySelector("[data-arena-detail]");
		if (!grid || !detail) return;

		const arenas = getArenaCatalogSync().arenas;
		const equipped = getEquippedArenaId();
		grid.innerHTML = arenas
			.map((a) => {
				const locked = !isArenaUnlocked(a.id);
				const selected = a.id === (this.selectedId ?? equipped);
				return `
          <button type="button" class="inventory-card arena-card ${selected ? "inventory-card--selected" : ""} ${locked ? "inventory-card--locked" : ""}"
            data-arena-id="${a.id}" ${locked ? "disabled" : ""}>
            <div class="arena-card__map">${this.minimapSvg(a)}</div>
            <span class="inventory-card__name">${t(a.nameKey as never)}</span>
            ${locked ? `<span class="inventory-card__lock">🔒</span>` : ""}
            ${a.id === equipped ? `<span class="inventory-card__equipped">${t("arena.picker.equipped")}</span>` : ""}
          </button>`;
			})
			.join("");

		for (const btn of grid.querySelectorAll<HTMLButtonElement>(
			"[data-arena-id]",
		)) {
			btn.addEventListener("click", () => {
				const id = btn.dataset.arenaId;
				if (!id || !isArenaUnlocked(id)) return;
				this.selectedId = id;
				void this.refresh();
			});
		}

		const sel = getArenaEntry(this.selectedId ?? equipped);
		if (sel) {
			const d = sel.dimensions;
			detail.innerHTML = `
        <h3>${t(sel.nameKey as never)}</h3>
        <p class="inventory-detail__dims">${d.width}×${d.length} m · ${t("arena.picker.height")} ${d.height} m</p>
        <p class="inventory-detail__desc">${t(`arena.desc.${sel.id}` as never)}</p>
        <button type="button" class="inventory-detail__equip" data-arena-equip ${sel.id === equipped ? "disabled" : ""}>
          ${sel.id === equipped ? t("arena.picker.equipped") : t("arena.picker.select")}
        </button>`;
			detail
				.querySelector("[data-arena-equip]")
				?.addEventListener("click", () => {
					if (equipArena(sel.id)) {
						ArenaRuntime.setActive(sel.id);
						this.onEquip?.(sel.id);
						void this.refresh();
					}
				});
		}
		applyStaticI18n(this.root);
	}
}
