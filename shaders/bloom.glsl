precision highp float;

uniform sampler2D tDiffuse;
uniform vec2 iResolution;

uniform float uThreshold;
uniform float uIntensity;
uniform float uRadius;
uniform vec2 uTexelSize;

varying vec2 vUv;

float brightness(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
    vec2 uv = vUv;

    vec4 base = texture2D(tDiffuse, uv);

    vec3 bloomColor = vec3(0.0);
    float total = 0.0;

for (int x = -10; x <= 10; x++) {
    for (int y = -10; y <= 10; y++) {

        vec2 offset = vec2(float(x), float(y)) * uTexelSize * uRadius;

        vec3 col = texture2D(tDiffuse, uv + offset).rgb;

        float b = brightness(col);
        float mask = step(uThreshold, b);

        float weight = 1.0 - length(vec2(float(x), float(y))) / 14.0;

        bloomColor += col * mask * weight;
        total += weight;
    }
}

    bloomColor /= max(total, 0.0001);

    vec3 finalColor = base.rgb + bloomColor * uIntensity;

    gl_FragColor = vec4(finalColor, base.a);
}