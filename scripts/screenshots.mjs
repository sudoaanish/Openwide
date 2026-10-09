import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Screenshots use generated media and controlled extension API responses.
const browser = await chromium.launch({
  channel: process.env.ULTRAWIDE_BROWSER_CHANNEL || 'chromium',
  headless: true,
});
const folder = path.resolve('assets/screenshots');
await mkdir(folder, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1720, height: 1080 } });
  await page.goto(pathToFileURL(path.resolve('demo/standalone.html')).href);
  await page.getByRole('button', { name: 'Start fixture', exact: true }).click();
  await page.locator('[data-ultrawide-panel]').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    document.getElementById('secondary')?.remove();
    document.querySelector('.player-buttons')?.remove();
    document.querySelector('.captions')?.remove();
  });
  await page.getByRole('button', { name: 'Open extension controls', exact: true }).click();
  await page.getByRole('button', { name: 'Document fullscreen', exact: true }).click();
  await page.getByRole('radio', { name: 'Elastic', exact: true }).click();
  const wrap = page.locator('[data-ultrawide-panel]').locator('.wrap');
  await page.getByLabel('Protected center value').waitFor({ state: 'visible' });
  await wrap.screenshot({ path: path.join(folder, 'panel.png') });
  await page.setViewportSize({ width: 2160, height: 1080 });
  await page.screenshot({ path: path.join(folder, 'overview.png') });

  const popup = await browser.newPage({ viewport: { width: 380, height: 960 } });
  await popup.addInitScript(() => {
    const frame = {
      frameId: 0,
      active: true,
      origin: 'https://www.youtube.com',
      adapter: 'YouTube',
      settings: {
        mode: 'auto',
        zoom: 1,
        center: 0.6,
        strength: 1,
        ambientBrightness: 0.35,
        elasticBackend: 'webgl',
      },
      effectiveMode: 'ambient',
      ambientActive: true,
      loss: 0.2558,
      capabilities: { pixels: 'readable', webgl: true },
      message: 'Native foreground · Readable video',
    };
    globalThis.chrome = {
      tabs: { query: async () => [{ id: 1, url: 'https://www.youtube.com/' }] },
      runtime: {
        sendMessage: async (message) => ({
          result: message.type === 'frame-status' ? [frame] : true,
        }),
      },
    };
  });
  await popup.goto(pathToFileURL(path.resolve('dist/popup.html')).href);
  await popup.getByLabel('Ambient intensity value').waitFor({ state: 'visible' });
  // Capture the complete scrollable popup contents for the documentation.
  await popup.locator('body').evaluate((body) => {
    body.style.maxHeight = 'none';
    body.style.overflow = 'visible';
  });
  await popup.locator('body').screenshot({ path: path.join(folder, 'popup.png') });
} finally {
  await browser.close();
}
