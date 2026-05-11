precision highp float;

uniform sampler2D tDiffuse;
uniform sampler2D uAscii;
uniform vec2  iResolution;
uniform float uCellSize;
uniform float uGlyphCount;
uniform float uColors;   // 2..256

varying vec2 vUv;

void main() {
    vec2 cellPx     = vec2(uCellSize) / iResolution;
    vec2 cellId     = floor(vUv / cellPx);
    vec2 cellOrigin = cellId * cellPx;
    vec2 cellCenter = cellOrigin + cellPx * 0.5;

    vec4 src   = texture(tDiffuse, cellCenter);
    vec3 col   = src.rgb;
    float a    = src.a;
    float lum  = dot(col, vec3(0.299, 0.587, 0.114));

    // Per-channel quantization to uColors levels
    float steps = max(uColors - 1.0, 1.0);
    vec3 q = floor(col * steps + 0.5) / steps;

    // Glyph pick by luminance
    float gn  = uGlyphCount;
    float idx = floor(clamp(lum, 0.0, 0.9999) * gn);
    vec2  inCell = (vUv - cellOrigin) / cellPx;
    float u   = (idx + inCell.x) / gn;
    float v   = inCell.y;
    float gA  = texture(uAscii, vec2(u, v)).r;

    // Premultiplied alpha; transparent outside glyph so layers below show through
    float outA = gA * a;
    gl_FragColor = vec4(q * outA, outA);
}
