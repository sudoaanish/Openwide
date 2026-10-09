import { MODES } from './core';
import { modePicker, rangeControl, conciseStatus, effectVisibility } from './ui';
let tab = null,
  frame = null,
  frames = [];
const $ = (id) => document.getElementById(id) as any;
async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw Error(response.error);
  return response?.result;
}
function notice(text) {
  $('status').textContent = text;
}
const picker = modePicker($('primary'), (mode) =>
  run(() => command({ type: 'change', patch: { mode } }))()
);
const fields = new Map();
for (const [key, label, min, max, step] of [
  ['zoom', 'Zoom', 0.25, 4, 0.05],
  ['center', 'Protected center', 0.3, 0.8, 0.05],
  ['strength', 'Elastic strength', 0, 1, 0.05],
  ['ambientBrightness', 'Ambient intensity', 0, 1, 0.05],
])
  fields.set(
    key,
    rangeControl($('primary'), label, key, min, max, step, (value) =>
      run(() => command({ type: 'change', patch: { [key]: value } }))()
    )
  );
const elasticHint = document.createElement('p');
elasticHint.className = 'hint';
elasticHint.textContent = 'WebGL Elastic may affect RTX VSR. SVG support is experimental.';
$('primary').append(elasticHint);
function syncPrimary() {
  picker.sync(frame?.settings.mode || 'auto', !frame, !!frame?.elasticUnavailable);
  const visibility = frame
    ? effectVisibility(frame.settings, frame.effectiveMode, frame.ambientActive)
    : { elastic: false, ambient: false };
  for (const [key, f] of fields) {
    if (frame) f.sync(frame.settings[key]);
    f.setDisabled(!frame);
    f.row.hidden =
      key === 'zoom'
        ? false
        : key === 'ambientBrightness'
          ? !visibility.ambient
          : !visibility.elastic;
  }
  elasticHint.hidden = !visibility.elastic;
}
async function refresh() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    frame = null;
    syncPrimary();
    $('enable').disabled = true;
    notice('Open an HTTP/HTTPS video page to enable Openwide.');
    return;
  }
  const origin = new URL(tab.url).origin;
  $('origin').textContent = origin;
  frames = await request({ type: 'frame-status', tabId: tab.id });
  const selected = Number($('frame').value);
  frame =
    frames.find((f) => f.frameId === selected && f.active) || frames.find((f) => f.active) || null;
  $('frame').replaceChildren();
  for (const f of frames) {
    const o = document.createElement('option');
    o.value = String(f.frameId);
    o.textContent = f.origin + (f.active ? ' · ' + f.adapter : ' · no video');
    o.selected = f === frame;
    $('frame').append(o);
  }
  for (const id of ['mode', 'panel', 'reset', 'compare', 'save']) $(id).disabled = !frame;
  $('frame').parentElement.hidden = frames.filter((f) => f.active).length <= 1;
  syncPrimary();
  if (frame) {
    $('mode').value = frame.settings.mode;
    $('mode').querySelector('option[value="elastic"]').disabled =
      frame.capabilities.elasticFailed ||
      (frame.capabilities.pixels === 'blocked' && frame.settings.elasticBackend === 'webgl');
    picker.sync(
      frame.settings.mode,
      false,
      $('mode').querySelector('option[value="elastic"]').disabled
    );
    notice(conciseStatus(frame));
    $('diagnostics').textContent = frame.message;
    $('warning').textContent = frame.notice || frame.capabilities.reason || '';
  } else {
    $('warning').textContent = '';
    $('diagnostics').textContent = '';
    notice('Enable this site, then play a video. For an embedded player, grant its origin below.');
  }
}
async function command(value) {
  if (!frame) return;
  const result = await request({
    type: 'frame-command',
    tabId: tab.id,
    frameId: frame.frameId,
    command: value,
  });
  await refresh();
  return result;
}
async function enable(origin) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('Use an HTTP/HTTPS origin.');
  const pattern = url.protocol + '//' + url.hostname + '/*';
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    notice('Permission declined. The page is unchanged.');
    return;
  }
  await request({ type: 'enable-origin', origin: url.origin, tabId: tab.id });
  // boot() waits for storage, so allow the injected controller to attach.
  setTimeout(() => refresh().catch((e) => notice(e.message)), 350);
}
function run(fn) {
  return () =>
    Promise.resolve()
      .then(fn)
      .catch((e) => notice(e.message));
}
for (const mode of MODES) {
  const o = document.createElement('option');
  o.value = mode;
  o.textContent = mode[0].toUpperCase() + mode.slice(1);
  $('mode').append(o);
}
$('enable').addEventListener('click', () => {
  // permissions.request must run in the direct user gesture, before asynchronous work.
  try {
    enable(new URL(tab.url).origin).catch((e) => notice(e.message));
  } catch (e) {
    notice(e.message);
  }
});
$('grant').addEventListener('click', () => {
  try {
    enable($('embedded').value).catch((e) => notice(e.message));
  } catch (e) {
    notice(e.message);
  }
});
$('mode').addEventListener(
  'change',
  run(() => command({ type: 'change', patch: { mode: $('mode').value } }))
);
$('frame').addEventListener('change', run(refresh));
$('panel').addEventListener(
  'click',
  run(() => command({ type: 'show-panel' }))
);
$('reset').addEventListener(
  'click',
  run(() => command({ type: 'command', command: 'reset-video' }))
);
let comparing = false;
function compare(on) {
  if (!frame || comparing === on) return;
  comparing = on;
  command({ type: 'compare', on }).catch((e) => notice(e.message));
}
$('compare').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  $('compare').setPointerCapture(e.pointerId);
  compare(true);
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur'])
  $('compare').addEventListener(event, () => compare(false));
$('compare').addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    compare(true);
  }
});
$('compare').addEventListener('keyup', () => compare(false));
window.addEventListener('pagehide', () => {
  if (comparing && frame)
    chrome.runtime
      .sendMessage({
        type: 'frame-command',
        tabId: tab.id,
        frameId: frame.frameId,
        command: { type: 'compare', on: false },
      })
      .catch(() => {});
});
$('save').addEventListener(
  'click',
  run(() => request({ type: 'save-profile', origin: frame.origin, settings: frame.settings }))
);
$('disable').addEventListener(
  'click',
  run(async () => {
    const origin = frame?.origin || new URL(tab.url).origin;
    await request({ type: 'disable-origin', origin });
    await refresh();
  })
);
$('reset-site').addEventListener(
  'click',
  run(async () => {
    await request({ type: 'reset-profile', origin: frame?.origin || new URL(tab.url).origin });
    await command({ type: 'command', command: 'reset-video' });
  })
);
$('export').addEventListener(
  'click',
  run(async () => {
    const value = await request({ type: 'export-store' });
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'openwide-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice('Settings exported. No video URLs are stored.');
  })
);
$('import').addEventListener(
  'change',
  run(async () => {
    const file = $('import').files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) throw Error('Settings file exceeds 1 MB.');
    await request({ type: 'import-store', value: JSON.parse(await file.text()) });
    await refresh();
    $('import').value = '';
  })
);
$('shortcuts').addEventListener(
  'click',
  run(() => request({ type: 'open-shortcuts' }))
);
refresh().catch((e) => notice(e.message));
