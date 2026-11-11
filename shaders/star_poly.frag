#version 450
#include "util/common.glsl"
#include "util/uv.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

// The spectrum's pixel lines, bent into star polygons. in0 is a spectrum
// image (Audio FFT in spectrum mode; without it the 64 engine bins are used),
// cut into `lines` columns like fft_strands. Each column becomes one star
// outline (two regular n-gons: triangles → a hexagram), and its value, read
// as is, places it: pushed outward (`push`), slid sideways (`shift`), turned
// (`twist`) and leant in depth (`tilt`), and sets its brightness. So the outlines spread into a
// bundle on loud bins, collapse onto one star in silence and fade out with
// the sound, moving with the same pixels as the strands.

layout(set = 0, binding = 1) uniform NodeParams {
    vec4  ink;      // color = 1,1,1
    vec4  halo;     // color = 0.3,1,0.4     glow color
    int   sides;    // 3..8 = 3
    bool  star;     // = true               two n-gons, the second turned half a side
    int   lines;    // 1..16 = 8            outlines (spectrum columns)
    float lo;       // 0..1 = 0.02          first bin used
    float hi;       // 0..1 = 0.6           last bin used
    float gain;     // 0..4 = 1.6
    float base;     // 0..1 = 0             brightness kept in silence
    float size;     // 0.1..1.5 = 0.27
    float gap;      // 0..0.05 = 0.006      spacing between outlines
    float push;     // 0..0.4 = 0.08        value pushes an outline outward
    float twist;    // 0..45 = 5            value turns an outline (degrees)
    float shift;    // 0..0.2 = 0.04        value slides an outline sideways
    float tilt;     // 0..1 = 0.5           value leans an outline in depth
    float spin;     // -2..2 = 0.12         turns per 4 beats
    float width;    // 0.5..8 = 1.6         line width (px) at full value
    float glow;     // 0..2 = 0.5
};

const float PI = 3.14159265;

float spec(float t) {
    float x = mix(lo, hi, clamp(t, 0.0, 1.0));
    vec4 s = texture(u_tex0, vec2(x, 0.5));
    float v = s.a > 0.0 ? s.r : fft(int(clamp(x * 64.0, 0.0, 63.0)));
    return clamp(v * gain, 0.0, 1.0);
}

// Signed distance to a regular n-gon with inradius r, a vertex pointing up:
// fold the angle into one side's sector and measure to that edge segment.
float sd_ngon(vec2 p, float r, int n) {
    float an = PI / float(n);
    float a = atan(p.y, p.x) - PI * 0.5 + an;
    a = mod(a + an, 2.0 * an) - an;
    vec2 q = length(p) * vec2(cos(a), sin(a));
    float he = r * tan(an);
    return length(q - vec2(r, clamp(q.y, -he, he))) * sign(q.x - r);
}

void main() {
    vec2 p0 = rotate_deg(to_centered(v_uv), spin * u_beats * 90.0);
    float px = 2.0 / u_resolution.y;            // one pixel in centred units
    float nl = float(lines);

    vec3 col = vec3(0.0);
    for (int i = 0; i < 16; i++) {
        if (i >= lines) break;
        float fi = float(i);
        float v = spec((fi + 0.5) / nl);
        float side = mod(fi, 2.0) * 2.0 - 1.0;  // alternate outlines turn opposite ways

        float dir = fi * 2.39996;               // golden-angle spread of slide directions
        vec2 p = p0 - shift * v * vec2(cos(dir), sin(dir));
        p = rotate_deg(p, side * twist * v);
        // lean in depth: squash along an axis turned per outline
        float ax = fi * 47.0;
        p = rotate_deg(p, ax);
        p.y /= max(cos(tilt * v * side * 1.2), 0.25);
        p = rotate_deg(p, -ax);

        float r = size + (fi - (nl - 1.0) * 0.5) * gap + push * v;
        float d = abs(sd_ngon(p, r, sides));
        if (star) d = min(d, abs(sd_ngon(rotate_deg(p, 180.0 / float(sides)), r, sides)));

        float dp = d / px;
        float w = width * u_scale * (0.4 + 0.6 * v);
        float core = 1.0 - smoothstep(w * 0.5 - 0.75, w * 0.5 + 0.75, dp);
        float bright = base + (1.0 - base) * v;
        col += ink.rgb * core * bright + halo.rgb * glow * 0.25 * exp(-dp / (14.0 * u_scale)) * v;
    }
    f_color = vec4(min(col, vec3(4.0)), 1.0);
}
