import { t } from "../i18n";

export type QuickChatId =
	| "great_pass"
	| "nice_shot"
	| "defending"
	| "oops"
	| "close"
	| "calculated"
	| "wow"
	| "gg";

const CHAT_ORDER: QuickChatId[] = [
	"great_pass",
	"nice_shot",
	"defending",
	"oops",
	"close",
	"calculated",
	"wow",
	"gg",
];

export type QuickChatBubble = {
	id: QuickChatId;
	text: string;
	team: "blue" | "orange";
	elapsed: number;
	duration: number;
};

/** Radial quick chat (T) + dymek nad autem. */
export class QuickChatOverlay {
	private readonly wheel: HTMLDivElement;
	private readonly bubble: HTMLDivElement;
	private active = false;
	private hoverId: QuickChatId | null = null;
	private bubbleState: QuickChatBubble | null = null;
	private readonly onPick: (id: QuickChatId) => void;
	private readonly pointerMove: (e: PointerEvent) => void;
	private readonly pointerUp: (e: PointerEvent) => void;

	constructor(onPick: (id: QuickChatId) => void) {
		this.onPick = onPick;
		this.wheel = document.createElement("div");
		this.wheel.id = "quick-chat-wheel";
		this.wheel.className = "hidden";
		this.wheel.setAttribute("aria-hidden", "true");

		for (let i = 0; i < CHAT_ORDER.length; i++) {
			const id = CHAT_ORDER[i]!;
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "quick-chat-wheel__item";
			btn.dataset.chatId = id;
			btn.textContent = t(`quickChat.${id}`);
			const angle = (i / CHAT_ORDER.length) * Math.PI * 2 - Math.PI / 2;
			const r = 118;
			btn.style.setProperty("--qx", `${Math.cos(angle) * r}px`);
			btn.style.setProperty("--qy", `${Math.sin(angle) * r}px`);
			btn.addEventListener("pointerenter", () => {
				this.hoverId = id;
				btn.classList.add("hover");
			});
			btn.addEventListener("pointerleave", () => {
				if (this.hoverId === id) this.hoverId = null;
				btn.classList.remove("hover");
			});
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.commitPick(id);
			});
			this.wheel.appendChild(btn);
		}

		const hub = document.createElement("div");
		hub.className = "quick-chat-wheel__hub";
		hub.textContent = t("quickChat.hold");
		this.wheel.appendChild(hub);

		this.bubble = document.createElement("div");
		this.bubble.id = "quick-chat-bubble";
		this.bubble.className = "hidden";
		this.bubble.setAttribute("aria-live", "polite");

		document.body.append(this.wheel, this.bubble);

		this.pointerMove = (e) => this.updateHoverFromPointer(e.clientX, e.clientY);
		this.pointerUp = () => {
			if (this.active && this.hoverId) this.commitPick(this.hoverId);
			this.closeWheel();
		};
	}

	setOpen(open: boolean): void {
		if (open === this.active) return;
		if (open) {
			this.active = true;
			this.hoverId = null;
			this.wheel.classList.remove("hidden");
			window.addEventListener("pointermove", this.pointerMove);
			window.addEventListener("pointerup", this.pointerUp, { once: true });
		} else {
			this.closeWheel();
		}
	}

	showBubble(id: QuickChatId, team: "blue" | "orange"): void {
		this.bubbleState = {
			id,
			text: t(`quickChat.${id}`),
			team,
			elapsed: 0,
			duration: 2.8,
		};
		this.bubble.textContent = this.bubbleState.text;
		this.bubble.dataset.team = team;
		this.bubble.classList.remove("hidden");
	}

	update(dt: number, screenPos: { x: number; y: number } | null): void {
		if (this.bubbleState) {
			this.bubbleState.elapsed += dt;
			if (this.bubbleState.elapsed >= this.bubbleState.duration) {
				this.bubbleState = null;
				this.bubble.classList.add("hidden");
			} else if (screenPos) {
				this.bubble.style.left = `${screenPos.x}px`;
				this.bubble.style.top = `${screenPos.y - 72}px`;
			}
		}
	}

	isWheelOpen(): boolean {
		return this.active;
	}

	dispose(): void {
		this.closeWheel();
		this.wheel.remove();
		this.bubble.remove();
	}

	private commitPick(id: QuickChatId): void {
		this.onPick(id);
		this.closeWheel();
	}

	private closeWheel(): void {
		if (!this.active) return;
		this.active = false;
		this.hoverId = null;
		this.wheel.classList.add("hidden");
		window.removeEventListener("pointermove", this.pointerMove);
		for (const btn of this.wheel.querySelectorAll(".quick-chat-wheel__item")) {
			btn.classList.remove("hover");
		}
	}

	private updateHoverFromPointer(clientX: number, clientY: number): void {
		const rect = this.wheel.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		const dx = clientX - cx;
		const dy = clientY - cy;
		const dist = Math.hypot(dx, dy);
		if (dist < 36) {
			this.hoverId = null;
			for (const btn of this.wheel.querySelectorAll(
				".quick-chat-wheel__item",
			)) {
				btn.classList.remove("hover");
			}
			return;
		}
		let angle = Math.atan2(dy, dx) + Math.PI / 2;
		if (angle < 0) angle += Math.PI * 2;
		const idx = Math.floor((angle / (Math.PI * 2)) * CHAT_ORDER.length);
		const id = CHAT_ORDER[idx % CHAT_ORDER.length]!;
		this.hoverId = id;
		for (const btn of this.wheel.querySelectorAll<HTMLButtonElement>(
			".quick-chat-wheel__item",
		)) {
			btn.classList.toggle("hover", btn.dataset.chatId === id);
		}
	}
}
