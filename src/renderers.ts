import { clamp } from './core';
import { OwnedStyles } from './adapters';

export class NativeRenderer {
  styles = new OwnedStyles();
  apply(video, shell, plan, s) {
    const p = plan.picture,
      r = shell.getBoundingClientRect();
    this.styles.set(
      shell,
      'position',
      getComputedStyle(shell).position === 'static' ? 'relative' : getComputedStyle(shell).position
    );
    this.styles.set(shell, 'overflow', 'hidden');
    this.styles.set(shell, 'isolation', 'isolate');
    this.styles.set(video, 'position', 'absolute');
    this.styles.set(video, 'left', '0px');
    this.styles.set(video, 'top', '0px');
    this.styles.set(video, 'right', 'auto');
    this.styles.set(video, 'bottom', 'auto');
    this.styles.set(video, 'width', video.videoWidth + 'px');
    this.styles.set(video, 'height', video.videoHeight + 'px');
    this.styles.set(video, 'max-width', 'none');
    this.styles.set(video, 'max-height', 'none');
    this.styles.set(video, 'min-width', '0');
    this.styles.set(video, 'min-height', '0');
    this.styles.set(video, 'margin', '0');
    this.styles.set(video, 'object-fit', 'fill');
    // Individual CSS transforms compose with the matrix; neutralize them to
    // prevent an existing scale, translation, or rotation from compounding it.
    this.styles.set(video, 'scale', '1');
    this.styles.set(video, 'translate', 'none');
    this.styles.set(video, 'rotate', 'none');
    this.styles.set(video, 'transition', 'none');
    this.styles.set(video, 'z-index', '1');
    const parent = video.offsetParent;
    const parentRect = parent?.getBoundingClientRect() || r;
    const cx = p.x + p.width / 2,
      cy = p.y + p.height / 2;
    const dx = r.left - parentRect.left + plan.x + plan.width / 2 - cx;
    const dy = r.top - parentRect.top + plan.y + plan.height / 2 - cy;
    const sx = ((plan.quarter ? plan.height : plan.width) / p.width) * (s.flipX ? -1 : 1);
    const sy = ((plan.quarter ? plan.width : plan.height) / p.height) * (s.flipY ? -1 : 1);
    this.styles.set(video, 'transform-origin', cx + 'px ' + cy + 'px');
    this.styles.set(
      video,
      'transform',
      'translate(' +
        dx +
        'px,' +
        dy +
        'px) rotate(' +
        s.rotation +
        'deg) scale(' +
        sx +
        ',' +
        sy +
        ')'
    );
    this.styles.set(
      video,
      'clip-path',
      Object.values(s.borders).some((v) => Number(v) > 0)
        ? 'inset(' +
            p.y +
            'px ' +
            (video.videoWidth - p.x - p.width) +
            'px ' +
            (video.videoHeight - p.y - p.height) +
            'px ' +
            p.x +
            'px)'
        : 'none'
    );
    this.styles.set(
      video,
      'filter',
      s.brightness === 1 && s.contrast === 1 && s.saturation === 1
        ? 'none'
        : 'brightness(' +
            s.brightness +
            ') contrast(' +
            s.contrast +
            ') saturate(' +
            s.saturation +
            ')'
    );
  }
  hide(video) {
    this.styles.set(video, 'opacity', '0');
  }
  restore() {
    this.styles.restore();
  }
}
export function effectCanvas(shell, name) {
  const canvas = document.createElement('canvas');
  canvas.dataset.ultrawideEffect = name;
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
  shell.prepend(canvas);
  return canvas;
}
export class AmbientRenderer {
  canvas;
  context;
  previous;
  sample;
  last = 0;
  lastLuma = null;
  fps = 30;
  quality = 1;
  qualitySample = null;
  initialized = false;
  constructor(shell) {
    this.canvas = effectCanvas(shell, 'ambient');
    this.context = this.canvas.getContext('2d', { alpha: true });
    this.sample = document.createElement('canvas');
    this.sample.width = 160;
    this.sample.height = 90;
    this.previous = document.createElement('canvas');
    if (!this.context) throw Error('Ambient canvas unavailable.');
  }
  draw(video, plan, s, now) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fps = Math.min(this.fps, s.ambientFps, reduced ? 10 : 30);
    if (now - this.last < 1000 / fps) return;
    const dt = this.last ? now - this.last : 1000 / fps;
    this.last = now;
    const start = performance.now(),
      p = plan.picture;
    const q = video.getVideoPlaybackQuality?.();
    if (q && (!this.qualitySample || now - this.qualitySample.time > 2000)) {
      if (this.qualitySample) {
        const total = q.totalVideoFrames - this.qualitySample.total,
          dropped = q.droppedVideoFrames - this.qualitySample.dropped;
        if (total > 30 && dropped / total > 0.005) {
          this.quality = Math.max(0.3, this.quality * 0.8);
          this.fps = Math.max(10, this.fps - 5);
        }
      }
      this.qualitySample = { time: now, total: q.totalVideoFrames, dropped: q.droppedVideoFrames };
    }
    const size = clamp(s.ambientQuality * this.quality, 0.15, 1);
    const w = Math.max(64, Math.round((plan.viewport.width * size) / 3));
    const h = Math.max(36, Math.round((plan.viewport.height * size) / 3));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.previous.width = w;
      this.previous.height = h;
      this.lastLuma = null;
      this.initialized = false;
    }
    const sample = this.sample.getContext('2d', { willReadFrequently: true });
    sample.drawImage(video, p.x, p.y, p.width, p.height, 0, 0, 160, 90);
    const data = sample.getImageData(0, 0, 160, 90).data;
    let luma = 0;
    for (let i = 0; i < data.length; i += 16)
      luma += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    luma /= data.length / 16;
    // Limit luminance jumps in the backdrop. Never modify foreground video.
    let compensation = 1;
    if (this.lastLuma !== null && luma > this.lastLuma + 18)
      compensation = (this.lastLuma + 18) / Math.max(1, luma);
    this.lastLuma =
      this.lastLuma === null ? luma : this.lastLuma + clamp(luma - this.lastLuma, -18, 18);
    const ctx = this.context;
    const pc = this.previous.getContext('2d');
    pc.clearRect(0, 0, w, h);
    pc.filter =
      'blur(' +
      s.ambientBlur * (w / plan.viewport.width) +
      'px) brightness(' +
      s.ambientBrightness * compensation +
      ')';
    const cover = Math.max(w / p.width, h / p.height) * s.ambientSpread;
    const dw = p.width * cover,
      dh = p.height * cover;
    pc.drawImage(video, p.x, p.y, p.width, p.height, (w - dw) / 2, (h - dh) / 2, dw, dh);
    pc.filter = 'none';
    const smoothing = Math.max(s.ambientSmoothing, reduced ? 600 : 0);
    ctx.globalAlpha = this.initialized ? 1 - Math.exp(-dt / Math.max(1, smoothing)) : 1;
    this.initialized = true;
    ctx.drawImage(this.previous, 0, 0);
    ctx.globalAlpha = 1;
    // Clear the foreground rectangle so ambience is confined to unused screen area.
    ctx.clearRect(
      (plan.x * w) / plan.viewport.width,
      (plan.y * h) / plan.viewport.height,
      (plan.width * w) / plan.viewport.width,
      (plan.height * h) / plan.viewport.height
    );
    if (performance.now() - start > 6) {
      this.quality = Math.max(0.3, this.quality * 0.8);
      this.fps = Math.max(10, this.fps - 5);
    }
  }
  hide() {
    this.canvas.style.display = 'none';
  }
  show() {
    this.canvas.style.display = '';
  }
  destroy() {
    this.canvas.remove();
  }
}
const VERTEX = `#version 300 es
in vec2 position;
out vec2 uv;
void main(){uv=position*0.5+0.5;gl_Position=vec4(position,0.,1.);}`;
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;out vec4 color;
uniform sampler2D videoTexture;
uniform sampler2D warpTexture;
uniform vec4 roi;
uniform float rotation;
uniform vec2 flips;
uniform vec3 adjustments;
void main(){
  float p=clamp(uv.x*2047.,0.,2047.);
  int a=int(floor(p));
  float x=mix(texelFetch(warpTexture,ivec2(a,0),0).r,
    texelFetch(warpTexture,ivec2(min(a+1,2047),0),0).r,fract(p));
  vec2 q=vec2(x,1.-uv.y);
  if(rotation==1.)q=vec2(q.y,1.-q.x);
  else if(rotation==2.)q=vec2(1.-q.x,1.-q.y);
  else if(rotation==3.)q=vec2(1.-q.y,q.x);
  if(flips.x<0.)q.x=1.-q.x;if(flips.y<0.)q.y=1.-q.y;
  vec3 c=texture(videoTexture,roi.xy+q*roi.zw).rgb;
  c=(c-0.5)*adjustments.y+0.5;c*=adjustments.x;
  float y=dot(c,vec3(.2126,.7152,.0722));c=mix(vec3(y),c,adjustments.z);
  color=vec4(clamp(c,0.,1.),1.);
}`;
export class ElasticRenderer {
  canvas;
  gl;
  program;
  videoTexture;
  warpTexture;
  buffer;
  key = '';
  lost = false;
  onFailure;
  abort = new AbortController();
  constructor(shell, onFailure) {
    this.onFailure = onFailure;
    this.canvas = effectCanvas(shell, 'elastic');
    this.canvas.style.zIndex = '1';
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      this.canvas.remove();
      throw Error('WebGL2 unavailable.');
    }
    this.gl = gl;
    try {
      this.canvas.addEventListener(
        'webglcontextlost',
        (event) => {
          event.preventDefault();
          this.lost = true;
          this.onFailure('Elastic GPU context lost.');
        },
        { signal: this.abort.signal }
      );
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const reason = gl.getShaderInfoLog(shader);
          gl.deleteShader(shader);
          throw Error(reason || 'Shader compilation failed.');
        }
        return shader;
      };
      const vs = compile(gl.VERTEX_SHADER, VERTEX),
        fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
      this.program = gl.createProgram();
      gl.attachShader(this.program, vs);
      gl.attachShader(this.program, fs);
      gl.linkProgram(this.program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
        throw Error('Elastic shader link failed.');
      gl.useProgram(this.program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );
      const location = gl.getAttribLocation(this.program, 'position');
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
      this.videoTexture = gl.createTexture();
      this.warpTexture = gl.createTexture();
      for (const [index, texture] of [this.videoTexture, this.warpTexture].entries()) {
        gl.activeTexture(gl.TEXTURE0 + index);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      gl.uniform1i(gl.getUniformLocation(this.program, 'videoTexture'), 0);
      gl.uniform1i(gl.getUniformLocation(this.program, 'warpTexture'), 1);
      this.buffer = buffer;
    } catch (error) {
      this.destroy();
      throw error;
    }
  }
  draw(video, plan, s) {
    if (this.lost) throw Error('Elastic is disabled after GPU context loss.');
    const gl = this.gl,
      p = plan.picture;
    this.canvas.style.inset = 'auto';
    this.canvas.style.left = plan.x + 'px';
    this.canvas.style.top = plan.y + 'px';
    this.canvas.style.width = plan.width + 'px';
    this.canvas.style.height = plan.height + 'px';
    // Avoid rendering more pixels than the actual display; cap DPR for predictable memory.
    const dpr = Math.min(devicePixelRatio, 1.5);
    const w = Math.max(1, Math.round(plan.width * dpr)),
      h = Math.max(1, Math.round(plan.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.program);
    const key = [plan.elastic.width, plan.elastic.k, s.center, plan.width].join(':');
    if (key !== this.key) {
      const n = 2048,
        lut = new Float32Array(n);
      for (let i = 0; i < n; i++)
        lut[i] =
          plan.elastic.inverse((i / (n - 1)) * plan.elastic.width) / plan.elastic.sourceWidth;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.warpTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, n, 1, 0, gl.RED, gl.FLOAT, lut);
      this.key = key;
      // R32F linear filtering is optional; nearest sampling is universally valid.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.uniform4f(
      gl.getUniformLocation(this.program, 'roi'),
      p.x / video.videoWidth,
      p.y / video.videoHeight,
      p.width / video.videoWidth,
      p.height / video.videoHeight
    );
    gl.uniform1f(gl.getUniformLocation(this.program, 'rotation'), s.rotation / 90);
    gl.uniform2f(gl.getUniformLocation(this.program, 'flips'), s.flipX ? -1 : 1, s.flipY ? -1 : 1);
    gl.uniform3f(
      gl.getUniformLocation(this.program, 'adjustments'),
      s.brightness,
      s.contrast,
      s.saturation
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) throw Error('Elastic upload/render failed (' + err + ').');
  }
  destroy() {
    const gl = this.gl;
    this.abort.abort();
    if (gl && !this.lost) {
      if (this.videoTexture) gl.deleteTexture(this.videoTexture);
      if (this.warpTexture) gl.deleteTexture(this.warpTexture);
      if (this.buffer) gl.deleteBuffer(this.buffer);
      if (this.program) gl.deleteProgram(this.program);
    }
    this.canvas.remove();
  }
}
// SVG is deliberately opt-in experimental until a real browser/DRM combination is validated.
export class SvgElasticRenderer {
  svg;
  id;
  styles = new OwnedStyles();
  key = '';
  image;
  displacement;
  constructor(shell) {
    const ns = 'http://www.w3.org/2000/svg';
    this.id = 'uw-warp-' + Math.random().toString(36).slice(2);
    this.svg = document.createElementNS(ns, 'svg');
    this.svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
    const filter = document.createElementNS(ns, 'filter');
    filter.id = this.id;
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');
    filter.setAttribute('width', '1');
    filter.setAttribute('height', '1');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    this.image = document.createElementNS(ns, 'feImage');
    this.image.setAttribute('result', 'map');
    this.image.setAttribute('preserveAspectRatio', 'none');
    this.displacement = document.createElementNS(ns, 'feDisplacementMap');
    const neutral = document.createElementNS(ns, 'feComponentTransfer');
    neutral.setAttribute('in', 'map');
    neutral.setAttribute('result', 'neutralMap');
    const green = document.createElementNS(ns, 'feFuncG');
    green.setAttribute('type', 'linear');
    green.setAttribute('slope', '0');
    green.setAttribute('intercept', '0.5');
    neutral.append(green);
    this.displacement.setAttribute('in', 'SourceGraphic');
    this.displacement.setAttribute('in2', 'neutralMap');
    this.displacement.setAttribute('xChannelSelector', 'R');
    this.displacement.setAttribute('yChannelSelector', 'G');
    filter.append(this.image, neutral, this.displacement);
    this.svg.append(filter);
    shell.append(this.svg);
  }
  apply(video, plan, s) {
    if (s.rotation !== 0 || s.flipX || s.flipY || Object.values(s.borders).some((v) => v !== 0))
      throw Error(
        'Experimental SVG currently requires no rotation, flips, or encoded-border crop.'
      );
    const key = [plan.width, plan.elastic.k, s.center].join(':');
    if (key !== this.key) {
      const canvas = document.createElement('canvas');
      canvas.width = 2048;
      canvas.height = 2;
      const ctx = canvas.getContext('2d'),
        data = ctx.createImageData(2048, 2);
      const baseWidth = plan.elastic.sourceWidth;
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2048; x++) {
          const u = (x + 0.5) / 2048,
            source = plan.elastic.inverse(u * plan.elastic.width) / baseWidth;
          const i = (y * 2048 + x) * 4;
          data.data[i] = Math.round(clamp(0.5 + source - u, 0, 1) * 255);
          data.data[i + 1] = 128;
          data.data[i + 2] = 0;
          data.data[i + 3] = 255;
        }
      ctx.putImageData(data, 0, 0);
      this.image.setAttribute('href', canvas.toDataURL());
      this.displacement.setAttribute('scale', String(video.videoWidth));
      this.key = key;
    }
    this.styles.set(
      video,
      'filter',
      'url("#' +
        this.id +
        '") brightness(' +
        s.brightness +
        ') contrast(' +
        s.contrast +
        ') saturate(' +
        s.saturation +
        ')'
    );
  }
  destroy() {
    this.styles.restore();
    this.svg.remove();
  }
}

export class TextTrackOverlay {
  host;
  key = '';
  constructor(shell) {
    this.host = document.createElement('div');
    this.host.dataset.ultrawideEffect = 'captions';
    this.host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:6;';
    shell.append(this.host);
  }
  update(video, plan) {
    const cues = [];
    for (const track of video.textTracks)
      if (track.mode === 'showing' && track.activeCues)
        for (const cue of track.activeCues) cues.push(cue);
    const key =
      cues.map((c) => c.id + '|' + c.text + '|' + c.startTime).join(';') +
      ':' +
      plan.viewport.width +
      ':' +
      plan.viewport.height;
    if (key === this.key) return;
    this.key = key;
    this.host.replaceChildren();
    for (const cue of cues) {
      const text = document.createElement('div');
      text.textContent = cue.getCueAsHTML ? cue.getCueAsHTML().textContent : cue.text;
      const position = Number.isFinite(cue.position) ? cue.position : 50;
      const size = Number.isFinite(cue.size) ? cue.size : 90;
      text.style.cssText =
        'position:absolute;text-align:center;white-space:pre-line;color:white;text-shadow:0 1px 3px black;background:#0009;padding:3px 8px;border-radius:3px;transform:translateX(-50%);';
      text.style.left = position + '%';
      text.style.width = Math.min(90, size) + '%';
      text.style.fontSize = clamp(plan.viewport.height * 0.035, 14, 32) + 'px';
      if (cue.snapToLines === false && Number.isFinite(cue.line)) text.style.top = cue.line + '%';
      else text.style.bottom = '10%';
      this.host.append(text);
    }
  }
  destroy() {
    this.host.remove();
  }
}

export class NativeControlProxy {
  host;
  abort = new AbortController();
  video;
  seek;
  clock;
  play;
  constructor(shell, video) {
    this.video = video;
    video.controls = false;
    this.host = document.createElement('div');
    this.host.dataset.ultrawideEffect = 'controls';
    this.host.style.cssText =
      'position:absolute;left:12px;right:12px;bottom:8px;display:flex;align-items:center;gap:8px;z-index:8;padding:8px;border-radius:8px;background:#101826e8;color:white;font:13px system-ui;';
    const makeButton = (label, action) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText =
        'font:inherit;background:#263b57;color:white;border:1px solid #7992ac;border-radius:5px;padding:5px;';
      b.addEventListener('click', action, { signal: this.abort.signal });
      return b;
    };
    this.play = makeButton('Pause/play', () => {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    });
    this.seek = document.createElement('input');
    this.seek.type = 'range';
    this.seek.min = '0';
    this.seek.max = '1000';
    this.seek.step = '1';
    this.seek.setAttribute('aria-label', 'Seek video');
    this.seek.style.flex = '1';
    this.seek.addEventListener(
      'input',
      () => {
        if (Number.isFinite(video.duration))
          video.currentTime = (Number(this.seek.value) / 1000) * video.duration;
      },
      { signal: this.abort.signal }
    );
    this.clock = document.createElement('span');
    const mute = makeButton('Mute', () => {
      video.muted = !video.muted;
      mute.textContent = video.muted ? 'Unmute' : 'Mute';
    });
    mute.textContent = video.muted ? 'Unmute' : 'Mute';
    const volume = document.createElement('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '1';
    volume.step = '.05';
    volume.value = String(video.volume);
    volume.setAttribute('aria-label', 'Volume');
    volume.style.width = '70px';
    volume.addEventListener(
      'input',
      () => {
        video.volume = Number(volume.value);
      },
      { signal: this.abort.signal }
    );
    const captions = document.createElement('select');
    captions.setAttribute('aria-label', 'Subtitles');
    const off = document.createElement('option');
    off.value = '-1';
    off.textContent = 'Subtitles off';
    captions.append(off);
    for (let i = 0; i < video.textTracks.length; i++) {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent =
        video.textTracks[i].label || video.textTracks[i].language || 'Track ' + (i + 1);
      option.selected = video.textTracks[i].mode === 'showing';
      captions.append(option);
    }
    captions.addEventListener(
      'change',
      () => {
        for (let i = 0; i < video.textTracks.length; i++)
          video.textTracks[i].mode = i === Number(captions.value) ? 'showing' : 'disabled';
      },
      { signal: this.abort.signal }
    );
    const fullscreen = makeButton('Fullscreen', () => shell.requestFullscreen().catch(() => {}));
    this.host.append(this.play, this.seek, this.clock, mute, volume);
    if (video.textTracks.length) this.host.append(captions);
    this.host.append(fullscreen);
    shell.append(this.host);
    for (const event of ['timeupdate', 'durationchange', 'play', 'pause'])
      video.addEventListener(event, () => this.update(), { signal: this.abort.signal });
    this.update();
  }
  update() {
    this.seek.disabled = !Number.isFinite(this.video.duration) || this.video.duration <= 0;
    if (!this.seek.disabled)
      this.seek.value = String((this.video.currentTime / this.video.duration) * 1000);
    this.clock.textContent =
      Math.floor(this.video.currentTime / 60) +
      ':' +
      String(Math.floor(this.video.currentTime % 60)).padStart(2, '0');
    this.play.textContent = this.video.paused ? 'Play' : 'Pause';
  }
  destroy() {
    this.abort.abort();
    this.host.remove();
    if (!this.video.controls) this.video.controls = true;
  }
}
