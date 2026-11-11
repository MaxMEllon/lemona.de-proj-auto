#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Crystal shatter: long needle-like glass shards bursting from the centre,
// overlapping at random angles. Each shard refracts a colourful "photo"
// behind it, has a lit and a shaded half split by a bright ridge, thin dark
// edges and prismatic rainbow fringes; a faceted crystal backdrop, sparse
// block-mosaic patches and thin circles complete it. Shards stream outward
// and re-cut on every beat; the colours switch every two bars (red / blue
// <-> lime / violet). in0 (optional) replaces the built-in photo with your
// own footage. Kick (pad 1 / low hit) punches in and whitens, snare (pad 2 /
// mid hit) throws mosaic blocks, hats (high hit) flash the fringes, accent
// (pad 4) inverts.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   count;     // 8..64 = 56       shards (the first 30% are big slabs)
    float facets;    // 6..40 = 18       backdrop facets around the centre
    float flow;      // 0..2 = 0.25      outward stream speed
    float refract_;  // 0..0.6 = 0.2     how far each shard shifts the image
    float white;     // 0..1 = 0.8       glassy whitening
    float iris;      // 0..2 = 1         rainbow fringes
    float blocks;    // 0..1 = 0.12      block-mosaic amount
    bool  mirror;    // = true           left-right symmetry
    bool  cut;       // = true           re-cut the shards on every beat
};

vec3 rainbow(float t) { return 0.5 + 0.5 * cos(6.2831853 * (t + vec3(0.0, 0.33, 0.67))); }

float g_section;

// Built-in "photo": warped noise in the section's colours with fine detail.
vec3 photo(vec2 uv) {
    if (texture(u_tex0, vec2(0.5)).a > 0.5) return texture(u_tex0, fract(uv)).rgb;
    vec2 q = uv * vec2(aspect(), 1.0) * 2.5;
    float w = fbm(q * 1.3 + g_section * 3.7, 3);
    float n = fbm(q + w * 2.2, 4);
    float fine = noise2(q * 14.0 + w * 6.0);
    vec3 a, b, c;
    if (g_section < 0.5) { a = vec3(0.86, 0.30, 0.16); b = vec3(0.16, 0.18, 0.75); c = vec3(0.93, 0.93, 0.96); }
    else                 { a = vec3(0.84, 0.96, 0.20); b = vec3(0.38, 0.26, 0.80); c = vec3(0.26, 0.40, 0.24); }
    vec3 col = mix(b, a, smoothstep(0.35, 0.65, n));
    col = mix(col, c, smoothstep(0.5, 0.8, fine) * 0.6);
    return col * (0.65 + 0.5 * smoothstep(0.2, 0.8, w));
}

void main() {
    vec2 p = to_centered(v_uv);
    float kick = max(u_triggers.x, u_hits.y);
    float sn = max(u_triggers.y, u_hits.z);
    float hat = max(u_triggers.z, u_hits.w);
    p /= 1.0 + kick * 0.12;
    if (mirror) p.x = abs(p.x);
    g_section = mod(floor(u_beats / 8.0), 2.0);
    float seed = cut ? mod(floor(u_beats), 61.0) * 3.1 : 0.0;
    float px = 2.0 / u_resolution.y;
    float r = length(p);
    float ang = atan(p.y, p.x);

    // Backdrop: wedge facets, each split into a lit and a shaded half.
    float fa = (ang / 6.2831853 + 0.5) * facets;
    float fid = floor(fa);
    float ff = fract(fa);
    float fh = hash21(vec2(fid, seed + 1.0));
    float split = 0.3 + 0.4 * fh;
    float half_ = step(split, ff);
    float lv = hash21(vec2(fid + half_ * 17.0, seed + 4.0));
    float shade = lv < 0.3 ? 0.35 : (lv < 0.6 ? 0.75 : 1.1);
    vec2 offs = (hash22(vec2(fid + half_ * 31.0, seed)) - 0.5) * refract_;
    vec2 suv = v_uv + offs;
    float whiten = white * (0.6 + 0.4 * hash21(vec2(fid, 9.0)));
    float ridge = smoothstep(0.03, 0.0, abs(ff - split)) * 0.35;
    float edgeA = 0.0, fringe = 0.0;

    // Needle shards: tapered diamonds along random rays; later ones on top.
    float topId = -1.0, topSide = 0.0, topT = 0.0, topEdge = 1.0;
    for (int i = 0; i < 64; i++) {
        if (i >= count) break;
        float fi = float(i);
        vec4 h = vec4(hash21(vec2(fi, seed)), hash21(vec2(fi, seed + 7.3)),
                      hash21(vec2(fi + 3.1, seed)), hash21(vec2(fi + 5.7, seed + 2.2)));
        float th = h.x * 6.2831853;
        vec2 dir = vec2(cos(th), sin(th));
        vec2 nrm = vec2(-dir.y, dir.x);
        bool slab = fi < float(count) * 0.3;              // first ones: big backdrop slabs
        float len = slab ? 0.9 + h.y * 1.3 : 0.35 + h.y * 1.1;
        float start = fract(h.z + u_time * flow * (0.4 + h.w)) * (slab ? 0.8 : 1.2) - (slab ? 0.7 : 0.45);
        vec2 o = nrm * (h.w - 0.5) * (slab ? 0.5 : 0.22);  // axes miss the centre a little
        float along = dot(p - o, dir) - start;
        float t = along / len;
        if (t < 0.0 || t > 1.0) continue;
        float across = dot(p - o, nrm);
        float wmax = slab ? 0.12 + h.w * 0.3 : 0.02 + h.w * 0.12;
        float prof = wmax * (t < 0.3 ? t / 0.3 : (1.0 - t) / 0.7);   // diamond: short base, long tip
        float d = abs(across);
        if (d > prof) continue;
        topId = fi; topSide = sign(across) * (h.y > 0.5 ? 1.0 : -1.0); topT = t;
        topEdge = (prof - d) / max(prof, 1e-4);   // 0 at the edge, 1 on the ridge
    }
    if (topId >= 0.0) {
        float hs = hash21(vec2(topId, seed + 13.0));
        float lvl = hash21(vec2(topId, seed + 21.0));
        shade = (lvl < 0.22 ? 0.3 : (lvl < 0.5 ? 0.75 : 1.15)) * (topSide > 0.0 ? 1.0 : 0.72);
        suv = v_uv + (hash22(vec2(topId, seed + 5.0)) - 0.5) * refract_ * 1.6;
        whiten = hs > 0.72 ? white * 0.15 : white;           // a few shards keep strong colour
        ridge = smoothstep(0.15, 0.0, 1.0 - topEdge) * 0.6;   // bright spine
        edgeA = smoothstep(0.12, 0.0, topEdge);               // dark rim
        fringe = smoothstep(0.35, 0.05, topEdge) * step(0.6, hs);
    }

    vec3 col = photo(suv);
    col = mix(col, vec3(1.0), clamp(whiten + kick * 0.3, 0.0, 1.0));
    col *= shade;
    col += ridge;
    col *= 1.0 - edgeA * 0.6;
    col += rainbow(topEdge * 2.0 + topT * 1.5 + u_time * 0.2) * fringe * iris * (0.35 + hat * 0.8);
    // Faint wedge seams in the backdrop.
    col *= 1.0 - smoothstep(0.02, 0.0, min(ff, 1.0 - ff)) * 0.25 * step(topId, -0.5);

    // Sparse block mosaic, towards the frame edges and on snares.
    vec2 bs = vec2(aspect(), 1.0) * 14.0;
    vec2 bid = floor(v_uv * bs);
    float edgeW = smoothstep(0.5, 1.3, length(to_centered(v_uv)));
    float bmask = step(1.0 - (blocks + sn * 0.3) * edgeW, hash21(bid + mod(floor(u_beats * 2.0), 61.0) * 1.31));
    if (bmask > 0.5) {
        vec3 bcol = photo((bid + 0.5) / bs + hash21(bid) * 0.3);
        bcol = mix(bcol, vec3(dot(bcol, vec3(0.333))), 0.6) * (0.55 + 0.6 * hash21(bid + 5.0));
        col = mix(col, bcol, 0.8);
    }

    // Thin circles.
    vec2 pc = to_centered(v_uv);
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float bb = mod(floor(u_beats / 2.0), 61.0);
        vec2 cc = (vec2(hash21(vec2(fi, bb)), hash21(vec2(fi + 9.0, bb))) - 0.5) * vec2(aspect(), 1.0) * 1.6;
        float rad = 0.12 + 0.45 * hash21(vec2(fi + 3.0, bb + 2.0));
        col = mix(col, vec3(0.95), smoothstep(px * 1.5, 0.0, abs(length(pc - cc) - rad)) * 0.6);
    }

    col = clamp(col, 0.0, 1.0);
    col = mix(col, 1.0 - col, step(0.5, u_triggers.w));
    f_color = vec4(col, 1.0);
}
