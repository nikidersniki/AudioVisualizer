import {
  AudioListener, Audio, AudioLoader, AudioAnalyser,
  PerspectiveCamera, Scene, BoxGeometry, MeshNormalMaterial,
  Mesh, WebGLRenderer, MeshBasicMaterial, Group, ShapeGeometry,
  DoubleSide, Box3, Vector3, DynamicDrawUsage,
  NoToneMapping, PointLight,
  MeshStandardMaterial, Color, TextureLoader, EquirectangularReflectionMapping, Vector2
} from './modules/three.js/build/three.module.js';

import { OBJLoader } from './modules/three.js/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from './modules/three.js/examples/jsm/loaders/FBXLoader.js';
import { SVGLoader } from './modules/three.js/examples/jsm/loaders/SVGLoader.js';
import { SimplexNoise } from './modules/three.js/examples/jsm/math/SimplexNoise.js';
import { EXRLoader } from './modules/three.js/examples/jsm/loaders/EXRLoader.js';
import { UnrealBloomPass } from './modules/three.js/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './modules/three.js/examples/jsm/postprocessing/OutputPass.js';import { EffectComposer } from './modules/three.js/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './modules/three.js/examples/jsm/postprocessing/RenderPass.js';


// Init Window dimensions
const width = window.innerWidth, height = window.innerHeight;

const camera = new PerspectiveCamera( 70, width / height, 0.01, 10 );
camera.position.z = 3;

let RotateBackground = false;
let rotateModel = false;
let modelRotationSpeed = 1;
let NoiseScale = 1;
let NoiseAmount = 1;
let objectScale = 1;
let ColorChange = false;
let changeMaterial = false;
let changeMaterialThreshold = 0.01;
let currentMaterial = 'normal';
let lightIntensity = 1;
let modelColor = 0x888888;
let modelRoughness = 1;
let modelMetalness = 0;
let bloomStrength = 0.1;
let bloomRadius = 1.0;
let bloomThreshold = 0.1;

// IndexedDB setup for caching audio files
const DB_NAME = "AudioDB";
const STORE_NAME = "files";

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = () => {
            const db = request.result;
            db.createObjectStore(STORE_NAME, { keyPath: "id" });
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}


const scene = new Scene();
scene.background = new Color(0x000000);

const normalMaterial = new MeshNormalMaterial();
const wireframeMaterial = new MeshBasicMaterial( { wireframe: true, color: 0xffffff} );
const standardMaterial = new MeshStandardMaterial({
    color: 0x000000,
    roughness: modelRoughness,
    metalness: modelMetalness,
    flatShading: false 
});
const bgMaterial = new MeshStandardMaterial( { color: 0x888888, roughness: 1 } );
const bgMaterialNoGradient = new MeshBasicMaterial( { color: 0x888888} );

new EXRLoader().load('./Graphics/pond_bridge_night_1k.exr', (texture) => {
    // This is critical for reflections to work correctly on spheres/meshes
    texture.mapping = EquirectangularReflectionMapping;

    // Assign to the whole scene OR just a specific material
    standardMaterial.envMap = texture;
    standardMaterial.needsUpdate = true;
});


function getActiveMaterial() {
    if (currentMaterial === 'normal') return normalMaterial;
    if (currentMaterial === 'wireframe') return wireframeMaterial;
    return standardMaterial;
}

function applyMaterialToCurrentModel() {
    if (!loadedModels[modelName]) return;
    const mat = getActiveMaterial();
    loadedModels[modelName].traverse(child => {
        if (child.isMesh) child.material = mat;
    });
}

//model list
const models = [
    { name: 'duck', path: './models/duck-plush/source/Duck.fbx', scale: [0.01, 0.01, 0.01], position: [0, 0, 0] },
    { name: 'eco-sphere', path: './models/EcoSphrere.fbx', scale: [0.01, 0.01, 0.01], position: [0, 0, 0] },
    { name: 'monke', path: './models/Monke.fbx', scale: [0.01, 0.01, 0.01], position: [0, 0, 0] }
];

let modelName = 'duck';
models.get = (name) => models.find(m => m.name === name);
const loadedModels = {};

function getLoaderForFile( filePath ) {
    const extension = filePath.split( '.' ).pop().toLowerCase();
    if ( extension === 'fbx' ) return new FBXLoader();
    return new OBJLoader();
}

function removeCurrentModel() {
    Object.values(loadedModels).forEach(obj => scene.remove(obj));
}

function loadModel( name ) {
    const model = models.get(name);
    if (!model) return;

    removeCurrentModel();

    if (loadedModels[name]) {
        loadedModels[name].traverse( child => {
            if ( child.isMesh && child.geometry && loadedModels[name].originalPositions[child.uuid] ) {
                const original = loadedModels[name].originalPositions[child.uuid];
                const positions = child.geometry.attributes.position;
                for (let i = 0; i < original.length; i++) positions.array[i] = original[i];
                positions.needsUpdate = true;
                child.geometry.computeVertexNormals();
            }
        });
        scene.add(loadedModels[name]);
    } else {
        const loader = getLoaderForFile(model.path);
        loader.load( model.path, object => {
            loadedModels[name] = object;
            loadedModels[name].scale.set(...model.scale);
            loadedModels[name].position.set(...model.position);
            loadedModels[name].originalPositions = {};

            loadedModels[name].traverse( child => {
                if ( child.isMesh ) {
                    child.material = getActiveMaterial();
                    if (child.geometry) {
                        child.geometry = child.geometry.clone();
                        child.geometry.computeVertexNormals();
                        if (child.geometry.attributes.position) {
                            child.geometry.attributes.position.setUsage(DynamicDrawUsage);
                        }
                        const positions = child.geometry.attributes.position.array.slice();
                        loadedModels[name].originalPositions[child.uuid] = positions;
                    }
                }
            });

            scene.add(loadedModels[name]);
        }, undefined, error => console.error('Model load error:', error) );
    }
}

document.getElementById('model-select').addEventListener('change', (e) => {
    modelName = e.target.value;
    loadModel(modelName);
});

loadModel(modelName);

// SVG loader for background
const group = new Group();
const svgLoader = new SVGLoader();
svgLoader.loadAsync('./Graphics/spiral.svg').then(data => {
    const paths = data.paths;
    const svgGroup = new Group();

    for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const shapes = SVGLoader.createShapes(path);
        for (let j = 0; j < shapes.length; j++) {
            const shape = shapes[j];
            const geometry = new ShapeGeometry(shape);
            const mesh = new Mesh(geometry, bgMaterial);
            svgGroup.add(mesh);
        }
    }

    const box = new Box3().setFromObject(svgGroup);
    const center = new Vector3();
    box.getCenter(center);
    svgGroup.position.x = -center.x;
    svgGroup.position.y = -center.y;

    group.add(svgGroup);
    group.scale.set(0.01, 0.01, 0.1);
    group.position.z = -1;
    scene.add(group);
});

// Light — keep a reference so we can update intensity
const pointLight = new PointLight( 0xffffff, lightIntensity, 100 );
scene.add( pointLight );

const canvas = document.getElementById( 'three-canvas' );
const renderer = new WebGLRenderer( { antialias: true, canvas } );
renderer.setSize( width, height );

// --- Post Processing ---
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
    new Vector2(width, height), // resolution
    bloomStrength,   // strength
    bloomRadius,   // radius
    bloomThreshold      // threshold
);
bloomPass.clearColor = new Color(0x0d0d0d);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// Audio setup
const listener = new AudioListener();
camera.add( listener );
const sound = new Audio( listener );
const analyser = new AudioAnalyser( sound, 32 );

let audioBuffer = null;
let isDragging = false;
let audioContext = null;
let audioSource = null;
let startTime = 0;
let pauseTime = 0;
let isPlaying = false;

const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const currentTimeDisplay = document.getElementById('current-time');
const durationDisplay = document.getElementById('duration');

function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function applyAudioBuffer(buffer) {
    if (sound.isPlaying) sound.stop();
    audioBuffer = buffer;
    audioSource = null;
    sound.setBuffer(buffer);
    sound.setLoop(false);
    sound.setVolume(0.5);
    durationDisplay.textContent = formatTime(buffer.duration);
    audioContext = listener.context;
    startTime = audioContext.currentTime;
    pauseTime = 0;
    isPlaying = true;
    sound.play();
}

function loadAudioFromFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        audioContext = listener.context;
        const decoded = await audioContext.decodeAudioData(e.target.result);
        document.getElementById('track-name').textContent = file.name;
        applyAudioBuffer(decoded);
    };
    reader.readAsArrayBuffer(file);
}

window.addEventListener("load", async () => {
    const allFiles = await loadAllAudioFiles();

    if (allFiles.length > 0) {
        allFiles.forEach(f => {
            let lI = document.createElement('div');
            let button = document.createElement('button');
            button.textContent = f.name;
            button.classList.add('track-button');
            button.onclick = () => loadAudioFromFile(f.file);
            lI.appendChild(button);
            document.getElementById('saved-tracks').appendChild(lI);
        }   );
        }

        // auto-load first one
        loadAudioFromFile(allFiles[0].file);
    }
);

async function saveAudioFile(file) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const id = Date.now() + "_" + file.name; // unique id

    store.put({
        id: id,
        file: file,
        name: file.name,
        type: file.type
    });

    return new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = reject;
    });
}

async function loadAllAudioFiles() {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// --- Standard material controls visibility ---
const standardOnlyControls = document.getElementById('standard-material-controls');
const wireColorControl = document.getElementById('wire-color').parentElement;
function updateStandardControlsVisibility() {
    if (standardOnlyControls) {
        standardOnlyControls.style.display = currentMaterial === 'standard' ? '' : 'none';
    }
    if (wireColorControl) {
        wireColorControl.style.display = currentMaterial === 'wireframe' ? '' : 'none';
    }
}
updateStandardControlsVisibility();

// --- Control event listeners ---

document.getElementById('audio-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    await saveAudioFile(file);
    loadAudioFromFile(file);

    console.log('Saved audio file:', file.name);

    const allFiles = await loadAllAudioFiles();
    console.log("All saved sounds:");
    allFiles.forEach(f => console.log(f.name));
});

document.getElementById('bg-spin').addEventListener('change', (e) => {
    RotateBackground = e.target.checked;
});

document.getElementById('model-rotation-speed').addEventListener('input', (e) => {
    modelRotationSpeed = parseFloat(e.target.value);
});

document.getElementById('noise-scale').addEventListener('change', (e) => {
    NoiseScale = e.target.value;
});

document.getElementById('noise-amount').addEventListener('change', (e) => {
    NoiseAmount = e.target.value;
});

document.getElementById('object-scale').addEventListener('change', (e) => {
    objectScale = e.target.value;
});

document.getElementById('color-change').addEventListener('change', (e) => {
    ColorChange = e.target.checked;
});

document.getElementById('change-material').addEventListener('change', (e) => {
    changeMaterial = e.target.checked;
});

document.getElementById('model-spin').addEventListener('change', (e) => {
    rotateModel = e.target.checked;
});

document.getElementById('change-material-threshold').addEventListener('change', (e) => {
    changeMaterialThreshold = e.target.value;
});

document.getElementById('bg-light').addEventListener('input', (e) => {
    pointLight.intensity = parseFloat(e.target.value);
    lightIntensity = parseFloat(e.target.value);
});

document.getElementById('bloom-strength').addEventListener('input', (e) => {
    bloomStrength = parseFloat(e.target.value); 
    composer.passes.forEach(pass => {
        if (pass instanceof UnrealBloomPass) {
            pass.strength = bloomStrength;
        }
    });
});

document.getElementById('bloom-radius').addEventListener('input', (e) => {
    bloomRadius = parseFloat(e.target.value); 
    composer.passes.forEach(pass => {
        if (pass instanceof UnrealBloomPass) {
            pass.radius = bloomRadius;
        }
    });
});

document.getElementById('bloom-threshold').addEventListener('input', (e) => {
    bloomThreshold = parseFloat(e.target.value);
    composer.passes.forEach(pass => {
        if (pass instanceof UnrealBloomPass) {
            pass.threshold = bloomThreshold;
        }
    });
});


document.getElementById('bg-color').addEventListener('input', (e) => {
    bgMaterial.color.set(e.target.value);
    bgMaterialNoGradient.color.set(e.target.value);
    pointLight.color.set(e.target.value);
});


document.getElementById('bg-gradient').addEventListener('change', (e) => {
    const materialToUse = e.target.checked ? bgMaterial : bgMaterialNoGradient;

    group.traverse(child => {
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material = child.material.map(() => materialToUse);
            } else {
                child.material = materialToUse;
            }

            child.material.needsUpdate = true;
        }
    });
});

document.getElementById('model-material').addEventListener('change', (e) => {
    currentMaterial = e.target.value;
    applyMaterialToCurrentModel();
    updateStandardControlsVisibility();
});

document.getElementById('model-color').addEventListener('input', (e) => {
    standardMaterial.color.set(e.target.value);
});
document.getElementById('wire-color').addEventListener('input', (e) => {
    wireframeMaterial.color.set(e.target.value);
});

document.getElementById('model-roughness')?.addEventListener('input', (e) => {
    standardMaterial.roughness = parseFloat(e.target.value);
});

document.getElementById('model-metalness')?.addEventListener('input', (e) => {
    standardMaterial.metalness = parseFloat(e.target.value);
});

// --- Seek / progress ---

function playAudioFromTime(offsetTime) {
    console.log('Seeking to:', offsetTime, 'seconds');
    sound.stop();
    isPlaying = false;
    audioContext = listener.context;

    if (audioSource) {
        try { audioSource.stop(); } catch(e) {}
    }

    audioSource = audioContext.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.loop = false;
    audioSource.connect(analyser.analyser);
    analyser.analyser.connect(listener.getInput());

    startTime = audioContext.currentTime - offsetTime;
    pauseTime = offsetTime;
    isPlaying = true;
    audioSource.start(0, offsetTime);
}

function updateProgressBar() {
    if (!isDragging && audioBuffer && audioContext) {
        let currentTime;
        if (isPlaying && !audioSource) {
            currentTime = audioContext.currentTime - startTime;
        } else if (isPlaying && audioSource) {
            currentTime = audioContext.currentTime - startTime + pauseTime;
        }
        if (currentTime !== undefined) {
            const duration = audioBuffer.duration;
            if (currentTime >= duration) {
                isPlaying = false;
                progressFill.style.width = '100%';
                currentTimeDisplay.textContent = formatTime(duration);
            } else {
                progressFill.style.width = (currentTime / duration) * 100 + '%';
                currentTimeDisplay.textContent = formatTime(currentTime);
            }
        }
    }
}

progressBar.addEventListener('mousedown', () => {
    isDragging = true;
    if (audioSource) { audioSource.stop(); isPlaying = false; }
});

document.addEventListener('mouseup', () => { isDragging = false; });

progressBar.addEventListener('click', (e) => {
    if (!audioBuffer) return;
    const rect = progressBar.getBoundingClientRect();
    const clickX = e.clientX / 2 - rect.left;
    const percent = (clickX / rect.width * 100).toFixed(2);
    playAudioFromTime((percent / 100) * audioBuffer.duration);
});

// --- Animation ---
function animate( time ) {
    const data = analyser.getAverageFrequency();
    updateProgressBar();

    if ( loadedModels[modelName] ) {
        const scale = (0.001 + data / 10000) * objectScale;
        loadedModels[modelName].scale.set( scale, scale, scale );

        const simplex = animate.simplex || (animate.simplex = new SimplexNoise());

        loadedModels[modelName].traverse( child => {
            if ( child.isMesh && child.geometry && loadedModels[modelName].originalPositions[child.uuid] ) {
                const positions = child.geometry.attributes.position;
                const originalPositions = loadedModels[modelName].originalPositions[child.uuid];

                for (let i = 0; i < originalPositions.length; i += 3) {
                    const x = originalPositions[i];
                    const y = originalPositions[i + 1];
                    const z = originalPositions[i + 2];

                    const noise = simplex.noise3d(
                        x * NoiseScale + time * 0.0006,
                        y * NoiseScale + data * 0.01,
                        z * NoiseScale + loadedModels[modelName].rotation.y
                    );

                    const length = Math.sqrt(x * x + y * y + z * z) || 1;
                    const displacement = noise * data * 0.001 * NoiseAmount;
                    positions.array[i]     = x + (x / length) * displacement;
                    positions.array[i + 1] = y + (y / length) * displacement;
                    positions.array[i + 2] = z + (z / length) * displacement;
                }
                positions.needsUpdate = true;
                child.geometry.computeVertexNormals();
            }
        });
    }

    // changeMaterial toggle overrides selected material with freq-reactive swap
    if ( loadedModels[modelName] && changeMaterial ) {
        const mat = loadedModels[modelName].scale.x > changeMaterialThreshold ? wireframeMaterial : normalMaterial;
        loadedModels[modelName].traverse( child => { if ( child.isMesh ) child.material = mat; });
    }
    pointLight.intensity = (data / 10) *lightIntensity;
    const hue = ( data / 100 ) % 1;
    if (ColorChange) {
        wireframeMaterial.color.setHSL( hue * 0.5, 1, 0.5 );
        standardMaterial.color.setHSL( hue, 1, 0.5 );
        bgMaterial.color.setHSL( hue + (time / 10000), 1, 0.1 );
        bgMaterialNoGradient.color.setHSL( hue + (time / 10000), 1, 0.1 );
    }

    if ( loadedModels[modelName] && rotateModel) {
        loadedModels[modelName].rotation.y = time / 1000 * modelRotationSpeed;
    }

    group.rotation.z = RotateBackground ? (time / 2000) + (Math.round(data) / 500) : 0;

    composer.render();
}

renderer.setAnimationLoop(animate);