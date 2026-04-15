uniform sampler2D tDiffuse;
uniform vec2 iResolution;
uniform float uFrequency;
uniform float uDisplace;
uniform vec3 uColor0;
uniform vec3 uColor1;

varying vec2 vUv;

void main() {
    float r = texture(tDiffuse, vUv).g;
    float c = step(0., sin(vUv.x * uFrequency + r * uDisplace));

    gl_FragColor = vec4(mix(uColor0, uColor1, c), 1.0);
}
