precision highp float;

uniform sampler2D tDiffuse;
uniform float     uSide; // 0=left, 1=right, 2=top, 3=bottom

varying vec2 vUv;

void main() {
    vec2 uv = vUv;

    if (uSide < 0.5) {
        if (uv.x > 0.5) uv.x = 1.0 - uv.x;
    } else if (uSide < 1.5) {
        if (uv.x < 0.5) uv.x = 1.0 - uv.x;
    } else if (uSide < 2.5) {
        if (uv.y < 0.5) uv.y = 1.0 - uv.y;
    } else {
        if (uv.y > 0.5) uv.y = 1.0 - uv.y;
    }

    vec4 c = texture(tDiffuse, uv);
    float a = c.a;
    gl_FragColor = vec4(c.rgb * a, a);
}
