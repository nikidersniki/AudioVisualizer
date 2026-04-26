// ─────────────────────────────────────────────
//  PropertyBinding
//  A single animatable value: constant or audio-driven
// ─────────────────────────────────────────────
export class PropertyBinding {
    constructor(defaultValue = 1) {
        this.mode   = 'constant';       // 'constant' | 'audio'
        this.value  = defaultValue;     // used when mode === 'constant'
        this.source = 'avgFrequency';   // audio signal key
        this.min    = 0;                // remap range
        this.max    = 1;
        this.curve  = 'linear';         // 'linear' | 'exponential' | 'inverse'
    }

    resolve(audioData) {
        if (this.mode === 'constant') return this.value;
        const raw = audioData[this.source] ?? 0; // 0–255
        const t = raw / 255;
        let mapped;
        if (this.curve === 'exponential') mapped = t * t;
        else if (this.curve === 'inverse') mapped = 1 - t;
        else mapped = t;
        return +this.min + mapped * (this.max - this.min);
    }

    toJSON() {
        return { mode: this.mode, value: this.value, source: this.source,
                 min: this.min, max: this.max, curve: this.curve };
    }

    static fromJSON(d) {
        return Object.assign(new PropertyBinding(), d);
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
        this.threeObject.scale.set(
            this.scaleX.resolve(audioData),
            this.scaleY.resolve(audioData),
            this.scaleZ.resolve(audioData)
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
        this.roughness    = new PropertyBinding(1);
        this.metalness    = new PropertyBinding(0);
        this.useMapTexture          = true;
        this.useRoughnessMapTexture = true;
        this.useMetalnessMapTexture = true;
        this.useNormalMapTexture    = true;

        // Noise displacement
        this.noiseScale   = new PropertyBinding(1);
        this.noiseAmount  = new PropertyBinding(1);

        // Audio-reactive scale (overrides base scaleX/Y/Z when in audio mode)
        this.audioScale   = new PropertyBinding(1);

        // Rotation speed (can be audio-driven)
        this.spinSpeed    = new PropertyBinding(0);

        this.opacity          = 1;
        this.smoothShading    = true;
        this.colorReactive   = false;
        this.colorSensitivity = 0.5;
    }

    applyBindings(audioData) {
        if (!this.threeObject) return;
        this.threeObject.visible = this.visible;

        const s = this.audioScale.resolve(audioData);
        this.threeObject.scale.set(
            this.scaleX.resolve(audioData) * s * 0.01,
            this.scaleY.resolve(audioData) * s * 0.01,
            this.scaleZ.resolve(audioData) * s * 0.01
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
        this.color    = '#ffffff';
        this.amplitude   = new PropertyBinding(0.5);
        this.radius      = new PropertyBinding(1);   // circular: base ring radius
        this.width       = new PropertyBinding(2);   // linear / line: horizontal span
        this.barSpacing  = new PropertyBinding(0.05); // bars / bars-both: distance between bar centers
        this.sampleCount = 512;                      // how many freq bins to read (1–analyser max)
        this.lineWidth   = 5;                        // screen-space line width in pixels
        this.opacity     = 0.5;
        this.colorReactive   = false;
        this.colorSensitivity = 0.5;
    }

    toJSON() { return this._bindingsToJSON(); }

    static fromJSON(d) {
        const obj = new WaveObject();
        obj._restoreBindings(d);
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
        this.opacity      = 1;
    }

    applyBindings(audioData) {
        if (!this.threeObject) return;
        this.threeObject.visible = this.visible;
        const s = this.audioScale.resolve(audioData);
        this.threeObject.scale.set(
            this.scaleX.resolve(audioData) * s,
            this.scaleY.resolve(audioData) * s,
            this.scaleZ.resolve(audioData) * s
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