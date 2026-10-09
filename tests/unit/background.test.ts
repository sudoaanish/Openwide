import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emptyStore, STORAGE_KEY } from '../../src/settings';
let listener,
  memory,
  granted = true,
  registered = [],
  injected = 0;
const event = () => ({ addListener: () => {} });
const api = {
  runtime: {
    id: 'unit-test',
    getURL: (path) => 'chrome-extension://unit-test/' + path,
    onMessage: {
      addListener: (fn) => {
        listener = fn;
      },
    },
    onInstalled: event(),
    onStartup: event(),
  },
  storage: {
    local: {
      get: async () => ({ [STORAGE_KEY]: memory }),
      set: async (value) => {
        memory = value[STORAGE_KEY];
      },
    },
  },
  permissions: {
    contains: async () => granted,
    getAll: async () => ({ origins: ['https://media.test/*'] }),
    onAdded: event(),
    onRemoved: event(),
  },
  scripting: {
    unregisterContentScripts: async () => {
      registered = [];
    },
    registerContentScripts: async (scripts) => {
      registered.push(...scripts);
    },
    executeScript: async () => {
      injected++;
      return [];
    },
  },
  commands: { onCommand: event() },
  tabs: { query: async () => [], sendMessage: async () => ({}), create: async () => ({}) },
};
beforeEach(async () => {
  vi.resetModules();
  memory = emptyStore();
  granted = true;
  registered = [];
  injected = 0;
  vi.stubGlobal('chrome', api);
  await import('../../src/background');
});
function send(
  message,
  sender = { id: 'unit-test', url: 'chrome-extension://unit-test/popup.html' }
) {
  return new Promise((resolve) => listener(message, sender, resolve));
}
describe('permission and profile boundary', () => {
  it('accepts a genuine extension page even when Chrome includes its tab', async () => {
    const response = await send(
      { type: 'export-store' },
      { id: 'unit-test', url: 'chrome-extension://unit-test/popup.html', tab: { id: 2 } }
    );
    expect(response.error).toBeUndefined();
    expect(response.result.version).toBe(1);
  });
  it('does not inject when host permission is declined', async () => {
    granted = false;
    const response = await send({ type: 'enable-origin', origin: 'https://media.test', tabId: 1 });
    expect(response.error).toContain('not been granted');
    expect(injected).toBe(0);
  });
  it('registers only granted hosts and enables the current origin', async () => {
    memory.disabled = ['https://media.test'];
    const response = await send({ type: 'enable-origin', origin: 'https://media.test', tabId: 1 });
    expect(response.result.ok).toBe(true);
    expect(memory.disabled).toEqual([]);
    expect(registered[0].matches).toEqual(['https://media.test/*']);
    expect(registered[0].allFrames).toBe(true);
    expect(injected).toBe(2);
  });
  it('rejects a profile request impersonating another origin', async () => {
    const response = await send(
      { type: 'save-profile', origin: 'https://media.test', settings: { zoom: 1.2 } },
      { id: 'unit-test', tab: { id: 1 }, url: 'https://other.test/watch' }
    );
    expect(response.error).toContain('does not match');
    expect(memory.sites).toEqual({});
  });
  it('rejects content-frame settings import and invalid full-URL profiles', async () => {
    const denied = await send(
      { type: 'import-store', value: { version: 1 } },
      { id: 'unit-test', tab: { id: 1 }, url: 'https://media.test' }
    );
    expect(denied.error).toContain('popup');
    const invalid = await send({
      type: 'import-store',
      value: { version: 1, sites: { 'https://media.test/watch?v=secret': {} } },
    });
    expect(invalid.error).toContain('origins');
  });
  it('disables sites and validates saved controls', async () => {
    await send({ type: 'disable-origin', origin: 'https://media.test' });
    expect(memory.disabled).toEqual(['https://media.test']);
    const invalid = await send({
      type: 'save-profile',
      origin: 'https://media.test',
      settings: { speed: 10 },
    });
    expect(invalid.error).toContain('Invalid');
    expect(memory.sites).toEqual({});
  });
});
