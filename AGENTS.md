# lemona.de — working with a running show

This folder is a **lemona.de 0.1.0** project (a node-based VJ app):
`project.ron` is the show, `shaders/` its nodes' own shader files. The app
writes this file, `CLAUDE.md` and `docs/` when the project is opened or
created, so don't edit them; write shaders and send commands as described
below.

- This show's own shaders: `/Users/melocilde/Movies/sense/shaders` — every GLSL node's file, and
  a built-in node's own copy once its shader was edited (in the app's SHADER
  panel). One file per node, used by that node only; `state.json` gives each
  node's `shader`. Editing a file changes only its node.
- Shared shaders: `/Users/melocilde/work/vj-app/shaders` (built-in `generators/`, `effects/`, …,
  shared code in `util/`, a library of GLSL starting points in `user/`). They
  are used by every node of their kind: don't edit them for one node.
- Live state: `agent/state.json`
- Commands: `agent/commands/*.json` → results in `agent/results/`
- Snapshots: `agent/snapshots/*.png`
- References: `docs/shader-recipes.md` (GLSL snippets: beat, triggers, audio,
  palette), `docs/expressions.md` (binding expressions, Japanese)
- `project.ron` is written by the app on SAVE (unsaved edits live in the
  app's autosave). Read it if useful, but never write it; change the show with
  commands.

The app must be running for state, commands and snapshots. `state.json`
has `"app": "lemona.de"` and a `written_at` time (Unix seconds); it is
rewritten within a second of any change.

## How a show is built

- 4 **layers** × 8 **cells** (or, in 16-layer mode, 16 layers of one cell
  each, all playing — `grid_mode` command, `state.json` `grid_mode`; each mode
  keeps its own cells). Each cell is its own node graph ending in the
  cell's `Out` node; each layer plays one cell; the layers are composited into
  the master output (through the crossfader: layers on side A / B fade with it,
  THRU ones always show — `crossfader` command), followed by the master tint (`state.json`
  `master_tint`, 0 = off: the master's luma mapped onto the palette, dark → color 1 … bright → color 8), post FX and the master level (`state.json`
  `master_level`, 0 = black; the user's master fader). Cells are numbered like the UI:
  `{"layer": 1..4, "slot": 1..8}`, in 16-layer mode `{"layer": 1..16}` (`slot`
  1 or left out); `"grid": "4"` / `"16"` names a mode's cells (default: the
  playing mode). `state.json` writes every cell with its `grid`, so a cell
  from it names the same cell in any mode. The EDITOR tab shows one cell
  (`state.json` `editing`).
  A launch waits for the layer's quantize point on the beat clock (the next
  bar by default) and changes cells with the layer's transition (a cut by
  default) — `layer` command; pass `quantize: "off"` to `launch` to switch at
  once. Launches, quantize, transitions, autopilot and scenes belong to the
  4-layer grid: 16-layer mode plays every layer's one cell.
- **TEX** nodes are fullscreen fragment shaders producing a 1920×1080 texture
  (× `render_scale`). **SIG** nodes compute float values on the CPU each frame;
  **STR** nodes compute text the same way (String ports connect only to String
  ports; Number to String / Format / String to Number / Length / Text Compare
  cross between text and numbers). Format templates use `{…}` holes: a text
  input (`{s1}`) or a numeric expression with an optional format
  (`{bpm:.0}`, `{a:03}`). **Clock** outputs the current time as text
  (`format` is strftime, default `%H:%M:%S`; `time zone` an IANA name, empty =
  the system's) plus `hour` / `minute` / `second`.
- A **GLSL** node runs its own file in `/Users/melocilde/Movies/sense/shaders`. Its two inputs
  `in0` and `in1` are `u_tex0` and `u_tex1`. Its params are whatever the
  file's `NodeParams` block declares (see below).
- A **Base** groups nodes (like a TouchDesigner Base COMP). Nodes inside it
  have its id as `parent` in `state.json`; add them with `add_node` +
  `parent`. Its ports are the **TEX In / TEX Out**, **SIG In / SIG Out** and
  **Text In / Text Out** nodes inside it, named by their `name` param (ports
  sorted by name: `in1`, `in2`, …). Connections only join nodes with the same
  parent; Base / In / Out cost nothing (values pass straight through).
  `group` / `ungroup` move nodes into / out of a Base; `expose` shows a
  param of a node inside on the Base's NODE tab (`exposed` in `state.json`);
  `save_component` / `add_component` reuse a Base with everything inside.
- A **Particle** turns a texture into particles simulated on the GPU.
  `add_node` with `"kind": "Particle"` makes it with a TEX In `in`, a
  TEX Out `out` (both fixed: not removable or renamable) and a starting chain
  inside: Emit Pixels → Return → Curl Noise → Render Points. Connect a
  texture to the COMP's `in` and its `out` onward. The PARTICLE nodes below
  only work inside one (add them with `parent` = the COMP) and join by
  `particles` ports into one chain: one Emit node, any Forces in order, one
  Render node (no fan-out). Particle positions are in the frame's 0..1 uv;
  frame-unit params (Gravity / Explode `x` `y`) are −1..1 with y up. The
  COMP's `max particles` caps the count (the Emit `step` grid is widened to
  fit), `reset_particles` starts them over, and its `particles` in
  `state.json` gives `emitted` / `capacity`. Explode pushes while `amount`
  > 0 — bind a trigger (`trig(0)`) for bursts.
- Any numeric param can be **bound**: up to 4 float wires from SIG nodes
  (ports named `speed`, `speed 2`, …) and/or an expression (`set_expr`).
  Text params (Text `text`, Image / Video `file`, …) bind the same way with
  String wires from STR nodes (joined in order into `x`) and a `{…}` template
  as the expression, e.g. `/clips/{floor(beats) % 4:.0}.mp4` or `{x1}/{x2}.png`.
- **Video** nodes play their `file` with hot cues A–H (saved with the
  show): `state.json` gives a Video's `video` (`position` / `duration`
  seconds, `playing`, `ended` (loop off and played out: `play` true starts it over), `held` (`play` on but paused as nothing shows it: `layer_hidden`, `cell_not_playing`, `not_connected`; else null), `rate`, `cues`; with `auto sync` on, `rate` = the show's BPM /
  the clip's `bpm` and `speed` is ignored; negative = backwards, `reverse` on), the `video`
  command seeks, sets / jumps to cues, plays / pauses and sets `reverse` / `speed` / `auto sync` / `bpm`.
- **MIDI** controllers drive the performance (cells, triggers — velocity =
  strength —, tempo, layers, post FX) and node params; the user maps them
  (MIDI window, learn). `state.json` `midi` lists devices and performance
  mappings, a param's `midi` its control (`audio` gives the gain / floor and
  hit thresholds / decay knobs can also turn); the `midi` command plays a message
  through them.
- **Triggers** (`u_triggers`, `trig(i)` in expressions) are 4 pads that jump
  to 1 and decay; the **step sequencer** fires them on the beat clock: 4 rows
  (t1 kick, t2 snare / clap, t3 hats, t4 accent) × 16 16th-note steps, one
  bar. `state.json` `sequencer` gives `enabled`, `rows` (`x` = on) and the
  built-in `preset` it matches; the `sequencer` command edits it (a preset,
  whole rows or single steps) — e.g. `{"cmd": "sequencer", "preset":
  "house", "set": [{"pad": 3, "step": 4, "on": true}]}`.

## Workflow for shader work

1. Read `agent/state.json` to see the cells, nodes, params and errors.
2. Create a node with `add_glsl` (optionally with `"source"` and `"out": true`
   to connect it to the cell's Out), or edit a node's file in
   `/Users/melocilde/Movies/sense/shaders`.
3. Saving the file hot-reloads it. Params are re-read from `NodeParams` on
   save; values of params that keep their name and type are kept.
4. Check the node in `state.json`: `pipeline` goes `building` → `ready` or
   `failed`, and `error` holds the compiler message with line numbers
   (`…/foo.frag:23: error: …`).
5. Look at the result with `snapshot` (waits for the build) and read the PNG.
   It shows one frame; for motion, take several or reason from the code.

## GLSL conventions

```glsl
#version 450
#include "util/common.glsl"   // EngineUniforms, u_tex0..3, fft(), palette(), monochrome()
#include "util/uv.glsl"       // optional helpers, see below

layout(location = 0) in vec2 v_uv;      // 0..1, origin at the TOP-left
layout(location = 0) out vec4 f_color;  // alpha is ignored: outputs are opaque

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;   // 0..4 = 1       rotation speed
    int   steps;   // 1..16 = 4
    int   shape;   // circle|square|tri = square
    bool  invert;  // = true
    vec4  tint;    // color = 1,0.5,0
};

void main() {
    vec3 src = texture(u_tex0, v_uv).rgb;   // black if in0 is unconnected
    f_color = vec4(src, 1.0);
}
```

- `NodeParams` fields become the node's params in order. Only `float`, `int`,
  `bool` and `vec4` (a color) are allowed, one field per line, 256 bytes max.
- A `//` comment on the field's line may start with a spec: a range
  `min..max` (float default 0..1, int 0..10), `a|b|c` choices (int), or `color`
  (vec4). It may then give a default `= value`: for choices, a label or an
  index; for colors, `r,g,b` or `r,g,b,a`. Without a default a number takes
  the middle of its range, a bool false and a color white. Text after the
  spec is a free description.
- A block that doesn't parse gives the node four 0..1 knobs `a b c d`, and
  the error shows in `state.json` (`error`, `NodeParams line N: …`).
- Includes resolve against `/Users/melocilde/work/vj-app/shaders`. Don't edit `util/` or the
  built-in folders: they are replaced when the app updates. The files in
  `/Users/melocilde/Movies/sense/shaders` are yours.
- Sizes given in pixels should be multiplied by `u_scale` (render scale).
- Unconnected texture inputs are transparent black (alpha 0). Connected ones
  are always opaque.

## Engine uniforms (`util/common.glsl`)

```glsl
layout(set = 0, binding = 0) uniform EngineUniforms {
    float u_time;
    float u_bpm;        // tempo (detected or tapped)
    float u_phase;      // position within the beat, 0..1
    float u_level;      // overall audio level, 0..1
    vec2  u_resolution; // the size drawn (the atlas with atlas mapping; see world_uv())
    float u_beat;       // 1 on each beat, decaying towards 0
    float u_beats;      // beats elapsed (continuous)
    vec4  u_fft4[16];   // 64 FFT bins (20 Hz..16 kHz, log-spaced, 0..1) packed as vec4
    vec4  u_palette[8]; // color palette (rgb); see palette(t) below
    vec4  u_bands;      // audio bands 0..1: x sub, y low, z mid, w high
    vec4  u_triggers;   // trigger pads 1–4 (x..w): 1 when fired, decaying to 0
    vec4  u_hits;       // audio band hits (x sub, y low, z mid, w high): 1 on a hit, decaying to 0
    float u_scale;      // render scale: multiply sizes given in full-resolution pixels by it
    // Atlas mapping (see world_uv() below); 0 slots = off.
    int   u_slot_count;
    vec2  u_world_resolution;   // the world (the show's frame) in render pixels
    vec4  u_slot_atlas[32];     // per slot: its atlas rect (min xy, max xy) in UV
    vec4  u_slot_to_world[64];  // per slot: 2 rows of the atlas UV → world UV affine
    vec4  u_slot_to_atlas[64];  // per slot: 2 rows of the world UV → atlas UV affine
};

// Texture inputs, in the node's input port order. Unconnected inputs are
// transparent black (rgb 0, alpha 0); connected inputs are always opaque
// (alpha 1), since node outputs only keep the RGB a shader writes.
layout(set = 0, binding = 2) uniform sampler2D u_tex0;
layout(set = 0, binding = 3) uniform sampler2D u_tex1;
layout(set = 0, binding = 4) uniform sampler2D u_tex2;
layout(set = 0, binding = 5) uniform sampler2D u_tex3;
```

## Shared GLSL helpers (`util/`)

### `util/common.glsl`

Common uniforms provided by the engine to every fragment shader. Usage: #include "util/common.glsl"  Each node shader may also declare its parameters, in the order the node defines them (Float/Int/Bool = 4 bytes, Color = vec4): layout(set = 0, binding = 1) uniform NodeParams { float radius; };

```glsl
float fft(int i);
vec3 palette(float t);  // The palette blended along t (0..1): smooth steps between the 8 colors. Matches lemonade_core::palette::sample.
vec3 monochrome(vec3 c);  // Grayscale by Rec. 709 luma (generators' `mono` param).
vec2 atlas_apply(vec4 row0, vec4 row1, vec2 p);
bool atlas_in_slot(int i, vec2 atlas);
int atlas_slot(vec2 uv);  // The slot showing atlas UV `uv` (the first one), -1 for none.
float world_aspect();  // World width / height.
vec2 world_uv(vec2 uv);  // The world UV of atlas UV `uv` (0..1 across the world; −1 outside every slot). Remembers the slot for sample_world().
vec2 atlas_uv_found(vec2 w, out bool found, out int slot);  // Where world UV `w` is in the atlas: in the last world_uv() slot if it holds it, else the first slot that does. `found` is false when none does (then the result is in the last world_uv() slot, if any, or w).
void world_home(vec2 w);  // For passes drawn in the world's layout (pre-passes: v_uv is a world UV): make sample_world() try the slot showing world UV `w` first.
vec2 atlas_uv(vec2 w);  // Atlas UV of world UV `w` (see atlas_uv_found; −1 when no slot shows it).
const float ATLAS_CLAMP_REACH = 0.03;  // How far past the edge of the slot it clamps into sample_world() still reads that edge pixel, as a fraction of the world's height (~32 px at 1080p): enough for filters reading a few pixels around (blurs, shakes, waves), while a point deep in a hole between slots (a zoomed-out or turned picture) reads black instead of filling the hole with one stretched edge pixel. It fades out over the second half.
vec4 sample_world(sampler2D tex, vec2 w);  // `tex` (drawn in the atlas layout, like every node output) at world UV `w`. Reads stay half a texel inside the slot, so filtering never mixes in a neighbouring slot; a point no slot shows reads the nearest pixel of the last world_uv() slot (like a texture's clamped edge) up to ATLAS_CLAMP_REACH past its edge, else transparent black.
bool atlas_unused(vec2 uv);  // Whether atlas UV `uv` is outside every slot (nothing there is sent).
```

### `util/uv.glsl`

UV helpers for effect nodes. Needs util/common.glsl (u_world_resolution).  "Centred" coordinates: the frame centre is (0, 0), y points up, y runs −1..1 from the bottom to the top edge and x is scaled by the aspect ratio, so rotations keep circles round. Node position params use frame units (−1..1 across and up) — convert them with frame_offset(). The frame is the world (see world_uv() in common.glsl): pass world_uv(v_uv) to to_centered.

```glsl
float aspect();
vec2 to_centered(vec2 uv);
vec2 from_centered(vec2 p);
vec2 frame_offset(float x, float y);
vec2 rotate_deg(vec2 p, float degrees);  // Rotate counter-clockwise by `degrees`.
const int EDGE_BLACK = 0;  // Edge modes, indices = lemonade_core::builtin::EDGE_MODES.
const int EDGE_REPEAT = 1;
const int EDGE_MIRROR = 2;
bool edge_uv(inout vec2 uv, int edge);  // World UV `uv` folded into 0..1 per `edge`; false when it falls off (black).
vec4 sample_edge(sampler2D tex, vec2 uv, int edge);  // Sample `tex` (a node input, in the atlas layout) at world UV `uv`, treating coordinates outside 0..1 per `edge`.
vec4 sample_edge_image(sampler2D tex, vec2 uv, int edge);  // The same for an image laid out like the world (a CPU-made image: Text, Image, Video frames, …).
```

### `util/noise.glsl`

Hash and value-noise helpers for generators. Usage: #include "util/noise.glsl"

```glsl
float hash21(vec2 p);  // Pseudo-random 0..1 per 2D cell.
vec2 hash22(vec2 p);  // Pseudo-random 2D offset 0..1 per cell.
float noise2(vec2 p);  // Smooth value noise, 0..1.
float fbm(vec2 p, int octaves);  // Fractal noise: `octaves` layers of noise2, 0..1.
```

### `util/blend.glsl`

Blend mode library. Mode indices match lemonade_core::builtin::BLEND_MODES. Usage: #include "util/blend.glsl"   then   blend_mode(mode, base, layer)

```glsl
const int BLEND_NORMAL      = 0;
const int BLEND_ADD         = 1;
const int BLEND_SUBTRACT    = 2;
const int BLEND_MULTIPLY    = 3;
const int BLEND_SCREEN      = 4;
const int BLEND_OVERLAY     = 5;
const int BLEND_SOFT_LIGHT  = 6;
const int BLEND_HARD_LIGHT  = 7;
const int BLEND_COLOR_DODGE = 8;
const int BLEND_COLOR_BURN  = 9;
const int BLEND_DARKEN      = 10;
const int BLEND_LIGHTEN     = 11;
const int BLEND_DIFFERENCE  = 12;
const int BLEND_EXCLUSION   = 13;
vec3 blend_overlay(vec3 b, vec3 l);
vec3 blend_soft_light(vec3 b, vec3 l);
vec3 blend_mode(int mode, vec3 base, vec3 layer);  // The result of putting `layer` over `base` with `mode`, before opacity.
vec3 blend(int mode, vec3 base, vec3 layer, float amount);  // Composite `layer` over `base` with `mode` and weight `amount` (0..1).
```

### `util/blur.glsl`

One axis of a separable Gaussian blur reaching ±radius px with sigma = radius / 2. `texel` is one pixel along the axis in UV, e.g. vec2(1.0 / u_world_resolution.x, 0.0).  Up to 32 px, taps sit on every texel and neighbours are merged into one bilinear fetch at their weighted position (exact); beyond, 16 taps per side spread across the radius. At most 33 fetches per axis.  gaussian_axis reads `tex` as laid out like `uv` (a pre-pass, in the world's layout); gaussian_axis_world reads a node input (the atlas layout) at world UV `uv` through sample_world().

```glsl
const int BLUR_TAPS = 16;
vec4 blur_tap(sampler2D tex, vec2 uv, bool atlas);
vec4 gaussian_axis_of(sampler2D tex, vec2 uv, vec2 texel, float radius, bool atlas);
vec4 gaussian_axis(sampler2D tex, vec2 uv, vec2 texel, float radius);
vec4 gaussian_axis_world(sampler2D tex, vec2 uv, vec2 texel, float radius);
```

## Binding expressions

Expressions are set with `set_expr` on a numeric param (on a text param,
`set_expr` takes a `{…}` template instead, see `docs/expressions.md`) and
evaluated every frame. They are C-like floats: `+ - * / %`, comparisons, `&& || !`,
`c ? a : b`. There are no statements, vectors or comments. The result is
clamped to the param's range; an int param rounds it, and a bool param is
true when it's non-zero.

Locals: `x` is the combined wires (or the slider value when no wire is
connected), `x1`..`x4` are the individual wires (0 when unconnected), and `v`
is the slider value. Inside an Expression SIG node the locals are `a b c d`
(its inputs).

| Variable | Meaning |
|---|---|
| `time` | seconds since launch |
| `dt` | seconds since the previous frame |
| `bpm` | tempo |
| `phase` | position in the current beat, 0..1 |
| `beat` | pulse on each beat: 1 on the beat, decaying to 0 |
| `beats` | beats counted so far (continuous; its fraction is `phase`) |
| `level` | overall audio level 0..1 |
| `onset` | attack strength |
| `sub` | sub band level 0..1 |
| `low` | low band level 0..1 |
| `mid` | mid band level 0..1 |
| `high` | high band level 0..1 |
| `pi` | 3.14159… |

| Function | Meaning |
|---|---|
| `sin(x)` | radians |
| `cos(x)` | radians |
| `tan(x)` | radians |
| `abs(x)` | absolute value |
| `floor(x)` | round down |
| `ceil(x)` | round up |
| `round(x)` | round to nearest |
| `fract(x)` | `x - floor(x)` |
| `sqrt(x)` | square root (negative values count as 0) |
| `sign(x)` | -1, 0 or 1 |
| `hash(x)` | pseudo-random 0..1 determined by x (same x, same value) |
| `trig(x)` | trigger pad value, 0-based: pads 1–4 are `trig(0)`..`trig(3)` |
| `band(x)` | band level: 0 = sub, 1 = low, 2 = mid, 3 = high |
| `hit(x)` | band hit: 1 on an attack in band i (0 = sub, 1 = low, 2 = mid, 3 = high) above its threshold, decaying to 0 |
| `fft(x)` | FFT bin 0..63 (log spaced) |
| `pow(a, b)` | `pow(a, b)` = a to the power b |
| `min(a, b)` | smaller of a, b |
| `max(a, b)` | larger of a, b |
| `mod(a, b)` | GLSL mod: sign follows b (`mod(-1, 4)` = 3) |
| `step(a, b)` | `step(edge, x)`: 1 if x >= edge, else 0 |
| `clamp(a, b, c)` | `clamp(x, lo, hi)` |
| `mix(a, b, c)` | `mix(a, b, t)` = a + (b - a) * t |
| `smoothstep(a, b, c)` | `smoothstep(e0, e1, x)`, GLSL argument order |

Examples: `v + beat * 0.5` · `mix(v, 1, low)` · `trig(0) > 0.5 ? 1 : 0.2` ·
`fract(beats / 2) * 360 - 180` · `mod(floor(beats / 4), 2) == 0 ? v : 0`

## Built-in nodes

Use these names with `add_node`. `in` / `out` are texture ports unless marked
(float).

### TEX

- **Base** (group) — params: `name` text
- **Particle** (group) — params: `name` text, `max particles` int 1024..262144 = 262144, `seed` int 0..9999 = 0
- **TEX In** (group) — params: `name` text
- **TEX Out** (group) — in: in — params: `name` text
- **SIG In** (group) — params: `name` text
- **SIG Out** (group) — in: in (float) — params: `name` text
- **Text In** (group) — params: `name` text
- **Text Out** (group) — in: in (string) — params: `name` text
- **Plasma** (source) `generators/plasma.frag` — params: `speed` 0..4 = 1, `scale` 0.1..8 = 1, `mono` bool = false
- **Rings** (source) `generators/rings.frag` — params: `speed` 0..4 = 1, `scale` 0.1..8 = 1, `mono` bool = false
- **Grid** (source) `generators/grid.frag` — params: `speed` 0..4 = 1, `scale` 0.1..8 = 1, `width` 0.005..0.3 = 0.04, `pulse` 0..1 = 0.5, `mono` bool = false
- **Stripes** (source) `generators/stripes.frag` — params: `speed` 0..4 = 1, `scale` 0.1..8 = 1, `angle` -180..180 = 30, `sharpness` 0..1 = 0.8, `mono` bool = false
- **Polygon** (source) `generators/polygon.frag` — params: `speed` 0..4 = 1, `scale` 0.1..8 = 1, `sides` int 3..12 = 6, `kick` 0..1 = 0.4, `mono` bool = false
- **Clouds** (source) `generators/clouds.frag` — params: `speed` 0..4 = 1, `scale` 0.1..8 = 1, `octaves` int 1..8 = 5, `contrast` 0.5..3 = 1.2, `mono` bool = false
- **Voronoi** (source) `generators/voronoi.frag` — params: `speed` 0..4 = 1, `scale` 0.1..8 = 1, `jitter` 0..1 = 1, `edge` 0..0.3 = 0.05, `mono` bool = false
- **Flow** (source) `generators/flow.frag` — params: `speed` 0..4 = 1, `scale` 0.1..8 = 1, `warp` 0..4 = 1.5, `mono` bool = false
- **Tunnel** (source) `generators/tunnel.frag` — params: `speed` 0..4 = 1, `scale` 0.1..8 = 1, `twist` -4..4 = 1, `glow` 0..2 = 1, `mono` bool = false
- **Sphere** (source) `generators/sphere.frag` — params: `speed` 0..4 = 1, `scale` 0.1..8 = 1, `displace` 0..1 = 0.4, `mono` bool = false
- **Spectrum** (source) `generators/spectrum.frag` — params: `speed` 0..4 = 1, `scale` 0.1..8 = 1, `gain` 0..4 = 1.5, `mode` bars|radial = bars, `mono` bool = false
- **Raymarch** (source) `generators/raymarch.frag` — params: `speed` 0..4 = 1, `scale` 0.1..8 = 1, `shape` sphere|box|torus|menger = sphere, `smooth` 0..1 = 0.5, `repeat` 0..1 = 0, `bass` 0..1 = 0.5, `mono` bool = false
- **Shape** (source) `generators/shape.frag` — params: `speed` 0..4 = 1, `scale` 0.1..8 = 1, `shape` circle|rect|star|polygon = circle, `sides` int 3..12 = 5, `outline` 0..0.5 = 0, `rotate` -180..180 = 0, `repeat` int 1..8 = 1, `fill` white|palette = white, `mono` bool = false
- **Blur** (effect) `effects/blur.frag` — in: in — params: `radius` 0..64 = 8
- **Transform** (effect) `effects/transform.frag` — in: in — params: `scale` 0.1..8 = 1, `x` -1..1 = 0, `y` -1..1 = 0, `rotate` -180..180 = 0, `edge` black|repeat|mirror = black
- **Fit** (effect) `effects/fit.frag` — in: in — params: `width` int 1..8192 = 1920, `height` int 1..8192 = 1080, `fit` best|outside|horizontal|vertical|native|fill = best, `justify h` left|center|right = center, `justify v` bottom|center|top = center, `scale x` 0.05..4 = 1, `scale y` 0.05..4 = 1, `x` -1..1 = 0, `y` -1..1 = 0, `edge` black|repeat|mirror = black
- **Lens Distortion** (effect) `effects/lens.frag` — in: in — params: `k1` -1..1 = 0.2, `k2` -1..1 = 0, `k3` -1..1 = 0, `p1` -0.2..0.2 = 0, `p2` -0.2..0.2 = 0, `chroma` -0.2..0.2 = 0, `zoom` 0.25..4 = 1, `x` -1..1 = 0, `y` -1..1 = 0, `edge` black|repeat|mirror = black
- **Mirror** (effect) `effects/mirror.frag` — in: in — params: `angle` 0..360 = 90, `x` -1..1 = 0, `y` -1..1 = 0, `flip` bool = false
- **Kaleidoscope** (effect) `effects/kaleidoscope.frag` — in: in — params: `segments` int 2..24 = 6, `rotate` -180..180 = 0, `spin` -2..2 = 0, `zoom` 0.25..4 = 1, `x` -1..1 = 0, `y` -1..1 = 0
- **Bloom** (effect) `effects/bloom.frag` — in: in — params: `threshold` 0..1 = 0.6, `knee` 0..0.5 = 0.1, `radius` 1..256 = 24, `intensity` 0..4 = 1, `spread` 0..1 = 0.5, `color` color = [1.0, 1.0, 1.0, 1.0], `input` 0..2 = 1, `mode` composite|bloom only|threshold = composite
- **Color** (effect) `effects/color.frag` — in: in — params: `brightness` -1..1 = 0, `contrast` 0..3 = 1, `saturation` 0..3 = 1, `hue` -180..180 = 0, `invert` 0..1 = 0
- **Level** (effect) `effects/level.frag` — in: in — params: `invert` 0..1 = 0, `black level` 0..1 = 0, `brightness` 0..4 = 1, `gamma` 0.1..4 = 1, `contrast` 0..4 = 1, `opacity` 0..1 = 1
- **Feedback** (effect) `effects/feedback.frag` — in: in — params: `amount` 0..0.99 = 0.9, `zoom` 0.9..1.1 = 1.01, `rotate` -10..10 = 0, `x` -0.02..0.02 = 0, `y` -0.02..0.02 = 0, `mode` max|add|over = max
- **Delay** (effect) `effects/delay.frag` — in: in — params: `frames` int 0..60 = 4
- **Displace** (effect) `effects/displace.frag` — in: in, map — params: `amount` -1..1 = 0.1, `rotate` -180..180 = 0, `source` red green|brightness = red green, `edge` black|repeat|mirror = mirror
- **Optical Flow** (effect) `effects/optical_flow.frag` — in: in — params: `output` vectors|speed|direction = vectors, `range` 0.1..5 = 1, `search` int 1..3 = 2, `smooth` 0..0.98 = 0.5, `threshold` 0..0.2 = 0.02
- **Glitch** (effect) `effects/glitch.frag` — in: in — params: `split` 0..64 = 6, `angle` 0..360 = 0, `blocks` 0..1 = 0, `block size` 4..256 = 32, `drive` always|beat|trigger 1|trigger 2|trigger 3|trigger 4|level = always
- **Pixelate** (effect) `effects/pixelate.frag` — in: in — params: `size` 1..128 = 8
- **Posterize** (effect) `effects/posterize.frag` — in: in — params: `levels` int 2..32 = 6, `gamma` 0.3..3 = 1
- **Edge Detect** (effect) `effects/edge_detect.frag` — in: in — params: `threshold` 0..1 = 0.1, `width` 0.5..4 = 1.5, `color` white|source|palette = white, `show` edges|over = edges
- **Chroma Key** (effect) `effects/chroma_key.frag` — in: in — params: `source` color|palette = color, `color` color = [0.0, 1.0, 0.0, 1.0], `palette` int 0..7 = 0, `tolerance` 0..1 = 0.25, `softness` 0..1 = 0.1, `spill` 0..1 = 0.5, `output` keyed|matte = keyed
- **Blend** (mixer) `mixers/blend.frag` — in: a, b — params: `mix` 0..1 = 0.5, `mode` Normal|Add|Subtract|Multiply|Screen|Overlay|Soft Light|Hard Light|Color Dodge|Color Burn|Darken|Lighten|Difference|Exclusion = Normal
- **Mask Mix** (mixer) `mixers/mask_mix.frag` — in: a, b, mask — params: `amount` 0..1 = 1, `invert` bool = false
- **Image** (source) `sources/image.frag` — params: `file` text, `fit` fit|fill|stretch = fit
- **Audio FFT** (source) `sources/audio_fft.frag` — params: `mode` spectrum|spectrogram = spectrogram, `gain` 0..4 = 1, `history` 0.5..30 = 4, `data` spectrum|flux|chroma = spectrum, `axis` log|linear = log, `scale` dB|linear = dB
- **Audio Scope** (source) `sources/audio_scope.frag` — params: `mode` waveform|split|vectorscope = waveform, `gain` 0..8 = 1, `window` 2..170 = 20, `trigger` bool = true, `thickness` 0.5..16 = 2, `persistence` 0..0.99 = 0.8, `grid` bool = false
- **Plot** (source) `sources/plot.frag` — in: a (float), b (float), c (float), d (float) — params: `history` 0.5..60 = 4, `auto range` bool = true, `min` -100..100 = 0, `max` -100..100 = 1, `style` line|fill = line, `thickness` 0.5..16 = 2, `grid` bool = false
- **Face Detect** (effect) `effects/face_detect.frag` — in: in — params: `output` mask|overlay|cutout = mask, `face` int 0..7 = 0, `threshold` 0.3..0.95 = 0.6, `smooth` 0..0.98 = 0.7, `shape` ellipse|rect = ellipse, `size` 0.5..3 = 1.2, `feather` 0..1 = 0.3
- **Person Detect** (effect) `effects/person_detect.frag` — in: in — params: `output` mask|overlay|cutout = mask, `target` head|body|hand|face = head, `index` int 0..7 = 0, `threshold` 0.1..0.95 = 0.4, `smooth` 0..0.98 = 0.7, `shape` ellipse|rect = ellipse, `size` 0.5..3 = 1.1, `feather` 0..1 = 0.3
- **Blob Detect** (effect) `effects/blob_detect.frag` — in: in — params: `output` mask|overlay|cutout|motion = overlay, `blob` int 0..31 = 0, `mode` background|motion = background, `threshold` 0.01..1 = 0.12, `blur` int 0..3 = 2, `learn` 0..1 = 0.01, `frames` int 1..30 = 4, `capture` bool = false, `min size` 0..0.2 = 0.002, `max size` 0..1 = 1, `clean` int 0..2 = 1, `join` int 0..4 = 2, `left` 0..1 = 0, `right` 0..1 = 1, `top` 0..1 = 0, `bottom` 0..1 = 1, `smooth` 0..0.98 = 0.5, `shape` ellipse|rect = rect, `size` 0.5..3 = 1, `feather` 0..1 = 0.1
- **Video** (source) `sources/video.frag` — params: `file` text, `play` bool = true, `loop` bool = true, `speed` 0..4 = 1, `reverse` bool = false, `auto sync` bool = false, `bpm` 40..240 = 120, `fit` fit|fill|stretch = fit, `hardware` bool = true
- **Camera** (source) `sources/camera.frag` — params: `device` text, `active` bool = true, `fit` fit|fill|stretch = fit, `mirror` bool = false
- **Syphon Spout In** (source) `sources/camera.frag` — params: `source` text, `active` bool = true, `fit` fit|fill|stretch = fit, `mirror` bool = false
- **Text** (source) `sources/text.frag` — params: `text` text, `font file` text, `font` sans|serif|mono = sans, `weight` int 100..900 = 600, `size` 8..800 = 160, `line spacing` 0.5..3 = 1, `tracking` -0.2..1 = 0, `wrap` bool = false, `align h` left|center|right = center, `align v` bottom|center|top = center, `x` -1..1 = 0, `y` -1..1 = 0, `rotate` -180..180 = 0, `color` color = [1.0, 1.0, 1.0, 1.0], `background` color = [0.0, 0.0, 0.0, 1.0], `anim` none|typewriter|fade|rise|jitter|scramble = none, `progress` 0..1 = 1, `spread` 0..1 = 0.3, `scroll` off|left|right|up|down = off, `scroll speed` 0..2 = 0.2
- **Code** (source) `sources/image.frag` — params: `source` text, `size` 8..72 = 22, `scroll` 0..1 = 0, `highlight` bool = true, `line numbers` bool = true

### SIG

- **Trigger** (input) — out: value (float), fired (float) — params: `pad` 1|2|3|4 = 1
- **Audio Hit** (input) — out: value (float), fired (float), attack (float) — params: `band` sub|low|mid|high = low
- **Beat** (input) — out: bpm (float), phase (float), pulse (float), beats (float), step (float)
- **Audio** (input) — out: level (float), sub (float), low (float), mid (float), high (float), onset (float) — params: `gain` 0..8 = 1
- **Loudness** (input) — out: momentary (float), short-term (float), integrated (float), range (float), true peak (float), peak (float), rms (float), crest (float)
- **Stereo** (input) — out: correlation (float), width (float), balance (float), peak L (float), peak R (float), rms L (float), rms R (float)
- **Pitch** (input) — out: pitch (float), strength (float), key (float), minor (float), key strength (float), note (float) — params: `note` C|C#|D|D#|E|F|F#|G|G#|A|A#|B = C
- **Time** (input) — out: time (float), dt (float)
- **Constant** (input) — out: out (float) — params: `value` -10..10 = 1
- **LFO** (generator) — out: out (float) — params: `shape` sine|triangle|saw|square|random = sine, `sync` bool = true, `rate` 0.01..16 = 1, `phase` 0..1 = 0, `amp` 0..10 = 1, `offset` -10..10 = 0
- **Noise** (generator) — out: out (float) — params: `rate` 0.01..16 = 1, `amp` 0..10 = 1, `offset` -10..10 = 0, `seed` int 0..99 = 0
- **Math** (process) — in: a (float), b (float) — out: out (float) — params: `op` add|sub|mul|div|min|max|pow|mod = add, `a` -10..10 = 0, `b` -10..10 = 0
- **Range** (process) — in: in (float) — out: out (float) — params: `in lo` -10..10 = 0, `in hi` -10..10 = 1, `out lo` -10..10 = 0, `out hi` -10..10 = 1, `clamp` bool = true
- **Expression** (process) — in: a (float), b (float), c (float), d (float) — out: out (float) — params: `expr` text
- **Smooth** (process) — in: in (float) — out: out (float) — params: `up` 0..5 = 0.05, `down` 0..5 = 0.3
- **Envelope** (process) — in: gate (float) — out: out (float) — params: `attack` 0..5 = 0.01, `release` 0..5 = 0.5
- **Compare** (logic) — in: a (float), b (float) — out: out (float) — params: `op` >|>=|<|<=|==|!= = >, `a` -10..10 = 0, `b` -10..10 = 0.5
- **Switch** (logic) — in: cond (float), a (float), b (float) — out: out (float) — params: `a` -10..10 = 1, `b` -10..10 = 0
- **Counter** (logic) — in: trigger (float), reset (float) — out: out (float) — params: `step` -10..10 = 1, `modulo` int 0..64 = 4
- **Hold** (logic) — in: in (float), trigger (float) — out: out (float)

### STR

- **String** (source) — out: text (string) — params: `text` text
- **File List** (source) — in: index (float) — out: path (string), name (string), count (float) — params: `folder` text, `extensions` text, `index` int 0..9999 = 0, `wrap` bool = true
- **Text File** (source) — in: line (float) — out: line (string), text (string), lines (float) — params: `file` text, `line` int 0..99999 = 0, `wrap` bool = true
- **Clock** (source) — out: text (string), hour (float), minute (float), second (float) — params: `format` text, `time zone` text
- **Concat** (process) — in: a (string), b (string), c (string), d (string) — out: out (string) — params: `a` text, `b` text, `c` text, `d` text, `separator` text, `skip empty` bool = true
- **Replace** (process) — in: in (string) — out: out (string) — params: `in` text, `find` text, `replace` text
- **Slice** (process) — in: in (string), start (float), length (float) — out: out (string) — params: `in` text, `start` int -9999..9999 = 0, `length` int -1..9999 = -1
- **Case** (process) — in: in (string) — out: out (string) — params: `in` text, `mode` upper|lower|title|trim = upper
- **Split** (process) — in: in (string), index (float) — out: part (string), count (float) — params: `in` text, `separator` text, `index` int 0..9999 = 0, `wrap` bool = true
- **Select** (process) — in: index (float), a (string), b (string), c (string), d (string) — out: out (string) — params: `index` int 0..9999 = 0, `a` text, `b` text, `c` text, `d` text, `wrap` bool = true
- **Number to String** (convert) — in: value (float) — out: text (string) — params: `value` -1000..1000 = 0, `decimals` int 0..6 = 2, `pad` int 0..12 = 0, `prefix` text, `suffix` text
- **Format** (convert) — in: a (float), b (float), c (float), d (float), s1 (string), s2 (string) — out: text (string) — params: `template` text, `a` -1000..1000 = 0, `b` -1000..1000 = 0, `c` -1000..1000 = 0, `d` -1000..1000 = 0, `s1` text, `s2` text
- **String to Number** (convert) — in: in (string) — out: value (float), ok (float) — params: `in` text, `fallback` -1000..1000 = 0
- **Length** (convert) — in: in (string) — out: chars (float), lines (float), words (float) — params: `in` text
- **Text Compare** (convert) — in: a (string), b (string) — out: result (float) — params: `a` text, `b` text, `mode` equals|contains|starts with|ends with = equals, `ignore case` bool = false

### PARTICLE (only inside a Particle)

- **Emit Pixels** (emit) `particles/emit_pixels.comp` — in: in — out: particles (particles) — params: `step` int 1..32 = 4, `threshold` 0..1 = 0.05, `refresh color` bool = true, `life` 0..30 = 0
- **Emit From Bright** (emit) `particles/emit_from_bright.comp` — in: in — out: particles (particles) — params: `rate` 0..50000 = 2000, `life` 0.1..20 = 2, `threshold` 0..1 = 0.3, `speed` 0..5 = 0.3, `spread` 0..1 = 0.5
- **Return** (force) `particles/return.comp` — in: particles (particles) — out: particles (particles) — params: `strength` 0..20 = 2, `damping` 0..1 = 0.9
- **Curl Noise** (force) `particles/noise.comp` — in: particles (particles) — out: particles (particles) — params: `strength` 0..10 = 1, `scale` 0.1..20 = 3, `speed` 0..5 = 0.3
- **Flow Field** (force) `particles/flow_field.comp` — in: particles (particles), field — out: particles (particles) — params: `strength` 0..20 = 2, `follow` 0..1 = 0
- **Gravity** (force) `particles/gravity.comp` — in: particles (particles) — out: particles (particles) — params: `x` -5..5 = 0, `y` -5..5 = -0.5
- **Explode** (force) `particles/explode.comp` — in: particles (particles) — out: particles (particles) — params: `x` -1..1 = 0, `y` -1..1 = 0, `strength` 0..30 = 3, `amount` 0..1 = 0
- **Drag** (force) `particles/drag.comp` — in: particles (particles) — out: particles (particles) — params: `amount` 0..20 = 1
- **Bounds** (force) `particles/bounds.comp` — in: particles (particles) — out: particles (particles) — params: `mode` bounce|wrap|respawn = bounce, `bounce` 0..1 = 0.6
- **Render Points** (render) `particles/render_points` — in: particles (particles) — out: out — params: `size` 0.5..32 = 2, `size by speed` 0..4 = 0, `shape` square|round|soft = square, `color` source|palette|white = source, `opacity` 0..1 = 1, `blend` add|alpha = add, `fade by age` bool = false

## Post FX

These are the effects of the 16 post FX slots (applied to the master output,
or to chosen layers before the mix — set in PERFORMANCE), each with
one param `float amount`, under `/Users/melocilde/work/vj-app/shaders/post/`:

- **strobe** `post/strobe.frag` — white flashes on 16th notes
- **invert** `post/invert.frag` — negative image
- **rgb split** `post/rgb_split.frag` — red and blue pulled apart
- **glitch** `post/glitch.frag` — bands jumping sideways
- **shake** `post/shake.frag` — camera shake
- **zoom** `post/zoom.frag` — punch in, pulsing on the beat
- **pixelate** `post/pixelate.frag` — mosaic
- **whiteout** `post/whiteout.frag` — fade to white
- **blackout** `post/blackout.frag` — fade to black
- **trails** `post/trails.frag` — previous frames linger
- **blur** `post/blur.frag` — soft focus
- **hue** `post/hue.frag` — rotate colors, drifting over time
- **mono** `post/mono.frag` — grayscale
- **posterize** `post/posterize.frag` — fewer color steps
- **mirror** `post/mirror.frag` — left half mirrored to the right
- **kaleido** `post/kaleido.frag` — mirrored wedges
- **edge** `post/edge.frag` — outlines only
- **wave** `post/wave.frag` — wavy distortion
- **scanlines** `post/scanlines.frag` — CRT lines
- **crumble** `post/crumble.frag` — falls apart under gravity while held, comes back after
- **dust** `post/dust.frag` — turns to falling particles while held, gathers back after
- **rgb delay** `post/rgb_delay.frag` — green and blue lag behind, leaving colored echoes
- **bloom** `post/bloom.frag` — glow around bright parts
- **distortion** `post/distortion.frag` — pinched in toward the centre, with color fringes

## Commands

Write one JSON object to `agent/commands/<name>.json`, writing to a temporary
name first and then renaming it. Files are processed in name order, deleted,
and answered in `agent/results/<name>.json`:
`{"ok": true, ...}` or `{"ok": false, "error": "..."}`.

From a shell, `/Users/melocilde/work/vj-app/target/debug/lemonade send <cmd> key=value …` does this for one command
and prints the result (values are JSON when they parse, else text; or pass a
whole JSON object; `send state` prints `state.json`; exit status 1 when the
command failed, 2 when the app isn't running):

```sh
/Users/melocilde/work/vj-app/target/debug/lemonade send set_param node=12 param=speed value=2
/Users/melocilde/work/vj-app/target/debug/lemonade send snapshot 'cell={"layer": 1, "slot": 1}'
```

Node ids are the `id`s in `state.json`. They are valid while the app runs; a
reopened show gets new ids. `cell` defaults to the edited cell.

| `cmd` | Fields | Result |
|---|---|---|
| `add_glsl` | `name?` (file stem in `/Users/melocilde/Movies/sense/shaders`), `source?` (GLSL; else a starter template), `cell?`, `position?` `[x, y]`, `out?` (connect to the cell's Out) | `node`, `shader`, `file` |
| `add_node` | `kind` (built-in name), `cell?`, `position?`, `parent?` (a Base's or Particle's id: add inside it; required for In / Out and particle nodes) | `node` |
| `remove_node` | `node` (not an Out, nor a Particle's own `in` / `out`) | |
| `reset_particles` | `node` (a Particle) — every particle starts over at its pixel | |
| `video` | `node` (a Video), `seek?` (seconds), `cue?` (`a`..`h`: jump there, or set it at the current position when empty), `clear_cue?`, `play?` (bool), `reverse?` (bool: play backwards), `speed?` (0–4, 1 = normal; to 0.001), `auto_sync?` (bool: play at the show's BPM / `bpm`), `bpm?` (the clip's tempo, 40–240) | |
| `group` | `nodes` (ids in one network, not an Out) — moved into a new Base; connections crossing them go through new In / Out nodes | `node` (the Base), `inputs`, `outputs` |
| `ungroup` | `node` (a Base, not a Particle) — its nodes move out into the network around it and the Base with its In / Out nodes goes; connections through its ports are rewired | `nodes` (the moved ids) |
| `expose` | `base`, `node` (inside it, any depth), `param`, `remove?` — shows the node's param on the Base's NODE tab (edited on the node; its MIDI / bindings stay on the node), or stops showing it | `exposed` (`[{ node, param }]`, also in `state.json` on Bases) |
| `save_component` | `node` (a Base or Particle), `name` — saves it with everything inside as `presets/components/<name>.ron` in the data dir (overwrites) | `components` (saved names) |
| `cell_preset` | `action?` (`list` (the default), `save`: `cell` + `name`, `load`: `cell` + `name` — replaces the cell's nodes) — a pack's presets are `<pack>/<name>` | `presets` (names); `load`: `problems` |
| `node_preset` | `node`, `action?` (`list` (the default): the presets of its kind, `save` + `name`, `apply` + `name`: its params, bindings and shader copy) — a pack's presets are `<pack>/<name>` | `presets` (names); `apply`: `problems` |
| `pack` | `action?` (`list` (the default), `install` (`path`: a folder or a .zip; or `url`: a .zip URL or a git repository, installed in the background — `list` again to see it), `remove` (`name`), `export` (`name`, `title?`, `author?`, `description?`, `version?`, `home?` (its URL), `notes?` (`{"cells/<name>": "…"}`), `cells?`, `components?`, `nodes?` (`[[kind folder, name]]`) — the user's presets —, `to`: a folder, or a `.zip` file)) — packs share cell presets, components and node presets; theirs are named `<pack>/<name>` (in `cell_preset`, `add_component`) | `packs` (`[{ name, title, author, version, description, shipped, source, cells, components, nodes }]`), `installing`, `message`; `install`: `installed`; `export`: `written` |
| `add_component` | `name`, `cell?`, `position?`, `parent?` (a Base to add it inside) — adds a saved component, shader files copied | `node` (the new Base) |
| `connect` | `from`, `from_port?` (default `out`), `to`, `to_port?` (default: the only input, else the first free texture input) | |
| `disconnect` | `to`, `to_port` | |
| `set_param` | `node`, `param`, `value` (number, bool, `[r,g,b(,a)]`, string, or a choice label) | `value` |
| `set_expr` | `node`, `param`, `expr` (`null` or `""` removes it) | `error` if it doesn't parse |
| `set_wires` | `node`, `param`, `count` 0..4, `combine?` (`mul add min max avg`) | wire port names |
| `select` | `node` (also shows its cell in the EDITOR) | |
| `edit_cell` | `cell` | |
| `launch` | `cell` (play it on its layer; an error in 16-layer mode, whose layers all play, and for a cell of the mode not playing), `quantize?` (`off` `beat` `bar` `2bars` `4bars`; default: the layer's, see `layer`) — starts at the next quantize point of the beat clock (`off`: now) with the layer's transition | `pending` (waits for its point), `at_beat` (the beat it starts on: the beat clock count, as `engine.beats` in `inspect`) |
| `layer` | `layer` (1–4, 1–16 in 16-layer mode), `opacity?` (0–1), `mode?` (a blend mode name: `Normal`, `Add`, `Screen`, …), `bypass?`, `solo?`, `side?` (`a` `thru` `b`), `quantize?` (`off` `beat` `bar` (the default) `2bars` `4bars`: where a launch on the layer starts), `transition?` (`cut` (the default) `crossfade` `wipe` `zoom` `slide` `dissolve` `glitch` `flash`: how the layer changes cells), `transition_beats?` (0.25–32) — while a transition runs both cells play; a launch during one starts from the cell that showed more | `layer` (as in `state.json` `layers`: `opacity`, `mode`, `bypass`, `solo`, `side`, `quantize`, `transition`, `transition_beats`, `pending_slot`, `fading_from`, `progress`, `autopilot`) |
| `tempo` | `bpm?` (20–400: a manual tempo, like typing it), `auto?` (follow the music again), `tap?`, `sync?` (now = the start of a beat) | `tempo` (`bpm`, `beats`: the clock's beat count, `source`: `auto` / `manual`; also in `state.json`) |
| `master` | `level?` (0 = black … 1; after the post FX), `tint?` (0 = off … 1: the master's luma mapped onto the palette, `palette(luma)`; before the post FX — post FX on chosen layers run before the mix, so before it) | `master_level`, `master_tint` |
| `palette` | `preset?` (a built-in palette: `neon`, `sunset`, `ocean`, `acid`, …), `colors?` (8 colors), `index?` (1–8) + `color?` — a color is `[r, g, b]` (0–1) or `"#rrggbb"` | `palette` (`colors`: 8 `#rrggbb`, `preset`: its name when it is one; also in `state.json`) |
| `post_fx` | `kind?` (`fade` / `one_shot`) + `slot?` (1–8) with `fx?` (a post FX name: `strobe`, `rgb split`, `trails`, …) and `level?` (fades, 0 = off … 1), `layers?` (`"all"`: on the master output, or layer numbers `[1, 3]` (1–4, 1–16 in 16-layer mode): on those layers before the mix) | `post_fx` (`fade`: `[{ fx, level }]`, `one_shot`: effects, `layers`; also in `state.json`) |
| `autopilot` | `layer` (1–4), `enabled?`, `mode?` (`next`: the next cell that plays something; `random`; `random_of`: random among `cells`), `every?` (1–64 events per change), `on?` (`bars`, `beats`, `trigger1`–`trigger4`: a pad firing, `hit_sub` `hit_low` `hit_mid` `hit_high`: a band hit), `cells?` (1-based slots for `random_of`) — the layer changes cells by itself with its quantize / transition; a launch by hand (or a scene) starts the count over; off by default | `layer` (as in `state.json` `layers`: `autopilot` `{ enabled, mode, every, on, cells, count }`) |
| `scene` | `action?` (`list` (the default), `capture`: save the mix now into `slot`, `launch`: at the next point of `quantize?` (default `bar`; `off` now), `rename`, `clear`), `slot` (1–8; not for `list`), `name?`, `glide_beats?` (0–32: opacities, crossfader, master, fade levels and palette glide this long) — a scene is the mix state (each layer's cell and mix settings, crossfader, master level, post FX picks / levels / layers, palette), not node params; at its point each layer launches its cell with its own quantize / transition | `scenes` (`slots`: per slot `null` or `{ slot, name, glide_beats, cells }`, `active`, `pending`, `glide` progress; also in `state.json`); `launch`: `pending`, `at_beat` |
| `timeline` | `action?` (`list` (the default), `play` (`from_bar?`, default 1: starts on the next bar line; cues before `from_bar` are skipped), `stop`, `rec` (`on?`, default true; on while stopped also plays from bar 1: scenes, cells and triggers launched by hand — `scene`, `launch`, `trigger` included — become cues where they land, from bar 1 on; a trigger keeps its strength), `add` (`bar`, `beat?` (1–4.75, snapped to quarters, default 1) and one of `scene` (1–8), `cell`, `trigger` (1–4; `value?` = its strength, default 1), `knob` (`layer1`–`layer4` opacity, `master`, `crossfader`, `fade1`–`fade8`) + `value?` (0–1, default the value now)), `move` (`index`, `bar`, `beat?`), `remove` (`index`), `clear`) — a cue sheet for a fixed set; a cue on the same beat with the same target (any scene, the same layer, pad or knob) replaces the old one; a cell cue switches on its beat whatever the layer's quantize | `timeline` (`state`: `stopped` / `armed` / `playing`, `recording`, `position` (`bar.beat.sixteenth` from bar 1 — before it, `-beats`, or the bar before `from_bar`), `beats`, `start_beat` (the clock's beat count at bar 1), `next` (index), `cues`: `[{ index, at, position, bar, beat, label, scene / cell / trigger + strength / knob + value }]`; also in `state.json`); `add` / `move`: `index` |
| `ask` | `prompt?`, `node?` (rewrite that node's shader; a built-in node gets its own copy first) or `edit?` (the selected node), else a new GLSL node in the cell being edited; `run?` (start the user's agent command from the app, like the SHADER panel's ASK — one at a time), `stop?` (stop it) — for people asking for a shader in words; an agent working here already writes the files itself | `node`, `shader_file` (the file to write), `file` (the request in `agent/requests/`), `request`, `ask` (`state`: `idle` / `running` / `done` / `failed` / `stopped`, `node`, `file`, `seconds`, `error`, `log`; also in `state.json`) — without a `prompt` just `ask` |
| `remote` | `enabled?`, `port?` (0: any free port), `new_token?` — the remote: a page in a phone's browser on the LAN that plays the show (launch, scenes, triggers, tempo, faders, the timeline's transport) through the same commands; the address carries a key | `remote` (`enabled`, `running`, `port`, `url` with the key, `clients`, `error`; also in `state.json`) |
| `trigger` | `pad` (1–4), `strength?` (0–1, default 1) — fire it now, like its key or MIDI pad | `triggers` (the 4 envelopes now) |
| `crossfader` | `position?` (0 = side A … 1 = side B), `curve?` (`linear`, `smooth`: eased ends, `cut`: both sides full until the last 5 %), `layer?` + `side?` (1–4, 1–16 in 16-layer mode; `a`, `thru`, `b`) — layers on A show toward 0, on B toward 1, THRU always (the default) | `crossfader` (`position`, `curve`, `gain_a`, `gain_b`; also in `state.json`, each layer's `side` in `layers`) |
| `arrange` | `cell?` (lay the nodes out in columns) | |
| `undo` / `redo` | `cell?` (the cell's edit history, like ⌘Z / ⇧⌘Z; each command is one step) | `can_undo`, `can_redo`; node ids change when nodes were added / removed |
| `snapshot` | `node?` or `cell?` (its Out; default: the master output) or `mapped: true` (the mapped output, see `mapping`), `timeout_ms?` (default 5000) | `png`, `width`, `height`, `pipeline`, `error`, `engine` |
| `mapping` | `mode?` (`"surfaces"`: slices of the show warped onto surfaces after the graph; `"atlas"`: the whole graph draws in the sending layout of `set_slot`'s slots, every node at its pixels' world position, so content runs on across slots without seams — the first switch adds a slot of the whole frame), `size?` (`"window"`: the output window's, 1920×1080 without one; or `[w, h]`; in atlas mode also the node size × render scale), `reset?` (one full-frame master surface: mapping off), `test_pattern?` (send a grid with each surface's / slot's number and corners 1–4 instead of the show), `load?` (a saved mapping replaces this one, first), `save_as?` (save it, last: `presets/mappings/<name>.ron` in the data dir — a venue's mapping for any show) | `presets` (saved mapping names), `mapping` (`mode`, `active`, `test_pattern`, `size`, `mapped_size`, `node_size`, `world_size`, `surfaces`, `slots`; also in `state.json`) |
| `set_slot` | `slot?` (1-based; none = add one), `remove?`, `name?`, `enabled?`, `atlas?` (`[x0, y0, x1, y1]` in mapped-output UV: where it sits in the sending layout), `center?` (`[x, y]` in world UV: the show's own frame), `size?` (`[w, h]` in world UV, before turning), `angle?` (degrees clockwise, kept in -180..180), `flip?` (mirrored left to right), `one_to_one?` (set `size` so the atlas rect gets the world's pixels 1:1, after `atlas`) — atlas mapping slots (`mapping mode=atlas`): each sends the world rect it shows, drawn there by the nodes themselves (GLSL nodes: `world_uv()` / `sample_world()`, see the shader conventions); the first slot holding a world point is the one effects read | `slot`, `mapping`, `warning?` |
| `set_surface` | `surface?` (1-based; none = add one), `remove?`, `name?`, `enabled?`, `source?` (`"master"` or a layer 1–4, 1–16 for 16-layer mode; a layer the playing mode lacks shows nothing), `input?` (`[x0, y0, x1, y1]` or corners TL TR BR BL in source UV: a perspective slice), `input_turn?` (quarter turns clockwise), `input_flip?` (`"horizontal"` / `"vertical"`), `output?` (corners TL TR BR BL in output UV, convex), `opacity?`, `brightness?` (0–2), `feather?` (0–0.5), `mask?` (`{ points: [[x, y], …] in output UV (3–32; fewer removes it), mode?: "show_inside" | "hide_inside", feather?: px }`) — projection mapping surfaces, drawn in order; the output window and Syphon / Spout Output show the mapped output while the mapping isn't the default | `surface`, `mapping`, `warning?` |
| `inspect` | `nodes?` (ids; default: the edited cell) | current param values (with bindings applied), SIG outputs, `engine` (clock, audio level / bands / hits, triggers, `meters`: LUFS, true peak, peak / RMS L R, correlation, width, balance, pitch, key) |
| `view` | `tab?` (`editor` `performance`), `side?` (`node` `shader` `palette` `audio`), `levels?` / `perf?` / `packs?` / `remote?` (open / close those windows), `output?` (`window` `off`, or `fullscreen` / `fullscreen N`: borderless on display N, default 1 — the output window), `preview?` (`master` `mapped`: what the PERFORMANCE output preview shows; `state.json` `performance_preview`) | |
| `midi` | `note` or `cc` (0..127), `value?` (velocity / controller value, default 127; a note with 0 releases), `channel?` (1..16, default 1), `device?` (input name as in `state.json` `midi.devices`, default `agent`) — handled like a message from that device: its mappings act (holds don't stay down) | |
| `sequencer` | applied in this order: `preset?` (a built-in pattern — `default`, `4x4`, `house`, `trance`, `dnb`, … — or a saved one), `rows?` (4 rows of 16 `x` / `.`, spaces ignored: t1 kick, t2 snare / clap, t3 hats, t4 accent), `clear?`, `set?` (`[{"pad": 1..4, "step": 1..16, "on"?: bool}]`, `on` left out toggles), `enabled?`, `save_as?` (save as a user pattern) | `enabled`, `rows`, `preset` (the built-in pattern it matches, if any) |
| `drop_media` | `cell`, `path?` / `paths?` / `media?` (library ids), `keep?` (default: the media browser's "keep nodes", off unless the user turned it on) — adds a Video (Image for image files) node per file and connects it to the cell's Out (a video with a tempo in the library gets it as `bpm`, with `auto sync` on); the cell's other nodes are removed first, or with `keep` they stay; more files go to the following cells of the layer (16-layer mode: the following layers). Like dragging media from the media browser or Finder / Explorer onto a PERFORMANCE cell; one undo step per cell | `nodes` |
| `grid_mode` | `mode?` (`4`: 4 layers × 8 cells, `16`: 16 layers × 1 cell, all playing; none = report) — the PERFORMANCE grid; the other mode's cells and layer settings stay as they are | `mode`, `layers`, `editing` |
| `media_browser` | `open?` (bool) — the media browser window | `open` |
| `library_add_root` / `library_remove_root` | `path` (a folder: scanned recursively and watched) / `root` (its id) | `roots` (`id`, `path`, `count`, `missing`) |
| `library_status` | `rescan?`, `hap?` (`off`, `auto`: HAP / HAP Alpha copies of videos, made beside them as `<name>.hap.mov` (in the cache when the folder is read-only) and played on the GPU; `high`: HAP R) | `status` (`media`, `pending`: still to probe / thumbnail, `hap_pending`, `converting`, `hap_mode`, `scanning`, `missing`, …), `roots` |
| `library_query` | `text?` (words matched in names, folders, tags), `tags_all?` / `tags_any?` / `tags_none?` (names), `kind?` (`video` `image`), `folder?` + `recursive?`, `min_width?` `max_width?` `min_height?` `max_height?`, `min_short_side?` (720 = 720p or more either way up), `min_duration?` `max_duration?` (s), `min_bpm?` `max_bpm?` (videos with a tempo set), `orientation?` (`landscape` `portrait` `square`), `codec?`, `sort?` (`name` `modified` `added` `duration` `resolution` `size` `last_used` `bpm`), `desc?`, `include_missing?`, `limit?` (50) | `total`, `items` (`id`, `path`, `name`, `kind`, `width`, `height`, `duration`, `fps`, `codec`, `tags`, `bpm`, `hap`, `hap_path`, …) |
| `library_tag` / `library_untag` | `media?` (ids) or `paths?`, `tag` | `items` with their `tags` |
| `library_set_bpm` | `media?` (ids) or `paths?`, `bpm` (40–240, clamped; `null` clears) — the tempo of videos (images are skipped), like the media browser's bpm field; `drop_media` of a video with a tempo sets its Video node's `bpm` and turns `auto sync` on | `items` (`id`, `path`, `bpm`) |
| `state` | | writes `state.json` now |

Example: `{"cmd": "add_glsl", "name": "tunnel", "out": true}` followed by
`{"cmd": "snapshot", "cell": {"layer": 1, "slot": 1}}`.
