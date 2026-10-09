# Architecture

## Geometry and data flow

Versioned local settings -> global/site/temporary merge -> active-picture bounds ->
crop-loss policy -> render plan -> renderer.

The original video element remains the playback and audio source. Renderers adjust its presentation
or draw readable frames to an effect surface.

- `core.ts`: pure geometry, setting validation, monotonic elastic mapping, padding analysis.
- `adapters.ts`: known player shells, visible-video selection, inline-style ownership.
- `renderers.ts`: native transforms, low-resolution canvas ambience, WebGL2 warp, experimental SVG,
  text-track overlay, and generic playback controls.
- `content.ts`: session lifecycle, decoded-frame scheduling, UI wiring, recovery.
- `background.ts`: optional permissions, dynamic scripts, serialized storage mutations, shortcuts.
- `panel.ts` / `popup.ts`: controls and status.
- `types.ts`: shared geometry, settings, session, and capability contracts.

## Elastic map

Work in the proportional Fit picture's horizontal CSS-pixel coordinates.
The center band is linear with derivative 1. Each edge starts at derivative 1, transitions
through smoothstep over its first 20%, and reaches a constant derivative `1 + k`.
The integral is continuous through second derivative.

Set k from the requested extra width, clamp it to [0,1], and apply strength.
The result always has positive derivative and never exceeds 2× local expansion.
Invert with bounded bisection and upload 2,048 normalized samples to a float lookup texture.
The shader interpolates neighboring samples without requiring optional float-texture filtering.

The SVG experiment uses the same inverse mapping but encodes it into an 8-bit displacement image;
this has a known precision disadvantage and is not the default backend.

## Detection and rendering

Analyze 240-pixel-wide frames approximately four times per second. Require a bright interior,
edge darkness, and five consistent candidates before narrowing the crop. Allow a small top-border
watermark; use stricter bottom coverage and changing-text safeguards. Add a safety margin.
Release invalid crops immediately when new picture becomes visible. Retain the last confident
rectangle through dark scenes and fades. Refine changed confident candidates at 960 pixels wide
with a half-sample safety margin; routine analysis remains small. Paused decoded frames receive
a bounded settling pass. Manual borders take precedence.

Foreground frames are driven by requestVideoFrameCallback, with a currentTime-aware RAF fallback.
Ambience uses a lower-resolution surface, rate limiting, brightness-jump compensation, temporal
blending, and adaptive quality reduction when draw cost or reported dropped frames rise.
Paused/hidden video does not continuously redraw.

## Ownership and recovery

Keep exact prior inline values and priorities. Restore only extension-owned current values,
preserving newer host changes. Watch host changes to reapply active geometry. Neutralize individual
CSS scale/translate/rotate and transitions while applying native geometry to avoid compounding
another fitter's presentation. Retain the player shell when fullscreen is the document root:
the HTML rectangle may have zero height with a fixed body.
Disconnect observers, frame callbacks, timers, controls, and effect canvases on session destruction.
Handle source replacement, container movement, fullscreen relocation, and BFCache restoration.

Foreground video becomes invisible only after a successful WebGL draw. On GPU/upload failure,
restore it immediately and disable elastic for the session. Protected/pixel-blocked sessions retain
native fitting and manual adjustment. Host-permission revocation is checked within four seconds.

## Security

Content scripts are registered dynamically for granted hosts.
Content frames may save only their own origin's profile. Import/export and injection actions require
the extension popup. Reject invalid profile origins, unknown schema versions, and out-of-range
controls. Unknown settings fields are discarded. Runtime code and assets are packaged with the
extension; storage contains settings and site origins.
