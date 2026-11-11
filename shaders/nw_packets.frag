#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// The internet as a picture, on black (made to sit on a Screen layer):
//   globe  a dotted world, packets arcing between cities, with a hex dump, a
//          route list and the real audio spectrum as TRAFFIC around it
//   mesh   a network graph, packets running along its live links
//   rain   falling hex, a big word cut out of it
// Text is a 3x5 pixel font built in. Words flash every 4 bars; each bar's start
// slips the frame. Colors from the palette (or terminal green).
// Pad 1 / low hit = kick, pad 2 = a word now, pad 3 / high hit = slip.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   mode;     // auto|globe|mesh|rain = auto
    int   hold;     // 1..32 = 8         bars per mode (auto)
    int   colors;   // palette|terminal = palette
    float low;      // 0..1 = 0.45       lowest palette position used
    float hud;      // 0..1 = 1          text panels
    float words;    // 0..1 = 1          big words
    float slip;     // 0..1 = 0.6        jump on each bar
    float gain;     // 0.5..2 = 1
    float react;    // 0..1 = 1          pads and audio
};

const int GL[46] = int[46](31599, 11415, 29671, 29647, 23497, 31183, 31215, 29257, 31727, 31695, 11245, 27566, 14627, 27502, 31143, 31140, 14699, 23533, 29847, 4714, 23469, 18727, 24557, 27501, 11114, 27556, 11123, 27565, 14478, 29842, 23407, 23402, 23549, 23213, 23186, 29351, 0, 2, 1040, 4772, 448, 7, 17492, 26918, 12875, 3640);
const int WD[96] = int[96](28, 34, 23, 39, 10, 12, 20, 36, 4, 0, 4, 36, 36, 36, 36, 36, 25, 18, 23, 16, 36, 36, 36, 36, 27, 24, 24, 29, 36, 36, 36, 36, 2, 0, 0, 36, 24, 20, 36, 36, 29, 12, 25, 39, 18, 25, 36, 36, 23, 30, 21, 21, 36, 36, 36, 36, 13, 23, 28, 36, 36, 36, 36, 36, 10, 12, 12, 14, 28, 28, 36, 36, 28, 30, 13, 24, 36, 36, 36, 36, 29, 29, 21, 45, 0, 36, 36, 36, 17, 29, 29, 25, 36, 36, 36, 36);
const int WDLEN[12] = int[12](7, 3, 4, 4, 6, 6, 4, 3, 6, 4, 5, 4);
const int TX[144] = int[144](23, 14, 29, 37, 28, 29, 10, 29, 36, 36, 43, 21, 18, 23, 20, 36, 30, 25, 44, 36, 36, 36, 36, 36, 27, 24, 30, 29, 14, 36, 42, 36, 0, 37, 0, 37, 0, 37, 0, 39, 0, 36, 36, 36, 36, 36, 36, 36, 17, 14, 33, 13, 30, 22, 25, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 29, 27, 10, 12, 14, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 29, 27, 10, 15, 15, 18, 12, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 25, 20, 29, 39, 28, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36);
const int N_WORDS = 12;
const int C_SPACE = 36, C_DOT = 37, C_M = 22, C_S = 28;

const float PI = 3.14159265, TAU = 6.2831853;

float B, kick, px, yaw;
vec3 cDim, cMid, cHot;

float H(float x) { return hash21(vec2(x * 0.731 + 1.3, 9.17)); }
float H2(float x, float y) { return hash21(vec2(x * 0.731 + 1.3, y * 1.137 + 4.1)); }
float sm(float a, float b, float x) { return smoothstep(a, b, x); }

float chPx(vec2 f, int c) {
    ivec2 g = ivec2(floor(f * vec2(4.0, 6.0)));
    if (g.x < 0 || g.y < 0 || g.x > 2 || g.y > 4) return 0.0;
    return float((GL[c] >> (14 - g.y * 3 - g.x)) & 1);
}

vec2 charSize(float h) { return vec2(h * (4.0 / 6.0) / aspect(), h); }

float textLine(vec2 w, vec2 org, float h, int line, int count) {
    vec2 g = (w - org) / charSize(h);
    if (g.y < 0.0 || g.y >= 1.0 || g.x < 0.0 || g.x >= float(count)) return 0.0;
    return chPx(fract(g), TX[line * 24 + int(g.x)]);
}

// Scrolling lines of hex: a 4-digit address, then bytes in pairs.
vec2 hexDump(vec2 w, vec2 org, vec2 box, float h) {
    if (w.x < org.x || w.y < org.y || w.x > org.x + box.x || w.y > org.y + box.y) return vec2(0.0);
    vec2 g = (w - org) / charSize(h);
    float row = floor(g.y), col = floor(g.x);
    if (col >= floor(box.x / charSize(h).x)) return vec2(0.0);
    float id = row + floor(B * 4.0);
    int c = C_SPACE;
    float bright = 0.55;
    if (col < 4.0) {
        c = int(mod(floor(id * 16.0 / pow(16.0, 3.0 - col)), 16.0));
        bright = 0.3;
    } else if (col > 4.5) {
        float k = col - 5.0;
        if (mod(k, 3.0) < 1.5) {
            float change = floor(B * (H2(id, k) > 0.9 ? 8.0 : 0.0));
            c = int(H2(id + change, k) * 16.0);
        }
    }
    float hi = step(mod(id, 11.0), 0.5);
    return vec2(chPx(fract(g), c), mix(bright, 1.0, hi));
}

// The route list: addresses arriving on the beat, the newest brightest.
vec2 ipList(vec2 w, vec2 org, vec2 box, float h) {
    if (w.x < org.x || w.y < org.y || w.x > org.x + box.x || w.y > org.y + box.y) return vec2(0.0);
    vec2 g = (w - org) / charSize(h);
    float row = floor(g.y), col = floor(g.x);
    float rows = floor(box.y / h);
    float id = floor(B) - row;
    int c = C_SPACE;
    if (col < 15.0) {
        c = mod(col, 4.0) > 2.5 ? C_DOT : int(H2(id, floor(col / 4.0) * 7.0 + mod(col, 4.0)) * 10.0);
    } else if (col > 15.5 && col < 18.0) {
        c = int(H2(id, col) * 10.0);
    } else if (col > 17.5 && col < 19.5) {
        c = col < 18.5 ? C_M : C_S;
    }
    return vec2(chPx(fract(g), c), row < 0.5 ? 1.0 : mix(0.65, 0.2, row / rows));
}

float trafficBars(vec2 w, vec2 org, vec2 box) {
    vec2 g = (w - org) / box;
    if (g.x < 0.0 || g.x > 1.0 || g.y < 0.0 || g.y > 1.0) return 0.0;
    float n = 32.0;
    float i = floor(g.x * n);
    float lvl = pow(min(fft(int(i * 1.8 + 2.0)), 1.0), 2.2) * react;
    float y = 1.0 - g.y;
    float seg = step(0.3, fract(y * 18.0));
    return step(0.14, fract(g.x * n)) * step(y, lvl * 0.95 + 0.02) * seg;
}

vec3 rotLocal(vec3 n) {
    float c = cos(yaw), s = sin(yaw);
    vec3 m = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
    float a = 0.38, ca = cos(a), sa = sin(a);
    return vec3(m.x, ca * m.y - sa * m.z, sa * m.y + ca * m.z);
}
vec3 fromLocal(vec3 m) {
    float a = -0.38, ca = cos(a), sa = sin(a);
    vec3 n = vec3(m.x, ca * m.y - sa * m.z, sa * m.y + ca * m.z);
    float c = cos(yaw), s = sin(yaw);
    return vec3(c * n.x - s * n.z, n.y, s * n.x + c * n.z);
}

float worldDots(vec3 m) {
    float rows = 40.0;
    float lat = asin(clamp(m.y, -1.0, 1.0));
    float ly = (lat / PI + 0.5) * rows;
    float iy = floor(ly);
    float latC = ((iy + 0.5) / rows - 0.5) * PI;
    float cl = cos(latC);
    float nLon = max(floor(cl * rows * 2.0), 1.0);
    float lx = (atan(m.z, m.x) / TAU + 0.5) * nLon;
    float ix = floor(lx);
    float lonC = ((ix + 0.5) / nLon - 0.5) * TAU;
    vec3 c = vec3(cl * cos(lonC), sin(latC), cl * sin(lonC));
    float land = noise2(c.xz * 2.1 + c.y * 1.4 + 3.0) + 0.45 * noise2(c.zy * 4.6 + 8.0);
    if (land < 0.74) return 0.0;
    vec2 f = vec2(fract(lx) - 0.5, fract(ly) - 0.5);
    return 1.0 - sm(0.2, 0.34, length(f));
}

vec3 randS(float x) {
    float z = H(x) * 1.7 - 0.85;
    float a = H(x + 5.7) * TAU;
    float r = sqrt(1.0 - z * z);
    return vec3(r * cos(a), z, r * sin(a));
}

vec3 globe(vec2 p, vec2 ctr, float R) {
    vec3 col = vec3(0.0);
    vec2 q = (p - ctr) / R;
    float l2 = dot(q, q);
    float l = sqrt(l2);

    // Thin atmosphere and the disc's edge.
    col += cMid * exp(-abs(l - 1.0) * 26.0) * 0.5;
    col += cMid * exp(-max(l - 1.0, 0.0) * 9.0) * step(1.0, l) * 0.1;

    if (l < 1.0) {
        float z = sqrt(1.0 - l2);
        vec3 front = rotLocal(vec3(q, z));
        vec3 back = rotLocal(vec3(q, -z));
        col += cHot * worldDots(front) * (0.35 + 0.65 * z) * (0.8 + kick * 0.5);
        col += cDim * worldDots(back) * 0.3;

        // Parallels and meridians.
        float mer = abs(fract(atan(front.z, front.x) / TAU * 12.0) - 0.5) * 2.0;
        float par = abs(fract((asin(front.y) / PI + 0.5) * 8.0) - 0.5) * 2.0;
        col += cDim * (sm(0.04, 0.0, mer) + sm(0.05, 0.0, par)) * 0.18 * z;

        // A pulse sweeps out from the middle on the kick.
        float pr = fract(B) * 1.1;
        col += cMid * exp(-pow((l - pr) * 12.0, 2.0)) * (1.0 - fract(B)) * 0.14;
    }

    // Packets arcing between cities.
    for (int i = 0; i < 8; i++) {
        float s0 = B * 0.25 + float(i) * 0.37;
        float cell = floor(s0), s = fract(s0);
        float seed = cell * 3.1 + float(i) * 11.0;
        vec3 a = randS(seed), b = randS(seed + 2.3);
        vec3 mid = normalize(a + b + vec3(1e-3)) * (1.05 + 0.55 * length(a - b));
        vec3 A = fromLocal(a), M = fromLocal(mid), C = fromLocal(b);
        float v = 0.0;
        vec3 pr = A;
        const int SEG = 12;
        for (int j = 1; j <= SEG; j++) {
            float t = float(j) / float(SEG);
            if (t - 1.0 / float(SEG) > s) break;
            float tc = min(t, s);
            float u = 1.0 - tc;
            vec3 cu = u * u * A + 2.0 * u * tc * M + tc * tc * C;
            vec2 pa = q - pr.xy, ba = cu.xy - pr.xy;
            float hh = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
            float d = length(pa - ba * hh) * R;
            float zz = mix(pr.z, cu.z, hh);
            float occl = (dot(pr.xy + ba * hh, pr.xy + ba * hh) < 1.0 && zz < 0.0) ? 0.1 : 1.0;
            float tail = max(0.22, sm(s - 0.6, s, tc)) * (1.0 - sm(0.9, 1.0, s) * (1.0 - tc));
            v = max(v, (exp(-d * d * 22000.0) + 0.16 * exp(-d * d * 1400.0)) * tail * occl);
            pr = cu;
        }
        col += mix(cMid, cHot, 0.5) * v * 1.5;

        // The head, and a ring where it lands.
        float u2 = 1.0 - s;
        vec3 hd = u2 * u2 * A + 2.0 * u2 * s * M + s * s * C;
        vec2 dh = (q - hd.xy) * R;
        col += cHot * exp(-dot(dh, dh) * 2600.0) * step(0.0, dot(hd.xy, hd.xy) < 1.0 && hd.z < 0.0 ? -1.0 : 1.0) * 1.4;
        if (C.z > 0.0) {
            float rr = length((q - C.xy) * R);
            float ring = sm(0.8, 1.0, s);
            col += cHot * exp(-pow((rr - ring * 0.06) * 260.0, 2.0)) * ring * (1.0 - sm(0.97, 1.0, s));
        }
    }
    return col;
}

vec3 netGraph(vec2 p) {
    float sc = 3.2;
    vec2 g = p * sc;
    vec2 id = floor(g);
    float t = floor(B / 4.0);
    vec3 col = vec3(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 c = id + vec2(float(x), float(y));
        vec2 A = c + 0.5 + (hash22(c) - 0.5) * 0.75;
        // A node.
        float hub = step(0.8, hash21(c + 3.0));
        float dn = length(g - A) / sc;
        float blink = step(0.5, fract(B * (0.5 + hash21(c) * 2.0) + hash21(c + 8.0)));
        col += mix(cMid, cHot, hub) * (1.0 - sm(0.006 + 0.007 * hub, 0.008 + 0.007 * hub + px, dn)) * (0.55 + 0.45 * blink);
        col += cHot * hub * exp(-pow((dn - fract(B + hash21(c)) * 0.09) * 180.0, 2.0)) * (1.0 - fract(B + hash21(c)));
        // Its links.
        for (int k = 0; k < 3; k++) {
            vec2 off = k == 0 ? vec2(1.0, 0.0) : (k == 1 ? vec2(0.0, 1.0) : vec2(1.0, 1.0));
            vec2 c2 = c + off;
            float eh = hash21(c + off * 37.0 + 1.5);
            if (k == 2 && eh < 0.55) continue;
            vec2 Bp = c2 + 0.5 + (hash22(c2) - 0.5) * 0.75;
            vec2 pa = g - A, ba = Bp - A;
            float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
            float d = length(pa - ba * hh) / sc;
            float live = step(0.42, hash21(c + off * 11.0 + t * 1.7));
            col += cDim * (1.0 - sm(px * 0.6, px * 1.6, d)) * (0.22 + 0.55 * live);
            if (live > 0.5) {
                float sp = 0.5 + eh;
                float ph = fract(B * sp + eh * 9.0);
                float along = hh - ph;
                float tail = step(along, 0.0) * exp(along * 9.0);
                col += mix(cMid, cHot, 0.6) * (1.0 - sm(px * 0.8, px * 2.4, d)) * tail * 1.5 * (0.7 + kick * 0.5);
            }
        }
    }
    return col;
}

vec3 rain(vec2 w) {
    float h = 1.0 / 44.0;
    vec2 cs = charSize(h);
    vec2 g = w / cs;
    float col = floor(g.x);
    float sp = 0.25 + H(col) * 0.75;
    float y = g.y / 44.0;
    float head = fract(B * sp * 0.25 + H(col + 5.0));
    float dist = fract(head - y + 1.0);
    float len = 0.2 + H(col + 9.0) * 0.5;
    float tail = 1.0 - sm(0.0, len, dist);
    float row = floor(g.y);
    float flip = floor(B * (H2(col, row) > 0.8 ? 8.0 : 1.0));
    float ch = chPx(fract(g), int(H2(col + flip * 3.1, row) * 16.0));
    float isHead = step(dist, h * 1.2);
    return (mix(cDim, cMid, tail) * pow(tail, 1.6) * 1.1 + cHot * isHead * 1.3) * ch;
}

float bigWord(vec2 w, int idx, out float box) {
    int n = WDLEN[idx];
    float h = 0.2;
    vec2 cs = charSize(h);
    float W = cs.x * float(n);
    vec2 org = vec2(0.5 - W * 0.5, 0.5 - h * 0.5);
    vec2 g = (w - org) / cs;
    box = step(abs(w.x - 0.5), W * 0.5 + 0.018) * step(abs(w.y - 0.5), h * 0.5 + 0.03);
    if (g.x < 0.0 || g.y < 0.0 || g.x >= float(n) || g.y >= 1.0) return 0.0;
    return chPx(fract(g), WD[idx * 8 + int(g.x)]);
}

void main() {
    vec2 w0 = world_uv(v_uv);
    if (w0.x < 0.0) { f_color = vec4(0.0, 0.0, 0.0, 1.0); return; }

    B = u_beats;
    px = 2.0 / u_world_resolution.y;
    float bar = floor(B / 4.0);
    float len = 4.0 * float(hold);
    float low2 = max(u_triggers.x, u_hits.y) * react;
    float high2 = max(u_triggers.z, u_hits.w * 0.6) * react;
    kick = max(pow(max(u_beat, 0.0), 2.0), low2);
    yaw = u_time * 0.09 + floor(B / 4.0) * 0.0;

    if (colors == 1) {
        cDim = vec3(0.02, 0.32, 0.12); cMid = vec3(0.1, 0.9, 0.4); cHot = vec3(0.72, 1.0, 0.82);
    } else {
        cDim = palette(mix(low, 1.0, 0.1)) * 0.75;
        cMid = palette(mix(low, 1.0, 0.45));
        cHot = palette(mix(low, 1.0, 0.95));
    }

    // Each bar's start slips bands sideways, briefly.
    vec2 w = w0;
    float barF = fract(B / 4.0);
    float jolt = step(barF, 0.05) * slip + high2 * high2 * slip * 0.4 * step(0.5, hash21(vec2(floor(w0.y * 9.0), floor(u_time * 20.0))));
    float band = floor(w0.y * 22.0);
    w.x += (hash21(vec2(band, floor(B * 8.0))) - 0.5) * 0.18 * jolt * step(0.45, hash21(vec2(band + 3.0, bar)));

    vec2 p = to_centered(w);
    p /= 1.0 + kick * 0.035;
    vec2 wZ = from_centered(p);

    int m = mode > 0 ? mode - 1 : int(mod(floor(B / len), 3.0));
    vec3 col = vec3(0.0);
    float wide = 1.0;
    if (m == 0) {
        col += globe(p, vec2(0.0, -0.02), hud > 0.05 ? 0.78 : 0.92);
    } else if (m == 1) {
        col += netGraph(p);
    } else {
        col += rain(wZ);
    }

    // Panels, in a fixed frame so the picture moves under them.
    if (hud > 0.01) {
        float h = 1.0 / 62.0;
        float t = 0.0;
        // Crop marks and a rule along the top.
        vec2 e = abs(w - 0.5);
        vec2 mg = vec2(0.012 / aspect(), 0.012);
        vec2 ec = vec2(0.5) - mg - e;
        float marks = max(step(abs(ec.x), px * 0.5) * step(ec.y, 0.03) * step(0.0, ec.y), step(abs(ec.y), px * 0.5) * step(ec.x, 0.03 / aspect()) * step(0.0, ec.x));
        col += cMid * marks * 0.9;

        t = max(t, textLine(w, vec2(0.022, 0.03), h, 0, 24));
        float clockCol = 0.0;
        col += cHot * t * hud;

        if (m == 0) {
            float a = textLine(w, vec2(0.022, 0.08), h, 2, 8);
            vec2 hx = hexDump(w, vec2(0.022, 0.105), vec2(0.215, 0.5), h);
            col += cMid * a * 0.9 * hud + cMid * hx.x * hx.y * hud;

            float a2 = textLine(w, vec2(0.022, 0.67), h, 3, 6);
            vec2 ip = ipList(w, vec2(0.022, 0.695), vec2(0.215, 0.26), h);
            col += cMid * a2 * 0.9 * hud + mix(cMid, cHot, step(0.9, ip.y)) * ip.x * ip.y * hud;

            float a3 = textLine(w, vec2(0.79, 0.67), h, 4, 8);
            col += cMid * a3 * 0.9 * hud;
            col += mix(cMid, cHot, sm(0.72, 0.95, 1.0 - (w.y - 0.695) / 0.26)) * trafficBars(w, vec2(0.79, 0.695), vec2(0.188, 0.26)) * 0.9 * hud;

            vec2 hx2 = hexDump(w + vec2(0.0, 0.31), vec2(0.79, 0.105 + 0.31), vec2(0.188, 0.5), h);
            col += cDim * hx2.x * hx2.y * 1.1 * hud;
        }
    }

    // A word flashes every 4 bars. Pad 2 calls one too.
    float phr = mod(B, 16.0);
    float wordOn = max(step(phr, 2.0), step(0.5, u_triggers.y * react));
    wordOn = max(wordOn, step(1.5, float(m)) * step(mod(B, 8.0), 6.0));
    if (words > 0.5 && wordOn > 0.5 && (m == 2 || step(0.5, fract(B * 2.0)) > 0.5 || phr > 1.0)) {
        float box;
        int idx = int(mod(floor(B / 16.0) + floor(u_triggers.y * 0.0), float(N_WORDS)));
        float wv = bigWord(w, idx, box);
        if (m == 2) col *= 1.0 - box;
        col = mix(col, vec3(0.0), wv * (m == 2 ? 0.0 : 0.85));
        col += cHot * wv * 1.3;
    }

    // Faint scanlines.
    col *= 0.9 + 0.1 * step(0.4, fract(w0.y * u_world_resolution.y / (3.0 * u_scale)));

    f_color = vec4(col * gain, 1.0);
}
