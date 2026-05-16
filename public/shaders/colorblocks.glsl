uniform sampler2D tDiffuse;
uniform vec2 iResolution;
uniform float uIntensity;

varying vec2 vUv;

void main() {
    vec2 step = 1.0 / iResolution;

    vec4 s1 = texture(tDiffuse, vUv + vec2(     0., -step.y));
    vec4 s3 = texture(tDiffuse, vUv + vec2(-step.x,      0.));
    vec4 s4 = texture(tDiffuse, vUv);
    vec4 s5 = texture(tDiffuse, vUv + vec2( step.x,      0.));
    vec4 s7 = texture(tDiffuse, vUv + vec2(     0.,  step.y));

    // Laplacian kernel: 0,-1,0 / -1,4,-1 / 0,-1,0
    vec4 sum = -s1 - s3 + 4.0 * s4 - s5 - s7;
    sum *= uIntensity;

    float origAlpha = s4.a;
    gl_FragColor = vec4(clamp(sum.rgb, 0.0, 1.0) * origAlpha, origAlpha);
}
