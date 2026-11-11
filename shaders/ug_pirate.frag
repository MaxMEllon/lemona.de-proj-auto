#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// UK garage / dub, on pirate radio:
//   estate  tower blocks at night in the rain; windows answer the 2-step, and the
//           mast on the roof throws rings that repeat like a dub delay
//   stack   a wall of sound system speakers, the push travelling through it
//   tuner   an FM dial scrolling through static, locking onto 98.7
// A ticker runs along the bottom. Every `rewind` bars the selecta pulls it up:
// everything runs backwards for 2 beats, under a big REWIND!.
// The drums are a swung 2-step from the beat clock.
// Pad 1 / low hit = kick, pad 2 / mid hit = snare, pad 3 = a word, pad 4 = rewind.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   shot;     // auto|estate|stack|tuner = auto
    int   hold;     // 1..32 = 8         bars per shot (auto)
    int   rewind;   // 0..64 = 16        bars between rewinds (0 = never)
    float swing;    // 0..1 = 0.55       how late the off 16ths fall
    int   colors;   // night|palette = night
    bool  ticker;   // = true
    float rain;     // 0..1 = 0.5
    float gain;     // 0.5..2 = 1
    float react;    // 0..1 = 0.7        pads and audio hits
};

const int GL[43] = int[43](31599, 11415, 29671, 29647, 23497, 31183, 31215, 29257, 31727, 31695, 11245, 27566, 14627, 27502, 31143, 31140, 14699, 23533, 29847, 4714, 23469, 18727, 24557, 27501, 11114, 27556, 11123, 27565, 14478, 29842, 23407, 23402, 23549, 23213, 23186, 29351, 0, 2, 1040, 4772, 448, 9346, 1488);
const int WD[64] = int[64](27, 14, 32, 18, 23, 13, 41, 36, 11, 18, 16, 36, 30, 25, 36, 36, 11, 24, 24, 22, 36, 36, 36, 36, 2, 40, 28, 29, 14, 25, 36, 36, 13, 30, 11, 36, 36, 36, 36, 36, 21, 18, 31, 14, 36, 36, 36, 36, 28, 14, 21, 14, 12, 29, 10, 36, 11, 10, 28, 28, 36, 36, 36, 36);
const int WDLEN[8] = int[8](7, 6, 4, 6, 3, 4, 7, 4);
const int TICK[138] = int[138](9, 8, 37, 7, 36, 15, 22, 36, 36, 21, 18, 31, 14, 36, 24, 23, 36, 10, 18, 27, 36, 36, 42, 42, 36, 36, 11, 18, 16, 36, 30, 25, 36, 10, 21, 21, 36, 29, 17, 14, 36, 22, 10, 28, 28, 18, 31, 14, 36, 36, 42, 42, 36, 36, 13, 30, 11, 36, 25, 21, 10, 29, 14, 36, 28, 25, 14, 12, 18, 10, 21, 36, 36, 42, 42, 36, 36, 28, 14, 21, 14, 12, 29, 10, 36, 32, 17, 14, 14, 21, 36, 18, 29, 36, 30, 25, 36, 36, 42, 42, 36, 36, 2, 40, 28, 29, 14, 25, 36, 10, 21, 21, 36, 23, 18, 16, 17, 29, 36, 36, 42, 42, 36, 36, 25, 30, 21, 21, 36, 30, 25, 41, 36, 36, 42, 42, 36, 36);
const int N_TICK = 138;
const int N_WORDS = 8;
const int C_DOT = 37, C_F = 15, C_M = 22;

const float TAU = 6.2831853;

float Bs, px, kick, snare, hat;
vec3 cSky, cBody, cSod, cHot, cSig;

float H(float x) { return hash21(vec2(x * 0.731 + 3.3, 8.41)); }
float H2(float x, float y) { return hash21(vec2(x * 0.731 + 3.3, y * 1.137 + 2.9)); }
float sm(float a, float b, float x) { return smoothstep(a, b, x); }

// Time since the last step in a 16-step pattern, swung; decays by `dec` per beat.
float stepEnv(int bits, float b, float dec) {
    float pos = mod(b, 4.0) * 4.0;
    float last = -100.0;
    float firstAt = 100.0;
    for (int i = 0; i < 16; i++) {
        if (((bits >> i) & 1) == 0) continue;
        float t = float(i) + (mod(float(i), 2.0) > 0.5 ? swing * 0.66 : 0.0);
        if (t <= pos) last = t;
        if (firstAt > 99.0) firstAt = t;
    }
    float age = last > -99.0 ? pos - last : pos + 16.0 - 12.0;
    return exp(-age * 0.25 * dec);
}

float chPx(vec2 f, int c) {
    ivec2 g = ivec2(floor(f * vec2(4.0, 6.0)));
    if (g.x < 0 || g.y < 0 || g.x > 2 || g.y > 4) return 0.0;
    return float((GL[c] >> (14 - g.y * 3 - g.x)) & 1);
}
vec2 charSize(float h) { return vec2(h * (4.0 / 6.0) / aspect(), h); }

float bigWord(vec2 w, int idx, float h) {
    int n = WDLEN[idx];
    vec2 cs = charSize(h);
    vec2 org = vec2(0.5 - cs.x * float(n) * 0.5, 0.5 - h * 0.5);
    vec2 g = (w - org) / cs;
    if (g.x < 0.0 || g.y < 0.0 || g.x >= float(n) || g.y >= 1.0) return 0.0;
    return chPx(fract(g), WD[idx * 8 + int(g.x)]);
}

// One row of towers. Returns the color in rgb, coverage in a.
vec4 towers(vec2 p, float seed, float wdt, float base, float range, float wn, float dim) {
    float c = floor(p.x / wdt);
    float bx = fract(p.x / wdt);
    float top = base + H2(c, seed) * range;
    float gap = 0.06 + 0.1 * H2(c, seed + 5.0);
    if (p.y > top || bx < gap || bx > 1.0 - gap) return vec4(0.0);
    vec3 col = cBody * (0.75 + 0.35 * dim);

    float ww = wdt * (1.0 - 2.0 * gap) / wn;
    vec2 g = vec2((bx - gap) * wdt / ww, (top - p.y) / (ww * 1.25));
    vec2 id = floor(g);
    vec2 f = fract(g);
    float pane = step(0.26, f.x) * step(f.x, 0.74) * step(0.28, f.y) * step(f.y, 0.72);
    float h = H2(c * 7.0 + id.x * 13.0, id.y + seed * 3.0);
    float lit = step(0.8, h);
    // Some windows answer the drums.
    float drum = 0.0;
    if (h > 0.58 && h < 0.8) {
        float pick = fract(h * 37.0);
        drum = pick < 0.45 ? kick : (pick < 0.75 ? snare : hat * 0.8);
    }
    vec3 tint = fract(h * 91.0) > 0.25 ? cSod : cHot * 0.8;
    col += tint * pane * (lit * (0.3 + 0.4 * fract(h * 13.0)) + drum * 1.3) * dim;
    return vec4(col, 1.0);
}

vec3 estate(vec2 p, float t) {
    float asp = aspect();
    // Sky: dark, the city's orange low down.
    vec3 col = cSky * (0.6 + 0.5 * sm(1.0, -1.0, p.y));
    col += cSod * 0.34 * exp(-(p.y + 0.75) * 1.9);
    float haze = fbm(vec2(p.x * 1.3 + t * 0.02, p.y * 2.4), 4);
    col += cSod * 0.14 * haze * sm(0.7, -0.7, p.y);

    // The mast's rings, repeating like a delay at dotted 8ths.
    vec2 apex = vec2(0.06, 0.84);
    float d = length(p - apex);
    float sinceK = mod(Bs, 2.0);
    for (int i = 0; i < 5; i++) {
        float age = sinceK - float(i) * 0.75;
        if (age < 0.0) age += 2.0;
        float r = age * 0.75;
        float fall = exp(-float(i) * 0.55) * exp(-age * 1.1);
        col += cSig * exp(-pow((d - r) * 70.0, 2.0)) * fall * 0.9;
    }

    // Three rows of blocks, the far ones drifting slower.
    vec4 a = towers(p + vec2(t * 0.012 + 3.0, 0.0), 1.0, 0.27, -0.42, 0.42, 5.0, 0.32);
    col = mix(col, a.rgb + cSod * 0.02, a.a);
    vec4 b = towers(p + vec2(t * 0.024 + 9.0, 0.0), 2.0, 0.42, -0.6, 0.52, 6.0, 0.6);
    col = mix(col, b.rgb, b.a);

    // The block with the transmitter.
    vec2 q = p - vec2(0.06, 0.0);
    if (abs(q.x) < 0.3 && p.y < 0.5) {
        vec3 tc = cBody * 0.8;
        vec2 g = vec2((q.x + 0.3) / 0.6 * 9.0, (0.5 - p.y) / 0.0735);
        vec2 id = floor(g);
        vec2 f = fract(g);
        float pane = step(0.24, f.x) * step(f.x, 0.76) * step(0.26, f.y) * step(f.y, 0.74);
        float h = H2(id.x * 3.0 + 40.0, id.y);
        float pick = fract(h * 29.0);
        float drum = pick < 0.28 ? kick : (pick < 0.46 ? snare : (pick < 0.6 ? hat : 0.0));
        float steady = step(0.76, h) * (0.45 + 0.35 * fract(h * 13.0));
        tc += (fract(h * 91.0) > 0.2 ? cSod : cHot) * pane * (steady + drum * 1.5);
        col = tc;
    }
    // Mast and its stays.
    float mx = abs(p.x - 0.06);
    if (p.y > 0.49 && p.y < 0.84) {
        float taper = 0.003 + (0.84 - p.y) * 0.012;
        col = mix(col, cBody, 1.0 - sm(taper, taper + px * 1.5, mx));
        float rungs = step(mod(p.y, 0.07), 0.007) * step(mx, 0.012 + (0.84 - p.y) * 0.1);
        col = mix(col, cBody, rungs);
    }
    // The red light, on the beat.
    float blink = step(0.5, fract(Bs * 0.5));
    col += vec3(1.0, 0.1, 0.05) * exp(-dot(p - apex, p - apex) * 2600.0) * (0.25 + 1.5 * blink);

    vec4 f = towers(p + vec2(t * 0.05 + 17.0, 0.0), 3.0, 0.62, -0.92, 0.4, 7.0, 1.0);
    col = mix(col, f.rgb * 0.5, f.a);

    // Drizzle.
    if (rain > 0.01) {
        vec2 rp = vec2(p.x + p.y * 0.14, p.y + t * 1.9) * vec2(230.0, 3.2);
        vec2 ri = floor(rp);
        float streak = step(0.965, hash21(ri)) * sm(0.0, 0.2, fract(rp.y)) * sm(1.0, 0.7, fract(rp.y)) * sm(0.5, 0.2, abs(fract(rp.x) - 0.5));
        col += cHot * streak * 0.11 * rain;
    }
    return col;
}

vec3 stackShot(vec2 p) {
    float sz = 0.5;
    vec2 q = p / sz + vec2(0.0, 0.5);
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5;
    float kind = H2(id.x + 20.0, id.y);

    // The push spreads out from the middle, late cabinets a little behind.
    float delay = length(id + vec2(0.5, 0.0)) * 0.09;
    int kBits = 1 | (1 << 10);
    float pump = stepEnv(kBits, Bs - delay, 5.0);
    pump = max(pump, kick * 0.8);

    vec3 tolex = vec3(0.028, 0.03, 0.036) * (0.8 + 0.4 * noise2(q * 40.0));
    vec3 col = tolex;
    float gapB = max(abs(f.x), abs(f.y));
    float light = 0.5 + 0.5 * sm(-1.0, 1.0, p.y);
    vec2 keyDir = vec2(-0.45, 0.89);

    if (kind < 0.76) {
        float r = length(f) / (0.42 * (1.0 + 0.04 * pump));
        vec2 nd = f / max(length(f), 1e-4);
        float facing = dot(nd, keyDir);
        // The cone slopes inward: lit on the side away from the key.
        float coneShade = 0.32 - 0.26 * facing * sm(0.25, 0.95, r);
        float ribs = 0.8 + 0.2 * sm(0.3, 0.7, abs(fract(r * 7.0) - 0.5) * 2.0);
        vec3 coneC = vec3(0.062, 0.066, 0.08) * coneShade * 3.0 * ribs;
        coneC += cSod * pump * 0.12 * sm(1.0, 0.35, r);
        vec3 c = coneC;
        // The surround: a rubber roll, lit on its near side.
        float roll = sm(0.84, 0.9, r) * sm(1.03, 0.98, r);
        c = mix(c, vec3(0.1, 0.105, 0.12) * (0.75 + 0.75 * facing), roll);
        // The metal ring.
        float ringM = sm(1.0, 1.015, r) * sm(1.1, 1.085, r);
        c = mix(c, mix(vec3(0.2), cSod, 0.35) * (0.55 + 0.75 * facing), ringM);
        // Dust cap, a dome taking the light.
        float cap = sm(0.33, 0.31, r);
        vec2 capUV = f / (0.42 * 0.33);
        float dome = 0.24 + 0.55 * max(dot(capUV, keyDir), -0.4) + 0.45 * pump;
        vec3 capC = mix(vec3(0.09, 0.09, 0.1), cSod, 0.3 + 0.55 * pump) * dome * 1.1;
        c = mix(c, capC, cap);
        c = mix(c, tolex, sm(1.09, 1.11, r));
        col = c;
    } else {
        // A horn: a rectangular throat, narrowing, with a driver flashing inside.
        vec2 a = abs(f);
        float dd = max(a.x / 0.42, a.y / 0.26);
        float wallSide = dot(sign(f) * step(a.yx * vec2(0.42 / 0.26, 0.26 / 0.42), a), keyDir);
        vec3 c = vec3(0.075, 0.078, 0.09) * (0.45 - 0.4 * wallSide) * sm(0.1, 1.0, dd);
        c = mix(c, cHot * (0.02 + 0.8 * hat), sm(0.18, 0.15, dd));
        c = mix(c, vec3(0.15, 0.15, 0.17) * (0.7 + 0.6 * wallSide), sm(0.94, 0.97, dd));
        col = mix(col, c, step(dd, 1.0));
    }

    // The cabinet's edge.
    col = mix(col, vec3(0.0), sm(0.47, 0.5, gapB));
    return col * (0.6 + 0.65 * light);
}

vec3 tuner(vec2 w, vec2 p, float t) {
    float asp = aspect();
    vec3 col = cSky * 0.5;

    // It hunts along the band, then locks to the station for most of the phrase.
    float cycleB = mod(Bs, 16.0);
    float lock = sm(2.5, 5.0, cycleB) * sm(16.0, 15.0, cycleB);
    float hunt = 91.0 + 15.0 * (0.5 + 0.5 * sin(Bs * 0.9 + 1.3 * sin(Bs * 0.37)));
    float freq = mix(hunt, 98.7, lock);

    // The scale, scrolling under a fixed needle.
    vec2 u = vec2(p.x / asp * 13.0 + freq, p.y);
    float yS = u.y + 0.12;
    float major = abs(fract(u.x) - 0.5);
    float minor = abs(fract(u.x * 5.0) - 0.5) / 5.0;
    float tickM = (1.0 - sm(0.006, 0.012, 0.5 - major)) * step(abs(yS), 0.13);
    float tickN = (1.0 - sm(0.006, 0.014, 0.1 - minor)) * step(abs(yS), 0.055);
    vec3 scale = cHot * max(tickM * 0.95, tickN * 0.55);
    col += scale;
    col += cSod * 0.5 * (1.0 - sm(0.002, 0.005, abs(yS - 0.2))) * step(0.0, 1.0);

    // Numbers on the even MHz.
    {
        float mhz = floor((u.x + 1.0) / 2.0) * 2.0;
        float dxL = (u.x - mhz) / 13.0 * asp;
        float h = 0.075;
        vec2 cs = vec2(h * 4.0 / 6.0, h);
        float val = mhz;
        int n = val >= 100.0 ? 3 : 2;
        vec2 g = vec2(dxL + float(n) * cs.x * 0.5, (0.33 - p.y + 0.0)) / cs;
        if (g.x >= 0.0 && g.x < float(n) && g.y >= 0.0 && g.y < 1.0) {
            int ci = int(g.x);
            float digit = n == 3 ? (ci == 0 ? 1.0 : (ci == 1 ? mod(floor(val / 10.0), 10.0) : mod(val, 10.0)))
                                 : (ci == 0 ? floor(val / 10.0) : mod(val, 10.0));
            col += cHot * chPx(fract(g), int(digit)) * 0.85;
        }
    }

    // The needle.
    float nd = abs(p.x);
    col = mix(col, cSod, 1.0 - sm(0.006, 0.0095, nd));
    col += cSod * exp(-nd * nd * 900.0) * 0.28 * (0.5 + 0.8 * kick);

    // The big readout.
    {
        float h = 0.27;
        vec2 cs = charSize(h);
        int fx = int(floor(freq * 10.0 + 0.5));
        int d0 = (fx / 1000) % 10, d1 = (fx / 100) % 10, d2 = (fx / 10) % 10, d3 = fx % 10;
        int n = 5;
        vec2 org = vec2(0.5 - cs.x * 2.5, 0.08);
        vec2 g = (w - org) / cs;
        if (g.x >= 0.0 && g.x < float(n) && g.y >= 0.0 && g.y < 1.0) {
            int i = int(g.x);
            int c = i == 0 ? d0 : (i == 1 ? d1 : (i == 2 ? d2 : (i == 3 ? C_DOT : d3)));
            float on = (i == 0 && d0 == 0) ? 0.0 : 1.0;
            col += mix(cSod, cHot, 0.2 + 0.6 * kick) * chPx(fract(g), c) * on * (0.65 + 0.35 * lock);
        }
    }

    // Signal meter, bottom: real audio when locked.
    {
        vec2 g = (w - vec2(0.2, 0.74)) / vec2(0.6, 0.075);
        if (g.x >= 0.0 && g.x < 1.0 && g.y >= 0.0 && g.y < 1.0) {
            float n = 48.0;
            float i = floor(g.x * n);
            float lvl = pow(min(fft(int(i * 1.2 + 2.0)), 1.0), 2.0) * react;
            float show = mix(0.15 * H2(i, floor(t * 12.0)), lvl, lock);
            float on = step(1.0 - g.y, show * 1.1 + 0.08) * step(0.18, fract(g.x * n));
            col += mix(cSig, cSod, g.x) * on * 0.9;
        }
    }

    // Static between stations.
    float off = 1.0 - lock;
    float nz = hash21(floor(w * u_world_resolution / (2.0 * max(u_scale, 0.1))) + mod(floor(t * 30.0), 251.0));
    col = mix(col, vec3(nz * nz) * cHot * 0.6, off * 0.3);
    return col;
}

void main() {
    vec2 w = world_uv(v_uv);
    if (w.x < 0.0) { f_color = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float B = u_beats;
    px = 2.0 / u_world_resolution.y;
    float t = u_time;

    if (colors == 1) {
        cSky = palette(0.08) + 0.02; cBody = palette(0.16) * 0.8 + 0.008;
        cSod = palette(0.72); cHot = palette(1.0); cSig = palette(0.55);
    } else {
        cSky = vec3(0.022, 0.045, 0.125); cBody = vec3(0.007, 0.009, 0.018);
        cSod = vec3(1.0, 0.58, 0.14); cHot = vec3(1.0, 0.93, 0.78); cSig = vec3(0.3, 0.72, 1.0);
    }

    // The rewind: for 2 beats time runs backwards, fast, with the frame slipping.
    float rw = 0.0;
    Bs = B;
    if (rewind > 0) {
        float len = 4.0 * float(rewind);
        float pos = mod(B, len);
        if (pos > len - 2.0) {
            float a = pos - (len - 2.0);
            rw = 1.0;
            Bs = (B - a) - a * 3.0;
            t -= a * 2.5;
        }
    }
    if (u_triggers.w * react > 0.05) {
        rw = 1.0;
        Bs = B - (1.0 - u_triggers.w) * 6.0;
    }

    // A swung 2-step. Bar A: kick on 1 and the "and" of 3; bar B adds a push.
    float bar2 = mod(floor(Bs / 4.0), 2.0);
    int kBits = bar2 < 0.5 ? (1 | (1 << 10)) : (1 | (1 << 7) | (1 << 10));
    int sBits = (1 << 4) | (1 << 12);
    int hBits = (1 << 2) | (1 << 6) | (1 << 10) | (1 << 14) | (1 << 3) | (1 << 11) | (1 << 15);
    kick = max(stepEnv(kBits, Bs, 7.0), max(u_triggers.x, u_hits.y) * react);
    snare = max(stepEnv(sBits, Bs, 7.0), max(u_triggers.y, u_hits.z * 0.5) * react);
    hat = stepEnv(hBits, Bs, 12.0);

    float rwSlip = rw * step(0.45, hash21(vec2(floor(w.y * 20.0), floor(u_time * 16.0))));
    vec2 wS = w;
    wS.x += rwSlip * (hash21(vec2(floor(w.y * 20.0), floor(u_time * 16.0) + 3.0)) - 0.5) * 0.22;

    vec2 p = to_centered(wS);
    p /= 1.0 + kick * 0.022;
    vec2 wZ = from_centered(p);

    float cutN = floor(B / (4.0 * float(hold)));
    int s = shot > 0 ? shot - 1 : int(mod(cutN, 3.0));
    vec3 col;
    if (s == 0)      col = estate(p, t);
    else if (s == 1) col = stackShot(p);
    else             col = tuner(wZ, p, t);

    // A word, now and then, or the rewind's.
    float wordOn = max(step(mod(B, 16.0), 1.0) * step(0.5, mod(floor(B / 16.0), 2.0)), step(0.4, u_triggers.z * react));
    int wIdx = -1;
    if (rw > 0.5) wIdx = 0;
    else if (wordOn > 0.5) wIdx = 1 + int(mod(floor(B / 16.0), float(N_WORDS - 1)));
    if (wIdx >= 0) {
        float bw = bigWord(wS, wIdx, 0.24);
        col *= 1.0 - 0.45 * rw;
        col = mix(col, vec3(0.0), bw);
        // The word is a hard sodium block, with an echo to the side.
        col += cHot * bw * (rw > 0.5 ? 1.2 : 1.0);
        float echo = bigWord(wS + vec2(0.012, 0.0), wIdx, 0.24);
        col += cSod * echo * (1.0 - bw) * 0.55;
    }

    // The ticker.
    if (ticker) {
        float h = 1.0 / 36.0;
        vec2 cs = charSize(h);
        float y0 = 0.935;
        float yy = (w.y - y0) / h;
        if (yy > -0.5 && yy < 1.5) {
            col = mix(col, vec3(0.0), 0.75);
            if (yy >= 0.0 && yy < 1.0) {
                float gx = w.x / cs.x + floor(u_time * 14.0) * 0.5;
                float i = mod(floor(gx), float(N_TICK));
                vec2 f = vec2(fract(gx), yy);
                col += cSod * chPx(f, TICK[int(i)]) * 1.05;
            }
        }
    }

    // Tube-screen lines, and grain.
    col *= 0.93 + 0.07 * step(0.4, fract(w.y * u_world_resolution.y / (3.0 * u_scale)));
    float gr = hash21(floor(w * u_world_resolution / max(1.0, 2.0 * u_scale)) + mod(floor(u_time * 24.0), 113.0));
    col += (gr - 0.5) * 0.025 * (0.3 + dot(col, vec3(0.33)));

    f_color = vec4(max(col, 0.0) * gain, 1.0);
}
