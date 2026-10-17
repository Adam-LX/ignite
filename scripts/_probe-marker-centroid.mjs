#!/usr/bin/env node
import WebSocket from "ws";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { setTimeout as sleep } from "timers/promises";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-results", "chase-camera", "electron-menu");
mkdirSync(OUT, { recursive: true });

const tabs = await fetch("http://127.0.0.1:9333/json/list").then((r) => r.json());
const page = tabs.find((t) => t.type === "page" && /5173/.test(t.url));
if (!page) throw new Error("no page on 5173");
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
const send = (method, params = {}, timeout = 120000) =>
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
const evalR = async (ex, timeout = 120000) => {
	const r = await send(
		"Runtime.evaluate",
		{ expression: ex, returnByValue: true, awaitPromise: true },
		timeout,
	);
	if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
	return r.result?.value;
};

for (let i = 0; i < 80; i++) {
	if (
		await evalR(
			`!!window.__igniteRenderer && !!window.__THREE && (document.body.classList.contains("menu-active")||!!window.__igniteLiveMenu)`,
		)
	)
		break;
	await sleep(200);
}

await evalR(`try{localStorage.setItem("ignite.tutorial.done","1");}catch{}`);
await evalR(`(()=>{
  document.querySelectorAll("button").forEach(b=>{
    const t=(b.textContent||"").toLowerCase();
    if(t.includes("pomiń")||t.includes("skip")) b.click();
  });
  document.querySelector('.mode-card[data-mode="1v1"]')?.click();
  document.querySelector("#main-menu-start")?.click();
})()`);

for (let i = 0; i < 200; i++) {
	if (
		(await evalR(
			`window.__igniteSession?.match?.getHudSnapshot?.(window.__igniteSession.cars)?.kickoffTick??null`,
		)) != null
	)
		break;
	await sleep(80);
}

const result = await evalR(`(()=>{
  const T=window.__THREE, s=window.__igniteSession, r=window.__igniteRenderer, sc=window.__igniteScene;
  if(!T||!s||!r||!sc) return {err:'missing', hasT:!!T, hasS:!!s};
  const cam=r.threeJSCamera;
  const player=s.humanCar.player;
  const car=player.getPosition();
  const ball=car.clone(); ball.y+=0.5;
  r.snapChaseCamera(player, ball, {kickoff:true, matchBlend:0});
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();

  let marker=sc.threeJSScene.getObjectByName('__igniteProbeMarker');
  if(marker) marker.removeFromParent();
  marker=new T.Mesh(
    new T.SphereGeometry(2.2, 20, 14),
    new T.MeshBasicMaterial({color:0xff0040, depthTest:false, depthWrite:false})
  );
  marker.name='__igniteProbeMarker';
  marker.position.copy(car);
  marker.position.y+=1.4;
  marker.frustumCulled=false;
  marker.renderOrder=9999;
  sc.threeJSScene.add(marker);

  const ndcPhys=car.clone().project(cam);
  const ndcMark=marker.position.clone().project(cam);
  const body=player.visualRoot.getObjectByName('body')||player.visualRoot;
  const bodyWp=new T.Vector3();
  body.getWorldPosition(bodyWp);
  const ndcBody=bodyWp.clone().project(cam);

  const gl=r.threeJSRenderer.domElement;
  const present=document.querySelector('canvas.webgl-present-canvas');
  const ctx=present.getContext('2d');

  function sample(c){
    const t=document.createElement('canvas');
    const tw=960, th=Math.max(1,Math.round(960*c.height/c.width));
    t.width=tw; t.height=th;
    const x=t.getContext('2d'); x.drawImage(c,0,0,c.width,c.height,0,0,tw,th);
    const img=x.getImageData(0,0,tw,th).data;
    let sx=0,sy=0,n=0, dsx=0,dsy=0,dn=0;
    for(let y=4;y<th-4;y++) for(let xx=4;xx<tw-4;xx++){
      const i=(y*tw+xx)*4; const R=img[i],G=img[i+1],B=img[i+2];
      if(R>180 && G<100 && B<130){ sx+=xx; sy+=y; n++; }
      if(G>R+18&&G>B+12) continue;
      if(R+G+B>190) continue;
      if(Math.max(R,G,B)<45){ dsx+=xx; dsy+=y; dn++; }
    }
    return {
      red:{cx:n?sx/n/tw:null,cy:n?sy/n/th:null,n},
      dark:{cx:dn?dsx/dn/tw:null,cy:dn?dsy/dn/th:null,n:dn},
      jpeg:t.toDataURL('image/jpeg',0.55)
    };
  }

  r.threeJSRenderer.setRenderTarget(null);
  r.threeJSRenderer.resetState();
  const css = r.threeJSRenderer.getSize(new T.Vector2());
  r.threeJSRenderer.setViewport(0, 0, css.x, css.y);
  r.threeJSRenderer.setScissor(0, 0, css.x, css.y);
  r.threeJSRenderer.setScissorTest(false);
  r.threeJSRenderer.setClearColor(0x0b1424, 1);
  r.threeJSRenderer.clear(true, true, true);
  r.threeJSRenderer.render(sc.threeJSScene, cam);
  ctx.globalCompositeOperation='copy';
  ctx.drawImage(gl,0,0,gl.width,gl.height,0,0,present.width,present.height);
  const direct=sample(present);

  r.postProcessor.setScene(sc.threeJSScene, cam);
  r.postProcessor.render();
  ctx.drawImage(gl,0,0,gl.width,gl.height,0,0,present.width,present.height);
  const post=sample(present);

  const you=[...document.querySelectorAll('.car-name-tag')].map(el=>{
    const rect=el.getBoundingClientRect();
    return {text:(el.textContent||'').trim(), nx:(rect.x+rect.width/2)/window.innerWidth, ny:(rect.y+rect.height/2)/window.innerHeight};
  });

  marker.removeFromParent();
  return {
    tick:s.match.getHudSnapshot(s.cars).kickoffTick,
    cam:{x:+cam.position.x.toFixed(2),y:+cam.position.y.toFixed(2),z:+cam.position.z.toFixed(2),fov:+cam.fov.toFixed(2),aspect:+cam.aspect.toFixed(4)},
    car:{x:car.x,y:+car.y.toFixed(3),z:car.z},
    bodyWp:{x:+bodyWp.x.toFixed(3),y:+bodyWp.y.toFixed(3),z:+bodyWp.z.toFixed(3)},
    ndcPhys:{x:+ndcPhys.x.toFixed(4),y:+ndcPhys.y.toFixed(4)},
    ndcBody:{x:+ndcBody.x.toFixed(4),y:+ndcBody.y.toFixed(4)},
    ndcMark:{x:+ndcMark.x.toFixed(4),y:+ndcMark.y.toFixed(4)},
    expectRed:{nx:+((ndcMark.x+1)*0.5).toFixed(4), ny:+((1-ndcMark.y)*0.5).toFixed(4)},
    gl:{w:gl.width,h:gl.height},
    you,
    direct:{red:direct.red,dark:direct.dark},
    post:{red:post.red,dark:post.dark},
    jpegs:{direct:direct.jpeg,post:post.jpeg}
  };
})()`);

writeFileSync(join(OUT, "marker-centroid.json"), JSON.stringify({ ...result, jpegs: undefined }, null, 2));
for (const [k, v] of Object.entries(result.jpegs || {})) {
	writeFileSync(join(OUT, `marker-${k}.jpg`), Buffer.from(String(v).split(",")[1], "base64"));
}
console.log(JSON.stringify({ ...result, jpegs: undefined }, null, 2));
pws.close();
const exp = result.expectRed?.nx;
const gotDirect = result.direct?.red?.cx;
const gotPost = result.post?.red?.cx;
const okDirect = gotDirect != null && exp != null && Math.abs(gotDirect - exp) < 0.12;
const okPost = gotPost != null && exp != null && Math.abs(gotPost - exp) < 0.12;
console.log(okDirect && okPost ? "PASS" : "FAIL", {
	exp,
	gotDirect,
	gotPost,
	you: result.you?.[0]?.nx,
});
process.exit(okDirect && okPost ? 0 : 2);
