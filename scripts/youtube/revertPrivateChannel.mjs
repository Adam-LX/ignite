#!/usr/bin/env node
/** Cofa branding Ignite na kanale Adam_eM (UCQhLorkB5Q1v0Bt5BhBMdJQ). */
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(__dirname, "../../docs/youtube/run-log");
const channelId = "UCQhLorkB5Q1v0Bt5BhBMdJQ";
const NAME = "Adam_eM";

fs.mkdirSync(LOG, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const created = await fetch(
	"http://127.0.0.1:9222/json/new?" +
		encodeURIComponent(`https://studio.youtube.com/channel/${channelId}/editing/details`),
	{ method: "PUT" },
).then((r) => r.json());
await sleep(4500);
const page = (await fetch("http://127.0.0.1:9222/json/list").then((r) => r.json())).find((t) => t.id === created.id);
if (!page?.webSocketDebuggerUrl) throw new Error("Brak karty Studio");

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
	const p = path.join(LOG, `${Date.now()}-revert-${n}.png`);
	fs.writeFileSync(p, Buffer.from(data, "base64"));
	console.log("shot", p);
};
const clickText = async (want) => {
	const t = await evalR(`(() => {
    const want = ${JSON.stringify(want)};
    for (const el of document.querySelectorAll("button, yt-button-shape, [role=button], a")) {
      const text = (el.innerText || "").replace(/\\s+/g, " ").trim();
      if (text === want || text.startsWith(want)) {
        (el.querySelector("button") || el).click();
        return text;
      }
    }
    return null;
  })()`);
	console.log("click", want, "->", t);
	return t;
};

await evalR(
	`document.querySelectorAll("[role=dialog] button").forEach(b => { if (/anuluj|zamknij|cancel|close/i.test(b.innerText||"")) b.click(); })`,
);
await sleep(800);
await shot("details");

// Nazwa → Adam_eM
const renamed = await evalR(`(() => {
  const inputs = [...document.querySelectorAll("input")].filter((i) =>
    (!i.type || i.type === "text") && i.offsetWidth > 80 &&
    !/search|szukaj|http|@/i.test([i.id, i.placeholder, i.value].join(" "))
  );
  const el = inputs[0];
  if (!el) return null;
  el.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(NAME)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return el.value;
})()`);
console.log("name", renamed);

// Wyczyść opis (Ignite)
const cleared = await evalR(`(() => {
  const boxes = [...document.querySelectorAll("textarea, #textbox, [contenteditable=true]")];
  const el = boxes.find((a) => /opis|description/i.test([a.getAttribute("aria-label"), a.id].join(" ")))
    || boxes.find((b) => (b.tagName === "TEXTAREA" && b.offsetHeight > 40))
    || boxes[0];
  if (!el) return false;
  el.focus();
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    Object.getOwnPropertyDescriptor(
      el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value",
    ).set.call(el, "");
  } else {
    el.textContent = "";
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`);
console.log("desc cleared", cleared);

await clickText("Opublikuj");
await sleep(3000);
await shot("after-publish");

// Branding — usuń banner/avatar jeśli da się
await psend("Page.navigate", { url: `https://studio.youtube.com/channel/${channelId}/editing/profile` });
await sleep(4000);
await evalR(
	`document.querySelectorAll("[role=dialog] button").forEach(b => { if (/anuluj|zamknij|cancel|close/i.test(b.innerText||"")) b.click(); })`,
);
await sleep(500);
await shot("branding");

// Usuń zdjęcie / banner — klikaj „Usuń” przy profilu i banerze
for (let i = 0; i < 4; i++) {
	const u = await clickText("Usuń");
	if (!u) break;
	await sleep(1000);
	await clickText("Usuń"); // potwierdzenie
	await sleep(800);
	await clickText("Opublikuj");
	await sleep(1500);
}
await clickText("Opublikuj");
await sleep(2000);
await shot("final");

const side = await evalR(`(document.body.innerText || "").match(/Twój kanał\\s*\\n\\s*([^\\n]+)/)?.[1] || null`);
const summary = {
	ok: true,
	revertedName: NAME,
	channelId,
	public: "https://www.youtube.com/@adam_em2820",
	sideName: side,
	note: "Nazwa/opis cofnięte. Avatar/banner: Usuń jeśli skrypt złapał; sprawdź wizualnie.",
	at: new Date().toISOString(),
};
fs.writeFileSync(path.join(LOG, "revert-summary.json"), JSON.stringify(summary, null, 2));
console.log("DONE", summary);
pws.close();
