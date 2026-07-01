const MATCH_LOG_KEY = "ignite-match-log";

export function matchMark(step: string): void {
	const t = (performance.now() / 1000).toFixed(2);
	const line = `[${t}s] ${step}`;
	console.info(`[Match] ${line}`);
	try {
		const prev = localStorage.getItem(MATCH_LOG_KEY) ?? "";
		const lines = `${prev}\n${line}`.trim().split("\n");
		localStorage.setItem(MATCH_LOG_KEY, lines.slice(-60).join("\n"));
	} catch {
		// private mode
	}
}

export async function matchStep<T>(
	label: string,
	fn: () => Promise<T>,
): Promise<T> {
	matchMark(`→ ${label}`);
	try {
		const result = await fn();
		matchMark(`✓ ${label}`);
		return result;
	} catch (err) {
		matchMark(
			`✗ ${label}: ${err instanceof Error ? err.message : String(err)}`,
		);
		throw err;
	}
}
