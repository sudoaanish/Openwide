import { describe, it, expect } from 'vitest';
import { OwnedStyles } from '../../src/adapters';
class Style {
  values = {};
  priorities = {};
  getPropertyValue(k) {
    return this.values[k] || '';
  }
  getPropertyPriority(k) {
    return this.priorities[k] || '';
  }
  setProperty(k, v, p = '') {
    this.values[k] = v;
    this.priorities[k] = p;
  }
  removeProperty(k) {
    delete this.values[k];
    delete this.priorities[k];
  }
}
describe('style ownership', () => {
  it('restores preexisting values and priorities, removes added properties', () => {
    const el = { style: new Style() };
    el.style.setProperty('filter', 'contrast(1.2)', 'important');
    const owned = new OwnedStyles();
    owned.set(el, 'filter', 'none');
    owned.set(el, 'width', '400px');
    owned.restore();
    expect(el.style.getPropertyValue('filter')).toBe('contrast(1.2)');
    expect(el.style.getPropertyPriority('filter')).toBe('important');
    expect(el.style.getPropertyValue('width')).toBe('');
  });
  it('preserves newer host-player changes', () => {
    const el = { style: new Style() },
      owned = new OwnedStyles();
    owned.set(el, 'filter', 'none');
    el.style.setProperty('filter', 'brightness(1.4)');
    owned.restore();
    expect(el.style.getPropertyValue('filter')).toBe('brightness(1.4)');
  });
  it('captures a new host value before reapplying ownership', () => {
    const el = { style: new Style() },
      owned = new OwnedStyles();
    owned.set(el, 'filter', 'none');
    el.style.setProperty('filter', 'saturate(1.5)');
    owned.set(el, 'filter', 'none');
    owned.restore();
    expect(el.style.getPropertyValue('filter')).toBe('saturate(1.5)');
  });
});
