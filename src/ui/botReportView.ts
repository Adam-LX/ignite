import {
	BOT_IQ_MAX,
	BOT_IQ_MIN,
	type BotIQTier,
	iqLabelTier,
	iqToGaugeFill,
} from "../ai/learning/BotIQ";
import type { BotProgressSummary } from "../ai/learning/BotLearningProgress";
import { formatTrend } from "../ai/learning/BotLearningProgress";
import type { I18nKey } from "../i18n";
import { t } from "../i18n";

const IQ_TIER_KEYS: Record<BotIQTier, I18nKey> = {
	rookie: "menu.bot.iq.rookie",
	trained: "menu.bot.iq.trained",
	sharp: "menu.bot.iq.sharp",
	elite: "menu.bot.iq.elite",
};

function iqTierLabel(tier: BotIQTier): string {
	return t(IQ_TIER_KEYS[tier]);
}

export function renderBotIQGauge(iq: number, size = 72): string {
	const fill = iqToGaugeFill(iq);
	const tier = iqLabelTier(iq);
	const r = 26;
	const c = 2 * Math.PI * r;
	const dash = c * fill;
	return `
    <div class="main-menu__bot-iq-gauge" data-tier="${tier}" data-size="${size}" aria-hidden="true" style="--iq-size:${size}px">
      <svg viewBox="0 0 64 64" width="${size}" height="${size}">
        <circle class="main-menu__bot-iq-track" cx="32" cy="32" r="${r}" />
        <circle
          class="main-menu__bot-iq-fill"
          cx="32" cy="32" r="${r}"
          stroke-dasharray="${dash.toFixed(2)} ${c.toFixed(2)}"
          transform="rotate(-90 32 32)"
        />
      </svg>
      <span class="main-menu__bot-iq-val">${iq}</span>
      <span class="main-menu__bot-iq-cap">${iqTierLabel(tier)}</span>
    </div>`;
}

export function renderBotSparkline(
	values: number[],
	opts: {
		width?: number;
		height?: number;
		className?: string;
		emptyKey?: I18nKey;
		minSpan?: number;
	},
): string {
	const w = opts.width ?? 280;
	const h = opts.height ?? 52;
	const cls = opts.className ?? "main-menu__bot-spark";
	const emptyKey = opts.emptyKey ?? "menu.bot.sparkline.empty";

	if (values.length < 2) {
		return `<div class="${cls} empty">${t(emptyKey)}</div>`;
	}

	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = Math.max(max - min, opts.minSpan ?? 0.5);
	const pts = values
		.map((v, i) => {
			const x = (i / (values.length - 1)) * w;
			const y = h - ((v - min) / span) * (h - 8) - 4;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		})
		.join(" ");

	return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" /></svg>`;
}

export function renderBotDeltaChart(
	values: number[],
	width = 280,
	height = 52,
): string {
	const w = width;
	const h = height;
	if (values.length < 2) {
		return `<div class="main-menu__bot-delta empty">${t("menu.bot.sparkline.empty")}</div>`;
	}

	const maxAbs = Math.max(1.2, ...values.map((v) => Math.abs(v)));
	const midY = h / 2;
	const barW = Math.max(4, w / values.length - 2);

	const bars = values
		.map((v, i) => {
			const x = (i / values.length) * w + 1;
			const height = (Math.abs(v) / maxAbs) * (h * 0.42);
			const y = v >= 0 ? midY - height : midY;
			const cls = v >= 0 ? "pos" : "neg";
			return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, height).toFixed(1)}" rx="1" />`;
		})
		.join("");

	return `<svg class="main-menu__bot-delta" viewBox="0 0 ${w} ${h}" aria-hidden="true"><line class="mid" x1="0" y1="${midY}" x2="${w}" y2="${midY}" />${bars}</svg>`;
}

export function renderBotLearningReport(
	summary: BotProgressSummary,
	meta: { prefix: string; federated: boolean; global: boolean },
	opts?: { large?: boolean },
): string {
	const winPct = Math.round(summary.winRateRecent * 100);
	const iqTier = iqLabelTier(summary.iq);
	const large = opts?.large ?? false;
	const chartW = large ? 480 : 280;
	const chartH = large ? 58 : 52;
	const gaugeSize = large ? 88 : 72;
	const reportClass = large
		? "main-menu__bot-report main-menu__bot-report--stage"
		: "main-menu__bot-report";

	return `
    <div class="${reportClass}">
      <div class="main-menu__bot-report-hero">
        ${renderBotIQGauge(summary.iq, gaugeSize)}
        <div class="main-menu__bot-report-meta">
          <h3>${t("menu.bot.report.title")}</h3>
          <p class="main-menu__bot-report-sub">
            ${meta.prefix}${summary.generation} · ${t("menu.bot.report.fitness")} ${summary.fitness.toFixed(1)}
            ${meta.federated ? " · FED" : meta.global ? " · G" : " · L"}
          </p>
          <p class="main-menu__bot-report-trends">
            <span data-tier="${iqTier}">${formatTrend(summary.iqTrend, 0)} IQ</span>
            <span>${formatTrend(summary.fitnessTrend)} ${t("menu.bot.report.fitnessShort")}</span>
            <span>${formatTrend(summary.aerialTrend, 2)} aerial</span>
          </p>
        </div>
      </div>

      <div class="main-menu__bot-report-body">
        <div class="main-menu__bot-grid main-menu__bot-grid--report">
          <div><span class="lbl">${t("menu.bot.progress.best")}</span><strong>${summary.bestFitness.toFixed(1)}</strong></div>
          <div><span class="lbl">${t("menu.bot.report.winRate")}</span><strong>${winPct}%</strong></div>
          <div><span class="lbl">${t("menu.bot.progress.matches")}</span><strong>${summary.entries}${summary.globalMatches > summary.entries ? ` <em class="fed-total">/ ${summary.globalMatches}</em>` : ""}</strong></div>
          <div><span class="lbl">${t("menu.bot.report.form")}</span><strong>${summary.recentBotDeltaAvg >= 0 ? "+" : ""}${summary.recentBotDeltaAvg.toFixed(2)}</strong></div>
          <div><span class="lbl">${t("menu.bot.progress.aerial")}</span><strong>${summary.totalAerialTouches}</strong></div>
          <div><span class="lbl">${t("menu.bot.progress.micro")}</span><strong>${summary.microPromotions}</strong></div>
        </div>

        <div class="main-menu__bot-charts">
          <div class="main-menu__bot-chart-block">
            <span class="main-menu__bot-chart-lbl">${t("menu.bot.chart.iq")} <em>${BOT_IQ_MIN}–${BOT_IQ_MAX}</em></span>
            ${renderBotSparkline(summary.iqSparkline, {
							className: "main-menu__bot-spark main-menu__bot-spark--iq",
							minSpan: 8,
							width: chartW,
							height: chartH,
						})}
          </div>
          <div class="main-menu__bot-chart-block">
            <span class="main-menu__bot-chart-lbl">${t("menu.bot.chart.fitness")}</span>
            ${renderBotSparkline(summary.sparkline, {
							className: "main-menu__bot-spark main-menu__bot-spark--fit",
							width: chartW,
							height: chartH,
						})}
          </div>
          <div class="main-menu__bot-chart-block">
            <span class="main-menu__bot-chart-lbl">${t("menu.bot.chart.form")}</span>
            ${renderBotDeltaChart(summary.deltaSparkline, chartW, chartH)}
          </div>
        </div>
      </div>

      <p class="main-menu__bot-hint">${t("menu.bot.report.hint")}</p>
    </div>`;
}
