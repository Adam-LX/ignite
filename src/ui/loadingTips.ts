import { type I18nKey, t } from "../i18n";

const TIP_KEYS: I18nKey[] = [
	"tip.field.rush",
	"tip.field.zones",
	"tip.field.overcharge",
	"tip.field.lab",
	"tip.camera.ballCam",
	"tip.camera.altRig",
	"tip.replay.skip",
	"tip.body.traits",
];

let tipCursor = Math.floor(Math.random() * TIP_KEYS.length);

/** Rotating loading / match tips — one line of Field Energy / UX identity. */
export function nextLoadingTip(): string {
	const key = TIP_KEYS[tipCursor % TIP_KEYS.length]!;
	tipCursor += 1;
	return t(key);
}

export function peekLoadingTipKeys(): readonly I18nKey[] {
	return TIP_KEYS;
}
