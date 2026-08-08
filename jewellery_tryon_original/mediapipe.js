// Landmark smoothing, adaptive: heavy while a point is still, light while it
// moves. A single fixed rate has to choose between jitter and lag; letting each
// point pick its own by how fast it is actually travelling avoids the trade.
const SMOOTH_LANDMARK_MIN = 0.42;
const SMOOTH_LANDMARK_MAX = 0.94;

// Movement per frame, in normalised units, that counts as "moving fast".
const SMOOTH_LANDMARK_SPEED = 0.012;

// Longest edge of the frame handed to MediaPipe, in pixels.
const TRACK_MAX_DIM = 480;

// How long a single solution may take before we give up on this frame.
const FRAME_TIMEOUT_MS = 1600;

// The very first frame also downloads several MB of WASM and model data, which on a…
const WARMUP_TIMEOUT_MS = 60000;

// If a solution never settles, `_busy` would stay stuck forever and tracking would…
const STALL_RESET_MS = 8000;

// How many consecutive misses before we declare tracking lost and let the jewellery…
const MISS_GRACE = 10;

// The same, for ONE slot losing its hand while the detector still sees others.
// One frame, i.e. no hold at all: the detector was asked for two hands and
// returned fewer, so there is nothing left to hold on to. See _slot.
const SLOT_DROP_GRACE = 1;

// How many frames of agreement before a hand's handedness is considered settled.
const HANDEDNESS_VOTES = 12;

// How far a wrist may have moved between two tracking frames and still be considered…
const SLOT_MATCH_RADIUS = 0.32;

// Pose runs at a fraction of the tracking rate.
const POSE_EVERY_N_FRAMES = 4;

// MediaPipe's own documentation:
const HANDEDNESS_LABEL_ASSUMES_MIRROR = true;

// Pinned to the newest published build of each package.
export const MP_VERSION = {
  face: '0.4.1633559619',
  hands: '0.4.1675469240',
  pose: '0.5.1675469404',
};

const CDN = {
  face: `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@${MP_VERSION.face}`,
  hands: `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${MP_VERSION.hands}`,
  pose: `https://cdn.jsdelivr.net/npm/@mediapipe/pose@${MP_VERSION.pose}`,
};

export class MediaPipeTracker {
  constructor() {
    this.faceMesh = null;
    this.hands = null;
    this.pose = null;
    this.ready = false;

    // Which solutions actually initialised.
    this.available = { face: false, hands: false, pose: false };

    // Which solutions the current selection needs.
    this.needs = { face: true, hands: false, pose: false };
    this.handCount = 1;

    this.face = null;
    this.poseLm = null;
    this.leftHand = null;
    this.rightHand = null;

    // Which PHYSICAL hand currently occupies each slot:
    this.leftHandIsRight = null;
    this.rightHandIsRight = null;
    this._handVote = {
      left: { yes: 0, seen: 0, latched: null },
      right: { yes: 0, seen: 0, latched: null },
    };

    // Last wrist position each slot held, in normalised image coordinates.
    this._slotAnchor = {
      left: { x: 0, y: 0, live: false },
      right: { x: 0, y: 0, live: false },
    };

    // Frame counter, used to run Pose at a lower rate than the rest.
    this._frameNo = 0;

    this.trackingFace = false;
    this.trackingHands = false;
    this.trackingPose = false;

    this._miss = { face: 0, hands: 0, pose: 0, left: 0, right: 0 };
    this._resolvers = { face: null, hands: null, pose: null };
    this._fails = { face: 0, hands: 0, pose: 0 };
    this._warmed = { face: false, hands: false, pose: false };
    // Warmup ACTUALLY finished, as opposed to merely having been started.
    this._loaded = { face: false, hands: false, pose: false };
    this._busy = false;
    this._busySince = 0;

    // Reused downscale target — see TRACK_MAX_DIM.
    this._scratch = null;
    this._scratchCtx = null;

    // True once a frame has completed end to end.
    this.warm = false;
    this.lastError = null;
  }

  // Builds the solutions but does NOT download their models yet.
  async init() {
    const missing = [];
    if (typeof FaceMesh === 'undefined') missing.push('face_mesh.js');
    if (typeof Hands === 'undefined') missing.push('hands.js');
    if (typeof Pose === 'undefined') missing.push('pose.js');

    if (missing.length === 3) {
      this.lastError =
        `MediaPipe scripts did not load (${missing.join(', ')}). ` +
        'Check the connection to cdn.jsdelivr.net.';
      throw new Error(this.lastError);
    }
    if (missing.length) console.warn('[Tracker] missing MediaPipe bundles:', missing);

    if (typeof FaceMesh !== 'undefined') {
      this.faceMesh = new FaceMesh({ locateFile: (f) => `${CDN.face}/${f}` });
      this.faceMesh.setOptions({
        maxNumFaces: 1,
        // Kept off: the extra iris points push the count from 468 to 478 and
        // buy nothing here, while costing real CPU time.
        refineLandmarks: false,
        minDetectionConfidence: 0.5,
        // Lower than the detection threshold on purpose.
        minTrackingConfidence: 0.35,
      });
      this.faceMesh.onResults((r) => this._onFace(r));
      this.available.face = true;
    }

    if (typeof Hands !== 'undefined') {
      this.hands = new Hands({ locateFile: (f) => `${CDN.hands}/${f}` });
      this.hands.setOptions({
        maxNumHands: this.handCount,
        modelComplexity: 0,
        minDetectionConfidence: 0.5,
        // Same asymmetry as FaceMesh:
        // than it took to acquire it.
        minTrackingConfidence: 0.35,
      });
      this.hands.onResults((r) => this._onHands(r));
      this.available.hands = true;
    }

    if (typeof Pose !== 'undefined') {
      this.pose = new Pose({ locateFile: (f) => `${CDN.pose}/${f}` });
      this.pose.setOptions({
        modelComplexity: 0,
        // Pose's own temporal filter.
        // smooths again: it is applied before the landmarks are downsampled by
        // the throttle, so it suppresses noise this side would never see.
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.35,
      });
      this.pose.onResults((r) => this._onPose(r));
      this.available.pose = true;
    }

    this.ready = true;
    console.log('[Tracker] solutions created (models load on first use)', this.available);
  }

  // Starts downloading a solution's model in the background.
  warmup(keys = ['face']) {
    for (const key of keys) {
      const solution = this._solution(key);
      if (!solution || this._warmed[key]) continue;
      this._warmed[key] = true;
      try {
        Promise.resolve(solution.initialize())
          .then(() => { this._loaded[key] = true; })
          .catch((err) => {
            // Let it be retried by a later send rather than disabling it.
            this._warmed[key] = false;
            console.warn(`[Tracker] ${key} warmup failed (will retry on use)`, err);
          });
      } catch (err) {
        this._warmed[key] = false;
        console.warn(`[Tracker] ${key} warmup threw`, err);
      }
    }
  }

  _solution(key) {
    if (key === 'face') return this.faceMesh;
    if (key === 'hands') return this.hands;
    if (key === 'pose') return this.pose;
    return null;
  }

  // Tell the tracker which solutions the active jewellery actually needs.
  setNeeds(needs) {
    this.needs = {
      face: !!needs.face,
      hands: !!needs.hands,
      pose: !!needs.pose,
    };
    if (!this.needs.face) this._clear('face');
    if (!this.needs.hands) this._clear('hands');
    if (!this.needs.pose) this._clear('pose');

    // Paired bracelets need both wrists; everything else runs cheaper on one.
    const want = needs.handCount === 2 ? 2 : 1;
    if (want !== this.handCount) {
      this.handCount = want;
      if (this.hands && this.available.hands) {
        try {
          this.hands.setOptions({ maxNumHands: want });
        } catch (err) {
          console.warn('[Tracker] could not change maxNumHands', err);
        }
      }
    }
  }

  _clear(key) {
    if (key === 'face') { this.face = null; this.trackingFace = false; }
    if (key === 'hands') {
      this.leftHand = null;
      this.rightHand = null;
      this.leftHandIsRight = null;
      this.rightHandIsRight = null;
      this._handVote.left = { yes: 0, seen: 0, latched: null };
      this._handVote.right = { yes: 0, seen: 0, latched: null };
      this._slotAnchor.left.live = false;
      this._slotAnchor.right.live = false;
      this.trackingHands = false;
      this._miss.left = this._miss.right = 0;
    }
    if (key === 'pose') { this.poseLm = null; this.trackingPose = false; }
    this._miss[key] = 0;
  }

  _smooth(prev, next) {
    if (!next || !next.length) return null;
    if (!prev || prev.length !== next.length) {
      return next.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z || 0, visibility: lm.visibility }));
    }
    const out = new Array(next.length);
    for (let i = 0; i < next.length; i++) {
      const p = prev[i];
      const n = next[i];
      const dx = n.x - p.x;
      const dy = n.y - p.y;
      const dz = (n.z || 0) - (p.z || 0);

      const speed = Math.hypot(dx, dy);
      const t = speed >= SMOOTH_LANDMARK_SPEED ? 1 : speed / SMOOTH_LANDMARK_SPEED;
      const k = SMOOTH_LANDMARK_MIN + (SMOOTH_LANDMARK_MAX - SMOOTH_LANDMARK_MIN) * t;

      out[i] = {
        x: p.x + dx * k,
        y: p.y + dy * k,
        z: (p.z || 0) + dz * k,
        visibility: n.visibility,
      };
    }
    return out;
  }

  _onFace(results) {
    this._fails.face = 0; // results came back, so the solution is alive
    const raw = results?.multiFaceLandmarks?.[0];
    if (raw && raw.length) {
      this.face = this._smooth(this.face, raw);
      this.trackingFace = true;
      this._miss.face = 0;
    } else if (++this._miss.face >= MISS_GRACE) {
      this.face = null;
      this.trackingFace = false;
    }
    this._resolve('face');
  }

  _onHands(results) {
    this._fails.hands = 0;
    const list = results?.multiHandLandmarks;

    if (!list || !list.length) {
      if (++this._miss.hands >= MISS_GRACE) {
        this.leftHand = null;
        this.rightHand = null;
        this.trackingHands = false;
      }
      // Let each slot run down its OWN grace period rather than expiring them immediately.
      this._miss.left = Math.min(this._miss.left + 1, MISS_GRACE);
      this._miss.right = Math.min(this._miss.right + 1, MISS_GRACE);
      if (this._miss.left >= MISS_GRACE) {
        this.leftHand = null;
        this._slotAnchor.left.live = false;
      }
      if (this._miss.right >= MISS_GRACE) {
        this.rightHand = null;
        this._slotAnchor.right.live = false;
      }
      this.leftHandIsRight = this._latchHandedness('left', this.leftHand, null);
      this.rightHandIsRight = this._latchHandedness('right', this.rightHand, null);
      this._resolve('hands');
      return;
    }

    this._miss.hands = 0;
    this.trackingHands = true;

    // "left"/"right" here are purely SLOT NAMES with no anatomical meaning.
    // All a slot has to do is keep hold of the same physical hand from frame
    // to frame. Real handedness travels separately, in `isRight`.
    const detections = [];
    for (let i = 0; i < list.length; i++) {
      const landmarks = list[i];
      if (!landmarks || !landmarks.length) continue;
      const reported = results.multiHandedness?.[i]?.label;
      const known = reported === 'Left' || reported === 'Right';
      const saysRight = reported === 'Right';
      detections.push({
        landmarks,
        isRight: known
          ? (HANDEDNESS_LABEL_ASSUMES_MIRROR ? !saysRight : saysRight)
          : null,
        x: landmarks[0]?.x ?? 0.5,
        y: landmarks[0]?.y ?? 0.5,
      });
    }

    const slots = this._assignSlots(detections);

    this.leftHand = this._slot('left', 'leftHand', slots.left?.landmarks || null);
    this.rightHand = this._slot('right', 'rightHand', slots.right?.landmarks || null);

    this.leftHandIsRight = this._latchHandedness('left', this.leftHand, slots.left?.isRight ?? null);
    this.rightHandIsRight = this._latchHandedness('right', this.rightHand, slots.right?.isRight ?? null);

    this._resolve('hands');
  }

  // Decides which detected hand belongs in which slot, by CONTINUITY.
  _assignSlots(detections) {
    const out = { left: null, right: null };
    if (!detections.length) return out;

    const taken = new Set();

    // 1. Continuity — pair slots to detections BEST MATCH FIRST, across every
    //    pair at once. Walking the slots in a fixed order instead lets whichever
    //    is checked first claim a hand that plainly belongs to the other, and
    //    the loser then falls back on a held copy of the hand it just lost.
    const pairs = [];
    for (const key of ['left', 'right']) {
      const last = this._slotAnchor[key];
      if (!last.live) continue;
      for (let i = 0; i < detections.length; i++) {
        const d = Math.hypot(detections[i].x - last.x, detections[i].y - last.y);
        if (d <= SLOT_MATCH_RADIUS) pairs.push({ key, i, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);

    for (const pair of pairs) {
      if (out[pair.key] || taken.has(pair.i)) continue;
      out[pair.key] = detections[pair.i];
      taken.add(pair.i);
    }

    // 2. Anything left over is a newly appeared hand and goes to a free slot.
    const free = ['left', 'right'].filter((k) => !out[k]);
    const fresh = detections
      .map((d, i) => ({ d, i }))
      .filter(({ i }) => !taken.has(i))
      .sort((a, b) => a.d.x - b.d.x);

    for (let i = 0; i < fresh.length && i < free.length; i++) {
      out[free[i]] = fresh[i].d;
    }

    // Remember where each slot's hand was, for next frame's matching.
    for (const key of ['left', 'right']) {
      if (out[key]) {
        this._slotAnchor[key].x = out[key].x;
        this._slotAnchor[key].y = out[key].y;
        this._slotAnchor[key].live = true;
      }
    }

    return out;
  }

  // Settles a hand's handedness ONCE and then holds it.
  _latchHandedness(key, landmarks, observed) {
    const vote = this._handVote[key];

    if (!landmarks) {
      vote.yes = 0;
      vote.seen = 0;
      vote.latched = null;
      return null;
    }

    if (vote.latched !== null) return vote.latched;

    if (observed === true || observed === false) {
      vote.seen++;
      if (observed === true) vote.yes++;
    }
    if (!vote.seen) return null;

    const majority = vote.yes * 2 >= vote.seen;
    if (vote.seen >= HANDEDNESS_VOTES) vote.latched = majority;

    // Before the vote settles, report the running majority so the ring is
    // oriented sensibly from the first frame rather than waiting a second.
    return majority;
  }

  // Only ever reached when the detector DID return hands. So a slot with no
  // detection here has genuinely lost its hand, rather than the whole frame
  // having failed — and it gets a much shorter reprieve. Holding a copy of a
  // departed hand for the full grace period leaves it sitting on top of the
  // hand that is still there, which is what put two bangles on one wrist.
  _slot(key, prop, landmarks) {
    if (landmarks) {
      this._miss[key] = 0;
      return this._smooth(this[prop], landmarks);
    }
    if (++this._miss[key] >= SLOT_DROP_GRACE) {
      this._slotAnchor[key].live = false;
      return null;
    }
    return this[prop];
  }

  _onPose(results) {
    this._fails.pose = 0;
    const raw = results?.poseLandmarks;
    if (raw && raw.length) {
      this.poseLm = this._smooth(this.poseLm, raw);
      this.trackingPose = true;
      this._miss.pose = 0;
    } else if (++this._miss.pose >= MISS_GRACE) {
      this.poseLm = null;
      this.trackingPose = false;
    }
    this._resolve('pose');
  }

  _resolve(key) {
    const fn = this._resolvers[key];
    this._resolvers[key] = null;
    if (fn) fn();
  }

  // Sends one frame to one solution.
  _send(key, image) {
    const solution = this._solution(key);
    this._warmed[key] = true;
    return new Promise((resolve) => {
      // Release any waiter left over from a previous frame before taking the
      // slot. Overwriting it silently would strand that promise, and the
      // Promise.all built on it would never settle.
      this._resolve(key);
      this._resolvers[key] = resolve;
      try {
        const p = solution.send({ image });
        if (p && typeof p.then === 'function') {
          // onResults normally settles this first; these are the safety nets
          // for the case where it never fires at all.
          p.then(() => this._resolve(key), (err) => this._sendFailed(key, err));
        }
      } catch (err) {
        this._sendFailed(key, err);
      }
    });
  }

  _sendFailed(key, err) {
    if (++this._fails[key] >= 5) {
      this.available[key] = false;
      console.error(`[Tracker] ${key} failed ${this._fails[key]}x — disabling it`, err);
    } else {
      console.warn(`[Tracker] ${key} send failed (${this._fails[key]}/5)`, err);
    }
    this._resolve(key);
  }

  // Processes one frame.
  // Shrinks the frame the models are given, preserving aspect ratio so the normalised…
  _trackingFrame(video) {
    if (!TRACK_MAX_DIM) return video;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return video;

    const ratio = TRACK_MAX_DIM / Math.max(vw, vh);
    if (ratio >= 1) return video;

    const w = Math.round(vw * ratio);
    const h = Math.round(vh * ratio);

    if (!this._scratch) {
      this._scratch = document.createElement('canvas');
      this._scratchCtx = this._scratch.getContext('2d', { alpha: false });
    }
    if (this._scratch.width !== w || this._scratch.height !== h) {
      this._scratch.width = w;
      this._scratch.height = h;
    }

    try {
      this._scratchCtx.drawImage(video, 0, 0, w, h);
    } catch {
      return video;   // e.g. the frame isn't decodable yet
    }
    return this._scratch;
  }

  async processFrame(video) {
    if (!this.ready || !video || video.readyState < 2) return this.getTracking();

    if (this._busy) {
      if (Date.now() - this._busySince < STALL_RESET_MS) return this.getTracking();
      // A solution went away and never called back.
      // rather than letting tracking sit frozen for the rest of the session.
      console.warn('[Tracker] a solution stalled — abandoning that frame');
      this._busy = false;
      this._resolvers = { face: null, hands: null, pose: null };
    }

    const image = this._trackingFrame(video);
    this._frameNo++;

    // Pose is sampled at a fraction of the rate — see POSE_EVERY_N_FRAMES.
    // Pose additionally waits for its model to have FINISHED downloading.
    const wantPose = this.needs.pose && this.available.pose && this.pose
      && this._loaded.pose
      && this._frameNo % POSE_EVERY_N_FRAMES === 0;

    const jobs = [];
    if (this.needs.face && this.available.face && this.faceMesh) jobs.push(this._send('face', image));
    if (this.needs.hands && this.available.hands && this.hands) jobs.push(this._send('hands', image));
    if (wantPose) jobs.push(this._send('pose', image));

    if (!jobs.length) return this.getTracking();

    this._busy = true;
    this._busySince = Date.now();
    const settled = Promise.all(jobs).finally(() => { this._busy = false; });

    try {
      // The first frame also pays for downloading the models, which on a
      // phone can take a while.
      // real-time budget.
      await withTimeout(settled, this.warm ? FRAME_TIMEOUT_MS : WARMUP_TIMEOUT_MS, 'frame');
      this.warm = true;
    } catch {
      // dropped frame — the next one just carries on
    }
    return this.getTracking();
  }

  getPrimaryHand() {
    return this.rightHand || this.leftHand || null;
  }

  // Handedness of whichever hand getPrimaryHand() picked.
  getPrimaryHandIsRight() {
    if (this.rightHand) return this.rightHandIsRight;
    if (this.leftHand) return this.leftHandIsRight;
    return null;
  }

  getTracking() {
    return {
      face: this.face,
      pose: this.poseLm,
      leftHand: this.leftHand,
      rightHand: this.rightHand,
      leftHandIsRight: this.leftHandIsRight,
      rightHandIsRight: this.rightHandIsRight,
      primaryHand: this.getPrimaryHand(),
      primaryHandIsRight: this.getPrimaryHandIsRight(),

      // How many consecutive detector results have MISSED each source.
      faceMiss: this._miss.face,
      leftHandMiss: this.leftHand ? this._miss.left : MISS_GRACE,
      rightHandMiss: this.rightHand ? this._miss.right : MISS_GRACE,
      primaryHandMiss: this.rightHand
        ? this._miss.right
        : (this.leftHand ? this._miss.left : MISS_GRACE),
      trackingFace: this.trackingFace,
      trackingHands: this.trackingHands,
      trackingPose: this.trackingPose,
      isTracking: this.trackingFace || this.trackingHands,
    };
  }

  reset() {
    this._clear('face');
    this._clear('hands');
    this._clear('pose');
    this._busy = false;
    this._busySince = 0;
    this._resolvers = { face: null, hands: null, pose: null };
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

export function getTrackingLabel(tracking, activeCategories) {
  if (!tracking) return 'Camera off';

  const needs = activeCategories || [];
  const needsFace = needs.some((c) => c === 'necklace' || c === 'earring');
  const needsHand = needs.some((c) => c === 'ring' || c === 'bracelet');

  if (needsFace && tracking.trackingFace) return 'Tracking Face';
  if (needsHand && tracking.trackingHands) return 'Tracking Hand';
  if (needsFace && needsHand) return 'Show face or hand';
  if (needsFace) return 'Looking for face…';
  if (needsHand) return 'Show your hand';
  return 'Camera Ready';
}