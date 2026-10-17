/**
 * Overlay diagnostyczny path tracera — `?ptDebug=1` w URL.
 */

import type { PathTraceFrameStats } from "./MatchPathTracer";

let el: HTMLDivElement | null = null;

export function isPathTraceDebugEnabled(): boolean {
	if (typeof location === "undefined") return false;
	return new URLSearchParams(location.search).get("ptDebug") === "1";
}

export type PtDebugBackend =
	| "realtime-rt"
	| "pathtracer"
	| "film-hybrid"
	| "warming"
	| "off";

export function updatePathTraceDebugHud(
	active: boolean,
	stats: PathTraceFrameStats | null,
	backend: PtDebugBackend = "off",
): void {
	if (!isPathTraceDebugEnabled()) {
		if (el) {
			el.remove();
			el = null;
		}
		return;
	}
	if (!el) {
		el = document.createElement("div");
		el.id = "ignite-pt-debug";
		el.style.cssText =
			"position:fixed;left:8px;bottom:8px;z-index:99999;font:12px/1.35 ui-monospace,monospace;" +
			"color:#c8ffe0;background:rgba(0,12,8,.72);padding:6px 8px;border:1px solid #2a6;pointer-events:none;";
		document.body.appendChild(el);
	}
	if (backend === "warming") {
		el.textContent = "RT warming → film hybrid…";
		return;
	}
	if (backend === "film-hybrid") {
		el.textContent = "film-hybrid (planar+lacquer+post)";
		return;
	}
	if (!active || !stats || backend === "off") {
		el.textContent = "PT: inactive (raster)";
		return;
	}
	el.textContent = `${backend} · ${stats.ms.toFixed(1)}ms${stats.rebuilt ? " COMPILE" : ""}`;
}
