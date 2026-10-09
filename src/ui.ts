import { DEFAULTS, MODES } from './core';
export const labelMode = (m) => m[0].toUpperCase() + m.slice(1);
export function section(parent, title) {
  const el = document.createElement('details'),
    summary = document.createElement('summary');
  summary.textContent = title;
  el.append(summary);
  parent.append(el);
  return el;
}
export function modePicker(parent, onChange) {
  const group = document.createElement('div');
  group.className = 'modes';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Mode');
  const paths = {
    fit: 'M4 7h24v18H4z M8 11h16v10H8z',
    fill: 'M5 12V5h7 M20 5h7v7 M27 20v7h-7 M12 27H5v-7',
    elastic: 'M4 7Q16 11 28 7v18Q16 21 4 25z M12 11v10 M20 11v10',
    ambient: 'M9 10h14v12H9z M4 5h24v22H4z',
  };
  const buttons = new Map();
  for (const mode of ['fit', 'fill', 'elastic', 'ambient', 'auto', 'original', 'stretch']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', labelMode(mode));
    b.setAttribute('aria-checked', 'false');
    b.tabIndex = -1;
    if (paths[mode]) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 32 32');
      svg.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS(svg.namespaceURI, 'path');
      p.setAttribute('d', paths[mode]);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-width', '1.6');
      p.setAttribute('stroke-linejoin', 'round');
      svg.append(p);
      b.append(svg);
    } else b.className = 'secondary';
    b.append(document.createTextNode(labelMode(mode)));
    b.addEventListener('click', () => onChange(mode));
    buttons.set(mode, b);
    group.append(b);
    b.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key))
        return;
      e.preventDefault();
      const list = [...buttons.entries()].filter(([, button]) => !button.disabled),
        i = list.findIndex(([m]) => m === mode);
      const n =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? list.length - 1
            : (i + (['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1) + list.length) % list.length;
      list[n][1].focus();
      onChange(list[n][0]);
    });
  }
  parent.append(group);
  return {
    group,
    buttons,
    sync(mode, disabled = false, elasticUnavailable = false) {
      for (const [m, b] of buttons) {
        b.disabled = disabled || (m === 'elastic' && elasticUnavailable);
        b.setAttribute('aria-checked', String(m === mode));
        b.tabIndex = m === mode && !b.disabled ? 0 : -1;
      }
      if (![...buttons.values()].some((b) => b.tabIndex === 0)) {
        const available = [...buttons.values()].find((b) => !b.disabled);
        if (available) available.tabIndex = 0;
      }
    },
  };
}
export function rangeControl(parent, label, key, min, max, step, onChange) {
  const row = document.createElement('div');
  row.className = 'range-row';
  row.dataset.setting = key;
  const heading = document.createElement('div');
  heading.className = 'range-heading';
  const title = document.createElement('label');
  title.textContent = label;
  const controls = document.createElement('div');
  controls.className = 'control';
  const number = document.createElement('input');
  number.type = 'number';
  number.setAttribute('aria-label', label + ' value');
  const percent =
    ['center', 'strength', 'ambientBrightness', 'cropBudget'].includes(key) ||
    key.startsWith('border:');
  const factor = percent ? 100 : 1;
  number.min = String(min * factor);
  number.max = String(max * factor);
  number.step = String(step * factor);
  const unit = document.createElement('span');
  unit.className = 'unit';
  unit.textContent = percent ? '%' : key === 'zoom' || key === 'speed' ? '×' : '';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = '↺';
  reset.setAttribute('aria-label', 'Reset ' + label);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.setAttribute('aria-label', label);
  const error = document.createElement('div');
  error.className = 'error';
  error.setAttribute('role', 'alert');
  input.id = 'openwide-' + key;
  title.htmlFor = input.id;
  let current = 0;
  const sync = (value) => {
    current = value;
    input.value = String(value);
    number.value = String(Number((value * factor).toFixed(3)));
    error.textContent = '';
    number.removeAttribute('aria-invalid');
  };
  const commit = (value) => {
    sync(value);
    onChange(value);
  };
  input.addEventListener('input', () => commit(Number(input.value)));
  number.addEventListener('change', () => {
    const value = number.valueAsNumber / factor;
    if (!Number.isFinite(value) || value < min || value > max) {
      error.textContent = `Enter a value from ${min * factor} to ${max * factor}.`;
      number.setAttribute('aria-invalid', 'true');
      return;
    }
    number.removeAttribute('aria-invalid');
    commit(value);
  });
  number.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      sync(current);
      number.removeAttribute('aria-invalid');
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      number.dispatchEvent(new Event('change'));
    }
  });
  reset.addEventListener('click', () => commit(key.startsWith('border:') ? 0 : DEFAULTS[key]));
  controls.append(number, unit, reset);
  heading.append(title, controls);
  row.append(heading, input, error);
  parent.append(row);
  return {
    input,
    number,
    out: unit,
    row,
    sync,
    setDisabled(value) {
      input.disabled = number.disabled = reset.disabled = value;
    },
  };
}
export function conciseStatus(s) {
  const mode = s.effectiveMode || s.settings?.mode || 'original',
    loss = s.loss == null ? '' : (s.loss * 100).toFixed(1) + '%';
  if (s.settings?.mode === 'auto')
    return `Using ${mode === 'ambient' ? 'ambience' : labelMode(mode)}${loss ? ' · Fill would crop ' + loss : ''}`;
  if (s.settings?.mode === 'elastic' && mode !== 'elastic')
    return `Elastic unavailable · Using ${labelMode(mode)}`;
  return mode === 'original'
    ? 'Original presentation'
    : mode === 'fill'
      ? `Fill · Estimated picture crop ${loss || '—'}`
      : `${labelMode(mode)}${s.settings?.zoom > 1 ? ' · Additional zoom applied' : ' · Picture preserved'}`;
}
export function effectVisibility(settings, effectiveMode, ambientActive) {
  return {
    elastic: settings.mode === 'elastic',
    ambient:
      settings.mode === 'ambient' ||
      (settings.mode === 'auto' && effectiveMode === 'ambient') ||
      (settings.mode === 'elastic' && ambientActive),
  };
}
