/** Panel credits / licencje — C lub przycisk w HUD / menu głównym. */
export class CreditsPanel {
	private open = false;

	constructor() {
		const panel = document.getElementById("credits-panel");
		const trigger = document.getElementById("credits-trigger");

		trigger?.addEventListener("click", () => this.show());
		panel?.addEventListener("click", (e) => {
			const target = e.target as HTMLElement | null;
			if (e.target === panel) this.hide();
			if (target?.id === "credits-close") this.hide();
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
		this.open = value;
		document
			.getElementById("credits-panel")
			?.classList.toggle("hidden", !value);
	}
}
