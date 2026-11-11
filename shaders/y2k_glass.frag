#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

// in0: the sky seen through the glass

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;       // 0..2 = 0.25       liquid flow speed
    float fly;         // 0..0.5 = 0.07     bubbles flying out from the centre
    float x;           // -1..1 = 0.05      vanishing point
    float y;           // -1..1 = -0.25
    float bend;        // 0..1.5 = 0.45     tubes winding
    float spiral;      // -2..2 = 0.5       tubes curling around the centre
    float width;       // 0.2..3 = 1        tube thickness
    int   bubbles;     // 0..16 = 12
    float refraction;  // 0..0.3 = 0.14
    float dispersion;  // 0..1 = 0.6        prism fringes
    float oil;         // 0..1 = 0.7        iridescent film
    float highlight;   // 0..3 = 1.2
    float react;       // 0..3 = 1          audio: light and color only
    vec4  tint;        // color = 0.30,0.88,1.0
    vec4  deep;        // color = 0.26,0.10,0.48  the oily core
};

const float TAU = 6.2831853;
const float PI = 3.14159265;
float T;
vec2 C;
vec2 Q;   // liquid coordinates of the last glass_height call (marbles the film)

float glass_height(vec2 p, out float core) {
    vec2 d = p - C;
    float r = length(d);
    // liquid twist near the centre
    vec2 q = d * 2.2;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        q += 0.5 / (1.0 + fi) * vec2(sin(q.y * (1.6 + fi) + T + fi),
                                     cos(q.x * (1.4 + fi) - T * 0.8 + fi * 2.0));
    }
    d += (q / 2.2 - d) * smoothstep(0.9, 0.0, r) * 0.35;
    r = length(d);
    float a = atan(d.y, d.x);
    float lr = log(r + 1e-3);

    float h = 0.0;
    for (int i = 0; i < 16; i++) {
        float fi = float(i);
        vec2 hh = hash22(vec2(fi, 3.7));
        float base = (fi + hh.x * 0.8) / 16.0 * TAU;
        float ang = base + spiral * lr + bend * sin(lr * 1.7 + T * 0.35 + fi * 2.3);
        float w = width * mix(0.02, 0.11, hh.y * hh.y);
        float da = abs(mod(a - ang + PI, TAU) - PI);
        float xx = da / w;
        float r0 = mix(0.05, 0.35, hash21(vec2(fi, 9.1)));
        h = max(h, sqrt(max(1.0 - xx * xx, 0.0)) * smoothstep(r0, r0 + 0.15, r));
    }
    Q = q;
    float ridge = (0.5 + 0.5 * sin(q.x * 1.3 + sin(q.y * 1.7) * 1.4)) * (0.5 + 0.5 * cos(q.y * 1.1 - q.x * 0.6));
    float k = ridge - 0.12 - r * 1.3;
    core = smoothstep(0.0, 0.025, k) * (0.75 + 0.25 * sqrt(clamp(k * 6.0, 0.0, 1.0)));
    float folds = 0.6 + 0.25 * sin(q.x * 4.0 + q.y * 3.0) + 0.15 * sin(q.y * 7.0 - q.x * 2.0);
    return max(h, core * folds);
}

// The nearest bubble covering p: lens-shaped drops flying out of the centre.
bool bubble(vec2 p, out vec3 n, out vec2 ctr, out float alpha) {
    float bestf = -1.0;
    for (int i = 0; i < 16; i++) {
        if (i >= bubbles) break;
        float fi = float(i);
        vec2 hh = hash22(vec2(fi * 1.31, 7.7));
        float f = fract(u_time * fly + hh.x);
        float ang = hh.y * TAU + fi;
        vec2 dir = vec2(cos(ang), sin(ang));
        vec2 perp = vec2(-dir.y, dir.x);
        float dist = exp(mix(log(0.06), log(2.0), f));
        vec2 c = C + dir * dist;
        float rr = mix(0.02, 0.07, hash21(vec2(fi, 2.2))) * (0.3 + dist);
        vec2 lp = p - c;
        vec2 lq = vec2(dot(lp, dir), dot(lp, perp) * 1.35) / rr;
        float d2 = dot(lq, lq);
        if (d2 < 1.0 && f > bestf) {
            bestf = f;
            n = normalize(vec3(lq.x * dir + lq.y * perp, sqrt(1.0 - d2)));
            ctr = c;
            alpha = smoothstep(0.0, 0.1, f) * smoothstep(1.0, 0.9, f) * smoothstep(1.0, 0.9, d2);
        }
    }
    return bestf >= 0.0;
}

bool has_tex;
vec3 sky(vec2 uv) {
    if (has_tex) return sample_edge(u_tex0, uv, EDGE_MIRROR).rgb;
    return mix(vec3(0.55, 0.87, 1.0), vec3(0.0, 0.33, 0.78), 1.0 - uv.y);
}

void main() {
    has_tex = texture(u_tex0, vec2(0.5)).a > 0.5;
    T = u_time * speed;
    C = vec2(x * aspect(), y);
    vec2 p = to_centered(v_uv);

    float hue_shift = u_time * 0.02 + react * 0.12 * u_hits.x;
    float hi = highlight * (0.85 + react * (0.35 * u_hits.y + 0.5 * u_hits.w));
    float la = u_beats * 0.25 + 2.2;
    vec3 L = normalize(vec3(cos(la) * 0.7, sin(la) * 0.7, 0.65));

    float e = 2.0 / u_resolution.y;
    float core, c1, c2;
    float h = glass_height(p, core);
    vec2 q_here = Q;
    float hx = glass_height(p + vec2(e, 0.0), c1);
    float hy = glass_height(p + vec2(0.0, e), c2);
    vec3 n = normalize(vec3(-vec2(hx - h, hy - h) / e * 0.06, 1.0));
    vec2 uvn = vec2(n.x, -n.y);

    vec3 bg = sky(v_uv);

    // tubes and core: refracted sky, cyan body, oily film
    vec2 off = uvn * refraction * (0.5 + h);
    float dp = dispersion * 0.6;
    vec3 refr = vec3(sky(v_uv + off * (1.0 + dp)).r,
                     sky(v_uv + off).g,
                     sky(v_uv + off * (1.0 - dp)).b);
    refr *= mix(vec3(1.0), tint.rgb, clamp(0.15 + h * 0.45, 0.0, 1.0));
    vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
    // studio reflection: crisp white streaks running along the tubes
    float band = sin((r.x * 2.0 + r.y * 3.0) * 3.0 + 1.0);
    vec3 refl = mix(tint.rgb * 0.6, vec3(1.0), smoothstep(0.55, 0.65, band) + smoothstep(0.3, 0.35, r.y + 0.3 * r.x) * 0.6);
    float fres = 0.04 + 0.96 * pow(1.0 - n.z, 3.0);
    vec3 glass = mix(refr, refl, clamp(fres * 1.3, 0.0, 1.0));

    float marble = sin(q_here.x * 3.1 + q_here.y * 2.3) * 0.5 + sin(q_here.y * 5.7 - q_here.x * 1.3) * 0.25;
    vec3 film = 0.5 + 0.5 * cos(TAU * (h * 1.7 + marble + dot(n.xy, vec2(1.3, 0.9)) + hue_shift + vec3(0.0, 0.33, 0.67)));
    glass = mix(glass, deep.rgb * (0.4 + 0.9 * refr) + film * film * 0.55 * (0.4 + fres) + refl * fres * 0.5, core * oil * 0.85);
    glass += film * fres * oil * 0.35;

    float spec = pow(max(dot(r, L), 0.0), 90.0);
    float rim = pow(1.0 - n.z, 5.0);
    glass += (spec * 1.6 + rim * 0.6) * hi;

    vec3 col = mix(bg, glass, smoothstep(0.0, 0.08, h));

    // bubbles: magnified, upside-down sky with a bright film rim
    vec3 bn; vec2 bc; float ba;
    if (bubble(p, bn, bc, ba)) {
        vec2 lp = p - bc;
        vec3 inside = sky(from_centered(bc - lp * 0.7)) * mix(vec3(1.0), tint.rgb, 0.35) * 1.1 + 0.08;
        float bf = pow(1.0 - bn.z, 2.5);
        vec3 film2 = 0.5 + 0.5 * cos(TAU * (bf * 1.5 + hue_shift + vec3(0.0, 0.33, 0.67)));
        vec3 bcol = mix(inside, vec3(0.85, 0.97, 1.0), bf * 0.8) + film2 * bf * oil * 0.4;
        bcol += pow(max(dot(reflect(vec3(0.0, 0.0, -1.0), bn), L), 0.0), 60.0) * hi * 1.5;
        col = mix(col, bcol, ba);
    }

    f_color = vec4(clamp(col, 0.0, 1.0), 1.0);
}
