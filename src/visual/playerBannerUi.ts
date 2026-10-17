/**
 * Player banner = UI wokół nicku (jak RL), NIE plane 3D za autem na boisku.
 */
import { getEquippedBannerId } from "../meta/PlayerInventory";
import { getBannerCssUrl } from "./bannerTextures";

export function applyPlayerBannerStyle(
	el: HTMLElement,
	bannerId: string = getEquippedBannerId(),
): void {
	el.style.setProperty("--player-banner", getBannerCssUrl(bannerId));
	el.classList.add("player-banner-plate");
}

export function clearPlayerBannerStyle(el: HTMLElement): void {
	el.style.removeProperty("--player-banner");
	el.classList.remove("player-banner-plate");
}
