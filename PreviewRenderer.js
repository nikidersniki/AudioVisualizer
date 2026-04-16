import {
    WebGLRenderer, PerspectiveCamera, Scene,
    IcosahedronGeometry, Mesh, Box3, Vector3,
    MeshNormalMaterial, PointLight,
    WebGLRenderTarget, PlaneGeometry, OrthographicCamera, ShaderMaterial,
} from './modules/three.js/build/three.module.js';

import { PP_SHADER_REGISTRY, PP_NATIVE_REGISTRY } from './PostProcessing.js';

import { FBXLoader } from './modules/three.js/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from './modules/three.js/examples/jsm/loaders/OBJLoader.js';
import { mergeVertices } from './modules/three.js/examples/jsm/utils/BufferGeometryUtils.js';

import { PRESETS } from './SceneBuilder.js';

const SIZE = 128;

function makeRenderer() {
    const canvas = document.createElement('canvas');
    const renderer = new WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setClearColor(0x1a1a1a, 1);
    return renderer;
}

function makeScene(object) {
    const scene = new Scene();
    scene.add(object);
    const key  = new PointLight(0xffffff, 3); key.position.set(2, 3, 4);
    const fill = new PointLight(0xffffff, 1); fill.position.set(-3, -1, 2);
    scene.add(key, fill);
    return scene;
}

function fitAndRender(renderer, camera, scene, object) {
    const box    = new Box3().setFromObject(object);
    const center = box.getCenter(new Vector3());
    const size   = box.getSize(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist   = (maxDim / 2) / Math.tan((camera.fov * Math.PI) / 360) * 1.5;

    camera.position.set(center.x, center.y, center.z + dist);
    camera.lookAt(center);
    camera.near = dist * 0.01;
    camera.far  = dist * 10;
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    return renderer.domElement.toDataURL();
}

// ─────────────────────────────────────────────
//  Material previews — icosphere × 3 materials
// ─────────────────────────────────────────────
export async function generateMaterialPreviews() {
    const renderer = makeRenderer();
    const camera   = new PerspectiveCamera(45, 1, 0.01, 100);
    const geo      = new IcosahedronGeometry(1, 3);

    const results = Object.entries(PRESETS.materials).map(([name, mat]) => {
        const mesh  = new Mesh(geo, mat);
        const scene = makeScene(mesh);
        const url   = fitAndRender(renderer, camera, scene, mesh);
        return { name, url };
    });

    geo.dispose();
    renderer.dispose();
    return results;
}

// ─────────────────────────────────────────────
//  Model previews — each catalogue model, normal material
// ─────────────────────────────────────────────
function loadModelForPreview(entry) {
    const loader = entry.path.endsWith('.fbx') ? new FBXLoader() : new OBJLoader();
    return new Promise((resolve, reject) => {
        loader.load(entry.path, object => {
            object.scale.set(...entry.scale);
            const mat = new MeshNormalMaterial();
            object.traverse(child => {
                if (!child.isMesh) return;
                try {
                    child.geometry = mergeVertices(child.geometry.clone());
                    child.geometry.computeVertexNormals();
                } catch (_) {}
                child.material = mat;
            });
            resolve(object);
        }, undefined, reject);
    });
}

// ─────────────────────────────────────────────
//  PP shader previews — each shader applied to an icosphere render
// ─────────────────────────────────────────────
export async function generatePPPreviews() {
    const renderer = makeRenderer();
    const camera   = new PerspectiveCamera(45, 1, 0.01, 100);

    // Render base scene into a render target
    const baseTarget = new WebGLRenderTarget(SIZE, SIZE);
    const geo  = new IcosahedronGeometry(1, 3);
    const mat  = new MeshNormalMaterial();
    const mesh = new Mesh(geo, mat);
    const baseScene = makeScene(mesh);

    const box    = new Box3().setFromObject(mesh);
    const center = box.getCenter(new Vector3());
    const size   = box.getSize(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist   = (maxDim / 2) / Math.tan((camera.fov * Math.PI) / 360) * 1.5;
    camera.position.set(center.x, center.y, center.z + dist);
    camera.lookAt(center);
    camera.near = dist * 0.01;
    camera.far  = dist * 10;
    camera.updateProjectionMatrix();

    renderer.setRenderTarget(baseTarget);
    renderer.render(baseScene, camera);
    renderer.setRenderTarget(null);

    // Full-screen quad for applying each shader / blitting pass results
    const quadGeo   = new PlaneGeometry(2, 2);
    const quadScene = new Scene();
    const quadCam   = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad      = new Mesh(quadGeo);
    quadScene.add(quad);

    // Inline copy material — blits a render target texture to screen
    const copyMat = new ShaderMaterial({
        vertexShader:   'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
        fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor=texture2D(t,vUv); }',
        uniforms: { t: { value: null } },
        depthTest: false, depthWrite: false,
    });

    const results = [];

    // ── Custom GLSL shaders ──────────────────────────────────────
    for (const reg of Object.values(PP_SHADER_REGISTRY)) {
        if (!reg._vertSrc || !reg._fragSrc) {
            results.push({ name: reg.name, url: null });
            continue;
        }
        try {
            const fragSrc  = reg.patchFragmentSrc
                ? reg.patchFragmentSrc(reg._fragSrc, reg.defaultProperties)
                : reg._fragSrc;
            const uniforms = reg.buildUniforms(reg.defaultProperties, SIZE, SIZE);
            uniforms.tDiffuse.value = baseTarget.texture;
            const shaderMat = new ShaderMaterial({
                vertexShader:   reg._vertSrc,
                fragmentShader: fragSrc,
                uniforms,
                depthTest: false, depthWrite: false,
            });
            quad.material = shaderMat;
            renderer.setRenderTarget(null);
            renderer.render(quadScene, quadCam);
            results.push({ name: reg.name, url: renderer.domElement.toDataURL() });
            shaderMat.dispose();
        } catch (e) {
            console.warn('PreviewRenderer: PP preview failed for', reg.name, e);
            results.push({ name: reg.name, url: null });
        }
    }

    // ── Native Three.js passes ───────────────────────────────────
    const dstTarget = new WebGLRenderTarget(SIZE, SIZE);
    for (const reg of Object.values(PP_NATIVE_REGISTRY)) {
        // Passes that write bloom additively onto readBuffer (not writeBuffer) would
        // corrupt baseTarget and break every subsequent preview — skip them.
        if (reg.writesToReadBuffer) {
            results.push({ name: reg.name, url: null });
            continue;
        }
        const savedAutoClear = renderer.autoClear;
        try {
            const pass = reg.create(SIZE, SIZE, reg.defaultProperties);
            pass.renderToScreen = false;
            pass.render(renderer, dstTarget, baseTarget, 0.016, false);
            copyMat.uniforms.t.value = dstTarget.texture;
            quad.material = copyMat;
            renderer.setRenderTarget(null);
            renderer.render(quadScene, quadCam);
            results.push({ name: reg.name, url: renderer.domElement.toDataURL() });
            pass.dispose?.();
        } catch (e) {
            console.warn('PreviewRenderer: native pass preview failed for', reg.name, e);
            results.push({ name: reg.name, url: null });
        } finally {
            renderer.autoClear = savedAutoClear;
            renderer.setRenderTarget(null);
        }
    }
    dstTarget.dispose();

    geo.dispose();
    mat.dispose();
    baseTarget.dispose();
    quadGeo.dispose();
    renderer.dispose();
    return results;
}

export async function generateModelPreviews() {
    const renderer = makeRenderer();
    const camera   = new PerspectiveCamera(45, 1, 0.01, 1000);
    const results  = [];

    for (const entry of PRESETS.MODEL_CATALOGUE) {
        try {
            const object = await loadModelForPreview(entry);
            const scene  = makeScene(object);
            const url    = fitAndRender(renderer, camera, scene, object);
            results.push({ name: entry.name, url });
        } catch (e) {
            console.warn('PreviewRenderer: failed', entry.name, e);
            results.push({ name: entry.name, url: null });
        }
    }

    renderer.dispose();
    return results;
}
