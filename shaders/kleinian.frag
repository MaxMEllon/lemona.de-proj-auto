#version 450
#include "util/common.glsl"

// Pseudo-Kleinian raymarcher, ported from a Shadertoy-style TouchDesigner shader (tmp.frag).

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

// Knobs (0..1). At 0.5 each matches the original look.
layout(set = 0, binding = 1) uniform NodeParams {
    float a;   // distortion: 0..5 (was iDistortion = 2.5)
    float b;   // time speed: 0..2x
    float c;   // hue shift of the blue base colors (0.5 = original)
    float d;   // exposure: 0..8 (was 4.0)
};

// Was a TouchDesigner Count CHOP accumulating kicks, to speed up time on beats.
// Now derived from the beat clock: steps by 1 on each beat, easing in over
// the first 0.3 beat, so the rotation lurches forward on the beat.
float kick() {
    return floor(u_beats) + smoothstep(0.0, 0.3, fract(u_beats));
}

float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

// Y-axis rotation
mat3 rot3(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

// Rotate hue around the grey axis.
vec3 hueShift(vec3 col, float angle) {
    const vec3 k = vec3(0.57735);
    float c = cos(angle);
    return col * c + cross(k, col) * sin(angle) + k * dot(k, col) * (1.0 - c);
}

#define ITERATIONS 8

float dePseudoKleinian(vec3 p) {
    vec3 csize = vec3(0.90756, 0.92436, 0.90756);
    float size = 1.0;
    float defactor = 1.0;
    for (int i = 0; i < ITERATIONS; i++) {
        p = 2.0 * clamp(p, -csize, csize) - p;
        float k = max(size / dot(p, p), 1.0);
        p *= k;
        defactor *= k;
    }
    return abs(0.5 * abs(p.y) / defactor);
}

// `rot` is the scene rotation, computed once per pixel in main().
float sceneSDF(vec3 p, mat3 rot) {
    return dePseudoKleinian(p * rot);
}

vec3 normalAt(vec3 p) {
    const float h = 0.001;
    const vec2 k = vec2(1.0, -1.0);
    return normalize(k.xyy * dePseudoKleinian(p + k.xyy * h) +
                     k.yyx * dePseudoKleinian(p + k.yyx * h) +
                     k.yxy * dePseudoKleinian(p + k.yxy * h) +
                     k.xxx * dePseudoKleinian(p + k.xxx * h));
}

vec3 lighting(vec3 p, vec3 view, float time) {
    vec3 normal = normalAt(p);
    float vn = clamp(dot(-view, normal), 0.0, 1.0);
    vec3 ld = normalize(vec3(-1.0, 0.9 * sin(time * 0.5) - 0.1, 0.0));
    float NdotL = max(dot(ld, normal), 0.0);
    vec3 R = normalize(-ld + NdotL * normal * 2.0);
    float spec = pow(max(dot(-view, R), 0.0), 20.0) * clamp(sign(NdotL), 0.0, 1.0);
    vec3 col = vec3(1.0) * (pow(vn, 2.0) * 0.9 + spec * 0.3);

    // Emissive stripes
    float k = 0.5;
    float ks = 0.9;
    vec2 sxz = floor((p.xz - 0.5 * ks) / ks) * ks;
    float sx = rand(sxz);
    float sy = rand(sxz + 100.1);
    float emissive = clamp(0.001 / abs(mod(abs(p.y * sx + p.x * sy) + time * sign(sx - 0.5) * 0.4, k) - 0.5 * k), 0.0, 1.0);

    float hue = (c - 0.5) * 6.2831853;
    vec3 base1 = hueShift(vec3(0.4, 0.4, 1.0), hue);
    vec3 base2 = hueShift(vec3(0.6, 0.6, 1.0), hue);

    return clamp(col * base1 + emissive * base2, 0.0, 1.0);
}

// Raymarch steps. Fewer steps are cheaper; the step scale grows to match so
// rays still travel about as far (100 steps × 0.65 in the original).
// Measured at 1920×1080 with AA off: 100 → 13 ms, 72 → 8.4 ms (looks the
// same); at 64 the inner shell starts to change.
#ifndef STEPS
#define STEPS 72
#endif
#define STEP_SCALE min(0.65 * 100.0 / float(STEPS), 0.9)

// 1 = adaptive anti-aliasing below (up to 5 samples on edges; ~2.5× slower,
// since a fractal has edges almost everywhere). 0 = one sample per pixel.
#ifndef AA
#define AA 0
#endif

// Adaptive anti-aliasing: every pixel takes one sample at its centre; pixels
// on an edge (large colour or depth change across the 2x2 quad, measured with
// screen-space derivatives) add 4 rotated-grid sub-pixel samples and average
// all 5. The GPU runs pixels in SIMD groups, so one edge pixel makes its whole
// group pay: keep the refinement small and the thresholds strict.
// Colour difference (0..1 per channel) that counts as an edge.
#define EDGE_COLOR 0.15
// Relative depth difference that counts as an edge.
#define EDGE_DEPTH 0.1
// 1 = paint the refined pixels red, to tune the thresholds.
#define SHOW_EDGES 0

// Returns the clamped colour for one ray; the hit distance goes to `depth`.
vec3 renderSample(vec2 fragCoord, float time, mat3 rot, float distortion, out float depth) {
    vec2 p = (fragCoord - 0.5 * u_resolution) / u_resolution.y;

    // Lens distortion
    p *= 1.0 + distortion * dot(p, p) * 25.0;

    // Camera
    vec3 target = vec3(0.0);
    vec3 cp = vec3(0.0, -7.0, -7.0);
    vec3 cd = normalize(target - cp);
    vec3 cs = normalize(cross(vec3(0.0, 1.0, 0.0), cd));
    vec3 cu = normalize(cross(cd, cs));
    float fov = 16.0/9.0;
    vec3 rd = normalize(cs * p.x + cu * p.y + cd * fov);

    // Raymarch without early exit ("phantom" look)
    float t = 0.0;
    for (int i = 0; i < STEPS; i++) {
        float dist = max(abs(sceneSDF(cp + t * rd, rot)), 0.01);
        t += dist * STEP_SCALE;
        if (t > 720.0) {
            break;
        }
    }
    depth = t;

    vec3 col = pow(lighting(cp + rd * t, rd, time), vec3(2.2));
    // Clamp before any averaging so over-exposed samples don't swamp their
    // neighbours (edges resolve as they're displayed).
    return clamp(col * d * 8.0, 0.0, 1.0);
}

void main() {
    float time = u_time * b * 2.0;
    float distortion = a * 5.0;
    mat3 rot = rot3((time + kick()) / 4.0);

    // Shadertoy fragCoord: origin at the bottom-left.
    vec2 fragCoord = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution;

    float depth;
    vec3 col = renderSample(fragCoord, time, rot, distortion, depth);

#if AA
    // Edge detection. Derivatives must be taken here, in uniform control flow.
    vec3 dc = fwidth(col);
    float dd = fwidth(depth) / max(depth, 1e-3);
    bool edge = max(max(dc.r, dc.g), dc.b) > EDGE_COLOR || dd > EDGE_DEPTH;

    if (edge) {
        // Rotated grid: 4 samples, each on its own row and column.
        const vec2 offsets[4] = vec2[](
            vec2(0.125, 0.375), vec2(-0.375, 0.125),
            vec2(-0.125, -0.375), vec2(0.375, -0.125));
        for (int i = 0; i < 4; i++) {
            float unused;
            col += renderSample(fragCoord + offsets[i], time, rot, distortion, unused);
        }
        col /= 5.0;
#if SHOW_EDGES
        col = mix(col, vec3(1.0, 0.0, 0.0), 0.6);
#endif
    }
#endif

    f_color = vec4(col, .0);
}
