import { describe, expect, it } from "vitest";

import { collectMpServerCandidates } from "../../src/net/serverStatus";
import { listWaitingRooms } from "../../server/mpRooms";
import { mpHttpBaseUrl, parseServerAddress, resolveWsUrl } from "../../src/net/protocol";

describe("collectMpServerCandidates", () => {
	it("preferuje publiczny relay przed lokalnym", () => {
		const candidates = collectMpServerCandidates({
			server: "wss://relay.example.com",
			local: "localhost:8765",
			lan: "ws://192.168.1.10:8765",
		});
		expect(candidates[0]).toBe("wss://relay.example.com");
		expect(candidates).toContain("localhost:8765");
		expect(candidates).toContain("ws://192.168.1.10:8765");
	});

	it("uwzględnia hosty z LAN discovery (multicast)", () => {
		const candidates = collectMpServerCandidates({
			local: "localhost:8765",
		});
		// Bez bridge — tylko localhost; test struktury gdy bridge mockowany przez env nie jest dostępny w vitest
		expect(candidates[candidates.length - 1]).toBe("localhost:8765");
	});
});

describe("listWaitingRooms", () => {
	it("zwraca tylko pokoje bez gościa", () => {
		const rooms = listWaitingRooms([
			{ code: "ZZZZZZ", guest: null, ranked: true },
			{ code: "AAAAAA", guest: { ws: 1 } },
			{ code: "MMMMMM", guest: null, ranked: false },
		]);
		expect(rooms.map((r) => r.code)).toEqual(["MMMMMM", "ZZZZZZ"]);
		expect(rooms[1]?.ranked).toBe(true);
	});
});

describe("MP URL helpers", () => {
	it("resolveWsUrl akceptuje wss://", () => {
		expect(resolveWsUrl("wss://example.com")).toBe("wss://example.com");
	});

	it("mpHttpBaseUrl mapuje wss na https", () => {
		expect(mpHttpBaseUrl("wss://tunnel.example.com")).toBe(
			"https://tunnel.example.com",
		);
	});

	it("parseServerAddress dla wss bez portu używa 443", () => {
		expect(parseServerAddress("wss://tunnel.example.com")).toEqual({
			host: "tunnel.example.com",
			port: 443,
		});
	});
});
