import { getArenaEntry } from "../arena/ArenaCatalog";
import type { GameAudio } from "../audio/GameAudio";
import {
	type GameModeId,
	getLocalizedModeSpec,
	menuModeOrderForDeck,
	modeMenuDeckForMode,
	type ModeMenuDeck,
	parseGameMode,
} from "../game/modes";
import { getModePolicy } from "../game/modePolicy";
import { onLocaleChange, t } from "../i18n";
import { applyStaticI18n } from "../i18n/staticDom";
import { getCarEntry } from "../meta/CarCatalog";
import { countNewCosmetics, getEquippedArenaId, getEquippedCarId } from "../meta/PlayerInventory";
import { getWeeklyMutator } from "../modes/MutatorRegistry";
import {
	fetchOnlineStatus,
	formatOnlineCount,
	resolveMpServerAddress,
} from "../net/serverStatus";
import { GAME_VERSION } from "../util/gameVersion";
import type { CreditsPanel } from "./CreditsPanel";
import type { SettingsOverlay } from "./SettingsOverlay";

const MODE_NAV_INTERVAL_MS = 340;
const SPIN_COOLDOWN_MS = 1400;
const SPIN_COMMIT_DELAY_MS = 160;
/** Out + stagger delay ostatniej karty (nth-child 6 ≈ 225ms). */
const DECK_SWAP_OUT_MS = 720;

type ModeSpinPolicy = "auto" | "always" | "never";

const MODE_ACCENT: Record<GameModeId, string> = {
	"1v1": "duel",
	"2v2": "team",
	"3v3": "team",
	"4v4": "chaos",
	ignitionRush2v2: "ignition",
	meridian2v2: "duel",
	ignition1v1: "ignition",
	ignition: "ignition",
	weeklyLab2v2: "lab",
};

const MODE_ACCENT_GLOW: Record<string, string> = {
	duel: "rgba(77, 168, 255, 0.42)",
	team: "rgba(61, 255, 232, 0.4)",
	chaos: "rgba(176, 108, 255, 0.38)",
	ignition: "rgba(255, 138, 61, 0.4)",
	lab: "rgba(80, 255, 190, 0.45)",
};

export class MainMenu {
	private readonly root: HTMLElement;
	private readonly onStart: (mode: GameModeId) => void;
	private readonly onOnline?: () => void;
	private selected: GameModeId;
	private modeDeck: ModeMenuDeck;
	private startBtn!: HTMLButtonElement;
	private modeIndexEl!: HTMLElement;
	private onlineCountEl!: HTMLElement;
	private deckToggleBtn!: HTMLButtonElement;
	private keyHandler: ((e: KeyboardEvent) => void) | null = null;
	private onlinePollTimer: number | null = null;
	private cardsIntroTimer: number | null = null;
	private spinCommitTimer: number | null = null;
	private deckSwapTimer: number | null = null;
	private blurSyncObserver: ResizeObserver | null = null;
	private lastSpunMode: GameModeId | null = null;
	private modeNavBlockedUntil = 0;
	private lastSpinAt = 0;
	private deckSwapBusy = false;

	private launchModeEl!: HTMLElement;
	private briefTitleEl!: HTMLElement;
	private briefDescEl!: HTMLElement;
	private garageChipEl!: HTMLElement;

	constructor(
		onStart: (mode: GameModeId) => void,
		private readonly credits?: CreditsPanel,
		onOnline?: () => void,
		private readonly audio?: GameAudio,
		private readonly settings?: SettingsOverlay,
		private readonly onLoadout?: () => void,
	) {
		const el = document.getElementById("main-menu");
		if (!el) throw new Error("Brak #main-menu");
		this.root = el;
		this.onStart = onStart;
		this.onOnline = onOnline;

		const params = new URLSearchParams(window.location.search);
		this.selected = parseGameMode(params.get("mode"));
		this.modeDeck = modeMenuDeckForMode(this.selected);

		this.render();
		this.bindKeyboard();
		onLocaleChange(() => {
			this.applyMenuLocale();
		});
	}

	hide(): void {
		this.root.classList.add("hidden");
		this.stopOnlinePoll();
		this.stopCardsIntro();
		this.clearSpinCommit();
		this.clearDeckSwap();
		this.stopModesBlurSync();
		this.lastSpunMode = null;
		if (this.keyHandler) {
			window.removeEventListener("keydown", this.keyHandler);
			this.keyHandler = null;
		}
	}

	show(): void {
		this.root.classList.remove("hidden", "main-menu--exit");
		if (!this.keyHandler) {
			this.bindKeyboard();
		}
		this.audio?.ensureMenuMusic();
		this.refreshEquippedChip();
		void this.refreshOnlineCount();
		this.startOnlinePoll();
		this.syncModeCardVariables();
		this.syncModesBlurPosition();
		this.lastSpunMode = null;
		this.playCardsIntro();
	}

	isVisible(): boolean {
		return !this.root.classList.contains("hidden");
	}

	getSelectedMode(): GameModeId {
		return this.selected;
	}

	getModeIndex(): number {
		return this.deckOrder().indexOf(this.selected);
	}

	selectModeById(id: GameModeId): void {
		const deck = modeMenuDeckForMode(id);
		if (deck !== this.modeDeck) {
			this.modeDeck = deck;
			this.fillModeGrid();
			this.syncDeckToggleLabel();
		}
		if (!this.deckOrder().includes(id)) return;
		this.selectMode(id);
	}

	private deckOrder(): GameModeId[] {
		return menuModeOrderForDeck(this.modeDeck);
	}

	private render(): void {
		this.root.classList.add(
			"main-menu--tiles",
			"main-menu--rl",
			"main-menu--wypas",
			"main-menu--cosmos",
			"main-menu--apex",
			"main-menu--stadium-orbit",
			"main-menu--esport",
		);

		this.root.innerHTML = `
      <div class="main-menu__fx main-menu__fx--stadium-orbit" aria-hidden="true">
        <div class="main-menu__vignette main-menu__vignette--soft"></div>
      </div>

      <div class="main-menu-overlay main-menu__layout main-menu__layout--esport">
        <div class="logo-container">
          <h1 class="main-menu__cosmos-brand logo-ignite">IGN!TE</h1>
          <div class="logo-meta">
            <span class="main-menu__mode-index" id="mode-index">01/06</span>
            <span class="main-menu__cosmos-version" id="main-menu-version">v${GAME_VERSION}</span>
          </div>
        </div>

        <nav class="sidebar-right" aria-label="${t("menu.nav.aria")}">
          <ul class="nav-links">
            <li>
              <button type="button" id="main-menu-garage" class="nav-item active" data-nav="garage">
                <span class="nav-title" data-i18n="menu.nav.garage">${t("menu.nav.garage")}</span>
                <span class="nav-sub" id="main-menu-garage-chip">—</span>
              </button>
            </li>
            <li>
              <button type="button" id="main-menu-online" class="nav-item" data-nav="online">
                <span class="nav-title" data-i18n="menu.online.label">${t("menu.online.label")}</span>
                <span class="nav-sub" id="main-menu-online-count">${t("menu.online.defaultStatus")}</span>
              </button>
            </li>
            <li>
              <button type="button" id="main-menu-settings" class="nav-item" data-i18n-aria="menu.settings.aria" aria-label="${t("menu.settings.aria")}">
                <span class="nav-title" data-i18n="menu.settings">${t("menu.settings")}</span>
              </button>
            </li>
            <li>
              <button type="button" id="main-menu-credits" class="nav-item">
                <span class="nav-title" data-i18n="menu.credits">${t("menu.credits")}</span>
              </button>
            </li>
          </ul>
        </nav>

        <section class="modes-panel-bottom" aria-label="${t("menu.zone.modes")}">
          <header class="modes-header">
            <h2 data-i18n="menu.zone.modes">${t("menu.zone.modes")}</h2>
            <button type="button" id="main-menu-deck-toggle" class="main-menu__deck-toggle" data-i18n-aria="menu.playlist.deckToggleAria" aria-label="${t("menu.playlist.deckToggleAria")}">
              <span class="main-menu__deck-toggle-label" data-i18n="menu.playlist.toExperimental">${t("menu.playlist.toExperimental")}</span>
            </button>
          </header>
          <div class="modes-list main-menu__modes-track">
            <div class="main-menu__modes-blur" aria-hidden="true"></div>
            <div class="modes-list__cards" id="mode-grid" role="list"></div>
          </div>
        </section>

        <button type="button" id="main-menu-start" class="btn-massive-play">
          <span data-i18n="menu.launch.play">${t("menu.launch.play")}</span>
          <span class="btn-sub" id="main-menu-launch-mode">—</span>
        </button>

        <div class="main-menu__sr-only" aria-hidden="true">
          <h2 id="main-menu-brief-title">—</h2>
          <p id="main-menu-brief-desc">—</p>
        </div>
        <p class="main-menu__controls main-menu__controls--sr" data-i18n-html="menu.controls">${t("menu.controls")}</p>
      </div>
    `;

		this.startBtn = this.req<HTMLButtonElement>("#main-menu-start");
		this.launchModeEl = this.req("#main-menu-launch-mode");
		this.briefTitleEl = this.req("#main-menu-brief-title");
		this.briefDescEl = this.req("#main-menu-brief-desc");
		this.garageChipEl = this.req("#main-menu-garage-chip");
		this.modeIndexEl = this.req("#mode-index");
		this.onlineCountEl = this.req("#main-menu-online-count");
		this.deckToggleBtn = this.req<HTMLButtonElement>("#main-menu-deck-toggle");

		this.fillModeGrid();
		this.syncDeckToggleLabel();

		this.startBtn.addEventListener("click", () => this.launch());
		this.deckToggleBtn.addEventListener("click", () => {
			void this.toggleModeDeck();
		});
		this.req<HTMLButtonElement>("#main-menu-credits").addEventListener(
			"click",
			() => {
				this.credits?.show();
			},
		);
		this.req<HTMLButtonElement>("#main-menu-settings").addEventListener(
			"click",
			() => {
				this.settings?.show();
			},
		);
		this.req<HTMLButtonElement>("#main-menu-garage").addEventListener(
			"click",
			() => {
				this.onLoadout?.();
			},
		);
		this.req<HTMLButtonElement>("#main-menu-online").addEventListener(
			"click",
			() => {
				this.onOnline?.();
			},
		);

		this.selectMode(this.selected, false, "never");
		this.refreshEquippedChip();
		this.bindMenuUiSounds();
		this.bindModesBlurSync();
	}

	private fillModeGrid(): void {
		const grid = this.req<HTMLElement>("#mode-grid");
		grid.replaceChildren();
		const order = this.deckOrder();
		for (const id of order) {
			grid.appendChild(this.createModeCard(id, order.indexOf(id)));
		}
		this.root.dataset.modeDeck = this.modeDeck;
	}

	private syncDeckToggleLabel(): void {
		const label = this.deckToggleBtn.querySelector(".main-menu__deck-toggle-label");
		const key =
			this.modeDeck === "core"
				? "menu.playlist.toExperimental"
				: "menu.playlist.toCore";
		if (label) {
			label.setAttribute("data-i18n", key);
			label.textContent = t(key);
		}
		this.deckToggleBtn.classList.toggle(
			"main-menu__deck-toggle--exp",
			this.modeDeck === "experimental",
		);
	}

	private async toggleModeDeck(): Promise<void> {
		if (this.deckSwapBusy) return;
		this.deckSwapBusy = true;
		this.clearSpinCommit();
		this.stopCardsIntro();
		this.clearModeCardInlineVars();

		const nextDeck: ModeMenuDeck =
			this.modeDeck === "core" ? "experimental" : "core";
		this.audio?.playMenuSpin(
			nextDeck === "experimental" ? "ignition" : "team",
		);

		this.root.classList.remove("main-menu--deck-swap-in", "main-menu--cards-intro");
		this.root.classList.add("main-menu--deck-swap-out");
		void this.root.offsetWidth;

		await new Promise<void>((resolve) => {
			if (this.deckSwapTimer !== null) {
				window.clearTimeout(this.deckSwapTimer);
			}
			this.deckSwapTimer = window.setTimeout(() => {
				this.deckSwapTimer = null;
				resolve();
			}, DECK_SWAP_OUT_MS);
		});

		this.modeDeck = nextDeck;
		const order = this.deckOrder();
		if (!order.includes(this.selected)) {
			this.selected = order[0]!;
		}
		this.fillModeGrid();
		this.syncDeckToggleLabel();
		this.root.classList.remove("main-menu--deck-swap-out");
		void this.root.offsetWidth;
		this.root.classList.add("main-menu--deck-swap-in");
		this.selectMode(this.selected, true, "never", "auto");
		this.playCardsIntro();

		window.setTimeout(() => {
			this.root.classList.remove("main-menu--deck-swap-in");
			this.deckSwapBusy = false;
			this.syncModeCardVariables();
		}, 980);
	}

	private clearDeckSwap(): void {
		if (this.deckSwapTimer !== null) {
			window.clearTimeout(this.deckSwapTimer);
			this.deckSwapTimer = null;
		}
		this.root.classList.remove("main-menu--deck-swap-out", "main-menu--deck-swap-in");
	}

	private bindMenuUiSounds(): void {
		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			".nav-item, .main-menu__deck-toggle",
		)) {
			btn.addEventListener("pointerenter", () => this.audio?.playMenuHover());
			btn.addEventListener("click", () => this.audio?.playMenuConfirm());
		}
		this.startBtn.addEventListener("pointerenter", () =>
			this.audio?.playMenuHover("ignition"),
		);
	}

	private startOnlinePoll(): void {
		this.stopOnlinePoll();
		this.onlinePollTimer = window.setInterval(() => {
			void this.refreshOnlineCount();
		}, 5000);
	}

	private stopOnlinePoll(): void {
		if (this.onlinePollTimer !== null) {
			window.clearInterval(this.onlinePollTimer);
			this.onlinePollTimer = null;
		}
	}

	private async refreshOnlineCount(): Promise<void> {
		await resolveMpServerAddress();
		const status = await fetchOnlineStatus();
		this.onlineCountEl.textContent = formatOnlineCount(status);
	}

	private createModeCard(id: GameModeId, deckIndex: number): HTMLButtonElement {
		const spec = getLocalizedModeSpec(id);
		const policy = getModePolicy(id);
		const accent = MODE_ACCENT[id];
		const btn = document.createElement("button");
		btn.type = "button";
		const featuredClass =
			id === "ignitionRush2v2" || id === "ignition"
				? " mode-card--featured"
				: "";
		const testClass = id === "ignition1v1" ? " mode-card--ignition-test" : "";
		btn.className = `mode-card mode-card--esport mode-card--${accent}${featuredClass}${testClass}`;
		btn.dataset.mode = id;
		btn.role = "listitem";

		const playlistBadge = policy.experimentalBadge
			? `<span class="mode-card__badge mode-card__badge--experimental">${t("menu.playlist.experimentalBadge")}</span>`
			: "";

		const weekly = policy.features.weeklyMutator
			? getWeeklyMutator()
			: null;
		const desc = weekly
			? t("menu.playlist.weeklyMutatorLine", {
					name: t(weekly.nameKey as never),
				})
			: spec.description;

		btn.innerHTML = `
      <span class="mode-id" aria-hidden="true">${String(deckIndex + 1).padStart(2, "0")}</span>
      <span class="mode-card__edge" aria-hidden="true"></span>
      <div class="mode-card-content">
        <h3>${spec.label}</h3>
        <p>${desc}</p>
        ${playlistBadge}
      </div>
    `;

		btn.addEventListener("click", () => this.selectMode(id, true, "always"));
		btn.addEventListener("pointerenter", () => this.audio?.playMenuHover(accent));
		btn.addEventListener("dblclick", () => {
			this.selectMode(id, false);
			this.launch();
		});

		return btn;
	}

	refreshEquippedChip(): void {
		const car = getCarEntry(getEquippedCarId());
		const arena = getArenaEntry(getEquippedArenaId());
		const carName = car ? t(car.nameKey as never) : "—";
		const arenaName = arena ? t(arena.nameKey as never) : "—";
		const newCount = countNewCosmetics();
		this.garageChipEl.textContent =
			newCount > 0
				? `${carName} · ${arenaName} · ${t("garage.newCount", { count: newCount })}`
				: `${carName} · ${arenaName}`;
	}

	private selectMode(
		id: GameModeId,
		focusStart = true,
		spinPolicy: ModeSpinPolicy = "auto",
		scrollBehavior: ScrollBehavior = "smooth",
	): void {
		const order = this.deckOrder();
		if (!order.includes(id)) return;

		const isReselect = id === this.selected;
		this.clearSpinCommit();
		const spec = getLocalizedModeSpec(id);
		const idx = order.indexOf(id);
		this.selected = id;

		let activeCard: HTMLButtonElement | null = null;
		for (const card of this.root.querySelectorAll<HTMLButtonElement>(
			".mode-card",
		)) {
			const isActive = card.dataset.mode === id;
			card.classList.toggle("active", isActive);
			card.classList.toggle("selected", isActive);
			if (!isActive) card.classList.remove("mode-card--spin");
			if (isActive) activeCard = card;
		}
		this.syncModeCardVariables();

		const introPlaying = this.root.classList.contains(
			"main-menu--cards-intro",
		);
		const canSpinNow =
			!isReselect &&
			(spinPolicy === "always" ||
				(spinPolicy === "auto" &&
					!introPlaying &&
					this.lastSpunMode !== null &&
					this.canPlaySpin()));

		if (activeCard) {
			this.ensureCardVisible(activeCard, scrollBehavior);
			if (!isReselect || spinPolicy === "always") {
				const accent = MODE_ACCENT[id];
				activeCard.classList.add("mode-card--pick");
				window.setTimeout(() => {
					activeCard?.classList.remove("mode-card--pick");
				}, 1350);
				if (canSpinNow && this.lastSpunMode !== id) {
					this.playCardSpin(activeCard);
					this.lastSpinAt = performance.now();
				} else if (spinPolicy !== "never" && !introPlaying && !isReselect) {
					this.audio?.playMenuNav(accent, true);
					this.scheduleSpinCommit(activeCard);
				}
				this.lastSpunMode = id;
			}
		}

		this.modeIndexEl.textContent = `${String(idx + 1).padStart(2, "0")}/${String(order.length).padStart(2, "0")}`;
		this.launchModeEl.textContent = spec.label;
		this.briefTitleEl.textContent = spec.label;
		this.briefDescEl.textContent = spec.description;

		this.root.dataset.selectedAccent = MODE_ACCENT[id];
		window.dispatchEvent(
			new CustomEvent("ignite:menu-accent", {
				detail: MODE_ACCENT[id],
			}),
		);

		if (focusStart) {
			this.startBtn.focus();
		}
		this.syncModesBlurPosition();
	}

	private canPlaySpin(): boolean {
		return performance.now() - this.lastSpinAt >= SPIN_COOLDOWN_MS;
	}

	private scheduleSpinCommit(card: HTMLButtonElement): void {
		this.clearSpinCommit();
		this.spinCommitTimer = window.setTimeout(() => {
			this.spinCommitTimer = null;
			if (
				card.dataset.mode !== this.selected ||
				!card.classList.contains("active") ||
				card.classList.contains("mode-card--spin")
			) {
				return;
			}
			this.playCardSpin(card);
			this.lastSpinAt = performance.now();
		}, SPIN_COMMIT_DELAY_MS);
	}

	private clearSpinCommit(): void {
		if (this.spinCommitTimer !== null) {
			window.clearTimeout(this.spinCommitTimer);
			this.spinCommitTimer = null;
		}
	}

	private navigateModeAdjacent(delta: 1 | -1): void {
		const now = performance.now();
		if (now < this.modeNavBlockedUntil) return;
		this.modeNavBlockedUntil = now + MODE_NAV_INTERVAL_MS;

		const order = this.deckOrder();
		const idx = order.indexOf(this.selected);
		const next = order[(idx + delta + order.length) % order.length]!;
		const scrollBehavior = this.canPlaySpin() ? "smooth" : "auto";
		this.selectMode(next, true, "auto", scrollBehavior);
	}

	private cardMotionLocked(): boolean {
		return (
			this.root.classList.contains("main-menu--cards-intro") ||
			this.root.classList.contains("main-menu--deck-swap-out") ||
			this.root.classList.contains("main-menu--deck-swap-in")
		);
	}

	/** Inline --card-* zabijają keyframes deck-swap / stagger-in. */
	private clearModeCardInlineVars(): void {
		for (const card of this.root.querySelectorAll<HTMLButtonElement>(
			".mode-card",
		)) {
			card.style.removeProperty("--card-lift");
			card.style.removeProperty("--card-scale");
			card.style.removeProperty("--card-opacity");
			card.style.removeProperty("--card-tilt-y");
			card.style.removeProperty("--card-tilt-x");
		}
	}

	private syncModeCardVariables(): void {
		if (this.cardMotionLocked()) {
			this.syncModesBlurPosition();
			return;
		}
		for (const card of this.root.querySelectorAll<HTMLButtonElement>(
			".mode-card",
		)) {
			card.style.removeProperty("--card-lift");
			card.style.removeProperty("--card-scale");
			card.style.removeProperty("--card-opacity");
			card.style.removeProperty("--card-tilt-y");
			card.style.removeProperty("--card-tilt-x");
		}
		this.syncModesBlurPosition();
	}

	private bindModesBlurSync(): void {
		this.stopModesBlurSync();
		const track = this.root.querySelector<HTMLElement>(".main-menu__modes-track");
		const grid = this.root.querySelector<HTMLElement>("#mode-grid");
		if (!track || !grid || typeof ResizeObserver === "undefined") return;
		this.blurSyncObserver = new ResizeObserver(() => {
			this.syncModesBlurPosition();
		});
		this.blurSyncObserver.observe(track);
		this.blurSyncObserver.observe(grid);
		window.addEventListener("resize", this.onBlurLayoutChange);
		grid.addEventListener("scroll", this.onBlurLayoutChange, { passive: true });
		requestAnimationFrame(() => this.syncModesBlurPosition());
	}

	private stopModesBlurSync(): void {
		this.blurSyncObserver?.disconnect();
		this.blurSyncObserver = null;
		window.removeEventListener("resize", this.onBlurLayoutChange);
		this.root
			.querySelector("#mode-grid")
			?.removeEventListener("scroll", this.onBlurLayoutChange);
	}

	private readonly onBlurLayoutChange = (): void => {
		this.syncModesBlurPosition();
	};

	/** Miękki cień pod kartami — glow śledzi aktywną kartę. */
	private syncModesBlurPosition(): void {
		const blur = this.root.querySelector<HTMLElement>(".main-menu__modes-blur");
		const grid = this.root.querySelector<HTMLElement>("#mode-grid");
		const track = this.root.querySelector<HTMLElement>(".main-menu__modes-track");
		if (!blur || !grid || !track) return;

		const accent = MODE_ACCENT[this.selected];
		blur.style.setProperty(
			"--blur-glow",
			MODE_ACCENT_GLOW[accent] ?? MODE_ACCENT_GLOW.team!,
		);

		const active = grid.querySelector<HTMLElement>(".mode-card.active");
		if (!active) {
			blur.style.setProperty("--blur-accent-x", "50%");
			blur.style.setProperty("--blur-accent-y", "58%");
			return;
		}

		const tRect = track.getBoundingClientRect();
		const aRect = active.getBoundingClientRect();
		const cx = ((aRect.left + aRect.width * 0.5 - tRect.left) / tRect.width) * 100;
		const cy = ((aRect.top + aRect.height * 0.55 - tRect.top) / tRect.height) * 100;
		blur.style.setProperty("--blur-accent-x", `${cx}%`);
		blur.style.setProperty("--blur-accent-y", `${cy}%`);
	}

	private playCardsIntro(): void {
		this.stopCardsIntro();
		this.clearModeCardInlineVars();
		this.root.classList.remove("main-menu--cards-intro");
		void this.root.offsetWidth;
		this.root.classList.add("main-menu--cards-intro");
		this.cardsIntroTimer = window.setTimeout(() => {
			this.root.classList.remove("main-menu--cards-intro");
			this.cardsIntroTimer = null;
			this.syncModeCardVariables();
			const activeCard = this.root.querySelector<HTMLButtonElement>(
				".mode-card.active",
			);
			if (activeCard) {
				this.playCardSpin(activeCard);
				this.lastSpinAt = performance.now();
				this.lastSpunMode = this.selected;
			}
		}, 780);
	}

	private playCardSpin(card: HTMLButtonElement): void {
		if (card.classList.contains("mode-card--spin")) return;
		this.clearSpinCommit();
		const mode = card.dataset.mode as GameModeId | undefined;
		this.audio?.playMenuSpin(mode ? MODE_ACCENT[mode] : undefined);
		card.classList.remove("mode-card--spin");
		void card.offsetWidth;
		card.classList.add("mode-card--spin");
		const onEnd = (event: Event) => {
			const anim = event as AnimationEvent;
			if (anim.animationName !== "apex-card-spin-outer") return;
			card.classList.remove("mode-card--spin");
			card.removeEventListener("animationend", onEnd);
		};
		card.addEventListener("animationend", onEnd);
	}

	private stopCardsIntro(): void {
		if (this.cardsIntroTimer !== null) {
			window.clearTimeout(this.cardsIntroTimer);
			this.cardsIntroTimer = null;
		}
		this.root.classList.remove("main-menu--cards-intro");
	}

	private ensureCardVisible(
		card: HTMLButtonElement,
		behavior: ScrollBehavior = "smooth",
	): void {
		const scroller =
			card.closest<HTMLElement>(".modes-list__cards") ??
			card.closest<HTMLElement>("#mode-grid") ??
			card.parentElement;
		if (!scroller) return;

		const scrollerRect = scroller.getBoundingClientRect();
		const cardRect = card.getBoundingClientRect();
		const margin = 20;
		const outOfView =
			cardRect.left < scrollerRect.left + margin ||
			cardRect.right > scrollerRect.right - margin ||
			cardRect.top < scrollerRect.top + margin ||
			cardRect.bottom > scrollerRect.bottom - margin;
		if (outOfView) {
			card.scrollIntoView({
				behavior,
				block: "nearest",
				inline: "nearest",
			});
		}
	}

	private applyMenuLocale(): void {
		applyStaticI18n(this.root);
		this.syncDeckToggleLabel();
		for (const id of this.deckOrder()) {
			const card = this.root.querySelector<HTMLButtonElement>(
				`[data-mode="${id}"]`,
			);
			if (!card) continue;
			const spec = getLocalizedModeSpec(id);
			const title = card.querySelector("h3");
			if (title) title.textContent = spec.label;
			const desc = card.querySelector("p");
			if (desc) {
				if (getModePolicy(id).features.weeklyMutator) {
					const m = getWeeklyMutator();
					desc.textContent = t("menu.playlist.weeklyMutatorLine", {
						name: t(m.nameKey as never),
					});
				} else {
					desc.textContent = spec.description;
				}
			}
			const expBadge = card.querySelector(".mode-card__badge--experimental");
			if (expBadge) {
				expBadge.textContent = t("menu.playlist.experimentalBadge");
			}
		}
		this.selectMode(this.selected, false, "never");
		this.syncModeCardVariables();
		void this.refreshOnlineCount();
	}

	private launch(): void {
		this.audio?.playMenuLaunch();
		this.root.classList.add("main-menu--exit", "main-menu--launch-flash");
		window.setTimeout(() => {
			this.hide();
			this.onStart(this.selected);
		}, 520);
	}

	private bindKeyboard(): void {
		this.keyHandler = (e: KeyboardEvent) => {
			if (this.root.classList.contains("hidden")) return;
			if (this.settings?.isVisible()) return;
			if (e.key === "g" || e.key === "G") {
				e.preventDefault();
				this.onLoadout?.();
				return;
			}

			const tag = (e.target as HTMLElement | null)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA") return;

			if (e.key === "Enter") {
				e.preventDefault();
				this.launch();
				return;
			}

			if (e.key === "s" || e.key === "S") {
				e.preventDefault();
				this.settings?.show();
				return;
			}

			if (e.key === "o" || e.key === "O") {
				e.preventDefault();
				this.onOnline?.();
				return;
			}

			if (e.key === "ArrowRight" || e.key === "ArrowDown") {
				e.preventDefault();
				this.navigateModeAdjacent(1);
				return;
			}
			if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
				e.preventDefault();
				this.navigateModeAdjacent(-1);
				return;
			}

			const order = this.deckOrder();
			const num = Number(e.key);
			if (num >= 1 && num <= order.length) {
				e.preventDefault();
				this.selectMode(order[num - 1]!, true, "always");
			}
		};

		window.addEventListener("keydown", this.keyHandler);
	}

	private req<T extends HTMLElement = HTMLElement>(selector: string): T {
		const el = this.root.querySelector<T>(selector);
		if (!el) throw new Error(`MainMenu: brak ${selector}`);
		return el;
	}
}
