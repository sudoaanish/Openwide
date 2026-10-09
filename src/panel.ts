import { MODES } from './core';
import theme from '../public/theme.css?inline';
import { modePicker, rangeControl, section, conciseStatus, effectVisibility } from './ui';
export class ControlPanel {
  picker;
  summary;
  warning;
  feedback;
  elasticHint;
  returnFocus;
  lastSettings;
  host;
  root;
  launcher;
  fillButton;
  elasticButton;
  callbacks;
  status;
  mode;
  videos;
  custom;
  compare = false;
  fields = new Map();
  constructor(shell, callbacks) {
    this.callbacks = callbacks;
    this.host = document.createElement('div');
    this.host.dataset.ultrawidePanel = 'true';
    this.host.style.cssText =
      'position:fixed;right:12px;top:24px;z-index:2147483646;display:none;pointer-events:auto';
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = theme;
    this.root.append(style);
    const wrap = document.createElement('section');
    wrap.className = 'wrap';
    wrap.setAttribute('aria-label', 'Openwide video controls');
    this.root.append(wrap);
    const header = document.createElement('header'),
      title = document.createElement('div');
    title.className = 'brand';
    const logo = document.createElement('img');
    logo.src = chrome.runtime.getURL
      ? chrome.runtime.getURL('icons/openwide-logo.png')
      : '../public/icons/openwide-logo.png';
    logo.alt = 'Openwide';
    const version = document.createElement('span');
    version.className = 'version';
    version.textContent = '0.1.1';
    title.append(logo, version);
    const close = this.button('Close', () => this.hide());
    header.append(title, close);
    wrap.append(header);
    const site = document.createElement('p');
    site.className = 'site';
    site.textContent = location.hostname || 'Video laboratory';
    wrap.append(site);
    this.videos = this.select(wrap, 'Video', [], (v) => callbacks.selectVideo(Number(v)));
    this.mode = this.select(
      wrap,
      'Mode',
      MODES.map((v) => [v, v[0].toUpperCase() + v.slice(1)]),
      (v) => callbacks.change({ mode: v })
    );
    this.mode.parentElement.hidden = true;
    this.picker = modePicker(wrap, (v) => callbacks.change({ mode: v }));
    this.range(wrap, 'Zoom', 'zoom', 0.25, 4, 0.05);
    this.range(wrap, 'Protected center', 'center', 0.3, 0.8, 0.05);
    this.range(wrap, 'Elastic strength', 'strength', 0, 1, 0.05);
    this.range(wrap, 'Ambient intensity', 'ambientBrightness', 0, 1, 0.05);
    this.elasticHint = document.createElement('p');
    this.elasticHint.className = 'hint';
    this.elasticHint.textContent = 'WebGL Elastic may affect RTX VSR. SVG support is experimental.';
    wrap.append(this.elasticHint);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const compare = this.button('Compare', () => {});
    compare.title = 'Hold to compare with original';
    compare.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      compare.setPointerCapture(e.pointerId);
      this.compare = true;
      callbacks.compare(true);
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'])
      compare.addEventListener(event, () => {
        if (this.compare) {
          this.compare = false;
          callbacks.compare(false);
        }
      });
    compare.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (!this.compare) {
          this.compare = true;
          callbacks.compare(true);
        }
      }
    });
    compare.addEventListener('keyup', () => {
      if (this.compare) {
        this.compare = false;
        callbacks.compare(false);
      }
    });
    actions.append(
      compare,
      this.button('Reset video', () => callbacks.resetVideo()),
      this.button('Fullscreen', () => callbacks.fullscreen())
    );
    wrap.append(actions);
    this.summary = document.createElement('div');
    this.summary.className = 'status-summary';
    this.summary.setAttribute('role', 'status');
    wrap.append(this.summary);
    this.warning = document.createElement('div');
    this.warning.className = 'warning';
    this.warning.setAttribute('role', 'status');
    wrap.append(this.warning);
    this.feedback = document.createElement('p');
    this.feedback.className = 'hint';
    this.feedback.setAttribute('role', 'status');
    this.feedback.hidden = true;
    wrap.append(this.feedback);
    const advanced = section(wrap, 'Picture');
    const ratio = this.select(
      advanced,
      'Picture aspect',
      [
        ['0', 'Source'],
        ['1.7777777778', '16:9'],
        ['2.3333333333', '21:9'],
        ['2.39', '2.39:1'],
        ['custom', 'Custom'],
      ],
      (v) => {
        this.custom.parentElement.parentElement.style.display = v === 'custom' ? 'flex' : 'none';
        if (v !== 'custom') callbacks.change({ aspect: Number(v) });
      }
    );
    this.fields.set('aspect', ratio);
    const row = document.createElement('label');
    row.textContent = 'Custom W:H';
    const box = document.createElement('div');
    box.className = 'control';
    this.custom = document.createElement('input');
    this.custom.type = 'text';
    this.custom.placeholder = '43:18';
    this.custom.setAttribute('aria-label', 'Custom width to height');
    const apply = this.button('Apply', () => {
      const parts = this.custom.value.split(':').map(Number),
        aspect = parts.length === 2 ? parts[0] / parts[1] : NaN;
      if (!Number.isFinite(aspect) || aspect <= 0 || aspect > 8) {
        this.announce('Enter a positive W:H ratio, at most 8:1.');
        return;
      }
      callbacks.change({ aspect });
    });
    box.append(this.custom, apply);
    row.append(box);
    row.style.display = 'none';
    advanced.append(row);
    this.range(advanced, 'Pan horizontal', 'panX', -1, 1, 0.025);
    this.range(advanced, 'Pan vertical', 'panY', -1, 1, 0.025);
    ratio.title =
      'Overrides the active picture aspect (useful for anamorphic video); Source preserves its proportions.';
    this.fields.set(
      'rotation',
      this.select(
        advanced,
        'Rotate',
        [
          [0, '0°'],
          [90, '90°'],
          [180, '180°'],
          [270, '270°'],
        ],
        (v) => callbacks.change({ rotation: Number(v) })
      )
    );
    this.checkbox(advanced, 'Flip horizontally', 'flipX');
    this.checkbox(advanced, 'Flip vertically', 'flipY');
    this.range(advanced, 'Playback speed', 'speed', 0.25, 4, 0.25);
    this.range(advanced, 'Auto crop budget', 'cropBudget', 0, 0.1, 0.005);
    this.checkbox(advanced, 'Detect black padding', 'detectBars');
    this.checkbox(advanced, 'Lock padding detection', 'lockBars');
    for (const edge of ['top', 'right', 'bottom', 'left'])
      this.range(advanced, 'Border ' + edge, 'border:' + edge, 0, 0.45, 0.005);
    const effects = section(wrap, 'Effects');
    this.range(effects, 'Brightness', 'brightness', 0, 2, 0.05);
    this.range(effects, 'Contrast', 'contrast', 0, 2, 0.05);
    this.range(effects, 'Saturation', 'saturation', 0, 2, 0.05);
    this.range(effects, 'Ambient blur (px)', 'ambientBlur', 0, 160, 5);
    this.range(effects, 'Ambient spread', 'ambientSpread', 1, 2, 0.05);
    this.range(effects, 'Ambient smoothing (ms)', 'ambientSmoothing', 0, 2000, 50);
    this.range(effects, 'Ambient quality', 'ambientQuality', 0.25, 1, 0.25);
    this.range(effects, 'Ambient FPS cap', 'ambientFps', 5, 30, 5);
    this.fields.set(
      'elasticBackend',
      this.select(
        effects,
        'Elastic renderer',
        [
          ['webgl', 'WebGL2 (readable video)'],
          ['svg', 'SVG (experimental)'],
        ],
        (v) => callbacks.change({ elasticBackend: v })
      )
    );
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent =
      'Elastic preview is live. WebGL may stop RTX VSR; SVG has unverified DRM compatibility. Auto always keeps native foreground video.';
    effects.append(hint);
    const siteActions = document.createElement('div');
    siteActions.className = 'actions';
    siteActions.append(
      this.button('Save for site', () => callbacks.saveSite()),
      this.button('Reset site', () => callbacks.resetSite()),
      this.button('Disable site', () => callbacks.disableSite())
    );
    section(wrap, 'Site settings').append(siteActions);
    this.status = document.createElement('div');
    this.status.className = 'diagnostic';
    section(wrap, 'Diagnostics').append(this.status);
    this.root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
    });
    this.launcher = this.playerButton(
      'Open Openwide controls',
      'M8 10h20 M8 18h20 M8 26h20 M13 7v6 M23 15v6 M16 23v6',
      () => this.toggle()
    );
    this.launcher.dataset.ultrawideLauncher = 'true';
    this.fillButton = this.playerButton(
      'Openwide: Zoom to Fill',
      'M8 14V8h6 M22 8h6v6 M28 22v6h-6 M14 28H8v-6',
      () => callbacks.change({ mode: this.mode.value === 'fill' ? 'fit' : 'fill' })
    );
    this.elasticButton = this.playerButton(
      'Openwide: Elastic Stretch',
      'M7 10Q18 13 29 10 M7 26Q18 23 29 26 M7 10v16 M29 10v16 M14 13v10 M22 13v10',
      () => callbacks.change({ mode: this.mode.value === 'elastic' ? 'fit' : 'elastic' })
    );
    shell.append(this.host);
    this.mountControls(shell);
  }
  playerButton(label, path, onClick) {
    const el = this.button('', (e) => {
      onClick();
    });
    el.className = 'ytp-button';
    el.title = label;
    el.setAttribute('aria-label', label);
    el.dataset.ultrawideControl = 'true';
    el.style.cssText =
      'color:white;vertical-align:top;padding:0;border:0;background:transparent;box-shadow:none';
    // YouTube adds padding around a 24px SVG. A 100% SVG includes the whole
    // button width before that padding, overflowing the hover target.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '6 6 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('aria-hidden', 'true');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', path);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('stroke-linecap', 'round');
    svg.append(line);
    el.append(svg);
    // Keep clicks and keyboard activation from reaching the player's playback shortcuts.
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
    });
    return el;
  }
  mountControls(shell) {
    const bar = shell.querySelector('.ytp-right-controls');
    for (const button of [this.fillButton, this.elasticButton, this.launcher]) {
      if (bar) {
        if (button.parentElement !== bar) {
          // Other player extensions may wrap fullscreen controls. insertBefore
          // requires a direct child; insert before its outer wrapper instead.
          let anchor = bar.querySelector('.ytp-fullscreen-button');
          while (anchor && anchor.parentElement !== bar) anchor = anchor.parentElement;
          bar.insertBefore(button, anchor);
        }
      } else button.remove();
    }
  }
  button(text, onClick) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = text;
    el.addEventListener('click', onClick);
    return el;
  }
  select(parent, label, options, onChange) {
    const row = document.createElement('label');
    row.textContent = label;
    const el = document.createElement('select');
    el.setAttribute('aria-label', label);
    for (const [value, text] of options) {
      const o = document.createElement('option');
      o.value = String(value);
      o.textContent = text;
      el.append(o);
    }
    el.addEventListener('change', () => onChange(el.value));
    row.append(el);
    parent.append(row);
    return el;
  }
  range(parent, label, key, min, max, step) {
    const field = rangeControl(parent, label, key, min, max, step, (value) => {
      if (key.startsWith('border:')) this.callbacks.border(key.slice(7), value);
      else this.callbacks.change({ [key]: value });
    });
    this.fields.set(key, field);
  }
  checkbox(parent, label, key) {
    const row = document.createElement('label');
    row.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => this.callbacks.change({ [key]: input.checked }));
    row.append(input);
    parent.append(row);
    this.fields.set(key, input);
  }
  format(key, value) {
    if (
      ['center', 'strength', 'ambientBrightness', 'cropBudget'].includes(key) ||
      key.startsWith('border:')
    )
      return Math.round(value * 100) + '%';
    return Number(value.toFixed(2)).toString();
  }
  sync(settings) {
    this.lastSettings = settings;
    this.mode.value = settings.mode;
    this.picker.sync(settings.mode);
    this.updatePresentation({
      settings,
      effectiveMode: settings.mode,
      ambientActive: settings.mode === 'ambient',
    });
    this.fillButton.setAttribute('aria-pressed', String(settings.mode === 'fill'));
    this.elasticButton.setAttribute('aria-pressed', String(settings.mode === 'elastic'));
    for (const [key, field] of this.fields) {
      const value = key.startsWith('border:') ? settings.borders[key.slice(7)] : settings[key];
      if (field.input) {
        field.sync(value);
      } else if (field.type === 'checkbox') field.checked = value;
      else if (key === 'aspect') {
        const exists = [...field.options].some((o) => Math.abs(Number(o.value) - value) < 1e-8);
        field.value = exists
          ? String([...field.options].find((o) => Math.abs(Number(o.value) - value) < 1e-8).value)
          : 'custom';
        this.custom.parentElement.parentElement.style.display = exists ? 'none' : 'flex';
        if (!exists) this.custom.value = value + ':1';
      } else field.value = String(value);
    }
  }
  updateVideos(videos, current) {
    this.videos.parentElement.hidden = videos.length <= 1;
    this.videos.replaceChildren();
    videos.forEach((v, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent =
        'Video ' + (i + 1) + ' · ' + (v.videoWidth || '?') + '×' + (v.videoHeight || '?');
      o.selected = v === current;
      this.videos.append(o);
    });
  }
  notice(text) {
    this.status.textContent = text;
  }
  announce(text) {
    this.feedback.hidden = false;
    this.feedback.textContent = text;
  }
  updatePresentation(s) {
    const settings = s.settings || this.lastSettings;
    if (!settings) return;
    const visibility = effectVisibility(settings, s.effectiveMode, s.ambientActive);
    for (const key of ['center', 'strength']) this.fields.get(key).row.hidden = !visibility.elastic;
    this.elasticHint.hidden = !visibility.elastic;
    this.fields.get('ambientBrightness').row.hidden = !visibility.ambient;
    this.summary.textContent = conciseStatus({ ...s, settings });
    this.warning.textContent = s.notice || s.capabilities?.reason || '';
    this.picker.sync(settings.mode, false, !!s.elasticUnavailable);
  }
  show() {
    if (this.host.style.display === 'none') this.returnFocus = document.activeElement;
    this.host.style.display = '';
    this.root.querySelector('button').focus();
  }
  hide() {
    if (this.compare) {
      this.compare = false;
      this.callbacks.compare(false);
    }
    this.host.style.display = 'none';
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
  }
  toggle() {
    this.host.style.display === 'none' ? this.show() : this.hide();
  }
  destroy() {
    this.hide();
    this.host.remove();
    for (const button of [this.launcher, this.fillButton, this.elasticButton]) button.remove();
  }
}
