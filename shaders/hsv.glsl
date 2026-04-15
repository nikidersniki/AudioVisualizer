uniform sampler2D tDiffuse;
uniform float uHue;
uniform float uSaturation;
uniform float uValue;
uniform float uFac;

varying vec2 vUv;

vec3 rgb2hsv(vec3 c) {
    float cmax = max(c.r, max(c.g, c.b));
    float cmin = min(c.r, min(c.g, c.b));
    float diff = cmax - cmin;
    float h = 0.0;
    if (diff > 0.0) {
        if      (cmax == c.r) h = mod((c.g - c.b) / diff, 6.0) / 6.0;
        else if (cmax == c.g) h = ((c.b - c.r) / diff + 2.0) / 6.0;
        else                  h = ((c.r - c.g) / diff + 4.0) / 6.0;
    }
    return vec3(h, cmax > 0.0 ? diff / cmax : 0.0, cmax);
}

vec3 hsv2rgb(vec3 c) {
    float h = c.x * 6.0;
    float s = c.y;
    float v = c.z;
    float i = floor(h);
    float f = h - i;
    float p = v * (1.0 - s);
    float q = v * (1.0 - s * f);
    float t = v * (1.0 - s * (1.0 - f));
    if (i == 0.0) return vec3(v, t, p);
    if (i == 1.0) return vec3(q, v, p);
    if (i == 2.0) return vec3(p, v, t);
    if (i == 3.0) return vec3(p, q, v);
    if (i == 4.0) return vec3(t, p, v);
                  return vec3(v, p, q);
}

void main() {
    vec4 texel = texture2D(tDiffuse, vUv);
    vec3 hsv   = rgb2hsv(texel.rgb);

    hsv.x = fract(hsv.x + uHue);        // hue shift (wraps)
    hsv.y = clamp(hsv.y * uSaturation, 0.0, 1.0);
    hsv.z = clamp(hsv.z * uValue,      0.0, 1.0);

    vec3 result = hsv2rgb(hsv);
    gl_FragColor = vec4(mix(texel.rgb, result, uFac), texel.a);
}
