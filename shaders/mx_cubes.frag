#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Mono techno: gliding low over an endless field of black pillars lit by a
// hard white light. Pillar heights re-roll on every beat (rising into place),
// kick (pad 1 / low hit) slams a wave of pillars up from the camera, hats
// (high hit) flash pillar tops, accent (pad 4) inverts. Rendered by walking
// the grid cells along each ray with one exact box test per cell.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;     // 0..4 = 1
    float height;    // 0..3 = 1.2       pillar height range
    float gap;       // 0..0.45 = 0.08   gap between pillars
    float edge;      // 0..1 = 0.9       white edge outline
    float light;     // 0..2 = 1         sweeping light slab
    int   quality;   // 16..128 = 64     max grid cells walked per ray
    bool  invert;    // = false
};

float pillarH(vec2 id) {
    vec2 hid = mod(id, 97.0);
    float b = floor(u_beats);
    float k = smoothstep(0.0, 0.3, fract(u_beats));
    float h0 = hash21(hid + mod(b, 61.0) * 0.71);
    float h1 = hash21(hid + mod(b + 1.0, 61.0) * 0.71);
    float hh = mix(h0, h1, k);
    hh = hh * hh * height;
    float kick = max(u_triggers.x, u_hits.y);
    hh += kick * 0.8 * exp(-length(id) * 0.15);
    return hh;
}

// Ray vs. axis-aligned box: entry distance and the face normal hit.
bool box_hit(vec3 ro, vec3 inv, vec3 bmin, vec3 bmax, out float tn, out vec3 n) {
    vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
    vec3 tmin = min(t0, t1), tmax = max(t0, t1);
    tn = max(max(tmin.x, tmin.y), tmin.z);
    float tf = min(min(tmax.x, tmax.y), tmax.z);
    if (tn > tf || tf < 0.0) return false;
    n = tn == tmin.x ? vec3(-sign(inv.x), 0.0, 0.0)
      : tn == tmin.y ? vec3(0.0, -sign(inv.y), 0.0)
      :                vec3(0.0, 0.0, -sign(inv.z));
    return true;
}

void main() {
    vec2 p = to_centered(v_uv);
    float t = u_time * speed * 0.8;
    vec3 ro = vec3(t * 0.6, 1.4, t);
    vec3 fw = normalize(vec3(0.35, -0.55, 1.0));
    vec3 rt = normalize(cross(vec3(0, 1, 0), fw));
    vec3 up = cross(fw, rt);
    vec3 rd = normalize(p.x * rt + p.y * up + 1.4 * fw);
    rd += vec3(1e-5) * (1.0 - abs(sign(rd)));   // no exact zeros
    vec3 inv = 1.0 / rd;

    // Only the slab between the floor (y = -1) and the tallest possible
    // pillar top can hold a hit: walk the grid cells the ray crosses there,
    // one box test per cell (exact, no distance-field marching).
    float kick = max(u_triggers.x, u_hits.y);
    float ymax = height - 1.0 + kick * 0.8 + 0.01;
    float d = 1e9;
    vec3 n = vec3(0.0);
    if (rd.y < 0.0) {
        float tStart = max((ro.y - ymax) / -rd.y, 0.0);
        float tEnd = min((ro.y + 1.0) / -rd.y, 30.0);
        vec3 ps = ro + rd * tStart;
        vec2 cell = floor(ps.xz);
        vec2 stp = sign(rd.xz);
        vec2 tDelta = abs(inv.xz);
        vec2 tNext = (cell + max(stp, 0.0) - ro.xz) * inv.xz;
        float tc = tStart;
        for (int i = 0; i < 128; i++) {
            if (i >= quality || tc > tEnd) break;
            float h = pillarH(cell);
            float tn; vec3 nn;
            if (box_hit(ro, inv, vec3(cell.x + gap, -1.0, cell.y + gap),
                        vec3(cell.x + 1.0 - gap, h - 1.0, cell.y + 1.0 - gap), tn, nn) && tn > 0.0) {
                d = tn; n = nn;
                break;
            }
            if (tNext.x < tNext.y) { tc = tNext.x; tNext.x += tDelta.x; cell.x += stp.x; }
            else                   { tc = tNext.y; tNext.y += tDelta.y; cell.y += stp.y; }
        }
    }
    float top = step(0.5, n.y);
    float v = 0.0;
    if (d < 30.0) {
        vec3 pos = ro + rd * d;
        vec3 L = normalize(vec3(-0.6, 0.7, -0.3));
        float diff = clamp(dot(n, L), 0.0, 1.0);
        v = diff * diff * 0.12;
        // A slab of white light sweeps through the field once per beat.
        float sweep = fract(pos.z * 0.25 - u_beats * 0.5);
        v += smoothstep(0.06, 0.0, abs(sweep - 0.5)) * (0.4 + 0.6 * diff) * light;
        // Outline along the pillar edges.
        vec3 f = fract(pos);
        vec2 ef = min(f.xz, 1.0 - f.xz);
        float rim = smoothstep(gap + 0.015, gap, min(ef.x, ef.y)) * step(0.5, n.y);
        // Vertical edges on the side faces.
        float side = 1.0 - step(0.5, n.y);
        vec2 sf = abs(n.x) > 0.5 ? vec2(f.z, f.z) : vec2(f.x, f.x);
        rim = max(rim, side * smoothstep(gap + 0.015, gap, min(sf.x, 1.0 - sf.x)) * 0.6);
        v = max(v, rim * edge);
        v += top * max(u_hits.w, u_triggers.z) * 0.8 * step(0.5, n.y);
        v *= exp(-d * 0.07);
    }
    if (invert) v = 1.0 - v;
    v = mix(v, 1.0 - v, step(0.5, u_triggers.w));
    f_color = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
}
