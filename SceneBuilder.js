import {
    Scene, PerspectiveCamera, WebGLRenderer,
    MeshNormalMaterial, MeshBasicMaterial, MeshStandardMaterial,
    PointLight, DynamicDrawUsage, TextureLoader,
    EquirectangularReflectionMapping
} from './modules/three.js/build/three.module.js';

import { FBXLoader }     from './modules/three.js/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader }     from './modules/three.js/examples/jsm/loaders/OBJLoader.js';
import { SimplexNoise }  from './modules/three.js/examples/jsm/math/SimplexNoise.js';
import { EXRLoader }     from './modules/three.js/examples/jsm/loaders/EXRLoader.js';

import { Layer, ModelObject, PointLightObject } from './Sceneobjects.js';

// ─────────────────────────────────────────────
//  Model catalogue  (add entries here to expand)
// ─────────────────────────────────────────────
export class PRESETS{
    static MODEL_CATALOGUE = [
        { name: 'duck',       path: './models/duck-plush/source/Duck.fbx', scale: [0.01, 0.01, 0.01] },
        { name: 'eco-sphere', path: './models/EcoSphrere.fbx',             scale: [0.01, 0.01, 0.01] },
        { name: 'monke',      path: './models/Monke.fbx',                  scale: [0.01, 0.01, 0.01] },
    ];
        // ── Shared materials ───────────────────────────
    static materials = {
        normal:    new MeshNormalMaterial(),
        wireframe: new MeshBasicMaterial({ wireframe: true, color: 0xffffff }),
        standard:  new MeshStandardMaterial({ color: 0x888888, roughness: 1, metalness: 0 }),
    };
}


export class SceneBuilder {
    constructor(canvas) {
        // ── Renderer / camera / scene ──────────────────
        this.width  = window.innerWidth;
        this.height = window.innerHeight;

        this.camera   = new PerspectiveCamera(70, this.width / this.height, 0.01, 1000);
        this.camera.position.z = 3;

        this.renderer = new WebGLRenderer({ antialias: true, canvas });
        this.renderer.setSize(this.width, this.height);
        this.renderer.setClearColor(0x000000, 1);
        this.renderer.autoClear = false;

        window.addEventListener('resize', () => {
            this.width  = window.innerWidth;
            this.height = window.innerHeight;
            this.camera.aspect = this.width / this.height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(this.width, this.height);
        });

        new EXRLoader().load('./Graphics/pond_bridge_night_1k.exr', (tex) => {
            tex.mapping = EquirectangularReflectionMapping;
            PRESETS.materials.standard.envMap = tex;
            PRESETS.materials.standard.needsUpdate = true;
        });

        // ── Model cache  (name → Three.js object) ─────
        this._modelCache = {};
        this._simplex    = new SimplexNoise();

        // ── Layer list & per-layer scenes ─────────────
        this.layers      = [];               // Layer[]
        this._layerScenes = new Map();       // layerId → Scene

        // ── Audio data (updated externally each frame) ─
        this.audioData = {
            avgFrequency: 0,
            lowFreq:      0,
            midFreq:      0,
            highFreq:     0,
            peak:         0,
            volume:       0,
        };
    }

    // ─────────────────────────────────────────
    //  Layer management
    // ─────────────────────────────────────────
    addLayer(layer) {
        this.layers.push(layer);
        this._layerScenes.set(layer.id, new Scene());
        return layer;
    }

    removeLayer(id) {
        const layer = this.layers.find(l => l.id === id);
        if (!layer) return;
        const scene = this._layerScenes.get(id);
        layer.objects.forEach(obj => {
            if (obj.threeObject && scene) scene.remove(obj.threeObject);
        });
        this._layerScenes.delete(id);
        this.layers = this.layers.filter(l => l.id !== id);
    }

    getLayer(id) { return this.layers.find(l => l.id === id) ?? null; }

    // ─────────────────────────────────────────
    //  Object management
    // ─────────────────────────────────────────

    /** Add a ModelObject to a layer and load the mesh */
    async addModelToLayer(layerId, modelObj) {
        const layer = this.getLayer(layerId);
        if (!layer) return;
        layer.addObject(modelObj);
        await this._loadMesh(modelObj, this._layerScenes.get(layerId));
    }

    /** Add a PointLightObject to a layer */
    addLightToLayer(layerId, lightObj) {
        const layer = this.getLayer(layerId);
        if (!layer) return;
        layer.addObject(lightObj);

        const light = new PointLight(lightObj.color, 1, 100);
        light.position.set(0, 0, 0);
        lightObj.threeObject = light;
        this._layerScenes.get(layerId)?.add(light);
    }

    removeObjectFromLayer(layerId, objectId) {
        const layer = this.getLayer(layerId);
        if (!layer) return;
        const obj = layer.getObject(objectId);
        if (obj?.threeObject) this._layerScenes.get(layerId)?.remove(obj.threeObject);
        layer.removeObject(objectId);
    }

    // ─────────────────────────────────────────
    //  Model loading
    // ─────────────────────────────────────────
    _getLoader(path) {
        return path.endsWith('.fbx') ? new FBXLoader() : new OBJLoader();
    }

    _getCatalogue(name) {
        return PRESETS.MODEL_CATALOGUE.find(m => m.name === name) ?? null;
    }

    async _loadMesh(modelObj, scene) {
        const entry = this._getCatalogue(modelObj.modelName);
        if (!entry) { console.warn('Unknown model:', modelObj.modelName); return; }

        // Re-use cached geometry clone if available
        if (this._modelCache[modelObj.modelName]) {
            const cached = this._modelCache[modelObj.modelName];
            const clone  = cached.clone();
            this._prepareObject(clone, modelObj, entry);
            modelObj.threeObject = clone;
            scene?.add(clone);
            return;
        }

        return new Promise((resolve, reject) => {
            this._getLoader(entry.path).load(entry.path, (object) => {
                this._modelCache[modelObj.modelName] = object;
                this._prepareObject(object, modelObj, entry);
                modelObj.threeObject = object;
                scene?.add(object);
                resolve(object);
            }, undefined, reject);
        });
    }

    _prepareObject(object, modelObj, entry) {
        object.scale.set(...entry.scale);
        object.originalPositions = {};

        const mat = PRESETS.materials[modelObj.materialType] ?? this.materials.normal;
        object.traverse(child => {
            if (!child.isMesh) return;
            child.material = mat;
            if (child.geometry) {
                child.geometry = child.geometry.clone();
                child.geometry.computeVertexNormals();
                if (child.geometry.attributes.position) {
                    child.geometry.attributes.position.setUsage(DynamicDrawUsage);
                    object.originalPositions[child.uuid] =
                        child.geometry.attributes.position.array.slice();
                }
            }
        });
    }

    // ─────────────────────────────────────────
    //  Per-frame update  (call from animate loop)
    // ─────────────────────────────────────────
    update(time) {
        // Update all object state (no rendering yet)
        for (const layer of this.layers) {
            if (!layer.visible) continue;
            for (const obj of layer.objects) {
                if (obj.type === 'model')      this._updateModel(obj, time);
                if (obj.type === 'pointLight') obj.applyBindings(this.audioData);
            }
        }

        // Render each layer in order — clear depth between layers so higher
        // layers always paint on top regardless of 3-D position
        this.renderer.clear();
        for (const layer of this.layers) {
            if (!layer.visible) continue;
            const scene = this._layerScenes.get(layer.id);
            if (!scene) continue;
            this.renderer.clearDepth();
            this.renderer.render(scene, this.camera);
        }
    }

    _updateModel(modelObj, time) {
        const three = modelObj.threeObject;
        if (!three) return;

        const ad = this.audioData;
        modelObj.applyBindings(ad);

        // ── Spin ──────────────────────────────────────
        const speed = modelObj.spinSpeed.resolve(ad);
        if (speed !== 0) {
            three.rotation.y = modelObj.rotY.resolve(ad) + time / 1000 * speed;
        }

        // ── Noise displacement ────────────────────────
        const noiseScale  = modelObj.noiseScale.resolve(ad);
        const noiseAmount = modelObj.noiseAmount.resolve(ad);
        const avgFreq     = ad.avgFrequency;

        three.traverse(child => {
            if (!child.isMesh || !child.geometry || !three.originalPositions?.[child.uuid]) return;
            const positions = child.geometry.attributes.position;
            const original  = three.originalPositions[child.uuid];

            for (let i = 0; i < original.length; i += 3) {
                const x = original[i], y = original[i+1], z = original[i+2];
                const noise = this._simplex.noise3d(
                    x * noiseScale + time * 0.0006,
                    y * noiseScale + avgFreq * 0.01,
                    z * noiseScale + three.rotation.y
                );
                const len = Math.sqrt(x*x + y*y + z*z) || 1;
                const d   = noise * avgFreq * 0.001 * noiseAmount;
                positions.array[i]     = x + (x/len)*d;
                positions.array[i + 1] = y + (y/len)*d;
                positions.array[i + 2] = z + (z/len)*d;
            }
            positions.needsUpdate = true;
            child.geometry.computeVertexNormals();
        });

        // ── Material properties ───────────────────────
        if (modelObj.materialType === 'standard') {
            const mat = PRESETS.materials.standard;
            mat.roughness = Math.max(0, Math.min(1, modelObj.roughness.resolve(ad)));
            mat.metalness = Math.max(0, Math.min(1, modelObj.metalness.resolve(ad)));
            mat.color.set(modelObj.color);
            if (modelObj.colorReactive) {
                const hue = (ad.avgFrequency / 255) * (modelObj.colorSensitivity ?? 0.5);
                mat.color.setHSL(hue, 1, 0.5);
            }
        } else if (modelObj.materialType === 'wireframe') {
            const mat = PRESETS.materials.wireframe;
            mat.color.set(modelObj.color);
            if (modelObj.colorReactive) {
                const hue = (ad.avgFrequency / 255) * (modelObj.colorSensitivity ?? 0.5);
                mat.color.setHSL(hue, 1, 0.5);
            }
        }
    }

    // ─────────────────────────────────────────
    //  Audio signal helpers
    // ─────────────────────────────────────────

    /** Call once per frame with the Three.js AudioAnalyser */
    updateAudioData(analyser, volume) {
        const freqData = analyser.getFrequencyData(); // Uint8Array

        const third = Math.floor(freqData.length / 3);
        const avg = (arr, start, end) => {
            let sum = 0;
            for (let i = start; i < end; i++) sum += arr[i];
            return sum / (end - start);
        };

        this.audioData = {
            avgFrequency: analyser.getAverageFrequency(),
            lowFreq:      avg(freqData, 0,       third),
            midFreq:      avg(freqData, third,   third * 2),
            highFreq:     avg(freqData, third*2, freqData.length),
            peak:         Math.max(...freqData),
            volume:       volume * 255,
        };
    }

    // ─────────────────────────────────────────
    //  Serialization
    // ─────────────────────────────────────────
    toJSON() {
        return this.layers.map(l => l.toJSON());
    }

    loadFromJSON(data) {
        // Remove all existing scene objects from their layer scenes
        this.layers.forEach(l => {
            const scene = this._layerScenes.get(l.id);
            l.objects.forEach(o => { if (o.threeObject && scene) scene.remove(o.threeObject); });
        });
        this._layerScenes.clear();
        this.layers = [];

        const promises = [];
        for (const layerData of data) {
            const layer = Layer.fromJSON(layerData);
            this.layers.push(layer);
            const scene = new Scene();
            this._layerScenes.set(layer.id, scene);
            for (const obj of layer.objects) {
                if (obj.type === 'model') {
                    promises.push(this._loadMesh(obj, scene));
                } else if (obj.type === 'pointLight') {
                    const light = new PointLight(obj.color, 1, 100);
                    obj.threeObject = light;
                    scene.add(light);
                }
            }
        }
        return Promise.all(promises);
    }
}