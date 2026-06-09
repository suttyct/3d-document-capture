# System Architecture: 3D Document Capture

The core idea: stop treating capture as "take a good photo" and start treating it as **building a quality-complete 3D observation of a physical object**. The system maintains a live scene model — camera pose, document pose, light direction, and a per-pixel quality map *in document coordinates* — and the capture session ends when that model says every critical zone has been observed cleanly.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        3D SCENE MODEL (world frame)                  │
│                                                                      │
│   Camera pose P_cam(t)      ← ARKit/ARCore VIO (free, drift-stable)  │
│   Document anchor T_doc     ← corner net + IPPE PnP, held by anchor  │
│   Light direction L         ← inverted from observed highlights      │
│   Quality atlas Q(u,v)      ← per-document-pixel, accumulated        │
│   Pose trajectory P(t)      ← stamped on every harvested frame       │
└─────────────────────────────────────────────────────────────────────┘
        ▲                    ▲                      │
        │ 30 fps             │ 10–30 Hz             ▼
┌───────────────┐   ┌────────────────┐   ┌──────────────────────────┐
│ AR session     │   │ Perception     │   │ Guidance & capture       │
│ (camera frames,│   │ (corners, pose,│   │ (coaching renderer,      │
│  pose, gravity,│   │  glare mask,   │   │  state machine, frame    │
│  intrinsics)   │   │  blur map)     │   │  harvest, fusion, gates) │
└───────────────┘   └────────────────┘   └──────────────────────────┘
```

---

## 1. The 3D scene model

### 1.1 Coordinate frames
- **World frame** — established by ARKit/ARCore world tracking (gravity-aligned). Camera pose comes from the platform VIO at every frame with ~0.02 m/s drift; never re-derive it.
- **Document frame** — origin at the card's top-left corner, X across the long edge, Y down, Z out of the face. Physical extents are known a priori: ID-1 = 85.60 × 53.98 mm, ID-3 data page = 125 × 88 mm. Classify the document type from the stream (aspect + content), don't ask the user.
- **Document UV space** — the rectified template raster (suggest 8 px/mm → 685×432 for ID-1; gives 200+ DPI-equivalent bookkeeping). All quality state lives here.

### 1.2 Document pose estimation (solve rarely, hold continuously)
1. **Detect** corners with a lightweight network at 10–30 Hz: `VNDetectDocumentSegmentationRequest` on ANE (iOS) or a custom LDRNet-style MobileNet corner regressor (~10 MB, single-digit ms on ANE/NNAPI), fine-tuned on MIDV-2020 + SmartDoc. Refine corners to sub-pixel with a local edge fit.
2. **Solve** `solvePnP(SOLVEPNP_IPPE_SQUARE)` with the known physical geometry and the platform's per-frame intrinsics. Keep **both** IPPE candidate poses.
3. **Disambiguate** the planar flip: lower reprojection error + temporal consistency + agreement with the AR plane/raycast normal (and LiDAR depth when the card is beyond ~26 cm).
4. **Anchor**: place an ARAnchor at the solved world-frame pose. Between detections, the anchor + `VNTrackRectangleRequest` (cheap 2D lock) carry the pose. Smooth with a small constant-pose Kalman filter in world frame.
5. **Gate** PnP updates on low gyro energy — rolling shutter corrupts corners during fast motion; during motion, trust the anchor.

Expected precision: ~5–15 mm translation, 1–5° rotation at arm's length; tilt is the weak axis; near-frontoparallel is the flip-ambiguity danger zone (design the UX to prefer a slight off-axis hold, which also helps glare — see §3).

### 1.3 Light model
Maintain a persistent estimate of the dominant light direction **L** in world frame:
- From every detected glare highlight: camera ray V to the highlight centroid + document normal N (from pose) → `L = 2(V·N)N − V`. The light is static while the phone and card move, so a few observations pin it down; recursively filter.
- On Android, corroborate with ARCore Environmental HDR's main directional light. On iOS, world-tracking sessions have no directional estimate — the inversion above is the source of truth.

This single piece of state is what turns glare from a complaint into a prediction (§3).

---

## 2. Defect localization in document space

Per analysis frame (1080p stream, every 1–2 frames):

1. **Glare mask** — cheap pass: adaptive high-V/low-S thresholding + connected components; or Rodin-style block CNN (~24 ms class hardware budget) for robustness. Output: binary/severity mask in image space.
2. **Blur map** — tile-based (32–64 px tiles, document tiles only): Laplacian variance or Haar-wavelet energy; optionally a small CNN that discriminates **motion vs. defocus** per region (the coaching differs: hold still vs. adjust distance/focus).
3. **Project** both masks through the inverse homography into document UV space.
4. **Intersect with the zone map** — a per-template semantic layout: portrait, MRZ, PDF417, signature, hologram/OVD region, field boxes (ICAO 9303 zones for passports; AAMVA layout for US licenses). Verdicts become *semantic*: "MRZ sharp ✓, glare over portrait ✗".

### 2.1 The quality atlas
The central data structure: a per-UV-pixel accumulator across the session (the MIDV-Holo baseline proves per-document-pixel accumulation across registered frames runs on mobile):

```
Q(u,v) = { best_sharpness, glare_free_seen, best_frame_id,
           n_observations, chroma_stats (for OVD analysis) }
```

- A zone is **complete** when every pixel (or a high percentile) has been observed sharp and glare-free in *some* pose-stamped frame.
- Completion is monotone — the user can only make progress, never lose it. This drives the UX's "painting the document clean" metaphor and guarantees the session converges.
- Accept frames whose defects miss all critical zones; never reject globally for a defect on a non-critical region.

---

## 3. Physics-driven glare coaching

With L, N, and camera pose known, the specular lobe position on the document is a pure function of pose:

1. **Predict**: for the current pose, compute where the highlight sits in UV (validates the model against the observed mask).
2. **Search**: sample candidate device/document tilts (±15° around current pose), simulate the highlight position for each, find the minimal motion that moves glare off all incomplete critical zones.
3. **Coach**: render that motion as guidance (see UX blueprint §3) — a specific "tilt this way", not a generic "avoid glare".
4. **Or don't coach at all**: if the quality atlas shows the glare-covered zone was already captured clean in an earlier frame, say nothing and let fusion handle it (PhotoScan model: glare moves between frames; composite takes each region from its best frame).

Blur coaching branches on type: motion blur → "hold still" + gate harvest on gyro energy; defocus → distance/focus prompt. Most blur coaching should be silent: just don't harvest the frame.

**Note:** this area is patent-dense (US 9,503,612; 10,630,905; 10,762,369 family). Run freedom-to-operate before commercialization. The explicit reflection-model predictor appears unpublished — both an opportunity (novel) and a risk (uncharted).

---

## 4. Capture state machine

```
ACQUIRE ──► LOCKED ──► SWEEP ──► COMPLETE ──► (optional) CHIP ──► DONE
   ▲           │          │
   └───────────┴──────────┘  (track loss → reacquire; atlas persists)
```

- **ACQUIRE** — find document, classify type, solve pose, place anchor. Target < 1 s.
- **LOCKED** — pose held; per-frame analysis populating the atlas; silent harvest of good frames. Most captures complete here without any coaching.
- **SWEEP** — entered only if zones remain incomplete (glare stuck on a critical zone, hologram verification desired): guide a small tilt arc. The same sweep serves *two* purposes simultaneously — moving specular highlights off critical zones *and* collecting the pose-stamped angular samples for hologram/OVD verification (§5).
- **COMPLETE** — all critical zones clean; optimal-stopping rule on the fused OCR result confirms (the expected improvement from another frame is below threshold). Trigger the **full-resolution still / short raw burst** at this moment via zero-shutter-lag APIs.
- **CHIP** — if MRZ check digits validate and the document is chipped: NFC session keyed by the MRZ fields (PACE then BAC). A successful read supersedes optical quality for everything the chip signs.
- Fallback: manual shutter appears only after a timeout (Socure pattern, 5–10 s); ACQUIRE failure after ~3 s switches to simplified 2D framing guidance.

### 4.1 Frame harvesting and gates (cheap → expensive)
1. Geometry gate: 4 corners in frame, fill ratio (card spans ≥ ~1300 px for the PDF417/security-feature DPI budget), tilt within bounds, gyro energy low.
2. Quality gate: zone-level sharpness/glare from the atlas update; thresholds calibrated against *downstream OCR accuracy* (DIQA best practice), per device class and document class (the RIVR lesson).
3. Semantic gate: per-frame OCR with ROVER-style per-character fusion across frames; MRZ check digits / PDF417 Reed-Solomon decode as deterministic oracles.

### 4.2 Output artifacts
- **Forensic image**: best-frame full-res still, or burst-fused (multi-frame super-resolution + glare-free compositing) — closes the gap to 400–600 DPI security-feature requirements. **No learned restoration on this path** (hallucination risk).
- **OCR results**: fused across frames; deblurring nets permissible here.
- **Pose-stamped evidence bundle**: frame set with P(t), L, atlas, and (if performed) OVD trajectory analysis + chip-read results — the input to downstream verification.

---

## 5. 3D anti-fraud layer

The pose trajectory makes every liveness check falsifiable:

| Check | Mechanism | Defeats |
|---|---|---|
| Specular consistency | Observed highlight motion must match prediction from L and P(t); screens show flat emission + bloom, no traveling laminate highlight | Screen replay |
| Moiré/recapture | Frequency-domain screen signatures on harvested frames | Screen replay |
| OVD trajectory | Chroma statistics per UV pixel across the sweep (MIDV-Holo method) must show angle-dependent change matching the template's hologram/OVI expectation (MIDV-DynAttack direction) | Prints, photocopies, static fakes |
| Scene consistency | Document plane must be stable in world frame and consistent with AR plane/parallax; depth where available | Document-in-a-video, screen held in front of camera |
| Motion correlation | Document pose change must correlate with device IMU motion (a replayed video doesn't respond to *your* motion) | Replay injection |
| Chip authentication | PA/AA/CA/TA via the bought verification SDK | Everything optical can't |

Train/benchmark the OVD verifier on MIDV-Holo + MIDV-DynAttack + DLC-2021; budget an independent ISO 30107-3-aligned evaluation (BixeLab/iBeta) and benchmark against the MdTF RIVR protocol.

---

## 6. Platform stacks and budgets

| Layer | iOS | Android | Cross-platform option |
|---|---|---|---|
| World tracking | ARKit (world tracking, raycast, LiDAR where present) | ARCore (anchors, Environmental HDR light) | — |
| Camera | ARFrame stream + AVCapturePhotoOutput (deferred processing/ZSL) | CameraX analysis + MAXIMIZE_QUALITY still | — |
| Corner/quality nets | Core ML on ANE (warm before screen; 200–400 ms cold start) | LiteRT (NNAPI/GPU) | ONNX Runtime / ExecuTorch single artifact |
| Verification core | Bought SDK (Microblink / Regula shortlist) + NFC (Regula / Innovatrics) | same | server re-verification (zero-trust) |

Performance envelope (all published on-phone numbers): corner net ≤ 10 ms (ANE), glare block-CNN ~25 ms, tile sharpness ~ms, PnP sub-ms, per-frame budget ≈ 33 ms at 30 fps with detection at 10–30 Hz and tracking between. Analyze at 1080p; never run a 4K analysis stream (thermal/battery, no accuracy gain per BlinkID guidance). Sessions are 5–30 s, so thermals are manageable; still warm all models before presenting the camera.

### Degradation ladder
1. Full experience: AR stack + ANE/NNAPI nets + NFC.
2. No AR support (old devices): homography-only pose per frame (no world anchor), same atlas + zone logic, 2D coaching.
3. No NPU: classic CV glare/blur (HSV + Laplacian), detector at 5–10 Hz, lower harvest rate.
4. Web fallback: out of scope for the 3D experience; hand off to standard frame-scored capture.
