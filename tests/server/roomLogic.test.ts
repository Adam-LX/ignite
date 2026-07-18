import { describe, expect, it } from "vitest";

import {
	buildLobbyState,
	canRequestStart,
	nextFreeSlot,
	onlineMaxPlayers,
	resolveOnlineMode,
	sanitizeRankedFlag,
	shouldBeginMatch,
} from "../../server/roomLogic";

describe("roomLogic", () => {
	it("resolveOnlineMode — wszystkie tryby menu", () => {
		expect(resolveOnlineMode()).toBe("1v1");
		expect(resolveOnlineMode("2v2")).toBe("2v2");
		expect(resolveOnlineMode("3v3")).toBe("3v3");
		expect(resolveOnlineMode("4v4")).toBe("4v4");
		expect(resolveOnlineMode("ignitionRush2v2")).toBe("ignitionRush2v2");
		expect(resolveOnlineMode("weeklyLab2v2")).toBe("weeklyLab2v2");
	});

	it("onlineMaxPlayers — cap 8", () => {
		expect(onlineMaxPlayers("1v1")).toBe(2);
		expect(onlineMaxPlayers("2v2")).toBe(4);
		expect(onlineMaxPlayers("3v3")).toBe(6);
		expect(onlineMaxPlayers("4v4")).toBe(8);
		expect(onlineMaxPlayers("ignition")).toBe(8);
	});

	it("nextFreeSlot do 8", () => {
		expect(nextFreeSlot([0, 2], 4)).toBe(1);
		expect(nextFreeSlot([0, 1, 2, 3], 4)).toBe(null);
		expect(nextFreeSlot([0, 1, 2, 3, 4, 5], 8)).toBe(6);
	});

	it("shouldBeginMatch (legacy full-room)", () => {
		expect(shouldBeginMatch(2, 2)).toBe(true);
		expect(shouldBeginMatch(3, 4)).toBe(false);
		expect(shouldBeginMatch(4, 4)).toBe(true);
	});

	it("canRequestStart — solo + force / ready / ranked", () => {
		expect(
			canRequestStart({
				humanCount: 1,
				allReady: false,
				force: true,
				ranked: false,
			}),
		).toBe(true);
		expect(
			canRequestStart({
				humanCount: 1,
				allReady: true,
				force: false,
				ranked: false,
			}),
		).toBe(true);
		expect(
			canRequestStart({
				humanCount: 1,
				allReady: false,
				force: false,
				ranked: false,
			}),
		).toBe(false);
		expect(
			canRequestStart({
				humanCount: 1,
				allReady: true,
				force: true,
				ranked: true,
			}),
		).toBe(false);
		expect(
			canRequestStart({
				humanCount: 2,
				allReady: false,
				force: true,
				ranked: true,
			}),
		).toBe(true);
	});

	it("buildLobbyState — bot-fill placeholders", () => {
		const state = buildLobbyState({
			mode: "3v3",
			maxPlayers: 6,
			humans: [
				{
					slot: 0,
					clientId: "h1",
					displayName: "Host",
					carId: "muscle",
					ready: true,
				},
				{
					slot: 3,
					clientId: "g1",
					displayName: "Guest",
					carId: "truck",
					ready: false,
				},
			],
			ranked: false,
		});
		expect(state.slots).toHaveLength(6);
		expect(state.slots.filter((s) => s.isBot)).toHaveLength(4);
		expect(state.slots.find((s) => s.slot === 0)?.name).toBe("Host");
		expect(state.canStart).toBe(true);
		expect(state.allHumansReady).toBe(false);
	});

	it("sanitizeRankedFlag", () => {
		expect(sanitizeRankedFlag(true, "1v1")).toBe(true);
		expect(sanitizeRankedFlag(true, "2v2")).toBe(true);
		expect(sanitizeRankedFlag(true, "3v3")).toBe(false);
		expect(sanitizeRankedFlag(true, "ignition")).toBe(false);
	});
});
