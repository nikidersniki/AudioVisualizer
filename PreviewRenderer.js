import {
    WebGLRenderer, PerspectiveCamera, Scene,
    IcosahedronGeometry, Mesh, Box3, Vector3,
    MeshNormalMaterial,
    PointLight,
} from './modules/three.js/build/three.module.js';

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
