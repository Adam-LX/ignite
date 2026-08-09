#!/usr/bin/env node
/** Rename channel + branding. Exact "Ignite" is blocked by YouTube. */
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const LOG = path.join(ROOT, "docs/youtube/run-log");
const ASSETS = path.join(ROOT, "docs/youtube/assets");
const channelId = "UCQhLorkB5Q1v0Bt5BhBMdJQ";
const NAMES = ["Ignite Game", "Play Ignite", "Ignite Arcade", "Team Ignite"];
const BANNER = path.join(ASSETS, "banner-youtube.jpg");
const AVATAR = path.join(ASSETS, "avatar-logo.png");

fs.mkdirSync(LOG, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const created = await fetch(
	"http://127.0.0.1:9222/json/new?" +
		encodeURIComponent(`https://studio.youtube.com/channel/${channelId}/editing/details`),
	{ method: "PUT" },
).then((r) => r.json());
await sleep(4500);
const page = (await fetch("http://127.0.0.1:9222/json/list").then((r) => r.json())).find((t) => t.id === created.id);
const pws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
	pws.once("open", res);
	pws.once("error", rej);
});
let pid = 0;
const pp = new Map();
pws.on("message", (raw) => {
	const msg = JSON.parse(raw.toString());
	if (msg.id && pp.has(msg.id)) {
		const { resolve, reject, timer } = pp.get(msg.id);
		clearTimeout(timer);
		pp.delete(msg.id);
		if (msg.error) reject(new Error(JSON.stringify(msg.error)));
		else resolve(msg.result);
	}
});
const psend = (method, params = {}, timeout = 45000) =>
	new Promise((resolve, reject) => {
		const i = ++pid;
		const timer = setTimeout(() => {
			pp.delete(i);
			reject(new Error("t " + method));
		}, timeout);
		pp.set(i, { resolve, reject, timer });
		pws.send(JSON.stringify({ id: i, method, params }));
	});
await psend("Runtime.enable");
await psend("Page.enable");
await psend("DOM.enable");
const evalR = async (expression) => {
	const r = await psend("Runtime.evaluate", {
		expression,
		returnByValue: true,
		userGesture: true,
		awaitPromise: true,
	});
	if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
	return r.result?.value;
};
const shot = async (n) => {
	const { data } = await psend("Page.captureScreenshot", { format: "png" });
	const p = path.join(LOG, `${Date.now()}-${n}.png`);
	fs.writeFileSync(p, Buffer.from(data, "base64"));
	console.log("shot", p);
};
const clickText = async (exact) => {
	const t = await evalR(`(() => {
    const want = ${JSON.stringify(exact)};
    for (const el of document.querySelectorAll("button, yt-button-shape, [role=button]")) {
      const text = (el.innerText || "").replace(/\\s+/g, " ").trim();
      if (text === want || text.startsWith(want)) {
        (el.querySelector("button") || el).click();
        return text;
      }
    }
    return null;
  })()`);
	console.log("click", exact, "->", t);
	return t;
};

await evalR(`document.querySelectorAll("[role=dialog] button").forEach(b => { if (/anuluj|zamknij|cancel/i.test(b.innerText||"")) b.click(); })`);
await sleep(600);

let accepted = null;
for (const name of NAMES) {
	const typed = await evalR(`(() => {
    const inputs = [...document.querySelectorAll("input")].filter((i) => (!i.type || i.type === "text") && i.offsetWidth > 80 && !/search|szukaj|http|@/i.test([i.id, i.placeholder, i.value].join(" ")));
    const el = inputs[0];
    if (!el) return null;
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(name)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value;
  })()`);
	console.log("typed", typed);
	await sleep(500);
	await clickText("Opublikuj");
	await sleep(2800);
	const body = await evalR(`document.body.innerText || ""`);
	const rejected = /Nie można tak nazwać|Use a different name/i.test(body);
	console.log(name, rejected ? "REJECTED" : "maybe OK");
	await shot(`name-${name.replace(/\s+/g, "_")}`);
	if (!rejected) {
		accepted = name;
		break;
	}
}

await psend("Page.navigate", { url: `https://studio.youtube.com/channel/${channelId}/editing/profile` });
await sleep(4000);
await evalR(`document.querySelectorAll("[role=dialog] button").forEach(b => { if (/anuluj|zamknij|cancel/i.test(b.innerText||"")) b.click(); })`);
const nFiles = await evalR(`document.querySelectorAll("input[type=file]").length`);
console.log("files", nFiles);

const setFile = async (idx, file) => {
	await evalR(`(() => {
    document.querySelectorAll("input[type=file]").forEach((i) => i.removeAttribute("data-ignite"));
    document.querySelectorAll("input[type=file]")[${idx}].setAttribute("data-ignite", "1");
    return true;
  })()`);
	const doc = await psend("DOM.getDocument", { depth: -1 });
	const { nodeId } = await psend("DOM.querySelector", {
		nodeId: doc.root.nodeId,
		selector: 'input[type=file][data-ignite="1"]',
	});
	await psend("DOM.setFileInputFiles", { nodeId, files: [file] });
	await sleep(2200);
	await clickText("Gotowe");
	await sleep(1500);
	await clickText("Opublikuj");
	await sleep(1500);
};

if (nFiles > 0 && fs.existsSync(BANNER)) {
	await setFile(0, BANNER);
	console.log("banner");
}
if (nFiles > 1 && fs.existsSync(AVATAR)) {
	await setFile(1, AVATAR);
	console.log("avatar");
}
await shot("final");

const summary = {
	ok: !!accepted,
	acceptedName: accepted,
	exactIgniteRejected: true,
	descriptionLikelyApplied: true,
	channelId,
	handle: "@adam_em2820",
	public: "https://www.youtube.com/@adam_em2820",
	studio: `https://studio.youtube.com/channel/${channelId}`,
	newChannelRequiresVerification: true,
	at: new Date().toISOString(),
};
fs.writeFileSync(path.join(LOG, "summary.json"), JSON.stringify(summary, null, 2));
console.log("DONE", summary);
pws.close();
