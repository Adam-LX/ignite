import { iqLabelTier } from "../ai/learning/BotIQ";
import { BotLearning } from "../ai/learning/BotLearning";
import type { GameAudio } from "../audio/GameAudio";
import {
	allGameModes,
	type GameModeId,
	getLocalizedModeSpec,
	isIgnitionMode,
	MATCH_RULES,
	parseGameMode,
} from "../game/modes";
import { getLocale, onLocaleChange, setLocale, t } from "../i18n";
import { applyStaticI18n } from "../i18n/staticDom";
import {
	fetchOnlineStatus,
	formatOnlineCount,
	resolveMpServerAddress,
} from "../net/serverStatus";
import { renderBotIQGauge, renderBotLearningReport } from "./botReportView";
import type { CreditsPanel } from "./CreditsPanel";

const IGNITION_MODES = allGameModes().filter((m) => isIgnitionMode(m));
const TEAM_MODES = allGameModes().filter((m) => !isIgnitionMode(m));
const MODE_ORDER: GameModeId[] = [...TEAM_MODES, ...IGNITION_MODES];

const MODE_ACCENT: Record<GameModeId, string> = {
	"1v1": "duel",
	"2v2": "team",
	"3v3": "team",
	"4v4": "chaos",
	ignition1v1: "ignition",
	ignition: "ignition",
};

export class MainMenu {
	private readonly root: HTMLElement;
	private readonly onStart: (mode: GameModeId) => void;
	private readonly onOnline?: () => void;
	private selected: GameModeId;
	private startBtn!: HTMLButtonElement;
	private modeIndexEl!: HTMLElement;
	private briefTitleEl!: HTMLElement;
	private briefDescEl!: HTMLElement;
	private onlineCountEl!: HTMLElement;
	private keyHandler: ((e: KeyboardEvent) => void) | null = null;
	private onlinePollTimer: number | null = null;
	private botLearningPollTimer: number | null = null;
	private botProgressOpen = false;
	private botReportCloseTimer: number | null = null;
	private beatRaf = 0;
	private titleEl: HTMLElement | null = null;

	constructor(
		onStart: (mode: GameModeId) => void,
		private readonly credits?: CreditsPanel,
		onOnline?: () => void,
		private readonly audio?: GameAudio,
	) {
		const el = document.getElementById("main-menu");
		if (!el) throw new Error("Brak #main-menu");
		this.root = el;
		this.onStart = onStart;
		this.onOnline = onOnline;

		const params = new URLSearchParams(window.location.search);
		this.selected = parseGameMode(params.get("mode"));

		this.render();
		this.bindKeyboard();
		onLocaleChange(() => {
			this.applyMenuLocale();
		});
	}

	hide(): void {
		this.root.classList.add("hidden");
		this.stopBeatSync();
		this.stopOnlinePoll();
		this.stopBotLearningPoll();
		if (this.botReportCloseTimer !== null) {
			window.clearTimeout(this.botReportCloseTimer);
			this.botReportCloseTimer = null;
		}
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
		this.startBeatSync();
		this.audio?.ensureMenuMusic();
		void this.refreshOnlineCount();
		this.startOnlinePoll();
		void this.refreshBotLearning();
		this.startBotLearningPoll();
	}

	isVisible(): boolean {
		return !this.root.classList.contains("hidden");
	}

	private render(): void {
		const durationMin = MATCH_RULES.durationSec / 60;
		const sparks = Array.from(
			{ length: 28 },
			(_, i) => `<i class="main-menu__spark" style="--i:${i}"></i>`,
		).join("");

		this.root.innerHTML = `
      <div class="main-menu__fx" aria-hidden="true">
        <div class="main-menu__vignette"></div>
        <div class="main-menu__grain"></div>
        <div class="main-menu__scanlines"></div>
        <div class="main-menu__beams">
          <span></span><span></span><span></span>
        </div>
        <div class="main-menu__sparks">${sparks}</div>
        <div class="main-menu__speed-streaks"></div>
      </div>

      <div class="main-menu__layout main-menu__layout--dock">
        <div class="main-menu__topbar">
          <div class="main-menu__topbar-left">
            <button type="button" id="main-menu-credits" class="main-menu__credits" data-i18n="menu.credits">${t("menu.credits")}</button>
            <div class="main-menu__locale" role="group" data-i18n-aria="menu.locale.group" aria-label="${t("menu.locale.group")}">
              <button type="button" class="main-menu__locale-btn${getLocale() === "pl" ? " active" : ""}" data-locale="pl">${t("menu.locale.pl")}</button>
              <button type="button" class="main-menu__locale-btn${getLocale() === "en" ? " active" : ""}" data-locale="en">${t("menu.locale.en")}</button>
            </div>
          </div>
          <p class="main-menu__controls" data-i18n-html="menu.controls">${t("menu.controls")}</p>
          <span class="main-menu__mode-index" id="mode-index">01 / 05</span>
        </div>

        <div class="main-menu__stage">
          <aside class="main-menu__brief" aria-live="polite">
            <p class="main-menu__brief-kicker" data-i18n="menu.selection.label">${t("menu.selection.label")}</p>
            <h2 class="main-menu__brief-title" id="mode-brief-title">—</h2>
            <p class="main-menu__brief-desc" id="mode-brief-desc"></p>
          </aside>

          <div class="main-menu__bot-sheet hidden" id="main-menu-bot-progress" aria-live="polite"></div>

          <header class="main-menu__brand">
            <p class="main-menu__eyebrow"><span class="main-menu__live-dot"></span> <span data-i18n="menu.eyebrow">${t("menu.eyebrow")}</span></p>

            <div class="main-menu__title-block">
              <h1 class="main-menu__title" data-text="IGN!TE">IGN!TE</h1>
              <span class="main-menu__title-ghost" aria-hidden="true">IGN!TE</span>
              <span class="main-menu__title-glitch" aria-hidden="true">IGN!TE</span>
              <span class="main-menu__title-glitch main-menu__title-glitch--2" aria-hidden="true">IGN!TE</span>
            </div>

            <p class="main-menu__tagline" data-i18n="menu.tagline">${t("menu.tagline")}</p>

            <div class="main-menu__stats">
              <div class="main-menu__stat">
                <span class="main-menu__stat-val">${durationMin}</span>
                <span class="main-menu__stat-lbl" data-i18n="menu.stat.matchMin">${t("menu.stat.matchMin")}</span>
              </div>
              <div class="main-menu__stat">
                <span class="main-menu__stat-val">RL</span>
                <span class="main-menu__stat-lbl" data-i18n="menu.stat.physics">${t("menu.stat.physics")}</span>
              </div>
              <div class="main-menu__stat">
                <span class="main-menu__stat-val">∞</span>
                <span class="main-menu__stat-lbl" data-i18n="menu.stat.chaos">${t("menu.stat.chaos")}</span>
              </div>
            </div>

            <div class="main-menu__ticker" aria-hidden="true">
              <span>SUPERSONIC</span><span>BOOST</span><span>AERIAL</span><span>DEMO</span><span>OWN GOAL</span>
            </div>
          </header>
        </div>

        <div class="main-menu__dock-wrap">
          <div class="main-menu__dock">
            <section
              class="main-menu__dock-modes"
              data-i18n-aria="menu.modes.aria"
              aria-label="${t("menu.modes.aria")}"
            >
              <h2 class="main-menu__section-title" data-i18n="menu.zone.modes">${t("menu.zone.modes")}</h2>
              <div class="mode-rail mode-rail--horizontal" id="mode-grid"></div>
            </section>

            <div class="main-menu__dock-actions">
              <button type="button" id="main-menu-start" class="main-menu__launch main-menu__launch--dock">
                <span class="main-menu__launch-shine" aria-hidden="true"></span>
                <span class="main-menu__launch-text">
                  <small data-i18n="menu.launch.small">${t("menu.launch.small")}</small>
                  <strong class="main-menu__primary-label">GRAJ</strong>
                </span>
                <span class="main-menu__launch-arrow" aria-hidden="true">▶</span>
              </button>

              <div class="main-menu__dock-secondary">
                <button type="button" id="main-menu-online" class="main-menu__online main-menu__online--dock">
                  <span class="main-menu__online-pulse" aria-hidden="true"></span>
                  <span class="main-menu__online-tag">LIVE</span>
                  <span class="main-menu__online-label" data-i18n="menu.online.label">${t("menu.online.label")}</span>
                  <span class="main-menu__online-sub" id="main-menu-online-count" data-i18n="menu.online.defaultStatus">${t("menu.online.defaultStatus")}</span>
                </button>

                <button type="button" id="main-menu-bot-report" class="main-menu__bot-report-btn main-menu__bot-report-btn--dock" data-i18n-aria="menu.botStat.title" aria-expanded="false" aria-controls="main-menu-bot-progress">
                  <div class="main-menu__bot-report-preview" id="main-menu-bot-preview" aria-hidden="true"></div>
                  <span class="main-menu__bot-report-copy">
                    <span class="main-menu__bot-report-tag" data-i18n="menu.bot.report.tag">${t("menu.bot.report.tag")}</span>
                    <strong class="main-menu__bot-report-title" data-i18n="menu.bot.report.btn">${t("menu.bot.report.btn")}</strong>
                    <span class="main-menu__bot-report-line" id="main-menu-bot-gen">—</span>
                  </span>
                  <span class="main-menu__bot-report-chevron" aria-hidden="true">▼</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <span class="main-menu__footer-stat main-menu__footer-stat--bot hidden" id="main-menu-bot-stat-legacy" aria-hidden="true"></span>
      </div>
    `;

		this.startBtn = this.req<HTMLButtonElement>("#main-menu-start");
		this.modeIndexEl = this.req("#mode-index");
		this.briefTitleEl = this.req("#mode-brief-title");
		this.briefDescEl = this.req("#mode-brief-desc");
		this.onlineCountEl = this.req("#main-menu-online-count");

		const grid = this.req<HTMLElement>("#mode-grid");
		for (const id of MODE_ORDER) {
			grid.appendChild(this.createModeCard(id));
		}

		this.startBtn.addEventListener("click", () => this.launch());
		this.req<HTMLButtonElement>("#main-menu-credits").addEventListener(
			"click",
			() => {
				this.credits?.show();
			},
		);
		this.req<HTMLButtonElement>("#main-menu-online").addEventListener(
			"click",
			() => {
				this.onOnline?.();
			},
		);
		this.req<HTMLElement>("#main-menu-bot-report").addEventListener(
			"click",
			() => {
				this.botProgressOpen = !this.botProgressOpen;
				if (this.botProgressOpen) {
					this.refreshBotLearning();
				}
				this.syncBotReportExpanded();
			},
		);

		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			".main-menu__locale-btn",
		)) {
			btn.addEventListener("click", () => {
				const locale = btn.dataset.locale;
				if (locale === "pl" || locale === "en") {
					setLocale(locale);
				}
			});
		}

		this.selectMode(this.selected, false);
		this.titleEl = this.root.querySelector<HTMLElement>(".main-menu__title");
		this.startBeatSync();
		this.audio?.ensureMenuMusic();
		void this.refreshOnlineCount();
		this.startOnlinePoll();
		this.refreshBotLearning();
	}

	private startBeatSync(): void {
		if (!this.audio || !this.titleEl) return;
		this.stopBeatSync();

		const tick = (): void => {
			if (this.root.classList.contains("hidden")) return;
			this.audio?.ensureMenuMusic();
			const raw = this.audio!.getMusicPulse();
			const punch = raw <= 0.02 ? 0 : Math.min(1, raw ** 0.65);
			this.titleEl!.style.setProperty("--punch", punch.toFixed(3));
			this.beatRaf = requestAnimationFrame(tick);
		};
		tick();
	}

	private stopBeatSync(): void {
		if (this.beatRaf) {
			cancelAnimationFrame(this.beatRaf);
			this.beatRaf = 0;
		}
		this.titleEl?.style.setProperty("--punch", "0");
	}

	refreshBotLearning(): void {
		const learning = BotLearning.get();
		const genEl = this.root.querySelector<HTMLElement>("#main-menu-bot-gen");
		const previewEl = this.root.querySelector<HTMLElement>(
			"#main-menu-bot-preview",
		);
		const panel = this.root.querySelector<HTMLElement>(
			"#main-menu-bot-progress",
		);
		const reportBtn = this.root.querySelector<HTMLElement>(
			"#main-menu-bot-report",
		);
		if (!genEl) return;

		if (!learning.isActive()) {
			genEl.textContent = learning.isGlobal() ? "…" : "—";
			if (previewEl) previewEl.innerHTML = "";
			panel?.classList.remove("is-visible");
			panel?.classList.add("hidden");
			reportBtn?.classList.remove("is-ready");
			return;
		}

		const summary = learning.getProgressSummary();
		const fit = summary.fitness.toFixed(1);
		const fed = learning.getFederationStats();
		const prefix = learning.isFederated()
			? "F"
			: learning.isGlobal()
				? "G"
				: "L";
		const tier = iqLabelTier(summary.iq);
		genEl.textContent = `IQ ${summary.iq} · ${prefix}${summary.generation} · fit ${fit}`;
		if (fed.syncTargets > 0) {
			genEl.title = `Federacja: ${fed.fetchHits}/${fed.fetchTargets} fetch · ${fed.syncHits}/${fed.syncTargets} sync`;
		}
		if (learning.isMicroEvolveRunning()) {
			genEl.textContent += " ⏳";
		}
		if (previewEl) {
			previewEl.innerHTML = renderBotIQGauge(summary.iq);
		}
		if (reportBtn) {
			reportBtn.classList.add("is-ready");
			reportBtn.dataset.tier = tier;
		}

		if (!panel) return;
		if (this.botProgressOpen) {
			panel.innerHTML = renderBotLearningReport(
				summary,
				{
					prefix,
					federated: learning.isFederated(),
					global: learning.isGlobal(),
				},
				{ large: true },
			);
		}
	}

	private syncBotReportExpanded(): void {
		const btn = this.root.querySelector<HTMLElement>("#main-menu-bot-report");
		const panel = this.root.querySelector<HTMLElement>(
			"#main-menu-bot-progress",
		);
		if (!btn) return;
		btn.classList.toggle("is-open", this.botProgressOpen);
		btn.setAttribute("aria-expanded", this.botProgressOpen ? "true" : "false");
		if (!panel) return;

		if (this.botReportCloseTimer !== null) {
			window.clearTimeout(this.botReportCloseTimer);
			this.botReportCloseTimer = null;
		}

		if (this.botProgressOpen) {
			this.root.classList.add("is-bot-report");
			panel.classList.remove("hidden");
			panel.classList.remove("is-visible");
			void panel.offsetHeight;
			requestAnimationFrame(() => {
				panel.classList.add("is-visible");
			});
		} else {
			panel.classList.remove("is-visible");
			this.botReportCloseTimer = window.setTimeout(() => {
				panel.classList.add("hidden");
				this.root.classList.remove("is-bot-report");
				this.botReportCloseTimer = null;
			}, 480);
		}
	}

	private startBotLearningPoll(): void {
		this.stopBotLearningPoll();
		this.botLearningPollTimer = window.setInterval(() => {
			void BotLearning.get()
				.refreshFromGlobal()
				.then((ok) => {
					if (ok) this.refreshBotLearning();
				});
			this.refreshBotLearning();
		}, 8_000);
	}

	private stopBotLearningPoll(): void {
		if (this.botLearningPollTimer !== null) {
			window.clearInterval(this.botLearningPollTimer);
			this.botLearningPollTimer = null;
		}
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

	private createModeCard(id: GameModeId): HTMLButtonElement {
		const spec = getLocalizedModeSpec(id);
		const accent = MODE_ACCENT[id];
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = `mode-card mode-card--tab mode-card--${accent}${id === "ignition" ? " mode-card--featured" : ""}${id === "ignition1v1" ? " mode-card--ignition-test" : ""}`;
		btn.dataset.mode = id;

		const badge = spec.isFFA
			? `<span class="mode-card__badge mode-card__badge--ffa">FFA</span>`
			: `<span class="mode-card__badge">${spec.teamSize}v${spec.teamSize}</span>`;

		btn.innerHTML = `
      <span class="mode-card__beam" aria-hidden="true"></span>
      <span class="mode-card__index" aria-hidden="true">${String(MODE_ORDER.indexOf(id) + 1).padStart(2, "0")}</span>
      ${badge}
      <strong class="mode-card__title">${spec.label}</strong>
      <span class="mode-card__players">${t("menu.mode.players", { count: spec.playerCount })}</span>
    `;

		btn.addEventListener("click", () => this.selectMode(id));
		btn.addEventListener("dblclick", () => {
			this.selectMode(id, false);
			this.launch();
		});

		return btn;
	}

	private selectMode(id: GameModeId, focusStart = true): void {
		this.selected = id;
		const spec = getLocalizedModeSpec(id);
		const idx = MODE_ORDER.indexOf(id);

		for (const card of this.root.querySelectorAll<HTMLButtonElement>(
			".mode-card",
		)) {
			const isActive = card.dataset.mode === id;
			card.classList.toggle("active", isActive);
			if (isActive) {
				card.scrollIntoView({
					behavior: "smooth",
					block: "nearest",
					inline: "center",
				});
			}
		}

		this.modeIndexEl.textContent = `${String(idx + 1).padStart(2, "0")} / ${String(MODE_ORDER.length).padStart(2, "0")}`;
		this.briefTitleEl.textContent = spec.label;
		this.briefDescEl.textContent = spec.description;

		const labelEl = this.startBtn.querySelector(".main-menu__primary-label");
		if (labelEl) {
			labelEl.textContent = spec.label.toUpperCase();
		}

		this.root.dataset.selectedAccent = MODE_ACCENT[id];

		if (focusStart) {
			this.startBtn.focus();
		}
	}

	private applyMenuLocale(): void {
		applyStaticI18n(this.root);
		for (const btn of this.root.querySelectorAll<HTMLButtonElement>(
			".main-menu__locale-btn",
		)) {
			btn.classList.toggle("active", btn.dataset.locale === getLocale());
		}
		for (const id of MODE_ORDER) {
			const card = this.root.querySelector<HTMLButtonElement>(
				`[data-mode="${id}"]`,
			);
			if (!card) continue;
			const spec = getLocalizedModeSpec(id);
			const title = card.querySelector(".mode-card__title");
			const players = card.querySelector(".mode-card__players");
			if (title) title.textContent = spec.label;
			if (players) {
				players.textContent = t("menu.mode.players", {
					count: spec.playerCount,
				});
			}
		}
		const spec = getLocalizedModeSpec(this.selected);
		this.briefTitleEl.textContent = spec.label;
		this.briefDescEl.textContent = spec.description;
		this.selectMode(this.selected, false);
		if (this.botProgressOpen) {
			this.syncBotReportExpanded();
			this.refreshBotLearning();
		}
		void this.refreshOnlineCount();
	}

	private launch(): void {
		this.root.classList.add("main-menu--exit");
		window.setTimeout(() => {
			this.hide();
			this.onStart(this.selected);
		}, 520);
	}

	private bindKeyboard(): void {
		this.keyHandler = (e: KeyboardEvent) => {
			if (this.root.classList.contains("hidden")) return;

			const tag = (e.target as HTMLElement | null)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA") return;

			if (e.key === "Enter") {
				e.preventDefault();
				this.launch();
				return;
			}

			if (e.key === "o" || e.key === "O") {
				e.preventDefault();
				this.onOnline?.();
				return;
			}

			if (e.key === "b" || e.key === "B") {
				e.preventDefault();
				this.botProgressOpen = !this.botProgressOpen;
				if (this.botProgressOpen) {
					this.refreshBotLearning();
				}
				this.syncBotReportExpanded();
				return;
			}

			const idx = MODE_ORDER.indexOf(this.selected);

			if (e.key === "ArrowRight" || e.key === "ArrowDown") {
				e.preventDefault();
				this.selectMode(MODE_ORDER[(idx + 1) % MODE_ORDER.length]!);
			} else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
				e.preventDefault();
				this.selectMode(
					MODE_ORDER[(idx - 1 + MODE_ORDER.length) % MODE_ORDER.length]!,
				);
			}

			const num = Number(e.key);
			if (num >= 1 && num <= MODE_ORDER.length) {
				e.preventDefault();
				this.selectMode(MODE_ORDER[num - 1]!);
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
