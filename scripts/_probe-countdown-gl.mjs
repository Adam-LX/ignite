#!/usr/bin/env node
/**
 * Menu→1v1 countdown: force clear / direct / post render and sample car cx.
 */
import WebSocket from "ws";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { setTimeout as sleep } from "timers/promises";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-results", "chase-camera", "electron-menu");
mkdirSync(OUT, { recursive: true });
const LOG = "/tmp/ignite-electron-cdp.log";
writeFileSync(LOG, "");

const env = {
	...process.env,
	IGNITE_DEV: "1",
	IGNITE_WINDOWED: "1",
	IGNITE_VITE_URL: `http://127.0.0.1:5173/?skipIntro=1&ignite=${Date.now()}`,
	PATH: `/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:${process.env.PATH}`,
};

const child = spawn(
	"nix",
	[
		"shell",
		"nixpkgs#electron",
		"-c",
		"electron",
		".",
		"--no-sandbox",
		"--class=Ignite",
		"--remote-debugging-port=9333",
	],
	{ cwd: ROOT, env, stdio: ["ignore", "append", "append"] },
);
const logFd = await import("fs").then((fs) =>
	fs.openSync(LOG, "a"),
);
child.stdout?.destroy?.();
// reopen with append via spawn stdio file — simpler:
child.unref?.();

const kill = () => {
	try {
		process.kill(child.pid, "SIGTERM");
	} catch {
		/* */
	}
};
process.on("exit", kill);
process.on("SIGINT", () => {
	kill();
	process.exit(130);
});

for (let i = 0; i < 80; i++) {
	try {
		const tabs = await fetch("http://127.0.0.1:9333/json/list").then((r) =>
			r.json(),
		);
		if (tabs.some((t) => t.webSocketDebuggerUrl)) break;
	} catch {
		/* */
	}
	await sleep(400);
}

const tabs = await fetch("http://127.0.0.1:9333/json/list").then((r) => r.json());
const page = tabs.find((t) => t.type === "page" && /5173/.test(t.url));
if (!page) {
	console.error("no page");
	kill();
	process.exit(2);
}

const pws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
	pws.once("open", res);
	pws.once("error", rej);
});
let id = 0;
const pend = new Map();
pws.on("message", (raw) => {
	const m = JSON.parse(raw.toString());
	if (m.id && pend.has(m.id)) {
		const { resolve, reject, t } = pend.get(m.id);
		clearTimeout(t);
		pend.delete(m.id);
		m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
	}
});
const send = (method, params = {}, timeout = 90000) =>
	new Promise((resolve, reject) => {
		const i = ++id;
		const t = setTimeout(() => {
			pend.delete(i);
			reject(new Error(method + " timeout"));
		}, timeout);
		pend.set(i, { resolve, reject, t });
		pws.send(JSON.stringify({ id: i, method, params }));
	});
await send("Runtime.enable");
const evalR = async (ex, timeout = 90000) => {
	const r = await send(
		"Runtime.evaluate",
		{ expression: ex, returnByValue: true, awaitPromise: true },
		timeout,
	);
	if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
	return r.result?.value;
};

for (let i = 0; i < 40; i++) {
	const ok = await evalR(
		`!!window.__igniteLiveMenu || document.body.classList.contains("menu-active")`,
	);
	if (ok) break;
	await sleep(250);
}

await evalR(
	`try{localStorage.setItem("ignite.tutorial.done","1");}catch{}`,
);
await evalR(`(()=>{
  document.querySelector('.mode-card[data-mode="1v1"]')?.click();
  document.querySelector("#main-menu-start")?.click();
})()`);

for (let i = 0; i < 120; i++) {
	const t = await evalR(
		`window.__igniteSession?.match?.getHudSnapshot?.(window.__igniteSession.cars)?.kickoffTick??null`,
	);
	if (t != null) break;
	await sleep(80);
}

const result = await evalR(`(()=>{
  const s=window.__igniteSession, r=window.__igniteRenderer, sc=window.__igniteScene;
  const cam=r.threeJSCamera;
  const car=s.humanCar.player.getPosition();
  const ball=new cam.position.constructor(0,0.5,0);
  r.snapChaseCamera(s.humanCar.player, ball, {kickoff:true, matchBlend:0});
  cam.updateMatrixWorld(true);
  const ndc=car.clone().project(cam);
  const gl=r.threeJSRenderer.domElement;
  const present=document.querySelector('canvas.webgl-present-canvas');
  const ctx=present.getContext('2d');

  function sample(c){
    const t=document.createElement('canvas');
    const tw=640, th=Math.max(1,Math.round(640*c.height/c.width));
    t.width=tw;t.height=th;
    const x=t.getContext('2d'); x.drawImage(c,0,0,c.width,c.height,0,0,tw,th);
    const img=x.getImageData(0,0,tw,th).data;
    let sx=0,sy=0,n=0, magenta=0;
    for(let y=30;y<th-20;y+=2) for(let xx=8;xx<tw-8;xx+=2){
      const i=(y*tw+xx)*4; const R=img[i],G=img[i+1],B=img[i+2];
      if(R>200&&B>200&&G<120) magenta++;
      if(G>R+18&&G>B+12) continue;
      if(R+G+B>190) continue;
      if(Math.max(R,G,B)<45){sx+=xx;sy+=y;n++;}
    }
    return {cx:n?sx/n/tw:null, cy:n?sy/n/th:null, n, magenta, jpeg:t.toDataURL('image/jpeg',0.5)};
  }

  r.threeJSRenderer.setRenderTarget(null);
  r.threeJSRenderer.setClearColor(0xff00ff,1);
  r.threeJSRenderer.clear(true,true,true);
  ctx.fillStyle='#ff00ff'; ctx.fillRect(0,0,present.width,present.height);
  ctx.globalCompositeOperation='copy';
  ctx.drawImage(gl,0,0,gl.width,gl.height,0,0,present.width,present.height);
  const cleared=sample(present);

  r.threeJSRenderer.setClearColor(0x0b1424,1);
  r.threeJSRenderer.resetState();
  r.threeJSRenderer.setRenderTarget(null);
  r.threeJSRenderer.render(sc.threeJSScene, cam);
  ctx.drawImage(gl,0,0,gl.width,gl.height,0,0,present.width,present.height);
  const direct=sample(present);

  r.postProcessor.setScene(sc.threeJSScene, cam);
  r.postProcessor.render();
  ctx.drawImage(gl,0,0,gl.width,gl.height,0,0,present.width,present.height);
  const post=sample(present);

  const c=r.postProcessor.composer;
  return {
    ndc:{x:ndc.x,y:ndc.y}, camY:cam.position.y,
    gl:{w:gl.width,h:gl.height}, present:{w:present.width,h:present.height},
    rt1:[c.renderTarget1?.width,c.renderTarget1?.height],
    cleared:{cx:cleared.cx,n:cleared.n,magenta:cleared.magenta},
    direct:{cx:direct.cx,cy:direct.cy,n:direct.n,magenta:direct.magenta},
    post:{cx:post.cx,cy:post.cy,n:post.n,magenta:post.magenta},
    jpegs:{cleared:cleared.jpeg, direct:direct.jpeg, post:post.jpeg}
  };
})()`);

writeFileSync(
	join(OUT, "force-render.json"),
	JSON.stringify({ ...result, jpegs: undefined }, null, 2),
);
for (const [k, v] of Object.entries(result.jpegs || {})) {
	writeFileSync(
		join(OUT, `force-${k}.jpg`),
		Buffer.from(v.split(",")[1], "base64"),
	);
}
console.log(JSON.stringify({ ...result, jpegs: undefined }, null, 2));
pws.close();
kill();
const directOk =
	result.direct?.cx != null &&
	result.direct.cx > 0.35 &&
	result.direct.cx < 0.65;
process.exit(directOk ? 0 : 2);
