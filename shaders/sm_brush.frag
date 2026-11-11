#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Sumi: big brush strokes struck on the beat, black and white only. An enso, slashes,
// a long horizontal, a dragged vertical, each whipped on in a fraction of a beat,
// bristles streaking and running dry toward its end, then drying out and crumbling.
// Spatter flies off, a thin wash bleeds around, the line boils like hand-drawn
// animation. A small seal is stamped at the end of the phrase.
// White ink on black by default, so it sits on a Screen layer.
// Pad 1 = a slash now, low hit = spatter.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   paper;    // dark|light|swap = dark
    float rate;     // 0.25..2 = 1       strokes per beat
    float size;     // 0.4..2 = 1        brush width
    float dry;      // 0..1 = 0.5        how fast the brush runs dry
    float wash;     // 0..1 = 0.35       grey bleed around the strokes
    float spatter;  // 0..1 = 0.6
    float boil;     // 0..1 = 0.5        hand-drawn wobble
    bool  seal;     // = true
    float react;    // 0..1 = 0.7        pads and audio hits
};

const float TAU = 6.2831853;

float B, tb, px, burst;

float H(float x) { return hash21(vec2(x * 0.731 + 7.3, 1.77)); }
float sm(float a, float b, float x) { return smoothstep(a, b, x); }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

// Ink of one stroke at (s along 0..1, d across), and its grey wash in .y
vec2 inkOf(float s, float d, float W, float length_, float age, float dur, float seed) {
    float prog = 1.0 - pow(1.0 - clamp(age / dur, 0.0, 1.0), 3.0);
    float fade = sm(0.0, 5.0, age - dur);

    float press = 0.85 + 0.35 * noise2(vec2(s * 5.0 + seed, seed));
    float capS = W * 1.1 / length_;
    float cap = s < capS ? sqrt(max(1.0 - pow(1.0 - max(s, 0.0) / capS, 2.0), 0.0)) : 1.0;
    float w = W * press * cap * mix(1.15, 0.6, s) * (0.3 + 0.7 * sm(1.0, 0.84, s));
    if (s <= 0.0 || s >= 1.0 || w < px) return vec2(0.0);
    float v = d / max(w, 1e-3);

    float head = s - prog + (noise2(vec2(v * 7.0 + seed, seed * 2.0)) - 0.5) * 0.09;
    float reveal = 1.0 - sm(-0.012, 0.012, head);

    float side = sign(v) * 3.0 + tb * 0.3;
    float rag = (noise2(vec2(s * length_ * 5.0 + seed, side)) - 0.5) * 0.2 + (noise2(vec2(s * length_ * 47.0 + seed, side)) - 0.5) * 0.09;
    float edge = 1.0 - abs(v) + rag;
    float body = sm(0.0, 0.05, edge);

    // Bristles run along the stroke: fast across it, slow along it.
    float b1 = noise2(vec2(v * 11.0 + seed, s * length_ * 1.4 + seed));
    float b2 = noise2(vec2(v * 34.0 - seed, s * length_ * 3.2 + seed * 2.0));
    float bristle = b1 * 0.62 + b2 * 0.38;

    float running = pow(clamp(s, 0.0, 1.0), 1.3) * (0.42 + 0.5 * dry);
    float th = 0.14 + running + fade * 0.8;
    float ink = sm(th - 0.025, th + 0.025, bristle) * body * reveal;

    // A loaded brush is solid at the start.
    float solid = sm(0.28, 0.03, s);
    float thS = 0.02 + fade * 1.15;
    ink = max(ink, body * reveal * solid * sm(thS - 0.025, thS + 0.025, bristle));

    float gw = sm(1.7, 0.8, abs(v)) * reveal * (1.0 - sm(0.0, 7.0, age)) * (0.6 + 0.8 * noise2(vec2(s * 4.0, v * 1.5 + seed)));
    return vec2(ink, gw);
}

vec3 strokeAt(vec2 p, int kind, float seed, float age, float dur) {
    // Each stroke wobbles a little, boiling at 8 frames a second.
    vec2 q = p + (vec2(noise2(p * 2.6 + seed + tb * 1.7), noise2(p * 2.6 + seed * 2.0 - tb * 1.3)) - 0.5) * (0.018 + 0.03 * boil);

    float s, d, W, Ln;
    if (kind == 0) {
        // Enso, with the gap where the brush lifted.
        vec2 c = (vec2(H(seed), H(seed + 1.0)) - 0.5) * vec2(0.5, 0.18);
        vec2 e = q - c;
        float R = 0.62 + H(seed + 2.0) * 0.1;
        float a0 = H(seed + 3.0) * TAU;
        float dirn = H(seed + 4.0) > 0.5 ? 1.0 : -1.0;
        float a = fract((dirn * atan(e.y, e.x) - a0) / TAU);
        float span = 0.93;
        s = a / span;
        d = length(e * vec2(1.0, 1.04)) - R - (noise2(vec2(a * 5.0, seed)) - 0.5) * 0.06;
        W = 0.11 * size;
        Ln = TAU * R;
        if (a > span + 0.02) s = 2.0;
    } else {
        // A straight stroke with a little bow.
        float ang;
        float Lh;
        if (kind == 1) { ang = 0.5 + H(seed) * 0.5; ang *= H(seed + 1.0) > 0.5 ? 1.0 : -1.0; Lh = 1.25; W = 0.075 * size; }
        else if (kind == 2) { ang = (H(seed) - 0.5) * 0.14; Lh = 1.4; W = 0.12 * size; }
        else { ang = 1.57 + (H(seed) - 0.5) * 0.24; Lh = 0.95; W = 0.15 * size; }
        vec2 c = (vec2(H(seed + 2.0), H(seed + 3.0)) - 0.5) * vec2(0.9, 0.5);
        if (H(seed + 5.0) > 0.5) ang += 3.14159265;
        vec2 e = rot(q - c, -ang);
        float x = e.x / (2.0 * Lh) + 0.5;
        s = x;
        float bow = (H(seed + 4.0) - 0.5) * 0.36;
        d = e.y - bow * (x - 0.5) * (x - 0.5) * 4.0 * 0.5;
        Ln = 2.0 * Lh;
    }

    if (s < -0.08 || s > 1.08) return vec3(0.0);
    vec2 ig = inkOf(s, d, W, Ln, age, dur, seed);

    // Spatter off the stroke, thrown as it lands.
    float sp = 0.0;
    float reach = 0.1 + min(age * 0.35, 0.34);
    if (abs(d) < reach + W * 1.5 && age < dur + 4.0) {
        float g = 34.0;
        vec2 gp = q * g + seed;
        vec2 id = floor(gp);
        vec2 f = fract(gp) - 0.5 - (hash22(id) - 0.5) * 0.7;
        float hh = hash21(id + seed);
        float prob = 0.9 - 0.1 * burst;
        float r = (0.08 + 0.3 * pow(hash21(id + 3.0), 4.0));
        float dd = 1.0 - sm(r - 0.05, r + 0.05, length(f));
        float near = sm(reach + W, W, abs(d));
        sp = dd * step(prob, hh) * near * spatter * step(s, age / dur + 0.02) * (1.0 - sm(dur, dur + 3.5, age));
    }
    return vec3(ig.x, ig.y, sp);
}

void main() {
    vec2 w = world_uv(v_uv);
    if (w.x < 0.0) { f_color = vec4(0.0, 0.0, 0.0, 1.0); return; }

    B = u_beats * rate;
    tb = floor(u_time * 8.0) / 8.0 * (boil > 0.01 ? 1.0 : 0.0);
    px = 2.0 / u_world_resolution.y;
    burst = max(u_hits.y, u_triggers.x) * react;

    vec2 p = to_centered(w);
    float kick = pow(max(u_beat, 0.0), 3.0);
    p /= 1.0 + kick * 0.012;

    // An 8-beat phrase of strokes, struck slightly off the grid.
    const float AT[6] = float[6](0.0, 2.5, 3.25, 4.0, 6.0, 6.75);
    const float DUR[6] = float[6](0.9, 0.3, 0.3, 0.42, 0.55, 0.3);
    float base = floor(B / 8.0) * 8.0;
    float ink = 0.0, gw = 0.0, sp = 0.0;
    for (int j = 1; j >= 0; j--) {
        float loopB = base - float(j) * 8.0;
        float cyc = mod(loopB / 8.0, 251.0);
        for (int i = 0; i < 6; i++) {
            float at = loopB + AT[i];
            float age = B - at;
            if (age < 0.0 || age > 8.0) continue;
            float seed = cyc * 3.7 + float(i) * 9.1 + 0.5;
            // The phrase opens on an enso every other time, otherwise a big stroke.
            int kind;
            if (i == 0) kind = mod(cyc, 2.0) < 0.5 ? 0 : 3;
            else kind = i == 3 ? 2 : (i == 4 ? 3 : 1);
            vec3 r = strokeAt(p, kind, seed, age, DUR[i]);
            ink = max(ink, r.x);
            gw = max(gw, r.y);
            sp = max(sp, r.z);
        }
    }

    // Pad 1 cuts a slash straight in.
    if (u_triggers.x * react > 0.03) {
        float a = (1.0 - u_triggers.x) * 1.4;
        vec3 r = strokeAt(p, 1, mod(floor(B / 4.0), 97.0) + 77.0, a, 0.2);
        ink = max(ink, r.x);
        sp = max(sp, r.z);
    }

    // Paper and wash.
    float fibre = fbm(p * vec2(3.0, 55.0) + 3.0, 3) * 0.6 + hash21(floor(w * u_world_resolution * 0.5)) * 0.4;
    float washV = gw * wash * (0.3 + 0.55 * fbm(p * 3.0 + 11.0, 4));
    float v = washV * 0.55;
    v = mix(v, 1.0, max(ink, sp));
    v *= 0.93 + 0.07 * fibre;

    // The seal, stamped near the end of the phrase, at the corner.
    if (seal) {
        float pos8 = mod(B, 16.0);
        if (pos8 > 13.0) {
            float asp = aspect();
            vec2 sc = vec2(asp - 0.22, -0.72);
            vec2 sq = (p - sc) / 0.075;
            if (abs(sq.x) < 1.0 && abs(sq.y) < 1.0) {
                float cellN = mod(floor(B / 16.0), 53.0);
                vec2 cid = floor((sq * 0.5 + 0.5) * 5.0);
                float carved = step(0.55, hash21(cid + cellN));
                float rim = max(abs(sq.x), abs(sq.y));
                float mark = max(carved, sm(0.82, 0.88, rim));
                mark *= 0.75 + 0.25 * step(0.3, noise2(sq * 7.0 + cellN));
                v = max(v, mark);
            }
        }
    }

    // A dark sheet by default; light is the same inverted.
    bool lightSheet = paper == 1 || (paper == 2 && mod(floor(B / 16.0), 2.0) > 0.5);
    if (lightSheet) v = 1.0 - v * 0.96;

    f_color = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
}
