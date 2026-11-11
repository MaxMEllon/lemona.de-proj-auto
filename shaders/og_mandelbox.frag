#version 450
#include "util/common.glsl"
#include "util/uv.glsl"

// Organic: flying through a raymarched Mandelbox. The camera drifts freely
// (no beat, trigger or audio sync). Lower `quality` if the frame rate
// drops.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;     // 0..4 = 1         forward speed
    float fold;      // 0.5..1.5 = 1     box fold limit
    float mscale;    // -3..3 = -2.2     Mandelbox scale
    float glow;      // 0..3 = 1         crevice glow
    int   quality;   // 24..128 = 72     march steps
    bool  mono;      // = false
};

float g_trap;

float de(vec3 p) {
    vec4 z = vec4(p, 1.0);
    float f = fold;
    float mr2 = 0.25, fr2 = 1.0;
    g_trap = 1e9;
    for (int i = 0; i < 9; i++) {
        z.xyz = clamp(z.xyz, -f, f) * 2.0 - z.xyz;
        float r2 = dot(z.xyz, z.xyz);
        z *= clamp(fr2 / max(r2, mr2), 1.0, fr2 / mr2);
        z = z * vec4(vec3(mscale), abs(mscale)) + vec4(p, 1.0);
        g_trap = min(g_trap, dot(z.xyz, z.xyz));
    }
    return length(z.xyz) / abs(z.w);
}

void main() {
    vec2 p = to_centered(v_uv);
    float t = u_time * 0.13 * speed;
    vec3 ro = vec3(sin(t * 0.7) * 1.2, cos(t * 0.5) * 1.2, -3.2 + sin(t * 0.3) * 0.6);
    vec3 ta = vec3(0.0, 0.0, 0.0);
    vec3 fw = normalize(ta - ro);
    vec3 rt = normalize(cross(vec3(sin(t * 0.2), 1.0, 0.0), fw));
    vec3 up = cross(fw, rt);
    vec3 rd = normalize(p.x * rt + p.y * up + 1.6 * fw);

    float d = 0.0, steps = 0.0, h = 0.0;
    float acc = 0.0;
    for (int i = 0; i < 128; i++) {
        if (i >= quality) break;
        h = de(ro + rd * d);
        acc += exp(-h * 40.0);
        if (h < 0.0015 * d || d > 12.0) break;
        d += h * 0.9;
        steps += 1.0;
    }
    float ao = 1.0 - steps / float(quality);
    float hit = step(h, 0.002 * d) * step(d, 12.0);
    float trap = clamp(log(g_trap) * 0.08, 0.0, 1.0);
    vec3 base = palette(fract(trap + u_time * 0.015));
    vec3 col = base * ao * ao * hit * 1.4;
    col += palette(0.6) * acc * 0.012 * glow;
    col *= exp(-d * 0.08);
    if (mono) col = vec3(monochrome(col));
    f_color = vec4(col, 1.0);
}
