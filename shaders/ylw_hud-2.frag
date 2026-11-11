#version 450
#include "util/common.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float opacity;  // 0..1 = 0.85
    float margin;   // 0..120 = 36      frame inset, px
    float flicker;  // 0..1 = 0.3       HUD flashes on beat
    vec4  tint;     // color = 1,0.95,0.2
    bool  frame;    // = false          rounded border + corner marks
};

// anti-aliased line of half-width w px around distance d (px)
float line(float d, float w) { return 1.0 - smoothstep(w - 0.75, w + 0.75, abs(d)); }

float rbox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
    vec3 src = texture(u_tex0, v_uv).rgb;
    vec2 px = v_uv * u_resolution;               // top-left origin, pixels
    vec2 res = u_resolution;
    float s = u_scale;
    float m = margin * s;
    float lw = 0.9 * s;

    float hud = 0.0;
    float rail_x = res.x - m - 40.0 * s;         // right rail
    float bar_y  = res.y - m - 64.0 * s;         // bottom strip

    // main frame: rounded box, its right edge stops at the rail area
    vec2 c = vec2((m + rail_x - 22.0 * s) * 0.5, (m + bar_y - 10.0 * s) * 0.5);
    vec2 b = vec2((rail_x - 22.0 * s - m) * 0.5, (bar_y - 10.0 * s - m) * 0.5);
    if (frame) hud += line(rbox(px - c, b, 18.0 * s), lw);

    // right rail with end dots and a playhead moving over 4 bars
    float top = m + 18.0 * s, bot = bar_y - 28.0 * s;
    if (px.y > top && px.y < bot) hud += line(px.x - rail_x, lw);
    hud += line(length(px - vec2(rail_x, top)) - 5.0 * s, lw);
    hud += line(length(px - vec2(rail_x, bot)) - 5.0 * s, lw);
    float head = mix(top, bot, fract(u_beats / 16.0));
    hud += (1.0 - smoothstep(3.0 * s, 4.5 * s, length(px - vec2(rail_x, head))));
    // ticks: one per beat of the bar
    for (int i = 1; i < 16; i++) {
        float ty = mix(top, bot, float(i) / 16.0);
        float len = (i % 4 == 0) ? 10.0 : 4.0;
        if (abs(px.x - rail_x) < len * s) hud += line(px.y - ty, lw * 0.8) * 0.7;
    }

    // bottom strip: rule + separators
    if (px.x > m && px.x < res.x - m) hud += line(px.y - bar_y, lw) * 0.6;
    float sy = bar_y + 32.0 * s;
    for (int i = 0; i < 3; i++) {
        float x0 = m + 300.0 * s + float(i) * 12.0 * s;
        vec2 q = px - vec2(x0, sy);
        if (abs(q.y) < 12.0 * s) hud += line(q.x + q.y * 0.35, lw);   // "///"
    }
    // icon box bottom-right with a beat-lit glyph
    vec2 ib = vec2(res.x - m - 40.0 * s, sy);
    hud += line(rbox(px - ib, vec2(26.0 * s), 6.0 * s), lw);
    for (int i = 0; i < 3; i++) {
        float gx = ib.x + (float(i) - 1.0) * 9.0 * s;
        if (abs(px.y - ib.y - 3.0 * s) < 13.0 * s) hud += line(px.x - gx, lw) * (0.5 + 0.5 * u_beat);
    }
    if (abs(px.x - ib.x) < 15.0 * s) hud += line(px.y - ib.y + 8.0 * s, lw);

    // corner crosshair marks
    for (int i = 0; i < (frame ? 4 : 0); i++) {
        vec2 k = vec2((i & 1) == 0 ? m * 0.5 : res.x - m * 0.5, (i & 2) == 0 ? m * 0.5 : res.y - m * 0.5);
        vec2 q = abs(px - k);
        hud += (line(q.x, lw * 0.7) * step(q.y, 6.0 * s) + line(q.y, lw * 0.7) * step(q.x, 6.0 * s)) * 0.7;
    }

    // darken the strip under the text a little
    float strip = smoothstep(bar_y - 2.0, bar_y + 2.0, px.y);
    src *= 1.0 - 0.55 * strip;

    float a = clamp(hud, 0.0, 1.0) * opacity * (1.0 - flicker * 0.5 + flicker * 0.5 * u_beat);
    f_color = vec4(mix(src, tint.rgb, a), 1.0);
}
