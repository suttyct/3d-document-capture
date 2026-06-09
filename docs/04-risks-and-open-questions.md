# Risks, Open Questions, and Proof-of-Concept Plan

## 1. Patent landscape — action required before commercialization

Glare-aware guided capture is patent-dense. A freedom-to-operate review is the first commercial gate:

| Patent | Subject (as found; assignees unverified) |
|---|---|
| US 9,503,612 | "Glare mitigation for dynamic document scanning" — directing users to change camera position/view angle to eliminate glare |
| US 10,630,905 | Real-time shadow and glare analysis for document capture |
| US 10,762,369 / US 12,249,137 | Auto-capture pipeline with AR "tokens/targets" inducing device tilt, specular-highlight feedback |
| US 12,056,978 (iProov) | Document genuineness from imagery captured during device movement (hologram, glare behavior) |
| US 11,030,449 | Document verification by combining multiple images |
| US 12,469,291 | NN-predicted optimal stopping for video-stream recognition |

Notes: the *explicit closed-form reflection-model tilt predictor* (L = 2(V·N)N − V driving coaching) was not found in published work or these patents' public summaries — potentially novel and patentable for us, but the claims of the family above must be read in full first.

## 2. Technical risks

| Risk | Severity | Mitigation |
|---|---|---|
| Planar pose flip ambiguity near frontoparallel | High (core UX) | Prefer slightly off-axis holds in UX; dual-candidate tracking + AR-normal agreement; temporal filtering |
| Corner localization noise on natural card edges (vs. fiducials) | Medium | Sub-pixel edge refinement; expect 5–15 mm / 1–5°; design coaching to not require better |
| LiDAR/depth useless at capture distance (<26 cm dead zone) | Low (designed around) | Depth used only for scene consistency, never card measurement |
| Light model wrong under multiple light sources | Medium | Fall back to observed-glare-only coaching ("the glow slides off as you tilt" works without a global L); ARCore HDR cross-check on Android |
| Thermal/battery on low-end Android | Medium | 1080p analysis cap, detector decimation, degradation ladder (architecture §6) |
| OVD verifier generalization to unseen attacks | High (fraud claims) | MIDV-DynAttack finding: static-fraud detection ≠ dynamic-attack robustness; independent lab evaluation before any marketing claim |
| Device × document blind spots | High (silent) | RIVR lesson: per-device/per-doc-class calibration + telemetry from day one |

## 3. Open questions to resolve in PoC

1. **Pose accuracy in practice**: is 1–5° tilt accuracy sufficient to make the glare predictor's tilt suggestions feel "right"? (If predicted highlight motion disagrees with observed by >X°, the coaching feels broken — measure the threshold empirically.)
2. **Atlas resolution vs. memory/perf**: 8 px/mm proposed; validate on low-end Android.
3. **How often is the SWEEP state needed?** If >30% of sessions in normal lighting need the glare dance, the happy path isn't happy enough — re-tune fusion-first policy.
4. **Hologram verification per-template**: building template expectations (which OVD, where, what behavior) is a data problem — start with passports (standardized, MIDV-Holo-aligned) before state licenses.
5. **Web/RN/Flutter reach**: the 3D experience is native-only by design; confirm business tolerance for a tiered experience.
6. **Verification-core vendor**: Microblink vs. Regula bake-off against our captured evidence bundles (pose-stamped frames + full-res stills) — does either ingest multi-frame evidence today, or server-side only single images?

## 4. Proof-of-concept sequence (suggested)

**PoC 1 — Pose lock (1–2 weeks of eng).** iOS-only: ARKit + `VNDetectDocumentSegmentationRequest` + IPPE PnP + ARAnchor. Success: world-anchored outline glued to a hand-held card at 30 fps, stable through moderate motion, flip ambiguity handled. *This de-risks the magic moment.*

**PoC 2 — Document-space quality atlas (1–2 weeks).** Add HSV glare mask + tile Laplacian, warp to UV, zone map for one passport template, sweeping-fill rendering. Success: "glare is on the MRZ" demonstrably correct; atlas completes and triggers full-res still.

**PoC 3 — The glare dance (2 weeks).** Light-direction inversion, tilt search, directional coaching; measure prediction-vs-observation error and the Open Question 1 threshold. Success: a user in a glare-prone setup is reliably coached to a clean capture in one gesture.

**PoC 4 — Trajectory liveness (3–4 weeks, parallelizable).** MIDV-Holo + DLC-2021 training: specular-consistency + moiré + motion-correlation checks on pose-stamped frames; baseline OVD chroma accumulation. Success: screen-replay DFAR measurably below single-frame baseline on held-out attacks.

Then: Android port, vendor bake-off (Open Question 6), accessibility spoken-coaching prototype, and an independent lab pre-assessment.

## 5. Claims hygiene

Before any external statement, re-verify the flagged items in [01-research-findings.md §Master list](01-research-findings.md#master-list-of-flaggedunverified-claims) — especially vendor metrics, RIVR DFRR figures (against mdtf.org primary tables), and the derived DPI arithmetic.
