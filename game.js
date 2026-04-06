import {AudioListener, Audio, AudioLoader, AudioAnalyser, PerspectiveCamera, Scene, BoxGeometry, MeshNormalMaterial, Mesh, WebGLRenderer, MeshBasicMaterial, Group, ShapeGeometry, DoubleSide, Box3, Vector3, DynamicDrawUsage} from 'three';
import { OBJLoader } from './modules/three.js/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from './modules/three.js/examples/jsm/loaders/FBXLoader.js';
import { NoToneMapping, PointLight } from './modules/three.js/build/three.core.js';
import { SVGLoader } from './modules/three.js/examples/jsm/loaders/SVGLoader.js';
import { SimplexNoise } from './modules/three.js/examples/jsm/math/SimplexNoise.js';

// Init Window dimensions
const width = window.innerWidth, height = window.innerHeight;

const camera = new PerspectiveCamera( 70, width / height, 0.01, 10 );
camera.position.z = 3;

const scene = new Scene();


let color = 0xffffff;
const normalMaterial = new MeshNormalMaterial();
const wireframeMaterial = new MeshBasicMaterial( { wireframe: true, color: color, wireframeLinewidth: 3 } );
const basicMaterial = new MeshBasicMaterial( { color: 0x888888 } );

//model list

const models = [
//    { name: 'duck', path: './models/duck-plush/source/Duck.fbx', scale: [0.01, 0.01, 0.01], position: [0, 0, 0], material: normalMaterial }
   { name: 'duck', path: './models/EcoSphrere.fbx', scale: [0.01, 0.01, 0.01], position: [0, 0, 0], material: normalMaterial }
//   { name: 'duck', path: './models/Monke.fbx', scale: [0.01, 0.01, 0.01], position: [0, 0, 0], material: normalMaterial }
];

const loadedModels = {};

// Model loader function based on file extension
function getLoaderForFile( filePath ) {
    const extension = filePath.split( '.' ).pop().toLowerCase();
    if ( extension === 'fbx' ) {
        return new FBXLoader();
    }
    return new OBJLoader();
}
models.forEach( model => {
    const loader = getLoaderForFile( model.path );
    loader.load( model.path, object => {
        loadedModels[model.name] = object;
        loadedModels[model.name].scale.set(...model.scale);
        loadedModels[model.name].position.set(...model.position);
        
        // Store original vertex positions for displacement
        loadedModels[model.name].originalPositions = {};
        
        loadedModels[model.name].traverse( child => {
            if ( child.isMesh ) {
                child.material = model.material;
                // Clone geometry to avoid modifying the original
                if (child.geometry) {
                    // Clone the geometry for safe modification
                    child.geometry = child.geometry.clone();
                    
                    // Mark position attribute as dynamic
                    if (child.geometry.attributes.position) {
                        child.geometry.attributes.position.setUsage(DynamicDrawUsage);
                    }
                    
                    const positions = child.geometry.attributes.position.array.slice();
                    loadedModels[model.name].originalPositions[child.uuid] = positions;
                }
            }
        });
        scene.add(loadedModels[model.name]);
    }, undefined, error => console.error('Model load error:', error) );
});

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
            const mesh = new Mesh(geometry, basicMaterial);
            svgGroup.add(mesh);
        }
    }

    // Center shapes around the local origin so rotation occurs around the SVG center
    const box = new Box3().setFromObject(svgGroup);
    const center = new Vector3();
    box.getCenter(center);
    svgGroup.position.x = -center.x;
    svgGroup.position.y = -center.y;

    group.add(svgGroup);
    group.scale.set(0.01, 0.01, 0.1); // Scale down to fit
    group.position.z = -1;
    scene.add(group);
});


//light
scene.add( new PointLight( 0xffffff, 1, 100 ) );


const canvas = document.getElementById( 'three-canvas' );
const renderer = new WebGLRenderer( { antialias: true, canvas } );
renderer.setSize( width, height );
renderer.setAnimationLoop( animate );

//load sounds
const listener = new AudioListener();
camera.add( listener );
const sound = new Audio( listener );

const audioLoader = new AudioLoader();
audioLoader.load( './sounds/Darude - Sandstorm 2000 - Remaster.mp3', function( buffer ) {
	audioBuffer = buffer;
	sound.setBuffer( buffer );
	sound.setLoop(false);
	sound.setVolume(0.5);
	durationDisplay.textContent = formatTime(buffer.duration);
	
	// Initialize audio context and playback tracking for initial load
	audioContext = sound.getOutput().context;
	startTime = audioContext.currentTime;
	isPlaying = true;
	
	sound.play();
});
// create an AudioAnalyser, passing in the sound and desired fftSize
const analyser = new AudioAnalyser( sound, 32 );

// Track duration and current time
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

// Format time in MM:SS
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Play audio from specific time
function playAudioFromTime(offsetTime) {
    // Stop the Three.js sound object
    console.log('Seeking to:', offsetTime, 'seconds');
    sound.stop();
    isPlaying = false;
    
    audioContext = sound.getOutput().context;
    
    // Stop existing source
    if (audioSource) {
        try {
            audioSource.stop();
        } catch(e) {}
    }
    
    // Create new source and connect to analyser so visuals update
    audioSource = audioContext.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.loop = false;
    
    // Connect through analyser to listener
    audioSource.connect(analyser.analyser);
    analyser.analyser.connect(listener.getInput());
    
    // Track playback time
    startTime = audioContext.currentTime - offsetTime;
    pauseTime = offsetTime;
    isPlaying = true;
    
    audioSource.start(0, offsetTime);
}

// Update progress bar
function updateProgressBar() {
    if (!isDragging && audioBuffer && audioContext) {
        let currentTime;
        
        // If using the Three.js sound object
        if (isPlaying && !audioSource) {
            const elapsed = audioContext.currentTime - startTime;
            currentTime = elapsed;
        }
        // If using the BufferSource (after seeking)
        else if (isPlaying && audioSource) {
            currentTime = audioContext.currentTime - startTime + pauseTime;
        }
        
        if (currentTime !== undefined) {
            const duration = audioBuffer.duration;
            
            if (currentTime >= duration) {
                isPlaying = false;
                progressFill.style.width = '100%';
                currentTimeDisplay.textContent = formatTime(duration);
            } else {
                const percentage = (currentTime / duration);
                progressFill.style.width = percentage * 100 + '%';
                currentTimeDisplay.textContent = formatTime(currentTime);
            }
        }
    }
}

// Handle progress bar clicks/drags
progressBar.addEventListener('mousedown', () => {
    isDragging = true;
    if (audioSource) {
        audioSource.stop();
        isPlaying = false;
    }
});

document.addEventListener('mouseup', () => {
    isDragging = false;
});

progressBar.addEventListener('click', (e) => {
    if (!audioBuffer) return;
    const rect = progressBar.getBoundingClientRect();
    const clickX = e.clientX/2 - rect.left;
    const percent = (clickX / rect.width * 100).toFixed(2);
    console.log('Calculated click percentage:', percent + '%');
    const seekTime = (percent / 100) *  audioBuffer.duration;
    playAudioFromTime(seekTime);
});

//Controlls Event Listener

// animation

function animate( time ) {


	// get the average frequency of the sound
	const data = analyser.getAverageFrequency();
    // Update progress bar
    updateProgressBar();
    // use the frequency data to scale the model
    if ( loadedModels['duck'] ) {
        const scale = 0.001 + data / 10000; // base scale + scaled by frequency
        loadedModels['duck'].scale.set( scale, scale, scale );
        
        const simplex = animate.simplex || (animate.simplex = new SimplexNoise());
        
        // Displace vertices using noise
        loadedModels['duck'].traverse( child => {
            if ( child.isMesh && child.geometry && loadedModels['duck'].originalPositions[child.uuid] ) {
                const positions = child.geometry.attributes.position;
                const originalPositions = loadedModels['duck'].originalPositions[child.uuid];
                
                for (let i = 0; i < originalPositions.length; i += 3) {
                    const x = originalPositions[i];
                    const y = originalPositions[i + 1];
                    const z = originalPositions[i + 2];

                    const noise = simplex.noise3d(
                        x * 3 + time * 0.0006,
                        y * 3 + data * 0.001,
                        z * 3 + loadedModels['duck'].rotation.y
                    );

                    // Calculate direction from center (normalize the vertex position)
                    const length = Math.sqrt(x * x + y * y + z * z) || 1;
                    const nx = x / length;
                    const ny = y / length;
                    const nz = z / length;

                    // Displace outward along that direction
                    const displacement = noise * data * 0.001;
                    positions.array[i]     = x + nx * displacement;
                    positions.array[i + 1] = y + ny * displacement;
                    positions.array[i + 2] = z + nz * displacement;
                }
                positions.needsUpdate = true;
                
                // Recalculate normals for proper lighting after displacement
                if (child.geometry.computeVertexNormals) {
                    child.geometry.computeVertexNormals();
                }
            }
        });
    }
    if ( loadedModels['duck'] ) {
        loadedModels['duck'].scale.x > 0.01 ? loadedModels['duck'].traverse( child => {
            if ( child.isMesh ) {
                child.material = wireframeMaterial;
            }
    }     ) : loadedModels['duck'].traverse( child => {
            if ( child.isMesh ) {
                child.material = normalMaterial;
            }
    }     );
    }

    const hue = ( data / 100 ) % 1;
    wireframeMaterial.color.setHSL( hue, 1, 0.5 );
    basicMaterial.color.setHSL( hue*0.1*(time/1000), 1, 0.1 );
	if ( loadedModels['duck'] ) {
		loadedModels['duck'].rotation.y = time / 1000;
	}
    // Rotate the SVG group based on time and frequency data
    group.rotation.z = time / 2000 + data / 500;

	renderer.render( scene, camera );

}