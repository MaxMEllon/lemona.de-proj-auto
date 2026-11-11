#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Madness: a lopsided 3D scribble of white lines (a random walk stretched and
// bent on one side, crushed on the other) with nerve spikes shooting out of
// its joints. Joints regrow on their own staggered beats, twitch on 16ths and
// a few shake all the time; it turns with a jolt on each beat, sometimes
// jerking back; delayed ghosts trail it in the palette and torn bands slip
// sideways. The phrase's last beat flickers inverted.
// Pads / hits: t1 or low = twitch burst + punch, t2 or mid = ghosts flare,
// t3 or high = tear, t4 = invert.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   points;   // 8..64 = 44        joints of the scribble
    float chaos;    // 0..1 = 0.7        joints twitching
    float skew;     // 0..1 = 0.75       how lopsided it is
    float spikes;   // 0..1 = 0.5        nerve spikes out of the joints
    float spin;     // 0..2 = 0.6        rotation
    float jerk;     // 0..1 = 0.8        jolt on each beat
    int   ghosts;   // 0..3 = 2          delayed copies
    float width;    // 0.5..5 = 2.2      line width (px)
    float tear;     // 0..1 = 0.4        bands slipping sideways
    int   tint;     // mono|palette = palette  ghost color
    float react;    // 0..1 = 1          pads and audio hits
    bool  invert;   // = false
};

const int MAXP = 64;

float px;
int n;
vec3 P[MAXP];

float H(float x) { return hash21(vec2(x, 7.31)); }
vec3 h3(float a, float b) {
    return vec3(hash21(vec2(a, b)), hash21(vec2(a + 17.13, b * 1.31 + 3.7)), hash21(vec2(a * 1.73 + 5.1, b + 11.9)));
}
vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

// Eases from 0 to 1 over the first third of each unit: a lurch, then a hold.
float lurch(float t) { return 1.0 - pow(1.0 - clamp(fract(t) * 3.0, 0.0, 1.0), 5.0); }

// Joint i's step direction: each joint regrows every 8–20 beats at its own
// offset, easing to a new random direction (everything after it follows).
vec3 dir_at(float i, float bt) {
    float period = 8.0 + floor(H(i + 3.0) * 4.0) * 4.0;
    float t = (bt + H(i) * period) / period;
    float g = floor(t);
    float f = clamp(fract(t) * 6.0, 0.0, 1.0);
    f = f * f * (3.0 - 2.0 * f);
    return mix(h3(i, g - 1.0), h3(i, g), f) * 2.0 - 1.0;
}

void build(float bt, float kick) {
    vec3 pos = vec3(0.0);
    float tw = floor(bt * 4.0);
    for (int i = 0; i < n; i++) {
        float fi = float(i);
        pos += dir_at(fi, bt) * mix(0.12, 0.6, pow(H(fi + 9.0), 3.0));
        pos *= 0.86;
        vec3 q = pos;
        // lopsided: stretched and bent upward on +x, crushed on -x
        q.x = q.x > 0.0 ? q.x * (1.0 + skew * 1.4) : q.x * (1.0 - skew * 0.45);
        q.y += skew * (0.9 * q.x * abs(q.x) - 0.15);
        q.z += skew * 0.6 * max(q.x, 0.0) * q.y;
        q.x -= skew * 0.25;
        // some joints jump on each 16th (more on a kick); nervous ones shake constantly
        float on = step(0.6 - 0.45 * kick, hash21(vec2(fi, tw + 0.5)));
        q += (h3(fi, tw) - 0.5) * chaos * (0.06 + 0.3 * kick) * on;
        q += (h3(fi, floor(bt * 24.0)) - 0.5) * step(0.82, H(fi + 21.0)) * chaos * 0.07;
        P[i] = q;
    }
}

vec3 view(vec3 q, float bt, float scale) {
    // a slow turn plus a random jolt each beat (either way), snapped in
    float b0 = floor(bt), e = lurch(bt);
    float j1 = mix(H(b0 - 0.5), H(b0 + 0.5), e) - 0.5;
    float j2 = mix(H(b0 + 99.5), H(b0 + 100.5), e) - 0.5;
    q.xz = rot(q.xz, spin * (u_time * 0.25 + jerk * 0.5 * (b0 + e)) + jerk * j1 * 2.2);
    q.yz = rot(q.yz, 0.45 * sin(u_time * 0.13 * spin + 1.0) + jerk * j2 * 1.4);
    q.xy = rot(q.xy, 0.3 * sin(u_time * 0.071 + 2.0));
    float w = 3.4 - q.z;
    return vec3(q.xy * 3.6 * scale / w, q.z);
}

float seg(vec2 p, vec2 a, vec2 b, out float h) {
    vec2 pa = p - a, ba = b - a;
    h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    return length(pa - ba * h);
}
float stroke(float d, float w) { return 1.0 - smoothstep(w - px * 0.75, w + px * 0.75, d); }

float draw(vec2 p, float bt, float scale, float kick, float wmul) {
    build(bt, kick);
    float acc = 0.0;
    float pulse = pow(1.0 - fract(bt), 3.0);
    vec3 prev = view(P[0], bt, scale);
    for (int i = 1; i < n; i++) {
        float fi = float(i), h;
        vec3 cur = view(P[i], bt, scale);
        float d = seg(p, prev.xy, cur.xy, h);
        float dep = clamp(0.85 + mix(prev.z, cur.z, h) * 0.5, 0.3, 1.5);
        acc = max(acc, stroke(d, max(width * px * 0.5 * dep * wmul, px * 0.35)) * dep);
        // nerve spike: a hairline out of the joint, re-aimed every 2 beats, lunging on the beat
        if (H(fi + 31.0) < spikes * 0.45) {
            vec3 sd = normalize(h3(fi, floor(bt * 0.5) + 7.0) - 0.5 + vec3(skew * 0.5, 0.0, 0.0));
            float len = (0.3 + 2.2 * pow(H(fi + 41.0), 2.0)) * (0.35 + 0.65 * pulse + 0.5 * kick);
            vec3 tip = view(P[i] + sd * len, bt, scale);
            float hs, ds = seg(p, cur.xy, tip.xy, hs);
            acc = max(acc, stroke(ds, px * 0.45 * wmul) * (1.0 - hs) * 0.9);
        }
        prev = cur;
    }
    return acc;
}

void main() {
    vec2 p = to_centered(world_uv(v_uv));
    px = 2.0 / u_world_resolution.y;
    n = clamp(points, 2, MAXP);
    float kick = max(u_triggers.x, u_hits.y) * react;
    float snare = max(u_triggers.y, u_hits.z) * react;
    float hat = max(u_triggers.z, u_hits.w) * react;
    float bt = u_beats;
    float s16 = floor(bt * 4.0);

    // torn bands slipping sideways on 16ths
    float tr = tear * (0.3 + 0.7 * hat);
    float band = floor(p.y * 14.0 + H(floor(bt)) * 5.0);
    if (hash21(vec2(band, s16)) < tr * 0.35) p.x += (hash21(vec2(band + 3.0, s16)) - 0.5) * 0.6 * tr;

    float scale = 1.0 + 0.2 * kick;
    vec3 col = vec3(draw(p, bt, scale, kick, 1.0));
    for (int k = 1; k <= 3; k++) {
        if (k > ghosts) break;
        float fk = float(k);
        vec2 off = vec2(0.025, -0.012) * fk * (1.0 + 3.0 * snare);
        float g = draw(p - off, bt - fk * (0.12 + 0.25 * snare), scale * (1.0 + 0.05 * fk), 0.0, 0.8);
        vec3 gc = tint == 1 ? palette(0.8 - 0.1 * fk) : vec3(1.0);
        col = max(col, gc * g * (0.95 / fk) * (0.8 + 0.6 * snare));
    }

    col += (hash21(v_uv * u_world_resolution + fract(u_time) * 97.0) - 0.5) * 0.04;
    bool flick = mod(floor(bt), 16.0) == 15.0 && hash21(vec2(s16, 2.0)) < 0.6 * chaos;
    if (invert != (flick || u_triggers.w * react > 0.5)) col = 1.0 - col;
    f_color = vec4(clamp(col, 0.0, 1.0), 1.0);
}
