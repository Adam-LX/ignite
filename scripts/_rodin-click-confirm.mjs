import { chromium } from "playwright";
import fs from "fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = `${process.env.HOME}/Pobrane/goalFrame-rodin.glb`;
const MAT =
	"Dark brushed metal PBR, cyan neon emissive strips, clean game-ready, no ground, watertight tubes";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const page =
	browser.contexts()[0].pages().find((p) => p.url().includes("rodin")) ||
	browser.contexts()[0].pages()[0];

async function dump(n) {
	await page.screenshot({ path: `/tmp/hyper3d-pw-shots/${n}.png` });
	fs.writeFileSync(
		`/tmp/hyper3d-pw-shots/${n}.txt`,
		(await page.locator("body").innerText()).slice(0, 10000),
	);
	console.log("shot", n);
}

await sleep(1000);
await page.evaluate(() => {
	[...document.querySelectorAll("button")]
		.find((b) => (b.innerText || "").trim() === "Cancel")
		?.click();
});
await sleep(400);

// Click the REAL purple Confirm = parent of span "Confirm" that has sibling "0.5 Credits"
const geo = await page.evaluate(() => {
	const spans = [...document.querySelectorAll("span")];
	const credit = spans.find(
		(s) => (s.innerText || "").replace(/\s+/g, " ").trim() === "0.5 Credits",
	);
	if (!credit) return { ok: false, reason: "no 0.5 Credits span" };
	// Walk up to clickable parent
	let el = credit.parentElement;
	for (let i = 0; i < 6 && el; i++) {
		const r = el.getBoundingClientRect();
		const t = (el.innerText || "").replace(/\s+/g, " ");
		if (r.width > 90 && r.height > 28 && /Confirm/i.test(t)) {
			el.click();
			return {
				ok: true,
				tag: el.tagName,
				cls: (el.className || "").toString().slice(0, 100),
				w: r.width,
				h: r.height,
				t: t.slice(0, 40),
			};
		}
		el = el.parentElement;
	}
	// fallback: click credit's parent
	credit.parentElement?.click();
	return { ok: true, via: "parent-fallback" };
});
console.log("GEO CONFIRM", geo);
await sleep(10000);
await dump("40-after-geo");

const matState = await page.evaluate(() => {
	const ta = document.querySelector('textarea[placeholder*="materials" i]');
	return ta ? { disabled: ta.disabled } : { missing: true };
});
console.log("matState", matState);

// Wait unlock
for (let i = 0; i < 30; i++) {
	const st = await page.evaluate(() => {
		const ta = document.querySelector('textarea[placeholder*="materials" i]');
		return { disabled: ta?.disabled ?? null };
	});
	console.log("wait", i, st);
	if (st.disabled === false) break;
	await sleep(2000);
}
await dump("41-mat");

// Fill + confirm material
await page.evaluate((prompt) => {
	const ta = document.querySelector('textarea[placeholder*="materials" i]');
	if (!ta) return;
	ta.focus();
	const setter = Object.getOwnPropertyDescriptor(
		HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	setter?.call(ta, prompt);
	ta.dispatchEvent(new Event("input", { bubbles: true }));
	ta.dispatchEvent(new Event("change", { bubbles: true }));
}, MAT);

await sleep(500);

// Material Confirm — look for another 0.5 Credits near Material section, or Confirm in material card
const matConf = await page.evaluate(() => {
	const cards = [...document.querySelectorAll("div")].filter((d) =>
		(d.className || "").toString().includes("rodin-card-material"),
	);
	for (const card of cards) {
		const credit = [...card.querySelectorAll("span")].find(
			(s) => (s.innerText || "").trim() === "0.5 Credits",
		);
		if (credit) {
			let el = credit.parentElement;
			for (let i = 0; i < 6 && el; i++) {
				const r = el.getBoundingClientRect();
				if (r.width > 90 && r.height > 28) {
					el.click();
					return { ok: true, via: "material-card" };
				}
				el = el.parentElement;
			}
		}
	}
	// any remaining Confirm with 0.5
	const credits = [...document.querySelectorAll("span")].filter(
		(s) => (s.innerText || "").trim() === "0.5 Credits",
	);
	for (const c of credits) {
		let el = c.parentElement;
		for (let i = 0; i < 5 && el; i++) {
			const r = el.getBoundingClientRect();
			if (r.width > 90 && r.height > 28 && r.top > 200) {
				el.click();
				return { ok: true, via: "lower-credit", top: r.top };
			}
			el = el.parentElement;
		}
	}
	return { ok: false };
});
console.log("MAT CONFIRM", matConf);

for (let i = 0; i < 40; i++) {
	const ready = await page.evaluate(() => {
		const t = document.body.innerText;
		return !/Pack[\s\S]{0,60}Locked/i.test(t);
	});
	console.log("pack", i, ready);
	if (ready) break;
	await sleep(3000);
}
await dump("42-pack");

// Select glb + try download
await page.evaluate(() => {
	[...document.querySelectorAll("div,button,span")].forEach((el) => {
		if ((el.innerText || "").trim() === ".glb") el.click();
	});
});

const dlWait = page.waitForEvent("download", { timeout: 60000 }).catch(() => null);
await page.evaluate(() => {
	const els = [...document.querySelectorAll("button,a,div,span")];
	for (const el of els) {
		const t = (el.innerText || el.getAttribute("aria-label") || "").toLowerCase();
		if (t === "download" || t.includes("download")) {
			el.click();
			return;
		}
	}
});
const dl = await dlWait;
if (dl) {
	await dl.saveAs(OUT);
	console.log("SAVED", OUT, fs.statSync(OUT).size);
} else {
	console.log("no download event");
	await dump("43-fail");
}
process.exit(0);
