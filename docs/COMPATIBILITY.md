# Capability matrix

Openwide 0.1.1 is a preview release tested with Chrome and Edge on Windows. Adapters identify player shells; runtime checks determine pixel readability and effect availability.

| Player             | Native fitting                                             | Detection and ambience                        | WebGL Elastic                                 | SVG Elastic                                 |
| ------------------ | ---------------------------------------------------------- | --------------------------------------------- | --------------------------------------------- | ------------------------------------------- |
| YouTube            | Live Chrome Fill verified; other modes covered by fixtures | Live Chrome verified                          | Live Chrome verified                          | Experimental                                |
| Netflix            | Adapter included; real-service verification incomplete     | Disabled for protected/pixel-blocked playback | Disabled for protected/pixel-blocked playback | Experimental; protected playback unverified |
| Hulu               | Adapter included; real-service verification incomplete     | Disabled for protected/pixel-blocked playback | Disabled for protected/pixel-blocked playback | Experimental; protected playback unverified |
| Jellyfin Web       | Adapter included; real-service verification incomplete     | Runtime pixel probe                           | Runtime pixel probe                           | Experimental                                |
| Plex Web           | Adapter included; real-service verification incomplete     | Runtime pixel probe                           | Runtime pixel probe                           | Experimental                                |
| Generic HTML video | Controlled fixtures verified                               | Controlled fixtures verified                  | Controlled fixtures verified                  | Experimental                                |

## Rendering boundaries

- Pixel readability depends on the player, origin, media protection, and browser. It is not guaranteed by a site name.
- Pixel-based effects are disabled for protected EME sessions.
- Normal, theater, and player-shell fullscreen are supported. A video-only fullscreen surface cannot contain sibling ambience layers.
- Cross-origin iframes require permission for their own origin and can prohibit fullscreen.
- Open shadow roots are searchable. Closed shadow roots are unsupported.
- Browser-rendered captions stay separate from the warp. Burned-in text transforms with the picture. Complex native text-track styling needs player-specific verification.
- Experimental SVG Elastic does not support rotation, flips, or border cropping. Its protected-playback output is not verified.
- RTX VSR activity, HDR filter behavior, and sustained GPU performance require testing on the target device.
- Firefox, native players, local-file playback, and picture-in-picture effects are outside 0.1.1.

## Validation baseline

Typecheck, production build, 40 unit tests, 20 Chrome/Chromium checks, and 19 Edge fixture/UI checks passed for the 0.1.1 implementation. The browser suites exercise generated video, native foreground retention, WebGL output and recovery, padding detection, fullscreen, settings, and lifecycle cleanup.

Live Chrome YouTube checks cover Fill, Auto ambience, WebGL Elastic, the redesigned panel, and a changing bottom-promotion regression.

Ten-minute performance sessions, measured audio synchronization, native permission dialogs, and protected SVG rendering remain unverified.
