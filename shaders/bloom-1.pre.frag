#version 450
#include "util/common.glsl"
#include "util/bloom.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float threshold;
    float knee;
    float radius;   // full-resolution pixels
};

const int TAPS = 24;   // per side

// Bloom pass 1 (the node's pre-pass, drawn at half resolution in the
// world's layout: v_uv is a world UV): bright pass, blurred horizontally
// (Gaussian, sigma = radius / 2). Offsets are in full-size world pixels
// (u_world_resolution), so the size of this pass doesn't matter; at half
// size each fetch lands between 2 × 2 input pixels and averages them.
// `bloom.frag` blurs it vertically.
void main() {
    world_home(v_uv);
    float r = radius * u_scale;   // in render pixels
    vec3 sum = bloom_bright(sample_world(u_tex0, v_uv).rgb, threshold, knee);
    if (r >= 0.5) {
        float k = -2.0 / (r * r);
        float step = r / float(TAPS);
        float texel = 1.0 / u_world_resolution.x;
        float weight_sum = 1.0;
        for (int i = 1; i <= TAPS; i++) {
            float o = float(i) * step;
            float w = exp(k * o * o);
            vec2 offset = vec2(o * texel, 0.0);
            sum += (bloom_bright(sample_world(u_tex0, v_uv + offset).rgb, threshold, knee)
                  + bloom_bright(sample_world(u_tex0, v_uv - offset).rgb, threshold, knee)) * w;
            weight_sum += 2.0 * w;
        }
        sum /= weight_sum;
    }
    f_color = vec4(sum, 1.0);
}
