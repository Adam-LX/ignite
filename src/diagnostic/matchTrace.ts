const MATCH_LOG_KEY = "ignite-match-log";
const MAX_LINES = 100;

export function matchMark(step: string, category?: string): void {
	const t = (performance.now() / 1000).toFixed(2);
	const tag = category ? `[${category}] ` : "";
	const line = `[${t}s] ${tag}${step}`;
	console.info(`[Match] ${line}`);
	try {
		const prev = localStorage.getItem(MATCH_LOG_KEY) ?? "";
		const lines = `${prev}\n${line}`.trim().split("\n");
		localStorage.setItem(MATCH_LOG_KEY, lines.slice(-MAX_LINES).join("\n"));
	} catch {
		// private mode
	}
}

export function getMatchLog(): string {
	try {
		return localStorage.getItem(MATCH_LOG_KEY) ?? "";
	} catch {
		return "";
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
