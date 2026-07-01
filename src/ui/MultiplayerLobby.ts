import { type I18nKey, onLocaleChange, t } from "../i18n";
import { applyStaticI18n } from "../i18n/staticDom";
import { getMpClientId } from "../net/mpClientId";
import { NetworkControlInput } from "../net/NetworkControlInput";
import type { OnlineRole } from "../net/protocol";
import { RoomClient } from "../net/RoomClient";
import {
	fetchMyRankedStats,
	fetchRankedLeaderboard,
} from "../net/rankedClient";
import {
	fetchOnlineStatus,
	fetchOpenRooms,
	formatOnlineCount,
	resolveMpServerAddress,
} from "../net/serverStatus";

export type OnlineLobbyResult = {
	role: OnlineRole;
	localSlot: number;
	roomClient: RoomClient;
	remoteInput: NetworkControlInput;
	roomCode: string;
	ranked: boolean;
};

export class MultiplayerLobby {
	private readonly root: HTMLElement;
	private readonly onStart: (result: OnlineLobbyResult) => void;
	private readonly onCancel: () => void;
	private roomClient: RoomClient | null = null;
	private remoteInput = new NetworkControlInput();
	private statusEl!: HTMLElement;
	private serverStatusEl!: HTMLElement;
	private roomCodeEl!: HTMLElement;
	private hostPanel!: HTMLElement;
	private guestPanel!: HTMLElement;
	private openRoomsEl!: HTMLElement;
	private guestCodeInput!: HTMLInputElement;
	private rankedToggle!: HTMLInputElement;
	private myEloEl!: HTMLElement;
	private leaderboardEl!: HTMLElement;
	private pendingStart: OnlineLobbyResult | null = null;
	private pollTimer: number | null = null;
	private joining = false;
	private serverRaw = "";
	private lastStatusKey: I18nKey | null = null;
	private lastStatusParams: Record<string, string | number> | undefined;

	constructor(
		onStart: (result: OnlineLobbyResult) => void,
		onCancel: () => void,
	) {
		const el = document.getElementById("mp-lobby");
		if (!el) throw new Error("Brak #mp-lobby");
		this.root = el;
		this.onStart = onStart;
		this.onCancel = onCancel;
		this.render();
		onLocaleChange(() => this.applyLobbyLocale());
	}

	show(): void {
		this.root.classList.remove("hidden");
		this.setStatusKey("mp.status.initial");
		this.roomCodeEl.textContent = "—";
		if (this.guestCodeInput) this.guestCodeInput.value = "";
		this.pendingStart = null;
		this.joining = false;
		void this.ensureServer().then(() => this.refreshLobbyStatus());
		this.startPoll();
	}

	hide(): void {
		this.root.classList.add("hidden");
		this.stopPoll();
	}

	disconnect(): void {
		this.roomClient?.disconnect();
		this.roomClient = null;
		this.pendingStart = null;
		this.joining = false;
	}

	private render(): void {
		this.root.innerHTML = `
 <div class="mp-lobby__veil" aria-hidden="true"></div>
 <div class="mp-lobby__panel">
 <header class="mp-lobby__header">
 <p class="mp-lobby__eyebrow" data-i18n="mp.eyebrow">${t("mp.eyebrow")}</p>
 <h2 class="mp-lobby__title" data-i18n="mp.title">${t("mp.title")}</h2>
 <p class="mp-lobby__server-status" id="mp-server-status" aria-live="polite" data-i18n="mp.connecting">${t("mp.connecting")}</p>
 </header>

 <div class="mp-lobby__tabs">
 <button type="button" class="mp-lobby__tab mp-lobby__tab--active" data-tab="host" data-i18n="mp.tab.host">${t("mp.tab.host")}</button>
 <button type="button" class="mp-lobby__tab" data-tab="guest" data-i18n="mp.tab.guest">${t("mp.tab.guest")}</button>
 </div>

 <section class="mp-lobby__section" id="mp-host-panel">
 <label class="mp-lobby__field mp-lobby__field--inline">
 <input type="checkbox" id="mp-ranked-toggle" />
 <span data-i18n="mp.ranked">${t("mp.ranked")}</span>
 </label>
 <p class="mp-lobby__elo" id="mp-my-elo" aria-live="polite"></p>
 <button type="button" id="mp-host-create" class="mp-lobby__primary" data-i18n="mp.createRoom">${t("mp.createRoom")}</button>
 <div class="mp-lobby__room-code">
 <span data-i18n="mp.yourRoom">${t("mp.yourRoom")}</span>
 <strong id="mp-room-code">—</strong>
 </div>
 <p class="mp-lobby__lan-tip" data-i18n="mp.lanTip">${t("mp.lanTip")}</p>
 </section>

 <section class="mp-lobby__section hidden" id="mp-guest-panel">
 <label class="mp-lobby__field">
 <span data-i18n="mp.roomCode">${t("mp.roomCode")}</span>
 <input type="text" id="mp-join-code" maxlength="6" autocomplete="off" spellcheck="false" placeholder="ABC123" />
 </label>
 <button type="button" id="mp-join-by-code" class="mp-lobby__primary" data-i18n="mp.joinByCode">${t("mp.joinByCode")}</button>
 <div class="mp-lobby__open-rooms">
 <div class="mp-lobby__open-rooms-head">
 <span data-i18n="mp.openRooms">${t("mp.openRooms")}</span>
 <button type="button" id="mp-refresh-rooms" class="mp-lobby__secondary mp-lobby__refresh" data-i18n="mp.refresh">${t("mp.refresh")}</button>
 </div>
 <ul class="mp-lobby__room-list" id="mp-open-rooms" aria-live="polite"></ul>
 </div>
 </section>

 <p class="mp-lobby__status" id="mp-status" aria-live="polite"></p>

 <div class="mp-lobby__leaderboard">
 <span class="mp-lobby__leaderboard-head" data-i18n="mp.topRanked">${t("mp.topRanked")}</span>
 <ol class="mp-lobby__leaderboard-list" id="mp-leaderboard" aria-live="polite"></ol>
 </div>

 <footer class="mp-lobby__footer">
 <button type="button" id="mp-lobby-cancel" class="mp-lobby__secondary" data-i18n="mp.back">${t("mp.back")}</button>
 </footer>
 </div>
 `;

		this.statusEl = this.req("#mp-status");
		this.serverStatusEl = this.req("#mp-server-status");
		this.roomCodeEl = this.req("#mp-room-code");
		this.hostPanel = this.req("#mp-host-panel");
		this.guestPanel = this.req("#mp-guest-panel");
		this.openRoomsEl = this.req("#mp-open-rooms");
		this.guestCodeInput = this.req<HTMLInputElement>("#mp-join-code");
		this.rankedToggle = this.req<HTMLInputElement>("#mp-ranked-toggle");
		this.myEloEl = this.req("#mp-my-elo");
		this.leaderboardEl = this.req("#mp-leaderboard");

		for (const tab of this.root.querySelectorAll<HTMLButtonElement>(
			".mp-lobby__tab",
		)) {
			tab.addEventListener("click", () =>
				this.selectTab(tab.dataset.tab === "guest" ? "guest" : "host"),
			);
		}

		this.req<HTMLButtonElement>("#mp-host-create").addEventListener(
			"click",
			() => void this.createRoom(),
		);
		this.req<HTMLButtonElement>("#mp-refresh-rooms").addEventListener(
			"click",
			() => void this.refreshLobbyStatus(),
		);
		this.req<HTMLButtonElement>("#mp-join-by-code").addEventListener(
			"click",
			() => void this.joinRoomFromInput(),
		);
		this.guestCodeInput.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter") void this.joinRoomFromInput();
		});
		this.req<HTMLButtonElement>("#mp-lobby-cancel").addEventListener(
			"click",
			() => {
				this.disconnect();
				this.onCancel();
			},
		);
	}

	private applyLobbyLocale(): void {
		applyStaticI18n(this.root);
		if (this.lastStatusKey) {
			this.statusEl.textContent = t(this.lastStatusKey, this.lastStatusParams);
		}
		void this.refreshLobbyStatus();
	}

	private selectTab(tab: "host" | "guest"): void {
		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			".mp-lobby__tab",
		)) {
			btn.classList.toggle("mp-lobby__tab--active", btn.dataset.tab === tab);
		}
		this.hostPanel.classList.toggle("hidden", tab !== "host");
		this.guestPanel.classList.toggle("hidden", tab !== "guest");
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

		const stats = await fetchMyRankedStats(serverRaw, getMpClientId());
		if (stats && stats.matches > 0) {
			this.myEloEl.textContent = t("mp.elo.yours", {
				elo: stats.elo,
				wins: stats.wins,
				losses: stats.losses,
			});
		} else {
			this.myEloEl.textContent = t("mp.elo.start");
		}

		const board = await fetchRankedLeaderboard(serverRaw);
		this.leaderboardEl.innerHTML = "";
		if (!board || board.length === 0) {
			const li = document.createElement("li");
			li.className = "mp-lobby__leaderboard-empty";
			li.textContent = t("mp.leaderboard.empty");
			this.leaderboardEl.appendChild(li);
		} else {
			for (const [i, row] of board.slice(0, 5).entries()) {
				const li = document.createElement("li");
				li.textContent = t("mp.leaderboard.row", {
					rank: i + 1,
					elo: row.elo,
					wins: row.wins,
				});
				this.leaderboardEl.appendChild(li);
			}
		}

		if (this.guestPanel.classList.contains("hidden")) return;

		const rooms = await fetchOpenRooms(serverRaw);
		this.renderOpenRooms(rooms);
	}

	private renderOpenRooms(
		rooms: { code: string; ranked?: boolean }[] | null,
	): void {
		this.openRoomsEl.innerHTML = "";
		if (rooms === null) {
			const li = document.createElement("li");
			li.className = "mp-lobby__room-empty";
			li.textContent = t("mp.rooms.noServer");
			this.openRoomsEl.appendChild(li);
			return;
		}
		if (rooms.length === 0) {
			const li = document.createElement("li");
			li.className = "mp-lobby__room-empty";
			li.textContent = t("mp.rooms.waitingHost");
			this.openRoomsEl.appendChild(li);
			return;
		}

		for (const room of rooms) {
			const li = document.createElement("li");
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "mp-lobby__room-item";
			btn.textContent = room.ranked
				? t("mp.rooms.joinRanked", { code: room.code })
				: t("mp.rooms.join", { code: room.code });
			btn.addEventListener("click", () => void this.joinRoom(room.code));
			li.appendChild(btn);
			this.openRoomsEl.appendChild(li);
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
			onWelcome: (roomCode, slot, welcomeRole, ranked, elo) => {
				this.roomCodeEl.textContent = roomCode;
				const rankedLabel = ranked ? t("mp.status.rankedSuffix") : "";
				const eloLabel =
					ranked && elo != null ? t("mp.status.eloSuffix", { elo }) : "";
				const extras = `${rankedLabel}${eloLabel}`;
				this.setStatusKey(
					welcomeRole === "host"
						? "mp.status.roomReadyHost"
						: "mp.status.roomReadyGuest",
					{ extras },
				);
				this.pendingStart = {
					role: welcomeRole,
					localSlot: slot,
					roomClient: client,
					remoteInput: this.remoteInput,
					roomCode,
					ranked,
				};
				void this.refreshLobbyStatus();
			},
			onRankedResult: (before, after, delta) => {
				const sign = delta >= 0 ? "+" : "";
				this.setStatusKey("mp.status.rankedResult", {
					before,
					after,
					sign,
					delta,
				});
			},
			onPeerJoined: () => {
				this.setStatusKey("mp.status.peerJoined");
			},
			onStartMatch: () => {
				if (this.pendingStart) {
					this.stopPoll();
					this.onStart(this.pendingStart);
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
				this.setStatusKey("mp.status.disconnected");
			},
		});
	}

	private async createRoom(): Promise<void> {
		try {
			this.disconnect();
			this.remoteInput = new NetworkControlInput();
			const client = await this.connectClient();
			this.wireClient(client);
			client.createRoom(this.rankedToggle.checked);
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
			this.remoteInput = new NetworkControlInput();
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
