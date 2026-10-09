# Testing

## Automated checks

```bash
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The browser suite starts Vite on port 4173 and uses generated media. The MV3 test uses a temporary browser profile and extension copy with test-only host grants.

Run installed Chrome fixture/UI tests on Windows:

```powershell
$env:ULTRAWIDE_BROWSER_CHANNEL='chrome'
npm run test:browser -- tests/browser/fixture.spec.ts tests/browser/standalone.spec.ts tests/browser/ui.spec.ts --workers=1
```

Run the same scope in Edge:

```powershell
$env:ULTRAWIDE_BROWSER_CHANNEL='msedge'
npm run test:browser -- tests/browser/fixture.spec.ts tests/browser/standalone.spec.ts tests/browser/ui.spec.ts --workers=1
```

`ULTRAWIDE_CHROMIUM_PATH` optionally selects the full Chromium executable used by the MV3 test. These environment variable names are retained for compatibility with existing scripts.

## Coverage

- Geometry, crop budgets, settings validation, elastic endpoints, monotonic mapping, and expansion bounds.
- Encoded padding, dark scenes, logos, changing localized promotions, and broad caption borders.
- Native-video restoration, GPU context loss, unreadable pixels, fullscreen, paused detection, and replacement cleanup.
- MV3 injection, profiles, legacy import, permission boundaries, and disable restoration.
- Seven UI modes, conditional effects, numeric errors and resets, keyboard selection, focus return, and popup states.
- Panel containment at 1280×720, 3440×1440, and a 640×360 CSS viewport representing a 200% zoom layout.

The small-viewport test is not an automated change to the browser's actual zoom setting. Physical fullscreen and browser zoom should also be checked manually.

## Manual acceptance

1. Load the build in Chrome and Edge, grant a video site, and verify all requested modes.
2. Test normal, theater, and fullscreen layouts, including captions and native controls.
3. Seek, pause, navigate between videos, and cross an advertisement or episode boundary.
4. Verify 16:9 Auto chooses ambience when Fill exceeds its crop budget.
5. Verify a padded widescreen picture removes padding without repeated framing jumps.
6. Check the panel at 100%, 150%, and 200% browser zoom. Open each advanced section and verify scrolling.
7. Run ten-minute Ambient and Elastic sessions, recording native baseline and effect-mode dropped frames, responsiveness, and GPU load.
8. Check RTX VSR using NVIDIA's own activity indicator when supported by the device.
9. Disable the site and confirm that video styling and playback rate are restored.

Record the browser version, OS, player, selected mode, and observed effects when reporting service-specific results.
