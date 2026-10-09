// Pure geometry and settings. No browser or extension dependencies.
export const MODES = ['original', 'fit', 'fill', 'auto', 'stretch', 'elastic', 'ambient'];
export const DEFAULTS = {
  mode: 'auto',
  cropBudget: 0.02,
  zoom: 1,
  panX: 0,
  panY: 0,
  aspect: 0,
  rotation: 0,
  flipX: false,
  flipY: false,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  speed: 1,
  borders: { top: 0, right: 0, bottom: 0, left: 0 },
  detectBars: true,
  lockBars: false,
  center: 0.6,
  strength: 1,
  ambientBrightness: 0.35,
  ambientBlur: 60,
  ambientSpread: 1.15,
  ambientSmoothing: 250,
  ambientQuality: 0.5,
  ambientFps: 30,
  elasticBackend: 'webgl',
};
export const LIMITS = {
  cropBudget: [0, 0.1],
  zoom: [0.25, 4],
  panX: [-1, 1],
  panY: [-1, 1],
  aspect: [0, 8],
  brightness: [0, 2],
  contrast: [0, 2],
  saturation: [0, 2],
  speed: [0.25, 4],
  center: [0.3, 0.8],
  strength: [0, 1],
  ambientBrightness: [0, 1],
  ambientBlur: [0, 160],
  ambientSpread: [1, 2],
  ambientSmoothing: [0, 2000],
  ambientQuality: [0.25, 1],
  ambientFps: [5, 30],
};
export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
export function clamp(n, a, b) {
  return Math.min(b, Math.max(a, n));
}
export function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Settings must be an object.');
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const v = value[key];
    if (key === 'borders') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Invalid borders.');
      const borders = { ...DEFAULTS.borders };
      for (const edge of Object.keys(borders)) {
        if (v[edge] !== undefined) {
          if (!Number.isFinite(v[edge]) || v[edge] < 0 || v[edge] > 0.45)
            throw Error('Borders must be between 0 and 45%.');
          borders[edge] = v[edge];
        }
      }
      out[key] = borders;
    } else if (key === 'mode') {
      if (!MODES.includes(v)) throw Error('Invalid mode.');
      out[key] = v;
    } else if (key === 'rotation') {
      if (![0, 90, 180, 270].includes(v)) throw Error('Invalid rotation.');
      out[key] = v;
    } else if (key === 'elasticBackend') {
      if (!['webgl', 'svg'].includes(v)) throw Error('Invalid elastic backend.');
      out[key] = v;
    } else if (key in LIMITS) {
      const [a, b] = LIMITS[key];
      if (!Number.isFinite(v) || v < a || v > b) throw Error('Invalid ' + key + '.');
      out[key] = v;
    } else {
      if (typeof v !== 'boolean') throw Error('Invalid ' + key + '.');
      out[key] = v;
    }
  }
  return out;
}
export function validateStore(value) {
  if (!value || value.version !== 1) throw Error('Expected settings version 1.');
  const global = { ...clone(DEFAULTS), ...validateSettings(value.global || {}) };
  const sites = {};
  const disabled = [];
  const validOrigin = (s) => {
    const url = new URL(s);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== s ||
      url.username ||
      url.password
    )
      throw Error('Profiles must use HTTP/HTTPS origins only.');
    return s;
  };
  if (value.sites && (typeof value.sites !== 'object' || Array.isArray(value.sites)))
    throw Error('Invalid site profiles.');
  for (const [origin, settings] of Object.entries(value.sites || {}))
    sites[validOrigin(origin)] = validateSettings(settings);
  if (value.disabled !== undefined && !Array.isArray(value.disabled))
    throw Error('Invalid disabled-site list.');
  for (const origin of value.disabled || []) disabled.push(validOrigin(origin));
  return { version: 1, global, sites, disabled: [...new Set(disabled)] };
}
export function mergeSettings(global, site, temporary) {
  return {
    ...clone(DEFAULTS),
    ...global,
    ...site,
    ...temporary,
    borders: { ...DEFAULTS.borders, ...global?.borders, ...site?.borders, ...temporary?.borders },
  };
}
export function pictureBounds(width, height, borders) {
  const x = Math.round(width * borders.left),
    y = Math.round(height * borders.top);
  return {
    x,
    y,
    width: Math.max(1, width - x - Math.round(width * borders.right)),
    height: Math.max(1, height - y - Math.round(height * borders.bottom)),
  };
}
export function cropLoss(sourceAspect, targetAspect) {
  return 1 - Math.min(sourceAspect / targetAspect, targetAspect / sourceAspect);
}
// Smoothstep edge derivative starts at 1, ends at 1+k. The protected band is linear.
// A short smooth transition followed by a flat derivative keeps edge expansion bounded.
// Its integral produces a C2 continuous, strictly increasing forward map.
export function elasticMap(sourceWidth, desiredWidth, center, strength = 1) {
  const half = sourceWidth / 2,
    protectedHalf = half * center,
    edge = half - protectedHalf;
  const transition = 0.2,
    integralAtEnd = 1 - transition / 2;
  const desiredExtra = Math.max(0, desiredWidth - sourceWidth);
  const k = clamp(desiredExtra / Math.max(2 * edge * integralAtEnd, 1), 0, 1) * strength;
  const width = sourceWidth + 2 * edge * k * integralAtEnd;
  const integral = (t) => {
    if (t >= transition) return t - transition / 2;
    const u = t / transition;
    return transition * (u * u * u - 0.5 * u * u * u * u);
  };
  const forward = (x) => {
    const d = x - half,
      sign = d < 0 ? -1 : 1,
      a = Math.abs(d);
    if (a <= protectedHalf) return width / 2 + d;
    const t = clamp((a - protectedHalf) / edge, 0, 1);
    return width / 2 + sign * (protectedHalf + edge * (t + k * integral(t)));
  };
  const inverse = (x) => {
    let a = 0,
      b = sourceWidth;
    for (let i = 0; i < 24; i++) {
      const m = (a + b) / 2;
      if (forward(m) < x) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  return { sourceWidth, width, k, maxExpansion: 1 + k, forward, inverse };
}
export function renderPlan(source, viewport, settings) {
  const p = pictureBounds(source.width, source.height, settings.borders);
  const quarter = settings.rotation === 90 || settings.rotation === 270;
  const aspect = settings.aspect || p.width / p.height;
  const visualAspect = quarter ? 1 / aspect : aspect;
  const target = viewport.width / viewport.height;
  const loss = cropLoss(visualAspect, target);
  let mode = settings.mode;
  if (mode === 'auto') mode = loss <= settings.cropBudget ? 'fill' : 'ambient';
  const fitW = Math.min(viewport.width, viewport.height * visualAspect),
    fitH = fitW / visualAspect;
  let w = fitW,
    h = fitH,
    elastic = null;
  if (mode === 'fill') {
    w = Math.max(viewport.width, viewport.height * visualAspect);
    h = w / visualAspect;
  }
  if (mode === 'stretch') {
    w = viewport.width;
    h = viewport.height;
  }
  if (mode === 'elastic') {
    // Horizontal only. A tall picture fills vertically with ambience above/below when appropriate.
    elastic = elasticMap(fitW, viewport.width, settings.center, settings.strength);
    w = elastic.width;
  }
  w *= settings.zoom;
  h *= settings.zoom;
  const x = (viewport.width - w) / 2 + (settings.panX * viewport.width) / 2;
  const y = (viewport.height - h) / 2 + (settings.panY * viewport.height) / 2;
  return {
    mode,
    requestedMode: settings.mode,
    picture: p,
    loss,
    x,
    y,
    width: w,
    height: h,
    viewport,
    elastic,
    ambient: ['ambient', 'elastic'].includes(mode),
    quarter,
  };
}
// Analyze a small RGBA frame. Require a bright enough interior to avoid dark-scene crops.
export function detectPadding(data, width, height, safetyMargin = 2) {
  const luma = (x, y) => {
    const i = (y * width + x) * 4;
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  };
  let bright = 0,
    total = 0;
  for (let y = Math.floor(height * 0.25); y < height * 0.75; y += 2)
    for (let x = Math.floor(width * 0.25); x < width * 0.75; x += 2) {
      total++;
      if (luma(x, y) > 28) bright++;
    }
  if (!total || bright / total < 0.18) return null;
  const darkRow = (y, coverage = 0.9) => {
    let dark = 0;
    for (let x = 0; x < width; x++) if (luma(x, y) < 20) dark++;
    return dark / width >= coverage;
  };
  const darkCol = (x) => {
    let dark = 0;
    for (let y = 0; y < height; y++) if (luma(x, y) < 20) dark++;
    return dark / height >= 0.9;
  };
  const scan = (len, test, reverse = false) => {
    let count = 0;
    for (let n = 0; n < Math.floor(len * 0.3); n++) {
      if (!test(reverse ? len - 1 - n : n)) break;
      count++;
    }
    return count >= 3 ? Math.max(0, count - safetyMargin) / len : 0;
  };
  const result = {
    top: scan(height, (y) => darkRow(y, 0.8)),
    bottom: scan(height, darkRow, true),
    left: scan(width, darkCol),
    right: scan(width, darkCol, true),
  };
  // A small promotional badge can animate inside an otherwise symmetric bar.
  // Require black background throughout the inferred band and localized artwork;
  // wide subtitles or real picture expansion do not qualify.
  if (result.top > 0.02 && result.bottom < result.top) {
    const rows = Math.round(result.top * height + safetyMargin),
      columns = new Set();
    let background = true;
    for (let y = height - rows; y < height; y++) {
      let lit = 0;
      for (let x = 0; x < width; x++)
        if (luma(x, y) >= 20) {
          lit++;
          columns.add(x);
        }
      if (lit / width > 0.25) {
        background = false;
        break;
      }
    }
    if (background && columns.size / width <= 0.25) result.bottom = result.top;
  }
  return result;
}
export class PaddingTracker {
  current = { top: 0, right: 0, bottom: 0, left: 0 };
  candidate = null;
  count = 0;
  bottomHistory = [];
  bottomTextProtected = false;
  update(data, width, height) {
    const result = detectPadding(data, width, height);
    if (!result) {
      this.count = 0;
      return null;
    }
    // Detect fluctuating bright text inside a bottom bar, then retain that entire border.
    const rawStart = Math.floor(height * (1 - Math.max(result.bottom, this.current.bottom)));
    let lit = 0,
      n = 0;
    for (let y = rawStart; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        n++;
        if (data[i] + data[i + 1] + data[i + 2] > 90) lit++;
      }
    this.bottomHistory.push(n ? lit / n : 0);
    if (this.bottomHistory.length > 8) this.bottomHistory.shift();
    const fluctuating =
      this.bottomHistory.length >= 3 &&
      Math.max(...this.bottomHistory) - Math.min(...this.bottomHistory) > 0.006;
    // Localized bar artwork already accepted by detectPadding is not a caption
    // invalidation. Wide changing text remains protected until the video resets.
    if (fluctuating && result.bottom < this.current.bottom - 0.015 && this.current.bottom > 0.02)
      this.bottomTextProtected = true;
    if (this.bottomTextProtected) {
      result.bottom = 0;
      // Keep symmetric letterboxed content centered when retaining its text bar.
      result.top = 0;
    }
    // Widen immediately when newly visible picture or captions invalidate an old crop.
    // Narrowing still requires five stable samples.
    const release = Object.keys(result).some((k) => result[k] < this.current[k] - 0.015);
    if (release) {
      for (const k of Object.keys(result)) this.current[k] = Math.min(this.current[k], result[k]);
      this.candidate = null;
      this.count = 0;
      return { ...this.current };
    }
    const similar =
      this.candidate &&
      Object.keys(result).every((k) => Math.abs(result[k] - this.candidate[k]) < 0.015);
    this.count = similar ? this.count + 1 : 1;
    this.candidate = result;
    if (this.count < 5) return null;
    if (Object.keys(result).every((k) => Math.abs(result[k] - this.current[k]) < 0.008))
      return null;
    this.current = { ...result };
    return { ...result };
  }
}
