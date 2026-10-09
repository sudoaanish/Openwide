import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => console.error('Browser exception:', error.message));
});
async function start(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start fixture', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => globalThis['fixture']?.state()?.capabilities.pixels))
    .toBe('readable');
}
test('Auto preserves 16:9; ambient sits behind native video', async ({ page }) => {
  await start(page);
  await expect
    .poll(() => page.evaluate(() => globalThis['fixture'].state().settings.mode))
    .toBe('auto');
  await expect(page.locator('[data-ultrawide-effect="ambient"]')).toHaveCount(1);
  await expect(page.locator('#video')).toHaveCSS('opacity', '1');
  expect(await page.evaluate(() => globalThis['fixture'].state().loss)).toBeGreaterThan(0.25);
  await page.getByRole('button', { name: 'Pause/play' }).click();
  expect(await page.locator('#video').evaluate((v) => v.paused)).toBe(true);
});
test('encoded bars detected with logo; dark scenes retain stable crop', async ({ page }) => {
  await page.goto('/');
  await page.selectOption('#padding', 'encoded');
  await page.check('#logo');
  await page.getByRole('button', { name: 'Start fixture', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => globalThis['__ultrawideController']?.session?.detected.top), {
      timeout: 10000,
    })
    .toBeGreaterThan(0.1);
  const before = await page.evaluate(
    () => globalThis['__ultrawideController'].session.detected.top
  );
  await page.selectOption('#scene', 'dark');
  await page.waitForTimeout(1800);
  expect(await page.evaluate(() => globalThis['__ultrawideController'].session.detected.top)).toBe(
    before
  );
});
test('elastic draws successfully before hiding video; captions remain separate', async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => globalThis['fixture'].change({ mode: 'elastic' }));
  await expect(page.locator('[data-ultrawide-effect="elastic"]')).toHaveCount(1);
  await expect(page.locator('#video')).toHaveCSS('opacity', '0');
  await expect(page.locator('.captions')).toBeVisible();
  await page.getByRole('button', { name: 'Open extension controls' }).click();
  await expect(page.getByRole('button', { name: 'Compare' })).toBeVisible();
  await page.getByRole('button', { name: 'Compare' }).focus();
  await page.keyboard.down('Space');
  await expect(page.locator('#video')).not.toHaveCSS('opacity', '0');
  await page.keyboard.up('Space');
  await expect(page.locator('#video')).toHaveCSS('opacity', '0');
});
test('context loss restores native foreground', async ({ page }) => {
  await start(page);
  await page.evaluate(() => globalThis['fixture'].change({ mode: 'elastic' }));
  await expect(page.locator('#video')).toHaveCSS('opacity', '0');
  await page.evaluate(() =>
    globalThis['__ultrawideController'].session.elastic.gl
      .getExtension('WEBGL_lose_context')
      .loseContext()
  );
  await expect(page.locator('#video')).not.toHaveCSS('opacity', '0');
  await expect(page.locator('[data-ultrawide-effect="elastic"]')).toHaveCount(0);
  expect(await page.evaluate(() => globalThis['fixture'].state().capabilities.elasticFailed)).toBe(
    true
  );
});
test('blocked pixels fall back without changing playback source or audio', async ({ page }) => {
  await start(page);
  const source = await page.locator('#video').evaluate((v) => v.srcObject !== null);
  await page.getByRole('button', { name: 'Simulate blocked pixels' }).click();
  await page.evaluate(() => globalThis['fixture'].change({ mode: 'elastic' }));
  await expect(page.locator('[data-ultrawide-effect="elastic"]')).toHaveCount(0);
  await expect(page.locator('#video')).not.toHaveCSS('opacity', '0');
  expect(await page.locator('#video').evaluate((v) => v.srcObject !== null)).toBe(source);
  expect(await page.locator('#video').evaluate((v) => v.paused)).toBe(false);
});
test('manual crop overrides detection, survives resizing, resets per video', async ({ page }) => {
  await start(page);
  await page.evaluate(() => globalThis['__ultrawideController'].session.setBorder('top', 0.1));
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(await page.evaluate(() => globalThis['fixture'].state().settings.borders.top)).toBe(0.1);
  await page.evaluate(() => globalThis['fixture'].reset());
  expect(await page.evaluate(() => globalThis['fixture'].state().settings.borders.top)).toBe(0);
});
test('player replacement cleans old effects; disable restores styles and rate', async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => globalThis['fixture'].change({ speed: 1.5 }));
  await page.getByRole('button', { name: 'Replace video' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          globalThis['__ultrawideController'].session?.video === document.getElementById('video')
      )
    )
    .toBe(true);
  await expect.poll(() => page.evaluate(() => globalThis['fixture'].stats().panels)).toBe(1);
  await page.evaluate(() => globalThis['fixture'].disable());
  await expect.poll(() => page.evaluate(() => globalThis['fixture'].stats().effects)).toBe(0);
  expect(await page.locator('#video').evaluate((v) => (v as HTMLVideoElement).style.cssText)).toBe(
    ''
  );
  expect(await page.locator('#video').evaluate((v) => v.playbackRate)).toBe(1);
});
test('fullscreen effects belong to the player shell', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Player fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('main-player');
  expect(
    await page
      .locator('[data-ultrawide-effect="ambient"]')
      .evaluate((c) => document.fullscreenElement.contains(c))
  ).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator('#video')).not.toHaveCSS('opacity', '0');
});
test('settings round trip and multiple video selection', async ({ page }) => {
  await page.setViewportSize({ width: 1720, height: 1200 });
  await start(page);
  await page.evaluate(() => globalThis['__ultrawideController'].session.update({ zoom: 1.2 }));
  await page.evaluate(() => globalThis['__ultrawideController'].session.saveSite());
  await expect
    .poll(() => page.evaluate(() => Object.values(globalThis['fixture'].export().sites).length))
    .toBe(1);
  await page.evaluate(() => {
    const exported = globalThis['fixture'].export();
    globalThis['fixture'].import(exported);
  });
  await page.evaluate(() => {
    const controller = globalThis['__ultrawideController'];
    controller.scan();
    controller.select(controller.videos.findIndex((v) => v.id === 'second-video'));
  });
  expect(await page.evaluate(() => globalThis['__ultrawideController'].session.video.id)).toBe(
    'second-video'
  );
  await page.evaluate(() => globalThis['fixture'].destroy());
  expect(await page.evaluate(() => globalThis['fixture'].stats())).toEqual({
    effects: 0,
    panels: 0,
  });
});

test('paused windowboxed picture survives zero-height document fullscreen', async ({ page }) => {
  await page.setViewportSize({ width: 3440, height: 1440 });
  await page.goto('/');
  await page.selectOption('#picture', '2.39:1');
  await page.selectOption('#padding', 'windowbox');
  await page.check('#logo');
  await page.getByRole('button', { name: 'Start fixture', exact: true }).click();
  await expect
    .poll(() => page.locator('#video').evaluate((v) => (v as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Pause/play' }).click();
  await page.getByRole('button', { name: 'Document fullscreen', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement))
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.getBoundingClientRect().height)).toBe(
    0
  );
  await expect
    .poll(() => page.evaluate(() => globalThis['__ultrawideController'].session.detected.left), {
      timeout: 10000,
    })
    .toBeGreaterThan(0.1);
  const result = await page.evaluate(() => {
    const s = globalThis['__ultrawideController'].session;
    return {
      shell: s.adapter.shell.id,
      viewport: s.plan.viewport,
      picture: s.plan.picture,
      paused: s.video.paused,
      mode: s.plan.mode,
    };
  });
  expect(result.shell).toBe('main-player');
  expect(result.viewport).toEqual({ width: 3440, height: 1440 });
  expect(result.picture.width).toBeLessThan(1600);
  expect(result.picture.height).toBeLessThan(700);
  expect(Math.abs(result.picture.width - 1440)).toBeLessThan(8);
  expect(Math.abs(result.picture.height - 1440 / 2.39)).toBeLessThan(8);
  expect(result.paused).toBe(true);
  expect(['fill', 'ambient']).toContain(result.mode);
  await page.evaluate(() => globalThis['__ultrawideController'].command('toggle-panel'));
  await expect(page.getByRole('radiogroup', { name: 'Mode', exact: true })).toBeVisible();
  await page.evaluate(() => globalThis['fixture'].change({ mode: 'ambient' }));
  await expect(page.locator('[data-ultrawide-effect="ambient"]')).toHaveCount(1);
  await page.evaluate(() => globalThis['fixture'].change({ mode: 'elastic' }));
  await expect(page.locator('#video')).toHaveCSS('opacity', '0');
  await page.evaluate(() => document.exitFullscreen());
  await page.evaluate(() => globalThis['fixture'].destroy());
  await expect(
    page.locator('[data-ultrawide-panel],[data-ultrawide-effect],[data-ultrawide-launcher]')
  ).toHaveCount(0);
});

test('Fill covers UWQHD after encoded and four-sided padding removal', async ({ page }) => {
  await page.setViewportSize({ width: 3440, height: 1440 });
  for (const padding of ['encoded', 'windowbox']) {
    await page.goto('/');
    await page.selectOption('#picture', '2.39:1');
    await page.selectOption('#padding', padding);
    await page.check('#logo');
    await page.getByRole('button', { name: 'Start fixture', exact: true }).click();
    await page.getByRole('button', { name: 'Document fullscreen', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => globalThis['__ultrawideController']?.session?.detected.top), {
        timeout: 10000,
      })
      .toBeGreaterThan(0.1);
    await page.evaluate(() => globalThis['__ultrawideController'].command('toggle-panel'));
    await page.getByRole('radio', { name: 'Fill', exact: true }).click();
    const p = await page.evaluate(() => {
      const s = globalThis['__ultrawideController'].session,
        p = s.plan;
      return {
        mode: p.mode,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
        loss: p.loss,
        opacity: getComputedStyle(s.video).opacity,
        source: s.video.srcObject !== null,
      };
    });
    expect(p.mode).toBe('fill');
    expect(p.x).toBeLessThanOrEqual(0.01);
    expect(p.y).toBeLessThanOrEqual(0.01);
    expect(p.width).toBeGreaterThanOrEqual(3440);
    expect(p.height).toBeGreaterThanOrEqual(1440);
    expect(p.loss).toBeLessThan(0.02);
    expect(p.opacity).toBe('1');
    expect(p.source).toBe(true);
    await page.getByRole('radio', { name: 'Auto', exact: true }).click();
    expect(await page.evaluate(() => globalThis['__ultrawideController'].session.plan.mode)).toBe(
      'fill'
    );
    await page.evaluate(() => document.exitFullscreen());
  }
});

test('native fitting neutralizes and restores another fitter individual scale', async ({
  page,
}) => {
  await page.setViewportSize({ width: 3440, height: 1440 });
  await page.goto('/');
  await page.locator('#video').evaluate((v) => {
    (v as HTMLElement).style.setProperty('scale', '1.4', 'important');
  });
  await page.getByRole('button', { name: 'Start fixture', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => globalThis['fixture']?.state()?.capabilities.pixels))
    .toBe('readable');
  await page.getByRole('button', { name: 'Document fullscreen', exact: true }).click();
  await page.evaluate(() => globalThis['__ultrawideController'].command('toggle-panel'));
  await page.getByRole('radio', { name: 'Fill', exact: true }).click();
  await expect(page.locator('#video')).toHaveCSS('scale', '1');
  expect(await page.locator('#video').evaluate((v) => v.getBoundingClientRect().width)).toBeCloseTo(
    3440,
    0
  );
  await page.getByRole('radio', { name: 'Original', exact: true }).click();
  expect(
    await page.locator('#video').evaluate((v) => (v as HTMLElement).style.getPropertyValue('scale'))
  ).toBe('1.4');
});

test('YouTube controls replace the floating launcher and survive control-bar replacement', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const shell = document.getElementById('main-player');
    shell.classList.add('html5-video-player');
    const style = document.createElement('style');
    style.textContent =
      '.ytp-right-controls .ytp-button{width:48px;height:40px;line-height:0;display:inline-block}.ytp-right-controls .ytp-button svg{box-sizing:content-box;width:24px;height:24px;padding:8px 12px}';
    document.head.append(style);
    const bar = document.createElement('div');
    bar.className = 'ytp-right-controls';
    bar.style.cssText = 'position:absolute;bottom:0;right:0;z-index:10;background:#333';
    bar.innerHTML =
      '<span class="other-extension-wrapper"><span><button class="ytp-fullscreen-button">Native fullscreen</button></span></span>';
    shell.append(bar);
  });
  await page.getByRole('button', { name: 'Start fixture', exact: true }).click();
  const controls = page.locator('.ytp-right-controls [data-ultrawide-control]');
  await expect(controls).toHaveCount(3);
  for (const button of await controls.all()) {
    const alignment = await button.evaluate((b) => {
      const r = b.getBoundingClientRect(),
        s = b.querySelector('svg').getBoundingClientRect();
      return {
        dx: (s.left + s.right - r.left - r.right) / 2,
        dy: (s.top + s.bottom - r.top - r.bottom) / 2,
        width: s.width,
        height: s.height,
      };
    });
    expect(alignment.dx).toBeCloseTo(0, 1);
    expect(alignment.dy).toBeCloseTo(0, 1);
    expect(alignment.width).toBe(48);
    expect(alignment.height).toBe(40);
  }
  expect(
    await page.locator('[data-ultrawide-launcher]').evaluate((b) => getComputedStyle(b).position)
  ).not.toBe('absolute');
  await page.getByRole('button', { name: 'Openwide: Zoom to Fill', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Openwide: Zoom to Fill', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Openwide: Zoom to Fill', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => globalThis['fixture'].state().settings.mode))
    .toBe('fit');
  await page.getByRole('button', { name: 'Openwide: Elastic Stretch', exact: true }).click();
  await expect(page.locator('#video')).toHaveCSS('opacity', '0');
  await page.getByRole('button', { name: 'Open Openwide controls', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: 'Mode', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => {
    const bar = document.querySelector('.ytp-right-controls'),
      replacement = bar.cloneNode(false);
    replacement.innerHTML =
      '<span class="other-extension-wrapper"><button class="ytp-fullscreen-button">Native fullscreen</button></span>';
    bar.replaceWith(replacement);
  });
  await expect(controls).toHaveCount(3);
  await page.getByRole('button', { name: 'Open Openwide controls', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('radiogroup', { name: 'Mode', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Simulate blocked pixels' }).click();
  await expect(
    page.getByRole('button', { name: 'Openwide: Elastic Stretch', exact: true })
  ).toBeDisabled();
  await page.evaluate(() => globalThis['fixture'].destroy());
  await expect(page.locator('[data-ultrawide-control],[data-ultrawide-panel]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Native fullscreen' })).toBeVisible();
});
