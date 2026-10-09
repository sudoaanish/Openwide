# Contributing

Bug reports, compatibility results, and focused pull requests are welcome.

## Development

Use Node.js 22.12 or newer. Install dependencies with `npm ci`. Run `npm run dev` for generated-video fixtures and `npm run build` for the unpacked extension.

Before submitting a change, run:

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

## Changes

- Keep geometry and settings validation independent of player-specific DOM behavior.
- Preserve the original video element as the playback and audio source.
- Restore only extension-owned styles and remove observers/effects on cleanup.
- Report requested mode and effective fallback separately.
- Preserve the settings schema and command identifiers unless a migration is included.
- Add regression coverage for behavioral fixes. Use generated fixtures rather than copyrighted media or private server content in committed assets.
- Package runtime assets locally and keep frame processing on the device. Respect player access restrictions and the user's granted site permissions.

Describe the behavior changed, reproduction steps, validation, and relevant browser/player limitations. Do not commit browser profiles, credentials, private diagnostics, dependency folders, or generated test reports.

## Licensing

Contributions are accepted under the project's MIT License. Third-party code and assets must have compatible licenses and retain their required notices.
