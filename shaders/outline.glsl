precision highp float;

uniform sampler2D tDiffuse;
uniform vec2      iResolution;
uniform float     uAmount;     // overall outline intensity
uniform float     uThickness;  // pixel radius of the sample kernel
uniform vec3      uColor;      // outline colour (default white)

varying vec2 vUv;

// Edge detection adapted from the Shadertoy two-buffer outline technique.
// Originally iChannel0 carried vec4(normal, depth).  Here tDiffuse.rgb is
// used as a proxy for normals (normalised colour direction) and tDiffuse.a
// as a proxy for depth so object silhouettes are picked up automatically.
float getOutline(vec2 uv) {
    vec2 pixel = uThickness / iResolution.xy;

    // 3×3 neighbourhood
    vec4 s0 = texture(tDiffuse, uv + pixel * vec2(-1, -1));
    vec4 s1 = texture(tDiffuse, uv + pixel * vec2( 0, -1));
    vec4 s2 = texture(tDiffuse, uv + pixel * vec2(+1, -1));
    vec4 s3 = texture(tDiffuse, uv + pixel * vec2(-1,  0));
    // s4 = centre — not needed in cross-differences
    vec4 s5 = texture(tDiffuse, uv + pixel * vec2(+1,  0));
    vec4 s6 = texture(tDiffuse, uv + pixel * vec2(-1, +1));
    vec4 s7 = texture(tDiffuse, uv + pixel * vec2( 0, +1));
    vec4 s8 = texture(tDiffuse, uv + pixel * vec2(+1, +1));

    // Alpha (depth-proxy) cross-differences
    float dpos = (
        abs(s1.a - s7.a) +
        abs(s5.a - s3.a) +
        abs(s0.a - s8.a) +
        abs(s2.a - s6.a)
    ) * 0.5;

    // Colour-direction (normal-proxy) cross-differences — normalise first so
    // hue matters more than brightness
    dpos += (
        max(0.0, 1.0 - dot(normalize(s1.rgb + 0.001), normalize(s7.rgb + 0.001))) +
        max(0.0, 1.0 - dot(normalize(s5.rgb + 0.001), normalize(s3.rgb + 0.001))) +
        max(0.0, 1.0 - dot(normalize(s0.rgb + 0.001), normalize(s8.rgb + 0.001))) +
        max(0.0, 1.0 - dot(normalize(s2.rgb + 0.001), normalize(s6.rgb + 0.001)))
    );

    return pow(max(dpos - 0.5, 0.0), 5.0);
}

void main() {
    vec4  texel    = texture(tDiffuse, vUv);
    float outline  = clamp(getOutline(vUv) * uAmount, 0.0, 1.0);
    vec3  out_rgb  = mix(texel.rgb, uColor, outline);

    float origAlpha = texel.a;
    gl_FragColor = vec4(out_rgb * origAlpha, origAlpha);
}
