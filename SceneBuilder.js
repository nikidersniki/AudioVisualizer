import {
    Scene, PerspectiveCamera, WebGLRenderer,
    MeshNormalMaterial, MeshBasicMaterial, MeshStandardMaterial,
    PointLight, DynamicDrawUsage, TextureLoader, VideoTexture,
    EquirectangularReflectionMapping,
    WebGLRenderTarget, OrthographicCamera, Mesh, PlaneGeometry,
    CustomBlending, OneFactor, OneMinusSrcAlphaFactor,
    BufferGeometry, BufferAttribute, DoubleSide,
    EdgesGeometry,
} from 'three';

import { LineSegments2 }        from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial }         from 'three/examples/jsm/lines/LineMaterial.js';

import { FBXLoader }     from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader }     from 'three/examples/jsm/loaders/OBJLoader.js';
import { SimplexNoise }  from 'three/examples/jsm/math/SimplexNoise.js';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import { EXRLoader }     from 'three/examples/jsm/loaders/EXRLoader.js';
import { mergeVertices }      from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TransformControls }  from 'three/examples/jsm/controls/TransformControls.js';

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
        this._perlin     = new ImprovedNoise();

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
            sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, presence: 0, brilliance: 0,
            rms: 0, centroid: 0, flatness: 0, flux: 0, zcr: 0,
            beat: 0, bpm: 0,
            volumeFast: 0, volumeSlow: 0, avgFast: 0, avgSlow: 0,
        };
        this._prevFreq      = null;
        this._fluxHistory   = [];
        this._beatTimes     = [];
        this._lastBeatTime  = 0;

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
            if (e.key === 't') this.setGizmoMode('translate');
            if (e.key === 'r') this.setGizmoMode('rotate');
            if (e.key === 's') this.setGizmoMode('scale');
        });
    }

    setGizmoMode(mode) {
        if (!['translate', 'rotate', 'scale'].includes(mode)) return;
        this._transformControls.setMode(mode);
        window.dispatchEvent(new CustomEvent('gizmo-mode-changed', { detail: { mode } }));
    }

    getGizmoMode() { return this._transformControls.mode; }

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
            // Only commit values while the user is actually dragging the gizmo.
            // Other internal updates (applyBindings writing mesh.scale every frame,
            // audio-driven multipliers, etc.) also dispatch objectChange and must
            // not be back-written or the value-feedback explodes.
            if (!this._transformControls.dragging) return;
            const t = obj.threeObject;
            if (!t) return;
            const ad = this.audioData;
            if (obj.posX.mode === 'constant') obj.posX.value = t.position.x;
            if (obj.posY.mode === 'constant') obj.posY.value = t.position.y;
            if (obj.posZ.mode === 'constant') obj.posZ.value = t.position.z;
            if (obj.rotX.mode === 'constant') obj.rotX.value = t.rotation.x;
            if (obj.rotY.mode === 'constant') obj.rotY.value = t.rotation.y;
            if (obj.rotZ.mode === 'constant') obj.rotZ.value = t.rotation.z;
            // Inverse the LIVE per-frame multipliers (audioScale, globalScale, model 0.01)
            // so the stored scaleX/Y/Z corresponds to the value the binding will produce.
            const g  = obj.globalScale ? obj.globalScale.resolve(ad) : 1;
            const as = obj.audioScale  ? obj.audioScale.resolve(ad)  : 1;
            const k  = obj.type === 'model' ? 0.01 : 1;
            const sf = g * as * k || 1;
            if (obj.scaleX.mode === 'constant') obj.scaleX.value = t.scale.x / sf;
            if (obj.scaleY.mode === 'constant') obj.scaleY.value = t.scale.y / sf;
            if (obj.scaleZ.mode === 'constant') obj.scaleZ.value = t.scale.z / sf;
            onLiveUpdate?.();
            onChange?.();
        };
        this._transformControls.addEventListener('objectChange', this._gizmoChangeHandler);
    }

    detachGizmo() {
        if (this._gizmoChangeHandler) {
            this._transformControls.removeEventListener('objectChange', this._gizmoChangeHandler);
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

    _waveSupportsFill(waveType) {
        return waveType === 'linear' || waveType === 'linear-up' || waveType === 'line';
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

        // Fill mesh — built lazily when fill is enabled
        const fillVerts = new Float32Array(segCount * 6 * 3); // 2 triangles per segment, 3 verts each, 3 floats each
        const fillGeo = new BufferGeometry();
        fillGeo.setAttribute('position', new BufferAttribute(fillVerts, 3).setUsage(DynamicDrawUsage));
        const fillMat = new MeshBasicMaterial({
            color:       waveObj.fillColor ?? waveObj.color,
            opacity:     waveObj.opacity,
            transparent: true,
            side:        DoubleSide,
            depthWrite:  false,
        });
        const fillMesh = new Mesh(fillGeo, fillMat);
        fillMesh.frustumCulled = false;
        fillMesh.visible = !!waveObj.fill;
        three.add(fillMesh);
        three._fillMesh   = fillMesh;
        three._fillVerts  = fillVerts;
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
                    const wasAttached = this._transformControls?.object === three;
                    if (wasAttached) this.detachGizmo();
                    scene?.remove(three);
                    if (three._fillMesh) {
                        three._fillMesh.geometry.dispose();
                        three._fillMesh.material.dispose();
                    }
                    three.geometry.dispose();
                    three.material.dispose();
                    three = this._createWaveThreeObject(waveObj);
                    waveObj.threeObject = three;
                    scene?.add(three);
                    if (wasAttached) this._transformControls.attach(three);
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

        // Fill mesh sync
        if (three._fillMesh) {
            const supportsFill = this._waveSupportsFill(waveObj.waveType);
            three._fillMesh.visible = !!waveObj.fill && supportsFill;
            three._fillMesh.material.opacity = waveObj.opacity;
            three._fillMesh.material.color.set(waveObj.fillColor ?? waveObj.color);
            if (waveObj.colorReactive) {
                three._fillMesh.material.color.copy(three.material.color);
            }
        }
        three.material.linewidth = waveObj.lineWidth ?? 1;

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

            case 'linear-up': {
                const ampU = Math.max(0, amplitude);
                for (let i = 0; i < N - 1; i++) {
                    const x0 = (i       / (N-1) - 0.5) * width;
                    const x1 = ((i + 1) / (N-1) - 0.5) * width;
                    const h0 = Math.max(0, (freqData[ptBin(i,     N)] / 255) * ampU);
                    const h1 = Math.max(0, (freqData[ptBin(i + 1, N)] / 255) * ampU);
                    arr[i*6]   = x0; arr[i*6+1] = h0; arr[i*6+2] = 0;
                    arr[i*6+3] = x1; arr[i*6+4] = h1; arr[i*6+5] = 0;
                }
                break;
            }

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
                const y = Math.max(0, (ad.avgFrequency / 255) * amplitude);
                arr[0] = -width*0.5; arr[1] = y; arr[2] = 0;
                arr[3] =  width*0.5; arr[4] = y; arr[5] = 0;
                break;
            }

        }

        // Mark the underlying interleaved buffer for GPU upload
        three.geometry.attributes.instanceStart.data.needsUpdate = true;

        // Build fill triangles between line and y=0
        if (three._fillMesh && three._fillMesh.visible) {
            const fv = three._fillVerts;
            const segs = segCount;
            // Two triangles per segment: (x0,0)-(x0,y0)-(x1,y1) and (x0,0)-(x1,y1)-(x1,0)
            // Layout: 6 verts per seg × 3 floats = 18 per seg
            for (let i = 0; i < segs; i++) {
                const a = i * 6;
                const x0 = arr[a],   y0 = arr[a+1];
                const x1 = arr[a+3], y1 = arr[a+4];
                const o = i * 18;
                fv[o   ] = x0; fv[o+ 1] = 0;  fv[o+ 2] = 0;
                fv[o+ 3] = x0; fv[o+ 4] = y0; fv[o+ 5] = 0;
                fv[o+ 6] = x1; fv[o+ 7] = y1; fv[o+ 8] = 0;
                fv[o+ 9] = x0; fv[o+10] = 0;  fv[o+11] = 0;
                fv[o+12] = x1; fv[o+13] = y1; fv[o+14] = 0;
                fv[o+15] = x1; fv[o+16] = 0;  fv[o+17] = 0;
            }
            three._fillMesh.geometry.attributes.position.needsUpdate = true;
            three._fillMesh.geometry.setDrawRange(0, segs * 6);
        }
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

    _updateImage(fillObj, time) {
        const mesh = fillObj.threeObject;
        if (!mesh) return;
        const ad = this.audioData;
        fillObj.applyBindings(ad);

        // ── Spin ──────────────────────────────────────
        const speed = fillObj.spinSpeed?.resolve?.(ad) ?? 0;
        if (speed !== 0 && typeof time === 'number') {
            const dir  = fillObj.spinAxis ?? '+z';
            const sign = dir.charAt(0) === '-' ? -1 : 1;
            const axis = dir.slice(-1);
            const delta = (time / 1000) * speed * sign;
            const rx = fillObj.rotX.resolve(ad);
            const ry = fillObj.rotY.resolve(ad);
            const rz = fillObj.rotZ.resolve(ad);
            mesh.rotation.set(
                axis === 'x' ? rx + delta : rx,
                axis === 'y' ? ry + delta : ry,
                axis === 'z' ? rz + delta : rz
            );
        }

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

        // Load raw FBX into cache if missing. The cached object is NEVER used as a
        // live scene instance — it must stay untouched so subsequent clones get
        // pristine geometry (displacement mutates positions per-frame in place).
        let raw = this._modelCache[modelObj.modelName];
        if (!raw) {
            raw = await new Promise((resolve, reject) => {
                this._getLoader(entry.path).load(entry.path, resolve, undefined, reject);
            });
            this._modelFBXTextures[modelObj.modelName] = this._extractFBXTextures(raw);
            this._modelCache[modelObj.modelName] = raw;
        }

        const instance = raw.clone();
        this._prepareObject(instance, modelObj, entry);
        modelObj.threeObject = instance;
        scene?.add(instance);
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
                    if (child.geometry.attributes.normal) {
                        object.originalNormals ??= {};
                        object.originalNormals[child.uuid] =
                            child.geometry.attributes.normal.array.slice();
                    }
                }
            }
        });
    }

    _cloneMaterialForType(type) {
        if (type === 'wireframe') {
            // The mesh itself is hidden; a LineSegments2 wireframe overlay is added per child mesh.
            return new MeshBasicMaterial({ visible: false });
        }
        if (type === 'standard') {
            const m = new MeshStandardMaterial({ color: 0x888888, roughness: 1, metalness: 0 });
            m.envMap = PRESETS.materials.standard.envMap ?? null;
            return m;
        }
        return PRESETS.materials.normal; // normal is shared — no per-model props needed
    }

    _ensureWireframeOverlay(mesh) {
        if (mesh._wfOverlay) return mesh._wfOverlay;
        const geo = mesh.geometry;
        const idxArr = geo.index ? geo.index.array : null;
        const triCount = idxArr ? (idxArr.length / 3) : (geo.attributes.position.count / 3);

        const edges = new Map();
        const addEdge = (a, b) => {
            const k = a < b ? (a + '_' + b) : (b + '_' + a);
            if (!edges.has(k)) edges.set(k, a < b ? [a, b] : [b, a]);
        };
        for (let t = 0; t < triCount; t++) {
            const i = t * 3;
            const a = idxArr ? idxArr[i]     : i;
            const b = idxArr ? idxArr[i + 1] : i + 1;
            const c = idxArr ? idxArr[i + 2] : i + 2;
            addEdge(a, b); addEdge(b, c); addEdge(c, a);
        }

        const segCount = edges.size;
        const pairs    = new Uint32Array(segCount * 2);
        const positions = new Float32Array(segCount * 6);
        {
            let p = 0;
            for (const [, [a, b]] of edges) { pairs[p++] = a; pairs[p++] = b; }
        }

        const lg = new LineSegmentsGeometry();
        lg.setPositions(positions);
        const lm = new LineMaterial({
            color:       0xffffff,
            linewidth:   2,
            transparent: true,
            opacity:     1,
        });
        lm.resolution.set(this.renderer.domElement.width, this.renderer.domElement.height);
        const overlay = new LineSegments2(lg, lm);
        overlay.frustumCulled = false;
        overlay._isWireframeOverlay = true;
        mesh.add(overlay);
        mesh._wfOverlay        = overlay;
        mesh._wfEdgePairs      = pairs;
        mesh._wfLinePositions  = positions;
        this._updateWireframeOverlayPositions(mesh); // initial fill
        return overlay;
    }

    _updateWireframeOverlayPositions(mesh) {
        const overlay = mesh._wfOverlay;
        if (!overlay) return;
        const pairs     = mesh._wfEdgePairs;
        const positions = mesh._wfLinePositions;
        const posAttr   = mesh.geometry.attributes.position;
        const segCount  = pairs.length / 2;
        for (let s = 0; s < segCount; s++) {
            const a = pairs[s * 2];
            const b = pairs[s * 2 + 1];
            positions[s * 6    ] = posAttr.getX(a);
            positions[s * 6 + 1] = posAttr.getY(a);
            positions[s * 6 + 2] = posAttr.getZ(a);
            positions[s * 6 + 3] = posAttr.getX(b);
            positions[s * 6 + 4] = posAttr.getY(b);
            positions[s * 6 + 5] = posAttr.getZ(b);
        }
        overlay.geometry.attributes.instanceStart.data.needsUpdate = true;
    }

    _removeWireframeOverlay(mesh) {
        if (!mesh._wfOverlay) return;
        const ov = mesh._wfOverlay;
        mesh.remove(ov);
        ov.geometry.dispose();
        ov.material.dispose();
        mesh._wfOverlay = null;
        mesh._wfEdgePairs = null;
        mesh._wfLinePositions = null;
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
                if (obj.type === 'image') this._updateImage(obj, time);
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
                layerPP.apply(target, time, this._layerPPTarget, this.audioData);
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
            this._postPipeline.apply(this._finalTarget, time, null, this.audioData);
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
            const dir = modelObj.spinAxis ?? '+y';
            const sign = dir.charAt(0) === '-' ? -1 : 1;
            const axis = dir.slice(-1); // 'x' | 'y' | 'z'
            const delta = (time / 1000) * speed * sign;
            const rx = modelObj.rotX.resolve(ad);
            const ry = modelObj.rotY.resolve(ad);
            const rz = modelObj.rotZ.resolve(ad);
            three.rotation.set(
                axis === 'x' ? rx + delta : rx,
                axis === 'y' ? ry + delta : ry,
                axis === 'z' ? rz + delta : rz
            );
        }

        // ── Displacement ──────────────────────────────
        const noiseScale  = modelObj.noiseScale.resolve(ad);
        const noiseAmount = modelObj.noiseAmount.resolve(ad);
        const avgFreq     = ad.avgFrequency;
        const noiseType   = modelObj.noiseType ?? 'simplex';
        const direction   = modelObj.displaceDirection ?? 'radial';

        const sampleNoise = (x, y, z) => {
            switch (noiseType) {
                case 'perlin':
                    return this._perlin.noise(
                        x * noiseScale + time * 0.0006,
                        y * noiseScale + avgFreq * 0.01,
                        z * noiseScale + three.rotation.y
                    );
                case 'voronoi': {
                    const sx = x * noiseScale + time * 0.0006;
                    const sy = y * noiseScale + avgFreq * 0.01;
                    const sz = z * noiseScale + three.rotation.y;
                    const ix = Math.floor(sx), iy = Math.floor(sy), iz = Math.floor(sz);
                    let minD = 1e9;
                    for (let dz = -1; dz <= 1; dz++)
                    for (let dy = -1; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++) {
                        const cx = ix + dx, cy = iy + dy, cz = iz + dz;
                        // hashed feature point in cell
                        const h = Math.sin(cx * 127.1 + cy * 311.7 + cz * 74.7) * 43758.5453;
                        const h2 = Math.sin(cx * 269.5 + cy * 183.3 + cz * 246.1) * 43758.5453;
                        const h3 = Math.sin(cx * 113.5 + cy * 271.9 + cz * 124.6) * 43758.5453;
                        const fx = cx + (h - Math.floor(h));
                        const fy = cy + (h2 - Math.floor(h2));
                        const fz = cz + (h3 - Math.floor(h3));
                        const ddx = sx - fx, ddy = sy - fy, ddz = sz - fz;
                        const d2 = ddx*ddx + ddy*ddy + ddz*ddz;
                        if (d2 < minD) minD = d2;
                    }
                    return Math.sqrt(minD) * 2 - 1; // ~[-1,1]
                }
                case 'sine': {
                    const k = noiseScale, tt = time * 0.001;
                    return (
                        Math.sin(x * k + tt) +
                        Math.cos(y * k + tt * 1.3) +
                        Math.sin(z * k + tt * 0.7)
                    ) / 3;
                }
                case 'simplex':
                default:
                    return this._simplex.noise3d(
                        x * noiseScale + time * 0.0006,
                        y * noiseScale + avgFreq * 0.01,
                        z * noiseScale + three.rotation.y
                    );
            }
        };

        three.traverse(child => {
            if (!child.isMesh || !child.geometry || !three.originalPositions?.[child.uuid]) return;
            const positions = child.geometry.attributes.position;
            const original  = three.originalPositions[child.uuid];
            const normals   = direction === 'normal'
                ? three.originalNormals?.[child.uuid]
                : null;

            for (let i = 0; i < original.length; i += 3) {
                const x = original[i], y = original[i+1], z = original[i+2];
                const noise = sampleNoise(x, y, z);
                const d   = noise * avgFreq * 0.001 * noiseAmount;
                let dx, dy, dz;
                if (normals) {
                    dx = normals[i]; dy = normals[i+1]; dz = normals[i+2];
                } else {
                    const len = Math.sqrt(x*x + y*y + z*z) || 1;
                    dx = x/len; dy = y/len; dz = z/len;
                }
                positions.array[i]     = x + dx*d;
                positions.array[i + 1] = y + dy*d;
                positions.array[i + 2] = z + dz*d;
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
            const opacity   = modelObj.opacity ?? 1;
            const lineWidth = modelObj.wireframeLineWidth ?? 2;
            three.traverse(child => {
                if (!child.isMesh || child._isWireframeOverlay) return;
                const overlay = this._ensureWireframeOverlay(child);
                const lm = overlay.material;
                lm.color.set(modelObj.color);
                if (modelObj.colorReactive) {
                    const hue = (ad.avgFrequency / 255) * (modelObj.colorSensitivity ?? 0.5);
                    lm.color.setHSL(hue, 1, 0.5);
                }
                lm.opacity     = opacity;
                lm.transparent = opacity < 1;
                lm.linewidth   = lineWidth;
                lm.resolution.set(this.renderer.domElement.width, this.renderer.domElement.height);
                // Refresh line positions from the (noise-displaced) source positions.
                this._updateWireframeOverlayPositions(child);
            });
        }

        // Strip wireframe overlays when not in wireframe mode
        if (modelObj.materialType !== 'wireframe') {
            three.traverse(child => {
                if (child.isMesh && child._wfOverlay) this._removeWireframeOverlay(child);
            });
        }
    }

    // ─────────────────────────────────────────
    //  Audio signal helpers
    // ─────────────────────────────────────────

    /** Call once per frame with the Three.js AudioAnalyser */
    updateAudioData(analyser, volume) {
        const freqData = analyser.getFrequencyData(); // Uint8Array
        const N = freqData.length;
        const ctx = analyser.analyser.context;
        const sampleRate = ctx.sampleRate;
        const fftSize    = analyser.analyser.fftSize;
        const binHz      = sampleRate / fftSize;

        // ── time-domain (RMS, zero-crossing) ──
        const timeData = new Uint8Array(fftSize);
        analyser.analyser.getByteTimeDomainData(timeData);
        let sumSq = 0, zc = 0;
        for (let i = 0; i < timeData.length; i++) {
            const v = (timeData[i] - 128) / 128;
            sumSq += v * v;
            if (i > 0 && ((timeData[i-1] - 128) ^ (timeData[i] - 128)) < 0) zc++;
        }
        const rms = Math.sqrt(sumSq / timeData.length) * 255;
        const zcr = (zc / timeData.length) * 255;

        // ── classic 3-band split (kept for compat) ──
        const third = Math.floor(N / 3);
        const avg = (arr, start, end) => {
            if (end <= start) return 0;
            let sum = 0;
            for (let i = start; i < end; i++) sum += arr[i];
            return sum / (end - start);
        };

        // ── 7-band split by frequency ranges (Hz) ──
        const bandRanges = [
            [20, 60], [60, 250], [250, 500], [500, 2000],
            [2000, 4000], [4000, 6000], [6000, 20000],
        ];
        const bandValue = ([lo, hi]) => {
            const s = Math.max(0, Math.floor(lo / binHz));
            const e = Math.min(N, Math.ceil(hi / binHz));
            return avg(freqData, s, e);
        };
        const [sub, bass, lowMid, mid, highMid, presence, brilliance] = bandRanges.map(bandValue);

        // ── spectral centroid (brightness) ──
        let cNum = 0, cDen = 0;
        for (let i = 0; i < N; i++) {
            cNum += i * freqData[i];
            cDen += freqData[i];
        }
        const centroid = cDen > 0 ? (cNum / cDen / N) * 255 : 0;

        // ── spectral flatness (tonal vs noise) ──
        let logSum = 0, arSum = 0, nz = 0;
        for (let i = 1; i < N; i++) {
            const m = freqData[i] + 1;
            logSum += Math.log(m);
            arSum  += m;
            nz++;
        }
        const geo  = nz > 0 ? Math.exp(logSum / nz) : 0;
        const arith = nz > 0 ? arSum / nz : 1;
        const flatness = arith > 0 ? (geo / arith) * 255 : 0;

        // ── spectral flux (positive change) ──
        let flux = 0;
        if (this._prevFreq) {
            for (let i = 0; i < N; i++) {
                const d = freqData[i] - this._prevFreq[i];
                if (d > 0) flux += d;
            }
            flux /= N;
        }
        this._prevFreq = Uint8Array.from(freqData);

        // ── beat detection (adaptive flux threshold) ──
        this._fluxHistory.push(flux);
        if (this._fluxHistory.length > 43) this._fluxHistory.shift();
        let fluxMean = 0;
        for (const f of this._fluxHistory) fluxMean += f;
        fluxMean /= this._fluxHistory.length;
        const now = performance.now();
        let beat = 0;
        if (flux > fluxMean * 1.5 && flux > 2 && now - this._lastBeatTime > 200) {
            beat = 255;
            this._beatTimes.push(now);
            if (this._beatTimes.length > 16) this._beatTimes.shift();
            this._lastBeatTime = now;
        } else {
            const dt = (now - this._lastBeatTime) / 1000;
            beat = Math.max(0, 255 * Math.exp(-dt * 6));
        }

        // ── BPM (median of beat intervals, clamped 40–240) ──
        let bpm = this.audioData.bpm || 0;
        if (this._beatTimes.length >= 4) {
            const intervals = [];
            for (let i = 1; i < this._beatTimes.length; i++) {
                const dt = this._beatTimes[i] - this._beatTimes[i-1];
                if (dt >= 250 && dt <= 1500) intervals.push(dt);
            }
            if (intervals.length >= 3) {
                intervals.sort((a, b) => a - b);
                const med = intervals[Math.floor(intervals.length / 2)];
                bpm = med > 0 ? 60000 / med : 0;
            }
        }

        // ── envelope smoothing (fast / slow) ──
        const prev = this.audioData;
        const volScaled = volume * 255;
        const avgF      = analyser.getAverageFrequency();
        const lerp = (a, b, k) => a + (b - a) * k;
        const volumeFast = lerp(prev.volumeFast, volScaled, 0.5);
        const volumeSlow = lerp(prev.volumeSlow, volScaled, 0.05);
        const avgFast    = lerp(prev.avgFast,    avgF,      0.5);
        const avgSlow    = lerp(prev.avgSlow,    avgF,      0.05);

        this.audioData = {
            avgFrequency: avgF,
            lowFreq:      avg(freqData, 0,       third),
            midFreq:      avg(freqData, third,   third * 2),
            highFreq:     avg(freqData, third*2, N),
            peak:         Math.max(...freqData),
            volume:       volScaled,
            sub, bass, lowMid, mid, highMid, presence, brilliance,
            rms, centroid, flatness, flux, zcr,
            beat, bpm,
            volumeFast, volumeSlow, avgFast, avgSlow,
            freqData,
            timeData,
        };
    }

    // ─────────────────────────────────────────
    //  Serialization
    // ─────────────────────────────────────────
    toJSON() {
        return this.layers.map(l => l.toJSON());
    }

    async loadFromJSON(data) {
        // Detach gizmo so it doesn't keep referencing an about-to-be-removed mesh
        this.detachGizmo();

        // Build the new layers + scenes in TEMPORARY maps first, so the renderer
        // keeps drawing the existing scene until the new content is fully loaded.
        const newLayers  = [];
        const newScenes  = new Map();
        const newTargets = new Map();
        const promises   = [];

        for (const layerData of data) {
            const layer = Layer.fromJSON(layerData);
            newLayers.push(layer);
            const scene = new Scene();
            newScenes.set(layer.id, scene);
            newTargets.set(layer.id, new WebGLRenderTarget(this.width, this.height));
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

        await Promise.all(promises);

        // Atomic swap: dispose old, install new
        const oldLayers  = this.layers;
        const oldScenes  = this._layerScenes;
        const oldTargets = this._layerTargets;

        this.layers          = newLayers;
        this._layerScenes    = newScenes;
        this._layerTargets   = newTargets;
        this._layerPPPipelines.clear();

        oldLayers.forEach(l => {
            const scene = oldScenes.get(l.id);
            l.objects.forEach(o => {
                if (o.threeObject && scene) scene.remove(o.threeObject);
                o.threeObject = null;
            });
            oldTargets.get(l.id)?.dispose();
        });
    }
}