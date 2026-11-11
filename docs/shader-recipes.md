# Shader recipes

Short GLSL patterns for lemona.de shaders (GLSL nodes, `shaders/user/*.frag`).
All of them assume `#include "util/common.glsl"` and the usual

```glsl
layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;
```

See the uniform table in the [README](../AGENTS.md#engine-uniforms-utilcommonglsl) for what
each `u_*` value means.

## Band hits (`u_hits`)

`u_hits.x` … `.w` are the audio bands sub / low / mid / high. Each jumps to 1
when an attack in that band (a kick in low, a snare in mid, hats in high)
rises above the band's threshold, and fades over the hit decay — both set in
the AUDIO tab's "hits" section. They work like `u_triggers`, so every trigger
snippet below works with a hit instead:

| Effect | Snippet | Notes |
|--------|---------|-------|
| Kick flash | `col += u_hits.y * 0.5;` | low band |
| Snare invert | `col = mix(col, 1.0 - col, u_hits.z);` | mid band |
| Hat sparkle | `col += step(0.97, hash21(floor(v_uv * 200.0) + u_time)) * u_hits.w;` | high band; needs `#include "util/noise.glsl"` |
| Kick zoom punch | `uv = (uv - 0.5) / (1.0 + u_hits.y * 0.2) + 0.5;` | |

In expressions the same values are `hit(0)` … `hit(3)`; the **Audio Hit** SIG
node gives one band's `value`, a one-frame `fired` pulse and its `attack`.

## Triggers (`u_triggers`)

`u_triggers.x` … `.w` are pads 1–4 (keys `1`–`4`, or the pads in PERFORMANCE).
Each jumps to 1 when fired and decays to 0 over the pad's decay time. The step
sequencer in PERFORMANCE fires them on 16th-note steps of the beat clock
(e.g. steps 1/5/9/13 = every beat, step 1 = every bar).

| Effect | Snippet | Notes |
|--------|---------|-------|
| Flash | `col += u_triggers.x;` | White flash that fades with the pad's decay |
| Blackout | `col *= 1.0 - u_triggers.x;` | Long decay = fade back in |
| Invert | `col = mix(col, 1.0 - col, u_triggers.x);` | |
| Zoom punch | `uv = (uv - 0.5) / (1.0 + u_triggers.x * 0.3) + 0.5;` | Zooms in around the center; apply before sampling / drawing |
| Shake | `uv += (hash2(vec2(u_time)) - 0.5) * 0.05 * u_triggers.x;` | Needs `hash2` below |
| Time lurch | `float t = u_time + u_triggers.x * 2.0;` | Animation jumps ahead, then settles |
| Palette jump | `col = mix(col, palette(fract(t + 0.5)), u_triggers.x);` | Shifts to the opposite end of the palette |
| RGB split | see below | Needs an input texture (`u_tex0`) |
| Hard strobe | `col *= step(0.5, u_triggers.x);` | On/off instead of a fade |
| Snappier fade | `float k = pow(u_triggers.x, 3.0);` | Use `k` instead of the raw value: same decay time, sharper hit |

RGB split on an input:

```glsl
float d = 0.02 * u_triggers.x;
vec3 col = vec3(
    texture(u_tex0, uv + vec2(d, 0.0)).r,
    texture(u_tex0, uv).g,
    texture(u_tex0, uv - vec2(d, 0.0)).b);
```

A small hash for the shake:

```glsl
vec2 hash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
```

## Beat (`u_beat`, `u_beats`, `u_phase`, `u_bpm`)

| Effect | Snippet | Notes |
|--------|---------|-------|
| Pulse on every beat | `col *= 1.0 + u_beat * 0.5;` | `u_beat` is 1 on the beat, decaying |
| Step once per beat | `float step_ = floor(u_beats);` | e.g. pick a new pattern / color each beat |
| Lurch on the beat | `float kick = floor(u_beats) + smoothstep(0.0, 0.3, fract(u_beats));` | Used by `kleinian.frag` to rotate in jumps |
| Every 4th beat | `float bar = floor(u_beats / 4.0);` | |
| Sweep within a beat | `float x = u_phase;` | 0 → 1 across each beat |

Built-in nodes that react on their own: Glitch's `drive` (beat / trigger 1–4 / level)
scales its strength, and Kaleidoscope's `spin` turns in time with the beat clock.
Feedback reads its own previous frame as `u_tex1`; see `shaders/effects/feedback.frag`
for a trail shader to copy.

## Audio (`u_level`, `u_bands`, `fft(i)`)

| Effect | Snippet | Notes |
|--------|---------|-------|
| Bass swell | `float s = 1.0 + u_bands.y * 0.4;` | `y` = low (60–250 Hz); `x` sub, `z` mid, `w` high |
| Hi-hat sparkle | `col += u_bands.w * noise;` | |
| Spectrum bars | `float h = fft(int(uv.x * 64.0));` | 64 log-spaced bins, 0..1 |
| Overall energy | `col *= 0.5 + u_level;` | |
| Finer spectrum / history as pixels | connect an **Audio FFT** node to your node's input, then `float v = texture(u_tex0, vec2(x, 0.5)).r;` | 512 log-spaced bins across (20 Hz left, 16 kHz right; `axis` linear: 0 → 16 kHz), brightness 0..1; `mode` spectrogram puts the last `history` seconds top (now) to bottom — e.g. `texture(u_tex0, vec2(x, age / history)).r`, or displace / mask with it. `data` flux: each bin's rise (onsets flash); chroma: 12 columns C..B |
| Waveform / vectorscope as pixels | connect an **Audio Scope** node to your node's input | Its output is the drawn trace (white on black): use it as a mask, displace by it, or feed Feedback for trails |

## Palette (`palette(t)`, `u_palette[8]`)

| Effect | Snippet |
|--------|---------|
| Gradient across the screen | `col = palette(uv.x);` |
| Cycling colors | `col = palette(fract(uv.x + u_time * 0.1));` |
| One palette color per beat | `col = u_palette[int(mod(floor(u_beats), 8.0))].rgb;` |
| Grayscale (luma) | `col = monochrome(col);` |

## Sizes in pixels (`u_resolution`, `u_scale`)

Nodes may render below 1920×1080 (render scale in the PERF window, saved with the show). `u_world_resolution` is the show's frame as actually rendered and `u_scale` its fraction of full size, so give sizes in full-resolution pixels and multiply by `u_scale`. With atlas mapping (MAPPING tab), nodes draw the sending layout instead: positions come from `world_uv(v_uv)` and other pixels of an input from `sample_world()`, so they join up across slots; without it these are `v_uv`, `texture()` and `u_resolution`:

| Effect | Snippet |
|--------|---------|
| Offset by 4 px | `vec2 d = 4.0 * u_scale / u_world_resolution;` |
| One texel (neighbour sampling) | `vec2 texel = 1.0 / u_world_resolution;` |
| A neighbour of this pixel | `sample_world(u_tex0, world_uv(v_uv) + texel * vec2(1, 0))` |
| 8 px pixel grid | `vec2 cell = 8.0 * u_scale / u_world_resolution;` |
| Pixel row at full resolution | `float y = world_uv(v_uv).y * u_world_resolution.y / u_scale;` |

## Param binding (no shader edits)

Any numeric node param can be driven from the NODE tab instead of in GLSL: **FX** binds an expression, **IN** gives the param an input port for a SIG wire (**+** adds more, up to 4; the connected ones combine into `x` by mul / add / min / max / avg). In expressions, `x` is the combined wires (or the base value if nothing is connected), `x1`..`x4` each wire (0 if unconnected), `v` is the base value set with the slider, and the engine values are `time dt bpm phase beat beats level onset sub low mid high pi`, `trig(i)`, `band(i)`, `fft(i)`. Operators are C-like, including `? :`. Results are clamped to the param's range. Full syntax, variables and functions: [expressions.md](expressions.md).

| Effect | Expression | Notes |
|--------|-----------|-------|
| Flash on pad 1 | `trig(0) > 0.5 ? 1 : 0.2` | |
| Pulse on the beat | `v + beat * 0.5` | |
| Bass-driven amount | `mix(v, 1, low)` | |
| Half-time sweep | `fract(beats / 2) * 360 - 180` | e.g. Transform `rotate` |
| Scale a SIG wire | `x * 32` | LFO (0..1) → Blur `radius` |
| LFO gated by a pad | `x1 * x2` (or IN ×2, mul) | LFO → wire 1, Trigger → wire 2 |
| Mix two wires | `mix(x1, x2, x3)` | wire 3 = crossfade |
| Every other bar | `mod(floor(beats / 4), 2) == 0 ? v : 0` | |

SIG nodes (`lemonade-core/src/signal_nodes.rs`) do the same on wires: Trigger / Beat / Audio / Time / Constant, LFO / Noise, Math / Range / Expression / Smooth / Envelope, Compare / Switch / Counter / Hold.
