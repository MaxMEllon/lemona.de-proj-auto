#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Film noir, black and white only: hard light through venetian blinds across a
// plaster sculpture and the wall behind it, with smoke in the beams. Cut like a
// film: every few bars a new sculpture, angle and slat direction. Some shots go
// to a coarse print screen. The sculpture turns in small lurches on the beat, the
// slats open with the kick. Shot on 24 fps film: grain, gate weave, dust.
// Pad 1 / low hit = the blinds snap open, pad 2 = a negative flash.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   form;     // auto|column|twist|slices|lattice = auto
    int   cut;      // 1..16 = 2         bars per shot
    float speed;    // 0..3 = 1          the sculpture's turning
    int   slats;    // 3..30 = 11
    float press;    // 0..1 = 0.3        share of shots in print screen
    float smoke;    // 0..1 = 0.6
    float grain;    // 0..1 = 0.5
    float react;    // 0..1 = 0.7        pads and audio hits
    int   steps;    // 24..96 = 60       ray steps: lower if the frame rate drops
    bool  invert;   // = false
};

const float PI = 3.14159265;

float tt, B, yaw, slide, openness, goboAng, goboOff;
int shape;
vec3 lightPos, lDir, lU, lV;

float H(float x) { return hash21(vec2(x * 0.731 + 4.7, 2.91)); }
float sm(float a, float b, float x) { return smoothstep(a, b, x); }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float snapEase(float t) {
    float f = clamp(fract(t) * 3.0, 0.0, 1.0);
    return floor(t) + 1.0 - pow(1.0 - f, 4.0);
}

float sculpture(vec3 p) {
    if (shape == 0) {
        // An endless column of rhomboids.
        vec3 q = p;
        q.xz = rot(q.xz, yaw);
        float per = 1.1;
        q.y = mod(q.y + per * 0.5 + slide * 0.14, per) - per * 0.5;
        float wd = 0.2 + 0.36 * (1.0 - abs(q.y) / (per * 0.5));
        return (max(abs(q.x), abs(q.z)) - wd) * 0.72;
    }
    if (shape == 1) {
        // A square column, twisted.
        vec3 q = p;
        float a = q.y * 1.15 + yaw;
        q.xz = rot(q.xz, a);
        vec2 d = abs(q.xz) - 0.42;
        float box = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 0.02;
        return box * 0.62;
    }
    if (shape == 2) {
        // A sphere sliced into discs, the discs sliding past each other.
        vec3 q = p;
        q.xz = rot(q.xz, yaw * 0.5);
        float wdt = 0.24;
        float i = floor(q.y / wdt);
        float shift = sin(i * 1.9 + slide * 0.9) * 0.34 * (0.5 + 0.5 * sin(slide * 0.5 + i * 0.3));
        vec3 c = q - vec3(shift, 0.0, 0.0);
        float sph = length(c) - 1.15;
        float gap = abs(fract(q.y / wdt) - 0.5) * wdt - wdt * 0.46;
        return max(sph, -gap) * 0.62;
    }
    // A shell of gyroid lattice.
    vec3 q = p;
    q.xz = rot(q.xz, yaw * 0.7);
    q.xy = rot(q.xy, yaw * 0.35);
    float sc = 4.4;
    vec3 g = q * sc;
    float gy = abs(dot(sin(g), cos(g.yzx))) / sc - 0.05;
    float sph = length(q) - 1.2;
    return max(sph, gy) * 0.68;
}

float wallD(vec3 p) { return 3.0 - p.z; }
float sceneD(vec3 p) { return min(sculpture(p), wallD(p)); }

vec3 normalAt(vec3 p) {
    vec2 e = vec2(0.002, -0.002);
    return normalize(e.xyy * sceneD(p + e.xyy) + e.yyx * sceneD(p + e.yyx) + e.yxy * sceneD(p + e.yxy) + e.xxx * sceneD(p + e.xxx));
}

// The blinds: slats in front of the light, projected through the scene.
float gobo(vec3 p) {
    vec3 v = p - lightPos;
    float z = dot(v, lDir);
    vec2 uv = vec2(dot(v, lU), dot(v, lV)) / max(z, 0.1);
    uv = rot(uv, goboAng);
    float win = sm(0.62, 0.56, abs(uv.x)) * sm(0.5, 0.45, abs(uv.y));
    float s = fract(uv.y * float(slats) * 0.95 + goboOff);
    float slat = sm(0.0, 0.035, s) * sm(openness + 0.035, openness, s);
    return slat * win;
}

float shadowTo(vec3 p, vec3 n) {
    vec3 ro = p + n * 0.012;
    vec3 ld = normalize(lightPos - ro);
    float t = 0.02, res = 1.0;
    for (int i = 0; i < 24; i++) {
        float h = sculpture(ro + ld * t);
        res = min(res, 22.0 * h / t);
        t += clamp(h, 0.02, 0.5);
        if (res < 0.002 || t > 9.0) break;
    }
    return clamp(res, 0.0, 1.0);
}

void main() {
    vec2 w = world_uv(v_uv);
    if (w.x < 0.0) { f_color = vec4(0.0, 0.0, 0.0, 1.0); return; }

    B = u_beats;
    float frameN = floor(u_time * 24.0);
    tt = frameN / 24.0;
    float fm = mod(frameN, 997.0);

    // Gate weave and a slow breath in the lamp.
    vec2 p = to_centered(w);
    vec2 weave = (hash22(vec2(fm, 2.0)) - 0.5) * vec2(0.0025, 0.004);
    p += weave;
    float flick = 0.96 + 0.08 * hash21(vec2(fm, 7.0));

    // The edit.
    float shotLen = 4.0 * float(cut);
    float cutN = floor(B / shotLen);
    float inShot = mod(B, shotLen);
    float seed = mod(cutN, 233.0);
    shape = form > 0 ? form - 1 : int(mod(float(int(H(seed + 1.0) * 4.0)) + cutN, 4.0));

    float low = max(u_triggers.x, u_hits.y) * react;
    float kick = max(pow(max(u_beat, 0.0), 3.0) * 0.6, low);
    yaw = tt * 0.14 * speed + snapEase(B * 0.5) * 0.42 * speed + H(seed) * 6.0;
    slide = snapEase(B * 0.5);
    openness = 0.46 + 0.34 * kick;
    goboOff = snapEase(B * 0.25) * 0.5 + tt * 0.012;
    goboAng = (H(seed + 2.0) - 0.5) * 1.15;

    // The lamp stands up and to one side, the side changing with the shot.
    float side = H(seed + 3.0) > 0.5 ? 1.0 : -1.0;
    lightPos = vec3(side * (3.8 + 1.5 * H(seed + 4.0)), 3.4 + H(seed + 5.0) * 1.5, -5.2);
    lDir = normalize(vec3(0.0, 0.0, 1.0) - lightPos);
    lU = normalize(cross(lDir, vec3(0.0, 1.0, 0.0)));
    lV = cross(lU, lDir);

    // The camera: wide, or a crop right on the form.
    float closeUp = step(0.55, H(seed + 6.0));
    float camYaw = (H(seed + 7.0) - 0.5) * 1.0 + sin(tt * 0.1) * 0.03;
    float camPit = (H(seed + 8.0) - 0.5) * 0.5;
    float dist = closeUp > 0.5 ? mix(2.7, 3.6, H(seed + 9.0)) : mix(5.0, 6.4, H(seed + 9.0));
    dist *= shape >= 2 ? 0.72 : 1.0;
    dist -= inShot * 0.006 * (closeUp > 0.5 ? 1.0 : 2.0);
    vec3 ro = vec3(sin(camYaw) * cos(camPit), sin(camPit), -cos(camYaw) * cos(camPit)) * dist;
    vec3 ta = closeUp > 0.5 ? (vec3(H(seed + 10.0), H(seed + 11.0), 0.0) - 0.5) * vec3(1.2, 1.5, 0.0) : vec3(0.0);
    vec3 fw = normalize(ta - ro);
    vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
    vec3 up = cross(fw, rt);
    vec2 cp = rot(p, (H(seed + 12.0) - 0.5) * 0.18);
    vec3 rd = normalize(rt * cp.x + up * cp.y + fw * 1.9);

    // March.
    float t = 0.0, hitD = 0.0;
    bool hit = false;
    for (int i = 0; i < steps; i++) {
        hitD = sceneD(ro + rd * t);
        if (hitD < 0.0012 * max(t, 1.0)) { hit = true; break; }
        t += hitD;
        if (t > 24.0) break;
    }

    float v = 0.0;
    if (hit) {
        vec3 pos = ro + rd * t;
        bool onWall = wallD(pos) < sculpture(pos);
        vec3 n = normalAt(pos);
        vec3 ld = normalize(lightPos - pos);
        float dif = max(dot(n, ld), 0.0);
        float sh = dif > 0.001 ? shadowTo(pos, n) : 0.0;
        float lit = dif * sh * gobo(pos);
        float albedo = onWall ? 0.5 + 0.1 * fbm(pos.xy * 2.2, 3) : 0.98;
        float rim = onWall ? 0.0 : pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * 0.08;
        float amb = (onWall ? 0.012 : 0.03) * (0.5 + 0.5 * n.y);
        v = albedo * (lit * 1.5 + amb) + rim;
    }

    // Beams of light in the smoke.
    if (smoke > 0.01) {
        float tEnd = hit ? min(t, 10.0) : 10.0;
        float acc = 0.0;
        float jit = hash21(w * 311.0 + fm * 0.13);
        for (int i = 0; i < 8; i++) {
            float ts = tEnd * (float(i) + jit) / 8.0;
            acc += gobo(ro + rd * ts);
        }
        acc /= 8.0;
        float haze = fbm(p * 1.7 + vec2(tt * 0.05, -tt * 0.09), 4);
        v += acc * pow(max(haze, 0.0), 1.6) * smoke * 0.75;
    }

    v *= flick;

    // Film response: deep blacks, a hard shoulder.
    v = v / (1.0 + v * 0.25);
    v = sm(0.015, 0.8, v);

    float aspectNow = aspect();
    vec2 c = to_centered(w);
    v *= max(1.0 - 0.1 * dot(c, c) - 0.02 * dot(c, c) * dot(c, c), 0.0);

    // Some shots go to a print screen.
    if (H(seed + 13.0) < press) {
        vec2 sp = rot(w * vec2(aspectNow, 1.0), 0.785) * 150.0;
        float screen = 0.14 + 0.86 * (0.5 + 0.5 * cos(sp.x * 2.0 * PI) * cos(sp.y * 2.0 * PI));
        v = sm(screen - 0.07, screen + 0.07, pow(v, 0.8));
    } else {
        // Grain, heavier in the middle tones.
        float nz = hash21(floor(w * u_world_resolution / max(1.0, 1.5 * u_scale)) + fm * 1.37);
        v += (nz - 0.5) * grain * 0.22 * (0.2 + 1.6 * v * (1.0 - v) + 0.2 * step(v, 0.02) * 0.2);
    }

    // Dust and a rare scratch.
    float dust = step(0.99985, hash21(floor(w * vec2(480.0, 270.0)) + fm * 3.1));
    v = max(v, dust * 0.7 * step(0.7, H(fm)));
    float scrX = H(floor(frameN / 5.0) + 3.0);
    if (H(floor(frameN / 5.0) + 9.0) > 0.86) {
        v = mix(v, 0.85, (1.0 - sm(0.0, 0.0009, abs(w.x - scrX))) * 0.5);
    }

    // A negative for a few frames at every 4th cut, or on pad 2.
    float neg = (mod(cutN, 4.0) < 0.5 && inShot < 0.22) ? 1.0 : 0.0;
    neg = max(neg, step(0.55, u_triggers.y * react));
    v = clamp(v, 0.0, 1.0);
    if (neg > 0.5) v = 1.0 - v;
    if (invert) v = 1.0 - v;

    f_color = vec4(vec3(v), 1.0);
}
