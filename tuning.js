// Live tuning panel — enabled with ?tune=1 in the URL.

import { clearSavedTuning } from './engine3d.js';

// Keep an angle inside the sliders' -180..180 range.
const wrapDeg = (deg) => (((deg + 180) % 360) + 360) % 360 - 180;

// The three material sliders are OVERRIDES, and they behave differently from the rest:
const FIELDS = [
  { key: 'rotX', label: 'Rotate X', min: -180, max: 180, step: 1, def: 0, unit: '°', rebake: true },
  { key: 'rotY', label: 'Rotate Y', min: -180, max: 180, step: 1, def: 0, unit: '°', rebake: true },
  { key: 'rotZ', label: 'Rotate Z', min: -180, max: 180, step: 1, def: 0, unit: '°', rebake: true },
  { key: 'scale', label: 'Size', min: 0.2, max: 3, step: 0.01, def: 1, unit: '×' },
  { key: 'offsetX', label: 'Move X', min: -1.5, max: 1.5, step: 0.01, def: 0 },
  { key: 'offsetY', label: 'Move Y', min: -2, max: 2, step: 0.01, def: 0 },
  { key: 'offsetZ', label: 'Move Z', min: -1.5, max: 1.5, step: 0.01, def: 0 },
  { key: 'metalness', label: 'Metal', min: 0, max: 1, step: 0.01, def: 0, group: 'Material' },
  { key: 'roughness', label: 'Polish', min: 0.02, max: 1, step: 0.01, def: 0.30, group: 'Material' },
  { key: 'envIntensity', label: 'Reflections', min: 0, max: 3, step: 0.05, def: 1, group: 'Material' },

  // Earring-only. Where the piercing sits varies from face to face and from model to…
  { key: 'earDrop', label: 'Ear ↓', min: -0.8, max: 1.2, step: 0.01, def: 0.18, only: 'earring', group: 'Earring fit' },
  { key: 'earOut', label: 'Ear ↔', min: -0.4, max: 0.8, step: 0.01, def: 0.14, only: 'earring', group: 'Earring fit' },
  { key: 'earBack', label: 'Ear ↕ depth', min: -0.6, max: 0.6, step: 0.01, def: 0.08, only: 'earring', group: 'Earring fit' },
];

const CSS = `
#vto-tuner {
  position: fixed; top: 12px; right: 12px; z-index: 10000;
  width: 250px; max-height: 88vh; overflow-y: auto;
  padding: 12px 14px 14px;
  background: rgba(14,14,14,0.94);
  border: 1px solid rgba(212,175,55,0.5); border-radius: 12px;
  font-family: 'Poppins', system-ui, sans-serif; font-size: 12px; color: #F5F0E8;
  box-shadow: 0 10px 40px rgba(0,0,0,0.6);
  backdrop-filter: blur(6px);
}
#vto-tuner h3 { margin: 0 0 2px; font-size: 13px; color: #E8C860; letter-spacing: .04em; }
#vto-tuner .vt-sub { margin: 0 0 10px; opacity: .6; font-size: 10.5px; line-height: 1.4; }
#vto-tuner select, #vto-tuner button {
  width: 100%; padding: 6px 8px; margin-bottom: 8px;
  background: rgba(255,255,255,.06); color: #F5F0E8;
  border: 1px solid rgba(212,175,55,.35); border-radius: 7px;
  font: inherit; cursor: pointer;
}
#vto-tuner button:hover { background: rgba(212,175,55,.18); }
#vto-tuner .vt-row { margin-bottom: 7px; }
#vto-tuner .vt-row label {
  display: flex; justify-content: space-between; margin-bottom: 2px;
  font-size: 11px; opacity: .85;
}
#vto-tuner .vt-row label b { color: #E8C860; font-weight: 500; }
#vto-tuner input[type=range] { width: 100%; accent-color: #D4AF37; height: 16px; }
#vto-tuner .vt-empty { opacity: .55; padding: 10px 0; line-height: 1.5; }
#vto-tuner .vt-group {
  margin: 10px 0 5px; padding-top: 8px;
  border-top: 1px solid rgba(212,175,55,.22);
  font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
  color: #E8C860; opacity: .8;
}
#vto-tuner .vt-anchor { display: flex; gap: 6px; margin-bottom: 8px; }
#vto-tuner .vt-anchor button { margin: 0; }
#vto-tuner .vt-anchor button.on { background: rgba(212,175,55,.3); border-color: #D4AF37; }
`;

export function createTuner(engine, getActiveItems) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'vto-tuner';
  document.body.appendChild(panel);

  let currentId = null;

  function render() {
    const items = getActiveItems();
    panel.innerHTML = '';

    const h = document.createElement('h3');
    h.textContent = 'Model Tuning';
    panel.appendChild(h);

    const sub = document.createElement('p');
    sub.className = 'vt-sub';
    sub.textContent = 'Adjust, then copy the config into MODEL_TUNING in engine3d.js';
    panel.appendChild(sub);

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'vt-empty';
      empty.textContent = 'Turn on a piece of jewellery to tune it.';
      panel.appendChild(empty);
      return;
    }

    if (!items.some((i) => i.id === currentId)) currentId = items[0].id;

    const picker = document.createElement('select');
    for (const item of items) {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.label;
      opt.selected = item.id === currentId;
      picker.appendChild(opt);
    }
    picker.addEventListener('change', () => { currentId = picker.value; render(); });
    panel.appendChild(picker);

    const tuning = engine.getTuning(currentId);
    if (!tuning) return;

    // Anchor
    const anchorRow = document.createElement('div');
    anchorRow.className = 'vt-anchor';
    for (const mode of ['top', 'center']) {
      const b = document.createElement('button');
      b.textContent = mode === 'top' ? 'Hang from top' : 'Centred';
      if ((tuning.anchor || 'center') === mode) b.classList.add('on');
      b.addEventListener('click', () => {
        engine.updateTuning(currentId, { anchor: mode });
        render();
      });
      anchorRow.appendChild(b);
    }
    panel.appendChild(anchorRow);

    // The two orientation mistakes an exported model actually makes:
    // the wrong way up, or facing away from the camera.
    const flipRow = document.createElement('div');
    flipRow.className = 'vt-anchor';

    const flipUp = document.createElement('button');
    flipUp.textContent = 'Flip up / down';
    flipUp.addEventListener('click', () => {
      engine.updateTuning(currentId, { rotZ: wrapDeg((tuning.rotZ || 0) + 180) });
      render();
    });

    const flipFace = document.createElement('button');
    flipFace.textContent = 'Flip front / back';
    flipFace.addEventListener('click', () => {
      engine.updateTuning(currentId, { rotY: wrapDeg((tuning.rotY || 0) + 180) });
      render();
    });

    flipRow.append(flipUp, flipFace);
    panel.appendChild(flipRow);

    // Pair mirroring — only meaningful for the two-copy categories.
    if (tuning.pair === 2) {
      const pairRow = document.createElement('div');
      pairRow.className = 'vt-anchor';
      for (const on of [true, false]) {
        const b = document.createElement('button');
        b.textContent = on ? 'Mirror pair' : 'Identical pair';
        if (!!tuning.pairMirror === on) b.classList.add('on');
        b.addEventListener('click', () => {
          engine.updateTuning(currentId, { pairMirror: on });
          render();
        });
        pairRow.appendChild(b);
      }
      panel.appendChild(pairRow);
    }

    // Sliders. `only` fields appear just for the category they belong to.
    let shownGroup = null;
    for (const f of FIELDS) {
      if (f.only && tuning.category !== f.only) continue;

      if (f.group && f.group !== shownGroup) {
        shownGroup = f.group;
        const heading = document.createElement('p');
        heading.className = 'vt-group';
        heading.textContent = f.group;
        panel.appendChild(heading);
      }

      const row = document.createElement('div');
      row.className = 'vt-row';

      const label = document.createElement('label');
      const name = document.createElement('span');
      name.textContent = f.label;
      const val = document.createElement('b');
      const current = tuning[f.key] ?? f.def;
      val.textContent = fmt(current, f);
      label.append(name, val);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = f.min;
      slider.max = f.max;
      slider.step = f.step;
      slider.value = current;

      // Rotation re-bakes the model, so only commit on release.
      const evt = f.rebake ? 'change' : 'input';
      slider.addEventListener('input', () => { val.textContent = fmt(+slider.value, f); });
      slider.addEventListener(evt, () => {
        engine.updateTuning(currentId, { [f.key]: +slider.value });
      });

      row.append(label, slider);
      panel.appendChild(row);
    }

    const reset = document.createElement('button');
    reset.textContent = 'Reset';
    reset.addEventListener('click', () => {
      const patch = {};
      for (const f of FIELDS) patch[f.key] = f.def;
      engine.updateTuning(currentId, patch);
      render();
    });
    panel.appendChild(reset);

    const copy = document.createElement('button');
    copy.textContent = 'Copy config';
    copy.addEventListener('click', () => {
      const t = engine.getTuning(currentId);
      const kept = {};
      for (const f of FIELDS) {
        if (f.only && t.category !== f.only) continue;
        const v = t[f.key] ?? f.def;
        if (Math.abs(v - f.def) > 1e-6) kept[f.key] = +v.toFixed(3);
      }
      kept.anchor = t.anchor;
      if (t.pair === 2) kept.pairMirror = !!t.pairMirror;
      const snippet = `  '${currentId}': ${JSON.stringify(kept)},`;
      navigator.clipboard?.writeText(snippet);
      console.log('[Tuner] paste this into MODEL_TUNING:\n' + snippet);
      copy.textContent = 'Copied ✓';
      setTimeout(() => { copy.textContent = 'Copy config'; }, 1500);
    });
    panel.appendChild(copy);

    const forget = document.createElement('button');
    forget.textContent = 'Forget saved';
    forget.title = 'Drop the tuning stored in this browser and reload';
    forget.addEventListener('click', () => {
      clearSavedTuning();
      forget.textContent = 'Cleared — reload';
      setTimeout(() => { forget.textContent = 'Forget saved'; }, 2000);
    });
    panel.appendChild(forget);
  }

  function fmt(v, f) {
    return f.step >= 1 ? `${Math.round(v)}${f.unit || ''}` : `${(+v).toFixed(2)}${f.unit || ''}`;
  }

  render();
  return { refresh: render };
}