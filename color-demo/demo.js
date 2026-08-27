'use strict';
/* Pulse Color — Web Demo. Everything runs locally in the browser (wasm).
   No export path by design: the processed frames stay in the canvas. */
(() => {

const $ = (s) => document.querySelector(s);

const FX_KEYS = ['enhance', 'halation', 'bloom', 'vignetta', 'grana', 'promist',
                 'mist_bianca', 'glimmer', 'pelle', 'streak', 'ca', 'stella'];

const FX_LABELS = {
  enhance: 'Enhance', halation: 'Halation', bloom: 'Bloom', vignetta: 'Vignette',
  grana: 'Grain', promist: 'Pro-Mist', mist_bianca: 'White Mist', glimmer: 'Glimmer',
  pelle: 'Skin Glow', streak: 'Streak', ca: 'Chromatic Aberration', stella: 'Starburst'
};

const LOOK_DOTS = {
  'nordic': '#8fb4d9', 'cinema-print': '#c9a15a', 'midnight': '#4a5f9e',
  'daylight': '#e8d9a8', 'linen': '#d9cfc0', 'amber': '#e8a03c',
  'ember': '#d9622b', 'amalfi': '#5fb4c9', 'velvet': '#9e4a7a',
  'brass': '#b48a3c', 'silk': '#e8c9d9', 'olive': '#8a9e5a'
};

const PUNTE = 4;
const WIDTH_STEPS = [960, 720, 640];
const FRAME_BUDGET_MS = 40;

const state = {
  M: null,
  data: null,
  ready: false,
  // wasm pointers (kept alive for the whole session)
  fxPtr: 0,
  techPtr: 0,
  imgPtr: 0,
  imgCap: 0,
  lookPtrs: new Map(),      // slug -> heap pointer
  lookLoading: null,
  // parameters
  lookIndex: -1,
  profile: 0,
  strength: 1.0,
  ev: 0,
  temp: 0,
  tint: 0,
  fx: new Float32Array(12),
  // source
  source: null,             // { kind: 'image'|'video', el }
  objectUrl: null,
  frameNo: 0,
  showOriginal: false,
  // adaptive resolution (one-way: only steps down, never back up)
  widthStep: 0,
  perfWindow: [],
  // WebGL fast path
  lutReady: false,
  lutKey: '',
  bakePtr: 0,
  bakeCap: 0,
  fxZeroPtr: 0,
  refineTimer: 0,
  latticeCache: new Map(),
  forceWasm: false,
  // render scheduling
  renderPending: false,
  videoCbId: 0,
  videoRafId: 0
};

const srcCanvas = document.createElement('canvas');
const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
const viewCanvas = $('#viewer-canvas');
const viewCtx = viewCanvas.getContext('2d');

/* ---------------- WebGL fast path ----------------
   Il colore è una LUT 3D cotta DAL MOTORE WASM (nodi u8 esatti a passo intero,
   quindi griglia uniforme senza errore di piazzamento); gli FX girano in shader
   (gl.js, porting di applica_fx). Il wasm resta la referenza e il fallback. */
let glr = null, glCanvas = null, wmCanvas = null, wmCtx = null;

function initGL() {
  if (typeof PulseGL === 'undefined') return;
  const c = document.createElement('canvas');
  c.width = viewCanvas.width; c.height = viewCanvas.height;
  const t = new PulseGL(c);
  if (!t.ok) return;
  glr = t; glCanvas = c;
  viewCanvas.id = 'viewer-canvas-2d';
  c.id = 'viewer-canvas';                      // eredita lo stile del viewer
  viewCanvas.parentNode.insertBefore(c, viewCanvas);
  viewCanvas.style.display = 'none';
}

const BAKE_N_FINE = 86, BAKE_N_FAST = 52;      // passi 255/85=3 e 255/51=5: nodi u8 ESATTI
function lattice(N) {
  let l = state.latticeCache.get(N);
  if (l) return l;
  const step = 255 / (N - 1);
  l = new Uint8Array(N * N * N * 4);
  let i = 0;
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    l[i] = r * step; l[i + 1] = g * step; l[i + 2] = b * step; l[i + 3] = 255; i += 4;
  }
  state.latticeCache.set(N, l);
  return l;
}

function bakeLut(N) {
  const M = state.M;
  const lat = lattice(N);
  const n = lat.length;
  if (n > state.bakeCap) {
    if (state.bakePtr) M._free(state.bakePtr);
    state.bakePtr = M._malloc(n); state.bakeCap = n;
  }
  if (!state.fxZeroPtr) state.fxZeroPtr = M._malloc(12 * 4);
  M.HEAPU8.set(lat, state.bakePtr);
  M.HEAPF32.fill(0, state.fxZeroPtr >> 2, (state.fxZeroPtr >> 2) + 12);
  M._pd_process(state.bakePtr, N, N * N, state.profile,
                state.strength, state.ev, state.temp, state.tint,
                state.fxZeroPtr, PUNTE, 0);
  glr.setLut(M.HEAPU8.subarray(state.bakePtr, state.bakePtr + n), N);
  state.lutReady = true;
}

function colorKey() {
  return [state.lookIndex, state.profile, state.strength, state.ev, state.temp, state.tint].join('|');
}

/* cottura rapida durante il drag, rifinitura fine a riposo */
function scheduleRebake() {
  if (!glr || !state.ready || state.lookIndex < 0) return;
  const key = colorKey();
  if (key === state.lutKey && state.lutReady) return;
  state.lutKey = key;
  bakeLut(BAKE_N_FAST);
  clearTimeout(state.refineTimer);
  state.refineTimer = setTimeout(() => {
    if (colorKey() === state.lutKey && glr) { bakeLut(BAKE_N_FINE); requestRender(); }
  }, 180);
}

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => { if (wmCanvas) { wmCanvas.width = 0; requestRender(); } });
}

function ensureWatermark(w, h) {
  if (!wmCanvas) { wmCanvas = document.createElement('canvas'); wmCtx = wmCanvas.getContext('2d'); }
  if (wmCanvas.width !== w || wmCanvas.height !== h) {
    wmCanvas.width = w; wmCanvas.height = h;
    wmCtx.clearRect(0, 0, w, h);
    drawWatermark(wmCtx, w, h);
    glr.setWatermark(wmCanvas);
  }
}

/* ---------------- core pipeline ---------------- */

function fitSize(sw, sh) {
  const maxW = WIDTH_STEPS[state.widthStep];
  const w = Math.min(maxW, sw) || 1;
  const h = Math.max(1, Math.round(sh * w / sw));
  return [w, h];
}

function drawWatermark(ctx, w, h) {
  if (state.noWm) return;   // solo per il gate di parità (?debug)
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#ffffff';
  ctx.font = '28px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 6);
  const gap = Math.max(w, h) / 3;
  for (const off of [-gap, 0, gap]) {
    ctx.fillText('PULSE COLOR — PREVIEW', 0, off);
  }
  ctx.restore();
}

/* Processes one frame of `el` (image or video) and paints it. Returns process ms. */
function runPipeline(el, sw, sh, seme) {
  if (!sw || !sh) return 0;
  if (glr && state.lutReady && !state.forceWasm) {
    const gw = Math.min(960, sw) || 1;               // il GL non scala mai i gradini
    const gh = Math.max(1, Math.round(sh * gw / sw));
    ensureWatermark(gw, gh);
    const t0 = performance.now();
    glr.render(el, gw, gh, state.fx, PUNTE, seme, state.showOriginal);
    return performance.now() - t0;
  }
  const [w, h] = fitSize(sw, sh);
  if (srcCanvas.width !== w || srcCanvas.height !== h) {
    srcCanvas.width = w; srcCanvas.height = h;
  }
  srcCtx.drawImage(el, 0, 0, w, h);
  const id = srcCtx.getImageData(0, 0, w, h);

  if (viewCanvas.width !== w || viewCanvas.height !== h) {
    viewCanvas.width = w; viewCanvas.height = h;
  }

  let ms = 0;
  if (state.ready && !state.showOriginal) {
    const M = state.M;
    const n = w * h * 4;
    if (n > state.imgCap) {
      if (state.imgPtr) M._free(state.imgPtr);
      state.imgPtr = M._malloc(n);
      state.imgCap = n;
    }
    const t0 = performance.now();
    // NB: re-read heap views from M at every use (memory growth moves them)
    M.HEAPU8.set(id.data, state.imgPtr);
    M.HEAPF32.set(state.fx, state.fxPtr >> 2);
    M._pd_process(state.imgPtr, w, h, state.profile,
                  state.strength, state.ev, state.temp, state.tint,
                  state.fxPtr, PUNTE, seme);
    id.data.set(M.HEAPU8.subarray(state.imgPtr, state.imgPtr + n));
    ms = performance.now() - t0;
  }

  viewCtx.putImageData(id, 0, 0);
  drawWatermark(viewCtx, w, h);
  return ms;
}

if (location.search.indexOf('debug') !== -1) { window.__pc = () => ({ state, runPipeline, glr: () => glr, bakeLut, viewCanvas, glCanvas: () => glCanvas }); }

/* Rolling perf window: step resolution down once when the budget is blown. */
function adaptResolution(ms) {
  if (state.widthStep >= WIDTH_STEPS.length - 1) return;
  state.perfWindow.push(ms);
  if (state.perfWindow.length < 12) return;
  const sorted = [...state.perfWindow].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  state.perfWindow.length = 0;
  if (median > FRAME_BUDGET_MS) {
    state.widthStep += 1;
  }
}

/* ---------------- render scheduling ---------------- */

function requestRender() {
  scheduleRebake();
  if (state.renderPending) return;
  const s = state.source;
  if (!s || s.kind !== 'image') return; // video repaints itself every frame
  state.renderPending = true;
  requestAnimationFrame(() => {
    state.renderPending = false;
    const src = state.source;
    if (src && src.kind === 'image') {
      runPipeline(src.el, src.el.naturalWidth, src.el.naturalHeight, 0);
    }
  });
}

function stopVideoLoop() {
  const s = state.source;
  if (state.videoCbId && s && s.kind === 'video' && s.el.cancelVideoFrameCallback) {
    s.el.cancelVideoFrameCallback(state.videoCbId);
  }
  if (state.videoRafId) cancelAnimationFrame(state.videoRafId);
  state.videoCbId = 0;
  state.videoRafId = 0;
}

function startVideoLoop(video) {
  const useRVFC = typeof video.requestVideoFrameCallback === 'function';
  const step = () => {
    if (!state.source || state.source.el !== video) return; // source changed
    if (video.videoWidth) {
      const ms = runPipeline(video, video.videoWidth, video.videoHeight, state.frameNo++);
      if (!state.showOriginal) adaptResolution(ms);
    }
    schedule();
  };
  const schedule = () => {
    if (useRVFC) state.videoCbId = video.requestVideoFrameCallback(step);
    else state.videoRafId = requestAnimationFrame(step);
  };
  schedule();
}

/* ---------------- source management ---------------- */

function clearSource() {
  stopVideoLoop();
  if (state.source && state.source.kind === 'video') {
    state.source.el.pause();
    state.source.el.removeAttribute('src');
  }
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }
  state.source = null;
  state.frameNo = 0;
  state.perfWindow.length = 0;
}

function _segnaSorgente(){ const f=document.querySelector('.viewer-frame'); if(f) f.classList.add('has-source'); }
function setImageSource(img) { _segnaSorgente();
  clearSource();
  state.source = { kind: 'image', el: img };
  requestRender();
}

function setVideoSource(url) { _segnaSorgente();
  clearSource();
  state.objectUrl = url;
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.src = url;
  state.source = { kind: 'video', el: video };
  video.addEventListener('loadeddata', () => {
    if (!state.source || state.source.el !== video) return;
    video.play().catch(() => {});
    startVideoLoop(video);
  }, { once: true });
  video.addEventListener('error', () => {
    setStatus('could not decode that video — try another file');
  }, { once: true });
}

function loadUserFile(file) {
  if (!file) return;
  markActiveThumb(null);
  if (file.type.startsWith('video/')) {
    setVideoSource(URL.createObjectURL(file));
  } else if (file.type.startsWith('image/')) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      setImageSource(img);
      state.objectUrl = url; // revoke together with the next source swap
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus('could not read that image — try another file');
    };
    img.src = url;
  } else {
    setStatus('unsupported file type — use a video or an image');
  }
}

/* ---------------- looks ---------------- */

async function selectLook(index) {
  const M = state.M;
  const look = state.data.looks[index];
  if (!look) return;
  state.lookIndex = index;
  markActiveLook(index);
  applyFxDefaults(look);

  let ptr = state.lookPtrs.get(look.slug);
  if (!ptr) {
    setLookSpinner(index, true);
    const buf = await fetch('./data/look_' + look.slug + '.bin').then(r => {
      if (!r.ok) throw new Error('look fetch failed: ' + r.status);
      return r.arrayBuffer();
    });
    ptr = M._malloc(buf.byteLength);
    M.HEAPU8.set(new Uint8Array(buf), ptr);
    state.lookPtrs.set(look.slug, ptr);
    setLookSpinner(index, false);
    if (state.lookIndex !== index) return; // user clicked another look meanwhile
  }
  M._pd_set_lut(ptr, state.techPtr, state.data.lut_n);
  state.lutReady = false;
  state.lutKey = '';
  requestRender();
}

function applyFxDefaults(look) {
  FX_KEYS.forEach((key, i) => {
    const v = (look.fx && typeof look.fx[key] === 'number') ? look.fx[key] : 0;
    state.fx[i] = v;
    const input = document.getElementById('fx-' + key);
    if (input) {
      input.value = String(v);
      updateSliderVal(input);
    }
  });
}

/* ---------------- UI ---------------- */

function setStatus(text) {
  $('#engine-status').textContent = text;
}

function hideOverlay() {
  $('#viewer-overlay').classList.add('hidden');
}

function markActiveLook(index) {
  document.querySelectorAll('.look-item').forEach((li, i) => {
    li.classList.toggle('active', i === index);
  });
}

function setLookSpinner(index, on) {
  const li = document.querySelectorAll('.look-item')[index];
  if (!li) return;
  let spin = li.querySelector('.spin');
  if (on) {
    if (!spin) {
      spin = document.createElement('span');
      spin.className = 'spin';
      spin.textContent = '…';
      li.appendChild(spin);
    }
  } else if (spin) {
    spin.remove();
  }
}

function markActiveThumb(button) {
  document.querySelectorAll('.thumb').forEach(t => { // (nessuna thumb: no-op)
    t.classList.toggle('active', t === button);
  });
}

function updateSliderVal(input) {
  const label = input.closest('.slider-row').querySelector('.val');
  const v = parseFloat(input.value);
  if (input.dataset.fmt === 'pct') label.textContent = Math.round(v * 100) + '%';
  else if (input.dataset.fmt === 'ev') label.textContent = (v >= 0 ? '+' : '') + v.toFixed(2) + ' EV';
  else label.textContent = v.toFixed(2);
}

function makeSlider(parent, { id, label, min, max, step, value, fmt, onInput }) {
  const row = document.createElement('div');
  row.className = 'slider-row';
  const lab = document.createElement('div');
  lab.className = 'slider-label';
  const name = document.createElement('span');
  name.textContent = label;
  const val = document.createElement('span');
  val.className = 'val';
  lab.appendChild(name);
  lab.appendChild(val);
  const input = document.createElement('input');
  input.type = 'range';
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  if (fmt) input.dataset.fmt = fmt;
  input.addEventListener('input', () => {
    updateSliderVal(input);
    onInput(parseFloat(input.value));
    requestRender();
  });
  row.appendChild(lab);
  row.appendChild(input);
  parent.appendChild(row);
  updateSliderVal(input);
  return input;
}

function buildUI() {
  const data = state.data;

  // camera profile select
  const sel = $('#profile-select');
  data.profili.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = name;
    sel.appendChild(opt);
  });
  sel.value = '0';
  sel.addEventListener('change', () => {
    state.profile = parseInt(sel.value, 10) || 0;
    requestRender();
  });

  // look list
  const list = $('#look-list');
  data.looks.forEach((look, i) => {
    const li = document.createElement('li');
    li.className = 'look-item';
    const dot = document.createElement('span');
    dot.className = 'look-dot';
    dot.style.background = LOOK_DOTS[look.slug] || '#888';
    const name = document.createElement('span');
    name.textContent = look.nome;
    li.appendChild(dot);
    li.appendChild(name);
    li.addEventListener('click', () => {
      selectLook(i).catch(err => setStatus('look load failed'));
    });
    list.appendChild(li);
  });

  // global sliders
  const g = $('#global-sliders');
  makeSlider(g, { id: 'sl-strength', label: 'Strength', min: 0, max: 1, step: 0.01,
    value: 1, fmt: 'pct', onInput: v => { state.strength = v; } });
  makeSlider(g, { id: 'sl-ev', label: 'Exposure', min: -2, max: 2, step: 0.05,
    value: 0, fmt: 'ev', onInput: v => { state.ev = v; } });
  makeSlider(g, { id: 'sl-temp', label: 'Temperature', min: -1, max: 1, step: 0.01,
    value: 0, onInput: v => { state.temp = v; } });
  makeSlider(g, { id: 'sl-tint', label: 'Tint', min: -1, max: 1, step: 0.01,
    value: 0, onInput: v => { state.tint = v; } });

  // fx sliders
  const fxBox = $('#fx-sliders');
  FX_KEYS.forEach((key, i) => {
    makeSlider(fxBox, { id: 'fx-' + key, label: FX_LABELS[key], min: 0, max: 1,
      step: 0.01, value: 0, onInput: v => { state.fx[i] = v; } });
  });

  $('#reset-fx').addEventListener('click', () => {
    const look = state.data.looks[state.lookIndex];
    if (look) {
      applyFxDefaults(look);
      requestRender();
    }
  });

  // hold-to-compare
  const cmp = $('#compare-btn');
  const setOriginal = (on) => {
    if (state.showOriginal === on) return;
    state.showOriginal = on;
    requestRender();
  };
  cmp.addEventListener('pointerdown', (e) => { e.preventDefault(); setOriginal(true); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
    cmp.addEventListener(ev, () => setOriginal(false)));
  cmp.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setOriginal(true); }
  });
  cmp.addEventListener('keyup', () => setOriginal(false));

  // file input + dropzone
  const input = $('#file-input');
  input.addEventListener('change', () => {
    loadUserFile(input.files && input.files[0]);
    input.value = '';
  });
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
  }));
  dz.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    loadUserFile(file);
  });
}

/* ---------------- boot ---------------- */

async function boot() {
  setStatus('loading engine…');
  const [M, data] = await Promise.all([
    PulseDemo(),
    fetch('./data/demo_data.json').then(r => {
      if (!r.ok) throw new Error('demo_data.json: ' + r.status);
      return r.json();
    })
  ]);
  state.M = M;
  state.data = data;

  setStatus('loading profiles…');
  const [profBuf, techBuf] = await Promise.all([
    fetch('./data/profili.bin').then(r => r.arrayBuffer()),
    fetch('./data/tech.bin').then(r => r.arrayBuffer())
  ]);

  const profPtr = M._malloc(profBuf.byteLength);
  M.HEAPU8.set(new Uint8Array(profBuf), profPtr);
  const m0Ptr = M._malloc(9 * 4);
  M.HEAPF32.set(new Float32Array(data.m0_inv), m0Ptr >> 2);
  M._pd_init(profPtr, data.n_profili, data.tab_n, m0Ptr);

  state.techPtr = M._malloc(techBuf.byteLength);
  M.HEAPU8.set(new Uint8Array(techBuf), state.techPtr);
  state.fxPtr = M._malloc(12 * 4);

  buildUI();
  initGL();

  setStatus('loading look…');
  await selectLook(0);

  state.ready = true;
  setStatus('engine ready — runs in your browser');
  hideOverlay();
  requestRender();
}

boot().catch((err) => {
  console.error(err);
  setStatus('failed to load the demo engine — reload the page');
  $('#viewer-overlay').textContent = 'Failed to load the demo engine. Reload the page to retry.';
});

})();
