# Research Findings

Synthesized from five parallel deep-research passes (June 2026), ~90 sources. Each claim carries a confidence rating; claims that rest on a single source, vendor marketing, or our own derivation are flagged. Where research agents could not fetch full texts (several publisher sites blocked fetches), claims were cross-corroborated across independent search extracts — re-verify flagged items before betting the architecture on them.

---

## Pillar 1 — Real-time document detection and 6DoF pose

### Detection
- The classic pipeline (Canny → Hough → quad scoring) still works in real time but fails on low-contrast backgrounds and occluded corners; production scanners (Dropbox, Grizzly Labs) moved to ML front-ends with geometric quad-fitting back-ends. **HIGH** — [Dropbox Tech](https://dropbox.tech/machine-learning/fast-and-accurate-document-detection-for-scanning), [Grizzly Labs](https://blog.thegrizzlylabs.com/2024/10/document-detection.html)
- **Direct corner-regression CNNs beat segmentation on speed at comparable accuracy.** LDRNet (MobileNetV2 backbone, predicts 4 corners + border points, ~10 MB) reaches Jaccard ≈ 0.985 on SmartDoc and claims up to 790 FPS — *hardware context for the FPS figure unverified*. **HIGH** for accuracy/size, **MED** for FPS — [arXiv 2206.02136](https://arxiv.org/abs/2206.02136), [GitHub](https://github.com/niuwagege/LDRNet)
- On iOS, `VNDetectDocumentSegmentationRequest` (iOS 15+) is ML-based, returns a mask **plus 4 corner points**, and is real-time only on the Neural Engine; `VNTrackRectangleRequest` maintains cheap 2D lock between detector runs. **HIGH** — [WWDC21 10041](https://developer.apple.com/videos/play/wwdc2021/10041/), [Apple docs](https://developer.apple.com/documentation/vision/vndetectdocumentsegmentationrequest)
- Turnkey scanners (`DataScannerViewController`, ML Kit Document Scanner) hide the camera and the quad — unusable for a custom 3D experience; ARKit image anchors require a known reference image, so they cannot anchor an arbitrary user's ID. **HIGH** — [Apple docs](https://developer.apple.com/documentation/visionkit/datascannerviewcontroller), [ML Kit](https://developers.google.com/ml-kit/vision/doc-scanner)

### Pose from known physical size
- With calibrated intrinsics and 4 known-size corners (ID-1: 85.60 × 53.98 mm; ID-3 passport page: 125 × 88 mm), full 6DoF pose is solvable in closed form via `solvePnP(SOLVEPNP_IPPE_SQUARE)`; IPPE is 50–80× faster than iterative PnP (*author-reported*). **HIGH** — [OpenCV docs](https://docs.opencv.org/4.x/d5/d1f/calib3d_solvePnP.html), [IPPE](https://github.com/tobycollins/IPPE)
- **Planar pose has an intrinsic two-fold "flip" ambiguity** that worsens when the card is small in frame, distant, or near-frontoparallel — exactly the hand-held ID regime. Mitigations: pick lower reprojection error, temporal consistency, agreement with the AR plane normal. **HIGH** — [IPPE](https://github.com/tobycollins/IPPE), [OpenCV ArUco](https://docs.opencv.org/4.x/d5/dae/tutorial_aruco_detection.html)
- Accuracy envelope (from fiducial-marker studies at 0.5–1 m): ~1.4–13.6 mm translation, ~0.01–3.5° rotation; natural card corners localize worse than fiducial corners, so expect **~5–15 mm and 1–5°** without refinement; translation is consistently better than out-of-plane tilt. **MED** (order-of-magnitude envelope, setup-dependent) — [PMC6960891](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6960891/), [PMC7506853](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7506853/)

### Platform 3D infrastructure
- ARKit world tracking: ~0.02 m/s drift (best-in-class phone VIO in independent benchmarks), per-frame pixel-accurate `ARCamera.intrinsics`, plane detection, raycasting. ARCore equivalent on Android. The AR stack is EKF-style VIO — IMU bridges camera frames, so you get stable camera pose "for free" and only need to solve *document* pose at detection events. **HIGH** — [arXiv 2207.06780](https://arxiv.org/pdf/2207.06780), [MDPI Sensors 22(14):5382](https://www.mdpi.com/1424-8220/22/14/5382)
- **Depth sensors are marginal at capture distance.** iPhone LiDAR `sceneDepth` is 256×192 @ 30 fps with ~0.26 m minimum range — a card at 15–25 cm may sit inside the dead zone; ARCore Depth API is optimal 0.5–15 m. Depth is useful for scene-consistency checks, not for measuring the card. **HIGH** — [Scientific Reports](https://www.nature.com/articles/s41598-021-01763-9), [ARCore Depth docs](https://developers.google.com/ar/develop/java/depth/developer-guide)
- Rolling shutter corrupts pose during fast motion; practical mitigation is gating PnP updates on low gyro rates and relying on the world anchor during motion. **HIGH** — [arXiv 1911.01015](https://arxiv.org/abs/1911.01015)

### Datasets
- **MIDV-500/2019/2020** (ID documents in video, per-frame quad annotations; MIDV-2020 = 1000 unique mock documents, the modern benchmark), **SmartDoc-2015** (saturated, JI ≈ 0.98+), **MIDV-Holo** (hologram detection + presentation attacks), **DLC-2021** (screen recaptures and copies). **HIGH** — [arXiv 2107.00396](https://arxiv.org/abs/2107.00396), [Springer MIDV-Holo](https://link.springer.com/chapter/10.1007/978-3-031-41682-8_30), [MDPI DLC-2021](https://www.mdpi.com/2313-433X/8/7/181)

---

## Pillar 2 — Glare and blur: detection and document-space localization

### Glare detection
- Classical: pixels with high intensity + low saturation (adaptive HSV thresholds), connected components; Regula's documented "glares" check is exactly this family. **HIGH** — [Frontiers in Physics](https://www.frontiersin.org/journals/physics/articles/10.3389/fphy.2020.616930/full), [Regula docs](https://docs.regulaforensics.com/develop/doc-reader-sdk/overview/image-quality/)
- **ID-specific, real-time, localized:** Rodin & Orlov's block-CNN glare detector achieves F1 = 0.812 at **~24.3 ms/frame on an iPhone XS** — per-block glare localization at video rate. **HIGH** — [arXiv 1911.05189](https://arxiv.org/abs/1911.05189)
- Datasets: SHDocs (NeurIPS 2024; 19k document images with aligned deglared ground truth), MIDV-Holo lighting variants, DLC-2021 (glare presence is itself a *liveness signal* for laminated documents). **HIGH** — [SHDocs](https://openreview.net/forum?id=OfXwix3NRH)

### Blur detection
- Laplacian variance / Tenengrad are the standard cheap focus measures; for documents, score **text regions only** (background dominates global scores); tile-based wavelet/FFT variants give per-region blur maps cheaply. **HIGH** — [MDPI Appl. Sci.](https://www.mdpi.com/2076-3417/8/5/807)
- Motion vs. defocus discrimination is solved per-pixel by CNNs (Kim et al., F1 ≈ 0.884) — the distinction matters because the coaching differs: motion → "hold still" (gate on gyro energy); defocus → "move back / tap to focus". **HIGH** — [Kim 2018](https://cg.postech.ac.kr/papers/Kim2018Defocus.pdf)

### Document-space (UV) localization — the white space
- The standard architecture is quad → homography → rectify → template zones (photo, MRZ, fields). Warping a glare/blur mask through the homography into rectified document coordinates is a trivial perspective warp; intersecting with zones yields "glare covers the MRZ". Evidence vendors reason per-zone exists (Smart Engines selects "glare-free face photo"), **but no vendor publicly exposes zone-level defect feedback — they ship boolean flags and generic prompts.** **MED-HIGH** — [arXiv 1911.05189](https://arxiv.org/abs/1911.05189), [Smart Engines](https://smartengines.com/news-events/smart-engines-has-launched-a-new-generation-of-recognition-systems-with-document-authentication-and-biometric-verification/)
- MIDV-Holo's baseline proves per-document-pixel accumulation across registered frames is practical on mobile video (it accumulates chromaticity statistics in document coordinates to detect holograms). **HIGH** — [Springer](https://link.springer.com/chapter/10.1007/978-3-031-41682-8_30)

### Multi-frame and physics
- **Google PhotoScan** is the canonical product proof of multi-angle glare-free fusion: 5 frames at offset positions, homography-aligned, composite assembled so every pixel is glare-free in some frame (*exact fusion operator unverified*). **HIGH** — [Google Research blog](https://research.google/blog/photoscan-taking-glare-free-pictures-of-pictures/)
- **Glare prediction is closed-form.** Given the camera ray V to a highlight and document normal N (both known from pose), light direction L = 2(Vᵀ·N)N − V; with L persisted (the light is static while the phone moves), the specular lobe position can be simulated for any candidate pose — enabling geometric "tilt this way" guidance. Established in light-source-estimation literature; **no published application to ID-capture coaching found — likely a novel combination** (patents gesture at it without the explicit reflection model). **HIGH** for the geometry, **flagged novel** for the application.
- Platform light estimation: ARCore Environmental HDR gives a main directional light; ARKit world tracking gives only ambient intensity/temperature (directional estimates are face-tracking-only) — on iOS, infer L from observed highlights instead. **HIGH** — [ARCore lighting](https://developers.google.com/ar/develop/lighting-estimation), [Apple docs](https://developer.apple.com/documentation/arkit/ardirectionallightestimate)
- **Patent density warning:** glare-coaching is patented prior art — US 9,503,612 (directing users to change camera position/angle to eliminate glare), US 10,630,905 (real-time shadow/glare analysis), US 10,762,369 / US 12,249,137 (AR tokens/targets that make the user tilt). Assignees unverified; freedom-to-operate check required. **MED-HIGH**

### Vendor state of practice
- Onfido shipped on-device real-time glare detection, cutting glare-failed uploads from 2% to <0.8%; BlinkID 6.8+ exposes glare/blur strictness levels and per-capture flags; Regula, Jumio, Veriff, Smart Engines all do frame-level glare/blur feedback. **HIGH** — [Onfido engineering](https://medium.com/onfido-tech/live-computer-vision-with-opencv-on-mobiles-f4e5ab15ad48), [Microblink](https://microblink.com/resources/blog/blinkid-6-8-0-release-glare-and-blur-detection-for-capturing-the-highest-quality-image/)

---

## Pillar 3 — Guided capture UX

### What ships today
- **Shutterless is the converged default.** BlinkID auto-captures from the video stream with no shutter and no document-type preselection (live classification, directional coaching, best-frame selection, sub-5-second claims); Stripe Identity scores every frame and picks the most readable; Onfido records a short video and auto-selects, claiming up to 70% fewer rejections (*vendor figure*); Socure exposes a 0–10 s auto-capture timeout before a manual button appears. **HIGH** — [BlinkID capture-android](https://github.com/BlinkID/capture-android), [Stripe Identity](https://docs.stripe.com/identity), [Onfido SDK](https://github.com/onfido/onfido-android-sdk/blob/master/README.md), [Socure](https://help.socure.com/riskos/page/latest-updates)
- The converged feedback pattern: card-aspect bracket with a state-machine reticle (searching → aligned → captured), one corrective text instruction at a time, color shift on lock, haptic + sound on success. **HIGH**
- **Apple's choreography:** Wallet ID capture = scan front/back, then selfie with head movements held *until the iPhone vibrates* (haptics as the instruction channel). Apple Digital ID (iOS 26.1, passports) = scan photo page, then **place the phone on the closed passport** until a gentle vibration confirms the NFC chip read. *The often-cited "tilt the ID card" step could not be verified in any Apple documentation — the movement choreography is in the selfie step.* **HIGH** (flag noted) — [Apple support](https://support.apple.com/en-us/111803), [Apple Newsroom](https://www.apple.com/newsroom/2025/11/apple-introduces-digital-id-a-new-way-to-create-and-present-an-id-in-apple-wallet/)
- iProov's design lesson: passive beats active, and the on-screen face outline is deliberately abstract because a mirror image makes users preen and slows completion. >98% completion, 1.08–1.22 average attempts (*vendor-published*). **MED** — [iProov](https://www.iproov.com/blog/face-verification-ux-performance-challenges-solutions)
- **Nobody ships a true 3D ghost-card AR overlay or bubble-level tilt metaphor** — tilt handling is text/icon coaching. This is the open UX white space. **MED** (absence of evidence after extensive search)

### Conversion economics
- Signicat (7,600 consumers, 14 markets): 68% have abandoned a digital onboarding; document upload and liveness are the canonical exit points. Re-capture requests are a major abandonment driver (the popular "3x more likely" figure has **no traceable primary source**). **HIGH** for direction, **LOW** for specific multipliers — [Signicat](https://www.signicat.com/the-battle-to-onboard-2022)
- The proven lever is **first-time pass rate**; all vendor numbers (70% fewer rejections, 95% first-time pass, 30% better conversion) are self-published without independent audit. **MED**

### Accessibility
- iProov is WCAG 2.2 AA audited; Onfido ships TalkBack labels, font scaling, contrast compliance; BlinkID added screen-reader glare warnings only in 6.10 (2024). **Continuous spoken coaching during capture is not standard anywhere** — another gap. Passivity itself is the strongest accommodation (no timed gestures, no precision actions, no shutter taps). **HIGH** — [iProov WCAG](https://www.iproov.com/blog/wcag-2-2-aa-iproov-compliance), [BlinkID 6.10](https://microblink.com/resources/blog/blinkid-6-10-0-release/)

---

## Pillar 4 — Quality standards and capture mechanics

### Standards map
- **ISO/IEC 29794-5:2025**: computable face-image quality (portrait only, not whole-document); reference implementation OFIQ. **ICAO Doc 9303**: fixes document geometry — TD3 MRZ 2×44 chars, TD1 3×30, OCR-B at 2.54 mm pitch, standard zones I–VII. **ICAO TR Portrait Quality**: inter-eye distance ≥90 px legacy / ≥240 px recommended. **NIST SP 800-63A-4** (final, July 2025): governs US remote proofing; ~10% error-rate expectation (*via secondary reporting*). **No ISO standard for whole-document capture quality exists — the gap is real.** **HIGH** — [ISO 29794-5](https://www.iso.org/standard/81005.html), [ICAO 9303 Part 3](https://www.icao.int/sites/default/files/publications/DocSeries/9303_p3_cons_en.pdf), [SP 800-63A-4](https://csrc.nist.gov/pubs/sp/800/63/A/4/final)
- **DHS RIVTD/RIVR is the de facto benchmark** — and it shows capture device and document type are first-order error sources (some systems rejected nearly 100% of genuine IDs from specific state/phone combinations). Per-device, per-document-class calibration is not optional. **HIGH** — [MdTF results](https://mdtf.org/rivr/Results)

### Resolution budgets (derived where noted)
| Target | Requirement | Basis |
|---|---|---|
| General OCR | ~300 DPI-equivalent; ≥18 px per uppercase char | **HIGH** — [Broadcom KB](https://knowledge.broadcom.com/external/article/254861/image-quality-and-resolution-for-ocr-res.html) |
| MRZ OCR | ~200 DPI floor, 300 comfortable (*our arithmetic from OCR-B pitch*) | **MED, derived** |
| PDF417 (US licenses) | ~2.5 px/module → worst case ~370+ DPI over the barcode (*derived*) — the most resolution-hungry optical anchor | **MED, derived** |
| Security features (microtext, IPI) | 400–600+ DPI; phones deliver ~300–450 DPI-eq per frame at arm's length → optical authenticity is resolution-marginal on single frames | **MED** (vendor-stated) — [Regula](https://regulaforensics.com/blog/document-authenticity-checks/) |

### Mechanics that win
- **DIQA done right:** score frames by *predicted downstream OCR accuracy*, not human opinion (CG-DIQA, OCR-grounded labels). **HIGH** — [ACM Computing Surveys](https://dl.acm.org/doi/10.1145/3606692)
- **Result-level fusion beats pixel-level for text:** recognize every frame, merge per-character alternatives ROVER-style, stop capturing when the fused result stabilizes (optimal stopping; granted patents exist on NN-predicted stopping). This is how production MRZ readers get near-perfect reads from mediocre frames. **HIGH** — [arXiv 2008.02566](https://arxiv.org/pdf/2008.02566)
- **Deterministic quality oracles:** MRZ check digits (mod-10, 7-3-1 weights; *note: the name field is not covered*) → a check-digit-valid read is near-certainly correct; PDF417 has Reed-Solomon EC so decode success is error-proof; **NFC chip read is the ultimate gate** — BAC/PACE keys derive from exactly the three MRZ fields the check digits protect, and a successful read yields the signed DG2 portrait, making optical portrait quality moot. **HIGH** — [Kinegram eMRTD](https://kinegram.digital/knowledge-base/docval-service-emrtd-security-mechanisms/)
- **Burst fusion closes the resolution gap:** Google's handheld multi-frame super-resolution (hand tremor provides sub-pixel offsets, ~100 ms per 12 MP frame on phones, ships as Super-Res Zoom) can recover the 1.5–2× deficit between phone capture and security-feature requirements; frame-to-frame specular motion lets fusion erase glare no single frame avoids. **HIGH** for mechanics, **MED** for document-specific production use — [Google Research](https://research.google/pubs/pub48460)
- **Learned deblurring only on the OCR path, never the forensic path** — generative restoration can hallucinate characters and security features (*analyst judgment*).
- **Pipeline pattern:** analyze at 1080p/30fps (BlinkID requires ≥1080p preview; >1080p "won't improve scanning significantly"), trigger a full-resolution still (12–48 MP → 600+ DPI-eq) via zero-shutter-lag APIs at the gate-pass moment. Capture sessions are short enough that thermal ceilings are manageable, but 4K analysis streams are not worth the power. **HIGH** — [BlinkID Android](https://github.com/BlinkID/blinkid-android), [WWDC23 10105](https://developer.apple.com/videos/play/wwdc2023/10105/)

---

## Pillar 5 — Document liveness via 3D, and the build landscape

### Why 3D capture is the fraud killer
- **Screen replay** (the most common attack): screens emit rather than reflect — moiré patterns, flat specular bloom, no laminate micro-gloss, and crucially **no angle-dependent diffraction**. **Printouts**: freeze one angular sample of every optically-variable feature. A capture system that knows the document's pose trajectory P(t) can verify that hologram/OVI/MLI appearance *changes correctly with angle for that document template* — converting liveness from texture classification (generalizes poorly) into a physical-consistency test the fraudster must defeat in hardware. **HIGH** (synthesis of sources below)
- Research base: **MIDV-Holo** (ICDAR 2023; 300 genuine + 400 attack clips; baseline accumulates per-pixel chromaticity in document coordinates), **MIDV-DynAttack** (ICDAR 2025; verifies the *specific dynamic behavior* of holograms; finds prior methods catch photocopies but not dynamic attacks), **DLC-2021** (screen/print attacks). **HIGH** — [Springer 2023](https://link.springer.com/chapter/10.1007/978-3-031-41682-8_30), [Springer 2025](https://link.springer.com/chapter/10.1007/978-3-032-04624-6_19)
- Production: Regula verifies holograms/OVI/MLI/Dynaprint against per-template expectations under tilt; Smart Engines' Holo AI does on-device temporal hologram analysis; iProov holds a US patent on analyzing imagery captured *during device movement* for hologram/glare-behavior correctness. **HIGH/MED** — [Regula](https://regulaforensics.com/products/document-reader-sdk/), [iProov patent](https://www.iproov.com/press/us-patent-drivers-license-government-id-imagery)
- Depth caveat: at 20–35 cm both a card and a phone screen are "flat" to LiDAR — raw depth flatness is a weak check; parallax/scene-plane consistency and specular/flash response are the useful 3D liveness cues. **MED**

### Build vs. buy
- **Buy:** template-specific forensics (Regula: 14,000+ templates), NFC chip authentication (PA/AA/CA/TA — the strongest check available, pure commodity via Regula/Innovatrics/Onfido), baseline passive liveness (IDLive Doc). RIVR shows even specialists struggle; a from-scratch fake-ID classifier will be worse.
- **Build:** the 3D capture layer — AR-guided tilt trajectory, pose-stamped frame selection, document-space defect accumulation, hologram-trajectory verification. **No SDK surveyed exposes pose-trajectory-conditioned capture as a first-class API**, the AR stacks give the signal for free, and open datasets (MIDV-Holo, MIDV-DynAttack, DLC-2021) exist to train and benchmark.
- **Test:** independent evaluation aligned to ISO/IEC 30107-3 + CEN/TS 18099 (BixeLab, iBeta); benchmark against the MdTF RIVR protocol. No formal document-PAD certification exists yet.
- Engine shortlist: **Microblink** (best independently corroborated RIVR accuracy, fully on-device), **Regula** (deepest OVD/liveness checks, full NFC suite, server re-verification), **Smart Engines** (strongest published hologram research; *assess procurement/geopolitical constraints — Russian-origin vendor*).

### ML stack for the custom layer
- iOS: ARKit + Vision + Core ML (ANE; warm models before the capture screen — 200–400 ms cold start). Android: ARCore + CameraX + LiteRT/ML Kit. Cross-platform single artifact: ONNX Runtime (Core ML/NNAPI/XNNPACK EPs) or ExecuTorch (1.0 GA Oct 2025). Realistic budgets: corner/keypoint nets at 30–60 fps; segmentation only on keyframes at reduced resolution. **HIGH** — [onnxruntime.ai](https://onnxruntime.ai/docs/tutorials/mobile/), [ExecuTorch 1.0](https://pytorch.org/blog/introducing-executorch-1-0/)

---

## Master list of flagged/unverified claims

1. LDRNet's 790 FPS hardware context; IPPE's 50–80× speedup (author-reported).
2. ARKit "IMU at 1000 Hz" (single Apple-talk origin); ARCore depth range figures (Google docs only).
3. PhotoScan's exact fusion operator; IDTrust paper internals.
4. Patent assignees and claim scope for US 9,503,612 / 10,630,905 / 10,762,369 / 12,249,137 / 12,056,978 — **freedom-to-operate review required**.
5. All vendor conversion metrics (Onfido 70%, Veriff 95%/30%, iProov 98%, "3x abandonment after re-upload").
6. The "tilt the ID card" step attributed to Apple Wallet (not found in any Apple documentation).
7. Our derived DPI arithmetic for MRZ (~200) and PDF417 (~370+).
8. NIST 800-63A-4's "10% error rate" linkage (secondary reporting); specific RIVR DFRR figures (re-check against mdtf.org primary tables).
9. Veridas "iBeta certification" wording (iBeta issues conformance letters, not certifications); Microblink "only provider to meet all RIVR benchmarks" (vendor framing).
10. Production deployment of document-specific burst glare-fusion (inferred from patents + physics, not confirmed in any vendor's published pipeline).
