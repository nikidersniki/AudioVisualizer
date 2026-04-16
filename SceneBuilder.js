import {
    Scene, PerspectiveCamera, WebGLRenderer,
    MeshNormalMaterial, MeshBasicMaterial, MeshStandardMaterial,
    PointLight, DynamicDrawUsage, TextureLoader,
    EquirectangularReflectionMapping,
    WebGLRenderTarget, OrthographicCamera, Mesh, PlaneGeometry,
    CustomBlending, OneFactor, OneMinusSrcAlphaFactor,
} from './modules/three.js/build/three.module.js';

import { LineSegments2 }        from './modules/three.js/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from './modules/three.js/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial }         from './modules/three.js/examples/jsm/lines/LineMaterial.js';

import { FBXLoader }     from './modules/three.js/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader }     from './modules/three.js/examples/jsm/loaders/OBJLoader.js';
import { SimplexNoise }  from './modules/three.js/examples/jsm/math/SimplexNoise.js';
import { EXRLoader }     from './modules/three.js/examples/jsm/loaders/EXRLoader.js';
import { mergeVertices }      from './modules/three.js/examples/jsm/utils/BufferGeometryUtils.js';
import { TransformControls }  from './modules/three.js/examples/jsm/controls/TransformControls.js';

import { Layer, ModelObject, PointLightObject, WaveObject } from './Sceneobjects.js';
// ─────────────────────────────────────────────
//  Model catalogue  (add entries here to expand)
// ─────────────────────────────────────────────
export class PRESETS{
    static MODEL_CATALOGUE = [
        { name: 'duck',       path: './models/duck-plush/source/Duck.fbx', scale: [0.01, 0.01, 0.01] },
        { name: 'eco-sphere', path: './models/EcoSphrere.fbx',             scale: [0.01, 0.01, 0.01] },
        { name: 'monke',      path: './models/Monke.fbx',                  scale: [0.01, 0.01, 0.01] },
        { name: 'tube',      path: './models/Tube.fbx',                  scale: [0.01, 0.01, 0.01] },
        { name: 'MacNCheese',      path: './models/MacNCheese.fbx',                  scale: [0.01, 0.01, 0.01] },
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
            this._layerTargets.forEach(t => t.setSize(this.width, this.height));
            this._finalTarget.setSize(this.width, this.height);
            this._layerPPTarget.setSize(this.width, this.height);
            this._postPipeline?.resize(this.width, this.height);
            this._layerPPPipelines.forEach(p => p.resize(this.width, this.height));
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
        this.layers       = [];               // Layer[]
        this._layerScenes = new Map();        // layerId → Scene
        this._layerTargets = new Map();       // layerId → WebGLRenderTarget

        // ── Compositing (full-screen quad per layer) ──
        this._compositeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this._compositeQuad   = new Mesh(
            new PlaneGeometry(2, 2),
            new MeshBasicMaterial({
                transparent: true, depthWrite: false, depthTest: false,
                // Render target stores premultiplied alpha from blending —
                // use ONE src factor so we don't multiply alpha a second time.
                blending:      CustomBlending,
                blendSrc:      OneFactor,
                blendDst:      OneMinusSrcAlphaFactor,
                blendSrcAlpha: OneFactor,
                blendDstAlpha: OneMinusSrcAlphaFactor,
            })
        );
        this._compositeScene  = new Scene();
        this._compositeScene.add(this._compositeQuad);
        
        // ── Audio data (updated externally each frame) ─
        this.audioData = {
            avgFrequency: 0,
            lowFreq:      0,
            midFreq:      0,
            highFreq:     0,
            peak:         0,
            volume:       0,
        };

        // ── Final composite target + PP pipeline hook ──
        this._finalTarget    = new WebGLRenderTarget(this.width, this.height);
        this._postPipeline   = null;

        // ── Per-layer PP pipelines ─────────────────────
        this._layerPPPipelines = new Map(); // layerId → PostProcessingPipeline
        this._layerPPTarget    = new WebGLRenderTarget(this.width, this.height); // scratch for per-layer PP output

        // ── Gizmo overlay (TransformControls) ─────────
        this._gizmoScene = new Scene();
        this._transformControls = new TransformControls(this.camera, this.renderer.domElement);
        this._transformControls.setMode('translate');
        this._gizmoScene.add(this._transformControls._root); // _root is the Object3D
        this._gizmoChangeHandler = null;

        window.addEventListener('keydown', e => {
            if (!this._transformControls.object) return;
            if (e.key === 't') this._transformControls.setMode('translate');
            if (e.key === 'r') this._transformControls.setMode('rotate');
            if (e.key === 's') this._transformControls.setMode('scale');
        });
    }

    // ─────────────────────────────────────────
    //  Layer management
    // ─────────────────────────────────────────
    addLayer(layer) {
        this.layers.push(layer);
        this._layerScenes.set(layer.id, new Scene());
        this._layerTargets.set(layer.id, new WebGLRenderTarget(this.width, this.height));
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
        this._layerTargets.get(id)?.dispose();
        this._layerTargets.delete(id);
        this._layerPPPipelines.delete(id);
        this.layers = this.layers.filter(l => l.id !== id);
    }

    getLayer(id) { return this.layers.find(l => l.id === id) ?? null; }

    // ─────────────────────────────────────────
    //  Post-processing pipeline
    // ─────────────────────────────────────────
    setPostPipeline(pipeline) { this._postPipeline = pipeline; }

    setLayerPPPipeline(layerId, pipeline) {
        if (pipeline) this._layerPPPipelines.set(layerId, pipeline);
        else          this._layerPPPipelines.delete(layerId);
    }

    // ─────────────────────────────────────────
    //  Gizmo (TransformControls)
    // ─────────────────────────────────────────
    attachGizmo(obj, onChange, onLiveUpdate) {
        this.detachGizmo();
        if (!obj?.threeObject) return;
        this._transformControls.attach(obj.threeObject);
        this._gizmoChangeHandler = () => {
            const t = obj.threeObject;
            if (!t) return;
            if (obj.posX.mode === 'constant') obj.posX.value = t.position.x;
            if (obj.posY.mode === 'constant') obj.posY.value = t.position.y;
            if (obj.posZ.mode === 'constant') obj.posZ.value = t.position.z;
            if (obj.rotX.mode === 'constant') obj.rotX.value = t.rotation.x;
            if (obj.rotY.mode === 'constant') obj.rotY.value = t.rotation.y;
            if (obj.rotZ.mode === 'constant') obj.rotZ.value = t.rotation.z;
            // ModelObject applies scale as: scaleX.value * audioScale * 0.01
            // Reverse that factor so the stored value stays correct.
            if (obj.type === 'model') {
                const as = obj.audioScale.mode === 'constant' ? obj.audioScale.value : 1;
                const sf = as * 0.01;
                if (obj.scaleX.mode === 'constant') obj.scaleX.value = t.scale.x / sf;
                if (obj.scaleY.mode === 'constant') obj.scaleY.value = t.scale.y / sf;
                if (obj.scaleZ.mode === 'constant') obj.scaleZ.value = t.scale.z / sf;
            } else {
                if (obj.scaleX.mode === 'constant') obj.scaleX.value = t.scale.x;
                if (obj.scaleY.mode === 'constant') obj.scaleY.value = t.scale.y;
                if (obj.scaleZ.mode === 'constant') obj.scaleZ.value = t.scale.z;
            }
            onLiveUpdate?.();
            onChange?.();
        };
        this._transformControls.addEventListener('change', this._gizmoChangeHandler);
    }

    detachGizmo() {
        if (this._gizmoChangeHandler) {
            this._transformControls.removeEventListener('change', this._gizmoChangeHandler);
            this._gizmoChangeHandler = null;
        }
        this._transformControls.detach();
    }

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
    //  Wave management
    // ─────────────────────────────────────────
    addWaveToLayer(layerId, waveObj) {
        const layer = this.getLayer(layerId);
        if (!layer) return;
        layer.addObject(waveObj);
        const three = this._createWaveThreeObject(waveObj);
        waveObj.threeObject = three;
        this._layerScenes.get(layerId)?.add(three);
    }

    // Number of line segments for each wave type
    _waveSegCount(waveType, N) {
        if (waveType === 'line')                                   return 1;
        if (waveType === 'linear' || waveType === 'linear-up')     return Math.max(1, N - 1);
        return N; // circular, bars, bars-both
    }

    _createWaveThreeObject(waveObj) {
        const N        = waveObj.segments;
        const segCount = this._waveSegCount(waveObj.waveType, N);
        // Each segment = start(xyz) + end(xyz) = 6 floats.
        // LineSegmentsGeometry uses a Float32Array directly — no copy made.
        const arr = new Float32Array(segCount * 6);

        const geo = new LineSegmentsGeometry();
        geo.setPositions(arr);

        const mat = new LineMaterial({
            color:       waveObj.color,
            opacity:     waveObj.opacity,
            transparent: true,
            linewidth:   waveObj.lineWidth ?? 1,
        });
        mat.resolution.set(this.renderer.domElement.width, this.renderer.domElement.height);

        const three = new LineSegments2(geo, mat);
        three.frustumCulled = false; // bounding sphere would go stale each frame
        three._waveType  = waveObj.waveType;
        three._segCount  = segCount;
        three._arr       = arr; // direct reference to the GPU buffer array
        return three;
    }

    _updateWave(waveObj) {
        let three = waveObj.threeObject;
        if (!three) return;

        const ad        = this.audioData;
        const freqData  = ad.freqData ?? new Uint8Array(32);
        const N         = waveObj.segments;
        const segCount  = this._waveSegCount(waveObj.waveType, N);


        // Rebuild if type or segment count changed
        if (three._waveType !== waveObj.waveType || three._segCount !== segCount) {
            for (const layer of this.layers) {
                if (layer.getObject(waveObj.id)) {
                    const scene = this._layerScenes.get(layer.id);
                    scene?.remove(three);
                    three.geometry.dispose();
                    three.material.dispose();
                    three = this._createWaveThreeObject(waveObj);
                    waveObj.threeObject = three;
                    scene?.add(three);
                    break;
                }
            }
        }

        waveObj.applyBindings(ad);
        three.material.color.set(waveObj.color);
        if (waveObj.colorReactive) {
            const hue = (ad.avgFrequency / 255) * (waveObj.colorSensitivity ?? 0.5);
            three.material.color.setHSL(hue, 1, 0.5);
        }
        three.material.opacity = waveObj.opacity;
        const lineWidthValue = waveObj.width?.resolve ? 
                       waveObj.width.resolve(ad) : 
                       (waveObj.width ?? 4);
        three.material.linewidth = lineWidthValue;

        three.material.resolution.set(this.renderer.domElement.width, this.renderer.domElement.height);
        
        const amplitude   = waveObj.amplitude.resolve(ad);
        const width       = waveObj.width.resolve(ad);
        const radius      = waveObj.radius.resolve(ad);
        const barSpacing  = waveObj.barSpacing?.resolve ? waveObj.barSpacing.resolve(ad) : (waveObj.barSpacing ?? 0.05);
        const sampleCount = Math.max(1, Math.min(waveObj.sampleCount ?? freqData.length, freqData.length));
        const arr         = three._arr;

        // Map a point index (0..nPts-1) to a freq bin
        const ptBin = (k, nPts) => {
            const t = nPts > 1 ? k / (nPts - 1) : 0;
            return Math.min(Math.floor(t * sampleCount), sampleCount - 1);
        };

        switch (waveObj.waveType) {
            case 'circular':
                // N segments closing the loop: seg i = (point[i] → point[(i+1)%N])
                for (let i = 0; i < N; i++) {
                    const j   = (i + 1) % N;
                    const a0  = (i / N) * Math.PI * 2;
                    const a1  = (j / N) * Math.PI * 2;
                    const b0  = Math.min(Math.floor((i / N) * sampleCount), sampleCount - 1);
                    const b1  = Math.min(Math.floor((j / N) * sampleCount), sampleCount - 1);
                    const r0  = radius + (freqData[b0] / 255) * amplitude;
                    const r1  = radius + (freqData[b1] / 255) * amplitude;
                    arr[i*6]   = Math.cos(a0) * r0; arr[i*6+1] = Math.sin(a0) * r0; arr[i*6+2] = 0;
                    arr[i*6+3] = Math.cos(a1) * r1; arr[i*6+4] = Math.sin(a1) * r1; arr[i*6+5] = 0;
                }
                break;

            case 'linear':
                // N-1 segments: seg i = (point[i] → point[i+1])
                for (let i = 0; i < N - 1; i++) {
                    const x0 = (i       / (N-1) - 0.5) * width;
                    const x1 = ((i + 1) / (N-1) - 0.5) * width;
                    const f0 = (freqData[ptBin(i,     N)] / 255 - 0.5) * 2;
                    const f1 = (freqData[ptBin(i + 1, N)] / 255 - 0.5) * 2;
                    arr[i*6]   = x0; arr[i*6+1] = f0 * amplitude; arr[i*6+2] = 0;
                    arr[i*6+3] = x1; arr[i*6+4] = f1 * amplitude; arr[i*6+5] = 0;
                }
                break;

            case 'linear-up':
                for (let i = 0; i < N - 1; i++) {
                    const x0 = (i       / (N-1) - 0.5) * width;
                    const x1 = ((i + 1) / (N-1) - 0.5) * width;
                    const h0 = (freqData[ptBin(i,     N)] / 255) * amplitude;
                    const h1 = (freqData[ptBin(i + 1, N)] / 255) * amplitude;
                    arr[i*6]   = x0; arr[i*6+1] = h0; arr[i*6+2] = 0;
                    arr[i*6+3] = x1; arr[i*6+4] = h1; arr[i*6+5] = 0;
                }
                break;

            case 'bars':
                for (let i = 0; i < N; i++) {
                    const x = (i - (N - 1) * 0.5) * barSpacing;
                    const h = (freqData[ptBin(i, N)] / 255) * amplitude;
                    arr[i*6]   = x; arr[i*6+1] = 0;  arr[i*6+2] = 0;
                    arr[i*6+3] = x; arr[i*6+4] = h;  arr[i*6+5] = 0;
                }
                break;

            case 'bars-both':
                for (let i = 0; i < N; i++) {
                    const x = (i - (N - 1) * 0.5) * barSpacing;
                    const h = (freqData[ptBin(i, N)] / 255) * amplitude;
                    arr[i*6]   = x; arr[i*6+1] = -h; arr[i*6+2] = 0;
                    arr[i*6+3] = x; arr[i*6+4] =  h; arr[i*6+5] = 0;
                }
                break;

            case 'line': {
                const y = (ad.avgFrequency / 255) * amplitude;
                arr[0] = -width*0.5; arr[1] = y; arr[2] = 0;
                arr[3] =  width*0.5; arr[4] = y; arr[5] = 0;
                break;
            }
        }

        // Mark the underlying interleaved buffer for GPU upload
        three.geometry.attributes.instanceStart.data.needsUpdate = true;
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

        // Each model gets its own material instance so per-model opacity is independent.
        const mat = this._cloneMaterialForType(modelObj.materialType);
        object._ownMaterial     = mat;
        object._ownMaterialType = modelObj.materialType;

        object.traverse(child => {
            if (!child.isMesh) return;
            child.material = mat;
            if (child.geometry) {
                // mergeVertices welds coincident vertices into an indexed geometry,
                // so computeVertexNormals() averages across shared verts → smooth shading.
                child.geometry = mergeVertices(child.geometry.clone());
                child.geometry.computeVertexNormals();
                if (child.geometry.attributes.position) {
                    child.geometry.attributes.position.setUsage(DynamicDrawUsage);
                    object.originalPositions[child.uuid] =
                        child.geometry.attributes.position.array.slice();
                }
            }
        });
    }

    _cloneMaterialForType(type) {
        if (type === 'wireframe') {
            return new MeshBasicMaterial({ wireframe: true, color: 0xffffff });
        }
        if (type === 'standard') {
            const m = new MeshStandardMaterial({ color: 0x888888, roughness: 1, metalness: 0 });
            m.envMap = PRESETS.materials.standard.envMap ?? null;
            return m;
        }
        return PRESETS.materials.normal; // normal is shared — no per-model props needed
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
                if (obj.type === 'wave')       this._updateWave(obj);
            }
        }

        // 1. Composite all 3D layers → _finalTarget
        this.renderer.setRenderTarget(this._finalTarget);
        this.renderer.setClearColor(0x000000, 1);
        this.renderer.clear();

        for (const layer of this.layers) {
            if (!layer.visible) continue;
            const scene  = this._layerScenes.get(layer.id);
            const target = this._layerTargets.get(layer.id);
            if (!scene || !target) continue;

            // Render layer scene
            this.renderer.setRenderTarget(target);
            this.renderer.setClearColor(0x000000, 0);
            this.renderer.clear();
            this.renderer.render(scene, this.camera);

            // Apply per-layer PP if any effects are active
            const layerPP = this._layerPPPipelines.get(layer.id);
            const hasLayerPP = layerPP?.layers.some(l => l.visible);
            let compositeSource = target;
            if (hasLayerPP) {
                layerPP.apply(target, time, this._layerPPTarget);
                compositeSource = this._layerPPTarget;
            }

            // Composite into final target
            this.renderer.setRenderTarget(this._finalTarget);
            this._compositeQuad.material.map     = compositeSource.texture;
            this._compositeQuad.material.opacity = layer.opacity ?? 1;
            this._compositeQuad.material.needsUpdate = true;
            this.renderer.render(this._compositeScene, this._compositeCamera);
        }

        // 2. PP pipeline → screen  (or direct blit if no pipeline)
        if (this._postPipeline) {
            this._postPipeline.apply(this._finalTarget, time);
        } else {
            this.renderer.setRenderTarget(null);
            this._compositeQuad.material.map     = this._finalTarget.texture;
            this._compositeQuad.material.opacity = 1;
            this._compositeQuad.material.needsUpdate = true;
            this.renderer.render(this._compositeScene, this._compositeCamera);
        }

        // 3. Gizmo overlay — always on top, after PP
        if (this._transformControls.object) {
            this.renderer.setRenderTarget(null);
            this.renderer.clearDepth();
            this.renderer.render(this._gizmoScene, this.camera);
        }

        this.renderer.setClearColor(0x000000, 1);
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

        // ── Material type switch ──────────────────────
        if (three._ownMaterialType !== modelObj.materialType) {
            const newMat = this._cloneMaterialForType(modelObj.materialType);
            three._ownMaterial     = newMat;
            three._ownMaterialType = modelObj.materialType;
            three.traverse(child => { if (child.isMesh) child.material = newMat; });
        }

        // ── Material properties ───────────────────────
        if (modelObj.materialType === 'standard') {
            const mat = three._ownMaterial;
            // Keep envMap in sync (EXR may finish loading after model)
            if (mat.envMap !== PRESETS.materials.standard.envMap) {
                mat.envMap = PRESETS.materials.standard.envMap ?? null;
                mat.needsUpdate = true;
            }
            mat.roughness = Math.max(0, Math.min(1, modelObj.roughness.resolve(ad)));
            mat.metalness = Math.max(0, Math.min(1, modelObj.metalness.resolve(ad)));
            mat.color.set(modelObj.color);
            if (modelObj.colorReactive) {
                const hue = (ad.avgFrequency / 255) * (modelObj.colorSensitivity ?? 0.5);
                mat.color.setHSL(hue, 1, 0.5);
            }
            const opacity = modelObj.opacity ?? 1;
            const wasTransparent = mat.transparent;
            const wasFlatShading = mat.flatShading;
            mat.opacity     = opacity;
            mat.transparent = opacity < 1;
            mat.depthWrite  = opacity >= 1;
            mat.flatShading = !(modelObj.smoothShading ?? true);
            if (mat.transparent !== wasTransparent || mat.flatShading !== wasFlatShading) mat.needsUpdate = true;
        } else if (modelObj.materialType === 'wireframe') {
            const mat = three._ownMaterial;
            mat.color.set(modelObj.color);
            if (modelObj.colorReactive) {
                const hue = (ad.avgFrequency / 255) * (modelObj.colorSensitivity ?? 0.5);
                mat.color.setHSL(hue, 1, 0.5);
            }
            const opacity = modelObj.opacity ?? 1;
            const wasTransparent = mat.transparent;
            mat.opacity     = opacity;
            mat.transparent = opacity < 1;
            mat.depthWrite  = opacity >= 1;
            if (mat.transparent !== wasTransparent) mat.needsUpdate = true;
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
            freqData,
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
            this._layerTargets.get(l.id)?.dispose();
        });
        this._layerScenes.clear();
        this._layerTargets.clear();
        this._layerPPPipelines.clear();
        this.layers = [];

        const promises = [];
        for (const layerData of data) {
            const layer = Layer.fromJSON(layerData);
            this.layers.push(layer);
            const scene = new Scene();
            this._layerScenes.set(layer.id, scene);
            this._layerTargets.set(layer.id, new WebGLRenderTarget(this.width, this.height));
            for (const obj of layer.objects) {
                if (obj.type === 'model') {
                    promises.push(this._loadMesh(obj, scene));
                } else if (obj.type === 'pointLight') {
                    const light = new PointLight(obj.color, 1, 100);
                    obj.threeObject = light;
                    scene.add(light);
                } else if (obj.type === 'wave') {
                    const three = this._createWaveThreeObject(obj);
                    obj.threeObject = three;
                    scene.add(three);
                }
            }
        }
        return Promise.all(promises);
    }
}