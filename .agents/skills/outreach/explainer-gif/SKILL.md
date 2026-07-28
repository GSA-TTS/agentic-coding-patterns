---
id: explainer-gif
version: "1.0.0"
title: "Explainer GIF (Terminal Screencast)"
type: skill
description: "Script a terminal session as a deterministic tape and render it to an accessible, readable GIF or short video for documentation and outreach"

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
      - "Tape Script"
      - "Recording Command"
      - "Human Review Checklist"
    prohibited_content:
      - "Secrets"
      - "Real PII"
      - "Real CUI"
      - "Internal URLs"

categories:
  - "documentation"

quality_gates:
  readability_max_grade: 10
  citations_required: false

triggers:
  - "terminal demo"
  - "screencast"
  - "demo gif"
  - "cli recording"
  - "asciinema"
  - "vhs"

tags:
  - "outreach"
  - "gif"
  - "screencast"
  - "terminal"
  - "vhs"
  - "demo"

portability:
  opencode: true
  cursor: true
  claude_projects: true
  chatgpt: true
  generic_llm: true

scope:
  intended_use:
    - "Record a CLI tool walkthrough as a GIF for a README hero"
    - "Produce a deterministic, re-renderable terminal demo for docs or CI"
    - "Create an accessible, paced screencast that reads well at a glance"
  exclusions:
    - "Not for live, unscripted screen captures (use a screen recorder)"
    - "Not for GUI or browser demos (use a video tool; see explainer-video)"
    - "Does not replace prose documentation — pair the GIF with a text summary"

collection: communications
routing:
  task_types:
    - "author"
    - "render"
  input_artifacts:
    - "artifact-brief"
    - "shell-script"
  output_artifacts:
    - "explainer-gif"
    - "terminal-demo"
  prefer_when:
    - "the request is a short terminal screencast/GIF"
  avoid_when:
    - "the request is a narrated/animated motion video"
  delegates:
    - pattern: explainer-video
      when: "the request is a full motion/animated explainer video"
  aliases:
    - "terminal screencast"
    - "demo gif"
    - "vhs tape"
---

# Skill: Explainer GIF (Terminal Screencast)

Script a terminal session as a tape file, then render it deterministically to a
GIF (or short MP4/WebM) of a command-line tool in action. The recording is
reproducible: there is no live typing to fumble, the same inputs always produce
the same frames, and the artifact can be re-rendered in CI. This skill produces
draft tape scripts and recording commands for human review before publishing.

## When to Use

- Showing what a CLI tool does at the top of a README
- Producing a paced, readable terminal walkthrough for documentation
- Re-rendering a demo automatically when the tool changes
- User asks to "record a terminal demo", "make a demo GIF", or "screencast the CLI"

## Prerequisites

- The CLI tool to demonstrate, runnable from a shell
- A recording tool installed. The reference tool is
  [VHS](https://github.com/charmbracelet/vhs) (MIT), which renders a `.tape`
  script to GIF/MP4/WebM via a headless terminal plus `ffmpeg`. Alternatives:
  [asciinema](https://asciinema.org/) to capture a cast, and
  [agg](https://github.com/asciinema/agg) (asciinema-agg) to convert a cast to
  a GIF.
- A target screen size, theme, and font decided in advance
- A short list of commands and the order to show them

## Procedure

### Step 1: Write the Tape

Script the session declaratively so the render is reproducible. A tape is a
list of directives the recorder replays: set the environment, type a command,
press Enter, sleep, repeat. Do not capture live typing — a script removes
timing jitter and typos, and lets you re-render after the tool changes.

Keep the demo short. Pick three to six commands that tell one story. Trim
anything that does not earn its screen time.

### Step 2: Make It Deterministic

Pin every variable that affects the output:

- [ ] Pin the recorder version (record it in a comment or a `Require` line)
- [ ] Set the terminal width and height in the tape, not the host terminal
- [ ] Set the theme, font, and font size in the tape
- [ ] Set any tool environment variables in the tape so output is stable
- [ ] Avoid commands whose output changes run to run (timestamps, random IDs);
      if unavoidable, pin a seed or a fixed clock

Deterministic input plus a fixed terminal equals a render that looks identical
on every machine and in CI.

### Step 3: Set Pacing for Readability

A GIF that scrolls too fast is unreadable. Two validated techniques:

1. **Slide / paginated mode (recommended for GIFs).** Clear the screen, show
   ONE screenful, hold it for about five to seven seconds, then clear and
   advance. Each frame is a full, readable screen rather than a racing scroll.
   This is the pattern large CLI projects use for tool GIFs.
2. **Narrated pacing.** Before each command, print what it does and what to
   look for, then pause for reading time (about 200 words per minute plus a few
   seconds of buffer), then run the command and pause again so the output can
   sink in.

Prefer slide mode for a GIF: a viewer cannot pause a GIF, so every frame must
stand on its own. Use narrated pacing for a live screen-share or a longer
video.

- [ ] Each slide holds long enough to read (about five to seven seconds)
- [ ] Reading pauses scale with the amount of text on screen
- [ ] The final slide is held before recording stops (give the recorder a
      window slightly longer than the total hold time)

### Step 4: Set an Accessible Palette

Build for WCAG 2.1. The terminal palette is the demo's only visual channel, so
it must carry meaning without relying on color alone.

- **Contrast (WCAG 1.4.6, AAA).** Use foregrounds that meet at least a 7:1
  contrast ratio against the background. No single chromatic color is AAA on
  both a dark and a light terminal, so select a theme per render (a dark theme
  for a dark background, a light theme for a light one) and pair each
  foreground with an explicit background so the ratio is guaranteed.
- **Use of color (WCAG 1.4.1).** Never let color be the only signal. Pair every
  status with a text label and a glyph — for example `PASS`, `FAIL`, `WARN`
  with `[+]`, `[x]`, `[!]` — so meaning survives no-color, colorblind, and
  grayscale viewing.
- **Honor `NO_COLOR`.** Respect the [no-color.org](https://no-color.org/)
  convention so the demo degrades cleanly to plain text.
- **Self-check contrast.** Provide a check that computes the WCAG
  relative-luminance and contrast-ratio formulas for every palette pair and
  fails if any drops below 7:1, so CI can gate it.
- **No audio, motion-only info.** A GIF has no sound and conveys information
  through motion. Pair it with a text summary or alt text so the same
  information is available without playback.

### Step 5: Keep Tool Output Compact

Long tool output overflows a terminal frame and pushes content off screen.
Render a compact or trimmed view — one fixed-width row per result, errors only,
or a summarized table — so each result fits a single screen. Keep the full,
detailed output in the normal (non-recorded) command.

### Step 6: Render and Commit

Render the tape to an artifact and commit it so documentation can reference it
without a toolchain:

```bash
vhs demo.tape          # renders the Output path declared in the tape
```

- [ ] Render to a GIF for README heroes (universal inline playback)
- [ ] Commit the artifact to the repository
- [ ] Reference it from the README or docs
- [ ] Commit the tape alongside the artifact so it can be re-rendered

GitHub renders a committed GIF inline in Markdown. A committed MP4 does **not**
play inline from a repo path — it needs a hosted `user-attachments` asset URL to
embed. For an MP4 walkthrough, see the related `explainer-video` skill.

## Tape Script

A small VHS tape that records two commands in slide-friendly, accessible style.
Replace the commands and theme to match your tool. Comments explain each choice.

```tape
# demo.tape — render with:  vhs demo.tape
# Requires the recorder and ffmpeg on PATH.
Require bash

# Output artifact. A GIF embeds inline in Markdown everywhere.
Output demo.gif

# Deterministic terminal: size, font, and theme live HERE, not on the host.
Set Shell bash
Set FontSize 22
Set Width 1280
Set Height 800
Set Padding 24

# A dark theme whose foregrounds meet AAA contrast (>= 7:1) on this background.
# Pick a light theme instead when recording on a light background.
Set Theme { "name": "Demo", "background": "#1e1e1e", "foreground": "#e6e6e6", "green": "#73d393", "red": "#ff8a80", "yellow": "#f0c674", "blue": "#4dc9d6" }

# Tool environment, pinned so output is stable across machines and CI.
Env NO_COLOR ""

Sleep 800ms

# Slide 1: type a command, run it, hold long enough to read the screen.
Type "your-cli --help"
Sleep 600ms
Enter
Sleep 6s

# Clear before the next slide so each frame is one full, readable screen.
Type "clear"
Enter
Sleep 300ms

# Slide 2: show a result. Status carries a text label, not just color.
Type "your-cli check ./example   # prints PASS / FAIL, not color alone"
Sleep 600ms
Enter
Sleep 6s
```

## Recording Command

Render the tape with the reference tool:

```bash
vhs demo.tape          # renders the Output path declared in the tape
```

The render is deterministic because the terminal size, theme, font, and tool
environment are all declared in the tape rather than inherited from the host.
Commit both the rendered artifact and the tape so the demo can be re-rendered
when the tool changes.

## Accessibility

A terminal GIF must remain useful with no color, no motion, and no sound.

- [ ] Foreground colors meet at least 7:1 contrast against the background (WCAG
      1.4.6 AAA); the theme is chosen to match the background
- [ ] Status is conveyed by a text label and a glyph, never color alone (WCAG
      1.4.1)
- [ ] `NO_COLOR` is honored; the demo reads cleanly as plain text
- [ ] A contrast self-check verifies every palette pair and can gate in CI
- [ ] The GIF is paired with a text summary or alt text describing what it shows
- [ ] Pacing gives a viewer time to read each screen without pausing

## Tradeoffs

| Format | Inline playback | Size | Fidelity | Best for |
|--------|-----------------|------|----------|----------|
| GIF | Plays inline anywhere, including a committed repo path | Larger | Lower (256 colors, no audio) | README heroes, quick previews |
| MP4 / WebM | Smaller and higher fidelity, but needs hosting to embed inline | Smaller | Higher | Slide decks, longer walkthroughs |

Recommend a GIF for a README hero and an MP4 for a slide deck or a longer
narrated demo. For the MP4 path and inline-embedding details, cross-link the
`explainer-video` skill.

## Human Review Checklist

Before publishing this output, a human MUST verify:

- [ ] The tape contains no secrets, real PII, real CUI, or internal URLs in any
      typed command or output
- [ ] The demo tells one clear story in three to six commands
- [ ] Every slide holds long enough to read at a glance
- [ ] The palette matches the background and meets AAA contrast
- [ ] Status meaning survives with color disabled (labels and glyphs present)
- [ ] The GIF is paired with a text summary or alt text
- [ ] Tool output is trimmed so each result fits one screen
- [ ] The artifact and the tape are both committed so the demo can be re-rendered

**This skill produces draft tapes and recording commands, not published media.**

## Related Patterns

- `explainer-video` — Produce an MP4 walkthrough and embed it inline

## References

- [VHS](https://github.com/charmbracelet/vhs) — Scriptable terminal recorder (MIT); renders `.tape` to GIF/MP4/WebM
- [asciinema](https://asciinema.org/) — Record a terminal session to a cast
- [agg](https://github.com/asciinema/agg) — Convert an asciinema cast to a GIF
- [ffmpeg](https://ffmpeg.org/) — Encodes the rendered frames
- [WCAG 2.1: Contrast (Enhanced) 1.4.6](https://www.w3.org/WAI/WCAG21/Understanding/contrast-enhanced.html)
- [WCAG 2.1: Use of Color 1.4.1](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html)
- [NO_COLOR convention](https://no-color.org/)
