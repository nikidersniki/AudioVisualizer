precision highp float;

uniform sampler2D tDiffuse;
uniform vec2      iResolution;
uniform float     uAmount;     // sharpening strength  (0 = off, 1 = standard, >1 = heavy)
uniform float     uRadius;     // blur radius in pixels used for the high-pass base
uniform float     uThreshold;  // minimum edge magnitude before sharpening is applied

varying vec2 vUv;

// Gaussian-weighted 5×5 blur — provides the "low-pass" base for the USM.
vec3 gaussianBlur(vec2 uv) {
    vec2 s = uRadius / iResolution;

    // Gaussian kernel σ=1  (weights sum ≈ 1 after normalisation)
    float k[5];
    k[0] = 0.0625; k[1] = 0.25; k[2] = 0.375; k[3] = 0.25; k[4] = 0.0625;

    vec3  col   = vec3(0.0);
    float total = 0.0;
    for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
            float w = k[x + 2] * k[y + 2];
            col   += texture(tDiffuse, uv + vec2(float(x), float(y)) * s).rgb * w;
            total += w;
        }
    }
    return col / total;
}

void main() {
    vec4 texel   = texture(tDiffuse, vUv);
    vec3 blurred = gaussianBlur(vUv);

    // High-pass detail layer
    vec3 detail = texel.rgb - blurred;

    // Only sharpen where the detail is above the threshold
    float mag = length(detail);
    float mask = smoothstep(uThreshold * 0.05, uThreshold * 0.05 + 0.02, mag);

    vec3 out_rgb = texel.rgb + detail * uAmount * mask;
    out_rgb = clamp(out_rgb, 0.0, 1.0);

    float origAlpha = texel.a;
    gl_FragColor = vec4(out_rgb * origAlpha, origAlpha);
}
