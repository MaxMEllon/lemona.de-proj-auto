#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Festival LED-wall fractal. A folded 3D fractal, seen two ways that cut every 4 bars:
//   tunnel  flying down a corridor carved through it, walls of endless detail
//   object  a huge crystal hanging in the dark, turning in lurches
// It breathes on the kick, and a wave of light passes through the structure on each
// beat. Arranged like a track: drop, a calm break, a build into a white hit.
// Turn `sync` off and it free-runs on time alone, with no beat, pad or audio link.
// Pad 1 / low hit = kick, pad 2 / mid hit = a wave of light, pad 3 = new form.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   section;  // auto|drop|calm|build = auto
    int   cycle;    // 4..64 = 16        bars from one drop to the next
    int   view;     // auto|tunnel|object = auto
    int   mirror;   // auto|off|2|6 = auto  symmetry for the screen
    int   colors;   // neon|palette = neon
    float fly;      // 0..3 = 1          speed down the tunnel
    float glow;     // 0..2 = 1
    float exposure; // 0.3..4 = 2.2
    int   steps;    // 24..96 = 44       ray steps: lower if the frame rate drops
    int   iters;    // 3..9 = 5          fractal depth: lower if the frame rate drops
    bool  sync;     // = true            off: free-running, no beat or audio
    float react;    // 0..1 = 0.7        pads and audio hits
};

const float TAU = 6.2831853;

float B, kick, wave, dropE, calmE, bld, impact;
float fS, fA1, fA2, trap;
vec3 fOff, roG;
bool tunnelView, cutHit;

float H(float x) { return hash21(vec2(x * 0.731 + 5.9, 3.13)); }
float sm(float a, float b, float x) { return smoothstep(a, b, x); }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float snapEase(float t, float sharp) {
    float f = clamp(fract(t) * sharp, 0.0, 1.0);
    return floor(t) + 1.0 - pow(1.0 - f, 4.0);
}

vec3 colorAt(float t) {
    t = fract(t);
    if (colors == 1) return palette(mix(0.42, 1.0, 1.0 - abs(t * 2.0 - 1.0)));
    const vec3 N0 = vec3(0.05, 0.75, 1.0);
    const vec3 N1 = vec3(0.45, 0.2, 1.0);
    const vec3 N2 = vec3(1.0, 0.1, 0.65);
    const vec3 N3 = vec3(1.0, 0.72, 0.25);
    float k = t * 4.0;
    if (k < 1.0) return mix(N0, N1, k);
    if (k < 2.0) return mix(N1, N2, k - 1.0);
    if (k < 3.0) return mix(N2, N3, k - 2.0);
    return mix(N3, N0, k - 3.0);
}

// Apollonian packing: repeat space, invert in a sphere, again and again.
float deFractal(vec3 p0) {
    float dom = 1.7;
    vec3 p = p0 * dom;
    if (!tunnelView) p.xz = rot(p.xz, fA2 * 3.0);
    float sc = dom;
    float tr = 1e3;
    float ca = cos(fA1), sa = sin(fA1);
    for (int i = 0; i < iters; i++) {
        p = -1.0 + 2.0 * fract(0.5 * p + 0.5);
        p.xy = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
        float r2 = dot(p, p);
        tr = min(tr, r2);
        float k = fS / max(r2, 0.001);
        p *= k;
        sc *= k;
    }
    trap = sqrt(tr);
    float d = 0.25 * mix(abs(p.y), length(p.xz), fOff.x) / sc;
    if (tunnelView) {
        // Always a way through: a square corridor down the middle.
        vec2 tq = rot(p0.xy, 0.785);
        float cutD = 0.24 - max(abs(tq.x), abs(tq.y));
        cutHit = cutD > d;
        d = max(d, cutD);
    } else {
        float cutD = length(p0) - 1.3;
        cutHit = cutD > d;
        d = max(d, cutD);
    }
    return d;
}

void main() {
    vec2 w = world_uv(v_uv);
    if (w.x < 0.0) { f_color = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec2 p = to_centered(w);

    float rx = sync ? react : 0.0;
    B = sync ? u_beats : u_time * 1.6;
    float bars = float(max(cycle, 4));
    float len = bars * 4.0;
    float pos = mod(B, len);
    float buildLen = 8.0;

    float secN = pos < len * 0.5 ? 0.0 : (pos < len - buildLen ? 1.0 : 2.0);
    if (section > 0) secN = float(section - 1);
    if (!sync) secN = 1.0;
    dropE = secN < 0.5 ? 1.0 : 0.0;
    calmE = (secN > 0.5 && secN < 1.5) ? 1.0 : 0.0;
    bld = secN > 1.5 ? (section > 0 ? fract(B / 8.0) : (pos - (len - buildLen)) / buildLen) : 0.0;
    impact = (sync && section == 0) ? exp(-pos * 1.5) : 0.0;

    float clockKick = sync ? pow(max(u_beat, 0.0), 2.0) * mix(0.25, 1.0, dropE) * (1.0 - calmE * 0.6) : 0.0;
    kick = max(clockKick, max(u_triggers.x, u_hits.y * 0.8) * rx);
    float padWave = max(u_triggers.y, u_hits.z * 0.5) * rx;

    // Forms: a new one every 4 bars, cross-morphing over the first beat.
    float shot = floor(B / 16.0) + floor(u_triggers.z * rx * 1.999) * 3.0;
    float seedA = mod(shot, 3.0);
    float seedB = mod(shot + 2.0, 3.0);
    const float SS[3] = float[3](1.12, 1.28, 1.44);
    const vec3 OO[3] = vec3[3](vec3(0.0), vec3(0.6, 0.0, 0.0), vec3(0.22, 0.0, 0.0));
    const float A1[3] = float[3](0.0, 0.12, 0.3);
    const float A2[3] = float[3](0.12, 0.3, 0.62);
    float morph = sm(0.0, 1.0, mod(B, 16.0));
    int ia = int(seedA), ib = int(seedB);
    fS = mix(SS[ib], SS[ia], morph);
    fOff = mix(OO[ib], OO[ia], morph);
    float driftA = sin(B * 0.11) * 0.09 + snapEase(B * 0.5, 3.0) * 0.015;
    fA1 = mix(A1[ib], A1[ia], morph) + driftA;
    fA2 = mix(A2[ib], A2[ia], morph) + cos(B * 0.083) * 0.07;
    // It breathes on the kick.
    fS += kick * 0.02;

    // Screen symmetry.
    int mm = mirror > 0 ? mirror - 1 : (H(shot + 4.0) > 0.5 ? 2 : 1);
    vec2 uvp = p;
    uvp = rot(uvp, (H(shot + 2.0) - 0.5) * 0.7 + (sync ? 0.0 : u_time * 0.01));
    if (mm == 1) {
        uvp.x = abs(uvp.x);
    } else if (mm == 2) {
        float a = atan(uvp.y, uvp.x), r = length(uvp);
        float s = TAU / 6.0;
        a = abs(mod(a, s) - s * 0.5);
        uvp = vec2(cos(a), sin(a)) * r;
    }
    uvp /= 1.0 + kick * 0.05 + impact * 0.35;

    // Views.
    int vw = view > 0 ? view - 1 : int(mod(floor(B / 16.0), 2.0));
    if (!sync && view == 0) vw = int(mod(floor(u_time / 30.0), 2.0));
    tunnelView = vw == 0;
    vec3 ro, rd;
    float focal;
    if (tunnelView) {
        float spd = fly * mix(mix(0.3, 0.09, calmE), 1.2, bld * bld);
        float z = B * spd + snapEase(B, 3.0) * 0.1 * dropE * fly;
        ro = vec3(sin(B * 0.05) * 0.05, cos(B * 0.041) * 0.05, z);
        float roll = snapEase(B * 0.25, 3.0) * 0.785 * (mod(shot, 2.0) * 2.0 - 1.0) * (sync ? 1.0 : 0.2);
        vec2 u2 = rot(uvp, roll);
        rd = normalize(vec3(u2, 1.25 + 0.4 * bld));
        focal = 1.25;
    } else {
        float a = B * 0.02 + H(shot) * TAU;
        float dist = mix(2.45, 2.0, H(shot + 1.0)) - bld * 0.5 + impact * 1.2;
        ro = vec3(sin(a) * dist, 0.25 * sin(a * 0.7), cos(a) * dist);
        vec3 fw = normalize(-ro);
        vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
        vec3 up = cross(fw, rt);
        rd = normalize(rt * uvp.x + up * uvp.y + fw * 1.55);
        focal = 1.55;
    }
    roG = ro;

    // March, gathering the glow of what we pass.
    float px = 2.0 / u_world_resolution.y;
    float t = 0.0;
    float maxT = tunnelView ? 7.0 : 6.0;
    float dmin = 1e3;
    float glowAcc = 0.0;
    vec3 glowCol = vec3(0.0);
    bool hit = false;
    int used = 0;
    float hue = fract(floor(B / 16.0) * 0.27 + 0.05);
    for (int i = 0; i < steps; i++) {
        vec3 q = ro + rd * t;
        float d = deFractal(q);
        if (d < 0.0009 * t / focal + 0.0002) { hit = true; used = i; break; }
        float g = exp(-max(d, 0.0) * 70.0);
        glowCol += colorAt(trap * 0.55 + hue) * g;
        glowAcc += g;
        t += d * 0.85;
        used = i;
        if (t > maxT) break;
    }
    float stepsF = float(steps);

    vec3 col = vec3(0.0);
    if (hit) {
        vec3 pos3 = ro + rd * t;
        float saveTrap = trap;
        vec2 e = vec2(0.0012 + 0.0009 * t, 0.0);
        vec3 n0 = (vec3(
            deFractal(pos3 + e.xyy) - deFractal(pos3 - e.xyy),
            deFractal(pos3 + e.yxy) - deFractal(pos3 - e.yxy),
            deFractal(pos3 + e.yyx) - deFractal(pos3 - e.yyx)));
        trap = saveTrap;
        vec3 n = dot(n0, n0) > 1e-12 ? normalize(n0) : -rd;

        bool isCut = cutHit;
        vec3 base = colorAt(trap * 0.55 + hue);
        // Crease shadow from how long the ray had to work.
        float ao = pow(1.0 - float(used) / stepsF, 2.4);
        vec3 ld = normalize(vec3(0.4, 0.75, -0.5));
        float dif = max(dot(n, ld), 0.0);
        float fres = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
        vec3 h = normalize(ld - rd);
        float spec = pow(max(dot(n, h), 0.0), 60.0);

        // Nearly black metal; where it was cut through, black outright.
        vec3 steel = vec3(0.05, 0.055, 0.07);
        col = isCut ? vec3(0.0) : (steel * (0.15 + dif) + base * fres * 0.5 + vec3(1.0) * spec * 0.45) * ao;

        // The neon burns along the folds, harder on the kick.
        float vein = exp(-trap * trap * 90.0);
        float fine = exp(-pow((trap - 0.16) * 34.0, 2.0));
        float energy = (1.1 + 3.2 * kick + 1.3 * dropE) * (1.0 - calmE * 0.45);
        col += base * (vein * 1.2 + fine * 0.8) * energy * (isCut ? 0.7 : 1.0) * mix(ao, 1.0, 0.35);
        // The hottest parts of the neon go white.
        col += vec3(1.0) * pow(vein, 3.0) * energy * 0.75 * mix(ao, 1.0, 0.35);

        // A wave of light through the structure on each beat.
        float fb = fract(B);
        float dWave;
        if (tunnelView) dWave = (pos3.z - ro.z) - fb * 6.0;
        else dWave = length(pos3) - fb * 2.2;
        float wv = exp(-dWave * dWave * (tunnelView ? 2.2 : 26.0)) * (1.0 - fb) * dropE;
        float pw = (tunnelView ? (pos3.z - ro.z) : length(pos3)) - (1.0 - padWave) * (tunnelView ? 6.0 : 2.2);
        wv = max(wv, exp(-pw * pw * (tunnelView ? 2.2 : 26.0)) * padWave);
        col += mix(base, vec3(1.0), 0.35) * wv * (isCut ? 0.5 : 1.1);

        // Far things sink into the dark.
        col *= exp(-t * (tunnelView ? 0.55 : 0.14));
    }
    col += glowCol / stepsF * 1.0 * glow * (0.35 + 0.65 * (1.0 - calmE * 0.6)) * (1.0 + kick * 0.9);

    // The build's rising light and strobe, then the hit.
    col *= 1.0 + bld * bld * 1.6;
    col += vec3(1.0) * step(0.5, fract(B * 4.0)) * pow(bld, 5.0) * 0.85;

    col *= exposure;
    col = 1.0 - exp(-col * 1.15);
    col = mix(col, vec3(1.0), sm(0.3, 0.85, impact));

    // Vignette, and a little dither against banding in the darks.
    col *= 1.0 - 0.09 * dot(p, p);
    col += (hash21(w * 917.0 + mod(u_time * 60.0, 89.0)) - 0.5) / 128.0;

    f_color = vec4(max(col, 0.0), 1.0);
}
