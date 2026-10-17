import { t } from "../i18n";
import type { FriendEntry, FriendRequest, DmMessage } from "../social/FriendsStore";
import type { LobbyStatePayload } from "../net/protocol";
import { getInviteCode, getSocialDisplayName } from "../social/SocialIdentity";
import { SOCIAL_CHAT_ICON, SOCIAL_FRIENDS_ICON, SOCIAL_PARTY_ICON } from "./socialIcons";

export type SocialTab = "friends" | "party" | "chat";

export type SocialPanelCallbacks = {
	onClose: () => void;
	onAddFriend: (inviteCode: string) => void;
	onAccept: (socialId: string) => void;
	onIgnore: (socialId: string) => void;
	onRemove: (socialId: string) => void;
	onInviteParty: (socialId: string) => void;
	onOpenDm: (socialId: string) => void;
	onSendDm: (text: string) => void;
	onSendPartyChat: (text: string) => void;
	onCopyCode: () => void;
	onDisplayNameChange: (name: string) => void;
	onJoinInviteRoom?: (roomCode: string) => void;
};

export type SocialPanelModel = {
	friends: FriendEntry[];
	incoming: FriendRequest[];
	outgoing: FriendRequest[];
	dmPeerId: string | null;
	dmPeerName: string;
	dmThread: DmMessage[];
	selfId: string;
	lobby: LobbyStatePayload | null;
	roomCode: string | null;
	partyChat: { fromName: string; text: string; at: number }[];
	pendingInvite: { fromName: string; roomCode: string } | null;
	connected: boolean;
	statusLine: string;
};

/** Panel RL-style: Znajomi | Party | Czat. */
export class SocialPanel {
	readonly root: HTMLElement;
	private tab: SocialTab = "friends";
	private bodyEl: HTMLElement;
	private tabsEl: HTMLElement;
	private readonly cb: SocialPanelCallbacks;

	constructor(cb: SocialPanelCallbacks) {
		this.cb = cb;
		this.root = document.createElement("div");
		this.root.id = "social-panel";
		this.root.className = "social-panel hidden";
		this.root.setAttribute("role", "dialog");
		this.root.setAttribute("aria-label", t("social.panelTitle"));
		this.root.innerHTML = `
			<span class="social-panel__shell" aria-hidden="true"></span>
			<span class="social-panel__glow social-panel__glow--cyan" aria-hidden="true"></span>
			<span class="social-panel__glow social-panel__glow--orange" aria-hidden="true"></span>
			<span class="social-panel__glow social-panel__glow--floor" aria-hidden="true"></span>
			<span class="social-panel__edge" aria-hidden="true"></span>
			<span class="social-panel__corner social-panel__corner--tl" aria-hidden="true"></span>
			<span class="social-panel__corner social-panel__corner--bl" aria-hidden="true"></span>
			<header class="social-panel__head">
				<div class="social-panel__brand">
					<p class="social-panel__eyebrow">Ignite Social</p>
					<div class="social-panel__title ignite-hero-type ignite-hero-type--on-dark">${t("social.panelTitle")}</div>
				</div>
				<button type="button" class="social-panel__close" aria-label="${t("social.close")}" title="${t("social.close")}">
					<span aria-hidden="true">✕</span>
				</button>
			</header>
			<nav class="social-panel__tabs" role="tablist"></nav>
			<div class="social-panel__body"></div>
		`;
		this.tabsEl = this.root.querySelector(".social-panel__tabs")!;
		this.bodyEl = this.root.querySelector(".social-panel__body")!;
		this.root.querySelector(".social-panel__close")!.addEventListener("click", () => {
			this.cb.onClose();
		});
		this.renderTabs();
		document.body.appendChild(this.root);
	}

	setOpen(open: boolean): void {
		if (open) {
			this.root.classList.remove("hidden", "is-closing");
			/** Restart slide-in even when already visible. */
			this.root.classList.remove("is-open");
			void this.root.offsetWidth;
			this.root.classList.add("is-open");
			return;
		}
		if (this.root.classList.contains("hidden")) return;
		this.root.classList.remove("is-open");
		this.root.classList.add("is-closing");
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			this.root.classList.add("hidden");
			this.root.classList.remove("is-closing");
			this.root.removeEventListener("animationend", finish);
		};
		this.root.addEventListener("animationend", finish);
		window.setTimeout(finish, 340);
	}

	setTab(tab: SocialTab): void {
		this.tab = tab;
		this.renderTabs();
	}

	getTab(): SocialTab {
		return this.tab;
	}

	render(model: SocialPanelModel): void {
		this.renderTabs();
		if (this.tab === "friends") this.renderFriends(model);
		else if (this.tab === "party") this.renderParty(model);
		else this.renderChat(model);
	}

	dispose(): void {
		this.root.remove();
	}

	private renderTabs(): void {
		const tabs: { id: SocialTab; label: string; icon: string }[] = [
			{ id: "friends", label: t("social.tabFriends"), icon: TAB_ICON_FRIENDS },
			{ id: "party", label: t("social.tabParty"), icon: TAB_ICON_PARTY },
			{ id: "chat", label: t("social.tabChat"), icon: TAB_ICON_CHAT },
		];
		this.tabsEl.innerHTML = "";
		for (const tab of tabs) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "social-panel__tab";
			btn.dataset.tab = tab.id;
			btn.dataset.hint = tab.label;
			btn.setAttribute("role", "tab");
			btn.setAttribute("aria-label", tab.label);
			btn.setAttribute("aria-selected", this.tab === tab.id ? "true" : "false");
			btn.title = tab.label;
			btn.classList.toggle("is-active", this.tab === tab.id);
			btn.innerHTML = `<span class="social-panel__tab-icon" aria-hidden="true">${tab.icon}</span>`;
			btn.addEventListener("click", () => {
				if (this.tab === tab.id) return;
				this.tab = tab.id;
				this.root.dispatchEvent(
					new CustomEvent("social-tab", { detail: tab.id, bubbles: true }),
				);
			});
			this.tabsEl.appendChild(btn);
		}
	}

	private renderFriends(model: SocialPanelModel): void {
		const code = getInviteCode();
		const name = getSocialDisplayName();
		this.bodyEl.innerHTML = `
			<section class="social-section social-identity-card">
				<div class="social-field">
					<label class="social-label" for="social-name">${t("social.yourName")}</label>
					<input type="text" class="social-input" id="social-name" maxlength="24" value="${escapeAttr(name)}" />
				</div>
				<div class="social-field">
					<span class="social-label" id="social-code-label">${t("social.yourCode")}</span>
					<div class="social-code-row" aria-labelledby="social-code-label">
						<code class="social-code">${escapeHtml(code)}</code>
						<button type="button" class="social-btn social-btn--ghost" id="social-copy">${t("social.copy")}</button>
					</div>
				</div>
				<div class="social-status-line">${escapeHtml(model.statusLine)}</div>
			</section>
			<section class="social-section social-add-card">
				<div class="social-field">
					<label class="social-label" for="social-add-code">${t("social.addFriend")}</label>
					<div class="social-row">
						<input type="text" class="social-input" id="social-add-code" placeholder="IGN-XXXX" maxlength="12" autocomplete="off" />
						<button type="button" class="social-btn social-btn--primary" id="social-add-btn">${t("social.add")}</button>
					</div>
				</div>
			</section>
			<section class="social-section" id="social-incoming"></section>
			<section class="social-section" id="social-outgoing"></section>
			<section class="social-section">
				<div class="social-section__title">${t("social.friendsList")}</div>
				<p class="social-empty" id="social-friends-empty" hidden></p>
				<ul class="social-list" id="social-friends"></ul>
			</section>
		`;

		this.bodyEl.querySelector("#social-copy")!.addEventListener("click", () => {
			this.cb.onCopyCode();
		});
		const nameInput = this.bodyEl.querySelector("#social-name") as HTMLInputElement;
		nameInput.addEventListener("change", () => {
			this.cb.onDisplayNameChange(nameInput.value);
		});
		const addBtn = this.bodyEl.querySelector("#social-add-btn")!;
		const addInput = this.bodyEl.querySelector("#social-add-code") as HTMLInputElement;
		const doAdd = () => {
			const v = addInput.value.trim();
			if (v) this.cb.onAddFriend(v);
			addInput.value = "";
		};
		addBtn.addEventListener("click", doAdd);
		addInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") doAdd();
		});

		const incoming = this.bodyEl.querySelector("#social-incoming")!;
		if (model.incoming.length) {
			incoming.innerHTML = `<div class="social-section__title">${t("social.incoming")}</div>`;
			const ul = document.createElement("ul");
			ul.className = "social-list";
			for (const req of model.incoming) {
				ul.appendChild(this.friendRequestRow(req, true));
			}
			incoming.appendChild(ul);
		}

		const outgoing = this.bodyEl.querySelector("#social-outgoing")!;
		if (model.outgoing.length) {
			outgoing.innerHTML = `<div class="social-section__title">${t("social.outgoing")}</div>
				<ul class="social-list">${model.outgoing
					.map(
						(r) =>
							`<li class="social-row-item"><span>${escapeHtml(r.name)} · ${escapeHtml(r.inviteCode)}</span><span class="social-muted">${t("social.pending")}</span></li>`,
					)
					.join("")}</ul>`;
		}

		const emptyEl = this.bodyEl.querySelector("#social-friends-empty") as HTMLElement;
		const list = this.bodyEl.querySelector("#social-friends")!;
		if (!model.friends.length) {
			emptyEl.hidden = false;
			emptyEl.textContent = t("social.noFriends");
			list.replaceChildren();
		} else {
			emptyEl.hidden = true;
			emptyEl.textContent = "";
			for (const f of model.friends) {
				list.appendChild(this.friendRow(f));
			}
		}
	}

	private friendRequestRow(req: FriendRequest, incoming: boolean): HTMLElement {
		const li = document.createElement("li");
		li.className = "social-row-item";
		li.innerHTML = `
			<span class="social-row-item__main">
				<strong>${escapeHtml(req.name)}</strong>
				<span class="social-muted">${escapeHtml(req.inviteCode)}</span>
			</span>
			<span class="social-row-item__actions"></span>
		`;
		const actions = li.querySelector(".social-row-item__actions")!;
		if (incoming) {
			const accept = document.createElement("button");
			accept.type = "button";
			accept.className = "social-btn social-btn--primary social-btn--sm";
			accept.textContent = t("social.accept");
			accept.addEventListener("click", () => this.cb.onAccept(req.socialId));
			const ignore = document.createElement("button");
			ignore.type = "button";
			ignore.className = "social-btn social-btn--ghost social-btn--sm";
			ignore.textContent = t("social.ignore");
			ignore.addEventListener("click", () => this.cb.onIgnore(req.socialId));
			actions.append(accept, ignore);
		}
		return li;
	}

	private friendRow(f: FriendEntry): HTMLElement {
		const li = document.createElement("li");
		li.className = "social-row-item";
		li.innerHTML = `
			<span class="social-row-item__main">
				<span class="social-presence social-presence--${f.status}" title="${f.status}"></span>
				<strong>${escapeHtml(f.name)}</strong>
				<span class="social-muted">${statusLabel(f.status)}</span>
			</span>
			<span class="social-row-item__actions"></span>
		`;
		const actions = li.querySelector(".social-row-item__actions")!;
		const chat = document.createElement("button");
		chat.type = "button";
		chat.className = "social-btn social-btn--ghost social-btn--sm";
		chat.textContent = t("social.dm");
		chat.addEventListener("click", () => this.cb.onOpenDm(f.socialId));
		const invite = document.createElement("button");
		invite.type = "button";
		invite.className = "social-btn social-btn--primary social-btn--sm";
		invite.textContent = t("social.invite");
		invite.disabled = f.status === "offline";
		invite.addEventListener("click", () => this.cb.onInviteParty(f.socialId));
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "social-btn social-btn--ghost social-btn--sm";
		remove.textContent = t("social.remove");
		remove.addEventListener("click", () => this.cb.onRemove(f.socialId));
		actions.append(chat, invite, remove);
		return li;
	}

	private renderParty(model: SocialPanelModel): void {
		const slots = model.lobby?.slots ?? [];
		this.bodyEl.innerHTML = `
			<section class="social-section">
				<div class="social-section__title">${t("social.party")}</div>
				<div class="social-room-pill">${model.roomCode ? `${t("social.room")}: <strong>${escapeHtml(model.roomCode)}</strong>` : t("social.noParty")}</div>
				<ul class="social-list" id="social-party-slots"></ul>
			</section>
			<section class="social-section" id="social-party-invite-banner"></section>
			<section class="social-section social-chat-section">
				<div class="social-section__title">${t("social.partyChat")}</div>
				<div class="social-chat-log" id="social-party-log"></div>
				<div class="social-row social-compose">
					<input type="text" class="social-input" id="social-party-input" maxlength="280" placeholder="${t("social.chatPlaceholder")}" ${model.roomCode ? "" : "disabled"} />
					<button type="button" class="social-btn social-btn--primary" id="social-party-send" ${model.roomCode ? "" : "disabled"}>${t("social.send")}</button>
				</div>
			</section>
		`;
		const ul = this.bodyEl.querySelector("#social-party-slots")!;
		if (!slots.length) {
			ul.innerHTML = `<li class="social-empty">${t("social.noParty")}</li>`;
		} else {
			for (const s of slots) {
				const li = document.createElement("li");
				li.className = "social-row-item";
				li.innerHTML = `<span class="social-row-item__main"><strong>${escapeHtml(s.name)}</strong>${s.isBot ? '<span class="social-muted">bot</span>' : ""}${s.ready ? '<span class="social-ready">✓</span>' : ""}</span>
					<span class="social-team social-team--${s.team}">${s.team}</span>`;
				ul.appendChild(li);
			}
		}

		const banner = this.bodyEl.querySelector("#social-party-invite-banner")!;
		if (model.pendingInvite) {
			banner.innerHTML = `
				<div class="social-invite-banner">
					<span>${t("social.partyInviteFrom", { name: model.pendingInvite.fromName, code: model.pendingInvite.roomCode })}</span>
					<button type="button" class="social-btn social-btn--primary social-btn--sm" id="social-join-invite">${t("social.joinRoom")}</button>
				</div>`;
			banner.querySelector("#social-join-invite")!.addEventListener("click", () => {
				this.cb.onJoinInviteRoom?.(model.pendingInvite!.roomCode);
			});
		}

		const log = this.bodyEl.querySelector("#social-party-log")!;
		log.innerHTML = model.partyChat
			.map(
				(m) =>
					`<div class="social-chat-line"><span class="social-chat-line__who">${escapeHtml(m.fromName)}</span><span class="social-chat-line__text">${escapeHtml(m.text)}</span></div>`,
			)
			.join("");
		log.scrollTop = log.scrollHeight;

		const input = this.bodyEl.querySelector("#social-party-input") as HTMLInputElement;
		const send = () => {
			const v = input.value.trim();
			if (!v) return;
			this.cb.onSendPartyChat(v);
			input.value = "";
		};
		this.bodyEl.querySelector("#social-party-send")!.addEventListener("click", send);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") send();
		});
	}

	private renderChat(model: SocialPanelModel): void {
		this.bodyEl.innerHTML = `
			<section class="social-section social-chat-section">
				<div class="social-section__title">${t("social.tabChat")}</div>
				<div class="social-dm-peer">${model.dmPeerId ? escapeHtml(model.dmPeerName) : t("social.pickFriendForDm")}</div>
				<div class="social-chat-log social-chat-log--tall" id="social-dm-log"></div>
				<div class="social-row social-compose">
					<input type="text" class="social-input" id="social-dm-input" maxlength="280" placeholder="${t("social.chatPlaceholder")}" ${model.dmPeerId ? "" : "disabled"} />
					<button type="button" class="social-btn social-btn--primary" id="social-dm-send" ${model.dmPeerId ? "" : "disabled"}>${t("social.send")}</button>
				</div>
			</section>
		`;
		const log = this.bodyEl.querySelector("#social-dm-log")!;
		log.innerHTML = model.dmThread
			.map((m) => {
				const mine = m.fromSocialId === model.selfId;
				return `<div class="social-chat-line ${mine ? "is-mine" : ""}"><span class="social-chat-line__who">${mine ? t("social.you") : escapeHtml(model.dmPeerName)}</span><span class="social-chat-line__text">${escapeHtml(m.text)}</span></div>`;
			})
			.join("");
		log.scrollTop = log.scrollHeight;

		const input = this.bodyEl.querySelector("#social-dm-input") as HTMLInputElement;
		const send = () => {
			const v = input.value.trim();
			if (!v) return;
			this.cb.onSendDm(v);
			input.value = "";
		};
		this.bodyEl.querySelector("#social-dm-send")!.addEventListener("click", send);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") send();
		});
	}
}

function statusLabel(s: FriendEntry["status"]): string {
	switch (s) {
		case "online":
			return t("social.statusOnline");
		case "inLobby":
			return t("social.statusLobby");
		case "inMatch":
			return t("social.statusMatch");
		default:
			return t("social.statusOffline");
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
	return escapeHtml(s).replace(/'/g, "&#39;");
}

const TAB_ICON_FRIENDS = SOCIAL_FRIENDS_ICON;
const TAB_ICON_PARTY = SOCIAL_PARTY_ICON;
const TAB_ICON_CHAT = SOCIAL_CHAT_ICON;
