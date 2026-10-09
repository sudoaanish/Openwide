import { test, expect, chromium } from '@playwright/test';
import { mkdir, mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

test('real MV3 worker, injection, profiles, popup routing, and disable', async () => {
  test.setTimeout(60000);
  const cache = path.resolve('.cache');
  await mkdir(cache, { recursive: true });
  const temp = await mkdtemp(path.join(cache, 'mv3-'));
  const extension = path.join(temp, 'extension'),
    profile = path.join(temp, 'profile');
  await cp(path.resolve('dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  // Test grant only; the shipped manifest retains optional host permissions.
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  const executablePath = process.env.ULTRAWIDE_CHROMIUM_PATH;
  const context = await chromium.launchPersistentContext(profile, {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }),
    headless: true,
    viewport: { width: 1720, height: 720 },
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
  });
  try {
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).hostname;
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/?extension=1');
    await page.getByRole('button', { name: 'Start fixture', exact: true }).click();
    const popup = await context.newPage();
    await popup.goto('chrome-extension://' + id + '/popup.html');
    const tabId = await popup.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:4173/*' });
      return tabs[0].id;
    });
    const send = (message) =>
      popup.evaluate((message) => chrome.runtime.sendMessage(message), message);
    // A pre-rename export/storage record must retain profiles and disabled origins.
    const legacy = {
      version: 1,
      global: { mode: 'auto' },
      sites: { 'https://legacy.example': { zoom: 1.25, mode: 'fill' } },
      disabled: ['https://disabled.example'],
    };
    await popup.evaluate(
      async (value) => chrome.storage.local.set({ ultrawideSettingsV1: value }),
      legacy
    );
    const imported = await send({ type: 'import-store', value: legacy });
    expect(imported.error).toBeUndefined();
    const retained = await send({ type: 'export-store' });
    expect(retained.result.sites['https://legacy.example']).toEqual(
      legacy.sites['https://legacy.example']
    );
    expect(retained.result.disabled).toContain('https://disabled.example');
    const enabled = await send({ type: 'enable-origin', origin: 'http://127.0.0.1:4173', tabId });
    expect(enabled.error, JSON.stringify(enabled)).toBeUndefined();
    await expect
      .poll(async () => {
        const reply = await send({ type: 'frame-status', tabId });
        return reply.result?.find((f) => f.active)?.capabilities.pixels;
      })
      .toBe('readable');
    await page.bringToFront();
    await send({
      type: 'frame-command',
      tabId,
      frameId: 0,
      command: { type: 'change', patch: { mode: 'elastic' } },
    });
    await expect(page.locator('[data-ultrawide-effect="elastic"]')).toHaveCount(1);
    await expect(page.locator('#video')).toHaveCSS('opacity', '0');
    const saved = await send({
      type: 'save-profile',
      origin: 'http://127.0.0.1:4173',
      settings: { mode: 'ambient', zoom: 1.1 },
    });
    expect(saved.error, JSON.stringify(saved)).toBeUndefined();
    const exported = await send({ type: 'export-store' });
    expect(exported.result.sites['http://127.0.0.1:4173'].zoom).toBe(1.1);
    const denied = await send({
      type: 'enable-origin',
      origin: 'https://ungranted.invalid',
      tabId,
    });
    expect(denied.error).toContain('not been granted');
    await send({ type: 'disable-origin', origin: 'http://127.0.0.1:4173' });
    await expect(page.locator('[data-ultrawide-effect]')).toHaveCount(0);
    expect(
      await page.locator('#video').evaluate((v) => (v as HTMLVideoElement).style.cssText)
    ).toBe('');
  } finally {
    await context.close();
    if (!path.resolve(temp).startsWith(cache + path.sep))
      throw Error('Unexpected test cache path.');
    await rm(temp, { recursive: true, force: true });
  }
});
