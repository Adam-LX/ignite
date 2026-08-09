#!/usr/bin/env node
/**
 * Otwiera rejestrację Google pod kanał gry i wypełnia formularz.
 * Telefon / SMS / CAPTCHA — musi dokończyć użytkownik.
 */
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.join(__dirname, "../../docs/youtube");
const LOG = path.join(KIT, "run-log");
const OUT = path.join(KIT, "GOOGLE-ACCOUNT.local.md");
const CDP = `http://127.0.0.1:${process.env.YT_CDP_PORT || "9222"}`;

const FIRST = "Ignite";
const LAST = "Game";
const USERNAMES = [
	"ignite.game.yt",
	"play.ignite.game",
	"ignitearcade.yt",
	"ignite.carsoccer",
	"flyball.ignite",
];
const PASSWORD = crypto.randomBytes(14).toString("base64url") + "Aa1!";

fs.mkdirSync(LOG, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ver = await fetch(`${CDP}/json/version`).then((r) => {
	if (!r.ok) throw new Error("CDP down — bash scripts/youtube/open-vivaldi-cdp.sh --restart");
	return r.json();
});

const created = await fetch(
	`${CDP}/json/new?` +
		encodeURIComponent(
			"https://accounts.google.com/signup/v2/webcreateaccount?flowName=GlifWebSignIn&flowEntry=SignUp&hl=pl",
		),
	{ method: "PUT" },
).then((r) => r.json());
await sleep(5000);
const page = (await fetch(`${CDP}/json/list`).then((r) => r.json())).find((t) => t.id === created.id);
if (!page?.webSocketDebuggerUrl) throw new Error("Brak karty signup");

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
	const p = path.join(LOG, `${Date.now()}-signup-${n}.png`);
	fs.writeFileSync(p, Buffer.from(data, "base64"));
	console.log("shot", p);
};
const setInput = async (selectors, value) =>
	evalR(`(() => {
    const sels = ${JSON.stringify(selectors)};
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      el.focus();
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return sel;
    }
    return null;
  })()`);
const clickText = async (want) =>
	evalR(`(() => {
    const want = ${JSON.stringify(want)};
    for (const el of document.querySelectorAll("button, div[role=button], span")) {
      const t = (el.innerText || "").replace(/\\s+/g, " ").trim();
      if (t === want || t.startsWith(want)) {
        const btn = el.closest("button, div[role=button]") || el;
        btn.click();
        return t;
      }
    }
    return null;
  })()`);

await shot("start");
console.log("url", await evalR("location.href"));

await setInput(['input[name="firstName"]', "#firstName", 'input[autocomplete="given-name"]'], FIRST);
await setInput(['input[name="lastName"]', "#lastName", 'input[autocomplete="family-name"]'], LAST);

let chosenUser = null;
for (const u of USERNAMES) {
	const ok = await setInput(
		['input[name="Username"]', "#username", 'input[type="email"]', 'input[autocomplete="username"]'],
		u,
	);
	console.log("username field", ok, u);
	await sleep(800);
	// blur to trigger availability check
	await evalR(`document.activeElement && document.activeElement.blur()`);
	await sleep(1200);
	const err = await evalR(`(document.body.innerText || "").match(/zajęta|taken|niedostępna|already|unavailable|That username/i)?.[0] || null`);
	console.log("avail?", u, err || "OK?");
	if (!err) {
		chosenUser = u;
		break;
	}
}
if (!chosenUser) chosenUser = USERNAMES[0];

await setInput(['input[name="Passwd"]', 'input[type="password"]', "#passwd"], PASSWORD);
await sleep(300);
// confirm is often 2nd password
await evalR(`(() => {
  const pwds = [...document.querySelectorAll('input[type="password"]')];
  const el = pwds[1] || pwds[0];
  if (!el) return null;
  el.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(PASSWORD)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return pwds.length;
})()`);

await shot("filled");
const next = (await clickText("Dalej")) || (await clickText("Next"));
console.log("next", next);
await sleep(4000);
await shot("after-next");

const state = await evalR(`({
  href: location.href,
  text: (document.body.innerText || "").slice(0, 1200),
  phone: /telefon|phone|SMS|numer/i.test(document.body.innerText || ""),
  captcha: /captcha|nie jestem robotem|recaptcha/i.test(document.body.innerText || "")
})`);
console.log("state", { href: state.href, phone: state.phone, captcha: state.captcha });
console.log(state.text.slice(0, 500));

const email = `${chosenUser}@gmail.com`;
const md = `# Konto Google — kanał Ignite (LOKALNE — nie commitować)

| Pole | Wartość |
|------|---------|
| Imię / nazwisko | ${FIRST} ${LAST} |
| Email | **${email}** |
| Hasło | \`${PASSWORD}\` |
| Utworzone | ${new Date().toISOString()} |

## Status rejestracji
- Formularz wypełniony automatycznie w Vivaldi.
- **Dokończ w przeglądarce:** telefon / SMS / CAPTCHA (jeśli wyskoczy).
- Potem: YouTube → utwórz kanał **Ignite Game**.

## Po założeniu
Napisz agentowi „konto gotowe” — ustawi kanał + branding z \`docs/youtube/assets/\`.
`;
fs.writeFileSync(OUT, md);
console.log("credentials ->", OUT);
console.log("EMAIL", email);
pws.close();
