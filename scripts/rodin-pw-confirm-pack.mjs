#!/usr/bin/env node
/**
 * Hyper3D Rodin — precise DOM clicks via page.evaluate
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.OUT || `${process.env.HOME}/Pobrane/goalFrame-rodin.glb`;
const MATERIAL_PROMPT =
	"Dark brushed metal PBR, cyan neon emissive edge strips, clean game-ready, no ground plane, watertight tubes";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dump(page, name) {
	const dir = "/tmp/hyper3d-pw-shots";
	fs.mkdirSync(dir, { recursive: true });
	await page.screenshot({ path: `${dir}/${name}.png` }).catch(() => {});
	fs.writeFileSync(
		`${dir}/${name}.txt`,
		(await page.locator("body").innerText().catch(() => "")).slice(0, 12000),
	);
	console.log("shot", name);
}

/** Click first button whose normalized text matches. */
async function clickByText(page, re, label) {
	const result = await page.evaluate((pattern) => {
		const rx = new RegExp(pattern, "i");
		const buttons = [...document.querySelectorAll("button, [role=button], a")];
		for (const b of buttons) {
			const t = (b.innerText || b.textContent || "").replace(/\s+/g, " ").trim();
			if (!rx.test(t)) continue;
			const r = b.getBoundingClientRect();
			if (r.width < 2 || r.height < 2) continue;
			b.click();
			return { ok: true, text: t.slice(0, 80), w: r.width, h: r.height };
		}
		return {
			ok: false,
			all: buttons
				.map((b) => (b.innerText || "").replace(/\s+/g, " ").trim())
				.filter((t) => /confirm|download|pack|cancel|subscribe|glb/i.test(t))
				.slice(0, 40),
		};
	}, re.source || re);
	console.log(label, result);
	return result.ok;
}

async function unlockMaterial(page) {
	const t = await page.locator("body").innerText();
	return !/Material\s*\n\s*Locked/i.test(t) && !/Material[\s\S]{0,40}Locked/i.test(t);
}

async function main() {
	const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
	const page =
		browser.contexts()[0].pages().find((p) => /rodin/.test(p.url())) ||
		browser.contexts()[0].pages()[0];
	console.log("url", page.url());
	await dump(page, "20-start");

	// Close overlays
	await clickByText(page, "^Cancel$", "cancel");
	await page.keyboard.press("Escape");
	await sleep(400);
	await clickByText(page, "^Cancel$", "cancel2");
	await sleep(300);

	// Prefer Triangular for detail (optional)
	await clickByText(page, "^Triangular$", "triangular");
	await sleep(300);

	// Geometry Confirm — exact "Confirm" preferably with credits nearby via evaluate
	const geo = await page.evaluate(() => {
		const buttons = [...document.querySelectorAll("button")];
		// Prefer Confirm that sits near "Bang to Parts" / "Redo"
		const bang = buttons.find((b) => /Bang to Parts/i.test(b.innerText || ""));
		if (bang) {
			const parent = bang.closest("div")?.parentElement || bang.parentElement;
			const conf = [...(parent?.querySelectorAll("button") || [])].find((b) =>
				/^Confirm/i.test((b.innerText || "").trim()),
			);
			if (conf) {
				conf.click();
				return { ok: true, via: "near-bang", text: conf.innerText };
			}
		}
		// Fallback: last visible Confirm that is NOT in bounding box footer
		const confs = buttons.filter((b) => {
			const t = (b.innerText || "").replace(/\s+/g, " ").trim();
			if (!/^Confirm(\s|\n|$)/i.test(t) && t !== "Confirm") return false;
			const r = b.getBoundingClientRect();
			return r.width > 40 && r.height > 20 && r.top < window.innerHeight * 0.75;
		});
		if (confs.length) {
			const c = confs[0];
			c.click();
			return { ok: true, via: "first-upper", text: c.innerText, n: confs.length };
		}
		return {
			ok: false,
			btns: buttons.map((b) => (b.innerText || "").slice(0, 40)).filter(Boolean).slice(0, 50),
		};
	});
	console.log("geo confirm", geo);
	await sleep(5000);
	await dump(page, "21-after-geo");

	// Poll material unlock — Confirm may show a progress toast
	for (let i = 0; i < 50; i++) {
		await clickByText(page, "^Cancel$", "cancel-loop");
		const unlocked = await page.evaluate(() => {
			const ta = document.querySelector(
				'textarea[placeholder*="materials" i], textarea[placeholder*="Material" i]',
			);
			return ta && !ta.disabled;
		});
		console.log(`wait mat ${i} unlocked=${unlocked}`);
		if (unlocked) break;
		// Maybe need second Confirm for triangular dialog
		if (i === 2) {
			await page.evaluate(() => {
				const confs = [...document.querySelectorAll("button")].filter((b) =>
					/^Confirm/i.test((b.innerText || "").trim()),
				);
				confs[0]?.click();
			});
		}
		await sleep(2000);
	}
	await dump(page, "22-material");

	// Enable + fill material (remove disabled via force if needed — better wait)
	const filled = await page.evaluate((prompt) => {
		const ta = document.querySelector(
			'textarea[placeholder*="materials" i], textarea[placeholder*="Material" i]',
		);
		if (!ta) return { ok: false, reason: "no textarea" };
		if (ta.disabled) {
			ta.disabled = false;
			ta.classList.remove("rodin-card-material-textarea-inactive");
		}
		ta.focus();
		ta.value = prompt;
		ta.dispatchEvent(new Event("input", { bubbles: true }));
		ta.dispatchEvent(new Event("change", { bubbles: true }));
		return { ok: true, disabled: ta.disabled, len: ta.value.length };
	}, MATERIAL_PROMPT);
	console.log("fill mat", filled);

	await sleep(500);
	// Material Confirm — usually becomes available after geo unlock
	const matConf = await page.evaluate(() => {
		const buttons = [...document.querySelectorAll("button")];
		const matSection = [...document.querySelectorAll("div")].find((d) =>
			/^Material$/i.test((d.innerText || "").split("\n")[0] || ""),
		);
		// Find Confirm that is NOT the geometry one (geometry already confirmed → may say differently)
		const confs = buttons.filter((b) => {
			const t = (b.innerText || "").replace(/\s+/g, " ").trim();
			return /^Confirm/i.test(t);
		});
		// Click the Confirm in lower half (material)
		const lower = confs.filter((b) => b.getBoundingClientRect().top > 300);
		const target = lower[0] || confs[confs.length - 1];
		if (!target) return { ok: false, n: confs.length };
		target.click();
		return { ok: true, text: target.innerText, top: target.getBoundingClientRect().top };
	});
	console.log("mat confirm", matConf);

	for (let i = 0; i < 60; i++) {
		const packReady = await page.evaluate(() => {
			const t = document.body.innerText;
			const locked = /Pack[\s\S]{0,80}Locked/i.test(t);
			const glb = /\.glb/i.test(t);
			return !locked && glb;
		});
		console.log(`pack ${i} ready=${packReady}`);
		if (packReady) break;
		await sleep(2500);
		if (i % 5 === 0) await dump(page, `pack-${i}`);
	}
	await dump(page, "23-pack");

	await clickByText(page, "^\\.glb$", "glb");
	await clickByText(page, "^PBR$", "pbr");

	const dlWait = page.waitForEvent("download", { timeout: 90000 }).catch(() => null);
	await clickByText(page, "Download", "download");
	await clickByText(page, "^Pack$", "pack-btn");

	// Also try clicking any button with download icon near Pack
	await page.evaluate(() => {
		const btns = [...document.querySelectorAll("button, a")];
		for (const b of btns) {
			const t = (b.innerText || b.getAttribute("aria-label") || "").toLowerCase();
			if (t.includes("download") || t.includes("export")) b.click();
		}
	});

	const download = await dlWait;
	if (download) {
		fs.mkdirSync(path.dirname(OUT), { recursive: true });
		await download.saveAs(OUT);
		console.log("SAVED", OUT, fs.statSync(OUT).size);
		return;
	}

	// Capture network glb URLs from performance
	const urls = await page.evaluate(() =>
		performance
			.getEntriesByType("resource")
			.map((e) => e.name)
			.filter((u) => /\.glb(\?|$)/i.test(u)),
	);
	console.log("perf glbs", urls);
	for (const u of urls.slice(-5)) {
		try {
			const res = await page.request.get(u);
			const buf = Buffer.from(await res.body());
			if (buf.length > 200000) {
				fs.mkdirSync(path.dirname(OUT), { recursive: true });
				fs.writeFileSync(OUT, buf);
				console.log("SAVED perf", OUT, buf.length);
				return;
			}
		} catch {}
	}

	await dump(page, "24-fail");
	console.error("FAIL");
	process.exit(2);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
