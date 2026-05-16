precision highp float;

uniform sampler2D tDiffuse;
uniform vec2  iResolution;
uniform float uAngle;
uniform float uScale;
uniform float uKeepColors;

varying vec2 vUv;

float dotPattern(vec2 coord) {
    float s = sin(uAngle);
    float c = cos(uAngle);
    vec2  p = vec2(c * coord.x - s * coord.y,
                   s * coord.x + c * coord.y) * uScale;
    return (sin(p.x) * sin(p.y)) * 4.0;
}

void main() {
    vec4  texel = texture2D(tDiffuse, vUv);
    vec2  coord = vUv * iResolution;
    float lum   = dot(texel.rgb, vec3(0.333));
    float val   = clamp(lum * 10.0 - 5.0 + dotPattern(coord), 0.0, 1.0);

    vec3 out_rgb = mix(vec3(val), texel.rgb * val, uKeepColors);
    gl_FragColor = vec4(out_rgb * texel.a, texel.a);
}
