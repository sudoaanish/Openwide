import { chromium } from '@playwright/test';
import { mkdir, mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
const cache = path.resolve('.cache');
await mkdir(cache, { recursive: true });
const temp = await mkdtemp(path.join(cache, 'youtube-'));
const extension = path.join(temp, 'extension');
await cp(path.resolve('dist'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['https://www.youtube.com/*'];
await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
  executablePath: process.env.ULTRAWIDE_CHROMIUM_PATH,
  headless: true,
  viewport: { width: 3440, height: 1440 },
  args: [
    '--disable-extensions-except=' + extension,
    '--load-extension=' + extension,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const report = {
  url: 'https://www.youtube.com/watch?v=MLkn9ED_Ay8',
  isolatedProfile: true,
  checks: [],
  errors: [],
};
try {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const popup = await context.newPage();
  await popup.goto('chrome-extension://' + new URL(worker.url()).hostname + '/popup.html');
  const page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto(report.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(8000);
  report.title = await page.title();
  report.finalUrl = page.url();
  report.pageText = (await page.locator('body').innerText()).slice(0, 5000);
  await page.screenshot({ path: path.resolve('.cache/youtube-initial.png') });
  report.playerMessage = await page.locator('.ytp-error').allTextContents();
  report.video = await page.locator('video').evaluateAll((videos) =>
    videos.map((v) => ({
      width: v.videoWidth,
      height: v.videoHeight,
      readyState: v.readyState,
      paused: v.paused,
      time: v.currentTime,
      duration: v.duration,
      mediaKeys: !!v.mediaKeys,
      error: v.error?.message,
    }))
  );
  if (!report.video.length)
    throw Error('No YouTube video element was available: ' + report.pageText);
  const tabId = await popup.evaluate(
    async () => (await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' }))[0].id
  );
  const send = (message) =>
    popup.evaluate((message) => chrome.runtime.sendMessage(message), message);
  report.enabled = await send({ type: 'enable-origin', origin: 'https://www.youtube.com', tabId });
  await page.waitForTimeout(3000);
  report.initialStatus = await send({ type: 'frame-status', tabId });
  const playable = report.video.some((v) => v.width > 0 && v.readyState >= 2);
  if (playable) {
    await page
      .locator('video')
      .first()
      .evaluate(async (v) => {
        v.currentTime = 2493;
        await v.play();
      });
    await page.waitForTimeout(4000);
    const fullscreen = page.locator('.ytp-fullscreen-button').first();
    await fullscreen.click();
    await page.waitForTimeout(2000);
    for (const mode of ['original', 'auto', 'ambient', 'elastic']) {
      await send({
        type: 'frame-command',
        tabId,
        frameId: 0,
        command: { type: 'change', patch: { mode } },
      });
      await page.waitForTimeout(1800);
      report.checks.push({
        mode,
        status: await send({ type: 'frame-status', tabId }),
        dom: await page.evaluate(() => ({
          fullscreen: !!document.fullscreenElement,
          effects: [...document.querySelectorAll('[data-ultrawide-effect]')].map((e) => ({
            kind: e.dataset.ultrawideEffect,
            insideFullscreen: document.fullscreenElement?.contains(e),
          })),
          videoOpacity: document.querySelector('video').style.opacity,
        })),
      });
      await page.screenshot({ path: path.resolve('.cache/youtube-' + mode + '.png') });
    }
    await send({ type: 'disable-origin', origin: 'https://www.youtube.com' });
    await page.waitForTimeout(500);
    report.cleanup = await page.evaluate(() => ({
      effects: document.querySelectorAll('[data-ultrawide-effect]').length,
      videoStyle: document.querySelector('video').style.cssText,
    }));
  } else {
    report.blockedReason = (await page.locator('body').innerText()).slice(0, 5000);
    await page.screenshot({ path: path.resolve('.cache/youtube-unavailable.png') });
  }
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  await writeFile(path.resolve('.cache/youtube-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await context.close();
  if (!path.resolve(temp).startsWith(cache + path.sep)) throw Error('Unexpected cache path');
  await rm(temp, { recursive: true, force: true });
}
