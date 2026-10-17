import { getLocale, onLocaleChange, setLocale, t } from "../i18n";
import { applyStaticI18n } from "../i18n/staticDom";
import {
	isAutoPlayerReportEnabled,
	setAutoPlayerReportEnabled,
} from "../diagnostic/autoPlayerReport";
import {
	buildPlayerReport,
	copyReportToClipboard,
	sendPlayerReport,
} from "../diagnostic/PlayerReport";
import { GAME_VERSION } from "../util/gameVersion";
import {
	type GraphicsQuality,
	resolveGraphicsSettings,
	setGraphicsQuality,
} from "../util/graphicsProfile";
import {
	type CinematicCameraMode,
	getCinematicCameraMode,
	isCommentatorEnabled,
	isGpuRealtimeRtEnabled,
	isPathTraceLookEnabled,
	isUiVignetteEnabled,
	setCinematicCameraMode,
	setCommentatorEnabled,
	setGpuRealtimeRtEnabled,
	setPathTraceLookEnabled,
	setUiVignette,
} from "../util/presentationPrefs";

export type SettingsOverlayOptions = {
	onGraphicsChange?: (quality: GraphicsQuality) => void;
	onPathTraceLookChange?: (enabled: boolean) => void;
	onGpuRealtimeRtChange?: (enabled: boolean) => void;
};

function graphicsLabel(quality: GraphicsQuality): string {
	switch (quality) {
		case "low":
			return t("settings.graphics.low");
		case "medium":
			return t("settings.graphics.medium");
		case "deck":
			return t("settings.graphics.deck");
		default:
			return t("settings.graphics.high");
	}
}

/** Współdzielony panel ustawień — menu główne i pauza. */
export class SettingsOverlay {
	private readonly root: HTMLElement;
	private readonly onGraphicsChange?: (quality: GraphicsQuality) => void;
	private readonly onPathTraceLookChange?: (enabled: boolean) => void;
	private readonly onGpuRealtimeRtChange?: (enabled: boolean) => void;
	private keyHandler: ((e: KeyboardEvent) => void) | null = null;
	private visible = false;

	constructor(options: SettingsOverlayOptions = {}) {
		this.onGraphicsChange = options.onGraphicsChange;
		this.onPathTraceLookChange = options.onPathTraceLookChange;
		this.onGpuRealtimeRtChange = options.onGpuRealtimeRtChange;
		const el = document.createElement("div");
		el.id = "settings-overlay";
		el.className = "settings-overlay hidden";
		el.setAttribute("role", "dialog");
		el.setAttribute("aria-modal", "true");
		el.setAttribute("aria-labelledby", "settings-overlay-title");
		document.body.appendChild(el);
		this.root = el;
		this.render();
		onLocaleChange(() => this.applyLocale());
	}

	isVisible(): boolean {
		return this.visible;
	}

	show(): void {
		if (this.visible) return;
		this.visible = true;
		document.body.classList.add("settings-open");
		this.root.classList.remove("hidden");
		void this.root.offsetWidth;
		this.root.classList.add("settings-overlay--open");
		this.syncControls();
		this.bindKeyboard();
		this.req<HTMLButtonElement>("[data-settings-close]").focus();
	}

	hide(): void {
		if (!this.visible) return;
		this.visible = false;
		document.body.classList.remove("settings-open");
		this.root.classList.remove("settings-overlay--open");
		this.root.classList.add("hidden");
		if (this.keyHandler) {
			window.removeEventListener("keydown", this.keyHandler);
			this.keyHandler = null;
		}
	}

	toggle(): void {
		if (this.visible) this.hide();
		else this.show();
	}

	private render(): void {
		this.root.innerHTML = `
      <div class="settings-overlay__dimmer" data-settings-close tabindex="-1" aria-hidden="true"></div>
      <div class="settings-overlay__panel glass-panel">
        <header class="settings-overlay__head">
          <h2 id="settings-overlay-title" data-i18n="settings.title">${t("settings.title")}</h2>
        </header>

        <section class="settings-section">
          <h3 class="settings-section__label" data-i18n="settings.graphics.title">${t("settings.graphics.title")}</h3>
          <p class="settings-section__hint" data-i18n="settings.graphics.hint">${t("settings.graphics.hint")}</p>
          <div class="segmented-control" role="group" data-i18n-aria="settings.graphics.title" aria-label="${t("settings.graphics.title")}">
            <button type="button" class="segmented-control__btn" data-gfx="low">${graphicsLabel("low")}</button>
            <button type="button" class="segmented-control__btn" data-gfx="medium">${graphicsLabel("medium")}</button>
            <button type="button" class="segmented-control__btn" data-gfx="high">${graphicsLabel("high")}</button>
            <button type="button" class="segmented-control__btn" data-gfx="deck">${graphicsLabel("deck")}</button>
          </div>
        </section>

        <section class="settings-section">
          <h3 class="settings-section__label" data-i18n="settings.presentation.title">${t("settings.presentation.title")}</h3>
          <p class="settings-section__hint" data-i18n="settings.presentation.vignetteHint">${t("settings.presentation.vignetteHint")}</p>
          <p class="settings-section__sub" data-i18n="settings.presentation.vignette">${t("settings.presentation.vignette")}</p>
          <div class="segmented-control" role="group" data-i18n-aria="settings.presentation.vignette" aria-label="${t("settings.presentation.vignette")}">
            <button type="button" class="segmented-control__btn" data-vignette="off">${t("settings.presentation.off")}</button>
            <button type="button" class="segmented-control__btn" data-vignette="on">${t("settings.presentation.on")}</button>
          </div>
          <p class="settings-section__hint" data-i18n="settings.presentation.cinematicHint">${t("settings.presentation.cinematicHint")}</p>
          <p class="settings-section__sub" data-i18n="settings.presentation.cinematic">${t("settings.presentation.cinematic")}</p>
          <div class="segmented-control" role="group" data-i18n-aria="settings.presentation.cinematic" aria-label="${t("settings.presentation.cinematic")}">
            <button type="button" class="segmented-control__btn" data-cinematic="on">${t("settings.presentation.cinematic.on")}</button>
            <button type="button" class="segmented-control__btn" data-cinematic="reduced">${t("settings.presentation.cinematic.reduced")}</button>
            <button type="button" class="segmented-control__btn" data-cinematic="off">${t("settings.presentation.cinematic.off")}</button>
          </div>
          <p class="settings-section__hint" data-i18n="settings.presentation.commentatorHint">${t("settings.presentation.commentatorHint")}</p>
          <p class="settings-section__sub" data-i18n="settings.presentation.commentator">${t("settings.presentation.commentator")}</p>
          <div class="segmented-control" role="group" data-i18n-aria="settings.presentation.commentator" aria-label="${t("settings.presentation.commentator")}">
            <button type="button" class="segmented-control__btn" data-commentator="off">${t("settings.presentation.off")}</button>
            <button type="button" class="segmented-control__btn" data-commentator="on">${t("settings.presentation.on")}</button>
          </div>
          <p class="settings-section__hint" data-i18n="settings.presentation.pathTraceHint">${t("settings.presentation.pathTraceHint")}</p>
          <p class="settings-section__sub" data-i18n="settings.presentation.pathTrace">${t("settings.presentation.pathTrace")}</p>
          <div class="segmented-control" role="group" data-i18n-aria="settings.presentation.pathTrace" aria-label="${t("settings.presentation.pathTrace")}">
            <button type="button" class="segmented-control__btn" data-path-trace="off">${t("settings.presentation.off")}</button>
            <button type="button" class="segmented-control__btn" data-path-trace="on">${t("settings.presentation.on")}</button>
          </div>
          <p class="settings-section__hint" data-i18n="settings.presentation.gpuRtHint">${t("settings.presentation.gpuRtHint")}</p>
          <p class="settings-section__sub" data-i18n="settings.presentation.gpuRt">${t("settings.presentation.gpuRt")}</p>
          <div class="segmented-control" role="group" data-i18n-aria="settings.presentation.gpuRt" aria-label="${t("settings.presentation.gpuRt")}">
            <button type="button" class="segmented-control__btn" data-gpu-rt="off">${t("settings.presentation.off")}</button>
            <button type="button" class="segmented-control__btn" data-gpu-rt="on">${t("settings.presentation.on")}</button>
          </div>
        </section>

        <section class="settings-section">
          <h3 class="settings-section__label" data-i18n="settings.language.title">${t("settings.language.title")}</h3>
          <div class="segmented-control" role="group" data-i18n-aria="settings.language.title" aria-label="${t("settings.language.title")}">
            <button type="button" class="segmented-control__btn" data-locale="pl">${t("menu.locale.pl")}</button>
            <button type="button" class="segmented-control__btn" data-locale="en">${t("menu.locale.en")}</button>
          </div>
        </section>

        <section class="settings-section settings-section--report">
          <h3 class="settings-section__label" data-i18n="settings.report.title">${t("settings.report.title")}</h3>
          <p class="settings-section__hint" data-i18n="settings.report.hint">${t("settings.report.hint")}</p>
          <p class="settings-section__sub" data-i18n="settings.report.auto">${t("settings.report.auto")}</p>
          <div class="segmented-control" role="group" data-i18n-aria="settings.report.auto" aria-label="${t("settings.report.auto")}">
            <button type="button" class="segmented-control__btn" data-auto-report="on">${t("settings.presentation.on")}</button>
            <button type="button" class="segmented-control__btn" data-auto-report="off">${t("settings.presentation.off")}</button>
          </div>
          <div class="settings-report-actions">
            <button type="button" class="settings-report-btn settings-report-btn--primary" id="settings-send-report" data-i18n="settings.report.send">${t("settings.report.send")}</button>
            <button type="button" class="settings-report-btn" id="settings-copy-report" data-i18n="settings.report.copy">${t("settings.report.copy")}</button>
          </div>
          <p class="settings-report-status" id="settings-report-status" aria-live="polite"></p>
        </section>

        <footer class="settings-overlay__foot">
          <p class="settings-overlay__version" data-i18n="settings.version" data-i18n-version="${GAME_VERSION}">${t("settings.version", { version: GAME_VERSION })}</p>
          <p class="settings-overlay__changelog" data-i18n="settings.changelog">${t("settings.changelog")}</p>
          <p class="settings-overlay__hint" data-i18n="settings.hint">${t("settings.hint")}</p>
          <button type="button" class="ui-ignite-back settings-overlay__back" data-settings-close aria-label="${t("ui.back")}">
            <span class="ui-ignite-back__shine" aria-hidden="true"></span>
            <span class="ui-ignite-back__icon" aria-hidden="true">←</span>
            <span class="ui-ignite-back__label" data-i18n="ui.back">${t("ui.back")}</span>
          </button>
        </footer>
      </div>
    `;

		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-gfx]",
		)) {
			btn.addEventListener("click", () => {
				const q = btn.dataset.gfx as GraphicsQuality | undefined;
				if (q !== "low" && q !== "medium" && q !== "high" && q !== "deck")
					return;
				setGraphicsQuality(q);
				this.syncGfxButtons(q);
				this.onGraphicsChange?.(q);
			});
		}

		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-vignette]",
		)) {
			btn.addEventListener("click", () => {
				setUiVignette(btn.dataset.vignette === "on");
				this.syncVignetteButtons(isUiVignetteEnabled());
			});
		}

		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-cinematic]",
		)) {
			btn.addEventListener("click", () => {
				const mode = btn.dataset.cinematic as CinematicCameraMode | undefined;
				if (mode !== "on" && mode !== "reduced" && mode !== "off") return;
				setCinematicCameraMode(mode);
				this.syncCinematicButtons(mode);
			});
		}

		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-commentator]",
		)) {
			btn.addEventListener("click", () => {
				setCommentatorEnabled(btn.dataset.commentator === "on");
				this.syncCommentatorButtons(isCommentatorEnabled());
			});
		}

		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-path-trace]",
		)) {
			btn.addEventListener("click", () => {
				const on = btn.dataset.pathTrace === "on";
				setPathTraceLookEnabled(on);
				this.syncPathTraceButtons(on);
				this.onPathTraceLookChange?.(on);
			});
		}

		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-gpu-rt]",
		)) {
			btn.addEventListener("click", () => {
				const on = btn.dataset.gpuRt === "on";
				setGpuRealtimeRtEnabled(on);
				this.syncGpuRtButtons(on);
				this.onGpuRealtimeRtChange?.(on);
			});
		}

		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-locale]",
		)) {
			btn.addEventListener("click", () => {
				const loc = btn.dataset.locale;
				if (loc === "pl" || loc === "en") setLocale(loc);
			});
		}

		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-auto-report]",
		)) {
			btn.addEventListener("click", () => {
				setAutoPlayerReportEnabled(btn.dataset.autoReport === "on");
				this.syncAutoReportButtons(isAutoPlayerReportEnabled());
			});
		}

		for (const close of this.root.querySelectorAll<HTMLElement>(
			"[data-settings-close]",
		)) {
			close.addEventListener("click", () => this.hide());
		}

		this.req<HTMLButtonElement>("#settings-send-report").addEventListener(
			"click",
			() => void this.handleSendReport(),
		);
		this.req<HTMLButtonElement>("#settings-copy-report").addEventListener(
			"click",
			() => void this.handleCopyReport(),
		);
	}

	private reportStatusEl(): HTMLElement {
		return this.req("#settings-report-status");
	}

	private async handleCopyReport(): Promise<void> {
		const status = this.reportStatusEl();
		status.textContent = t("settings.report.working");
		const report = buildPlayerReport({ context: { source: "settings" } });
		const ok = await copyReportToClipboard(report);
		status.textContent = ok
			? t("settings.report.copied")
			: t("settings.report.copyFail");
	}

	private async handleSendReport(): Promise<void> {
		const status = this.reportStatusEl();
		const sendBtn = this.req<HTMLButtonElement>("#settings-send-report");
		sendBtn.disabled = true;
		status.textContent = t("settings.report.working");
		try {
			const report = buildPlayerReport({ context: { source: "settings" } });
			const result = await sendPlayerReport(report);
			if (result.ok) {
				status.textContent = result.issueNumber
					? t("settings.report.sentIssue", { n: result.issueNumber })
					: t("settings.report.sent");
			} else {
				status.textContent = t("settings.report.sendFail", {
					error: result.error,
				});
			}
		} finally {
			sendBtn.disabled = false;
		}
	}

	private syncControls(): void {
		this.syncGfxButtons(resolveGraphicsSettings().quality);
		this.syncVignetteButtons(isUiVignetteEnabled());
		this.syncCinematicButtons(getCinematicCameraMode());
		this.syncCommentatorButtons(isCommentatorEnabled());
		this.syncPathTraceButtons(isPathTraceLookEnabled());
		this.syncGpuRtButtons(isGpuRealtimeRtEnabled());
		this.syncAutoReportButtons(isAutoPlayerReportEnabled());
		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-locale]",
		)) {
			btn.classList.toggle("active", btn.dataset.locale === getLocale());
		}
	}

	private syncAutoReportButtons(on: boolean): void {
		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-auto-report]",
		)) {
			btn.classList.toggle(
				"active",
				(btn.dataset.autoReport === "on") === on,
			);
		}
	}

	private syncGfxButtons(active: GraphicsQuality): void {
		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-gfx]",
		)) {
			btn.classList.toggle("active", btn.dataset.gfx === active);
		}
	}

	private syncVignetteButtons(enabled: boolean): void {
		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-vignette]",
		)) {
			const on = btn.dataset.vignette === "on";
			btn.classList.toggle("active", on === enabled);
		}
	}

	private syncCinematicButtons(mode: CinematicCameraMode): void {
		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-cinematic]",
		)) {
			btn.classList.toggle("active", btn.dataset.cinematic === mode);
		}
	}

	private syncCommentatorButtons(enabled: boolean): void {
		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-commentator]",
		)) {
			const on = btn.dataset.commentator === "on";
			btn.classList.toggle("active", on === enabled);
		}
	}

	private syncPathTraceButtons(enabled: boolean): void {
		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-path-trace]",
		)) {
			const on = btn.dataset.pathTrace === "on";
			btn.classList.toggle("active", on === enabled);
		}
	}

	private syncGpuRtButtons(enabled: boolean): void {
		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-gpu-rt]",
		)) {
			const on = btn.dataset.gpuRt === "on";
			btn.classList.toggle("active", on === enabled);
		}
	}

	private applyLocale(): void {
		applyStaticI18n(this.root);
		const verEl = this.root.querySelector<HTMLElement>("[data-i18n-version]");
		if (verEl) {
			verEl.textContent = t("settings.version", { version: GAME_VERSION });
		}
		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			"[data-gfx]",
		)) {
			const q = btn.dataset.gfx as GraphicsQuality | undefined;
			if (q === "low" || q === "medium" || q === "high" || q === "deck") {
				btn.textContent = graphicsLabel(q);
			}
		}
		this.syncControls();
	}

	private bindKeyboard(): void {
		if (this.keyHandler) return;
		this.keyHandler = (e: KeyboardEvent) => {
			if (!this.visible) return;
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				this.hide();
			}
		};
		window.addEventListener("keydown", this.keyHandler);
	}

	private req<T extends HTMLElement>(selector: string): T {
		const el = this.root.querySelector<T>(selector);
		if (!el) throw new Error(`SettingsOverlay: brak ${selector}`);
		return el;
	}
}
