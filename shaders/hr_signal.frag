#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Horror on a dying VHS signal, always red (it ignores the palette).
//   figure  a backlit silhouette; the light fails, and each time it returns the
//           figure stands closer
//   face    a hollow-eyed face, melting, its mouth slowly stretching open
//   eye     a huge bloodshot eye, darting around, then fixing on you
// Motion runs at a low frame rate, so everything twitches. Glitch comes in
// uneven bursts: blocks, torn lines, static. A heartbeat drives the light.
// A face is cut in for a few frames at random moments.
// Pad 1 / low hit = lurch, pad 2 / mid hit = glitch burst, pad 3 / high hit =
// static, pad 4 = the face, held as long as the pad is up.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   scene;    // auto|figure|face|eye = auto
    int   hold;     // 1..16 = 4         bars per scene (auto)
    float fps;      // 4..60 = 12        motion frame rate
    float glitch;   // 0..1 = 0.6
    float flash;    // 0..1 = 0.5        how often the face cuts in
    float grain;    // 0..1 = 0.35       film grain
    float heart;    // 0..1 = 0.6        heartbeat in the light
    float gain;     // 0.5..2 = 1        exposure
    float react;    // 0..1 = 1          pads and audio hits
};

float tt, B, frameN, phase01, lurch;

float H(float x) { return hash21(vec2(x, 11.3)); }
float sm(float a, float b, float x) { return smoothstep(a, b, x); }
float caps(vec2 p, vec2 a, vec2 b, float r) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}
float ell(vec2 p, vec2 r) { return (length(p / r) - 1.0) * min(r.x, r.y); }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

float figureV(vec2 p) {
    // The light behind it, failing now and then.
    float cutN = floor(phase01 * 6.0);
    float fog = fbm(p * 1.7 + vec2(tt * 0.04, -tt * 0.07), 4);
    float L = exp(-dot(p * vec2(0.75, 1.0), p * vec2(0.75, 1.0)) * 0.9);
    float v = L * (0.3 + 0.95 * fog);
    float drop = fract(phase01 * 6.0);
    float dark = step(0.86, drop);
    v *= (1.0 - dark) * (0.82 + 0.18 * step(0.3, H(frameN)));

    // Closer each time the light returns.
    float S = mix(0.42, 1.75, pow(cutN / 5.0, 1.5)) * (1.0 + lurch * 0.15);
    vec2 q = (p - vec2((H(cutN + floor(B / 64.0) * 7.0) - 0.5) * 0.7, -0.08 * S)) / S;
    q = rot(q, (H(cutN + 3.0) - 0.5) * 0.14);
    q.x += (noise2(vec2(q.y * 7.0, tt * 2.0)) - 0.5) * 0.018;

    float d = length((q - vec2(0.0, 0.62)) * vec2(1.05, 0.9)) - 0.12;
    d = smin(d, caps(q, vec2(0.0, 0.6), vec2(0.0, 0.4), 0.038), 0.03);
    d = smin(d, caps(q, vec2(-0.2, 0.38), vec2(0.2, 0.38), 0.045), 0.05);
    d = smin(d, caps(q, vec2(0.0, 0.38), vec2(0.0, -1.2), 0.13), 0.07);
    d = smin(d, caps(q, vec2(-0.22, 0.38), vec2(-0.36, -0.86), 0.028), 0.03);
    d = smin(d, caps(q, vec2(0.22, 0.38), vec2(0.36, -0.86), 0.028), 0.03);
    v *= sm(0.0, 0.012, d);

    // Its eyes stay lit when the light does not.
    vec2 e = vec2(abs(q.x) - 0.045, q.y - 0.635);
    v += exp(-dot(e, e) / 0.00012) * 1.5 * step(0.12, H(frameN + 5.0));
    return v;
}

float faceV(vec2 p, float S, float scream) {
    vec2 q = p / S;
    q.x += (noise2(vec2(q.y * 3.0, tt * 0.7)) - 0.5) * 0.09;
    q.y += (noise2(vec2(q.x * 4.0, tt * 0.4)) - 0.5) * 0.05;

    float jaw = 1.0 + 0.5 * sm(0.05, -0.85, q.y);
    vec2 h = vec2(q.x * jaw, q.y * 0.72 + 0.02);
    float hl = length(h) / 0.74;
    float mask = sm(1.03, 0.9, hl);
    float z = sqrt(max(1.0 - hl * hl, 0.0));
    float s = 0.14 + 0.82 * pow(z, 0.8) * (0.55 + 0.45 * sm(-0.9, 0.7, q.y));
    s *= 0.7 + 0.6 * fbm(q * 5.0 + 9.0, 4);

    // Sockets, drooping outward.
    vec2 e = rot(vec2(abs(q.x) - 0.27, q.y - 0.13), 0.35);
    float sE = ell(e, vec2(0.155, 0.19 + 0.05 * scream));
    s *= 1.0 - 0.55 * sm(0.17, 0.0, sE);
    s *= 1.0 - 0.98 * sm(0.05, -0.03, sE);

    // Nose slits, sunken cheeks.
    float nS = ell(vec2(abs(q.x) - 0.045, q.y + 0.12), vec2(0.022, 0.042));
    s *= 1.0 - 0.9 * sm(0.03, 0.0, nS);
    s *= 1.0 - 0.55 * sm(0.24, 0.0, length(vec2(abs(q.x) - 0.33, q.y + 0.22)));

    // The mouth opens wider than it should.
    vec2 m = vec2(q.x, q.y + 0.42 + 0.14 * scream);
    float rag = (noise2(vec2(atan(m.y, m.x) * 4.0, tt * 2.0)) - 0.5) * 0.04;
    float sM = ell(m, vec2(0.12 + 0.05 * scream, 0.04 + 0.34 * scream)) + rag;
    s *= 1.0 - 0.6 * sm(0.1, 0.0, sM);
    s *= sm(-0.02, 0.025, sM);

    // Cracks.
    vec2 cq = q * 7.0 + 3.0 + vec2(fbm(q * 5.0, 3), fbm(q * 5.0 + 7.0, 3)) * 2.2;
    s *= 1.0 - 0.6 * sm(0.012, 0.0, abs(noise2(cq) - 0.5)) * sm(0.45, 0.62, fbm(q * 3.0 + 13.0, 3));

    float v = s * mask;

    // Pinprick pupils deep in the sockets.
    vec2 g = vec2(abs(q.x) - 0.27, q.y - 0.11) + (hash22(vec2(frameN)) - 0.5) * 0.012;
    v += exp(-dot(g, g) / 0.0009) * 1.25;
    return v;
}

float eyeV(vec2 p) {
    vec2 q = p / (1.0 + lurch * 0.2);
    q.y += q.x * 0.04;

    // Blinks are rare, and snap.
    float bn = floor(tt * 0.9);
    float open = 1.0 - step(0.72, H(bn + 40.0)) * step(fract(tt * 0.9), 0.14);
    float lid = 0.56 * open * (1.0 - (q.x * q.x) / (1.3 * 1.3));
    float d = abs(q.y) - max(lid, 0.0);
    float inside = sm(0.012, -0.012, d);

    // Darting, then a long stare straight ahead.
    float gn = floor(tt * 1.3);
    float stare = step(0.6, H(floor(gn / 4.0) + 21.0));
    vec2 gaze = (vec2(H(gn), H(gn + 3.0)) - 0.5) * vec2(0.8, 0.26) * (1.0 - stare);
    gaze += (hash22(vec2(frameN)) - 0.5) * 0.008;

    vec2 e = q - gaze;
    float r = length(e), a = atan(e.y, e.x);

    float ball = 0.95 - 0.4 * sm(0.3, 1.2, length(q));
    ball -= 0.65 * sm(0.14, 0.0, -d);
    float v1 = abs(noise2(vec2(a * 6.0, r * 2.2) + 4.0) - 0.5);
    float v2 = abs(noise2(vec2(a * 15.0, r * 5.0) + 9.0) - 0.5);
    ball -= sm(0.03, 0.0, v1) * sm(0.33, 0.8, r) * 0.6;
    ball -= sm(0.025, 0.0, v2) * sm(0.45, 0.95, r) * 0.42;

    float R = 0.3, P = 0.095 + 0.09 * lurch + 0.03 * sin(tt * 0.7);
    float fib = noise2(vec2(a * 26.0, r * 5.0 - tt * 0.1));
    float iris = (0.28 + 0.5 * fib) * sm(R, R * 0.72, r) + 0.02;
    ball = mix(ball, iris, sm(R + 0.012, R - 0.012, r));
    ball *= sm(P - 0.008, P + 0.008, r);
    vec2 hl = e - vec2(-0.08, 0.1);
    ball += exp(-dot(hl, hl) / 0.0008) * 0.8;

    float skin = (0.06 + 0.26 * fbm(q * 6.0 + 2.0, 4));
    skin *= 0.72 + 0.28 * sin(d * 46.0 + noise2(q * 4.0) * 5.0);
    skin *= sm(1.5, 0.1, length(q * vec2(0.75, 1.0)));
    return mix(max(skin, 0.0), max(ball, 0.0), inside);
}

float image(vec2 p, int mode, float flashOn) {
    if (flashOn > 0.5) {
        float f = faceV(p + (hash22(vec2(frameN, 3.0)) - 0.5) * 0.03, 1.28, 1.0);
        return sm(0.12, 0.55, f) * 1.2;
    }
    if (mode == 0) return figureV(p);
    if (mode == 1) {
        float scream = sm(0.1, 0.95, phase01);
        float f = faceV(p, mix(0.8, 1.2, phase01) * (1.0 + lurch * 0.14), scream);
        return f + (1.0 - sm(0.0, 0.8, f)) * 0.05 * fbm(p * 2.0 + tt * 0.1, 3);
    }
    return eyeV(p);
}

vec3 ramp(float v) {
    vec3 c = mix(vec3(0.0), vec3(0.17, 0.0, 0.012), sm(0.0, 0.22, v));
    c = mix(c, vec3(0.66, 0.012, 0.035), sm(0.22, 0.55, v));
    c = mix(c, vec3(1.0, 0.07, 0.05), sm(0.55, 0.85, v));
    return mix(c, vec3(1.0, 0.74, 0.62), sm(0.85, 1.25, v));
}

void main() {
    vec2 w = world_uv(v_uv);
    if (w.x < 0.0) { f_color = vec4(0.0, 0.0, 0.0, 1.0); return; }

    B = u_beats;
    float frameRaw = floor(u_time * fps);
    tt = frameRaw / fps;
    frameN = mod(frameRaw, 997.0);
    float len = 4.0 * float(hold);
    phase01 = fract(B / len);

    float low = max(u_triggers.x, u_hits.y) * react;
    float mid = max(u_triggers.y, u_hits.z) * react;
    float high = max(u_triggers.z, u_hits.w) * react;
    lurch = low * low;

    // Scenes run figure, face, figure, eye, so it keeps coming back.
    float seq = mod(floor(B / len), 4.0);
    int mode = scene > 0 ? scene - 1 : (seq < 0.5 || (seq > 1.5 && seq < 2.5) ? 0 : (seq < 1.5 ? 1 : 2));

    // Uneven bursts: half-beat cells, only some of them fire.
    float cellB = floor(B * 2.0);
    float burst = step(0.74, H(cellB)) * exp(-fract(B * 2.0) * 2.6);
    float g = glitch * (0.1 + 0.95 * burst + 0.7 * mid * mid);

    // A face cuts in for a few frames.
    float fc = floor(B * 4.0);
    float flashOn = step(1.0 - 0.14 * flash, H(fc + 77.0)) * step(fract(B * 4.0), 0.5);
    flashOn = max(flashOn, step(0.5, u_triggers.w * react));

    // Torn lines, tracking, blocks.
    float fr = frameN;
    vec2 uv = w;
    float line = floor(w.y * 270.0) + 0.37;
    uv.x += (hash21(vec2(line, fr)) - 0.5) * 0.004 * (0.3 + g * 9.0);
    float roll = 1.0 - sm(0.0, 0.05, abs(fract(w.y - tt * 0.17 + H(floor(tt / 9.0))) - 0.5));
    uv.x += roll * (noise2(vec2(w.y * 90.0, tt * 8.0)) - 0.5) * (0.07 + g * 0.3);
    vec2 blk = floor(w * vec2(26.0, 15.0));
    float bh = hash21(blk + floor(tt * 10.0));
    if (bh > 1.0 - g * 0.5) uv += (hash22(blk + fr) - 0.5) * vec2(0.34, 0.05);
    float bandH = floor(w.y * 11.0 + H(fr) * 3.0);
    if (hash21(vec2(bandH, floor(tt * 8.0))) > 1.0 - g * 0.55) uv.x += (hash21(vec2(bandH, fr)) - 0.5) * 0.5;

    vec2 p = to_centered(uv);
    float o = (0.0012 + 0.016 * g);
    float v = image(p, mode, flashOn);
    float vO = image(p + vec2(o, 0.0), mode, flashOn);

    // The light beats like a heart: lub-dub, once a bar.
    float hx = fract(B / 4.0);
    float hb = exp(-hx * 12.0) + 0.75 * step(0.17, hx) * exp(-(hx - 0.17) * 12.0);
    float light = gain * (1.0 - heart * 0.42 + heart * 0.62 * hb);
    if (flashOn < 0.5) { v *= light; vO *= light; }

    // Vignette.
    vec2 c = to_centered(w);
    float vig = 1.0 - 0.13 * dot(c, c);
    v *= vig; vO *= vig;

    // Dropped and burning lines.
    float dl = hash21(vec2(floor(w.y * 135.0) * 1.37 + fr * 2.11, fr * 0.73 + 5.1));
    if (dl > 1.0 - g * 0.09) { v = 0.0; vO = 0.0; }
    else if (dl < g * 0.035) { v = 1.05; vO = 1.05; }

    // Static and grain.
    vec2 cellP = floor(w * u_world_resolution / max(1.0, 2.0 * u_scale));
    float nz = hash21(cellP + vec2(fr * 3.1, fr * 1.7));
    float st = clamp(g * 0.55 + high * high * 0.6, 0.0, 1.0) * sm(0.5, 0.9, hash21(vec2(floor(w.y * 40.0), floor(tt * 14.0))));
    v = mix(v, nz * nz * 1.1, st);
    vO = mix(vO, nz * nz * 1.1, st);
    float gr = (nz - 0.5) * grain * 0.16;
    v = max(v + gr * sm(0.0, 0.25, v + 0.1), 0.0);
    vO = max(vO + gr * sm(0.0, 0.25, vO + 0.1), 0.0);

    // Red from one copy, the highlights' tail from the shifted one.
    vec3 a = ramp(v), b_ = ramp(vO);
    vec3 col = vec3(a.r, b_.g, b_.b);

    // Scanlines.
    float sc = fract(w.y * u_world_resolution.y / (3.0 * u_scale));
    col *= 0.86 + 0.14 * step(0.34, sc);

    f_color = vec4(col, 1.0);
}
