import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://127.0.0.1:4175/";
const CHROMIUM = process.env.CHROMIUM ?? "/run/current-system/sw/bin/chromium";

const logs = [];
const errors = [];

const browser = await puppeteer.launch({
	executablePath: CHROMIUM,
	headless: true,
	args: ["--no-sandbox", "--disable-gpu", "--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage();
page.on("console", (msg) => {
	const line = `[${msg.type()}] ${msg.text()}`;
	logs.push(line);
});
page.on("pageerror", (err) => errors.push(String(err)));

try {
	await page.goto(URL, { waitUntil: "networkidle0", timeout: 120_000 });
	await page.waitForTimeout(8000);
} catch (err) {
	errors.push(`goto: ${err}`);
}

await browser.close();

console.log("=== FlyBall console (grass diagnostics) ===");
for (const line of logs.filter((l) => l.includes("FlyBall"))) {
	console.log(line);
}
if (errors.length) {
	console.log("=== PAGE ERRORS ===");
	for (const e of errors) console.log(e);
}
