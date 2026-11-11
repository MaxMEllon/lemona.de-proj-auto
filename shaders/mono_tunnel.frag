#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

// Black & white geometric corridor: line frames (square / triangle / circle /
// hex) hang along z, each turned a little from the last, rails run into the
// distance, and the camera lurches forward on every beat. Some frames light
// up per beat; the picture inverts on the kick.

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;    // 0..4 = 1            frames travelled per beat
    float punch;    // 0..1 = 0.75         travel lurches on the beat
    float twist;    // -90..90 = 12        rotation step between frames (degrees)
    float spin;     // -2..2 = 0.25        frames turning over time
    int   shape;    // mix|square|triangle|circle|hex = mix
    float spacing;  // 0.5..4 = 1.4        distance between frames
    float width;    // 0.005..0.15 = 0.022 line width
    float size;     // 0.3..2 = 1
    float nested;   // 0..1 = 0.5          frames with an inner shape
    float rails;    // 0..1 = 1            lines running down the corridor
    float ticks;    // 0..1 = 0.4          frames with a ring of dashes
    float glow;     // 0..2 = 0.7
    float fog;      // 0..1 = 0.55
    float flash;    // 0..1 = 0.8          frames lighting up with the beat
    int   invert;   // off|kick|trigger 1|every bar|always = kick
    float camera;   // 0..1 = 0.4          camera sway and roll
    int   frames;   // 4..40 = 20          frames drawn (fewer = lighter)
    float grain;    // 0..0.2 = 0.04
};

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

float sd_box(vec2 p, float r) {
    vec2 d = abs(p) - vec2(r);
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sd_tri(vec2 p, float r) {
    const float k = 1.7320508;
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
}
float sd_hex(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
}
float sd_shape(vec2 p, int k, float r) {
    if (k == 0) return sd_box(p, r);
    if (k == 1) return sd_tri(p, r * 1.5);
    if (k == 2) return length(p) - r * 1.1;
    return sd_hex(p, r);
}

// Lines of one frame, in its own plane (world units; < 0 inside a line).
float frame_d(vec2 p, float id, float h) {
    int k = shape == 0 ? int(h * 4.0) : shape - 1;
    float dir = h > 0.5 ? 1.0 : -1.0;
    vec2 q = rot(radians(twist) * id + u_time * spin * dir) * p;
    float r = size * (0.85 + 0.35 * fract(h * 7.1));
    float d = abs(sd_shape(q, k, r)) - width;
    if (fract(h * 13.3) < nested) {
        int k2 = (k + 1 + int(fract(h * 3.7) * 3.0)) % 4;
        vec2 q2 = rot(-u_time * spin * 2.0 * dir + id) * p;
        d = min(d, abs(sd_shape(q2, k2, r * 0.45)) - width * 0.7);
    }
    if (fract(h * 5.3) < ticks) {
        // ring of dashes around the frame
        float n = 24.0 + floor(fract(h * 9.1) * 3.0) * 12.0;
        float a0 = (floor(atan(q.y, q.x) / 6.2831853 * n) + 0.5) * 6.2831853 / n;
        vec2 qs = rot(-a0) * q - vec2(r * 1.4, 0.0);
        vec2 e = abs(qs) - vec2(0.05 * size, width * 0.5);
        d = min(d, length(max(e, 0.0)) + min(max(e.x, e.y), 0.0));
    }
    return d;
}

void main() {
    vec2 uv = to_centered(v_uv);
    float t = u_time;
    const float F = 1.5;                 // focal length
    float px = 2.0 / u_resolution.y;     // one pixel on screen

    // forward travel: steady, or eased into each beat
    float ease = 1.0 - pow(1.0 - u_phase, 4.0);
    float cells = mod(floor(u_beats) + mix(u_phase, ease, punch), 512.0) * speed;
    vec3 ro = vec3(camera * 0.35 * vec2(sin(t * 0.31), cos(t * 0.23)), cells * spacing);
    vec2 sv = uv * rot(camera * 0.35 * sin(t * 0.17) + camera * 0.08 * u_hits.y);
    float fogk = mix(0.02, 0.35, fog);

    // frames are planes at fixed z: intersect each, near to far, and
    // composite front to back (no ray marching)
    float v = 0.0, T = 1.0, acc = 0.0;
    float first = floor(ro.z / spacing) + 1.0;
    float far = float(frames) * spacing;
    for (int i = 0; i < frames; i++) {
        float id = first + float(i);
        float dz = id * spacing - ro.z;
        vec2 p = ro.xy + sv * dz / F;
        float d = frame_d(p, id, hash21(vec2(id, 7.3)));
        float cov = clamp(0.5 - d / (px * dz / F), 0.0, 1.0);
        float lit = step(0.72, hash21(vec2(id, floor(u_beats))));
        float em = 0.35 + lit * flash * (1.0 + 2.0 * (1.0 - u_phase));
        float f = exp(-dz * fogk) * clamp((far - dz) / (3.0 * spacing), 0.0, 1.0);
        v += T * cov * min(em * 1.6, 1.0) * f;
        acc += T * em * f * 0.3 / (1.0 + d * d * 3000.0);
        T *= 1.0 - cov;
        if (T < 0.01) break;
    }

    // rails at four corners, seen behind the frames
    if (rails > 0.0) {
        float rv = 0.0;
        for (int k = 0; k < 4; k++) {
            float a = 0.7853982 + float(k) * 1.5707963;
            vec2 D = size * 1.55 * vec2(cos(a), sin(a)) - ro.xy;
            float s = max(dot(sv, D) / dot(D, D), 1e-4);   // = F / depth
            float dist = length(sv - s * D);
            float cov = clamp(0.5 - (dist - width * 0.35 * s) / px, 0.0, 1.0);
            rv = max(rv, cov * exp(-F / s * fogk));
        }
        v += T * rv * rails * 0.7;
    }
    v += acc * glow;
    v += exp(-length(uv) * 3.0) * 0.06 * (1.0 + u_beat);   // light at the end of the corridor

    // invert
    float inv = invert == 1 ? step(0.55, u_hits.y)
              : invert == 2 ? step(0.5, u_triggers.x)
              : invert == 3 ? mod(floor(u_beats / 4.0), 2.0)
              : invert == 4 ? 1.0 : 0.0;
    v = clamp(v, 0.0, 1.0);
    v *= 1.0 - 0.35 * dot(uv * 0.5, uv * 0.5);              // vignette
    v += (hash21(v_uv * u_resolution + fract(t) * 91.0) - 0.5) * grain;
    v = mix(v, 1.0 - v, inv);
    f_color = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
}
