precision highp float;

uniform sampler2D tDiffuse;
uniform float uPos1;
uniform float uPos2;
uniform float uPos3;
uniform vec3  uColor0;
uniform vec3  uColor1;
uniform vec3  uColor2;
uniform vec3  uColor3;
uniform float uFac;

varying vec2 vUv;

void main() {
    vec4  texel = texture2D(tDiffuse, vUv);
    float lum   = dot(texel.rgb, vec3(0.299, 0.587, 0.114));

    // constant interpolation — step to the colour of the highest
    // threshold that the luminance value has reached
    vec3 ramp = uColor0;
    if (lum >= uPos1) ramp = uColor1;
    if (lum >= uPos2) ramp = uColor2;
    if (lum >= uPos3) ramp = uColor3;

    vec3 out_rgb = mix(texel.rgb, ramp, uFac);
    gl_FragColor = vec4(out_rgb * texel.a, texel.a);
}
