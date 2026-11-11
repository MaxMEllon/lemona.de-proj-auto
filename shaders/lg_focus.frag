#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// A logo pulled into focus, like a lens hunting for it. Connect the logo to in0.
// Each cycle: close on the focus point, deep out of focus -> the lens hunts,
// overshooting, and locks on -> pulls back to the whole logo -> holds, breathing on
// the kick -> hunts again in 8ths -> melts away into bokeh.
// Focus spreads outward from the point, so it sharpens first and the edges follow.
// A blurred copy sits behind for depth; a reticle closes in and blinks on lock.
// Pad 1 / low hit = a rack on the beat, pad 2 = lose focus, snap back.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   cycle;    // 2..32 = 8         bars per cycle
    float depth;    // 0..160 = 90       deepest blur (px)
    float push;     // 1..4 = 2.6        how close it starts
    float focusX;   // 0..1 = 0.5        focus point
    float focusY;   // 0..1 = 0.454
    float spread;   // 0..1 = 0.6        focus spreads out from the point
    float fringe;   // 0..1 = 0.5        color fringes in the blur
    float ghost;    // 0..1 = 0.14       blurred copy behind
    bool  reticle;  // = true
    vec4  tint;     // color = 1,1,1
    float react;    // 0..1 = 0.7        pads and audio hits
};

const float GOLD = 2.39996323;
const int TAPS = 44;

float sm(float a, float b, float x) { return smoothstep(a, b, x); }
float H(float x) { return hash21(vec2(x * 0.731 + 1.9, 4.27)); }

// A lens disc, slightly tall, each tap split by its distance from the middle.
vec3 discBlur(vec2 w, float radPx, float jitter) {
    vec2 unit = vec2(u_scale / u_world_resolution.x, u_scale / u_world_resolution.y);
    if (radPx < 0.4) {
        vec3 c = sample_world(u_tex0, w).rgb;
        return c * c;
    }
    vec3 acc = vec3(0.0);
    vec3 wsum = vec3(0.0);
    float fr = fringe * 0.16;
    for (int i = 0; i < TAPS; i++) {
        float t = (float(i) + 0.5) / float(TAPS);
        float r = sqrt(t);
        float a = float(i) * GOLD + jitter;
        vec2 off = vec2(cos(a), sin(a)) * r * radPx * unit * vec2(0.86, 1.0);
        float s = dot(sample_world(u_tex0, w + off).rgb, vec3(0.333));
        s *= s;
        // Red lands wide, blue lands tight: a colored rim on each bokeh disc.
        vec3 band = vec3(1.0 - fr + 2.0 * fr * r, 1.0, 1.0 + fr - 2.0 * fr * r);
        acc += s * band;
        wsum += band;
    }
    return acc / wsum;
}

void main() {
    vec2 w = world_uv(v_uv);
    if (w.x < 0.0) { f_color = vec4(0.0, 0.0, 0.0, 1.0); return; }

    float B = u_beats;
    float len = 4.0 * float(max(cycle, 2));
    float pos = mod(B, len);
    float arrive = min(4.0, len * 0.25);
    float huntAt = len - 8.0 > arrive + 2.0 ? len - 8.0 : len - 3.0;
    float meltAt = len - 4.0 > huntAt ? len - 4.0 : len - 1.5;

    // How far out of focus, 0..1, and where the camera sits.
    float blur = 0.0;
    float zoom = 1.0;
    float lockPulse = 0.0;
    float fade = 1.0;
    if (pos < arrive) {
        float k = pos / arrive;
        // The hunt: swinging through focus, each swing smaller.
        blur = pow(1.0 - k, 1.5) * abs(cos(k * 9.42));
        blur = max(blur, (1.0 - sm(0.0, 0.2, k)));
        zoom = mix(push, push * 0.86, k);
        fade = sm(0.0, 0.06, k);
    } else {
        float k = pos - arrive;
        lockPulse = exp(-k * 3.2);
        // A fast pull back to the whole logo, right after the lock.
        zoom = mix(push * 0.86, 1.0, 1.0 - pow(1.0 - clamp(k / 2.5, 0.0, 1.0), 4.0));
        zoom *= 1.0 + 0.0022 * (pos - arrive);
        if (pos > huntAt && pos < meltAt) {
            float n = floor(pos * 2.0);
            blur = step(0.45, H(n)) * mix(0.14, 0.55, H(n + 3.0)) * exp(-fract(pos * 2.0) * 1.6);
        } else if (pos >= meltAt) {
            float m = (pos - meltAt) / (len - meltAt);
            blur = pow(m, 1.6);
            fade = 1.0 - sm(0.72, 1.0, m);
        }
    }

    // The kick breathes through the lens while it holds.
    float low = max(u_triggers.x, u_hits.y * 0.8) * react;
    float kick = pow(max(u_beat, 0.0), 3.0);
    float hold = (pos > arrive + 1.5 && pos < huntAt) ? 1.0 : 0.0;
    blur = max(blur, hold * max(kick * 0.035, low * low * 0.1));
    blur = max(blur, u_triggers.y * react);
    zoom *= 1.0 + hold * kick * 0.012;

    // Where this pixel reads the logo.
    vec2 fp = vec2(focusX, focusY);
    vec2 d = w - fp;
    vec2 wZ = fp + d / zoom;

    // Focus opens outward from the point.
    float asp = aspect();
    float dist = length(d * vec2(asp, 1.0));
    float local = mix(1.0, 0.1 + 1.25 * sm(0.0, 0.55, dist), spread);
    float rad = blur * depth * local;

    float jitter = hash21(floor(w * u_world_resolution)) * 6.2831853;
    vec3 lin = discBlur(wZ, rad, jitter);

    // The blurred copy behind, a little larger, drifting.
    if (ghost > 0.01) {
        vec2 gw = fp + (wZ - fp) / 1.16 + vec2(sin(u_time * 0.21), cos(u_time * 0.17)) * 0.006;
        vec3 back = discBlur(gw, 58.0 + 26.0 * blur, jitter + 1.0);
        lin = max(lin, back * ghost * (0.75 + 0.5 * kick));
    }

    lin *= fade;

    // Focus breathes light into the logo: blur keeps the energy, the lock adds a kick.
    lin *= 1.0 + lockPulse * 1.6;
    vec3 col = sqrt(max(lin, vec3(0.0))) * tint.rgb;

    // A glint in the eye as it locks.
    vec2 ge = (w - fp) * vec2(asp, 1.0);
    float gl = exp(-dot(ge, ge) * 900.0) + 0.35 * exp(-ge.y * ge.y * 11000.0) * exp(-abs(ge.x) * 8.0);
    col += tint.rgb * gl * lockPulse * 1.5 * step(arrive, pos);

    // The reticle closes in as it hunts, blinks on the lock, and goes.
    if (reticle) {
        float show = 0.0;
        float size = 0.07;
        if (pos < arrive) {
            float k = pos / arrive;
            size = mix(0.3, 0.075, pow(k, 0.7));
            show = sm(0.0, 0.1, k) * step(0.25, fract(pos * 4.0));
        } else if (pos < arrive + 1.5) {
            size = 0.075;
            show = step(0.5, fract((pos - arrive) * 4.0)) * 1.0;
        } else if (pos > huntAt && pos < meltAt) {
            float n = floor(pos * 2.0);
            size = mix(0.12, 0.2, H(n + 7.0));
            show = step(0.45, H(n)) * 0.8;
        }
        if (show > 0.0) {
            vec2 q = abs(d * vec2(asp, 1.0));
            vec2 box = vec2(size * 1.25, size);
            float th = 0.0016;
            float armL = size * 0.33;
            vec2 e = q - box;
            float hor = step(abs(e.y), th) * step(e.x, th) * step(-armL, e.x);
            float ver = step(abs(e.x), th) * step(e.y, th) * step(-armL, e.y);
            col = max(col, tint.rgb * max(hor, ver) * show);
        }
    }

    f_color = vec4(max(col, vec3(0.0)), 1.0);
}
