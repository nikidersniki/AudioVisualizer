precision highp float;

uniform sampler2D tDiffuse;
uniform sampler2D iChannel1;   // noise / paper texture
uniform vec2      iResolution;
uniform float     uScribbleStrength;
uniform float     uVignette;

varying vec2 vUv;

// ── Paper noise ───────────────────────────────────────────────────────────────
vec4 getRand(vec2 pos) {
    // iChannel1 is 1024×1024; scale matches sketch.glsl usage
    vec2 uv = pos / (1024.0 * sqrt(iResolution.x / 600.0));
    return texture(iChannel1, uv);
}

// ── Paint layer — weighted blur + contrast / warmth boost (inline iChannel2) ──
vec4 paintCol(vec2 uv) {
    vec3  c     = vec3(0.0);
    float total = 0.0;
    for (int x = -3; x <= 3; x++) {
        for (int y = -3; y <= 3; y++) {
            float w = 1.0 / (1.0 + float(x * x + y * y));
            c     += texture(tDiffuse, uv + vec2(float(x), float(y)) / iResolution * 5.0).rgb * w;
            total += w;
        }
    }
    c /= total;
    float m = dot(vec3(0.333), c);
    c = (c - m) * 1.5 + m;
    c = clamp(0.3 + 0.8 * c, 0.0, 1.0);
    return vec4(c, 1.0);
}

// ── Line layer — Laplacian at two scales (inline iChannel0, simulates LOD) ───
vec4 lineCol(vec2 uv) {
    vec2 s = 1.0 / iResolution;

    // Sharp edges
    vec4 c0    = texture(tDiffuse, uv);
    vec4 sharp = abs(4.0 * c0
        - texture(tDiffuse, uv + vec2( s.x,   0.0))
        - texture(tDiffuse, uv + vec2(-s.x,   0.0))
        - texture(tDiffuse, uv + vec2(  0.0,  s.y))
        - texture(tDiffuse, uv + vec2(  0.0, -s.y)));

    // Soft edges (LOD-3.5 simulation — wider kernel)
    float r = 3.5;
    vec4 soft = abs(4.0 * c0
        - texture(tDiffuse, uv + vec2( r * s.x,    0.0))
        - texture(tDiffuse, uv + vec2(-r * s.x,    0.0))
        - texture(tDiffuse, uv + vec2(   0.0,  r * s.y))
        - texture(tDiffuse, uv + vec2(   0.0, -r * s.y)));

    return clamp(0.5 * sharp + 0.5 * soft, 0.0, 2.0);
}

// ─────────────────────────────────────────────────────────────────────────────
void main() {
    vec2 fragCoord = vUv * iResolution;
    vec4 texel     = texture(tDiffuse, vUv);

    vec4 r  = getRand(fragCoord * 1.1) - getRand(fragCoord * 1.1 + vec2(1.0, -1.0) * 1.5);
    vec4 r2 = getRand(fragCoord * 0.015) - 0.5 + getRand(fragCoord * 0.008) - 0.5;

    vec4 pc = paintCol(vUv);
    vec4 lc = lineCol(vUv).xxxx * (0.75 + 0.25 * (1.0 - r.y));
    vec4 c  = 1.0 - 0.15 * lc * uScribbleStrength;
    c *= pc;

    vec4 result = c * (0.95 + 0.06 * r.xxxx + 0.06 * r);

    // Vignette
    vec2  sc    = (fragCoord - 0.5 * iResolution) / iResolution.x;
    float vign  = 1.0 - 0.3  * dot(sc, sc);
    vign *= 1.0 - 0.7 * exp(-sin(fragCoord.x / iResolution.x * 3.14159) * 40.0);
    vign *= 1.0 - 0.7 * exp(-sin(fragCoord.y / iResolution.y * 3.14159) * 20.0);
    result *= mix(1.0, vign, uVignette);

    // Premultiplied alpha — transparent on non-global layers
    float origAlpha = texel.a;
    gl_FragColor = vec4(result.rgb * origAlpha, origAlpha);
}
