#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;    // 0..2 = 0.06       cloud drift
    float scale;    // 0.2..6 = 1.3      cloud size (higher = smaller)
    float cover;    // 0..1 = 0.5        amount of cloud
    float sun;      // 0..2 = 1          sun glow
    float sun_x;    // -1..1 = 0.55
    float sun_y;    // -1..1 = 0.35
    vec4  top;      // color = 0.0,0.33,0.78
    vec4  horizon;  // color = 0.55,0.87,1.0
    vec4  cloud;    // color = 1,1,1
};

float clouds(vec2 p, vec2 drift) {
    return fbm(p + drift, 6) * 0.85 + fbm(p * 2.4 - drift + 3.0, 3) * 0.15;
}

void main() {
    vec2 c = to_centered(v_uv);
    vec2 sp = vec2(sun_x * aspect(), sun_y);
    float ds = length(c - sp);
    vec3 sky = mix(horizon.rgb, top.rgb, smoothstep(0.0, 1.9, ds));

    vec2 p = c * scale;
    vec2 drift = vec2(u_time * speed, u_time * speed * 0.3);
    float d = clouds(p, drift);
    float th = 0.62 - cover * 0.3;
    float dens = smoothstep(th, th + 0.07, d);
    // lit from the sun's side
    vec2 to_sun = normalize(sp - c + 1e-4);
    float toward = clouds(p + to_sun * 0.05, drift);
    float shade = clamp(1.0 + (d - toward) * 5.0, 0.62, 1.05);
    vec3 cl = mix(top.rgb * 0.5 + 0.45, cloud.rgb, shade);

    vec3 col = mix(sky, cl, dens);
    col += sun * (exp(-ds * 2.5) * 0.45 + exp(-ds * 10.0) * 0.5) * vec3(1.0, 0.98, 0.95);
    f_color = vec4(clamp(col, 0.0, 1.0), 1.0);
}
