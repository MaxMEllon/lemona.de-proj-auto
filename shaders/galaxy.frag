#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

// A spiral galaxy in deep space: tilted disk with log-spiral arms, dust lanes,
// star-forming knots and a glowing core, over a nebula and a star field the
// camera drifts through. Kick pulses the core, hats make the stars sparkle,
// mids light up the nebula.

layout(set = 0, binding = 1) uniform NodeParams {
    vec4  armcolor;  // color = 0.45,0.62,1      arm (young star) color
    vec4  corecolor; // color = 1,0.78,0.5       core / bulge color
    vec4  nebcolor;  // color = 0.75,0.22,0.65   background nebula color
    float speed;     // 0..4 = 1                 galaxy rotation
    float size;      // 0.2..3 = 1
    float tilt;      // 0..85 = 58               disk tilt (degrees)
    float angle;     // -180..180 = -25          disk angle in frame
    int   arms;      // 1..6 = 2
    float twist;     // 0..10 = 4.5              arm winding
    float dust;      // 0..1 = 0.65              dark dust lanes
    float core;      // 0..3 = 1.2               core brightness
    float nebula;    // 0..2 = 0.6
    float stars;     // 0..2 = 1                 background stars
    float drift;     // 0..2 = 0.3               camera flying through stars
    float react;     // 0..2 = 1                 audio reactivity
    float hue;       // 0..1 = 0                 colors → show palette
    float x;         // -1..1 = 0
    float y;         // -1..1 = 0
};

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec3 star_color(float h) {
    return h < 0.33 ? vec3(0.65, 0.78, 1.0) : (h < 0.8 ? vec3(1.0) : vec3(1.0, 0.8, 0.55));
}

// One layer of point stars on a grid, `cells` cells per unit.
vec3 star_layer(vec2 p, float cells, float seed, float density, float px) {
    vec2 g = p * cells;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash21(id + seed);
    if (h < 1.0 - density) return vec3(0.0);
    vec2 o = (hash22(id + seed * 1.7) - 0.5) * 0.7;
    float d = length(f - o) / cells;              // distance in frame units
    float b = (h - (1.0 - density)) / density;    // 0..1 brightness
    b = b * b;
    float tw = 0.65 + 0.35 * sin(u_time * (1.5 + h * 6.0) + h * 80.0);
    tw += u_hits.w * react * step(0.6, fract(h * 37.0)) * 1.5;
    float r = px * (0.8 + 1.4 * b);
    float s = exp(-d * d / (r * r)) + 0.12 * b * exp(-d / (r * 1.5));
    return star_color(fract(h * 13.7)) * s * b * tw;
}

void main() {
    float px = 2.0 / u_resolution.y;
    vec2 p0 = to_centered(v_uv);
    float t = u_time;

    // ---- star field: layers flying towards the camera ----
    vec3 col = vec3(0.0);
    for (int i = 0; i < 4; i++) {
        float z = fract(float(i) / 4.0 + t * drift * 0.03);
        float scale = mix(28.0, 3.0, z);          // far → near
        float fade = smoothstep(0.0, 0.3, z) * smoothstep(1.0, 0.85, z);
        vec2 sp = p0 * rot(t * 0.004) / (0.4 + z * 1.2);
        col += star_layer(sp, scale, float(i) * 17.0 + floor(float(i) / 4.0 + t * drift * 0.03) * 5.3, 0.12, px * scale / 12.0) * fade;
    }
    col += star_layer(p0, 110.0, 91.0, 0.25, px) * 0.5;  // fine dust of tiny stars
    col *= stars;

    // ---- nebula ----
    vec2 np = p0 * 1.3 + vec2(t * 0.006, -t * 0.004);
    vec2 w = vec2(fbm(np + 3.1, 4), fbm(np + 7.7, 4));
    float n = fbm(np + w * 1.8, 5);
    float n2 = fbm(np * 2.3 - w + 11.0, 4);
    vec3 nc1 = mix(nebcolor.rgb, palette(fract(n * 0.6 + 0.3)), hue);
    vec3 nc2 = mix(vec3(0.15, 0.35, 0.9), palette(fract(n2 * 0.6 + 0.7)), hue);
    float neb = smoothstep(0.42, 0.85, n);
    vec3 nebc = nc1 * neb * neb + nc2 * smoothstep(0.5, 0.9, n2) * 0.5;
    nebc *= 1.0 - 0.6 * smoothstep(0.55, 0.75, fbm(np * 4.0 + 20.0, 4));  // dark filaments
    col += nebc * nebula * (0.35 + react * u_bands.z * 0.8);

    // ---- galaxy ----
    vec2 q = p0 - frame_offset(x, y);
    q = rot(radians(angle)) * q;
    q /= size * 0.75 * (1.0 + react * u_hits.y * 0.04);
    q.y /= max(cos(radians(tilt)), 0.12);
    float r = length(q);
    float spin = mod(t * speed * 0.08, 6.2831853);
    float a = atan(q.y, q.x) - spin;
    vec2 qr = vec2(cos(a), sin(a)) * r;           // co-rotating coordinates

    float warp = (fbm(qr * 3.0, 4) - 0.5) * 2.2;
    float phi = float(arms) * a + twist * log(r + 0.02) * float(arms) * 0.5 + warp;
    float armd = pow(0.5 + 0.5 * cos(phi), 2.5);
    float env = exp(-r * 2.2) * smoothstep(0.0, 0.12, r);
    float gas = fbm(qr * 7.0 + 4.0, 5);
    float disk = exp(-r * 3.5);

    vec3 armc = mix(armcolor.rgb, palette(fract(r * 0.8 + 0.2)), hue);
    vec3 corec = mix(corecolor.rgb, palette(0.05), hue);
    vec3 gal = armc * armd * env * (0.5 + 1.2 * gas) * 2.2;
    gal += mix(corec, armc, smoothstep(0.0, 0.6, r)) * disk * 0.55;   // diffuse disk

    // star-forming knots (pink / blue) strung along the arms
    vec2 kg = qr * 38.0;
    vec2 kid = floor(kg);
    float kh = hash21(kid + 3.0);
    vec2 ko = hash22(kid) - 0.5;
    float kd = length(fract(kg) - 0.5 - ko * 0.6);
    float knot = smoothstep(0.25, 0.0, kd) * step(0.82, kh) * armd * env;
    vec3 knotc = kh > 0.93 ? vec3(1.0, 0.45, 0.75) : vec3(0.75, 0.88, 1.0);
    gal += knotc * knot * 2.5 * (1.0 + react * u_hits.w);

    // resolved stars in the disk
    gal += star_layer(qr, 70.0, 5.0, 0.3, px * 0.9) * (armd * 1.5 + 0.2) * env * 3.0;

    // dust lanes on the inner edge of the arms
    float lane = pow(0.5 + 0.5 * cos(phi + 0.75), 7.0);
    float dmask = lane * smoothstep(0.35, 0.7, fbm(qr * 14.0 + 9.0, 4)) * smoothstep(0.05, 0.25, r) * exp(-r * 1.5);
    gal *= 1.0 - clamp(dust * dmask * 2.2, 0.0, 0.92);
    col *= 1.0 - clamp(dust * dmask * 1.5 * env * 3.0, 0.0, 0.8);

    // core + bulge
    float pulse = 1.0 + react * (u_hits.y * 0.9 + u_beat * 0.25);
    float rc = length(vec2(q.x, q.y * mix(1.0, max(cos(radians(tilt)), 0.12), 0.7)));
    gal += corec * (exp(-rc * rc / 0.0025) * 2.2 + exp(-rc / 0.09) * 0.8) * core * pulse;
    gal += vec3(1.0, 0.95, 0.9) * exp(-rc * rc / 0.0003) * core * pulse;

    col += gal;

    // filmic tone map
    col = 1.0 - exp(-col * 1.15);
    col = pow(col, vec3(0.92));
    f_color = vec4(col, 1.0);
}
