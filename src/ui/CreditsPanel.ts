/** Panel credits / licencje — C lub przycisk w HUD / menu głównym. */
export class CreditsPanel {
	private open = false;
	private closing = false;

	constructor() {
		const panel = document.getElementById("credits-panel");
		const trigger = document.getElementById("credits-trigger");

		trigger?.addEventListener("click", () => this.show());
		panel?.addEventListener("click", (e) => {
			const target = e.target as HTMLElement | null;
			if (e.target === panel) this.hide();
			if (target?.closest("#credits-close")) this.hide();
		});

		window.addEventListener("keydown", (e) => {
			if (
				(e.key === "c" || e.key === "C") &&
				!e.ctrlKey &&
				!e.metaKey &&
				!e.altKey
			) {
				const tag = (e.target as HTMLElement | null)?.tagName;
				if (tag === "INPUT" || tag === "TEXTAREA") return;
				if (this.open) this.hide();
				else this.show();
				return;
			}
			if (e.key === "Escape" && this.open) {
				e.preventDefault();
				this.hide();
			}
		});
	}

	show(): void {
		this.setOpen(true);
	}

	hide(): void {
		this.setOpen(false);
	}

	isOpen(): boolean {
		return this.open;
	}

	private setOpen(value: boolean): void {
		const panel = document.getElementById("credits-panel");
		if (!panel) return;

		if (value) {
			this.closing = false;
			this.open = true;
			panel.classList.remove("hidden", "is-closing");
			panel.classList.remove("is-open");
			void panel.offsetWidth;
			panel.classList.add("is-open");
			return;
		}

		if (!this.open || this.closing) return;
		this.open = false;
		this.closing = true;
		panel.classList.remove("is-open");
		panel.classList.add("is-closing");

		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			this.closing = false;
			panel.classList.add("hidden");
			panel.classList.remove("is-closing");
			panel.removeEventListener("animationend", finish);
		};
		panel.addEventListener("animationend", finish);
		window.setTimeout(finish, 240);
	}
}
