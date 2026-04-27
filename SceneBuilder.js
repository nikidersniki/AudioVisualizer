import {
    Scene, PerspectiveCamera, WebGLRenderer,
    MeshNormalMaterial, MeshBasicMaterial, MeshStandardMaterial,
    PointLight, DynamicDrawUsage, TextureLoader, VideoTexture,
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

import { Layer, ModelObject, PointLightObject, WaveObject, FillObject } from './Sceneobjects.js';
// ─────────────────────────────────────────────
//  Model catalogue  (add entries here to expand)
// ─────────────────────────────────────────────
export class PRESETS{
    static BG_CATALOGUE = [
        { name: 'Flare', path: './Graphics/bg/Flare.jpg' },
        { name: 'Pattern',  path: './Graphics/bg/Pattern.png'  },
    ];
    static HDRI_CATALOGUE = [
        { name: 'Pond Bridge Night',  path: './Graphics/hdri/pond_bridge_night_1k.exr'          },
        { name: 'Industrial Sunset',  path: './Graphics/hdri/industrial_sunset_02_puresky_1k.exr'},
        { name: 'Misty Pines',        path: './Graphics/hdri/misty_pines_1k.exr'                 },
        { name: 'Studio',             path: './Graphics/hdri/studio_small_02_1k.exr'             },
        { name: 'Winter Evening',     path: './Graphics/hdri/winter_evening_1k.exr'              },
    ];
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
        const _measure = () => {
            const w = canvas.clientWidth  || window.innerWidth;
            const h = canvas.clientHeight || window.innerHeight;
            return { w, h };
        };
        let _m = _measure();
        this.width  = _m.w;
        this.height = _m.h;

        this.camera   = new PerspectiveCamera(70, this.width / this.height, 0.01, 1000);
        this.camera.position.z = 3;

        this.renderer = new WebGLRenderer({ antialias: true, canvas });
        this.renderer.setSize(this.width, this.height, false);
        this.renderer.setClearColor(0x000000, 1);
        this.renderer.autoClear = false;

        const _onResize = () => {
            const m = _measure();
            this.width  = m.w;
            this.height = m.h;
            this.camera.aspect = this.width / this.height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(this.width, this.height, false);
            this._layerTargets.forEach(t => t.setSize(this.width, this.height));
            this._finalTarget.setSize(this.width, this.height);
            this._layerPPTarget.setSize(this.width, this.height);
            this._postPipeline?.resize(this.width, this.height);
            this._layerPPPipelines.forEach(p => p.resize(this.width, this.height));
        };
        window.addEventListener('resize', _onResize);
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(_onResize).observe(canvas);
        }

        this.selectedHDRI = PRESETS.HDRI_CATALOGUE[0].name;
        this.setHDRI(this.selectedHDRI);

        // ── Model cache  (name → Three.js object) ─────
        this._modelCache       = {};
        this._modelFBXTextures = {}; // name → { map, roughnessMap, metalnessMap, normalMap }
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

        this._bgColor = '#000000'; // scene background / clear color

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
            // Reverse the scale factor so stored value matches what the binding expects.
            if (obj.type === 'model') {
                // model: mesh scale = scaleX * audioScale * 0.01
                const as = obj.audioScale.mode === 'constant' ? obj.audioScale.value : 1;
                const sf = as * 0.01;
                if (obj.scaleX.mode === 'constant') obj.scaleX.value = t.scale.x / sf;
                if (obj.scaleY.mode === 'constant') obj.scaleY.value = t.scale.y / sf;
                if (obj.scaleZ.mode === 'constant') obj.scaleZ.value = t.scale.z / sf;
            } else if (obj.type === 'image') {
                // image: mesh scale = scaleX * audioScale
                const as = obj.audioScale.mode === 'constant' ? obj.audioScale.value : 1;
                if (obj.scaleX.mode === 'constant') obj.scaleX.value = t.scale.x / as;
                if (obj.scaleY.mode === 'constant') obj.scaleY.value = t.scale.y / as;
                if (obj.scaleZ.mode === 'constant') obj.scaleZ.value = t.scale.z / as;
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
    //  Scene settings
    // ─────────────────────────────────────────
    setClearColor(hex) { this._bgColor = hex; }

    // ─────────────────────────────────────────
    //  Image plane management
    // ─────────────────────────────────────────
    addImageToLayer(layerId, fillObj) {
        const layer = this.getLayer(layerId);
        if (!layer) return;
        layer.addObject(fillObj);
        const mat  = new MeshBasicMaterial({ transparent: true });
        fillObj.threeObject = new Mesh(new PlaneGeometry(2, 2), mat);
        this._layerScenes.get(layerId)?.add(fillObj.threeObject);
    }

    _updateImage(fillObj) {
        const mesh = fillObj.threeObject;
        if (!mesh) return;
        fillObj.applyBindings(this.audioData);

        const mat     = mesh.material;
        const opacity = fillObj.opacity ?? 1;
        if (mat.opacity !== opacity) { mat.opacity = opacity; mat.transparent = opacity < 1; mat.needsUpdate = true; }

        const isVideo = fillObj.mediaType === 'video';

        if (isVideo) {
            if (mesh._imageLoadedName) {
                mesh._imageLoadedName = null;
                if (mat.map && !mesh._video) { mat.map = null; mat.needsUpdate = true; }
            }
            if (fillObj.videoName && mesh._videoLoadedName !== fillObj.videoName) {
                const entry = (PRESETS.VIDEO_CATALOGUE || []).find(e => e.name === fillObj.videoName);
                if (entry) {
                    mesh._videoLoadedName = fillObj.videoName;
                    if (mesh._video) { mesh._video.pause(); mesh._video.src = ''; }
                    const v = document.createElement('video');
                    v.src = entry.path;
                    v.loop = true;
                    v.muted = true;
                    v.playsInline = true;
                    v.crossOrigin = 'anonymous';
                    v.playbackRate = fillObj.playbackRate ?? 1;
                    v.play().catch(() => {});
                    mesh._video = v;
                    mat.map = new VideoTexture(v);
                    mat.needsUpdate = true;
                }
            } else if (!fillObj.videoName && mesh._video) {
                mesh._video.pause(); mesh._video.src = '';
                mesh._video = null; mesh._videoLoadedName = null;
                mat.map = null; mat.needsUpdate = true;
            }
            if (mesh._video) {
                const r = fillObj.playbackRate ?? 1;
                if (mesh._video.playbackRate !== r) mesh._video.playbackRate = r;
            }
        } else {
            if (mesh._video) {
                mesh._video.pause(); mesh._video.src = '';
                mesh._video = null; mesh._videoLoadedName = null;
                mat.map = null; mat.needsUpdate = true;
            }
            if (fillObj.imageName && mesh._imageLoadedName !== fillObj.imageName) {
                const entry = PRESETS.BG_CATALOGUE.find(e => e.name === fillObj.imageName);
                if (entry) {
                    mesh._imageLoadedName = fillObj.imageName;
                    new TextureLoader().load(entry.path, tex => { mat.map = tex; mat.needsUpdate = true; });
                }
            } else if (!fillObj.imageName && mat.map) {
                mat.map = null; mat.needsUpdate = true;
            }
        }
    }

    // ─────────────────────────────────────────
    //  Model loading
    // ─────────────────────────────────────────

    setHDRI(name) {
        const entry = PRESETS.HDRI_CATALOGUE.find(e => e.name === name);
        if (!entry) return;
        this.selectedHDRI = name;
        const isExr = entry.path.endsWith('.exr');
        const loader = isExr ? new EXRLoader() : new TextureLoader();
        loader.load(entry.path, tex => {
            tex.mapping = EquirectangularReflectionMapping;
            PRESETS.materials.standard.envMap = tex;
            PRESETS.materials.standard.needsUpdate = true;
        });
    }

    _getLoader(path) {
        return path.endsWith('.fbx') ? new FBXLoader() : new OBJLoader();
    }

    // Walk FBX children and harvest any textures baked into the original materials
    // before we replace them with our own.
    _extractFBXTextures(object) {
        const tex = { map: null, roughnessMap: null, metalnessMap: null, normalMap: null };
        object.traverse(child => {
            if (!child.isMesh) return;
            const m = Array.isArray(child.material) ? child.material[0] : child.material;
            if (!m) return;
            if (!tex.map          && m.map)          tex.map          = m.map;
            if (!tex.roughnessMap && m.roughnessMap) tex.roughnessMap = m.roughnessMap;
            if (!tex.metalnessMap && m.metalnessMap) tex.metalnessMap = m.metalnessMap;
            if (!tex.normalMap    && m.normalMap)    tex.normalMap    = m.normalMap;
        });
        return tex;
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
                // Extract FBX textures while original materials are still intact
                this._modelFBXTextures[modelObj.modelName] = this._extractFBXTextures(object);
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
        object._fbxTextures = this._modelFBXTextures[entry.name] ?? {};

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
                if (obj.type === 'image') this._updateImage(obj);
            }
        }

        // 1. Composite all 3D layers → _finalTarget
        this.renderer.setRenderTarget(this._finalTarget);
        this.renderer.setClearColor(this._bgColor, 1);
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
            const fbx = three._fbxTextures ?? {};

            // Keep envMap in sync (EXR may finish loading after model)
            if (mat.envMap !== PRESETS.materials.standard.envMap) {
                mat.envMap = PRESETS.materials.standard.envMap ?? null;
                mat.needsUpdate = true;
            }

            // Sync FBX textures based on per-object flags
            const wantMap      = modelObj.useMapTexture          ? (fbx.map          ?? null) : null;
            const wantRoughMap = modelObj.useRoughnessMapTexture ? (fbx.roughnessMap ?? null) : null;
            const wantMetalMap = modelObj.useMetalnessMapTexture ? (fbx.metalnessMap ?? null) : null;
            const wantNormMap  = modelObj.useNormalMapTexture    ? (fbx.normalMap    ?? null) : null;
            if (mat.map          !== wantMap)      { mat.map          = wantMap;      mat.needsUpdate = true; }
            if (mat.roughnessMap !== wantRoughMap) { mat.roughnessMap = wantRoughMap; mat.needsUpdate = true; }
            if (mat.metalnessMap !== wantMetalMap) { mat.metalnessMap = wantMetalMap; mat.needsUpdate = true; }
            if (mat.normalMap    !== wantNormMap)  { mat.normalMap    = wantNormMap;  mat.needsUpdate = true; }

            if (!modelObj.useRoughnessMapTexture)
                mat.roughness = Math.max(0, Math.min(1, modelObj.roughness.resolve(ad)));
            if (!modelObj.useMetalnessMapTexture)
                mat.metalness = Math.max(0, Math.min(1, modelObj.metalness.resolve(ad)));

            if (!modelObj.useMapTexture) {
                mat.color.set(modelObj.color);
                if (modelObj.colorReactive) {
                    const hue = (ad.avgFrequency / 255) * (modelObj.colorSensitivity ?? 0.5);
                    mat.color.setHSL(hue, 1, 0.5);
                }
            } else {
                mat.color.set(0xffffff); // neutral tint so map colours show unaffected
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
                } else if (obj.type === 'image' || obj.type === 'fill') {
                    const mat  = new MeshBasicMaterial({ transparent: true });
                    obj.threeObject = new Mesh(new PlaneGeometry(2, 2), mat);
                    scene.add(obj.threeObject);
                }
            }
        }
        return Promise.all(promises);
    }
}