#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

// Aerial view: streaking clouds above a tilted horizon, forest and lakes below.

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;    // 0..2 = 0.2        flight speed
    float tilt;     // -60..60 = 28      horizon roll (degrees)
    float horizon;  // -1..1 = -0.3      horizon height
    float streak;   // 0..1 = 0.6        cloud motion streaks
    float cover;    // 0..1 = 0.55       amount of cloud
    float lake;     // 0..1 = 0.45       amount of water
    vec4  sky_top;  // color = 0.36,0.64,0.93
    vec4  sky_low;  // color = 0.87,0.93,0.99
    vec4  forest;   // color = 0.13,0.30,0.12
};

void main() {
    vec2 p = rotate_deg(to_centered(v_uv), -tilt);
    p.y -= horizon;
    float t = u_time * speed;
    vec3 col;

    if (p.y > 0.0) {
        vec3 sky = mix(sky_low.rgb, sky_top.rgb, smoothstep(0.0, 1.1, p.y));
        // cloud layer above, streaked towards the vanishing point
        float depth = 0.35 / max(p.y, 0.02);
        vec2 cp = vec2(p.x * depth, depth + t * 1.5) * vec2(3.0, 1.4);
        float cl = 0.0;
        for (int i = 0; i < 6; i++) {
            cl += fbm(cp + vec2(0.0, float(i) / 5.0 * streak * 0.35), 5);
        }
        cl /= 6.0;
        float th = 0.6 - cover * 0.25;
        float dens = smoothstep(th, th + 0.12, cl) * smoothstep(0.0, 0.2, p.y);
        float lit = smoothstep(th, th + 0.3, cl);
        col = mix(sky, mix(vec3(0.82, 0.87, 0.94), vec3(1.0), lit), dens * 0.95);
        // distant blue mountains on the horizon
        float ridge = 0.025 + 0.05 * fbm(vec2(p.x * 2.5 + 3.0, 3.0), 4);
        if (p.y < ridge) col = mix(vec3(0.22, 0.38, 0.55), sky_low.rgb, 0.35 + 0.3 * p.y / ridge);
    } else {
        float y = -p.y;
        float depth = 1.0 / max(y, 0.004);
        vec2 gp = vec2(p.x * depth, depth + t * 3.0);
        float far = smoothstep(0.0, 0.3, y);   // detail fades towards the horizon
        // forest canopy
        float detail = fbm(gp * 3.0, 4);
        float tree = fbm(gp * 14.0, 3);
        vec3 f = forest.rgb * (0.55 + 0.9 * detail) * mix(1.0, 0.45 + 1.1 * tree, far);
        f = mix(f, f * vec3(1.3, 1.3, 0.8) + vec3(0.06, 0.09, 0.0), smoothstep(0.5, 0.8, fbm(gp * 0.8 + 7.0, 3)) * 0.6);
        // lakes reflecting the sky
        float th = 0.64 - lake * 0.25;
        float ln = fbm(gp * 0.3 + 11.0, 4);
        float water = smoothstep(th, th + 0.015, ln);
        float shore = smoothstep(th - 0.02, th, ln) * (1.0 - water);
        vec3 w = mix(vec3(0.16, 0.34, 0.55), sky_low.rgb, 0.15 + 0.35 * noise2(gp * vec2(1.5, 7.0) + t));
        col = mix(f * (1.0 - 0.4 * shore), w, water);
        col = mix(col, sky_low.rgb * 0.92, exp(-y * 14.0));   // haze
    }
    f_color = vec4(clamp(col, 0.0, 1.0), 1.0);
}
