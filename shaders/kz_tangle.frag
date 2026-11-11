#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Kyoki: a lopsided 3D knot made only of lines — the curves where two warped
// gyroid fields both cross zero, kept inside a lumpy envelope that throws
// tendrils out to one side. It writhes, freezes, snaps to new poses, its lines
// boil at 12 fps and it tears / flashes now and then (`madness`).
// White lines on black, for a palette node after it. Free-running unless `react`.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;    // 0..4 = 1
    float density;  // 1..6 = 2.6       strands (field frequency)
    float width;    // 0.5..6 = 1.4     line width, px
    float glow;     // 0..2 = 0.6
    float madness;  // 0..1 = 0.6       stutters, snaps, boil, spasms, tears
    float reach;    // 0..1 = 0.6       lopsided tendrils
    float zoom;     // 0.5..2 = 1
    float react;    // 0..1 = 0         beat / hits drive the spasms (0 = free-running)
    int   quality;  // low|mid|high = mid
};

float h1(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
vec3  h3(float x) { return vec3(h1(x), h1(x + 17.3), h1(x + 41.9)); }

mat3 axis_rot(vec3 a, float t) {
    a = normalize(a);
    float c = cos(t), s = sin(t), k = 1.0 - c;
    return mat3(c + a.x * a.x * k,       a.y * a.x * k + a.z * s, a.z * a.x * k - a.y * s,
                a.x * a.y * k - a.z * s, c + a.y * a.y * k,       a.z * a.y * k + a.x * s,
                a.x * a.z * k + a.y * s, a.y * a.z * k - a.x * s, c + a.z * a.z * k);
}

// per-frame state
float T;          // stuttering time
mat3  M_pose;     // object orientation (snaps)
mat3  M_b;        // second lattice's turn
vec3  g_boil;     // 12 fps jitter of the fields
float g_spasm;    // 0..1 convulsion
vec3  g_axis;     // tendril direction
vec3  g_center;
float g_rmax;

// x: distance to the line set, y: envelope (< 0 inside)
vec2 field(vec3 p) {
    vec3 q = M_pose * (p - g_center);
    vec3 o = q;
    // writhing warp, stronger in a spasm
    float wa = 0.3 + g_spasm * 0.35;
    q += wa * sin(q.yzx * 1.7 + vec3(T * 0.9, T * 1.13 + 1.0, T * 0.71 + 2.0));
    q += g_boil;
    float D = density;
    vec3 a = q * D;
    float f1 = dot(sin(a), cos(a.yzx));
    vec3 b = (M_b * q + vec3(0.7, 1.9, T * 0.2)) * (D * 1.31);
    float f2 = dot(sin(b), cos(b.zxy));
    float c = length(vec2(f1, f2 / 1.31)) / (D * 1.9);
    // lumpy envelope reaching out along g_axis
    float r = length(o);
    float along = max(dot(o, g_axis) / max(r, 1e-3), 0.0);
    float R = 0.95 + reach * 1.3 * along * along * along
            + 0.18 * sin(o.x * 2.3 + T * 0.6) * sin(o.y * 1.9 - T * 0.4) * sin(o.z * 2.1 + 1.0);
    return vec2(c, r - R);
}

void main() {
    vec2 w = world_uv(v_uv);
    if (w.x < 0.0) { f_color = vec4(0.0, 0.0, 0.0, 1.0); return; }
    float pxu = 2.0 / u_world_resolution.y;            // one pixel, centred units
    float t = u_time * speed;
    float m = madness;
    float kick = react * max(max(u_beat, u_hits.y), u_triggers.x);

    // stutter: some 0.4 s chunks freeze on their first frame
    float ch = floor(t / 0.4);
    float frozen = step(1.0 - m * 0.3, h1(ch * 1.37));
    T = mix(t, ch * 0.4, frozen);
    // pose: a slow tumble plus snaps to a new orientation every ~2 s
    float sn = floor(t * 0.47 + h1(floor(t * 0.47)) * 0.5);
    vec3 snap = (h3(sn) - 0.5) * 3.0 * m;
    M_pose = axis_rot(vec3(0.3, 1.0, 0.2) + snap.yzx * 0.3, T * 0.23 + snap.x)
           * axis_rot(vec3(1.0, 0.1, 0.4), T * 0.17 + snap.y);
    M_b = axis_rot(vec3(0.6, 0.3, 1.0), 0.9 + T * 0.05);
    g_boil = (h3(floor(u_time * 12.0)) - 0.5) * 0.05 * m;
    g_spasm = clamp(pow(h1(floor(t * 1.7) + 9.0), 5.0) * m * 2.0 + kick, 0.0, 1.0);
    g_axis = normalize(vec3(0.8 + 0.3 * sin(T * 0.11), -0.35 + 0.4 * sin(T * 0.07 + 2.0), 0.3));
    g_center = vec3(-0.25 + 0.12 * sin(T * 0.13), 0.08 * sin(T * 0.19), 0.0)
             + (h3(sn + 3.0) - 0.5) * vec3(0.3, 0.2, 0.0) * m;
    g_rmax = 1.2 + reach * 1.3 + 0.3 * g_spasm;

    vec2 p = to_centered(w);
    // horizontal tears
    float tear = m * step(0.86, h1(floor(u_time * 6.0) + 5.0));
    p.x += (h1(floor(p.y * 18.0) + floor(u_time * 15.0)) - 0.5) * 0.18 * tear;
    p /= zoom;

    vec3 ro = vec3(0.0, 0.0, -4.2);
    vec3 rd = normalize(vec3(p, 2.0));
    // bounding sphere of the envelope (around g_center)
    vec3 oc = ro - g_center;
    float bq = dot(oc, rd), cq = dot(oc, oc) - g_rmax * g_rmax;
    float disc = bq * bq - cq;
    float core = 0.0, halo = 0.0;
    if (disc > 0.0) {
        float sq = sqrt(disc);
        float d0 = max(-bq - sq, 0.0), d1 = -bq + sq;
        int steps = quality == 0 ? 56 : (quality == 1 ? 90 : 140);
        float dist = d0;
        float lw0 = width * u_scale * pxu / 2.0;        // line half-width per unit depth
        for (int i = 0; i < 140; i++) {
            if (i >= steps || dist > d1) break;
            vec3 pos = ro + rd * dist;
            vec2 f = field(pos);
            float lw = lw0 * dist;
            float inside = smoothstep(0.0, -0.3, f.y);
            float depth = mix(1.0, 0.3, clamp((dist - d0) / max(d1 - d0, 1e-3), 0.0, 1.0));
            core += inside * depth * smoothstep(lw * 1.6, lw * 0.4, f.x);
            halo += inside * depth * exp(-f.x / (lw * 10.0)) * 0.06;
            // stay on the lines while inside, skip the envelope's outside fast
            float dd = max(f.x, f.y);
            dist += max(dd * 0.7, lw * 0.6);
        }
    }
    float v = clamp(core, 0.0, 1.0) + halo * glow * (1.0 + g_spasm);
    v = clamp(v, 0.0, 1.0);
    // a rare inverted frame
    if (h1(floor(u_time * 8.0) + 77.0) > 1.0 - m * 0.035) v = 1.0 - v;
    f_color = vec4(vec3(v), 1.0);
}
