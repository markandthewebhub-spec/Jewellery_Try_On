// "vto/" specifiers, not relative paths — see the import map in index.html.
import { MediaPipeTracker, getTrackingLabel } from 'vto/mediapipe.js';
import {
  Engine3D,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
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
// The jewellery UI is inert until the camera is live.
let cameraOn = false;
let rafId = null;
let catalogue = [];
let latestTracking = null;
let lastLabel = '';
const activeByCategory = new Map();
const activeIds = new Set();

// In-flight load per category, identified by a monotonic token.
const pendingByCategory = new Map();
let requestSeq = 0;

let notificationTimer = null;

injectNotificationStyles();

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
      padding: 0.75rem 1.5rem;
      background: rgba(20, 20, 20, 0.92);
      border: 1px solid rgba(212, 175, 55, 0.45);
      border-radius: 14px;
      color: #F5F0E8;
      font-family: 'Poppins', sans-serif;
      font-size: 0.875rem;
      letter-spacing: 0.03em;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 24px rgba(212,175,55,0.15);
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
      `[Catalogue] no model found in: ${missing.join(', ')}\n` +
      'Drop a model.obj into objects/<folder>/ to enable those buttons.',
    );
  }
}

// Groups whatever was discovered, in a stable order.
function groupCatalogue() {
  const seen = new Set(catalogue.map((c) => c.category));
  return CATEGORY_ORDER
    .filter((key) => seen.has(key))
    .map((key) => ({
      key,
      title: CATEGORY_LABELS[key] || key,
      items: catalogue.filter((c) => c.category === key),
    }));
}

function buildJewelleryUI() {
  jewelleryControls.innerHTML = '';

  for (const cat of groupCatalogue()) {
    const items = cat.items;
    if (!items.length) continue;

    const group = document.createElement('div');
    group.className = 'jewellery-group';

    const title = document.createElement('h2');
    title.className = 'group-title';
    title.textContent = cat.title;
    group.appendChild(title);

    const buttons = document.createElement('div');
    buttons.className = 'jewellery-buttons';

    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'jewellery-btn';
      btn.textContent = item.label;
      btn.dataset.id = item.id;
      btn.dataset.category = item.category;
      btn.setAttribute('aria-label', `Toggle ${item.label}`);

      if (!item.available) {
        btn.classList.add('unavailable');
        btn.disabled = true;
        btn.title = `No model in objects/${item.folder}/`;
        btn.setAttribute('aria-label', `${item.label} — no model file yet`);
      } else {
        btn.addEventListener('click', () => toggleJewellery(item, btn));
      }

      buttons.appendChild(btn);
    }

    group.appendChild(buttons);
    jewelleryControls.appendChild(group);
  }
}

function getButton(id) {
  return jewelleryControls.querySelector(`[data-id="${id}"]`);
}

// Locks or unlocks the whole jewellery panel.
function setJewelleryEnabled(enabled) {
  const buttons = jewelleryControls.querySelectorAll('.jewellery-btn');
  for (const btn of buttons) {
    if (btn.classList.contains('unavailable')) continue;
    // A button mid-download belongs to toggleJewellery until its load settles;
    // its own `finally` hands it back in whatever state the camera is then in.
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

  // Start pulling the models we're about to need, so the first tracked frame
  // isn't the one that pays for the download.
  const keys = ['face', 'hands', 'pose'].filter((k) => need[k]);
  tracker.warmup(keys.length ? keys : ['face']);
}

// Turns one piece of jewellery off, everywhere.
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

async function toggleJewellery(item, btn) {
  if (btn.classList.contains('loading')) return;

  // The camera rule is enforced HERE, not by disabling the button — see…
  if (!cameraOn) {
    showNotification(CAMERA_OFF_MESSAGE);
    // Draw the eye to the control that unblocks them.
    btnStart.focus({ preventScroll: true });
    btnStart.classList.remove('nudge');
    void btnStart.offsetWidth;
    btnStart.classList.add('nudge');
    return;
  }

  // OFF
  if (activeIds.has(item.id)) {
    // Cancel any load still in flight for this category, so a slow download
    // started earlier cannot come back and switch something on after the
    // user has just switched it off.
    pendingByCategory.delete(item.category);
    deactivateItem(item.id);
    syncTrackerNeeds();
    showNotification(`${item.label} OFF`);
    window.__vtoTuner?.refresh();
    return;
  }

  // ON

  // Only one item per category at a time.
  deactivateItem(activeByCategory.get(item.category)?.id);

  // A token identifying THIS request, so a load that finishes after the user has moved on…
  const token = ++requestSeq;
  pendingByCategory.set(item.category, token);
  const superseded = () => pendingByCategory.get(item.category) !== token;

  // Marked busy with a class and aria-busy, NOT with the `disabled` attribute.
  setButtonState(btn, 'loading');
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = 'Loading…';
  showLoading(`Loading ${item.label}…`);

  try {
    const template = await engine.loadJewellery(
      item.id,
      item.folder,
      item.objFile,
      item.category,
      (fraction) => showLoading(`Loading ${item.label}… ${Math.round(fraction * 100)}%`),
    );

    if (superseded()) {
      // The user changed their mind while this was downloading.
      // stays in the cache, so choosing it again is instant.
      setButtonState(btn, 'off');
      return;
    }

    engine.activate(item.id, template);
    activeIds.add(item.id);
    activeByCategory.set(item.category, item);
    setButtonState(btn, 'on');
    syncTrackerNeeds();
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
    // If the camera was stopped while this was downloading, hand the button
    // back locked rather than live.
    btn.classList.toggle('locked', !cameraOn);
    btn.setAttribute('aria-disabled', String(!cameraOn));
  }
}

// Camera + loops

async function startCamera() {
  try {
    setTrackingUI('Starting camera…', 'loading');

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

    // Tracking failing must not take the camera preview down with it — the
    // models download lazily, so this only throws if the CDN scripts are
    // genuinely missing.
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
  } catch (err) {
    console.error('[Camera] start failed', err);
    setTrackingUI('Camera permission denied', 'offline');
    showNotification('Unable to access camera. Please allow camera permission.');
  }
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
  engine.render();
  setTrackingUI('Camera off', 'offline');
}

// Rendering runs on its own rAF loop, independent of tracking.
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

// Tracking runs as fast as it can, and never blocks rendering.
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
        // First frame is still downloading the WASM + model files.
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

// Saves the camera frame and the jewellery as one image.
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

    // iOS Safari has never supported the download attribute.
    const canDownload = 'download' in link && !isIOS();
    if (!canDownload) link.target = '_blank';

    document.body.appendChild(link);
    link.click();
    link.remove();

    // Give the browser time to start reading the blob before releasing it.
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
  // iPadOS 13+ reports itself as a Mac, and is told apart by touch support.
  return /iPad|iPhone|iPod/.test(ua)
    || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// Boot

async function init() {
  resizeViewport();
  window.addEventListener('resize', resizeViewport);
  window.addEventListener('orientationchange', () => setTimeout(resizeViewport, 250));
  video.addEventListener('loadedmetadata', resizeViewport);

  // The wrapper is sized by aspect-ratio and a max-width, so it can change
  // without the window doing so — late webfonts, the mobile URL bar sliding
  // away, a scrollbar appearing.
  // mapping is wrong and everything sits slightly off.
  if (window.ResizeObserver && video.parentElement) {
    new ResizeObserver(() => resizeViewport()).observe(video.parentElement);
  }

  btnStart.addEventListener('click', startCamera);
  btnStop.addEventListener('click', stopCamera);
  btnScreenshot.addEventListener('click', captureScreenshot);

  setTrackingUI('Camera off', 'offline');
  await discoverCatalogue();
  buildJewelleryUI();
  // Nothing can be tried on until there is a face or a hand to track.
  setJewelleryEnabled(false);

  if (new URLSearchParams(location.search).has('tune')) {
    const { createTuner } = await import('vto/tuning.js');
    window.__vtoTuner = createTuner(engine, () => [...activeByCategory.values()]);
  }
}

init();