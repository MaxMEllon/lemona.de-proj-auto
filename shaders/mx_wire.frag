#version 450
#include "util/common.glsl"
#include "util/uv.glsl"

// Mono techno: a white wireframe tesseract (4D hypercube) turning in black
// space. Its rotation jolts forward on every beat; every bar it switches the
// 4D rotation planes; snare (pad 2 / mid hit) splits off a ghost copy, hats
// (pad 3 / high hit) light the vertices, kick (pad 1 / low hit) punches the
// scale. Chain into Feedback for trails.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float size;      // 0.2..2 = 0.6 
    float spin;      // 0..2 = 0.6       rotation per beat
    float lurch;     // 0..1 = 0.8       how snappy each beat's turn is
    float width;     // 0.5..6 = 1.5     line width (px)
    float depth;     // 0..1 = 0.6       far edges dimmer
    bool  invert;    // = false
};

vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

vec3 project(int i, float t, float bar, out float z) {
    vec4 v = vec4((i & 1) != 0 ? 1.0 : -1.0, (i & 2) != 0 ? 1.0 : -1.0,
                  (i & 4) != 0 ? 1.0 : -1.0, (i & 8) != 0 ? 1.0 : -1.0);
    float m = mod(bar, 3.0);
    if (m < 0.5)      { v.xw = rot(v.xw, t);        v.yz = rot(v.yz, t * 0.5); }
    else if (m < 1.5) { v.yw = rot(v.yw, t);        v.xz = rot(v.xz, t * 0.7); }
    else              { v.zw = rot(v.zw, t * 1.2);  v.xy = rot(v.xy, t * 0.4); }
    vec3 q = v.xyz / (2.6 - v.w);
    q.xz = rot(q.xz, t * 0.3);
    q.yz = rot(q.yz, 0.35);
    z = q.z;
    return vec3(q.xy / (2.4 - q.z), q.z);
}

float seg(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * h);
}

float draw(vec2 p, float t, float bar, float px) {
    vec2 pts[16];
    float zs[16];
    for (int i = 0; i < 16; i++) {
        float z;
        vec3 q = project(i, t, bar, z);
        pts[i] = q.xy * size * 3.2;
        zs[i] = z;
    }
    float v = 0.0;
    for (int i = 0; i < 16; i++) {
        for (int k = 0; k < 4; k++) {
            int j = i ^ (1 << k);
            if (j < i) continue;
            float d = seg(p, pts[i], pts[j]);
            float zz = (zs[i] + zs[j]) * 0.5;
            float shade = mix(1.0, clamp(0.55 + zz, 0.15, 1.0), depth);
            v = max(v, smoothstep(px, 0.0, d) * shade);
        }
        float hat = max(u_triggers.z, u_hits.w);
        v = max(v, smoothstep(px * 4.0, 0.0, length(p - pts[i])) * (0.25 + hat));
    }
    return v;
}

void main() {
    vec2 p = to_centered(v_uv);
    float b = floor(u_beats);
    float t = (b + mix(fract(u_beats), smoothstep(0.0, 0.35, fract(u_beats)), lurch)) * spin;
    float bar = mod(floor(u_beats / 4.0), 3.0);
    float px = width * u_scale * 2.0 / u_resolution.y;
    float kick = max(u_triggers.x, u_hits.y);
    p /= 1.0 + kick * 0.15;

    float v = draw(p, t, bar, px);
    float ghost = max(u_triggers.y, u_hits.z);
    if (ghost > 0.02) v = max(v, draw(p * (1.0 + ghost * 0.25), t - ghost * 0.4, bar, px) * ghost * 0.7);

    if (invert) v = 1.0 - v;
    f_color = vec4(vec3(v), 1.0);
}
