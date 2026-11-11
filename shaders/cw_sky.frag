#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;     // 0..2 = 0.12       cloud drift
    float scale;     // 0.2..6 = 0.9      cloud size (higher = smaller)
    float cover;     // 0..1 = 0.48      amount of cloud
    float softness;  // 0..1 = 0.45       cloud edge softness
    vec4  top;       // color = 0.20,0.31,0.43
    vec4  horizon;   // color = 0.58,0.67,0.76
    vec4  cloud;     // color = 0.97,0.98,1.0
};

float clouds(vec2 p, vec2 drift) {
    return fbm(p + drift, 5) * 0.85 + fbm(p * 2.1 + drift * 1.6 + 5.0, 3) * 0.15;
}

void main() {
    vec2 c = to_centered(v_uv);
    vec2 p = c * scale;
    float t = u_time * speed;
    vec2 drift = vec2(t, t * 0.2);

    float th = 0.62 - cover * 0.3;
    float soft = 0.03 + softness * 0.2;
    float d = clouds(p, drift);
    float dens = smoothstep(th, th + soft, d);
    // lit from above: density just above this point shades the underside
    float above = clouds(p + vec2(0.0, 0.07), drift);
    float shade = clamp(0.92 + (d - above) * 4.0, 0.62, 1.06);
    shade *= mix(0.88, 1.0, smoothstep(th, th + 0.25, d));

    vec3 sky = mix(horizon.rgb, top.rgb, smoothstep(-1.0, 1.0, c.y));
    vec3 cl = mix(top.rgb * 0.9 + 0.25, cloud.rgb, shade) * shade;
    f_color = vec4(mix(sky, cl, dens), 1.0);
}
