#version 450
#include "util/common.glsl"
#include "util/uv.glsl"

// A sculpture for the print chain, not a picture: R = tone (0 shadow .. 1 lit),
// G = silhouette, B = rim. rs_sep turns these into ink separations.
// The form changes every `every` beats, kicks (pad 1) punch it.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;   // 0..2 = 0.35      turning speed
    float zoom;    // 0.5..3 = 1.9     lens
    int   every;   // 1..64 = 16       beats per form
    float morph;   // 0.25..8 = 1.5    beats a change of form takes
    float punch;   // 0..1 = 0.3       how much a kick grows it
    float lurch;   // 0..2 = 0.6       turn jumping on every beat
};

mat2 rot2(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float box_d(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Slabs stacked on a twist.
float sd_spire(vec3 p, float t) {
    p.xz = rot2(p.y * 1.5 + t * 0.3) * p.xz;
    const float c = 0.2;
    float id = clamp(round(p.y / c), -6.0, 6.0);
    float r = 0.28 + 0.62 * (0.5 + 0.5 * cos(id * 0.75 + t * 0.6));
    return box_d(vec3(p.x, p.y - id * c, p.z), vec3(r, c * 0.3, r * 0.6)) - 0.015;
}

// A ball carved by a gyroid.
float sd_gyro(vec3 p, float t) {
    vec3 q = p * 4.6 + vec3(0.0, t * 0.4, 0.0);
    float g = abs(dot(sin(q), cos(q.zxy))) / 4.6 - 0.04;
    return max(length(p) - 1.2, g);
}

// Balls on orbits, melting together.
float sd_blobs(vec3 p, float t) {
    float d = length(p) - 0.42;
    for (int i = 0; i < 5; i++) {
        float f = float(i);
        vec3 c = vec3(sin(t * 0.7 + f * 2.1), cos(t * 0.53 + f * 1.3), sin(t * 0.41 + f * 3.7)) * 0.85;
        d = smin(d, length(p - c) - 0.2 - 0.1 * fract(f * 0.37), 0.34);
    }
    return d;
}

// A flat band twisted around a ring.
float sd_band(vec3 p, float t) {
    float a = atan(p.z, p.x);
    vec2 q = vec2(length(p.xz) - 0.86, p.y);
    q = rot2(a * 1.5 + t * 0.5) * q;
    vec2 e = abs(q) - vec2(0.36, 0.05);
    return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - 0.012;
}

float pick(int i, vec3 p, float t) {
    if (i == 0) return sd_spire(p, t);
    if (i == 1) return sd_gyro(p, t);
    if (i == 2) return sd_blobs(p, t);
    return sd_band(p, t);
}

float g_blend;
int g_a, g_b;
float g_size;
mat3 g_view;

float scene_d(vec3 p) {
    vec3 q = g_view * p / g_size;
    float t = u_time * speed;
    float d = g_blend < 0.001 ? pick(g_a, q, t)
            : g_blend > 0.999 ? pick(g_b, q, t)
            : mix(pick(g_a, q, t), pick(g_b, q, t), g_blend);
    return d * g_size;
}

vec3 normal_at(vec3 p) {
    vec2 e = vec2(0.002, -0.002);
    return normalize(e.xyy * scene_d(p + e.xyy) + e.yyx * scene_d(p + e.yyx)
                   + e.yxy * scene_d(p + e.yxy) + e.xxx * scene_d(p + e.xxx));
}

void main() {
    vec2 p = to_centered(world_uv(v_uv));

    float sect = floor(u_beats / float(every));
    float into = (u_beats - sect * float(every)) / morph;
    g_blend = smoothstep(0.0, 1.0, clamp(into, 0.0, 1.0));
    g_a = int(mod(sect - 1.0, 4.0));
    g_b = int(mod(sect, 4.0));

    float kick = u_triggers.x * u_triggers.x;
    g_size = 1.0 + punch * kick;

    // Slow turn, plus a short lurch on every beat.
    float stepped = floor(u_beats) + smoothstep(0.0, 0.35, fract(u_beats));
    float yaw = u_time * speed * 0.6 + stepped * lurch * 0.25;
    float pitch = 0.45 + 0.3 * sin(u_time * speed * 0.31);
    mat2 ry = rot2(yaw), rx = rot2(pitch);
    g_view = mat3(ry[0][0], 0.0, ry[0][1],
                  0.0,      1.0, 0.0,
                  ry[1][0], 0.0, ry[1][1])
           * mat3(1.0, 0.0,      0.0,
                  0.0, rx[0][0], rx[0][1],
                  0.0, rx[1][0], rx[1][1]);

    vec3 ro = vec3(0.0, 0.0, -3.6);
    vec3 rd = normalize(vec3(p, zoom * 1.5));

    float t = 2.0;
    float hit = 0.0;
    for (int i = 0; i < 72; i++) {
        float d = scene_d(ro + rd * t);
        if (d < 0.0012) { hit = 1.0; break; }
        t += d * 0.72;
        if (t > 6.0) break;
    }

    vec3 out_col = vec3(0.0);
    if (hit > 0.5) {
        vec3 pos = ro + rd * t;
        vec3 n = normal_at(pos);
        vec3 l = normalize(vec3(-0.55, 0.75, -0.5));

        // Hard cast shadow: this ends up as dots, so it should have an edge.
        float sh = 1.0;
        float st = 0.03;
        for (int i = 0; i < 18; i++) {
            float d = scene_d(pos + n * 0.006 + l * st);
            sh = min(sh, 9.0 * d / st);
            st += clamp(d, 0.02, 0.25);
            if (sh < 0.01 || st > 2.5) break;
        }
        sh = clamp(sh, 0.0, 1.0);

        float ao = clamp(scene_d(pos + n * 0.12) / 0.12, 0.0, 1.0);
        float diff = max(dot(n, l), 0.0);
        float tone = (0.08 + 0.92 * diff * sh) * mix(0.55, 1.0, ao);
        float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        out_col = vec3(clamp(tone, 0.0, 1.0), 1.0, rim);
    }
    f_color = vec4(out_col, 1.0);
}
