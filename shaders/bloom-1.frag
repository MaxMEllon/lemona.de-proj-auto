#version 450
#include "util/common.glsl"
#include "util/blur.glsl"
#include "util/bloom.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 f_color;

layout(set = 0, binding = 1) uniform NodeParams {
    float threshold;    // luma where the glow starts
    float knee;         // soft start below the threshold
    float radius;       // halo size, full-resolution pixels
    float intensity;
    float spread;       // 0 = tight core only, 1 = wide halo only
    vec4 color;         // tint
    float input_level;  // brightness of the input under the glow
    int mode;           // lemonade_core::builtin::BLOOM_OUTPUTS
};

const int TAPS = 64;

// Golden-angle spiral, precomputed: xy = offset (unit radius), z = Gaussian
// weight exp(-3 r^2); tap i at r = sqrt((i + 0.5) / TAPS), angle i * 2.39996.
const vec3 SPIRAL[TAPS] = vec3[](
    vec3(0.0883883, 0.0000000, 0.9768350),
    vec3(-0.1128861, 0.1034129, 0.9321025),
    vec3(0.0172790, -0.1968856, 0.8894184),
    vec3(0.1422856, 0.1855864, 0.8486890),
    vec3(-0.2611116, -0.0461870, 0.8098247),
    vec3(0.2473477, -0.1573424, 0.7727401),
    vec3(-0.0827330, 0.3077625, 0.7373538),
    vec3(-0.1577807, -0.3037972, 0.7035879),
    vec3(0.3423211, 0.1250151, 0.6713682),
    vec3(-0.3561280, 0.1470045, 0.6406240),
    vec3(0.1716773, -0.3668643, 0.6112877),
    vec3(0.1268651, 0.4044660, 0.5832948),
    vec3(-0.3823729, -0.2215929, 0.5565838),
    vec3(0.4485670, -0.0986162, 0.5310960),
    vec3(-0.2737535, 0.3893861, 0.5067753),
    vec3(-0.0632434, -0.4880448, 0.4835684),
    vec3(0.3882524, 0.3272195, 0.4614242),
    vec3(-0.5224660, 0.0216056, 0.4402940),
    vec3(0.3810988, -0.3792442, 0.4201315),
    vec3(-0.0254970, 0.5513959, 0.4008923),
    vec3(-0.3626168, -0.4345361, 0.3825341),
    vec3(0.5744250, 0.0772881, 0.3650166),
    vec3(-0.4867091, 0.3386395, 0.3483013),
    vec3(0.1329969, -0.5911847, 0.3323514),
    vec3(0.3076150, 0.5368291, 0.3171319),
    vec3(-0.6013578, -0.1918496, 0.3026094),
    vec3(0.5841426, -0.2698887, 0.2887519),
    vec3(-0.2530652, 0.6046863, 0.2755290),
    vec3(-0.2258551, -0.6279347, 0.2629116),
    vec3(0.6009762, 0.3158562, 0.2508720),
    vec3(-0.6675333, 0.1759596, 0.2393837),
    vec3(0.3794305, -0.5901017, 0.2284215),
    vec3(0.1206991, 0.7023135, 0.2179614),
    vec3(-0.5720078, -0.4429950, 0.2079802),
    vec3(0.7317019, -0.0606200, 0.1984561),
    vec3(-0.5057603, 0.5467120, 0.1893681),
    vec3(0.0036840, -0.7551814, 0.1806963),
    vec3(0.5143049, 0.5669461, 0.1724216),
    vec3(-0.7722949, -0.0715761, 0.1645259),
    vec3(0.6257873, -0.4749502, 0.1569917),
    vec3(-0.1423806, 0.7826495, 0.1498025),
    vec3(-0.4288839, -0.6815395, 0.1429425),
    vec3(0.7859201, 0.2153881, 0.1363967),
    vec3(-0.7334855, 0.3764127, 0.1301507),
    vec3(0.2898617, -0.7818521, 0.1241906),
    vec3(0.3179115, 0.7809416, 0.1185035),
    vec3(-0.7702639, -0.3650425, 0.1130769),
    vec3(0.8232633, -0.2538209, 0.1078987),
    vec3(-0.4401565, 0.7510491, 0.1029577),
    vec3(-0.1846432, -0.8598514, 0.0982429),
    vec3(0.7241773, 0.5144217, 0.0937440),
    vec3(-0.8901574, 0.1109386, 0.0894512),
    vec3(0.5870543, -0.6896954, 0.0853549),
    vec3(0.0333199, 0.9136888, 0.0814462),
    vec3(-0.6477269, -0.6572764, 0.0777165),
    vec3(0.9300141, 0.0475523, 0.0741576),
    vec3(-0.7243231, 0.5984718, 0.0707617),
    vec3(0.1309753, -0.9387667, 0.0675213),
    vec3(0.5422049, 0.7874493, 0.0644293),
    vec3(-0.9396490, -0.2162111, 0.0614788),
    vec3(0.8459368, -0.4792739, 0.0586635),
    vec3(-0.3024919, 0.9324356, 0.0559771),
    vec3(-0.4100971, -0.8991012, 0.0534137),
    vec3(0.9169759, 0.3890280, 0.0509677)
);
const float WEIGHT_SUM = 20.269353;

// Pass 2: the bright pass at two sizes, like a mip-chain bloom: a tight core
// (spiral over a quarter of the radius) and a wide halo (the pre-pass,
// u_tex1, at half resolution in the world's layout, blurred vertically),
// tinted and added over the input.
void main() {
    vec4 src = texture(u_tex0, v_uv);
    vec2 w = world_uv(v_uv);
    vec3 bright = bloom_bright(src.rgb, threshold, knee);
    if (mode == 2) {
        f_color = vec4(bright, src.a);
        return;
    }
    float r = radius * u_scale;   // in render pixels
    vec2 core_scale = 0.25 * r / u_world_resolution;
    vec3 core = vec3(0.0);
    for (int i = 0; i < TAPS; i++) {
        vec3 s = sample_world(u_tex0, w + SPIRAL[i].xy * core_scale).rgb;
        core += bloom_bright(s, threshold, knee) * SPIRAL[i].z;
    }
    core /= WEIGHT_SUM;
    // The pre-pass may be smaller than the output (half size for the
    // built-in node): blur in its own texels, the radius scaled to match.
    float pre_height = float(textureSize(u_tex1, 0).y);
    float pre_r = r * pre_height / u_world_resolution.y;
    vec3 halo = pre_r < 0.5 ? texture(u_tex1, w).rgb
                            : gaussian_axis(u_tex1, w, vec2(0.0, 1.0 / pre_height), pre_r).rgb;
    vec3 glow = mix(core, halo, spread) * intensity * color.rgb;
    f_color = mode == 1 ? vec4(glow, src.a) : vec4(src.rgb * input_level + glow, src.a);
}
