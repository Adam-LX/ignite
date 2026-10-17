/**
 * Quick Chat wheel na tle klatki z gry → PNG.
 * Usage: node scripts/screenshot-quick-chat.mjs
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public/_preview");
const outFile = join(outDir, "quick-chat-wheel.png");
const htmlFile = join(outDir, "quick-chat-wheel.html");
const bgFile = join(outDir, "quick-chat-bg.jpg");
mkdirSync(outDir, { recursive: true });

const fontUrl = `file://${join(root, "src/assets/fonts/Orbitron-Variable.ttf")}`;
const cssUrl = `file://${join(root, "src/style.css")}`;
const bgUrl = `file://${bgFile}`;

const html = `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8" />
  <style>
    @font-face {
      font-family: "Orbitron";
      src: url("${fontUrl}") format("truetype");
      font-weight: 100 900;
      font-display: swap;
    }
  </style>
  <link rel="stylesheet" href="${cssUrl}" />
  <style>
    html, body {
      margin: 0;
      width: 1280px;
      height: 720px;
      overflow: hidden;
      background: #050a12 url("${bgUrl}") center / cover no-repeat;
    }
    .shot-hud {
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 5;
      font-family: Orbitron, system-ui, sans-serif;
      font-weight: 800;
      font-size: 13px;
      letter-spacing: 0.14em;
      color: rgba(255,255,255,0.85);
      padding: 0.45rem 1.4rem 0.7rem;
      background: linear-gradient(180deg, rgba(2,6,16,0.88), rgba(6,12,26,0.72));
      border: 1px solid rgba(255,255,255,0.18);
      border-top: none;
      clip-path: polygon(12px 0, calc(100% - 12px) 0, 100% 70%, 50% 100%, 0 70%);
    }
    .shot-cam {
      position: fixed;
      top: 18px;
      left: 22px;
      z-index: 5;
      font-family: Orbitron, system-ui, sans-serif;
      font-weight: 800;
      font-size: 11px;
      letter-spacing: 0.12em;
      color: #3dffe8;
      padding: 0.35rem 0.7rem;
      background: rgba(6,10,22,0.72);
      border: 1px solid rgba(61,255,232,0.35);
      clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
    }
  </style>
</head>
<body>
  <div class="shot-cam">BALL CAM</div>
  <div class="shot-hud">BLUE 0 &nbsp;|&nbsp; 3:54 &nbsp;|&nbsp; ORANGE 0</div>
  <script type="module">
    const CHAT = [
      ["great_pass", "PASS", "Great pass!"],
      ["nice_shot", "SHOT", "Nice shot!"],
      ["defending", "DEF", "Defending!"],
      ["oops", "OOPS", "Oops…"],
      ["close", "CLOSE", "So close!"],
      ["calculated", "CALC", "Calculated."],
      ["wow", "WOW", "WOW!"],
      ["gg", "GG", "GG"],
    ];
    const N = CHAT.length;
    const LABEL_R = 96;

    function wedgePath(i, innerR, outerR, gapDeg = 2.8) {
      const slice = 360 / N;
      const start = -90 + i * slice + gapDeg * 0.5;
      const end = -90 + (i + 1) * slice - gapDeg * 0.5;
      const toRad = (d) => (d * Math.PI) / 180;
      const x0 = Math.cos(toRad(start));
      const y0 = Math.sin(toRad(start));
      const x1 = Math.cos(toRad(end));
      const y1 = Math.sin(toRad(end));
      const large = end - start > 180 ? 1 : 0;
      return [
        \`M \${x0 * innerR} \${y0 * innerR}\`,
        \`L \${x0 * outerR} \${y0 * outerR}\`,
        \`A \${outerR} \${outerR} 0 \${large} 1 \${x1 * outerR} \${y1 * outerR}\`,
        \`L \${x1 * innerR} \${y1 * innerR}\`,
        \`A \${innerR} \${innerR} 0 \${large} 0 \${x0 * innerR} \${y0 * innerR}\`,
        "Z",
      ].join(" ");
    }

    const root = document.createElement("div");
    root.id = "quick-chat-root";
    root.className = "quick-chat-root--open";

    const wheel = document.createElement("div");
    wheel.id = "quick-chat-wheel";
    wheel.className = "has-hover";

    const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    ring.classList.add("quick-chat-wheel__ring");
    ring.setAttribute("viewBox", "-120 -120 240 240");
    const glow = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    glow.setAttribute("class", "quick-chat-wheel__glow");
    glow.setAttribute("r", "110");
    ring.appendChild(glow);
    const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    track.setAttribute("class", "quick-chat-wheel__track");
    track.setAttribute("r", "84");
    ring.appendChild(track);

    for (let i = 0; i < N; i++) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", "quick-chat-wheel__wedge" + (i === 1 ? " is-hot" : ""));
      path.setAttribute("d", wedgePath(i, 40, 102));
      ring.appendChild(path);
    }
    wheel.appendChild(ring);

    for (let i = 0; i < N; i++) {
      const [id, shortTxt, fullTxt] = CHAT[i];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quick-chat-wheel__item" + (i === 1 ? " hover" : "");
      const short = document.createElement("span");
      short.className = "quick-chat-wheel__short";
      short.textContent = shortTxt;
      const full = document.createElement("span");
      full.className = "quick-chat-wheel__full";
      full.textContent = fullTxt;
      btn.append(short, full);
      const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
      btn.style.setProperty("--qx", \`\${Math.cos(angle) * LABEL_R}px\`);
      btn.style.setProperty("--qy", \`\${Math.sin(angle) * LABEL_R}px\`);
      wheel.appendChild(btn);
    }

    const hub = document.createElement("div");
    hub.className = "quick-chat-wheel__hub";
    hub.innerHTML = \`
      <span class="quick-chat-wheel__hub-key">T</span>
      <span class="quick-chat-wheel__hub-preview">Nice shot!</span>
      <span class="quick-chat-wheel__hub-hint">RELEASE</span>
    \`;
    wheel.appendChild(hub);
    root.appendChild(wheel);
    document.body.appendChild(root);
    document.documentElement.dataset.ready = "1";
  </script>
</body>
</html>`;

writeFileSync(htmlFile, html, "utf8");

const browser = await chromium.launch({
	headless: true,
	executablePath: "/run/current-system/sw/bin/chromium",
	args: ["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files"],
});
const page = await browser.newPage({
	viewport: { width: 1280, height: 720 },
	deviceScaleFactor: 2,
});
await page.goto(`file://${htmlFile}`, { waitUntil: "load" });
await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
await page.waitForTimeout(400);
await page.screenshot({ path: outFile, type: "png" });
await browser.close();

const picturesDir = join(process.env.HOME ?? "/home/adam", "Obrazy/Ignite");
mkdirSync(picturesDir, { recursive: true });
const pictures = join(picturesDir, "quick-chat-wheel.png");
copyFileSync(outFile, pictures);
console.log(`Wrote ${outFile}`);
console.log(`Copied ${pictures}`);
