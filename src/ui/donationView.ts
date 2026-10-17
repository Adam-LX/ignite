import { t } from "../i18n";
import { loadDonationConfig, truncateAddress } from "./donationConfig";

/** Wstawia tagline, portfele i link weryfikacji do sekcji credits. */
export async function mountDonationBlock(
	root: HTMLElement | null,
): Promise<void> {
	if (!root) return;

	const config = await loadDonationConfig();

	const walletBtns = config.wallets
		.map((w) => {
			const hasAddr = w.address.length > 0;
			return `
        <button type="button"
          class="credits-donation__wallet${hasAddr ? "" : " credits-donation__wallet--empty"}"
          data-address="${hasAddr ? w.address : ""}"
          title="${hasAddr ? t("menu.wallet.copy", { label: w.label }) : t("menu.wallet.missing", { label: w.label })}"
          ${hasAddr ? "" : "disabled"}>
          <span class="credits-donation__sym">${w.symbol}</span>
          <span class="credits-donation__addr">${truncateAddress(w.address)}</span>
        </button>`;
		})
		.join("");

	const verifyLink = config.verifyUrl
		? `<a class="credits-donation__verify" href="${config.verifyUrl}" target="_blank" rel="noopener noreferrer">${t("menu.tip.verify")}</a>`
		: "";

	root.innerHTML = `
    <p class="credits-donation__line">${config.tagline}</p>
    <div class="credits-donation__wallets">${walletBtns}</div>
    ${verifyLink}
  `;

	for (const btn of root.querySelectorAll<HTMLButtonElement>(
		".credits-donation__wallet:not([disabled])",
	)) {
		btn.addEventListener("click", () => {
			const addr = btn.dataset.address;
			if (!addr) return;
			void navigator.clipboard.writeText(addr).then(() => {
				btn.classList.add("credits-donation__wallet--copied");
				const addrEl = btn.querySelector(".credits-donation__addr");
				if (addrEl) addrEl.textContent = t("menu.wallet.copied");
				window.setTimeout(() => {
					btn.classList.remove("credits-donation__wallet--copied");
					if (addrEl) addrEl.textContent = truncateAddress(addr);
				}, 1400);
			});
		});
	}
}
