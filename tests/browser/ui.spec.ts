import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
async function panel(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start fixture', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => globalThis['fixture']?.state()?.capabilities.pixels))
    .toBe('readable');
  await page.getByRole('button', { name: 'Open extension controls' }).click();
}
test('seven requested modes, conditional effects, numeric validation and defaults', async ({
  page,
}) => {
  await panel(page);
  for (const mode of ['Fit', 'Fill', 'Elastic', 'Ambient', 'Auto', 'Original', 'Stretch']) {
    await page.getByRole('radio', { name: mode, exact: true }).click();
    await expect(page.getByRole('radio', { name: mode, exact: true })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await expect(page.getByLabel('Protected center value')).toBeVisible({
      visible: mode === 'Elastic',
    });
    if (['Ambient', 'Auto'].includes(mode))
      await expect(page.getByLabel('Ambient intensity value')).toBeVisible();
  }
  const zoom = page.getByLabel('Zoom value', { exact: true });
  await zoom.fill('8');
  await zoom.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Enter a value from 0.25 to 4');
  expect(await page.evaluate(() => globalThis['fixture'].state().settings.zoom)).toBe(1);
  await page.getByRole('button', { name: 'Reset Zoom', exact: true }).click();
  await expect(zoom).toHaveValue('1');
  await expect(zoom).not.toHaveAttribute('aria-invalid', 'true');
  await zoom.fill('1.2');
  await zoom.press('Enter');
  await expect
    .poll(() => page.evaluate(() => globalThis['fixture'].state().settings.zoom))
    .toBe(1.2);
  await page.getByRole('button', { name: 'Reset Zoom', exact: true }).click();
  await expect(zoom).toHaveValue('1');
});
test('keyboard selection, Escape focus return and explicit unavailable fallback', async ({
  page,
}) => {
  await panel(page);
  await page.getByRole('radio', { name: 'Fit', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Fill', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('radiogroup')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open extension controls' })).toBeFocused();
  await page.getByRole('button', { name: 'Open extension controls' }).click();
  await page.getByRole('button', { name: 'Simulate blocked pixels' }).click();
  await page.evaluate(() => globalThis['fixture'].change({ mode: 'elastic' }));
  await expect(page.getByRole('radio', { name: 'Elastic', exact: true })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Elastic', exact: true })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await expect(page.locator('[data-ultrawide-panel]').locator('.status-summary')).toContainText(
    'Elastic unavailable'
  );
});
test('panel screenshots and viewport containment at standard, ultrawide and 200% zoom', async ({
  page,
}) => {
  await mkdir('artifacts', { recursive: true });
  await panel(page);
  // 200% browser zoom halves the available CSS viewport. Test that layout
  // directly rather than CSS zoom, which has different fixed-position semantics.
  for (const [name, width, height] of [
    ['standard', 1280, 720],
    ['ultrawide', 3440, 1440],
    ['zoom-200', 640, 360],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.getByRole('radio', { name: 'Elastic', exact: true }).click();
    const wrap = page.locator('[data-ultrawide-panel]').locator('.wrap');
    const box = await wrap.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    await page.screenshot({ path: 'artifacts/openwide-panel-' + name + '.png' });
  }
});
async function popup(page, active = true) {
  await page.addInitScript(
    ({ active }) => {
      const settings = {
        mode: 'auto',
        zoom: 1,
        center: 0.6,
        strength: 1,
        ambientBrightness: 0.35,
        elasticBackend: 'webgl',
      };
      const frame = {
        frameId: 0,
        active: true,
        origin: 'https://www.youtube.com',
        adapter: 'YouTube',
        settings,
        effectiveMode: 'ambient',
        ambientActive: true,
        loss: 0.256,
        capabilities: { pixels: 'readable', webgl: true },
        message: 'Readable video · Native foreground',
      };
      globalThis['chrome'] = {
        tabs: { query: async () => [{ id: 7, url: 'https://www.youtube.com/watch?v=fixture' }] },
        permissions: { request: async () => false },
        runtime: {
          sendMessage: async (m) => {
            if (m.type === 'frame-status') return { result: active ? [frame] : [] };
            if (m.type === 'frame-command') {
              if (m.command.patch) {
                Object.assign(settings, m.command.patch);
                frame.effectiveMode = settings.mode === 'auto' ? 'ambient' : settings.mode;
                frame.ambientActive = ['ambient', 'auto'].includes(settings.mode);
              }
              return { result: true };
            }
            return { result: true };
          },
        },
      };
    },
    { active }
  );
  await page.goto('/dist/popup.html');
}
test('popup modes route to selected frame; no-video and denied-permission states', async ({
  page,
}) => {
  await popup(page);
  await expect(page.getByRole('radio', { name: 'Auto', exact: true })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await expect(page.locator('#status')).toContainText('Fill would crop 25.6%');
  await expect(page.getByLabel('Player frame')).toBeHidden();
  await page.getByRole('radio', { name: 'Elastic', exact: true }).click();
  await expect(page.getByLabel('Protected center value')).toBeVisible();
  await page.getByRole('radio', { name: 'Fit', exact: true }).click();
  await expect(page.getByLabel('Protected center value')).toBeHidden();
  await page.getByRole('radio', { name: 'Auto', exact: true }).click();
  await mkdir('artifacts', { recursive: true });
  await page.setViewportSize({ width: 380, height: 720 });
  await page.screenshot({ path: 'artifacts/openwide-popup.png' });
  await page.getByRole('button', { name: 'Enable on this site' }).click();
  await expect(page.locator('#status')).toContainText('Permission declined');
});
test('popup without video leaves modes visible and disabled', async ({ page }) => {
  await popup(page, false);
  await expect(page.getByRole('radio')).toHaveCount(7);
  await expect(page.getByRole('radio', { name: 'Fill', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Open player controls' })).toBeDisabled();
  await expect(page.locator('#status')).toContainText('Enable this site');
});
