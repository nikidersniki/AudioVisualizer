uniform sampler2D tDiffuse;
uniform vec2 iResolution;
uniform vec2 uTexelSize;
uniform float uRadius;

varying vec2 vUv;

void main() {
    vec4 color = vec4(0.0);
    float total = 0.0;

    // simple box blur approximation (you can upgrade to gaussian weights later)
    for (float x = -20.0; x <= 20.0; x++) {
        float weight = exp(-abs(x) / uRadius);

        vec2 offset = vec2(x, 0.0) * uTexelSize;
        color += texture2D(tDiffuse, vUv + offset) * weight;
        total += weight;
    }

    gl_FragColor = color / total;
}