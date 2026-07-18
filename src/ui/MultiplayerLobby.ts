import type { GameModeId } from "../game/modes";
import {
	getLocalizedModeSpec,
	getModeSpec,
	menuModeOrderForDeck,
	modeMenuDeckForMode,
	type ModeMenuDeck,
} from "../game/modes";
import { getModePolicy, menuModeOrder } from "../game/modePolicy";
import { type I18nKey, onLocaleChange, t } from "../i18n";
import { applyStaticI18n } from "../i18n/staticDom";
import { getEquippedCarId } from "../meta/PlayerInventory";
import { getWeeklyMutator } from "../modes/MutatorRegistry";
import { NetworkControlInputPool } from "../net/NetworkControlInputPool";
import type { LobbyStatePayload, OnlineRole } from "../net/protocol";
import { isRankedEligibleMode } from "../net/protocol";
import { RoomClient } from "../net/RoomClient";
import { effectiveRanked, RANKED_UI_ENABLED } from "../net/rankedFeature";
import {
	fetchOnlineStatus,
	fetchOpenRooms,
	formatOnlineCount,
	resolveMpServerAddress,
	type OpenRoomInfo,
} from "../net/serverStatus";
import { attachHoloCardTilt } from "./holoCardTilt";

const ONLINE_LOBBY_MODES: GameModeId[] = menuModeOrder();

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

function lobbyMaxPlayers(mode: GameModeId): number {
	return Math.min(getModeSpec(mode).playerCount, 8);
}

function lobbyModeLabel(mode: GameModeId | string | undefined): string {
	if (!mode) return "—";
	try {
		return getLocalizedModeSpec(mode as GameModeId).label;
	} catch {
		return String(mode);
	}
}

export type OnlineLobbyResult = {
	role: OnlineRole;
	localSlot: number;
	mode: GameModeId;
	roomClient: RoomClient;
	remoteInputs: NetworkControlInputPool;
	roomCode: string;
	ranked: boolean;
	lobby?: LobbyStatePayload;
	preMatchEndsAtMs?: number;
};

export class MultiplayerLobby {
	private readonly root: HTMLElement;
	private readonly onPreMatch: (result: OnlineLobbyResult) => void;
	private readonly onCancel: () => void;
	private roomClient: RoomClient | null = null;
	private remoteInputs = new NetworkControlInputPool();
	private statusEl!: HTMLElement;
	private serverStatusEl!: HTMLElement;
	private roomCodeEl!: HTMLElement;
	private hostPanel!: HTMLElement;
	private guestPanel!: HTMLElement;
	private openRoomsEl!: HTMLElement;
	private guestCodeInput!: HTMLInputElement;
	private slotsEl!: HTMLElement;
	private modeGridEl!: HTMLElement;
	private launchBtn!: HTMLButtonElement;
	private launchModeEl!: HTMLElement;
	private readyBtn!: HTMLButtonElement;
	private deckToggleBtn!: HTMLButtonElement;
	private rankedToggle?: HTMLInputElement;
	private pendingStart: OnlineLobbyResult | null = null;
	private localReady = false;
	private pollTimer: number | null = null;
	private joining = false;
	private serverRaw = "";
	private selectedMode: GameModeId = "1v1";
	private modeDeck: ModeMenuDeck = "core";
	private activeTab: "host" | "guest" = "host";
	private lastStatusKey: I18nKey | null = null;
	private lastStatusParams: Record<string, string | number> | undefined;

	constructor(
		onPreMatch: (result: OnlineLobbyResult) => void,
		onCancel: () => void,
	) {
		const el = document.getElementById("mp-lobby");
		if (!el) throw new Error("Brak #mp-lobby");
		this.root = el;
		this.onPreMatch = onPreMatch;
		this.onCancel = onCancel;
		this.render();
		onLocaleChange(() => this.applyLobbyLocale());
	}

	show(preselectMode?: GameModeId): void {
		this.root.classList.remove("hidden");
		this.setStatusKey("mp.status.initial");
		this.roomCodeEl.textContent = "—";
		if (this.guestCodeInput) this.guestCodeInput.value = "";
		this.pendingStart = null;
		this.localReady = false;
		this.joining = false;
		if (preselectMode && ONLINE_LOBBY_MODES.includes(preselectMode)) {
			this.modeDeck = modeMenuDeckForMode(preselectMode);
			this.root.dataset.modeDeck = this.modeDeck;
			this.selectOnlineMode(preselectMode);
		} else {
			this.selectOnlineMode(this.selectedMode);
		}
		this.fillModeGrid();
		this.syncDeckToggleLabel();
		this.renderSlots(null);
		this.syncPartyActionButtons();
		void this.ensureServer().then(() => this.refreshLobbyStatus());
		this.startPoll();
	}

	hide(): void {
		this.root.classList.add("hidden");
		this.stopPoll();
	}

	isVisible(): boolean {
		return !this.root.classList.contains("hidden");
	}

	cancel(): void {
		this.disconnect();
		this.onCancel();
	}

	disconnect(): void {
		this.roomClient?.disconnect();
		this.roomClient = null;
		this.pendingStart = null;
		this.joining = false;
	}

	private render(): void {
		this.root.className = "mp-lobby--wypas main-menu--wypas hidden";
		this.root.dataset.modeDeck = this.modeDeck;
		this.root.innerHTML = `
<div class="mp-lobby__veil" aria-hidden="true"></div>
<div class="mp-lobby__frame">
  <button type="button" id="mp-lobby-cancel" class="ui-ignite-back mp-lobby__back" data-i18n-aria="ui.back" aria-label="${t("ui.back")}">
    <span class="ui-ignite-back__shine" aria-hidden="true"></span>
    <span class="ui-ignite-back__icon" aria-hidden="true">←</span>
    <span class="ui-ignite-back__label" data-i18n="ui.back">${t("ui.back")}</span>
  </button>

  <header class="mp-lobby__brand">
    <p class="mp-lobby__eyebrow ignite-hero-type ignite-hero-type--on-dark" data-i18n="mp.eyebrow">${t("mp.eyebrow")}</p>
    <h2 class="mp-lobby__title" data-i18n="mp.title">${t("mp.title")}</h2>
    <p class="mp-lobby__server-status" id="mp-server-status" aria-live="polite">${t("mp.connecting")}</p>
  </header>

  <nav class="mp-lobby__rail" role="tablist" aria-label="${t("mp.tab.host")} / ${t("mp.tab.guest")}">
    <button type="button" class="mp-lobby__nav mp-lobby__nav--active" data-tab="host">
      <span class="mp-lobby__nav-icon" aria-hidden="true">◆</span>
      <span data-i18n="mp.tab.host">${t("mp.tab.host")}</span>
      <span class="mp-lobby__nav-hint" data-i18n="mp.path.hostHint">${t("mp.path.hostHint")}</span>
    </button>
    <button type="button" class="mp-lobby__nav" data-tab="guest">
      <span class="mp-lobby__nav-icon" aria-hidden="true">●</span>
      <span data-i18n="mp.tab.guest">${t("mp.tab.guest")}</span>
      <span class="mp-lobby__nav-hint" data-i18n="mp.path.joinHint">${t("mp.path.joinHint")}</span>
    </button>
  </nav>

  <section class="mp-lobby__stage" id="mp-host-panel">
    <div class="mp-lobby__modes-head">
      <p class="mp-lobby__kicker ignite-hero-type ignite-hero-type--on-dark" data-i18n="menu.zone.modes">${t("menu.zone.modes")}</p>
      <button type="button" id="mp-deck-toggle" class="main-menu__deck-toggle" data-i18n-aria="menu.playlist.deckToggleAria" aria-label="${t("menu.playlist.deckToggleAria")}">
        <span class="main-menu__deck-toggle-label" data-i18n="menu.playlist.toExperimental">${t("menu.playlist.toExperimental")}</span>
      </button>
    </div>
    <div class="mp-lobby__carousel">
      <div class="main-menu__rl-playlist" id="mp-mode-grid" role="list"></div>
    </div>
    ${
			RANKED_UI_ENABLED
				? `<label class="mp-ranked-chip hidden" id="mp-ranked-wrap">
      <input type="checkbox" id="mp-ranked-toggle" />
      <span data-i18n="mp.rankedShort">${t("mp.rankedShort")}</span>
    </label>`
				: ""
		}
    <button type="button" class="mp-code-card hidden" id="mp-copy-code" title="${t("mp.copyCode")}">
      <span class="mp-code-card__label" data-i18n="mp.yourRoom">${t("mp.yourRoom")}</span>
      <strong class="mp-code-card__value" id="mp-room-code">—</strong>
      <span class="mp-code-card__action" data-i18n="mp.copyCode">${t("mp.copyCode")}</span>
    </button>
  </section>

  <section class="mp-lobby__stage hidden" id="mp-guest-panel">
    <div class="mp-join-row">
      <input type="text" id="mp-join-code" class="mp-join-input" maxlength="6" autocomplete="off" spellcheck="false" placeholder="ABC123" />
      <button type="button" id="mp-join-by-code" class="mp-cta mp-cta--primary" data-i18n="mp.joinByCode">${t("mp.joinByCode")}</button>
    </div>
    <div class="mp-rooms-head">
      <span data-i18n="mp.openRooms">${t("mp.openRooms")}</span>
      <button type="button" id="mp-refresh-rooms" class="mp-ghost-btn" data-i18n="mp.refresh">${t("mp.refresh")}</button>
    </div>
    <div class="mp-room-cards" id="mp-open-rooms" aria-live="polite"></div>
  </section>

  <section class="mp-roster mp-roster--empty" id="mp-slots" data-empty="${t("mp.slots.empty")}" aria-live="polite"></section>

  <footer class="mp-lobby__dock">
    <button type="button" id="mp-ready" class="mp-cta mp-cta--ghost hidden" data-i18n="mp.ready">${t("mp.ready")}</button>
    <button type="button" id="mp-launch" class="mp-lobby__play ignite-cta-ground">
      <span class="mp-lobby__play-shine" aria-hidden="true"></span>
      <span class="mp-lobby__play-label ignite-hero-type ignite-hero-type--on-cta" id="mp-launch-label">${t("mp.createRoom")}</span>
      <small class="mp-lobby__play-mode" id="mp-launch-mode">—</small>
    </button>
  </footer>
  <p class="mp-lobby__status" id="mp-status" aria-live="polite"></p>
</div>
`;

		this.statusEl = this.req("#mp-status");
		this.serverStatusEl = this.req("#mp-server-status");
		this.roomCodeEl = this.req("#mp-room-code");
		this.hostPanel = this.req("#mp-host-panel");
		this.guestPanel = this.req("#mp-guest-panel");
		this.openRoomsEl = this.req("#mp-open-rooms");
		this.guestCodeInput = this.req<HTMLInputElement>("#mp-join-code");
		this.slotsEl = this.req("#mp-slots");
		this.modeGridEl = this.req("#mp-mode-grid");
		this.launchBtn = this.req("#mp-launch");
		this.launchModeEl = this.req("#mp-launch-mode");
		this.readyBtn = this.req("#mp-ready");
		this.deckToggleBtn = this.req("#mp-deck-toggle");
		if (RANKED_UI_ENABLED) {
			this.rankedToggle = this.req<HTMLInputElement>("#mp-ranked-toggle");
		}

		for (const nav of this.root.querySelectorAll<HTMLButtonElement>(
			".mp-lobby__nav",
		)) {
			nav.addEventListener("click", () =>
				this.selectTab(nav.dataset.tab === "guest" ? "guest" : "host"),
			);
		}

		this.deckToggleBtn.addEventListener("click", () => this.toggleModeDeck());
		this.launchBtn.addEventListener("click", () => void this.onLaunch());
		this.req("#mp-copy-code").addEventListener("click", () =>
			void this.copyRoomCode(),
		);
		this.req("#mp-refresh-rooms").addEventListener("click", () =>
			void this.refreshLobbyStatus(),
		);
		this.req("#mp-join-by-code").addEventListener("click", () =>
			void this.joinRoomFromInput(),
		);
		this.guestCodeInput.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter") void this.joinRoomFromInput();
		});
		this.readyBtn.addEventListener("click", () => this.toggleReady());
		this.req("#mp-lobby-cancel").addEventListener("click", () => {
			this.disconnect();
			this.onCancel();
		});

		this.fillModeGrid();
		this.syncPartyActionButtons();
	}

	private deckOrder(): GameModeId[] {
		return menuModeOrderForDeck(this.modeDeck);
	}

	private fillModeGrid(): void {
		this.modeGridEl.replaceChildren();
		const order = this.deckOrder();
		order.forEach((id, index) => {
			this.modeGridEl.appendChild(this.createModeCard(id, index));
		});
		this.paintModeSelection();
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
		btn.className = `mode-card mode-card--rl mode-card--wypas game-mode-card mode-card--${accent}${featuredClass}${testClass}`;
		btn.dataset.mode = id;
		btn.role = "listitem";

		const badge = spec.isFFA
			? `<span class="mode-card__badge mode-card__badge--ffa">FFA</span>`
			: `<span class="mode-card__badge">${spec.teamSize}v${spec.teamSize}</span>`;
		const playlistBadge = policy.experimentalBadge
			? `<span class="mode-card__badge mode-card__badge--experimental">${t("menu.playlist.experimentalBadge")}</span>`
			: "";
		const artLabel = spec.isFFA ? "FFA" : `${spec.teamSize}×${spec.teamSize}`;
		const weekly = policy.features.weeklyMutator ? getWeeklyMutator() : null;
		const mutatorLine = weekly
			? `<span class="mode-card__mutator">${t("menu.playlist.weeklyMutatorLine", {
					name: t(weekly.nameKey as never),
				})}</span>`
			: "";

		btn.innerHTML = `
      <span class="mode-card__inner">
        <span class="mode-card__shimmer" aria-hidden="true"></span>
        <span class="mode-card__beam" aria-hidden="true"></span>
        <div class="mode-card__art" aria-hidden="true">
          <span class="mode-card__art-mesh"></span>
          <span class="mode-card__art-glow"></span>
          <span class="mode-card__art-label">${artLabel}</span>
        </div>
        <div class="mode-card__foot">
          <span class="mode-card__badges">${badge}${playlistBadge}</span>
          <strong class="mode-card__title cosmos-shimmer-hover">${spec.label}</strong>
          ${mutatorLine || `<span class="mode-card__desc">${spec.description}</span>`}
        </div>
        <span class="mode-card__index">${String(deckIndex + 1).padStart(2, "0")}</span>
      </span>
    `;

		btn.addEventListener("click", () => this.selectOnlineMode(id));
		attachHoloCardTilt(btn);
		return btn;
	}

	private paintModeSelection(): void {
		for (const card of this.modeGridEl.querySelectorAll<HTMLButtonElement>(
			".mode-card",
		)) {
			card.classList.toggle("active", card.dataset.mode === this.selectedMode);
			card.disabled = Boolean(this.roomClient?.roomCode);
		}
		const spec = getLocalizedModeSpec(this.selectedMode);
		this.launchModeEl.textContent = spec.label.toUpperCase();
	}

	private toggleModeDeck(): void {
		if (this.roomClient?.roomCode) return;
		this.modeDeck = this.modeDeck === "core" ? "experimental" : "core";
		this.root.dataset.modeDeck = this.modeDeck;
		const order = this.deckOrder();
		if (!order.includes(this.selectedMode) && order[0]) {
			this.selectedMode = order[0];
		}
		this.fillModeGrid();
		this.syncDeckToggleLabel();
		this.selectOnlineMode(this.selectedMode);
	}

	private syncDeckToggleLabel(): void {
		const key =
			this.modeDeck === "core"
				? "menu.playlist.toExperimental"
				: "menu.playlist.toCore";
		const label = this.deckToggleBtn.querySelector(
			".main-menu__deck-toggle-label",
		);
		if (label) {
			label.setAttribute("data-i18n", key);
			label.textContent = t(key);
		}
	}

	private renderSlots(state: LobbyStatePayload | null): void {
		this.slotsEl.dataset.empty = t("mp.slots.empty");
		if (!state) {
			this.slotsEl.innerHTML = "";
			this.slotsEl.classList.add("mp-roster--empty");
			return;
		}
		this.slotsEl.classList.remove("mp-roster--empty");
		const chips = state.slots
			.map((s) => {
				const flag = s.isBot ? t("mp.slots.bot") : s.ready ? "✓" : "·";
				return `<span class="mp-chip mp-chip--${s.team}${s.isBot ? " mp-chip--bot" : ""}${s.ready && !s.isBot ? " mp-chip--ready" : ""}" title="${s.carId}">${s.name} <em>${flag}</em></span>`;
			})
			.join("");
		this.slotsEl.innerHTML = `<div class="mp-roster__row">${chips}</div>`;
	}

	private syncPartyActionButtons(): void {
		const inRoom = Boolean(this.roomClient?.roomCode);
		const isHost = this.pendingStart?.role === "host";
		this.root.classList.toggle("mp-lobby--in-room", inRoom);
		this.root.classList.toggle("mp-lobby--tab-guest", this.activeTab === "guest");

		this.readyBtn.classList.toggle("hidden", !inRoom);
		this.readyBtn.disabled = !inRoom;
		this.readyBtn.textContent = this.localReady
			? t("mp.unready")
			: t("mp.ready");

		const codeCard = this.root.querySelector("#mp-copy-code");
		codeCard?.classList.toggle("hidden", !(inRoom && isHost));
		this.deckToggleBtn.disabled = inRoom;
		this.paintModeSelection();

		const label = this.req("#mp-launch-label");
		if (!inRoom) {
			if (this.activeTab === "guest") {
				label.textContent = t("mp.joinByCode");
				this.launchBtn.disabled = false;
			} else {
				label.textContent = t("mp.createRoom");
				this.launchBtn.disabled = false;
			}
		} else if (isHost) {
			label.textContent = t("mp.startMatch");
			this.launchBtn.disabled = false;
		} else {
			label.textContent = this.localReady ? t("mp.unready") : t("mp.ready");
			this.launchBtn.disabled = false;
		}
	}

	private async onLaunch(): Promise<void> {
		const inRoom = Boolean(this.roomClient?.roomCode);
		if (!inRoom) {
			if (this.activeTab === "guest") {
				await this.joinRoomFromInput();
			} else {
				await this.createRoom();
			}
			return;
		}
		if (this.pendingStart?.role === "host") {
			this.requestStart();
			return;
		}
		this.toggleReady();
	}

	private toggleReady(): void {
		if (!this.roomClient) return;
		this.localReady = !this.localReady;
		this.roomClient.setReady(this.localReady);
		this.syncPartyActionButtons();
	}

	private requestStart(): void {
		if (!this.roomClient || this.pendingStart?.role !== "host") return;
		this.roomClient.requestStart(true);
		this.setStatusKey("mp.status.starting");
	}

	private applyLobbyLocale(): void {
		applyStaticI18n(this.root);
		if (this.lastStatusKey) {
			this.statusEl.textContent = t(this.lastStatusKey, this.lastStatusParams);
		}
		this.fillModeGrid();
		this.syncDeckToggleLabel();
		this.syncPartyActionButtons();
		void this.refreshLobbyStatus();
	}

	private selectOnlineMode(mode: GameModeId): void {
		if (this.roomClient?.roomCode) return;
		this.selectedMode = mode;
		const neededDeck = modeMenuDeckForMode(mode);
		if (neededDeck !== this.modeDeck) {
			this.modeDeck = neededDeck;
			this.root.dataset.modeDeck = this.modeDeck;
			this.fillModeGrid();
			this.syncDeckToggleLabel();
		} else {
			this.paintModeSelection();
		}
		const rankedWrap = this.root.querySelector("#mp-ranked-wrap");
		const rankedOk = isRankedEligibleMode(mode);
		if (rankedWrap) {
			rankedWrap.classList.toggle("hidden", !rankedOk);
		}
		if (this.rankedToggle) {
			if (!rankedOk) {
				this.rankedToggle.checked = false;
				this.rankedToggle.disabled = true;
			} else {
				this.rankedToggle.disabled = false;
			}
		}
	}

	private selectTab(tab: "host" | "guest"): void {
		this.activeTab = tab;
		for (const nav of this.root.querySelectorAll<HTMLButtonElement>(
			".mp-lobby__nav",
		)) {
			nav.classList.toggle("mp-lobby__nav--active", nav.dataset.tab === tab);
		}
		this.hostPanel.classList.toggle("hidden", tab !== "host");
		this.guestPanel.classList.toggle("hidden", tab !== "guest");
		this.syncPartyActionButtons();
		void this.refreshLobbyStatus();
	}

	private setStatusKey(
		key: I18nKey,
		params?: Record<string, string | number>,
	): void {
		this.lastStatusKey = key;
		this.lastStatusParams = params;
		this.statusEl.textContent = t(key, params);
	}

	private setStatus(msg: string): void {
		this.lastStatusKey = null;
		this.lastStatusParams = undefined;
		this.statusEl.textContent = msg;
	}

	private startPoll(): void {
		this.stopPoll();
		this.pollTimer = window.setInterval(() => {
			void this.refreshLobbyStatus();
		}, 4000);
	}

	private stopPoll(): void {
		if (this.pollTimer !== null) {
			window.clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	private async ensureServer(): Promise<string> {
		this.serverRaw = await resolveMpServerAddress();
		return this.serverRaw;
	}

	private async refreshLobbyStatus(): Promise<void> {
		const serverRaw = this.serverRaw || (await this.ensureServer());
		const status = await fetchOnlineStatus(serverRaw);
		this.serverStatusEl.textContent = formatOnlineCount(status);
		if (this.guestPanel.classList.contains("hidden")) return;
		const rooms = await fetchOpenRooms(serverRaw);
		this.renderOpenRooms(rooms);
	}

	private renderOpenRooms(rooms: OpenRoomInfo[] | null): void {
		this.openRoomsEl.innerHTML = "";
		if (rooms === null) {
			this.openRoomsEl.innerHTML = `<p class="mp-rooms-empty">${t("mp.rooms.noServer")}</p>`;
			return;
		}
		if (rooms.length === 0) {
			this.openRoomsEl.innerHTML = `<p class="mp-rooms-empty">${t("mp.rooms.waitingHost")}</p>`;
			return;
		}

		for (const room of rooms) {
			if (!RANKED_UI_ENABLED && room.ranked) continue;
			const modeId = (ONLINE_LOBBY_MODES as string[]).includes(room.mode ?? "")
				? (room.mode as GameModeId)
				: "1v1";
			const accent = MODE_ACCENT[modeId] ?? "team";
			const players = room.players ?? 1;
			const max = room.maxPlayers ?? lobbyMaxPlayers(modeId);
			const bots = room.botsWillFill ?? Math.max(0, max - players);
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = `mp-room-card mp-room-card--${accent}`;
			btn.innerHTML = `
<span class="mp-room-card__beam" aria-hidden="true"></span>
<span class="mp-room-card__code">${room.code}</span>
<span class="mp-room-card__meta">${lobbyModeLabel(room.mode)} · ${players}/${max}${bots > 0 ? ` · +${bots}` : ""}${room.ranked ? " · ranked" : ""}</span>
`;
			btn.addEventListener("click", () => void this.joinRoom(room.code));
			this.openRoomsEl.appendChild(btn);
		}
	}

	private async connectClient(): Promise<RoomClient> {
		const serverRaw = await this.ensureServer();
		const client = new RoomClient();
		this.setStatusKey("mp.status.connecting", { server: serverRaw });
		await client.connect(serverRaw);
		return client;
	}

	private wireClient(client: RoomClient): void {
		this.roomClient = client;
		client.setCallbacks({
			onWelcome: (roomCode, slot, welcomeRole, ranked, elo, mode) => {
				this.roomCodeEl.textContent = roomCode;
				const activeRanked = effectiveRanked(ranked);
				if (mode) {
					this.selectedMode = mode;
					this.modeDeck = modeMenuDeckForMode(mode);
					this.root.dataset.modeDeck = this.modeDeck;
					this.fillModeGrid();
					this.syncDeckToggleLabel();
				}
				const rankedLabel = activeRanked ? t("mp.status.rankedSuffix") : "";
				const eloLabel =
					activeRanked && elo != null ? t("mp.status.eloSuffix", { elo }) : "";
				const extras = `${rankedLabel}${eloLabel}`;
				this.pendingStart = {
					role: welcomeRole,
					localSlot: slot,
					mode: mode ?? this.selectedMode,
					roomClient: client,
					remoteInputs: this.remoteInputs,
					roomCode,
					ranked: activeRanked,
				};
				client.setLoadout(
					getEquippedCarId(),
					welcomeRole === "host" ? "Host" : "Player",
				);
				this.localReady = false;
				this.syncPartyActionButtons();
				if (welcomeRole === "host") {
					this.setStatusKey("mp.status.roomReadyHost", { extras });
				} else {
					this.setStatusKey("mp.status.roomReadyGuest", { extras });
				}
			},
			onLobbyState: (state) => {
				this.selectedMode = state.mode;
				this.paintModeSelection();
				this.renderSlots(state);
				const me = state.slots.find(
					(s) => s.slot === this.pendingStart?.localSlot && !s.isBot,
				);
				if (me) this.localReady = me.ready;
				this.syncPartyActionButtons();
				const humans = state.slots.filter((s) => !s.isBot).length;
				this.setStatusKey("mp.status.waitingPlayers", {
					n: humans,
					max: state.maxPlayers,
				});
			},
			onPeerJoined: () => this.setStatusKey("mp.status.peerJoined"),
			onStartMatch: (mode, _seed, ranked, lobby, preMatchEndsAtMs) => {
				if (this.pendingStart) {
					this.pendingStart.mode = mode;
					this.pendingStart.ranked = effectiveRanked(ranked);
					this.pendingStart.lobby = lobby;
					this.pendingStart.preMatchEndsAtMs = preMatchEndsAtMs;
					this.stopPoll();
					this.onPreMatch(this.pendingStart);
				}
			},
			onError: (message) => {
				this.joining = false;
				this.setStatusKey("mp.status.error", { message });
			},
			onPeerLeft: (reason) => {
				if (reason) this.setStatus(reason);
				else this.setStatusKey("mp.status.peerLeft");
			},
			onDisconnect: () => {
				this.joining = false;
				this.syncPartyActionButtons();
				this.setStatusKey("mp.status.disconnected");
			},
		});
	}

	private async copyRoomCode(): Promise<void> {
		const code = this.roomCodeEl.textContent?.trim();
		if (!code || code === "—") {
			this.setStatusKey("mp.status.copyEmpty");
			return;
		}
		try {
			await navigator.clipboard.writeText(code);
			this.setStatusKey("mp.status.copyOk", { code });
		} catch {
			this.setStatusKey("mp.status.copyFail");
		}
	}

	private async createRoom(): Promise<void> {
		try {
			this.disconnect();
			this.remoteInputs = new NetworkControlInputPool();
			const client = await this.connectClient();
			this.wireClient(client);
			client.createRoom(
				Boolean(
					RANKED_UI_ENABLED &&
						isRankedEligibleMode(this.selectedMode) &&
						this.rankedToggle?.checked,
				),
				this.selectedMode,
			);
		} catch (err) {
			this.setStatus(err instanceof Error ? err.message : String(err));
		}
	}

	private async joinRoomFromInput(): Promise<void> {
		const code = this.guestCodeInput.value.trim().toUpperCase();
		if (code.length < 4) {
			this.setStatusKey("mp.status.enterCode");
			return;
		}
		await this.joinRoom(code);
	}

	private async joinRoom(code: string): Promise<void> {
		if (this.joining) return;
		try {
			this.joining = true;
			this.disconnect();
			this.remoteInputs = new NetworkControlInputPool();
			const client = await this.connectClient();
			this.wireClient(client);
			client.joinRoom(code);
		} catch (err) {
			this.joining = false;
			this.setStatus(err instanceof Error ? err.message : String(err));
		}
	}

	private req<T extends HTMLElement = HTMLElement>(selector: string): T {
		const el = this.root.querySelector<T>(selector);
		if (!el) throw new Error(`MultiplayerLobby: brak ${selector}`);
		return el;
	}
}
