import type { I18nKey } from "../i18n";
import { en } from "../i18n/locales/en";

const GAG_KEYS: I18nKey[] = [
	"error.gag.ballCam",
	"error.gag.exception",
	"error.gag.boost",
	"error.gag.demo",
	"error.gag.freeCam",
	"error.gag.pitch",
	"error.gag.hitbox",
	"error.gag.gg",
	"error.gag.respawn",
	"error.gag.pit",
];

/** Random dry gag for the crash screen — always English. */
export function pickCrashGag(): string {
	const i = Math.floor(Math.random() * GAG_KEYS.length);
	return en[GAG_KEYS[i]!];
}

export function peekCrashGagKeys(): readonly I18nKey[] {
	return GAG_KEYS;
}
