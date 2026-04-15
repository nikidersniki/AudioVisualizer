precision highp float;

uniform sampler2D tDiffuse;
uniform vec2 iResolution;
uniform float uDitherIntensity;
uniform float uPixelSize;
uniform float uPaletteMode;
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

vec3 tryColor(vec3 newVal, vec3 currentBest, vec3 ref) {
    vec3 dNew = newVal - ref;
    vec3 dOld = currentBest - ref;
    return dot(dNew, dNew) < dot(dOld, dOld) ? newVal : currentBest;
}

// Palettes taken from the Pixless camera kickstarter
// 0: dark-to-warm  |  1: orange-to-neutral  |  2: cool grey
vec3 findClosestPixless(vec3 ref, float mode) {
    vec3 best = vec3(25500.0);
    if (mode < 0.5) {
        best = tryColor(vec3( 15,  32,  48), best, ref);
        best = tryColor(vec3( 30,  49,  68), best, ref);
        best = tryColor(vec3( 88,  79,  99), best, ref);
        best = tryColor(vec3(142, 110, 123), best, ref);
        best = tryColor(vec3(211, 139, 102), best, ref);
        best = tryColor(vec3(255, 168,  91), best, ref);
        best = tryColor(vec3(255, 217, 181), best, ref);
        best = tryColor(vec3(255, 241, 225), best, ref);
    } else if (mode < 1.5) {
        best = tryColor(vec3(252, 210,  52), best, ref);
        best = tryColor(vec3(178, 114,  42), best, ref);
        best = tryColor(vec3( 87,  49,  31), best, ref);
        best = tryColor(vec3( 41,  24,  18), best, ref);
        best = tryColor(vec3(192, 131,  98), best, ref);
        best = tryColor(vec3(113,  89,  87), best, ref);
        best = tryColor(vec3( 57,  58,  62), best, ref);
        best = tryColor(vec3( 35,  36,  39), best, ref);
    } else {
        best = tryColor(vec3( 13,  13,  18), best, ref);
        best = tryColor(vec3( 28,  26,  36), best, ref);
        best = tryColor(vec3( 57,  54,  75), best, ref);
        best = tryColor(vec3( 88,  86, 113), best, ref);
        best = tryColor(vec3(133, 130, 156), best, ref);
        best = tryColor(vec3(176, 175, 196), best, ref);
        best = tryColor(vec3(208, 206, 222), best, ref);
        best = tryColor(vec3(234, 235, 242), best, ref);
    }
    return best;
}

float fetchDitherValue(vec2 pos) {
    int x = int(pos.x) % 8;
    int y = int(pos.y) % 8;
    return bayer8x8[y * 8 + x];
}

vec3 applyRetroDither(vec3 screenColor, vec2 emuCoord, float intensity) {
    float ditherVal = fetchDitherValue(emuCoord);
    vec3 color = screenColor * 255.0;
    color = color * 0.95 * intensity;
    color += (ditherVal - 31.5) * 0.65;
    return color;
}

void main() {
    vec2 fragCoord  = vUv * iResolution;
    vec2 pixelScale = vec2(max(uPixelSize, 1.0));
    vec2 emuCoord   = floor(fragCoord / pixelScale);
    vec2 uv         = (emuCoord * pixelScale + pixelScale * 0.5) / iResolution;

    vec3 screen   = texture(tDiffuse, uv).rgb;
    vec3 dithered = applyRetroDither(screen, emuCoord, uDitherIntensity);
    vec3 colorPix = findClosestPixless(clamp(dithered, 0.0, 255.0), uPaletteMode) / 255.0;
    vec3 orig     = texture(tDiffuse, vUv).rgb;

    gl_FragColor = vec4(mix(orig, colorPix, uGlobalMix), 1.0);
}
