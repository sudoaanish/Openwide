// Trim transparent padding and generate square PNGs from the source artwork.
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const data = await readFile(new URL('../logos/OPENWIDE-LOGO-transparent.png', import.meta.url));
const browser = await chromium.launch({
  channel: process.env.ULTRAWIDE_BROWSER_CHANNEL || 'chrome',
  headless: true,
});
try {
  const page = await browser.newPage();
  const result = await page.evaluate(
    async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let x0 = canvas.width,
        y0 = canvas.height,
        x1 = 0,
        y1 = 0;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++)
          if (pixels[(y * canvas.width + x) * 4 + 3] > 0) {
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
          }
      const width = x1 - x0 + 1,
        height = y1 - y0 + 1,
        out = {};
      for (const size of [16, 32, 48, 128, 512]) {
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size === 512 ? Math.round((size * height) / width) : size;
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        const scale = Math.min(c.width / width, c.height / height);
        g.drawImage(
          canvas,
          x0,
          y0,
          width,
          height,
          (c.width - width * scale) / 2,
          (c.height - height * scale) / 2,
          width * scale,
          height * scale
        );
        out[size] = c.toDataURL('image/png').split(',')[1];
      }
      return out;
    },
    'data:image/png;base64,' + data.toString('base64')
  );
  const folder = new URL('../public/icons/', import.meta.url);
  await mkdir(folder, { recursive: true });
  for (const [size, png] of Object.entries(result))
    await writeFile(
      new URL(size === '512' ? 'openwide-logo.png' : `openwide-${size}.png`, folder),
      Buffer.from(png, 'base64')
    );
} finally {
  await browser.close();
}
