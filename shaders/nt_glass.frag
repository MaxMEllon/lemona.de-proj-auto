#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

// Thick clear glass tubes coiling from the foreground into the distance, with bubbles.
// in0: the scene behind the glass

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;       // 0..2 = 0.15       tubes drifting
    float thickness;   // 0.2..3 = 1.6
    int   tubes;       // 1..5 = 4
    float loops;       // 0..4 = 2.2        coils per tube
    float refraction;  // 0..2 = 0.9        lens strength (above 1: upside-down image)
    float dispersion;  // 0..1 = 0.35       prism fringes
    float clarity;     // 0..1 = 0.75       0 frosted blue .. 1 clear
    float highlight;   // 0..3 = 1.2
    int   bubbles;     // 0..16 = 10
    float fly;         // 0..0.5 = 0.04     bubble drift
    float react;       // 0..3 = 1          audio: light and color only
    vec4  tint;        // color = 0.84,0.91,1.0
    vec4  edge;        // color = 0.42,0.56,0.84  glass edge tone
};

const float TAU = 6.2831853;
float T;

// per-tube constants, computed once per pixel instead of at every curve point
vec2 TA, TB;
float TPH, TCOIL, TRAD, TFK;

void tube_setup(int k) {
    float fk = float(k);
    vec2 h = hash22(vec2(fk, 4.2));
    vec2 h2 = hash22(vec2(fk, 8.9));
    TA = vec2(mix(-1.4, 0.4, h.x), -1.35);                 // near: below the frame
    TB = vec2(mix(-0.2, 1.7, h.y), mix(0.1, 1.2, h2.x));   // far: up and away
    TPH = T * (0.5 + 0.3 * h2.y) + fk * 1.7;
    TCOIL = 0.5 * (0.5 + 0.5 * h2.x);
    TRAD = thickness * mix(0.7, 1.2, h.y);
    TFK = fk;
}

vec2 curve(float s, out float rad) {
    vec2 c = mix(TA, TB, s) + vec2(sin(s * 3.0 + TPH), cos(s * 2.3 + TPH * 0.8)) * 0.25;
    float ang = TAU * loops * s + TPH * 1.3 + TFK;
    c += vec2(cos(ang), sin(ang) * 0.6) * TCOIL * (1.0 - s * 0.7);
    rad = TRAD * mix(0.12, 0.025, s);
    return c;
}

float seg_dist(vec2 p, vec2 a, vec2 b, out float h, out vec2 cp) {
    vec2 pa = p - a, ba = b - a;
    h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    cp = a + ba * h;
    return length(p - cp);
}

vec3 scene(vec2 uv) {
    if (texture(u_tex0, vec2(0.5)).a < 0.5) return mix(vec3(0.87, 0.93, 0.99), vec3(0.36, 0.64, 0.93), 1.0 - uv.y);
    return sample_edge(u_tex0, uv, EDGE_MIRROR).rgb;
}

void main() {
    T = u_time * speed;
    vec2 p = to_centered(v_uv);
    float px = 2.0 / u_resolution.y;

    float hi = highlight * (0.85 + react * (0.35 * u_hits.y + 0.5 * u_hits.w));
    float dp = dispersion * (1.0 + react * 0.6 * u_hits.x);
    float la = u_beats * 0.25 + 2.0;
    vec3 L = normalize(vec3(cos(la) * 0.6, sin(la) * 0.6 + 0.3, 0.7));

    // each tube is the smooth union of its segments (crossings melt together);
    // between tubes the nearer one wins
    float best = -1.0, bd = 0.0, bR = 1.0;
    vec2 bcp = vec2(0.0);
    // coarse spans first; only spans the pixel could touch are refined
    const int NC = 10, NF = 4;
    for (int k = 0; k < 5; k++) {
        if (k >= tubes) break;
        tube_setup(k);
        float tx = 1.0, td = 0.0, tR = 1.0, ts = 0.0;
        vec2 tcp = vec2(0.0);
        float r0;
        vec2 c0 = curve(0.0, r0);
        for (int j = 1; j <= NC; j++) {
            float s1 = float(j) / float(NC);
            float r1;
            vec2 c1 = curve(s1, r1);
            float hh; vec2 cp;
            // coil bulge between the span's ends (sagitta of its arc) + wobble + thickness
            float margin = max(r0, r1) + 0.06 + TCOIL * (1.0 - cos(min(loops * TAU / float(NC) * 0.5, 1.5708)));
            if (seg_dist(p, c0, c1, hh, cp) < margin) {
                float s0 = s1 - 1.0 / float(NC);
                float rp = r0;
                vec2 prev = c0;
                for (int i = 1; i <= NF; i++) {
                    float s = s0 + float(i) / float(NC * NF);
                    float rc;
                    vec2 cur = i == NF ? c1 : curve(s, rc);
                    if (i == NF) rc = r1;
                    float d = seg_dist(p, prev, cur, hh, cp);
                    float R = mix(rp, rc, hh);
                    if (d / R < tx) { tx = d / R; td = d; tR = R; tcp = cp; ts = s; }
                    prev = cur; rp = rc;
                }
            }
            c0 = c1; r0 = r1;
        }
        float near = 1.0 - ts + float(k) * 0.001;
        if (tx < 1.0 && near > best) { best = near; bd = td; bR = tR; bcp = tcp; }
    }

    vec3 col = scene(v_uv);

    if (best >= 0.0) {
        float x = bd / bR;
        vec2 dir = (p - bcp) / max(bd, 1e-5);
        vec3 n = normalize(vec3(dir * x, sqrt(max(1.0 - x * x, 0.0))));
        // a solid glass rod: the scene is pulled across (and flipped by) its axis
        vec2 rel = p - bcp;
        float k = 1.0 - refraction * (1.0 + 0.6 * x * x);
        vec3 refr = vec3(scene(from_centered(bcp + rel * k * (1.0 - dp * 0.3))).r,
                         scene(from_centered(bcp + rel * k)).g,
                         scene(from_centered(bcp + rel * k * (1.0 + dp * 0.3))).b);
        refr = mix(refr, edge.rgb * 1.3, (1.0 - clarity) * 0.6);
        refr *= tint.rgb;

        vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
        float fres = 0.04 + 0.96 * pow(1.0 - n.z, 3.0);
        vec3 refl = mix(vec3(0.72, 0.82, 0.97), vec3(1.0), smoothstep(-0.1, 0.5, r.y));
        vec3 g = mix(refr, refl, fres * 0.7);
        g = mix(g, edge.rgb, smoothstep(0.86, 1.0, x) * 0.55);                  // darker blue walls
        g += smoothstep(0.03, 0.0, abs(x - 0.82)) * 0.2;                       // inner wall glint
        vec3 film = 0.5 + 0.5 * cos(TAU * (x * 1.5 + dir.x * 0.5 + u_time * 0.03 + vec3(0.0, 0.33, 0.67)));
        g += film * smoothstep(0.6, 0.95, x) * dp * 0.35;                       // rainbow at the walls
        g += (pow(max(dot(r, L), 0.0), 70.0) * 1.4 + pow(max(dot(r, L), 0.0), 8.0) * 0.12) * hi;
        float a = 1.0 - smoothstep(bR - 1.5 * px, bR, bd);
        col = mix(col, g, a);
    }

    // bubbles drifting past
    for (int i = 0; i < 16; i++) {
        if (i >= bubbles) break;
        float fi = float(i);
        vec2 h = hash22(vec2(fi * 1.7, 2.3));
        float f = fract(u_time * fly * (0.6 + h.x) + h.y);
        vec2 c = vec2(1.9 - f * 3.8, mix(-0.9, 0.95, hash21(vec2(fi, 5.5))) + sin(f * 6.0 + fi) * 0.08);
        float rr = mix(0.012, 0.07, pow(hash21(vec2(fi, 9.0)), 2.0));
        vec2 lq = (p - c) / rr * vec2(1.0, 1.25);
        float d2 = dot(lq, lq);
        if (d2 < 1.0) {
            vec3 bn = normalize(vec3(lq, sqrt(1.0 - d2)));
            float bf = pow(1.0 - bn.z, 2.0);
            vec3 inside = scene(from_centered(c - (p - c) * 0.8)) * vec3(0.85, 0.97, 1.0) + 0.06;
            vec3 b = mix(inside, vec3(0.9, 0.97, 1.0), bf * 0.7);
            b += pow(max(dot(reflect(vec3(0.0, 0.0, -1.0), bn), L), 0.0), 50.0) * hi;
            col = mix(col, b, smoothstep(1.0, 0.85, d2) * 0.9);
        }
    }

    f_color = vec4(clamp(col, 0.0, 1.0), 1.0);
}
