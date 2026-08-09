/**
 * Demo / AAA content gates — build flag, nie osobny fork.
 * `VITE_IGNITE_DEMO=1` lub `?demo=1` / localStorage.
 */
export type DemoLimits = {
	enabled: boolean;
	/** Max match length (s). */
	matchCapSec: number;
	allowedModes: ReadonlySet<string>;
	allowedCarIds: ReadonlySet<string>;
	allowedArenaIds: ReadonlySet<string>;
};

const DEMO_MATCH_CAP_SEC = 10 * 60;

function envDemo(): boolean {
	try {
		const vite = (import.meta as ImportMeta & { env?: Record<string, string> })
			.env;
		if (vite?.VITE_IGNITE_DEMO === "1" || vite?.IGNITE_DEMO === "1") return true;
	} catch {
		/* non-vite */
	}
	if (typeof process !== "undefined" && process.env?.IGNITE_DEMO === "1") {
		return true;
	}
	return false;
}

function queryOrStorageDemo(): boolean {
	if (typeof window === "undefined") return false;
	try {
		if (new URLSearchParams(location.search).get("demo") === "1") return true;
		if (localStorage.getItem("ignite.demo") === "1") return true;
	} catch {
		/* private */
	}
	return false;
}

export function isDemoBuild(): boolean {
	return envDemo() || queryOrStorageDemo();
}

export function resolveDemoLimits(): DemoLimits {
	const enabled = isDemoBuild();
	return {
		enabled,
		matchCapSec: DEMO_MATCH_CAP_SEC,
		allowedModes: new Set(["1v1"]),
		allowedCarIds: new Set(["octane", "muscle"]),
		allowedArenaIds: new Set(["standard"]),
	};
}

/** Clamp match duration for demo playlist. */
export function demoMatchDurationSec(baseSec: number): number {
	const d = resolveDemoLimits();
	if (!d.enabled) return baseSec;
	return Math.min(baseSec, d.matchCapSec);
}

export function demoAllowsMode(modeId: string): boolean {
	const d = resolveDemoLimits();
	if (!d.enabled) return true;
	return d.allowedModes.has(modeId);
}

export function demoAllowsCar(carId: string): boolean {
	const d = resolveDemoLimits();
	if (!d.enabled) return true;
	return d.allowedCarIds.has(carId);
}
