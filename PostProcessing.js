import {
    ShaderMaterial, WebGLRenderTarget, Mesh, PlaneGeometry,
    Scene, OrthographicCamera, Vector2, Vector4,
    TextureLoader, RepeatWrapping, Color,
} from './modules/three.js/build/three.module.js';

import { UnrealBloomPass } from './modules/three.js/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass }  from './modules/three.js/examples/jsm/postprocessing/AfterimagePass.js';
import { FilmPass }        from './modules/three.js/examples/jsm/postprocessing/FilmPass.js';
import { GlitchPass }      from './modules/three.js/examples/jsm/postprocessing/GlitchPass.js';
import { OutputPass }      from './modules/three.js/examples/jsm/postprocessing/OutputPass.js';

// ── Noise texture (loaded once) ───────────────────────────────
let _noiseTex = null;
function _getOrLoadNoiseTex() {
    if (!_noiseTex) {
        _noiseTex = new TextureLoader().load('./Graphics/noise.png');
        _noiseTex.wrapS = _noiseTex.wrapT = RepeatWrapping;
    }
    return _noiseTex;
}

// ─────────────────────────────────────────────
//  Shader registry  (custom GLSL passes)
// ─────────────────────────────────────────────
export const PP_SHADER_REGISTRY = {
    sketch: {
        name:         'Sketch',
        vertexPath:   './shaders/vertex.glsl',
        fragmentPath: './shaders/sketch.glsl',
        _vertSrc: null,
        _fragSrc: null,
        defaultProperties: { enableBlur: false, resolution: 20 },
        propertyDefs: [
            { key: 'enableBlur', label: 'High Quality Blur', type: 'checkbox' },
            { key: 'resolution', label: 'Blur Size', type: 'slider', min: 1, max: 60, step: 1 },
        ],
        buildUniforms(props, w, h) {
            return {
                tDiffuse:    { value: null },
                iChannel1:   { value: _getOrLoadNoiseTex() },
                iResolution: { value: new Vector2(w, h) },
                iTime:       { value: 0 },
                iMouse:      { value: new Vector4(0, 0, props.enableBlur ? 1 : 0, 0) },
            };
        },
        patchFragmentSrc(src, props) {
            const size = Math.max(2, Math.round(props.resolution));
            return src.replace(/const int mSize\s*=\s*\d+\s*;/, `const int mSize = ${size};`);
        },
        updateUniforms(u, props, time, w, h) {
            u.iTime.value    = time / 1000;
            u.iResolution.value.set(w, h);
            u.iMouse.value.z = props.enableBlur ? 1 : 0;
        },
    },

    sharpen: {
        name:         'Sharpen',
        vertexPath:   './shaders/vertex.glsl',
        fragmentPath: './shaders/sharpen.glsl',
        _vertSrc: null,
        _fragSrc: null,
        defaultProperties: { amount: 1.0, radius: 1.0, threshold: 0.0 },
        propertyDefs: [
            { key: 'amount',    label: 'Amount',    type: 'slider', min: 0, max: 5,   step: 0.01 },
            { key: 'radius',    label: 'Radius',    type: 'slider', min: 1, max: 8,   step: 0.1  },
            { key: 'threshold', label: 'Threshold', type: 'slider', min: 0, max: 1,   step: 0.01 },
        ],
        buildUniforms(props, w, h) {
            return {
                tDiffuse:    { value: null },
                iResolution: { value: new Vector2(w, h) },
                uAmount:     { value: props.amount },
                uRadius:     { value: props.radius },
                uThreshold:  { value: props.threshold },
            };
        },
        updateUniforms(u, props, _time, w, h) {
            u.iResolution.value.set(w, h);
            u.uAmount.value    = props.amount;
            u.uRadius.value    = props.radius;
            u.uThreshold.value = props.threshold;
        },
    },

    outline: {
        name:         'Outline',
        vertexPath:   './shaders/vertex.glsl',
        fragmentPath: './shaders/outline.glsl',
        _vertSrc: null,
        _fragSrc: null,
        defaultProperties: { amount: 1.0, thickness: 1.0, color: '#ffffff' },
        propertyDefs: [
            { key: 'amount',    label: 'Amount',    type: 'slider', min: 0, max: 5,  step: 0.01 },
            { key: 'thickness', label: 'Thickness', type: 'slider', min: 1, max: 10, step: 0.1  },
            { key: 'color',     label: 'Color',     type: 'color' },
        ],
        buildUniforms(props, w, h) {
            return {
                tDiffuse:    { value: null },
                iResolution: { value: new Vector2(w, h) },
                uAmount:     { value: props.amount },
                uThickness:  { value: props.thickness },
                uColor:      { value: new Color(props.color) },
            };
        },
        updateUniforms(u, props, _time, w, h) {
            u.iResolution.value.set(w, h);
            u.uAmount.value    = props.amount;
            u.uThickness.value = props.thickness;
            u.uColor.value.set(props.color);
        },
    },

    waterPaint: {
        name:         'Water Paint',
        vertexPath:   './shaders/vertex.glsl',
        fragmentPath: './shaders/waterpaint.glsl',
        _vertSrc: null,
        _fragSrc: null,
        defaultProperties: { scribbleStrength: 1.0, vignette: true },
        propertyDefs: [
            { key: 'scribbleStrength', label: 'Scribble Strength', type: 'slider', min: 0, max: 3, step: 0.01 },
            { key: 'vignette',         label: 'Vignette',          type: 'checkbox' },
        ],
        buildUniforms(props, w, h) {
            return {
                tDiffuse:          { value: null },
                iChannel1:         { value: _getOrLoadNoiseTex() },
                iResolution:       { value: new Vector2(w, h) },
                uScribbleStrength: { value: props.scribbleStrength },
                uVignette:         { value: props.vignette ? 1.0 : 0.0 },
            };
        },
        updateUniforms(u, props, _time, w, h) {
            u.iResolution.value.set(w, h);
            u.uScribbleStrength.value = props.scribbleStrength;
            u.uVignette.value         = props.vignette ? 1.0 : 0.0;
        },
    },

    colorBlocks: {
        name:         'Color Blocks',
        vertexPath:   './shaders/vertex.glsl',
        fragmentPath: './shaders/colorblocks.glsl',
        _vertSrc: null,
        _fragSrc: null,
        defaultProperties: { intensity: 100 },
        propertyDefs: [
            { key: 'intensity', label: 'Intensity', type: 'slider', min: 0, max: 500, step: 1 },
        ],
        buildUniforms(props, w, h) {
            return {
                tDiffuse:    { value: null },
                iResolution: { value: new Vector2(w, h) },
                uIntensity:  { value: props.intensity },
            };
        },
        updateUniforms(u, props, _time, w, h) {
            u.iResolution.value.set(w, h);
            u.uIntensity.value = props.intensity;
        },
    },

    pixelArt: {
        name:         'Pixless Dither',
        vertexPath:   './shaders/vertex.glsl',
        fragmentPath: './shaders/pixelart.glsl',
        _vertSrc: null,
        _fragSrc: null,
        defaultProperties: { ditherIntensity: 1.0, pixelSize: 4, colorLevels: 8, globalMix: 1.0 },
        propertyDefs: [
            { key: 'ditherIntensity', label: 'Dither Intensity', type: 'slider', min: 0,   max: 3,  step: 0.01 },
            { key: 'pixelSize',       label: 'Pixel Size',       type: 'slider', min: 1,   max: 16, step: 1    },
            { key: 'colorLevels',     label: 'Colors',           type: 'slider', min: 2,   max: 32, step: 1    },
            { key: 'globalMix',       label: 'Mix',              type: 'slider', min: 0,   max: 1,  step: 0.01 },
        ],
        buildUniforms(props, w, h) {
            return {
                tDiffuse:         { value: null },
                iResolution:      { value: new Vector2(w, h) },
                uDitherIntensity: { value: props.ditherIntensity },
                uPixelSize:       { value: props.pixelSize },
                uColorLevels:     { value: props.colorLevels },
                uGlobalMix:       { value: props.globalMix },
            };
        },
        updateUniforms(u, props, _time, w, h) {
            u.iResolution.value.set(w, h);
            u.uDitherIntensity.value = props.ditherIntensity;
            u.uPixelSize.value       = props.pixelSize;
            u.uColorLevels.value     = props.colorLevels;
            u.uGlobalMix.value       = props.globalMix;
        },
    },

    sineThresholder: {
        name:         'Sine Thresholder',
        vertexPath:   './shaders/vertex.glsl',
        fragmentPath: './shaders/sinethresholder.glsl',
        _vertSrc: null,
        _fragSrc: null,
        defaultProperties: { frequency: 10, displace: 40, color0: '#000000', color1: '#ffffff', keepColors: true },
        propertyDefs: [
            { key: 'frequency',  label: 'Frequency',   type: 'slider',   min: 1, max: 100, step: 0.1 },
            { key: 'displace',   label: 'Displace',    type: 'slider',   min: 0, max: 200, step: 0.1 },
            { key: 'color0',     label: 'Color A',     type: 'color' },
            { key: 'color1',     label: 'Color B',     type: 'color' },
            { key: 'keepColors', label: 'Keep Colors', type: 'checkbox' },
        ],
        buildUniforms(props, w, h) {
            return {
                tDiffuse:    { value: null },
                iResolution: { value: new Vector2(w, h) },
                uFrequency:  { value: props.frequency },
                uDisplace:   { value: props.displace },
                uColor0:     { value: new Color(props.color0) },
                uColor1:     { value: new Color(props.color1) },
                uKeepColors: { value: props.keepColors ? 1.0 : 0.0 },
            };
        },
        updateUniforms(u, props, _time, w, h) {
            u.iResolution.value.set(w, h);
            u.uFrequency.value  = props.frequency;
            u.uDisplace.value   = props.displace;
            u.uColor0.value.set(props.color0);
            u.uColor1.value.set(props.color1);
            u.uKeepColors.value = props.keepColors ? 1.0 : 0.0;
        },
    },

    hsv: {
        name:         'Hue / Saturation / Color',
        vertexPath:   './shaders/vertex.glsl',
        fragmentPath: './shaders/hsv.glsl',
        _vertSrc: null,
        _fragSrc: null,
        defaultProperties: { hue: 0.0, saturation: 1.0, value: 1.0, fac: 1.0, color: '#ffffff' },
        propertyDefs: [
            { key: 'hue',        label: 'Hue',        type: 'slider', min: -0.5, max: 0.5, step: 0.01 },
            { key: 'saturation', label: 'Saturation',  type: 'slider', min: 0,    max: 2,   step: 0.01 },
            { key: 'value',      label: 'Value',       type: 'slider', min: 0,    max: 2,   step: 0.01 },
            { key: 'fac',        label: 'Factor',      type: 'slider', min: 0,    max: 1,   step: 0.01 },
            { key: 'color',      label: 'Color',       type: 'color' },
        ],
        buildUniforms(props) {
            return {
                tDiffuse:     { value: null },
                uHue:         { value: props.hue },
                uSaturation:  { value: props.saturation },
                uValue:       { value: props.value },
                uFac:         { value: props.fac },
                uColor:       { value: new Color(props.color) },
            };
        },
        updateUniforms(u, props) {
            u.uHue.value        = props.hue;
            u.uSaturation.value = props.saturation;
            u.uValue.value      = props.value;
            u.uFac.value        = props.fac;
            u.uColor.value.set(props.color);
        },
    },

    colorRamp: {
        name:         'Color Ramp',
        vertexPath:   './shaders/vertex.glsl',
        fragmentPath: './shaders/colorramp.glsl',
        _vertSrc: null,
        _fragSrc: null,
        defaultProperties: {
            color0: '#000000', pos1: 0.25, color1: '#555555',
            pos2: 0.5, color2: '#aaaaaa', pos3: 0.75, color3: '#ffffff',
            fac: 1.0,
        },
        propertyDefs: [
            { key: 'color0', label: 'Color 1',    type: 'color' },
            { key: 'pos1',   label: 'Pos 2',      type: 'slider', min: 0, max: 1, step: 0.01 },
            { key: 'color1', label: 'Color 2',    type: 'color' },
            { key: 'pos2',   label: 'Pos 3',      type: 'slider', min: 0, max: 1, step: 0.01 },
            { key: 'color2', label: 'Color 3',    type: 'color' },
            { key: 'pos3',   label: 'Pos 4',      type: 'slider', min: 0, max: 1, step: 0.01 },
            { key: 'color3', label: 'Color 4',    type: 'color' },
            { key: 'fac',    label: 'Factor',     type: 'slider', min: 0, max: 1, step: 0.01 },
        ],
        buildUniforms(props) {
            return {
                tDiffuse: { value: null },
                uPos1:    { value: props.pos1 },
                uPos2:    { value: props.pos2 },
                uPos3:    { value: props.pos3 },
                uColor0:  { value: new Color(props.color0) },
                uColor1:  { value: new Color(props.color1) },
                uColor2:  { value: new Color(props.color2) },
                uColor3:  { value: new Color(props.color3) },
                uFac:     { value: props.fac },
            };
        },
        updateUniforms(u, props) {
            u.uPos1.value     = props.pos1;
            u.uPos2.value     = props.pos2;
            u.uPos3.value     = props.pos3;
            u.uColor0.value.set(props.color0);
            u.uColor1.value.set(props.color1);
            u.uColor2.value.set(props.color2);
            u.uColor3.value.set(props.color3);
            u.uFac.value      = props.fac;
        },
    },

    blur: {
        name:         'Blur',
        vertexPath:   './shaders/vertex.glsl',
        fragmentPath: './shaders/blur.glsl',
        _vertSrc: null,
        _fragSrc: null,
        defaultProperties: { radius: 5 },
        propertyDefs: [
            { key: 'radius', label: 'Blur Radius', type: 'slider', min: 0, max: 20, step: 0.1 },
        ],
        buildUniforms(props, w, h) {
            return {
                tDiffuse:    { value: null },
                iResolution: { value: new Vector2(w, h) },
                uTexelSize:  { value: new Vector2(1 / w, 1 / h) },
                uRadius:     { value: props.radius },
            };
        },
        updateUniforms(u, props, _time, w, h) {
            u.iResolution.value.set(w, h);
            u.uTexelSize.value.set(1 / w, 1 / h);
            u.uRadius.value = props.radius;
        },
    },

    dotScreen: {
        name:         'Dot Screen',
        vertexPath:   './shaders/vertex.glsl',
        fragmentPath: './shaders/dotscreen.glsl',
        _vertSrc: null,
        _fragSrc: null,
        defaultProperties: { angle: 0.5, scale: 1.0, keepColors: true },
        propertyDefs: [
            { key: 'angle',      label: 'Angle',       type: 'slider',   min: 0, max: 3.14, step: 0.01 },
            { key: 'scale',      label: 'Scale',       type: 'slider',   min: 0.1, max: 10, step: 0.1  },
            { key: 'keepColors', label: 'Keep Colors', type: 'checkbox' },
        ],
        buildUniforms(props, w, h) {
            return {
                tDiffuse:    { value: null },
                iResolution: { value: new Vector2(w, h) },
                uAngle:      { value: props.angle },
                uScale:      { value: props.scale },
                uKeepColors: { value: props.keepColors ? 1.0 : 0.0 },
            };
        },
        updateUniforms(u, props, _time, w, h) {
            u.iResolution.value.set(w, h);
            u.uAngle.value      = props.angle;
            u.uScale.value      = props.scale;
            u.uKeepColors.value = props.keepColors ? 1.0 : 0.0;
        },
    },
};

// Load all shader GLSL sources from disk — call once at app startup
export async function initShaders() {
    await Promise.all(
        Object.values(PP_SHADER_REGISTRY).map(async reg => {
            [reg._vertSrc, reg._fragSrc] = await Promise.all([
                fetch(reg.vertexPath).then(r => r.text()),
                fetch(reg.fragmentPath).then(r => r.text()),
            ]);
        })
    );
}

// ─────────────────────────────────────────────
//  Native pass registry  (Three.js built-in passes)
// ─────────────────────────────────────────────
const _bloomFactors = [1.0, 0.8, 0.6, 0.4, 0.2];

export const PP_NATIVE_REGISTRY = {
    unrealBloom: {
        name: 'Bloom (Unreal)',
        // UnrealBloomPass additively blends bloom onto readBuffer in-place (not writeBuffer).
        // The pipeline must NOT advance srcTarget/ppIdx after this pass when it is not last.
        writesToReadBuffer: true,
        defaultProperties: { threshold: 0.5, strength: 1.5, radius: 0.4, samples: 5 },
        propertyDefs: [
            { key: 'threshold', label: 'Threshold', type: 'slider', min: 0, max: 1, step: 0.01 },
            { key: 'strength',  label: 'Strength',  type: 'slider', min: 0, max: 5, step: 0.01 },
            { key: 'radius',    label: 'Radius',    type: 'slider', min: 0, max: 1, step: 0.01 },
            { key: 'samples',   label: 'Samples',   type: 'slider', min: 1, max: 5, step: 1    },
        ],
        create: (w, h, p) => new UnrealBloomPass(new Vector2(w, h), p.strength, p.radius, p.threshold),
        update(pass, props) {
            pass.threshold = props.threshold;
            pass.strength  = props.strength;
            pass.radius    = props.radius;
            const n = Math.round(props.samples);
            pass.compositeMaterial.uniforms['bloomFactors'].value =
                _bloomFactors.map((f, i) => i < n ? f : 0);
        },
    },

    afterimage: {
        name: 'Afterimage',
        defaultProperties: { damp: 0.96 },
        propertyDefs: [
            { key: 'damp', label: 'Damp', type: 'slider', min: 0, max: 1, step: 0.01 },
        ],
        create: (_w, _h, p) => new AfterimagePass(p.damp),
        update: (pass, props) => { pass.uniforms['damp'].value = props.damp; },
    },

    film: {
        name: 'Film Grain',
        defaultProperties: { intensity: 0.5, grayscale: false },
        propertyDefs: [
            { key: 'intensity', label: 'Intensity', type: 'slider', min: 0, max: 1, step: 0.01 },
            { key: 'grayscale', label: 'Grayscale', type: 'checkbox' },
        ],
        create: (_w, _h, p) => new FilmPass(p.intensity, p.grayscale),
        update(pass, props) {
            pass.uniforms['intensity'].value = props.intensity;
            pass.uniforms['grayscale'].value = props.grayscale;
        },
    },

    glitch: {
        name: 'Glitch',
        defaultProperties: { goWild: false },
        propertyDefs: [
            { key: 'goWild', label: 'Go Wild', type: 'checkbox' },
        ],
        create: () => new GlitchPass(),
        update: (pass, props) => { pass.goWild = props.goWild; },
    },

    output: {
        name: 'Output (Tone Map)',
        defaultProperties: {},
        propertyDefs: [],
        create: () => new OutputPass(),
        update: () => {},
    },
};

// ─────────────────────────────────────────────
//  NativePassLayer  — wraps any Three.js built-in pass
// ─────────────────────────────────────────────
export class NativePassLayer {
    constructor(passType) {
        this.id         = crypto.randomUUID();
        this.passType   = passType;
        const reg       = PP_NATIVE_REGISTRY[passType];
        this.name       = reg?.name ?? passType;
        this.visible    = true;
        this.properties = { ...(reg?.defaultProperties ?? {}) };
        this._pass      = null;
    }

    get propertyDefs() { return PP_NATIVE_REGISTRY[this.passType]?.propertyDefs ?? []; }

    getPass(w, h) {
        if (!this._pass)
            this._pass = PP_NATIVE_REGISTRY[this.passType]?.create(w, h, this.properties);
        return this._pass;
    }

    resize(w, h) { this._pass?.setSize?.(w, h); }

    invalidateMaterial() { this._pass?.dispose?.(); this._pass = null; }

    toJSON() {
        return { id: this.id, type: 'native', passType: this.passType,
                 name: this.name, visible: this.visible, properties: { ...this.properties } };
    }

    static fromJSON(d) {
        const l = new NativePassLayer(d.passType);
        l.id         = d.id;
        l.name       = d.name    ?? l.name;
        l.visible    = d.visible ?? true;
        l.properties = { ...l.properties, ...d.properties };
        return l;
    }
}

// ─────────────────────────────────────────────
//  PostProcessingLayer  — one custom GLSL shader pass
// ─────────────────────────────────────────────
export class PostProcessingLayer {
    constructor(shaderName) {
        this.id         = crypto.randomUUID();
        this.shaderName = shaderName;
        this.name       = PP_SHADER_REGISTRY[shaderName]?.name ?? shaderName;
        this.visible    = true;
        this.properties = { ...(PP_SHADER_REGISTRY[shaderName]?.defaultProperties ?? {}) };
        this._material  = null;
    }

    getMaterial(w, h) {
        if (!this._material) {
            const reg = PP_SHADER_REGISTRY[this.shaderName];
            if (!reg?._vertSrc || !reg?._fragSrc) return null;
            const fragSrc = reg.patchFragmentSrc
                ? reg.patchFragmentSrc(reg._fragSrc, this.properties)
                : reg._fragSrc;
            this._material = new ShaderMaterial({
                vertexShader:   reg._vertSrc,
                fragmentShader: fragSrc,
                uniforms:       reg.buildUniforms(this.properties, w, h),
                depthTest:  false,
                depthWrite: false,
            });
        }
        return this._material;
    }

    invalidateMaterial() { this._material?.dispose(); this._material = null; }

    toJSON() {
        return { id: this.id, shaderName: this.shaderName, name: this.name,
                 visible: this.visible, properties: { ...this.properties } };
    }

    static fromJSON(d) {
        const l = new PostProcessingLayer(d.shaderName);
        Object.assign(l, d);
        l._material = null;
        return l;
    }
}

// ─────────────────────────────────────────────
//  PostProcessingPipeline  — ping-pong blit through all visible layers
// ─────────────────────────────────────────────
export class PostProcessingPipeline {
    constructor(renderer, w, h) {
        this.renderer = renderer;
        this.width = w; this.height = h;
        this._ping  = new WebGLRenderTarget(w, h);
        this._pong  = new WebGLRenderTarget(w, h);
        this._quad  = new Mesh(new PlaneGeometry(2, 2));
        this._scene = new Scene();
        this._scene.add(this._quad);
        this._cam   = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this._copyMat = new ShaderMaterial({
            vertexShader:   `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.); }`,
            fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor=texture2D(tDiffuse,vUv); }`,
            uniforms: { tDiffuse: { value: null } },
            depthTest: false, depthWrite: false,
        });
        this.layers = [];
    }

    resize(w, h) {
        this.width = w; this.height = h;
        this._ping.setSize(w, h);
        this._pong.setSize(w, h);
        for (const layer of this.layers) {
            if (layer instanceof NativePassLayer) layer.resize(w, h);
            else layer.invalidateMaterial();
        }
    }

    // finalTarget: if provided, the last pass outputs here instead of to screen.
    // Used by per-layer PP so the result can be composited rather than shown directly.
    apply(inputTarget, time, finalTarget = null) {
        const deltaTime = this._lastTime === undefined ? 0.016 : (time - this._lastTime) / 1000;
        this._lastTime  = time;

        const active = this.layers.filter(l => l.visible);

        if (active.length === 0) {
            this._copyMat.uniforms.tDiffuse.value = inputTarget.texture;
            this._quad.material = this._copyMat;
            this.renderer.setRenderTarget(finalTarget);
            this.renderer.render(this._scene, this._cam);
            return;
        }

        const pingpong = [this._ping, this._pong];
        let srcTarget  = inputTarget;
        let ppIdx      = 0;

        for (let i = 0; i < active.length; i++) {
            const layer  = active[i];
            const isLast = i === active.length - 1;

            if (layer instanceof NativePassLayer) {
                const pass = layer.getPass(this.width, this.height);
                if (!pass) continue;
                const reg = PP_NATIVE_REGISTRY[layer.passType];
                reg?.update(pass, layer.properties, this.width, this.height);

                if (isLast && finalTarget === null) {
                    // Normal path: render to screen
                    pass.renderToScreen = true;
                    pass.render(this.renderer, null, srcTarget, deltaTime, false);
                } else if (isLast) {
                    // Redirect last pass to finalTarget
                    pass.renderToScreen = false;
                    if (reg?.writesToReadBuffer) {
                        pass.render(this.renderer, pingpong[ppIdx], srcTarget, deltaTime, false);
                        // srcTarget was modified in-place; copy it to finalTarget
                        this._copyMat.uniforms.tDiffuse.value = srcTarget.texture;
                        this._quad.material = this._copyMat;
                        this.renderer.setRenderTarget(finalTarget);
                        this.renderer.render(this._scene, this._cam);
                    } else {
                        pass.render(this.renderer, finalTarget, srcTarget, deltaTime, false);
                    }
                } else {
                    pass.renderToScreen = false;
                    const dst = pingpong[ppIdx];
                    pass.render(this.renderer, dst, srcTarget, deltaTime, false);
                    if (!reg?.writesToReadBuffer) {
                        srcTarget = dst;
                        ppIdx = 1 - ppIdx;
                    }
                }
                continue;
            }

            // Custom GLSL shader layer
            const mat = layer.getMaterial(this.width, this.height);
            if (!mat) continue;

            PP_SHADER_REGISTRY[layer.shaderName]
                ?.updateUniforms(mat.uniforms, layer.properties, time, this.width, this.height);
            mat.uniforms.tDiffuse.value = srcTarget.texture;
            this._quad.material = mat;

            if (isLast) {
                this.renderer.setRenderTarget(finalTarget);
                this.renderer.render(this._scene, this._cam);
            } else {
                const dst = pingpong[ppIdx];
                ppIdx = 1 - ppIdx;
                this.renderer.setRenderTarget(dst);
                this.renderer.setClearColor(0, 0);
                this.renderer.clear();
                this.renderer.render(this._scene, this._cam);
                srcTarget = dst;
            }
        }
    }
}
