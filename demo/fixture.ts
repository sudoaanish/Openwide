import { boot } from '../src/content';
import { emptyStore, STORAGE_KEY } from '../src/settings';
import { validateSettings, validateStore } from '../src/core';
const memory = { [STORAGE_KEY]: emptyStore() },
  changed = [],
  messages = [];
const actualExtension = new URLSearchParams(location.search).has('extension');
const runtime = {
  id: 'fixture',
  onMessage: {
    addListener: (fn) => messages.push(fn),
    removeListener: (fn) => {
      const i = messages.indexOf(fn);
      if (i >= 0) messages.splice(i, 1);
    },
  },
  sendMessage: async (message) => {
    if (message.type === 'save-profile') {
      memory[STORAGE_KEY].sites[message.origin] = validateSettings(message.settings);
      emit();
    }
    if (message.type === 'reset-profile') {
      delete memory[STORAGE_KEY].sites[message.origin];
      emit();
    }
    if (message.type === 'disable-origin') {
      memory[STORAGE_KEY].disabled.push(message.origin);
      emit();
    }
    if (message.type === 'authorized') return { result: true };
    return { result: { ok: true } };
  },
};
function emit() {
  for (const fn of changed) fn({ [STORAGE_KEY]: { newValue: memory[STORAGE_KEY] } }, 'local');
}
if (!actualExtension)
  globalThis['chrome'] = {
    runtime,
    storage: {
      local: {
        get: async () => memory,
        set: async (values) => {
          Object.assign(memory, values);
          emit();
        },
      },
      onChanged: {
        addListener: (fn) => changed.push(fn),
        removeListener: (fn) => {
          const i = changed.indexOf(fn);
          if (i >= 0) changed.splice(i, 1);
        },
      },
    },
  };
const $ = (id) => document.getElementById(id);
const source = document.createElement('canvas');
source.width = 1920;
source.height = 1080;
const ctx = source.getContext('2d');
let frame = 0,
  stream = null;
function paint() {
  frame++;
  const width = source.width,
    height = source.height,
    scene = $('scene').value;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  const ratio = $('picture').value.split(':').map(Number),
    aspect = ratio[0] / ratio[1];
  let w = width,
    h = width / aspect;
  if (h > height) {
    h = height;
    w = h * aspect;
  }
  if ($('padding').value === 'encoded') {
    w = width;
    h = Math.round(width / 2.39);
  }
  if ($('padding').value === 'windowbox') {
    w *= 0.75;
    h *= 0.75;
  }
  const x = (width - w) / 2,
    y = (height - h) / 2;
  const factor =
    scene === 'dark'
      ? 0.025
      : scene === 'fade'
        ? (Math.sin(frame / 60) + 1) / 2
        : scene === 'flash'
          ? frame % 60 < 30
            ? 1
            : 0.05
          : 1;
  ctx.fillStyle =
    'rgb(' +
    Math.round(60 * factor) +
    ',' +
    Math.round(140 * factor) +
    ',' +
    Math.round(180 * factor) +
    ')';
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle =
    'rgb(' +
    Math.round(240 * factor) +
    ',' +
    Math.round(235 * factor) +
    ',' +
    Math.round(220 * factor) +
    ')';
  ctx.lineWidth = 3;
  for (let gx = x; gx < x + w; gx += 80) {
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + h);
    ctx.stroke();
  }
  for (let gy = y; gy < y + h; gy += 80) {
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
    ctx.stroke();
  }
  for (const cx of [x + w * 0.15, x + w * 0.5, x + w * 0.85]) {
    ctx.beginPath();
    ctx.arc(cx, y + h * 0.5, 100, 0, Math.PI * 2);
    ctx.stroke();
  }
  const mx = x + w * 0.5 + Math.sin(frame / 90) * w * 0.2;
  ctx.fillStyle = 'rgb(' + Math.round(230 * factor) + ',' + Math.round(180 * factor) + ',0)';
  ctx.fillRect(mx - 25, y + h * 0.7, 50, 50);
  ctx.restore();
  if ($('logo').checked) {
    ctx.fillStyle = '#fff';
    ctx.font = '32px sans-serif';
    ctx.fillText('LOGO', width * 0.82, Math.max(35, y * 0.7));
  }
  if ($('burnt').checked && frame % 180 < 120) {
    ctx.fillStyle = '#fff';
    ctx.font = '32px sans-serif';
    ctx.fillText('Burned-in captions must be protected', width * 0.28, height - 25);
  }
  requestAnimationFrame(paint);
}
paint();
async function play(video) {
  video.srcObject = stream;
  await video.play();
}
$('start').addEventListener('click', async () => {
  try {
    stream = source.captureStream(60);
    await play($('video'));
    await play($('second-video'));
    if (!actualExtension) await boot();
    $('fixture-status').textContent = 'Fixture started. Open extension controls.';
  } catch (error) {
    $('fixture-status').textContent =
      'Unable to start: ' + error.message + '. Open this laboratory in Chrome or Edge.';
    throw error;
  }
});
$('show').addEventListener('click', () =>
  globalThis['__ultrawideController']?.session?.panel.show()
);
$('pause').addEventListener('click', () => {
  const v = $('video');
  v.paused ? v.play() : v.pause();
});
$('replace').addEventListener('click', async () => {
  const old = $('video'),
    replacement = document.createElement('video');
  replacement.id = 'video';
  replacement.muted = true;
  replacement.playsInline = true;
  old.replaceWith(replacement);
  await play(replacement);
});
$('remove').addEventListener('click', () => $('video')?.remove());
$('fullscreen-fixture').addEventListener('click', () => $('main-player').requestFullscreen());
$('root-fullscreen-fixture').addEventListener('click', () => {
  document.body.style.cssText = 'position:fixed;inset:0;margin:0;padding:0';
  $('main-player').style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;aspect-ratio:auto';
  document.documentElement.requestFullscreen();
});
$('dom-captions').addEventListener('change', () => {
  document.querySelector('.captions').style.display = $('dom-captions').checked ? '' : 'none';
});
$('block').addEventListener('click', () => {
  const session = globalThis['__ultrawideController']?.session;
  if (session) {
    session.blockPixels('Fixture: blocked pixel access.');
    session.render();
  }
});
globalThis['fixture'] = {
  state: () => globalThis['__ultrawideController']?.session?.status(),
  change: (patch) => globalThis['__ultrawideController']?.session?.update(patch),
  reset: () => globalThis['__ultrawideController']?.session?.resetVideo(),
  disable: () => globalThis['__ultrawideController']?.disable(),
  destroy: () => globalThis['__ultrawideController']?.destroy(),
  export: () => JSON.parse(JSON.stringify(memory[STORAGE_KEY])),
  import: (value) => {
    memory[STORAGE_KEY] = validateStore(value);
    emit();
  },
  stats: () => ({
    effects: document.querySelectorAll('[data-ultrawide-effect]').length,
    panels: document.querySelectorAll('[data-ultrawide-panel]').length,
  }),
};
