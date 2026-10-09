import { DEFAULTS, clone, validateStore, mergeSettings } from './core';
export const STORAGE_KEY = 'ultrawideSettingsV1';
export function emptyStore() {
  return { version: 1, global: clone(DEFAULTS), sites: {}, disabled: [] };
}
export async function loadSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  try {
    return data[STORAGE_KEY] ? validateStore(data[STORAGE_KEY]) : emptyStore();
  } catch {
    return emptyStore();
  }
}
export async function writeSettings(store) {
  const safe = validateStore(store);
  await chrome.storage.local.set({ [STORAGE_KEY]: safe });
  return safe;
}
export function effectiveSettings(store, origin, temporary = {}) {
  return mergeSettings(store.global, store.sites[origin] || {}, temporary);
}
