import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isSocialClientMessage } from "../../src/net/protocol";
import { SocialHub } from "../../server/socialHub";
import type { ServerMessage } from "../../src/net/protocol";

describe("socialProtocol", () => {
	it("isSocialClientMessage", () => {
		expect(isSocialClientMessage("socialHello")).toBe(true);
		expect(isSocialClientMessage("socialDm")).toBe(true);
		expect(isSocialClientMessage("socialBindRoom")).toBe(true);
		expect(isSocialClientMessage("createRoom")).toBe(false);
		expect(isSocialClientMessage("ping")).toBe(false);
	});
});

describe("SocialHub", () => {
	it("hello + presence + dm forward", () => {
		const hub = new SocialHub();
		const inboxA: ServerMessage[] = [];
		const inboxB: ServerMessage[] = [];
		const sendA = (m: ServerMessage) => inboxA.push(m);
		const sendB = (m: ServerMessage) => inboxB.push(m);

		hub.hello(sendA, "id-a", "IGN-AAAA", "Ada");
		hub.hello(sendB, "id-b", "IGN-BBBB", "Bob");

		expect(inboxA.some((m) => m.type === "socialWelcome")).toBe(true);
		expect(inboxB.some((m) => m.type === "socialPresence")).toBe(true);

		hub.handle(sendA, {
			type: "socialFriendRequest",
			toInviteCode: "IGN-BBBB",
		});
		expect(
			inboxB.some(
				(m) => m.type === "socialFriendRequest" && m.fromSocialId === "id-a",
			),
		).toBe(true);

		hub.handle(sendB, {
			type: "socialFriendResponse",
			fromSocialId: "id-a",
			accept: true,
		});
		expect(
			inboxA.some(
				(m) => m.type === "socialFriendResponse" && m.accept === true,
			),
		).toBe(true);

		inboxA.length = 0;
		inboxB.length = 0;
		hub.handle(sendA, { type: "socialDm", toSocialId: "id-b", text: "hi" });
		expect(inboxB.some((m) => m.type === "socialDm" && m.text === "hi")).toBe(
			true,
		);
		expect(inboxA.some((m) => m.type === "socialDm" && m.text === "hi")).toBe(
			true,
		);
	});

	it("offline target errors", () => {
		const hub = new SocialHub();
		const inbox: ServerMessage[] = [];
		const send = (m: ServerMessage) => inbox.push(m);
		hub.hello(send, "id-a", "IGN-AAAA", "Ada");
		hub.handle(send, { type: "socialFriendRequest", toInviteCode: "IGN-ZZZZ" });
		expect(inbox.some((m) => m.type === "error")).toBe(true);
	});

	it("party chat via bindRoom", () => {
		const hub = new SocialHub();
		const a: ServerMessage[] = [];
		const b: ServerMessage[] = [];
		const sendA = (m: ServerMessage) => a.push(m);
		const sendB = (m: ServerMessage) => b.push(m);
		hub.hello(sendA, "id-a", "IGN-AAAA", "Ada");
		hub.hello(sendB, "id-b", "IGN-BBBB", "Bob");
		hub.handle(sendA, { type: "socialBindRoom", roomCode: "ABCD" });
		hub.handle(sendB, { type: "socialBindRoom", roomCode: "ABCD" });
		a.length = 0;
		b.length = 0;
		expect(hub.handle(sendA, { type: "socialPartyChat", text: "glhf" })).toBe(
			true,
		);
		expect(a.some((m) => m.type === "socialPartyChat" && m.text === "glhf")).toBe(
			true,
		);
		expect(b.some((m) => m.type === "socialPartyChat" && m.text === "glhf")).toBe(
			true,
		);
	});

	it("party chat without bind errors", () => {
		const hub = new SocialHub();
		const inbox: ServerMessage[] = [];
		const send = (m: ServerMessage) => inbox.push(m);
		hub.hello(send, "id-a", "IGN-AAAA", "Ada");
		hub.handle(send, { type: "socialPartyChat", text: "x" });
		expect(inbox.some((m) => m.type === "error")).toBe(true);
	});

	it("party chat broadcast helper", () => {
		const hub = new SocialHub();
		const a: ServerMessage[] = [];
		const b: ServerMessage[] = [];
		const sendA = (m: ServerMessage) => a.push(m);
		const sendB = (m: ServerMessage) => b.push(m);
		hub.hello(sendA, "id-a", "IGN-AAAA", "Ada");
		hub.hello(sendB, "id-b", "IGN-BBBB", "Bob");
		const peer = hub.getPeerBySend(sendA)!;
		hub.broadcastPartyChat(peer, "glhf", [sendA, sendB]);
		expect(a.some((m) => m.type === "socialPartyChat")).toBe(true);
		expect(b.some((m) => m.type === "socialPartyChat")).toBe(true);
	});
});

describe("social UI hide-in-match", () => {
	it("CSS hides fab and panel during match", () => {
		const css = readFileSync(
			resolve(__dirname, "../../src/style.css"),
			"utf8",
		);
		expect(css).toMatch(/body\.in-match\s+#social-fab/);
		expect(css).toMatch(/body\.in-match\s+#social-panel/);
		expect(css).toMatch(/display:\s*none\s*!important/);
	});
});
