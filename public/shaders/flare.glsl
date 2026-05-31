precision highp float;

uniform sampler2D tDiffuse;
uniform vec2  iResolution;
uniform float uThreshold;       // brightness cutoff for what counts as a light
uniform float uIntensity;       // overall flare strength
uniform float uGhostDispersal;  // spacing between ghost reflections (0..1)
uniform float uHaloWidth;       // halo offset along the optical axis (0..1)
uniform float uStreakLength;    // anamorphic streak length (0..1)
uniform float uChromatic;       // chromatic aberration on samples (pixels)
uniform vec3  uTint;            // overall colour tint

varying vec2 vUv;

const int NUM_GHOSTS = 4;        // patched per layer (see patchFragmentSrc)
const int STREAK_SAMPLES = 12;

// ── Bright pass: keep only pixels above the luminance threshold ──
vec3 brightPass(vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
    vec3 c = texture(tDiffuse, uv).rgb;
    float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return c * max(L - uThreshold, 0.0) / max(L, 1e-4);
}

// Three offset samples along `dir` (R/G/B) → cheap chromatic aberration.
vec3 brightChroma(vec2 uv, vec2 dir, float amount) {
    vec2 pix = 1.0 / iResolution;
    vec3 r = brightPass(uv + dir * pix * amount);
    vec3 g = brightPass(uv);
    vec3 b = brightPass(uv - dir * pix * amount);
    return vec3(r.r, g.g, b.b);
}

void main() {
    vec4 src = texture(tDiffuse, vUv);

    // Flip the UV so that bright pixels in the original project across the
    // screen center — this is the classic "lens reflection" geometry.
    vec2 uv     = vec2(1.0) - vUv;
    vec2 center = vec2(0.5);
    vec2 dir    = center - uv;
    vec2 ndir   = normalize(dir + vec2(1e-5));

    vec3 flare = vec3(0.0);

    // ── Ghost reflections strung along the optical axis ──
    vec2 ghostStep = dir * uGhostDispersal;
    for (int i = 0; i < NUM_GHOSTS; ++i) {
        vec2 g_uv = uv + ghostStep * float(i);
        // attenuate by distance from screen center so far-out ghosts fade
        float d = distance(g_uv, center);
        float w = pow(1.0 - clamp(d / 0.7, 0.0, 1.0), 3.0);
        flare += brightChroma(g_uv, ndir, uChromatic) * w;
    }

    // ── Halo around the bright source ──
    vec2 haloVec = ndir * uHaloWidth;
    float hd = distance(uv + haloVec, center);
    float hw = pow(1.0 - clamp(hd / 0.5, 0.0, 1.0), 5.0);
    flare += brightChroma(uv + haloVec, ndir, uChromatic) * hw;

    // ── Anamorphic horizontal streak ──
    vec3 streak = vec3(0.0);
    for (int i = -STREAK_SAMPLES; i <= STREAK_SAMPLES; ++i) {
        float t = float(i) / float(STREAK_SAMPLES);
        vec2 s_uv = vUv + vec2(t * uStreakLength * 0.5, 0.0);
        float falloff = 1.0 - abs(t);
        streak += brightPass(s_uv) * (falloff * falloff);
    }
    streak /= float(STREAK_SAMPLES);
    streak *= vec3(0.6, 0.8, 1.2); // slight cool tint native to anamorphic flares

    vec3 total = (flare + streak) * uTint * uIntensity;

    float a = src.a;
    gl_FragColor = vec4((src.rgb + total) * a, a);
}
