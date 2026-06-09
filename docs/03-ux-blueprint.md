# UX Blueprint: The "25th-Century" Capture Experience

Design north star: **the document capture should feel like the phone simply *understood* the document** — saw it, locked onto it, quietly gathered what it needed, and confirmed with a single satisfying pulse. The user's mental model: "I showed it my ID. It got it."

The research is unambiguous about what wins: *less* UI, not more AR. Shutterless capture, one instruction at a time, haptics as the language of success, and zero cognitive load. The 3D understanding mostly works **invisibly** — it surfaces only when it makes the next action obvious.

---

## 1. Principles (each grounded in evidence)

1. **Capture is a non-event.** No shutter button, no document-type picker, no countdown. Frames are harvested from the stream and the best is selected — the converged industry default (BlinkID, Stripe, Onfido), with Onfido attributing up to 70% fewer rejections to it.
2. **One instruction at a time.** Never stack warnings. The state machine picks the single highest-leverage correction and says it in ≤ 4 words.
3. **Coach with geometry, not complaints.** Because the system knows *where* glare is and *where it will go*, guidance is directional and specific ("Tilt the top away") — never "glare detected, try again".
4. **Progress is monotone and visible.** The quality atlas only fills up. The user should feel they are *finishing* something, never that the app rejected their effort. Re-capture requests are the canonical abandonment point (Signicat: 68% have abandoned an onboarding) — the design goal is that re-capture *cannot happen* because the session doesn't end until it's complete.
5. **Haptics are the success channel.** Apple's Wallet flow proves users understand "hold until it vibrates". Every state transition has a haptic signature; the completion pulse is the emotional payoff.
6. **Passive is accessible.** No timed gestures, no precision alignment, no shutter tap (WCAG 2.2; iProov's passivity-as-inclusivity). The 3D system tolerates sloppy framing because it tracks pose — accessibility and UX quality are the same feature here.

---

## 2. The choreography

### Scene 1 — Invitation (0–1 s)
Camera opens instantly (models pre-warmed). No frame mask, no overlay wall of text. A soft full-bleed viewfinder with one line: **"Show your ID."** Any orientation, any distance, front or back first — the classifier sorts it out.

### Scene 2 — Lock-on (the magic moment, <1 s after the card appears)
The instant the document is detected and its 3D pose solved, a **light, precise outline materializes around the physical card** — perspective-correct, tracking it in 3D like it's attached (it is: world-anchored, not screen-space). A single crisp haptic tick + a sub-tone confirms: *it sees the card*.

This is the moment that makes the experience feel a generation ahead — the overlay is glued to the *object*, not floating on the screen. (No shipping IDV product does this; it's the visible tip of the 3D architecture.)

### Scene 3 — The quiet harvest (1–4 s, the default happy path)
The outline carries a subtle **fill that sweeps across the document as zones complete** — the quality atlas rendered as light. Most users in decent lighting will watch the card "fill up" in two or three seconds without a single instruction, then get the completion pulse. Nothing else appears on screen.

Microcopy only when needed, one at a time, ≤ 4 words, with matching outline behavior:
- Too far → outline gently breathes outward: **"A little closer."**
- Motion blur → outline softens: **"Hold steady."** (harvest auto-pauses on gyro energy; no scolding)
- Defocus → **"Back a touch."**

### Scene 4 — The glare dance (only when physics demands it)
If glare is parked on a critical zone and won't be out-fused, the system computes the minimal tilt that moves it off (reflection model) and renders the most literal possible guidance:

- The glare region on the card glows faintly (the user sees *what* the problem is, exactly where it sits on their document), and
- a **soft directional light-cue + arrow on the outline edge** indicates the tilt — "roll the card slightly toward me." As the user tilts, the glow visibly slides off the document and extinguishes — cause and effect in 200 ms feedback loops. Haptic detents as zones complete during the motion.

This same gesture doubles, invisibly, as the hologram sweep: the tilt arc collects the angular samples the anti-fraud layer needs. **One physical gesture, two jobs, zero explanation.**

### Scene 5 — Completion
All critical zones clean → full-res still fires silently → outline snaps tight, fills solid, **single deep haptic pulse + resolve tone**, card visual "lifts" into a rectified thumbnail. Total target: **under 5 seconds** in normal conditions.

Then, without mode-switching ceremony: **"Now the back."** (flip detection is automatic — the classifier notices the flip, no button).

### Scene 6 — Chip upgrade (when available)
If the MRZ validated and the document is chipped: **"Hold your phone on the document."** Vibration confirms contact, a progress ring around the contact point, completion pulse on read. This is the Apple Digital ID pattern — the most futuristic shipped gesture in the industry, and it replaces *all* optical anxiety with one tactile action.

### Fallbacks (graceful, never dead-ends)
- No lock in ~3 s → simplified guidance ("Place your ID on a dark surface"), then classic 2D framing.
- Auto-capture timeout (8 s) → manual shutter appears (Socure pattern). Manual captures still flow through the same atlas/gates.
- Persistent zone failure → accept best-available with server-side flag rather than trapping the user; never loop more than twice on the same instruction.

---

## 3. The visual language

- **One hero element**: the world-anchored outline. It is reticle, progress bar, and coach in a single object. No corner brackets + toast + banner + spinner stack.
- **States**: searching (absent), locked (thin, luminous), harvesting (sweeping fill), coaching (directional edge glow + arrow), complete (solid snap).
- **Defect rendering is diegetic**: glare/blur problems are shown *on the document where they are*, not as abstract icons. The user fixes what they can see.
- **Restraint rule**: if the atlas is progressing, show nothing but the fill. Every visual element must earn its place by changing the user's next 500 ms.
- Avoid mirror-cleverness: iProov's lesson — don't make the screen a mirror that invites preening/fiddling; the outline is abstract and confident, not a photographic preview demanding judgment.

## 4. Sound & haptics vocabulary

| Event | Haptic | Sound |
|---|---|---|
| Lock-on | light tick | soft sub-tone |
| Zone complete (during sweep) | micro-detent | none |
| Coaching active | none (visual/voice only) | none |
| Capture complete | single deep pulse | short resolve tone |
| Chip contact / read | continuous gentle → pulse | none / resolve |

Haptics carry meaning (Apple Wallet's "hold until it vibrates"); sound is optional polish and must never be required for success.

## 5. Accessibility — first-class, not bolted on

- **Continuous spoken coaching** via VoiceOver/TalkBack: the same single-instruction stream, spoken ("Card found." "Tilt the top away… good." "Captured."). *No vendor ships this today* — BlinkID 6.10's screen-reader glare warnings are the current ceiling. The 3D pose model makes spoken guidance dramatically better because instructions are relative to the card the user is holding, not the screen.
- **Tremor tolerance by architecture**: harvest gating + multi-frame fusion means shaky hands produce *slower* captures, not failed ones. No hold-still requirement is ever hard.
- Large type, WCAG-AA contrast for all microcopy; no timed actions (WCAG 2.2); one-handed operation assumed (card on table is a fully supported path — the pose solver doesn't care).
- Haptic-only completion works for deaf users; audio-only works for blind users; visual-only works with haptics off. Every signal is triple-encoded.

## 6. Metrics that define success

| Metric | Target | Rationale |
|---|---|---|
| Time to capture (front, p50 / p90) | < 5 s / < 12 s | BlinkID claims sub-5 s; the 3D path should match while collecting more |
| First-attempt completion | > 95% | the abandonment lever; re-capture is the exit point |
| Zero-instruction captures | > 70% | measures how often the quiet path suffices |
| Server-side rejection rate | < 1% | Onfido cut glare failures 2% → <0.8% with 2D feedback; zone-gating should beat it |
| Accessibility task-completion parity | within 10% of baseline | spoken-coaching efficacy check |
| Fraud: screen-replay / print DFAR | benchmark vs. MdTF RIVR best (DFAR < 0.01) | the 3D layer's reason to exist |

Instrument per device class and per document class from day one — RIVR showed device × document interactions can silently destroy specific user populations (near-100% false rejection for some state/phone combos).
