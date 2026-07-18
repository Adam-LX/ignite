import { getAllArenaIds, getArenaCatalogSync, loadArenaCatalog } from "../arena/ArenaCatalog";
import type { ArenaDefinition } from "../arena/ArenaDefinition";
import { getPerimeterEdgesForDefinition } from "../arena/ArenaDefinition";
import { ArenaRuntime } from "../arena/ArenaRuntime";
import { t } from "../i18n";
import { applyStaticI18n } from "../i18n/staticDom";
import {
	type CosmeticKind,
	isCarBodyCosmeticKind,
	type CosmeticRef,
	getCosmeticNameKey,
	getCosmeticRarity,
	getDecalEntry,
	getInstanceDisplayRarity,
	getPaintDisplayRarity,
	getPaintRarityLabelKey,
	getTopperEntry,
	getTrailEntry,
	getWheelEntry,
	listCatalogIds,
	loadItemCatalog,
	makeCosmeticRef,
	provenanceLineKey,
} from "../meta/CosmeticCatalog";
import {
	getCarCatalogSync,
	loadCarCatalog,
	resolveWheelIdForCar,
} from "../meta/CarCatalog";
import { getTraitsForCar } from "../meta/carBodyTraits";
import {
	getTeamPit,
	setTeamPitFocus,
	setTeamPitSlot,
	syncTeamPitEquippedCar,
	type TeamPitSlotIndex,
} from "../meta/teamPit";
import { getPaintEntry, getPaintRarity, loadPaintCatalog } from "../meta/PaintCatalog";
import {
	applyCarBodyCosmeticToAllUnlockedCars,
	copyCarBodyLoadout,
	countNewCosmetics,
	equipCar,
	equipCosmetic,
	getEquippedCarId,
	getEquippedCosmetic,
	getEquippedSlot,
	getGarageCustomizeCarId,
	getInstanceProvenance,
	getUnlockedInstances,
	isCarUnlocked,
	isCosmeticNew,
	isCosmeticUnlocked,
	markCosmeticSeen,
	setGarageCustomizeCarId,
	swapCarBodyLoadoutBetweenCars,
	unlockCosmetic,
} from "../meta/PlayerInventory";
import { paintCssHex, paintTrailCssGradient } from "../visual/applyPaintCosmetic";
import type { CarCosmeticLoadout } from "../visual/carCosmetics";
import { getEquippedCarLoadout } from "../visual/carCosmetics";
import {
	clearCarThumbnailCache,
	mountCarThumbnail,
	mountGlbThumbnail,
	primeCarThumbnails,
	primeGlbThumbnails,
} from "./carThumbnail";
import {
	GARAGE_COMPOSITOR_WARM_FRAMES,
	GARAGE_TRANSITION_SETTLE_FRAMES,
} from "./LiveMainMenuScene";

export type GarageTab =
	| "cars"
	| "collection"
	| "trails"
	| "wheels"
	| "toppers"
	| "decals"
	| "goalExplosions"
	| "arenas";

type GarageFilter = "all" | "common" | "rare" | "epic" | "legendary" | "painted";

const GARAGE_TABS: GarageTab[] = [
	"cars",
	"collection",
	"trails",
	"wheels",
	"toppers",
	"decals",
	"goalExplosions",
	"arenas",
];

const TAB_I18N: Record<GarageTab, string> = {
	cars: "garage.tab.cars",
	collection: "garage.tab.collection",
	trails: "garage.tab.trails",
	wheels: "garage.tab.wheels",
	toppers: "garage.tab.toppers",
	decals: "garage.tab.decals",
	goalExplosions: "garage.tab.goalFx",
	arenas: "garage.tab.arenas",
};

const TAB_ICON: Record<GarageTab, string> = {
	cars: sidebarSvg(
		`<path d="M4.5 12 6.2 7h11.6L19.5 12V18h-2.5v-2.2H7v2.2H4.5V12Zm2.8 0h9.4l-1-3.2H8.3l-1 3.2ZM7.8 16.2a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Zm8.4 0a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z" fill="currentColor"/>`,
	),
	collection: sidebarSvg(
		`<path d="M4 5.5h16v3H4v-3Zm0 5h16v3H4v-3Zm0 5h16v3H4v-3Z" fill="currentColor"/>`,
	),
	trails: sidebarSvg(
		`<path d="M3.5 12c3.5-6.5 5.5-6.5 8.5 0s5 6.5 8.5 0" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="currentColor"/>`,
	),
	wheels: sidebarSvg(
		`<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.8"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M12 3.5v3.5M12 17v3.5M3.5 12h3.5M17 12h3.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
	),
	toppers: sidebarSvg(
		`<path d="M12 3.5 20.5 19H3.5L12 3.5Zm0 5.8 3.5 7.2H8.5L12 9.3Z" fill="currentColor"/>`,
	),
	decals: sidebarSvg(
		`<path d="M5.5 5.5h13v13h-13v-13Zm2 2v9h9v-9h-9Zm2 2h5v5h-5v-5Z" fill="currentColor"/>`,
	),
	goalExplosions: sidebarSvg(
		`<path d="M12 2.5 13.8 7.5H19l-4.2 3.1 1.6 5L12 12.2 7.6 15.6l1.6-5L5 7.5h5.2L12 2.5Z" fill="currentColor"/>`,
	),
	arenas: sidebarSvg(
		`<path d="M4.5 4.5h15v15h-15v-15Zm2.5 2.5v10h10v-10h-10Zm2 2h6v6h-6v-6Z" fill="currentColor"/>`,
	),
};

const TILE_GLYPH: Record<CosmeticKind, string> = {
	trail: tileGlyph(
		`<path d="M3 12c4-7 6-7 9 0s5 7 9 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/>`,
	),
	wheel: tileGlyph(
		`<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
	),
	topper: tileGlyph(
		`<path d="M12 2.5 21 20H3L12 2.5Zm0 6.5 4 8.5H8l4-8.5Z" fill="currentColor"/>`,
	),
	decal: tileGlyph(
		`<path d="M4 4h16v16H4V4Zm3 3v10h10V7H7Zm2.5 2.5h5v5h-5v-5Z" fill="currentColor"/>`,
	),
	goalExplosion: tileGlyph(
		`<path d="M12 2 14.2 8H21l-5.2 3.8 2 6.2L12 13.5 6 18l2-6.2L2.8 8H9.8L12 2Z" fill="currentColor"/>`,
	),
	car: tileGlyph(
		`<path d="M4 13 6 8h12l2 5v5h-2.5v-2H6.5v2H4v-5Zm2.5 0h11l-1-3.5H7.5l-1 3.5Z" fill="currentColor"/>`,
	),
	arena: tileGlyph(
		`<path d="M4 4h16v16H4V4Zm3 3v10h10V7H7Zm2 2h6v6H9V9Z" fill="currentColor"/>`,
	),
};

function sidebarSvg(inner: string): string {
	return `<svg class="garage-sidebar__svg" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
}

function tileGlyph(inner: string): string {
	return `<svg class="garage-tile__glyph" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
}

const TAB_KIND: Partial<Record<GarageTab, CosmeticKind>> = {
	trails: "trail",
	wheels: "wheel",
	toppers: "topper",
	decals: "decal",
	goalExplosions: "goalExplosion",
};

const FILTER_KEYS: GarageFilter[] = [
	"all",
	"common",
	"rare",
	"epic",
	"legendary",
	"painted",
];

function waitCompositorFrames(count = 2): Promise<void> {
	return new Promise((resolve) => {
		let left = count;
		const step = () => {
			left -= 1;
			if (left <= 0) {
				resolve();
				return;
			}
			requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	});
}

export type LoadoutChangeListener = (change: {
	kind: CosmeticKind | "car" | "arena";
	id: string;
	paintId: string | null;
	equipped: boolean;
}) => void;

/** Garaż RL — sidebar kategorii, wyszukiwarka, instancje z paint chip. */
export class LoadoutOverlay {
	private readonly root: HTMLElement;
	private visible = false;
	private onClose: (() => void) | null = null;
	private onAfterHide: (() => void) | null = null;
	private onPrepareShow: (() => void) | null = null;
	private onEnterGarageScene: (() => void) | null = null;
	private onShow: (() => void) | null = null;
	private onGarageUiOpened: (() => void) | null = null;
	private onChange: LoadoutChangeListener | null = null;
	private previewRef: CosmeticRef | null = null;
	private activeTab: GarageTab = "cars";
	private searchQuery = "";
	private activeFilter: GarageFilter = "all";
	private searchDebounce = 0;
	private keyHandler: ((e: KeyboardEvent) => void) | null = null;

	constructor() {
		const el = document.createElement("div");
		el.id = "loadout-overlay";
		el.className = "garage-overlay hidden";
		el.setAttribute("role", "dialog");
		el.setAttribute("aria-modal", "true");
		el.setAttribute("aria-labelledby", "garage-title");
		document.body.appendChild(el);
		this.root = el;
		this.renderShell();
	}

	setOnClose(fn: () => void): void {
		this.onClose = fn;
	}

	setOnAfterHide(fn: () => void): void {
		this.onAfterHide = fn;
	}

	setOnGarageUiOpened(fn: () => void): void {
		this.onGarageUiOpened = fn;
	}

	setOnPrepareShow(fn: () => void): void {
		this.onPrepareShow = fn;
	}

	setOnEnterGarageScene(fn: () => void): void {
		this.onEnterGarageScene = fn;
	}

	setOnShow(fn: () => void): void {
		this.onShow = fn;
	}

	setOnChange(fn: LoadoutChangeListener): void {
		this.onChange = fn;
	}

	isVisible(): boolean {
		return this.visible;
	}

	/** Podgląd 3D w garażu — equipped + kliknięty item (nawet zablokowany). */
	getPreviewLoadout(carId?: string): CarCosmeticLoadout {
		const id = carId ?? getGarageCustomizeCarId();
		const loadout = getEquippedCarLoadout(id);
		const ref = this.previewRef;
		if (!ref) return loadout;

		if (ref.kind === "wheel") {
			return {
				...loadout,
				wheelId: resolveWheelIdForCar(id, ref.itemId),
				paint: { ...loadout.paint, wheel: ref.paintId },
			};
		}
		if (ref.kind === "topper") {
			return {
				...loadout,
				topperId: ref.itemId,
				paint: { ...loadout.paint, topper: ref.paintId },
			};
		}
		if (ref.kind === "decal") {
			return {
				...loadout,
				decalId: ref.itemId,
				paint: { ...loadout.paint, decal: ref.paintId },
			};
		}
		return loadout;
	}

	async show(focus?: CosmeticRef): Promise<void> {
		await Promise.all([
			loadCarCatalog(),
			loadArenaCatalog(),
			loadItemCatalog(),
			loadPaintCatalog(),
		]);
		clearCarThumbnailCache();
		const {
			unlockGarageCosmeticsForDev,
			unlockAllGarageCarsForDev,
		} = await import("../meta/devGarageUnlock");
		if (import.meta.env.DEV) unlockGarageCosmeticsForDev();
		/** Karoserie zawsze odblokowane w garażu — klik = jazda w meczu. */
		await unlockAllGarageCarsForDev();
		const equippedCar = getEquippedCosmetic("car");
		setGarageCustomizeCarId(equippedCar.itemId);
		this.previewRef = focus ?? equippedCar;
		if (focus) {
			this.activeTab = this.tabForKind(focus.kind);
		} else {
			this.activeTab = "cars";
			this.previewRef = equippedCar;
		}
		this.searchQuery = "";
		this.activeFilter = "all";
		document.body.classList.add("garage-entering");
		this.onPrepareShow?.();
		await waitCompositorFrames(GARAGE_COMPOSITOR_WARM_FRAMES);
		this.onEnterGarageScene?.();
		await waitCompositorFrames(GARAGE_TRANSITION_SETTLE_FRAMES);
		document.body.classList.remove("garage-entering");
		this.visible = true;
		document.body.classList.add("garage-open");
		this.root.classList.remove("hidden");
		this.root.classList.add("garage-overlay--open");
		this.bindKeyboard();
		this.onShow?.();
		this.onGarageUiOpened?.();
		await this.refresh();
		this.root.querySelector<HTMLButtonElement>("[data-garage-close]")?.focus();
	}

	hide(): void {
		if (!this.visible) return;
		this.visible = false;
		this.unbindKeyboard();
		document.body.classList.remove("garage-open");
		this.root.classList.remove("garage-overlay--open");
		this.root.classList.add("hidden");
		setGarageCustomizeCarId(null);
		void this.finishGarageHide();
	}

	private async finishGarageHide(): Promise<void> {
		document.body.classList.add("garage-entering");
		await waitCompositorFrames(GARAGE_COMPOSITOR_WARM_FRAMES);
		this.onClose?.();
		await waitCompositorFrames(GARAGE_TRANSITION_SETTLE_FRAMES);
		document.body.classList.remove("garage-entering");
		this.onAfterHide?.();
	}

	private tabForKind(kind: CosmeticKind): GarageTab {
		switch (kind) {
			case "car":
				return "cars";
			case "arena":
				return "arenas";
			case "trail":
				return "trails";
			case "wheel":
				return "wheels";
			case "topper":
				return "toppers";
			case "decal":
				return "decals";
			case "goalExplosion":
				return "goalExplosions";
		}
	}

	private kindForTab(tab: GarageTab): CosmeticKind | null {
		if (tab === "cars") return "car";
		if (tab === "arenas") return "arena";
		if (tab === "collection") return null;
		return TAB_KIND[tab] ?? null;
	}

	private renderShell(): void {
		const sidebar = GARAGE_TABS.map(
			(tab) =>
				`<button type="button" class="garage-sidebar__btn${tab === "cars" ? " garage-sidebar__btn--active" : ""}" data-garage-tab="${tab}" title="${t(TAB_I18N[tab] as never)}" aria-label="${t(TAB_I18N[tab] as never)}">${TAB_ICON[tab]}</button>`,
		).join("");

		const filters = FILTER_KEYS.map(
			(f) =>
				`<button type="button" class="garage-filter__chip${f === "all" ? " garage-filter__chip--active" : ""}" data-garage-filter="${f}">${t(`garage.filter.${f}` as never)}</button>`,
		).join("");

		this.root.innerHTML = `
      <div class="garage-overlay__vignette" aria-hidden="true"></div>
      <header class="garage-top garage-top--sidebar">
        <div class="garage-top__brand">
          <p class="garage-top__kicker" data-i18n="garage.kicker">${t("garage.kicker")}</p>
          <h2 id="garage-title" data-i18n="garage.title">${t("garage.title")}</h2>
          <span class="garage-top__new" data-garage-new hidden></span>
        </div>
        <label class="garage-search">
          <span class="garage-search__icon" aria-hidden="true">🔍</span>
          <input type="search" class="garage-search__input" data-garage-search placeholder="${t("garage.searchPlaceholder")}" autocomplete="off" />
        </label>
      </header>
      <div class="garage-layout">
        <nav class="garage-sidebar" role="tablist" aria-orientation="vertical">${sidebar}</nav>
        <div class="garage-main">
          <div class="garage-hero" aria-live="polite">
            <div class="garage-hero__plate">
              <p class="garage-hero__label" data-garage-hero-label>${t("garage.detail")}</p>
              <h3 class="garage-hero__name" data-garage-hero-name>—</h3>
              <p class="garage-hero__meta" data-garage-hero-meta></p>
              <div class="garage-hero__actions" data-garage-car-actions hidden>
                <button type="button" class="garage-hero__action garage-hero__action--primary" data-garage-use-car>${t("garage.useInMatch")}</button>
              </div>
              <div class="garage-hero__actions" data-garage-body-actions hidden>
                <button type="button" class="garage-hero__action" data-garage-apply-all>${t("garage.applyBodyToAll")}</button>
                <button type="button" class="garage-hero__action" data-garage-copy-equipped>${t("garage.copyFromEquipped")}</button>
                <button type="button" class="garage-hero__action" data-garage-swap-equipped>${t("garage.swapWithEquipped")}</button>
              </div>
            </div>
          </div>
          <div class="garage-pit" data-garage-pit hidden>
            <p class="garage-pit__label" data-i18n="garage.pit.label">${t("garage.pit.label")}</p>
            <div class="garage-pit__slots" data-garage-pit-slots role="list"></div>
          </div>
          <div class="garage-filters" role="group" aria-label="${t("garage.filter.all")}">${filters}</div>
          <div class="garage-inventory" data-garage-inventory>
            <div class="garage-dock-wrap">
              <footer class="garage-dock garage-dock--grid">
                <div class="garage-dock__grid" data-garage-grid role="list"></div>
              </footer>
            </div>
            <p class="garage-hint" data-garage-hint data-i18n="garage.hintLive">${t("garage.hintLive")}</p>
          </div>
        </div>
      </div>
      <footer class="garage-back-dock">
        <button type="button" class="ui-ignite-back" data-garage-close aria-label="${t("ui.back")}">
          <span class="ui-ignite-back__shine" aria-hidden="true"></span>
          <span class="ui-ignite-back__icon" aria-hidden="true">←</span>
          <span class="ui-ignite-back__label" data-i18n="ui.back">${t("ui.back")}</span>
        </button>
      </footer>`;

		this.root
			.querySelector("[data-garage-close]")
			?.addEventListener("click", () => this.hide());

		this.root
			.querySelector("[data-garage-use-car]")
			?.addEventListener("click", () => this.activatePreviewCar());

		this.root
			.querySelector("[data-garage-apply-all]")
			?.addEventListener("click", () => this.applyBodyCosmeticToAllCars());

		this.root
			.querySelector("[data-garage-copy-equipped]")
			?.addEventListener("click", () => this.copyBodyLoadoutFromEquipped());

		this.root
			.querySelector("[data-garage-swap-equipped]")
			?.addEventListener("click", () => this.swapBodyLoadoutWithEquipped());

		this.root
			.querySelector<HTMLInputElement>("[data-garage-search]")
			?.addEventListener("input", (e) => {
				const val = (e.target as HTMLInputElement).value;
				window.clearTimeout(this.searchDebounce);
				this.searchDebounce = window.setTimeout(() => {
					this.searchQuery = val.trim().toLowerCase();
					void this.refresh();
				}, 150);
			});

		for (const tab of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-garage-tab]",
		)) {
			tab.addEventListener("click", () => {
				const next = tab.dataset.garageTab as GarageTab | undefined;
				if (!next || next === this.activeTab) return;
				this.activeTab = next;
				const kind = this.kindForTab(next);
				if (kind) {
					this.previewRef = isCarBodyCosmeticKind(kind)
						? getEquippedCosmetic(kind, getGarageCustomizeCarId())
						: getEquippedCosmetic(kind);
				}
				void this.refresh().then(() => this.notifyGaragePreview());
			});
		}

		for (const chip of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-garage-filter]",
		)) {
			chip.addEventListener("click", () => {
				const f = chip.dataset.garageFilter as GarageFilter | undefined;
				if (!f || f === this.activeFilter) return;
				this.activeFilter = f;
				void this.refresh();
			});
		}
	}

	private garageEntriesForTab(tab: GarageTab): CosmeticRef[] {
		if (tab === "collection") {
			return getUnlockedInstances().filter(
				(ref) => this.matchesSearch(ref) && this.matchesFilter(ref),
			);
		}
		const kind = this.kindForTab(tab);
		if (!kind) return [];

		const unlocked = getUnlockedInstances(kind);
		const catalogIds =
			tab === "cars"
				? getCarCatalogSync().cars.map((c) => c.id)
				: tab === "arenas"
					? getAllArenaIds()
					: listCatalogIds(kind);

		const result: CosmeticRef[] = [...unlocked];
		const ownedItems = new Set(unlocked.map((i) => i.itemId));
		for (const itemId of catalogIds) {
			if (!ownedItems.has(itemId)) {
				result.push(makeCosmeticRef(kind, itemId, null));
			}
		}
		return result;
	}

	private matchesSearch(ref: CosmeticRef): boolean {
		if (!this.searchQuery) return true;
		const itemName = t(getCosmeticNameKey(ref) as never).toLowerCase();
		if (itemName.includes(this.searchQuery)) return true;
		if (ref.paintId) {
			const paint = getPaintEntry(ref.paintId);
			if (paint) {
				const paintName = t(paint.nameKey as never).toLowerCase();
				if (paintName.includes(this.searchQuery)) return true;
			}
			if (ref.paintId.includes(this.searchQuery)) return true;
		}
		const rarity = t(
			`inventory.rarity.${getInstanceDisplayRarity(ref)}` as never,
		).toLowerCase();
		return rarity.includes(this.searchQuery);
	}

	private matchesFilter(ref: CosmeticRef): boolean {
		if (this.activeFilter === "all") return true;
		if (this.activeFilter === "painted") return ref.paintId !== null;
		return getInstanceDisplayRarity(ref) === this.activeFilter;
	}

	private filteredEntries(tab: GarageTab): CosmeticRef[] {
		if (tab === "collection") {
			return this.garageEntriesForTab(tab);
		}
		return this.garageEntriesForTab(tab).filter(
			(ref) => this.matchesSearch(ref) && this.matchesFilter(ref),
		);
	}

	private isEquipped(ref: CosmeticRef): boolean {
		if (ref.kind === "car") {
			return (
				getEquippedCarId() === ref.itemId &&
				getEquippedCosmetic("car").paintId === (ref.paintId ?? null)
			);
		}
		const slot = isCarBodyCosmeticKind(ref.kind)
			? getEquippedSlot(ref.kind, getGarageCustomizeCarId())
			: getEquippedSlot(ref.kind);
		return slot.itemId === ref.itemId && slot.paintId === ref.paintId;
	}

	private async refresh(): Promise<void> {
		applyStaticI18n(this.root);

		for (const tab of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-garage-tab]",
		)) {
			const active = tab.dataset.garageTab === this.activeTab;
			tab.classList.toggle("garage-sidebar__btn--active", active);
			tab.setAttribute("aria-selected", active ? "true" : "false");
		}

		for (const chip of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-garage-filter]",
		)) {
			chip.classList.toggle(
				"garage-filter__chip--active",
				chip.dataset.garageFilter === this.activeFilter,
			);
		}

		const newCount = countNewCosmetics();
		const newEl = this.root.querySelector<HTMLElement>("[data-garage-new]");
		if (newEl) {
			if (newCount > 0) {
				newEl.hidden = false;
				newEl.textContent = t("garage.newCount", { count: newCount });
			} else {
				newEl.hidden = true;
			}
		}

		const grid = this.root.querySelector("[data-garage-grid]");
		if (!grid) return;

		const entries = this.filteredEntries(this.activeTab);
		if (
			this.previewRef &&
			!entries.some(
				(e) =>
					e.itemId === this.previewRef!.itemId &&
					e.paintId === this.previewRef!.paintId,
			)
		) {
			this.previewRef = entries[0] ?? null;
		}

		grid.replaceChildren(
			...entries.map((ref) => this.renderInstanceTile(ref)),
		);
		this.mountTileThumbnails(entries);
		void this.primeVisibleThumbnails(entries);
		this.updateHero(this.previewRef ?? entries[0] ?? null);
		this.updateCarActions();
		this.updateBodyCosmeticActions();
		this.refreshPitStrip();

		const selected = grid.querySelector<HTMLElement>(".garage-tile--selected");
		selected?.scrollIntoView({
			inline: "nearest",
			block: "nearest",
			behavior: "smooth",
		});
	}

	private refreshPitStrip(): void {
		const pitRoot = this.root.querySelector<HTMLElement>("[data-garage-pit]");
		const slotsEl = this.root.querySelector("[data-garage-pit-slots]");
		if (!pitRoot || !slotsEl) return;
		const show = this.activeTab === "cars";
		pitRoot.hidden = !show;
		if (!show) return;

		const pit = getTeamPit();
		slotsEl.replaceChildren();
		pit.slots.forEach((carId, index) => {
			const slot = index as TeamPitSlotIndex;
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = `garage-pit__slot${pit.focusSlot === slot ? " garage-pit__slot--focus" : ""}${getEquippedCarId() === carId && slot === 0 ? " garage-pit__slot--match" : ""}`;
			btn.setAttribute("role", "listitem");
			btn.dataset.pitSlot = String(slot);
			const name =
				getCarCatalogSync().cars.find((c) => c.id === carId)?.nameKey ??
				carId;
			btn.innerHTML = `
        <span class="garage-pit__slot-index">${slot + 1}</span>
        <span class="garage-pit__slot-thumb" data-pit-thumb></span>
        <span class="garage-pit__slot-name">${t(name as never)}</span>`;
			btn.addEventListener("click", () => this.focusPitSlot(slot));
			slotsEl.appendChild(btn);
			const thumb = btn.querySelector<HTMLElement>("[data-pit-thumb]");
			if (thumb) void mountCarThumbnail(thumb, carId);
		});
	}

	private focusPitSlot(slot: TeamPitSlotIndex): void {
		const state = setTeamPitFocus(slot);
		const carId = state.slots[slot];
		setGarageCustomizeCarId(carId);
		const paintId = getEquippedCosmetic("car").paintId;
		this.previewRef = makeCosmeticRef("car", carId, paintId);
		this.activeTab = "cars";
		this.onChange?.({
			kind: "car",
			id: carId,
			paintId,
			equipped: getEquippedCarId() === carId,
		});
		void this.refresh();
	}

	private bindKeyboard(): void {
		if (this.keyHandler) return;
		this.keyHandler = (e: KeyboardEvent) => {
			if (!this.visible) return;
			if (e.key === "Escape") {
				e.preventDefault();
				this.hide();
				return;
			}
			if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
				const tag = (e.target as HTMLElement | null)?.tagName;
				if (tag === "INPUT" || tag === "TEXTAREA") return;
				e.preventDefault();
				this.cycleSelection(e.key === "ArrowRight" ? 1 : -1);
			}
			if (e.key === "Enter" && this.activeTab === "cars") {
				const tag = (e.target as HTMLElement | null)?.tagName;
				if (tag === "INPUT" || tag === "TEXTAREA") return;
				e.preventDefault();
				this.activatePreviewCar();
			}
		};
		window.addEventListener("keydown", this.keyHandler);
	}

	private unbindKeyboard(): void {
		if (!this.keyHandler) return;
		window.removeEventListener("keydown", this.keyHandler);
		this.keyHandler = null;
	}

	private cycleSelection(delta: number): void {
		const entries = this.filteredEntries(this.activeTab);
		if (entries.length === 0) return;
		const current = this.previewRef;
		let idx = entries.findIndex(
			(e) =>
				e.itemId === current?.itemId && e.paintId === current?.paintId,
		);
		if (idx < 0) idx = 0;
		const next =
			entries[(idx + delta + entries.length) % entries.length]!;
		this.selectRef(next);
	}

	/** Wymusza aktywną karoserię z podglądu (przycisk / Enter). */
	private activatePreviewCar(): void {
		const ref =
			this.previewRef?.kind === "car"
				? this.previewRef
				: getEquippedCosmetic("car");
		if (ref.kind !== "car") return;
		const equipped = equipCar(ref.itemId, ref.paintId ?? null);
		syncTeamPitEquippedCar(ref.itemId);
		setGarageCustomizeCarId(ref.itemId);
		this.previewRef = makeCosmeticRef("car", ref.itemId, ref.paintId ?? null);
		this.onChange?.({
			kind: "car",
			id: ref.itemId,
			paintId: ref.paintId,
			equipped,
		});
		this.flashHint(equipped ? "garage.activeInMatch" : "garage.lockedPreview");
		console.info(
			`[Ignite] Garaż → aktywne auto: ${getEquippedCarId()} (equip=${equipped})`,
		);
		void this.refresh();
	}

	private updateCarActions(): void {
		const actions = this.root.querySelector<HTMLElement>(
			"[data-garage-car-actions]",
		);
		const useBtn = this.root.querySelector<HTMLButtonElement>(
			"[data-garage-use-car]",
		);
		if (!actions) return;
		const show = this.activeTab === "cars";
		actions.hidden = !show;
		if (!useBtn || !show) return;
		const active = getEquippedCarId();
		const previewId = this.previewRef?.kind === "car" ? this.previewRef.itemId : active;
		useBtn.textContent =
			previewId === active
				? t("garage.activeInMatch")
				: t("garage.useInMatch");
		useBtn.disabled = previewId === active;
	}

	private notifyGaragePreview(): void {
		if (!this.visible || !this.onChange) return;
		const ref = this.previewRef;
		if (!ref) return;
		if (ref.kind === "car" || ref.kind === "arena" || ref.kind === "trail") return;
		if (!isCarBodyCosmeticKind(ref.kind)) return;
		this.onChange({
			kind: ref.kind,
			id: ref.itemId,
			paintId: ref.paintId,
			equipped: this.isEquipped(ref),
		});
	}

	private isBodyCosmeticTab(): boolean {
		const kind = this.kindForTab(this.activeTab);
		return kind != null && isCarBodyCosmeticKind(kind);
	}

	private updateBodyCosmeticActions(): void {
		const actions = this.root.querySelector<HTMLElement>(
			"[data-garage-body-actions]",
		);
		const copyBtn = this.root.querySelector<HTMLButtonElement>(
			"[data-garage-copy-equipped]",
		);
		const swapBtn = this.root.querySelector<HTMLButtonElement>(
			"[data-garage-swap-equipped]",
		);
		if (!actions) return;

		const show = this.isBodyCosmeticTab();
		actions.hidden = !show;
		if (!show) return;

		const customizeId = getGarageCustomizeCarId();
		const matchId = getEquippedCarId();
		const customizeName = this.carDisplayName(customizeId);
		const matchName = this.carDisplayName(matchId);

		const labelEl = this.root.querySelector("[data-garage-hero-label]");
		if (labelEl) {
			labelEl.textContent =
				customizeId === matchId
					? t("garage.customizeActiveCar", { car: customizeName })
					: t("garage.customizeCar", { car: customizeName });
		}

		if (copyBtn) {
			copyBtn.textContent = t("garage.copyFromEquipped", { car: matchName });
			copyBtn.disabled = customizeId === matchId;
		}
		if (swapBtn) {
			swapBtn.textContent = t("garage.swapWithEquipped", { car: matchName });
			swapBtn.disabled = customizeId === matchId;
		}
	}

	private carDisplayName(carId: string): string {
		const entry = getCarCatalogSync().cars.find((c) => c.id === carId);
		return entry ? t(entry.nameKey as never) : carId;
	}

	private applyBodyCosmeticToAllCars(): void {
		const kind = this.kindForTab(this.activeTab);
		if (!kind || !isCarBodyCosmeticKind(kind)) return;
		const slot = getEquippedSlot(kind, getGarageCustomizeCarId());
		const ref = makeCosmeticRef(kind, slot.itemId, slot.paintId);
		if (!isCosmeticUnlocked(ref)) {
			this.flashHint("garage.lockedPreview");
			return;
		}
		applyCarBodyCosmeticToAllUnlockedCars(ref);
		this.onChange?.({
			kind,
			id: slot.itemId,
			paintId: slot.paintId,
			equipped: true,
		});
		void this.refresh();
	}

	private copyBodyLoadoutFromEquipped(): void {
		const customize = getGarageCustomizeCarId();
		const equipped = getEquippedCarId();
		if (customize === equipped) return;
		copyCarBodyLoadout(equipped, customize);
		this.onChange?.({
			kind: "wheel",
			id: getEquippedSlot("wheel", customize).itemId,
			paintId: getEquippedSlot("wheel", customize).paintId,
			equipped: true,
		});
		void this.refresh();
	}

	private swapBodyLoadoutWithEquipped(): void {
		const customize = getGarageCustomizeCarId();
		const equipped = getEquippedCarId();
		if (customize === equipped) return;
		swapCarBodyLoadoutBetweenCars(customize, equipped);
		this.onChange?.({
			kind: "wheel",
			id: getEquippedSlot("wheel", customize).itemId,
			paintId: getEquippedSlot("wheel", customize).paintId,
			equipped: true,
		});
		void this.refresh();
	}

	private updateHero(ref: CosmeticRef | null): void {
		const nameEl = this.root.querySelector("[data-garage-hero-name]");
		const metaEl = this.root.querySelector("[data-garage-hero-meta]");
		const labelEl = this.root.querySelector("[data-garage-hero-label]");
		if (!ref || !nameEl || !metaEl || !labelEl) return;

		labelEl.textContent = t(TAB_I18N[this.activeTab] as never);
		nameEl.textContent = t(getCosmeticNameKey(ref) as never);
		metaEl.innerHTML = "";

		const itemRarity = getCosmeticRarity(ref);
		const paintTier = ref.paintId ? getPaintDisplayRarity(ref) : null;
		const rarityEl = document.createElement("span");
		rarityEl.className = `garage-hero__rarity garage-hero__rarity--${itemRarity}`;
		rarityEl.textContent = t(`inventory.rarity.${itemRarity}` as never);
		metaEl.appendChild(rarityEl);

		if (paintTier && ref.paintId) {
			const paintRarityEl = document.createElement("span");
			paintRarityEl.className = `garage-hero__rarity garage-hero__rarity--${paintTier} garage-hero__rarity--paint-tier`;
			paintRarityEl.textContent = t(getPaintRarityLabelKey(ref.paintId) as never);
			metaEl.appendChild(paintRarityEl);
		}

		if (ref.paintId) {
			const paint = getPaintEntry(ref.paintId);
			const swatch = document.createElement("span");
			swatch.className = "garage-hero__paint";
			const hex = paintCssHex(ref.paintId);
			if (hex) swatch.style.background = hex;
			swatch.title = paint ? t(paint.nameKey as never) : ref.paintId;
			metaEl.appendChild(swatch);
			const paintLabel = document.createElement("span");
			paintLabel.className = "garage-hero__paint-label";
			paintLabel.textContent = paint
				? t(paint.nameKey as never)
				: ref.paintId;
			metaEl.appendChild(paintLabel);
		} else if (ref.kind !== "arena") {
			const std = document.createElement("span");
			std.className = "garage-hero__paint-label garage-hero__paint-label--muted";
			std.textContent = t("garage.unpainted");
			metaEl.appendChild(std);
		}

		const unlocked =
			ref.kind === "car" ? isCarUnlocked(ref.itemId) : isCosmeticUnlocked(ref);
		if (isCosmeticNew(ref)) {
			const badge = document.createElement("span");
			badge.className = "garage-hero__badge garage-hero__badge--new";
			badge.textContent = t("garage.new");
			metaEl.appendChild(badge);
		}
		if (ref.kind === "car" && getEquippedCarId() === ref.itemId) {
			const badge = document.createElement("span");
			badge.className = "garage-hero__badge";
			badge.textContent = t("garage.activeInMatch");
			metaEl.appendChild(badge);
		} else if (this.isEquipped(ref)) {
			const badge = document.createElement("span");
			badge.className = "garage-hero__badge";
			badge.textContent = t("garage.equipped");
			metaEl.appendChild(badge);
		} else if (!unlocked) {
			const badge = document.createElement("span");
			badge.className = "garage-hero__badge garage-hero__badge--locked";
			badge.textContent = t("garage.locked");
			metaEl.appendChild(badge);
		}

		if (ref.kind === "arena") {
			const entry = getArenaCatalogSync().arenas.find(
				(a) => a.id === ref.itemId,
			);
			if (entry) {
				const dims = document.createElement("span");
				dims.className = "garage-hero__dims";
				dims.textContent = `${entry.dimensions.width}×${entry.dimensions.length} m`;
				metaEl.appendChild(dims);
			}
		}

		if (ref.kind === "car") {
			const traits = getTraitsForCar(ref.itemId);
			const traitEl = document.createElement("p");
			traitEl.className = "garage-hero__trait";
			traitEl.textContent = t("garage.traitLine" as never, {
				name: t(traits.traitNameKey as never),
				desc: t(traits.traitDescKey as never),
			});
			metaEl.appendChild(traitEl);
		}

		if (isCosmeticUnlocked(ref)) {
			const prov = getInstanceProvenance(ref);
			const provEl = document.createElement("p");
			provEl.className = "garage-hero__provenance";
			const where = t(provenanceLineKey(prov) as never);
			provEl.textContent = t("collection.provenanceLine" as never, {
				where,
			});
			metaEl.appendChild(provEl);
		}
	}

	private selectRef(ref: CosmeticRef): void {
		const samePreview =
			this.previewRef?.itemId === ref.itemId &&
			this.previewRef?.paintId === ref.paintId;

		/** Karoseria: wybór = model 3D w garażu + auto gracza w meczu. */
		if (ref.kind === "car") {
			const pit = getTeamPit();
			if (pit.focusSlot !== 0) {
				setTeamPitSlot(pit.focusSlot, ref.itemId, { focus: true });
				setGarageCustomizeCarId(ref.itemId);
				this.previewRef = makeCosmeticRef(
					"car",
					ref.itemId,
					ref.paintId ?? null,
				);
				this.onChange?.({
					kind: "car",
					id: ref.itemId,
					paintId: ref.paintId,
					equipped: false,
				});
				this.flashHint("garage.pit.assigned");
				void this.refresh();
				return;
			}

			const alreadyActive =
				getEquippedCarId() === ref.itemId &&
				getEquippedCosmetic("car").paintId === (ref.paintId ?? null);
			if (samePreview && alreadyActive) {
				/** Wymuś odświeżenie hero — czasem UI pokazuje stary GLB. */
				this.onChange?.({
					kind: "car",
					id: ref.itemId,
					paintId: ref.paintId,
					equipped: true,
				});
				return;
			}

			const equipped = equipCar(ref.itemId, ref.paintId ?? null);
			syncTeamPitEquippedCar(ref.itemId);
			setGarageCustomizeCarId(ref.itemId);
			this.previewRef = makeCosmeticRef("car", ref.itemId, ref.paintId ?? null);
			this.onChange?.({
				kind: "car",
				id: ref.itemId,
				paintId: ref.paintId,
				equipped,
			});
			if (!equipped) this.flashHint("garage.lockedPreview");
			else this.flashHint("garage.activeInMatch");
			void this.refresh();
			return;
		}

		if (samePreview && this.isEquipped(ref)) return;

		if (
			import.meta.env.DEV &&
			!isCosmeticUnlocked(ref) &&
			isCarBodyCosmeticKind(ref.kind)
		) {
			unlockCosmetic(ref, false);
		}
		const unlocked = isCosmeticUnlocked(ref);
		const equipped =
			unlocked &&
			!this.isEquipped(ref) &&
			equipCosmetic(
				ref,
				isCarBodyCosmeticKind(ref.kind) ? getGarageCustomizeCarId() : null,
			);
		this.previewRef = ref;
		if (ref.kind === "arena") ArenaRuntime.setActive(ref.itemId);
		markCosmeticSeen(ref);
		this.onChange?.({
			kind: ref.kind,
			id: ref.itemId,
			paintId: ref.paintId,
			equipped: !!equipped,
		});
		if (!unlocked) this.flashHint("garage.lockedPreview");
		void this.refresh();
	}

	private flashHint(messageKey: string): void {
		const hint = this.root.querySelector("[data-garage-hint]");
		if (!hint) return;
		hint.textContent = t(messageKey as never);
		hint.classList.add("garage-hint--flash");
		window.setTimeout(() => hint.classList.remove("garage-hint--flash"), 900);
	}

	private renderInstanceTile(ref: CosmeticRef): HTMLButtonElement {
		const rarity = getInstanceDisplayRarity(ref);
		const unlocked =
			ref.kind === "car" ? isCarUnlocked(ref.itemId) : isCosmeticUnlocked(ref);
		const selected =
			this.previewRef?.itemId === ref.itemId &&
			this.previewRef?.paintId === ref.paintId;
		const equipped = this.isEquipped(ref);
		const equippedLabel =
			ref.kind === "car" ? t("garage.activeInMatch") : t("garage.equipped");
		const name = t(getCosmeticNameKey(ref) as never);
		const paintSuffix =
			ref.paintId && getPaintEntry(ref.paintId)
				? ` · ${t(getPaintEntry(ref.paintId)!.nameKey as never)}`
				: "";

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = `garage-tile garage-tile--${ref.kind} garage-tile--${rarity}`;
		btn.role = "listitem";
		if (!unlocked) btn.classList.add("garage-tile--locked");
		if (selected) btn.classList.add("garage-tile--selected");
		if (equipped) btn.classList.add("garage-tile--equipped");
		if (isCosmeticNew(ref)) btn.classList.add("garage-tile--new");

		const paintBar = ref.paintId
			? `<span class="garage-tile__paint garage-tile__paint--${getPaintRarity(ref.paintId)}" style="background:${paintCssHex(ref.paintId) ?? "#888"}"></span>`
			: `<span class="garage-tile__paint garage-tile__paint--none"></span>`;

		btn.innerHTML = `
      <span class="garage-tile__frame garage-tile__frame--${rarity}">
        <span class="garage-tile__thumb" data-thumb aria-hidden="true"></span>
        ${paintBar}
        ${!unlocked ? '<span class="garage-tile__lock">🔒</span>' : ""}
        ${isCosmeticNew(ref) ? `<span class="garage-tile__new">${t("garage.new")}</span>` : ""}
        ${equipped ? `<span class="garage-tile__equipped">${equippedLabel}</span>` : ""}
      </span>
      <span class="garage-tile__name">${name}${paintSuffix}</span>`;

		const thumbEl = btn.querySelector<HTMLElement>("[data-thumb]");
		if (thumbEl) {
			if (ref.kind === "arena") {
				const entry = getArenaCatalogSync().arenas.find(
					(a) => a.id === ref.itemId,
				);
				thumbEl.className = "garage-tile__map";
				thumbEl.innerHTML = entry ? this.minimapSvg(entry) : "";
			} else {
				thumbEl.className = "garage-tile__thumb garage-tile__thumb--pending";
			}
		}

		btn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.selectRef(ref);
		});
		return btn;
	}

	private mountTileThumbnails(entries: CosmeticRef[]): void {
		const grid = this.root.querySelector("[data-garage-grid]");
		if (!grid) return;
		for (let i = 0; i < entries.length; i += 1) {
			const ref = entries[i]!;
			const btn = grid.children[i] as HTMLElement | undefined;
			const thumb = btn?.querySelector<HTMLElement>("[data-thumb]");
			if (!thumb) continue;
			void this.mountThumbForRef(thumb, ref);
		}
	}

	private async primeVisibleThumbnails(entries: CosmeticRef[]): Promise<void> {
		const carIds = [
			...new Set(
				entries.filter((ref) => ref.kind === "car").map((ref) => ref.itemId),
			),
		];
		const glbPaths = entries
			.map((ref) => this.glbPathForRef(ref))
			.filter((path): path is string => path != null);
		await Promise.all([
			carIds.length > 0 ? primeCarThumbnails(carIds) : Promise.resolve(),
			glbPaths.length > 0 ? primeGlbThumbnails(glbPaths) : Promise.resolve(),
		]);
	}

	private glbPathForRef(ref: CosmeticRef): string | null {
		if (ref.kind === "wheel") return getWheelEntry(ref.itemId)?.glb ?? null;
		if (ref.kind === "topper") return getTopperEntry(ref.itemId)?.glb ?? null;
		return null;
	}

	private catalogColorToCss(value: string): string {
		const raw = value.startsWith("0x") ? value.slice(2) : value;
		return `#${raw}`;
	}

	private async mountThumbForRef(
		thumb: HTMLElement,
		ref: CosmeticRef,
	): Promise<void> {
		if (ref.kind === "arena") return;

		if (ref.kind === "car") {
			thumb.className = "garage-tile__thumb garage-tile__thumb--pending";
			try {
				await mountCarThumbnail(thumb, ref.itemId, ref.paintId);
				thumb.classList.remove("garage-tile__thumb--pending");
				thumb.classList.add("garage-tile__thumb--rendered");
			} catch {
				this.mountFallbackGlyph(thumb, ref);
			}
			return;
		}

		const glbPath = this.glbPathForRef(ref);
		if (glbPath) {
			thumb.className = "garage-tile__thumb garage-tile__thumb--pending";
			try {
				await mountGlbThumbnail(thumb, glbPath);
				thumb.classList.remove("garage-tile__thumb--pending");
				thumb.classList.add("garage-tile__thumb--rendered");
			} catch {
				this.mountFallbackGlyph(thumb, ref);
			}
			return;
		}

		if (ref.kind === "trail") {
			thumb.className = "garage-tile__thumb garage-tile__thumb--trail";
			const painted = ref.paintId ? paintTrailCssGradient(ref.paintId) : null;
			if (painted) {
				thumb.style.background = painted;
			} else {
				const entry = getTrailEntry(ref.itemId);
				if (entry) {
					thumb.style.background = `linear-gradient(135deg, ${this.catalogColorToCss(entry.colors.head)}, ${this.catalogColorToCss(entry.colors.tail)})`;
				}
			}
			thumb.innerHTML = TILE_GLYPH.trail;
			return;
		}

		if (ref.kind === "decal") {
			thumb.className = "garage-tile__thumb garage-tile__thumb--decal";
			const entry = getDecalEntry(ref.itemId);
			if (entry?.tint) {
				const { r, g, b } = entry.tint;
				thumb.style.background = `linear-gradient(160deg, rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, 0.95), rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, 0.35))`;
			}
			thumb.innerHTML = TILE_GLYPH.decal;
			return;
		}

		this.mountFallbackGlyph(thumb, ref);
	}

	private mountFallbackGlyph(thumb: HTMLElement, ref: CosmeticRef): void {
		thumb.replaceChildren();
		thumb.className = `garage-tile__icon garage-tile__icon--${ref.kind}`;
		if (ref.paintId) {
			const hex = paintCssHex(ref.paintId);
			if (hex) thumb.style.color = hex;
		}
		thumb.innerHTML = TILE_GLYPH[ref.kind] ?? tileGlyph("");
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
			.map((e) => {
				const x1 = e.ax - minX + pad;
				const y1 = e.az - minZ + pad;
				const x2 = e.bx - minX + pad;
				const y2 = e.bz - minZ + pad;
				return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
			})
			.join("");
		return `<svg viewBox="0 0 ${w} ${h}" class="arena-minimap" preserveAspectRatio="xMidYMid meet">${lines}</svg>`;
	}
}
