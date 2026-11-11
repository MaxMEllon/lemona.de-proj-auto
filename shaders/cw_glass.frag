#version 450
#include "util/common.glsl"
#include "util/uv.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

// in0: what shows through / reflects in the glass (the sky)

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;       // 0..2 = 0.3        flow speed
    float scale;       // 0.2..4 = 1.1      ribbon size (higher = finer)
    float warp;        // 0..2 = 0.9        how far the liquid swirls
    float twist;       // -4..4 = 1.6       central vortex
    float cover;       // 0..1 = 0.45        amount of glass on screen
    float refraction;  // 0..0.3 = 0.07     how much the sky bends through it
    float dispersion;  // 0..1 = 0.4        prism color fringes
    float chrome;      // 0..1 = 0.55       0 clear water .. 1 liquid metal
    float highlight;   // 0..3 = 1.2        specular streaks
    float react;       // 0..3 = 1          audio reactivity
    vec4  tint;        // color = 0.80,0.88,0.97
    vec4  deep;        // color = 0.04,0.07,0.12  dark tone of the metal
};

float T;     // flow time
float W;     // warp amount
float COVER;

// Ribbon height at centred point p: 0 outside the glass, ~1 inside.
float height(vec2 p, out float s) {
    float r = length(p);
    float a = twist * exp(-r * 1.2) + T * 0.07;
    p = rotate_deg(p, a * 57.2958);
    vec2 q = p * scale * 1.6;
    float k = 1.0;
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        q += (W / k) * vec2(sin(q.y * k * 1.7 + T * (1.0 + 0.3 * fi) + fi * 1.3),
                            cos(q.x * k * 1.4 - T * (0.8 + 0.2 * fi) + fi * 2.1));
        k *= 1.55;
    }
    s = sin(q.x * 2.3 + q.y * 1.1);
    float ridge = 1.0 - abs(sin(q.x * 0.8 - q.y * 0.55 + 0.7));
    float th = 1.0 - COVER;
    float m = smoothstep(th - 0.08, th + 0.08, ridge);
    m *= smoothstep(1.7, 0.15, length(p * vec2(0.75, 1.0)));
    return m * (0.8 + 0.2 * s);
}

vec3 sky_at(vec2 uv, bool has_tex) {
    if (has_tex) return sample_edge(u_tex0, uv, EDGE_MIRROR).rgb;
    return mix(vec3(0.58, 0.67, 0.76), vec3(0.2, 0.31, 0.43), 1.0 - uv.y);
}

void main() {
    bool has_tex = texture(u_tex0, vec2(0.5)).a > 0.5;
    float rk = react;
    // the shape only flows; sound drives the light, not the geometry
    T = u_time * speed;
    W = warp;
    COVER = cover;

    vec2 p = to_centered(v_uv);

    float e = 2.0 / u_resolution.y;
    float s, sx, sy, ss;
    float h = height(p, s);
    float hx = height(p + vec2(e, 0.0), sx);
    float hy = height(p + vec2(0.0, e), sy);
    float shadow = height(p + vec2(0.05, 0.07), ss);

    vec2 grad = vec2(hx - h, hy - h) / e;
    vec3 n = normalize(vec3(-grad * 0.05, 1.0));
    vec2 uvn = vec2(n.x, -n.y);           // normal in uv space (y down)

    // background sky, darkened under the glass
    vec3 bg = sky_at(v_uv, has_tex) * (1.0 - 0.15 * shadow * (1.0 - h));

    // refraction with prism split
    vec2 off = uvn * refraction * (1.0 + 0.6 * h) * (1.0 + 0.35 * rk * u_hits.y);
    float dp = dispersion * 0.5;
    vec3 refr = vec3(sky_at(v_uv + off * (1.0 + dp), has_tex).r,
                     sky_at(v_uv + off, has_tex).g,
                     sky_at(v_uv + off * (1.0 - dp), has_tex).b);
    refr *= tint.rgb * 1.08;

    // chrome reflection: studio horizon bands + the sky mirrored
    vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
    float band = r.y - 0.12 + 0.4 * s + 0.15 * sin(r.x * 5.0 + T);
    vec3 env = mix(deep.rgb, tint.rgb, smoothstep(-0.02, 0.12, band));
    env = mix(env, vec3(1.0), smoothstep(0.5, 0.56, band) * smoothstep(0.75, 0.6, band));
    vec3 mir = sky_at(vec2(0.5) + (v_uv - 0.5) * vec2(-1.0, 1.0) + r.xy * 0.4, has_tex);
    vec3 refl = mix(env, mir * 1.1, 0.3);

    float fres = 0.04 + 0.96 * pow(1.0 - n.z, 3.0);
    vec3 glass = mix(refr, refl, clamp(fres * 1.5 + chrome, 0.0, 1.0));

    // highlights: sun glints, bright rims, sparkle on highs
    // the light glides round slowly with the beats, so glints travel along the glass
    float la = u_beats * 0.25 + 2.2;
    vec3 L = normalize(vec3(cos(la) * 0.7, sin(la) * 0.7, 0.65));
    float spec = pow(max(dot(r, L), 0.0), 90.0);
    float rim = pow(1.0 - n.z, 5.0);
    float hi = highlight * (0.85 + rk * (0.35 * u_hits.y + 0.5 * u_hits.w));
    glass += vec3(1.0) * (spec * 1.6 + rim * 0.7) * hi;
    // crisp light lines along the flow
    float line = smoothstep(0.92, 1.0, s) * smoothstep(0.3, 0.9, h) * (0.4 + 0.6 * pow(1.0 - n.z, 1.5));
    glass += line * 0.35 * hi;

    float a = smoothstep(0.0, 0.12, h);
    vec3 col = mix(bg, glass, a);
    f_color = vec4(clamp(col, 0.0, 1.0), 1.0);
}
