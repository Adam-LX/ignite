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

/** Krótka etykieta na segmencie — pełny tekst w hubie. */
const CHAT_SHORT: Record<QuickChatId, string> = {
	great_pass: "PASS",
	nice_shot: "SHOT",
	defending: "DEF",
	oops: "OOPS",
	close: "CLOSE",
	calculated: "CALC",
	wow: "WOW",
	gg: "GG",
};

export type QuickChatBubble = {
	id: QuickChatId;
	text: string;
	team: "blue" | "orange";
	elapsed: number;
	duration: number;
};

const N = CHAT_ORDER.length;
const LABEL_R = 96;

function wedgePath(
	i: number,
	innerR: number,
	outerR: number,
	gapDeg = 2.8,
): string {
	const slice = 360 / N;
	const start = -90 + i * slice + gapDeg * 0.5;
	const end = -90 + (i + 1) * slice - gapDeg * 0.5;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const x0 = Math.cos(toRad(start));
	const y0 = Math.sin(toRad(start));
	const x1 = Math.cos(toRad(end));
	const y1 = Math.sin(toRad(end));
	const large = end - start > 180 ? 1 : 0;
	return [
		`M ${x0 * innerR} ${y0 * innerR}`,
		`L ${x0 * outerR} ${y0 * outerR}`,
		`A ${outerR} ${outerR} 0 ${large} 1 ${x1 * outerR} ${y1 * outerR}`,
		`L ${x1 * innerR} ${y1 * innerR}`,
		`A ${innerR} ${innerR} 0 ${large} 0 ${x0 * innerR} ${y0 * innerR}`,
		"Z",
	].join(" ");
}

/** Radial quick chat (T) + dymek nad autem. */
export class QuickChatOverlay {
	private readonly root: HTMLDivElement;
	private readonly wheel: HTMLDivElement;
	private readonly ring: SVGSVGElement;
	private readonly hubPreview: HTMLSpanElement;
	private readonly bubble: HTMLDivElement;
	private readonly wedgeEls: SVGPathElement[] = [];
	private readonly itemEls: HTMLButtonElement[] = [];
	private active = false;
	private hoverId: QuickChatId | null = null;
	private bubbleState: QuickChatBubble | null = null;
	private readonly onPick: (id: QuickChatId) => void;
	private readonly pointerMove: (e: PointerEvent) => void;
	private readonly pointerUp: (e: PointerEvent) => void;

	constructor(onPick: (id: QuickChatId) => void) {
		this.onPick = onPick;

		this.root = document.createElement("div");
		this.root.id = "quick-chat-root";
		this.root.className = "hidden";
		this.root.setAttribute("aria-hidden", "true");

		this.wheel = document.createElement("div");
		this.wheel.id = "quick-chat-wheel";
		this.wheel.setAttribute("role", "menu");
		this.wheel.setAttribute("aria-label", t("quickChat.hold"));

		this.ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		this.ring.classList.add("quick-chat-wheel__ring");
		this.ring.setAttribute("viewBox", "-120 -120 240 240");
		this.ring.setAttribute("aria-hidden", "true");

		const glow = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"circle",
		);
		glow.setAttribute("class", "quick-chat-wheel__glow");
		glow.setAttribute("r", "110");
		this.ring.appendChild(glow);

		const track = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"circle",
		);
		track.setAttribute("class", "quick-chat-wheel__track");
		track.setAttribute("r", "84");
		this.ring.appendChild(track);

		for (let i = 0; i < N; i++) {
			const path = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"path",
			);
			path.setAttribute("class", "quick-chat-wheel__wedge");
			path.setAttribute("d", wedgePath(i, 40, 102));
			path.dataset.chatId = CHAT_ORDER[i]!;
			this.ring.appendChild(path);
			this.wedgeEls.push(path);
		}
		this.wheel.appendChild(this.ring);

		for (let i = 0; i < N; i++) {
			const id = CHAT_ORDER[i]!;
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "quick-chat-wheel__item";
			btn.dataset.chatId = id;
			btn.setAttribute("role", "menuitem");

			const short = document.createElement("span");
			short.className = "quick-chat-wheel__short";
			short.textContent = CHAT_SHORT[id];
			const full = document.createElement("span");
			full.className = "quick-chat-wheel__full";
			full.textContent = t(`quickChat.${id}`);
			btn.append(short, full);

			const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
			btn.style.setProperty("--qx", `${Math.cos(angle) * LABEL_R}px`);
			btn.style.setProperty("--qy", `${Math.sin(angle) * LABEL_R}px`);
			btn.addEventListener("pointerenter", () => this.setHover(id));
			btn.addEventListener("pointerleave", () => {
				if (this.hoverId === id) this.setHover(null);
			});
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.commitPick(id);
			});
			this.wheel.appendChild(btn);
			this.itemEls.push(btn);
		}

		const hub = document.createElement("div");
		hub.className = "quick-chat-wheel__hub";
		const hubKey = document.createElement("span");
		hubKey.className = "quick-chat-wheel__hub-key";
		hubKey.textContent = t("quickChat.hold");
		const hubHint = document.createElement("span");
		hubHint.className = "quick-chat-wheel__hub-hint";
		hubHint.textContent = t("quickChat.release");
		this.hubPreview = document.createElement("span");
		this.hubPreview.className = "quick-chat-wheel__hub-preview";
		this.hubPreview.textContent = t("quickChat.aim");
		hub.append(hubKey, this.hubPreview, hubHint);
		this.wheel.appendChild(hub);

		this.root.appendChild(this.wheel);

		this.bubble = document.createElement("div");
		this.bubble.id = "quick-chat-bubble";
		this.bubble.className = "hidden";
		this.bubble.setAttribute("aria-live", "polite");

		document.body.append(this.root, this.bubble);

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
			this.setHover(null);
			this.root.classList.remove("hidden");
			this.root.classList.add("quick-chat-root--open");
			this.root.setAttribute("aria-hidden", "false");
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
		this.root.remove();
		this.bubble.remove();
	}

	private commitPick(id: QuickChatId): void {
		this.onPick(id);
		this.closeWheel();
	}

	private closeWheel(): void {
		if (!this.active) return;
		this.active = false;
		this.setHover(null);
		this.root.classList.add("hidden");
		this.root.classList.remove("quick-chat-root--open");
		this.root.setAttribute("aria-hidden", "true");
		window.removeEventListener("pointermove", this.pointerMove);
	}

	private setHover(id: QuickChatId | null): void {
		this.hoverId = id;
		for (const wedge of this.wedgeEls) {
			wedge.classList.toggle("is-hot", wedge.dataset.chatId === id);
		}
		for (const btn of this.itemEls) {
			btn.classList.toggle("hover", btn.dataset.chatId === id);
		}
		this.hubPreview.textContent = id
			? t(`quickChat.${id}`)
			: t("quickChat.aim");
		this.wheel.classList.toggle("has-hover", id != null);
	}

	private updateHoverFromPointer(clientX: number, clientY: number): void {
		const rect = this.wheel.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		const dx = clientX - cx;
		const dy = clientY - cy;
		const dist = Math.hypot(dx, dy);
		if (dist < 40) {
			this.setHover(null);
			return;
		}
		let angle = Math.atan2(dy, dx) + Math.PI / 2;
		if (angle < 0) angle += Math.PI * 2;
		const idx = Math.floor((angle / (Math.PI * 2)) * N);
		this.setHover(CHAT_ORDER[idx % N]!);
	}
}
