#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Mono geometry: pure white lines and shapes on black, in four compositions
// that cut on the phrase line, everything stepping on the beat clock.
//   monolith  a turning polygon, hatched inside, echoing outward with spokes
//   symbols   a grid of small line symbols turning in a staggered wave
//   iris      log-spaced rings of dashes and hairlines, like a lens diaphragm
//   corridor  a perspective tunnel of lines with an inverting polygon
// Pads / hits: t1 or low = punch, t2 or mid = invert, t3 or high = scan lines.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   scene;    // auto|monolith|symbols|iris|corridor = auto
    int   hold;     // 1..16 = 4         bars per composition (auto)
    float rate;     // 0.25..2 = 0.5     steps per beat
    float density;  // 0.5..2 = 1        line count
    float width;    // 0.5..5 = 1.6      line width (px)
    float punch;    // 0..1 = 0.5        zoom on the beat
    float slip;     // 0..1 = 0.6        bands jumping sideways on each bar
    float stutter;  // 0..1 = 1          inverting on the phrase's last beat
    float react;    // 0..1 = 1          pads and audio hits
    bool  invert;   // = false
};

const float TAU = 6.2831853;

float px, hw, b, bar, phrase, kick;

vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float H(float x) { return hash21(vec2(x, 7.31)); }
float xr(float a, float b_) { return a + b_ - 2.0 * a * b_; }

// t stepping forward: holds, then snaps to the next whole number.
float snap(float t) {
    float f = clamp(fract(t) * 2.5, 0.0, 1.0);
    return floor(t) + 1.0 - pow(1.0 - f, 4.0);
}

// Regular polygon: apothem-distance field, so its level sets stay polygons.
float ngon(vec2 p, float n) {
    float a = atan(p.x, p.y), s = TAU / n;
    return cos(floor(0.5 + a / s) * s - a) * length(p);
}

float stroke(float d, float h) { return 1.0 - smoothstep(h - px * 0.75, h + px * 0.75, abs(d)); }
float fill(float d) { return 1.0 - smoothstep(-px * 0.75, px * 0.75, d); }

// Parallel lines across s, antialiased, settling to their mean where too dense.
float lines(float s, float period, float h) {
    float fw = max(fwidth(s), 1e-5);
    float d = abs(fract(s / period + 0.5) - 0.5) * period;
    float l = 1.0 - smoothstep(h - fw * 0.75, h + fw * 0.75, d);
    return mix(l, clamp(2.0 * h / period, 0.0, 1.0), smoothstep(0.35, 0.9, fw / period));
}

float sidesOf(float i) {
    const float S[8] = float[8](3.0, 4.0, 6.0, 3.0, 5.0, 4.0, 8.0, 3.0);
    return S[int(mod(i, 8.0))];
}

float monolith(vec2 p) {
    float n = sidesOf(bar);
    float a = snap(b) * TAU / (n * 2.0);
    vec2 q = rot(p, a);
    float R = (n < 3.5 ? 0.42 : 0.54) * (1.0 + 0.06 * kick);
    float d = ngon(q, n) - R;

    // Outside: the outline echoing outward, thinning with distance.
    float r = length(p);
    float echo = lines(d - snap(b) * 0.09 / density, 0.09 / density, hw * mix(1.0, 0.55, smoothstep(0.0, 0.9, d)));
    float c = echo * step(0.0, d);

    // Spokes from the corners.
    float s = TAU / n;
    float fold = mod(atan(q.x, q.y) + s * 0.5, s) - s * 0.5;
    float corner = abs(abs(fold) - s * 0.5) * length(q);
    c = max(c, stroke(corner, hw * 0.7) * step(0.0, d));

    // Inside: hatching that thickens toward the centre.
    float ang = TAU / 8.0 * (floor(H(phrase) * 4.0) + 1.0);
    float h = dot(p, vec2(cos(ang), sin(ang))) + b * 0.02;
    float tone = smoothstep(0.0, -R * 0.8, d);
    float hatch = lines(h, 0.034 / density, mix(hw, 0.0135 / density, tone));

    // A smaller polygon turning the other way flips the hatching.
    float d2 = ngon(rot(p, -a * 2.0), n) - R * 0.46;
    hatch = xr(hatch, fill(d2));
    c = mix(c, hatch, fill(d));

    c = max(c, stroke(d, hw * 2.6));
    c = max(c, stroke(d2, hw * 1.2));

    // Outer ticked ring.
    float rk = stroke(r - 0.9, hw * 0.7);
    float ta = atan(p.y, p.x) + snap(b * 0.5) * TAU / 24.0;
    float tk = 1.0 - smoothstep(-px, px, abs(fract(ta / TAU * 72.0) - 0.5) * TAU / 72.0 * r - hw * 0.7);
    tk *= step(0.9, r) * step(r, 0.94 + 0.03 * step(0.5, fract(ta / TAU * 6.0)));
    return max(c, max(rk, tk));
}

float symbols(vec2 p) {
    float cell = 0.3334 / density;
    vec2 g = p / cell + vec2(0.5, 0.0);
    vec2 id = floor(g);
    vec2 l = (fract(g) - 0.5) * cell;

    float delay = (id.x * 0.11 + id.y * 0.23);
    float st = snap(b - delay);
    float type = mod(floor(H(id.x * 3.1 + id.y * 17.7) * 6.0) + floor(st / 2.0), 6.0);
    float r = cell * 0.36;
    vec2 q = rot(l, st * TAU / 8.0 * (mod(id.x + id.y, 2.0) * 2.0 - 1.0));
    float h1 = hw * 0.8;

    float c = 0.0;
    if (type < 0.5) {            // nested squares
        float d = ngon(q, 4.0);
        c = lines(d, r * 0.33, h1) * step(d, r * 1.02);
    } else if (type < 1.5) {     // hatched disc
        float d = length(l) - r;
        c = max(lines(q.y, r * 0.2, h1) * step(d, 0.0), stroke(d, h1));
    } else if (type < 2.5) {     // nested triangles
        float d = ngon(q, 3.0);
        c = lines(d, r * 0.26, h1) * step(d, r * 0.72);
    } else if (type < 3.5) {     // cross in a ring
        vec2 x = abs(q);
        c = stroke(min(x.x, x.y), h1) * step(max(x.x, x.y), r);
        c = max(c, stroke(length(l) - r * 0.55, h1));
    } else if (type < 4.5) {     // concentric rings
        c = lines(length(l), r * 0.28, h1) * step(length(l), r);
    } else {                     // the one solid mark, kept small
        c = fill(ngon(q, 3.0 + mod(id.x, 2.0)) - r * 0.38);
        c = max(c, stroke(ngon(q, 4.0) - r, h1));
    }

    // Hairline grid with heavier crosses where lines meet.
    vec2 e = cell * 0.5 - abs(l);
    c = max(c, stroke(min(e.x, e.y), hw * 0.35));
    c = max(c, step(max(e.x, e.y), cell * 0.06) * stroke(min(e.x, e.y), hw * 1.3));

    // A few cells flip each step.
    return xr(c, step(0.94, H(id.x * 5.3 + id.y * 41.9 + floor(st) * 3.7)));
}

float iris(vec2 p) {
    float r = max(length(p), 1e-3);
    float k = 2.6 * density;
    float lr = log(r) * k + snap(b * 0.5) * 0.5;
    float i = floor(lr), f = fract(lr);
    float dir = mod(i, 2.0) * 2.0 - 1.0;
    float a = atan(p.y, p.x) + dir * snap(b + H(i) * 0.5) * TAU / 16.0;

    const float NS[4] = float[4](3.0, 6.0, 12.0, 24.0);
    float N = NS[int(mod(i, 4.0))];
    float duty = mix(0.3, 0.75, H(i + 11.0));
    float seg = (abs(fract(a * N / TAU) - 0.5) - duty * 0.5) * TAU / N * r;
    float mask = 1.0 - smoothstep(-px, px, seg);

    float band = abs(f - 0.5) / k * r;
    float kind = H(i + 23.0);
    float c;
    if (kind < 0.34) {
        c = (1.0 - smoothstep(-px, px, band - r * 0.09 / k * 1.6)) * mask;       // solid arcs
    } else if (kind < 0.67) {
        c = lines(a / TAU * N * 6.0, 1.0, 0.16) * (1.0 - smoothstep(-px, px, band - r * 0.4 / k)); // radial comb
    } else {
        c = stroke(band - r * 0.32 / k, hw) * mask;                              // double hairline arcs
    }
    c = max(c, stroke(f < 0.5 ? f / k * r : (1.0 - f) / k * r, hw * 0.45));      // ring hairlines

    c *= smoothstep(0.015, 0.03, r);

    // Crosshair.
    c = max(c, stroke(p.y, hw * 0.45) * step(0.0, r - 0.06));
    c = max(c, stroke(p.x, hw * 0.45) * step(0.0, r - 0.06));
    return c;
}

float corridor(vec2 p) {
    vec2 q = p;
    float ax = abs(q.x) / aspect();
    float d = max(max(ax, abs(q.y)), 1e-3);
    float z = 0.42 / d + snap(b) * 1.5;
    float rings = lines(z, 1.0, 0.016);
    float u = (ax > abs(q.y) ? q.y : q.x / aspect()) / d;
    float rails = lines(u + 0.125 / density, 0.25 / density, 0.006);
    float diag = abs(abs(q.y) - ax) / sqrt(1.0 + 1.0 / (aspect() * aspect()));
    float c = max(max(rings, rails), stroke(diag, hw)) * smoothstep(0.02, 0.09, d);

    // The polygon inverts the tunnel behind it.
    float n = sidesOf(bar);
    float a = snap(b) * TAU / (n * 2.0);
    float o = ngon(rot(p, a), n) - 0.3 * (1.0 + 0.1 * kick);
    c = xr(c, fill(o));
    c = max(c, stroke(o - 0.05, hw));
    return c;
}

void main() {
    vec2 w = world_uv(v_uv);
    if (w.x < 0.0) { f_color = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec2 p = to_centered(w);

    px = 2.0 / u_world_resolution.y;
    hw = width * u_scale * px * 0.5;
    b = u_beats * rate;
    bar = floor(u_beats / 4.0);
    float len = 4.0 * float(hold);
    phrase = floor(u_beats / len);

    float low = max(u_triggers.x, u_hits.y) * react;
    float mid = max(u_triggers.y, u_hits.z) * react;
    float high = max(u_triggers.z, u_hits.w) * react;
    kick = max(u_beat * u_beat * punch, low);

    // Bands jump sideways at the start of each bar, further on a new phrase.
    float barF = fract(u_beats / 4.0);
    float jolt = step(barF, 0.06) * slip * (mod(bar, float(hold)) < 0.5 ? 1.0 : 0.35);
    float bandY = floor(w.y * 18.0);
    p.x += (hash21(vec2(bandY, bar)) - 0.5) * 0.7 * jolt;

    p /= 1.0 + kick * 0.09;

    int mode = scene > 0 ? scene - 1 : int(mod(phrase, 4.0));
    float c;
    if (mode == 0)      c = monolith(p);
    else if (mode == 1) c = symbols(p);
    else if (mode == 2) c = iris(p);
    else                c = corridor(p);

    // Hat scan lines.
    float sy = w.y * 54.0;
    float sl = stroke((fract(sy) - 0.5) * 2.0 / 54.0, hw * 0.6);
    c = max(c, sl * step(0.8, hash21(vec2(floor(sy), floor(u_time * 24.0)))) * step(0.25, high));

    // A hairline sweeping across each bar.
    c = xr(c, stroke(p.x - mix(-aspect(), aspect(), barF), hw * 0.6));

    // Snare invert.
    c = xr(c, step(0.45, mid));

    // Inverting 8ths on the phrase's last beat.
    float pos = mod(u_beats, len);
    if (pos > len - 1.0 && stutter > 0.5) c = xr(c, step(0.5, fract(u_beats * 2.0)));

    if (invert) c = 1.0 - c;
    f_color = vec4(vec3(clamp(c, 0.0, 1.0)), 1.0);
}
