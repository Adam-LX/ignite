import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const page = browser.contexts()[0].pages().find((p) => p.url().includes("rodin"));

await page.evaluate(() =>
	[...document.querySelectorAll("button")]
		.find((b) => b.innerText.trim() === "Cancel")
		?.click(),
);
await new Promise((r) => setTimeout(r, 500));

const box = await page.evaluate(() => {
	const spans = [...document.querySelectorAll("span")];
	const conf = spans.find(
		(s) =>
			s.innerText.trim() === "Confirm" &&
			String(s.className).includes("absolute-center"),
	);
	const credit = spans.find((s) => s.innerText.trim() === "0.5 Credits");
	const cr = credit?.getBoundingClientRect();
	const sr = conf?.getBoundingClientRect();
	let el = credit?.parentElement;
	const parents = [];
	for (let i = 0; i < 8 && el; i++) {
		const r = el.getBoundingClientRect();
		parents.push({
			i,
			tag: el.tagName,
			w: Math.round(r.width),
			h: Math.round(r.height),
			top: Math.round(r.top),
			left: Math.round(r.left),
			cls: String(el.className).slice(0, 80),
		});
		el = el.parentElement;
	}
	return {
		conf: sr && {
			top: sr.top,
			left: sr.left,
			w: sr.width,
			h: sr.height,
		},
		credit: cr && {
			top: cr.top,
			left: cr.left,
			w: cr.width,
			h: cr.height,
		},
		parents,
	};
});
console.log(JSON.stringify(box, null, 2));

const target = box.parents.find(
	(p) => p.w >= 100 && p.w <= 220 && p.h >= 30 && p.h <= 55,
);
console.log("target", target);

if (target) {
	const x = target.left + target.w / 2;
	const y = target.top + target.h / 2;
	await page.mouse.click(x, y);
	console.log("clicked", x, y);
} else if (box.conf) {
	await page.mouse.click(box.conf.left + 50, box.conf.top + box.conf.h / 2 + 8);
	console.log("clicked near conf");
} else {
	console.log("NO TARGET");
}

await new Promise((r) => setTimeout(r, 10000));
const ta = await page.evaluate(() => {
	const t = document.querySelector('textarea[placeholder*="materials" i]');
	return {
		disabled: t?.disabled,
		unlocked: !/Material[\s\S]{0,30}Locked/.test(document.body.innerText),
		nsfw: /NSFW/i.test(document.body.innerText),
	};
});
console.log("after", ta);
await page.screenshot({ path: "/tmp/hyper3d-pw-shots/50-mouse-confirm.png" });
process.exit(0);
