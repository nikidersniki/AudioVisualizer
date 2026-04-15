uniform sampler2D tDiffuse;
uniform sampler2D iChannel1;

uniform vec2 iResolution;
uniform float iTime;
uniform vec4 iMouse;

varying vec2 vUv;

const float PI = 3.1415926536;
const float PI2 = PI * 2.0; 
const int mSize = 20;
const int kSize = (mSize-1)/2;
const float sigma = 5.0;

float kernel[mSize];

float normpdf(in float x, in float sigma) {
	return 0.39894 * exp(-0.5 * x * x / (sigma * sigma)) / sigma;
}

vec3 colorDodge(in vec3 src, in vec3 dst) {
    return step(0.0, dst) * mix(min(vec3(1.0), dst/ (1.0 - src)), vec3(1.0), step(1.0, src)); 
}

float greyScale(in vec3 col) {
    return dot(col, vec3(0.3, 0.59, 0.11));
}

vec2 random(vec2 p){
	p = fract(p * vec2(314.159, 314.265));
    p += dot(p, p.yx + 17.17);
    return fract((p.xx + p.yx) * p.xy);
}

vec2 random2(vec2 p) {
    return texture(iChannel1, p / vec2(1024.0)).xy;
}

void main() {
    vec2 q = vUv;

    vec3 col = texture(tDiffuse, q).rgb;

    vec2 r = random(q);
    r.x *= PI2;
    vec2 cr = vec2(sin(r.x),cos(r.x))*sqrt(r.y);

    vec3 blurred = texture(tDiffuse, q + cr * (vec2(mSize) / iResolution.xy)).rgb;

    if (iMouse.z > 0.5) {
        blurred = vec3(0.0); 
        float Z = 0.0;

        for (int j = 0; j <= kSize; ++j) {
            kernel[kSize+j] = kernel[kSize-j] = normpdf(float(j), sigma);
        }

        for (int j = 0; j < mSize; ++j) {
            Z += kernel[j];
        }

        for (int i = -kSize; i <= kSize; ++i) {
            for (int j = -kSize; j <= kSize; ++j) {
                vec2 offset = vec2(float(i), float(j)) / iResolution.xy;
                blurred += kernel[kSize+j]*kernel[kSize+i] *
                    texture(tDiffuse, q + offset).rgb;
            }
        }

        blurred = blurred / (Z * Z);
    }

    vec3 inv = vec3(1.0) - blurred; 
    vec3 lighten = colorDodge(col, inv);
    vec3 res = vec3(greyScale(lighten));

    res = vec3(pow(res.x, 3.0)); 

    if (iMouse.z > 0.5) {
        res *= 0.25 + 0.75 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.15);
    }

    gl_FragColor = vec4(res, 1.0);
}