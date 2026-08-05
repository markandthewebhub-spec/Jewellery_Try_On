# Virtual Jewellery Try-On Plugin

You are a Senior Computer Vision Engineer, Senior Three.js Engineer, MediaPipe Expert, JavaScript Architect, and Real-Time AR Developer.

Your responsibility is NOT to simply generate code.

Your responsibility is to build a production-quality Virtual Jewellery Try-On Plugin that behaves like a real commercial jewellery try-on system.

Think like a senior engineer who has built Snapchat filters, Instagram AR effects, and commercial virtual try-on systems.

------------------------------------------------------------
IMPORTANT
------------------------------------------------------------

This is NOT a college project.

This is NOT a demo.

This is NOT an architecture showcase.

This plugin will later be integrated into websites like:

- Shopify
- WordPress
- Custom Websites

Therefore the implementation must be clean, lightweight and practical.

DO NOT over-engineer.

The primary objective is REALISTIC JEWELLERY PLACEMENT.

NOT fancy architecture.

------------------------------------------------------------
CURRENT PROJECT
------------------------------------------------------------

I already have these files.

index.html
style.css
objects/

DO NOT recreate them.

DO NOT redesign the UI.

DO NOT replace the HTML.

DO NOT replace the CSS.

Reuse my existing HTML and CSS.

You may ONLY modify them if absolutely necessary for integration.

Otherwise keep them exactly as they are.

------------------------------------------------------------
OBJECTS FOLDER
------------------------------------------------------------

I already have:

objects/

Inside I have folders such as

necklace-gold
necklace-diamond

earring-gold
earring-diamond
earring-hoop

ring-band
ring-solitaire

bracelet-gold
bracelet-diamond

Each folder MAY contain

model.obj

OPTIONAL
model.mtl

OPTIONAL
texture images

The plugin MUST support

OBJ only

OBJ + MTL

OBJ + Texture

without changing any code.

Never create another assets folder.

Never move my objects folder.

Always load directly from objects/.

------------------------------------------------------------
PROJECT STRUCTURE
------------------------------------------------------------

Keep the plugin extremely small.

Preferred structure

index.html

style.css

app.js

mediapipe.js

engine3d.js

objects/

DO NOT create

20 folders

manager folders

service folders

renderer folders

tracking folders

configuration folders

unless absolutely required.

The plugin should remain lightweight.

------------------------------------------------------------
PRIMARY GOAL
------------------------------------------------------------

This project is judged ONLY by these points.

1.

Correct Jewellery Placement

2.

Correct Scale

3.

Correct Rotation

4.

Smooth Movement

5.

Real-time Tracking

6.

Automatic Calibration

NOT by architecture.

NOT by number of files.

NOT by abstraction.

------------------------------------------------------------
MOST IMPORTANT REQUIREMENT
------------------------------------------------------------

The plugin MUST automatically determine

Model Size

Model Orientation

Model Scale

Model Camera Direction

without requiring manual adjustments.

The user should NEVER need to manually edit

Rotation X

Rotation Y

Rotation Z

Scale

Position

for every jewellery model.

The plugin should intelligently analyse the loaded model and fit it naturally whenever possible.

------------------------------------------------------------
CAMERA
------------------------------------------------------------

Camera is the MOST IMPORTANT part of this project.

The camera should work correctly on

Desktop Chrome

Android Chrome

iPhone Safari

ngrok

The plugin will primarily be tested on a MOBILE PHONE using ngrok.

Keep this in mind during development.

------------------------------------------------------------
MEDIAPIPE
------------------------------------------------------------

Use MediaPipe.

Use

Face Mesh

Hands

Pose

Use the correct landmarks for every jewellery type.

Never guess landmark positions.

Use actual MediaPipe landmarks.

------------------------------------------------------------
JEWELLERY TYPES
------------------------------------------------------------

Support

Necklace

Earrings

Ring

Bracelet

Each jewellery type MUST have completely independent placement logic.

Never use the same placement algorithm for all jewellery.

Necklace follows neck.

Earrings follow ears.

Ring follows finger.

Bracelet follows wrist.

Each requires different mathematics.

------------------------------------------------------------
STOP HERE BEFORE CODING
------------------------------------------------------------

Before writing any code,

analyse

index.html

style.css

objects/

Understand the project first.

Only then begin implementation.

Do NOT immediately start generating code.

# MASTER CURSOR PROMPT — PART 2

============================================================
CORE COMPUTER VISION REQUIREMENTS
============================================================

This section is the MOST IMPORTANT section of the entire project.

The primary objective is NOT to simply render a 3D object.

The primary objective is to make every jewellery model behave like real jewellery attached to the user's body.

Everything below has higher priority than architecture.

If there is any trade-off between architecture and placement accuracy,

ALWAYS choose placement accuracy.

============================================================
REAL PROBLEM TO SOLVE
============================================================

The previous implementation had the following issues.

The plugin MUST solve ALL of them.

Problem 1

The jewellery stays fixed in the center of the screen.

This MUST NEVER happen.

------------------------------------------------------------

Problem 2

The jewellery follows the camera incorrectly.

Instead of following the tracked landmark,
it appears detached.

This MUST NEVER happen.

------------------------------------------------------------

Problem 3

Necklace appears extremely small.

It should automatically resize according to the user's body.

------------------------------------------------------------

Problem 4

Earrings appear like a hat.

Wrong scale.

Wrong rotation.

Wrong placement.

------------------------------------------------------------

Problem 5

OBJ models require manual rotation values.

This MUST NOT be required.

------------------------------------------------------------

Problem 6

Every new OBJ requires manual adjustments.

The plugin should minimize manual work.

============================================================
AUTOMATIC MODEL ANALYSIS
============================================================

Immediately after loading every OBJ model,

analyse the model.

Determine

Bounding Box

Bounding Sphere

Width

Height

Depth

Center

Model Dimensions

Largest Axis

Model Origin

Never assume all OBJ files are exported identically.

Different modelling software exports models differently.

The plugin should adapt automatically.

============================================================
AUTOMATIC SCALE DETECTION
============================================================

Do NOT hardcode jewellery scale.

Instead,

calculate scale dynamically.

Examples

Necklace

↓

Use shoulder width

Use neck width

Use jaw width

Use face size

------------------------------------------------------------

Earrings

↓

Use ear size

Use face width

Use jaw width

------------------------------------------------------------

Ring

↓

Use finger width

Finger length

------------------------------------------------------------

Bracelet

↓

Use wrist width

Hand width

============================================================
ABSOLUTELY FORBIDDEN
============================================================

Never do this

model.scale.set(0.02)

model.scale.set(0.05)

model.scale.set(0.2)

for every jewellery.

Scale should be computed.

============================================================
AUTOMATIC ORIENTATION
============================================================

Different OBJ files may face

Front

Back

Left

Right

Up

Down

The plugin should detect the model orientation whenever possible.

Never assume

Rotation Y = 180°

works for every jewellery.

Avoid hardcoded rotations.

============================================================
AUTOMATIC CAMERA FIT
============================================================

The camera must naturally frame the jewellery.

The user should NEVER manually edit

Rotation

Scale

Position

to make the model visible.

The plugin should automatically fit the model to the tracked landmark.

============================================================
BODY TRACKING
============================================================

Movement is the highest priority.

Jewellery should NEVER remain fixed.

Jewellery should move naturally with

Head

Neck

Shoulders

Hands

Finger

Wrist

============================================================
TRACKING PRIORITY
============================================================

Movement

↓

Scale

↓

Rotation

↓

Visual Effects

Never prioritize graphics over tracking.

============================================================
NECKLACE PLACEMENT
============================================================

Necklace should NOT follow only the chin.

Instead,

combine multiple landmarks.

Use

Left Jaw

Right Jaw

Chin

Shoulders

Neck Center

Estimate a stable neck anchor.

The necklace should remain centered while the user turns the head.

Movement should feel natural.

============================================================
EARRING PLACEMENT
============================================================

Each earring must be calculated independently.

Use

Left Ear

Right Ear

Ear Lobe

Face Rotation

Head Rotation

Never place earrings using the neck anchor.

Each ear should move independently.

============================================================
RING PLACEMENT
============================================================

Use

Ring Finger

Finger Direction

Finger Rotation

Finger Width

The ring should rotate together with the finger.

============================================================
BRACELET PLACEMENT
============================================================

Use

Wrist

Hand Direction

Palm Rotation

Wrist Width

Bracelet should naturally rotate with the hand.

============================================================
COORDINATE SYSTEM
============================================================

One consistent coordinate system must be used.

Avoid mixing

Normalized Coordinates

World Coordinates

Screen Coordinates

without proper conversion.

Every conversion should be intentional.

============================================================
MOVEMENT
============================================================

Movement must be smooth.

Never jitter.

Never teleport.

Never jump.

Never freeze.

============================================================
SMOOTHING
============================================================

Apply smoothing only after the tracking is correct.

Never use smoothing to hide incorrect placement.

Tracking must first be accurate.

Then smooth.

============================================================
CAMERA MIRROR
============================================================

The preview camera is mirrored.

Jewellery placement must correctly match the mirrored preview.

Do not accidentally mirror only one jewellery type.

============================================================
DEBUGGING RULE
============================================================

If any jewellery

stays fixed,

appears too small,

appears too large,

appears in the screen center,

does not follow the tracked landmark,

or has incorrect rotation,

STOP adding features.

Find the root cause.

Fix the mathematics.

Only continue after the placement is correct.

============================================================
DEFINITION OF SUCCESS
============================================================

The feature is NOT complete because

the OBJ is visible.

The feature is complete ONLY when

✓ Correct Position

✓ Correct Rotation

✓ Correct Scale

✓ Correct Landmark

✓ Smooth Tracking

✓ Natural Movement

✓ No Manual Calibration

✓ Works for different OBJ models

without requiring manual adjustments for every new jewellery.

# MASTER CURSOR PROMPT — PART 3

============================================================
THREE.JS RENDERING ENGINE
============================================================

The rendering engine must be lightweight,
clean,
fast,
and easy to maintain.

The rendering engine is NOT responsible for
tracking.

Tracking is MediaPipe's responsibility.

Rendering is Three.js responsibility.

Never mix them together.

============================================================
RESPONSIBILITIES
============================================================

MediaPipe

↓

Detect landmarks

↓

Return landmark positions

↓

Three.js

↓

Load models

↓

Position models

↓

Rotate models

↓

Scale models

↓

Render models

============================================================
DO NOT MIX RESPONSIBILITIES
============================================================

MediaPipe should NEVER

Load OBJ

Load MTL

Render Models

Three.js should NEVER

Run Face Detection

Run Pose Detection

Run Hand Detection

Keep both systems completely independent.

============================================================
MODEL LOADING
============================================================

Always load models dynamically.

Never hardcode every jewellery.

The plugin should automatically read

objects/

detect available folders

and load models.

Never require editing JavaScript
every time a new jewellery is added.

============================================================
SUPPORTED MODELS
============================================================

Support

OBJ

OBJ + MTL

OBJ + JPG

OBJ + PNG

OBJ + MTL + Texture

If MTL does not exist

continue loading.

If texture does not exist

continue loading.

The model should still render.

============================================================
MODEL VALIDATION
============================================================

Before rendering

validate

model.obj exists

If not

show a clean user-friendly message.

Never display

model.obj missing

404

stack trace

console errors

to the user interface.

============================================================
MODEL CACHE
============================================================

Cache already loaded models.

Never reload

the same OBJ

every time

the user clicks ON.

Load once.

Reuse.

============================================================
CATEGORY RULES
============================================================

Only one jewellery
per category.

Example

Allowed

Diamond Necklace

+

Diamond Earrings

+

Gold Ring

+

Gold Bracelet

-----------------------------------

Not Allowed

Gold Necklace

+

Diamond Necklace

-----------------------------------

If user clicks

Gold Necklace

while

Diamond Necklace

is ON

Automatically

Diamond Necklace OFF

Gold Necklace ON

============================================================
TOGGLE EFFECT
============================================================

Current glow effect
is too basic.

Replace it.

Use

Smooth Fade

Soft Scale Animation

Luxury Highlight

Premium Feel

Do NOT use

cheap glow

flashing animation

============================================================
ON OFF NOTIFICATION
============================================================

Display

Diamond Necklace ON

Diamond Necklace OFF

Gold Earrings ON

Gold Ring OFF

Bottom notification.

Automatically disappear
after around

10–12 seconds.

Never display

technical information.

Never display

model.obj

objects/

folder path

loading file

============================================================
LOADING EXPERIENCE
============================================================

When loading a jewellery

Show

Loading...

Disable the clicked button

Prevent multiple clicks

After loading

Enable again.

============================================================
RENDER LOOP
============================================================

Use only ONE animation loop.

Never create

multiple requestAnimationFrame loops.

============================================================
PERFORMANCE
============================================================

Target

60 FPS

Avoid

heavy allocations

inside render()

Avoid

creating new objects

inside every frame.

Reuse vectors.

Reuse temporary objects.

============================================================
CAMERA
============================================================

Camera should automatically resize

when browser size changes.

Support

Desktop

Tablet

Mobile

Portrait

Landscape

============================================================
NGROK
============================================================

The plugin will be tested using

ngrok

on a mobile phone.

The camera should work correctly.

The rendering should work correctly.

No desktop-only implementation.

============================================================
MOBILE SUPPORT
============================================================

Support

Android Chrome

iPhone Safari

Chrome Desktop

Edge

============================================================
SCREENSHOT
============================================================

Support screenshot.

The screenshot should include

Camera

+

Rendered Jewellery

in one final image.

============================================================
ERROR HANDLING
============================================================

If tracking is lost

Do NOT

teleport jewellery.

Do NOT

leave jewellery floating.

Gracefully

hide

or

fade out.

When tracking returns

smoothly restore.

============================================================
FAILURE CONDITIONS
============================================================

The implementation is considered FAILED if

Jewellery freezes

Jewellery stays in screen center

Jewellery jumps

Jewellery flickers

Jewellery rotates randomly

Jewellery scale changes unexpectedly

Jewellery appears detached

Any of these issues

must be fixed

before continuing.

============================================================
IMPLEMENTATION STRATEGY
============================================================

Implement one feature at a time.

Complete it.

Test it.

Then continue.

Do NOT build
the whole project blindly.

============================================================
FINAL RULE
============================================================

Do not stop coding

just because

the model becomes visible.

The implementation is complete ONLY when

✓ Movement feels natural

✓ Jewellery follows the body

✓ Scale looks realistic

✓ Rotation looks realistic

✓ Camera feels correct

✓ User never manually adjusts
Rotation X

Rotation Y

Rotation Z

Scale

Position

The entire plugin should work
automatically.

# MASTER CURSOR PROMPT — PART 4

============================================================
USER INTERFACE
============================================================

The HTML and CSS are already available.

DO NOT recreate them.

DO NOT redesign the interface.

Reuse the existing UI.

Only modify HTML or CSS if absolutely required for functionality.

Otherwise leave them unchanged.

============================================================
DESIGN STYLE
============================================================

The overall feeling should be

Luxury

Premium

Modern

Minimal

Elegant

Jewellery is a luxury product.

Avoid

cheap animations

gaming effects

flashing colors

heavy glow

Everything should feel clean and premium.

============================================================
BUTTONS
============================================================

Every jewellery item should have

OFF state

Loading state

ON state

Disabled state

The transition between these states should be smooth.

============================================================
CATEGORY BEHAVIOUR
============================================================

Each jewellery category allows ONLY one active item.

Example

Necklace

✓ Gold Necklace

OR

✓ Diamond Necklace

Never both together.

----------------------------------------------------

Same rule for

Earrings

Ring

Bracelet

----------------------------------------------------

Different categories MAY remain active together.

Example

✓ Necklace

+

✓ Earrings

+

✓ Ring

+

✓ Bracelet

This is allowed.

============================================================
AUTOMATIC TOGGLE
============================================================

If

Diamond Necklace

is ON

and user clicks

Gold Necklace

Automatically

Diamond Necklace OFF

Gold Necklace ON

without asking the user.

============================================================
BUTTON EFFECT
============================================================

Replace the existing toggle effect.

Current effect feels basic.

Create a premium interaction.

Examples

Soft Scale

Smooth Fade

Subtle Border Animation

Luxury Accent

Avoid

Strong Glow

Neon

Gaming UI

============================================================
BOTTOM NOTIFICATION
============================================================

Display a notification whenever jewellery changes.

Examples

Diamond Necklace ON

Diamond Necklace OFF

Gold Earrings ON

Diamond Ring OFF

Gold Bracelet ON

------------------------------------------------------------

Notification position

Bottom Center

------------------------------------------------------------

Duration

Approximately 10–12 seconds

------------------------------------------------------------

Animation

Fade In

Stay

Fade Out

============================================================
NEVER DISPLAY
============================================================

Never show

model.obj

model.mtl

objects/

file path

technical messages

debug information

console errors

404

stack traces

The user should only see meaningful messages.

============================================================
LOADING STATE
============================================================

When loading a model

Disable the clicked button.

Prevent repeated clicks.

Show

Loading...

After loading

Automatically enable the button.

============================================================
ERROR MESSAGE
============================================================

If loading fails

Show

Unable to load this jewellery.

Please try another model.

Do NOT expose technical details.

============================================================
CAMERA EXPERIENCE
============================================================

When the user clicks

Start Camera

Camera should open smoothly.

No flashing.

No layout jumps.

No unnecessary delay.

============================================================
TRACKING STATUS
============================================================

Display simple status.

Examples

Camera Ready

Tracking Face

Tracking Hand

Tracking Lost

Camera Stopped

Do not display internal debugging text.

============================================================
SCREENSHOT
============================================================

The screenshot button should capture

Camera

+

Jewellery

as one final image.

Downloaded image should look exactly like the preview.

============================================================
RESPONSIVE DESIGN
============================================================

The UI should work correctly on

Desktop

Tablet

Mobile Portrait

Mobile Landscape

============================================================
MOBILE EXPERIENCE
============================================================

Large touch buttons.

Comfortable spacing.

Easy to operate with one hand.

============================================================
ACCESSIBILITY
============================================================

Buttons should have

ARIA labels

Keyboard support where applicable

Clear active state

============================================================
ANIMATION
============================================================

Animations should be subtle.

Keep them between

150ms

and

300ms

Avoid long animations.

============================================================
USER EXPERIENCE
============================================================

The user should never need technical knowledge.

Everything should feel automatic.

Load jewellery.

Turn it ON.

Start camera.

Everything else should happen automatically.

============================================================
IMPORTANT
============================================================

Never prioritize visual effects over tracking accuracy.

A perfectly tracked jewellery model with simple UI

is always better than

a beautiful UI with incorrect tracking.

Tracking quality is the highest priority.

# MASTER CURSOR PROMPT — PART 5

============================================================
DEBUG UNTIL SUCCESS
============================================================

This project is NOT complete simply because

• The project builds successfully.

• There are no JavaScript errors.

• The camera opens.

• MediaPipe detects landmarks.

• The OBJ model is visible.

None of these mean the plugin is finished.

============================================================
THE PROJECT IS COMPLETE ONLY WHEN
============================================================

Every jewellery model

✓ follows the correct body landmark

✓ has the correct scale

✓ has the correct rotation

✓ has smooth movement

✓ never freezes

✓ never jumps

✓ never jitters excessively

✓ feels like real jewellery attached to the user.

============================================================
STOP ADDING FEATURES
============================================================

If ANY of these problems exist

Necklace stays in screen center

Earrings appear like a hat

Ring floats

Bracelet floats

Scale is incorrect

Rotation is incorrect

Jewellery shakes badly

Jewellery does not move with the user

Tracking feels unrealistic

STOP.

Do NOT continue implementing new features.

Do NOT continue improving UI.

Do NOT continue optimizing code.

Find the root cause first.

============================================================
ROOT CAUSE ANALYSIS
============================================================

Before changing code

identify

WHY

the problem happens.

Never randomly change values.

Never randomly change

Rotation X

Rotation Y

Rotation Z

Scale

Position

Never fix problems by trial and error.

Always determine the mathematical reason.

============================================================
DEBUGGING ORDER
============================================================

Whenever placement fails

always debug in this order.

--------------------------------------------

STEP 1

Verify MediaPipe landmarks.

Are they correct?

--------------------------------------------

STEP 2

Verify landmark selection.

Is the correct landmark being used?

--------------------------------------------

STEP 3

Verify coordinate conversion.

Normalized

↓

Screen

↓

Three.js

--------------------------------------------

STEP 4

Verify model origin.

--------------------------------------------

STEP 5

Verify automatic scale.

--------------------------------------------

STEP 6

Verify automatic rotation.

--------------------------------------------

STEP 7

Verify smoothing.

Only after the previous steps are correct.

============================================================
NEVER HIDE BUGS
============================================================

Do NOT hide placement errors using

heavy smoothing

large offsets

hardcoded rotations

hardcoded scale

hardcoded position

Fix the mathematics.

============================================================
AUTOMATIC CALIBRATION
============================================================

Every new jewellery model should require

little to no manual adjustment.

The plugin should intelligently adapt to

different OBJ files.

Automatic analysis is preferred over

hardcoded values.

============================================================
REAL WORLD BEHAVIOUR
============================================================

Imagine a real necklace.

When the user

moves left

the necklace moves left.

When the user

moves right

the necklace moves right.

When the user

leans forward

the necklace should naturally follow.

The same applies to

earrings

ring

bracelet

============================================================
NEVER ACCEPT THESE RESULTS
============================================================

❌ Jewellery fixed at screen center

❌ Necklace too small

❌ Earrings too large

❌ Jewellery detached from body

❌ Random rotation

❌ Flickering

❌ Teleporting

❌ Floating jewellery

❌ Wrong mirror direction

These are failures.

============================================================
MOVEMENT QUALITY
============================================================

Movement should feel

stable

natural

smooth

predictable

Real jewellery never teleports.

Real jewellery never instantly jumps.

============================================================
SCALING QUALITY
============================================================

Jewellery size should naturally adapt

to different users.

Large face

↓

Slightly larger jewellery.

Small face

↓

Slightly smaller jewellery.

Do not use one fixed scale for everyone.

============================================================
ROTATION QUALITY
============================================================

Rotation should come from

body movement

not from

hardcoded values.

When the head rotates

necklace rotates naturally.

When the hand rotates

ring rotates naturally.

============================================================
COMMON MISTAKES TO AVOID
============================================================

Never assume

every OBJ has identical orientation.

Never assume

every jewellery has identical size.

Never assume

every landmark behaves the same.

Never use

magic numbers

without explanation.

Never hardcode

values only because they worked for one model.

============================================================
DEVELOPMENT PHILOSOPHY
============================================================

This plugin is being built

to solve a real problem.

The goal is not

to demonstrate software architecture.

The goal is

accurate tracking

realistic placement

excellent user experience.

Always prioritize

real-world behaviour

over engineering complexity.

============================================================
CONTINUE UNTIL SUCCESS
============================================================

Do not stop after making the jewellery visible.

Continue improving

until

the jewellery behaves naturally.

If necessary

iterate multiple times.

Analyse.

Test.

Improve.

Repeat.

Only stop when

movement

scale

rotation

placement

all feel realistic.

============================================================
FINAL DEBUG RULE
============================================================

Whenever you believe the feature is complete

ask yourself

Would this behaviour be acceptable
in a commercial virtual jewellery try-on website?

If the answer is

No

continue debugging.

If the answer is

Yes

only then continue to the next feature.

# MASTER CURSOR PROMPT — PART 6

============================================================
FINAL ACCEPTANCE CRITERIA
============================================================

The implementation is considered COMPLETE only if every requirement below passes successfully.

============================================================
PROJECT STRUCTURE
============================================================

□ Existing index.html reused

□ Existing style.css reused

□ Existing objects folder reused

□ No unnecessary folders created

□ Plugin remains lightweight

□ Clean project structure

============================================================
OBJECT LOADING
============================================================

□ OBJ models load successfully

□ OBJ without MTL works

□ OBJ with MTL works

□ OBJ with textures works

□ OBJ without textures works

□ Loading never crashes

□ Failed loading handled gracefully

============================================================
AUTOMATIC MODEL ANALYSIS
============================================================

□ Model bounding box analysed

□ Model dimensions calculated

□ Model size detected

□ Model center calculated

□ Automatic scale applied

□ Automatic orientation determined whenever possible

□ No manual editing required for every new model

============================================================
CAMERA
============================================================

□ Camera opens correctly

□ Camera works on Desktop Chrome

□ Camera works on Android Chrome

□ Camera works on iPhone Safari

□ Camera works through ngrok

□ Camera resizes correctly

□ Mirror view behaves correctly

============================================================
MEDIAPIPE
============================================================

□ Face Mesh works

□ Hands work

□ Pose works

□ Landmark detection is stable

□ Tracking recovers after temporary loss

============================================================
NECKLACE
============================================================

□ Appears around the neck

□ Never stays fixed in screen center

□ Correct scale

□ Correct rotation

□ Moves with head

□ Moves with shoulders

□ Smooth movement

□ No shaking

============================================================
EARRINGS
============================================================

□ Left earring follows left ear

□ Right earring follows right ear

□ Correct rotation

□ Correct scale

□ No hat effect

□ No floating

□ Smooth movement

============================================================
RING
============================================================

□ Ring follows finger

□ Correct finger rotation

□ Correct scale

□ Smooth movement

□ No floating

============================================================
BRACELET
============================================================

□ Bracelet follows wrist

□ Correct wrist rotation

□ Correct scale

□ Smooth movement

□ No floating

============================================================
TRACKING QUALITY
============================================================

□ Jewellery follows body naturally

□ No freezing

□ No jumping

□ No teleporting

□ No heavy jitter

□ Stable movement

============================================================
UI
============================================================

□ Existing HTML reused

□ Existing CSS reused

□ Premium button animation

□ Premium toggle effect

□ Luxury appearance

□ Responsive layout

============================================================
CATEGORY LOGIC
============================================================

□ Only one Necklace active

□ Only one Earrings active

□ Only one Ring active

□ Only one Bracelet active

□ Different categories can remain ON together

============================================================
NOTIFICATIONS
============================================================

□ Bottom notification

□ Fade animation

□ Automatically disappears after approximately 10–12 seconds

□ User-friendly messages only

Examples

Diamond Necklace ON

Diamond Necklace OFF

Gold Earrings ON

============================================================
NEVER DISPLAY
============================================================

The UI must NEVER display

model.obj

model.mtl

objects/

folder paths

stack traces

technical errors

404 messages

debug text

============================================================
PERFORMANCE
============================================================

□ Smooth rendering

□ Stable FPS

□ No unnecessary allocations

□ One render loop only

□ Cached models reused

============================================================
SCREENSHOT
============================================================

□ Screenshot captures

Camera

+

Jewellery

in one final image

============================================================
ERROR HANDLING
============================================================

□ Failed model loading handled

□ Camera permission handled

□ Tracking loss handled

□ No application crash

============================================================
COMMERCIAL QUALITY TEST
============================================================

Before considering the plugin complete,

ask yourself

Would this plugin be acceptable

on

a jewellery e-commerce website

where real customers try jewellery before buying?

If the answer is

NO

continue improving.

If the answer is

YES

continue.

============================================================
ABSOLUTELY DO NOT STOP IF
============================================================

Jewellery remains fixed.

Jewellery appears detached.

Jewellery appears too small.

Jewellery appears too large.

Jewellery rotates incorrectly.

Jewellery does not follow the body.

Any category logic fails.

Notifications show technical messages.

Camera behaves incorrectly.

If any of the above exists,

the project is NOT complete.

============================================================
FINAL DEFINITION OF DONE
============================================================

The project is considered COMPLETE ONLY when

✓ Jewellery automatically loads

✓ Jewellery automatically fits the user

✓ Jewellery automatically scales

✓ Jewellery automatically rotates

✓ Jewellery follows the correct body landmark

✓ Movement feels natural

✓ No manual Rotation X/Y/Z required

✓ No manual Scale required

✓ Works with different OBJ models

✓ Works on mobile

✓ Works with ngrok

✓ Feels like a real commercial Virtual Jewellery Try-On Plugin

============================================================
FINAL INSTRUCTION
============================================================

Before writing any code,

study

index.html

style.css

objects/

understand the existing project,

reuse everything possible,

keep the plugin lightweight,

and focus on solving the real problem:

Accurate automatic placement,
automatic scaling,
automatic orientation,
smooth movement,
and production-quality user experience.

Do not optimize for architecture.

Optimize for a working Virtual Jewellery Try-On experience.