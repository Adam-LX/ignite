import type { GameModeId } from "../game/modes";
import type { MatchPhase } from "../modes/MatchController";

export type OnlineRole = "host" | "guest";

export type Vec3Payload = { x: number; y: number; z: number };

export type QuatPayload = { x: number; y: number; z: number; w: number };

export type InputFramePayload = {
	seq: number;
	tickHint: number;
	forward: number;
	yaw: number;
	roll: number;
	boost: boolean;
	jumpHeld: boolean;
	jumpEdge: boolean;
	recover: boolean;
};

export type CarSnapshotPayload = {
	slot: number;
	pos: Vec3Payload;
	quat: QuatPayload;
	linvel: Vec3Payload;
	angvel: Vec3Payload;
	boost: number;
	boosting: boolean;
};

export type MatchSnapshotPayload = {
	phase: MatchPhase;
	timeRemainingSec: number;
	blueScore: number;
	orangeScore: number;
	countdownSec: number | null;
	kickoffTick: number | null;
	kickoffIgnite: boolean;
	overtimeBanner: boolean;
	isOvertime: boolean;
	winnerLabel: string | null;
	replayActive: boolean;
	resetCountdown: number | null;
	goalScorerName: string | null;
};

export type WorldSnapshotPayload = {
	tick: number;
	serverTimeMs: number;
	ball: {
		pos: Vec3Payload;
		quat: QuatPayload;
		linvel: Vec3Payload;
		angvel: Vec3Payload;
	};
	cars: CarSnapshotPayload[];
	match: MatchSnapshotPayload;
};

export type ClientMessage =
	| { type: "createRoom"; ranked?: boolean; clientId?: string }
	| { type: "joinRoom"; roomCode: string; clientId?: string }
	| {
			type: "reportMatch";
			blueScore: number;
			orangeScore: number;
	  }
	| { type: "inputFrame"; frame: InputFramePayload }
	| { type: "snapshot"; snapshot: WorldSnapshotPayload }
	| { type: "rematch" };

export type ServerMessage =
	| {
			type: "welcome";
			roomCode: string;
			slot: number;
			role: OnlineRole;
			ranked?: boolean;
			elo?: number;
	  }
	| { type: "peerJoined" }
	| { type: "peerLeft"; reason?: string }
	| {
			type: "startMatch";
			mode: GameModeId;
			seed: number;
			ranked?: boolean;
	  }
	| {
			type: "rankedResult";
			eloBefore: number;
			eloAfter: number;
			delta: number;
	  }
	| { type: "inputFrame"; frame: InputFramePayload; fromSlot: number }
	| { type: "snapshot"; snapshot: WorldSnapshotPayload }
	| { type: "error"; message: string };

export const DEFAULT_MP_PORT = 8765;
export const SNAPSHOT_RATE_HZ = 60;
/** ~3 klatki bufora przy 60 Hz — płynna interpolacja bez nadmiarowego lagu. */
export const INTERPOLATION_DELAY_MS = 50;

export function parseServerAddress(raw: string): {
	host: string;
	port: number;
} {
	const trimmed = raw.trim();
	if (!trimmed) {
		return { host: "localhost", port: DEFAULT_MP_PORT };
	}
	if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) {
		const url = new URL(trimmed);
		const defaultPort = trimmed.startsWith("wss://") ? 443 : DEFAULT_MP_PORT;
		return {
			host: url.hostname,
			port: url.port ? Number(url.port) : defaultPort,
		};
	}
	const colon = trimmed.lastIndexOf(":");
	if (colon > 0 && colon < trimmed.length - 1) {
		const host = trimmed.slice(0, colon);
		const port = Number(trimmed.slice(colon + 1));
		if (!Number.isNaN(port)) {
			return { host, port };
		}
	}
	return { host: trimmed, port: DEFAULT_MP_PORT };
}

export function buildWsUrl(host: string, port: number): string {
	const isLocal = host === "localhost" || host === "127.0.0.1";
	const protocol =
		isLocal &&
		typeof window !== "undefined" &&
		window.location.protocol === "https:"
			? "wss"
			: "ws";
	const omitPort =
		(protocol === "wss" && port === 443) || (protocol === "ws" && port === 80);
	return omitPort ? `${protocol}://${host}` : `${protocol}://${host}:${port}`;
}

/** Pełny adres WS z surowego wpisu (host:port, ws://, wss://). */
export function resolveWsUrl(serverRaw: string): string {
	const trimmed = serverRaw.trim();
	if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) {
		return trimmed;
	}
	const { host, port } = parseServerAddress(trimmed);
	return buildWsUrl(host, port);
}

/** Baza HTTP do /status i /rooms (wss:// → https://). */
export function mpHttpBaseUrl(serverRaw: string): string {
	const trimmed = serverRaw.trim();
	if (!trimmed) {
		return `http://localhost:${DEFAULT_MP_PORT}`;
	}
	if (trimmed.startsWith("wss://")) {
		const url = new URL(trimmed);
		const port = url.port ? `:${url.port}` : "";
		return `https://${url.hostname}${port}`;
	}
	if (trimmed.startsWith("ws://")) {
		const url = new URL(trimmed);
		const port = url.port ? `:${url.port}` : `:${DEFAULT_MP_PORT}`;
		return `http://${url.hostname}${port}`;
	}
	const { host, port } = parseServerAddress(trimmed);
	if (
		typeof window !== "undefined" &&
		window.location.protocol === "https:" &&
		(host === "localhost" || host === "127.0.0.1")
	) {
		return `https://${host}:${port}`;
	}
	return `http://${host}:${port}`;
}
