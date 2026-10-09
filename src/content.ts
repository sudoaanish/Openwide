import {
  DEFAULTS,
  MODES,
  clone,
  mergeSettings,
  renderPlan,
  validateSettings,
  PaddingTracker,
  detectPadding,
} from './core';
import { identifyPlayer, visibleVideos } from './adapters';
import {
  NativeRenderer,
  AmbientRenderer,
  ElasticRenderer,
  SvgElasticRenderer,
  TextTrackOverlay,
  NativeControlProxy,
} from './renderers';
import { ControlPanel } from './panel';
import { loadSettings, writeSettings, effectiveSettings, STORAGE_KEY } from './settings';
import type { FitSettings } from './types';

class Session {
  video;
  adapter;
  settings: FitSettings;
  temporary: Partial<FitSettings> = {};
  detected = { top: 0, right: 0, bottom: 0, left: 0 };
  tracker = new PaddingTracker();
  native = new NativeRenderer();
  ambient = null;
  elastic = null;
  svg = null;
  captions = null;
  controlProxy = null;
  panel;
  capabilities = {
    pixels: 'unknown',
    webgl: typeof WebGL2RenderingContext !== 'undefined',
    svg: 'experimental',
    fullscreen: true,
    elasticFailed: false,
    reason: '',
  };
  controller;
  abort = new AbortController();
  observer;
  styleObserver;
  sample;
  frame = 0;
  raf = 0;
  analysisTimer;
  destroyed = false;
  comparing = false;
  manualBorders = false;
  plan = null;
  lastFrame = -1;
  lastDraw = 0;
  lastSettingsKey = '';
  error = '';
  speedUnsupported = false;
  speedAttempts = [];
  source = '';
  originalSpeed = 1;
  ownedSpeed = null;
  forceFrame = true;
  ambientFailed = false;
  layoutDirty = true;
  pausedAnalysisKey = '';
  pausedAnalysisCount = 0;
  constructor(video, controller) {
    this.video = video;
    this.controller = controller;
    this.adapter = identifyPlayer(video);
    this.source = video.currentSrc;
    this.originalSpeed = video.playbackRate;
    this.settings = effectiveSettings(controller.store, location.origin);
    this.manualBorders = Object.values(this.settings.borders).some((v) => v > 0);
    this.sample = document.createElement('canvas');
    this.sample.width = 240;
    this.sample.height = 135;
    const signal = this.abort.signal;
    for (const event of ['loadedmetadata', 'resize', 'play', 'pause', 'seeked', 'ratechange'])
      video.addEventListener(
        event,
        () => {
          this.layoutDirty = true;
          this.render();
        },
        { signal }
      );
    video.addEventListener(
      'encrypted',
      () => this.blockPixels('Protected video: dynamic sampling is disabled.'),
      { signal }
    );
    document.addEventListener(
      'fullscreenchange',
      () => {
        this.layoutDirty = true;
        this.relocate();
        this.render();
      },
      { signal }
    );
    this.observer = new ResizeObserver(() => {
      this.layoutDirty = true;
      this.render();
    });
    this.observer.observe(this.adapter.shell);
    this.styleObserver = new MutationObserver(() => {
      const fields = this.native.styles.entries.get(this.video);
      if (
        fields &&
        [...fields].some(
          ([property, field]) =>
            !(property === 'filter' && this.svg) &&
            this.video.style.getPropertyValue(property) !== field.ours
        )
      ) {
        this.layoutDirty = true;
        this.render();
      }
    });
    this.styleObserver.observe(video, { attributes: true, attributeFilter: ['style'] });
    this.panel = new ControlPanel(this.adapter.shell, {
      change: (patch) => this.update(patch),
      border: (edge, value) => this.setBorder(edge, value),
      compare: (on) => {
        this.comparing = on;
        this.render();
      },
      resetVideo: () => this.resetVideo(),
      saveSite: () => this.saveSite(),
      resetSite: () => this.resetSite(),
      disableSite: () => controller.disable(),
      selectVideo: (index) => controller.select(index),
      fullscreen: () => this.fullscreen(),
    });
    this.panel.sync(this.settings);
    this.panel.updateVideos(controller.videos, video);
    this.analysisTimer = setInterval(() => this.analyze(), 250);
    this.trackFrames();
    this.render();
  }
  trackFrames() {
    if (this.destroyed) return;
    if ('requestVideoFrameCallback' in this.video) {
      this.frame = this.video.requestVideoFrameCallback(() => {
        this.forceFrame = true;
        this.render();
        this.trackFrames();
      });
    } else {
      const tick = () => {
        if (this.destroyed) return;
        if (this.video.currentTime !== this.lastFrame) {
          this.lastFrame = this.video.currentTime;
          this.forceFrame = true;
          this.render();
        }
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }
  }
  relocate() {
    const fullscreen = document.fullscreenElement;
    this.capabilities.fullscreen = !(fullscreen === this.video);
    if (fullscreen === this.video) {
      this.ambient?.hide();
      this.panel.hide();
      return;
    }
    const adapter = identifyPlayer(this.video);
    // YouTube can fullscreen the document root while its body is fixed-positioned.
    // That root has zero layout height; the actual player remains the effect surface.
    if (
      fullscreen &&
      fullscreen !== document.documentElement &&
      fullscreen !== document.body &&
      fullscreen.contains(this.video)
    )
      adapter.shell = fullscreen;
    if (adapter.shell !== this.adapter.shell) {
      const shown = this.panel.host.style.display !== 'none';
      this.releaseEffects();
      this.native.restore();
      this.observer.disconnect();
      this.adapter = adapter;
      this.observer.observe(adapter.shell);
      adapter.shell.append(this.panel.host);
      if (shown) this.panel.show();
    }
    this.panel?.mountControls(adapter.shell);
  }
  probe() {
    if (this.capabilities.pixels !== 'unknown' || this.video.readyState < 2) return;
    if (this.video.mediaKeys) {
      this.blockPixels('Protected video: pixel effects are unavailable.');
      return;
    }
    try {
      const context = this.sample.getContext('2d', { willReadFrequently: true });
      this.sample.width = 240;
      context.drawImage(this.video, 0, 0, this.sample.width, this.sample.height);
      context.getImageData(0, 0, 1, 1);
      this.capabilities.pixels = 'readable';
    } catch {
      this.blockPixels('Video pixels are blocked by browser security or protection.');
    }
  }
  blockPixels(reason) {
    this.capabilities.pixels = 'blocked';
    this.capabilities.reason = reason;
    this.ambientFailed = true;
    this.releaseEffects();
    this.native.restore();
    this.error = reason;
    this.forceFrame = true;
  }
  analyze() {
    if (this.destroyed || document.hidden || this.video.readyState < 2) return;
    this.probe();
    if (this.video.mediaKeys && this.capabilities.pixels !== 'blocked') {
      this.blockPixels('Protected video: pixel effects are unavailable.');
      this.render();
      return;
    }
    if (
      !this.settings.detectBars ||
      this.settings.lockBars ||
      this.manualBorders ||
      this.capabilities.pixels !== 'readable'
    )
      return;
    // A paused decoded frame still needs initial/seeked padding analysis. Bound the
    // samples so we settle the detector without continuously processing paused video.
    const key = [this.video.currentTime, this.video.videoWidth, this.video.videoHeight].join(':');
    if (this.video.paused) {
      if (key !== this.pausedAnalysisKey) {
        this.pausedAnalysisKey = key;
        this.pausedAnalysisCount = 0;
      }
      if (this.pausedAnalysisCount >= 6) return;
      this.pausedAnalysisCount++;
    } else {
      this.pausedAnalysisKey = '';
      this.pausedAnalysisCount = 0;
    }
    try {
      const context = this.sample.getContext('2d', { willReadFrequently: true });
      this.sample.width = 240;
      this.sample.height = Math.max(
        45,
        Math.round((240 * this.video.videoHeight) / this.video.videoWidth)
      );
      context.drawImage(this.video, 0, 0, this.sample.width, this.sample.height);
      const data = context.getImageData(0, 0, this.sample.width, this.sample.height);
      const found = this.tracker.update(data.data, data.width, data.height);
      if (found) {
        // Refine only after the low-resolution temporal detector agrees. Its two-row
        // safety margin otherwise becomes a visible ~16-source-pixel black strip.
        this.sample.width = 960;
        this.sample.height = Math.max(
          45,
          Math.round((960 * this.video.videoHeight) / this.video.videoWidth)
        );
        context.drawImage(this.video, 0, 0, this.sample.width, this.sample.height);
        const detail = context.getImageData(0, 0, this.sample.width, this.sample.height);
        const refined = detectPadding(detail.data, detail.width, detail.height, 0.5);
        this.detected = { ...found };
        if (refined)
          for (const edge of ['top', 'right', 'bottom', 'left'])
            if (found[edge] > 0 && Math.abs(refined[edge] - found[edge]) < 0.025)
              this.detected[edge] = refined[edge];
        this.forceFrame = true;
        this.render();
      }
    } catch {
      this.blockPixels('Padding detection cannot read this video.');
      this.render();
    }
  }
  effective() {
    const s = clone(this.settings);
    if (!this.manualBorders && s.detectBars) s.borders = { ...this.detected };
    if (this.comparing) s.mode = 'original';
    return s;
  }
  render() {
    if (this.destroyed || !this.video.isConnected || !this.video.videoWidth) return;
    if (this.video.currentSrc !== this.source) {
      this.controller.recreate();
      return;
    }
    this.relocate();
    if (!this.adapter.shell?.isConnected) return;
    this.probe();
    this.applySpeed();
    const s = this.effective(),
      shell = this.adapter.shell,
      r = shell.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    if (s.mode === 'original' || document.fullscreenElement === this.video) {
      this.releaseEffects();
      this.native.restore();
      this.plan = null;
      this.report();
      return;
    }
    let plan = renderPlan(
      { width: this.video.videoWidth, height: this.video.videoHeight },
      { width: r.width, height: r.height },
      s
    );
    if (
      plan.mode === 'elastic' &&
      (this.capabilities.elasticFailed ||
        (s.elasticBackend === 'webgl' && this.capabilities.pixels !== 'readable'))
    ) {
      plan = renderPlan(
        { width: this.video.videoWidth, height: this.video.videoHeight },
        { width: r.width, height: r.height },
        { ...s, mode: 'ambient' }
      );
    }
    this.plan = plan;
    const key = JSON.stringify([
      s,
      plan.x,
      plan.y,
      plan.width,
      plan.height,
      plan.mode,
      this.capabilities.pixels,
    ]);
    const changed = this.layoutDirty || key !== this.lastSettingsKey;
    if (changed) {
      this.svg?.destroy();
      this.svg = null;
      this.native.restore();
      this.native.apply(this.video, shell, plan, s);
      if (this.video.controls && !this.controlProxy)
        this.controlProxy = new NativeControlProxy(shell, this.video);
      this.lastSettingsKey = key;
      this.layoutDirty = false;
      this.forceFrame = true;
    }
    if (!plan.ambient || this.capabilities.pixels !== 'readable' || this.ambientFailed) {
      this.ambient?.destroy();
      this.ambient = null;
    } else {
      try {
        if (!this.ambient) this.ambient = new AmbientRenderer(shell);
        this.ambient.show();
      } catch {
        this.ambientFailed = true;
        this.error = 'Ambient rendering unavailable; keeping native video.';
      }
    }
    if (plan.mode !== 'elastic') {
      this.elastic?.destroy();
      this.elastic = null;
      this.svg?.destroy();
      this.svg = null;
    }
    if (plan.mode !== 'elastic' || s.elasticBackend !== 'webgl') {
      this.captions?.destroy();
      this.captions = null;
    }
    try {
      if (plan.mode === 'elastic') {
        if (s.elasticBackend === 'svg') {
          this.elastic?.destroy();
          this.elastic = null;
          if (!this.svg) this.svg = new SvgElasticRenderer(shell);
          this.svg.apply(this.video, plan, s);
        } else {
          this.svg?.destroy();
          this.svg = null;
          if (!this.elastic)
            this.elastic = new ElasticRenderer(shell, (reason) => this.failElastic(reason));
          if (this.forceFrame || changed) {
            this.elastic.draw(this.video, plan, s);
            // Hide original only after successful upload and draw. Native audio continues.
            this.native.hide(this.video);
            if (!this.captions) this.captions = new TextTrackOverlay(shell);
            this.captions.update(this.video, plan);
          }
        }
      }
      if (this.ambient && (this.forceFrame || changed) && !document.hidden)
        this.ambient.draw(this.video, plan, s, performance.now());
    } catch (error) {
      if (plan.mode === 'elastic') {
        this.failElastic(error.message || 'Elastic render failed.');
        return;
      }
      this.ambient?.destroy();
      this.ambient = null;
      this.ambientFailed = true;
      if (error.name === 'SecurityError')
        this.blockPixels('Pixel access was revoked; native video restored.');
      else this.error = 'Ambient disabled after rendering failure; native video remains visible.';
    }
    this.forceFrame = false;
    this.report();
  }
  applySpeed() {
    if (this.speedUnsupported || this.video.playbackRate === this.settings.speed) return;
    const now = performance.now();
    this.speedAttempts = this.speedAttempts.filter((t) => now - t < 2000);
    if (this.speedAttempts.length >= 3) {
      this.speedUnsupported = true;
      return;
    }
    this.speedAttempts.push(now);
    try {
      this.video.playbackRate = this.settings.speed;
      this.ownedSpeed = this.settings.speed;
      if (Math.abs(this.video.playbackRate - this.settings.speed) > 0.01)
        this.speedUnsupported = true;
    } catch {
      this.speedUnsupported = true;
    }
  }
  failElastic(reason) {
    const svgFallback =
      this.settings.elasticBackend === 'svg' && this.capabilities.pixels === 'readable';
    this.capabilities.elasticFailed = !svgFallback;
    if (this.settings.elasticBackend === 'svg') this.capabilities.svg = 'unavailable';
    this.error =
      reason +
      (svgFallback
        ? ' Switching to WebGL elastic; RTX VSR may be affected.'
        : ' Native video restored.');
    this.svg?.destroy();
    this.svg = null;
    this.elastic?.destroy();
    this.elastic = null;
    this.native.restore();
    if (svgFallback) {
      this.temporary.elasticBackend = 'webgl';
      this.settings.elasticBackend = 'webgl';
      this.panel.sync(this.settings);
    }
    this.captions?.destroy();
    this.captions = null;
    this.lastSettingsKey = '';
    this.forceFrame = true;
    this.render();
  }
  report() {
    const p = this.plan;
    const lines = [
      this.adapter.name + ' · ' + (p ? p.mode : 'original') + ' · native audio',
      'Fill picture loss: ' + (p ? (p.loss * 100).toFixed(1) + '%' : '—'),
      'Pixels: ' +
        this.capabilities.pixels +
        ' · WebGL: ' +
        (this.capabilities.webgl ? 'available (runtime tested on use)' : 'unavailable'),
      this.capabilities.svg === 'unavailable'
        ? 'SVG: unavailable for this session'
        : 'SVG: experimental; DRM support unverified',
      p
        ? 'Picture: ' +
          p.picture.width +
          '×' +
          p.picture.height +
          ' at ' +
          p.picture.x +
          ',' +
          p.picture.y
        : '',
      p?.elastic ? 'Maximum edge expansion: ' + p.elastic.maxExpansion.toFixed(2) + '×' : '',
      this.speedUnsupported ? 'Playback speed rejected by this player.' : '',
      !this.capabilities.fullscreen
        ? 'Video-only fullscreen: use extension fullscreen for effects.'
        : '',
      this.error || this.capabilities.reason,
    ]
      .filter(Boolean)
      .join('\n');
    if (this.panel.status.textContent !== lines) this.panel.notice(lines);
    this.panel.mode.querySelector('option[value="elastic"]').disabled =
      this.capabilities.elasticFailed ||
      (this.settings.elasticBackend === 'webgl' && this.capabilities.pixels === 'blocked');
    this.panel.elasticButton.disabled =
      this.panel.mode.querySelector('option[value="elastic"]').disabled;
    this.panel.elasticButton.title = this.panel.elasticButton.disabled
      ? 'Openwide: Elastic unavailable — video pixels are blocked or rendering failed'
      : 'Openwide: Elastic Stretch';
    this.panel.fields.get('elasticBackend').querySelector('option[value="svg"]').disabled =
      this.capabilities.svg === 'unavailable';
    this.panel.fields.get('speed').setDisabled(this.speedUnsupported);
    this.panel.updatePresentation(this.status());
  }
  update(patch) {
    try {
      const safe = validateSettings(patch);
      this.temporary = { ...this.temporary, ...safe };
      this.settings = effectiveSettings(this.controller.store, location.origin, this.temporary);
      this.error = '';
      this.panel.sync(this.settings);
      this.forceFrame = true;
      this.render();
    } catch (error) {
      this.panel.announce(error.message);
    }
  }
  setBorder(edge, value) {
    this.manualBorders = true;
    this.update({ borders: { ...this.effective().borders, [edge]: value }, lockBars: true });
  }
  resetVideo() {
    this.pausedAnalysisKey = '';
    this.pausedAnalysisCount = 0;
    this.temporary = {};
    this.detected = { top: 0, right: 0, bottom: 0, left: 0 };
    this.tracker = new PaddingTracker();
    this.settings = effectiveSettings(this.controller.store, location.origin);
    this.manualBorders = Object.values(this.settings.borders).some((v) => v > 0);
    this.speedUnsupported = false;
    this.speedAttempts = [];
    this.panel.sync(this.settings);
    this.forceFrame = true;
    this.render();
  }
  async saveSite() {
    try {
      await chrome.runtime.sendMessage({
        type: 'save-profile',
        origin: location.origin,
        settings: this.settings.lockBars
          ? { ...this.settings, borders: this.effective().borders }
          : this.settings,
      });
      this.panel.announce('Site profile saved locally.');
    } catch {
      this.panel.announce('Could not save the site profile.');
    }
  }
  async resetSite() {
    try {
      await chrome.runtime.sendMessage({ type: 'reset-profile', origin: location.origin });
      this.resetVideo();
    } catch {
      this.panel.announce('Could not reset the site profile.');
    }
  }
  async fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      await this.adapter.shell.requestFullscreen();
    } catch {
      this.panel.announce('Fullscreen was rejected by this player or iframe policy.');
    }
  }
  releaseEffects() {
    this.ambient?.destroy();
    this.ambient = null;
    this.elastic?.destroy();
    this.elastic = null;
    this.svg?.destroy();
    this.svg = null;
    this.captions?.destroy();
    this.captions = null;
    this.controlProxy?.destroy();
    this.controlProxy = null;
  }
  status() {
    const r = this.adapter.shell.getBoundingClientRect();
    return {
      active: true,
      area: r.width * r.height,
      adapter: this.adapter.name,
      origin: location.origin,
      settings: this.settings,
      capabilities: this.capabilities,
      loss: this.plan?.loss ?? null,
      effectiveMode: this.plan?.mode || 'original',
      picture: this.plan?.picture || null,
      ambientActive: !!this.ambient,
      elasticUnavailable: this.panel.mode.querySelector('option[value="elastic"]').disabled,
      speedUnsupported: this.speedUnsupported,
      notice: this.error || this.capabilities.reason,
      playbackQuality: this.video.getVideoPlaybackQuality
        ? {
            total: this.video.getVideoPlaybackQuality().totalVideoFrames,
            dropped: this.video.getVideoPlaybackQuality().droppedVideoFrames,
          }
        : null,
      message: this.panel.status.textContent,
    };
  }
  destroy() {
    this.destroyed = true;
    clearInterval(this.analysisTimer);
    this.abort.abort();
    this.observer.disconnect();
    this.styleObserver.disconnect();
    if (this.frame && this.video.cancelVideoFrameCallback)
      this.video.cancelVideoFrameCallback(this.frame);
    cancelAnimationFrame(this.raf);
    this.panel.destroy();
    this.releaseEffects();
    this.native.restore();
    if (this.ownedSpeed !== null && this.video.playbackRate === this.ownedSpeed)
      this.video.playbackRate = this.originalSpeed;
  }
}

export class Controller {
  session = null;
  store;
  videos = [];
  selected = null;
  observer;
  abort = new AbortController();
  timer;
  disabled = false;
  rescan = 0;
  destroyed = false;
  cleanup = [];
  authorizationTimer;
  constructor(store) {
    this.store = store;
    this.disabled = store.disabled.includes(location.origin);
    this.observer = new MutationObserver((records) => {
      // Ignore our effect and UI insertions. Geometry responds to resize separately.
      if (
        records.some((record) =>
          [...record.addedNodes, ...record.removedNodes].some(
            (n) =>
              n instanceof HTMLElement && !n.dataset?.ultrawideEffect && !n.dataset?.ultrawidePanel
          )
        )
      )
        this.queueScan();
    });
    this.observer.observe(document.documentElement, { childList: true, subtree: true });
    this.timer = setInterval(() => this.scan(), 1500);
    this.authorizationTimer = setInterval(async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'authorized',
          origin: location.origin,
        });
        if (response?.result === false && !this.disabled) {
          this.disabled = true;
          this.session?.destroy();
          this.session = null;
        }
      } catch {
        this.disabled = true;
        this.session?.destroy();
        this.session = null;
      }
    }, 4000);
    document.addEventListener(
      'visibilitychange',
      () => {
        if (!document.hidden) this.session?.render();
      },
      { signal: this.abort.signal }
    );
    window.addEventListener('pagehide', () => this.destroy(), { signal: this.abort.signal });
    this.scan();
  }
  queueScan() {
    clearTimeout(this.rescan);
    this.rescan = setTimeout(() => this.scan(), 150);
  }
  scan() {
    if (this.disabled || this.destroyed) return;
    this.videos = visibleVideos();
    if (this.session && !this.session.video.isConnected) {
      this.session.destroy();
      this.session = null;
      this.selected = null;
    }
    const main =
      this.selected && this.videos.includes(this.selected) ? this.selected : this.videos[0];
    if (!main) {
      this.session?.destroy();
      this.session = null;
      return;
    }
    if (this.session?.video !== main) {
      this.session?.destroy();
      this.session = new Session(main, this);
    }
    this.session?.panel.updateVideos(this.videos, main);
    if (this.session?.video.currentSrc !== this.session?.source) this.recreate();
    else this.session?.render();
  }
  select(index) {
    this.selected = this.videos[index] || null;
    this.scan();
  }
  recreate() {
    const video = this.session?.video;
    this.session?.destroy();
    this.session = null;
    if (video?.isConnected && !this.disabled) this.session = new Session(video, this);
  }
  command(command) {
    if (command === 'toggle-panel') this.session?.panel.toggle();
    if (command === 'reset-video') this.session?.resetVideo();
    if (command === 'cycle-mode' && this.session) {
      const unavailable =
        this.session.capabilities.elasticFailed ||
        (this.session.capabilities.pixels === 'blocked' &&
          this.session.settings.elasticBackend === 'webgl');
      const list = unavailable ? ['fit', 'fill', 'ambient'] : ['fit', 'fill', 'elastic', 'ambient'],
        index = list.indexOf(this.session.settings.mode);
      this.session.update({ mode: list[(index + 1) % list.length] });
    }
  }
  async disable() {
    try {
      await chrome.runtime.sendMessage({ type: 'disable-origin', origin: location.origin });
    } catch {
      this.session?.panel.announce('Could not disable the site.');
    }
  }
  settingsChanged(store) {
    this.store = store;
    this.disabled = store.disabled.includes(location.origin);
    if (this.disabled) {
      this.session?.destroy();
      this.session = null;
    } else if (this.session) {
      this.session.settings = effectiveSettings(store, location.origin, this.session.temporary);
      this.session.panel.sync(this.session.settings);
      this.session.render();
    } else this.scan();
  }
  status() {
    return (
      this.session?.status() || {
        active: false,
        area: 0,
        origin: location.origin,
        message: this.disabled ? 'Site disabled.' : 'No visible video found.',
      }
    );
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.timer);
    clearInterval(this.authorizationTimer);
    clearTimeout(this.rescan);
    this.abort.abort();
    this.observer.disconnect();
    this.session?.destroy();
    this.session = null;
    for (const cleanup of this.cleanup) cleanup();
    this.cleanup = [];
    if (globalThis['__ultrawideController'] === this) {
      globalThis['__ultrawideController'] = null;
      globalThis['__ultrawideBoot'] = false;
    }
  }
}
export async function boot() {
  if (globalThis['__ultrawideBoot']) return;
  globalThis['__ultrawideBoot'] = true;
  const controller = new Controller(await loadSettings());
  globalThis['__ultrawideController'] = controller;
  const onMessage = (message, sender, respond) => {
    if (message.type === 'status') {
      respond(controller.status());
      return;
    }
    if (message.type === 'command') {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      if (!message.shortcut || !active?.matches('input,textarea,select,[contenteditable="true"]'))
        controller.command(message.command);
      respond({ ok: true });
      return;
    }
    if (message.type === 'change') {
      controller.session?.update(message.patch);
      respond(controller.status());
      return;
    }
    if (message.type === 'show-panel') {
      controller.session?.panel.show();
      respond({ ok: true });
      return;
    }
    if (message.type === 'compare') {
      if (controller.session) {
        controller.session.comparing = message.on;
        controller.session.render();
      }
      respond({ ok: true });
      return;
    }
  };
  const onStorage = (changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY])
      loadSettings().then((store) => controller.settingsChanged(store));
  };
  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onStorage);
  controller.cleanup.push(
    () => chrome.runtime.onMessage.removeListener(onMessage),
    () => chrome.storage.onChanged.removeListener(onStorage)
  );
  window.addEventListener(
    'pageshow',
    (event) => {
      if (event.persisted) boot().catch(() => {});
    },
    { once: true }
  );
}
if (typeof chrome !== 'undefined' && chrome.runtime?.id)
  boot().catch((error) => console.warn('Openwide initialization failed:', error));
