import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// MediaPipe FaceMesh / Pose / Hands landmark indices

// FaceMesh's 468 points cover the face SURFACE only — the mesh boundary stops at the… NAMING:
const FACE = {
  chin: 152,
  forehead: 10,
  noseTip: 1,

  // The side of the face, top to bottom
  rightEarLow: 93,       // anatomical RIGHT (draws screen-right when mirrored)
  leftEarLow: 323,

  rightJawAngle: 132,
  leftJawAngle: 361,

  // Face-oval widest points, used for head width rather than for the ear
  rightJaw: 234,
  leftJaw: 454,

  rightEyeOuter: 33,
  leftEyeOuter: 263,
  rightEyeInner: 133,
  leftEyeInner: 362,
  rightMouth: 61,
  leftMouth: 291,

  rightTemple: 127,
  leftTemple: 356,
};

// MediaPipe Pose
const POSE = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
};

// The two arms, as [elbow, wrist] — a bangle rides the forearm between them
const FOREARM_PAIRS = [
  [POSE.leftElbow, POSE.leftWrist],
  [POSE.rightElbow, POSE.rightWrist],
];

const HAND = {
  wrist: 0,
  thumbCmc: 1,
  indexMcp: 5,
  middleMcp: 9,
  middlePip: 10,
  ringMcp: 13,
  ringPip: 14,
  ringTip: 16,
  pinkyMcp: 17,
};

// The four knuckles, index to pinky — the fan the palm's own frame is fitted to
const MCP_ROW = [5, 9, 13, 17];

// Finger chains, as [knuckle, middle joint, tip]
const FINGER_CHAINS = [
  [5, 6, 8],     // index
  [9, 10, 12],   // middle
  [13, 14, 16],  // ring
  [17, 18, 20],  // pinky
];

// PLACEMENT CONSTANTS

const PLACE = {
  // Necklace
  // ►► THE ONE VALUE THAT MOVES THE NECKLACE UP OR DOWN ◄◄
  // How far below the NECK PIVOT the chain crosses the sides of the neck
  neckDrop: 0.35,

  // Where the head actually pivots when it nods:
  neckPivotDrop: -0.05,
  neckPivotBack: 0.30,

  // Safety floor only, NOT the resting height — neckDrop above sets that
  neckClearChin: 0.30,

  // Absolute floor and ceiling on the anchor's distance below the chin, applied after…
  neckDropMin: 0.20,
  neckDropMax: 1.25,
  // Height of the chain above the shoulder midpoint, as a fraction of shoulder span
  neckAboveShoulder: 0.38,
  // Furthest the torso may move the anchor up or down, in face heights
  neckShoulderLift: 0.12,
  // Furthest it may move it toward or away from the lens, in neck radii
  neckShoulderDepth: 0.35,
  // How much of the neck's ORIENTATION the torso is allowed to contribute
  neckTorsoAxis: 0.25,
  neckRadius: 0.66,
  // Chain diameter relative to the neck's
  necklaceWidth: 1.02,
  // Runaway guard on how far the piece may hang below the neck, as a fraction of face…
  pendantDrop: 1.10,
  // Must stay 0 while the neck mask is concentric with the chain — see updateNecklace
  necklaceForward: 0,

  // Neck mask geometry, in CHAIN RADII rather than face heights
  neckMaskLength: 1.90,
  neckMaskLift: 0.41,

  // Neck mask size, as a multiple of the chain's OWN wrap radius
  neckMaskWide: 1.02,
  neckMaskDeep: 0.97,
  // A model that was already 3D was never wrapped
  neckMaskFitFlat: 0.86,

  // Torso contribution
  neckFromShoulder: 0.30,
  neckShoulderTrust: 0.35,
  neckShoulderPull: 0.30,
  neckShoulderShift: 0.22,

  // Earrings
  earringDrop: 0.078,
  earringMax: 0.135,
  // Where the earring hangs from
  earringLobeDrop: 0.18,
  earringLobeOut: 0.14,
  earringLobeBack: 0.08,
  // Earring orientation
  earringRollFollow: 0.55,
  earringHeadFollow: 0.82,
  earringOutward: 0.38,
  // Which earrings are visible
  earringFadeStart: -0.10,
  earringFadeEnd: -0.35,

  // Ring
  // Outer diameter in finger widths — the FALLBACK, used only when the model has no measurable hole
  ringWidth: 1.30,
  // How much of the model's hole the finger fills, 1 = exactly
  ringHoleFit: 1.0,
  // Finger shaft width as a fraction of the knuckle spacing
  ringShaft: 0.82,
  // Seat along the proximal phalanx, 0 = knuckle, 1 = first joint
  ringSeat: 0.52,
  ringDepth: 0.18,
  ringMinPx: 18,
  // Shortest the proximal phalanx may measure
  ringMinPhalanx: 0.55,
  ringPhalanxBand: 0.18,
  ringMinStraight: 0.86,
  ringStraightBand: 0.07,
  ringMinProportion: 1.05,
  // How square-on the phalanx must lie before its direction is trusted
  ringMinAxisView: 0.20,
  ringAxisBand: 0.15,

  // Which face of the finger carries the ornament
  ringStoneOnBackOfHand: false,

  // Hand occlusion
  handCoverReach: 0.95,
  handCoverFade: 0.35,

  // Bangles: outer diameter in wrist widths — the FALLBACK, as for the ring above
  bangleWidth: 1.32,
  // A bangle is loose:
  bangleHoleFit: 1.08,
  // How much of that slack gravity takes up, pulling it onto the underside
  bangleSag: 0.75,
  // How far up the forearm it sits, in wrist widths
  bangleSlide: 0.44,
  bangleDepth: 0.15,
  bangleMinPx: 20,

  // Wrist width as a fraction of the KNUCKLE-CENTRE span (landmarks 5 to 17).
  // Still the cue the size is calibrated on — see _wristWidth for the two extra
  // spans that are measured alongside it and what they are for.
  wristFromPalm: 0.86,
  wristDepthRatio: 0.70,
  // How far the forearm mask runs each way from the bangle, in knuckle spans
  forearmMaskToHand: 0.70,
  forearmMaskToElbow: 2.30,
  // How far the bangle is allowed to leave the hand for Pose's forearm
  forearmTrust: 0.85,
};

// SMOOTHING

// Per-category profiles
const SMOOTH_PROFILE = {
  necklace: { posMin: 0.14, posMax: 0.72, rotMin: 0.10, rotMax: 0.55, scale: 0.14, depth: 0.14 },
  earring: { posMin: 0.20, posMax: 0.86, rotMin: 0.14, rotMax: 0.68, scale: 0.18, depth: 0.18 },
  ring: { posMin: 0.30, posMax: 0.94, rotMin: 0.22, rotMax: 0.85, scale: 0.24, depth: 0.24 },
  bangles: { posMin: 0.26, posMax: 0.90, rotMin: 0.18, rotMax: 0.78, scale: 0.20, depth: 0.20 },
  default: { posMin: 0.24, posMax: 0.86, rotMin: 0.18, rotMax: 0.70, scale: 0.20, depth: 0.20 },
};

// Motion at or above this fraction of the item's own size per frame is treated as "the…
const RESPONSE_SPEED = 0.055;
const RESPONSE_ANGLE = 0.020;   // radians per frame, same idea for rotation

// Deadband:
const DEADBAND_PX = 0.35;
const DEADBAND_SCALE = 0.005;

// Jump rejection
const JUMP_SNAP = 2.5;

// How far past the edge of the canvas an anchor may sit before the piece is treated as…
const OFFSCREEN_MARGIN = 1.5;

// Hide jewellery that a hand is covering
const HIDE_UNDER_HANDS = true;

// BODY-PART VISIBILITY

// Detector results a hand may be missing for before its jewellery starts to fade, and…
const HAND_HOLD_MISSES = 2;
const HAND_FADE_MISSES = 5;

// How much a piece should still be trusted, given how stale its landmarks are
function freshness(miss, hold = HAND_HOLD_MISSES, fade = HAND_FADE_MISSES) {
  if (!Number.isFinite(miss) || miss <= hold) return 1;
  return clamp01(1 - (miss - hold) / fade);
}

// Is a normalised landmark inside the picture? MediaPipe does not omit a landmark that…
function inFrame(lm, margin = 0.06) {
  return !!lm
    && lm.x > -margin && lm.x < 1 + margin
    && lm.y > -margin && lm.y < 1 + margin;
}

// Are all of these landmarks present and inside the picture?
function allInFrame(landmarks, indices, margin) {
  for (const i of indices) {
    if (!inFrame(landmarks[i], margin)) return false;
  }
  return true;
}

// WHICH FINGER WEARS THE RING
//
// MediaPipe gives every finger the same four landmarks — MCP (knuckle), PIP
// (first joint), DIP (second joint), TIP. A ring is worn on the PROXIMAL
// PHALANX, the bone between MCP and PIP, and that is true of whichever finger
// the wearer picks, so the whole placement generalises by swapping four indices.
//
// `gapRef` is the knuckle the finger's WIDTH is measured against — the next MCP
// along toward the thumb, because knuckles are packed at roughly one finger
// width apart. The index finger has nothing on its thumb side in the MCP row, so
// it borrows the middle finger's. Picking it this way leaves the ring finger's
// reference at landmark 9, exactly what the ring-only code used before, so the
// default finger sizes identically to how it always has.
export const RING_FINGERS = {
  index: { key: 'index', label: 'Index', ordinal: 1, mcp: 5, pip: 6, dip: 7, tip: 8, gapRef: 9 },
  middle: { key: 'middle', label: 'Middle', ordinal: 2, mcp: 9, pip: 10, dip: 11, tip: 12, gapRef: 5 },
  ring: { key: 'ring', label: 'Ring', ordinal: 3, mcp: 13, pip: 14, dip: 15, tip: 16, gapRef: 9 },
  little: { key: 'little', label: 'Little', ordinal: 4, mcp: 17, pip: 18, dip: 19, tip: 20, gapRef: 13 },
};

// Left to right across the hand — the order the picker draws them in
export const RING_FINGER_ORDER = ['index', 'middle', 'ring', 'little'];

// The third finger counting from the index. Where a ring belongs, and what every
// camera restart returns to.
export const DEFAULT_RING_FINGER = 'ring';

// Which of the three MCP-row gaps belongs to each finger. The other two are
// averaged into a second, independent width cue.
const MCP_GAPS = [[5, 9], [9, 13], [13, 17]];
const MCP_GAP_OF = { index: 0, middle: 0, ring: 1, little: 2 };

export function normaliseFingerKey(key) {
  if (!key) return null;
  const v = String(key).toLowerCase().trim();
  if (RING_FINGERS[v]) return v;
  // The names people actually use for them
  if (v === 'first' || v === 'pointer' || v === 'forefinger' || v === '1') return 'index';
  if (v === 'second' || v === '2') return 'middle';
  if (v === 'third' || v === '3' || v === 'ringfinger') return 'ring';
  if (v === 'fourth' || v === '4' || v === 'pinky' || v === 'pinkie' || v === 'small') return 'little';
  return null;
}

export function fingerChain(finger) {
  return [finger.mcp, finger.pip, finger.dip, finger.tip];
}

// The knuckles the ring's size and orientation are measured from
const RING_SUPPORT = [0, 5, 9, 13, 17];

// The chosen finger must sit fully inside the picture, and then a little further
// in still. A landmark exactly on the edge means the finger's SILHOUETTE is
// already cut, and half a ring hanging off the frame edge looks worse than none.
const RING_FRAME_INSET = -0.015;

// How much better the other hand's chosen finger must look before the ring moves to it
const RING_HAND_STICK = 1.3;

// Proximal phalanx length as a multiple of finger width, on a real hand
const RING_BONE_TO_WIDTH = 1.85;

// STRICT VISIBILITY
//
// MediaPipe Hands reports no per-landmark confidence — unlike Pose, there is no
// `visibility` field to read, and it will happily invent a plausible position
// for a finger it cannot see at all. So "is this finger really visible?" has to
// be answered from the geometry it returns, by three independent signals:
// shape (below), clearance (is something in front of it), and wobble (are its
// own proportions holding still). All three have to agree.

// How close another finger may pass in front, as a fraction of the chosen
// finger's width, before the ring is treated as hidden behind it
const FINGER_OCCLUDE_REACH = 1.05;
const FINGER_OCCLUDE_FADE = 0.55;
// Depth separation that counts as genuinely in front rather than landmark noise
const FINGER_OCCLUDE_DEPTH = 0.12;

// Frame-to-frame wobble in the finger's OWN proportions. Moving a hand around
// does not change them, which is what makes this a usable tell: it separates
// MediaPipe guessing at a finger it cannot see from the hand simply moving fast.
const FINGER_WOBBLE_LIMIT = 0.16;
const FINGER_WOBBLE_SMOOTH = 0.20;

// The chosen finger has to look right for this many consecutive frames before
// the ring appears, and wrong for this many before it leaves. Two different
// levels, because a single threshold makes the ring strobe when it sits on it.
const RING_SHOW_LEVEL = 0.58;
const RING_HIDE_LEVEL = 0.34;
const RING_SHOW_FRAMES = 4;
const RING_HIDE_FRAMES = 3;

// Finger and wrist thickness change only as the limb nears the lens
const LIMB_WIDTH_SMOOTH = 0.12;

// How coherent the palm's triangles must be before their average normal is trusted
const MIN_PALM_AGREEMENT = 0.25;

// How close Pose's wrist must land to the hand's own, in normalised units
const FOREARM_MATCH_RADIUS = 0.14;
const FOREARM_MIN_VISIBILITY = 0.5;

// Is there really a finger here, laid out plainly enough to place a ring on it?
// Unchanged in substance from the ring-finger-only version — it just reads its
// four landmarks out of `finger` instead of having 13/14/15/16 written into it.
function fingerQuality(hand, engine, finger) {
  const mcp = hand[finger.mcp];
  const pip = hand[finger.pip];
  const dip = hand[finger.dip];
  const tip = hand[finger.tip];
  const gapRef = hand[finger.gapRef];
  if (!mcp || !pip || !dip || !tip || !gapRef) return 0;

  const knuckleGap = engine.dist3D(gapRef, mcp);
  if (!(knuckleGap > 1e-4)) return 0;

  const proximal = engine.dist3D(mcp, pip);
  const middle = engine.dist3D(pip, dip);
  const distal = engine.dist3D(dip, tip);
  const path = proximal + middle + distal;
  if (!(path > 1e-4)) return 0;

  // LENGTH — fades in across the band rather than switching at its edge
  const lengthScore = clamp01(
    (proximal / knuckleGap - PLACE.ringMinPhalanx) / PLACE.ringPhalanxBand,
  );

  // STRAIGHTNESS — 1 is fully extended, and it falls away as the finger curls
  const chord = engine.dist3D(mcp, tip);
  const straightScore = clamp01(
    (chord / path - PLACE.ringMinStraight) / PLACE.ringStraightBand,
  );

  // PROPORTION — the proximal bone outreaches the middle one on every real hand
  if (proximal < middle * PLACE.ringMinProportion) return 0;

  return Math.min(lengthScore, straightScore);
}

// Proximal phalanx as a multiple of the knuckle gap. A real finger holds this
// almost constant no matter where the hand goes, so a value that will not sit
// still is the signature of a landmark being guessed rather than seen.
function fingerShapeRatio(hand, engine, finger) {
  const mcp = hand[finger.mcp];
  const pip = hand[finger.pip];
  const gapRef = hand[finger.gapRef];
  if (!mcp || !pip || !gapRef) return 0;
  const gap = engine.dist3D(gapRef, mcp);
  return gap > 1e-4 ? engine.dist3D(mcp, pip) / gap : 0;
}

// How near a tap has to land, as a fraction of the hand's own knuckle span,
// before it counts as having chosen that finger
const FINGER_TAP_REACH = 0.75;

// Scratch for the finger-clearance solve
const _fsA = new THREE.Vector3();
const _fsB = new THREE.Vector3();
const _fsSeg = new THREE.Vector3();
const _fsRel = new THREE.Vector3();
const _fsNear = new THREE.Vector3();

// Scratch for the tap hit-test
const _ftA = new THREE.Vector3();
const _ftB = new THREE.Vector3();

// Distance from a point to a line segment, in the screen plane only — depth is
// irrelevant to where a finger LOOKS like it is when someone taps it.
function distanceToSegment2D(x, y, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = 0;
  if (len2 > 1e-9) {
    t = ((x - a.x) * abx + (y - a.y) * aby) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  return Math.hypot(x - (a.x + abx * t), y - (a.y + aby * t));
}

// Is anything in front of the seat point? 1 = nothing, 0 = fully covered.
// Only the OTHER fingers' proximal bones are tested: they are what a hand
// actually covers a ring with, and a closed fist puts all three across it.
function fingerClearance(hand, engine, finger, seat, fingerWidth) {
  if (!(fingerWidth > 1e-4)) return 0;

  let worst = 1;
  for (const key of RING_FINGER_ORDER) {
    const other = RING_FINGERS[key];
    if (other.key === finger.key) continue;

    const a = hand[other.mcp];
    const b = hand[other.pip];
    if (!a || !b) continue;

    engine.lmToScreen(a, _fsA);
    engine.lmToScreen(b, _fsB);

    // Closest point on that bone to the seat, clamped to the segment
    _fsSeg.subVectors(_fsB, _fsA);
    const len2 = _fsSeg.lengthSq();
    let t = 0;
    if (len2 > 1e-9) {
      _fsRel.subVectors(seat, _fsA);
      t = _fsRel.dot(_fsSeg) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    _fsNear.copy(_fsA).addScaledVector(_fsSeg, t);

    // Behind the chosen finger, or level with it? Then it hides nothing.
    // Screen space runs +Z toward the lens, so nearer means larger.
    if (_fsNear.z - seat.z <= fingerWidth * FINGER_OCCLUDE_DEPTH) continue;

    const gap = Math.hypot(_fsNear.x - seat.x, _fsNear.y - seat.y);
    const reach = fingerWidth * FINGER_OCCLUDE_REACH;
    const fade = Math.max(fingerWidth * FINGER_OCCLUDE_FADE, 1e-3);
    const clear = 1 - clamp01((reach - gap) / fade);
    if (clear < worst) worst = clear;
  }
  return worst;
}

// Wrist plus the knuckles a bangle's width and orientation are measured from.
// Landmark 1 (thumb CMC) is in here because it and 17 straddle the base of the
// palm, which is the part of the hand that actually turns with the wrist.
const WRIST_CHAIN = [0, 1, 5, 17];

// A bangle's size is read from three spans across the hand at once. They run
// along different axes, so they foreshorten at different moments — which is the
// whole point, since the median of them barely moves as the wrist turns, where
// any one of them alone swings badly.
//
// They are different LENGTHS on a real hand though, so they cannot be compared
// until the engine has watched the same hand square-on and learned how they
// relate. Until it has, only the calibrated cue is used, which is exactly the
// measurement bangles have always been sized by.
const WRIST_CAL_SQUARENESS = 0.80;
const WRIST_CAL_SMOOTH = 0.05;

// The points compared when deciding whether two hand slots hold one hand
const SAME_HAND_POINTS = [0, 5, 9, 13, 17];

// How closely they must shadow each other to count as one hand, as a fraction of the knuckle span
const SAME_HAND_LIMIT = 0.5;

// Rate the invisible body masks follow their target at
const MASK_SMOOTH = 0.55;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Rescales a per-60fps lerp factor to the frame time actually observed
function adapt(k, dtScale) {
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  return 1 - Math.pow(1 - k, dtScale);
}

// Speed-dependent rate:
function responsive(min, max, speed, reference, dtScale) {
  const t = clamp01(speed / Math.max(reference, 1e-6));
  return adapt(min + (max - min) * t, dtScale);
}

// Where the jewellery folders live; a host page sets window.VTO_OBJECTS_URL
export const OBJECTS_BASE = (() => {
  const set = typeof window !== 'undefined' && window.VTO_OBJECTS_URL;
  return set ? String(set).replace(/\/*$/, '/') : 'objects/';
})();

// PER-FOLDER TUNING

export const MODEL_TUNING = {
  'ring-band': { offsetY: 0.15, rotY: 180},
  'ring-solitaire': { offsetY: 0.15, rotY: 180},
};

// Anything set with ?tune=1 is also written to localStorage and re-applied on the next…
const TUNING_STORE_KEY = 'vto.modelTuning.v1';

export function loadSavedTuning() {
  try {
    const raw = localStorage.getItem(TUNING_STORE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    for (const [folder, patch] of Object.entries(saved)) {
      MODEL_TUNING[folder] = { ...(MODEL_TUNING[folder] || {}), ...patch };
    }
    console.log('[Engine3D] restored saved tuning for', Object.keys(saved).join(', '));
  } catch (err) {
    console.warn('[Engine3D] could not read saved tuning', err);
  }
}

export function saveTuning() {
  try {
    localStorage.setItem(TUNING_STORE_KEY, JSON.stringify(MODEL_TUNING));
  } catch (err) {
    console.warn('[Engine3D] could not save tuning', err);
  }
}

export function clearSavedTuning() {
  try {
    localStorage.removeItem(TUNING_STORE_KEY);
  } catch { /* private mode — nothing to clear */ }
}

loadSavedTuning();

// `pair:
const CATEGORY_DEFAULTS = {
  // The necklace is anchored at the NECK CENTRE, not hung from a top edge
  necklace: { fitAxis: 'x', anchor: 'center', scale: 1, pair: 1, pairMirror: false },
  // Earrings hang from the hook, which is the pivot the model gets
  earring: { fitAxis: 'y', anchor: 'top', scale: 1, pair: 2, pairMirror: false },
  ring: { fitAxis: 'x', anchor: 'center', scale: 1, pair: 1, pairMirror: false },
  bangles: { fitAxis: 'x', anchor: 'center', scale: 1, pair: 2, pairMirror: false },
};

const FADE_SPEED = 0.18;
const DEG = Math.PI / 180;

// Scratch objects
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _v7 = new THREE.Vector3();
const _v8 = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _n1 = new THREE.Vector3();
const _n2 = new THREE.Vector3();
const _n3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _bUp = new THREE.Vector3();
const _bRight = new THREE.Vector3();
const _bFwd = new THREE.Vector3();
const _bm4 = new THREE.Matrix4();
// Scratch for mask placement
const _mPos = new THREE.Vector3();
const _mScale = new THREE.Vector3();

// Scratch for the palm-frame solve
const _hfWrist = new THREE.Vector3();
const _hfP = new THREE.Vector3();
const _hfQ = new THREE.Vector3();
const _hfTmp = new THREE.Vector3();
const _hfNormal = new THREE.Vector3();
const _hfAcross = new THREE.Vector3();
const _hfAlong = new THREE.Vector3();

// Returned by _handFrame — the same object every call, never retained by a caller
const _handFrameOut = { normal: _hfNormal, across: _hfAcross, along: _hfAlong };

// Scratch for the forearm solve
const _faElbow = new THREE.Vector3();
const _faWrist = new THREE.Vector3();

// Scratch for the wrist-frame solve
const _wfWrist = new THREE.Vector3();
const _wfThumb = new THREE.Vector3();
const _wfIndex = new THREE.Vector3();
const _wfPinky = new THREE.Vector3();
const _wfBase = new THREE.Vector3();
const _wfAcross = new THREE.Vector3();
const _wfAlong = new THREE.Vector3();
const _wfNormal = new THREE.Vector3();

// Returned by _wristFrame — the same object every call, never retained by a caller
const _wristFrameOut = { across: _wfAcross, along: _wfAlong, normal: _wfNormal };

// Scratch for the hand-occlusion test
const _hcWrist = new THREE.Vector3();
const _hcIndex = new THREE.Vector3();
const _hcPinky = new THREE.Vector3();
const _hcMiddle = new THREE.Vector3();
const _hcPalm = new THREE.Vector3();

// Builds a guaranteed-orthonormal rotation from a primary axis plus a rough secondary…
function basisQuat(primaryUp, refFwd, outQuat) {
  _bUp.copy(primaryUp);
  if (_bUp.lengthSq() < 1e-12) _bUp.set(0, 1, 0);
  _bUp.normalize();

  _bFwd.copy(refFwd);
  if (_bFwd.lengthSq() < 1e-12) _bFwd.set(0, 0, 1);

  // Gram-Schmidt:
  _bFwd.addScaledVector(_bUp, -_bUp.dot(_bFwd));

  if (_bFwd.lengthSq() < 1e-8) {
    // forward was parallel to up
    if (Math.abs(_bUp.z) < 0.9) _bFwd.set(0, 0, 1);
    else _bFwd.set(1, 0, 0);
    _bFwd.addScaledVector(_bUp, -_bUp.dot(_bFwd));
  }
  _bFwd.normalize();

  _bRight.crossVectors(_bUp, _bFwd).normalize();

  _bm4.makeBasis(_bRight, _bUp, _bFwd);
  return outQuat.setFromRotationMatrix(_bm4);
}

// Per-channel smoothing state
function newSmoothState() {
  return {
    position: new THREE.Vector3(),   // x/y — screen plane
    depth: 0,                        // z — filtered separately, much harder
    scale: 1,
    quaternion: new THREE.Quaternion(),
    initialized: false,
    // Confidence ramp
    age: 0,
  };
}

// Head pose

function newHeadPose() {
  return {
    valid: false,
    center: new THREE.Vector3(),     // centroid of the head, screen space
    chin: new THREE.Vector3(),
    // Midpoint of the two jaw angles
    jawCenter: new THREE.Vector3(),
    // Roughly the atlanto-occipital joint — the point a nod rotates the skull about
    neckPivot: new THREE.Vector3(),
    right: new THREE.Vector3(),      // anatomical right, in screen space
    up: new THREE.Vector3(),
    forward: new THREE.Vector3(),    // out of the face
    quaternion: new THREE.Quaternion(),
    halfWidth: 1,                    // head half-width in px
    faceHeight: 1,
    jawWidth: 1,
    yaw: 0,                          // radians, + = turned to their left
    // Last confident answer to "did the raw cross product point into the skull?" — held…
    faceSign: 1,

    // How much this pose is still trusted, 1 down to 0
    confidence: 0,
    staleFrames: 0,
  };
}

// How long a head pose survives with no fresh landmarks
const HEAD_HOLD_FRAMES = 14;
const HEAD_FADE_FRAMES = 10;

// Torso pose

function newTorsoPose() {
  return {
    valid: false,
    shoulderMid: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    width: 0,
    // Ramps in and out so the necklace transitions between the torso-driven and face-only…
    blend: 0,
  };
}

// How quickly the torso solution fades in and out of use, per 60fps frame
const TORSO_BLEND_RATE = 0.08;

// MODEL FORMATS
//
// Jewellery arrives in whatever the designer happened to export. These are the
// formats a browser can genuinely open, listed in the order they are preferred
// when one folder holds several — glTF first, because it is the only one on the
// list actually designed for the web: smallest on the wire, with PBR materials
// and textures inside the single file.
//
// Deliberately absent, and they cannot be added later either:
//   STEP / IGES  NURBS surfaces. Nothing in a browser can tessellate them.
//   .blend .ztl  Application save files, not interchange formats.
//   .max .c4d    Same.
// Those have to be converted before upload. In practice it costs nothing: a
// marketplace listing offering them always offers a mesh format alongside.
export const MODEL_FORMATS = [
  {
    ext: 'glb', label: 'glTF Binary', loader: 'gltf', binary: true, materials: 'embedded',
    // glTF fixes the WORLD up-axis, but this engine needs a per-category pose —
    // a ring lying flat, a necklace facing +Z — which a Y-up file says nothing
    // about. So it gets the same bounding-box pass every other format gets.
    autoOrient: true,
  },
  {
    ext: 'gltf', label: 'glTF', loader: 'gltf', binary: false, materials: 'embedded',
    autoOrient: true,
  },
  {
    ext: 'obj', label: 'OBJ', loader: 'obj', binary: false, materials: 'mtl', autoOrient: true,
    // The exact names this project has always probed for, kept so every folder
    // added before multi-format support carries on working untouched
    stems: ['model', 'scene', '1', '2', '3'],
  },
  {
    ext: 'stl', label: 'STL', loader: 'stl', binary: true, materials: 'none', autoOrient: true,
    // STL stores triangles and nothing else — no colour, no texture, no groups.
    // Everything therefore renders in the default metal, which suits a plain
    // band and does not suit a stone setting.
    warn: 'STL carries no colours or materials, so the piece renders as one solid metal.',
  },
  { ext: 'ply', label: 'PLY', loader: 'ply', binary: true, materials: 'vertex', autoOrient: true },
  { ext: 'fbx', label: 'FBX', loader: 'fbx', binary: true, materials: 'embedded', autoOrient: true },
  { ext: '3ds', label: '3DS', loader: '3ds', binary: true, materials: 'embedded', autoOrient: true },
  { ext: 'dae', label: 'Collada', loader: 'dae', binary: false, materials: 'embedded', autoOrient: true },
  { ext: '3mf', label: '3MF', loader: '3mf', binary: true, materials: 'embedded', autoOrient: true },
  {
    ext: '3dm', label: 'Rhino 3DM', loader: '3dm', binary: true, materials: 'embedded',
    autoOrient: true,
    // Rhino is the jewellery trade's CAD tool, so 3DM turns up constantly. Two
    // things to know about it:
    //
    //   · it needs a separate ~2 MB rhino3dm WASM build, fetched on first use
    //   · Rhino works in NURBS — mathematical surfaces, not triangles. A file
    //     saved without render meshes has literally nothing a browser can draw,
    //     and it opens perfectly happily as an empty scene.
    //
    // The second one is why _loadTemplate counts meshes after parsing and says
    // so plainly, rather than leaving a piece that silently never appears.
    warn: 'Rhino files save NURBS surfaces; if this one has no render meshes saved with it, nothing will be drawn.',
  },
];

// Filenames probed inside a folder, before the folder's own name is tried
const DEFAULT_STEMS = ['model', 'scene'];

// Every extension the catalogue will look for, highest priority first
export const MODEL_EXTENSIONS = MODEL_FORMATS.map((f) => f.ext);

// Fetched on demand, so a site that only ever serves GLB never downloads the
// FBX loader. Resolved through the same `three/addons/` import-map entry the
// static imports at the top of this file use.
const LOADER_MODULES = {
  gltf: () => import('three/addons/loaders/GLTFLoader.js').then((m) => m.GLTFLoader),
  stl: () => import('three/addons/loaders/STLLoader.js').then((m) => m.STLLoader),
  ply: () => import('three/addons/loaders/PLYLoader.js').then((m) => m.PLYLoader),
  fbx: () => import('three/addons/loaders/FBXLoader.js').then((m) => m.FBXLoader),
  '3ds': () => import('three/addons/loaders/TDSLoader.js').then((m) => m.TDSLoader),
  dae: () => import('three/addons/loaders/ColladaLoader.js').then((m) => m.ColladaLoader),
  '3mf': () => import('three/addons/loaders/3MFLoader.js').then((m) => m.ThreeMFLoader),
  '3dm': () => import('three/addons/loaders/3DMLoader.js').then((m) => m.Rhino3dmLoader),
};

// The rhino3dm WASM build the 3DM loader drives. It has to match the release
// three r160 was written against — a mismatched pair is the first thing to
// check if 3DM files stop opening after a three upgrade.
const RHINO3DM_LIBRARY_PATH = 'https://cdn.jsdelivr.net/npm/rhino3dm@8.4.0/';

// Promises, not classes: a second piece in the same format reuses the in-flight
// import rather than starting another one
const _loaderClasses = new Map();

function getLoaderClass(key) {
  // Statically imported at the top — OBJ is the format everything already uses
  if (key === 'obj') return Promise.resolve(OBJLoader);
  if (!_loaderClasses.has(key)) {
    const load = LOADER_MODULES[key];
    if (!load) return Promise.reject(new Error(`No loader registered for "${key}"`));
    _loaderClasses.set(key, load());
  }
  return _loaderClasses.get(key);
}

// MUST stay in step with the three version in the import map in index.html — a
// decoder from a different release can fail to match the loader.
const DRACO_DECODER_PATH = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/';
let _draco = null;

// Draco-compressed glTF is what every optimisation tool emits — gltf-transform
// and gltfpack both — so without this those files throw on parse. An
// uncompressed glTF never touches it.
async function attachDraco(gltfLoader) {
  try {
    if (!_draco) {
      const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
      _draco = new DRACOLoader();
      _draco.setDecoderPath(DRACO_DECODER_PATH);
    }
    gltfLoader.setDRACOLoader(_draco);
  } catch (err) {
    console.warn('[Engine3D] Draco decoder unavailable — compressed glTF will not load', err);
  }
}

/** The format record for a filename, or null if the extension is not supported. */
export function formatForFile(name) {
  const clean = String(name || '').split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = clean.slice(dot + 1).toLowerCase();
  return MODEL_FORMATS.find((f) => f.ext === ext) || null;
}

// Loaders disagree about what they hand back: glTF and Collada wrap the scene
// in a result object, STL and PLY return bare geometry with no mesh around it.
function loaderResultToObject(result, cacheKey) {
  if (!result) throw new Error(`${cacheKey}: the loader returned nothing`);
  if (result.isObject3D) return result;
  if (result.scene && result.scene.isObject3D) return result.scene;

  if (result.isBufferGeometry) {
    const material = defaultMetalMaterial();
    // A vertex-coloured mesh is stating its own colour, so the gold tint that
    // suits a bare STL would fight it
    if (result.getAttribute && result.getAttribute('color')) {
      material.vertexColors = true;
      material.color.setRGB(1, 1, 1);
    }
    const group = new THREE.Group();
    group.add(new THREE.Mesh(result, material));
    return group;
  }

  throw new Error(`${cacheKey}: the loader returned something unrecognised`);
}

// Flattens a loaded model into the shape the rest of this file was written for:
// one level of plain meshes, every transform identity, every geometry owned by
// exactly one mesh.
//
// OBJ arrives like that already, which is why nothing downstream ever had to
// cope with the alternative. Every other format does not:
//
//   · glTF, FBX, Collada, 3DS and 3MF put the model's real placement — and its
//     unit scale, and Collada's Z-up correction — on NODE transforms, which
//     normalizeModel wipes when it resets the root before measuring
//   · they reuse one geometry across many nodes (the same stone repeated round
//     a setting), so baking a transform into it moves every other copy too, and
//     re-welding it disposes a buffer the other copies are still drawing from
//   · gltfpack and gltf-transform emit InstancedMesh, whose copies live in an
//     instance matrix that none of the vertex scans here read
//
// Doing this once at load time means the measuring, orienting, wrapping and
// cloning that follow all see exactly what an OBJ would have given them.
function flattenModel(root, label) {
  root.updateMatrixWorld(true);

  const meshes = [];
  root.traverse((child) => { if (child.isMesh) meshes.push(child); });

  let expanded = 0;
  for (const mesh of meshes) {
    // A loader root that is itself a mesh has nothing to be re-parented into
    if (!mesh.parent) continue;

    // An InstancedMesh draws N copies from one geometry; each becomes a real mesh
    if (mesh.isInstancedMesh && mesh.count > 0) {
      const parent = mesh.parent;
      const m = new THREE.Matrix4();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        const copy = new THREE.Mesh(mesh.geometry.clone(), mesh.material);
        // Local placement only — the bake below picks up the rest of the chain
        m.premultiply(mesh.matrix).decompose(copy.position, copy.quaternion, copy.scale);
        parent.add(copy);
      }
      parent.remove(mesh);
      expanded += mesh.count;
      continue;
    }

    // Nothing here is ever animated, and a skeleton only survives clone(true)
    // half-attached. The bind pose is the pose we want, so take it as static.
    if (mesh.isSkinnedMesh) {
      const plain = new THREE.Mesh(mesh.geometry, mesh.material);
      plain.name = mesh.name;
      plain.matrix.copy(mesh.matrix);
      plain.matrix.decompose(plain.position, plain.quaternion, plain.scale);
      mesh.parent.add(plain);
      mesh.parent.remove(mesh);
    }
  }

  if (expanded) console.log(`[Engine3D] ${label}: expanded ${expanded} GPU instance(s)`);

  root.updateMatrixWorld(true);

  const drawn = [];
  root.traverse((child) => { if (child.isMesh && child.geometry) drawn.push(child); });

  // Every mesh must own its geometry before ANY of them is baked — cloning
  // lazily during the bake would copy a buffer that already carries the first
  // mesh's matrix, and the copy would then get a second transform on top
  giveEachMeshItsOwnGeometry(drawn);

  const identity = new THREE.Matrix4();
  for (const child of drawn) {
    // An OBJ's meshes are all identity already — nothing to bake, and no reason
    // to push a whole vertex buffer through a no-op
    if (child.matrixWorld.equals(identity)) continue;

    child.geometry.applyMatrix4(child.matrixWorld);

    // A mirrored node inverts winding; applyMatrix4 fixes the normals but not
    // the triangle order, which single-sided shading would then get backwards
    if (child.matrixWorld.determinant() < 0) reverseWinding(child.geometry);
  }

  root.traverse((child) => {
    child.position.set(0, 0, 0);
    child.rotation.set(0, 0, 0);
    child.scale.set(1, 1, 1);
    child.matrixAutoUpdate = true;
  });
  root.updateMatrixWorld(true);
}

// Splits geometry shared by several meshes, so baking one mesh's transform
// cannot move the others
function giveEachMeshItsOwnGeometry(meshes) {
  const seen = new Set();
  for (const mesh of meshes) {
    if (seen.has(mesh.geometry)) mesh.geometry = mesh.geometry.clone();
    else seen.add(mesh.geometry);
  }
}

function reverseWinding(geometry) {
  const index = geometry.getIndex();
  if (index) {
    const a = index.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i];
      a[i] = a[i + 2];
      a[i + 2] = t;
    }
    index.needsUpdate = true;
    return;
  }
  for (const attr of Object.values(geometry.attributes)) {
    const a = attr.array;
    const n = attr.itemSize;
    for (let i = 0; i + 3 * n <= a.length; i += 3 * n) {
      for (let k = 0; k < n; k++) {
        const t = a[i + k];
        a[i + k] = a[i + 2 * n + k];
        a[i + 2 * n + k] = t;
      }
    }
    attr.needsUpdate = true;
  }
}

export class Engine3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.width = 1;
    this.height = 1;

    // Source video pixel size — needed to undo `object-fit:
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.dispW = 1;
    this.dispH = 1;
    this.offX = 0;
    this.offY = 0;

    // The camera feed is shown mirrored (selfie view), so landmarks get flipped here
    this.mirror = true;

    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      // Ask for the deepest depth buffer the device will give us and for a high-performance…
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // No tone mapping, deliberately
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Orthographic, looking down -Z
    this.camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 500, 3500);
    this.camera.position.z = 2000;

    // Lighting
    this.ambient = new THREE.AmbientLight(0xffffff, Math.max(0.85 - ENV_MEAN_LUMINANCE, 0.1));
    this.keyLight = new THREE.DirectionalLight(0xfff6ea, 1.15);
    this.fillLight = new THREE.DirectionalLight(0xeaf0ff, 0.40);
    this.rimLight = new THREE.DirectionalLight(0xffffff, 0.30);
    this.scene.add(this.ambient, this.keyLight, this.fillLight, this.rimLight);

    this._buildEnvironment();

    this.modelCache = new Map();
    this.pendingLoads = new Map();
    this.activeItems = new Map();

    // Rebuilt once per frame and shared by every face-driven piece
    this.headPose = newHeadPose();
    // Shoulders and chest, when Pose is running and its answer passes checks
    this.torsoPose = newTorsoPose();

    // Frame timing, so every smoothing rate can be expressed per-60fps-frame and rescaled…
    this._lastFrameTime = 0;
    this._dtScale = 1;

    // Smoothing state for the invisible body masks, keyed by mask
    this._maskStates = new Map();

    // Last landmark arrays actually solved, so an unchanged one can be skipped — see…
    this._lastFaceRef = null;
    this._lastPoseRef = null;

    // Detector results the face has been missing for, refreshed each frame
    this._faceMiss = 0;
    this._tracking = null;

    // Which finger the ring is worn on. Deliberately engine state rather than
    // per-item state: swapping to a different ring keeps the chosen finger,
    // and only a camera restart puts it back (see resetRingFinger).
    this.ringFinger = DEFAULT_RING_FINGER;

    // Per-finger confidence from the last solved frame, so the UI can show which
    // fingers are actually trackable instead of leaving the wearer guessing why
    // nothing appeared. Keyed by finger, values 0..1.
    this.fingerConfidence = {};

    // Open the page with ?anchors=1 to draw a dot at every attachment point
    this.showAnchors = typeof location !== 'undefined'
      && new URLSearchParams(location.search).has('anchors');
    this._anchorMarks = new Map();

    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy?.() || 1;

    this._buildOccluders();
  }

  // Pre-filters a small studio probe into an environment map
  _buildEnvironment() {
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const source = makeStudioEnvTexture();
      this.envTarget = pmrem.fromEquirectangular(source);
      this.scene.environment = this.envTarget.texture;
      source.dispose();
      pmrem.dispose();
    } catch (err) {
      console.warn('[Engine3D] environment map unavailable — lighting only', err);
      // Give the ambient back what the probe would have contributed
      this.ambient.intensity = 0.9;
    }
  }

  // Occlusion

  _buildOccluders() {
    const maskMaterial = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
      // Push the mask a little AWAY from the camera in depth only
      polygonOffset: true,
      // Constant only — the slope term MUST stay at zero
      polygonOffsetFactor: 0,
      polygonOffsetUnits: 2,
    });
    this.maskMaterial = maskMaterial;

    const mask = (geometry) => {
      const m = new THREE.Mesh(geometry, maskMaterial);
      m.visible = false;
      m.renderOrder = -1;
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    };

    // Unit primitives — all real sizing happens through per-frame scale
    this.occluders = {
      neck: mask(new THREE.CylinderGeometry(1, 1, 1, 20, 1, false)),
      head: mask(new THREE.SphereGeometry(1, 20, 14)),
      finger: mask(new THREE.CylinderGeometry(1, 1, 1, 14, 1, false)),
      forearm: [
        mask(new THREE.CylinderGeometry(1, 1, 1, 16, 1, false)),
        mask(new THREE.CylinderGeometry(1, 1, 1, 16, 1, false)),
      ],
    };
  }

  // Every occluder off; re-enabled per frame only by whatever needs it
  _resetOccluders() {
    this.occluders.neck.visible = false;
    this.occluders.head.visible = false;
    this.occluders.finger.visible = false;
    this.occluders.forearm[0].visible = false;
    this.occluders.forearm[1].visible = false;
  }

  // Moves a body mask to a pose, through the same kind of filter the jewellery goes…
  _placeMask(mesh, key, position, quaternion, scale, filter = true) {
    if (!filter) {
      mesh.position.copy(position);
      mesh.quaternion.copy(quaternion);
      mesh.scale.copy(scale);
      mesh.visible = true;
      const cached = this._maskStates.get(key);
      if (cached) cached.live = false;
      return;
    }

    let st = this._maskStates.get(key);
    if (!st) {
      st = {
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        scale: new THREE.Vector3(1, 1, 1),
        live: false,
      };
      this._maskStates.set(key, st);
    }

    if (!st.live) {
      st.position.copy(position);
      st.quaternion.copy(quaternion);
      st.scale.copy(scale);
      st.live = true;
    } else {
      const k = adapt(MASK_SMOOTH, this._dtScale);
      // A mask that has teleported (re-detection after occlusion) must not sweep across the frame
      if (st.position.distanceTo(position) > Math.max(scale.y, scale.x) * JUMP_SNAP) {
        st.position.copy(position);
        st.quaternion.copy(quaternion);
        st.scale.copy(scale);
      } else {
        st.position.lerp(position, k);
        st.quaternion.slerp(quaternion, k);
        st.scale.lerp(scale, k);
      }
    }

    mesh.position.copy(st.position);
    mesh.quaternion.copy(st.quaternion);
    mesh.scale.copy(st.scale);
    mesh.visible = true;
  }

  // Masks forget their pose when their jewellery goes away
  _forgetMask(key) {
    const st = this._maskStates.get(key);
    if (st) st.live = false;
  }

  // Viewport

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);

    // Re-read the device pixel ratio on every resize
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.renderer.getPixelRatio() !== dpr) this.renderer.setPixelRatio(dpr);

    this.renderer.setSize(this.width, this.height, false);

    const hw = this.width / 2;
    const hh = this.height / 2;
    this.camera.left = -hw;
    this.camera.right = hw;
    this.camera.top = hh;
    this.camera.bottom = -hh;
    this.camera.updateProjectionMatrix();

    // A three-point rig
    this.keyLight.position.set(hw * 0.45, hh * 0.75, 1200);
    this.fillLight.position.set(-hw * 0.6, -hh * 0.35, 900);
    this.rimLight.position.set(-hw * 0.25, hh * 0.6, -1000);

    this._updateCoverMapping();
  }

  setVideoSize(vw, vh) {
    if (!vw || !vh) return;
    this.videoWidth = vw;
    this.videoHeight = vh;
    this._updateCoverMapping();
  }

  // The <video> is drawn with `object-fit:
  _updateCoverMapping() {
    const vw = this.videoWidth || this.width;
    const vh = this.videoHeight || this.height;
    const cover = Math.max(this.width / vw, this.height / vh);
    this.dispW = vw * cover;
    this.dispH = vh * cover;
    this.offX = (this.width - this.dispW) / 2;
    this.offY = (this.height - this.dispH) / 2;
  }

  // Normalised landmark → centred screen-space point
  lmToScreen(lm, out) {
    const nx = this.mirror ? 1 - lm.x : lm.x;
    const px = this.offX + nx * this.dispW;
    const py = this.offY + lm.y * this.dispH;
    return out.set(
      px - this.width / 2,
      -(py - this.height / 2),
      -(lm.z || 0) * this.dispW,
    );
  }

  // Distance between two landmarks in on-screen pixels (ignores depth)
  dist2D(a, b) {
    const dx = (a.x - b.x) * this.dispW;
    const dy = (a.y - b.y) * this.dispH;
    return Math.hypot(dx, dy);
  }

  // True 3D distance in the same pixel units, including depth
  dist3D(a, b) {
    const dx = (a.x - b.x) * this.dispW;
    const dy = (a.y - b.y) * this.dispH;
    const dz = ((a.z || 0) - (b.z || 0)) * this.dispW;
    return Math.hypot(dx, dy, dz);
  }

  // Head pose

  // Builds the head's own 3D coordinate frame for this frame
  _decayHeadPose() {
    const hp = this.headPose;
    if (!hp.confidence && !hp.valid) {
      hp.valid = false;
      return hp;
    }

    hp.staleFrames += 1;

    if (hp.staleFrames <= HEAD_HOLD_FRAMES) {
      // Still holding:
      hp.confidence = 1;
      hp.valid = true;
      return hp;
    }

    const fading = hp.staleFrames - HEAD_HOLD_FRAMES;
    hp.confidence = clamp01(1 - fading / HEAD_FADE_FRAMES);
    hp.valid = hp.confidence > 0.01;
    return hp;
  }

  _updateHeadPose(face) {
    const hp = this.headPose;
    if (!face || face.length < 468) {
      this._lastFaceRef = null;
      return this._decayHeadPose();
    }

    // Rendering runs at display rate; FaceMesh delivers results at a third of that or less
    if (face === this._lastFaceRef && hp.valid) return hp;
    this._lastFaceRef = face;

    const chin = face[FACE.chin];
    const forehead = face[FACE.forehead];
    const lEye = face[FACE.leftEyeOuter];
    const rEye = face[FACE.rightEyeOuter];
    const lJaw = face[FACE.leftJaw];
    const rJaw = face[FACE.rightJaw];
    const noseTip = face[FACE.noseTip];

    const faceHeight = this.dist3D(forehead, chin);
    const jawWidth = this.dist3D(lJaw, rJaw);
    if (!(faceHeight > 1e-3) || !(jawWidth > 1e-3)) return this._decayHeadPose();

    this.lmToScreen(forehead, _v1);
    this.lmToScreen(chin, _v2);
    this.lmToScreen(lEye, _v3);
    this.lmToScreen(rEye, _v4);

    // Built in scratch, committed to `hp` only once every check has passed
    const right = _n1;
    const up = _n2;
    const forward = _n3;

    // Anatomical right:
    right.subVectors(_v4, _v3);
    up.subVectors(_v1, _v2);

    if (right.lengthSq() < 1e-9 || up.lengthSq() < 1e-9) return this._decayHeadPose();

    right.normalize();
    up.normalize();

    // forward = right × up
    forward.crossVectors(right, up);
    if (forward.lengthSq() < 1e-9) return this._decayHeadPose();
    forward.normalize();

    // Recovering the sign from the face itself
    _v5.addVectors(_v3, _v4).multiplyScalar(0.5);      // between the eyes
    this.lmToScreen(noseTip, _v6);
    _v6.sub(_v5);                                       // eyes → nose tip

    // Near full profile the nose tip projects almost onto the eye midpoint, so `_v6` gets…
    const noseReach = _v6.length();
    if (noseReach > faceHeight * 0.06) {
      const flipped = forward.dot(_v6) < 0;
      if (flipped) {
        forward.negate();
        right.negate();
      }
      hp.faceSign = flipped ? -1 : 1;
    } else if (hp.faceSign < 0) {
      // Too close to call — reuse the last trustworthy decision
      forward.negate();
      right.negate();
    }

    // Re-orthogonalise:
    right.crossVectors(up, forward).normalize();

    // Every check passed — commit
    hp.right.copy(right);
    hp.up.copy(up);
    hp.forward.copy(forward);

    _bm4.makeBasis(hp.right, hp.up, hp.forward);
    hp.quaternion.setFromRotationMatrix(_bm4);

    hp.chin.copy(_v2);
    hp.center.copy(_v2).addScaledVector(hp.up, faceHeight * 0.5);

    // Jaw angles (gonions)
    this.lmToScreen(face[FACE.rightJawAngle], _v7);
    this.lmToScreen(face[FACE.leftJawAngle], _v8);
    hp.jawCenter.addVectors(_v7, _v8).multiplyScalar(0.5);

    // The neck pivot, in the head's own frame — down from the centroid and back toward the spine
    hp.neckPivot.copy(hp.center)
      .addScaledVector(hp.up, -faceHeight * PLACE.neckPivotDrop)
      .addScaledVector(hp.forward, -jawWidth * PLACE.neckPivotBack);

    hp.faceHeight = faceHeight;
    hp.jawWidth = jawWidth;
    hp.halfWidth = jawWidth * 0.5;

    // Yaw straight off the frame:
    hp.yaw = Math.atan2(hp.forward.x, hp.forward.z);

    hp.staleFrames = 0;
    hp.confidence = 1;
    hp.valid = true;
    return hp;
  }

  // Torso pose

  // Builds the shoulder/chest frame, or declines to
  _updateTorsoPose(pose) {
    const tp = this.torsoPose;
    const hp = this.headPose;

    // Same reasoning as the head solve, and it saves more here:
    let ok;
    if (pose && pose === this._lastPoseRef && tp.valid) {
      ok = true;
    } else {
      this._lastPoseRef = pose || null;
      ok = this._solveTorso(pose, tp, hp);
    }

    // Ramped rather than switched
    const target = ok ? 1 : 0;
    tp.blend += (target - tp.blend) * adapt(TORSO_BLEND_RATE, this._dtScale);
    tp.blend = clamp01(tp.blend);
    tp.valid = ok;
    return tp;
  }

  _solveTorso(pose, tp, hp) {
    if (!pose || pose.length <= POSE.rightHip || !hp.valid) return false;

    const ls = pose[POSE.leftShoulder];
    const rs = pose[POSE.rightShoulder];
    if (!ls || !rs) return false;

    // 1
    const vis = Math.min(ls.visibility ?? 0, rs.visibility ?? 0);
    if (vis < 0.55) return false;

    // 2
    const inFrame = (lm) => lm.x > -0.15 && lm.x < 1.15 && lm.y > -0.15 && lm.y < 1.12;
    if (!inFrame(ls) || !inFrame(rs)) return false;

    // 3
    const width = this.dist3D(ls, rs);
    if (!(width > 1e-3)) return false;
    const ratio = width / Math.max(hp.jawWidth, 1e-6);
    if (ratio < 1.4 || ratio > 4.5) return false;

    this.lmToScreen(ls, _v1);
    this.lmToScreen(rs, _v2);

    // Anatomical right, from the left shoulder toward the right one
    tp.right.subVectors(_v2, _v1);
    if (tp.right.lengthSq() < 1e-9) return false;
    tp.right.normalize();

    tp.shoulderMid.addVectors(_v1, _v2).multiplyScalar(0.5);

    // Torso up:
    const lh = pose[POSE.leftHip];
    const rh = pose[POSE.rightHip];
    const hipsVisible = lh && rh
      && Math.min(lh.visibility ?? 0, rh.visibility ?? 0) > 0.5
      && inFrame(lh) && inFrame(rh);

    if (hipsVisible) {
      this.lmToScreen(lh, _v3);
      this.lmToScreen(rh, _v4);
      _v5.addVectors(_v3, _v4).multiplyScalar(0.5);
      tp.up.subVectors(tp.shoulderMid, _v5);
    } else {
      tp.up.subVectors(hp.chin, tp.shoulderMid);
    }
    if (tp.up.lengthSq() < 1e-9) return false;
    tp.up.normalize();

    tp.forward.crossVectors(tp.right, tp.up);
    if (tp.forward.lengthSq() < 1e-9) return false;
    tp.forward.normalize();

    // Sign, from a physical invariant rather than an assumption:
    if (tp.forward.dot(hp.forward) < 0) {
      tp.forward.negate();
      tp.right.negate();
    }

    // Re-orthogonalise; the shoulder line and the spine are not exactly perpendicular on a real body
    tp.right.crossVectors(tp.up, tp.forward).normalize();

    tp.width = width;
    return true;
  }

  // Loading

  async loadJewellery(id, folder, modelFile, category, onProgress) {
    const cacheKey = `${folder}/${modelFile}`;
    if (this.modelCache.has(cacheKey)) return this.modelCache.get(cacheKey);
    if (this.pendingLoads.has(cacheKey)) return this.pendingLoads.get(cacheKey);

    const job = this._loadTemplate(folder, modelFile, category, cacheKey, onProgress)
      .then((template) => {
        this.modelCache.set(cacheKey, template);
        this.pendingLoads.delete(cacheKey);
        return template;
      })
      .catch((err) => {
        this.pendingLoads.delete(cacheKey);
        throw err;
      });

    this.pendingLoads.set(cacheKey, job);
    return job;
  }

  // Every loader has its own parse signature and its own idea of a return
  // value. This is the only place that knows about those differences.
  async _parseModel(format, data, basePath, modelFile, cacheKey) {
    const LoaderClass = await getLoaderClass(format.loader);
    const loader = new LoaderClass();

    // Where a loader goes looking for the textures a model references
    if (typeof loader.setPath === 'function') loader.setPath(basePath);
    if (typeof loader.setResourcePath === 'function') loader.setResourcePath(basePath);

    // OBJ keeps the path it always had: its materials live in a separate MTL
    // that must be attached before parsing, and the text needs repairing first
    if (format.loader === 'obj') {
      const text = sanitizeObjText(data, cacheKey);
      const materials = await this._loadMaterials(basePath, modelFile, text);
      if (materials) loader.setMaterials(materials);
      return {
        object: loaderResultToObject(loader.parse(text), cacheKey),
        hasMaterials: !!materials,
      };
    }

    if (format.loader === 'gltf') {
      await attachDraco(loader);
      // Asynchronous parse, like 3DM below — the rest are synchronous
      const result = await new Promise((resolve, reject) => {
        loader.parse(data, basePath, resolve, reject);
      });
      return { object: loaderResultToObject(result, cacheKey), hasMaterials: true };
    }

    if (format.loader === '3dm') {
      loader.setLibraryPath(RHINO3DM_LIBRARY_PATH);
      try {
        const result = await new Promise((resolve, reject) => {
          loader.parse(data, resolve, reject);
        });
        return { object: loaderResultToObject(result, cacheKey), hasMaterials: true };
      } finally {
        // Rhino3dmLoader runs a worker per instance; without this each piece
        // loaded would leave one behind for the life of the page
        if (typeof loader.dispose === 'function') loader.dispose();
      }
    }

    return {
      object: loaderResultToObject(loader.parse(data, basePath), cacheKey),
      // Everything that is not OBJ arrives carrying a material already — either
      // its own, or the one loaderResultToObject puts on bare geometry
      hasMaterials: true,
    };
  }

  async _loadTemplate(folder, modelFile, category, cacheKey, onProgress) {
    const basePath = `${OBJECTS_BASE}${folder}/`;

    const format = formatForFile(modelFile);
    if (!format) {
      throw new Error(
        `${cacheKey}: "${modelFile}" is not a format this project can open. `
        + `Supported: ${MODEL_EXTENSIONS.join(', ')}. `
        + 'STEP, IGES, .blend and .ztl have to be converted first.',
      );
    }

    // One fetch, with progress. Text formats decode to a string; the rest stay
    // as an ArrayBuffer, which is what their loaders want.
    const data = await fetchModelData(`${basePath}${modelFile}`, format.binary, onProgress);

    const { object, hasMaterials } = await this._parseModel(
      format, data, basePath, modelFile, cacheKey,
    );

    if (format.warn) console.warn(`[Engine3D] ${cacheKey}: ${format.warn}`);

    // A file can open cleanly and still hold nothing drawable. Rhino is the
    // usual reason — it stores NURBS surfaces, and one saved without render
    // meshes parses into an empty scene. Left alone, that piece would just
    // never appear on camera with no clue as to why.
    let meshes = 0;
    object.traverse((child) => { if (child.isMesh) meshes++; });
    if (!meshes) {
      throw new Error(
        `${cacheKey}: the file opened but holds no meshes to draw.`
        + (format.ext === '3dm'
          ? ' Rhino saved it as NURBS surfaces only. Re-save it from Rhino with render'
            + ' meshes included, or export the piece as OBJ, STL or GLB instead.'
          : ' Re-export it from the tool that made it.'),
      );
    }

    // Everything downstream assumes an OBJ's flat, identity-transform hierarchy
    flattenModel(object, cacheKey);

    // Per-folder material overrides, read before the traverse so every mesh in the model…
    const materialOptions = {
      maxAnisotropy: this.maxAnisotropy,
      override: MODEL_TUNING[folder] || {},
      hasMTL: hasMaterials,
    };

    object.traverse((child) => {
      if (!child.isMesh) return;

      // Frustum culling OFF, deliberately
      child.frustumCulled = false;

      // No shadow map is enabled, so these only cost bookkeeping
      child.castShadow = false;
      child.receiveShadow = false;

      // No MTL at all
      if (!materialOptions.hasMTL || !child.material) {
        child.material = Array.isArray(child.material)
          ? child.material.map(() => defaultMetalMaterial())
          : defaultMetalMaterial();
      }

      const wasArray = Array.isArray(child.material);
      const mats = (wasArray ? child.material : [child.material])
        .map((m) => toPBRMaterial(m, materialOptions));
      child.material = wasArray ? mats : mats[0];

      if (child.geometry) child.geometry = prepareGeometry(child.geometry, cacheKey);
    });

    const tuning = {
      // Carried so the tuner can show only the controls that apply to this kind of piece
      category,
      ...CATEGORY_DEFAULTS[category],
      // Every format is oriented the same way; a format may still opt out here
      ...(format.autoOrient === false ? { autoOrient: false } : {}),
      ...(MODEL_TUNING[folder] || {}),
    };

    const analysis = normalizeModel(object, category, tuning);

    const anchorOffset = new THREE.Vector3(
      tuning.offsetX || 0,
      (tuning.anchor === 'top' ? -analysis.normHeight / 2 : 0) + (tuning.offsetY || 0),
      tuning.offsetZ || 0,
    );

    console.log('[Engine3D] loaded', cacheKey, {
      format: format.label,
      rawSize: analysis.rawSize.toArray().map((n) => +n.toFixed(3)),
      normSize: analysis.normSize.toArray().map((n) => +n.toFixed(3)),
      fitAxis: tuning.fitAxis,
      anchor: tuning.anchor,
      autoOrient: tuning.autoOrient !== false,
    });

    return { object, analysis, category, cacheKey, folder, tuning, anchorOffset };
  }

  // OBJ only — the one supported format that keeps its materials in a separate file
  async _loadMaterials(basePath, modelFile, objText) {
    const names = [];
    const declared = objText.match(/^\s*mtllib\s+(.+)$/m);
    if (declared) names.push(declared[1].trim());
    names.push('model.mtl', modelFile.replace(/\.obj$/i, '.mtl'));

    for (const name of [...new Set(names)]) {
      try {
        const res = await fetch(await versionedUrl(`${basePath}${name}`));
        if (!res.ok) continue;
        const raw = await res.text();
        const text = await stripMissingTextures(raw, basePath);
        const loader = new MTLLoader();
        loader.setResourcePath(basePath);
        loader.setPath(basePath);
        const mtl = loader.parse(text, basePath);
        mtl.preload();
        return mtl;
      } catch {
        // try the next candidate
      }
    }
    return null;
  }

  // Activation

  activate(id, template) {
    if (this.activeItems.has(id)) return;

    // Earrings and bangles are worn as a pair, so one uploaded model gets duplicated:
    const count = template.tuning.pair === 2 ? 2 : 1;
    const instances = [];

    for (let i = 0; i < count; i++) {
      const group = new THREE.Group();
      const pivot = new THREE.Group();
      const mesh = cloneWithOwnMaterials(template.object);

      pivot.position.copy(template.anchorOffset);
      // The mesh is centred on the pivot's origin
      if (i === 1 && template.tuning.pairMirror) pivot.scale.x = -1;
      pivot.add(mesh);
      group.add(pivot);
      group.visible = false;
      this.scene.add(group);

      const materials = collectMaterials(mesh);
      materials.forEach((m) => {
        m.userData._baseOpacity = m.opacity;
        m.userData._baseTransparent = m.transparent;
      });

      instances.push({
        group,
        pivot,
        mesh,
        materials,
        opacity: -1, // force the first setOpacity through
        state: newSmoothState(),
        // Which smoothing profile this piece follows
        smooth: SMOOTH_PROFILE[template.category] || SMOOTH_PROFILE.default,
      });
      this._setOpacity(instances[i], 0);
    }

    this.activeItems.set(id, {
      id,
      category: template.category,
      analysis: template.analysis,
      tuning: template.tuning,
      cacheKey: template.cacheKey,
      instances,
    });
  }

  deactivate(id) {
    const entry = this.activeItems.get(id);
    if (!entry) return;
    for (const inst of entry.instances) {
      this.scene.remove(inst.group);
      inst.materials.forEach((m) => m.dispose());
    }
    this.activeItems.delete(id);
  }

  clearScene() {
    for (const id of [...this.activeItems.keys()]) this.deactivate(id);
  }

  _setOpacity(inst, opacity) {
    if (Math.abs(inst.opacity - opacity) < 0.002) return;
    inst.opacity = opacity;
    const fullyIn = opacity >= 0.999;
    for (const m of inst.materials) {
      m.opacity = (m.userData._baseOpacity ?? 1) * opacity;
      // Once fully faded in, drop back to opaque rendering so the metal doesn't stay see-through
      m.transparent = !fullyIn || m.userData._baseTransparent === true;
      // depthWrite stays ON at every opacity, including mid-fade
      m.depthWrite = true;
      // depthTest must stay on at every opacity
      m.depthTest = true;
    }
  }

  // Snap everything out of view immediately (used when the camera stops)
  hideAll() {
    // Masks too — they are invisible
    this._resetOccluders();
    for (const st of this._maskStates.values()) st.live = false;

    // Clear the hold as well as the validity flag
    this.headPose.valid = false;
    this.headPose.confidence = 0;
    this.headPose.staleFrames = 0;
    this.torsoPose.valid = false;
    this.torsoPose.blend = 0;
    // Force a fresh solve on the next frame rather than reusing a cached one from before the camera
    this._lastFaceRef = null;
    this._lastPoseRef = null;

    this._lastFrameTime = 0;

    // Nothing learned from the last session survives either: a ring must earn
    // its way past the visibility gate again rather than reappearing the instant
    // the camera comes back, and limb widths belong to whoever was in frame.
    this.fingerConfidence = {};
    for (const [, entry] of this.activeItems) {
      entry.ringGate = null;
      entry.fingerShape = null;
      entry.fingerWidth = 0;
      entry.ringSlot = undefined;
      entry.wristWidthA = 0;
      entry.wristWidthB = 0;

      for (const inst of entry.instances) {
        inst.group.visible = false;
        inst.state.initialized = false;
        this._setOpacity(inst, 0);
      }
    }
  }

  // Smooth-follow + fade for one instance, filtering each channel separately
  place(inst, targetPos, targetScale, targetQuat, visible, alpha = 1) {
    const s = inst.state;
    const p = inst.smooth || SMOOTH_PROFILE.default;
    const dtScale = this._dtScale;

    if (visible) {
      if (!s.initialized) {
        s.position.set(targetPos.x, targetPos.y, 0);
        s.depth = targetPos.z;
        s.scale = targetScale;
        s.quaternion.copy(targetQuat);
        s.initialized = true;
        s.age = 0;
      } else {
        // Ramp:
        s.age = Math.min(s.age + 1, 8);
        const ramp = 0.35 + 0.65 * (s.age / 8);

        const dx = targetPos.x - s.position.x;
        const dy = targetPos.y - s.position.y;
        const moved = Math.hypot(dx, dy);

        // Anchor teleported — snap rather than sweep across the screen
        if (moved > Math.max(targetScale, 1) * JUMP_SNAP) {
          s.position.set(targetPos.x, targetPos.y, 0);
          s.depth = targetPos.z;
          s.scale = targetScale;
          s.quaternion.copy(targetQuat);
          s.age = 0;
        } else {
          // Speed is measured against the item's OWN size, so "moving fast" means the same thing…
          const reference = Math.max(targetScale, 1) * RESPONSE_SPEED * dtScale;

          if (moved > DEADBAND_PX) {
            const k = responsive(p.posMin, p.posMax, moved, reference, dtScale) * ramp;
            s.position.x += dx * k;
            s.position.y += dy * k;
          }

          // Depth is the noisiest channel MediaPipe produces — filter hardest, and at a fixed rate:
          s.depth += (targetPos.z - s.depth) * adapt(p.depth, dtScale) * ramp;

          // Scale gets a RELATIVE deadband:
          if (Math.abs(targetScale - s.scale) > s.scale * DEADBAND_SCALE) {
            s.scale += (targetScale - s.scale) * adapt(p.scale, dtScale) * ramp;
          }

          // Rotation gets the same treatment, keyed on the angle still to be covered
          const swept = s.quaternion.angleTo(targetQuat);
          const kRot = responsive(
            p.rotMin, p.rotMax, swept, RESPONSE_ANGLE * dtScale, dtScale,
          ) * ramp;
          s.quaternion.slerp(targetQuat, kRot);
        }
      }
    }

    const target = visible ? clamp01(alpha) : 0;
    const next = inst.opacity + (target - inst.opacity) * adapt(FADE_SPEED, dtScale);
    const clamped = Math.abs(target - next) < 0.01 ? target : next;

    inst.group.visible = clamped > 0.02;
    this._setOpacity(inst, clamped);

    // Fully hidden → forget the last pose so it snaps back in cleanly instead of sliding across the
    if (!visible && clamped <= 0.02) {
      s.initialized = false;
      s.age = 0;
    }

    if (inst.group.visible) {
      inst.group.position.set(s.position.x, s.position.y, s.depth);
      inst.group.scale.setScalar(s.scale);
      inst.group.quaternion.copy(s.quaternion);
    }
  }

  hide(entry) {
    for (const inst of entry.instances) {
      this.place(inst, _pos, 1, _q1.identity(), false);
    }
  }

  // Draws a dot at an attachment point, when ?anchors=1 is on
  _markAnchor(key, position, colour) {
    if (!this.showAnchors) return;
    let mark = this._anchorMarks.get(key);
    if (!mark) {
      mark = new THREE.Mesh(
        new THREE.SphereGeometry(1, 12, 8),
        new THREE.MeshBasicMaterial({ color: colour, depthTest: false, depthWrite: false }),
      );
      mark.renderOrder = 999;
      mark.frustumCulled = false;
      this.scene.add(mark);
      this._anchorMarks.set(key, mark);
    }
    mark.position.copy(position);
    mark.scale.setScalar(Math.max(this.width, this.height) * 0.007);
    mark.visible = true;
  }

  // How much a tracked hand is covering this point, 0 to 1
  _handCoverage(point, tracking, skip) {
    if (!tracking) return 0;
    let worst = 0;

    for (const hand of [tracking.leftHand, tracking.rightHand]) {
      if (!hand || hand === skip || hand.length < 21) continue;

      this.lmToScreen(hand[HAND.wrist], _hcWrist);
      this.lmToScreen(hand[HAND.indexMcp], _hcIndex);
      this.lmToScreen(hand[HAND.pinkyMcp], _hcPinky);
      this.lmToScreen(hand[HAND.middleMcp], _hcMiddle);

      const span = _hcIndex.distanceTo(_hcPinky);
      if (span < 1e-3) continue;

      // Centre of the palm — the part of a hand that actually covers things
      _hcPalm.copy(_hcWrist).add(_hcIndex).add(_hcPinky).add(_hcMiddle).multiplyScalar(0.25);

      const distance = Math.hypot(point.x - _hcPalm.x, point.y - _hcPalm.y);
      const reach = span * PLACE.handCoverReach;
      const fade = Math.max(span * PLACE.handCoverFade, 1e-3);

      const cover = clamp01((reach - distance) / fade);
      if (cover > worst) worst = cover;
    }
    return worst;
  }

  // Has this anchor left the picture? MediaPipe does not report a landmark as missing…
  _outOfFrame(position, scale) {
    const margin = Math.max(scale, 1) * OFFSCREEN_MARGIN;
    return Math.abs(position.x) > this.width / 2 + margin
      || Math.abs(position.y) > this.height / 2 + margin;
  }

  // Per-category placement

  // The necklace is anchored at the CENTRE OF THE NECK — inside the body, not on the skin…
  updateNecklace(entry, tracking) {
    const hp = this.headPose;
    if (!hp.valid) return false;

    // The neck must be in shot
    const face = tracking.face;
    if (face && !allInFrame(face, [FACE.chin, FACE.rightJawAngle, FACE.leftJawAngle])) return false;

    const tp = this.torsoPose;
    const torso = tp.blend;                 // 0 = face only, 1 = torso trusted

    const faceHeight = hp.faceHeight;
    const jawWidth = hp.jawWidth;
    const analysis = entry.analysis;

    // The neck frame
    const NECK_FOLLOW = 0.38;

    // Neck axis
    _n1.set(0, 1, 0).lerp(hp.up, NECK_FOLLOW).normalize();
    // Neck forward
    _n2.set(0, 0, 1).lerp(hp.forward, NECK_FOLLOW).normalize();

    if (torso > 0.001) {
      // Torso axes, leaned a little toward the head so a head turn still rotates the chain…
      _v5.copy(tp.up).lerp(hp.up, 0.20).normalize();
      _v6.copy(tp.forward).lerp(hp.forward, 0.30).normalize();
      // A NUDGE, never a handover
      _n1.lerp(_v5, torso * PLACE.neckTorsoAxis).normalize();
      _n2.lerp(_v6, torso * PLACE.neckTorsoAxis).normalize();
    }

    basisQuat(_n1, _n2, _q1);

    // Neck radius
    let neckRadius = jawWidth * PLACE.neckRadius * 0.5;
    if (torso > 0.001) {
      const fromShoulders = tp.width * PLACE.neckFromShoulder * 0.5;
      neckRadius += (fromShoulders - neckRadius) * torso * PLACE.neckShoulderTrust;
    }

    // Anchor: hung from the NECK PIVOT, not from the chin
    _pos.copy(hp.neckPivot)
      .addScaledVector(_n1, -faceHeight * PLACE.neckDrop)
      .addScaledVector(_n2, -neckRadius * PLACE.necklaceForward);

    const faceAnchorX = _pos.x;
    const faceAnchorY = _pos.y;
    const faceAnchorZ = _pos.z;

    // Torso correction
    if (torso > 0.001) {
      _v5.copy(tp.shoulderMid).addScaledVector(tp.up, tp.width * PLACE.neckAboveShoulder);
      _pos.lerp(_v5, torso * PLACE.neckShoulderPull);

      // Vertical deviation stays clamped, like the lateral one below
      const lift = faceHeight * PLACE.neckShoulderLift;
      _pos.y = faceAnchorY + Math.min(Math.max(_pos.y - faceAnchorY, -lift), lift);

      // Depth too
      const push = neckRadius * PLACE.neckShoulderDepth;
      _pos.z = faceAnchorZ + Math.min(Math.max(_pos.z - faceAnchorZ, -push), push);

      // Lateral deviation stays clamped:
      const limit = jawWidth * PLACE.neckShoulderShift;
      _pos.x = faceAnchorX + Math.min(Math.max(_pos.x - faceAnchorX, -limit), limit);
    }

    // Scale
    const openWidth = Math.max(analysis?.openWidth || analysis?.normWidth || 1, 1e-4);
    let scale = (neckRadius * 2 * PLACE.necklaceWidth / openWidth)
      * (entry.tuning.scale ?? 1);

    // Runaway guard only
    const drop = (analysis?.dropBelow || 0.5) * scale;
    const maxDrop = faceHeight * PLACE.pendantDrop;
    if (drop > maxDrop) scale *= maxDrop / drop;

    // The guarantee: against the FRONT of the piece only
    const rise = Math.max(analysis?.frontRise ?? analysis?.riseAbove ?? 0, 0) * scale;
    const minDrop = Math.max(
      faceHeight * PLACE.neckClearChin + rise,
      faceHeight * PLACE.neckDropMin,
    );

    _v6.subVectors(_pos, hp.chin);
    const along = _v6.dot(_n1);                       // negative = below the chin
    const wanted = Math.min(
      Math.max(-along, minDrop),
      Math.max(faceHeight * PLACE.neckDropMax, minDrop),
    );
    _pos.addScaledVector(_n1, -(wanted + along));

    const inst = entry.instances[0];
    // The neck has left the picture — see _outOfFrame
    if (this._outOfFrame(_pos, scale)) return false;

    // Two independent signals, multiplied:
    this._markAnchor('neck', _pos, 0xffcc00);

    // A hand raised over the throat hides the chain — see _handCoverage
    const alpha = hp.confidence
      * freshness(tracking.faceMiss)
      * (1 - this._handCoverage(_pos, tracking, null));
    if (alpha <= 0.01) return false;
    this.place(inst, _pos, scale, _q1, true, alpha);

    // Occluder: the mask IS the neck, and a wrapped chain lies on the neck
    const st = inst.state;
    const necklaceRadius = openWidth * 0.5 * scale;

    // A model that was never wrapped has only an estimated chain radius
    const wrapped = !!entry.analysis?.wrapped;
    const wide = wrapped ? PLACE.neckMaskWide : PLACE.neckMaskFitFlat;
    const deep = wrapped ? PLACE.neckMaskDeep : PLACE.neckMaskFitFlat;

    // Every figure below is in the NECKLACE's own units and multiplied by its smoothed scale
    const half = openWidth * 0.5;
    const wideRatio = half * wide;
    const deepRatio = half * deep;
    const lengthRatio = half * PLACE.neckMaskLength;
    const liftRatio = half * PLACE.neckMaskLift;

    // The chain's own axis, taken from the SMOOTHED pose for the same reason
    _v7.set(0, 1, 0).applyQuaternion(st.quaternion);

    _mPos.set(st.position.x, st.position.y, st.depth)
      // Ride up toward the jaw, clear of anything hanging below
      .addScaledVector(_v7, st.scale * liftRatio);
    _mScale.set(st.scale * wideRatio, st.scale * lengthRatio, st.scale * deepRatio);
    this._placeMask(this.occluders.neck, 'neck', _mPos, st.quaternion, _mScale, false);

    return true;
  }

  // Each earring is placed completely independently:
  updateEarrings(entry, tracking) {
    const hp = this.headPose;
    if (!hp.valid) return false;

    const face = tracking.face;
    const faceHeight = hp.faceHeight;
    const userScale = entry.tuning.scale ?? 1;

    // Scale
    const analysis = entry.analysis;
    const widest = Math.max(analysis?.normWidth || 1, analysis?.normHeight || 1, 1e-6);
    let scale = faceHeight * PLACE.earringDrop * userScale;
    const maxSpan = faceHeight * PLACE.earringMax * userScale;
    if (widest * scale > maxSpan) scale = maxSpan / widest;

    // Each ear is solved completely on its own:
    this._placeEarring(entry, entry.instances[0], face, +1, scale);
    if (entry.instances[1]) {
      this._placeEarring(entry, entry.instances[1], face, -1, scale);
    }

    // Head occluder:
    _mPos.copy(hp.center).addScaledVector(hp.forward, -hp.halfWidth * 0.30);
    _mScale.set(hp.halfWidth * 0.72, faceHeight * 0.50, hp.halfWidth * 0.80);
    this._placeMask(this.occluders.head, 'head', _mPos, hp.quaternion, _mScale);

    return true;
  }

  // @param side +1 = the subject's anatomical RIGHT ear, -1 = their left, matching the…
  _placeEarring(entry, inst, face, side, scale) {
    const hp = this.headPose;
    const faceHeight = hp.faceHeight;

    const earIdx = side > 0 ? FACE.rightEarLow : FACE.leftEarLow;         // 93 / 323
    const jawIdx = side > 0 ? FACE.rightJawAngle : FACE.leftJawAngle;     // 132 / 361

    // Is this ear actually facing the camera?
    _n1.copy(hp.right).multiplyScalar(side);      // outward from THIS ear
    const facing = _n1.z;

    // Where exactly the piercing sits varies with the wearer and with how the piece was…
    const tune = entry.tuning;
    const earDrop = tune.earDrop ?? PLACE.earringLobeDrop;
    const earOut = tune.earOut ?? PLACE.earringLobeOut;
    const earBack = tune.earBack ?? PLACE.earringLobeBack;

    // Anchor:
    if (face) {
      this.lmToScreen(face[earIdx], _v1);                 // lowest point beside the ear
      this.lmToScreen(face[jawIdx], _v2);                 // jaw angle, below and forward

      // Start at the ear point and walk a short way toward the jaw angle
      _pos.copy(_v1).lerp(_v2, earDrop);

      // Then out onto the lobe itself
      _pos
        .addScaledVector(_n1, hp.halfWidth * earOut)
        .addScaledVector(hp.forward, -hp.halfWidth * earBack);
    } else {
      _pos.copy(hp.center)
        .addScaledVector(_n1, hp.halfWidth * 0.92)
        .addScaledVector(hp.forward, -hp.halfWidth * 0.34)
        .addScaledVector(hp.up, -faceHeight * 0.10);
    }

    // There is deliberately NO head-frame prediction blend here any more

    // Orientation
    _n3.set(0, 1, 0).lerp(hp.up, PLACE.earringRollFollow).normalize();

    // Head forward, biased slightly toward the lens
    _v3.copy(hp.forward);
    _v3.z += (1 - PLACE.earringHeadFollow);
    _v3.addScaledVector(_n1, PLACE.earringOutward).normalize();

    basisQuat(_n3, _v3, _q1);

    // Visibility, decided per ear
    let turned = clamp01(
      (facing - PLACE.earringFadeEnd) / (PLACE.earringFadeStart - PLACE.earringFadeEnd),
    );

    // The ear region must also be inside the picture
    if (face && !allInFrame(face, [earIdx, jawIdx])) turned = 0;

    // Multiplied by the head pose's own confidence
    this._markAnchor(`ear${side}`, _pos, side > 0 ? 0x00ff66 : 0x00ddff);

    const covered = this._handCoverage(_pos, this._tracking, null);

    const alpha = (this._outOfFrame(_pos, scale) ? 0 : turned)
      * hp.confidence
      * freshness(this._faceMiss)
      * (1 - covered);

    this.place(inst, _pos, scale, _q1, alpha > 0.02, alpha);
  }

  // The palm's own orthonormal frame, fitted to the whole knuckle fan
  _handFrame(hand) {
    const wristLm = hand[HAND.wrist];
    const index = hand[HAND.indexMcp];
    const middle = hand[HAND.middleMcp];
    const pinky = hand[HAND.pinkyMcp];
    if (!wristLm || !index || !middle || !pinky) return null;

    this.lmToScreen(wristLm, _hfWrist);

    _hfNormal.set(0, 0, 0);
    let area = 0;
    for (let i = 0; i < MCP_ROW.length - 1; i++) {
      const a = hand[MCP_ROW[i]];
      const b = hand[MCP_ROW[i + 1]];
      if (!a || !b) continue;
      this.lmToScreen(a, _hfP).sub(_hfWrist);
      this.lmToScreen(b, _hfQ).sub(_hfWrist);
      _hfTmp.crossVectors(_hfQ, _hfP);
      _hfNormal.add(_hfTmp);
      area += _hfTmp.length();
    }
    if (!(area > 1e-6)) return null;

    // The triangles disagreeing means the landmarks are not describing a palm
    if (_hfNormal.length() < area * MIN_PALM_AGREEMENT) return null;
    _hfNormal.normalize();

    // Across and along, both made exactly perpendicular to that normal
    this.lmToScreen(index, _hfP);
    this.lmToScreen(pinky, _hfQ);
    _hfAcross.subVectors(_hfQ, _hfP);
    _hfAcross.addScaledVector(_hfNormal, -_hfNormal.dot(_hfAcross));
    if (_hfAcross.lengthSq() < 1e-12) return null;
    _hfAcross.normalize();

    this.lmToScreen(middle, _hfP);
    _hfAlong.subVectors(_hfP, _hfWrist);
    _hfAlong.addScaledVector(_hfNormal, -_hfNormal.dot(_hfAlong));
    _hfAlong.addScaledVector(_hfAcross, -_hfAcross.dot(_hfAlong));
    if (_hfAlong.lengthSq() < 1e-12) return null;
    _hfAlong.normalize();

    return _handFrameOut;
  }

  // FINGER SELECTION

  /** Which finger the ring is worn on, as a key of RING_FINGERS. */
  getRingFinger() {
    return this.ringFinger;
  }

  /**
   * Move the ring to another finger. Returns the finger actually in use, so a
   * caller that passes something unrecognised gets the unchanged one back.
   */
  setRingFinger(key) {
    const next = normaliseFingerKey(key);
    if (!next || next === this.ringFinger) return this.ringFinger;
    this.ringFinger = next;
    this._forgetRingFingerState();
    return this.ringFinger;
  }

  /** Back to the third finger. Called when the camera restarts. */
  resetRingFinger() {
    this.ringFinger = DEFAULT_RING_FINGER;
    this._forgetRingFingerState();
    return this.ringFinger;
  }

  // Everything remembered about the finger being left behind. Without this the
  // ring would arrive on the new finger already past its visibility gate, at the
  // old finger's width, still holding the old hand's roll.
  _forgetRingFingerState() {
    this.fingerConfidence = {};
    for (const [, entry] of this.activeItems) {
      if (entry.category !== 'ring') continue;
      entry.ringGate = null;
      entry.fingerShape = null;
      entry.fingerWidth = 0;
      entry.ringSlot = undefined;
      entry.dorsalSide = undefined;
    }
  }

  /**
   * Which finger is under this point? Coordinates are engine screen space —
   * centred on the canvas, +Y up — the same space lmToScreen produces.
   * Returns null when the tap was not near any finger, so a stray tap on the
   * background does not snap the ring to whichever finger was least far away.
   */
  pickFingerAt(x, y) {
    const tracking = this._tracking;
    if (!tracking) return null;

    let best = null;
    for (const hand of [tracking.leftHand, tracking.rightHand]) {
      if (!hand || hand.length < 21) continue;

      // Tap tolerance scales with how big the hand is on screen, so it works the
      // same at arm's length as it does close up
      const span = this.dist2D(hand[HAND.indexMcp], hand[HAND.pinkyMcp]);
      if (!(span > 1e-3)) continue;
      const limit = span * FINGER_TAP_REACH;

      for (const key of RING_FINGER_ORDER) {
        const d = this._tapDistanceToFinger(hand, RING_FINGERS[key], x, y);
        if (d === null || d > limit) continue;
        if (!best || d < best.d) best = { key, d };
      }
    }
    return best ? best.key : null;
  }

  // Shortest distance in the screen plane from a point to a finger's skeleton,
  // treated as the three joined bones MCP→PIP→DIP→TIP. People tap the part of
  // the finger they can see, which is rarely the knuckle.
  _tapDistanceToFinger(hand, finger, x, y) {
    const chain = fingerChain(finger);
    let best = null;
    for (let i = 0; i < chain.length - 1; i++) {
      const a = hand[chain[i]];
      const b = hand[chain[i + 1]];
      if (!a || !b) continue;
      this.lmToScreen(a, _ftA);
      this.lmToScreen(b, _ftB);
      const d = distanceToSegment2D(x, y, _ftA, _ftB);
      if (best === null || d < best) best = d;
    }
    return best;
  }

  // Which tracked hand is wearing the ring? Whichever shows the chosen finger best
  _pickRingHand(entry, tracking, finger) {
    const options = [
      { hand: tracking.leftHand, miss: tracking.leftHandMiss, isRight: tracking.leftHandIsRight, slot: 0 },
      { hand: tracking.rightHand, miss: tracking.rightHandMiss, isRight: tracking.rightHandIsRight, slot: 1 },
    ];

    let best = null;
    for (const option of options) {
      const hand = option.hand;
      if (!hand || hand.length < 21) continue;

      // Every landmark the placement reads must be genuinely in shot, and the
      // chosen finger has to clear the frame edge rather than merely touch it
      if (!allInFrame(hand, fingerChain(finger), RING_FRAME_INSET)) continue;
      if (!allInFrame(hand, RING_SUPPORT)) continue;

      const quality = fingerQuality(hand, this, finger) * freshness(option.miss);
      if (quality <= 0.01) continue;

      const weighted = option.slot === entry.ringSlot ? quality * RING_HAND_STICK : quality;
      if (!best || weighted > best.weighted) {
        best = { ...option, quality, weighted };
      }
    }
    return best;
  }

  // Finger thickness, from three independent cues rather than one gap
  _ringFingerWidth(entry, hand, finger) {
    const gaps = MCP_GAPS.map(([a, b]) => this.dist3D(hand[a], hand[b]));
    const own = MCP_GAP_OF[finger.key] ?? 1;
    const others = gaps.filter((v, i) => i !== own && v > 1e-4);

    const cues = [
      gaps[own],                                                     // its own knuckle gap
      others.length ? others.reduce((sum, v) => sum + v, 0) / others.length : 0,
      this.dist3D(hand[finger.mcp], hand[finger.pip]) / RING_BONE_TO_WIDTH,  // its proximal bone
    ].filter((v) => v > 1e-4).sort((a, b) => a - b);

    if (!cues.length) return 0;

    // The median throws away a cue spoiled by one bad landmark
    const target = cues[Math.floor(cues.length / 2)] * PLACE.ringShaft;

    const prev = entry.fingerWidth || 0;
    entry.fingerWidth = prev > 0
      ? prev + (target - prev) * adapt(LIMB_WIDTH_SMOOTH, this._dtScale)
      : target;
    return entry.fingerWidth;
  }

  // Are the chosen finger's own proportions holding still? See FINGER_WOBBLE_LIMIT
  _fingerSteadiness(entry, hand, finger) {
    const ratio = fingerShapeRatio(hand, this, finger);
    if (!(ratio > 1e-4)) return 0;

    const st = entry.fingerShape;
    if (!st || st.key !== finger.key) {
      entry.fingerShape = { key: finger.key, ratio, wobble: 0 };
      // Nothing to compare against yet. The gate's frame count is what stops a
      // single lucky frame from being enough.
      return 1;
    }

    // Per-60fps-frame, so a slow frame is not mistaken for a jumpy landmark
    const change = Math.abs(ratio - st.ratio) / Math.max(this._dtScale, 1e-3);
    st.ratio = ratio;
    st.wobble += (change - st.wobble) * adapt(FINGER_WOBBLE_SMOOTH, this._dtScale);
    return clamp01(1 - st.wobble / FINGER_WOBBLE_LIMIT);
  }

  // Two thresholds and two frame counts, so the ring cannot strobe on the edge
  // of its own visibility test. Better to hide it than to show it wrong.
  _ringGate(entry, confidence) {
    let gate = entry.ringGate;
    if (!gate) {
      gate = entry.ringGate = { on: false, good: 0, bad: 0 };
    }

    if (gate.on) {
      if (confidence >= RING_HIDE_LEVEL) gate.bad = 0;
      else if (++gate.bad >= RING_HIDE_FRAMES) { gate.on = false; gate.good = 0; }
    } else if (confidence >= RING_SHOW_LEVEL) {
      if (++gate.good >= RING_SHOW_FRAMES) { gate.on = true; gate.bad = 0; }
    } else {
      gate.good = 0;
    }
    return gate.on;
  }

  // What the picker's per-finger indicators read. Cheap signals only — the full
  // test is run for the chosen finger alone, in updateRing.
  _reportFingerConfidence(tracking, chosenKey, chosenValue) {
    const out = {};
    for (const key of RING_FINGER_ORDER) {
      const finger = RING_FINGERS[key];
      let best = 0;
      for (const hand of [tracking.leftHand, tracking.rightHand]) {
        if (!hand || hand.length < 21) continue;
        if (!allInFrame(hand, fingerChain(finger), RING_FRAME_INSET)) continue;
        if (!allInFrame(hand, RING_SUPPORT)) continue;
        const q = fingerQuality(hand, this, finger);
        if (q > best) best = q;
      }
      out[key] = best;
    }
    if (chosenKey) out[chosenKey] = chosenValue;
    this.fingerConfidence = out;
  }

  // The ring is worn on one bone, so everything here is solved in the hand's own
  // frame. Which bone is whichever finger the wearer picked — see RING_FINGERS.
  updateRing(entry, tracking) {
    const finger = RING_FINGERS[this.ringFinger] || RING_FINGERS[DEFAULT_RING_FINGER];

    const pick = this._pickRingHand(entry, tracking, finger);
    if (!pick) {
      this._ringGate(entry, 0);
      this._reportFingerConfidence(tracking, finger.key, 0);
      return false;
    }

    const hand = pick.hand;
    const frame = this._handFrame(hand);
    if (!frame) {
      this._ringGate(entry, 0);
      this._reportFingerConfidence(tracking, finger.key, 0);
      return false;
    }

    // Moving to the other hand invalidates everything remembered about the last:
    if (entry.ringSlot !== pick.slot) {
      entry.fingerWidth = 0;
      entry.dorsalSide = undefined;
      entry.fingerShape = null;
      entry.ringSlot = pick.slot;
    }

    this.lmToScreen(hand[finger.mcp], _v1);
    this.lmToScreen(hand[finger.pip], _v2);

    // Finger axis
    const axis = _v5.subVectors(_v2, _v1);
    const axisLen = axis.length();
    if (axisLen < 1e-6) {
      this._ringGate(entry, 0);
      this._reportFingerConfidence(tracking, finger.key, 0);
      return false;
    }
    axis.multiplyScalar(1 / axisLen);

    // A finger pointing straight at the lens collapses to a dot in the image
    const inPlane = Math.hypot(axis.x, axis.y);
    const axisScore = clamp01((inPlane - PLACE.ringMinAxisView) / PLACE.ringAxisBand);

    // Which way is the back of the hand? From finger curl
    _n2.copy(frame.normal);
    const curl = dorsalSideFromCurl(hand, this, _n2);
    if (curl !== 0) entry.dorsalSide = curl;
    else if (entry.dorsalSide === undefined) entry.dorsalSide = handSign(pick.isRight);
    _n2.multiplyScalar(PLACE.ringStoneOnBackOfHand ? entry.dorsalSide : -entry.dorsalSide);

    // A second copy, forced toward the lens
    _n3.copy(frame.normal);
    if (_n3.z < 0) _n3.negate();

    // Scale: fitted by the model's HOLE, so the finger fills it exactly
    const fingerWidth = this._ringFingerWidth(entry, hand, finger);
    if (!(fingerWidth > 1e-4)) {
      this._ringGate(entry, 0);
      this._reportFingerConfidence(tracking, finger.key, 0);
      return false;
    }
    const fingerRadius = fingerWidth * 0.5;

    const inner = entry.analysis?.innerRadius || 0;
    const scale = Math.max(
      inner > 1e-4
        ? (fingerRadius * PLACE.ringHoleFit) / inner
        : fingerWidth * PLACE.ringWidth,
      PLACE.ringMinPx,
    ) * (entry.tuning.scale ?? 1);

    // Seat + depth push
    _pos.copy(_v1)
      .addScaledVector(axis, axisLen * PLACE.ringSeat)
      .addScaledVector(_n3, -fingerRadius * PLACE.ringDepth);

    // Orientation
    basisQuat(axis, _n2, _q1);

    // IS THIS FINGER REALLY VISIBLE?
    //
    // Five independent signals, multiplied, so any one of them failing on its
    // own is enough to take the ring away:
    //   shape      — is it extended and proportioned like a real finger
    //   axis       — is it lying across the image rather than pointing at us
    //   clearance  — is another finger folded in front of it
    //   steadiness — are its landmarks observations or guesses
    //   coverage   — is the other hand over the top of it
    // Then the gate turns that number into a stable yes or no.
    const clearance = fingerClearance(hand, this, finger, _pos, fingerWidth);
    const steadiness = this._fingerSteadiness(entry, hand, finger);
    const covered = this._handCoverage(_pos, tracking, hand);

    const confidence = this._outOfFrame(_pos, scale)
      ? 0
      : pick.quality * axisScore * clearance * steadiness * (1 - covered);

    this._reportFingerConfidence(tracking, finger.key, confidence);

    if (!this._ringGate(entry, confidence)) return false;

    this._markAnchor('ring', _pos, 0xff44aa);

    // Full opacity as soon as the finger is comfortably visible, fading out only
    // across the gate's own hysteresis band — a ring rendered at 60% because its
    // confidence happened to be 0.6 just looks like a rendering fault.
    const alpha = clamp01(
      (confidence - RING_HIDE_LEVEL) / Math.max(RING_SHOW_LEVEL - RING_HIDE_LEVEL, 1e-6),
    );
    if (alpha <= 0.01) return false;

    const inst = entry.instances[0];
    this.place(inst, _pos, scale, _q1, true, alpha);

    // Occluder: the mask has to FILL the ring's hole
    const st = inst.state;
    _v6.set(0, 1, 0).applyQuaternion(st.quaternion);   // finger axis
    _v3.set(0, 0, 1).applyQuaternion(st.quaternion);   // back-of-hand dir
    if (_v3.z < 0) _v3.negate();                       // → toward camera

    const holeRadius = inner > 1e-4 ? inner * scale : fingerRadius;
    const radiusRatio = Math.min(holeRadius * 0.99, fingerRadius * 1.15)
      / Math.max(scale, 1e-6);
    const lengthRatio = (axisLen * 2.6) / Math.max(scale, 1e-6);
    const maskRadius = st.scale * radiusRatio;

    _mPos.set(st.position.x, st.position.y, st.depth)
      // Undo the seat push, back onto the finger's own centre line
      .addScaledVector(_v3, fingerRadius * PLACE.ringDepth)
      // Seat point → middle of the phalanx, where the mask is centred
      .addScaledVector(_v6, axisLen * (0.5 - PLACE.ringSeat));
    _mScale.set(maskRadius, st.scale * lengthRatio, maskRadius);

    this._placeMask(this.occluders.finger, 'finger', _mPos, st.quaternion, _mScale, false);

    return true;
  }

  // Are these two slots really holding the same physical hand? When one hand leaves
  _sameHand(a, b) {
    if (!a || !b) return false;

    let sum = 0;
    for (const i of SAME_HAND_POINTS) {
      if (!a[i] || !b[i]) return false;
      sum += this.dist2D(a[i], b[i]);
    }

    // Judged against the hands' own size
    const span = Math.max(
      this.dist2D(a[HAND.indexMcp], a[HAND.pinkyMcp]),
      this.dist2D(b[HAND.indexMcp], b[HAND.pinkyMcp]),
      1e-3,
    );
    return sum / SAME_HAND_POINTS.length < span * SAME_HAND_LIMIT;
  }

  // Bangles are worn as a pair, so instance 0 follows one hand and instance 1 the other
  updateBangles(entry, tracking) {
    const hands = [tracking.leftHand, tracking.rightHand];
    const sides = [tracking.leftHandIsRight, tracking.rightHandIsRight];
    const misses = [tracking.leftHandMiss, tracking.rightHandMiss];
    let placed = 0;

    // One wrist wears one bangle
    if (this._sameHand(hands[0], hands[1])) {
      const stale = (misses[0] ?? 0) >= (misses[1] ?? 0) ? 0 : 1;
      hands[stale] = null;
    }

    for (let i = 0; i < entry.instances.length; i++) {
      const hand = hands[i];
      // Each wrist is judged entirely on its own evidence, so one hand leaving the picture…
      const alpha = (hand && hand.length >= 21 && allInFrame(hand, WRIST_CHAIN))
        ? freshness(misses[i])
        : 0;

      if (alpha <= 0.01) {
        this.place(entry.instances[i], _pos, 1, _q1.identity(), false);
        this._forgetMask(`forearm${i}`);
        continue;
      }
      if (this._placeBangle(entry, entry.instances[i], hand, i, sides[i], alpha, tracking)) {
        placed++;
      }
    }

    // Single-instance fallback:
    if (!placed && entry.instances.length === 1) {
      const hand = tracking.primaryHand;
      if (!hand || hand.length < 21 || !allInFrame(hand, WRIST_CHAIN)) return false;
      const alpha = freshness(tracking.primaryHandMiss);
      if (alpha <= 0.01) return false;
      if (this._placeBangle(
        entry, entry.instances[0], hand, 0, tracking.primaryHandIsRight, alpha, tracking,
      )) {
        placed++;
      }
    }
    return placed > 0;
  }

  /**
   * The WRIST's own frame, fitted to the base of the palm instead of to the
   * knuckle fan.
   *
   * _handFrame is built from the four MCPs, which is the right bone for a ring
   * — the ring sits among them. It is the wrong one for a bangle:
   *
   *   · its `across` axis runs 5→17, so splaying the fingers turns it, and the
   *     bangle rolls on a wrist that never moved;
   *   · it needs the knuckle triangles to agree (MIN_PALM_AGREEMENT), and they
   *     stop agreeing the moment the hand closes — so a fist used to make the
   *     bangle vanish outright;
   *   · nothing in it is anchored to the carpus, which is the part of the hand
   *     that actually rotates with the forearm.
   *
   * This one runs `across` from the thumb's CMC (1) to the little finger's MCP
   * (17). Both are carried on the palm's base, so the axis turns with the wrist
   * and holds through a fist. `along` keeps a long baseline for steadiness, from
   * the wrist to the midpoint of the knuckle row.
   */
  _wristFrame(hand) {
    const wrist = hand[HAND.wrist];
    const thumb = hand[HAND.thumbCmc];
    const index = hand[HAND.indexMcp];
    const pinky = hand[HAND.pinkyMcp];
    if (!wrist || !thumb || !index || !pinky) return null;

    this.lmToScreen(wrist, _wfWrist);
    this.lmToScreen(thumb, _wfThumb);
    this.lmToScreen(index, _wfIndex);
    this.lmToScreen(pinky, _wfPinky);

    // Wrist → hand. Two landmarks averaged, and a long way from the wrist, so
    // the direction is far steadier than either knuckle would give on its own.
    _wfBase.addVectors(_wfIndex, _wfPinky).multiplyScalar(0.5);
    _wfAlong.subVectors(_wfBase, _wfWrist);
    if (_wfAlong.lengthSq() < 1e-9) return null;
    _wfAlong.normalize();

    // Across the base of the palm, then squared to the axis above
    _wfAcross.subVectors(_wfPinky, _wfThumb);
    _wfAcross.addScaledVector(_wfAlong, -_wfAlong.dot(_wfAcross));
    if (_wfAcross.lengthSq() < 1e-9) return null;
    _wfAcross.normalize();

    _wfNormal.crossVectors(_wfAcross, _wfAlong);
    if (_wfNormal.lengthSq() < 1e-9) return null;
    _wfNormal.normalize();

    return _wristFrameOut;
  }

  // Wrist thickness. See WRIST_CAL_SQUARENESS for why the extra spans have to be
  // calibrated before they can be believed.
  _wristWidth(entry, hand, slot, frame) {
    const primary = this.dist3D(hand[HAND.indexMcp], hand[HAND.pinkyMcp]);
    if (!(primary > 1e-4)) return 0;

    const base = this.dist3D(hand[HAND.thumbCmc], hand[HAND.pinkyMcp]);
    const length = this.dist3D(hand[HAND.wrist], hand[HAND.middleMcp]);

    const calKey = slot === 1 ? 'wristCalB' : 'wristCalA';
    const cal = entry[calKey] || (entry[calKey] = { base: 0, length: 0 });

    // Palm square to the lens means nothing is foreshortened, so all three spans
    // are measuring what they claim to and it is safe to learn how they relate.
    if (Math.abs(frame.normal.z) > WRIST_CAL_SQUARENESS && base > 1e-4 && length > 1e-4) {
      const k = adapt(WRIST_CAL_SMOOTH, this._dtScale);
      const toBase = primary / base;
      const toLength = primary / length;
      cal.base = cal.base > 0 ? cal.base + (toBase - cal.base) * k : toBase;
      cal.length = cal.length > 0 ? cal.length + (toLength - cal.length) * k : toLength;
    }

    const cues = [primary];
    if (cal.base > 0 && base > 1e-4) cues.push(base * cal.base);
    if (cal.length > 0 && length > 1e-4) cues.push(length * cal.length);
    cues.sort((a, b) => a - b);

    const target = cues[Math.floor(cues.length / 2)] * PLACE.wristFromPalm;

    const widthKey = slot === 1 ? 'wristWidthB' : 'wristWidthA';
    const prev = entry[widthKey] || 0;
    entry[widthKey] = prev > 0
      ? prev + (target - prev) * adapt(LIMB_WIDTH_SMOOTH, this._dtScale)
      : target;
    return entry[widthKey];
  }

  // Elbow → wrist, from Pose, for whichever arm this hand belongs to
  _forearmAxis(hand, tracking, out) {
    const pose = tracking?.pose;
    if (!pose || pose.length <= POSE.rightWrist) return 0;

    const handWrist = hand[HAND.wrist];
    if (!handWrist) return 0;

    // Match by position, not by side:
    let best = null;
    let bestDist = FOREARM_MATCH_RADIUS;
    for (const [elbowIdx, wristIdx] of FOREARM_PAIRS) {
      const elbow = pose[elbowIdx];
      const wrist = pose[wristIdx];
      if (!elbow || !wrist) continue;
      const seen = Math.min(elbow.visibility ?? 0, wrist.visibility ?? 0);
      if (seen < FOREARM_MIN_VISIBILITY) continue;
      const d = Math.hypot(wrist.x - handWrist.x, wrist.y - handWrist.y);
      if (d < bestDist) { bestDist = d; best = { elbow, wrist, seen }; }
    }
    if (!best) return 0;

    this.lmToScreen(best.elbow, _faElbow);
    this.lmToScreen(best.wrist, _faWrist);
    out.subVectors(_faWrist, _faElbow);
    if (out.lengthSq() < 1e-9) return 0;
    out.normalize();

    // Trusted in proportion to how well Pose sees the arm and how closely its wrist agrees with the
    return clamp01((best.seen - FOREARM_MIN_VISIBILITY) / 0.25)
      * clamp01(1 - bestDist / FOREARM_MATCH_RADIUS);
  }

  // A bangle hangs loose on the forearm, so it is solved on the forearm's frame.
  // Returns whether it managed to place anything.
  _placeBangle(entry, inst, hand, slot, isRight, alpha = 1, tracking = null) {
    const index = slot === 1 ? 1 : 0;

    // The wrist's own frame, NOT the knuckle fan — see _wristFrame
    const frame = this._wristFrame(hand);
    if (!frame) {
      this.place(inst, _pos, 1, _q1.identity(), false);
      this._forgetMask(`forearm${index}`);
      return false;
    }

    this.lmToScreen(hand[HAND.wrist], _v1);

    // Forearm axis: the hand only ever gives an approximation of it — the palm is hinged at the wrist
    _n1.copy(frame.along).negate();                   // knuckles → wrist, toward the elbow
    const trust = this._forearmAxis(hand, tracking || this._tracking, _v7);
    if (trust > 0) {
      _v7.negate();                                   // elbow → wrist, reversed
      // Only if the two broadly agree; a mismatch means Pose latched the wrong arm
      if (_v7.dot(_n1) > 0.2) _n1.lerp(_v7, trust * PLACE.forearmTrust).normalize();
    }

    // Roll: which way the back of the hand faces
    _n2.copy(frame.normal);
    const curl = dorsalSideFromCurl(hand, this, _n2);
    const key = slot === 1 ? 'dorsalSideB' : 'dorsalSideA';
    if (curl !== 0) entry[key] = curl;
    else if (entry[key] === undefined) entry[key] = handSign(isRight);
    _n2.multiplyScalar(entry[key]);

    // Made square to the forearm axis actually in use, not to the palm's
    _n2.addScaledVector(_n1, -_n1.dot(_n2));
    if (_n2.lengthSq() < 1e-9) {
      this.place(inst, _pos, 1, _q1.identity(), false);
      this._forgetMask(`forearm${index}`);
      return false;
    }
    _n2.normalize();

    // A second copy forced toward the lens — seat correction only, never orientation
    _n3.copy(_n2);
    if (_n3.z < 0) _n3.negate();

    // Scale
    const palmWidth = this.dist3D(hand[HAND.indexMcp], hand[HAND.pinkyMcp]);
    if (!(palmWidth > 1e-4)) {
      this.place(inst, _pos, 1, _q1.identity(), false);
      this._forgetMask(`forearm${index}`);
      return false;
    }

    const wristWidth = this._wristWidth(entry, hand, slot, frame);
    if (!(wristWidth > 1e-4)) {
      this.place(inst, _pos, 1, _q1.identity(), false);
      this._forgetMask(`forearm${index}`);
      return false;
    }
    const wristRadius = wristWidth * 0.5;

    // Fitted by the model's own hole
    const inner = entry.analysis?.innerRadius || 0;
    const scale = Math.max(
      inner > 1e-4
        ? (wristRadius * PLACE.bangleHoleFit) / inner
        : wristWidth * PLACE.bangleWidth,
      PLACE.bangleMinPx,
    ) * (entry.tuning.scale ?? 1);

    const holeRadius = inner > 1e-4 ? inner * scale : wristRadius * PLACE.bangleHoleFit;
    const slack = Math.max(holeRadius - wristRadius, 0);

    // Seat
    _pos.copy(_v1)
      .addScaledVector(_n1, wristWidth * PLACE.bangleSlide)
      .addScaledVector(_n3, -wristRadius * PLACE.bangleDepth);

    // A real bangle is loose and gravity parks it on the underside of the wrist
    const sag = slack * PLACE.bangleSag;
    _v6.set(0, -1, 0).addScaledVector(_n1, _n1.y);   // screen-down, square to the arm
    if (_v6.lengthSq() > 1e-9) {
      _v6.normalize();
      _pos.addScaledVector(_v6, sag);
    } else {
      _v6.set(0, 0, 0);
    }

    // Orientation
    basisQuat(_n1, _n2, _q1);

    // Gone from the picture, or covered by the OTHER hand
    this._markAnchor(`wrist${index}`, _pos, 0xff8800);

    const visible = alpha * (1 - this._handCoverage(_pos, this._tracking, hand));
    if (this._outOfFrame(_pos, scale) || visible <= 0.01) {
      this.place(inst, _pos, scale, _q1, false);
      this._forgetMask(`forearm${index}`);
      return false;
    }

    this.place(inst, _pos, scale, _q1, true, visible);

    // Occluder: an ELLIPTICAL forearm, sized to the real wrist rather than to the bangle
    const st = inst.state;
    _v3.set(0, 1, 0).applyQuaternion(st.quaternion);   // forearm axis, smoothed
    _v4.set(0, 0, 1).applyQuaternion(st.quaternion);   // wrist depth axis, smoothed
    if (_v4.z < 0) _v4.negate();

    // Screen-down in the smoothed frame, so the sag can be taken back off
    _v8.set(0, -1, 0).addScaledVector(_v3, _v3.y);
    if (_v8.lengthSq() > 1e-9) _v8.normalize();
    else _v8.set(0, 0, 0);

    const inv = 1 / Math.max(scale, 1e-6);
    const toHand = palmWidth * PLACE.forearmMaskToHand;
    const toElbow = palmWidth * PLACE.forearmMaskToElbow;

    _mPos.set(st.position.x, st.position.y, st.depth)
      // The arm does not sag with the bangle, and it does not take the seat push
      .addScaledVector(_v8, -st.scale * sag * inv)
      .addScaledVector(_v4, st.scale * wristRadius * PLACE.bangleDepth * inv)
      // Centre of a mask that reaches further up the arm than down it
      .addScaledVector(_v3, st.scale * (toElbow - toHand) * 0.5 * inv);

    // Ratios, so the mask inherits the bangle's smoothed size along with its pose
    const wide = st.scale * wristRadius * inv;
    _mScale.set(wide, st.scale * (toElbow + toHand) * inv, wide * PLACE.wristDepthRatio);
    this._placeMask(
      this.occluders.forearm[index], `forearm${index}`, _mPos, st.quaternion, _mScale, false,
    );

    return true;
  }

  // Frame update

  update(tracking) {
    // A null tracking result means "nothing detected"
    if (!tracking) tracking = {};

    // Frame timing
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const elapsed = this._lastFrameTime ? (now - this._lastFrameTime) / 1000 : 1 / 60;
    this._lastFrameTime = now;
    this._dtScale = Math.min(Math.max(elapsed * 60, 0.25), 3);

    // How stale the face landmarks are this frame
    this._faceMiss = tracking.faceMiss ?? 0;
    // Held for the helpers reached through the per-category updates, which do not carry the…
    this._tracking = tracking;

    // Anchor dots are opt-in per frame, like the masks
    if (this.showAnchors) {
      for (const mark of this._anchorMarks.values()) mark.visible = false;
    }

    // Occluders are opt-in per frame:
    this._resetOccluders();

    // One head-pose solve per frame
    this._updateHeadPose(tracking.face);
    this._updateTorsoPose(tracking.pose);

    for (const [, entry] of this.activeItems) {
      let ok = false;
      try {
        if (entry.category === 'necklace') ok = this.updateNecklace(entry, tracking);
        else if (entry.category === 'earring') ok = this.updateEarrings(entry, tracking);
        else if (entry.category === 'ring') ok = this.updateRing(entry, tracking);
        else if (entry.category === 'bangles') ok = this.updateBangles(entry, tracking);
      } catch (err) {
        // A throw here is not a tracking problem, it is a bug in the placement code — and its…
        const signature = String(err && err.message ? err.message : err);
        if (entry.lastError !== signature) {
          entry.lastError = signature;
          console.error(
            `[Engine3D] "${entry.id}" could not be placed, so it will not appear. `
            + 'This is a bug in its placement code, not a tracking failure.',
            err,
          );
        }
        ok = false;
      }
      if (!ok) this.hide(entry);
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  // Which trackers actually need to run this frame, and how many hands
  requiredTrackers() {
    let face = false;
    let hands = false;
    let pose = false;
    let handCount = 1;
    // The accurate hand model, needed only when a piece sits ON the hand
    let precise = false;

    for (const [, entry] of this.activeItems) {
      if (entry.category === 'necklace' || entry.category === 'earring') {
        face = true;
        // Hands are tracked for face jewellery too, purely so a hand raised over an ear or a…
        if (HIDE_UNDER_HANDS) { hands = true; handCount = 2; }
      }
      if (entry.category === 'necklace') pose = true;
      if (entry.category === 'ring' || entry.category === 'bangles') hands = true;
      // Only the ring reads individual finger joints
      if (entry.category === 'ring') precise = true;
      // A bangle rides the forearm, so Pose's elbow is what keeps it off the hand
      if (entry.category === 'bangles') pose = true;
      // A paired bangle needs both wrists detected
      if (entry.category === 'bangles' && entry.instances.length === 2) handCount = 2;
    }
    return { face, hands, pose, handCount, precise };
  }

  // Composites the camera frame and the rendered jewellery into one canvas
  captureComposite(video) {
    // Guarantee the overlay is present in the drawing buffer we are about to read
    this.renderer.render(this.scene, this.camera);

    const dpr = this.renderer.getPixelRatio();
    const w = this.width;
    const h = this.height;

    const composite = document.createElement('canvas');
    composite.width = Math.max(1, Math.round(w * dpr));
    composite.height = Math.max(1, Math.round(h * dpr));

    const ctx = composite.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(dpr, dpr);

    // Draw the video with the same mirror + cover crop the page uses
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    if (video && video.readyState >= 2) {
      ctx.drawImage(video, this.offX, this.offY, this.dispW, this.dispH);
    }
    ctx.restore();

    // The overlay canvas is dpr-sized internally
    ctx.drawImage(this.renderer.domElement, 0, 0, w, h);
    return composite;
  }

  // Kept for callers that want a data URL
  screenshot(video) {
    return this.captureComposite(video).toDataURL('image/png');
  }

  // Live tuning (used by the ?tune=1 panel)

  getTuning(id) {
    return this.activeItems.get(id)?.tuning ?? null;
  }

  // `scale`, `offset*`, `anchor` and the material overrides apply instantly
  updateTuning(id, patch) {
    const entry = this.activeItems.get(id);
    if (!entry) return null;

    const template = this.modelCache.get(entry.cacheKey);
    if (!template) return null;

    Object.assign(template.tuning, patch);
    MODEL_TUNING[template.folder] = {
      ...(MODEL_TUNING[template.folder] || {}),
      ...patch,
    };
    saveTuning();

    // Material overrides go straight onto the live materials — both the instances on screen…
    if (['metalness', 'roughness', 'envIntensity'].some((k) => k in patch)) {
      const override = MODEL_TUNING[template.folder];
      for (const inst of entry.instances) {
        inst.materials.forEach((m) => applyMaterialOverride(m, override));
      }
      template.object.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => applyMaterialOverride(m, override));
      });
    }

    const needsRebake = ['rotX', 'rotY', 'rotZ', 'autoOrient', 'fitAxis', 'pair', 'pairMirror']
      .some((k) => k in patch);

    if (needsRebake) {
      template.analysis = normalizeModel(template.object, template.category, template.tuning);
    }

    const t = template.tuning;
    template.anchorOffset.set(
      t.offsetX || 0,
      (t.anchor === 'top' ? -template.analysis.normHeight / 2 : 0) + (t.offsetY || 0),
      t.offsetZ || 0,
    );

    if (needsRebake) {
      this.deactivate(id);
      this.activate(id, template);
    } else {
      entry.tuning = t;
      entry.analysis = template.analysis;
      for (const inst of entry.instances) inst.pivot.position.copy(template.anchorOffset);
    }
    return t;
  }
}

// Model normalisation

// Orients the model, centres it, and rescales it so the category's fit axis measures…
function normalizeModel(object, category, tuning) {
  // Undo any geometry the necklace wrap baked in on a previous pass, so this function…
  restoreBaseGeometry(object);

  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.scale.set(1, 1, 1);
  object.updateMatrixWorld(true);

  const rawBox = new THREE.Box3().setFromObject(object);
  const rawSize = rawBox.getSize(new THREE.Vector3());

  if (tuning.autoOrient !== false) {
    applyCanonicalRotation(object, rawSize, category);
  }

  // The tuner's rotation sliders, applied in WORLD space for the same reason the…
  rotateWorld(object, 1, 0, 0, (tuning.rotX || 0) * DEG);
  rotateWorld(object, 0, 1, 0, (tuning.rotY || 0) * DEG);
  rotateWorld(object, 0, 0, 1, (tuning.rotZ || 0) * DEG);
  object.updateMatrixWorld(true);

  // Measure AFTER rotating
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  const fit = tuning.fitAxis === 'y' ? size.y : tuning.fitAxis === 'z' ? size.z : size.x;
  const norm = 1 / Math.max(fit, 1e-6);

  // matrix = T · R · S, so a geometry point maps to `position + R·(s·p)`
  object.scale.setScalar(norm);
  object.position.copy(center).multiplyScalar(-norm);
  object.updateMatrixWorld(true);

  const normSize = size.clone().multiplyScalar(norm);

  // Pivot correction: necklaces get their own treatment
  let opening = null;
  let wrapped = false;
  if (category === 'necklace') {
    opening = findNeckOpening(object);
    if (opening) {
      object.position.sub(opening.center);
      object.updateMatrixWorld(true);

      // Bend a flat necklace around the neck — see wrapNecklaceAroundNeck
      if (normSize.z < normSize.x * NECK_WRAP_FLATNESS) {
        bakeTransformIntoGeometry(object);
        wrapNecklaceAroundNeck(object, opening.width * 0.5);
        object.updateMatrixWorld(true);
        wrapped = true;
      }
    }
  }

  const pivot = opening ? null : findPivot(object, category, norm);
  if (pivot) {
    object.position.addScaledVector(pivot, -1);
    object.updateMatrixWorld(true);
  }

  // How far the piece hangs below its opening, measured after the origin has been moved…
  let dropBelow = normSize.y * 0.5;
  let riseAbove = normSize.y * 0.5;
  let frontRise = riseAbove;
  if (opening) {
    const finalBox = new THREE.Box3().setFromObject(object);
    if (Number.isFinite(finalBox.min.y)) dropBelow = Math.max(-finalBox.min.y, 0);
    if (Number.isFinite(finalBox.max.y)) riseAbove = Math.max(finalBox.max.y, 0);
    // Only a wrap sorts front from back; without one, assume the worst
    frontRise = wrapped ? measureFrontRise(object, opening.width * 0.5) : riseAbove;
  }

  // A ring and a bangle are both worn THROUGH their hole
  const hoop = (category === 'ring' || category === 'bangles')
    ? measureHoopRadii(object)
    : null;

  return {
    rawSize,
    normSize,
    normWidth: normSize.x,
    normHeight: normSize.y,
    normDepth: normSize.z,
    pivot: pivot || new THREE.Vector3(),
    // Width of the neck opening, in the same normalised units as normWidth
    openWidth: opening ? opening.width : normSize.x,
    dropBelow,
    // How far the piece extends ABOVE its opening — for a necklace, how high the chain arcs…
    riseAbove,
    // The same, counting only what ends up in FRONT of the neck — the chin clearance
    frontRise,
    // 0 when there is no measurable hole; the caller falls back to width sizing
    innerRadius: hoop ? hoop.innerRadius : 0,
    outerRadius: hoop ? hoop.outerRadius : normSize.x * 0.5,
    // Did this necklace get bent onto a cylinder? Its occluder depends on it
    wrapped,
  };
}

// Inner and outer radius of a hoop, about its own axis, in normalised units
function measureHoopRadii(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (!Number.isFinite(box.min.x) || !Number.isFinite(box.min.z)) return null;

  const cx = (box.min.x + box.max.x) * 0.5;
  const cz = (box.min.z + box.max.z) * 0.5;

  const radii = [];
  object.traverse((child) => {
    if (!child.isMesh) return;
    const pos = child.geometry?.attributes?.position;
    if (!pos || !pos.count) return;
    const step = Math.max(1, Math.floor(pos.count / 8000));
    for (let i = 0; i < pos.count; i += step) {
      _pv.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      if (!Number.isFinite(_pv.x) || !Number.isFinite(_pv.z)) continue;
      radii.push(Math.hypot(_pv.x - cx, _pv.z - cz));
    }
  });

  if (radii.length < 64) return null;
  radii.sort((a, b) => a - b);

  const at = (f) => radii[Math.min(radii.length - 1, Math.floor(radii.length * f))];
  // Percentiles rather than the extremes, so one stray vertex cannot define the hole
  const inner = at(HOOP_INNER_PERCENTILE);
  const outer = at(1 - HOOP_INNER_PERCENTILE);
  if (!(outer > 1e-6)) return null;

  // No real hole — a solid pendant-like shape
  if (inner < outer * HOOP_MIN_HOLE) return null;

  return { innerRadius: inner, outerRadius: outer };
}

// Where the hole edge is taken from in the sorted radii
const HOOP_INNER_PERCENTILE = 0.02;
const HOOP_MIN_HOLE = 0.25;

// A necklace flatter than this fraction of its own width is a planar cut-out and gets…
const NECK_WRAP_FLATNESS = 0.25;

// Exactly a quarter turn, and it MUST be exactly that
const NECK_WRAP_ANGLE = 90 * DEG;

// A loop needs this much material above its opening to count as having a back
const NECK_BACK_MIN = 0.05;

// How much of that rise the swing to the back is spread over
const NECK_BACK_BLEND = 0.5;

// Bends a flat necklace onto the neck
function wrapNecklaceAroundNeck(object, radius) {
  if (!(radius > 1e-6)) return;

  // How far the loop reaches above its opening — the rear chain's own extent
  let rise = 0;
  object.traverse((child) => {
    if (!child.isMesh) return;
    const attr = child.geometry?.attributes?.position;
    if (!attr || !attr.count) return;
    const a = attr.array;
    for (let i = 1; i < a.length; i += 3) if (a[i] > rise) rise = a[i];
  });

  // An open arc has no rear chain to place, so it keeps the front mapping throughout
  const span = rise > NECK_BACK_MIN ? rise * NECK_BACK_BLEND : 0;

  object.traverse((child) => {
    if (!child.isMesh) return;
    const attr = child.geometry?.attributes?.position;
    if (!attr || !attr.count) return;

    const a = attr.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i] / radius;                      // -1
      const u = t < -1 ? -1 : t > 1 ? 1 : t;

      const front = u * NECK_WRAP_ANGLE;
      // Mirrors the front branch about the sides
      const back = (u < 0 ? -1 : 1) * NECK_WRAP_ANGLE * (2 - Math.abs(u));

      const y = a[i + 1];
      const blend = (span > 0 && y > 0) ? (y >= span ? 1 : y / span) : 0;
      const angle = front + (back - front) * blend;

      const sin = Math.sin(angle);
      const cos = Math.cos(angle);

      // The model's own depth becomes height above the cylinder
      const r = radius + a[i + 2];
      // Anything wider than the opening — an unusually broad pendant — runs on along the…
      const overrun = (t - u) * radius;

      a[i] = r * sin + overrun * cos;
      a[i + 2] = r * cos - overrun * sin;
      // Height is untouched:
    }

    attr.needsUpdate = true;
    const g = child.geometry;
    g.deleteAttribute('normal');
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
  });
}

// Only the front 120° of the neck is under the chin; the rest is off to the side or behind it
const NECK_FRONT_CONE = 0.5;

// How far the piece rises above its anchor at the FRONT, where it could reach the chin
function measureFrontRise(object, radius) {
  object.updateMatrixWorld(true);
  const near = radius * NECK_FRONT_CONE;
  let rise = 0;
  object.traverse((child) => {
    if (!child.isMesh) return;
    const pos = child.geometry?.attributes?.position;
    if (!pos || !pos.count) return;
    const step = Math.max(1, Math.floor(pos.count / 8000));
    for (let i = 0; i < pos.count; i += step) {
      _pv.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      if (!Number.isFinite(_pv.y) || !Number.isFinite(_pv.z)) continue;
      // Anything off to the side or behind cannot reach the wearer's chin
      if (_pv.z <= near) continue;
      if (_pv.y > rise) rise = _pv.y;
    }
  });
  return rise;
}

// Folds the object's transform into its vertices and resets it to identity
function bakeTransformIntoGeometry(object) {
  object.updateMatrixWorld(true);

  // Shared geometry is split rather than skipped: baking one mesh's matrix into
  // a buffer two meshes draw from would move both, and skipping the second then
  // zeroing its transform below would drop it onto the first one
  const drawn = [];
  object.traverse((child) => { if (child.isMesh && child.geometry) drawn.push(child); });
  giveEachMeshItsOwnGeometry(drawn);

  for (const child of drawn) {
    rememberBaseGeometry(child.geometry);
    child.geometry.applyMatrix4(child.matrixWorld);
  }

  object.traverse((child) => {
    child.position.set(0, 0, 0);
    child.rotation.set(0, 0, 0);
    child.scale.set(1, 1, 1);
  });
  object.updateMatrixWorld(true);
}

// Keeps one pristine copy of a geometry's vertices, so normalisation can be re-run from…
function rememberBaseGeometry(geometry) {
  const attr = geometry?.attributes?.position;
  if (!attr || geometry.userData.basePosition) return;
  geometry.userData.basePosition = Float32Array.from(attr.array);
}

function restoreBaseGeometry(object) {
  object.traverse((child) => {
    const g = child.geometry;
    const base = g?.userData?.basePosition;
    if (!base || !g.attributes?.position) return;
    g.attributes.position.array.set(base);
    g.attributes.position.needsUpdate = true;
    g.deleteAttribute('normal');
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
  });
}

// How many horizontal slices the neck-opening scan uses
const OPENING_BANDS = 48;

// Locates a necklace's neck opening — the hole the wearer's neck goes through
function findNeckOpening(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const span = box.max.y - box.min.y;
  if (!Number.isFinite(span) || span < 1e-9) return null;

  const lo = new Float64Array(OPENING_BANDS).fill(Infinity);
  const hi = new Float64Array(OPENING_BANDS).fill(-Infinity);
  const zSum = new Float64Array(OPENING_BANDS);
  const ySum = new Float64Array(OPENING_BANDS);
  const count = new Float64Array(OPENING_BANDS);

  object.traverse((child) => {
    if (!child.isMesh) return;
    const pos = child.geometry?.attributes?.position;
    if (!pos || !pos.count) return;
    const step = Math.max(1, Math.floor(pos.count / 12000));
    for (let i = 0; i < pos.count; i += step) {
      _pv.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      if (!Number.isFinite(_pv.x) || !Number.isFinite(_pv.y) || !Number.isFinite(_pv.z)) continue;
      let b = Math.floor(((_pv.y - box.min.y) / span) * OPENING_BANDS);
      b = b < 0 ? 0 : b >= OPENING_BANDS ? OPENING_BANDS - 1 : b;
      if (_pv.x < lo[b]) lo[b] = _pv.x;
      if (_pv.x > hi[b]) hi[b] = _pv.x;
      zSum[b] += _pv.z;
      ySum[b] += _pv.y;
      count[b] += 1;
    }
  });

  // Only the UPPER part of the model is considered
  const searchFrom = Math.floor(OPENING_BANDS * 0.40);

  let best = -1;
  let bestWidth = 0;
  const scan = (from) => {
    for (let b = from; b < OPENING_BANDS; b++) {
      // Ignore bands too sparse to be a real cross-section
      if (count[b] < 8 || hi[b] < lo[b]) continue;
      const width = hi[b] - lo[b];
      if (width > bestWidth) {
        bestWidth = width;
        best = b;
      }
    }
  };

  scan(searchFrom);
  // Nothing usable up there (a very unusual model)
  if (best < 0) scan(0);

  if (best < 0 || bestWidth < 1e-6) return null;

  return {
    center: new THREE.Vector3(
      (lo[best] + hi[best]) * 0.5,
      ySum[best] / count[best],
      zSum[best] / count[best],
    ),
    width: bestWidth,
  };
}

// Scratch for the pivot scan — allocated once, not per model
const _pv = new THREE.Vector3();

// Scratch for world-space model rotations
const _rotAxis = new THREE.Vector3();
const _rotQuat = new THREE.Quaternion();

// Rotates a model about a WORLD axis, on top of whatever orientation it already has
function rotateWorld(object, x, y, z, angle) {
  if (!angle) return;
  _rotAxis.set(x, y, z).normalize();
  _rotQuat.setFromAxisAngle(_rotAxis, angle);
  object.quaternion.premultiply(_rotQuat);
  object.updateMatrixWorld(true);
}

// Finds the physical attachment point, in the model's post-normalisation space, as an…
function findPivot(object, category, norm) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (!Number.isFinite(box.min.y) || !Number.isFinite(box.max.y)) return null;

  const spanY = box.max.y - box.min.y;
  if (spanY < 1e-9) return null;

  const isHoop = category === 'ring' || category === 'bangles' || category === 'necklace';

  // Band to average over
  const loFrac = isHoop ? 0.42 : 0.88;
  const hiFrac = isHoop ? 0.58 : 1.0;
  const loY = box.min.y + spanY * loFrac;
  const hiY = box.min.y + spanY * hiFrac;

  let sx = 0;
  let sz = 0;
  let n = 0;

  object.traverse((child) => {
    if (!child.isMesh) return;
    const pos = child.geometry?.attributes?.position;
    if (!pos || !pos.count) return;
    // Same sampling budget as the flip test
    const step = Math.max(1, Math.floor(pos.count / 8000));
    for (let i = 0; i < pos.count; i += step) {
      _pv.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      if (!Number.isFinite(_pv.x) || !Number.isFinite(_pv.y) || !Number.isFinite(_pv.z)) continue;
      if (_pv.y < loY || _pv.y > hiY) continue;
      sx += _pv.x; sz += _pv.z; n++;
    }
  });

  // Too few samples to be meaningful
  if (n < 12) return null;

  const cx = sx / n;
  const cz = sz / n;

  // Only X/Z are corrected for a hoop:
  const out = new THREE.Vector3(cx, 0, cz);

  // Refuse absurd corrections:
  const limit = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.34;
  if (out.length() > limit) return null;

  return out;
}

// Bounding-box guess at how the model is laid out in its source file
function applyCanonicalRotation(object, size, category) {
  const dims = [size.x, size.y, size.z];
  const thin = dims.indexOf(Math.min(...dims));

  if (category === 'ring' || category === 'bangles') {
    // thin axis → +Y
    if (thin === 0) object.rotation.z = Math.PI / 2;
    else if (thin === 2) object.rotation.x = -Math.PI / 2;
    // thin 1 is already correct
  } else {
    // thin axis → +Z
    if (thin === 0) object.rotation.y = Math.PI / 2;
    else if (thin === 1) object.rotation.x = -Math.PI / 2;
    // thin 2 is already correct
  }
  object.updateMatrixWorld(true);

  // Which in-plane axis is the drop?
  if (category === 'earring') {
    const b = new THREE.Box3().setFromObject(object);
    const spanX = b.max.x - b.min.x;
    const spanY = b.max.y - b.min.y;
    if (Number.isFinite(spanX) && Number.isFinite(spanY) && spanX > spanY * 1.25) {
      rotateWorld(object, 0, 0, 1, Math.PI / 2);
      console.log('[Engine3D] stood an earring up on its long axis');
    }
  }

  // The step above gets the piece standing in the right plane
  if (category === 'earring' || category === 'necklace') {
    if (needsUpFlip(object, category)) {
      rotateWorld(object, 0, 0, 1, Math.PI);
      console.log(`[Engine3D] auto-flipped an inverted ${category} model`);
    }
  }

  // Which way does the piece FACE?
  if (category === 'ring' || category === 'bangles' || category === 'earring') {
    if (needsFaceFlip(object)) {
      rotateWorld(object, 0, 1, 0, Math.PI);
      console.log(`[Engine3D] auto-rotated a ${category} so its detail faces outward`);
    }
  }
}

// Which side of a ring/bangle carries its decoration? A plain band is symmetric about…
function needsFaceFlip(object) {
  object.updateMatrixWorld(true);

  // Why this is not a bounding-box test Radii are measured from the ring's own centre
  const box = new THREE.Box3().setFromObject(object);
  if (!Number.isFinite(box.min.x) || !Number.isFinite(box.min.z)) return false;
  const cx = (box.min.x + box.max.x) * 0.5;
  const cz = (box.min.z + box.max.z) * 0.5;

  const radii = [];
  const sides = [];

  object.traverse((child) => {
    if (!child.isMesh) return;
    const pos = child.geometry?.attributes?.position;
    if (!pos || !pos.count) return;
    const step = Math.max(1, Math.floor(pos.count / 6000));
    for (let i = 0; i < pos.count; i += step) {
      _pv.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      if (!Number.isFinite(_pv.x) || !Number.isFinite(_pv.z)) continue;
      radii.push(Math.hypot(_pv.x - cx, _pv.z - cz));
      sides.push(_pv.z - cz);
    }
  });

  const count = radii.length;
  if (count < 64) return false;

  // The band's own radius:
  const sorted = [...radii].sort((a, b) => a - b);
  const bandRadius = sorted[Math.floor(count * 0.5)];
  if (!(bandRadius > 1e-9)) return false;

  // Everything standing clear of the band, weighted by HOW far it stands clear, split by…
  const threshold = bandRadius * 1.12;
  let front = 0;
  let back = 0;
  for (let i = 0; i < count; i++) {
    const excess = radii[i] - threshold;
    if (excess <= 0) continue;
    if (sides[i] >= 0) front += excess;
    else back += excess;
  }

  // Normalised by the sample count and the band's own radius, so the figure means the…
  const strength = (front + back) / (count * bandRadius);
  if (strength < FACE_FLIP_MIN_STRENGTH) return false;

  // Protrudes on both sides about equally — symmetric, so the choice is invisible
  const bigger = Math.max(front, back);
  if (Math.min(front, back) > bigger * FACE_FLIP_MAX_SYMMETRY) return false;

  // The ornament should end up on +Z
  return back > front;
}

// How much material must stand proud of the band, and how lopsidedly, before the…
const FACE_FLIP_MIN_STRENGTH = 0.010;
const FACE_FLIP_MAX_SYMMETRY = 0.65;

// How lopsided the two ends must be before the flip test trusts itself
const PROFILE_BANDS = 16;
const PROFILE_RATIO = 1.2;
// The bulk test integrates a whole third of the model, so it accumulates a much larger…
const PROFILE_BULK_RATIO = 1.6;

// Decides which end of a hanging piece is the top, by comparing how wide the model is…
function endWidths(object) {
  object.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object);
  const span = box.max.y - box.min.y;
  if (!Number.isFinite(span) || span < 1e-9) return null;

  const lo = new Float64Array(PROFILE_BANDS).fill(Infinity);
  const hi = new Float64Array(PROFILE_BANDS).fill(-Infinity);
  const zLo = new Float64Array(PROFILE_BANDS).fill(Infinity);
  const zHi = new Float64Array(PROFILE_BANDS).fill(-Infinity);
  const v = new THREE.Vector3();

  object.traverse((child) => {
    if (!child.isMesh) return;
    const pos = child.geometry?.attributes?.position;
    if (!pos || !pos.count) return;
    // Sample rather than scan — a 300k-vertex model doesn't need every point to tell us which end is
    const step = Math.max(1, Math.floor(pos.count / 6000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) continue;
      let b = Math.floor(((v.y - box.min.y) / span) * PROFILE_BANDS);
      b = b < 0 ? 0 : b >= PROFILE_BANDS ? PROFILE_BANDS - 1 : b;
      if (v.x < lo[b]) lo[b] = v.x;
      if (v.x > hi[b]) hi[b] = v.x;
      if (v.z < zLo[b]) zLo[b] = v.z;
      if (v.z > zHi[b]) zHi[b] = v.z;
    }
  });

  const widest = (from, to) => {
    let w = 0;
    for (let b = from; b < to; b++) if (hi[b] >= lo[b]) w = Math.max(w, hi[b] - lo[b]);
    return w;
  };

  // Integrated cross-section — width times depth, summed over the bands
  const bulk = (from, to) => {
    let sum = 0;
    for (let b = from; b < to; b++) {
      if (hi[b] < lo[b] || zHi[b] < zLo[b]) continue;
      sum += (hi[b] - lo[b]) * Math.max(zHi[b] - zLo[b], 1e-6);
    }
    return sum;
  };

  const q = Math.max(1, Math.round(PROFILE_BANDS / 4));
  const t = Math.max(1, Math.round(PROFILE_BANDS / 3));
  return {
    top: widest(PROFILE_BANDS - q, PROFILE_BANDS),
    bottom: widest(0, q),
    topBulk: bulk(PROFILE_BANDS - t, PROFILE_BANDS),
    bottomBulk: bulk(0, t),
  };
}

// Which end of a hanging piece is its top? Two independent tests, because one was not…
function needsUpFlip(object, category) {
  const w = endWidths(object);
  if (!w) return false;

  let topNarrow;
  if (w.top * PROFILE_RATIO < w.bottom) topNarrow = true;
  else if (w.bottom * PROFILE_RATIO < w.top) topNarrow = false;
  else if (w.topBulk > 0 && w.bottomBulk > 0) {
    // Width was inconclusive — fall back to how much material each end holds
    if (w.topBulk * PROFILE_BULK_RATIO < w.bottomBulk) topNarrow = true;
    else if (w.bottomBulk * PROFILE_BULK_RATIO < w.topBulk) topNarrow = false;
    else return false;
  } else return false;

  return topNarrow !== (category === 'earring');
}

// Rhino (and a few other exporters) wrap long lines with a trailing backslash:
function sanitizeObjText(text, label) {
  let out = text;
  if (out.charCodeAt(0) === 0xfeff) out = out.slice(1); // strip BOM

  if (out.includes('\\')) {
    const before = out.length;
    out = out.replace(/\\[ \t]*\r?\n[ \t]*/g, ' ');
    if (out.length !== before) {
      console.log(`[Engine3D] ${label}: joined backslash-continued lines`);
    }
  }
  return out;
}

// Last line of defence:
function scrubNaNVertices(geometry, label) {
  const pos = geometry.attributes.position;
  if (!pos) return;
  const arr = pos.array;
  let bad = 0;
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) { arr[i] = 0; bad++; }
  }
  if (bad) {
    pos.needsUpdate = true;
    console.warn(
      `[Engine3D] ${label}: ${bad} invalid vertex value(s) were zeroed. ` +
      'The model file is malformed — re-export it if the model looks wrong.',
    );
  }
}

// Material + geometry quality

// Average luminance of the probe built below, in LINEAR light — solid-angle weighted…
const ENV_MEAN_LUMINANCE = 0.13;

// ►► HOW BRIGHT THE JEWELLERY LOOKS ◄◄
// Metal takes nearly all of its colour from what it reflects
const ENV_INTENSITY = 1.35;

// A small equirectangular studio probe, written pixel by pixel
function makeStudioEnvTexture() {
  const W = 64;
  const H = 32;
  const data = new Uint8Array(W * H * 4);

  const put = (i, v) => {
    const b = Math.round(Math.min(Math.max(v, 0), 1) * 255);
    data[i] = b;
    data[i + 1] = b;
    data[i + 2] = b;
    data[i + 3] = 255;
  };

  for (let y = 0; y < H; y++) {
    // 0 at the zenith, 1 at the nadir
    const v = y / (H - 1);
    // Sky 0.62 → horizon 0.34 → floor 0.10
    const base = v < 0.5
      ? 0.62 + (0.34 - 0.62) * (v / 0.5)
      : 0.34 + (0.10 - 0.34) * ((v - 0.5) / 0.5);

    for (let x = 0; x < W; x++) {
      const u = x / W;
      let value = base;

      // Two softboxes, front-left and front-right, a little above the horizon — the classic…
      for (const cu of [0.28, 0.72]) {
        let du = Math.abs(u - cu);
        if (du > 0.5) du = 1 - du;              // wrap around the sphere
        const dv = Math.abs(v - 0.36);
        const d = Math.hypot(du / 0.10, dv / 0.13);
        if (d < 1) value += 0.85 * (1 - d) * (1 - d);
      }

      put((y * W + x) * 4, value);
    }
  }

  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// Which direction is "out of the back of the hand"? `across × palmAxis` gives a vector…
function handSign(isRight) {
  if (isRight === true) return 1;
  if (isRight === false) return -1;
  return 1;
}

// Scratch for the finger-curl solve
const _fcChord = new THREE.Vector3();
const _fcBend = new THREE.Vector3();
const _fcSum = new THREE.Vector3();
const _fcMcp = new THREE.Vector3();
const _fcPip = new THREE.Vector3();
const _fcTip = new THREE.Vector3();

// Which side of the palm plane is the BACK OF THE HAND — measured from the hand's own…
function dorsalSideFromCurl(hand, engine, normal) {
  _fcSum.set(0, 0, 0);
  let reach = 0;

  for (const [mcpIdx, pipIdx, tipIdx] of FINGER_CHAINS) {
    const mcp = hand[mcpIdx];
    const pip = hand[pipIdx];
    const tip = hand[tipIdx];
    if (!mcp || !pip || !tip) continue;

    engine.lmToScreen(mcp, _fcMcp);
    engine.lmToScreen(pip, _fcPip);
    engine.lmToScreen(tip, _fcTip);

    // Skip a deeply flexed finger
    const path = _fcMcp.distanceTo(_fcPip) + _fcPip.distanceTo(_fcTip);
    const chord = _fcMcp.distanceTo(_fcTip);
    if (path < 1e-6 || chord / path < CURL_MIN_STRAIGHTNESS) continue;

    // Midpoint of the knuckle→tip chord:
    _fcChord.addVectors(_fcMcp, _fcTip).multiplyScalar(0.5);
    // How far, and which way, it actually departs from that line
    _fcBend.subVectors(_fcPip, _fcChord);

    _fcSum.add(_fcBend);
    reach += chord;
  }

  if (reach < 1e-3) return 0;

  // Normalised against the fingers' own length, so the threshold means the same thing…
  const signal = _fcSum.dot(normal) / reach;
  if (Math.abs(signal) < CURL_MIN_SIGNAL) return 0;
  return signal > 0 ? 1 : -1;
}

// How pronounced the collective finger bow must be, as a fraction of finger length…
const CURL_MIN_SIGNAL = 0.012;

// Minimum chord-to-bone-path ratio for a finger's bow to be read
const CURL_MIN_STRAIGHTNESS = 0.80;

// Only used when a model ships NO material at all — no MTL, no colours, nothing to be…
function defaultMetalMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xd4af37,
    metalness: 0.9,
    roughness: 0.25,
    envMapIntensity: ENV_INTENSITY,
    side: THREE.DoubleSide,
  });
}

// Translates a loaded MTL material into a physically-based one, FAITHFULLY
function toPBRMaterial(src, options) {
  const maxAnisotropy = options?.maxAnisotropy || 1;
  const override = options?.override || {};

  if (!src) return applyMaterialOverride(defaultMetalMaterial(), override);

  const tuneTexture = (tex, colour) => {
    if (!tex) return tex;
    tex.anisotropy = Math.min(maxAnisotropy, 8);
    // FBX, Collada and 3DS hand back colour maps still tagged linear, which
    // renders them washed out. A colour map is sRGB whatever wrote it.
    if (colour && 'colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  if (src.isMeshStandardMaterial || src.isMeshPhysicalMaterial) {
    // Already PBR — respect it, and only make sure it fits the scene
    src.side = THREE.DoubleSide;
    tuneTexture(src.map, true);
    tuneTexture(src.emissiveMap, true);
    // three's own default, i.e. the file said nothing. The scene's probe is a
    // small dim one, so metal left at 1 reads flat next to an OBJ piece.
    if (src.envMapIntensity === undefined || src.envMapIntensity === 1) {
      src.envMapIntensity = ENV_INTENSITY;
    }
    // Same gemstone treatment a transparent MTL gets, so a GLB stone sparkles
    if (src.transparent && src.opacity < 0.95) {
      src.envMapIntensity = ENV_INTENSITY * 1.4;
    }
    return applyMaterialOverride(src, override);
  }

  const out = new THREE.MeshPhysicalMaterial();
  out.name = src.name || '';

  // Colour, exactly as authored
  if (src.color) out.color.copy(src.color);
  out.map = tuneTexture(src.map || null, true);
  // PLY and some FBX exports state their colour per vertex instead
  out.vertexColors = src.vertexColors === true;

  if (src.emissive && out.emissive) out.emissive.copy(src.emissive);
  out.emissiveMap = tuneTexture(src.emissiveMap || null, true);
  out.alphaMap = src.alphaMap || null;
  // Deliberately not carrying aoMap across:

  // An MTL `bump` statement is frequently a real normal map that the exporter labelled as…
  if (src.normalMap) {
    out.normalMap = src.normalMap;
    if (src.normalScale) out.normalScale.copy(src.normalScale);
  } else if (src.bumpMap) {
    out.bumpMap = src.bumpMap;
    out.bumpScale = typeof src.bumpScale === 'number' ? src.bumpScale : 1;
  }

  // Specular
  if (src.specular && out.specularColor) {
    // Ks carries two things at once — how bright the highlight is and what colour it is —…
    const peak = Math.max(src.specular.r, src.specular.g, src.specular.b, 1e-4);
    out.specularColor.setRGB(
      src.specular.r / peak,
      src.specular.g / peak,
      src.specular.b / peak,
    );
    const lum = (src.specular.r + src.specular.g + src.specular.b) / 3;
    out.specularIntensity = Math.min(Math.max(lum * 2.0, 0.2), 2);
  }
  if (src.specularMap && 'specularColorMap' in out) {
    out.specularColorMap = tuneTexture(src.specularMap, true);
  }

  // Blinn-Phong exponent → roughness, by the usual approximation
  const shininess = typeof src.shininess === 'number' ? src.shininess : 30;
  out.roughness = Math.min(Math.max(Math.sqrt(2 / (shininess + 2)), 0.06), 0.9);

  // Metalness
  const ks = src.specular
    ? (src.specular.r + src.specular.g + src.specular.b) / 3
    : 0.25;
  const shiny = clamp01((shininess - 8) / 60);
  const metallic = clamp01(Math.min(shiny, clamp01(ks * 1.25)));

  out.metalness = out.map
    ? 0.30 * metallic
    : Math.min(0.35 + 0.60 * metallic, 0.95);

  out.envMapIntensity = ENV_INTENSITY;

  out.transparent = src.transparent === true;
  out.opacity = typeof src.opacity === 'number' ? src.opacity : 1;

  // Gemstones
  if (out.transparent && out.opacity < 0.95) {
    // Explicitly NOT metallic
    out.metalness = 0;
    out.roughness = Math.min(out.roughness, 0.06);
    out.ior = 2.0;
    out.specularIntensity = Math.max(out.specularIntensity, 1.4);
    out.envMapIntensity = ENV_INTENSITY * 1.4;
  }

  // Lots of exported OBJs have inconsistent face winding
  out.side = THREE.DoubleSide;

  return applyMaterialOverride(out, override);
}

// Per-folder material overrides from MODEL_TUNING
function applyMaterialOverride(material, override) {
  if (!material || !override) return material;
  if (typeof override.metalness === 'number') {
    material.metalness = Math.min(Math.max(override.metalness, 0), 1);
  }
  if (typeof override.roughness === 'number') {
    material.roughness = Math.min(Math.max(override.roughness, 0.02), 1);
  }
  if (typeof override.envIntensity === 'number') {
    material.envMapIntensity = Math.max(override.envIntensity, 0);
  }
  return material;
}

// Every MTL statement that names an image file
const MTL_TEXTURE_LINE = /^\s*(map_ka|map_kd|map_ks|map_ke|map_ns|map_d|map_bump|bump|map_refl|norm|disp|decal)\s+(\S.*)$/i;

// Removes texture statements whose image file is not actually there
const TEXTURE_EXTENSIONS = ['jpg', 'JPG', 'jpeg', 'JPEG', 'png', 'PNG', 'webp', 'WEBP'];

// Every filename worth trying for one MTL texture reference
function textureCandidates(name) {
  const out = [name];
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const dir = slash >= 0 ? name.slice(0, slash + 1) : '';
  const file = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return out;

  const stem = file.slice(0, dot);
  const ext = file.slice(dot + 1);

  // Ordered cheapest-likeliest first, and kept short
  out.push(`${dir}${stem}.${ext.toLowerCase()}`);
  out.push(`${dir}${stem}.${ext.toUpperCase()}`);
  out.push(`${dir}${stem.toLowerCase()}.${ext.toLowerCase()}`);
  for (const alt of TEXTURE_EXTENSIONS) out.push(`${dir}${stem}.${alt}`);

  return [...new Set(out)];
}

// Repairs an MTL's texture references against what is actually on disk
async function stripMissingTextures(text, basePath) {
  const lines = text.split(/\r?\n/);

  const names = lines.map((line) => {
    const m = line.match(MTL_TEXTURE_LINE);
    if (!m) return null;
    const parts = m[2].trim().split(/\s+/);
    return parts[parts.length - 1];
  });

  const seen = new Map();
  const probe = (name) => {
    if (!seen.has(name)) {
      seen.set(
        name,
        fetch(`${basePath}${encodeURI(name)}`, { method: 'HEAD', cache: 'no-cache' })
          .then((r) => (r.ok ? { ok: true, version: assetVersionSuffix(r.headers) } : { ok: false }))
          // A network error is not proof the file is missing
          .catch(() => ({ ok: true, version: '' })),
      );
    }
    return seen.get(name);
  };

  // Resolve every referenced name to whichever candidate is actually there, and carry its…
  const resolved = await Promise.all(names.map(async (name) => {
    if (!name) return null;
    for (const candidate of textureCandidates(name)) {
      const result = await probe(candidate);
      if (result.ok) return { name: candidate, version: result.version };
    }
    return false;
  }));

  const dropped = [];
  const repaired = [];

  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const name = names[i];
    if (!name) { kept.push(lines[i]); continue; }

    const found = resolved[i];
    if (found === false) {
      dropped.push(name);
      continue;
    }
    if (found.name !== name) repaired.push(`${name} → ${found.name}`);

    // Replace only the final token, leaving any `-bm 0.02` options intact
    const replacement = found.name + found.version;
    kept.push(lines[i].replace(/\S+(\s*)$/, (_, tail) => replacement + tail));
  }

  if (repaired.length) {
    console.log(`[Engine3D] ${basePath}: resolved texture name(s) — ${repaired.join(', ')}`);
  }
  if (dropped.length) {
    console.warn(
      `[Engine3D] ${basePath}: texture file(s) missing, ignoring them — `
      + `${[...new Set(dropped)].join(', ')}. `
      + 'The model will use its material colour instead.',
    );
  }

  return kept.join('\n');
}

// Welding vertices is O(n) but with a real constant, and it is done during a load the…
const SMOOTH_WELD_LIMIT = 150000;

// Makes a freshly parsed geometry safe and well-shaded
function prepareGeometry(geometry, label) {
  scrubNaNVertices(geometry, label);

  let out = geometry;
  const normals = out.attributes.normal;
  const count = out.attributes.position?.count || 0;

  if (!normals || !normalsAreUsable(normals)) {
    // Drop the unusable normals BEFORE welding, not after
    out.deleteAttribute('normal');

    if (!out.index && count > 0 && count <= SMOOTH_WELD_LIMIT) {
      try {
        const welded = BufferGeometryUtils.mergeVertices(out, 1e-5);
        if (welded && welded.attributes.position?.count) {
          out.dispose();
          out = welded;
        }
      } catch (err) {
        console.warn(`[Engine3D] ${label}: could not weld vertices for smooth shading`, err);
      }
    }

    out.computeVertexNormals();
  }

  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// A normal buffer full of zeros renders black, and some exporters emit exactly that
function normalsAreUsable(attr) {
  const n = attr.count;
  if (!n) return false;
  const step = Math.max(1, Math.floor(n / 200));
  let bad = 0;
  let seen = 0;
  for (let i = 0; i < n; i += step) {
    const x = attr.getX(i);
    const y = attr.getY(i);
    const z = attr.getZ(i);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) bad++;
    else if (x * x + y * y + z * z < 1e-8) bad++;
    seen++;
  }
  return seen > 0 && bad / seen < 0.1;
}

function cloneWithOwnMaterials(source) {
  const copy = source.clone(true);
  copy.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    child.material = Array.isArray(child.material)
      ? child.material.map((m) => m.clone())
      : child.material.clone();
  });
  return copy;
}

function collectMaterials(root) {
  const out = new Set();
  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach((m) => out.add(m));
  });
  return [...out];
}

// ASSET FRESHNESS

// Resolved version suffixes, so one asset is probed once per session
const _assetVersions = new Map();

// Short, stable, URL-safe token for an arbitrary validator string
function versionToken(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Appends a content-derived version to an asset URL
async function versionedUrl(url) {
  if (!_assetVersions.has(url)) {
    _assetVersions.set(url, (async () => {
      try {
        // `no-cache` on the probe itself:
        const res = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
        if (!res.ok) return '';
        return assetVersionSuffix(res.headers);
      } catch {
        return '';
      }
    })());
  }
  return url + (await _assetVersions.get(url));
}

// Builds the `?v=` suffix from whatever validators a response carries
function assetVersionSuffix(headers) {
  const etag = headers.get('etag');
  const length = headers.get('content-length');
  const modified = headers.get('last-modified');
  // Length first, because it is the one validator that changes when a model is swapped for a
  const validator = [length, etag, modified].filter(Boolean).join('|');
  return validator ? `?v=${versionToken(validator)}` : '';
}

// One fetch with progress, for either kind of model file. A text format is
// decoded to a string; a binary one is handed back as an ArrayBuffer, which is
// what its loader expects.
async function fetchModelData(rawUrl, binary, onProgress) {
  const url = await versionedUrl(rawUrl);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);

  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total || typeof onProgress !== 'function') {
    return binary ? res.arrayBuffer() : res.text();
  }

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }

  const merged = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) {
    merged.set(c, at);
    at += c.length;
  }
  return binary ? merged.buffer : new TextDecoder().decode(merged);
}

// Catalogue

/**
 * The model file inside a folder, or null if there is none this engine can
 * open. Formats are tried in MODEL_FORMATS order, so a folder holding both a
 * GLB and an OBJ serves the GLB.
 *
 * Probing costs one HEAD request per candidate, and it stops at the first hit —
 * a folder with model.glb costs one, model.obj costs seven. A folder with no
 * model at all is the worst case, and that is the case the manifest's own
 * `model` field exists to skip; see readManifest.
 */
export async function resolveModelFile(folder) {
  const tried = new Set();
  for (const format of MODEL_FORMATS) {
    for (const stem of [...(format.stems || DEFAULT_STEMS), folder]) {
      const name = `${stem}.${format.ext}`;
      if (tried.has(name)) continue;
      tried.add(name);
      try {
        // no-cache, so a folder that has just had its first model dropped in is not reported empty
        const res = await fetch(`${OBJECTS_BASE}${folder}/${name}`, { method: 'HEAD', cache: 'no-cache' });
        if (res.ok) return name;
      } catch {
        // try the next candidate
      }
    }
  }
  return null;
}

/**
 * @param {string} folder
 * @param {string} [knownModel] filename from the manifest, which skips probing
 */
export async function probeFolder(folder, knownModel) {
  const modelFile = knownModel || await resolveModelFile(folder);
  let image = null;
  for (const name of ['demo.jpg', 'demo.jpeg', 'demo.png', 'demo.webp', 'preview.jpg', 'preview.png']) {
    try {
      const res = await fetch(`${OBJECTS_BASE}${folder}/${name}`, { method: 'HEAD', cache: 'no-cache' });
      if (res.ok) {
        // Cache-bust so phones do not keep a broken/blank preview forever.
        image = `${OBJECTS_BASE}${folder}/${name}?v=1`;
        break;
      }
    } catch {
      // next candidate
    }
  }
  return modelFile
    ? { folder, modelFile, available: true, image }
    : { folder, available: false, image };
}

// The four categories the engine knows how to PLACE
export const CATEGORY_ORDER = ['necklace', 'earring', 'ring', 'bangles'];

export const CATEGORY_LABELS = {
  necklace: 'Necklace',
  earring: 'Earrings',
  ring: 'Ring',
  bangles: 'Bangles',
};

// Fallback list, used only when objects/index.json is absent
export const FOLDER_CATALOG = [
  'necklace-gold', 'necklace-diamond', 'necklace-mala',
  'earring-gold', 'earring-diamond', 'earring-hoop',
  'ring-band', 'ring-solitaire',
  'bangles-gold', 'bangles-diamond',
];

// Reads objects/index.json, if there is one
async function readManifest() {
  try {
    const res = await fetch(`${OBJECTS_BASE}index.json`, { cache: 'no-cache' });
    if (!res.ok) return null;

    const data = await res.json();
    const raw = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : null);
    if (!raw || !raw.length) return null;

    const entries = [];
    for (const item of raw) {
      if (typeof item === 'string') {
        if (item.trim()) entries.push({ folder: item.trim() });
      } else if (item && typeof item.folder === 'string' && item.folder.trim()) {
        entries.push({
          folder: item.folder.trim(),
          category: typeof item.category === 'string' ? item.category.trim() : undefined,
          label: typeof item.label === 'string' ? item.label.trim() : undefined,
          // Written by a host that scans the folders itself. When it is present
          // the browser skips probing entirely — it already knows the filename
          // and the extension, which matters now that there are ten to try.
          model: typeof item.model === 'string' && item.model.trim()
            ? item.model.trim()
            : undefined,
        });
      }
    }
    return entries.length ? entries : null;
  } catch {
    // No manifest, or it is not valid JSON
    return null;
  }
}

// Every jewellery item the app should offer, with its model file resolved
export async function discoverItems() {
  const entries = (await readManifest()) || FOLDER_CATALOG.map((folder) => ({ folder }));

  const probed = await Promise.all(entries.map(async (entry) => {
    const category = normaliseCategory(entry.category) || folderToCategory(entry.folder);
    if (!category) {
      console.warn(
        `[Catalogue] "${entry.folder}" does not name a supported category `
        + `(${CATEGORY_ORDER.join(', ')}) and has no "category" in the manifest — skipping.`,
      );
      return null;
    }
    const found = await probeFolder(entry.folder, entry.model);
    return {
      id: entry.folder,
      folder: entry.folder,
      category,
      label: entry.label || folderToLabel(entry.folder, category),
      modelFile: found.modelFile,
      format: found.modelFile ? formatForFile(found.modelFile) : null,
      available: found.available,
      image: found.image || null,
    };
  }));

  return probed.filter(Boolean);
}

// Names that mean the same category
const CATEGORY_ALIASES = {
  // The category is `bangles` now. `bracelet` stays understood on the way in, so
  // a shop that already uploaded a folder named bracelet-gold keeps working
  // without having to rename anything.
  bracelet: 'bangles',
  bracelets: 'bangles',
  bangle: 'bangles',
  kada: 'bangles',
  chain: 'necklace',
  pendant: 'necklace',
  studs: 'earring',
  stud: 'earring',
};

function normaliseCategory(value) {
  if (!value) return null;
  const v = value.toLowerCase().trim();
  for (const cat of CATEGORY_ORDER) {
    if (v === cat || v === `${cat}s`) return cat;
  }
  return CATEGORY_ALIASES[v] || null;
}

// Works out which category a folder belongs to from its name
export function folderToCategory(folder) {
  const words = String(folder).toLowerCase().split(/[-_\s]+/).filter(Boolean);
  for (const word of words) {
    const hit = normaliseCategory(word);
    if (hit) return hit;
  }
  // Last resort:
  const joined = words.join('');
  for (const cat of CATEGORY_ORDER) {
    if (joined.includes(cat)) return cat;
  }
  // The aliases have to be searched here too, not just word by word above. A
  // folder named with no separators at all — "goldbracelet" — only ever matched
  // through this fallback, and renaming the category would otherwise have
  // stopped it resolving.
  for (const alias of Object.keys(CATEGORY_ALIASES)) {
    if (joined.includes(alias)) return CATEGORY_ALIASES[alias];
  }
  return null;
}

// A readable name, with the category word moved to the end
export function folderToLabel(folder, category) {
  const cat = category || folderToCategory(folder);
  const words = String(folder).split(/[-_\s]+/).filter(Boolean);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

  const variant = words
    .filter((w) => !normaliseCategory(w))
    .map(cap)
    .join(' ');

  const suffix = CATEGORY_LABELS[cat] || '';
  if (variant && suffix) return `${variant} ${suffix}`;
  return variant || suffix || cap(String(folder));
}