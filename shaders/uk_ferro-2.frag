#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// UK bass: a pool of black ferrofluid in a dark room, seen only through the long
// strip lights reflected in it. The bassline raises spikes out of the middle and
// makes them shudder; the kick, on a 2-step pattern, sends rings across the surface;
// the snare (2 and 4) kicks the second light. Quiet, heavy, almost no color.
// Pad 1 / low hit = a ring, pad 2 = the light, sub hit = spikes.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   shot;     // auto|low|top = auto
    int   hold;     // 1..32 = 8         bars per shot (auto)
    float growl;    // 0..1 = 0.8        spikes on the bassline
    float rings;    // 0..1 = 0.8        waves from the kick
    float light;    // 0.3..3 = 1.5
    float grain;    // 0..1 = 0.3
    int   colors;   // bone|palette = bone
    vec4  bone;     // color = 0.92,0.88,0.8   the main lights
    vec4  accent;   // color = 0.95,0.42,0.14  the second light
    float react;    // 0..1 = 0.6        pads and audio hits
    int   steps;    // 12..48 = 32       ray steps: lower if the frame rate drops
};

const float TAU = 6.2831853;

float B, gr, tBase, sn;
vec2 evO[5];
float evA[5];
int evN;
vec3 cMain, cAcc;

float H(float x) { return hash21(vec2(x * 0.731 + 2.1, 6.31)); }
float sm(float a, float b, float x) { return smoothstep(a, b, x); }

// Height of the surface at x, its detail limited for distance by `lod` (0..1).
float hgt(vec2 x, float lod) {
    float h = 0.0;

    // A slow heavy swell.
    h += 0.05 * (noise2(x * 0.55 + vec2(tBase * 0.06, -tBase * 0.04)) - 0.5);

    // Kick rings.
    for (int i = 0; i < evN; i++) {
        float a = evA[i];
        float r = length(x - evO[i]);
        float front = a * 1.25;
        float d = r - front;
        h += sin(d * 8.5) * exp(-d * d * 1.5) * exp(-a * 0.5) * 0.075 * rings;
    }

    float r0 = length(x);
    if (gr > 0.001) {
        // The shudder: tight FM ripple around the middle.
        float m = exp(-r0 * r0 * 0.42);
        h += gr * m * lod * 0.005 * sin(r0 * 30.0 - tBase * 19.0 + 4.0 * sin(tBase * 7.3));

        // Spikes on a staggered grid, tallest in the middle.
        float sc = 3.4;
        vec2 s = x * sc;
        float row = floor(s.y);
        s.x += mod(row, 2.0) * 0.5;
        vec2 id = floor(s);
        vec2 f = fract(s) - 0.5;
        float jit = hash21(id + 3.0);
        float d = length(f);
        float rm = length((id + 0.5 - vec2(mod(row, 2.0) * 0.5, 0.0)) / sc);
        vec2 cen = (id + 0.5 - vec2(mod(row, 2.0) * 0.5, 0.0)) / sc;
        float mask = sm(1.45, 0.2, rm + (noise2(cen * 1.5 + tBase * 0.5) - 0.5) * 0.5);
        float shake = 0.82 + 0.18 * sin(tBase * 26.0 + jit * TAU);
        float A = gr * mask * shake * (0.75 + 0.25 * jit);
        h += pow(max(1.0 - d / 0.5, 0.0), 2.7) * A * 0.72 * lod;
        // The pool bulges under them.
        h += gr * exp(-r0 * r0 * 0.75) * 0.14;
    }
    return h;
}

// The room: dark, with thin strip lights: long ones across it, and a rack of
// them overhead whose reflections draw the shape of the surface.
vec3 room(vec3 r) {
    vec3 c = vec3(0.02, 0.02, 0.024) * sm(-0.1, 0.8, r.y);
    if (r.y < 0.004) return c;
    vec2 q = r.xz / r.y;

    float across = 0.0;
    const float ZS[4] = float[4](2.5, 3.8, 5.6, 8.4);
    for (int i = 0; i < 4; i++) {
        float wd = 0.035 * ZS[i];
        across += sm(wd, wd * 0.5, abs(q.y - ZS[i]));
    }
    across *= sm(11.0, 8.0, abs(q.x));

    float zebra = sm(0.09, 0.05, abs(fract(q.x * 1.6 + 0.5) - 0.5));
    zebra *= sm(2.6, 2.2, abs(q.y)) * sm(3.2, 2.7, abs(q.x));
    c += cMain * (across * 2.6 + zebra * 1.5);

    // The accent light answers the snare.
    float s4 = sm(11.0, 8.0, abs(q.x)) * sm(0.075, 0.04, abs(q.y - 1.62));
    float s5 = sm(0.05, 0.025, abs(q.x + 0.32)) * sm(2.6, 2.2, abs(q.y));
    c += cAcc * (s4 + s5) * (0.3 + 3.2 * sn);
    return c;
}

void main() {
    vec2 w = world_uv(v_uv);
    if (w.x < 0.0) { f_color = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec2 p = to_centered(w);

    B = u_beats;
    tBase = u_time;

    cMain = colors == 1 ? palette(0.9) : bone.rgb;
    cAcc = colors == 1 ? palette(0.62) : accent.rgb;

    // The bassline, 16ths over 2 bars. It holds, leaves gaps, and pushes at the end.
    const float G[32] = float[32](
        1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0,
        1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    float st = B * 4.0;
    int si = int(mod(floor(st), 32.0));
    float g0 = G[si], g1 = G[int(mod(float(si) + 1.0, 32.0))];
    float fst = fract(st);
    float gate = mix(g0, g1, sm(0.55, 1.0, fst));
    // It growls in a saw at 3 per beat.
    float saw = 1.0 - fract(B * 3.0);
    float clockG = gate * (0.62 + 0.38 * saw);
    gr = growl * max(clockG, max(u_hits.x, u_triggers.w) * react);

    // 2-step kicks.
    const float K[4] = float[4](0.0, 2.5, 4.0, 6.75);
    float base = floor(B / 8.0) * 8.0;
    evN = 0;
    for (int j = 0; j < 2; j++) {
        float loopB = base - float(j) * 8.0;
        for (int i = 3; i >= 0; i--) {
            float at = loopB + K[i];
            float age = B - at;
            if (age >= 0.0 && evN < 5) {
                float seed = mod(at, 509.0);
                evO[evN] = (vec2(H(seed), H(seed + 3.0)) - 0.5) * vec2(1.6, 1.0);
                evA[evN] = age;
                evN++;
            }
        }
    }
    float kickNow = evN > 0 ? exp(-evA[0] * 5.0) : 0.0;
    kickNow = max(kickNow, max(u_triggers.x, u_hits.y) * react);

    // Snare on 2 and 4, a pad on top.
    sn = max(exp(-mod(B - 1.0, 2.0) * 5.5), u_triggers.y * react);

    // The pressure: a very slight, low shake while it growls.
    vec2 uvp = p + vec2(sin(tBase * 71.0), cos(tBase * 83.0)) * 0.0018 * gr;

    // Shots cut with the phrase.
    float cutN = floor(B / (4.0 * float(hold)));
    int sh = shot > 0 ? shot - 1 : int(mod(cutN, 2.0));
    vec3 ro, fw, rt, up;
    float focal;
    if (sh == 0) {
        float sway = sin(tBase * 0.07) * 0.5;
        ro = vec3(sway + (H(cutN) - 0.5) * 1.2, 0.85 + 0.25 * H(cutN + 2.0), -3.1);
        vec3 ta = vec3(sway * 0.3, 0.0, 0.5);
        fw = normalize(ta - ro);
        rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
        up = cross(fw, rt);
        focal = 1.75;
    } else {
        float rl = tBase * 0.02 + H(cutN) * TAU;
        ro = vec3(0.0, 4.2 - sin(tBase * 0.06) * 0.5, 0.0);
        fw = vec3(0.0, -1.0, 0.0);
        rt = vec3(cos(rl), 0.0, sin(rl));
        up = vec3(-sin(rl), 0.0, cos(rl));
        focal = 1.7;
    }
    vec3 rd = normalize(rt * uvp.x + up * uvp.y + fw * focal);

    vec3 col = vec3(0.0);
    if (rd.y < -0.005) {
        // March down from above the tallest spike.
        float Hm = 0.85;
        float t = (ro.y - Hm) / -rd.y;
        vec3 hit = ro + rd * t;
        for (int i = 0; i < steps; i++) {
            float dY = hit.y - hgt(hit.xz, sm(9.0, 4.0, t));
            if (dY < 0.0015 * t || t > 18.0) break;
            t += dY * 0.55;
            hit = ro + rd * t;
        }
        vec2 x = hit.xz;
        float px = 2.0 / u_world_resolution.y;
        float e = max(0.004, t * px * 1.2 / (-rd.y + 0.15));
        float lod = sm(9.0, 4.0, t);

        float h0 = hgt(x, lod);
        float hx = hgt(x + vec2(e, 0.0), lod);
        float hz = hgt(x + vec2(0.0, e), lod);
        vec3 n = normalize(vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e));

        vec3 r = reflect(rd, n);
        float ndv = max(dot(n, -rd), 0.0);
        float fres = 0.06 + 0.94 * pow(1.0 - ndv, 4.0);
        col = room(r) * max(fres, 0.3);

        // The steep sides of what stands up catch a bit of the room.
        float steep = 1.0 - n.y;
        col += cMain * 0.14 * sm(0.2, 0.75, steep);

        // Hard little lamps: a glint on the tip of every spike.
        vec3 L1 = normalize(vec3(-0.45, 0.8, 0.4));
        vec3 L2 = normalize(vec3(0.7, 0.45, 0.55));
        float sp1 = pow(max(dot(r, L1), 0.0), 140.0);
        float sp2 = pow(max(dot(r, L2), 0.0), 90.0);
        col += cMain * sp1 * 2.4 + cAcc * sp2 * (0.5 + 2.5 * sn);

        // The pool falls away into the dark.
        col *= exp(-t * t * 0.012);
        col *= sm(10.5, 4.5, t);
        col *= 1.0 + kickNow * 0.12;
    }

    col *= light;

    // Vignette and film grain, nothing else.
    float vig = 1.0 - 0.2 * dot(p, p);
    col *= max(vig, 0.0);
    col = col / (1.0 + col * 0.35);
    float nz = hash21(floor(w * u_world_resolution / max(1.0, 2.0 * u_scale)) + mod(floor(tBase * 24.0), 113.0) * 1.37);
    col += (nz - 0.5) * 0.05 * grain * (0.25 + sm(0.0, 0.4, dot(col, vec3(0.33))));
    col = max(col, 0.0);

    f_color = vec4(col, 1.0);
}
