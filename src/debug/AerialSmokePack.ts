/**
 * Aerial smoke pack — w meczu (DEV).
 * Ctrl+Shift+A — następny · Ctrl+Shift+Z — poprzedni · Ctrl+Shift+X — replay
 */
import type { GameSession, GameSessionDeps } from "../game/GameSession";
import {
	AERIAL_SMOKE_SCENARIOS,
	type AerialSmokeScenario,
} from "./aerialSmokeScenarios";

type SessionWin = {
	__igniteSession?: GameSession;
	__igniteMatchDeps?: GameSessionDeps;
};

export class AerialSmokePack {
	private index = 0;
	private badge: HTMLDivElement | null = null;
	private badgeTimer = 0;
	private attached = false;
	private readonly onKeyDown: (e: KeyboardEvent) => void;

	constructor() {
		this.onKeyDown = (e) => {
			if (!e.ctrlKey || !e.shiftKey || e.repeat) return;
			if (!document.body.classList.contains("in-match")) return;

			if (e.code === "KeyA") {
				e.preventDefault();
				e.stopPropagation();
				this.next();
				return;
			}
			if (e.code === "KeyZ") {
				e.preventDefault();
				e.stopPropagation();
				this.prev();
				return;
			}
			if (e.code === "KeyX") {
				e.preventDefault();
				e.stopPropagation();
				this.replay();
			}
		};
	}

	attach(): void {
		if (this.attached) return;
		this.attached = true;
		window.addEventListener("keydown", this.onKeyDown, true);
		console.info(
			"[AerialSmoke] Ctrl+Shift+A next · Z prev · X replay — 6 scenariuszy aerial",
		);
	}

	detach(): void {
		if (!this.attached) return;
		this.attached = false;
		window.removeEventListener("keydown", this.onKeyDown, true);
		this.hideBadge();
	}

	next(): void {
		this.index = (this.index + 1) % AERIAL_SMOKE_SCENARIOS.length;
		this.applyCurrent();
	}

	prev(): void {
		this.index =
			(this.index - 1 + AERIAL_SMOKE_SCENARIOS.length) %
			AERIAL_SMOKE_SCENARIOS.length;
		this.applyCurrent();
	}

	replay(): void {
		this.applyCurrent();
	}

	applyById(id: string): boolean {
		const i = AERIAL_SMOKE_SCENARIOS.findIndex((s) => s.id === id);
		if (i < 0) return false;
		this.index = i;
		this.applyCurrent();
		return true;
	}

	list(): { id: string; label: string; tip: string }[] {
		return AERIAL_SMOKE_SCENARIOS.map((s) => ({
			id: s.id,
			label: s.label,
			tip: s.tip,
		}));
	}

	private applyCurrent(): void {
		const scenario = AERIAL_SMOKE_SCENARIOS[this.index]!;
		const ok = this.applyScenario(scenario);
		this.showBadge(scenario, ok);
		if (ok) {
			console.info(`[AerialSmoke] ${scenario.label}\n  ${scenario.tip}`);
		} else {
			console.warn(
				"[AerialSmoke] Brak sesji meczu — wejdź w mecz i spróbuj ponownie",
			);
		}
	}

	private applyScenario(scenario: AerialSmokeScenario): boolean {
		const win = window as unknown as SessionWin;
		const session = win.__igniteSession;
		const deps = win.__igniteMatchDeps;
		if (!session || !deps) return false;
		session.applyAerialSmokePose(deps, scenario.build());
		return true;
	}

	private showBadge(scenario: AerialSmokeScenario, ok: boolean): void {
		if (!this.badge) {
			this.badge = document.createElement("div");
			this.badge.style.cssText = [
				"position:fixed",
				"left:12px",
				"bottom:12px",
				"z-index:99999",
				"max-width:min(420px,92vw)",
				"padding:10px 14px",
				"border-radius:8px",
				"background:rgba(6,10,18,0.82)",
				"border:1px solid rgba(120,200,255,0.35)",
				"color:#e8f4ff",
				"font:600 13px/1.35 ui-sans-serif,system-ui,sans-serif",
				"pointer-events:none",
				"box-shadow:0 8px 28px rgba(0,0,0,0.45)",
			].join(";");
			document.body.appendChild(this.badge);
		}
		this.badge.innerHTML = ok
			? `<div style="opacity:.7;font-size:11px;letter-spacing:.04em">AERIAL SMOKE · Ctrl+Shift+A/Z/X</div>
				<div style="margin-top:4px">${scenario.label}</div>
				<div style="margin-top:6px;font-weight:500;opacity:.88;font-size:12px">${scenario.tip}</div>`
			: `<div>Aerial smoke — wejdź w mecz</div>`;
		window.clearTimeout(this.badgeTimer);
		this.badgeTimer = window.setTimeout(() => this.hideBadge(), 9000);
	}

	private hideBadge(): void {
		if (!this.badge) return;
		this.badge.remove();
		this.badge = null;
	}
}

let singleton: AerialSmokePack | null = null;

export function getAerialSmokePack(): AerialSmokePack {
	if (!singleton) singleton = new AerialSmokePack();
	return singleton;
}
