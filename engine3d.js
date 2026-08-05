import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// MediaPipe FaceMesh / Pose / Hands landmark indices

// FaceMesh's 468 points cover the face SURFACE only — the mesh boundary stops at the…
// NAMING: every left/right below is ANATOMICAL — the subject's own body.
const FACE = {
  chin: 152,
  forehead: 10,
  noseTip: 1,

  // The side of the face, top to bottom
  rightEarLow: 93,       // anatomical RIGHT (draws screen-right when mirrored)
  leftEarLow: 323,

  rightJawAngle: 132,
  leftJawAngle: 361,

  // Face-oval widest points, used for head width rather than for the ear.
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

// MediaPipe Pose. Named anatomically, like FACE above:
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

// The two arms, as [elbow, wrist] — a bangle rides the forearm between them.
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

// The four knuckles, index to pinky — the fan the palm's own frame is fitted to.
const MCP_ROW = [5, 9, 13, 17];

// Finger chains, as [knuckle, middle joint, tip].
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
  // How far below the NECK PIVOT the chain crosses the sides of the neck, as a
  // fraction of face height. The pivot sits 0.55 above the chin, so this lands
  // the chain about (neckDrop - 0.55) of a face height below the chin.
  // Bigger = lower. Everything else hangs off this.
  neckDrop: 1.00,

  // Where the head actually pivots when it nods: the atlanto-occipital joint,
  // roughly level with the ear canals and well back toward the spine. Measured
  // from the forehead-chin midpoint, so DROP is negative — the joint is ABOVE
  // that midpoint, not below it.
  // Getting this wrong is not a small error. Put the pivot a third of a face
  // height too low and a 30° nod swings it a quarter of a face height forward,
  // carrying the necklace off the neck and out into the air in front of the
  // chest. That was the drift and the stretching.
  neckPivotDrop: -0.05,
  neckPivotBack: 0.30,

  // Safety floor only, NOT the resting height — neckDrop above sets that.
  // How far the highest FRONT-FACING part of the piece must stay below the chin.
  // Measured against the front alone: the clasp and rear chain sit higher still,
  // but they are behind the neck and can never reach a beard.
  neckClearChin: 0.30,

  // Absolute floor and ceiling on the anchor's distance below the chin, applied after…
  neckDropMin: 0.20,
  neckDropMax: 1.25,
  // Height of the chain above the shoulder midpoint, as a fraction of shoulder
  // span. MediaPipe's shoulder points sit at the joints, roughly 0.9 of a face
  // height below the chin, and the chain rides about half a shoulder span above
  // that.
  neckAboveShoulder: 0.38,
  // Furthest the torso may move the anchor up or down, in face heights.
  neckShoulderLift: 0.12,
  // Furthest it may move it toward or away from the lens, in neck radii.
  neckShoulderDepth: 0.35,
  // How much of the neck's ORIENTATION the torso is allowed to contribute.
  neckTorsoAxis: 0.25,
  neckRadius: 0.66,
  // Chain diameter relative to the neck's.
  necklaceWidth: 1.02,
  // Runaway guard on how far the piece may hang below the neck, as a fraction of face…
  pendantDrop: 1.10,
  // Must stay 0 while the neck mask is concentric with the chain — see updateNecklace.
  necklaceForward: 0,

  // Neck mask geometry. It has to cover the neck itself — where the rear chain
  // passes — and stop short of the pendant, which hangs in front of the chest
  // and must never be cut.
  neckMaskLength: 0.42,
  neckMaskLift: 0.09,

  // Neck mask size, as a multiple of the chain's OWN wrap radius.
  // A wrapped chain lies on a cylinder, so the mask must be that same cylinder:
  // then every point past 90° is behind it and turns away out of sight, exactly
  // as a real chain does. Undersize it and the far side never hides at all.
  // Elliptical, because a real neck is wider than it is deep. The extra width
  // swallows the last of the rear chain at the sides, where the chain's own
  // thickness would otherwise poke past the silhouette, while the shallower
  // depth leaves the front of the chain standing clear.
  neckMaskWide: 1.02,
  neckMaskDeep: 0.97,
  // A model that was already 3D was never wrapped, so its chain radius is only
  // an estimate — keep the old conservative mask for those.
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
  // Which earrings are visible.
  earringFadeStart: -0.10,
  earringFadeEnd: -0.35,

  // Ring
  // Outer diameter in finger widths — the FALLBACK, used only when the model has
  // no measurable hole. Anything with a hole is fitted by it instead.
  ringWidth: 1.30,
  // How much of the model's hole the finger fills, 1 = exactly.
  ringHoleFit: 1.0,
  // Finger shaft width as a fraction of the knuckle spacing.
  ringShaft: 0.82,
  // Seat along the proximal phalanx, 0 = knuckle, 1 = first joint.
  ringSeat: 0.52,
  ringDepth: 0.18,
  ringMinPx: 18,
  // Shortest the proximal phalanx may measure, relative to the gap between neighbouring…
  // Ring-finger validation — see ringFingerQuality.
  ringMinPhalanx: 0.55,
  ringPhalanxBand: 0.18,
  ringMinStraight: 0.86,
  ringStraightBand: 0.07,
  ringMinProportion: 1.05,
  // How square-on the phalanx must lie before its direction is trusted.
  ringMinAxisView: 0.20,
  ringAxisBand: 0.15,

  // Which face of the finger carries the ornament
  ringStoneOnBackOfHand: false,

  // Hand occlusion. A piece is hidden when a hand covers it — see _handCoverage.
  handCoverReach: 0.95,
  handCoverFade: 0.35,

  // Bangles
  // Outer diameter in wrist widths — the FALLBACK, as for the ring above.
  braceletWidth: 1.32,
  // A bangle is loose: its hole clears the wrist by this much.
  bangleHoleFit: 1.08,
  // How much of that slack gravity takes up, pulling it onto the underside.
  bangleSag: 0.75,
  // How far up the forearm it sits, in wrist widths.
  braceletSlide: 0.44,
  braceletDepth: 0.15,
  braceletMinPx: 20,
  // Wrist width as a fraction of the KNUCKLE-CENTRE span (landmarks 5 to 17),
  // and wrist depth as a fraction of that width. Both straight from anthropometry:
  // wrist breadth is 0.88 of that span on adult hands of either sex, and the
  // wrist is about 0.7 as deep as it is wide. This sizes the arm occluder, and
  // an arm too thin to fill the bangle is what left it reading as a flat ring
  // laid on top rather than a hoop the arm passes through.
  wristFromPalm: 0.86,
  wristDepthRatio: 0.70,
  // How far the forearm mask runs each way from the bangle, in knuckle spans.
  // Lopsided on purpose: the arm is behind the bangle, and a mask reaching
  // forward as far would cover the knuckles and swallow a ring worn with it.
  forearmMaskToHand: 0.70,
  forearmMaskToElbow: 2.30,
  // How far the bangle is allowed to leave the hand for Pose's forearm.
  forearmTrust: 0.85,
};

// SMOOTHING

// Per-category profiles.
const SMOOTH_PROFILE = {
  necklace: { posMin: 0.14, posMax: 0.72, rotMin: 0.10, rotMax: 0.55, scale: 0.14, depth: 0.14 },
  earring: { posMin: 0.20, posMax: 0.86, rotMin: 0.14, rotMax: 0.68, scale: 0.18, depth: 0.18 },
  ring: { posMin: 0.30, posMax: 0.94, rotMin: 0.22, rotMax: 0.85, scale: 0.24, depth: 0.24 },
  bracelet: { posMin: 0.26, posMax: 0.90, rotMin: 0.18, rotMax: 0.78, scale: 0.20, depth: 0.20 },
  default: { posMin: 0.24, posMax: 0.86, rotMin: 0.18, rotMax: 0.70, scale: 0.20, depth: 0.20 },
};

// Motion at or above this fraction of the item's own size per frame is treated as "the…
const RESPONSE_SPEED = 0.055;
const RESPONSE_ANGLE = 0.020;   // radians per frame, same idea for rotation

// Deadband: ignore sub-pixel position changes and sub-0.5% scale changes entirely.
const DEADBAND_PX = 0.35;
const DEADBAND_SCALE = 0.005;

// Jump rejection. A landmark glitch (or a genuine re-detection after occlusion) can…
const JUMP_SNAP = 2.5;

// How far past the edge of the canvas an anchor may sit before the piece is treated as…
const OFFSCREEN_MARGIN = 1.5;

// Hide jewellery that a hand is covering.
const HIDE_UNDER_HANDS = true;

// BODY-PART VISIBILITY

// Detector results a hand may be missing for before its jewellery starts to fade, and…
const HAND_HOLD_MISSES = 2;
const HAND_FADE_MISSES = 5;

// How much a piece should still be trusted, given how stale its landmarks are.
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

// The four landmarks that make up the ring finger:
const RING_FINGER_CHAIN = [13, 14, 15, 16];

// The knuckles the ring's size and orientation are measured from.
const RING_SUPPORT = [0, 5, 9, 13, 17];

// The ring finger must be fully inside the picture, with no margin at all.
const RING_FRAME_MARGIN = 0;

// How much better the other hand's ring finger must look before the ring moves to it.
const RING_HAND_STICK = 1.3;

// Proximal phalanx length as a multiple of finger width, on a real hand.
const RING_BONE_TO_WIDTH = 1.85;

// Finger and wrist thickness change only as the limb nears the lens, so they are
// filtered hard — this is the one channel where lag costs nothing.
const LIMB_WIDTH_SMOOTH = 0.12;

// How coherent the palm's triangles must be before their average normal is trusted.
const MIN_PALM_AGREEMENT = 0.25;

// How close Pose's wrist must land to the hand's own, in normalised units.
const FOREARM_MATCH_RADIUS = 0.14;
const FOREARM_MIN_VISIBILITY = 0.5;

// Is there really a ring finger here, laid out plainly enough to place a ring on it? A…
function ringFingerQuality(hand, engine) {
  const mcp = hand[13];
  const pip = hand[14];
  const dip = hand[15];
  const tip = hand[16];
  const middleMcp = hand[9];
  if (!mcp || !pip || !dip || !tip || !middleMcp) return 0;

  const knuckleGap = engine.dist3D(middleMcp, mcp);
  if (!(knuckleGap > 1e-4)) return 0;

  const proximal = engine.dist3D(mcp, pip);
  const middle = engine.dist3D(pip, dip);
  const distal = engine.dist3D(dip, tip);
  const path = proximal + middle + distal;
  if (!(path > 1e-4)) return 0;

  // LENGTH — fades in across the band rather than switching at its edge.
  const lengthScore = clamp01(
    (proximal / knuckleGap - PLACE.ringMinPhalanx) / PLACE.ringPhalanxBand,
  );

  // STRAIGHTNESS — 1 is fully extended, and it falls away as the finger curls.
  const chord = engine.dist3D(mcp, tip);
  const straightScore = clamp01(
    (chord / path - PLACE.ringMinStraight) / PLACE.ringStraightBand,
  );

  // PROPORTION — the proximal bone outreaches the middle one on every real hand.
  if (proximal < middle * PLACE.ringMinProportion) return 0;

  return Math.min(lengthScore, straightScore);
}

// Wrist plus the two knuckles the bracelet's width and orientation are measured from.
const WRIST_CHAIN = [0, 5, 17];

// The points compared when deciding whether two hand slots hold one hand.
const SAME_HAND_POINTS = [0, 5, 9, 13, 17];

// How closely they must shadow each other to count as one hand, as a fraction
// of the knuckle span. Half a knuckle span averaged over the whole row is far
// tighter than two real hands can ever be, even held side by side.
const SAME_HAND_LIMIT = 0.5;

// Rate the invisible body masks follow their target at.
const MASK_SMOOTH = 0.55;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Rescales a per-60fps lerp factor to the frame time actually observed.
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

// `pair: 2` means one uploaded model is duplicated into a left/right pair.
const CATEGORY_DEFAULTS = {
  // The necklace is anchored at the NECK CENTRE, not hung from a top edge.
  necklace: { fitAxis: 'x', anchor: 'center', scale: 1, pair: 1, pairMirror: false },
  // Earrings hang from the hook, which is the pivot the model gets.
  earring: { fitAxis: 'y', anchor: 'top', scale: 1, pair: 2, pairMirror: false },
  ring: { fitAxis: 'x', anchor: 'center', scale: 1, pair: 1, pairMirror: false },
  bracelet: { fitAxis: 'x', anchor: 'center', scale: 1, pair: 2, pairMirror: false },
};

const FADE_SPEED = 0.18;
const DEG = Math.PI / 180;

// Scratch objects.
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
// Scratch for mask placement.
const _mPos = new THREE.Vector3();
const _mScale = new THREE.Vector3();

// Scratch for the palm-frame solve.
const _hfWrist = new THREE.Vector3();
const _hfP = new THREE.Vector3();
const _hfQ = new THREE.Vector3();
const _hfTmp = new THREE.Vector3();
const _hfNormal = new THREE.Vector3();
const _hfAcross = new THREE.Vector3();
const _hfAlong = new THREE.Vector3();

// Returned by _handFrame — the same object every call, never retained by a caller.
const _handFrameOut = { normal: _hfNormal, across: _hfAcross, along: _hfAlong };

// Scratch for the forearm solve.
const _faElbow = new THREE.Vector3();
const _faWrist = new THREE.Vector3();

// Scratch for the hand-occlusion test.
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

  // Gram-Schmidt: strip the part of forward that lies along up.
  _bFwd.addScaledVector(_bUp, -_bUp.dot(_bFwd));

  if (_bFwd.lengthSq() < 1e-8) {
    // forward was parallel to up — pick any perpendicular axis rather than
    // emitting a non-unit quaternion (which silently shrinks the model).
    if (Math.abs(_bUp.z) < 0.9) _bFwd.set(0, 0, 1);
    else _bFwd.set(1, 0, 0);
    _bFwd.addScaledVector(_bUp, -_bUp.dot(_bFwd));
  }
  _bFwd.normalize();

  _bRight.crossVectors(_bUp, _bFwd).normalize();

  _bm4.makeBasis(_bRight, _bUp, _bFwd);
  return outQuat.setFromRotationMatrix(_bm4);
}

// Per-channel smoothing state.
function newSmoothState() {
  return {
    position: new THREE.Vector3(),   // x/y — screen plane
    depth: 0,                        // z — filtered separately, much harder
    scale: 1,
    quaternion: new THREE.Quaternion(),
    initialized: false,
    // Confidence ramp.
    age: 0,
  };
}

// Head pose

function newHeadPose() {
  return {
    valid: false,
    center: new THREE.Vector3(),     // centroid of the head, screen space
    chin: new THREE.Vector3(),
    // Midpoint of the two jaw angles.
    jawCenter: new THREE.Vector3(),
    // Roughly the atlanto-occipital joint — the point a nod rotates the skull about.
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

    // How much this pose is still trusted, 1 down to 0.
    confidence: 0,
    staleFrames: 0,
  };
}

// How long a head pose survives with no fresh landmarks.
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

// How quickly the torso solution fades in and out of use, per 60fps frame.
const TORSO_BLEND_RATE = 0.08;

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

    // The camera feed is shown mirrored (selfie view), so landmarks get
    // flipped here. The canvas itself must NOT be CSS-mirrored as well.
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

    // No tone mapping, deliberately.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Orthographic, looking down -Z.
    this.camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 500, 3500);
    this.camera.position.z = 2000;

    // Lighting
    this.ambient = new THREE.AmbientLight(0xffffff, Math.max(0.85 - ENV_MEAN_LUMINANCE, 0.1));
    this.keyLight = new THREE.DirectionalLight(0xfff6ea, 1.0);
    this.fillLight = new THREE.DirectionalLight(0xeaf0ff, 0.40);
    this.rimLight = new THREE.DirectionalLight(0xffffff, 0.30);
    this.scene.add(this.ambient, this.keyLight, this.fillLight, this.rimLight);

    this._buildEnvironment();

    this.modelCache = new Map();
    this.pendingLoads = new Map();
    this.activeItems = new Map();

    // Rebuilt once per frame and shared by every face-driven piece.
    this.headPose = newHeadPose();
    // Shoulders and chest, when Pose is running and its answer passes checks.
    this.torsoPose = newTorsoPose();

    // Frame timing, so every smoothing rate can be expressed per-60fps-frame and rescaled…
    this._lastFrameTime = 0;
    this._dtScale = 1;

    // Smoothing state for the invisible body masks, keyed by mask.
    this._maskStates = new Map();

    // Last landmark arrays actually solved, so an unchanged one can be skipped — see…
    this._lastFaceRef = null;
    this._lastPoseRef = null;

    // Detector results the face has been missing for, refreshed each frame.
    this._faceMiss = 0;
    this._tracking = null;

    // Open the page with ?anchors=1 to draw a dot at every attachment point.
    this.showAnchors = typeof location !== 'undefined'
      && new URLSearchParams(location.search).has('anchors');
    this._anchorMarks = new Map();

    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy?.() || 1;

    this._buildOccluders();
  }

  // Pre-filters a small studio probe into an environment map.
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
      // Give the ambient back what the probe would have contributed, so a
      // device without it is merely flatter rather than dark.
      this.ambient.intensity = 0.9;
    }
  }

  // Occlusion

  _buildOccluders() {
    const maskMaterial = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
      // Push the mask a little AWAY from the camera in depth only.
      polygonOffset: true,
      // Constant only — the slope term MUST stay at zero. It scales with how
      // steeply the surface recedes from the camera, and a cylinder seen
      // end-on (which is exactly what the neck becomes when the head tilts
      // down) recedes almost infinitely steeply. The mask was being pushed
      // back far enough to let the entire chain draw through it.
      // Every mask now clears its jewellery geometrically instead: the neck
      // sits inside the chain's own thickness, the finger inside the ring's
      // hole, the forearm inside the bangle's.
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

    // Unit primitives — all real sizing happens through per-frame scale, so
    // the geometry is allocated exactly once.
    // Cylinders are built along +Y (three.js default) to match the limb
    // frames, which also use +Y as the bone axis.
    // CLOSED cylinders (openEnded = false).
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

  // Every occluder off; re-enabled per frame only by whatever needs it.
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
      // A mask that has teleported (re-detection after occlusion) must not
      // sweep across the frame carving through everything on the way.
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

  // Masks forget their pose when their jewellery goes away.
  _forgetMask(key) {
    const st = this._maskStates.get(key);
    if (st) st.live = false;
  }

  // Viewport

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);

    // Re-read the device pixel ratio on every resize.
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

    // A three-point rig.
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

  // Normalised landmark → centred screen-space point.
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

  // Distance between two landmarks in on-screen pixels (ignores depth).
  dist2D(a, b) {
    const dx = (a.x - b.x) * this.dispW;
    const dy = (a.y - b.y) * this.dispH;
    return Math.hypot(dx, dy);
  }

  // True 3D distance in the same pixel units, including depth.
  dist3D(a, b) {
    const dx = (a.x - b.x) * this.dispW;
    const dy = (a.y - b.y) * this.dispH;
    const dz = ((a.z || 0) - (b.z || 0)) * this.dispW;
    return Math.hypot(dx, dy, dz);
  }

  // Head pose

  // Builds the head's own 3D coordinate frame for this frame.
  // Marks this frame as having no usable face, WITHOUT immediately throwing the pose away.
  _decayHeadPose() {
    const hp = this.headPose;
    if (!hp.confidence && !hp.valid) {
      hp.valid = false;
      return hp;
    }

    hp.staleFrames += 1;

    if (hp.staleFrames <= HEAD_HOLD_FRAMES) {
      // Still holding: the pose keeps every value it had.
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

    // Rendering runs at display rate; FaceMesh delivers results at a third of that or less.
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

    // Built in scratch, committed to `hp` only once every check has passed.
    const right = _n1;
    const up = _n2;
    const forward = _n3;

    // Anatomical right:
    // left eye and `_v4` the right, so the subtraction runs left → right.
    right.subVectors(_v4, _v3);
    up.subVectors(_v1, _v2);

    if (right.lengthSq() < 1e-9 || up.lengthSq() < 1e-9) return this._decayHeadPose();

    right.normalize();
    up.normalize();

    // forward = right × up.
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
      // Too close to call — reuse the last trustworthy decision.
      forward.negate();
      right.negate();
    }

    // Re-orthogonalise:
    // exactly perpendicular on a real face.
    right.crossVectors(up, forward).normalize();

    // Every check passed — commit.
    hp.right.copy(right);
    hp.up.copy(up);
    hp.forward.copy(forward);

    _bm4.makeBasis(hp.right, hp.up, hp.forward);
    hp.quaternion.setFromRotationMatrix(_bm4);

    hp.chin.copy(_v2);
    hp.center.copy(_v2).addScaledVector(hp.up, faceHeight * 0.5);

    // Jaw angles (gonions).
    // of the skull and is the steady anchor the necklace is hung from.
    this.lmToScreen(face[FACE.rightJawAngle], _v7);
    this.lmToScreen(face[FACE.leftJawAngle], _v8);
    hp.jawCenter.addVectors(_v7, _v8).multiplyScalar(0.5);

    // The neck pivot, in the head's own frame — down from the centroid and back
    // toward the spine. Everything worn on the neck hangs from here.
    hp.neckPivot.copy(hp.center)
      .addScaledVector(hp.up, -faceHeight * PLACE.neckPivotDrop)
      .addScaledVector(hp.forward, -jawWidth * PLACE.neckPivotBack);

    hp.faceHeight = faceHeight;
    hp.jawWidth = jawWidth;
    hp.halfWidth = jawWidth * 0.5;

    // Yaw straight off the frame:
    // the camera axis.
    hp.yaw = Math.atan2(hp.forward.x, hp.forward.z);

    hp.staleFrames = 0;
    hp.confidence = 1;
    hp.valid = true;
    return hp;
  }

  // Torso pose

  // Builds the shoulder/chest frame, or declines to.
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

    // Ramped rather than switched.
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

    // 1. Does Pose itself believe in these points?
    const vis = Math.min(ls.visibility ?? 0, rs.visibility ?? 0);
    if (vis < 0.55) return false;

    // 2. Are they actually inside the picture? A little overshoot is normal and fine; a…
    const inFrame = (lm) => lm.x > -0.15 && lm.x < 1.15 && lm.y > -0.15 && lm.y < 1.12;
    if (!inFrame(ls) || !inFrame(rs)) return false;

    // 3. Is the result anatomically plausible? Shoulder span is reliably between about one…
    const width = this.dist3D(ls, rs);
    if (!(width > 1e-3)) return false;
    const ratio = width / Math.max(hp.jawWidth, 1e-6);
    if (ratio < 1.4 || ratio > 4.5) return false;

    this.lmToScreen(ls, _v1);
    this.lmToScreen(rs, _v2);

    // Anatomical right, from the left shoulder toward the right one.
    tp.right.subVectors(_v2, _v1);
    if (tp.right.lengthSq() < 1e-9) return false;
    tp.right.normalize();

    tp.shoulderMid.addVectors(_v1, _v2).multiplyScalar(0.5);

    // Torso up: from the hips toward the shoulders when the hips are visible, which is the…
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

    // Re-orthogonalise; the shoulder line and the spine are not exactly
    // perpendicular on a real body.
    tp.right.crossVectors(tp.up, tp.forward).normalize();

    tp.width = width;
    return true;
  }

  // Loading

  async loadJewellery(id, folder, objFile, category, onProgress) {
    const cacheKey = `${folder}/${objFile}`;
    if (this.modelCache.has(cacheKey)) return this.modelCache.get(cacheKey);
    if (this.pendingLoads.has(cacheKey)) return this.pendingLoads.get(cacheKey);

    const job = this._loadTemplate(folder, objFile, category, cacheKey, onProgress)
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

  async _loadTemplate(folder, objFile, category, cacheKey, onProgress) {
    const basePath = `objects/${folder}/`;

    // Fetch the OBJ once, with progress — these files can be tens of MB and
    // a silent 30-second parse looks exactly like a crash.
    const raw = await fetchTextWithProgress(`${basePath}${objFile}`, onProgress);
    const objText = sanitizeObjText(raw, cacheKey);

    // Every loader is a fresh instance.
    // mutated setPath()/setMaterials() on it, so two concurrent loads
    // corrupted each other's base path and material set.
    const objLoader = new OBJLoader();
    const materials = await this._loadMaterials(basePath, objFile, objText);
    if (materials) objLoader.setMaterials(materials);

    const object = objLoader.parse(objText);

    // Per-folder material overrides, read before the traverse so every mesh in the model…
    const materialOptions = {
      maxAnisotropy: this.maxAnisotropy,
      override: MODEL_TUNING[folder] || {},
      hasMTL: !!materials,
    };

    object.traverse((child) => {
      if (!child.isMesh) return;

      // Frustum culling OFF, deliberately.
      child.frustumCulled = false;

      // No shadow map is enabled, so these only cost bookkeeping.
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
      // Carried so the tuner can show only the controls that apply to this
      // kind of piece. Not persisted — saveTuning writes MODEL_TUNING, and
      // the category is derived from the folder, never stored.
      category,
      ...CATEGORY_DEFAULTS[category],
      ...(MODEL_TUNING[folder] || {}),
    };

    const analysis = normalizeModel(object, category, tuning);

    const anchorOffset = new THREE.Vector3(
      tuning.offsetX || 0,
      (tuning.anchor === 'top' ? -analysis.normHeight / 2 : 0) + (tuning.offsetY || 0),
      tuning.offsetZ || 0,
    );

    console.log('[Engine3D] loaded', cacheKey, {
      rawSize: analysis.rawSize.toArray().map((n) => +n.toFixed(3)),
      normSize: analysis.normSize.toArray().map((n) => +n.toFixed(3)),
      fitAxis: tuning.fitAxis,
      anchor: tuning.anchor,
    });

    return { object, analysis, category, cacheKey, folder, tuning, anchorOffset };
  }

  async _loadMaterials(basePath, objFile, objText) {
    const names = [];
    const declared = objText.match(/^\s*mtllib\s+(.+)$/m);
    if (declared) names.push(declared[1].trim());
    names.push('model.mtl', objFile.replace(/\.obj$/i, '.mtl'));

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

    // Earrings and bracelets are worn as a pair, so one uploaded model gets
    // duplicated: instance 0 = left side, instance 1 = right side.
    const count = template.tuning.pair === 2 ? 2 : 1;
    const instances = [];

    for (let i = 0; i < count; i++) {
      const group = new THREE.Group();
      const pivot = new THREE.Group();
      const mesh = cloneWithOwnMaterials(template.object);

      pivot.position.copy(template.anchorOffset);
      // The mesh is centred on the pivot's origin, so flipping the pivot
      // mirrors the model about its own centre.
      // winding order for negative-determinant matrices, so lighting and
      // face culling stay correct.
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
        // Which smoothing profile this piece follows — a necklace and a ring
        // sit on body parts with completely different motion.
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
      // Once fully faded in, drop back to opaque rendering so the metal
      // doesn't stay see-through.
      // (e.g. gemstones with `d 0.7`) keep their transparency.
      m.transparent = !fullyIn || m.userData._baseTransparent === true;
      // depthWrite stays ON at every opacity, including mid-fade.
      m.depthWrite = true;
      // depthTest must stay on at every opacity — it is what lets the body
      // occluders hide the far side of a chain or a hoop.
      // while fading would make the piece briefly draw through the neck.
      m.depthTest = true;
    }
  }

  // Snap everything out of view immediately (used when the camera stops).
  hideAll() {
    // Masks too — they are invisible, but they still write depth, and a stale
    // one left over the frozen last frame would punch a hole in anything
    // drawn afterwards.
    this._resetOccluders();
    for (const st of this._maskStates.values()) st.live = false;

    // Clear the hold as well as the validity flag.
    this.headPose.valid = false;
    this.headPose.confidence = 0;
    this.headPose.staleFrames = 0;
    this.torsoPose.valid = false;
    this.torsoPose.blend = 0;
    // Force a fresh solve on the next frame rather than reusing a cached one
    // from before the camera stopped.
    this._lastFaceRef = null;
    this._lastPoseRef = null;

    this._lastFrameTime = 0;

    for (const [, entry] of this.activeItems) {
      for (const inst of entry.instances) {
        inst.group.visible = false;
        inst.state.initialized = false;
        this._setOpacity(inst, 0);
      }
    }
  }

  // Smooth-follow + fade for one instance, filtering each channel separately.
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
        // Ramp: 0.35 → 1.0 of the nominal rate over ~8 frames.
        s.age = Math.min(s.age + 1, 8);
        const ramp = 0.35 + 0.65 * (s.age / 8);

        const dx = targetPos.x - s.position.x;
        const dy = targetPos.y - s.position.y;
        const moved = Math.hypot(dx, dy);

        // Anchor teleported — snap rather than sweep across the screen.
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

          // Depth is the noisiest channel MediaPipe produces — filter hardest,
          // and at a fixed rate:
          // making it responsive would just let the noise back in.
          s.depth += (targetPos.z - s.depth) * adapt(p.depth, dtScale) * ramp;

          // Scale gets a RELATIVE deadband:
          // threshold means the same thing near and far from the camera.
          if (Math.abs(targetScale - s.scale) > s.scale * DEADBAND_SCALE) {
            s.scale += (targetScale - s.scale) * adapt(p.scale, dtScale) * ramp;
          }

          // Rotation gets the same treatment, keyed on the angle still to be covered.
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

    // Fully hidden → forget the last pose so it snaps back in cleanly
    // instead of sliding across the screen when tracking returns.
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

  // Draws a dot at an attachment point, when ?anchors=1 is on.
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

  // How much a tracked hand is covering this point, 0 to 1.
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

      // Centre of the palm — the part of a hand that actually covers things.
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

    // Neck axis.
    _n1.set(0, 1, 0).lerp(hp.up, NECK_FOLLOW).normalize();
    // Neck forward.
    _n2.set(0, 0, 1).lerp(hp.forward, NECK_FOLLOW).normalize();

    if (torso > 0.001) {
      // Torso axes, leaned a little toward the head so a head turn still rotates the chain…
      _v5.copy(tp.up).lerp(hp.up, 0.20).normalize();
      _v6.copy(tp.forward).lerp(hp.forward, 0.30).normalize();
      // A NUDGE, never a handover. Pose's depth is far coarser than FaceMesh's,
      // and its forward axis comes out of a cross product of two of those coarse
      // vectors. Letting it reach 1 handed the necklace's whole orientation to
      // the worse of the two solves — and it did so several seconds in, the
      // moment the Pose model finished downloading, which is why the piece was
      // right on a fresh load and wrong ever after.
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

    // Anchor
    // Hung from the NECK PIVOT, not from the chin. The chin sweeps a long arc
    // every time the head nods and the neck does not, which is exactly why the
    // chain used to climb onto the beard when the wearer looked down and lift
    // clear of the throat when they looked up.
    _pos.copy(hp.neckPivot)
      .addScaledVector(_n1, -faceHeight * PLACE.neckDrop)
      .addScaledVector(_n2, -neckRadius * PLACE.necklaceForward);

    const faceAnchorX = _pos.x;
    const faceAnchorY = _pos.y;
    const faceAnchorZ = _pos.z;

    // Torso correction.
    if (torso > 0.001) {
      _v5.copy(tp.shoulderMid).addScaledVector(tp.up, tp.width * PLACE.neckAboveShoulder);
      _pos.lerp(_v5, torso * PLACE.neckShoulderPull);

      // Vertical deviation stays clamped, like the lateral one below. The
      // shoulders say where the body is far better than they say how high the
      // throat is, and an unclamped pull toward them drags the chain down onto
      // the chest the moment Pose becomes confident.
      const lift = faceHeight * PLACE.neckShoulderLift;
      _pos.y = faceAnchorY + Math.min(Math.max(_pos.y - faceAnchorY, -lift), lift);

      // Depth too. Pose measures z against the hips and it is the noisiest
      // number in the whole pipeline; unclamped it slides the chain in and out
      // of the neck mask, which is what makes the rear of the chain flicker.
      const push = neckRadius * PLACE.neckShoulderDepth;
      _pos.z = faceAnchorZ + Math.min(Math.max(_pos.z - faceAnchorZ, -push), push);

      // Lateral deviation stays clamped:
      // extrapolates worst, so a bad shoulder may nudge the necklace but
      // never carry it off the body.
      const limit = jawWidth * PLACE.neckShoulderShift;
      _pos.x = faceAnchorX + Math.min(Math.max(_pos.x - faceAnchorX, -limit), limit);
    }

    // Scale
    const openWidth = Math.max(analysis?.openWidth || analysis?.normWidth || 1, 1e-4);
    let scale = (neckRadius * 2 * PLACE.necklaceWidth / openWidth)
      * (entry.tuning.scale ?? 1);

    // Runaway guard only.
    const drop = (analysis?.dropBelow || 0.5) * scale;
    const maxDrop = faceHeight * PLACE.pendantDrop;
    if (drop > maxDrop) scale *= maxDrop / drop;

    // The guarantee
    // Against the FRONT of the piece only. Using its full height instead counts
    // the clasp and rear chain, which sit high behind the neck and cannot reach
    // a chin — and that mistake alone was shoving the whole necklace a third of
    // a face height down onto the chest.
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
    // The neck has left the picture — see _outOfFrame.
    if (this._outOfFrame(_pos, scale)) return false;

    // Two independent signals, multiplied:
    this._markAnchor('neck', _pos, 0xffcc00);

    // A hand raised over the throat hides the chain — see _handCoverage.
    const alpha = hp.confidence
      * freshness(tracking.faceMiss)
      * (1 - this._handCoverage(_pos, tracking, null));
    if (alpha <= 0.01) return false;
    this.place(inst, _pos, scale, _q1, true, alpha);

    // Occluder
    // The mask IS the neck, and a wrapped chain lies on the neck — so the two
    // must be the same cylinder, sharing an axis and a radius. That single fact
    // is what makes the chain turn away behind the neck instead of running on
    // past it: every point past 90° is then genuinely behind the surface.
    const st = inst.state;
    const necklaceRadius = openWidth * 0.5 * scale;

    // A model that was never wrapped has only an estimated chain radius, so it
    // keeps the old conservative circular mask.
    const wrapped = !!entry.analysis?.wrapped;
    const wide = wrapped ? PLACE.neckMaskWide : PLACE.neckMaskFitFlat;
    const deep = wrapped ? PLACE.neckMaskDeep : PLACE.neckMaskFitFlat;

    // Ratios against the raw scale, so the mask inherits the smoothed size.
    // Local X is across the neck and local Z is its depth — the basis was built
    // from the neck's own axis and forward, so the ellipse lands the right way round.
    const inv = 1 / Math.max(scale, 1e-6);
    const wideRatio = necklaceRadius * wide * inv;
    const deepRatio = necklaceRadius * deep * inv;
    const lengthRatio = faceHeight * PLACE.neckMaskLength * inv;
    const liftRatio = faceHeight * PLACE.neckMaskLift * inv;

    _mPos.set(st.position.x, st.position.y, st.depth)
      // Ride up toward the jaw, clear of anything hanging below.
      .addScaledVector(_n1, st.scale * liftRatio);
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
    // orientation, its own filter state and its own visibility.
    this._placeEarring(entry, entry.instances[0], face, +1, scale);
    if (entry.instances[1]) {
      this._placeEarring(entry, entry.instances[1], face, -1, scale);
    }

    // Head occluder: an ellipsoid standing in for the skull, so the far side of a hoop…
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

    // Anchor: the earlobe
    if (face) {
      this.lmToScreen(face[earIdx], _v1);                 // lowest point beside the ear
      this.lmToScreen(face[jawIdx], _v2);                 // jaw angle, below and forward

      // Start at the ear point and walk a short way toward the jaw angle.
      _pos.copy(_v1).lerp(_v2, earDrop);

      // Then out onto the lobe itself.
      _pos
        .addScaledVector(_n1, hp.halfWidth * earOut)
        .addScaledVector(hp.forward, -hp.halfWidth * earBack);
    } else {
      _pos.copy(hp.center)
        .addScaledVector(_n1, hp.halfWidth * 0.92)
        .addScaledVector(hp.forward, -hp.halfWidth * 0.34)
        .addScaledVector(hp.up, -faceHeight * 0.10);
    }

    // There is deliberately NO head-frame prediction blend here any more.

    // Orientation
    _n3.set(0, 1, 0).lerp(hp.up, PLACE.earringRollFollow).normalize();

    // Head forward, biased slightly toward the lens, then pushed outboard so
    // the piece angles away from the cheek the way a real one hangs.
    _v3.copy(hp.forward);
    _v3.z += (1 - PLACE.earringHeadFollow);
    _v3.addScaledVector(_n1, PLACE.earringOutward).normalize();

    basisQuat(_n3, _v3, _q1);

    // Visibility, decided per ear
    let turned = clamp01(
      (facing - PLACE.earringFadeEnd) / (PLACE.earringFadeStart - PLACE.earringFadeEnd),
    );

    // The ear region must also be inside the picture.
    if (face && !allInFrame(face, [earIdx, jawIdx])) turned = 0;

    // Multiplied by the head pose's own confidence, which carries the short hold after the…
    // A hand over this ear hides this earring, and only this one — the test is against THIS…
    // Green on the right ear, cyan on the left.
    this._markAnchor(`ear${side}`, _pos, side > 0 ? 0x00ff66 : 0x00ddff);

    const covered = this._handCoverage(_pos, this._tracking, null);

    const alpha = (this._outOfFrame(_pos, scale) ? 0 : turned)
      * hp.confidence
      * freshness(this._faceMiss)
      * (1 - covered);

    this.place(inst, _pos, scale, _q1, alpha > 0.02, alpha);
  }

  // The palm's own orthonormal frame, fitted to the whole knuckle fan.
  // A single cross product of two landmark spans inherits the noise of both.
  // Summing the fan's triangles instead weights each by its own area, so the
  // wide reliable ones dominate and a shaky one barely registers — the same
  // reason an area-weighted normal beats a face normal on a mesh.
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

    // The triangles disagreeing means the landmarks are not describing a palm.
    if (_hfNormal.length() < area * MIN_PALM_AGREEMENT) return null;
    _hfNormal.normalize();

    // Across and along, both made exactly perpendicular to that normal.
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

  // Which tracked hand is wearing the ring? Whichever shows the better ring
  // finger — but the one already wearing it keeps it unless clearly beaten,
  // so the ring never ping-pongs between two hands held side by side.
  _pickRingHand(entry, tracking) {
    const options = [
      { hand: tracking.leftHand, miss: tracking.leftHandMiss, isRight: tracking.leftHandIsRight, slot: 0 },
      { hand: tracking.rightHand, miss: tracking.rightHandMiss, isRight: tracking.rightHandIsRight, slot: 1 },
    ];

    let best = null;
    for (const option of options) {
      const hand = option.hand;
      if (!hand || hand.length < 21) continue;

      // Every landmark the placement reads must be genuinely in shot. MediaPipe
      // extrapolates the ones it cannot see rather than dropping them, so this
      // is the only thing standing between a half-visible hand and a ring
      // floating on a finger that was never there.
      if (!allInFrame(hand, RING_FINGER_CHAIN, RING_FRAME_MARGIN)) continue;
      if (!allInFrame(hand, RING_SUPPORT)) continue;

      const quality = ringFingerQuality(hand, this) * freshness(option.miss);
      if (quality <= 0.01) continue;

      const weighted = option.slot === entry.ringSlot ? quality * RING_HAND_STICK : quality;
      if (!best || weighted > best.weighted) {
        best = { ...option, quality, weighted };
      }
    }
    return best;
  }

  // Finger thickness, from three independent cues rather than one gap.
  _ringFingerWidth(entry, hand) {
    const cues = [
      this.dist3D(hand[9], hand[13]),                        // the ring finger's own knuckle gap
      (this.dist3D(hand[5], hand[9]) + this.dist3D(hand[13], hand[17])) * 0.5,
      this.dist3D(hand[13], hand[14]) / RING_BONE_TO_WIDTH,  // its proximal bone
    ].filter((v) => v > 1e-4).sort((a, b) => a - b);

    if (!cues.length) return 0;

    // The median throws away a cue spoiled by one bad landmark.
    const target = cues[Math.floor(cues.length / 2)] * PLACE.ringShaft;

    const prev = entry.fingerWidth || 0;
    entry.fingerWidth = prev > 0
      ? prev + (target - prev) * adapt(LIMB_WIDTH_SMOOTH, this._dtScale)
      : target;
    return entry.fingerWidth;
  }

  // The ring is worn on one bone, so everything here is solved in the hand's own frame.
  updateRing(entry, tracking) {
    const pick = this._pickRingHand(entry, tracking);
    if (!pick) return false;

    const hand = pick.hand;
    const frame = this._handFrame(hand);
    if (!frame) return false;

    // Moving to the other hand invalidates both remembered values: the two hands
    // are different sizes and face opposite ways.
    if (entry.ringSlot !== pick.slot) {
      entry.fingerWidth = 0;
      entry.dorsalSide = undefined;
      entry.ringSlot = pick.slot;
    }

    this.lmToScreen(hand[HAND.ringMcp], _v1);
    this.lmToScreen(hand[HAND.ringPip], _v2);

    // Finger axis
    const axis = _v5.subVectors(_v2, _v1);
    const axisLen = axis.length();
    if (axisLen < 1e-6) return false;
    axis.multiplyScalar(1 / axisLen);

    // A finger pointing straight at the lens collapses to a dot in the image,
    // and its direction — which is the ring's whole orientation — becomes
    // whatever the depth noise says. Fade out rather than spin.
    const inPlane = Math.hypot(axis.x, axis.y);
    const axisScore = clamp01((inPlane - PLACE.ringMinAxisView) / PLACE.ringAxisBand);
    if (axisScore <= 0.01) return false;

    // Which way is the back of the hand? From finger curl, which does not care
    // about handedness — see dorsalSideFromCurl.
    _n2.copy(frame.normal);
    const curl = dorsalSideFromCurl(hand, this, _n2);
    if (curl !== 0) entry.dorsalSide = curl;
    else if (entry.dorsalSide === undefined) entry.dorsalSide = handSign(pick.isRight);
    _n2.multiplyScalar(PLACE.ringStoneOnBackOfHand ? entry.dorsalSide : -entry.dorsalSide);

    // A second copy, forced toward the lens — the seat push is camera-relative
    // where the orientation must never be.
    _n3.copy(frame.normal);
    if (_n3.z < 0) _n3.negate();

    // Scale
    // Fitted by the model's HOLE, so the finger fills it exactly. That is what
    // a ring size IS, and it is why any new model lands correctly with no
    // per-folder tuning.
    const fingerWidth = this._ringFingerWidth(entry, hand);
    if (!(fingerWidth > 1e-4)) return false;
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

    // The hand has left the picture — see _outOfFrame.
    if (this._outOfFrame(_pos, scale)) return false;

    this._markAnchor('ring', _pos, 0xff44aa);

    // The OTHER hand covering this one hides the ring.
    const alpha = pick.quality
      * axisScore
      * (1 - this._handCoverage(_pos, tracking, hand));
    if (alpha <= 0.01) return false;

    const inst = entry.instances[0];
    this.place(inst, _pos, scale, _q1, true, alpha);

    // Occluder
    // The mask has to FILL the ring's hole. Sized any smaller it sits inside the
    // band entirely, occludes nothing, and the far side of the ring shows
    // straight through the near side — which is what read as the band splitting.
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
      // Undo the seat push, back onto the finger's own centre line.
      .addScaledVector(_v3, fingerRadius * PLACE.ringDepth)
      // Seat point → middle of the phalanx, where the mask is centred.
      .addScaledVector(_v6, axisLen * (0.5 - PLACE.ringSeat));
    _mScale.set(maskRadius, st.scale * lengthRatio, maskRadius);

    this._placeMask(this.occluders.finger, 'finger', _mPos, st.quaternion, _mScale, false);

    return true;
  }

  // Are these two slots really holding the same physical hand? When one hand
  // leaves, the tracker keeps serving a held copy of it in the vacated slot for
  // a few frames, and that copy sits right on top of the hand still being
  // tracked. Two slots, two instances, one wrist — two bangles on one arm.
  // A held copy shadows the live hand almost exactly, which no two real hands
  // ever do, so comparing the whole knuckle row tells them apart safely.
  _sameHand(a, b) {
    if (!a || !b) return false;

    let sum = 0;
    for (const i of SAME_HAND_POINTS) {
      if (!a[i] || !b[i]) return false;
      sum += this.dist2D(a[i], b[i]);
    }

    // Judged against the hands' own size, so the test means the same thing
    // near the lens and far from it.
    const span = Math.max(
      this.dist2D(a[HAND.indexMcp], a[HAND.pinkyMcp]),
      this.dist2D(b[HAND.indexMcp], b[HAND.pinkyMcp]),
      1e-3,
    );
    return sum / SAME_HAND_POINTS.length < span * SAME_HAND_LIMIT;
  }

  // A bracelet is worn as a pair, so instance 0 follows one hand and instance 1 the other.
  updateBracelet(entry, tracking) {
    const hands = [tracking.leftHand, tracking.rightHand];
    const sides = [tracking.leftHandIsRight, tracking.rightHandIsRight];
    const misses = [tracking.leftHandMiss, tracking.rightHandMiss];
    let placed = 0;

    // One wrist wears one bangle. If both slots resolve to the same wrist, the
    // staler of the two is the held copy — drop it and place a single bangle.
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
      this._placeBracelet(entry, entry.instances[i], hand, i, sides[i], alpha, tracking);
      placed++;
    }

    // Single-instance fallback:
    // on whichever hand is in view.
    if (!placed && entry.instances.length === 1) {
      const hand = tracking.primaryHand;
      if (!hand || hand.length < 21 || !allInFrame(hand, WRIST_CHAIN)) return false;
      const alpha = freshness(tracking.primaryHandMiss);
      if (alpha <= 0.01) return false;
      this._placeBracelet(
        entry, entry.instances[0], hand, 0, tracking.primaryHandIsRight, alpha, tracking,
      );
      placed++;
    }
    return placed > 0;
  }

  // Elbow → wrist, from Pose, for whichever arm this hand belongs to.
  // A bangle is worn on the FOREARM. Reading its direction off the palm instead
  // means every wrist flex swings the bangle with the hand, which is most of
  // what made it look stuck on rather than worn.
  _forearmAxis(hand, tracking, out) {
    const pose = tracking?.pose;
    if (!pose || pose.length <= POSE.rightWrist) return 0;

    const handWrist = hand[HAND.wrist];
    if (!handWrist) return 0;

    // Match by position, not by side: Pose and Hands label sides independently.
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

    // Trusted in proportion to how well Pose sees the arm and how closely its
    // wrist agrees with the hand's own — never as a hard switch.
    return clamp01((best.seen - FOREARM_MIN_VISIBILITY) / 0.25)
      * clamp01(1 - bestDist / FOREARM_MATCH_RADIUS);
  }

  // A bangle hangs loose on the forearm, so it is solved on the forearm's frame.
  _placeBracelet(entry, inst, hand, slot, isRight, alpha = 1, tracking = null) {
    const index = slot === 1 ? 1 : 0;
    const frame = this._handFrame(hand);
    if (!frame) return;

    this.lmToScreen(hand[HAND.wrist], _v1);

    // Forearm axis
    // The hand only ever gives an approximation of it — the palm is hinged at
    // the wrist. Pose's elbow gives the real thing, and is blended in by how
    // well it is actually seen.
    _n1.copy(frame.along).negate();                   // knuckles → wrist, toward the elbow
    const trust = this._forearmAxis(hand, tracking || this._tracking, _v7);
    if (trust > 0) {
      _v7.negate();                                   // elbow → wrist, reversed
      // Only if the two broadly agree; a mismatch means Pose latched the wrong arm.
      if (_v7.dot(_n1) > 0.2) _n1.lerp(_v7, trust * PLACE.forearmTrust).normalize();
    }

    // Roll
    // Which way the back of the hand faces, from finger curl — held per slot,
    // since the two hands are tracked independently.
    _n2.copy(frame.normal);
    const curl = dorsalSideFromCurl(hand, this, _n2);
    const key = slot === 1 ? 'dorsalSideB' : 'dorsalSideA';
    if (curl !== 0) entry[key] = curl;
    else if (entry[key] === undefined) entry[key] = handSign(isRight);
    _n2.multiplyScalar(entry[key]);

    // Made square to the forearm axis actually in use, not to the palm's.
    _n2.addScaledVector(_n1, -_n1.dot(_n2));
    if (_n2.lengthSq() < 1e-9) return;
    _n2.normalize();

    // A second copy forced toward the lens — seat correction only, never orientation.
    _n3.copy(_n2);
    if (_n3.z < 0) _n3.negate();

    // Scale
    const palmWidth = this.dist3D(hand[HAND.indexMcp], hand[HAND.pinkyMcp]);
    if (!(palmWidth > 1e-4)) return;

    const widthKey = slot === 1 ? 'wristWidthB' : 'wristWidthA';
    const target = palmWidth * PLACE.wristFromPalm;
    const prev = entry[widthKey] || 0;
    const wristWidth = prev > 0
      ? prev + (target - prev) * adapt(LIMB_WIDTH_SMOOTH, this._dtScale)
      : target;
    entry[widthKey] = wristWidth;
    const wristRadius = wristWidth * 0.5;

    // Fitted by the model's own hole, exactly as the ring is, so a bangle sized
    // for a wrist arrives sized for a wrist whatever the file says.
    const inner = entry.analysis?.innerRadius || 0;
    const scale = Math.max(
      inner > 1e-4
        ? (wristRadius * PLACE.bangleHoleFit) / inner
        : wristWidth * PLACE.braceletWidth,
      PLACE.braceletMinPx,
    ) * (entry.tuning.scale ?? 1);

    const holeRadius = inner > 1e-4 ? inner * scale : wristRadius * PLACE.bangleHoleFit;
    const slack = Math.max(holeRadius - wristRadius, 0);

    // Seat
    _pos.copy(_v1)
      .addScaledVector(_n1, wristWidth * PLACE.braceletSlide)
      .addScaledVector(_n3, -wristRadius * PLACE.braceletDepth);

    // A real bangle is loose and gravity parks it on the underside of the wrist.
    // The distance is not a guess — it is the measured slack between the hole
    // and the arm, so a wide kada rides low and a snug one hardly moves.
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

    // Gone from the picture, or covered by the OTHER hand.
    this._markAnchor(`wrist${index}`, _pos, 0xff8800);

    const visible = alpha * (1 - this._handCoverage(_pos, this._tracking, hand));
    if (this._outOfFrame(_pos, scale) || visible <= 0.01) {
      this.place(inst, _pos, scale, _q1, false);
      this._forgetMask(`forearm${index}`);
      return;
    }

    this.place(inst, _pos, scale, _q1, true, visible);

    // Occluder
    // An ELLIPTICAL forearm, sized to the real wrist rather than to the bangle.
    // That is what makes it read as worn: the arm passes in front of the bangle's
    // far side and hides it, while the slack at the top stays open to the light
    // exactly as it does on a real one.
    const st = inst.state;
    _v3.set(0, 1, 0).applyQuaternion(st.quaternion);   // forearm axis, smoothed
    _v4.set(0, 0, 1).applyQuaternion(st.quaternion);   // wrist depth axis, smoothed
    if (_v4.z < 0) _v4.negate();

    // Screen-down in the smoothed frame, so the sag can be taken back off.
    _v8.set(0, -1, 0).addScaledVector(_v3, _v3.y);
    if (_v8.lengthSq() > 1e-9) _v8.normalize();
    else _v8.set(0, 0, 0);

    const inv = 1 / Math.max(scale, 1e-6);
    const toHand = palmWidth * PLACE.forearmMaskToHand;
    const toElbow = palmWidth * PLACE.forearmMaskToElbow;

    _mPos.set(st.position.x, st.position.y, st.depth)
      // The arm does not sag with the bangle, and it does not take the seat push.
      .addScaledVector(_v8, -st.scale * sag * inv)
      .addScaledVector(_v4, st.scale * wristRadius * PLACE.braceletDepth * inv)
      // Centre of a mask that reaches further up the arm than down it.
      .addScaledVector(_v3, st.scale * (toElbow - toHand) * 0.5 * inv);

    // Ratios, so the mask inherits the bangle's smoothed size along with its pose.
    const wide = st.scale * wristRadius * inv;
    _mScale.set(wide, st.scale * (toElbow + toHand) * inv, wide * PLACE.wristDepthRatio);
    this._placeMask(
      this.occluders.forearm[index], `forearm${index}`, _mPos, st.quaternion, _mScale, false,
    );
  }

  // Frame update

  update(tracking) {
    // A null tracking result means "nothing detected" — items fade out
    // rather than freezing wherever they last were.
    if (!tracking) tracking = {};

    // Frame timing
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const elapsed = this._lastFrameTime ? (now - this._lastFrameTime) / 1000 : 1 / 60;
    this._lastFrameTime = now;
    this._dtScale = Math.min(Math.max(elapsed * 60, 0.25), 3);

    // How stale the face landmarks are this frame.
    this._faceMiss = tracking.faceMiss ?? 0;
    // Held for the helpers reached through the per-category updates, which do not carry the…
    this._tracking = tracking;

    // Anchor dots are opt-in per frame, like the masks.
    if (this.showAnchors) {
      for (const mark of this._anchorMarks.values()) mark.visible = false;
    }

    // Occluders are opt-in per frame:
    // the mask it needs.
    // over the video after its jewellery has faded out.
    this._resetOccluders();

    // One head-pose solve per frame, shared by the necklace and both earrings
    // rather than recomputed per item.
    // second.
    this._updateHeadPose(tracking.face);
    this._updateTorsoPose(tracking.pose);

    for (const [, entry] of this.activeItems) {
      let ok = false;
      try {
        if (entry.category === 'necklace') ok = this.updateNecklace(entry, tracking);
        else if (entry.category === 'earring') ok = this.updateEarrings(entry, tracking);
        else if (entry.category === 'ring') ok = this.updateRing(entry, tracking);
        else if (entry.category === 'bracelet') ok = this.updateBracelet(entry, tracking);
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

  // Which trackers actually need to run this frame, and how many hands.
  requiredTrackers() {
    let face = false;
    let hands = false;
    let pose = false;
    let handCount = 1;
    // The accurate hand model, needed only when a piece sits ON the hand.
    let precise = false;

    for (const [, entry] of this.activeItems) {
      if (entry.category === 'necklace' || entry.category === 'earring') {
        face = true;
        // Hands are tracked for face jewellery too, purely so a hand raised over an ear or a…
        if (HIDE_UNDER_HANDS) { hands = true; handCount = 2; }
      }
      if (entry.category === 'necklace') pose = true;
      if (entry.category === 'ring' || entry.category === 'bracelet') hands = true;
      // Only the ring reads individual finger joints, and only it is worth the
      // heavier model — a bangle needs the wrist and knuckles, which the light
      // one already places well.
      if (entry.category === 'ring') precise = true;
      // A bangle rides the forearm, so Pose's elbow is what keeps it off the hand.
      if (entry.category === 'bracelet') pose = true;
      // A paired bangle needs both wrists detected.
      if (entry.category === 'bracelet' && entry.instances.length === 2) handCount = 2;
    }
    return { face, hands, pose, handCount, precise };
  }

  // Composites the camera frame and the rendered jewellery into one canvas.
  captureComposite(video) {
    // Guarantee the overlay is present in the drawing buffer we are about to
    // read, rather than trusting that the last animation frame survived.
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

    // Draw the video with the same mirror + cover crop the page uses,
    // so the saved image matches what is on screen.
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    if (video && video.readyState >= 2) {
      ctx.drawImage(video, this.offX, this.offY, this.dispW, this.dispH);
    }
    ctx.restore();

    // The overlay canvas is dpr-sized internally; drawing it into the CSS-unit
    // coordinate space we just set up maps it back 1:1.
    ctx.drawImage(this.renderer.domElement, 0, 0, w, h);
    return composite;
  }

  // Kept for callers that want a data URL.
  screenshot(video) {
    return this.captureComposite(video).toDataURL('image/png');
  }

  // Live tuning (used by the ?tune=1 panel)

  getTuning(id) {
    return this.activeItems.get(id)?.tuning ?? null;
  }

  // `scale`, `offset*`, `anchor` and the material overrides apply instantly.
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

  // Measure AFTER rotating.
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  const fit = tuning.fitAxis === 'y' ? size.y : tuning.fitAxis === 'z' ? size.z : size.x;
  const norm = 1 / Math.max(fit, 1e-6);

  // matrix = T · R · S, so a geometry point maps to `position + R·(s·p)`.
  // The rotated centre must therefore be cancelled *after* scaling.
  object.scale.setScalar(norm);
  object.position.copy(center).multiplyScalar(-norm);
  object.updateMatrixWorld(true);

  const normSize = size.clone().multiplyScalar(norm);

  // Pivot correction
  // Necklaces get their own treatment
  let opening = null;
  let wrapped = false;
  if (category === 'necklace') {
    opening = findNeckOpening(object);
    if (opening) {
      object.position.sub(opening.center);
      object.updateMatrixWorld(true);

      // Bend a flat necklace around the neck — see wrapNecklaceAroundNeck.
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
    // Only a wrap sorts front from back; without one, assume the worst.
    frontRise = wrapped ? measureFrontRise(object, opening.width * 0.5) : riseAbove;
  }

  // A ring and a bangle are both worn THROUGH their hole, so the hole is what
  // the limb has to be fitted to — measure it once, here, rather than guessing
  // an outer diameter per folder for the rest of time.
  const hoop = (category === 'ring' || category === 'bracelet')
    ? measureHoopRadii(object)
    : null;

  return {
    rawSize,
    normSize,
    normWidth: normSize.x,
    normHeight: normSize.y,
    normDepth: normSize.z,
    pivot: pivot || new THREE.Vector3(),
    // Width of the neck opening, in the same normalised units as normWidth.
    openWidth: opening ? opening.width : normSize.x,
    dropBelow,
    // How far the piece extends ABOVE its opening — for a necklace, how high the chain arcs…
    riseAbove,
    // The same, counting only what ends up in FRONT of the neck — the chin clearance.
    frontRise,
    // 0 when there is no measurable hole; the caller falls back to width sizing.
    innerRadius: hoop ? hoop.innerRadius : 0,
    outerRadius: hoop ? hoop.outerRadius : normSize.x * 0.5,
    // Did this necklace get bent onto a cylinder? Its occluder depends on it.
    wrapped,
  };
}

// Inner and outer radius of a hoop, about its own axis, in normalised units.
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
  // Percentiles rather than the extremes, so one stray vertex cannot define the hole.
  const inner = at(HOOP_INNER_PERCENTILE);
  const outer = at(1 - HOOP_INNER_PERCENTILE);
  if (!(outer > 1e-6)) return null;

  // No real hole — a solid pendant-like shape. Say so instead of inventing one.
  if (inner < outer * HOOP_MIN_HOLE) return null;

  return { innerRadius: inner, outerRadius: outer };
}

// Where the hole edge is taken from in the sorted radii, and the smallest
// hole-to-outer ratio that still counts as a hoop at all.
const HOOP_INNER_PERCENTILE = 0.02;
const HOOP_MIN_HOLE = 0.25;

// A necklace flatter than this fraction of its own width is a planar cut-out and gets…
const NECK_WRAP_FLATNESS = 0.25;

// Exactly a quarter turn, and it MUST be exactly that. The front branch below
// reaches this at the opening's widest point and the back branch reaches twice
// it at the centre. Only at 90° do the two branches meet at the sides (both
// give ±90°) AND close at the back (+180° and -180° are the same point). Any
// other value tears the chain open at one seam or the other.
const NECK_WRAP_ANGLE = 90 * DEG;

// A loop needs this much material above its opening to count as having a back.
const NECK_BACK_MIN = 0.05;

// How much of that rise the swing to the back is spread over.
const NECK_BACK_BLEND = 0.5;

// Bends a flat necklace onto the neck.
// A necklace model is a CLOSED LOOP lying in a plane. The part below its
// opening is the chain that shows at the throat; the part above it is the
// clasp and the rear chain. Sending x straight to an angle puts that rear part
// across the front of the throat — which is what made the back of the chain
// appear on the neck. So the loop is mapped around the neck the way it is
// actually worn: its outline runs the full circle, front at the bottom, clasp
// at the nape, and the two halves blend where they meet at the widest point.
function wrapNecklaceAroundNeck(object, radius) {
  if (!(radius > 1e-6)) return;

  // How far the loop reaches above its opening — the rear chain's own extent.
  let rise = 0;
  object.traverse((child) => {
    if (!child.isMesh) return;
    const attr = child.geometry?.attributes?.position;
    if (!attr || !attr.count) return;
    const a = attr.array;
    for (let i = 1; i < a.length; i += 3) if (a[i] > rise) rise = a[i];
  });

  // An open arc has no rear chain to place, so it keeps the front mapping throughout.
  const span = rise > NECK_BACK_MIN ? rise * NECK_BACK_BLEND : 0;

  object.traverse((child) => {
    if (!child.isMesh) return;
    const attr = child.geometry?.attributes?.position;
    if (!attr || !attr.count) return;

    const a = attr.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i] / radius;                      // -1 .. 1 across the opening
      const u = t < -1 ? -1 : t > 1 ? 1 : t;

      const front = u * NECK_WRAP_ANGLE;
      // Mirrors the front branch about the sides, so the centre of the top bar
      // lands at the nape and the seams match.
      const back = (u < 0 ? -1 : 1) * NECK_WRAP_ANGLE * (2 - Math.abs(u));

      const y = a[i + 1];
      const blend = (span > 0 && y > 0) ? (y >= span ? 1 : y / span) : 0;
      const angle = front + (back - front) * blend;

      const sin = Math.sin(angle);
      const cos = Math.cos(angle);

      // The model's own depth becomes height above the cylinder.
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

// Only the front 120° of the neck is under the chin; the rest is off to the
// side or behind it.
const NECK_FRONT_CONE = 0.5;

// How far the piece rises above its anchor at the FRONT, where it could reach
// the chin. Measured after the wrap, because that is what decides which part of
// the loop ends up at the throat and which ends up behind the neck.
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
      // Anything off to the side or behind cannot reach the wearer's chin.
      if (_pv.z <= near) continue;
      if (_pv.y > rise) rise = _pv.y;
    }
  });
  return rise;
}

// Folds the object's transform into its vertices and resets it to identity.
function bakeTransformIntoGeometry(object) {
  object.updateMatrixWorld(true);

  const done = new Set();
  object.traverse((child) => {
    if (!child.isMesh || !child.geometry || done.has(child.geometry)) return;
    done.add(child.geometry);
    rememberBaseGeometry(child.geometry);
    child.geometry.applyMatrix4(child.matrixWorld);
  });

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

// How many horizontal slices the neck-opening scan uses.
const OPENING_BANDS = 48;

// Locates a necklace's neck opening — the hole the wearer's neck goes through.
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

  // Only the UPPER part of the model is considered.
  const searchFrom = Math.floor(OPENING_BANDS * 0.40);

  let best = -1;
  let bestWidth = 0;
  const scan = (from) => {
    for (let b = from; b < OPENING_BANDS; b++) {
      // Ignore bands too sparse to be a real cross-section — a single stray
      // vertex would otherwise define the opening.
      if (count[b] < 8 || hi[b] < lo[b]) continue;
      const width = hi[b] - lo[b];
      if (width > bestWidth) {
        bestWidth = width;
        best = b;
      }
    }
  };

  scan(searchFrom);
  // Nothing usable up there (a very unusual model) — fall back to the whole
  // piece rather than giving up and leaving it unfitted.
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

// Scratch for the pivot scan — allocated once, not per model.
const _pv = new THREE.Vector3();

// Scratch for world-space model rotations.
const _rotAxis = new THREE.Vector3();
const _rotQuat = new THREE.Quaternion();

// Rotates a model about a WORLD axis, on top of whatever orientation it already has.
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

  const isHoop = category === 'ring' || category === 'bracelet' || category === 'necklace';

  // Band to average over.
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
    // Same sampling budget as the flip test — a 300k-vertex model does not
    // need every point to locate a centre.
    const step = Math.max(1, Math.floor(pos.count / 8000));
    for (let i = 0; i < pos.count; i += step) {
      _pv.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      if (!Number.isFinite(_pv.x) || !Number.isFinite(_pv.y) || !Number.isFinite(_pv.z)) continue;
      if (_pv.y < loY || _pv.y > hiY) continue;
      sx += _pv.x; sz += _pv.z; n++;
    }
  });

  // Too few samples to be meaningful — leave the box centre alone rather than
  // moving the model somewhere arbitrary.
  if (n < 12) return null;

  const cx = sx / n;
  const cz = sz / n;

  // Only X/Z are corrected for a hoop:
  const out = new THREE.Vector3(cx, 0, cz);

  // Refuse absurd corrections:
  // measurement noise on a weird mesh, not a genuine off-centre pivot.
  const limit = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.34;
  if (out.length() > limit) return null;

  return out;
}

// Bounding-box guess at how the model is laid out in its source file.
function applyCanonicalRotation(object, size, category) {
  const dims = [size.x, size.y, size.z];
  const thin = dims.indexOf(Math.min(...dims));

  if (category === 'ring' || category === 'bracelet') {
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

  // The step above gets the piece standing in the right plane, but it cannot
  // tell +Y from -Y — that is a straight coin flip on the exporter's "up"
  // axis, and losing it is what made pieces hang inverted.
  // looking at where the material actually is.
  if (category === 'earring' || category === 'necklace') {
    if (needsUpFlip(object, category)) {
      rotateWorld(object, 0, 0, 1, Math.PI);
      console.log(`[Engine3D] auto-flipped an inverted ${category} model`);
    }
  }

  // Which way does the piece FACE?
  if (category === 'ring' || category === 'bracelet' || category === 'earring') {
    if (needsFaceFlip(object)) {
      rotateWorld(object, 0, 1, 0, Math.PI);
      console.log(`[Engine3D] auto-rotated a ${category} so its detail faces outward`);
    }
  }
}

// Which side of a ring/bracelet carries its decoration? A plain band is symmetric about…
function needsFaceFlip(object) {
  object.updateMatrixWorld(true);

  // Why this is not a bounding-box test
  // Radii are measured from the ring's own centre, not from the model's origin.
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
  // of a ring's surface IS band.
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

  // Protrudes on both sides about equally — symmetric, so the choice is
  // invisible. Leave it exactly as it is rather than reintroducing a flip.
  const bigger = Math.max(front, back);
  if (Math.min(front, back) > bigger * FACE_FLIP_MAX_SYMMETRY) return false;

  // The ornament should end up on +Z.
  return back > front;
}

// How much material must stand proud of the band, and how lopsidedly, before the…
const FACE_FLIP_MIN_STRENGTH = 0.010;
const FACE_FLIP_MAX_SYMMETRY = 0.65;

// How lopsided the two ends must be before the flip test trusts itself.
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
    // Sample rather than scan — a 300k-vertex model doesn't need every point
    // to tell us which end is wider.
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

  // Integrated cross-section — width times depth, summed over the bands.
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
    // Width was inconclusive — fall back to how much material each end holds.
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
      'The OBJ file is malformed — re-export it if the model looks wrong.',
    );
  }
}

// Material + geometry quality

// Average luminance of the probe built below, in LINEAR light — solid-angle weighted…
const ENV_MEAN_LUMINANCE = 0.13;

// A small equirectangular studio probe, written pixel by pixel.
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
    // 0 at the zenith, 1 at the nadir.
    const v = y / (H - 1);
    // Sky 0.62 → horizon 0.34 → floor 0.10.
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

// Scratch for the finger-curl solve.
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

    // Skip a deeply flexed finger.
    const path = _fcMcp.distanceTo(_fcPip) + _fcPip.distanceTo(_fcTip);
    const chord = _fcMcp.distanceTo(_fcTip);
    if (path < 1e-6 || chord / path < CURL_MIN_STRAIGHTNESS) continue;

    // Midpoint of the knuckle→tip chord:
    // the finger were perfectly straight.
    _fcChord.addVectors(_fcMcp, _fcTip).multiplyScalar(0.5);
    // How far, and which way, it actually departs from that line.
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

// Minimum chord-to-bone-path ratio for a finger's bow to be read.
const CURL_MIN_STRAIGHTNESS = 0.80;

// Only used when a model ships NO material at all — no MTL, no colours, nothing to be…
function defaultMetalMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xd4af37,
    metalness: 0.9,
    roughness: 0.25,
    envMapIntensity: 1.0,
    side: THREE.DoubleSide,
  });
}

// Translates a loaded MTL material into a physically-based one, FAITHFULLY.
function toPBRMaterial(src, options) {
  const maxAnisotropy = options?.maxAnisotropy || 1;
  const override = options?.override || {};

  if (!src) return applyMaterialOverride(defaultMetalMaterial(), override);

  const tuneTexture = (tex) => {
    if (!tex) return tex;
    tex.anisotropy = Math.min(maxAnisotropy, 8);
    return tex;
  };

  if (src.isMeshStandardMaterial || src.isMeshPhysicalMaterial) {
    // Already PBR — respect it, and only make sure it fits the scene.
    src.side = THREE.DoubleSide;
    tuneTexture(src.map);
    if (src.envMapIntensity === undefined) src.envMapIntensity = 1.0;
    return applyMaterialOverride(src, override);
  }

  const out = new THREE.MeshPhysicalMaterial();
  out.name = src.name || '';

  // Colour, exactly as authored
  if (src.color) out.color.copy(src.color);
  out.map = tuneTexture(src.map || null);

  if (src.emissive && out.emissive) out.emissive.copy(src.emissive);
  out.emissiveMap = src.emissiveMap || null;
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
    out.specularColorMap = tuneTexture(src.specularMap);
  }

  // Blinn-Phong exponent → roughness, by the usual approximation.
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

  out.envMapIntensity = 1.0;

  out.transparent = src.transparent === true;
  out.opacity = typeof src.opacity === 'number' ? src.opacity : 1;

  // Gemstones
  if (out.transparent && out.opacity < 0.95) {
    // Explicitly NOT metallic.
    // does not exist — rendered as one it reads as grey smoke.
    // the metalness derived above, which has no way of knowing that a low Ns
    // on a transparent material means "gem", not "dull".
    out.metalness = 0;
    out.roughness = Math.min(out.roughness, 0.06);
    out.ior = 2.0;
    out.specularIntensity = Math.max(out.specularIntensity, 1.4);
    out.envMapIntensity = 1.4;
  }

  // Lots of exported OBJs have inconsistent face winding, which makes half
  // the model vanish under backface culling.
  out.side = THREE.DoubleSide;

  return applyMaterialOverride(out, override);
}

// Per-folder material overrides from MODEL_TUNING.
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

// Every MTL statement that names an image file.
const MTL_TEXTURE_LINE = /^\s*(map_ka|map_kd|map_ks|map_ke|map_ns|map_d|map_bump|bump|map_refl|norm|disp|decal)\s+(\S.*)$/i;

// Removes texture statements whose image file is not actually there.
// Image extensions worth trying when the exact filename an MTL names is not there.
const TEXTURE_EXTENSIONS = ['jpg', 'JPG', 'jpeg', 'JPEG', 'png', 'PNG', 'webp', 'WEBP'];

// Every filename worth trying for one MTL texture reference.
function textureCandidates(name) {
  const out = [name];
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const dir = slash >= 0 ? name.slice(0, slash + 1) : '';
  const file = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return out;

  const stem = file.slice(0, dot);
  const ext = file.slice(dot + 1);

  // Ordered cheapest-likeliest first, and kept short.
  out.push(`${dir}${stem}.${ext.toLowerCase()}`);
  out.push(`${dir}${stem}.${ext.toUpperCase()}`);
  out.push(`${dir}${stem.toLowerCase()}.${ext.toLowerCase()}`);
  for (const alt of TEXTURE_EXTENSIONS) out.push(`${dir}${stem}.${alt}`);

  return [...new Set(out)];
}

// Repairs an MTL's texture references against what is actually on disk.
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
          // A network error is not proof the file is missing.
          // present and let the texture loader try it properly, rather than
          // stripping a good reference because the connection hiccuped.
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

    // Replace only the final token, leaving any `-bm 0.02` options intact.
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

// Makes a freshly parsed geometry safe and well-shaded.
function prepareGeometry(geometry, label) {
  scrubNaNVertices(geometry, label);

  let out = geometry;
  const normals = out.attributes.normal;
  const count = out.attributes.position?.count || 0;

  if (!normals || !normalsAreUsable(normals)) {
    // Drop the unusable normals BEFORE welding, not after.
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

// A normal buffer full of zeros renders black, and some exporters emit exactly that.
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

// Resolved version suffixes, so one asset is probed once per session.
const _assetVersions = new Map();

// Short, stable, URL-safe token for an arbitrary validator string.
function versionToken(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Appends a content-derived version to an asset URL.
async function versionedUrl(url) {
  if (!_assetVersions.has(url)) {
    _assetVersions.set(url, (async () => {
      try {
        // `no-cache` on the probe itself:
        // cache is would defeat the purpose.
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

// Builds the `?v=` suffix from whatever validators a response carries.
function assetVersionSuffix(headers) {
  const etag = headers.get('etag');
  const length = headers.get('content-length');
  const modified = headers.get('last-modified');
  // Length first, because it is the one validator that changes when a model
  // is swapped for a different one carrying the same archive timestamp.
  const validator = [length, etag, modified].filter(Boolean).join('|');
  return validator ? `?v=${versionToken(validator)}` : '';
}

async function fetchTextWithProgress(rawUrl, onProgress) {
  const url = await versionedUrl(rawUrl);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);

  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total || typeof onProgress !== 'function') {
    return res.text();
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
  return new TextDecoder().decode(merged);
}

// Catalogue

const OBJ_CANDIDATES = ['model.obj', 'scene.obj', '1.obj', '2.obj', '3.obj'];

export async function resolveObjFile(folder) {
  for (const name of [...OBJ_CANDIDATES, `${folder}.obj`]) {
    try {
      // no-cache, so a folder that has just had its first model dropped in is
      // not reported empty because an earlier 404 was cached.
      const res = await fetch(`objects/${folder}/${name}`, { method: 'HEAD', cache: 'no-cache' });
      if (res.ok) return name;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export async function probeFolder(folder) {
  const objFile = await resolveObjFile(folder);
  return objFile ? { folder, objFile, available: true } : { folder, available: false };
}

// The four categories the engine knows how to PLACE.
export const CATEGORY_ORDER = ['necklace', 'earring', 'ring', 'bracelet'];

export const CATEGORY_LABELS = {
  necklace: 'Necklace',
  earring: 'Earrings',
  ring: 'Ring',
  bracelet: 'Bangles',
};

// Fallback list, used only when objects/index.json is absent.
export const FOLDER_CATALOG = [
  'necklace-gold', 'necklace-diamond', 'necklace-mala',
  'earring-gold', 'earring-diamond', 'earring-hoop',
  'ring-band', 'ring-solitaire',
  'bangle-gold', 'bangle-diamond',
];

// Reads objects/index.json, if there is one.
async function readManifest() {
  try {
    const res = await fetch('objects/index.json', { cache: 'no-cache' });
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
        });
      }
    }
    return entries.length ? entries : null;
  } catch {
    // No manifest, or it is not valid JSON.
    // surfacing — the fallback list covers it.
    return null;
  }
}

// Every jewellery item the app should offer, with its model file resolved.
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
    const found = await probeFolder(entry.folder);
    return {
      id: entry.folder,
      folder: entry.folder,
      category,
      label: entry.label || folderToLabel(entry.folder, category),
      objFile: found.objFile,
      available: found.available,
    };
  }));

  return probed.filter(Boolean);
}

// Names that mean the same category.
const CATEGORY_ALIASES = {
  bangle: 'bracelet',
  bangles: 'bracelet',
  kada: 'bracelet',
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

// Works out which category a folder belongs to from its name.
export function folderToCategory(folder) {
  const words = String(folder).toLowerCase().split(/[-_\s]+/).filter(Boolean);
  for (const word of words) {
    const hit = normaliseCategory(word);
    if (hit) return hit;
  }
  // Last resort: the category word may be run together with something else,
  // as in "goldnecklace".
  const joined = words.join('');
  for (const cat of CATEGORY_ORDER) {
    if (joined.includes(cat)) return cat;
  }
  return null;
}

// A readable name, with the category word moved to the end.
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