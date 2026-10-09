import { validateSettings, validateStore } from './core';
import { loadSettings, writeSettings } from './settings';
let transactions = Promise.resolve();
function mutate(fn) {
  const task = transactions.then(async () => {
    const store = await loadSettings();
    fn(store);
    await writeSettings(store);
  });
  transactions = task.catch(() => {});
  return task;
}
function originPattern(origin) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
    throw Error('Select an HTTP/HTTPS site.');
  // Chrome match patterns do not restrict ports; profile keys still preserve the exact origin.
  return url.protocol + '//' + url.hostname + '/*';
}
let scriptUpdates = Promise.resolve();
function syncScripts() {
  const task = scriptUpdates.then(async () => {
    const { origins = [] } = await chrome.permissions.getAll();
    const matches = origins.filter((s) => s.startsWith('http://') || s.startsWith('https://'));
    await chrome.scripting.unregisterContentScripts({ ids: ['ultrawide-enabled'] }).catch(() => {});
    if (matches.length)
      await chrome.scripting.registerContentScripts([
        {
          id: 'ultrawide-enabled',
          matches,
          js: ['content.js'],
          runAt: 'document_idle',
          allFrames: true,
          persistAcrossSessions: true,
        },
      ]);
  });
  scriptUpdates = task.catch(() => {});
  return task;
}
async function frameStatus(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => globalThis['__ultrawideController']?.status() || null,
    });
    return results
      .filter((r) => r.result)
      .map((r) => ({ ...r.result, frameId: r.frameId }))
      .sort((a, b) => b.area - a.area);
  } catch {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => globalThis['__ultrawideController']?.status() || null,
      });
      return results.filter((r) => r.result).map((r) => ({ ...r.result, frameId: r.frameId }));
    } catch {
      return [];
    }
  }
}
async function inject(tabId) {
  // Main-frame failure is meaningful; cross-origin frames require separate host grants.
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] })
    .catch(() => {});
}
async function handle(message, sender) {
  if (message.type === 'authorized')
    return await chrome.permissions.contains({ origins: [originPattern(message.origin)] });
  const extensionPage =
    sender.id === chrome.runtime.id &&
    typeof sender.url === 'string' &&
    sender.url.startsWith(chrome.runtime.getURL(''));
  if (
    [
      'enable-origin',
      'import-store',
      'export-store',
      'frame-status',
      'frame-command',
      'open-shortcuts',
    ].includes(message.type) &&
    !extensionPage
  )
    throw Error('This action is only available from the extension popup.');
  if (
    ['save-profile', 'reset-profile', 'disable-origin'].includes(message.type) &&
    sender.tab &&
    !extensionPage
  ) {
    if (new URL(sender.url).origin !== message.origin)
      throw Error('Profile origin does not match the requesting frame.');
  }
  if (message.type === 'enable-origin') {
    const pattern = originPattern(message.origin);
    if (!(await chrome.permissions.contains({ origins: [pattern] })))
      throw Error('Site permission has not been granted.');
    await mutate((store) => {
      store.disabled = store.disabled.filter((v) => v !== message.origin);
    });
    await syncScripts();
    await inject(message.tabId);
    return { ok: true };
  }
  if (message.type === 'disable-origin') {
    originPattern(message.origin);
    await mutate((store) => {
      if (!store.disabled.includes(message.origin)) store.disabled.push(message.origin);
    });
    return { ok: true };
  }
  if (message.type === 'save-profile') {
    originPattern(message.origin);
    const safe = validateSettings(message.settings);
    await mutate((store) => {
      store.sites[message.origin] = safe;
    });
    return { ok: true };
  }
  if (message.type === 'reset-profile') {
    originPattern(message.origin);
    await mutate((store) => {
      delete store.sites[message.origin];
    });
    return { ok: true };
  }
  if (message.type === 'import-store') {
    const safe = validateStore(message.value);
    await mutate((store) => Object.assign(store, safe));
    return { ok: true };
  }
  if (message.type === 'export-store') return await loadSettings();
  if (message.type === 'frame-status') return await frameStatus(message.tabId);
  if (message.type === 'frame-command')
    return await chrome.tabs.sendMessage(message.tabId, message.command, {
      frameId: message.frameId || 0,
    });
  if (message.type === 'open-shortcuts') {
    await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    return { ok: true };
  }
  throw Error('Unknown extension action.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const supported = [
    'authorized',
    'enable-origin',
    'disable-origin',
    'save-profile',
    'reset-profile',
    'import-store',
    'export-store',
    'frame-status',
    'frame-command',
    'open-shortcuts',
  ];
  if (!supported.includes(message.type)) return;
  handle(message, sender).then(
    (result) => respond({ result }),
    (error) => respond({ error: error.message })
  );
  return true;
});
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const frames = await frameStatus(tab.id),
    frame = frames.find((f) => f.active);
  if (frame)
    await chrome.tabs
      .sendMessage(tab.id, { type: 'command', command, shortcut: true }, { frameId: frame.frameId })
      .catch(() => {});
});
chrome.permissions.onAdded.addListener(() => syncScripts().catch(() => {}));
chrome.permissions.onRemoved.addListener(async () => {
  await syncScripts().catch(() => {});
  // Existing documents are cleaned up by an explicit disable action or reload.
});
chrome.runtime.onInstalled.addListener(() => syncScripts().catch(() => {}));
chrome.runtime.onStartup.addListener(() => syncScripts().catch(() => {}));
