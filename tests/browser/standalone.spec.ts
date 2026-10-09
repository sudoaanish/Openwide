import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

test('standalone file starts video, controls, ambience, and elastic', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 3440, height: 1440 });
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error('Standalone exception:', error.message);
  });
  await page.goto(pathToFileURL(path.resolve('demo/standalone.html')).href);
  await page.getByRole('button', { name: 'Start fixture', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => globalThis['fixture']?.state()?.capabilities.pixels))
    .toBe('readable');
  await page.getByRole('button', { name: 'Open extension controls' }).click();
  await expect(page.getByRole('button', { name: 'Compare' })).toBeVisible();
  await expect(page.locator('[data-ultrawide-effect="ambient"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Player fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('main-player');
  await testInfo.attach('fullscreen-ambient', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.evaluate(() => globalThis['fixture'].change({ mode: 'elastic' }));
  await expect(page.locator('#video')).toHaveCSS('opacity', '0');
  await expect(page.locator('[data-ultrawide-effect="elastic"]')).toHaveCount(1);
  await page.waitForTimeout(250);
  const centerPixel = await page.evaluate(() => {
    const s = globalThis['__ultrawideController'].session,
      r = s.elastic,
      p = s.plan;
    r.draw(s.video, p, s.effective());
    const out = new Uint8Array(4),
      x = Math.round(r.canvas.width / 2 + (100 * r.canvas.height) / 1080);
    r.gl.readPixels(x, Math.round(r.canvas.height / 2), 1, 1, r.gl.RGBA, r.gl.UNSIGNED_BYTE, out);
    return [...out];
  });
  expect(centerPixel[0], 'Protected-center circle must remain visible').toBeGreaterThan(180);
  await testInfo.attach('fullscreen-elastic', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(errors).toEqual([]);
});
