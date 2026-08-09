#!/usr/bin/env node
/**
 * Tworzy kanał YouTube „Ignite” przez CDP (Vivaldi).
 * Używa świeżej karty (stare karty / MDX popup psuły channel_switcher).
 *
 *   bash scripts/youtube/open-vivaldi-cdp.sh --restart
 *   node scripts/youtube/setupChannel.mjs
 */
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ASSETS = path.join(ROOT, "docs/youtube/assets");
const LOG = path.join(ROOT, "docs/youtube/run-log");
const CHANNEL = "Ignite Game";
const AVATAR = path.join(ASSETS, "avatar-logo.png");
const BANNER = fs.existsSync(path.join(ASSETS, "banner-youtube.jpg"))
	? path.join(ASSETS, "banner-youtube.jpg")
	: path.join(ASSETS, "banner-2560x1440.png");
const DESC = `Ignite — car soccer arcade.
Boost, aeriale, gola. Bez czekania.

Pobierz (Windows / Linux / Steam Deck):
https://github.com/Adam-LX/ignite-releases/releases

Kod źródłowy:
https://codeberg.org/Adam-LX/ignite

Wjedź na boisko. Rozpal boost. Zostaw po sobie dym.`;
const CDP_HTTP = `http://127.0.0.1:${process.env.YT_CDP_PORT || "9222"}`;

fs.mkdirSync(LOG, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
	constructor(url) {
		this.url = url;
		this.id = 0;
		this.pending = new Map();
	}
	async open() {
		this.ws = new WebSocket(this.url);
		await new Promise((res, rej) => {
			this.ws.once("open", res);
			this.ws.once("error", rej);
			setTimeout(() => rej(new Error("ws timeout")), 15000);
		});
		this.ws.on("message", (raw) => {
			const msg = JSON.parse(raw.toString());
			if (!msg.id || !this.pending.has(msg.id)) return;
			const { resolve, reject, timer } = this.pending.get(msg.id);
			clearTimeout(timer);
			this.pending.delete(msg.id);
			if (msg.error) reject(new Error(JSON.stringify(msg.error)));
			else resolve(msg.result);
		});
	}
	send(method, params = {}, sessionId, timeout = 60000) {
		const id = ++this.id;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`timeout ${method}`));
			}, timeout);
			this.pending.set(id, { resolve, reject, timer });
			this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
		});
	}
	close() {
		try {
			this.ws.close();
		} catch {
			/* ignore */
		}
	}
}

async function main() {
	const ver = await fetch(`${CDP_HTTP}/json/version`).then((r) => {
		if (!r.ok) throw new Error("CDP down — bash scripts/youtube/open-vivaldi-cdp.sh --restart");
		return r.json();
	});
	const cdp = new Cdp(ver.webSocketDebuggerUrl);
	await cdp.open();
	console.log("WS OK", ver.Browser);

	const { targetId } = await cdp.send("Target.createTarget", {
		url: "https://www.youtube.com/channel_switcher?next=%2Faccount&feature=settings&authuser=1",
	});
	const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
	await cdp.send("Page.enable", {}, sessionId);
	await cdp.send("Runtime.enable", {}, sessionId);
	await cdp.send("DOM.enable", {}, sessionId);
	await sleep(4500);

	const evalR = async (expression) => {
		const r = await cdp.send(
			"Runtime.evaluate",
			{ expression, returnByValue: true, userGesture: true, awaitPromise: true },
			sessionId,
		);
		if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
		return r.result?.value;
	};
	const shot = async (name) => {
		const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
		const p = path.join(LOG, `${Date.now()}-${name}.png`);
		fs.writeFileSync(p, Buffer.from(data, "base64"));
		console.log("shot", p);
	};
	const clickByRe = async (reSource) => {
		const t = await evalR(`(() => {
      const re = new RegExp(${JSON.stringify(reSource)}, "i");
      const nodes = [...document.querySelectorAll("button, a, tp-yt-paper-button, yt-button-shape, [role=button]")];
      for (const el of nodes) {
        const text = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
        if (!re.test(text)) continue;
        const target = el.matches("button, a, [role=button]") ? el : el.querySelector("button") || el;
        target.click();
        return text.slice(0, 80);
      }
      return null;
    })()`);
		console.log("click", reSource, "->", t);
		return t;
	};
	const dismissMdx = async () => {
		for (let i = 0; i < 4; i++) {
			const hit = await clickByRe("^(Anuluj|Cancel)$");
			if (!hit) break;
			await sleep(600);
		}
		await evalR(`document.querySelectorAll(".ytp-mdx-popup-dialog").forEach((e) => e.remove())`);
	};

	await dismissMdx();
	await shot("fresh-list");

	for (let i = 0; i < 20; i++) {
		const ready = await evalR(
			`[...document.querySelectorAll("button")].some((b) => /utwórz kanał/i.test(b.innerText || ""))`,
		);
		if (ready) break;
		await sleep(400);
	}

	const exists = await evalR(
		`[...document.querySelectorAll("yt-formatted-string, span")].some((e) => (e.textContent || "").trim() === ${JSON.stringify(CHANNEL)})`,
	);
	console.log("exists", exists);

	if (!exists) {
		if (!(await clickByRe("Utwórz kanał"))) throw new Error("Brak Utwórz kanał");
		await sleep(1200);
		await dismissMdx();
		// właściwy confirm brand account (nie MDX)
		await clickByRe("^(Potwierdź|Confirm)$");
		await sleep(2000);
		await shot("name-dialog");

		const filled = await evalR(`(() => {
      const dialogs = [...document.querySelectorAll("tp-yt-paper-dialog, [role=dialog], ytd-channel-creation-dialog-renderer")];
      const dialog = dialogs.find((d) => !/YouTube TV|Nie korzystasz teraz|ytp-mdx/i.test(d.innerText || "")) || dialogs.find((d) => /nazwa|name|kanał/i.test(d.innerText || "")) || dialogs[0];
      const root = dialog || document;
      const inputs = [...root.querySelectorAll("input")].filter((i) => {
        if (i.type && i.type !== "text") return false;
        return !/search|szukaj/i.test([i.id, i.getAttribute("aria-label"), i.placeholder].join(" "));
      });
      const el = inputs.find((i) => i.offsetWidth || i.offsetHeight) || inputs[0];
      if (!el) return { ok: false, dialogText: dialog && (dialog.innerText || "").slice(0, 400) };
      el.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(CHANNEL)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: el.value };
    })()`);
		console.log("filled", filled);
		if (!filled?.ok || filled.value !== CHANNEL) {
			await shot("fill-fail");
			throw new Error("Nie wpisano Ignite");
		}
		await clickByRe("^(Utwórz kanał|Create channel|Utwórz)$");
		await sleep(6000);
		await shot("after-create");

		await cdp.send(
			"Page.navigate",
			{ url: "https://www.youtube.com/channel_switcher?next=%2Faccount&feature=settings&authuser=1" },
			sessionId,
		);
		await sleep(4000);
		await dismissMdx();
	}

	const listed = await evalR(
		`[...document.querySelectorAll("yt-formatted-string, span")].some((e) => (e.textContent || "").trim() === ${JSON.stringify(CHANNEL)})`,
	);
	await shot("list-check");
	if (!listed) throw new Error("Ignite nie ma na liście");
	await clickByRe(`^${CHANNEL}$`);
	await sleep(3000);

	await cdp.send("Page.navigate", { url: "https://studio.youtube.com/?authuser=1" }, sessionId);
	await sleep(5000);
	await dismissMdx();
	await shot("studio");
	const studio = await evalR(`({ href: location.href, text: (document.body.innerText || "").slice(0, 900) })`);
	console.log("studio", studio.href);
	if (/Adam_eM|adam\.mrowczynski|UCQhLorkB5Q1v0Bt5BhBMdJQ/i.test(`${studio.href}\n${studio.text || ""}`)) {
		await shot("wrong-channel");
		throw new Error("Studio na prywatnym kanale — stop (ochrona Adam_eM)");
	}
	if (!/Ignite/i.test(studio.text || "")) {
		await shot("wrong-channel");
		throw new Error("Studio nie na Ignite — stop");
	}
	const channelId = studio.href.split("/channel/")[1]?.split("/")[0];
	if (!channelId) throw new Error("brak channelId");
	console.log("channelId", channelId);

	await cdp.send("Page.navigate", { url: `https://studio.youtube.com/channel/${channelId}/editing/details` }, sessionId);
	await sleep(3500);
	await evalR(`(() => {
    const areas = [...document.querySelectorAll("textarea")];
    const el = areas.find((a) => /opis|description/i.test([a.getAttribute("aria-label"), a.id].join(" "))) || areas[0];
    if (!el) return false;
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, ${JSON.stringify(DESC)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
	await clickByRe("^(Opublikuj|Publish|Zapisz|Save)$");
	await sleep(2000);

	await cdp.send("Page.navigate", { url: `https://studio.youtube.com/channel/${channelId}/editing/profile` }, sessionId);
	await sleep(3500);
	await shot("branding");

	const setFile = async (idx, file) => {
		await evalR(`(() => {
      document.querySelectorAll("input[type=file]").forEach((i) => i.removeAttribute("data-ignite"));
      const el = document.querySelectorAll("input[type=file]")[${idx}];
      if (!el) throw new Error("no input");
      el.setAttribute("data-ignite", "1");
      return true;
    })()`);
		const doc = await cdp.send("DOM.getDocument", { depth: -1 }, sessionId);
		const { nodeId } = await cdp.send(
			"DOM.querySelector",
			{ nodeId: doc.root.nodeId, selector: 'input[type=file][data-ignite="1"]' },
			sessionId,
		);
		await cdp.send("DOM.setFileInputFiles", { nodeId, files: [file] }, sessionId);
		await sleep(2500);
		await clickByRe("^(Gotowe|Done)$");
		await sleep(1500);
		await clickByRe("^(Opublikuj|Publish)$");
		await sleep(1500);
		await clickByRe("^(Anuluj|Cancel)$");
	};

	const n = await evalR(`document.querySelectorAll("input[type=file]").length`);
	console.log("files", n);
	if (n > 0 && fs.existsSync(BANNER)) {
		await setFile(0, BANNER);
		console.log("banner ok");
	}
	if (n > 1 && fs.existsSync(AVATAR)) {
		await setFile(1, AVATAR);
		console.log("avatar ok");
	}
	await shot("final");

	const summary = {
		ok: true,
		channel: CHANNEL,
		channelId,
		studio: `https://studio.youtube.com/channel/${channelId}`,
		public: `https://www.youtube.com/channel/${channelId}`,
		at: new Date().toISOString(),
	};
	fs.writeFileSync(path.join(LOG, "summary.json"), JSON.stringify(summary, null, 2));
	console.log("Gotowe", summary);
	cdp.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
