import { chromium } from "playwright";
import fs from "fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const page =
	browser.contexts()[0].pages().find((p) => p.url().includes("hyper3d")) ||
	browser.contexts()[0].pages()[0];

const WS =
	"https://hyper3d.ai/workspace/rodin/c90f1d81-46e0-4a6c-9a82-a50ff6dc147f";
console.log("reload", WS);
await page.goto(WS, { waitUntil: "domcontentloaded", timeout: 90000 });
await sleep(7000);
fs.mkdirSync("/tmp/hyper3d-pw-shots", { recursive: true });
await page.screenshot({ path: "/tmp/hyper3d-pw-shots/30-reloaded.png" });
const text = await page.locator("body").innerText();
fs.writeFileSync("/tmp/hyper3d-pw-shots/30-reloaded.txt", text.slice(0, 10000));
console.log("has Confirm", /Confirm/i.test(text));
console.log("has Bang", /Bang to Parts/i.test(text));
console.log("has SubscribeFirst", /Subscribe First/i.test(text));

const info = await page.evaluate(() =>
	[...document.querySelectorAll("button")]
		.map((b) => ({
			t: (b.innerText || "").replace(/\s+/g, " ").trim().slice(0, 70),
			dis: b.disabled,
			top: Math.round(b.getBoundingClientRect().top),
			w: Math.round(b.getBoundingClientRect().width),
		}))
		.filter((x) => x.t && x.w > 20)
		.slice(0, 50),
);
console.log(JSON.stringify(info, null, 2));
process.exit(0);
