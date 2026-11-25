---
name: replica-polish
description: >-
  The fidelity loop. Takes a built screen or flow and iterates it until it
  holds up next to the original (or the benchmark app you name): capture
  screenshots and full-motion recordings, compare side by side, list every
  difference in type, spacing, hierarchy, colour roles, navigation and motion
  timing, fix, capture again. Enforces a native-quality bar (Apple HIG,
  semantic colours, native controls, anti-slop pre-flight, a strict motion
  gate) for Expo / React Native and the same discipline for the web. Works
  with or without the Appllama MCP. Use when the user says "make it 1:1",
  "polish this", "it looks generic", "make it feel native", "match the
  reference", "compare against the original", "it still looks AI-made", or
  after /replica-build and /replica-backend.
---

# replica-polish

Reads `replica/recon.md`, `replica/design/`, `replica/screens/` and the built
app. Writes `replica/polish/log.md` and before/after captures in
`replica/polish/`. Runs after `/replica-backend`, before `/replica-test`.

A screen that works is not finished. It is finished when you put it next to
the reference and cannot point at a single thing the reference does better.
This skill is that loop, run until nothing meaningful is left.

## The rules

- **Match the quality bar, not the property.** Proportions, rhythm, hierarchy,
  density, motion timing and interaction quality are fair game: they are how
  good apps feel. Logos, illustrations, copy, icons that are theirs, and the
  brand palette are not. `/replica-brand` swaps those, and this loop must not
  bring them back.
- **Evidence or it did not happen.** Every "fixed" in the log has a before
  and an after capture. Every "matches" was checked against a reference
  capture, not memory.
- **One screen at a time, all its states.** Empty, loading, filled, error,
  long text, Arabic or other RTL text if the product ships it, dark mode.
- **Never accept "good enough" when the reference does it better.** That is
  the whole skill.

## Step 1: pick the reference

In order of preference:

1. The original's screens in `replica/screens/` from `/replica-recon`.
2. If the **Appllama MCP** is connected (`https://mcp.appllama.io/mcp`, a Pro
   account, one credit per call), a top-grossing app in the same category:
   study 20 to 30 of its real screens and videos before touching code. The
   playbooks are in `references/appllama-research-methods.md`,
   `references/appllama-improve-a-screen.md` and
   `references/appllama-build-from-scratch.md`.
3. Public store screenshots and walkthrough videos the user points at.

Write the reference set at the top of `replica/polish/log.md`: one row per
screen, the reference image path, the clone route.

## Step 2: capture

You compare captures, never descriptions.

| target | stills | motion |
| --- | --- | --- |
| web | Playwright `page.screenshot` at the reference's viewport, deviceScaleFactor 2 | `recordVideo` on the context, then frames with ffmpeg |
| iOS (Expo) | `npx expo run:ios --device` on an iPhone 17 Pro simulator, `xcrun simctl io booted screenshot` | `xcrun simctl io booted recordVideo`, scrub frame by frame |
| Android | `adb exec-out screencap -p` | `adb shell screenrecord` |

Full detail for the simulator loop: `references/simulator-loop.md`.
Record whole flows, not single frames: a transition you only screenshot is a
transition you never checked.

## Step 3: compare

Side by side, same size, then:

```bash
python3 replica-diff/imgdiff.py reference.png clone.png --out diff.png
```

`imgdiff.py` compares edges, so your new palette does not count against you.
Then read both by eye and write every difference down, in this order:

1. **Hierarchy.** What the eye lands on first, second, third. If it differs,
   nothing else matters yet.
2. **Proportions.** Component heights, widths, gutters, padding, radii.
   Measure in points against the reference (the side panels in the original
   prompt: gap, gutter, padding, filler, width, radius).
3. **Type.** Sizes, weights, line heights, letter spacing, text lengths,
   truncation.
4. **Colour roles.** Canvas, surfaces, one accent, shadows (or none), dividers.
   Roles, not hues: your hues come from your own tokens.
5. **Content density.** How much is on screen above the fold.
6. **Navigation.** Push vs modal vs sheet, back gestures, where back lands.
7. **Motion.** Duration, curve, what moves, what does not.

## Step 4: the bar

Every difference is checked against these laws. Violating one is a finding,
not a preference. The full text, with the reasons, is in the references.

**Native fidelity (mobile).** Semantic colours in both themes from day one.
Native controls over rebuilt ones (`references/native-controls.md`). SF
Symbols or Material Symbols, one icon family. The platform type ramp, one
display size per screen, tabular numerals for anything that counts. Continuous
corners. One elevation system. One spacing unit. Safe areas and the Dynamic
Island checked with content scrolled under them. Liquid Glass only where the
system uses it.

**Navigation.** Push goes deeper, replace moves on. Presentation is meaning:
modal for a task with steps, sheet for a short interruption, full screen for
immersive content. One-way doors (sign-in, finished onboarding, a purchase)
leave the stack, so back never re-enters them. Tabs are peers and never slide.

**Anti-slop pre-flight.** Count, do not judge:

| check | must be |
| --- | --- |
| distinct accent hues | 1 |
| corner radii outside the stated scale | 0 |
| emoji in UI chrome | 0 |
| gradients without a brand reason | 0 |
| labels for the same intent ("Start", "Begin", "Get started") | 1 |
| screens with only the happy state built | 0 |

**Motion gate** (`references/motion.md`). Seen 100 times a day: platform
default, nothing more. Tens a day: under 150 ms. Occasional: standard motion.
Delight: rare, first-time moments only. Name the purpose in one word or delete
the animation. If a finger is involved it is a spring that carries the
finger's velocity. Nothing animates on the JS thread. No bounce for style.

**Performance** (`references/performance.md`). Lists virtualise, images are
sized, the first frame has no layout jump, skeletons match the final layout.

## Step 5: fix, then capture again

Fix the biggest difference first (hierarchy before pixels). Capture again with
the same viewport and state. Compare again. Log it:

```
S07 booking page   pass 3
  before: polish/S07-p2.png   after: polish/S07-p3.png   imgdiff: 0.081 -> 0.034
  fixed: slot buttons 44 -> 48pt, gap 12 -> 16, date header weight 600 -> 700
  open:  month switch animates 350ms, reference 250ms ease-out
```

Repeat for every screen and every transition until the "open" list is empty or
only holds things you decided on purpose (write the reason).

## Step 6: web apps

The same loop, with web equivalents: system font stacks or one open font,
`prefers-color-scheme` tokens, `prefers-reduced-motion` honoured, focus rings
visible, 44px touch targets, no horizontal scroll at 360px, RTL checked with
`dir="rtl"` if the product ships Arabic or Hebrew.

## Output

`replica/polish/log.md` with every screen's passes, before and after captures,
and a three-line summary: screens at parity, the open items you chose to keep,
the next step: `/replica-test`.

## Credit

The native-quality bar, motion gate, simulator loop and research playbooks in
`references/` come from Appllama's MIT-licensed app design skills
(`references/LICENSE-appllama`). The Appllama name and logo are their
trademarks; nothing here implies endorsement.
