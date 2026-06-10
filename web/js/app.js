/**
 * app.js — capture experience driver.
 *
 * Wires the CV pipeline (pipeline.js) to the UI: camera loop, state machine
 * (SEARCHING → LOCKED → COMPLETE), world-tracking outline, atlas fill,
 * zone-level glare callouts, coaching, and best-frame capture.
 *
 * Demo mode (?demo=1 or camera unavailable): renders a synthetic moving card
 * with traveling glare on an offscreen canvas and runs the identical pipeline.
 */
'use strict';
/* global cv, DocPipeline */

const P = DocPipeline;

// ---------- DOM ----------
const els = {};
for (const id of ['video', 'overlay', 'status', 'statusDot', 'coach', 'thumb', 'thumbImg',
  'startBtn', 'startPane', 'demoBtn', 'hud', 'donePane', 'doneThumb', 'restartBtn', 'metrics']) {
  els[id] = document.getElementById(id);
}

const state = {
  mode: null,              // 'camera' | 'demo'
  phase: 'SEARCHING',      // SEARCHING | LOCKED | COMPLETE
  corners: null,           // smoothed corners (display space)
  lastCorners: null,
  stableFrames: 0,
  atlas: null,
  pose: null,
  bestFrame: { score: -1, canvas: null },
  glareZones: [],
  coachMsg: { code: 'show', text: 'Show your ID.' },
  frameCount: 0,
  t0: 0,
  procW: 0, procH: 0,      // processing frame size
  demo: null,
  lastInferMs: 0,
};

// ---------- boot ----------
let cvReady = false, started = false;
cv.onRuntimeInitialized = () => {
  cvReady = true;
  P.init(cv);
  els.startBtn.disabled = false;
  els.demoBtn.disabled = false;
  els.startBtn.textContent = 'Start camera';
};

els.startBtn.addEventListener('click', () => start('camera'));
els.demoBtn.addEventListener('click', () => start('demo'));
els.restartBtn.addEventListener('click', () => location.reload());

const urlParams = new URLSearchParams(location.search);
if (urlParams.get('demo') === '1') {
  const t = setInterval(() => { if (cvReady) { clearInterval(t); start('demo'); } }, 100);
}

async function start(mode) {
  if (started || !cvReady) return;
  state.mode = mode;
  if (mode === 'camera') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      els.video.srcObject = stream;
      await els.video.play();
    } catch (e) {
      console.warn('camera unavailable, falling back to demo:', e);
      state.mode = 'demo';
    }
  }
  if (state.mode === 'demo') initDemo();
  started = true;
  state.t0 = performance.now();
  state.atlas = new P.Atlas();
  els.startPane.classList.add('hidden');
  els.hud.classList.remove('hidden');
  requestAnimationFrame(loop);
}

// ---------- demo scene (synthetic card, moving pose + traveling glare) ----------
function initDemo() {
  const c = document.createElement('canvas');
  c.width = 1280; c.height = 720;
  state.demo = { canvas: c, ctx: c.getContext('2d', { willReadFrequently: true }), t: 0 };
  els.video.style.display = 'none';
}

function drawDemoFrame() {
  const { ctx, canvas } = state.demo;
  const t = (state.demo.t += 1 / 60);
  const W = canvas.width, H = canvas.height;
  // desk background
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#3a3733'); g.addColorStop(1, '#181715');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // card pose drifts gently; user "tilts" at t>4s so glare slides off
  const cx = W / 2 + Math.sin(t * 0.6) * 14;
  const cy = H / 2 + Math.cos(t * 0.45) * 10;
  const tilt = Math.min(1, Math.max(0, (t - 4) / 2.5));        // 0 → 1 after 4 s
  const persp = 0.10 - tilt * 0.07;                              // top-edge pinch
  const cw = 560, ch = 352;
  const quad = [
    { x: cx - cw / 2 * (1 - persp), y: cy - ch / 2 + persp * 40 },
    { x: cx + cw / 2 * (1 - persp), y: cy - ch / 2 - persp * 10 },
    { x: cx + cw / 2, y: cy + ch / 2 },
    { x: cx - cw / 2, y: cy + ch / 2 },
  ];

  // card via 2D transform approximation (good enough to exercise the pipeline)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(quad[0].x, quad[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(quad[i].x, quad[i].y);
  ctx.closePath();
  ctx.clip();
  // body
  ctx.fillStyle = '#e3eae7'; ctx.fillRect(cx - cw / 2, cy - ch / 2, cw, ch);
  // header
  ctx.fillStyle = '#699b8e'; ctx.fillRect(cx - cw / 2, cy - ch / 2, cw, ch * 0.17);
  ctx.fillStyle = '#143229'; ctx.font = 'bold 22px monospace';
  ctx.fillText('REPUBLIC OF VERIDIA', cx - cw / 2 + 18, cy - ch / 2 + 40);
  // photo
  ctx.fillStyle = '#96aaa5';
  ctx.fillRect(cx - cw / 2 + cw * 0.04, cy - ch / 2 + ch * 0.24, cw * 0.24, ch * 0.50);
  // fields
  ctx.fillStyle = '#1f3a34'; ctx.font = '17px monospace';
  const fx = cx - cw / 2 + cw * 0.34, fy0 = cy - ch / 2 + ch * 0.30;
  ['SURNAME  MOKOENA', 'GIVEN    THANDI A', 'DOB      14 03 1992', 'DOC NO   VRD482 95513', 'EXPIRY   02 11 2033']
    .forEach((s, i) => ctx.fillText(s, fx, fy0 + i * ch * 0.10));
  // MRZ
  ctx.fillStyle = '#f0f0ee';
  ctx.fillRect(cx - cw / 2, cy + ch / 2 - ch * 0.21, cw, ch * 0.21);
  ctx.fillStyle = '#22302c'; ctx.font = 'bold 19px monospace';
  ctx.fillText('I<VRDMOKOENA<<THANDI<A<<<<<<<<<<', cx - cw / 2 + 8, cy + ch / 2 - ch * 0.105);
  ctx.fillText('VRD4829551<3VRD9203148F3311025<4', cx - cw / 2 + 8, cy + ch / 2 - 8);

  // traveling glare: starts on the MRZ, slides off as "the user tilts"
  const gx = cx + Math.sin(t * 0.5) * 30;
  const gy = (cy + ch / 2 - ch * 0.11) + tilt * (ch * 0.9);   // moves down/off with tilt
  const rad = 95;
  const rg = ctx.createRadialGradient(gx, gy, 0, gx, gy, rad);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.45, 'rgba(255,253,246,0.95)');
  rg.addColorStop(1, 'rgba(255,250,235,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(gx - rad, gy - rad, rad * 2, rad * 2);
  ctx.restore();
  return canvas;
}

// ---------- main loop ----------
const work = { src: null, cap: null };

function grabFrame() {
  let w, h, source;
  if (state.mode === 'demo') {
    source = drawDemoFrame();
    w = source.width; h = source.height;
  } else {
    source = els.video;
    w = source.videoWidth; h = source.videoHeight;
    if (!w) return null;
  }
  if (!work.cap || work.cap.width !== w) {
    work.cap = document.createElement('canvas');
    work.cap.width = w; work.cap.height = h;
    work.ctx = work.cap.getContext('2d', { willReadFrequently: true });
  }
  work.ctx.drawImage(source, 0, 0, w, h);
  const imgData = work.ctx.getImageData(0, 0, w, h);
  if (work.src) work.src.delete();
  work.src = cv.matFromImageData(imgData);
  state.procW = w; state.procH = h;
  return work.src;
}

function loop() {
  if (state.phase === 'COMPLETE') return;
  const src = grabFrame();
  if (src) {
    const tA = performance.now();
    processFrame(src);
    state.lastInferMs = performance.now() - tA;
  }
  render();
  requestAnimationFrame(loop);
}

function processFrame(src) {
  state.frameCount++;
  const quad = P.detectQuad(src);

  // motion = mean corner displacement / frame width
  let motion = 0;
  if (quad && state.lastCorners) {
    for (let i = 0; i < 4; i++) {
      motion += Math.hypot(quad.corners[i].x - state.lastCorners[i].x,
                           quad.corners[i].y - state.lastCorners[i].y);
    }
    motion /= 4 * state.procW;
  }
  state.lastCorners = quad ? quad.corners : null;

  if (!quad) {
    state.stableFrames = 0;
    if (state.phase === 'LOCKED') state.phase = 'SEARCHING';
    state.corners = null;
    state.coachMsg = P.coach({ quad: null });
    return;
  }

  // exponential smoothing for display corners
  if (!state.corners) state.corners = quad.corners.map(p => ({ ...p }));
  else {
    const a = 0.45;
    for (let i = 0; i < 4; i++) {
      state.corners[i].x += a * (quad.corners[i].x - state.corners[i].x);
      state.corners[i].y += a * (quad.corners[i].y - state.corners[i].y);
    }
  }

  state.stableFrames = motion < 0.02 ? state.stableFrames + 1 : 0;
  if (state.phase === 'SEARCHING' && state.stableFrames >= 4) {
    state.phase = 'LOCKED';
    haptic(30);
  }

  // full analysis only when locked (and every frame — preview-res is cheap)
  let glare = null, sharp = null;
  if (state.phase === 'LOCKED') {
    const uv = P.rectify(src, quad.corners);
    glare = P.analyzeGlare(uv);
    sharp = P.analyzeSharpness(uv);
    state.pose = P.estimatePose(quad.corners, state.procW, state.procH);
    state.atlas.update(glare, sharp);

    state.glareZones = Object.entries(glare.perZone)
      .filter(([n, z]) => z.glared && P.ZONES[n].critical && !state.atlas.zoneState[n].clean)
      .map(([n]) => n);

    // best-frame tracking: prefer frames with no critical glare + max sharpness
    const criticalGlare = Object.entries(glare.perZone).some(([n, z]) => z.glared && P.ZONES[n].critical);
    const score = (criticalGlare ? 0 : 1000000) + sharp.overall;
    if (score > state.bestFrame.score) {
      state.bestFrame.score = score;
      const c = document.createElement('canvas');
      c.width = P.UV_W; c.height = P.UV_H;
      cv.imshow(c, uv);
      state.bestFrame.canvas = c;
    }

    state.coachMsg = P.coach({ quad, pose: state.pose, glare, sharp, atlas: state.atlas, motion });
    glare.mask.delete();
    uv.delete();

    if (state.atlas.criticalComplete && state.atlas.fillFrac > 0.9) {
      complete();
    }
  } else {
    state.coachMsg = P.coach({ quad, motion });
  }
}

function complete() {
  state.phase = 'COMPLETE';
  els.coach.classList.remove('show');
  haptic([60, 40, 120]);
  const secs = ((performance.now() - state.t0) / 1000).toFixed(1);
  els.status.textContent = `Captured in ${secs}s`;
  document.body.classList.add('complete');
  if (state.bestFrame.canvas) {
    els.doneThumb.innerHTML = '';
    state.bestFrame.canvas.classList.add('rectified');
    els.doneThumb.appendChild(state.bestFrame.canvas);
  }
  setTimeout(() => {
    els.donePane.classList.remove('hidden');
  }, 650);
}

function haptic(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// ---------- rendering ----------
function render() {
  const cnv = els.overlay;
  const dw = cnv.clientWidth, dh = cnv.clientHeight;
  if (cnv.width !== dw * devicePixelRatio) {
    cnv.width = dw * devicePixelRatio; cnv.height = dh * devicePixelRatio;
  }
  const ctx = cnv.getContext('2d');
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, dw, dh);

  // cover-fit transform from processing space to display space — must match
  // the video element's object-fit:cover so the overlay stays glued
  const scale = Math.max(dw / state.procW, dh / state.procH) || 1;
  const ox = (dw - state.procW * scale) / 2, oy = (dh - state.procH * scale) / 2;

  // demo mode: paint the synthetic scene as the "camera feed"
  if (state.mode === 'demo' && state.demo) {
    ctx.drawImage(state.demo.canvas, ox, oy, state.procW * scale, state.procH * scale);
  }

  // status + coach
  const phaseText = {
    SEARCHING: 'Looking for a document…',
    LOCKED: state.glareZones.length ? `Glare over ${state.glareZones.join(', ').toUpperCase()} zone` : 'Capturing',
    COMPLETE: els.status.textContent,
  }[state.phase];
  if (state.phase !== 'COMPLETE') els.status.textContent = phaseText;
  els.statusDot.className = 'dot ' + (state.phase === 'LOCKED' ? (state.glareZones.length ? 'amber' : 'teal') : '');

  const msg = state.coachMsg;
  if (msg && msg.text && state.phase !== 'COMPLETE') {
    els.coach.textContent = msg.text;
    els.coach.classList.add('show');
    els.coach.classList.toggle('glareMsg', msg.code === 'glare');
  } else {
    els.coach.classList.remove('show');
  }

  if (!state.corners) { renderMetrics(); return; }

  // map processing-space corners to display space (cover transform)
  const c = state.corners.map(p => ({ x: p.x * scale + ox, y: p.y * scale + oy }));

  // atlas fill (clipped to quad, fills bottom-up)
  if (state.phase !== 'SEARCHING') {
    const fill = state.atlas.fillFrac;
    if (fill > 0) {
      ctx.save();
      quadPath(ctx, c);
      ctx.clip();
      const minY = Math.min(...c.map(p => p.y)), maxY = Math.max(...c.map(p => p.y));
      const yTop = maxY - (maxY - minY) * fill;
      ctx.fillStyle = 'rgba(57,230,195,0.14)';
      ctx.fillRect(0, yTop, dw, maxY - yTop);
      ctx.strokeStyle = 'rgba(57,230,195,0.65)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, yTop); ctx.lineTo(dw, yTop); ctx.stroke();
      ctx.restore();
    }
  }

  // glare zone callout (project zone rect through the quad bilinearly)
  for (const zn of state.glareZones) {
    const z = P.ZONES[zn];
    const zc = [
      uvToScreen(z.x, z.y, c), uvToScreen(z.x + z.w, z.y, c),
      uvToScreen(z.x + z.w, z.y + z.h, c), uvToScreen(z.x, z.y + z.h, c),
    ];
    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = 'rgba(255,179,71,0.95)';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(255,179,71,0.7)'; ctx.shadowBlur = 14;
    quadPath(ctx, zc); ctx.stroke();
    ctx.restore();
  }

  // the world-anchored outline
  const lockColor = state.phase === 'COMPLETE' ? '#39e6c3'
    : state.phase === 'LOCKED' ? (state.glareZones.length ? '#ffb347' : '#39e6c3')
    : 'rgba(57,230,195,0.45)';
  ctx.save();
  ctx.strokeStyle = lockColor;
  ctx.lineWidth = state.phase === 'LOCKED' ? 3 : 2;
  ctx.shadowColor = lockColor; ctx.shadowBlur = 18;
  ctx.lineJoin = 'round';
  quadPath(ctx, expandQuad(c, 8));
  ctx.stroke();
  ctx.restore();

  renderMetrics();
}

function quadPath(ctx, c) {
  ctx.beginPath();
  ctx.moveTo(c[0].x, c[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
  ctx.closePath();
}
function expandQuad(c, px) {
  const cx = (c[0].x + c[1].x + c[2].x + c[3].x) / 4;
  const cy = (c[0].y + c[1].y + c[2].y + c[3].y) / 4;
  return c.map(p => {
    const d = Math.hypot(p.x - cx, p.y - cy);
    const k = (d + px) / d;
    return { x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k };
  });
}
/** bilinear interpolation of UV position inside the displayed quad */
function uvToScreen(u, v, c) {
  const top = { x: c[0].x + (c[1].x - c[0].x) * u, y: c[0].y + (c[1].y - c[0].y) * u };
  const bot = { x: c[3].x + (c[2].x - c[3].x) * u, y: c[3].y + (c[2].y - c[3].y) * u };
  return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
}

function renderMetrics() {
  if (!els.metrics) return;
  const p = state.pose;
  els.metrics.textContent = [
    `proc ${state.lastInferMs.toFixed(0)} ms`,
    p ? `tilt ${p.tiltDeg.toFixed(0)}°  dist ${(p.distanceMm / 10).toFixed(0)} cm` : '',
    state.atlas ? `atlas ${(state.atlas.fillFrac * 100).toFixed(0)}%` : '',
  ].filter(Boolean).join('   ·   ');
}
