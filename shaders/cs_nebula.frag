#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// Deep-space backdrop: domain-warped gas in indigo / violet / magenta / cyan with
// real blacks between (this cell plays on a Screen layer), and three star layers.
// Also the environment the chrome rings of cs_armillary reflect.
// Kick (pad 1) pumps the gas, hats (pad 3) make the stars sparkle.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;  // 0..2 = 0.25     gas drift
    float scale;  // 0.3..4 = 1.1    size of the clouds
    float warp;   // 0..4 = 2.2      how much the gas curls
    float gas;    // 0..2 = 1        gas brightness
    float stars;  // 0..2 = 1        star brightness
    int   every;  // 1..64 = 8       beats per shot (same as cs_armillary)
    vec4  indigo;  // color = 0.07,0.05,0.38
    vec4  violet;  // color = 0.38,0.08,0.78
    vec4  magenta; // color = 0.98,0.10,0.56
    vec4  cyan;    // color = 0.05,0.72,0.95
    vec4  ember;   // color = 1.0,0.68,0.32
};

vec3 star_layer(vec2 p, float cells, float seed, float sparkle) {
    vec2 g = p * cells;
    vec2 id = floor(g);
    vec2 f = fract(g);
    vec3 sum = vec3(0.0);
    vec2 h = hash22(id + seed);
    float pick = hash21(id + seed + 7.0);
    if (pick > 0.72) {
        float d = length(f - (0.2 + 0.6 * h));
        float mag = pow((pick - 0.72) / 0.28, 3.0);
        float tw = 0.75 + 0.25 * sin(u_time * (1.0 + 3.0 * h.x) + h.y * 40.0);
        if (hash21(id + seed + floor(u_beats * 4.0)) > 0.8) tw += sparkle * 3.0;
        float core = exp(-d * d * (900.0 + 2400.0 * (1.0 - mag)));
        vec3 tint = mix(vec3(0.75, 0.86, 1.0), mix(ember.rgb, cyan.rgb, h.y), 0.45 * h.x);
        sum = tint * core * (0.25 + 1.6 * mag) * tw;
    }
    return sum;
}

void main() {
    vec2 p = to_centered(world_uv(v_uv));
    float shot = floor(u_beats / float(every));
    float kick = u_triggers.x * u_triggers.x;

    // Each shot looks at another part of the sky.
    vec2 sky = (hash22(vec2(shot, 3.0)) - 0.5) * 12.0;
    float ang = hash21(vec2(shot, 5.0)) * 6.283;
    vec2 q0 = rotate_deg(p, ang * 57.3) * (1.0 - 0.05 * kick);

    float t = u_time * speed * 0.2;
    vec2 s = q0 * scale + sky;
    vec2 q = vec2(fbm(s + vec2(t, 0.0), 4), fbm(s + vec2(5.2, 1.3 - t * 0.7), 4));
    float d = fbm(s + q * warp, 5);
    float e = fbm(s * 1.7 - q.yx * warp + 9.0 + t * 0.4, 4);
    float dust = smoothstep(0.28, 0.62, fbm(s * 2.3 + q * 1.4 + 3.1, 4));

    // Dark first; color only where the gas is thick.
    vec3 col = vec3(0.0);
    col = mix(col, indigo.rgb, smoothstep(0.34, 0.62, d));
    col = mix(col, violet.rgb, smoothstep(0.48, 0.72, d));
    col = mix(col, magenta.rgb, smoothstep(0.58, 0.82, d * (0.65 + 0.7 * e)));
    col += cyan.rgb * pow(smoothstep(0.5, 0.85, e), 2.0) * smoothstep(0.38, 0.62, d) * 0.8;
    col += ember.rgb * pow(smoothstep(0.68, 0.9, d), 3.0) * 1.2;
    col *= mix(0.25, 1.0, dust);
    col *= gas * (1.0 + 0.45 * kick);

    float sparkle = u_triggers.z;
    vec3 st = star_layer(q0 + sky, 26.0, 11.0, sparkle)
            + star_layer(q0 * 1.02 + sky, 58.0, 23.0, sparkle) * 0.75
            + star_layer(q0 * 1.05 + sky, 120.0, 37.0, sparkle) * 0.5;
    col += st * stars * mix(1.0, 0.5, smoothstep(0.5, 0.8, d));

    f_color = vec4(col, 1.0);
}
