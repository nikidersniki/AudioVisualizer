precision highp float;

uniform sampler2D tDiffuse;
uniform vec2  iResolution;
uniform float uDitherIntensity;
uniform float uPixelSize;
uniform float uColorLevels;
uniform float uGlobalMix;

varying vec2 vUv;

// Bayer 8x8 ordered dithering matrix
const float bayer8x8[64] = float[](
     0.0, 32.0,  8.0, 40.0,  2.0, 34.0, 10.0, 42.0,
    48.0, 16.0, 56.0, 24.0, 50.0, 18.0, 58.0, 26.0,
    12.0, 44.0,  4.0, 36.0, 14.0, 46.0,  6.0, 38.0,
    60.0, 28.0, 52.0, 20.0, 62.0, 30.0, 54.0, 22.0,
     3.0, 35.0, 11.0, 43.0,  1.0, 33.0,  9.0, 41.0,
    51.0, 19.0, 59.0, 27.0, 49.0, 17.0, 57.0, 25.0,
    15.0, 47.0,  7.0, 39.0, 13.0, 45.0,  5.0, 37.0,
    63.0, 31.0, 55.0, 23.0, 61.0, 29.0, 53.0, 21.0
);

float fetchDitherValue(vec2 pos) {
    int x = int(pos.x) % 8;
    int y = int(pos.y) % 8;
    return bayer8x8[y * 8 + x];
}

void main() {
    vec2 fragCoord  = vUv * iResolution;
    vec2 pixelScale = vec2(max(uPixelSize, 1.0));
    vec2 emuCoord   = floor(fragCoord / pixelScale);
    vec2 uv         = (emuCoord * pixelScale + pixelScale * 0.5) / iResolution;

    vec3 screen = texture(tDiffuse, uv).rgb;
    vec3 orig   = texture(tDiffuse, vUv).rgb;

    // Bayer threshold normalised to [-0.5, 0.5], scaled by intensity
    float t = (fetchDitherValue(emuCoord) / 63.0 - 0.5) * uDitherIntensity;

    // Quantise to uColorLevels levels per channel.
    // Dither noise is one quantisation step wide so it pushes borderline
    // colours to the next level rather than always rounding down.
    float L = max(floor(uColorLevels), 2.0) - 1.0;
    vec3 dithered  = screen + t / L;
    vec3 quantized = clamp(floor(dithered * L + 0.5) / L, 0.0, 1.0);

    gl_FragColor = vec4(mix(orig, quantized, uGlobalMix), 1.0);
}
