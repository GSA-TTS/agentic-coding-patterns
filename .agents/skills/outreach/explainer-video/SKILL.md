---
id: explainer-video
version: "1.0.0"
title: "Explainer Video (HTML to MP4)"
type: skill
description: "Hand-author an HTML composition and render it to a deterministic MP4 explainer video by seeking a paused GSAP timeline frame-by-frame with headless Chromium and FFmpeg, fully offline with locally vendored assets"

status: experimental
owners:
  - "@GSA-TTS/agentic-coding-team"

primary_personas:
  - developers
  - developer-advocates
  - technical-writers

requires:
  anchors: []

output:
  format: markdown
  contract:
    required_sections:
      - "Composition HTML"
      - "Render Command"
      - "Human Review Checklist"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"
      - "External CDN Links"

categories:
  - "documentation"
  - "supply-chain"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "explainer video"
  - "promo video"
  - "animated overview"
  - "html to video"
  - "launch video"

tags:
  - "outreach"
  - "video"
  - "explainer"
  - "hyperframes"
  - "gsap"
  - "animation"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Produce a short animated explainer or launch video from a hand-authored HTML file"
    - "Render an HTML composition to MP4 locally, offline, and deterministically"
    - "Create promo or overview motion graphics for a slide deck, README, or landing page"
  exclusions:
    - "Not for hosted-cloud rendering of sensitive content"
    - "Not a replacement for accessible text — pair every video with a text summary"
    - "Not for crawling or capturing arbitrary web pages"
---

# Skill: Explainer Video (HTML to MP4)

Render a short animated explainer video from a single hand-authored HTML file.
The capability: a renderer drives a paused GSAP timeline frame-by-frame in
headless Chromium and pipes each frame to FFmpeg, producing an MP4. There is no
build step and no proprietary timeline format — the HTML plays as-is. This skill
uses [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache-2.0) as
the reference renderer, but the technique generalizes to any tool that seeks a
deterministic timeline.

The render runs entirely offline with locally vendored scripts and fonts. This
skill produces a draft video for human review, never a publish-ready artifact.

## When to Use

- Building a short animated explainer (title cards, timed reveals, simple charts)
- Producing a launch or promo video for a release
- Turning a static one-pager into a 30-45 second animated overview
- User asks "make an explainer video", "html to video", or "animated overview"

## When Not to Use

- The content contains secrets, real PII, or real CUI (never send to a renderer
  you do not fully control; never use hosted rendering)
- The audience needs the information without video playback (provide text instead)
- You need to capture or crawl an existing live web page

## Prerequisites

- Node.js and `npx` available locally
- Docker available (strongly preferred for deterministic renders); otherwise a
  system Chrome/Chromium plus FFmpeg on `PATH`
- A pinned renderer version recorded in your project (treat any bump as a
  re-review trigger)
- GSAP downloaded once and vendored locally (see Step 3)
- A short script or storyboard: what each scene says, in order

## Procedure

### Step 1: Plan the Storyboard

Aim for 30-45 seconds at 1920x1080. Use a 6-scene pattern (generic, adapt the
copy to your subject):

1. Title — name the thing, one-line tagline
2. The problem — the pain you solve, stated plainly
3. The tool in action — a focused demonstration or key capability
4. A comparison or metric — an animated chart (before/after, bar growth)
5. A result or gauge — an animated number or progress dial
6. Call to action — where to go next (a repo path, a doc title; no live URLs)

Keep each scene 4-8 seconds. Source any real numbers from a single source of
truth and note in the composition where they came from so they can be refreshed.

### Step 2: Write the Composition HTML

A composition is one HTML file with a root element carrying composition metadata:

```html
<div id="root" data-composition-id="explainer"
     data-start="0" data-width="1920" data-height="1080">
  <section id="scene1"> ... </section>
  <section id="scene2"> ... </section>
  <!-- one plain <section> per scene -->
</div>
```

Authoring contract:

- **Scene layers are plain `<section>` elements** — full-frame layers whose
  visibility you drive with GSAP. Start them `opacity: 0` in CSS.
- **KEY VALIDATED LESSON: do NOT put `class="clip"` on a scene layer you animate
  with GSAP.** The renderer manages clip visibility itself and rejects GSAP
  tweens on the `visibility`/`display` of a `clip` element. A GSAP-driven scene
  layer must be a plain `<section>` with no `class="clip"` and no `data-start`.
- Use `class="clip"` ONLY for discrete media you are NOT animating on the master
  timeline (for example a static `<img>`). A clip needs `data-start` and, for
  images, `data-duration`; `data-track-index` controls z-order (one track cannot
  overlap itself in time).

### Step 3: Vendor GSAP and Fonts Locally

Download GSAP once at author time (a CDN fetch here is fine — the rule is only
that the *composition* must not reference a CDN at render time):

```bash
curl -fsSL -o assets/gsap.min.js \
  https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js
```

Reference it by relative path inside the composition:

```html
<script src="./assets/gsap.min.js"></script>
```

License note: GSAP is under the GreenSock Standard License — this is **not** an
OSI or MIT license. Record GSAP and its version in your SBOM; revisit if the
terms change.

Fonts: the renderer substitutes common families to bundled fonts. Use the
**target** names directly to avoid a `font_family_without_font_face` error:

```css
font-family: Inter, sans-serif;
font-family: "JetBrains Mono", monospace;
```

Do not use `-apple-system` or `BlinkMacSystemFont` — they alias to a generic
fallback.

### Step 4: Build the Single Paused Timeline

Animation is a **single paused GSAP timeline** registered as
`window.__timelines["<data-composition-id>"]`. The key MUST match the
composition id exactly. The composition duration equals `tl.duration()`; pad the
end with `tl.set`.

```html
<script>
  const tl = gsap.timeline({ paused: true });

  // Scene 1: fade in, reveal children, fade out
  tl.to("#scene1", { opacity: 1, duration: 0.5 }, 0);
  tl.from("#scene1 .title", { y: 40, opacity: 0, duration: 0.6 }, 0.2);
  tl.to("#scene1", { opacity: 0, duration: 0.5 }, 4);
  // HARD KILL: settle non-linear seeking — kill BOTH opacity and visibility
  tl.set("#scene1", { opacity: 0, visibility: "hidden" }, 4.5);

  // Scene 2 ...
  tl.to("#scene2", { opacity: 1, duration: 0.5 }, 4.5);
  // ... repeat the pattern per scene ...

  // Pad total duration (co-locate the final hard kill at the boundary)
  tl.set("#scene6", { opacity: 0, visibility: "hidden" }, 40);
  tl.set({}, {}, 42);

  // Required for hand-authored compositions:
  window.__timelines = window.__timelines || {};
  window.__timelines["explainer"] = tl;
</script>
```

### Step 5: The Hard-Kill Rule (Validated Fix)

After each scene's fade-OUT, add a hard-kill `tl.set(...)` at the fade-end time
on the non-clip scene layer, killing **BOTH** opacity and visibility:

```js
tl.set("#sceneN", { opacity: 0, visibility: "hidden" }, <endSeconds>);
```

Omitting it triggers `gsap_exit_missing_hard_kill` /
`scene_layer_missing_visibility_kill` and fails lint. The `visibility` kill is
correct and required here because plain `<section>` scene layers are NOT clips —
the prohibition on animating `visibility` applies only to actual `class="clip"`
elements. Apply the same hard-kill to the FINAL scene at the composition-end
second, co-located with the `tl.set({}, {}, <total>)` duration pad; the linter
accepts a hard-kill at the duration boundary.

### Step 6: Lint, Then Render

Run the lint step first, then render. Both use the locked-down environment.

See **Render Command** below for the exact, blessed invocation.

### Step 7: Inspect the Output

The render writes the MP4 relative to the composition directory. A docker render
prints an internal `/output/...` container path first, then the real host path —
use the host path. Watch the result end to end before review.

## Composition HTML

A minimal, complete skeleton (combine with the timeline from Step 4):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    html, body { margin: 0; background: #0b0b0f; }
    #root { position: relative; width: 1920px; height: 1080px; }
    section {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; /* scenes start hidden; GSAP reveals them */
      font-family: Inter, sans-serif; color: #fff;
    }
    .title { font-size: 96px; font-weight: 700; }
    .mono { font-family: "JetBrains Mono", monospace; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="explainer"
       data-start="0" data-width="1920" data-height="1080">
    <section id="scene1"><h1 class="title">Title Card</h1></section>
    <section id="scene2"><p class="title">The problem, stated plainly.</p></section>
    <section id="scene3"><p class="title">The tool in action.</p></section>
    <section id="scene4"><div class="chart"><!-- animated bars --></div></section>
    <section id="scene5"><p class="title mono">98%</p></section>
    <section id="scene6"><p class="title">See: docs/overview</p></section>
  </div>

  <script src="./assets/gsap.min.js"></script>
  <script>
    /* single paused timeline registered at window.__timelines["explainer"] */
    /* see Step 4 + Step 5 hard-kill rule */
  </script>
</body>
</html>
```

## Render Command

This is the only blessed, locked-down envelope. Always set the three privacy
env vars and pin the exact version. Run lint, then render, from the composition
directory.

```bash
# Pin the version; treat any bump as a re-review trigger.
VERSION=0.6.112

# 1) Lint (auto-discovers index.html in the current dir; no single-file flag)
HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_NO_UPDATE_CHECK=1 \
  npx --yes hyperframes@${VERSION} lint

# 2) Render (deterministic): builds a LOCAL renderer image, no hosted pull
HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_NO_UPDATE_CHECK=1 \
  npx --yes hyperframes@${VERSION} render --docker \
    --output out.mp4 --fps 30 --quality high
```

Notes:

- Prefer `--docker`: the first docker render builds a LOCAL renderer image from
  a bundled Dockerfile (pinned Chrome, fonts, FFmpeg). It does not pull a
  vendor-hosted image and gives deterministic output.
- `--output out.mp4` is written **relative to the composition dir**.
- **Local fallback** (only if Docker is unavailable): drop `--docker`. Local
  renders need a system Chrome/Chromium and FFmpeg on `PATH` and are NOT
  guaranteed bit-deterministic across machines — prefer `--docker`.
- The benign `gsap_studio_edit_blocked` warning is **expected** for
  hand-authored compositions: you registered `window.__timelines` by hand. It is
  safe and does not block the render. **Ignore that warning's own `Fix:` text
  telling you to remove the manual `window.__timelines` registration** — for a
  hand-authored composition the registration is required; removing it breaks the
  render.

## Security and Supply Chain

The renderer ships opt-in subcommands that fetch unpinned code or send content
to a hosted service. The blessed envelope avoids all of them.

**Hard guardrails:**

- Set `HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_NO_UPDATE_CHECK=1`
  on **every** invocation. (`CI=true` alone does NOT disable telemetry.)
- Pin the exact renderer version. **Any version bump is a re-review trigger.**
- Vendor all scripts and fonts locally; the composition must make **zero network
  requests at render time**.
- Verify the package tarball integrity against the registry before adopting a
  new version. Record vendored asset licenses (GSAP, fonts) in the SBOM.

**NEVER run these subcommands:**

| Command | Why it is forbidden |
|---------|---------------------|
| `hyperframes skills` | Runs `npx skills` -> `git clone` with `GIT_CLONE_PROTECTION_ACTIVE=0`; unpinned third-party CLI |
| `hyperframes init` without `--skip-skills` | Interactive path offers to install skills |
| `hyperframes add` / `catalog` | Fetch+write from an unpinned `main`-branch registry |
| `hyperframes capture` | Headless crawl of arbitrary URLs |
| `hyperframes publish` / `lambda` / `cloud` / `login` | Hosted rendering — never send sensitive content to a hosted renderer |
| `--tailwind` | Pulls a CDN runtime at render time; use plain CSS |

If you must initialize a project, use `hyperframes init --skip-skills`. Skills in
this ecosystem are Markdown instructions, not executable code — the risk is in
the *delivery* (`npx skills` + `git clone`), which the envelope sidesteps.

## Determinism Rules (Hard)

- No `Date.now()`.
- No `Math.random()` (or seed it deterministically).
- No network fetches at render time — all assets load before frame 0.
- Vendor scripts and fonts locally; reference them by relative path.

## Human Review Checklist

Before using this output, a human MUST verify:

- [ ] Video plays end to end with no flicker, ghost frames, or stuck scenes
- [ ] Each scene fades fully out (hard-kill present on every non-clip scene)
- [ ] No scene layer carries `class="clip"`
- [ ] Single paused timeline registered at `window.__timelines["<id>"]`, key
      matches `data-composition-id`
- [ ] Composition makes zero network requests at render time
- [ ] GSAP and fonts are vendored locally and recorded in the SBOM
- [ ] Renderer version is pinned; the three privacy env vars were set
- [ ] No forbidden subcommands were run (no `skills`/`add`/`catalog`/`capture`/
      hosted commands)
- [ ] No secrets, real PII, real CUI, internal URLs, or CDN links in the output
- [ ] All numbers trace to a single source of truth and are current
- [ ] Accessibility: a poster image + text summary exists (see below)

**This skill produces drafts, not publish-ready artifacts.**

## Accessibility

Video conveys information through motion and color, which excludes some users
and breaks down without playback. Always pair the video with:

- A **poster image** (a representative still frame)
- A **text summary** that contains the same information as the video, so the
  message survives with no playback at all

Treat the text summary as the source of record; the video is an enhancement.

## Related Patterns

- `explainer-gif` — Record a CLI tool as a deterministic, accessible
  terminal-screencast GIF. Prefer a GIF for a README hero (plays inline from a
  committed repo path); prefer this MP4 explainer for slide decks and
  higher-fidelity walkthroughs.

## References

- [HyperFrames](https://github.com/heygen-com/hyperframes) — reference renderer
  (Apache-2.0). HTML-to-MP4 via headless Chromium + FFmpeg.
- [GSAP](https://gsap.com/) — animation library (GreenSock Standard License; not
  OSI/MIT — record in SBOM).
- [GreenSock Standard License](https://gsap.com/standard-license)
- [FFmpeg](https://ffmpeg.org/) — frame encoding.
