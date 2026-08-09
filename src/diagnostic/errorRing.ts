/** Ring buffer ostatnich błędów konsoli / nieobsłużonych rejectionów. */

const MAX = 40;
const lines: string[] = [];
let installed = false;

function push(kind: string, message: string): void {
	const t = new Date().toISOString().slice(11, 19);
	const line = `[${t}] ${kind}: ${message}`.slice(0, 500);
	lines.push(line);
	if (lines.length > MAX) lines.splice(0, lines.length - MAX);
}

export function getErrorRing(): string[] {
	return [...lines];
}

export function installErrorRing(): void {
	if (installed || typeof window === "undefined") return;
	installed = true;

	const origError = console.error.bind(console);
	console.error = (...args: unknown[]) => {
		try {
			push(
				"error",
				args
					.map((a) =>
						a instanceof Error
							? a.message
							: typeof a === "string"
								? a
								: JSON.stringify(a),
					)
					.join(" ")
					.slice(0, 400),
			);
		} catch {
			/* ignore */
		}
		origError(...args);
	};

	window.addEventListener("error", (ev) => {
		push("window", ev.message || String(ev.error ?? "error"));
	});
	window.addEventListener("unhandledrejection", (ev) => {
		const r = ev.reason;
		push(
			"rejection",
			r instanceof Error ? r.message : String(r ?? "rejection"),
		);
	});
}
