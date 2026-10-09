import { describe, it, expect } from 'vitest';
import {
  DEFAULTS,
  clone,
  renderPlan,
  cropLoss,
  elasticMap,
  validateSettings,
  validateStore,
  mergeSettings,
  detectPadding,
  PaddingTracker,
} from '../../src/core';
const screen = { width: 3440, height: 1440 },
  source = { width: 1920, height: 1080 };
function frame(width = 240, height = 135, bars = 17) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = bars; y < height - bars; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = 100;
      data[i + 1] = 140;
      data[i + 2] = 90;
      data[i + 3] = 255;
    }
  return { data, width, height };
}
describe('Auto and fitting', () => {
  it('preserves 16:9 with 440px sidebars', () => {
    const p = renderPlan(source, screen, DEFAULTS);
    expect(p.mode).toBe('ambient');
    expect(p.x).toBe(440);
    expect(p.width).toBe(2560);
    expect(p.height).toBe(1440);
    expect(p.loss).toBeCloseTo(0.2558139534883721, 10);
  });
  it('removes encoded padding before estimating picture loss', () => {
    const p = renderPlan(source, screen, {
      ...DEFAULTS,
      borders: { top: 0.125, bottom: 0.125, left: 0, right: 0 },
    });
    expect(p.mode).toBe('fill');
    expect(p.loss).toBeLessThan(0.02);
  });
  it('obeys the crop budget boundary', () => {
    const loss = cropLoss(16 / 9, 43 / 18);
    expect(renderPlan(source, screen, { ...DEFAULTS, cropBudget: 0 }).mode).toBe('ambient');
    const viewport = { width: 1930, height: 1080 };
    expect(renderPlan(source, viewport, { ...DEFAULTS, cropBudget: 0.005 }).mode).toBe('ambient');
    expect(renderPlan(source, viewport, { ...DEFAULTS, cropBudget: 0.01 }).mode).toBe('fill');
    expect(loss).toBeGreaterThan(0.1);
  });
  it.each([4 / 3, 16 / 9, 2.39, 9 / 16])('fits ratio %s', (aspect) => {
    const p = renderPlan({ width: Math.round(1080 * aspect), height: 1080 }, screen, {
      ...DEFAULTS,
      mode: 'fit',
    });
    expect(p.width).toBeLessThanOrEqual(screen.width);
    expect(p.height).toBeLessThanOrEqual(screen.height);
    expect(p.width / p.height).toBeCloseTo(Math.round(1080 * aspect) / 1080);
  });
  it('rotates and flips without changing crop-loss policy', () => {
    const p = renderPlan(source, screen, { ...DEFAULTS, rotation: 90, flipX: true, mode: 'fit' });
    expect(p.quarter).toBe(true);
    expect(p.width / p.height).toBeCloseTo(9 / 16);
  });
  it('supports custom aspect, zoom and pan', () => {
    const p = renderPlan(source, screen, {
      ...DEFAULTS,
      mode: 'fit',
      aspect: 43 / 18,
      zoom: 1.1,
      panX: 0.2,
    });
    expect(p.width).toBeCloseTo(3784);
    expect(p.x).toBeCloseTo(172);
  });
});
describe('elastic mapping', () => {
  it.each([0.3, 0.6, 0.8])('is monotonic, invertible and bounded at center %s', (center) => {
    const m = elasticMap(2560, 3440, center);
    expect(m.forward(0)).toBeCloseTo(0);
    expect(m.forward(2560)).toBeCloseTo(m.width);
    let previous = -1;
    for (let x = 0; x <= 2560; x += 0.5) {
      const y = m.forward(x);
      expect(y).toBeGreaterThan(previous);
      expect(m.inverse(y)).toBeCloseTo(x, 3);
      previous = y;
    }
    const cx = 1280,
      delta = 100;
    expect(m.forward(cx + delta) - m.forward(cx - delta)).toBeCloseTo(2 * delta);
    expect(m.maxExpansion).toBeLessThanOrEqual(2);
  });
  it('fills this monitor at default center protection', () => {
    expect(elasticMap(2560, 3440, 0.6).width).toBeCloseTo(3440);
  });
  it('leaves ambient space when expansion would exceed 2x', () => {
    const m = elasticMap(2560, 5000, 0.8);
    expect(m.width).toBeLessThan(5000);
    expect(m.maxExpansion).toBe(2);
  });
  it('has identity at zero strength and smooth protected-band boundaries', () => {
    const m = elasticMap(2560, 3440, 0.6, 0);
    expect(m.width).toBe(2560);
    const w = elasticMap(2560, 3440, 0.6),
      x = 1280 + 768,
      e = 0.001;
    expect((w.forward(x + e) - w.forward(x - e)) / (2 * e)).toBeCloseTo(1, 4);
  });
});
describe('settings', () => {
  it.each([
    { mode: 'bad' },
    { zoom: 0 },
    { cropBudget: 0.2 },
    { rotation: 45 },
    { speed: NaN },
    { borders: { top: 0.8 } },
  ])('rejects invalid values %j', (value) => expect(() => validateSettings(value)).toThrow());
  it('ignores unknown fields, validates versions, and forbids full URLs', () => {
    expect(validateSettings({ future: 'value' })).toEqual({});
    expect(() => validateStore({ version: 2 })).toThrow();
    expect(() =>
      validateStore({ version: 1, sites: { 'https://example.org/watch?v=123': {} } })
    ).toThrow();
    expect(() => validateStore({ version: 1, sites: { 'https://u:p@example.org': {} } })).toThrow();
  });
  it('round-trips local settings and uses override precedence', () => {
    const store = validateStore({
      version: 1,
      global: DEFAULTS,
      sites: { 'https://example.org': { zoom: 1.2 } },
      disabled: [],
    });
    const s = mergeSettings(store.global, store.sites['https://example.org'], { zoom: 1.5 });
    expect(s.zoom).toBe(1.5);
    expect(validateStore(JSON.parse(JSON.stringify(store)))).toEqual(store);
  });
});
describe('padding detection', () => {
  it('uses safety margin and five-frame hysteresis', () => {
    const f = frame(),
      b = detectPadding(f.data, f.width, f.height);
    expect(b.top).toBe(15 / 135);
    const tracker = new PaddingTracker();
    for (let i = 0; i < 4; i++) expect(tracker.update(f.data, f.width, f.height)).toBeNull();
    expect(tracker.update(f.data, f.width, f.height)).not.toBeNull();
  });
  it('rejects dark frames and preserves prior detection through fades', () => {
    const f = frame(),
      tracker = new PaddingTracker();
    for (let i = 0; i < 5; i++) tracker.update(f.data, f.width, f.height);
    const prior = { ...tracker.current };
    expect(tracker.update(new Uint8ClampedArray(f.data.length), f.width, f.height)).toBeNull();
    expect(tracker.current).toEqual(prior);
  });
  it('tolerates a small isolated border logo', () => {
    const f = frame();
    for (let y = 1; y < 8; y++)
      for (let x = 180; x < 195; x++) {
        const i = (y * f.width + x) * 4;
        f.data[i] = 255;
        f.data[i + 1] = 255;
        f.data[i + 2] = 255;
      }
    expect(detectPadding(f.data, f.width, f.height).top).toBe(15 / 135);
  });
});

describe('conservative crop release', () => {
  it('keeps symmetric bars stable through repeated changing localized promotions', () => {
    const tracker = new PaddingTracker(),
      base = frame();
    for (let i = 0; i < 5; i++) tracker.update(base.data, base.width, base.height);
    const prior = { ...tracker.current };
    for (let n = 0; n < 80; n++) {
      const f = frame();
      if (n % 12 < 6)
        for (let y = 120; y < 134; y++)
          for (let x = 95; x < 135; x++) {
            const i = (y * f.width + x) * 4;
            f.data[i] = f.data[i + 1] = f.data[i + 2] = 255;
          }
      tracker.update(f.data, f.width, f.height);
      expect(tracker.current).toEqual(prior);
    }
  });
  it('does not classify broad bottom text as a localized promotion', () => {
    const f = frame();
    for (let y = 120; y < 130; y++)
      for (let x = 25; x < 215; x++) {
        const i = (y * f.width + x) * 4;
        f.data[i] = f.data[i + 1] = f.data[i + 2] = 255;
      }
    expect(detectPadding(f.data, f.width, f.height).bottom).toBeLessThan(
      detectPadding(f.data, f.width, f.height).top
    );
  });
  it('retains broad changing caption borders without repeatedly panning the picture', () => {
    const tracker = new PaddingTracker(),
      base = frame();
    for (let i = 0; i < 5; i++) tracker.update(base.data, base.width, base.height);
    for (let n = 0; n < 60; n++) {
      const f = frame();
      if (n % 12 < 6)
        for (let y = 120; y < 130; y++)
          for (let x = 25; x < 215; x++) {
            const i = (y * f.width + x) * 4;
            f.data[i] = f.data[i + 1] = f.data[i + 2] = 255;
          }
      tracker.update(f.data, f.width, f.height);
      expect(tracker.current.top).toBe(0);
      expect(tracker.current.bottom).toBe(0);
    }
  });
  it('widens immediately when real picture enters previously detected padding', () => {
    const f = frame(),
      tracker = new PaddingTracker();
    for (let i = 0; i < 5; i++) tracker.update(f.data, f.width, f.height);
    const full = frame(240, 135, 0);
    const changed = tracker.update(full.data, full.width, full.height);
    expect(changed.top).toBe(0);
    expect(changed.bottom).toBe(0);
  });
  it('tolerates a wider isolated top-border watermark', () => {
    const f = frame();
    for (let y = 1; y < 12; y++)
      for (let x = 180; x < 220; x++) {
        const i = (y * f.width + x) * 4;
        f.data[i] = 255;
        f.data[i + 1] = 255;
        f.data[i + 2] = 255;
      }
    expect(detectPadding(f.data, f.width, f.height).top).toBe(15 / 135);
  });
});
