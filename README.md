# 3D Document Capture — Research & Design

Research and system design for a next-generation identity-document capture experience: the phone builds a live **3D understanding of the document in space** — where it is, how it's tilted, where glare and blur sit *on the document surface* — and uses that understanding to coach the user to a perfect, fraud-resistant capture in seconds.

## The one-paragraph thesis

Today's capture SDKs treat the camera feed as a stream of flat pictures and emit boolean warnings ("glare detected"). The next generation treats the document as a **physical object with a 6-degree-of-freedom pose in a tracked 3D scene**. Once you know the document's pose and the camera's pose at every frame, everything changes: glare becomes a *predictable* consequence of reflection geometry (so you can tell the user exactly how to tilt out of it, or quietly fuse a glare-free image from multiple angles); blur and glare can be projected onto the document's own coordinate system ("glare is covering the MRZ", not "glare somewhere"); and security features that change with viewing angle (holograms, OVI ink) become *falsifiable physical tests* that screens and printouts cannot pass. The capture experience becomes shorter, calmer, and dramatically harder to defraud — and no shipping SDK exposes this today.

## Why now

- **The fraud bar is on the floor.** DHS's 2026 RIVR evaluation found most document-validation systems "disastrously ineffective" — the worst accepted 71–77% of fake documents ([Biometric Update](https://www.biometricupdate.com/202602/dhs-rivr-results-suggest-most-id-document-validation-disastrously-ineffective)). Single-frame optical checks are losing.
- **Every component is proven feasible on phones.** Document corner detection runs at single-digit milliseconds on the Neural Engine; glare CNNs run at ~24 ms on an iPhone XS; ARKit/ARCore give drift-stable 6DoF camera pose and exact intrinsics for free; closed-form PnP solves card pose from its known physical size (85.60 × 53.98 mm).
- **The UX white space is real.** Market leaders converge on shutterless best-frame capture with text coaching — but nobody ships a true 3D ghost-card overlay, zone-level defect feedback, or geometric "tilt this way out of the glare" guidance.

## Repository map

| Document | Contents |
|---|---|
| [docs/01-research-findings.md](docs/01-research-findings.md) | Synthesized, cited findings across five research pillars: 3D pose, glare/blur, UX, quality standards, anti-fraud + SDK landscape. Includes confidence flags and unverified claims. |
| [docs/02-architecture.md](docs/02-architecture.md) | The proposed technical architecture: the 3D scene model, perception pipeline, document-space defect localization, multi-frame quality accumulator, capture state machine, and platform stacks. |
| [docs/03-ux-blueprint.md](docs/03-ux-blueprint.md) | The "25th-century" capture experience: choreography, AR overlay language, coaching grammar, haptics/sound, accessibility, fallbacks, and success metrics. |
| [docs/04-risks-and-open-questions.md](docs/04-risks-and-open-questions.md) | Patent landscape, unverified claims to re-check, technical risks, and the proposed proof-of-concept sequence. |
| [mockup/index.html](mockup/index.html) | High-fidelity animated prototype of the capture experience (self-contained HTML — open in any browser; auto-plays all seven scenes, or step through them). Rendered stills in [mockup/shots/](mockup/shots/). |
| [web/](web/) | **Working prototype with real computer vision** — document quad detection, sub-pixel corners, 6DoF pose (PnP), glare/blur masks localized to document zones, quality atlas, live coaching. Runs fully on-device in the browser (OpenCV WASM). |
| [test/](test/) | Headless pipeline test suite: synthetic card frames at known ground-truth homographies verify detection accuracy (±2.5 px), pose direction, zone-level glare localization, sharpness gating, and atlas completion. `cd test && npm install && npm test`. |

## Running the working prototype

```bash
cd web && python3 -m http.server 8080
# open http://localhost:8080  →  "Start camera" (or "Run demo mode")
```

- **On a phone**, the camera requires HTTPS: host `web/` on any static HTTPS host (GitHub Pages works), or tunnel localhost. Without a camera, **demo mode** (`?demo=1`) runs the identical pipeline on a synthetic moving card with traveling glare — it locks on, flags "Glare over MRZ zone", coaches the tilt, and completes with a rectified capture.
- Pipeline status: classic-CV implementation (Canny quad + cornerSubPix + IPPE PnP + HSV glare + Laplacian sharpness) at ~30 ms/frame headless. Known limitation, by design: threshold-based glare cannot separate blown-out white print from specular glare — the production path is the small glare CNN identified in the research (Rodin et al., ~24 ms on phone). Detection is the next component to upgrade (LDRNet-style corner net).

## Headline design decisions (detailed in the docs)

1. **AR stack as the 6DoF backbone.** ARKit/ARCore world tracking provides the camera pose; the document is detected by a lightweight corner network, solved once with IPPE-square PnP against its known ID-1/ID-3 geometry, and *anchored in world space* — not re-estimated per frame.
2. **Defects live in document space, not screen space.** Glare and blur masks are warped through the homography into the rectified document template and intersected with semantic zones (portrait, MRZ, barcode, hologram). Quality verdicts are per-zone, and a per-document-pixel accumulator across frames knows when every zone has been seen clean *somewhere*.
3. **Physics-driven coaching.** From the glare highlight and the known document normal, recover the light direction (L = 2(V·N)N − V), then *predict* where glare moves under candidate tilts and render guidance that drives it off the critical zones.
4. **Capture is a non-event.** No shutter. Frames are harvested continuously; MRZ check digits / PDF417 decode / NFC chip read act as deterministic quality oracles; an optimal-stopping rule ends the session the moment the fused result stabilizes; a full-resolution still (or raw burst) is triggered at the gate-pass moment.
5. **The 3D trajectory is the fraud check.** Pose-stamped frames make hologram/OVI verification template-predictable, defeat screen replays (no angle-dependent diffraction, moiré, flat specular bloom) and printouts (one frozen angular sample) at the physics level.
6. **Buy the verification core, build the capture layer.** Template forensics and NFC chip auth are commodities (Regula, Microblink, Innovatrics); pose-trajectory-conditioned capture is the differentiator no vendor exposes.

## Status

Research phase complete (June 2026). Five parallel deep-research passes, ~90 sources, adversarially cross-checked; unverified claims are flagged inline in the findings document. Next step: proof-of-concept sequence in [docs/04-risks-and-open-questions.md](docs/04-risks-and-open-questions.md).
