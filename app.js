// "vto/" specifiers, not relative paths — see the import map in index.html
import { MediaPipeTracker, getTrackingLabel } from 'vto/mediapipe.js';
import {
  Engine3D,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  MODEL_EXTENSIONS,
  RING_FINGERS,
  discoverItems,
} from 'vto/engine3d.js';

const NOTIFICATION_DURATION = 4000;

const CAMERA_OFF_MESSAGE = 'Please Turn On Your Camera';


const $ = (sel) => document.querySelector(sel);

const video = $('#video');
const canvas3d = $('#canvas3d');
const placeholder = $('#camera-placeholder');
const loadingOverlay = $('#loading-overlay');
const loadingText = $('#loading-text');
const btnStart = $('#btn-start');
const btnStop = $('#btn-stop');
const btnScreenshot = $('#btn-screenshot');
const trackingStatus = $('#tracking-status');
const trackingLabel = $('#tracking-label');
const jewelleryControls = $('#jewellery-controls');

const engine = new Engine3D(canvas3d);
const tracker = new MediaPipeTracker();

let stream = null;
let running = false;
// The jewellery UI is inert until the camera is live
let cameraOn = false;
let rafId = null;
let catalogue = [];
let latestTracking = null;
let lastLabel = '';
const activeByCategory = new Map();
const activeIds = new Set();

// In-flight load per category, identified by a monotonic token
const pendingByCategory = new Map();
let requestSeq = 0;

let notificationTimer = null;

// From ?category=&item= or window.VTO_BOOT (WordPress product → Try On)
const boot = readBootConfig();
let pendingAutoItemId = boot.item || '';

injectNotificationStyles();

function readBootConfig() {
  const params = new URLSearchParams(location.search);
  const fromWindow = (typeof window !== 'undefined' && window.VTO_BOOT) ? window.VTO_BOOT : {};
  let category = (params.get('category') || fromWindow.category || '').toLowerCase().trim();
  let item = (params.get('item') || fromWindow.item || '').trim();
  item = item.replace(/[^a-zA-Z0-9_\-]/g, '');
  if (category === 'earrings' || category === 'studs' || category === 'stud') category = 'earring';
  if (category === 'rings') category = 'ring';
  // `bracelet` still accepted on the way in — old links and old product meta
  if (category === 'bracelet' || category === 'bracelets'
    || category === 'bangle' || category === 'kada') category = 'bangles';
  if (category === 'necklaces' || category === 'chain' || category === 'pendant') category = 'necklace';
  return { category, item };
}

// Chrome

function injectNotificationStyles() {
  if (document.getElementById('vto-notification-styles')) return;
  const style = document.createElement('style');
  style.id = 'vto-notification-styles';
  style.textContent = `
    .vto-notification {
      position: fixed;
      bottom: 1.5rem;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      z-index: 9999;
      padding: 0.7rem 1.4rem;
      /* Reads the same custom properties style.css defines, so the notification
         follows the palette instead of pinning the old gold in JS */
      background: rgba(19, 18, 16, 0.94);
      border: 1px solid rgba(var(--gold-rgb, 197, 164, 100), 0.45);
      border-radius: 14px;
      color: var(--text-primary, #F2ECE0);
      font-family: 'Poppins', sans-serif;
      font-size: 0.82rem;
      letter-spacing: 0.03em;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 24px rgba(var(--gold-rgb, 197, 164, 100), 0.15);
      opacity: 0;
      transition: opacity 0.28s ease, transform 0.28s ease;
      pointer-events: none;
      max-width: 90vw;
      text-align: center;
    }
    .vto-notification.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    .jewellery-btn {
      transition: transform 0.22s cubic-bezier(0.4,0,0.2,1),
                  box-shadow 0.22s cubic-bezier(0.4,0,0.2,1),
                  background 0.22s cubic-bezier(0.4,0,0.2,1),
                  border-color 0.22s cubic-bezier(0.4,0,0.2,1),
                  color 0.22s cubic-bezier(0.4,0,0.2,1);
    }
    .jewellery-btn.active {
      transform: scale(1.04);
      animation: luxuryPulse 0.35s ease;
    }
    @keyframes luxuryPulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.06); }
      100% { transform: scale(1.04); }
    }
  `;
  document.head.appendChild(style);
}

function showNotification(message) {
  let el = document.getElementById('vto-notification');
  if (!el) {
    el = document.createElement('div');
    el.id = 'vto-notification';
    el.className = 'vto-notification';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }

  clearTimeout(notificationTimer);
  el.textContent = message;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');

  notificationTimer = setTimeout(() => el.classList.remove('show'), NOTIFICATION_DURATION);
}

function setTrackingUI(label, state) {
  if (label === lastLabel) return;
  lastLabel = label;
  trackingLabel.textContent = label;
  trackingStatus.className = `status-dot ${state}`;
}

function showLoading(message) {
  if (loadingText) loadingText.textContent = message;
  loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

// Viewport

function resizeViewport() {
  const wrapper = video.parentElement;
  const rect = wrapper.getBoundingClientRect();
  engine.resize(rect.width, rect.height);
  engine.setVideoSize(video.videoWidth, video.videoHeight);
}

// Catalogue

async function discoverCatalogue() {
  catalogue = await discoverItems();

  const missing = catalogue.filter((c) => !c.available).map((c) => c.folder);
  if (missing.length) {
    console.warn(
      `[Catalogue] no model found in: ${missing.join(', ')}\n`
      + `Drop a model file into objects/<folder>/ — ${MODEL_EXTENSIONS.join(', ')} are all read, `
      + 'and a file named model.<ext> is found fastest.',
    );
  }
}

const PRODUCT_BLURBS = {
  necklace: {
    lead: 'A refined neckpiece cut for quiet luxury — made to catch soft light at the collarbone.',
    bullets: ['Premium finish', 'Everyday to evening', 'Comfortable drape', 'Try on live with your camera'],
  },
  earring: {
    lead: 'Lightweight elegance for the ear — atelier gleam without the weight.',
    bullets: ['Secure wear', 'Day-to-night pairing', 'Polished detail', 'Preview on yourself instantly'],
  },
  ring: {
    lead: 'A sculpted band designed for the hand — mirror polish and comfort fit.',
    bullets: ['Comfort-fit feel', 'Statement or stack', 'High polish', 'See it on your finger live'],
  },
  bangles: {
    lead: 'A luminous bangle line for the wrist — fluid shine, intentional weight.',
    bullets: ['Smooth clasp feel', 'Layer or solo', 'Luxe finish', 'Try the fit on camera'],
  },
};

let currentView = 'home';
let selectedProduct = null;

function setView(view) {
  currentView = view;
  const views = {
    home: document.getElementById('view-home'),
    detail: document.getElementById('view-detail'),
    tryon: document.getElementById('view-tryon'),
  };
  Object.entries(views).forEach(([name, el]) => {
    if (!el) return;
    const on = name === view;
    el.hidden = !on;
    el.classList.toggle('hidden', !on);
  });
  const status = document.querySelector('.header-status');
  if (status) status.style.display = view === 'tryon' ? '' : 'none';

  if (view !== 'tryon' && cameraOn) {
    stopCamera();
  }
  if (view === 'tryon') {
    requestAnimationFrame(() => resizeViewport());
  }
}

function buildHiddenJewelleryButtons(items) {
  if (!jewelleryControls) return;
  jewelleryControls.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'jewellery-buttons';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jewellery-btn';
    btn.textContent = item.label;
    btn.dataset.id = item.id;
    btn.dataset.category = item.category;
    if (!item.available) {
      btn.classList.add('unavailable');
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => toggleJewellery(item, btn));
    }
    wrap.appendChild(btn);
  }
  jewelleryControls.appendChild(wrap);
}

function orderedCatalogue() {
  const items = catalogue.filter((c) => c.available);
  const ordered = [];
  for (const key of CATEGORY_ORDER) {
    ordered.push(...items.filter((i) => i.category === key));
  }
  for (const item of items) {
    if (!ordered.includes(item)) ordered.push(item);
  }
  return ordered;
}

/** Main page: photo + name only */
function buildAllProductsHome() {
  const grid = document.getElementById('product-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const items = orderedCatalogue();
  if (!items.length) {
    grid.innerHTML = '<p class="product-shelf__empty">No jewellery models found yet.</p>';
    return;
  }

  for (const item of items) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'product-tile';
    card.dataset.id = item.id;
    card.setAttribute('aria-label', item.label);

    const media = document.createElement('div');
    media.className = 'product-tile__media';
    if (item.image) {
      const img = document.createElement('img');
      img.src = item.image;
      img.alt = item.label;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 600;
      img.height = 600;
      img.sizes = '(max-width: 700px) 46vw, (max-width: 1100px) 30vw, 280px';
      media.appendChild(img);
    } else {
      media.classList.add('is-fallback');
    }

    const name = document.createElement('span');
    name.className = 'product-tile__name';
    name.textContent = item.label;

    card.append(media, name);
    card.addEventListener('click', () => openProductDetail(item));
    grid.appendChild(card);
  }
}

/** After tap: full details + Try On on one clean line */
function openProductDetail(item) {
  selectedProduct = item;
  const panel = document.getElementById('product-detail-panel');
  if (!panel) return;

  const blurb = PRODUCT_BLURBS[item.category] || PRODUCT_BLURBS.necklace;
  const bullets = blurb.bullets.slice(0, 3).map((b) => `<li>${b}</li>`).join('');

  panel.innerHTML = `
    <article class="product-sheet">
      <div class="product-sheet__media${item.image ? '' : ' is-fallback'}">
        ${item.image ? `<img src="${item.image}" alt="${item.label}" width="800" height="800" decoding="async">` : ''}
      </div>
      <div class="product-sheet__body">
        <p class="product-sheet__eyebrow">${CATEGORY_LABELS[item.category] || item.category}</p>
        <h4 class="product-sheet__title">${item.label}</h4>
        <p class="product-sheet__lead">${blurb.lead}</p>
        <ul class="product-sheet__list">${bullets}</ul>
        <div class="vto-product-tryon vto-product-tryon--bar">
          <button type="button" class="vto-product-tryon__btn" id="btn-open-tryon">
            <span class="vto-product-tryon__pulse" aria-hidden="true"></span>
            <span class="vto-product-tryon__shine" aria-hidden="true"></span>
            <span class="vto-product-tryon__label">Try On</span>
          </button>
        </div>
      </div>
    </article>
  `;

  panel.querySelector('#btn-open-tryon')?.addEventListener('click', () => openTryOn(item));
  setView('detail');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openTryOn(item) {
  selectedProduct = item;
  // Only the piece being tried on may stay visible — clear necklace/ring/etc.
  clearAllJewellery();
  pendingAutoItemId = item.id;

  const label = document.getElementById('tryon-piece-label');
  if (label) label.textContent = item.label;

  const peers = catalogue.filter((c) => c.category === item.category && c.available);
  buildHiddenJewelleryButtons(peers);
  setView('tryon');
  showNotification(`Tap Start Camera to try on ${item.label}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  requestAnimationFrame(() => resizeViewport());
}

function buildJewelleryUI() {
  buildAllProductsHome();

  document.getElementById('btn-back-grid')?.addEventListener('click', () => {
    selectedProduct = null;
    setView('home');
  });
  document.getElementById('btn-back-detail')?.addEventListener('click', () => {
    if (cameraOn) stopCamera();
    if (selectedProduct) openProductDetail(selectedProduct);
    else setView('home');
  });

  if (boot.item) {
    const item = catalogue.find((c) => c.id === boot.item && c.available);
    if (item) {
      openProductDetail(item);
      return;
    }
  }
  setView('home');
}

// Ring finger prompt
//
// Tapping the finger on the camera is the ONLY way to choose one now, so this
// prompt is not decoration — nobody would guess the gesture without it. It
// stays on screen the whole time a ring is being worn.

function hasActiveRing() {
  for (const id of activeIds) {
    const item = catalogue.find((c) => c.id === id);
    if (item && item.category === 'ring') return true;
  }
  return false;
}

// Built once, into the camera section, so the landscape layout can place it
// without any extra markup in index.html or the shortcode.
function buildFingerPicker() {
  const existing = document.getElementById('vto-finger-picker');
  if (existing) return existing;

  const section = document.querySelector('.camera-section');
  if (!section) return null;

  const picker = document.createElement('div');
  picker.id = 'vto-finger-picker';
  picker.className = 'vto-finger-picker';
  picker.hidden = true;

  const hint = document.createElement('p');
  hint.className = 'vto-finger-hint';
  hint.setAttribute('role', 'status');

  const dot = document.createElement('span');
  dot.className = 'vto-finger-hint__dot';
  dot.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.textContent = 'Tap the finger you want on the camera';

  hint.append(dot, text);
  picker.appendChild(hint);
  section.appendChild(picker);
  return picker;
}

function chooseFinger(key, announce = true) {
  const applied = engine.setRingFinger(key);
  syncFingerPicker();
  if (announce && RING_FINGERS[applied]) {
    showNotification(`Ring moved to the ${RING_FINGERS[applied].label.toLowerCase()} finger`);
  }
}

// The prompt is shown only while a ring is the piece being worn — it is the one
// piece the camera tap applies to.
function syncFingerPicker() {
  const picker = document.getElementById('vto-finger-picker');
  if (!picker) return;

  const ringActive = hasActiveRing();
  picker.hidden = !ringActive;
  // Only a ring makes the camera itself tappable
  video.parentElement?.classList.toggle('vto-pickable', ringActive);
}

// Camera-space tap → the centred, Y-up space the engine works in. The wrapper is
// what engine.resize() was given, so its rect and engine.width/height agree.
function viewportTapToEngine(event) {
  const wrapper = video.parentElement;
  if (!wrapper) return null;
  const rect = wrapper.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: (event.clientX - rect.left) - rect.width / 2,
    y: -((event.clientY - rect.top) - rect.height / 2),
  };
}

function handleViewportTap(event) {
  if (!cameraOn || !hasActiveRing()) return;

  const point = viewportTapToEngine(event);
  if (!point) return;

  const key = engine.pickFingerAt(point.x, point.y);
  if (!key) {
    showNotification('Tap directly on the finger you want to wear the ring');
    return;
  }
  chooseFinger(key);
}

function getButton(id) {
  return jewelleryControls.querySelector(`[data-id="${id}"]`);
}

// Locks or unlocks the whole jewellery panel
function setJewelleryEnabled(enabled) {
  const buttons = jewelleryControls.querySelectorAll('.jewellery-btn');
  for (const btn of buttons) {
    if (btn.classList.contains('unavailable')) continue;
    // A button mid-download belongs to toggleJewellery until its load settles
    if (btn.classList.contains('loading')) continue;

    btn.classList.toggle('locked', !enabled);
    // Marked disabled for assistive technology, but NOT with the `disabled` attribute, and…
    btn.setAttribute('aria-disabled', String(!enabled));
    btn.title = enabled ? '' : CAMERA_OFF_MESSAGE;
  }
  jewelleryControls.classList.toggle('locked', !enabled);
}

function setButtonState(btn, state) {
  btn.classList.remove('active', 'loading');
  if (state === 'on') btn.classList.add('active');
  if (state === 'loading') btn.classList.add('loading');
}

function syncTrackerNeeds() {
  const need = engine.requiredTrackers();
  tracker.setNeeds(need);

  // Start pulling the models we're about to need
  const keys = ['face', 'hands', 'pose'].filter((k) => need[k]);
  tracker.warmup(keys.length ? keys : ['face']);
}

// Turns one piece of jewellery off, everywhere
function deactivateItem(id) {
  if (!id) return;
  engine.deactivate(id);
  activeIds.delete(id);
  for (const [category, active] of activeByCategory) {
    if (active.id === id) activeByCategory.delete(category);
  }
  const btn = getButton(id);
  if (btn) setButtonState(btn, 'off');
}

/** Only one product on-camera at a time (necklace + earring must not stack). */
function clearAllJewellery() {
  for (const id of [...activeIds]) {
    deactivateItem(id);
  }
  pendingByCategory.clear();
  try {
    engine.hideAll();
  } catch (_) {
    // engine may not be ready yet
  }
  syncFingerPicker();
}

async function toggleJewellery(item, btn) {
  if (btn.classList.contains('loading')) return;

  // The camera rule is enforced HERE, not by disabling the button — see…
  if (!cameraOn) {
    showNotification(CAMERA_OFF_MESSAGE);
    // Draw the eye to the control that unblocks them
    btnStart.focus({ preventScroll: true });
    btnStart.classList.remove('nudge');
    void btnStart.offsetWidth;
    btnStart.classList.add('nudge');
    return;
  }

  // OFF
  if (activeIds.has(item.id)) {
    pendingByCategory.delete(item.category);
    deactivateItem(item.id);
    syncTrackerNeeds();
    syncFingerPicker();
    showNotification(`${item.label} OFF`);
    window.__vtoTuner?.refresh();
    return;
  }

  // ON — remove every other piece first (cross-category)
  clearAllJewellery();
  selectedProduct = item;
  pendingAutoItemId = '';

  const token = ++requestSeq;
  pendingByCategory.set(item.category, token);
  const superseded = () => (
    pendingByCategory.get(item.category) !== token
    || (selectedProduct && selectedProduct.id !== item.id)
  );

  // Marked busy with a class and aria-busy, NOT with the `disabled` attribute
  setButtonState(btn, 'loading');
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = 'Loading…';
  showLoading(`Loading ${item.label}…`);

  try {
    const template = await engine.loadJewellery(
      item.id,
      item.folder,
      item.modelFile,
      item.category,
      (fraction) => showLoading(`Loading ${item.label}… ${Math.round(fraction * 100)}%`),
    );

    if (superseded()) {
      // The user changed their mind while this was downloading
      setButtonState(btn, 'off');
      return;
    }

    // Ensure nothing else snuck on during the download
    clearAllJewellery();
    pendingByCategory.set(item.category, token);

    engine.activate(item.id, template);
    activeIds.add(item.id);
    activeByCategory.set(item.category, item);
    setButtonState(btn, 'on');
    syncTrackerNeeds();
    syncFingerPicker();
    showNotification(`${item.label} ON`);
    window.__vtoTuner?.refresh();
  } catch (err) {
    console.error('[Load] failed for', item.folder, err);
    setButtonState(btn, 'off');
    showNotification(`Could not load ${item.label}. Please try another piece.`);
  } finally {
    if (pendingByCategory.get(item.category) === token) {
      pendingByCategory.delete(item.category);
    }
    hideLoading();
    btn.textContent = item.label;
    btn.removeAttribute('aria-busy');
    // If the camera was stopped while this was downloading
    btn.classList.toggle('locked', !cameraOn);
    btn.setAttribute('aria-disabled', String(!cameraOn));
  }
}

// Camera + loops

async function startCamera() {
  try {
    setTrackingUI('Starting camera…', 'loading');

    // Every camera session starts on the third finger, whatever the last one
    // ended on. stopCamera() resets too, so this only matters for a session that
    // never got a clean stop.
    engine.resetRingFinger();
    syncFingerPicker();

    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) {
      await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
    }

    video.style.display = 'block';
    placeholder.classList.add('hidden');

    btnStart.disabled = true;
    btnStop.disabled = false;
    btnScreenshot.disabled = false;

    cameraOn = true;
    setJewelleryEnabled(true);

    // Tracking failing must not take the camera preview down with it — the models download lazily
    if (!tracker.ready) {
      try {
        await tracker.init();
      } catch (err) {
        console.error('[Tracker] init failed', err);
        showNotification(tracker.lastError || 'AI tracking could not start.');
      }
    }

    running = true;
    resizeViewport();
    syncTrackerNeeds();
    setTrackingUI(tracker.ready ? 'Camera Ready' : 'Tracking unavailable',
      tracker.ready ? 'tracking' : 'offline');

    renderLoop();
    trackingPump();

    // Phone/Live Link: give the jewellery buttons a tick to settle, then auto-wear.
    await maybeAutoSelectJewellery();
  } catch (err) {
    console.error('[Camera] start failed', err);
    setTrackingUI('Camera permission denied', 'offline');
    showNotification('Unable to access camera. Please allow camera permission.');
  }
}

function findCatalogueItem(idOrFolder) {
  if (!idOrFolder) return null;
  const key = String(idOrFolder).toLowerCase();
  return catalogue.find((c) => (
    c.available
    && (c.id.toLowerCase() === key || c.folder.toLowerCase() === key)
  )) || null;
}

async function maybeAutoSelectJewellery() {
  const wanted = pendingAutoItemId;
  if (!wanted || !cameraOn) return;

  // Retry a few times — on phones the button row can lag one frame behind.
  let item = null;
  let btn = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    item = findCatalogueItem(wanted);
    if (item) btn = getButton(item.id);
    if (item && btn) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  if (!item) {
    console.warn('[AutoSelect] no catalogue item for', wanted);
    return;
  }
  if (!btn) {
    console.warn('[AutoSelect] button missing for', item.id);
    return;
  }
  if (activeIds.has(item.id)) {
    pendingAutoItemId = '';
    return;
  }

  pendingAutoItemId = '';
  showNotification(`Trying on ${item.label}…`);
  await toggleJewellery(item, btn);
}

function stopCamera() {
  running = false;
  cameraOn = false;
  setJewelleryEnabled(false);
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;

  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  video.srcObject = null;
  video.style.display = 'none';
  placeholder.classList.remove('hidden');

  btnStart.disabled = false;
  btnStop.disabled = true;
  btnScreenshot.disabled = true;

  tracker.reset();
  latestTracking = null;
  engine.hideAll();
  // Back to the third finger — the selection is not carried across a restart
  engine.resetRingFinger();
  syncFingerPicker();
  engine.render();
  setTrackingUI('Camera off', 'offline');
}

// Rendering runs on its own rAF loop, independent of tracking
function renderLoop() {
  if (!running) return;
  rafId = requestAnimationFrame(renderLoop);
  try {
    engine.update(latestTracking);
    engine.render();
  } catch (err) {
    console.error('[Render] frame failed', err);
  }
}

// Tracking runs as fast as it can, and never blocks rendering
async function trackingPump() {
  while (running) {
    try {
      latestTracking = await tracker.processFrame(video);

      const activeCategories = [...activeByCategory.values()].map((i) => i.category);

      let label;
      let state;
      if (!tracker.ready) {
        label = 'Tracking unavailable';
        state = 'offline';
      } else if (!tracker.warm && activeCategories.length) {
        // First frame is still downloading the WASM + model files
        label = 'Loading AI model…';
        state = 'loading';
      } else {
        label = getTrackingLabel(latestTracking, activeCategories);
        state = label === 'Camera off' ? 'offline'
          : (label.startsWith('Tracking') || label === 'Camera Ready') ? 'tracking'
          : 'loading';
      }
      setTrackingUI(label, state);
    } catch (err) {
      console.warn('[Tracking] frame failed', err);
    }
    await nextFrame();
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// Saves the camera frame and the jewellery as one image
function captureScreenshot() {
  if (!running || video.readyState < 2) return;

  let composite;
  try {
    composite = engine.captureComposite(video);
  } catch (err) {
    console.error('[Screenshot] compositing failed', err);
    showNotification('Could not save the photo. Please try again.');
    return;
  }

  const filename = `jewellery-tryon-${Date.now()}.png`;

  const deliver = (blob) => {
    if (!blob) {
      showNotification('Could not save the photo. Please try again.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';

    // iOS Safari has never supported the download attribute
    const canDownload = 'download' in link && !isIOS();
    if (!canDownload) link.target = '_blank';

    document.body.appendChild(link);
    link.click();
    link.remove();

    // Give the browser time to start reading the blob before releasing it
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showNotification(canDownload ? 'Screenshot saved' : 'Photo ready — press and hold to save it');
  };

  if (typeof composite.toBlob === 'function') {
    composite.toBlob(deliver, 'image/png');
  } else {
    // Very old WebViews:
    const link = document.createElement('a');
    link.download = filename;
    link.href = composite.toDataURL('image/png');
    link.click();
    showNotification('Screenshot saved');
  }
}

function isIOS() {
  const ua = navigator.userAgent || '';
  // iPadOS 13+ reports itself as a Mac, and is told apart by touch support
  return /iPad|iPhone|iPod/.test(ua)
    || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// Boot

async function init() {
  resizeViewport();
  window.addEventListener('resize', resizeViewport);
  window.addEventListener('orientationchange', () => setTimeout(resizeViewport, 250));
  video.addEventListener('loadedmetadata', resizeViewport);

  // The wrapper is sized by aspect-ratio and a max-width
  if (window.ResizeObserver && video.parentElement) {
    new ResizeObserver(() => resizeViewport()).observe(video.parentElement);
  }

  btnStart.addEventListener('click', () => {
    startCamera().catch((err) => console.error('[Camera] start handler', err));
  });
  btnStop.addEventListener('click', stopCamera);
  btnScreenshot.addEventListener('click', captureScreenshot);

  // "Tap the finger you want" — the overlay canvas keeps pointer-events:none, so
  // the tap lands on the wrapper and the engine hit-tests it against the
  // landmarks it is already tracking.
  buildFingerPicker();
  video.parentElement?.addEventListener('click', handleViewportTap);

  setTrackingUI('Camera off', 'offline');
  await discoverCatalogue();
  buildJewelleryUI();
  // Nothing can be tried on until there is a face or a hand to track
  setJewelleryEnabled(false);

  // Deep-link / product flow: remind that Start Camera triggers auto-select.
  if (pendingAutoItemId && currentView === 'tryon') {
    const pref = findCatalogueItem(pendingAutoItemId);
    if (pref) {
      showNotification(`Tap Start Camera to try on ${pref.label}`);
      if (btnStart) {
        btnStart.setAttribute(
          'aria-label',
          `Start Camera and try on ${pref.label}`,
        );
      }
      preloadBootItem(pref).catch((err) => console.warn('[Preload]', err));
    }
  }

  if (new URLSearchParams(location.search).has('tune')) {
    const { createTuner } = await import('vto/tuning.js');
    window.__vtoTuner = createTuner(engine, () => [...activeByCategory.values()]);
  }
}

async function preloadBootItem(item) {
  if (!item?.available || !item.modelFile) return;
  try {
    showLoading(`Preparing ${item.label}…`);
    await engine.loadJewellery(
      item.id,
      item.folder,
      item.modelFile,
      item.category,
      (fraction) => showLoading(`Preparing ${item.label}… ${Math.round(fraction * 100)}%`),
    );
  } finally {
    hideLoading();
  }
}

init();