import { chromium } from "playwright";
import fs from "fs";

const OUT = `${process.env.HOME}/Pobrane/goalFrame-rodin.glb`;
const MAT =
	"Dark brushed metal PBR, cyan neon emissive strips, clean game-ready, no ground";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const page = browser.contexts()[0].pages().find((p) => p.url().includes("rodin"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dump(n) {
	await page.screenshot({ path: `/tmp/hyper3d-pw-shots/${n}.png` });
	fs.writeFileSync(
		`/tmp/hyper3d-pw-shots/${n}.txt`,
		(await page.locator("body").innerText()).slice(0, 8000),
	);
	console.log("shot", n);
}

// Cancel NSFW modal
await page.evaluate(() =>
	[...document.querySelectorAll("button")]
		.find((b) => b.innerText.trim() === "Cancel")
		?.click(),
);
await sleep(600);

// Click rodin-geometry-confirm-action
const clicked = await page.evaluate(() => {
	const el = document.querySelector(
		".rodin-geometry-confirm-action, [class*=geometry_confirm], [class*=confirmBtn]",
	);
	if (!el) {
		return {
			ok: false,
			found: [...document.querySelectorAll("[class*=confirm]")].map((e) =>
				String(e.className).slice(0, 80),
			),
		};
	}
	const r = el.getBoundingClientRect();
	el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
	el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
	el.click();
	el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
	el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
	return { ok: true, w: r.width, h: r.height, top: r.top, left: r.left, cls: String(el.className).slice(0, 100) };
});
console.log("confirm action", clicked);

if (clicked.ok) {
	await page.mouse.click(clicked.left + clicked.w / 2, clicked.top + clicked.h / 2);
	console.log("mouse also");
}

await sleep(12000);
await dump("60-after-confirm-action");

const st = await page.evaluate(() => {
	const ta = document.querySelector('textarea[placeholder*="materials" i]');
	return {
		disabled: ta?.disabled,
		nsfw: /NSFW/i.test(document.body.innerText),
		locked: /Material[\s\S]{0,40}Locked/i.test(document.body.innerText),
		textHasConfirm: /Confirm/i.test(document.body.innerText),
	};
});
console.log("state", st);

if (st.disabled === false) {
	await page.evaluate((prompt) => {
		const ta = document.querySelector('textarea[placeholder*="materials" i]');
		const setter = Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set;
		setter?.call(ta, prompt);
		ta.dispatchEvent(new Event("input", { bubbles: true }));
	}, MAT);
	await sleep(400);
	// material confirm button
	const mat = await page.evaluate(() => {
		const el = document.querySelector(
			"[class*=material][class*=confirm], [class*=rodin-card-material] [class*=confirm]",
		);
		if (el) {
			el.click();
			return { ok: true, cls: String(el.className).slice(0, 80) };
		}
		// second confirm-action
		const all = [...document.querySelectorAll("[class*=confirm-action], [class*=confirmBtn]")];
		const second = all[1] || all[0];
		second?.click();
		return { ok: !!second, n: all.length };
	});
	console.log("mat", mat);
	await sleep(15000);
	await dump("61-after-mat");
}

process.exit(0);
