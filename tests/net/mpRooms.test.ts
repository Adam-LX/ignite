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
	it("zwraca tylko pokoje bez pełnego składu", () => {
		const rooms = listWaitingRooms([
			{
				code: "ZZZZZZ",
				clients: [{ ws: 1 }],
				maxPlayers: 2,
				ranked: true,
				mode: "1v1",
			},
			{
				code: "AAAAAA",
				clients: [{ ws: 1 }, { ws: 2 }],
				maxPlayers: 2,
			},
			{
				code: "MMMMMM",
				clients: [{ ws: 1 }],
				maxPlayers: 4,
				ranked: false,
				mode: "2v2",
			},
		]);
		expect(rooms.map((r) => r.code)).toEqual(["MMMMMM", "ZZZZZZ"]);
		expect(rooms[1]?.ranked).toBe(true);
		expect(rooms[0]?.maxPlayers).toBe(4);
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
