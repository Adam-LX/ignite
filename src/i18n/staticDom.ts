import { mountDonationBlock } from "../ui/donationView";
import { type I18nKey, t } from "./index";

export function applyStaticI18n(root: ParentNode = document): void {
	for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
		const key = el.dataset.i18n as I18nKey | undefined;
		if (key) el.textContent = t(key);
	}
	for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-html]")) {
		const key = el.dataset.i18nHtml as I18nKey | undefined;
		if (key) el.innerHTML = t(key);
	}
	for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
		const key = el.dataset.i18nTitle as I18nKey | undefined;
		if (key) el.title = t(key);
	}
	for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-aria]")) {
		const key = el.dataset.i18nAria as I18nKey | undefined;
		if (key) el.setAttribute("aria-label", t(key));
	}
	renderCreditsCard();
}

export function renderCreditsCard(): void {
	const card = document.getElementById("credits-card");
	if (!card) return;

	card.innerHTML = `
    <h2 id="credits-title">${t("credits.title")}</h2>
    <p class="credits-tagline">${t("credits.tagline")}</p>

    <p class="credits-disclaimer">${t("credits.disclaimer")}</p>

    <h3>${t("credits.code")}</h3>
    <ul>
      <li>${t("credits.code.base")}</li>
      <li>${t("credits.code.fork")}</li>
    </ul>

    <h3>${t("credits.music")}</h3>
    <ul>
      <li>${t("credits.music.item")}</li>
    </ul>

    <h3>${t("credits.sfx")}</h3>
    <ul>
      <li>${t("credits.sfx.kenney")}</li>
      <li>${t("credits.sfx.oga")}</li>
    </ul>

    <h3>${t("credits.graphics")}</h3>
    <ul>
      <li>${t("credits.graphics.sky")}</li>
      <li>${t("credits.graphics.models")}</li>
    </ul>

    <h3>${t("credits.typography")}</h3>
    <ul>
      <li>${t("credits.typography.orbitron")}</li>
    </ul>

    <p class="credits-note">${t("credits.note")}</p>

    <h3>${t("credits.support")}</h3>
    <div class="credits-donation" id="credits-donation" aria-label="${t("menu.tip.aria")}"></div>

    <button type="button" id="credits-close">${t("credits.close")}</button>
  `;

	void mountDonationBlock(document.getElementById("credits-donation"));
}
