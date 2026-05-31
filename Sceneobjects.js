import { inputBus } from './InputBus.js';

// ─────────────────────────────────────────────
//  PropertyBinding
//  A single animatable value: constant or audio-driven
// ─────────────────────────────────────────────
export class PropertyBinding {
    constructor(defaultValue = 1) {
        this.mode   = 'constant';       // 'constant' | 'audio'
        this.value  = defaultValue;     // used when mode === 'constant'
        this.source = 'beat';           // audio signal key
        this.min    = 0;                // remap range
        this.max    = 1;
        this.curve  = 'linear';         // 'linear' | 'exponential' | 'inverse'

        // ── Key / MIDI override (optional) ──
        // While the trigger is active the property switches from its base value
        // (constant/audio above) to the override target below.
        this.keyCode    = null;         // trigger id: 'key:KeyA' | 'midi:note:36' | 'midi:cc:7'
        this.keyTrigger = 'hold';       // 'hold' (active while down) | 'toggle' (press flips)
        this.keyTarget  = 'static';     // 'static' | 'sampled'
        this.keyValue   = 0;            // static override value
        this.keySource  = 'beat';       // sampled override source ('beat' | 'midi:cc:7' | …)
        this.keyMin     = 0;
        this.keyMax     = 1;
        this.keyCurve   = 'linear';
        this.keyEase    = 'snap';       // 'snap' | 'ramp'
        this.keyFade    = 200;          // ms, used when ease === 'ramp'

        // transient ramp state — never serialized
        this._rampVal  = null;
        this._rampLast = 0;
        this._keyEnv   = 0;   // 0..1 activation envelope (drives Key Map cube fill)
    }

    _sampleNorm(srcId, audioData) {
        if (srcId && srcId.indexOf('midi:') === 0) return inputBus.ccValue(srcId); // 0..1
        const raw = (audioData && audioData[srcId]) ?? 0; // 0–255
        return raw / 255;
    }

    _remap(t, curve, min, max) {
        let mapped = t;
        if (curve === 'exponential') mapped = t * t;
        else if (curve === 'inverse') mapped = 1 - t;
        return +min + mapped * (max - min);
    }

    resolve(audioData) {
        // Base value (legacy behavior)
        let base;
        if (this.mode === 'constant') base = this.value;
        else base = this._remap(this._sampleNorm(this.source, audioData), this.curve, this.min, this.max);

        if (!this.keyCode) return base;

        // Override target while trigger active
        const active = inputBus.isActive(this.keyCode, this.keyTrigger);
        let target = base;
        if (active) {
            target = (this.keyTarget === 'sampled')
                ? this._remap(this._sampleNorm(this.keySource, audioData), this.keyCurve, this.keyMin, this.keyMax)
                : this.keyValue;
        }
        const envTarget = active ? 1 : 0;

        if (this.keyEase !== 'ramp') {
            this._rampVal = target;
            this._keyEnv  = envTarget;
            return target;
        }

        // Ramp value and activation envelope toward target over keyFade ms
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const dt = this._rampLast ? (now - this._rampLast) : 0;
        this._rampLast = now;
        const a = this.keyFade > 0 ? Math.min(1, dt / this.keyFade) : 1;
        if (this._rampVal == null) this._rampVal = target;
        this._rampVal += (target - this._rampVal) * a;
        this._keyEnv  += (envTarget - this._keyEnv) * a;
        return this._rampVal;
    }

    toJSON() {
        return { mode: this.mode, value: this.value, source: this.source,
                 min: this.min, max: this.max, curve: this.curve,
                 keyCode: this.keyCode, keyTrigger: this.keyTrigger, keyTarget: this.keyTarget,
                 keyValue: this.keyValue, keySource: this.keySource,
                 keyMin: this.keyMin, keyMax: this.keyMax, keyCurve: this.keyCurve,
                 keyEase: this.keyEase, keyFade: this.keyFade };
    }

    static fromJSON(d) {
        // Object.assign over a fresh instance: any missing (older) fields keep defaults.
        const b = Object.assign(new PropertyBinding(), d);
        b._rampVal = null; b._rampLast = 0;
        return b;
    }
}

// ─────────────────────────────────────────────
//  SceneObject  (base)
// ─────────────────────────────────────────────
export class SceneObject {
    constructor(type) {
        this.id      = crypto.randomUUID();
        this.type    = type;
        this.name    = type;
        this.visible = true;
        // transform bindings
        this.posX = new PropertyBinding(0);
        this.posY = new PropertyBinding(0);
        this.posZ = new PropertyBinding(0);
        this.rotX = new PropertyBinding(0);
        this.rotY = new PropertyBinding(0);
        this.rotZ = new PropertyBinding(0);
        this.scaleX = new PropertyBinding(1);
        this.scaleY = new PropertyBinding(1);
        this.scaleZ = new PropertyBinding(1);
        this.globalScale = new PropertyBinding(1);

        this.threeObject = null; // live Three.js object — never serialized
    }

    // Subclasses override this to drive their own bindings
    applyBindings(audioData) {
        if (!this.threeObject) return;
        this.threeObject.visible = this.visible;
        this.threeObject.position.set(
            this.posX.resolve(audioData),
            this.posY.resolve(audioData),
            this.posZ.resolve(audioData)
        );
        this.threeObject.rotation.set(
            this.rotX.resolve(audioData),
            this.rotY.resolve(audioData),
            this.rotZ.resolve(audioData)
        );
        const g = this.globalScale.resolve(audioData);
        this.threeObject.scale.set(
            this.scaleX.resolve(audioData) * g,
            this.scaleY.resolve(audioData) * g,
            this.scaleZ.resolve(audioData) * g
        );
    }

    _bindingsToJSON() {
        const out = {};
        for (const key of Object.keys(this)) {
            if (key === 'threeObject') continue;
            const val = this[key];
            out[key] = (val instanceof PropertyBinding) ? val.toJSON() : val;
        }
        return out;
    }

    toJSON() { return this._bindingsToJSON(); }

    // Restore PropertyBinding instances after plain fromJSON
    _restoreBindings(data) {
        for (const key of Object.keys(data)) {
            if (key === 'threeObject') continue;
            const val = data[key];
            if (val && typeof val === 'object' && 'mode' in val && 'source' in val) {
                this[key] = PropertyBinding.fromJSON(val);
            } else {
                this[key] = val;
            }
        }
    }
}

// ─────────────────────────────────────────────
//  ModelObject
// ─────────────────────────────────────────────
export class ModelObject extends SceneObject {
    constructor() {
        super('model');
        this.name        = 'Model';
        this.modelName   = 'duck';

        // Material
        this.materialType = 'normal';   // 'normal' | 'wireframe' | 'standard'
        this.color        = '#888888';
        this.wireframeLineWidth = 2;
        this.roughness    = new PropertyBinding(1);
        this.metalness    = new PropertyBinding(0);
        // Texture slot assignments — catalogue texture names (null = no map)
        this.colorMap     = null;
        this.roughnessMap = null;
        this.metalnessMap = null;
        this.normalMap    = null;

        // Displacement
        this.noiseType    = 'simplex'; // 'simplex' | 'perlin' | 'voronoi' | 'sine'
        this.displaceDirection = 'radial'; // 'radial' | 'normal'
        this.noiseScale   = new PropertyBinding(1);
        this.noiseAmount  = new PropertyBinding(1);

        // Audio-reactive scale (overrides base scaleX/Y/Z when in audio mode)
        this.audioScale   = new PropertyBinding(1);

        // Rotation speed (can be audio-driven)
        this.spinSpeed    = new PropertyBinding(0);
        this.spinAxis     = '+y'; // '+x' | '-x' | '+y' | '-y' | '+z' | '-z'

        this.opacity          = new PropertyBinding(1);
        this.smoothShading    = true;
        this.colorReactive   = false;
        this.colorSensitivity = 0.5;
    }

    applyBindings(audioData) {
        if (!this.threeObject) return;
        this.threeObject.visible = this.visible;

        const s = this.audioScale.resolve(audioData);
        const g = this.globalScale.resolve(audioData);
        this.threeObject.scale.set(
            this.scaleX.resolve(audioData) * s * g * 0.01,
            this.scaleY.resolve(audioData) * s * g * 0.01,
            this.scaleZ.resolve(audioData) * s * g * 0.01
        );

        this.threeObject.position.set(
            this.posX.resolve(audioData),
            this.posY.resolve(audioData),
            this.posZ.resolve(audioData)
        );

        this.threeObject.rotation.set(
            this.rotX.resolve(audioData),
            this.rotY.resolve(audioData),
            this.rotZ.resolve(audioData)
        );
    }

    toJSON() { return this._bindingsToJSON(); }

    static fromJSON(d) {
        const obj = new ModelObject();
        obj._restoreBindings(d);
        if (typeof obj.opacity === 'number') obj.opacity = new PropertyBinding(obj.opacity);
        return obj;
    }
}

// ─────────────────────────────────────────────
//  PointLightObject
// ─────────────────────────────────────────────
export class PointLightObject extends SceneObject {
    constructor() {
        super('pointLight');
        this.name      = 'Point Light';
        this.color     = '#ffffff';
        this.intensity = new PropertyBinding(1);
        this.distance  = new PropertyBinding(100);
    }

    applyBindings(audioData) {
        if (!this.threeObject) return;
        this.threeObject.visible   = this.visible;
        this.threeObject.color.set(this.color);
        this.threeObject.intensity = this.intensity.resolve(audioData);
        this.threeObject.distance  = this.distance.resolve(audioData);
        this.threeObject.position.set(
            this.posX.resolve(audioData),
            this.posY.resolve(audioData),
            this.posZ.resolve(audioData)
        );
    }

    toJSON() { return this._bindingsToJSON(); }

    static fromJSON(d) {
        const obj = new PointLightObject();
        obj._restoreBindings(d);
        return obj;
    }
}

// ─────────────────────────────────────────────
//  WaveObject
// ─────────────────────────────────────────────
export class WaveObject extends SceneObject {
    constructor() {
        super('wave');
        this.name     = 'Wave';
        // 'circular' | 'linear' | 'linear-up' | 'bars' | 'bars-both' | 'line'
        this.waveType = 'circular';
        this.segments = 64;
        this.color     = '#ffffff'; // line color
        this.fillColor = '#ffffff';
        this.fill      = false;
        this.amplitude   = new PropertyBinding(0.5);
        this.radius      = new PropertyBinding(1);   // circular: base ring radius
        this.width       = new PropertyBinding(2);   // linear / line: horizontal span
        this.barSpacing  = new PropertyBinding(0.05); // bars / bars-both: distance between bar centers
        this.sampleCount = 100;                      // fixed freq-bin count
        this.lineWidth   = 5;                        // screen-space line width in pixels
        this.opacity     = new PropertyBinding(0.5);
        this.colorReactive   = false;
        this.colorSensitivity = 0.5;
    }

    toJSON() { return this._bindingsToJSON(); }

    static fromJSON(d) {
        const obj = new WaveObject();
        obj._restoreBindings(d);
        if (typeof obj.opacity === 'number') obj.opacity = new PropertyBinding(obj.opacity);
        obj.sampleCount = 100;
        return obj;
    }
}

// ─────────────────────────────────────────────
//  FillObject  (image plane in scene)
// ─────────────────────────────────────────────
export class FillObject extends SceneObject {
    constructor() {
        super('image');
        this.name         = 'Image';
        this.mediaType    = 'image';   // 'image' | 'video'
        this.imageName    = null;
        this.videoName    = null;
        this.playbackRate = 1;
        this.audioScale   = new PropertyBinding(1);
        this.spinSpeed    = new PropertyBinding(0);
        this.spinAxis     = '+z';
        this.opacity      = new PropertyBinding(1);
    }

    applyBindings(audioData) {
        if (!this.threeObject) return;
        this.threeObject.visible = this.visible;
        const s = this.audioScale.resolve(audioData);
        const g = this.globalScale.resolve(audioData);
        this.threeObject.scale.set(
            this.scaleX.resolve(audioData) * s * g,
            this.scaleY.resolve(audioData) * s * g,
            this.scaleZ.resolve(audioData) * s * g
        );
        this.threeObject.position.set(
            this.posX.resolve(audioData),
            this.posY.resolve(audioData),
            this.posZ.resolve(audioData)
        );
        this.threeObject.rotation.set(
            this.rotX.resolve(audioData),
            this.rotY.resolve(audioData),
            this.rotZ.resolve(audioData)
        );
    }

    toJSON() { return this._bindingsToJSON(); }

    static fromJSON(d) {
        const obj = new FillObject();
        obj._restoreBindings(d);
        if (typeof obj.opacity === 'number') obj.opacity = new PropertyBinding(obj.opacity);
        obj.type = 'image'; // normalize old 'fill' saves
        return obj;
    }
}

// ─────────────────────────────────────────────
//  Layer
// ─────────────────────────────────────────────
export class Layer {
    constructor(name = 'Layer', isBase = false) {
        this.id      = crypto.randomUUID();
        this.name    = name;
        this.isBase  = isBase;
        this.visible = true;
        this.opacity = 1;
        this.objects = [];  // SceneObject[]
    }

    addObject(sceneObj)  { this.objects.push(sceneObj); }
    removeObject(id)     { this.objects = this.objects.filter(o => o.id !== id); }
    getObject(id)        { return this.objects.find(o => o.id === id) ?? null; }

    toJSON() {
        return {
            id:      this.id,
            name:    this.name,
            isBase:  this.isBase,
            visible: this.visible,
            opacity: this.opacity,
            objects: this.objects.map(o => o.toJSON())
        };
    }

    static fromJSON(data) {
        const layer = new Layer(data.name, data.isBase);
        layer.id      = data.id;
        layer.visible = data.visible ?? true;
        layer.opacity = data.opacity ?? 1;
        layer.objects = (data.objects || []).map(o => {
            if (o.type === 'model')                    return ModelObject.fromJSON(o);
            if (o.type === 'pointLight')               return PointLightObject.fromJSON(o);
            if (o.type === 'wave')                     return WaveObject.fromJSON(o);
            if (o.type === 'image' || o.type === 'fill') return FillObject.fromJSON(o);
            return null;
        }).filter(Boolean);
        return layer;
    }
}