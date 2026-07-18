/** Średnice montażu felg per bodyStyle — wspólne dla runtime i pipeline Trellis. */
export const BODY_STYLE_WHEEL_MOUNTS = {
	standard: { frontDiameterM: 0.25, rearDiameterM: 0.25 },
	wide: { frontDiameterM: 0.28, rearDiameterM: 0.28 },
	low: { frontDiameterM: 0.24, rearDiameterM: 0.24 },
	hatch: { frontDiameterM: 0.25, rearDiameterM: 0.25 },
	tall: { frontDiameterM: 0.3, rearDiameterM: 0.3 },
} as const;

export type PipelineBodyStyle = keyof typeof BODY_STYLE_WHEEL_MOUNTS;

export function wheelMountsForBodyStyle(style: PipelineBodyStyle) {
	return { ...BODY_STYLE_WHEEL_MOUNTS[style] };
}

/** Prompt suffix — Trellis generuje karoserię bez kół. */
export const EMPTY_WHEEL_WELL_PROMPT_SUFFIX =
	", empty wheel arch cutouts, NO wheels, NO tires, body shell only, game-ready PBR vehicle";

export function promptForEmptyWheelWells(base: string): string {
	const lower = base.toLowerCase();
	if (
		lower.includes("no wheels") ||
		lower.includes("empty wheel") ||
		lower.includes("wheel arch")
	) {
		return base;
	}
	return `${base}${EMPTY_WHEEL_WELL_PROMPT_SUFFIX}`;
}
