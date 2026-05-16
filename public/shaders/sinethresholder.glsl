uniform sampler2D tDiffuse;
uniform vec2 iResolution;
uniform float uFrequency;
uniform float uDisplace;
uniform vec3  uColor0;
uniform vec3  uColor1;
uniform float uKeepColors;

varying vec2 vUv;

void main() {
    vec4  texel = texture(tDiffuse, vUv);
    float r = texel.g;
    float c = step(0., sin(vUv.x * uFrequency + r * uDisplace));

    // keepColors=0: mix between Color A and Color B
    // keepColors=1: Color A in dark bands, original color in bright bands
    vec3 with_colors = mix(uColor0, uColor1,   c);
    vec3 keep_orig   = mix(uColor0, texel.rgb, c);
    vec3 out_rgb     = mix(with_colors, keep_orig, uKeepColors);
    gl_FragColor = vec4(out_rgb * texel.a, texel.a);
}
