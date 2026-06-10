/**
 * Headless pipeline tests. Renders synthetic ID-card frames with OpenCV
 * (no browser, no canvas), runs the pipeline, asserts against ground truth.
 *
 * Run: cd test && npm install && node pipeline.test.js
 */
'use strict';
const path = require('path');
global.cv = require('@techstark/opencv-js');
const P = require(path.join(__dirname, '..', 'web', 'js', 'pipeline.js'));

const GREEN = s => `\x1b[32m${s}\x1b[0m`, RED = s => `\x1b[31m${s}\x1b[0m`;
let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(GREEN('  ✓ ') + name + (detail ? `  (${detail})` : '')); }
  else { fail++; console.log(RED('  ✗ ') + name + (detail ? `  (${detail})` : '')); }
}

/** Draw a synthetic ID-1 card texture in UV space (RGBA). */
function makeCardTexture(cv) {
  const W = P.UV_W * 2, H = P.UV_H * 2; // 2x for crisper warps
  const tex = new cv.Mat(H, W, cv.CV_8UC4, new cv.Scalar(225, 234, 230, 255));
  // header band (mid-tone so the card's top edge stays visible on dark surfaces)
  cv.rectangle(tex, new cv.Point(0, 0), new cv.Point(W, Math.round(H * 0.17)), new cv.Scalar(105, 155, 142, 255), -1);
  cv.putText(tex, 'REPUBLIC OF VERIDIA', new cv.Point(20, Math.round(H * 0.115)), cv.FONT_HERSHEY_SIMPLEX, 0.8, new cv.Scalar(20, 50, 42, 255), 2);
  // photo box
  cv.rectangle(tex, new cv.Point(Math.round(W * 0.04), Math.round(H * 0.24)), new cv.Point(Math.round(W * 0.28), Math.round(H * 0.74)), new cv.Scalar(150, 170, 165, 255), -1);
  cv.rectangle(tex, new cv.Point(Math.round(W * 0.04), Math.round(H * 0.24)), new cv.Point(Math.round(W * 0.28), Math.round(H * 0.74)), new cv.Scalar(90, 110, 105, 255), 3);
  // field text lines
  const fld = [['SURNAME  MOKOENA', 0.30], ['GIVEN    THANDI A', 0.40], ['DOB      14 03 1992', 0.50], ['DOC NO   VRD482 95513', 0.60], ['EXPIRY   02 11 2033', 0.70]];
  for (const [t, fy] of fld) {
    cv.putText(tex, t, new cv.Point(Math.round(W * 0.34), Math.round(H * fy)), cv.FONT_HERSHEY_SIMPLEX, 0.62, new cv.Scalar(31, 58, 52, 255), 2);
  }
  // MRZ — paper-white under normal exposure sits ~235-245; true glare clips
  // to 250+. (Threshold methods cannot separate blown-out print from glare;
  // that's the production case for a small glare CNN — see research findings.)
  cv.rectangle(tex, new cv.Point(0, Math.round(H * 0.79)), new cv.Point(W, H), new cv.Scalar(240, 240, 238, 255), -1);
  cv.putText(tex, 'I<VRDMOKOENA<<THANDI<A<<<<<<<<<<<<<', new cv.Point(12, Math.round(H * 0.88)), cv.FONT_HERSHEY_SIMPLEX, 0.62, new cv.Scalar(34, 48, 44, 255), 2);
  cv.putText(tex, 'VRD4829551<3VRD9203148F3311025<<<4', new cv.Point(12, Math.round(H * 0.97)), cv.FONT_HERSHEY_SIMPLEX, 0.62, new cv.Scalar(34, 48, 44, 255), 2);
  return tex;
}

/**
 * Render a scene frame: card texture warped to given corner positions over a
 * textured dark background. Returns RGBA Mat (frameW x frameH).
 */
function renderScene(cv, tex, cornersScene, frameW, frameH, opts = {}) {
  // plain dark background (card edges provide the contrast Canny needs)
  const bg = new cv.Mat(frameH, frameW, cv.CV_8UC4, new cv.Scalar(52, 48, 44, 255));

  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0, tex.cols, 0, tex.cols, tex.rows, 0, tex.rows,
  ]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    cornersScene[0].x, cornersScene[0].y, cornersScene[1].x, cornersScene[1].y,
    cornersScene[2].x, cornersScene[2].y, cornersScene[3].x, cornersScene[3].y,
  ]);
  const H = cv.getPerspectiveTransform(srcTri, dstTri);

  const warped = new cv.Mat();
  cv.warpPerspective(tex, warped, H, new cv.Size(frameW, frameH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
  // mask of card area
  const texMask = new cv.Mat(tex.rows, tex.cols, cv.CV_8UC1, new cv.Scalar(255));
  const mask = new cv.Mat();
  cv.warpPerspective(texMask, mask, H, new cv.Size(frameW, frameH), cv.INTER_NEAREST, cv.BORDER_CONSTANT, new cv.Scalar(0));
  warped.copyTo(bg, mask);

  // synthetic glare blob (in scene space) — soften only a local ROI so the
  // rest of the frame (card edges) stays sharp
  if (opts.glare) {
    cv.circle(bg, new cv.Point(opts.glare.x, opts.glare.y), opts.glare.r, new cv.Scalar(255, 255, 255, 255), -1);
    const pad = opts.glare.r + 40;
    const rx = Math.max(0, opts.glare.x - pad), ry = Math.max(0, opts.glare.y - pad);
    const rw = Math.min(frameW - rx, pad * 2), rh = Math.min(frameH - ry, pad * 2);
    const roi = bg.roi(new cv.Rect(rx, ry, rw, rh));
    cv.GaussianBlur(roi, roi, new cv.Size(31, 31), 0);
    roi.delete();
  }
  if (opts.blurAll) {
    cv.GaussianBlur(bg, bg, new cv.Size(opts.blurAll, opts.blurAll), 0);
  }
  srcTri.delete(); dstTri.delete(); H.delete(); warped.delete(); texMask.delete(); mask.delete();
  return bg;
}

function avgCornerError(found, gt) {
  let e = 0;
  for (let i = 0; i < 4; i++) e += Math.hypot(found[i].x - gt[i].x, found[i].y - gt[i].y);
  return e / 4;
}

cv.onRuntimeInitialized = () => {
  P.init(cv);
  const FW = 1280, FH = 720;
  const tex = makeCardTexture(cv);

  // ---- ground-truth scenes ----
  // near-frontal, card filling ~45% of width
  const GT1 = [{ x: 340, y: 190 }, { x: 940, y: 205 }, { x: 925, y: 565 }, { x: 350, y: 555 }];
  // perspective tilt (top edge further away)
  const GT2 = [{ x: 420, y: 230 }, { x: 860, y: 215 }, { x: 960, y: 540 }, { x: 330, y: 520 }];

  console.log('\nTest 1 — quad detection, near-frontal');
  {
    const frame = renderScene(cv, tex, GT1, FW, FH);
    const q = P.detectQuad(frame);
    check('quad found', !!q);
    if (q) {
      const err = avgCornerError(q.corners, GT1);
      check('corner error < 8 px', err < 8, `avg err ${err.toFixed(1)} px`);
      check('area fraction sane', q.areaFrac > 0.1 && q.areaFrac < 0.6, q.areaFrac.toFixed(3));
    }
    frame.delete();
  }

  console.log('\nTest 2 — quad detection under perspective');
  let rectifiedRef = null;
  {
    const frame = renderScene(cv, tex, GT2, FW, FH);
    const q = P.detectQuad(frame);
    check('quad found', !!q);
    if (q) {
      const err = avgCornerError(q.corners, GT2);
      check('corner error < 10 px', err < 10, `avg err ${err.toFixed(1)} px`);
      const uv = P.rectify(frame, q.corners);
      check('rectified size', uv.cols === P.UV_W && uv.rows === P.UV_H);
      rectifiedRef = uv; // keep for sharpness baseline
    }
    frame.delete();
  }

  console.log('\nTest 3 — pose estimation direction');
  {
    const frame = renderScene(cv, tex, GT2, FW, FH);
    const q = P.detectQuad(frame);
    if (q) {
      const pose = P.estimatePose(q.corners, FW, FH);
      check('pose solved', !!pose);
      if (pose) {
        check('tilt detected (5–60°)', pose.tiltDeg > 5 && pose.tiltDeg < 60, `tilt ${pose.tiltDeg.toFixed(1)}°`);
        check('distance plausible (100–1000 mm)', pose.distanceMm > 100 && pose.distanceMm < 1000, `${pose.distanceMm.toFixed(0)} mm`);
      }
    }
    // near-frontal pose should have smaller tilt
    const frame1 = renderScene(cv, tex, GT1, FW, FH);
    const q1 = P.detectQuad(frame1);
    if (q && q1) {
      const p1 = P.estimatePose(q1.corners, FW, FH);
      const p2 = P.estimatePose(q.corners, FW, FH);
      if (p1 && p2) check('frontal tilt < perspective tilt', p1.tiltDeg < p2.tiltDeg, `${p1.tiltDeg.toFixed(1)}° vs ${p2.tiltDeg.toFixed(1)}°`);
    }
    frame.delete(); frame1.delete();
  }

  console.log('\nTest 4 — glare localized to the MRZ zone in document space');
  {
    // place glare over the scene position of the MRZ (bottom strip of card in GT1)
    const mrzSceneX = Math.round((GT1[3].x + GT1[2].x) / 2);
    const mrzSceneY = Math.round((GT1[3].y + GT1[2].y) / 2) - 40;
    const frame = renderScene(cv, tex, GT1, FW, FH, { glare: { x: mrzSceneX, y: mrzSceneY, r: 55 } });
    const q = P.detectQuad(frame);
    check('quad still found with glare', !!q);
    if (q) {
      const uv = P.rectify(frame, q.corners);
      const glare = P.analyzeGlare(uv);
      check('glare detected on card', glare.frac > 0.01, `frac ${(glare.frac * 100).toFixed(1)}%`);
      check('MRZ zone flagged', glare.perZone.mrz.glared, `mrz frac ${(glare.perZone.mrz.frac * 100).toFixed(1)}%`);
      check('photo zone clean', !glare.perZone.photo.glared, `photo frac ${(glare.perZone.photo.frac * 100).toFixed(1)}%`);
      check('glare centroid in lower half', glare.centroidUV && glare.centroidUV.v > 0.6, glare.centroidUV ? `v=${glare.centroidUV.v.toFixed(2)}` : 'none');

      const sharp = P.analyzeSharpness(uv);
      const decision = P.coach({ quad: q, pose: null, glare, sharp, atlas: new P.Atlas(), motion: 0 });
      check('coach says tilt (glare code)', decision.code === 'glare', `${decision.code}: "${decision.text}" zone=${decision.zone}`);
      glare.mask.delete(); uv.delete();
    }
    frame.delete();
  }

  console.log('\nTest 5 — sharpness gate: sharp vs blurred');
  {
    const sharpFrame = renderScene(cv, tex, GT1, FW, FH);
    const blurFrame = renderScene(cv, tex, GT1, FW, FH, { blurAll: 21 });
    const qs = P.detectQuad(sharpFrame);
    check('sharp frame quad', !!qs);
    if (qs) {
      const uvS = P.rectify(sharpFrame, qs.corners);
      const sS = P.analyzeSharpness(uvS);
      check('sharp MRZ above threshold', sS.perZone.mrz.sharp, `score ${sS.perZone.mrz.score.toFixed(0)}`);
      // blurred frame: detection may fail (soft edges) — rectify with GT corners instead
      const uvB = P.rectify(blurFrame, GT1);
      const sB = P.analyzeSharpness(uvB);
      check('blurred MRZ below threshold', !sB.perZone.mrz.sharp, `score ${sB.perZone.mrz.score.toFixed(0)}`);
      check('sharp >> blurred', sS.overall > sB.overall * 3, `${sS.overall.toFixed(0)} vs ${sB.overall.toFixed(0)}`);
      uvS.delete(); uvB.delete();
    }
    sharpFrame.delete(); blurFrame.delete();
  }

  console.log('\nTest 6 — atlas completion across a glare-moving sequence');
  {
    const atlas = new P.Atlas();
    // frame A: glare on MRZ -> mrz incomplete
    const mrzX = Math.round((GT1[3].x + GT1[2].x) / 2), mrzY = Math.round((GT1[3].y + GT1[2].y) / 2) - 40;
    const fA = renderScene(cv, tex, GT1, FW, FH, { glare: { x: mrzX, y: mrzY, r: 55 } });
    const qA = P.detectQuad(fA);
    if (qA) {
      const uvA = P.rectify(fA, qA.corners);
      const gA = P.analyzeGlare(uvA), sA = P.analyzeSharpness(uvA);
      atlas.update(gA, sA);
      check('after frame A: critical zones incomplete', !atlas.criticalComplete, `fill ${(atlas.fillFrac * 100).toFixed(0)}%`);
      check('after frame A: mrz not clean', !atlas.zoneState.mrz.clean);
      gA.mask.delete(); uvA.delete();
    }
    // frame B: glare moved off the card -> everything completes
    const fB = renderScene(cv, tex, GT1, FW, FH, { glare: { x: 150, y: 120, r: 60 } });
    const qB = P.detectQuad(fB);
    check('frame B quad found', !!qB);
    if (qB) {
      const uvB = P.rectify(fB, qB.corners);
      const gB = P.analyzeGlare(uvB), sB = P.analyzeSharpness(uvB);
      atlas.update(gB, sB);
      check('after frame B: critical zones complete', atlas.criticalComplete, `fill ${(atlas.fillFrac * 100).toFixed(0)}%`);
      check('fill is monotone and high', atlas.fillFrac > 0.9, `${(atlas.fillFrac * 100).toFixed(0)}%`);
      gB.mask.delete(); uvB.delete();
    }
    fA.delete(); fB.delete();
  }

  console.log('\nTest 7 — coach decision ladder');
  {
    check('no quad -> show', P.coach({ quad: null }).code === 'show');
    check('small quad -> closer', P.coach({ quad: { areaFrac: 0.05 }, motion: 0 }).code === 'closer');
    check('motion -> steady', P.coach({ quad: { areaFrac: 0.3 }, motion: 0.08 }).code === 'steady');
  }

  if (rectifiedRef) rectifiedRef.delete();
  tex.delete();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
};
