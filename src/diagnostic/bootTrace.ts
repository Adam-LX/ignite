const BOOT_LOG_KEY = "ignite-boot-log";
const MAX_LINES = 120;

export function bootMark(step: string, category?: string): void {
	const t = (performance.now() / 1000).toFixed(2);
	const tag = category ? `[${category}] ` : "";
	const line = `[${t}s] ${tag}${step}`;
	console.info(`[Boot] ${line}`);
	try {
		const prev = localStorage.getItem(BOOT_LOG_KEY) ?? "";
		const lines = `${prev}\n${line}`.trim().split("\n");
		localStorage.setItem(BOOT_LOG_KEY, lines.slice(-MAX_LINES).join("\n"));
	} catch {
		// private mode
	}
}

export function getBootLog(): string {
	try {
		return localStorage.getItem(BOOT_LOG_KEY) ?? "";
	} catch {
		return "";
	}
}

export async function bootStep<T>(
	label: string,
	fn: () => Promise<T>,
): Promise<T> {
	bootMark(`→ ${label}`);
	try {
		const result = await fn();
		bootMark(`✓ ${label}`);
		return result;
	} catch (err) {
		bootMark(`✗ ${label}: ${err instanceof Error ? err.message : String(err)}`);
		throw err;
	}
}
