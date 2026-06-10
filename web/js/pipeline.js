/**
 * pipeline.js — pure CV core for 3D document capture.
 *
 * Framework-free. Requires a ready `cv` (OpenCV.js) instance passed to init().
 * Works in the browser and in Node (for headless tests).
 *
 * Coordinate conventions:
 *  - "frame" space: pixels of the analyzed video frame.
 *  - "UV" space: rectified document raster, UV_W x UV_H (ID-1 at 5 px/mm).
 *  - Corners are always ordered [tl, tr, br, bl] in frame space.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DocPipeline = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let cv = null;

  // ---- ID-1 geometry ----
  const DOC_W_MM = 85.6, DOC_H_MM = 53.98;
  const PX_PER_MM = 5;
  const UV_W = Math.round(DOC_W_MM * PX_PER_MM);   // 428
  const UV_H = Math.round(DOC_H_MM * PX_PER_MM);   // 270

  // Semantic zones of a generic ID-1 card (fractions of UV space).
  // critical: capture cannot complete while the zone is glared/blurred.
  const ZONES = {
    header:  { x: 0.00, y: 0.00, w: 1.00, h: 0.17, critical: false },
    photo:   { x: 0.03, y: 0.22, w: 0.27, h: 0.55, critical: true  },
    fields:  { x: 0.34, y: 0.20, w: 0.63, h: 0.55, critical: true  },
    mrz:     { x: 0.00, y: 0.79, w: 1.00, h: 0.21, critical: true  },
  };

  const CONFIG = {
    analysisWidth: 480,        // downscale width for detection
    cannyLo: 40, cannyHi: 120,
    minAreaFrac: 0.05,         // quad must cover >= 5% of frame
    maxAreaFrac: 0.95,
    approxEpsFrac: 0.03,       // approxPolyDP epsilon as fraction of perimeter
    aspectMin: 1.15, aspectMax: 2.6,    // ID-1 = 1.586; tilt compresses apparent aspect
    glareValMin: 246,          // HSV V threshold (true glare is blown out, not just bright)
    glareSatMax: 60,           // HSV S threshold
    glareZoneFracBad: 0.04,    // zone is "glared" if > 4% of its pixels glare
    sharpZoneMin: 150,         // Laplacian variance threshold per zone (calibrated by tests)
    sharpAbsMin: 40,           // atlas: absolute floor for a zone to ever count as sharp
    sharpRelFrac: 0.3,         // atlas: zone is sharp if score > rel-frac of best seen for that zone
    atlasCols: 16, atlasRows: 10,
    atlasGlareCellFrac: 0.06,  // cell glared if >6% pixels glare
    focalFovDeg: 68,           // assumed horizontal FOV when intrinsics unknown
  };

  function init(cvInstance) { cv = cvInstance; }

  // ---------- helpers ----------
  function orderCorners(pts) {
    // pts: [{x,y} x4] any order -> [tl, tr, br, bl]
    const bySum = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y));
    const tl = bySum[0], br = bySum[3];
    const byDiff = [...pts].sort((a, b) => (a.y - a.x) - (b.y - b.x));
    const tr = byDiff[0], bl = byDiff[3];
    return [tl, tr, br, bl];
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function quadArea(c) {
    // shoelace on ordered corners
    let s = 0;
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
  }

  /**
   * Detect the document quadrangle in an RGBA frame Mat.
   * Tries Canny edges first; falls back to Otsu binarization (handles soft
   * edges / low local contrast where Canny fragments).
   * Returns { corners:[tl,tr,br,bl] in FULL-frame px, score, areaFrac } or null.
   */
  function detectQuad(srcRGBA, cfg = CONFIG) {
    const fw = srcRGBA.cols, fh = srcRGBA.rows;
    const scale = cfg.analysisWidth / fw;
    const aw = Math.round(fw * scale), ah = Math.round(fh * scale);

    const small = new cv.Mat(), gray = new cv.Mat();
    cv.resize(srcRGBA, small, new cv.Size(aw, ah), 0, 0, cv.INTER_AREA);
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    let best = null;

    // strategy 1: Canny edges
    {
      const edges = new cv.Mat();
      cv.Canny(gray, edges, cfg.cannyLo, cfg.cannyHi);
      cv.dilate(edges, edges, kernel);
      best = bestQuadFromBinary(edges, aw, ah, cfg);
      edges.delete();
    }
    // strategy 2: Otsu threshold (bright card on darker surface or vice versa)
    if (!best) {
      const bin = new cv.Mat();
      cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      best = bestQuadFromBinary(bin, aw, ah, cfg);
      if (!best) {
        cv.bitwise_not(bin, bin);
        best = bestQuadFromBinary(bin, aw, ah, cfg);
      }
      bin.delete();
    }
    kernel.delete(); small.delete(); gray.delete();

    if (!best) return null;
    let corners = best.ordered.map(p => ({ x: p.x / scale, y: p.y / scale }));
    corners = refineCorners(srcRGBA, corners);
    return { corners, score: best.score, areaFrac: best.areaFrac };
  }

  /** Find the best card-like quad in a binary/edge image. */
  function bestQuadFromBinary(binary, aw, ah, cfg) {
    const contours = new cv.MatVector(), hier = new cv.Mat();
    cv.findContours(binary, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let best = null;
    const frameArea = aw * ah;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, cfg.approxEpsFrac * peri, true);
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const pts = [];
        for (let j = 0; j < 4; j++) {
          pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
        }
        const ordered = orderCorners(pts);
        const area = quadArea(ordered);
        const areaFrac = area / frameArea;
        if (areaFrac >= cfg.minAreaFrac && areaFrac <= cfg.maxAreaFrac) {
          const wTop = dist(ordered[0], ordered[1]), wBot = dist(ordered[3], ordered[2]);
          const hL = dist(ordered[0], ordered[3]), hR = dist(ordered[1], ordered[2]);
          const aspect = ((wTop + wBot) / 2) / Math.max(1, (hL + hR) / 2);
          if (aspect >= cfg.aspectMin && aspect <= cfg.aspectMax) {
            const cArea = cv.contourArea(cnt);
            const rectangularity = cArea / Math.max(1, area);
            const score = areaFrac * rectangularity;
            if (!best || score > best.score) best = { ordered, score, areaFrac };
          }
        }
      }
      approx.delete(); cnt.delete();
    }
    contours.delete(); hier.delete();
    return best;
  }

  /** Sub-pixel corner refinement on the full-res frame (corrects the
   *  outward bias introduced by Canny+dilate at analysis scale). */
  function refineCorners(srcRGBA, corners) {
    try {
      const gray = new cv.Mat();
      cv.cvtColor(srcRGBA, gray, cv.COLOR_RGBA2GRAY);
      const flat = [];
      for (const p of corners) flat.push(p.x, p.y);
      const pts = cv.matFromArray(4, 1, cv.CV_32FC2, flat);
      const criteria = new cv.TermCriteria(3 /* EPS|COUNT */, 30, 0.01);
      cv.cornerSubPix(gray, pts, new cv.Size(11, 11), new cv.Size(-1, -1), criteria);
      const out = [];
      for (let i = 0; i < 4; i++) out.push({ x: pts.data32F[i * 2], y: pts.data32F[i * 2 + 1] });
      pts.delete(); gray.delete();
      // sanity: refinement must not move a corner more than 20 px
      for (let i = 0; i < 4; i++) {
        if (dist(out[i], corners[i]) > 20) return corners;
      }
      return out;
    } catch (e) {
      return corners;
    }
  }

  /** Rectify the document into an arbitrary-resolution raster. */
  function rectifyTo(srcRGBA, corners, outW, outH) {
    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      corners[0].x, corners[0].y, corners[1].x, corners[1].y,
      corners[2].x, corners[2].y, corners[3].x, corners[3].y,
    ]);
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, outW, 0, outW, outH, 0, outH,
    ]);
    const H = cv.getPerspectiveTransform(srcTri, dstTri);
    const uv = new cv.Mat();
    cv.warpPerspective(srcRGBA, uv, H, new cv.Size(outW, outH), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    srcTri.delete(); dstTri.delete(); H.delete();
    return uv;
  }

  /** Rectify the document into UV analysis space. Returns a new RGBA Mat (UV_W x UV_H). */
  function rectify(srcRGBA, corners) {
    return rectifyTo(srcRGBA, corners, UV_W, UV_H);
  }

  /**
   * Glare analysis in UV space.
   * Returns { mask: cv.Mat (CV_8U, caller deletes), frac, perZone:{zone:{frac,glared}}, centroidUV:{u,v}|null }
   */
  function analyzeGlare(uvRGBA, cfg = CONFIG) {
    const rgb = new cv.Mat(), hsv = new cv.Mat(), mask = new cv.Mat();
    cv.cvtColor(uvRGBA, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    const lo = cv.matFromArray(1, 3, cv.CV_8U, [0, 0, cfg.glareValMin]);
    const hi = cv.matFromArray(1, 3, cv.CV_8U, [180, cfg.glareSatMax, 255]);
    const loMat = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(0, 0, cfg.glareValMin));
    const hiMat = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), new cv.Scalar(180, cfg.glareSatMax, 255));
    cv.inRange(hsv, loMat, hiMat, mask);
    // opening drops thin white structures (gaps between text lines, edges of
    // white print areas) — true glare blobs are large and survive; closing
    // then solidifies them
    const kOpen = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(11, 11));
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kOpen);
    const kClose = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kClose);
    kOpen.delete(); kClose.delete(); lo.delete(); hi.delete(); loMat.delete(); hiMat.delete(); rgb.delete(); hsv.delete();

    const total = mask.rows * mask.cols;
    const frac = cv.countNonZero(mask) / total;

    const perZone = {};
    for (const [name, z] of Object.entries(ZONES)) {
      const r = new cv.Rect(
        Math.round(z.x * UV_W), Math.round(z.y * UV_H),
        Math.round(z.w * UV_W), Math.round(z.h * UV_H));
      const roi = mask.roi(r);
      const zf = cv.countNonZero(roi) / (r.width * r.height);
      perZone[name] = { frac: zf, glared: zf > cfg.glareZoneFracBad };
      roi.delete();
    }

    // centroid of glare (for coaching direction)
    let centroidUV = null;
    if (frac > 0.002) {
      const m = cv.moments(mask, true);
      if (m.m00 > 0) centroidUV = { u: m.m10 / m.m00 / UV_W, v: m.m01 / m.m00 / UV_H };
    }
    return { mask, frac, perZone, centroidUV };
  }

  /**
   * Sharpness analysis in UV space (Laplacian variance per zone).
   * Returns { overall, perZone:{zone:{score,sharp}} }
   */
  function analyzeSharpness(uvRGBA, cfg = CONFIG) {
    const gray = new cv.Mat(), lap = new cv.Mat();
    cv.cvtColor(uvRGBA, gray, cv.COLOR_RGBA2GRAY);
    cv.Laplacian(gray, lap, cv.CV_64F);

    function lapVar(mat) {
      const mean = new cv.Mat(), std = new cv.Mat();
      cv.meanStdDev(mat, mean, std);
      const v = std.data64F[0] * std.data64F[0];
      mean.delete(); std.delete();
      return v;
    }
    const overall = lapVar(lap);
    const perZone = {};
    for (const [name, z] of Object.entries(ZONES)) {
      const r = new cv.Rect(
        Math.round(z.x * UV_W), Math.round(z.y * UV_H),
        Math.round(z.w * UV_W), Math.round(z.h * UV_H));
      const roi = lap.roi(r);
      const s = lapVar(roi);
      perZone[name] = { score: s, sharp: s >= cfg.sharpZoneMin };
      roi.delete();
    }
    gray.delete(); lap.delete();
    return { overall, perZone };
  }

  /**
   * 6DoF pose from the 4 corners + assumed intrinsics.
   * Returns { rvec:[3], tvec:[3] (mm), normalCam:[3], tiltDeg, distanceMm } or null.
   */
  function estimatePose(corners, frameW, frameH, cfg = CONFIG) {
    const f = (frameW / 2) / Math.tan((cfg.focalFovDeg * Math.PI / 180) / 2);
    const K = cv.matFromArray(3, 3, cv.CV_64F, [f, 0, frameW / 2, 0, f, frameH / 2, 0, 0, 1]);
    const distCoeffs = cv.Mat.zeros(4, 1, cv.CV_64F);
    // object points in mm, document frame: origin center, X right, Y down, Z out of card
    const hw = DOC_W_MM / 2, hh = DOC_H_MM / 2;
    const obj = cv.matFromArray(4, 1, cv.CV_32FC3, [
      -hw, -hh, 0,  hw, -hh, 0,  hw, hh, 0,  -hw, hh, 0,
    ]);
    const img = cv.matFromArray(4, 1, cv.CV_32FC2, [
      corners[0].x, corners[0].y, corners[1].x, corners[1].y,
      corners[2].x, corners[2].y, corners[3].x, corners[3].y,
    ]);
    const rvec = new cv.Mat(), tvec = new cv.Mat();
    let ok = false;
    try {
      const flag = (cv.SOLVEPNP_IPPE !== undefined) ? cv.SOLVEPNP_IPPE : 0;
      ok = cv.solvePnP(obj, img, K, distCoeffs, rvec, tvec, false, flag);
    } catch (e) {
      try { ok = cv.solvePnP(obj, img, K, distCoeffs, rvec, tvec, false, 0); } catch (e2) { ok = false; }
    }
    let out = null;
    if (ok) {
      const R = new cv.Mat();
      cv.Rodrigues(rvec, R);
      // document normal (z axis of doc frame) in camera coords = R * [0,0,1]
      const nz = [R.data64F[2], R.data64F[5], R.data64F[8]];
      const tv = [tvec.data64F[0], tvec.data64F[1], tvec.data64F[2]];
      const distMm = Math.hypot(...tv);
      // tilt = angle between doc normal and camera view axis (0 = frontoparallel)
      const cosT = Math.abs(nz[2]) / Math.hypot(...nz);
      const tiltDeg = Math.acos(Math.min(1, cosT)) * 180 / Math.PI;
      out = { rvec: [rvec.data64F[0], rvec.data64F[1], rvec.data64F[2]], tvec: tv, normalCam: nz, tiltDeg, distanceMm: distMm };
      R.delete();
    }
    K.delete(); distCoeffs.delete(); obj.delete(); img.delete(); rvec.delete(); tvec.delete();
    return out;
  }

  /** Quality atlas: per-UV-cell accumulator across frames.
   *  Sharpness gating is adaptive: a zone counts as sharp relative to the
   *  best score seen for that zone this session (self-calibrates to the
   *  device/lighting instead of trusting absolute thresholds). */
  class Atlas {
    constructor(cfg = CONFIG) {
      this.cfg = cfg;
      this.cols = cfg.atlasCols; this.rows = cfg.atlasRows;
      this.cells = new Array(this.cols * this.rows).fill(0); // 0=unseen,1=clean
      this.zoneState = {};
      this.zoneMax = {};
      for (const name of Object.keys(ZONES)) {
        this.zoneState[name] = { clean: false };
        this.zoneMax[name] = 0;
      }
    }
    zoneSharp(name, sharp) {
      const score = sharp.perZone[name].score;
      if (score > this.zoneMax[name]) this.zoneMax[name] = score;
      const thr = Math.max(this.cfg.sharpAbsMin, this.cfg.sharpRelFrac * this.zoneMax[name]);
      return score >= thr;
    }
    /** Update from one frame's UV analyses. glare.mask must still be alive. */
    update(glare, sharp) {
      const zoneSharpNow = {};
      for (const name of Object.keys(ZONES)) zoneSharpNow[name] = this.zoneSharp(name, sharp);
      const cw = UV_W / this.cols, ch = UV_H / this.rows;
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const i = r * this.cols + c;
          if (this.cells[i]) continue;
          const rect = new cv.Rect(Math.round(c * cw), Math.round(r * ch), Math.floor(cw), Math.floor(ch));
          const roi = glare.mask.roi(rect);
          const gf = cv.countNonZero(roi) / (rect.width * rect.height);
          roi.delete();
          if (gf <= this.cfg.atlasGlareCellFrac) {
            // cell zone sharpness: use the zone the cell center falls into
            const u = (c + 0.5) / this.cols, v = (r + 0.5) / this.rows;
            const zname = zoneAt(u, v);
            const zsharp = zname ? zoneSharpNow[zname] : sharp.overall >= this.cfg.sharpAbsMin;
            if (zsharp) this.cells[i] = 1;
          }
        }
      }
      // zone completion = all cells whose center is in the zone are clean
      for (const [name, z] of Object.entries(ZONES)) {
        let all = true;
        for (let r = 0; r < this.rows && all; r++) {
          for (let c = 0; c < this.cols && all; c++) {
            const u = (c + 0.5) / this.cols, v = (r + 0.5) / this.rows;
            if (u >= z.x && u <= z.x + z.w && v >= z.y && v <= z.y + z.h) {
              if (!this.cells[r * this.cols + c]) all = false;
            }
          }
        }
        this.zoneState[name].clean = all;
      }
    }
    get fillFrac() { return this.cells.reduce((a, b) => a + b, 0) / this.cells.length; }
    get criticalComplete() {
      return Object.entries(ZONES).every(([n, z]) => !z.critical || this.zoneState[n].clean);
    }
  }

  function zoneAt(u, v) {
    for (const [name, z] of Object.entries(ZONES)) {
      if (u >= z.x && u <= z.x + z.w && v >= z.y && v <= z.y + z.h) return name;
    }
    return null;
  }

  /** Single coaching decision from one frame's analysis. Returns {code, text} */
  function coach({ quad, pose, glare, sharp, atlas, motion }) {
    if (!quad) return { code: 'show', text: 'Show your ID.' };
    if (quad.areaFrac < 0.10) return { code: 'closer', text: 'A little closer.' };
    if (motion > 0.025) return { code: 'steady', text: 'Hold steady.' };
    if (glare) {
      for (const [name, z] of Object.entries(ZONES)) {
        if (z.critical && glare.perZone[name].glared && !(atlas && atlas.zoneState[name].clean)) {
          const dir = glare.centroidUV && glare.centroidUV.v > 0.5 ? 'Tilt the bottom away' : 'Tilt the top away';
          return { code: 'glare', text: dir, zone: name };
        }
      }
    }
    if (sharp && sharp.overall < CONFIG.sharpZoneMin * 0.6) return { code: 'blur', text: 'Hold steady.' };
    return { code: 'ok', text: '' };
  }

  return {
    init, CONFIG, ZONES, UV_W, UV_H, DOC_W_MM, DOC_H_MM,
    orderCorners, detectQuad, rectify, rectifyTo, analyzeGlare, analyzeSharpness,
    estimatePose, Atlas, zoneAt, coach,
  };
}));
