#version 450
#include "util/common.glsl"
#include "util/noise.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

// An endless panorama for a 360° display: the frame width is one full turn and
// every layer is periodic in x (integer frequencies / cell counts), so the left
// and right edges meet without a seam while everything scrolls to the right.
// Far layers move slower than near ones (parallax); each beat gives a push.

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;     // -0.2..0.2 = 0.025   turns per second of the nearest layer (+ = right)
    float push;      // 0..0.1 = 0.012      extra turn eased in on each beat
    float parallax;  // 0..1 = 0.8          far layers slower
    float horizon;   // 0.25..0.7 = 0.42    horizon height (from the bottom)
    int   buildings; // 16..160 = 72        buildings round the ring
    float windows;   // 0..1 = 0.45         share of lit windows
    float streaks;   // 0..2 = 1            light streaks racing round the horizon
    float glow;      // 0..2 = 1
    float react;     // 0..2 = 1            audio response
    float stars;     // 0..1 = 0.6
    bool  use_palette; // = false           colors from the show palette
};

const float TAU = 6.2831853;

float ring_d(float a, float b) { return abs(fract(a - b + 0.5) - 0.5); }

vec3 col(float t, vec3 fallback) { return use_palette ? palette(t) : fallback; }

// Height of a periodic ridge: sines with integer frequencies only.
float ridge(float x, float seed, float rough) {
    float h = 0.0, a = 1.0, n = 0.0;
    const float K[7] = float[7](1.0, 2.0, 3.0, 5.0, 8.0, 13.0, 21.0);
    for (int i = 0; i < 7; i++) {
        float ph = hash21(vec2(seed, float(i))) * TAU;
        h += a * sin(TAU * K[i] * x + ph);
        n += a;
        a *= rough;
    }
    return h / n;   // -1..1
}

// One row of buildings round the ring. Returns (mask, window light, roof light).
vec3 city(float x, float y, float base, float tall, float n, float seed, float lit) {
    float c = floor(x * n);
    float lx = fract(x * n);
    float h1 = hash21(vec2(c, seed));
    float h2 = hash21(vec2(c, seed + 7.0));
    float w0 = 0.08 + 0.25 * h2;                    // gap on each side
    float in_x = step(w0, lx) * step(lx, 1.0 - w0 * 0.6);
    float top = base + tall * (0.25 + 0.75 * h1 * h1);
    float mask = in_x * step(y, top);
    // windows: columns across the building, rows up its height
    float cols = 3.0 + floor(h2 * 4.0);
    float wx = (lx - w0) / (1.0 - 1.6 * w0) * cols;
    float wy = (top - y) * 140.0;
    vec2 wc = vec2(floor(wx), floor(wy));
    float on = step(hash21(wc + vec2(c * 13.1, seed) + floor(u_beats / 4.0) * 0.37 * step(0.8, h1)), lit);
    float shape = step(0.25, fract(wx)) * step(fract(wx), 0.75) * step(0.3, fract(wy)) * step(fract(wy), 0.8);
    float win = mask * on * shape * step(0.004, top - y);
    // blinking aviation light on the tallest roofs
    float rx = (lx - 0.5) * u_resolution.x / n;
    float ry = (y - top - 0.006) * u_resolution.y;
    float roof = step(0.6, h1) * exp(-(rx * rx + ry * ry) / (18.0 * u_scale * u_scale))
               * (0.3 + 0.7 * step(0.5, fract(u_beats * 0.5 + h2)));
    return vec3(mask, win, roof);
}

void main() {
    vec2 R = u_resolution;
    float aspect = R.x / R.y;
    float x = v_uv.x;
    float y = 1.0 - v_uv.y;                       // 0 bottom .. 1 top
    float hz = horizon;

    // travel: steady drift plus an eased push on every beat
    float bf = fract(u_beats);
    float beat_steps = floor(u_beats) + (1.0 - pow(1.0 - min(bf * 2.5, 1.0), 3.0));
    float p = u_time * speed + beat_steps * push;
    float lowb = u_bands.y * react;
    float hitl = u_hits.y * react;

    // layer offsets (1 = nearest)
    #define OFF(f) (p * mix(1.0, f, parallax))

    // ---- sky ---------------------------------------------------------------
    float alt = clamp((y - hz) / (1.0 - hz), 0.0, 1.0);
    vec3 sky_top = col(0.05, vec3(0.02, 0.01, 0.08)) * 0.25;
    vec3 sky_mid = col(0.35, vec3(0.30, 0.05, 0.40));
    vec3 sky_low = col(0.70, vec3(1.00, 0.35, 0.30));
    vec3 c = mix(sky_low, sky_mid, smoothstep(0.0, 0.35, alt));
    c = mix(c, sky_top, smoothstep(0.25, 1.0, alt));
    c *= 0.85 + 0.3 * u_level * react;

    // stars (cells: an integer count across one turn)
    {
        float sx = fract(x - OFF(0.05));
        vec2 g = vec2(sx * 240.0, y * 240.0 / aspect);
        vec2 id = floor(g);
        id.x = mod(id.x, 240.0);
        vec2 o = hash22(id);
        vec2 d = (fract(g) - o) * vec2(R.x / 240.0, R.y / (240.0 / aspect));
        float s = step(1.0 - 0.25 * stars, hash21(id + 3.1));
        float tw = 0.5 + 0.5 * sin(u_time * (2.0 + 4.0 * o.x) + o.y * TAU);
        c += s * tw * exp(-dot(d, d) / (2.0 * u_scale * u_scale)) * smoothstep(0.15, 0.6, alt) * stars;
    }

    // sun and, opposite it, a ringed planet
    {
        float sx = fract(x - OFF(0.12));
        float r = 0.17;
        vec2 d = vec2(ring_d(sx, 0.25) * aspect, y - (hz + 0.14));
        float l = length(d);
        float bands = step(0.0, sin((y - hz) * 120.0 - u_time * 2.0) + (y - hz - 0.05) * 25.0);
        vec3 sun = mix(col(0.85, vec3(1.0, 0.9, 0.3)), col(0.6, vec3(1.0, 0.2, 0.5)), smoothstep(r, -r, d.y));
        c = mix(c, sun * (1.0 + 0.6 * hitl), step(l, r * (1.0 + 0.08 * lowb)) * bands);
        c += sun * 0.35 * glow * exp(-max(l - r, 0.0) * 9.0);

        vec2 q = vec2(ring_d(sx, 0.75) * aspect, y - (hz + 0.38));
        float pr = 0.07;
        vec3 pc = col(0.45, vec3(0.4, 0.8, 1.0));
        float body = step(length(q), pr);
        c = mix(c, pc * (0.35 + 0.65 * smoothstep(pr, -pr, q.x + q.y)), body);
        float ring = smoothstep(0.004, 0.0, abs(length(vec2(q.x, q.y * 4.0 + q.x * 0.6)) - pr * 1.7));
        c += pc * ring * (1.0 - body * step(0.0, q.y * 4.0 + q.x * 0.6)) * 0.9;
    }

    // ---- far mountains -----------------------------------------------------
    {
        float mx = fract(x - OFF(0.25));
        float h = hz + 0.10 + 0.07 * ridge(mx, 1.0, 0.6);
        float m = smoothstep(h + 0.0015, h - 0.0015, y);
        vec3 mc = mix(col(0.30, vec3(0.20, 0.05, 0.35)), sky_low, 0.35) * 0.55;
        c = mix(c, mc, m);
        c += sky_low * 0.25 * glow * exp(-abs(y - h) * 120.0) * step(h, y + 0.02);
    }
    {
        float mx = fract(x - OFF(0.4));
        float h = hz + 0.05 + 0.05 * ridge(mx, 9.0, 0.7);
        float m = smoothstep(h + 0.0015, h - 0.0015, y);
        c = mix(c, col(0.15, vec3(0.10, 0.02, 0.18)) * 0.6, m);
    }

    // ---- city: two rows --------------------------------------------------------
    {
        float n = float(buildings);
        vec3 b = city(fract(x - OFF(0.6)), y, hz, 0.16, floor(n * 0.75), 3.0, windows * 0.7);
        vec3 bc = col(0.20, vec3(0.06, 0.03, 0.12)) * 0.7;
        c = mix(c, bc, b.x);
        c += b.y * col(0.80, vec3(1.0, 0.75, 0.35)) * 0.6 * glow;
        c += b.z * vec3(1.0, 0.2, 0.2) * glow;

        b = city(fract(x - OFF(0.8)), y, hz, 0.22, n * 0.5, 11.0, windows);
        c = mix(c, vec3(0.012, 0.008, 0.02), b.x);
        c += b.y * col(0.55, vec3(0.3, 0.9, 1.0)) * (0.8 + 0.6 * lowb) * glow;
        c += b.z * vec3(1.0, 0.25, 0.2) * glow;
    }

    // ---- floor grid: rows at depth, columns sliding faster up close ---------
    if (y < hz) {
        float s = (hz - y) / hz;                  // 0 at the horizon .. 1 at the bottom
        float z = 1.0 / (s + 0.03);
        float row = abs(fract(z * 0.6 - u_beats * 0.25) - 0.5);
        float fx = x - p * 1.2;                   // the floor slides past just ahead of the city
        float colm = ring_d(fx * 48.0, 0.0);
        float aa = 0.6 * z * z / (hz * R.y);      // row units per pixel
        float ac = 48.0 / R.x;                    // column units per pixel
        float lr = smoothstep(aa * 1.5, aa * 0.3, row) * (1.0 - smoothstep(0.08, 0.3, aa));
        float lc = smoothstep(ac * 1.5, ac * 0.3, colm);
        vec3 gc = col(0.65, vec3(1.0, 0.2, 0.7));
        vec3 floorc = vec3(0.01, 0.0, 0.02) + sky_low * 0.08 * (1.0 - s);
        float fade = smoothstep(0.0, 0.25, s);
        floorc += gc * max(lr, lc) * fade * (0.7 + 0.8 * lowb + 0.6 * hitl) * glow;
        c = floorc + sky_low * 0.4 * exp(-s * 18.0) * glow;   // haze at the horizon
    }

    // ---- light streaks racing round the horizon ---------------------------------
    if (streaks > 0.0) {
        for (int i = 0; i < 4; i++) {
            float fi = float(i);
            float head = fract(fi * 0.25 + u_beats / (8.0 + 4.0 * fi) + p * 1.5);
            float back = fract(head - x);                 // turns behind the head
            float ly = hz - 0.015 - 0.035 * fi;
            float dy = (y - ly) * R.y / u_scale;
            float tail = exp(-back * (14.0 - 2.0 * fi)) * exp(-dy * dy / (6.0 + 4.0 * fi));
            float core = exp(-pow(back * R.x / u_scale / 8.0, 2.0)) * exp(-dy * dy / 20.0);
            vec3 sc = col(0.9 - fi * 0.18, i % 2 == 0 ? vec3(0.3, 1.0, 1.0) : vec3(1.0, 0.3, 0.8));
            c += sc * (tail * 0.8 + core * 2.0) * streaks * glow * (0.6 + 0.6 * u_beat);
        }
    }

    // ---- foreground posts whizzing past (fastest layer) ---------------------
    {
        float fx = fract(x - p * 1.8);
        float pc = floor(fx * 12.0);
        float lx = fract(fx * 12.0);
        float has = step(0.5, hash21(vec2(pc, 41.0)));
        float w = 0.05;
        float post = has * smoothstep(w, w * 0.6, abs(lx - 0.5)) * step(y, hz + 0.04 + 0.22 * hash21(vec2(pc, 5.0)));
        float lamp = has * exp(-pow((lx - 0.5) * R.x / 12.0 / u_scale, 2.0) / 60.0
                             - pow((y - hz - 0.04 - 0.22 * hash21(vec2(pc, 5.0))) * R.y / u_scale, 2.0) / 60.0);
        c = mix(c, vec3(0.0), post * 0.92);
        c += lamp * col(0.85, vec3(1.0, 0.8, 0.5)) * 1.5 * glow * (0.5 + hitl);
    }

    // vignette top/bottom only: a 360° ring has no left/right edges
    c *= 0.75 + 0.25 * smoothstep(0.0, 0.15, y) * smoothstep(1.0, 0.8, y);
    c = c / (1.0 + c * 0.25);
    f_color = vec4(c, 1.0);
}
