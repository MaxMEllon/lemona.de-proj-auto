#version 450
#include "util/common.glsl"
#include "util/uv.glsl"
#include "util/noise.glsl"

// EDM in space: a black hole with a lensed accretion disk (rays bend around it),
// stars and nebula behind, arranged like a track:
//   drop   lasers, a shock ring through the disk on every beat, the spectrum
//          standing on the disk, the background pumping like a sidechain
//   calm   the disk alone, drifting
//   build  warp streaks and a rising strobe, into a white hit and the next drop
// The camera cuts every 4 bars. Audio: fft on the disk, low hit = kick.
// Pad 1 = kick, pad 2 = shock ring, pad 3 = laser burst.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    int   section;  // auto|drop|calm|build = auto
    int   cycle;    // 4..64 = 16        bars from one drop to the next
    int   colors;   // cosmic|palette = cosmic
    vec4  colA;     // color = 0.1,0.65,1    inner disk, lasers
    vec4  colB;     // color = 1,0.1,0.75    outer disk, lasers
    float laser;    // 0..1 = 0.8
    float eq;       // 0..1 = 0.5        spectrum on the disk
    float warp;     // 0..1 = 1          streaks in the build
    float punch;    // 0..1 = 0.6        camera on the kick
    float exposure; // 0.3..3 = 1.1
    int   steps;    // 24..96 = 56       ray steps: lower if the frame rate drops
    float react;    // 0..1 = 1          pads and audio
};

const float TAU = 6.2831853;

float B, kick, ring, dropE, calmE, bld, impact, pump;
vec3 cA, cB;

float H(float x) { return hash21(vec2(x, 5.17)); }
float sm(float a, float b, float x) { return smoothstep(a, b, x); }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

vec3 stars(vec3 d) {
    vec3 c = vec3(0.0);
    for (int i = 0; i < 2; i++) {
        float sc = i == 0 ? 42.0 : 95.0;
        vec3 q = d * sc;
        vec3 id = floor(q);
        vec3 f = fract(q) - 0.5;
        float h = hash21(id.xy + id.z * 17.31 + float(i) * 3.0);
        if (h > 0.76) {
            vec3 off = (vec3(hash21(id.yz), hash21(id.zx), h * 7.0 - floor(h * 7.0)) - 0.5) * 0.5;
            float l = length(f - off);
            float tw = 0.6 + 0.4 * sin(u_time * (1.0 + h * 5.0) + h * 40.0);
            vec3 tint = mix(vec3(1.0), h > 0.92 ? cA : cB, 0.45);
            c += tint * exp(-l * l * 150.0) * tw * (i == 0 ? 3.0 : 1.5);
        }
    }
    return c;
}

vec3 nebula(vec3 d) {
    vec2 q = d.xz / (1.15 + abs(d.y)) * 2.6 + d.y * 0.7;
    vec2 wr = vec2(fbm(q * 1.3 + 2.0, 4), fbm(q * 1.3 + 8.0, 4)) * 1.6;
    float a = fbm(q + wr + vec2(B * 0.003, 0.0), 6);
    float b = fbm(q * 0.8 - wr * 0.5 + 9.0, 4);
    float n = pow(sm(0.34, 0.92, a), 2.4);
    return mix(cB, cA, sm(0.32, 0.68, b)) * n * 0.34;
}

// Light from the disk where the ray crosses it at `hit`, seen along `d`.
vec4 disk(vec3 hit, vec3 d, float t) {
    float r = length(hit.xz);
    if (r < 2.3 || r > 8.6) return vec4(0.0);
    float a = atan(hit.z, hit.x);
    vec2 sw = rot(hit.xz, t * 5.0 / pow(r, 1.5));

    float bands = 0.3 + 0.55 * noise2(vec2(r * 4.2, 7.0)) + 0.6 * noise2(vec2(r * 1.4, 2.0));
    float clump = 0.45 + 1.0 * noise2(sw * 1.25) * noise2(sw * 3.1 + 5.0) * 2.0;
    float edge = sm(2.45, 3.3, r) * sm(8.6, 5.2, r);
    float dens = bands * clump * edge;

    // Hot and white inside, cooling to A then B.
    float k = sm(2.3, 7.2, r);
    vec3 col = mix(mix(mix(cA, vec3(1.0), 0.75), cA, sm(0.05, 0.32, k)), cB, sm(0.3, 0.85, k));
    float heat = 1.7 / (0.45 + (r - 2.0) * 0.5);

    // Brighter on the side coming toward us.
    vec3 tang = normalize(vec3(-hit.z, 0.0, hit.x));
    float dop = pow(max(1.0 + 0.42 * dot(tang, -d), 0.05), 2.6);

    float e = dens * heat * dop * (0.5 + 0.5 * calmE + 0.75 * dropE + kick * 0.5);
    vec3 c = col * e;

    // A shock ring leaves the hole on every beat of the drop.
    float fb = fract(B);
    float sR = 2.4 + fb * 9.0;
    float beatRing = exp(-pow((r - sR) * 2.6, 2.0)) * (1.0 - fb) * dropE;
    float padR = 2.4 + (1.0 - ring) * 9.0;
    beatRing = max(beatRing, exp(-pow((r - padR) * 2.6, 2.0)) * ring * step(0.02, ring));
    c += mix(cA, vec3(1.0), 0.45) * beatRing * 3.2 * dop;

    // The spectrum stands on the disk, mirrored left and right.
    float sector = abs(a) / 3.14159265;
    float bins = 48.0;
    float bi = floor(sector * bins);
    float gapA = sm(0.0, 0.12, fract(sector * bins)) * sm(1.0, 0.88, fract(sector * bins));
    float lvl = min(fft(int(bi * 1.2 + 3.0)), 1.0) * react * (0.3 + 0.7 * dropE);
    float top = 3.0 + pow(lvl, 2.0) * 4.6;
    float bar = step(r, top) * step(top - 0.75, r) * gapA * step(0.04, lvl);
    float seg = sm(0.0, 0.12, fract(r * 3.0));
    c += mix(cA, cB, sm(3.0, 9.0, r)) * bar * seg * eq * 1.5 * dop;

    return vec4(c, clamp(dens * 0.9 * edge + bar * eq * 0.4, 0.0, 0.92));
}

vec3 lasers(vec2 p, float occl) {
    // A fan out of the hole, and two rigs from the bottom corners.
    float asp = aspect();
    float g = max(dropE, 0.0);
    float pad = max(u_triggers.z * react, 0.0);
    float gate = max(g * step(0.3, fract(B * 2.0 + 0.0) + 0.3 * step(1.0, mod(B, 2.0))), pad);
    if (gate < 0.01) return vec3(0.0);

    vec3 c = vec3(0.0);
    float r = length(p);
    float bar4 = floor(B / 8.0);
    float n = 4.0 + 2.0 * floor(H(bar4) * 4.0);
    float a = atan(p.y, p.x) + sin(B * 0.3927) * 1.1 + B * 0.04;
    float s = TAU / n;
    float d = abs(mod(a + s * 0.5, s) - s * 0.5) * r;
    float l = exp(-d * d * 9000.0) + 0.12 * exp(-d * d * 420.0);
    c += mix(cA, cB, mod(bar4, 2.0)) * l * sm(0.08, 0.3, r) * exp(-r * 0.32) * occl * 2.3;

    for (int i = 0; i < 2; i++) {
        float sgn = i == 0 ? -1.0 : 1.0;
        vec2 o = vec2(sgn * asp * 1.02, -1.04);
        for (int k = 0; k < 3; k++) {
            float ang = 1.57 - sgn * (0.5 + 0.3 * float(k)) + sgn * 0.42 * sin(B * 0.7854 + float(k) * 0.9);
            vec2 dirL = vec2(cos(ang), sin(ang));
            vec2 q = p - o;
            float along = dot(q, dirL);
            float dd = length(q - dirL * max(along, 0.0));
            c += mix(cB, cA, float(k) * 0.5) * (exp(-dd * dd * 7000.0) + 0.1 * exp(-dd * dd * 300.0)) * exp(-along * 0.32) * step(0.0, along) * occl * 1.6;
        }
    }
    return c * laser * gate;
}

vec3 warpLines(vec2 p) {
    if (bld < 0.001) return vec3(0.0);
    float r = length(p);
    float a = atan(p.y, p.x);
    float n = 150.0;
    float id = floor((a / TAU + 0.5) * n);
    float h = H(id);
    float across = abs(fract((a / TAU + 0.5) * n) - 0.5) * 2.0;
    float speed = 0.5 + h * 1.4;
    float head = fract(h * 13.0 + B * speed * (0.45 + bld * 1.5)) * 3.0;
    float tail = 0.14 + 1.0 * bld * bld;
    float l = sm(head - tail, head, r) * (1.0 - sm(head, head + 0.01, r));
    l *= 1.0 - sm(0.0, 0.5 + r * 0.25, across);
    return mix(vec3(1.0), mix(cA, cB, h), 0.55) * l * step(0.55, H(id + 31.0)) * bld * 2.0 * warp * sm(0.06, 0.4, r);
}

void main() {
    vec2 w = world_uv(v_uv);
    if (w.x < 0.0) { f_color = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec2 p = to_centered(w);

    B = u_beats;
    float bars = float(max(cycle, 4));
    float len = bars * 4.0;
    float pos = mod(B, len);

    // Half the cycle is drop, the rest calm, the last 2 bars build.
    float buildLen = 8.0;
    float secN = pos < len * 0.5 ? 0.0 : (pos < len - buildLen ? 1.0 : 2.0);
    if (section > 0) secN = float(section - 1);
    dropE = secN < 0.5 ? 1.0 : 0.0;
    calmE = (secN > 0.5 && secN < 1.5) ? 1.0 : 0.0;
    bld = secN > 1.5 ? (section > 0 ? fract(B / 8.0) : (pos - (len - buildLen)) / buildLen) : 0.0;
    impact = section == 0 ? exp(-pos * 1.6) : 0.0;

    float clockKick = pow(max(u_beat, 0.0), 2.0) * dropE;
    kick = max(clockKick, max(u_triggers.x, u_hits.y * 0.8) * react * (0.4 + 0.6 * dropE));
    ring = u_triggers.y * react;
    pump = mix(1.0, sm(0.0, 0.55, fract(B)) * 0.75 + 0.25, dropE);

    cA = colors == 1 ? palette(0.6) : colA.rgb;
    cB = colors == 1 ? palette(0.92) : colB.rgb;

    // A new shot every 4 bars; the build pushes in on the hole.
    float shot = floor(B / 16.0);
    float pitch = mix(0.05, 0.52, pow(H(shot), 1.4));
    float yaw = H(shot + 9.0) * TAU + B * 0.012;
    float dist = mix(19.0, 13.5, H(shot + 4.0));
    dist = mix(dist, 8.5, bld * bld);
    dist *= 1.0 + impact * 0.8;
    float roll = (H(shot + 2.0) - 0.5) * 0.7;

    // Kick: a lens punch and a small shake.
    vec2 uvp = rot(p, roll);
    uvp /= 1.0 + punch * (0.1 * kick + 0.45 * impact);
    uvp += (hash22(vec2(floor(u_time * 45.0))) - 0.5) * punch * (0.012 * kick + 0.05 * bld * bld * bld + 0.06 * impact);

    vec3 ro = vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)) * dist;
    vec3 fw = normalize(-ro);
    vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(rt, fw);
    vec3 v = normalize(rt * uvp.x + up * uvp.y + fw * (1.9 - 0.4 * bld));

    // Bend the ray around the hole, gathering the disk where it crosses.
    vec3 pos3 = ro;
    vec3 h3 = cross(pos3, v);
    float h2 = dot(h3, h3);
    vec3 acc = vec3(0.0);
    float alpha = 0.0;
    float captured = 0.0;
    float halo = 0.0;
    float dT = B * 0.3;
    for (int i = 0; i < steps; i++) {
        float r2 = dot(pos3, pos3);
        float r = sqrt(r2);
        if (r < 1.02) { captured = 1.0; break; }
        if (r > 34.0) break;
        float dt = max(0.05, 0.085 * r);
        halo += dt * exp(-(r - 1.5) * (r - 1.5) * 3.0);
        vec3 prev = pos3;
        v += -1.5 * h2 * pos3 / (r2 * r2 * r) * dt;
        pos3 += v * dt;
        if (prev.y * pos3.y < 0.0 && alpha < 0.98) {
            float f = prev.y / (prev.y - pos3.y);
            vec4 dc = disk(mix(prev, pos3, f), normalize(v), dT);
            acc += dc.rgb * (1.0 - alpha);
            alpha += dc.a * (1.0 - alpha);
        }
    }

    vec3 col = vec3(0.0);
    if (captured < 0.5) {
        vec3 d = normalize(v);
        col = (stars(d) + nebula(d)) * pump;
    }
    col = col * (1.0 - alpha) + acc;
    col += mix(cA, vec3(1.0), 0.4) * halo * 0.09 * (0.6 + kick * 0.9) * (captured > 0.5 ? 0.0 : 1.0);

    float occl = captured > 0.5 ? 0.0 : 1.0;
    col += lasers(p, occl);
    col += warpLines(p);

    // The build's strobe, then the hit.
    col += vec3(1.0) * step(0.5, fract(B * 4.0)) * pow(bld, 5.0) * 1.1;
    col = col * exposure;
    col = 1.0 - exp(-col);
    col = mix(col, vec3(1.0), sm(0.35, 0.9, impact));

    f_color = vec4(col, 1.0);
}
