# Jewellery Try On

Try necklaces, earrings, rings and bangles on yourself, live, through the camera.

Everything runs in the browser. No photo, video or measurement ever leaves the
device — nothing is uploaded anywhere.

## Run it

The app loads ES modules and fetches files, so it needs a web server — opening
`index.html` from disk will not work.

```
python -m http.server 8000
```

Then open <http://localhost:8000>.

The camera needs **HTTPS**, or `localhost`. Nothing else.

## Add jewellery

One folder per piece under `objects/`:

```
objects/
  necklace-gold/
    model.obj          the 3D model
    model.mtl          optional, OBJ only
    Necklace_stone.jpg optional texture
    demo.jpg           the picture shown in the grid
```

Then add the folder name to `objects/index.json`:

```json
{ "items": ["necklace-gold", "ring-band"] }
```

Reload the page. That is all — no JavaScript to edit.

### Folder name sets the category

`necklace-gold` becomes a Gold Necklace. The category word can lead or trail,
and dashes, underscores and spaces all work.

| Category | Also understood as |
|---|---|
| `necklace` | chain, pendant |
| `earring` | earrings, stud, studs |
| `ring` | rings |
| `bangles` | bangle, bracelet, kada |

### File name

Name the model **`model.<ext>`**. `scene.<ext>` and `<folder-name>.<ext>` are
also found; OBJ additionally accepts `1.obj`, `2.obj`, `3.obj`. Any other name
will not be found.

### Formats

`glb` · `gltf` · `obj` · `stl` · `ply` · `fbx` · `3ds` · `dae` · `3mf` · `3dm`

If a folder holds more than one, that is the order of preference.

**GLB is the best choice** — one file carrying its own materials and textures,
and the smallest download.

Three to know about:

- **STL** has no materials at all, so it renders as one solid metal.
- **3DM** (Rhino) stores NURBS surfaces. Save it *with render meshes*, or it
  opens as an empty scene.
- **`.gltf`** (the text form) keeps its `.bin` and textures as separate files —
  they must sit in the same folder.

STEP, IGES, `.blend` and `.ztl` cannot be opened by any browser and have to be
converted first.

## When a model sits wrong

The engine works out the orientation from the model's shape, which gets it right
in almost every case. What it cannot guess is a piece rotated flat-on — a ring
spun a quarter turn on its own axis looks identical to a bounding box.

Open the page with `?tune=1`, adjust the sliders, press **Copy config**, and
paste the line into `MODEL_TUNING` near the top of `engine3d.js`:

```js
export const MODEL_TUNING = {
  'ring-solitaire': { offsetY: 0.15, rotY: 180 },
};
```

## URL options

| | |
|---|---|
| `?category=ring` | open showing one category only |
| `?item=ring-band` | auto-select that piece |
| `?tune=1` | show the tuning sliders |
| `?debug=1` | on-screen console, for phones |

## Files

| | |
|---|---|
| `index.html` | the page, and the import map that pins every version |
| `app.js` | screens, product grid, buttons |
| `engine3d.js` | model loading, orientation, sizing, placement, rendering |
| `mediapipe.js` | face, hand and pose tracking |
| `tuning.js` | the `?tune=1` sliders |
| `style.css` | all styling |
| `objects/` | the jewellery |

No build step. No dependencies to install — three.js and MediaPipe load from a
CDN.

## Versions are pinned

three.js is pinned in the import map in `index.html`. The MediaPipe `<script>`
tags in `index.html` **must** stay in step with `MP_VERSION` in `mediapipe.js`,
or tracking silently never produces a result.
