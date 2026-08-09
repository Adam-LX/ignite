import { describe, expect, it } from "vitest";

import {
	isSocialClientMessage,
	type ClientMessage,
	type ServerMessage,
} from "../../src/net/protocol";

describe("socialProtocol serialization", () => {
	it("round-trips client social messages as JSON", () => {
		const msgs: ClientMessage[] = [
			{
				type: "socialHello",
				socialId: "s1",
				inviteCode: "IGN-ABCD",
				displayName: "Ada",
				status: "online",
			},
			{ type: "socialSetStatus", status: "inLobby" },
			{ type: "socialFriendRequest", toInviteCode: "IGN-ZZZZ" },
			{ type: "socialFriendResponse", fromSocialId: "s2", accept: true },
			{ type: "socialDm", toSocialId: "s2", text: "hello" },
			{ type: "socialPartyInvite", toSocialId: "s2", roomCode: "ROOM" },
			{ type: "socialPartyChat", text: "glhf" },
			{ type: "socialBindRoom", roomCode: "ROOM" },
			{ type: "socialBindRoom", roomCode: null },
		];
		for (const msg of msgs) {
			expect(isSocialClientMessage(msg.type)).toBe(true);
			const again = JSON.parse(JSON.stringify(msg)) as ClientMessage;
			expect(again).toEqual(msg);
		}
	});

	it("round-trips server social messages as JSON", () => {
		const msgs: ServerMessage[] = [
			{
				type: "socialWelcome",
				self: {
					socialId: "s1",
					inviteCode: "IGN-ABCD",
					name: "Ada",
					status: "online",
				},
			},
			{
				type: "socialPresence",
				entries: [
					{
						socialId: "s1",
						inviteCode: "IGN-ABCD",
						name: "Ada",
						status: "inLobby",
					},
				],
			},
			{
				type: "socialFriendRequest",
				fromSocialId: "s1",
				fromInviteCode: "IGN-ABCD",
				fromName: "Ada",
			},
			{
				type: "socialDm",
				fromSocialId: "s1",
				fromName: "Ada",
				text: "hi",
				at: 1,
			},
			{
				type: "socialPartyInvite",
				fromSocialId: "s1",
				fromName: "Ada",
				roomCode: "ABCD",
			},
			{
				type: "socialPartyChat",
				fromSocialId: "s1",
				fromName: "Ada",
				text: "go",
				at: 2,
			},
		];
		for (const msg of msgs) {
			expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
		}
	});
});
