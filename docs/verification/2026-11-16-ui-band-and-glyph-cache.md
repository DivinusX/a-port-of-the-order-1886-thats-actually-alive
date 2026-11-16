# Subtitles, button prompts and font-cache glyphs — verification (16 November 2026)

Machine: CachyOS, RX 9070 XT (RADV), game CUSA00035 APP_VER 01.02, package v0.2.22, 16:9
("Cinematic bars: Disabled"), 60 FPS, FSR 4, Español (Latinoamérica).
Method: the shipped runtime on a copy of the state folder, inside `gamescope --backend headless`,
driven with `ORDER1886_PAD_FILE` and captured with `ORDER1886_FRAME_DUMP_TRIGGER`; guest code
traced with gdb (image base 0x800000000). The player's own state was never written.

## What was wrong

1. **Bars removed: no subtitles, no interaction/QTE glyphs, menus ~5% too large.** The UI is Flash
   (Iggy) with a 1920x800 stage. The game calls `IggyPlayerSetDisplaySize` (0xdeb260, from
   0x838f34 and 0x8394a7) with the scene size, which the 16:9 recipe turns into 1920x1080. With
   the bars on, the same scenes showed every subtitle and prompt. FSR 4, the runtime's optimisation
   toggles and the language were ruled out by A/B runs.
2. **Wrong or late letters in any aspect** ("Eigan." for "Sigan."). New glyphs
   reach the font-cache texture through a compute dispatch (0x87e450) that binds the texture and
   its staging copy with another format (`0x6d`). The runtime keeps that view as a separate
   aliased image, and the sampled texture got the glyph late or not at all.

## The fix

`scripts/order1886_display.py` (`UI_SITES`, `apply_ui_fix`) edits nine sites of every prepared
image, for both aspect settings, and only when each site holds its original bytes:

- both `IggyPlayerSetDisplaySize` callers pass `(width, width * 5 / 12)`;
- the UI draw (0x83a08a) sets GDraw's tile origin y to `(scene height - band height) / 2`; the
  code lives in the 4K branch of the display-mode switch (0x44cf80), which no retail flag selects
  and whose entry (0x44cf7e) is now an unconditional skip;
- the world-to-stage projection (0x7a0830) subtracts that offset and normalises by the band
  height, so a prompt stays on the object it marks;
- the two `setFormat(0x6d)` calls of the glyph upload are removed.

With the bars on, the band is the scene: height and origin come out as before.

## Results (same save, same scripted route, before / after)

| Check | Before | After |
| --- | --- | --- |
| Main menu, 16:9 | title at y=336, scaled ~1.05 | y=350, same as with bars (348) |
| Prologue "Torturado", 16:9, first 60 s | 0 subtitle lines | every line, same timing as with bars |
| Subtitle text | "Eigan. A ver si así se porta bien." | "Sigan. A ver si así se porta bien." |
| Triangle prompt at the tunnel beam, 16:9 | absent | present; at (68,280)/640x360 against (68,281) predicted from the bars run |
| Bars on, same route | prompts and subtitles shown | unchanged |
| Backend run through the worker | — | `display_profile.ui_fix = {applied: true, changed_sites: 9}` |

## Not verified

- Render widths other than 1920 (the constants are computed from the render size, but only
  1920x1080 and 1920x800 were run).
- QTE sequences beyond the first minutes of the Prologue; Lycan evade prompts; full chapters.
- A prompt whose object sits in the top or bottom ~13% of a 16:9 frame is outside the UI band
  and is clipped or clamped to the band edge.
- The 16:9 recipe itself crops the sides of the 2.4:1 picture (it keeps the vertical field of
  view); that is unchanged here.
