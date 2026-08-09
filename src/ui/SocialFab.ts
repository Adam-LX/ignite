import { t } from "../i18n";
import { SOCIAL_FRIENDS_ICON } from "./socialIcons";

/** Przycisk znajomych — prawy dolny róg (ukryty w meczu przez CSS). */
export class SocialFab {
	readonly root: HTMLButtonElement;
	private badge: HTMLElement;

	constructor(onClick: () => void) {
		this.root = document.createElement("button");
		this.root.id = "social-fab";
		this.root.type = "button";
		this.root.className = "social-fab";
		this.root.setAttribute("aria-label", t("social.fabAria"));
		this.root.setAttribute("aria-expanded", "false");
		this.root.innerHTML = `
			<span class="social-fab__beam" aria-hidden="true"></span>
			<span class="social-fab__icon" aria-hidden="true">${SOCIAL_FRIENDS_ICON}</span>
			<span class="social-fab__meta">
				<span class="social-fab__kicker">Ignite</span>
				<span class="social-fab__label">${t("social.tabFriends")}</span>
			</span>
			<span class="social-fab__badge hidden">0</span>
		`;
		this.badge = this.root.querySelector(".social-fab__badge")!;
		this.root.addEventListener("click", (e) => {
			e.preventDefault();
			onClick();
		});
		document.body.appendChild(this.root);
	}

	setBadge(count: number): void {
		const n = Math.max(0, Math.floor(count));
		this.badge.textContent = n > 9 ? "9+" : String(n);
		this.badge.classList.toggle("hidden", n <= 0);
	}

	setOpen(open: boolean): void {
		this.root.classList.toggle("is-open", open);
		this.root.setAttribute("aria-expanded", open ? "true" : "false");
	}

	dispose(): void {
		this.root.remove();
	}
}
