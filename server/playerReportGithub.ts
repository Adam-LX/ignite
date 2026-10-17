/** Tworzy GitHub Issue z raportu gracza (token: env lub `gh auth`). */

import { githubTokenSourceHint, resolveGithubToken } from "./githubToken.ts";

const GITHUB_API = "https://api.github.com";
const MAX_BODY = 55_000;

type ReportLike = {
	gameVersion?: string;
	createdAt?: string;
	note?: string;
	platform?: {
		platform?: string;
		userAgent?: string;
		electron?: boolean;
	};
	viewport?: {
		innerWidth?: number;
		innerHeight?: number;
		devicePixelRatio?: number;
		drawingBufferWidth?: number;
		drawingBufferHeight?: number;
		menuBloomLikely?: boolean;
	};
	webgl?: { renderer?: string; vendor?: string };
	performance?: {
		avgFps?: number | null;
		p95FrameMs?: number | null;
		maxFrameMs?: number | null;
		freezeCount?: number | null;
		hitchCount?: number | null;
	};
	matchSession?: Record<string, unknown>;
	errors?: string[];
	bootLog?: string;
	matchLog?: string;
	context?: Record<string, unknown>;
};

function readToken(): string | null {
	return resolveGithubToken();
}

function resolveRepo(): { owner: string; repo: string } {
	const raw =
		process.env.IGNITE_REPORT_GITHUB_REPO?.trim() || "Adam-LX/ignite-releases";
	const [owner, repo] = raw.split("/");
	if (!owner || !repo) return { owner: "Adam-LX", repo: "ignite-releases" };
	return { owner, repo };
}

export function isPlayerReportGithubEnabled(): boolean {
	if (process.env.IGNITE_PLAYER_REPORT_GITHUB === "0") return false;
	return readToken() !== null;
}

export function playerReportGithubStatus(): {
	enabled: boolean;
	tokenSource: string | null;
} {
	if (process.env.IGNITE_PLAYER_REPORT_GITHUB === "0") {
		return { enabled: false, tokenSource: null };
	}
	const token = readToken();
	return {
		enabled: token !== null,
		tokenSource: token ? githubTokenSourceHint() : null,
	};
}

export function inferReportLabels(report: ReportLike): string[] {
	const labels = new Set<string>(["player-report"]);
	const blob = JSON.stringify(report).toLowerCase();
	if (
		blob.includes("black") ||
		blob.includes("letterbox") ||
		blob.includes("czarne") ||
		report.viewport?.menuBloomLikely
	) {
		labels.add("visual");
		labels.add("black-bars");
	}
	if (
		blob.includes("room") ||
		blob.includes("lobby") ||
		blob.includes("online") ||
		blob.includes("pokoj") ||
		blob.includes("pokoi") ||
		blob.includes("lista")
	) {
		labels.add("online");
		labels.add("room-list");
	}
	if (blob.includes("bot") || blob.includes("fillbots")) {
		labels.add("bots");
	}
	if (
		blob.includes("crash") ||
		blob.includes("exception") ||
		(report.errors?.length ?? 0) > 5
	) {
		labels.add("crash");
	}
	if (
		blob.includes("freeze") ||
		blob.includes("hitch") ||
		blob.includes("stutter") ||
		(report.performance?.freezeCount ?? 0) > 0
	) {
		labels.add("perf");
		labels.add("freeze");
	}
	const p95 = report.performance?.p95FrameMs;
	if (p95 != null && p95 > 33) labels.add("perf");
	return [...labels];
}

function buildIssueTitle(report: ReportLike): string {
	const ver = report.gameVersion || "?";
	const note = report.note?.trim();
	if (note) return `Player report v${ver}: ${note.slice(0, 72)}`;
	const gpu = report.webgl?.renderer?.split("/")[0]?.trim();
	const res =
		report.viewport?.innerWidth && report.viewport?.innerHeight
			? `${report.viewport.innerWidth}x${report.viewport.innerHeight}`
			: "";
	const bits = [gpu, res].filter(Boolean).join(" · ");
	return bits
		? `Player report v${ver} — ${bits}`.slice(0, 100)
		: `Player report v${ver}`;
}

function buildIssueBody(report: ReportLike): string {
	const lines: string[] = [
		"## Player report (auto)",
		"",
		`- **Version:** ${report.gameVersion ?? "?"}`,
		`- **When:** ${report.createdAt ?? "?"}`,
		`- **Platform:** ${report.platform?.platform ?? "?"} · electron=${Boolean(report.platform?.electron)}`,
		`- **GPU:** ${report.webgl?.renderer ?? "?"}`,
		`- **Viewport:** ${report.viewport?.innerWidth ?? "?"}×${report.viewport?.innerHeight ?? "?"} @${report.viewport?.devicePixelRatio ?? "?"} · DB ${report.viewport?.drawingBufferWidth ?? "?"}×${report.viewport?.drawingBufferHeight ?? "?"}`,
		`- **FPS:** avg ${report.performance?.avgFps ?? "?"} · p95 ${report.performance?.p95FrameMs ?? "?"}ms · max ${report.performance?.maxFrameMs ?? "?"}ms · freezes ${report.performance?.freezeCount ?? "?"} · hitches ${report.performance?.hitchCount ?? "?"}`,
		`- **menuBloomLikely:** ${Boolean(report.viewport?.menuBloomLikely)}`,
	];
	if (report.matchSession) {
		lines.push(
			"",
			"### Match session",
			"",
			"```json",
			JSON.stringify(report.matchSession, null, 2).slice(0, 4000),
			"```",
		);
	}
	if (report.note) {
		lines.push("", "### Note", "", report.note);
	}
	if (report.errors?.length) {
		lines.push("", "### Recent errors", "", "```", ...report.errors.slice(-15), "```");
	}
	if (report.matchLog) {
		lines.push(
			"",
			"### Match log",
			"",
			"```",
			report.matchLog.slice(-2500),
			"```",
		);
	}
	const json = JSON.stringify(report, null, 2);
	const clipped =
		json.length > MAX_BODY
			? `${json.slice(0, MAX_BODY)}\n…(truncated)`
			: json;
	lines.push("", "<details><summary>Full JSON</summary>", "", "```json", clipped, "```", "", "</details>", "");
	return lines.join("\n");
}

export async function createPlayerReportIssue(
	report: ReportLike,
): Promise<{ ok: true; issueUrl: string; issueNumber: number } | { ok: false; error: string }> {
	const token = readToken();
	if (!token) {
		return { ok: false, error: "Brak GITHUB_TOKEN na serwerze" };
	}
	const { owner, repo } = resolveRepo();
	const labels = inferReportLabels(report);
	const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues`, {
		method: "POST",
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2022-11-28",
			"Content-Type": "application/json",
			"User-Agent": "ignite-mp-player-report",
		},
		body: JSON.stringify({
			title: buildIssueTitle(report),
			body: buildIssueBody(report),
			labels,
		}),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		return {
			ok: false,
			error: `GitHub ${res.status}: ${text.slice(0, 200)}`,
		};
	}
	const data = (await res.json()) as { html_url?: string; number?: number };
	if (!data.html_url || data.number == null) {
		return { ok: false, error: "GitHub: brak url/number w odpowiedzi" };
	}
	return { ok: true, issueUrl: data.html_url, issueNumber: data.number };
}
