'use strict';
/* Pulse Edit — Web Demo. Tutto gira in locale nel browser.
   Il motore produce SOLO tempi di taglio: il player li mostra nel canvas.
   Nessun percorso di export, per scelta. */
(() => {

const $ = (s) => document.querySelector(s);

const PATTERNS = [
  { key: 'energy_map',  label: 'Energy Map (Auto)' },
  { key: 'bar',         label: 'Every bar' },
  { key: 'beat',        label: 'Every beat' }
];

const PRELOAD_LEAD = 0.3;  // anticipo del precarico del prossimo video, in secondi
const MIN_SEG = 0.05;      // sotto questa durata i segmenti si fondono

const COL_WAVE = '#4a4a52';
const COL_BAR  = '#d9a84a';
const COL_UP   = 'rgba(255, 75, 51, 0.75)';
const COL_CUT  = '#ffffff';
const COL_HEAD = '#ff4b33';

const state = {
  worker: null,
  job: 0,
  analyzing: false,
  // musica
  y: null,               // Float32Array mono 22050 — il master resta nel main
  songName: '',
  songUrl: null,         // object URL usato SOLO come src dell'<audio>
  audio: null,
  duration: 0,
  // analisi
  res: null,
  pattern: 'energy_map',
  sensitivity: 0.5,
  // clip
  clips: [],             // { id, name, url, video, duration }
  clipSeq: 0,
  order: [],             // permutazione clip per il round-robin
  // montaggio
  segments: [],          // { start, end, clip, offset }
  segIdx: -1,
  preloadedSeg: -1,
  playing: false,
  rafId: 0,
  // timeline
  tlStatic: null         // layer statico prerenderizzato (waveform + marker)
};

const viewCanvas = $('#viewer-canvas');
const viewCtx = viewCanvas.getContext('2d');
const VW = viewCanvas.width, VH = viewCanvas.height;
const tlCanvas = $('#timeline-canvas');
const tlCtx = tlCanvas.getContext('2d');

/* ---------------- utilita' ---------------- */

const fmtTime = (s) => {
  s = Math.max(0, s || 0);
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
};

function setStatus(text) { $('#engine-status').textContent = text; }

function showOverlay(text) {
  $('#overlay-text').textContent = text;
  $('#viewer-overlay').classList.remove('hidden');
}

function hideOverlay() { $('#viewer-overlay').classList.add('hidden'); }

function updateTimeReadout(t) {
  $('#time-readout').textContent = fmtTime(t) + ' / ' + fmtTime(state.duration);
}

function currentT() { return state.audio ? state.audio.currentTime : 0; }

/* ---------------- viewer ---------------- */

function drawWatermark(ctx, w, h) {
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
    ctx.fillText('PULSE EDIT — PREVIEW', 0, off);
  }
  ctx.restore();
}

function drawCover(v) {
  const vw = v.videoWidth, vh = v.videoHeight;
  const scale = Math.max(VW / vw, VH / vh);
  const w = vw * scale, h = vh * scale;
  viewCtx.drawImage(v, (VW - w) / 2, (VH - h) / 2, w, h);
}

function drawFrame() {
  viewCtx.fillStyle = '#000';
  viewCtx.fillRect(0, 0, VW, VH);
  const seg = state.segments[state.segIdx];
  if (seg) {
    const clip = state.clips[seg.clip];
    if (clip && clip.video.videoWidth) drawCover(clip.video);
  }
  drawWatermark(viewCtx, VW, VH);
}

/* ---------------- timeline ---------------- */

function sizeTimeline() {
  const rect = tlCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(200, Math.round(rect.width * dpr));
  const h = Math.max(40, Math.round(rect.height * dpr));
  if (tlCanvas.width !== w || tlCanvas.height !== h) {
    tlCanvas.width = w; tlCanvas.height = h;
    state.tlStatic = null;
  }
}

/* Layer statico: waveform grigia, bar oro, upbeat rossi corti, tagli bianchi. */
function renderTimelineStatic() {
  sizeTimeline();
  const w = tlCanvas.width, h = tlCanvas.height;
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const ctx = off.getContext('2d');
  ctx.fillStyle = '#0b0b0d';
  ctx.fillRect(0, 0, w, h);

  const dur = state.duration;
  if (state.y && dur) {
    const y = state.y, mid = h / 2, spp = y.length / w;
    ctx.fillStyle = COL_WAVE;
    for (let x = 0; x < w; x++) {
      const s = Math.floor(x * spp);
      const e = Math.min(y.length, Math.floor((x + 1) * spp) + 1);
      let mn = 0, mx = 0;
      for (let i = s; i < e; i++) { const v = y[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      const y0 = mid - mx * mid * 0.9;
      const y1 = mid - mn * mid * 0.9;
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }

  if (state.res && dur) {
    const lw = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const px = (t) => t / dur * w;
    ctx.fillStyle = COL_UP;
    for (const t of state.res.upbeats) ctx.fillRect(px(t) - lw / 2, h * 0.3, lw, h * 0.4);
    ctx.fillStyle = COL_BAR;
    for (const t of state.res.bars) ctx.fillRect(px(t) - lw / 2, 0, lw, h);
    ctx.fillStyle = COL_CUT;
    for (const t of state.res.cuts[state.pattern] || []) ctx.fillRect(px(t) - lw, 0, lw * 2, h);
  }

  state.tlStatic = off;
}

function drawTimeline(t) {
  sizeTimeline();
  if (!state.tlStatic) renderTimelineStatic();
  const w = tlCanvas.width, h = tlCanvas.height;
  tlCtx.drawImage(state.tlStatic, 0, 0);
  if (state.duration) {
    const lw = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const x = Math.max(0, Math.min(t / state.duration, 1)) * w;
    tlCtx.fillStyle = COL_HEAD;
    tlCtx.fillRect(x - 1.5 * lw, 0, 3 * lw, h);
  }
}

/* ---------------- segmenti e assegnazione clip ---------------- */

function rebuildSegments() {
  state.segments = [];
  state.segIdx = -1;
  state.preloadedSeg = -1;
  if (state.res && state.duration) {
    const bounds = [0];
    for (const c of state.res.cuts[state.pattern] || []) {
      if (c > MIN_SEG && c < state.duration - MIN_SEG) bounds.push(c);
    }
    bounds.push(state.duration);
    bounds.sort((a, b) => a - b);
    for (let i = 0; i < bounds.length - 1; i++) {
      if (bounds[i + 1] - bounds[i] < MIN_SEG) continue;
      state.segments.push({ start: bounds[i], end: bounds[i + 1], clip: -1, offset: 0 });
    }
  }
  assignClips();
  updateInfo();
}

/* Round-robin: seg i → clip order[i % n]; ogni riuso avanza l'offset
   dentro la clip, con wrap a 0 quando lo spezzone sforerebbe la durata. */
function assignClips() {
  const n = state.clips.length;
  if (!n || !state.segments.length) return;
  if (state.order.length !== n) state.order = state.clips.map((_, i) => i);
  const nextOff = new Array(n).fill(0);
  state.segments.forEach((seg, i) => {
    const ci = state.order[i % n];
    const clip = state.clips[ci];
    const need = seg.end - seg.start;
    let off = nextOff[ci];
    if (clip.duration > 0 && off + need > clip.duration) off = 0;
    seg.clip = ci;
    seg.offset = off;
    nextOff[ci] = off + need;
  });
  state.preloadedSeg = -1;
}

function shuffleClips() {
  const n = state.clips.length;
  if (n < 2) return;
  const ord = state.clips.map((_, i) => i);
  for (let i = ord.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = ord[i]; ord[i] = ord[j]; ord[j] = t;
  }
  state.order = ord;
  state.segIdx = -1;
  assignClips();
  if (!state.playing) drawPosterFrame();
}

/* ---------------- player ---------------- */

function canPlay() {
  return !!(state.audio && state.res && state.segments.length &&
            state.clips.some(c => c.duration > 0));
}

/* Tempo valido dentro la clip (wrap se lo spezzone sfora la durata). */
function clampTime(clip, t) {
  const d = clip.duration;
  if (!d) return 0;
  return d > 0.2 ? Math.min(t % d, d - 0.05) : 0;
}

function findSegment(t) {
  const segs = state.segments;
  let i = state.segIdx >= 0 ? Math.min(state.segIdx, segs.length - 1) : 0;
  if (segs[i] && t < segs[i].start) i = 0;
  while (i < segs.length - 1 && t >= segs[i].end) i++;
  return i;
}

function syncSegment(t) {
  if (!state.segments.length || !state.clips.length) return;
  const i = findSegment(t);
  if (i === state.segIdx) return;
  const prev = state.segIdx >= 0 ? state.segments[state.segIdx] : null;
  state.segIdx = i;
  const seg = state.segments[i];
  const clip = state.clips[seg.clip];
  if (!clip) return;
  if (prev && prev.clip !== seg.clip) {
    const pv = state.clips[prev.clip];
    if (pv) pv.video.pause();
  }
  const v = clip.video;
  const target = clampTime(clip, seg.offset + (t - seg.start));
  // seek per riallineare al cambio di segmento; se il precarico ci ha gia'
  // portato vicini, si evita il secondo seek
  if (Math.abs(v.currentTime - target) > 0.15) {
    try { v.currentTime = target; } catch (_) {}
  }
  // la clip corrente resta in play (muted) per fluidita'
  if (state.playing) v.play().catch(() => {});
}

function maybePreload(t) {
  const i = state.segIdx;
  const next = state.segments[i + 1];
  if (!next || state.preloadedSeg === i + 1) return;
  if (t < next.start - PRELOAD_LEAD) return;
  state.preloadedSeg = i + 1;
  const cur = state.segments[i];
  if (cur && next.clip === cur.clip) return; // stesso <video>, niente da fare
  const clip = state.clips[next.clip];
  if (clip) { try { clip.video.currentTime = clampTime(clip, next.offset); } catch (_) {} }
}

function loop() {
  cancelAnimationFrame(state.rafId);
  const step = () => {
    if (!state.playing) return;
    const t = state.audio.currentTime;
    syncSegment(t);
    drawFrame();
    drawTimeline(t);
    updateTimeReadout(t);
    maybePreload(t);
    state.rafId = requestAnimationFrame(step);
  };
  state.rafId = requestAnimationFrame(step);
}

function startPlayback() {
  if (!canPlay()) return;
  state.playing = true;
  $('#play-btn').innerHTML = '&#10074;&#10074; Pause';
  state.segIdx = -1; // forza il re-sync al primo frame
  state.audio.play().catch(() => { state.playing = false; });
  loop();
}

function pausePlayback() {
  state.playing = false;
  cancelAnimationFrame(state.rafId);
  if (state.audio) state.audio.pause();
  state.clips.forEach(c => c.video.pause());
  $('#play-btn').innerHTML = '&#9654; Play';
}

function stopPlayback() {
  pausePlayback();
  if (state.audio) { try { state.audio.currentTime = 0; } catch (_) {} }
  state.segIdx = -1;
  state.preloadedSeg = -1;
  drawTimeline(0);
  updateTimeReadout(0);
}

function onEnded() {
  stopPlayback();
  if (canPlay()) drawPosterFrame();
}

/* Da fermo: mostra il frame giusto del montaggio al tempo corrente. */
function drawPosterFrame() {
  if (!state.segments.length || !state.clips.length) return;
  const t = currentT();
  state.segIdx = -1;
  const i = findSegment(t);
  const seg = state.segments[i];
  const clip = state.clips[seg.clip];
  state.segIdx = i;
  drawTimeline(t);
  updateTimeReadout(t);
  if (!clip || !clip.duration) return;
  const v = clip.video;
  v.addEventListener('seeked', () => { if (!state.playing) drawFrame(); }, { once: true });
  try { v.currentTime = clampTime(clip, seg.offset + (t - seg.start)); } catch (_) {}
  drawFrame();
}

/* ---------------- musica ---------------- */

async function loadSong(file) {
  if (!file) return;
  stopPlayback();
  state.res = null;
  updateInfo();
  setStatus('decoding audio…');
  showOverlay('Decoding audio…');
  try {
    const buf = await file.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const decoded = await ac.decodeAudioData(buf);
    ac.close();
    // resample a 22050 mono per il motore
    const len = Math.max(1, Math.ceil(decoded.duration * 22050));
    const oac = new OfflineAudioContext(1, len, 22050);
    const src = oac.createBufferSource();
    src.buffer = decoded;
    src.connect(oac.destination);
    src.start(0);
    const rendered = await oac.startRendering();
    state.y = rendered.getChannelData(0).slice();
    state.duration = decoded.duration;
    state.songName = file.name;

    if (state.audio) {
      state.audio.pause();
      state.audio.removeEventListener('ended', onEnded);
      state.audio.removeAttribute('src');
    }
    if (state.songUrl) URL.revokeObjectURL(state.songUrl);
    state.songUrl = URL.createObjectURL(file); // solo come src dell'<audio>
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = state.songUrl;
    audio.addEventListener('ended', onEnded);
    state.audio = audio;

    $('#song-row').textContent = file.name + ' — ' + fmtTime(decoded.duration);
    state.tlStatic = null;
    drawTimeline(0);
    updateTimeReadout(0);
    runAnalysis();
  } catch (err) {
    console.error(err);
    hideOverlay();
    setStatus('could not decode that audio — try another file');
  }
  refreshViewerState();
}

function runAnalysis() {
  if (!state.y) return;
  const job = ++state.job;
  state.analyzing = true;
  setStatus('detecting beats…');
  if (!state.res) showOverlay('Detecting beats…'); // in ri-analisi la preview resta visibile
  const y = state.y.slice(); // copia trasferibile, il master resta qui
  state.worker.postMessage({ job, y, sensitivity: state.sensitivity }, [y.buffer]);
}

function onWorkerMessage(e) {
  const { job, ok, res, error } = e.data;
  if (job !== state.job) return; // risultato di un'analisi superata
  state.analyzing = false;
  hideOverlay();
  if (!ok) {
    console.error(error);
    setStatus('analysis failed — try another song');
    return;
  }
  state.res = res;
  setStatus('engine ready — runs in your browser');
  rebuildSegments();
  renderTimelineStatic();
  drawTimeline(currentT());
  refreshViewerState();
  if (!state.playing) drawPosterFrame();
}

/* ---------------- clip ---------------- */

function addClips(files) {
  let added = false;
  for (const file of files) {
    const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name);
    if (!isVideo) continue;
    const url = URL.createObjectURL(file); // solo come src del <video>
    const video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    const clip = { id: ++state.clipSeq, name: file.name, url, video, duration: 0 };
    video.addEventListener('loadedmetadata', () => {
      clip.duration = video.duration || 0;
      renderChips();
      assignClips();
      refreshViewerState();
      if (!state.playing) drawPosterFrame();
    });
    video.addEventListener('error', () => {
      setStatus('could not decode ' + clip.name);
      removeClip(clip.id);
    });
    video.src = url;
    state.clips.push(clip);
    added = true;
  }
  if (!added) return;
  state.order = state.clips.map((_, i) => i);
  state.segIdx = -1;
  renderChips();
  assignClips();
  refreshViewerState();
}

function removeClip(id) {
  const i = state.clips.findIndex(c => c.id === id);
  if (i < 0) return;
  const clip = state.clips[i];
  clip.video.pause();
  clip.video.removeAttribute('src');
  URL.revokeObjectURL(clip.url);
  state.clips.splice(i, 1);
  state.order = state.clips.map((_, k) => k);
  state.segIdx = -1;
  state.preloadedSeg = -1;
  renderChips();
  assignClips();
  refreshViewerState();
  if (!state.clips.length) stopPlayback();
  else if (!state.playing) drawPosterFrame();
}

function renderChips() {
  const box = $('#clip-chips');
  box.textContent = '';
  state.clips.forEach(clip => {
    const el = document.createElement('span');
    el.className = 'clip-chip';
    const name = document.createElement('span');
    name.className = 'clip-name';
    name.textContent = clip.name;
    name.title = clip.name;
    const dur = document.createElement('span');
    dur.className = 'clip-dur';
    dur.textContent = clip.duration ? fmtTime(clip.duration) : '…';
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'chip-x';
    x.textContent = '✕';
    x.title = 'Remove clip';
    x.addEventListener('click', () => removeClip(clip.id));
    el.appendChild(name);
    el.appendChild(dur);
    el.appendChild(x);
    box.appendChild(el);
  });
}

/* ---------------- UI ---------------- */

function updateInfo() {
  const res = state.res;
  $('#info-bpm').textContent = res ? res.bpm.toFixed(1) : '—';
  $('#info-beats').textContent = res ? String(res.beats.length) : '—';
  $('#info-cuts').textContent = res ? String((res.cuts[state.pattern] || []).length) : '—';
}

function refreshViewerState() {
  const frame = $('.viewer-frame');
  const text = $('#empty-text');
  const hasSong = !!state.y;
  const hasClips = state.clips.length > 0;
  if (hasSong && state.res && hasClips) {
    frame.classList.add('has-source');
  } else {
    frame.classList.remove('has-source');
    if (!hasSong && !hasClips) {
      text.innerHTML = '<b>Load a song and a few clips to start</b><br>Everything runs in your browser — your files never leave your computer.';
    } else if (!hasSong) {
      text.innerHTML = '<b>Now load a song</b><br>The engine will detect the beats and cut your clips in time.';
    } else {
      text.innerHTML = '<b>Now add a few clips</b><br>They will be cut on the beats you see in the timeline below.';
    }
  }
  $('#play-btn').disabled = !canPlay();
  $('#shuffle-btn').disabled = state.clips.length < 2;
}

function setPattern(key) {
  if (state.pattern === key) return;
  state.pattern = key;
  document.querySelectorAll('.pattern-item').forEach(li => {
    li.classList.toggle('active', li.dataset.key === key);
  });
  rebuildSegments();
  renderTimelineStatic();
  drawTimeline(currentT());
  if (!state.playing) drawPosterFrame();
}

function wireDropzone(el, onFiles) {
  ['dragenter', 'dragover'].forEach(ev => el.addEventListener(ev, (e) => {
    e.preventDefault();
    el.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(ev => el.addEventListener(ev, (e) => {
    e.preventDefault();
    el.classList.remove('dragover');
  }));
  el.addEventListener('drop', (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) onFiles(files);
  });
}

function buildUI() {
  // pattern di taglio
  const list = $('#pattern-list');
  PATTERNS.forEach(p => {
    const li = document.createElement('li');
    li.className = 'pattern-item' + (p.key === state.pattern ? ' active' : '');
    li.dataset.key = p.key;
    const dot = document.createElement('span');
    dot.className = 'pattern-dot';
    const name = document.createElement('span');
    name.textContent = p.label;
    li.appendChild(dot);
    li.appendChild(name);
    li.addEventListener('click', () => setPattern(p.key));
    list.appendChild(li);
  });

  // sensitivity: label live, ri-analisi al rilascio
  const sens = $('#sens-slider');
  sens.addEventListener('input', () => {
    $('#sens-val').textContent = parseFloat(sens.value).toFixed(2);
  });
  sens.addEventListener('change', () => {
    state.sensitivity = parseFloat(sens.value);
    runAnalysis();
  });

  $('#play-btn').addEventListener('click', () => {
    if (state.playing) pausePlayback(); else startPlayback();
  });
  $('#shuffle-btn').addEventListener('click', shuffleClips);

  // sorgenti
  const musicInput = $('#music-input');
  musicInput.addEventListener('change', () => {
    loadSong(musicInput.files && musicInput.files[0]);
    musicInput.value = '';
  });
  const clipsInput = $('#clips-input');
  clipsInput.addEventListener('change', () => {
    if (clipsInput.files && clipsInput.files.length) addClips(clipsInput.files);
    clipsInput.value = '';
  });
  wireDropzone($('#dropzone-music'), (files) => {
    for (const f of files) {
      if (f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac)$/i.test(f.name)) {
        loadSong(f);
        return;
      }
    }
    setStatus('drop an audio file here — mp3, wav, m4a, aac');
  });
  wireDropzone($('#dropzone-clips'), addClips);

  // click sulla timeline = seek
  tlCanvas.addEventListener('pointerdown', (e) => {
    if (!state.audio || !state.duration) return;
    const rect = tlCanvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
    try { state.audio.currentTime = Math.min(frac * state.duration, state.duration - 0.05); } catch (_) {}
    state.segIdx = -1;
    state.preloadedSeg = -1;
    if (!state.playing) drawPosterFrame();
    else drawTimeline(state.audio.currentTime);
  });

  window.addEventListener('resize', () => {
    state.tlStatic = null;
    drawTimeline(currentT());
  });
}

/* ---------------- boot ---------------- */

function boot() {
  state.worker = new Worker('./worker.js');
  state.worker.onmessage = onWorkerMessage;
  state.worker.onerror = (err) => {
    console.error(err);
    state.analyzing = false;
    hideOverlay();
    setStatus('engine failed to load — reload the page');
  };
  buildUI();
  drawTimeline(0);
  refreshViewerState();
  setStatus('engine ready — runs in your browser');
}

boot();

})();
