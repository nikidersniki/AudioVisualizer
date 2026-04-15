uniform sampler2D tDiffuse;
uniform vec2 iResolution;
uniform float uEdgeThreshold;
uniform float uBlockSize;
uniform float uColorPower;

varying vec2 vUv;

vec4 getPixel(vec2 uv) {
    return texture(tDiffuse, uv);
}

vec2 sobel(vec2 uv) {
    vec2 pxSize = 1.0 / iResolution.xy;
    mat3 kernelX = mat3(
        -1.0, 0.0, 1.0,
        -2.0, 0.0, 2.0,
        -1.0, 0.0, 1.0
    );
    mat3 kernelY = mat3(
        -1.0, -2.0, -1.0,
         0.0,  0.0,  0.0,
         1.0,  2.0,  1.0
    );
    float iX = 0.0, iY = 0.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 offset = vec2(float(x), float(y)) * pxSize;
            float luma = dot(getPixel(uv + offset).rgb, vec3(0.299, 0.587, 0.114));
            iX += kernelX[y + 1][x + 1] * luma;
            iY += kernelY[y + 1][x + 1] * luma;
        }
    }
    return vec2(iX, iY);
}

void main() {
    // Snap UV to pixel block grid
    vec2 fC  = floor(vUv * iResolution.xy / uBlockSize) * uBlockSize;
    vec2 nUV = fC / iResolution.xy;

    vec2  edge  = sobel(nUV);
    vec4  color = getPixel(nUV);

    color = pow(color, vec4(uColorPower));
    // Boost saturation: scale so brightest channel hits 1
    float mx = 1.0 / max(color.r, max(color.g, max(color.b, 0.001)));

    if (length(edge) >= uEdgeThreshold) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
        gl_FragColor = vec4(mx * color.rgb, 1.0);
    }
}
