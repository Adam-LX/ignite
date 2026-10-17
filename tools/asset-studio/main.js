/**
 * Ignite Editor — Blender-lite viewport + big UI.
 * LPM orbit · RMB/MMB pan · wheel zoom · drop files on selected slot.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const statusEl = document.querySelector("#status");
const statusRight = document.querySelector("#status-right");
const arenaList = document.querySelector("#arena-list");
const slotList = document.querySelector("#slot-list");
const folderEl = document.querySelector("#folder-path");
const saveBtn = document.querySelector("#btn-save");
const homeBtn = document.querySelector("#btn-home");
const propTitle = document.querySelector("#prop-title");
const propDesc = document.querySelector("#prop-desc");
const propPath = document.querySelector("#prop-path");
const drop = document.querySelector("#drop");
const pickBtn = document.querySelector("#btn-pick");
const fileInput = document.querySelector("#file");
const canvas = document.querySelector("#view");
const viewportLabel = document.querySelector("#viewport-label");
const viewportEmpty = document.querySelector("#viewport-empty");

/** @type {{ id: string, manifest: Record<string, unknown>, slots: any[], folder: string } | null} */
let current = null;
let dirty = false;
/** @type {any | null} */
let selectedSlot = null;

const view = {
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  content: null,
  grid: null,
  light: null,
  texLoader: new THREE.TextureLoader(),
  gltfLoader: new GLTFLoader(),
};

function setStatus(msg, kind = "") {
  statusEl.textContent = msg;
  statusEl.className = kind;
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function markDirty(v) {
  dirty = v;
  // File upload already saves; enable save when manifest tweaked
  saveBtn.disabled = !current;
  saveBtn.textContent = dirty ? "ZAPISZ ★" : "ZAPISZ";
}

function initViewport() {
  view.renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  view.renderer.setClearColor(0x0e0e0e, 1);
  view.renderer.outputColorSpace = THREE.SRGBColorSpace;
  view.scene = new THREE.Scene();

  view.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  view.camera.position.set(2.4, 1.8, 3.2);

  view.controls = new OrbitControls(view.camera, canvas);
  view.controls.enableDamping = true;
  view.controls.dampingFactor = 0.08;
  view.controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  view.controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };

  const hemi = new THREE.HemisphereLight(0xfff2dd, 0x1a2228, 1.15);
  const key = new THREE.DirectionalLight(0xffffff, 1.35);
  key.position.set(3, 5, 2);
  const fill = new THREE.DirectionalLight(0x88aacc, 0.45);
  fill.position.set(-3, 1, -2);
  view.light = key;
  view.scene.add(hemi, key, fill);

  view.grid = new THREE.GridHelper(8, 16, 0x444444, 0x2a2a2a);
  view.scene.add(view.grid);

  const resize = () => {
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 640;
    const h = canvas.clientHeight || 480;
    view.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    view.renderer.setSize(w, h, false);
    view.camera.aspect = w / Math.max(1, h);
    view.camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);
  new ResizeObserver(resize).observe(canvas.parentElement || canvas);

  const tick = () => {
    requestAnimationFrame(tick);
    view.controls.update();
    view.renderer.render(view.scene, view.camera);
  };
  tick();
}

function clearContent() {
  if (view.content) {
    view.scene.remove(view.content);
    view.content.traverse?.((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          m.map?.dispose?.();
          m.dispose?.();
        }
      }
    });
    view.content = null;
  }
}

function frameObject(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.2);
  view.controls.target.copy(center);
  view.camera.position.set(
    center.x + maxDim * 1.5,
    center.y + maxDim * 0.95,
    center.z + maxDim * 1.7,
  );
  view.controls.update();
}

function resetCamera() {
  view.controls.target.set(0, 0.5, 0);
  view.camera.position.set(2.4, 1.8, 3.2);
  view.controls.update();
}

async function showTexture(url) {
  clearContent();
  viewportEmpty.classList.add("hidden");
  viewportLabel.textContent = "Tekstura (płaszczyzna)";
  const tex = await view.texLoader.loadAsync(`${url}?t=${Date.now()}`);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const aspect = (tex.image?.width || 1) / (tex.image?.height || 1);
  const w = aspect >= 1 ? 2.4 : 2.4 * aspect;
  const h = aspect >= 1 ? 2.4 / aspect : 2.4;
  const geo = new THREE.PlaneGeometry(w, h);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.85,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = h * 0.5;
  const group = new THREE.Group();
  group.add(mesh);
  // soft ground shadow disc
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(w, h) * 0.45, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  group.add(shadow);
  view.content = group;
  view.scene.add(group);
  frameObject(group);
}

async function showGlb(url) {
  clearContent();
  viewportEmpty.classList.add("hidden");
  viewportLabel.textContent = "Model 3D (GLB)";
  const gltf = await view.gltfLoader.loadAsync(`${url}?t=${Date.now()}`);
  view.content = gltf.scene;
  view.scene.add(view.content);
  frameObject(view.content);
}

function clearViewportSoft() {
  clearContent();
  viewportEmpty.classList.remove("hidden");
  viewportLabel.textContent = "Widok 3D";
  resetCamera();
}

async function loadArenas() {
  const { arenas } = await api("/api/arenas");
  arenaList.innerHTML = "";
  for (const a of arenas) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.id = a.id;
    btn.innerHTML = `${a.id}<span class="sub">${a.nameKey || "mapa"}</span>`;
    btn.addEventListener("click", () => selectArena(a.id));
    li.appendChild(btn);
    arenaList.appendChild(li);
  }
  if (arenas[0]) await selectArena(arenas[0].id);
  setStatus("Wybierz slot po lewej, potem UPUŚĆ plik", "ok");
}

function syncArenaActive(id) {
  for (const btn of arenaList.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.id === id);
  }
}

async function selectArena(id) {
  if (dirty && !confirm("Są niezapisane zmiany. Porzucić?")) return;
  const data = await api(`/api/arenas/${encodeURIComponent(id)}`);
  current = data;
  markDirty(false);
  selectedSlot = null;
  syncArenaActive(id);
  folderEl.textContent = data.folder || "";
  statusRight.textContent = `Arena: ${id}`;
  renderSlotTree();
  propTitle.textContent = "—";
  propDesc.textContent = "Wybierz pozycję z listy „Co zmieniasz”.";
  propPath.textContent = "";
  clearViewportSoft();
  setStatus(`Arena „${id}” — wybierz co zmieniasz`, "ok");
}

function renderSlotTree() {
  if (!current) return;
  slotList.innerHTML = "";
  for (const slot of current.slots) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.key = slot.key;
    const has = slot.value ? "jest plik" : "PUSTE";
    btn.innerHTML = `${slot.label}<span class="sub">${has}</span>`;
    if (selectedSlot?.key === slot.key) btn.classList.add("active");
    btn.addEventListener("click", () => selectSlot(slot));
    li.appendChild(btn);
    slotList.appendChild(li);
  }
}

async function selectSlot(slot) {
  selectedSlot = slot;
  for (const btn of slotList.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.key === slot.key);
  }
  propTitle.textContent = slot.label;
  propDesc.textContent =
    slot.kind === "glb"
      ? "To model 3D. Wrzuć plik .glb (np. bramka)."
      : "To obrazek. Wrzuć PNG albo JPG.";
  propPath.textContent = slot.value || "(jeszcze nic — upuść plik)";
  fileInput.accept =
    slot.kind === "glb"
      ? ".glb,.gltf,model/gltf-binary"
      : "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";

  try {
    if (slot.value && slot.kind === "image") await showTexture(slot.value);
    else if (slot.value && slot.kind === "glb") await showGlb(slot.value);
    else clearViewportSoft();
    setStatus(`Edytujesz: ${slot.label}`, "ok");
  } catch (e) {
    setStatus(`Podgląd: ${e.message || e}`, "err");
  }
}

async function uploadFile(file) {
  if (!current) {
    setStatus("Najpierw wybierz arenę", "err");
    return;
  }
  if (!selectedSlot) {
    setStatus("Najpierw wybierz CO zmieniasz (lista po lewej)", "err");
    return;
  }
  setStatus(`Wgrywam ${file.name}…`);
  const fd = new FormData();
  fd.append("slot", selectedSlot.key);
  fd.append("file", file, file.name);
  try {
    const data = await api(`/api/arenas/${encodeURIComponent(current.id)}/file`, {
      method: "POST",
      body: fd,
    });
    current.manifest = data.manifest;
    current.slots = current.slots.map((s) =>
      s.key === selectedSlot.key
        ? { ...s, value: data.url, previewUrl: data.url }
        : s,
    );
    selectedSlot = current.slots.find((s) => s.key === selectedSlot.key);
    markDirty(false);
    renderSlotTree();
    await selectSlot(selectedSlot);
    setStatus(`Zapisane! ${selectedSlot.label} → dysk. Hard-reload gry.`, "ok");
  } catch (e) {
    setStatus(String(e.message || e), "err");
  }
}

pickBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files?.[0]) void uploadFile(fileInput.files[0]);
  fileInput.value = "";
});

for (const el of [drop, canvas]) {
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("drag");
  });
  el.addEventListener("dragleave", () => drop.classList.remove("drag"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
    const f = e.dataTransfer?.files?.[0];
    if (f) void uploadFile(f);
  });
}

saveBtn.addEventListener("click", async () => {
  if (!current) return;
  try {
    setStatus("Zapisuję manifest…");
    const data = await api(
      `/api/arenas/${encodeURIComponent(current.id)}/manifest`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifest: current.manifest }),
      },
    );
    current.manifest = data.manifest;
    markDirty(false);
    setStatus("Manifest OK — odśwież grę (Ctrl+Shift+R)", "ok");
  } catch (e) {
    setStatus(String(e.message || e), "err");
  }
});

homeBtn.addEventListener("click", () => {
  if (view.content) frameObject(view.content);
  else resetCamera();
  setStatus("Widok wycentrowany", "ok");
});

initViewport();
loadArenas().catch((e) => setStatus(String(e.message || e), "err"));
