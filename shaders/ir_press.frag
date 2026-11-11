#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// A stamping plant: rows of hydraulic presses slamming on 8th notes under one hard
// light, with a red alarm beacon sweeping the hall. This is data for ir_stamp, so
// the picture can only ever be black, white and red:
// R = white light, G = red (beacon and paint), B = white heat at the impacts.
// Camera cuts every `every` beats. Kick (pad 1) shakes the hall, snare (pad 2)
// raises the alarm.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   every;   // 1..64 = 8       beats per shot
    float travel;  // 0.2..2.4 = 1.7  how far the presses drop
    float drift;   // 0..2 = 0.35     camera travelling along the line
    float shake;   // 0..1 = 0.4      kick shaking the hall
    float alarm;   // 0..3 = 1        beacon strength
    float heat;    // 0..3 = 1        white heat at the impacts
    float haze;    // 0..0.5 = 0.045  how fast the hall falls into black
};

const float TOP = 4.4;
const vec2  CELL = vec2(2.4, 3.2);
int g_part;

float box_d(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// 1 = up, 0 = down. `imp` jumps to 1 as it lands, then fades.
float stroke_at(vec2 id, out float imp) {
    float h = hash21(id * 0.73 + 1.7);
    float off = floor(h * 8.0) * 0.5;
    float len = hash21(id * 1.31 + 4.1) < 0.5 ? 4.0 : 8.0;
    float x = mod(u_beats + off, len);
    imp = x > 0.1 ? exp(-(x - 0.1) * 7.0) : 0.0;
    if (x < 0.1) return 1.0 - (x / 0.1) * (x / 0.1);
    if (x < 0.4) return 0.0;
    return smoothstep(0.4, 2.8, x);
}

float scene_d(vec3 p) {
    vec2 id = round(p.xz / CELL);
    id.y = clamp(id.y, -3.0, 3.0);
    vec3 q = p;
    q.xz -= id * CELL;

    float imp;
    float cy = 0.42 + stroke_at(id, imp) * travel;

    float d = p.y;
    g_part = 0;
    float e = box_d(q - vec3(0.0, 0.06, 0.0), vec3(0.85, 0.06, 0.85));
    if (e < d) { d = e; g_part = 1; }
    e = box_d(q - vec3(0.0, cy, 0.0), vec3(0.62, 0.28, 0.62)) - 0.02;
    if (e < d) { d = e; g_part = 2; }
    e = box_d(q - vec3(0.0, cy + 0.4, 0.0), vec3(0.34, 0.1, 0.34));
    if (e < d) { d = e; g_part = 3; }
    float rad = length(q.xz);
    float mid = (cy + TOP) * 0.5;
    e = max(rad - 0.13, abs(q.y - mid) - (TOP - cy) * 0.5);
    if (e < d) { d = e; g_part = 4; }
    e = max(rad - 0.25, abs(q.y - (TOP - 0.55)) - 0.55);
    if (e < d) { d = e; g_part = 3; }
    e = box_d(vec3(0.0, q.y - TOP - 0.14, q.z), vec3(1.0, 0.14, 0.34));
    if (e < d) { d = e; g_part = 3; }
    return d;
}

vec3 normal_at(vec3 p) {
    vec2 e = vec2(0.002, -0.002);
    return normalize(e.xyy * scene_d(p + e.xyy) + e.yyx * scene_d(p + e.yyx)
                   + e.yxy * scene_d(p + e.yxy) + e.xxx * scene_d(p + e.xxx));
}

void main() {
    vec2 p = to_centered(world_uv(v_uv));
    float kick = u_triggers.x * u_triggers.x;
    float snare = u_triggers.y * u_triggers.y;

    // The hall shakes on the kick.
    vec2 sh = (hash22(vec2(floor(u_beats * 16.0), 3.0)) - 0.5) * kick * shake * 0.09;
    p += sh;

    float shot = floor(u_beats / float(every));
    int si = int(mod(shot, 4.0));
    float along = u_time * drift + hash21(vec2(shot, 2.0)) * 40.0;
    vec3 ro, ta;
    float fov, roll = 0.0;
    if (si == 0)      { ro = vec3(along, 1.9, -11.0);       ta = vec3(along, 1.9, 0.0);        fov = 3.6; }
    else if (si == 1) { ro = vec3(along - 6.5, 0.55, -4.4); ta = vec3(along, 2.0, 2.2);        fov = 1.25; roll = 0.14; }
    else if (si == 2) { ro = vec3(along, 13.0, 0.0);        ta = vec3(along + 0.01, 0.0, 0.2); fov = 3.0; roll = 0.5; }
    else {
        // Right up against one press.
        float cx = round(along / CELL.x) * CELL.x;
        ro = vec3(cx + 1.9, 0.75, -2.3); ta = vec3(cx, 1.0, 0.0); fov = 1.5; roll = -0.2;
    }

    vec3 fw = normalize(ta - ro);
    vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.001), fw));
    vec3 up = cross(fw, rt);
    float cr = cos(roll), sr = sin(roll);
    vec3 rd = normalize(p.x * (rt * cr + up * sr) + p.y * (up * cr - rt * sr) + fov * fw);

    float t = 0.0;
    bool hit = false;
    for (int i = 0; i < 90; i++) {
        float d = scene_d(ro + rd * t);
        if (d < 0.0012 * (1.0 + t * 0.2)) { hit = true; break; }
        t += d * 0.9;
        if (t > 34.0) break;
    }

    vec3 res = vec3(0.0);
    if (hit) {
        vec3 pos = ro + rd * t;
        vec3 n = normal_at(pos);
        scene_d(pos);
        int part = g_part;

        vec2 id = round(pos.xz / CELL);
        id.y = clamp(id.y, -3.0, 3.0);
        vec3 q = pos;
        q.xz -= id * CELL;
        float imp;
        float cy = 0.42 + stroke_at(id, imp) * travel;

        // One hard light from above, and shadows with an edge.
        vec3 l = normalize(vec3(-0.45, 0.95, -0.55));
        float sh2 = 1.0;
        float st = 0.03;
        for (int i = 0; i < 22; i++) {
            float d = scene_d(pos + n * 0.006 + l * st);
            if (d < 0.001) { sh2 = 0.0; break; }
            sh2 = min(sh2, 16.0 * d / st);
            st += clamp(d, 0.03, 0.5);
            if (st > 7.0) break;
        }
        float diff = max(dot(n, l), 0.0) * sh2;
        float spec = pow(max(dot(reflect(rd, n), l), 0.0), 36.0) * sh2;

        // Surfaces.
        float grime = fbm(pos.xz * 1.3 + pos.y * 2.1, 3);
        float brushed = 0.82 + 0.3 * noise2(vec2(pos.x * 3.0 + pos.z * 3.0, pos.y * 70.0));
        float alb = 0.42 * brushed * mix(0.5, 1.1, grime);
        float paint = 0.0;
        float emit = 0.0;

        float cheb = max(abs(q.x), abs(q.z));
        if (part == 0) {
            // Floor: dark plate, hazard stripes around each anvil.
            alb = 0.12 * mix(0.5, 1.2, grime);
            if (cheb < 1.12 && cheb > 0.9) {
                float stripe = step(0.5, fract((q.x + q.z) * 2.6));
                alb = stripe * 0.75;
            }
            float r = length(q.xz);
            emit += imp * exp(-r * 1.8) * 0.7;
        } else if (part == 1) {
            alb = 0.34 * brushed;
            emit += imp * smoothstep(0.65, 0.5, cheb) * 1.5;
        } else if (part == 2) {
            // Heads: a stripe band, bolts, and a red band on one head in four.
            float yy = q.y - cy;
            float side = abs(n.y) < 0.5 ? 1.0 : 0.0;
            float hsel = hash21(id * 2.3 + 0.7);
            if (side > 0.5 && abs(yy) < 0.13) {
                float s = step(0.5, fract((q.x + q.z + yy) * 3.2));
                if (hsel < 0.28) { paint = s; alb = s > 0.5 ? 0.0 : 0.05; }
                else             { alb = s * 0.85 + 0.03; }
            }
            vec2 bp = vec2(max(abs(q.x), abs(q.z)), abs(yy));
            if (side > 0.5) {
                float along_side = abs(n.x) > 0.5 ? q.z : q.x;
                float b = length(vec2(abs(along_side) - 0.47, abs(yy) - 0.21));
                if (b < 0.035) alb = 0.72;
            }
            // Bottom of the head glows as it lands.
            emit += imp * smoothstep(-0.2, -0.3, yy) * 2.0;
        } else if (part == 4) {
            // Rods are polished: mostly the highlight.
            alb = 0.25;
            spec *= 2.5;
        } else {
            alb = 0.2 * brushed * mix(0.6, 1.1, grime);
        }

        // A cold back light picks the silhouettes out of the black.
        float rimv = pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * max(dot(n, normalize(vec3(0.5, 0.5, 0.8))), 0.0);
        float white = (alb * (0.05 + diff * 2.3) + spec * 0.8 + rimv * 0.5) * (1.0 - paint);
        float red = paint * (0.16 + diff * 1.3);

        // Beacon: red light going round the hall, once a bar.
        float a = u_beats * 1.5708;
        vec3 rd2 = normalize(vec3(cos(a), 0.12, sin(a)));
        float swing = pow(max(dot(n, rd2), 0.0), 2.0);
        red += (alb + paint * 0.3) * swing * (0.55 + 2.4 * snare) * alarm;

        float fog = exp(-t * haze);
        res = vec3(white * fog, red * fog, emit * heat * fog);
    }

    f_color = vec4(res, 1.0);
}
