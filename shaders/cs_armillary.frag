#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// A total eclipse held inside a chrome armillary: a black sphere with a corona and
// a diamond-ring flare, circled by six ribbon rings that reflect the sky (in0).
// Rings snap to new angles on the beat. Over `gather` beats before each 16-beat
// mark they collapse flat into a Saturn disc, then burst open.
// Camera cuts every `every` beats. Kick (pad 1): shock ring, corona. Snare (pad 2):
// ring lights flash. Accent (pad 4): diamond flare.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   every;   // 1..64 = 8       beats per shot
    float gather;  // 0..15 = 3.5     beats the rings take to collapse (0 = never)
    float turn;    // 0..1 = 1        ring snapping on the beat
    float spin;    // 0..2 = 0.3      ring spin
    float radius;  // 0.2..1 = 0.62   the black sphere
    float corona;  // 0..3 = 1        corona brightness
    float shock;   // 0..3 = 1        kick shock ring
    float lights;  // 0..3 = 1        running lights on the rings
    float chrome;  // 0..3 = 1.2      sky reflected in the rings
    float streak;  // 0..3 = 1        anamorphic streak off the diamond
    vec4  hot;     // color = 0.35,0.92,1.0
    vec4  warm;    // color = 0.95,0.16,0.72
    vec4  sun;     // color = 1.0,0.82,0.55
};

const int RINGS = 6;
mat3 g_rot[6];
int  g_id;

mat3 rot_x(float a) { float c = cos(a), s = sin(a); return mat3(1, 0, 0, 0, c, s, 0, -s, c); }
mat3 rot_y(float a) { float c = cos(a), s = sin(a); return mat3(c, 0, -s, 0, 1, 0, s, 0, c); }
mat3 rot_z(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0, -s, c, 0, 0, 0, 1); }

float ring_radius(int i) { return radius + 0.32 + float(i) * 0.21; }

float ring_d(vec3 p, int i) {
    float fi = float(i);
    vec3 q = g_rot[i] * p;
    float rad = length(q.xz);
    float wd = 0.014 + 0.062 * fract(fi * 0.618 + 0.2);
    vec2 e = abs(vec2(rad - ring_radius(i), q.y)) - vec2(wd, 0.007);
    float d = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - 0.003;
    // Some rings are broken into arcs.
    if (i % 3 != 0) {
        float k = float(2 + i);
        float a = atan(q.z, q.x);
        float m = abs(fract(a * k / 6.28318) - 0.5) * 6.28318 / k * rad;
        d = max(d, 0.1 + 0.05 * fi - m);
    }
    return d;
}

float scene_d(vec3 p) {
    float d = length(p) - radius;
    g_id = -1;
    for (int i = 0; i < RINGS; i++) {
        float r = ring_d(p, i);
        if (r < d) { d = r; g_id = i; }
    }
    return d;
}

vec3 normal_at(vec3 p) {
    vec2 e = vec2(0.0015, -0.0015);
    return normalize(e.xyy * scene_d(p + e.xyy) + e.yyx * scene_d(p + e.yyx)
                   + e.yxy * scene_d(p + e.yxy) + e.xxx * scene_d(p + e.xxx));
}

// The sky as an environment, folded so there's no seam.
vec3 env(vec3 r) {
    vec2 u = vec2(atan(r.z, r.x) / 6.28318 + 0.5, asin(clamp(r.y, -1.0, 1.0)) / 3.14159 + 0.5);
    u.x = abs(u.x * 2.0 - 1.0);
    return sample_world(u_tex0, u).rgb;
}

void main() {
    vec2 w = world_uv(v_uv);
    vec2 p = to_centered(w);

    float kick = u_triggers.x;
    float snare = u_triggers.y;
    float accent = u_triggers.w;
    float shot = floor(u_beats / float(every));
    float t = u_time;

    // Collapse towards each 16-beat mark.
    float cyc = mod(u_beats, 16.0);
    float flat_ = gather > 0.01 ? smoothstep(16.0 - gather - 0.25, 15.75, cyc) : 0.0;

    for (int i = 0; i < RINGS; i++) {
        float fi = float(i);
        float dv = i < 2 ? 1.0 : (i < 4 ? 2.0 : 4.0);
        float sg = i % 2 == 0 ? 1.0 : -1.0;
        float b = u_beats / dv;
        float stepped = floor(b) + smoothstep(0.0, 0.42, fract(b));
        float snap = stepped * 1.5708 * sg * turn;
        float tilt = 0.45 + fi * 0.52;
        g_rot[i] = rot_y(t * spin * sg * (0.5 + 0.15 * fi) + fi * 1.9)
                 * rot_x(snap * (1.0 - flat_))
                 * rot_z(tilt * (1.0 - flat_));
    }

    // Shots.
    int si = int(mod(shot, 4.0));
    float yaw = hash21(vec2(shot, 1.0)) * 6.283 + t * 0.06;
    float pitch, dist, fov, roll;
    vec3 target = vec3(0.0);
    if (si == 0)      { pitch = 0.2;   dist = 5.6; fov = 2.1;  roll = 0.0; }
    else if (si == 1) { pitch = 0.42;  dist = 3.9; fov = 2.7;  roll = -0.22; target = vec3(0.65, -0.3, 0.0); }
    else if (si == 2) { pitch = -0.14; dist = 3.0; fov = 1.15; roll = 0.38;  target = vec3(0.0, 0.32, 0.0); }
    else              { pitch = 1.22;  dist = 5.2; fov = 2.0;  roll = 0.0; }

    vec3 ro = vec3(cos(yaw) * cos(pitch), sin(pitch), sin(yaw) * cos(pitch)) * dist;
    vec3 fw = normalize(target - ro);
    vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
    vec3 up = cross(fw, rt);
    float cr = cos(roll), sr = sin(roll);
    vec3 rt2 = rt * cr + up * sr;
    vec3 up2 = up * cr - rt * sr;
    vec3 rd = normalize(p.x * rt2 + p.y * up2 + fov * (1.0 + 0.07 * kick * kick) * fw);

    // Where the diamond sits on the limb, and the sun behind the sphere.
    float da = shot * 2.399 + t * 0.05;
    vec3 tang = normalize(rt2 * cos(da) + up2 * sin(da));
    vec3 sundir = normalize(-normalize(ro) + tang * 0.2);

    // Closest approach to the sphere: lensing and corona come from this.
    float tc = -dot(ro, rd);
    vec3 cp = ro + rd * tc;
    float b = length(cp);
    float h = max(b - radius, 0.0);
    vec3 nn = cp / max(b, 1e-4);
    vec2 limb = vec2(dot(nn, rt2), dot(nn, up2));

    // Background, pulled slightly around the sphere.
    vec2 bend = limb * 0.016 / (h + 0.14);
    bend.x /= aspect();
    vec3 col = sample_world(u_tex0, w - vec2(bend.x, -bend.y)).rgb;

    // Corona.
    float tq = t * 0.09;
    float st = fbm(limb * 3.0 + tq, 4);
    float st2 = fbm(limb * 9.0 - tq * 1.7 + 4.0, 3);
    float amp = (0.35 + 1.5 * st * st + 0.6 * st2) * (1.0 + 1.3 * kick * kick);
    vec3 cc = mix(warm.rgb, hot.rgb, exp(-h * 7.0));
    vec3 glow = cc * amp * exp(-h * 3.2) * 0.55 + vec3(1.0) * exp(-h * 70.0) * 0.8;
    float dr = pow(max(dot(nn, tang), 0.0), 42.0);
    glow += sun.rgb * dr * (exp(-h * 26.0) * 5.0 + exp(-h * 5.0) * 0.5) * (1.0 + 2.5 * accent * accent);
    glow *= corona;

    // March only inside the rings' bounding sphere.
    float rb = ring_radius(RINGS - 1) + 0.12;
    float disc = tc * tc - (dot(ro, ro) - rb * rb);
    bool hit = false;
    float tr = 1e5;
    float sum_glow = 0.0;
    if (disc > 0.0) {
        float sq = sqrt(disc);
        float tn = max(tc - sq, 0.0);
        float tf = tc + sq;
        float tm = tn;
        for (int i = 0; i < 64; i++) {
            float d = scene_d(ro + rd * tm);
            sum_glow += exp(-max(d, 0.0) * 34.0);
            if (d < 0.0009) { hit = true; tr = tm; break; }
            tm += d * 0.82;
            if (tm > tf) break;
        }
    }

    if (hit) {
        vec3 pos = ro + rd * tr;
        scene_d(pos);
        int id = g_id;
        vec3 n = normal_at(pos);
        float nv = max(dot(n, -rd), 0.0);
        if (id < 0) {
            // The black sphere: nearly nothing, a thread of light at the edge.
            col = warm.rgb * pow(1.0 - nv, 7.0) * 0.5 + hot.rgb * pow(1.0 - nv, 22.0) * 0.8;
        } else {
            vec3 r = reflect(rd, n);
            float fres = pow(1.0 - nv, 4.0);
            vec3 e = env(r);
            vec3 metal = e * chrome * (0.45 + 1.6 * fres) + vec3(0.012, 0.014, 0.03);
            float sp = pow(max(dot(r, sundir), 0.0), 70.0);
            metal += sun.rgb * sp * 3.0;
            metal += hot.rgb * pow(max(dot(r, normalize(sundir + rt2 * 0.7)), 0.0), 18.0) * 0.4;

            // Running lights in the ribbon.
            float fi = float(id);
            vec3 q = g_rot[id] * pos;
            float a = atan(q.z, q.x) / 6.28318;
            float wd = 0.014 + 0.062 * fract(fi * 0.618 + 0.2);
            float strip = 1.0 - smoothstep(wd * 0.1, wd * 0.2, abs(length(q.xz) - ring_radius(id)));
            float sg = id % 2 == 0 ? 1.0 : -1.0;
            float run = pow(fract(a * (1.0 + mod(fi, 3.0)) - sg * u_beats * 0.5), 6.0);
            vec3 lc = mix(hot.rgb, warm.rgb, fi / float(RINGS - 1));
            metal += lc * strip * (run * 3.0 + 0.1 + 2.2 * snare * snare) * lights;
            col = metal;
        }
    } else {
        col += glow;
    }

    // Thin halo around the rings where rays pass close (the sphere stays black).
    vec3 hc = mix(hot.rgb, warm.rgb, 0.5 + 0.5 * sin(u_beats * 0.39));
    bool on_sphere = hit && length(ro + rd * tr) < radius + 0.01;
    if (!on_sphere) col += hc * sum_glow * 0.009 * (1.0 + 2.0 * snare * snare) * lights;

    // Anamorphic streak off the diamond: one clean horizontal line across the lens.
    vec3 dpos = tang * radius - ro;
    float dz = dot(dpos, fw);
    vec2 ds = vec2(dot(dpos, rt2), dot(dpos, up2)) / dz * fov;
    float line = exp(-abs(p.y - ds.y) * 110.0) + 0.3 * exp(-abs(p.y - ds.y) * 22.0);
    col += mix(hot.rgb, vec3(1.0), 0.3) * line * exp(-abs(p.x - ds.x) * 0.9)
         * streak * (0.35 + 1.8 * accent * accent + 0.5 * kick * kick);

    // Kick: a shock ring leaving the sphere across the equator.
    if (abs(rd.y) > 1e-4) {
        float tp = -ro.y / rd.y;
        if (tp > 0.0 && (!hit || tp < tr)) {
            vec3 gp = ro + rd * tp;
            float rr = length(gp.xz);
            float rs = radius + 0.1 + (1.0 - kick) * 3.4;
            float wave = exp(-abs(rr - rs) * 26.0) + 0.25 * exp(-max(rs - rr, 0.0) * 4.0) * step(rr, rs);
            col += mix(warm.rgb, hot.rgb, kick) * wave * kick * kick * shock * step(radius, rr);
        }
    }

    f_color = vec4(col, 1.0);
}
