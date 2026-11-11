#version 450
#include "util/common.glsl"
#include "util/uv.glsl"

// Botanica: glass / chrome ribbons, mirrored left-right, twisting loops that
// cross into an X at the centre. in0 shows through them (refracted) and is
// mirrored in them. Free-running unless `react` is raised.

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float speed;    // 0..4 = 1
    float twist;    // 0..3 = 1          half-turns of each ribbon around its loop
    float width;    // 0.05..0.6 = 0.22  ribbon width
    float refract;  // 0..1 = 0.5
    float chrome;   // 0..1 = 0.15       mirror bands vs clear glass
    float zoom;     // 0.5..2 = 1
    float react;    // 0..1 = 0          beat push (0 = free-running)
    int   quality;  // low|mid|high = mid
};

float T;
float g_tw;
// per-frame rotations, set once in main() instead of on every map() call
mat2 R1a, R1b, R2a, R2b, R3a, R3b, R4a, R4b;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// a flat band (width w, thickness th) running around a loop of radius R in xz,
// turning tw half-turns per loop
float ribbon(vec3 p, float R, float w, float tw, float ph) {
    float a = atan(p.z, p.x);
    vec2 q = vec2(length(p.xz) - R, p.y);
    q = rot(a * tw + ph) * q;
    vec2 d = abs(q) - vec2(w, 0.012);
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// far from a loop's bounding sphere, its distance is all we need
float loop_d(vec3 q, float R, float w, float tw, float ph) {
    float b = length(q) - R - w;
    return b > 0.1 ? b : ribbon(q, R, w, tw, ph);
}

float map(vec3 p) {
    p.x = abs(p.x);
    // big leaning loops crossing at the centre
    vec3 q = p - vec3(0.6, 0.0, 0.0);
    q.xy = R1a * q.xy;
    q.yz = R1b * q.yz;
    float d = loop_d(q, 1.35, width, g_tw, T);
    // outer loops spinning slowly
    q = p - vec3(1.75, -0.1, 0.8);
    q.xy = R2a * q.xy;
    q.yz = R2b * q.yz;
    d = min(d, loop_d(q, 1.05, width * 0.75, g_tw + 0.5, -T * 0.8));
    // small centre loop
    q = p - vec3(0.0, -0.05, -0.4);
    q.xz = R3a * q.xz;
    q.yz = R3b * q.yz;
    d = min(d, loop_d(q, 0.6, width * 0.6, g_tw, T * 1.3));
    // petals at the top edge
    q = p - vec3(0.4, 1.35, 0.6);
    q.xy = R4a * q.xy;
    q.yz = R4b * q.yz;
    d = min(d, loop_d(q, 0.8, width * 0.7, g_tw + 0.5, T * 0.5 + 1.0));
    return d;
}

// tetrahedral gradient: 4 map() calls instead of 6
vec3 normal_at(vec3 p) {
    const vec2 k = vec2(1.0, -1.0);
    const float e = 0.002;
    return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e)
                   + k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}

// what the chrome reflects: in0 above the horizon, dark ground below
vec3 env(vec3 r) {
    vec2 uv = clamp(vec2(0.5 + r.x * 0.45, 0.5 - r.y * 0.6), 0.0, 1.0);
    vec3 s = texture(u_tex0, uv).rgb;
    float up = smoothstep(-0.08, 0.08, r.y);
    return mix(s * 0.12, s * 1.15 + 0.08, up);
}

void main() {
    T = u_time * speed * 0.25
      + react * (floor(u_beats) + smoothstep(0.0, 0.3, fract(u_beats))) * 0.15;
    g_tw = floor(twist * 2.0 + 0.5) * 0.5;
    R1a = rot(0.5);                R1b = rot(1.5708 + 0.5 + 0.25 * sin(T * 0.7));
    R2a = rot(-0.6);               R2b = rot(1.5708 + T * 0.5);
    R3a = rot(T * 0.6);            R3b = rot(1.2);
    R4a = rot(0.9 + 0.2 * sin(T * 0.4)); R4b = rot(1.5708 + T * 0.3);

    vec2 p = to_centered(v_uv) / zoom;
    vec3 ro = vec3(0.0, 0.0, -4.0);
    vec3 rd = normalize(vec3(p, 1.9));
    vec3 L = normalize(vec3(-0.4, 0.7, -0.6));

    // march only inside the box holding every loop (any width)
    vec3 bmin = vec3(-3.4, -2.1, -2.0), bmax = vec3(3.4, 2.7, 2.4);
    vec3 t0 = (bmin - ro) / rd, t1 = (bmax - ro) / rd;
    vec3 tn = min(t0, t1), tf = max(t0, t1);
    float tin = max(max(tn.x, tn.y), tn.z), tout = min(min(tf.x, tf.y), tf.z);

    int steps = quality == 0 ? 48 : (quality == 1 ? 72 : 120);
    vec2 offs = vec2(0.0);
    vec3 refl = vec3(0.0);
    float trans = 1.0;
    int layers = 0;
    float dist = max(tin, 0.0);
    for (int i = 0; i < 120; i++) {
        if (i >= steps || dist > tout || layers >= 3) break;
        vec3 pos = ro + rd * dist;
        float d = map(pos);
        if (d < 0.002) {
            vec3 n = normal_at(pos);
            if (dot(n, rd) > 0.0) n = -n;
            float fres = pow(1.0 - abs(dot(n, rd)), 3.0);
            vec3 r = reflect(rd, n);
            float spec = pow(max(dot(r, L), 0.0), 80.0);
            float rim = smoothstep(0.75, 1.0, 1.0 - abs(dot(n, rd)));
            vec3 glass = env(r) * (0.25 + 0.85 * fres) + rim * 0.6;
            vec3 metal = env(r) * vec3(0.95, 0.97, 1.05);
            vec3 c = mix(glass, metal, chrome) + spec * 1.5;
            float a = mix(0.25 + 0.55 * fres, 0.9, chrome);
            refl += trans * a * c;
            trans *= 1.0 - a;
            offs += vec2(n.x, -n.y) * refract * 0.12;
            layers++;
            dist += 0.06;   // step through the thin sheet
            continue;
        }
        dist += d * 0.75;
    }
    vec3 bg = texture(u_tex0, clamp(v_uv + offs, 0.0, 1.0)).rgb;
    vec3 tint = pow(vec3(0.9, 0.94, 1.0), vec3(float(layers)));
    f_color = vec4(bg * tint * trans + refl, 1.0);
}
