import {
    ShaderMaterial, WebGLRenderTarget, Mesh, PlaneGeometry,
    Scene, OrthographicCamera, Vector2, Vector4,
    TextureLoader, RepeatWrapping, Color,
} from './modules/three.js/build/three.module.js';

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
//  Shader registry
//  Add an entry here to expose a new shader in the PP panel.
//  GLSL files are loaded from /shaders/ at startup via initShaders().
// ─────────────────────────────────────────────
export const PP_SHADER_REGISTRY = {
    sketch: {
        name:         'Sketch',
        vertexPath:   './shaders/vertex.glsl',
        fragmentPath: './shaders/sketch.glsl',
        _vertSrc: null, // populated by initShaders()
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
        // mSize is a GLSL compile-time const used for array sizes/loop bounds,
        // so it must be injected into the source rather than sent as a uniform.
        patchFragmentSrc(src, props) {
            const size = Math.max(2, Math.round(props.resolution));
            return src.replace(/const int mSize\s*=\s*\d+\s*;/, `const int mSize = ${size};`);
        },
        updateUniforms(u, props, time, w, h) {
            u.iTime.value        = time / 1000;
            u.iResolution.value.set(w, h);
            u.iMouse.value.z     = props.enableBlur ? 1 : 0;
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
        name:         'Pixel Art',
        vertexPath:   './shaders/vertex.glsl',
        fragmentPath: './shaders/pixelart.glsl',
        _vertSrc: null,
        _fragSrc: null,
        defaultProperties: { edgeThreshold: 0.02, blockSize: 8, colorPower: 0.4545 },
        propertyDefs: [
            { key: 'edgeThreshold', label: 'Edge Threshold', type: 'slider', min: 0,   max: 0.5, step: 0.001 },
            { key: 'blockSize',     label: 'Block Size',     type: 'slider', min: 1,   max: 32,  step: 1     },
            { key: 'colorPower',    label: 'Color Power',    type: 'slider', min: 0.1, max: 3,   step: 0.01  },
        ],
        buildUniforms(props, w, h) {
            return {
                tDiffuse:       { value: null },
                iResolution:    { value: new Vector2(w, h) },
                uEdgeThreshold: { value: props.edgeThreshold },
                uBlockSize:     { value: props.blockSize },
                uColorPower:    { value: props.colorPower },
            };
        },
        updateUniforms(u, props, _time, w, h) {
            u.iResolution.value.set(w, h);
            u.uEdgeThreshold.value = props.edgeThreshold;
            u.uBlockSize.value     = props.blockSize;
            u.uColorPower.value    = props.colorPower;
        },
    },

    sineThresholder: {
        name:         'Sine Thresholder',
        vertexPath:   './shaders/vertex.glsl',
        fragmentPath: './shaders/sinethresholder.glsl',
        _vertSrc: null,
        _fragSrc: null,
        defaultProperties: {
            frequency: 10,
            displace:  40,
            color0: '#000000',
            color1: '#ffffff',
        },
        propertyDefs: [
            { key: 'frequency', label: 'Frequency', type: 'slider', min: 1, max: 100, step: 0.1 },
            { key: 'displace',  label: 'Displace',  type: 'slider', min: 0, max: 200, step: 0.1 },
            { key: 'color0',    label: 'Color A',   type: 'color' },
            { key: 'color1',    label: 'Color B',   type: 'color' },
        ],
        buildUniforms(props, w, h) {
            return {
                tDiffuse:    { value: null },
                iResolution: { value: new Vector2(w, h) },
                uFrequency:  { value: props.frequency },
                uDisplace:   { value: props.displace },
                uColor0:     { value: new Color(props.color0) },
                uColor1:     { value: new Color(props.color1) },
            };
        },
        updateUniforms(u, props, _time, w, h) {
            u.iResolution.value.set(w, h);
            u.uFrequency.value = props.frequency;
            u.uDisplace.value  = props.displace;
            u.uColor0.value.set(props.color0);
            u.uColor1.value.set(props.color1);
        },
    },
            blur: {
            name:         'Blur',
            vertexPath:   './shaders/vertex.glsl',
            fragmentPath: './shaders/blur.glsl',
            _vertSrc: null,
            _fragSrc: null,
                
            defaultProperties: {
                radius: 5,
            },
        
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
        bloom: {
            name:         'Bloom',
            vertexPath:   './shaders/vertex.glsl',
            fragmentPath: './shaders/bloom.glsl',
            _vertSrc: null,
            _fragSrc: null,
                
            defaultProperties: {
                threshold: 0.8,
                intensity: 1.5,
                radius: 4.0,
            },
        
            propertyDefs: [
                { key: 'threshold', label: 'Threshold', type: 'slider', min: 0,   max: 1,   step: 0.01 },
                { key: 'intensity', label: 'Intensity', type: 'slider', min: 0,   max: 5,   step: 0.01 },
                { key: 'radius',    label: 'Radius',    type: 'slider', min: 0,   max: 10,  step: 0.1  },
            ],
        
            buildUniforms(props, w, h) {
                return {
                    tDiffuse:    { value: null },
                    iResolution: { value: new Vector2(w, h) },
                
                    uThreshold:   { value: props.threshold },
                    uIntensity:   { value: props.intensity },
                    uRadius:      { value: props.radius },
                
                    uTexelSize:   { value: new Vector2(1 / w, 1 / h) },
                };
            },
        
            updateUniforms(u, props, _time, w, h) {
                u.iResolution.value.set(w, h);
                u.uTexelSize.value.set(1 / w, 1 / h);
            
                u.uThreshold.value = props.threshold;
                u.uIntensity.value = props.intensity;
                u.uRadius.value = props.radius;
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
//  PostProcessingLayer  — one shader pass
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
        for (const layer of this.layers) layer.invalidateMaterial();
    }

    // inputTarget: WebGLRenderTarget containing the 3D scene.
    // Outputs to screen (renderTarget = null).
    apply(inputTarget, time) {
        const active = this.layers.filter(l => l.visible);

        if (active.length === 0) {
            this._copyMat.uniforms.tDiffuse.value = inputTarget.texture;
            this._quad.material = this._copyMat;
            this.renderer.setRenderTarget(null);
            this.renderer.render(this._scene, this._cam);
            return;
        }

        const pingpong = [this._ping, this._pong];
        let srcTex = inputTarget.texture;
        let ppIdx  = 0;

        for (let i = 0; i < active.length; i++) {
            const layer = active[i];
            const mat   = layer.getMaterial(this.width, this.height);
            if (!mat) continue;

            PP_SHADER_REGISTRY[layer.shaderName]
                ?.updateUniforms(mat.uniforms, layer.properties, time, this.width, this.height);
            mat.uniforms.tDiffuse.value = srcTex;
            this._quad.material = mat;

            if (i === active.length - 1) {
                this.renderer.setRenderTarget(null);
                this.renderer.render(this._scene, this._cam);
            } else {
                const dst = pingpong[ppIdx];
                ppIdx = 1 - ppIdx;
                this.renderer.setRenderTarget(dst);
                this.renderer.setClearColor(0, 0);
                this.renderer.clear();
                this.renderer.render(this._scene, this._cam);
                srcTex = dst.texture;
            }
        }
    }
}
