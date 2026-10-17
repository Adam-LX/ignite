import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	acceptFriend,
	addIncomingRequest,
	addOutgoingRequest,
	appendDmForPeer,
	applyPresenceSnapshot,
	getDmThread,
	listFriends,
	listPendingIncoming,
	promoteOutgoingToFriend,
	removeFriend,
	resetFriendsStoreForTests,
} from "../../src/social/FriendsStore";
import {
	generateInviteCode,
	getInviteCode,
	getSocialDisplayName,
	getSocialId,
	normalizeInviteCode,
	resetSocialIdentityForTests,
	setSocialDisplayName,
} from "../../src/social/SocialIdentity";

describe("SocialIdentity", () => {
	beforeEach(() => {
		resetSocialIdentityForTests();
	});

	it("persists socialId and invite code", () => {
		const id1 = getSocialId();
		const code1 = getInviteCode();
		expect(id1.length).toBeGreaterThan(8);
		expect(code1).toMatch(/^IGN-[A-Z0-9]{4}$/);
		expect(getSocialId()).toBe(id1);
		expect(getInviteCode()).toBe(code1);
	});

	it("normalizeInviteCode accepts short form", () => {
		expect(normalizeInviteCode("ab12")).toBe("IGN-AB12");
		expect(normalizeInviteCode("ign-xy9z")).toBe("IGN-XY9Z");
	});

	it("generateInviteCode is stable for same seed", () => {
		expect(generateInviteCode("seed-a")).toBe(generateInviteCode("seed-a"));
		expect(generateInviteCode("seed-a")).not.toBe(generateInviteCode("seed-b"));
	});

	it("displayName clamps length", () => {
		setSocialDisplayName("  Ada  ");
		expect(getSocialDisplayName()).toBe("Ada");
		setSocialDisplayName("x".repeat(40));
		expect(getSocialDisplayName().length).toBe(24);
	});
});

describe("FriendsStore", () => {
	beforeEach(() => {
		resetFriendsStoreForTests();
	});

	afterEach(() => {
		resetFriendsStoreForTests();
	});

	it("add outgoing + promote to friend", () => {
		addOutgoingRequest({
			socialId: "peer-1",
			inviteCode: "IGN-TEST",
			name: "Bob",
			at: 1,
		});
		expect(listPendingIncoming()).toHaveLength(0);
		const entry = promoteOutgoingToFriend("peer-1", "Bobby", "IGN-TEST");
		expect(entry.name).toBe("Bobby");
		expect(listFriends()).toHaveLength(1);
		expect(listFriends()[0]!.status).toBe("online");
	});

	it("accept incoming request", () => {
		addIncomingRequest({
			socialId: "peer-2",
			inviteCode: "ign-abcd",
			name: "Cara",
			at: 2,
		});
		expect(listPendingIncoming()).toHaveLength(1);
		const f = acceptFriend("peer-2");
		expect(f?.inviteCode).toBe("IGN-ABCD");
		expect(listPendingIncoming()).toHaveLength(0);
		expect(listFriends().some((x) => x.socialId === "peer-2")).toBe(true);
	});

	it("remove friend", () => {
		promoteOutgoingToFriend("peer-3", "Dan", "IGN-DAN1");
		removeFriend("peer-3");
		expect(listFriends()).toHaveLength(0);
	});

	it("presence snapshot updates status", () => {
		promoteOutgoingToFriend("peer-4", "Eve", "IGN-EVE1");
		applyPresenceSnapshot([
			{ socialId: "peer-4", name: "Eve", status: "inLobby" },
		]);
		expect(listFriends()[0]!.status).toBe("inLobby");
		applyPresenceSnapshot([]);
		expect(listFriends()[0]!.status).toBe("offline");
	});

	it("dm thread persists", () => {
		appendDmForPeer("me", "peer", {
			fromSocialId: "me",
			toSocialId: "peer",
			text: "hi",
			at: 10,
		});
		appendDmForPeer("me", "peer", {
			fromSocialId: "peer",
			toSocialId: "me",
			text: "yo",
			at: 11,
		});
		const thread = getDmThread("me", "peer");
		expect(thread).toHaveLength(2);
		expect(thread[1]!.text).toBe("yo");
	});
});
