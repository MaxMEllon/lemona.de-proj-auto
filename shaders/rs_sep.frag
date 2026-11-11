#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// The poster: cuts the frame into panels and writes ink coverage, not color.
// R, G, B = how much of inks 1, 2, 3 goes on the paper (rs_print prints them).
// in0: rs_form (tone, silhouette, rim). in1: the Text node (white on black).

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   every;    // 1..32 = 8       beats per layout
    int   panels;   // 1..6 = 4        most columns in a layout
    float crop;     // 0..1 = 0.55     how far panels crop the form apart
    float slide;    // 0..1 = 0.5      kick pushing the columns up and down
    float wash;     // 0..1 = 0.55     flat tint behind the form
    float drop;     // 0..1 = 0.85     flat offset shadow of the form
    float type_ink; // 0..1 = 1        the big number
    float type_size; // 0.5..4 = 1.7   its size
    float marks;    // 0..1 = 1        crop marks and color bar
    float margin;   // 0..0.1 = 0.035  unprinted paper around the poster
};

float box_mask(vec2 p, vec2 c, vec2 b) {
    vec2 d = abs(p - c) - b;
    return step(max(d.x, d.y), 0.0);
}

void main() {
    vec2 w = world_uv(v_uv);
    float asp = aspect();
    vec2 m = vec2(margin / asp, margin);
    vec2 uv = (w - m) / (1.0 - 2.0 * m);

    float seed = floor(u_beats / float(every));
    float bar = floor(u_beats / 4.0);
    float kick = u_triggers.x;

    vec3 cov = vec3(0.0);

    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
        // Columns of uneven width.
        int n = 1 + int(hash21(vec2(seed, 1.0)) * float(panels));
        float total = 0.0;
        for (int i = 0; i < n; i++) total += 0.35 + hash21(vec2(seed + 2.0, float(i)));
        float x0 = 0.0;
        int col = n - 1;
        float acc = 0.0;
        for (int i = 0; i < n; i++) {
            float wd = (0.35 + hash21(vec2(seed + 2.0, float(i)))) / total;
            if (uv.x < acc + wd) { col = i; x0 = acc; break; }
            acc += wd;
        }

        // Each column may be cut once across.
        float fc = float(col);
        float cut = mix(0.28, 0.72, hash21(vec2(seed + 5.0, fc)));
        bool split = hash21(vec2(fc, seed + 9.0)) > 0.45;
        float row = split && uv.y > cut ? 1.0 : 0.0;
        float ps = seed * 1.37 + fc * 3.1 + row * 7.7;

        // Which ink does what here; the whole order turns over every bar.
        float roll = floor(hash21(vec2(ps, 3.0)) * 3.0) + bar;
        int a = int(mod(roll, 3.0));
        int b = int(mod(roll + 1.0, 3.0));
        int c = int(mod(roll + 2.0, 3.0));

        vec2 off = (hash22(vec2(ps, 11.0)) - 0.5) * crop * 0.7;
        off.y += (mod(fc, 2.0) * 2.0 - 1.0) * kick * kick * slide * 0.12;
        vec2 sw = w + off;

        vec4 f = sample_world(u_tex0, sw);
        float tone = f.r, mask = f.g, rim = f.b;

        // Behind the form: bare paper, a flat tint or a ramp.
        float bgk = hash21(vec2(ps, 17.0));
        if (bgk > 0.55)      cov[c] = wash;
        else if (bgk > 0.15) cov[c] = wash * clamp(uv.y * 1.4 - 0.1, 0.0, 1.0);

        // Flat shadow, thrown down and to the right.
        float ds = sample_world(u_tex0, sw - vec2(0.018, 0.034)).g;
        cov[b] = max(cov[b], ds * drop);

        // The form knocks out what's behind it, then prints its tones.
        cov *= 1.0 - mask;
        float dark = 1.0 - tone;
        cov[a] += mask * pow(dark, 1.3);
        cov[b] += mask * smoothstep(0.1, 0.95, dark) * 0.6;
        cov[c] += mask * max(rim * 0.9, 0.1 * tone);

        // The number, oversized and cropped: knocked out of whatever is printed
        // here, printed solid on bare paper, so it always reads.
        vec2 tp = (hash22(vec2(seed, 29.0)) - 0.5) * vec2(0.5, 0.3);
        float tz = type_size * (0.8 + 0.4 * hash21(vec2(seed, 31.0)));
        float t = sample_world(u_tex1, (w - 0.5) / tz + 0.5 + tp).r * type_ink;
        float busy = smoothstep(0.1, 0.3, max(cov.r, max(cov.g, cov.b)));
        int ti = int(mod(seed + bar, 3.0));
        vec3 printed = cov;
        printed[ti] = max(printed[ti], t);
        cov = mix(printed, cov * (1.0 - t), busy);

        // Accent (pad 4) floods a panel in its own ink.
        if (hash21(vec2(ps, floor(u_beats))) > 0.55) {
            float fl = u_triggers.w;
            cov[c] = max(cov[c], fl * fl);
        }

        // Thin keylines between panels, all inks: they show the misregistration.
        float px = 1.5 * u_scale / u_world_resolution.x;
        float line = step(abs(uv.x - x0), px) * step(0.001, x0);
        if (split) line = max(line, step(abs(uv.y - cut), px * asp));
        cov = max(cov, vec3(line * marks));
    } else {
        // Crop marks at the corners, in all inks.
        vec2 lw = vec2(1.5 * u_scale) / u_world_resolution;
        vec2 e = abs(w - 0.5) - (0.5 - m);
        float mk = step(abs(e.x + m.x * 0.0), lw.x) * step(e.y, m.y * 0.75) * step(0.15 * m.y, e.y)
                 + step(abs(e.y), lw.y) * step(e.x, m.x * 0.75) * step(0.15 * m.x, e.x);
        cov = vec3(clamp(mk, 0.0, 1.0) * marks);

        // Color bar along the bottom edge: solid patches of each ink; hats (pad 3)
        // overprint all three on the patch of the current 16th.
        float bx = 0.06;
        float pw = 0.0125;
        float by = 1.0 - m.y * 0.5;
        if (abs(w.y - by) < m.y * 0.22 && w.x > bx && w.x < bx + pw * 12.0) {
            float i = floor((w.x - bx) / pw);
            float gap = step(fract((w.x - bx) / pw), 0.8);
            int ink = int(mod(i, 3.0));
            cov[ink] = gap;
            float st = mod(floor(u_beats * 4.0), 12.0);
            if (i == st) cov = max(cov, vec3(u_triggers.z * gap));
            cov *= marks;
        }
    }

    f_color = vec4(clamp(cov, 0.0, 1.0), 1.0);
}
