import {
    AudioListener, Audio, AudioAnalyser,
} from './modules/three.js/build/three.module.js';

import { SceneBuilder, PRESETS}    from './SceneBuilder.js';
import { Layer, ModelObject, PointLightObject, WaveObject, PropertyBinding} from './Sceneobjects.js';
import { PP_SHADER_REGISTRY, PP_NATIVE_REGISTRY, PostProcessingLayer, PostProcessingPipeline, NativePassLayer, initShaders } from './PostProcessing.js';
import {generateMaterialPreviews, generateModelPreviews, generatePPPreviews} from './PreviewRenderer.js';
// ─────────────────────────────────────────────
//  Scene
// ─────────────────────────────────────────────
const canvas  = document.getElementById('three-canvas');
const builder = new SceneBuilder(canvas);

// ─────────────────────────────────────────────
//  Audio
// ─────────────────────────────────────────────
const listener = new AudioListener();
builder.camera.add(listener);
const sound    = new Audio(listener);
const analyser = new AudioAnalyser(sound, 256);

let audioBuffer = null;
let audioContext = null;
let audioSource  = null;
let startTime    = 0;
let pauseTime        = 0;
let isPlaying        = false;
let isDragging   = false;
let Volume       = 1;

// ─────────────────────────────────────────────
//  IndexedDB
// ─────────────────────────────────────────────
const DB_NAME     = 'AudioDB';
const STORE_NAME  = 'files';
const LAYERS_STORE = 'layers';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME))
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(LAYERS_STORE))
                db.createObjectStore(LAYERS_STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

async function saveAudioFile(file) {
    const db    = await openDB();
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
        id: Date.now() + '_' + file.name, file, name: file.name, type: file.type
    });
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}

async function loadAllAudioFiles() {
    const db  = await openDB();
    const tx  = db.transaction(STORE_NAME, 'readonly');
    return new Promise((res, rej) => {
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => res(req.result);
        req.onerror   = () => rej(req.error);
    });
}

// ─────────────────────────────────────────────
//  Unified serialization
// ─────────────────────────────────────────────
function serializeAll() {
    const globalPPLayers = (ppContexts.get('global')?.layers ?? []).map(l => l.toJSON());
    const sceneLayers = builder.layers.map(layer => ({
        ...layer.toJSON(),
        ppLayers: (ppContexts.get(layer.id)?.layers ?? []).map(l => l.toJSON()),
    }));
    return [
        { id: 'global', name: 'Global', isGlobal: true, objects: [], ppLayers: globalPPLayers },
        ...sceneLayers,
    ];
}

async function deserializeAll(data) {
    const globalEntry = data.find(d => d.isGlobal);
    const sceneLayers = data.filter(d => !d.isGlobal);

    // Clear per-layer PP contexts
    for (const id of ppContexts.keys()) {
        if (id !== 'global') ppContexts.delete(id);
    }

    await builder.loadFromJSON(sceneLayers);

    // Restore global PP
    const globalCtx = ppContexts.get('global');
    if (globalCtx && globalEntry?.ppLayers?.length) {
        globalCtx.layers = globalEntry.ppLayers.map(_deserializePPLayer);
        globalCtx.pipeline.layers = globalCtx.layers;
    }

    // Restore per-layer PP
    for (const layer of builder.layers) {
        const ld = sceneLayers.find(d => d.id === layer.id);
        if (ld?.ppLayers?.length > 0) {
            const lpp = new PostProcessingPipeline(builder.renderer, window.innerWidth, window.innerHeight);
            const layers = ld.ppLayers.map(_deserializePPLayer);
            lpp.layers = layers;
            ppContexts.set(layer.id, { layers, pipeline: lpp });
            builder.setLayerPPPipeline(layer.id, lpp);
        }
    }
}

async function saveAllToDB() {
    const db = await openDB();
    const tx = db.transaction(LAYERS_STORE, 'readwrite');
    tx.objectStore(LAYERS_STORE).put({ id: 'current', layers: serializeAll() });
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}

async function loadAllFromDB() {
    const db = await openDB();
    const tx = db.transaction(LAYERS_STORE, 'readonly');
    return new Promise((res, rej) => {
        const req = tx.objectStore(LAYERS_STORE).get('current');
        req.onsuccess = () => res(req.result?.layers ?? null);
        req.onerror   = () => rej(req.error);
    });
}

// ─────────────────────────────────────────────
//  Save/Load Layer Files
// ─────────────────────────────────────────────
function downloadLayersToFile(Name) {
    const data = serializeAll();

    const json = JSON.stringify(data, null, 2); // pretty format
    const blob = new Blob([json], { type: "application/json" });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = Name + ".json"; // filename
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}


document.getElementById('file-save').addEventListener('click', ()=>{
    spawnPopup("Save Project", [['Name','text']])
            .then(data => {
                const {
                    Name
                } = data;
                downloadLayersToFile(Name);
            })
            .catch(() => {});
    
});
const fileInput = document.getElementById('file-input');

document.getElementById('file-open').addEventListener('click', () => {
    fileInput.click();
});

// When user selects a file
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    await loadLayersFromFile(file);

    // allow re-selecting same file later
    fileInput.value = "";
});

async function loadLayersFromFile(file) {
    return new Promise((res, rej) => {
        const reader = new FileReader();

        reader.onload = async () => {
            try {
                const data = JSON.parse(reader.result);
                if (data) {
                    await deserializeAll(data);
                    renderLayerList();
                    switchPPContext('global');
                    if (builder.layers.length > 0) selectLayer(builder.layers[0]);
                    await saveAllToDB();
                }
                res(data);
            } catch (err) {
                rej(err);
            }
        };

        reader.onerror = () => rej(reader.error);
        reader.readAsText(file);
    });
}

// ─────────────────────────────────────────────
//  Audio playback
// ─────────────────────────────────────────────
function formatTime(s) {
    if (isNaN(s)) return '0:00';
    return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
}

function applyAudioBuffer(buffer) {
    if (sound.isPlaying) sound.stop();
    audioBuffer = buffer;
    audioSource = null;
    sound.setBuffer(buffer);
    sound.setLoop(false);
    sound.setVolume(Volume);
    durationDisplay.textContent = formatTime(buffer.duration);
    audioContext = listener.context;
    startTime = audioContext.currentTime;
    pauseTime = 0;
    isPlaying = true;
    sound.play();
}

function setCurrentTrack(name) {
    document.querySelectorAll('#saved-tracks .list-button').forEach(btn =>
        btn.classList.toggle('selected', btn.dataset.trackName === name)
    );
}

function updatePauseBtn() {
    const btn = document.getElementById('pause-btn');
    if (btn) btn.textContent = isPlaying ? '⏸' : '▶';
}

function pauseAudio() {
    if (!isPlaying || !audioContext || !audioBuffer) return;
    const currentTime = audioSource
        ? audioContext.currentTime - startTime + pauseTime
        : audioContext.currentTime - startTime;
    pauseTime = Math.max(0, currentTime);
    if (audioSource) { try { audioSource.stop(); } catch (_) {} audioSource = null; }
    else sound.stop();
    isPlaying = false;
    updatePauseBtn();
}

function resumeAudio() {
    if (isPlaying || !audioBuffer || !audioContext) return;
    playAudioFromTime(pauseTime/2);
    updatePauseBtn();
}

function loadAudioFromRecord(record) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        audioContext = listener.context;
        const decoded = await audioContext.decodeAudioData(e.target.result);
        document.getElementById('track-name').textContent = record.name;
        setCurrentTrack(record.name);
        applyAudioBuffer(decoded);
        updatePauseBtn();
    };
    reader.readAsArrayBuffer(record.file);
}

function playAudioFromTime(offsetTime) {
    sound.stop();
    isPlaying = false;
    audioContext = listener.context;
    if (audioSource) { try { audioSource.stop(); } catch(e) {} }
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

// ─────────────────────────────────────────────
//  Popup Handler
// ─────────────────────────────────────────────
function spawnPopup(title, popupFields) {
    return new Promise((resolve, reject) => {
        let popupFill = document.createElement("div");
        popupFill.classList.add('popup-bg');

        let popup = document.createElement("div");
        popup.classList.add("popup");

        let titleText = document.createElement('div');
        titleText.textContent = title;
        titleText.classList.add('h1', 'popup-title-text');

        let inputBox = document.createElement("div");
        inputBox.classList.add('popup-input-box');

        let inputs = [];

        popupFields.forEach((element, index) => {
            const [text, type, required] = element;
            let input = document.createElement("input");
            input.id = "popup-input-" + index;
            let extraElement = null;

            if (type == "select"){
                input = document.createElement("select");
                element[2].forEach(element => {
                    const z = document.createElement('option');
                    const t = document.createTextNode(element);
                    z.value = element;
                    z.appendChild(t);
                    input.appendChild(z);
                });
                input.id = "popup-input-" + index;
            }
            else if (type === 'preview') {
                const previewType = required; // 'model', 'material', or 'pp'
                const defaultVal  = previewType === 'model'
                    ? PRESETS.MODEL_CATALOGUE[0]?.name
                    : previewType === 'pp'
                    ? Object.values(PP_SHADER_REGISTRY)[0]?.name
                    : Object.keys(PRESETS.materials)[0];
                input = document.createElement('input');
                input.type  = 'hidden';
                input.value = defaultVal ?? '';
                input.id    = 'popup-input-' + index;
                const _extraCallbacks = [];
                input._extraCallbacks = _extraCallbacks;
                extraElement = createPreviewArea(previewType, defaultVal, name => {
                    input.value = name;
                    _extraCallbacks.forEach(fn => fn(name));
                });
            }
            else if (type === "color") {
                input = document.createElement("input");
                input.type = "color";
                input.value = "#ffffff";
            }
            else{
                input.type = type;
            }

            const nameField = document.createElement('div');
            nameField.classList.add("h2");
            nameField.textContent = text;

            const box = document.createElement('div');
            if (extraElement) box.classList.add('preview-field');
            box.appendChild(nameField);
            box.appendChild(input);
            if (extraElement) box.appendChild(extraElement);

            inputBox.appendChild(box);

            inputs.push({ input, type, required, label: text });
        });

        // Model preview -> auto-fill Name input
        const modelEntry = inputs.find(i => i.label === 'Model' && i.type === 'preview');
        const nameEntry  = inputs.find(i => i.label === 'Name'  && i.type === 'text');
        if (modelEntry?.input._extraCallbacks && nameEntry) {
            nameEntry.input.addEventListener('input', () => { nameEntry.input.dataset.userEdited = '1'; });
            modelEntry.input._extraCallbacks.push(name => {
                if (!nameEntry.input.dataset.userEdited) nameEntry.input.value = name;
            });
            if (modelEntry.input.value) nameEntry.input.value = modelEntry.input.value;
        }

        const confirm = document.createElement('div');
        confirm.textContent = "Confirm";
        confirm.classList.add('big-Btn');

        const cancel = document.createElement('div');
        cancel.textContent = "Cancel";
        cancel.classList.add('big-Btn');

        const buttonBox = document.createElement('div');
        buttonBox.appendChild(confirm);
        buttonBox.appendChild(cancel);
        buttonBox.classList.add("popup-button-box");

        popup.appendChild(titleText);
        popup.appendChild(inputBox);
        popup.appendChild(buttonBox);
        popupFill.appendChild(popup);
        document.body.appendChild(popupFill);

        confirm.onclick = () => {
            let result = {};
            let valid = true;

            inputs.forEach((item, i) => {
                let value;
                if (item.type === "checkbox") {
                    value = item.input.checked;
                } else {
                    value = item.input.value;
                }
                if (item.required && !value) {
                    valid = false;
                    item.input.style.border = "2px solid red";
                }
                result[item.label] = value;
            });

            if (!valid) return;
            popupFill.remove();
            resolve(result);
        };

        cancel.onclick = () => {
            popupFill.remove();
            reject("cancelled");
        };
    });
}

// ─────────────────────────────────────────────
//  Progress bar
// ─────────────────────────────────────────────
const progressBar         = document.getElementById('progress-bar');
const progressFill        = document.getElementById('progress-fill');
const currentTimeDisplay  = document.getElementById('current-time');
const durationDisplay     = document.getElementById('duration');

function updateProgressBar() {
    if (isDragging || !audioBuffer || !audioContext) return;
    let currentTime;
    if (isPlaying && !audioSource)  currentTime = audioContext.currentTime - startTime;
    else if (isPlaying && audioSource) currentTime = audioContext.currentTime - startTime + pauseTime;
    if (currentTime === undefined) return;

    const dur = audioBuffer.duration;
    if (currentTime >= dur) {
        isPlaying = false;
        progressFill.style.width = '100%';
        currentTimeDisplay.textContent = formatTime(dur);
    } else {
        progressFill.style.width = (currentTime / dur) * 100 + '%';
        currentTimeDisplay.textContent = formatTime(currentTime);
    }
}

progressBar.addEventListener('mousedown', () => {
    isDragging = true;
    if (audioSource) { audioSource.stop(); isPlaying = false; }
});
document.addEventListener('mouseup', () => { isDragging = false; });
progressBar.addEventListener('click', (e) => {
    if (!audioBuffer) return;
    const rect    = progressBar.getBoundingClientRect();
    const percent = (((e.clientX/2) - rect.left) / rect.width * 100).toFixed(2);
    playAudioFromTime((percent / 100) * audioBuffer.duration);
});

// ─────────────────────────────────────────────
//  Post-processing state
//  ppContexts: Map<'global' | layerId, { layers: [], pipeline: PostProcessingPipeline }>
// ─────────────────────────────────────────────
const ppContexts  = new Map();
let   ppContextId = 'global';   // which context the PP editor is showing

function getPPContext(id = ppContextId)  { return ppContexts.get(id); }
function getPPLayers(id = ppContextId)   { return getPPContext(id)?.layers ?? []; }
function getPPPipeline(id = ppContextId) { return getPPContext(id)?.pipeline ?? null; }

function _deserializePPLayer(d) {
    if (d.type === 'native') return NativePassLayer.fromJSON(d);
    if (d.type === 'bloom')  return NativePassLayer.fromJSON({ ...d, type: 'native', passType: 'unrealBloom' });
    return PostProcessingLayer.fromJSON(d);
}

// ─────────────────────────────────────────────
//  Tab switching (Object Editor ↔ Post Processing)
// ─────────────────────────────────────────────
let currentTab = 'oe';

function switchTab(tab) {
    currentTab = tab;
    const isOE = tab === 'oe';
    // #layers is always visible — it doubles as PP context selector in PP mode
    document.getElementById('current-layer-controls').style.display = isOE ? '' : 'none';
    document.getElementById('pp-section').style.display            = isOE ? 'none' : '';
    document.getElementById('oe-btn').classList.toggle('selected',  isOE);
    document.getElementById('pp-editor').classList.toggle('selected', !isOE);
    renderLayerList(); // re-render to add/remove Global item and rewire click handlers
}

// ─────────────────────────────────────────────
//  PP context selector
// ─────────────────────────────────────────────
function addPPLayerHandler() {
    if (!ppContexts.has(ppContextId)) switchPPContext(ppContextId);
    const ctx = getPPContext();

    const shaderKeys  = Object.keys(PP_SHADER_REGISTRY);
    const shaderNames = shaderKeys.map(k => PP_SHADER_REGISTRY[k].name);
    const nativeKeys  = Object.keys(PP_NATIVE_REGISTRY);
    const nativeNames = nativeKeys.map(k => PP_NATIVE_REGISTRY[k].name);
    spawnPopup('Add Post FX', [
        ['Effect', 'preview', 'pp'],
    ]).then(data => {
        const effectName = data['Effect'];
        const nativeIdx  = nativeNames.indexOf(effectName);
        const newLayer = nativeIdx !== -1
            ? new NativePassLayer(nativeKeys[nativeIdx])
            : new PostProcessingLayer(shaderKeys[shaderNames.indexOf(effectName)]);
        ctx.layers.push(newLayer);
        ctx.pipeline.layers = ctx.layers;
        if (ppContextId !== 'global') builder.setLayerPPPipeline(ppContextId, ctx.pipeline);
        renderPPLayerList();
        saveAllToDB();
    }).catch(() => {});
}

function switchPPContext(id) {
    ppContextId = id;
    if (!ppContexts.has(id)) {
        const lpp = new PostProcessingPipeline(builder.renderer, window.innerWidth, window.innerHeight);
        ppContexts.set(id, { layers: [], pipeline: lpp });
        if (id !== 'global') builder.setLayerPPPipeline(id, lpp);
    }
    // Update selection highlight in the layer list without a full re-render
    document.querySelectorAll('#layer-list .layer-item').forEach(el => {
        const elId = el.dataset.layerId ?? 'global';
        el.classList.toggle('selected', elId === id);
    });

    // Update title and Add Post FX button
    const title = id === 'global' ? 'Global' : (builder.layers.find(l => l.id === id)?.name ?? id);
    document.getElementById('pp-context-title').textContent = title;
    const btnBox = document.getElementById('pp-top-buttons');
    btnBox.innerHTML = '';
    const addBtn = document.createElement('div');
    addBtn.classList.add('Btn');
    addBtn.textContent = 'Add Post FX';
    addBtn.addEventListener('click', addPPLayerHandler);
    btnBox.appendChild(addBtn);

    renderPPLayerList();
    document.getElementById('pp-layer-properties').innerHTML = '';
}

// ─────────────────────────────────────────────
//  Post-processing layer list UI
// ─────────────────────────────────────────────
function renderPPLayerList() {
    const container = document.getElementById('pp-layer-list');
    container.innerHTML = '';
    for (const layer of getPPLayers()) addPPLayerElement(layer);
}

function addPPLayerElement(ppLayer) {
    const ctx = getPPContext(); // capture current context at creation time

    const el = document.createElement('div');
    el.classList.add('list-button');
    el.style.justifyContent = 'space-between';
    el.dataset.ppLayerId = ppLayer.id;

    const name = document.createElement('span');
    name.textContent = ppLayer.name;

    const btnGroup = document.createElement('div');
    btnGroup.className = 'obj-btn-group';

    const mkBtn = cls => {
        const b = document.createElement('div');
        b.classList.add(cls, 'image-button');
        return b;
    };

    const upBtn = mkBtn('move-up');
    upBtn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = ctx.layers.indexOf(ppLayer);
        if (idx > 0) {
            [ctx.layers[idx], ctx.layers[idx - 1]] = [ctx.layers[idx - 1], ctx.layers[idx]];
            ctx.pipeline.layers = ctx.layers;
            renderPPLayerList();
            saveAllToDB();
        }
    });

    const downBtn = mkBtn('move-down');
    downBtn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = ctx.layers.indexOf(ppLayer);
        if (idx < ctx.layers.length - 1) {
            [ctx.layers[idx], ctx.layers[idx + 1]] = [ctx.layers[idx + 1], ctx.layers[idx]];
            ctx.pipeline.layers = ctx.layers;
            renderPPLayerList();
            saveAllToDB();
        }
    });

    const removeBtn = mkBtn('remove-layer');
    removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        ctx.layers = ctx.layers.filter(l => l.id !== ppLayer.id);
        ctx.pipeline.layers = ctx.layers;
        // if last per-layer effect removed, unregister from renderer
        if (ppContextId !== 'global' && ctx.layers.length === 0)
            builder.setLayerPPPipeline(ppContextId, null);
        renderPPLayerList();
        document.getElementById('pp-layer-properties').innerHTML = '';
        saveAllToDB();
    });

    btnGroup.appendChild(removeBtn);
    btnGroup.appendChild(upBtn);
    btnGroup.appendChild(downBtn);
    el.appendChild(name);
    el.appendChild(btnGroup);

    el.addEventListener('click', () => {
        document.querySelectorAll('#pp-layer-list .list-button').forEach(e =>
            e.classList.toggle('selected', e.dataset.ppLayerId === ppLayer.id));
        renderPPLayerProperties(ppLayer);
    });

    document.getElementById('pp-layer-list').appendChild(el);
}

function renderPPLayerProperties(ppLayer) {
    const panel = document.getElementById('pp-layer-properties');
    panel.innerHTML = '';

    const defs = ppLayer.propertyDefs ?? PP_SHADER_REGISTRY[ppLayer.shaderName]?.propertyDefs;
    if (!defs) return;

    const title = document.createElement('div');
    title.className = 'h2 prop-section-title';
    title.textContent = ppLayer.name;
    panel.appendChild(title);

    for (const def of defs) {
        const rowEl = document.createElement('div');
        rowEl.className = 'prop-row';

        const lbl = document.createElement('label');
        lbl.className = 'prop-label';
        lbl.textContent = def.label;
        rowEl.appendChild(lbl);

        if (def.type === 'checkbox') {
            const inp = document.createElement('input');
            inp.type = 'checkbox';
            inp.className = 'prop-checkbox';
            inp.checked = ppLayer.properties[def.key];
            inp.addEventListener('change', () => {
                ppLayer.properties[def.key] = inp.checked;
                ppLayer.invalidateMaterial?.();
                saveAllToDB();
            });
            rowEl.appendChild(inp);
        } else if (def.type === 'slider') {
            const wrap = document.createElement('div');
            wrap.className = 'prop-slider-wrap';

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'prop-slider';
            slider.min  = def.min  ?? 0;
            slider.max  = def.max  ?? 1;
            slider.step = def.step ?? 0.01;
            slider.value = ppLayer.properties[def.key];

            const num = document.createElement('input');
            num.type = 'number';
            num.className = 'prop-number';
            num.step  = def.step ?? 0.01;
            num.value = ppLayer.properties[def.key];

            slider.addEventListener('input', () => {
                ppLayer.properties[def.key] = parseFloat(slider.value);
                num.value = ppLayer.properties[def.key];
                ppLayer.invalidateMaterial?.();
                saveAllToDB();
            });
            num.addEventListener('input', () => {
                ppLayer.properties[def.key] = parseFloat(num.value);
                slider.value = ppLayer.properties[def.key];
                ppLayer.invalidateMaterial?.();
                saveAllToDB();
            });

            wrap.appendChild(slider);
            wrap.appendChild(num);
            rowEl.appendChild(wrap);
        } else if (def.type === 'color') {
            const inp = document.createElement('input');
            inp.type = 'color';
            inp.className = 'prop-color';
            inp.value = ppLayer.properties[def.key];
            inp.addEventListener('input', () => {
                ppLayer.properties[def.key] = inp.value;
                saveAllToDB();
            });
            rowEl.appendChild(inp);
        }

        panel.appendChild(rowEl);
    }
}

// ─────────────────────────────────────────────
//  Layer UI
// ─────────────────────────────────────────────
let selectedObject = null;
let _gizmoLiveRefresh = null;

function refreshCounters() {
    Array.from(document.querySelectorAll('#layer-list .layer-item'))
        .filter(el => el.dataset.layerId !== 'global')
        .forEach((el, i) => el.querySelector('.layer-count').textContent = i + 1);
}

function renderLayerList() {
    const container = document.getElementById('layer-list');
    container.innerHTML = '';

    if (currentTab === 'pp') {
        // Global PP button — sits above scene layers, no reorder/remove
        const globalEl = document.createElement('div');
        globalEl.classList.add('list-button', 'layer-item');
        if (ppContextId === 'global') globalEl.classList.add('selected');
        globalEl.dataset.layerId = 'global';

        const content = document.createElement('div');
        content.classList.add('layer-content');
        const name = document.createElement('div');
        name.textContent = 'Global';
        content.appendChild(name);
        globalEl.appendChild(content);
        globalEl.addEventListener('click', () => switchPPContext('global'));
        container.appendChild(globalEl);
    }

    for (const layer of builder.layers) addLayerElement(layer);
    refreshCounters();
}

function addLayerElement(layer) {
    const el = document.createElement('div');
    el.classList.add('list-button', 'layer-item');
    el.dataset.layerId = layer.id;

    const content = document.createElement('div');
    content.classList.add('layer-content');

    const count = document.createElement('div');
    count.classList.add('layer-count');

    const name = document.createElement('div');
    name.textContent = layer.name;

    const buttonBox = document.createElement('div');
    buttonBox.classList.add('layer-buttons');

    content.appendChild(count);
    content.appendChild(name);
    content.appendChild(buttonBox);
    el.appendChild(content);

    if (!layer.isBase) {
        const mkBtn = (cls) => {
            const b = document.createElement('div');
            b.classList.add(cls, 'image-button');
            return b;
        };

        const upBtn = mkBtn('move-up');
        upBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = builder.layers.indexOf(layer);
            if (idx > 1) {
                [builder.layers[idx], builder.layers[idx-1]] =
                [builder.layers[idx-1], builder.layers[idx]];
                renderLayerList();
                saveAllToDB();
            }
        });

        const downBtn = mkBtn('move-down');
        downBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = builder.layers.indexOf(layer);
            if (idx < builder.layers.length - 1) {
                [builder.layers[idx], builder.layers[idx+1]] =
                [builder.layers[idx+1], builder.layers[idx]];
                renderLayerList();
                saveAllToDB();
            }
        });

        const removeBtn = mkBtn('remove-layer');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            builder.removeLayer(layer.id);
            renderLayerList();
            saveAllToDB();
        });

        buttonBox.appendChild(removeBtn);
        buttonBox.appendChild(upBtn);
        buttonBox.appendChild(downBtn);
    }

    el.addEventListener('click', () => {
        if (currentTab === 'pp') switchPPContext(layer.id);
        else selectLayer(layer);
    });
    document.getElementById('layer-list').appendChild(el);
}

function selectLayer(layer) {
    selectedObject = null;
    builder.detachGizmo();

    document.querySelectorAll('.layer-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.layerId === layer.id);
    });

    document.getElementById('current-layer-controls').children[0].textContent = layer.name;

    const buttonBox = document.getElementById('layerTopButtons');
    buttonBox.innerHTML = '';

    // Models only on non-base layers
    if (!layer.isBase) {
        const addModel = document.createElement('div');
        addModel.classList.add('Btn');
        addModel.textContent = 'Add Model';
        addModel.addEventListener('click', () => {
            spawnPopup('Add Model to Scene', [
                ['Name',         'text'],
                ['Model',        'preview', 'model'],
                ['Material',     'preview', 'material'],
            ])
            .then(data => {
                const {
                    Model, Name, Material
                } = data;
                onAddModel(layer, Model, Name, Material);
            })
            .catch(() => {});
        });
        buttonBox.appendChild(addModel);
    }

    // Lights only on non-base layers
    if (!layer.isBase) {
        const addLight = document.createElement('div');
        addLight.classList.add('Btn');
        addLight.textContent = 'Add Light';
        addLight.addEventListener('click', () => onAddLight(layer));
        buttonBox.appendChild(addLight);
    }

    const addWave = document.createElement('div');
    addWave.classList.add('Btn');
    addWave.textContent = 'Add Wave';
    addWave.addEventListener('click', () => {
        spawnPopup('Add Wave', [
            ['Name',     'text'],
            ['Type',     'select', ['circular','linear','linear-up','bars','bars-both','line']],
            ['Segments', 'text'],
            ['Color',    'color'],
        ])
        .then(data => onAddWave(layer, data))
        .catch(() => {});
    });

    buttonBox.appendChild(addWave);

    renderObjectList(layer);
    document.getElementById('object-properties').innerHTML = '';
}

// ─────────────────────────────────────────────
//  Object list UI
// ─────────────────────────────────────────────
function renderObjectList(layer) {
    let listEl = document.getElementById('object-list');
    listEl.innerHTML = '';

    for (const obj of layer.objects) {
        const row = document.createElement('div');
        row.classList.add('list-button');
        row.style.justifyContent = 'space-between';
        row.dataset.objectId = obj.id;

        row.addEventListener('click', () => selectObject(obj, layer));

        const label = document.createElement('span');
        label.textContent = obj.name;

        const dupBtn = document.createElement('div');
        dupBtn.classList.add('duplicate-object', 'image-button');
        dupBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await duplicateObject(obj, layer);
        });

        const removeBtn = document.createElement('div');
        removeBtn.classList.add('remove-layer', 'image-button');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (selectedObject && selectedObject.id === obj.id) {
                selectedObject = null;
                document.getElementById('object-properties').innerHTML = '';
            }
            builder.removeObjectFromLayer(layer.id, obj.id);
            renderObjectList(layer);
            saveAllToDB();
        });

        const btnGroup = document.createElement('div');
        btnGroup.className = 'obj-btn-group';
        btnGroup.appendChild(dupBtn);
        btnGroup.appendChild(removeBtn);

        row.appendChild(label);
        row.appendChild(btnGroup);
        listEl.appendChild(row);
    }
}

// ─────────────────────────────────────────────
//  Object selection
// ─────────────────────────────────────────────
function selectObject(obj, layer) {
    selectedObject = obj;

    document.querySelectorAll('#object-list .list-button').forEach(el => {
        el.classList.toggle('selected', el.dataset.objectId === obj.id);
    });

    builder.attachGizmo(obj, saveAllToDB, () => _gizmoLiveRefresh?.());
    renderObjectProperties(obj, layer);
}

// ─────────────────────────────────────────────
//  Property panel builder
// ─────────────────────────────────────────────

const AUDIO_SOURCES = ['avgFrequency','lowFreq','midFreq','highFreq','peak','volume'];
const CURVES        = ['linear','exponential','inverse'];

function renderObjectProperties(obj, layer) {
    const panel = document.getElementById('object-properties');
    panel.innerHTML = '';

    const save = () => saveAllToDB();

    let currentSection = null; // content div of the active section

    const objectName = document.createElement("div");
    objectName.classList.add('h2');
    objectName.textContent = obj.name;
    panel.appendChild(objectName);
    // Helper: collapsible section header
    function section(title) {
        const h = document.createElement('div');
        h.className = 'h2 prop-section-title prop-section-collapsible';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = title;

        const arrow = document.createElement('span');
        arrow.className = 'prop-section-arrow';
        arrow.textContent = '▾';

        h.appendChild(titleSpan);
        h.appendChild(arrow);
        panel.appendChild(h);

        const content = document.createElement('div');
        content.className = 'prop-section-content';
        content.style.display = 'none';        // collapsed by default
        panel.appendChild(content);

        arrow.style.transform = 'rotate(-90deg)'; // start pointing right (collapsed)

        h.addEventListener('click', () => {
            const collapsed = content.style.display === 'none';
            content.style.display = collapsed ? '' : 'none';
            arrow.style.transform = collapsed ? '' : 'rotate(-90deg)';
        });

        currentSection = content;
    }

    // Helper: row wrapper — appends to active section, or panel if none
    function row(label) {
        const wrap = document.createElement('div');
        wrap.className = 'prop-row';
        const lbl = document.createElement('label');
        lbl.className = 'prop-label';
        lbl.textContent = label;
        wrap.appendChild(lbl);
        (currentSection || panel).appendChild(wrap);
        return wrap;
    }

    // Text input
    function textInput(label, getter, setter) {
        const r = row(label);
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'prop-input';
        inp.value = getter();
        inp.addEventListener('input', () => { setter(inp.value); save(); });
        r.appendChild(inp);
    }

    // Checkbox
    function checkbox(label, getter, setter) {
        const r = row(label);
        const inp = document.createElement('input');
        inp.type = 'checkbox';
        inp.className = 'prop-checkbox';
        inp.checked = getter();
        inp.addEventListener('change', () => { setter(inp.checked); save(); });
        r.appendChild(inp);
    }

    // Select
    function selectInput(label, options, getter, setter) {
        const r = row(label);
        const sel = document.createElement('select');
        sel.className = 'prop-select';
        options.forEach(opt => {
            const o = document.createElement('option');
            o.value = o.textContent = opt;
            sel.appendChild(o);
        });
        sel.value = getter();
        sel.addEventListener('change', () => { setter(sel.value); save(); });
        r.appendChild(sel);
        return sel;
    }

    // Color picker
    function colorInput(label, getter, setter) {
        const r = row(label);
        const inp = document.createElement('input');
        inp.type = 'color';
        inp.className = 'prop-color';
        // normalize to #rrggbb
        const val = getter();
        inp.value = val.startsWith('#') ? val : '#888888';
        inp.addEventListener('input', () => { setter(inp.value); save(); });
        r.appendChild(inp);
    }

    // Slider
    function slider(label, min, max, step, getter, setter) {
        const r = row(label);
        const wrap = document.createElement('div');
        wrap.className = 'prop-slider-wrap';

        const inp = document.createElement('input');
        inp.type = 'range';
        inp.className = 'prop-slider';
        inp.min = min; inp.max = max; inp.step = step;
        inp.value = getter();

        const num = document.createElement('input');
        num.type = 'number';
        num.className = 'prop-number';
        num.min = min; num.max = max; num.step = step;
        num.value = getter();

        inp.addEventListener('input', () => {
            const v = parseFloat(inp.value);
            num.value = v;
            setter(v);
            save();
        });
        num.addEventListener('input', () => {
            const v = parseFloat(num.value);
            inp.value = v;
            setter(v);
            save();
        });

        wrap.appendChild(inp);
        wrap.appendChild(num);
        r.appendChild(wrap);
        return r;
    }

    // PropertyBinding sub-panel
    function bindingPanel(label, binding, range = { min: -10, max: 10 }) {
        const container = document.createElement('div');
        container.className = 'prop-binding';
        (currentSection || panel).appendChild(container);

        const head = document.createElement('div');
        head.className = 'prop-binding-title h2';
        head.textContent = label;
        container.appendChild(head);

        // Mode toggle
        const modeRow = document.createElement('div');
        modeRow.className = 'prop-row';
        const modeLbl = document.createElement('label');
        modeLbl.className = 'prop-label';
        modeLbl.textContent = 'Mode';
        modeRow.appendChild(modeLbl);

        const modeWrap = document.createElement('div');
        modeWrap.className = 'prop-mode-toggle';

        ['constant','audio'].forEach(m => {
            const btn = document.createElement('div');
            btn.textContent = m;
            btn.className = 'mode-btn' + (binding.mode === m ? ' active' : '');
            btn.addEventListener('click', () => {
                binding.mode = m;
                modeWrap.querySelectorAll('.mode-btn').forEach(b =>
                    b.classList.toggle('active', b.textContent === m));
                // show/hide relevant rows
                constantSection.style.display = m === 'constant' ? '' : 'none';
                audioSection.style.display    = m === 'audio'    ? '' : 'none';
                save();
            });
            modeWrap.appendChild(btn);
        });
        modeRow.appendChild(modeWrap);
        container.appendChild(modeRow);

        // Constant value
        const constantSection = document.createElement('div');
        constantSection.style.display = binding.mode === 'constant' ? '' : 'none';
        container.appendChild(constantSection);

        const cSliderRow = document.createElement('div');
        cSliderRow.className = 'prop-row';
        const cLbl = document.createElement('label');
        cLbl.className = 'prop-label';
        cLbl.textContent = 'Value';
        const cWrap = document.createElement('div');
        cWrap.className = 'prop-slider-wrap';

        const cSlider = document.createElement('input');
        cSlider.type = 'range'; cSlider.className = 'prop-slider';
        cSlider.min = range.min; cSlider.max = range.max; cSlider.step = 0.01;
        cSlider.value = binding.value;

        const cNum = document.createElement('input');
        cNum.type = 'number'; cNum.className = 'prop-number';
        cNum.step = 0.01; cNum.value = binding.value;

        cSlider.addEventListener('input', () => {
            binding.value = parseFloat(cSlider.value);
            cNum.value = binding.value; save();
        });
        cNum.addEventListener('input', () => {
            binding.value = parseFloat(cNum.value);
            cSlider.value = binding.value; save();
        });

        cWrap.appendChild(cSlider); cWrap.appendChild(cNum);
        cSliderRow.appendChild(cLbl); cSliderRow.appendChild(cWrap);
        constantSection.appendChild(cSliderRow);

        // Audio section
        const audioSection = document.createElement('div');
        audioSection.style.display = binding.mode === 'audio' ? '' : 'none';
        container.appendChild(audioSection);

        // Source select
        const srcRow = document.createElement('div');
        srcRow.className = 'prop-row';
        const srcLbl = document.createElement('label');
        srcLbl.className = 'prop-label'; srcLbl.textContent = 'Source';
        const srcSel = document.createElement('select');
        srcSel.className = 'prop-select';
        AUDIO_SOURCES.forEach(s => {
            const o = document.createElement('option');
            o.value = o.textContent = s;
            srcSel.appendChild(o);
        });
        srcSel.value = binding.source;
        srcSel.addEventListener('change', () => { binding.source = srcSel.value; save(); });
        srcRow.appendChild(srcLbl); srcRow.appendChild(srcSel);
        audioSection.appendChild(srcRow);

        // Curve select
        const curveRow = document.createElement('div');
        curveRow.className = 'prop-row';
        const curveLbl = document.createElement('label');
        curveLbl.className = 'prop-label'; curveLbl.textContent = 'Curve';
        const curveSel = document.createElement('select');
        curveSel.className = 'prop-select';
        CURVES.forEach(c => {
            const o = document.createElement('option');
            o.value = o.textContent = c;
            curveSel.appendChild(o);
        });
        curveSel.value = binding.curve;
        curveSel.addEventListener('change', () => { binding.curve = curveSel.value; save(); });
        curveRow.appendChild(curveLbl); curveRow.appendChild(curveSel);
        audioSection.appendChild(curveRow);

        // Min slider
        const minRow = document.createElement('div');
        minRow.className = 'prop-row';
        const minLbl = document.createElement('label');
        minLbl.className = 'prop-label'; minLbl.textContent = 'Min';
        const minWrap = document.createElement('div');
        minWrap.className = 'prop-slider-wrap';
        const minSlider = document.createElement('input');
        minSlider.type = 'range'; minSlider.className = 'prop-slider';
        minSlider.min = range.min; minSlider.max = range.max; minSlider.step = 0.001;
        minSlider.value = binding.min;
        const minNum = document.createElement('input');
        minNum.type = 'number'; minNum.className = 'prop-number';
        minNum.step = 0.001; minNum.value = binding.min;
        minSlider.addEventListener('input', () => {
            binding.min = parseFloat(minSlider.value); minNum.value = binding.min; save();
        });
        minNum.addEventListener('input', () => {
            binding.min = parseFloat(minNum.value); minSlider.value = binding.min; save();
        });
        minWrap.appendChild(minSlider); minWrap.appendChild(minNum);
        minRow.appendChild(minLbl); minRow.appendChild(minWrap);
        audioSection.appendChild(minRow);

        // Max slider
        const maxRow = document.createElement('div');
        maxRow.className = 'prop-row';
        const maxLbl = document.createElement('label');
        maxLbl.className = 'prop-label'; maxLbl.textContent = 'Max';
        const maxWrap = document.createElement('div');
        maxWrap.className = 'prop-slider-wrap';
        const maxSlider = document.createElement('input');
        maxSlider.type = 'range'; maxSlider.className = 'prop-slider';
        maxSlider.min = range.min; maxSlider.max = range.max; maxSlider.step = 0.001;
        maxSlider.value = binding.max;
        const maxNum = document.createElement('input');
        maxNum.type = 'number'; maxNum.className = 'prop-number';
        maxNum.step = 0.001; maxNum.value = binding.max;
        maxSlider.addEventListener('input', () => {
            binding.max = parseFloat(maxSlider.value); maxNum.value = binding.max; save();
        });
        maxNum.addEventListener('input', () => {
            binding.max = parseFloat(maxNum.value); maxSlider.value = binding.max; save();
        });
        maxWrap.appendChild(maxSlider); maxWrap.appendChild(maxNum);
        maxRow.appendChild(maxLbl); maxRow.appendChild(maxWrap);
        audioSection.appendChild(maxRow);

        container.refreshFromBinding = () => {
            if (binding.mode === 'constant') {
                cSlider.value = binding.value;
                cNum.value    = binding.value;
            }
        };
        return container;
    }

    // ── Common: Name + Visible ──────────────────
    section('General');
    textInput('Name', () => obj.name, v => { obj.name = v; renderObjectList(layer); });
    checkbox('Visible', () => obj.visible, v => { obj.visible = v; });

    // ── Transform bindings ──────────────────────
    section('Position');
    const _pPosX = bindingPanel('Position X', obj.posX);
    const _pPosY = bindingPanel('Position Y', obj.posY);
    const _pPosZ = bindingPanel('Position Z', obj.posZ);

    section('Rotation');
    const _pRotX = bindingPanel('Rotation X', obj.rotX);
    const _pRotY = bindingPanel('Rotation Y', obj.rotY);
    const _pRotZ = bindingPanel('Rotation Z', obj.rotZ);

    section('Scale');
    const _pScaleX = bindingPanel('Scale X', obj.scaleX);
    const _pScaleY = bindingPanel('Scale Y', obj.scaleY);
    const _pScaleZ = bindingPanel('Scale Z', obj.scaleZ);

    _gizmoLiveRefresh = () => {
        [_pPosX, _pPosY, _pPosZ, _pRotX, _pRotY, _pRotZ, _pScaleX, _pScaleY, _pScaleZ]
            .forEach(p => p.refreshFromBinding());
    };

    // ── Model-specific ──────────────────────────
    if (obj.type === 'model') {
        section('Model');

        currentSection.appendChild(createPreviewArea('model', obj.modelName, v => { obj.modelName = v; save(); }));

        section('Material Properties');

        let opacityRowRef    = null; // forward refs set after their rows are created
        let roughnessRowRef  = null;
        let metalnessRowRef  = null;
        let smoothRowRef     = null;

        const isStandard = () => obj.materialType === 'standard';
        const isNormal   = () => obj.materialType === 'normal';

        currentSection.appendChild(createPreviewArea('material', obj.materialType, v => {
            obj.materialType = v;
            if (opacityRowRef)   opacityRowRef.style.display   = v === 'normal'   ? 'none' : '';
            if (roughnessRowRef) roughnessRowRef.style.display = v === 'standard' ? '' : 'none';
            if (metalnessRowRef) metalnessRowRef.style.display = v === 'standard' ? '' : 'none';
            if (smoothRowRef)    smoothRowRef.style.display    = v === 'normal'   ? 'none' : '';
            save();
        }));

        colorInput('Color', () => obj.color, v => { obj.color = v; });

        // Color reactive toggle + sensitivity (shown only when reactive)
        const sensitivityRow = document.createElement('div');
        sensitivityRow.style.display = obj.colorReactive ? '' : 'none';
        const srWrap = document.createElement('div');
        srWrap.className = 'prop-row';
        const srLbl = document.createElement('label');
        srLbl.className = 'prop-label';
        srLbl.textContent = 'Color Sensitivity';
        const srSliderWrap = document.createElement('div');
        srSliderWrap.className = 'prop-slider-wrap';
        const srSlider = document.createElement('input');
        srSlider.type = 'range'; srSlider.className = 'prop-slider';
        srSlider.min = 0; srSlider.max = 2; srSlider.step = 0.01;
        srSlider.value = obj.colorSensitivity ?? 0.5;
        const srNum = document.createElement('input');
        srNum.type = 'number'; srNum.className = 'prop-number';
        srNum.min = 0; srNum.max = 2; srNum.step = 0.01;
        srNum.value = obj.colorSensitivity ?? 0.5;
        srSlider.addEventListener('input', () => {
            obj.colorSensitivity = parseFloat(srSlider.value);
            srNum.value = obj.colorSensitivity; save();
        });
        srNum.addEventListener('input', () => {
            obj.colorSensitivity = parseFloat(srNum.value);
            srSlider.value = obj.colorSensitivity; save();
        });
        srSliderWrap.appendChild(srSlider); srSliderWrap.appendChild(srNum);
        srWrap.appendChild(srLbl); srWrap.appendChild(srSliderWrap);
        sensitivityRow.appendChild(srWrap);

        const crRow = row('Color Reactive');
        const crInp = document.createElement('input');
        crInp.type = 'checkbox'; crInp.className = 'prop-checkbox';
        crInp.checked = obj.colorReactive;
        crInp.addEventListener('change', () => {
            obj.colorReactive = crInp.checked;
            sensitivityRow.style.display = obj.colorReactive ? '' : 'none';
            save();
        });
        crRow.appendChild(crInp);
        (currentSection || panel).appendChild(sensitivityRow);

        roughnessRowRef = bindingPanel('Roughness', obj.roughness, { min: 0, max: 1 });
        roughnessRowRef.style.display = isStandard() ? '' : 'none';

        metalnessRowRef = bindingPanel('Metalness', obj.metalness, { min: 0, max: 1 });
        metalnessRowRef.style.display = isStandard() ? '' : 'none';

        smoothRowRef = row('Smooth Shading');
        const smoothInp = document.createElement('input');
        smoothInp.type = 'checkbox'; smoothInp.className = 'prop-checkbox';
        smoothInp.checked = obj.smoothShading ?? true;
        smoothInp.addEventListener('change', () => { obj.smoothShading = smoothInp.checked; save(); });
        smoothRowRef.appendChild(smoothInp);
        smoothRowRef.style.display = isNormal() ? 'none' : '';

        opacityRowRef = slider('Opacity', 0, 1, 0.01,
            () => obj.opacity ?? 1,
            v => { obj.opacity = v; }
        );
        opacityRowRef.style.display = isNormal() ? 'none' : '';

        section('Audio Scale');
        bindingPanel('Audio Scale', obj.audioScale);

        section('Spin');
        bindingPanel('Spin Speed', obj.spinSpeed);

        section('Noise');
        bindingPanel('Noise Scale', obj.noiseScale);
        bindingPanel('Noise Amount', obj.noiseAmount);
    }

    // ── PointLight-specific ─────────────────────
    if (obj.type === 'pointLight') {
        section('Light');
        colorInput('Color', () => obj.color, v => { obj.color = v; });

        section('Intensity');
        bindingPanel('Intensity', obj.intensity);

        section('Distance');
        bindingPanel('Distance', obj.distance);
    }

    // ── Wave-specific ───────────────────────────
    if (obj.type === 'wave') {
        section('Wave');

        selectInput('Type',
            ['circular','linear','linear-up','bars','bars-both','line'],
            () => obj.waveType,
            v  => { obj.waveType = v; save(); renderObjectProperties(obj, layer); }
        );

        colorInput('Color', () => obj.color, v => { obj.color = v; });

        // Segments — integer, rebuilds geometry on change
        const segRow = row('Segments');
        const segNum = document.createElement('input');
        segNum.type = 'number'; segNum.className = 'prop-number';
        segNum.min = 2; segNum.max = 512; segNum.step = 1;
        segNum.value = obj.segments;
        segNum.addEventListener('change', () => {
            obj.segments = Math.max(2, parseInt(segNum.value) || 2);
            segNum.value = obj.segments;
            save();
        });
        segRow.appendChild(segNum);

        // Color reactive toggle + sensitivity (shown only when reactive)
        const sensitivityRow = document.createElement('div');
        sensitivityRow.style.display = obj.colorReactive ? '' : 'none';
        const srWrap = document.createElement('div');
        srWrap.className = 'prop-row';
        const srLbl = document.createElement('label');
        srLbl.className = 'prop-label';
        srLbl.textContent = 'Color Sensitivity';
        const srSliderWrap = document.createElement('div');
        srSliderWrap.className = 'prop-slider-wrap';
        const srSlider = document.createElement('input');
        srSlider.type = 'range'; srSlider.className = 'prop-slider';
        srSlider.min = 0; srSlider.max = 2; srSlider.step = 0.01;
        srSlider.value = obj.colorSensitivity ?? 0.5;
        const srNum = document.createElement('input');
        srNum.type = 'number'; srNum.className = 'prop-number';
        srNum.min = 0; srNum.max = 2; srNum.step = 0.01;
        srNum.value = obj.colorSensitivity ?? 0.5;
        srSlider.addEventListener('input', () => {
            obj.colorSensitivity = parseFloat(srSlider.value);
            srNum.value = obj.colorSensitivity; save();
        });
        srNum.addEventListener('input', () => {
            obj.colorSensitivity = parseFloat(srNum.value);
            srSlider.value = obj.colorSensitivity; save();
        });
        srSliderWrap.appendChild(srSlider); srSliderWrap.appendChild(srNum);
        srWrap.appendChild(srLbl); srWrap.appendChild(srSliderWrap);
        sensitivityRow.appendChild(srWrap);

        const crRow = row('Color Reactive');
        const crInp = document.createElement('input');
        crInp.type = 'checkbox'; crInp.className = 'prop-checkbox';
        crInp.checked = obj.colorReactive;
        crInp.addEventListener('change', () => {
            obj.colorReactive = crInp.checked;
            sensitivityRow.style.display = obj.colorReactive ? '' : 'none';
            save();
        });
        crRow.appendChild(crInp);
        (currentSection || panel).appendChild(sensitivityRow);

        slider('Opacity', 0, 1, 0.01,
            () => obj.opacity ?? 0.5,
            v => { obj.opacity = v; }
        );

        section('Amplitude');
        bindingPanel('Amplitude', obj.amplitude);

        slider('Samples', 1, 128, 1,
            () => obj.sampleCount ?? 128,
            v  => { obj.sampleCount = Math.round(v); }
        );

        section('Shape');
        bindingPanel('Width', obj.width, { min: 1, max: 50 });
        bindingPanel('Radius (circular)', obj.radius);
        if (obj.waveType === 'bars' || obj.waveType === 'bars-both') {
            bindingPanel('Bar Spacing', obj.barSpacing, { min: 0.001, max: 1, step: 0.001 });
        }
    }
}

// ─────────────────────────────────────────────
//  Duplicate object
// ─────────────────────────────────────────────
async function duplicateObject(obj, layer) {
    const data = { ...obj.toJSON(), id: crypto.randomUUID(), name: obj.name + ' copy' };
    if (obj.type === 'model') {
        const newObj = ModelObject.fromJSON(data);
        await builder.addModelToLayer(layer.id, newObj);
    } else if (obj.type === 'pointLight') {
        const newObj = PointLightObject.fromJSON(data);
        builder.addLightToLayer(layer.id, newObj);
    } else if (obj.type === 'wave') {
        const newObj = WaveObject.fromJSON(data);
        builder.addWaveToLayer(layer.id, newObj);
    }
    renderObjectList(layer);
    saveAllToDB();
}

// ─────────────────────────────────────────────
//  Add object handlers
// ─────────────────────────────────────────────
async function onAddModel(layer, model, modelDiplayName, Material) {
    const modelObj = new ModelObject();
    modelObj.audioScale.min      = 0.5;
    modelObj.audioScale.max      = 1.0;
    modelObj.name                = modelDiplayName;
    modelObj.modelName           = model;
    modelObj.materialType        = Material;
    await builder.addModelToLayer(layer.id, modelObj);
    renderObjectList(layer);
    saveAllToDB();
}

function onAddLight(layer) {
    const lightObj = new PointLightObject();
    lightObj.intensity.mode   = 'audio';
    lightObj.intensity.source = 'avgFrequency';
    lightObj.intensity.min    = 0;
    lightObj.intensity.max    = 10;

    builder.addLightToLayer(layer.id, lightObj);
    renderObjectList(layer);
    saveAllToDB();
}

function onAddWave(layer, data) {
    const waveObj      = new WaveObject();
    waveObj.name       = data['Name'] || 'Wave';
    waveObj.waveType   = data['Type'] || 'circular';
    waveObj.segments   = Math.max(2, parseInt(data['Segments']) || 64);
    waveObj.color      = /^#[0-9a-fA-F]{6}$/.test(data['Color']) ? data['Color'] : '#ffffff';
    waveObj.amplitude.mode  = 'audio';
    waveObj.amplitude.source = 'avgFrequency';
    waveObj.amplitude.min   = 0;
    waveObj.amplitude.max   = 1;
    builder.addWaveToLayer(layer.id, waveObj);
    renderObjectList(layer);
    saveAllToDB();
}

// ─────────────────────────────────────────────
//  Global controls
// ─────────────────────────────────────────────
document.getElementById('pause-btn').addEventListener('click', () => {
    isPlaying ? pauseAudio() : resumeAudio();
});

document.getElementById('hide-player').addEventListener('click', () => {
    const ui = document.getElementById('player');
    ui.style.display = ui.style.display === 'none' ? 'block' : 'none';
});
document.getElementById('hide-controlls').addEventListener('click', () => {
    const ui = document.getElementById('controlls');
    ui.style.display = ui.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('audio-volume').addEventListener('input', (e) => {
    Volume = parseFloat(e.target.value);
});

document.getElementById('add-layer').addEventListener('click', async () => {
    const name = prompt('Enter layer name:');
    if (!name) return;
    const layer = new Layer(name, false);
    builder.addLayer(layer);
    addLayerElement(layer);
    refreshCounters();
    await saveAllToDB();
});

document.getElementById('audio-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await saveAudioFile(file);

    const songName = await readID3Title({ file });
    const name = songName || file.name;
    const lI = document.createElement('div');
    const button = document.createElement('button');
    button.textContent = name;
    button.classList.add('list-button');
    button.dataset.trackName = name;
    button.onclick = () => loadAudioFromRecord({ file, name });
    lI.appendChild(button);
    document.getElementById('saved-tracks').appendChild(lI);

    loadAudioFromRecord({ file, name });
});
// ─────────────────────────────────────────────
//  PreviewArea
// ─────────────────────────────────────────────
let materialPreviews = generateMaterialPreviews();
let modelPreviews    = generateModelPreviews();
let ppPreviews;

function createPreviewArea(type, currentValue, onChange) {
    const grid = document.createElement('div');
    grid.className = 'preview-grid';

    const promise = type === 'material' ? materialPreviews
                  : type === 'model'    ? modelPreviews
                  : ppPreviews;
    Promise.resolve(promise).then(items => {
        items.forEach(({ name, url }) => {
            const item = document.createElement('div');
            item.className = 'preview-item';
            if (name === currentValue) item.classList.add('selected');
            item.title = name;

            const img = document.createElement(url ? 'img' : 'div');
            img.className = 'preview-img';
            if (url) img.src = url;
            item.appendChild(img);

            const label = document.createElement('div');
            label.className = 'preview-label';
            label.textContent = name;
            item.appendChild(label);

            item.addEventListener('click', () => {
                grid.querySelectorAll('.preview-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                onChange(name);
            });

            grid.appendChild(item);
        });
    });

    return grid;
}


// ─────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────
window.addEventListener('load', async () => {
    const allFiles = await loadAllAudioFiles();
    for (const f of allFiles) {
        const songName = await readID3Title(f);
        const trackName = songName || f.name;
        const lI = document.createElement('div');
        const button = document.createElement('button');
        button.textContent = trackName;
        button.classList.add('list-button');
        button.dataset.trackName = trackName;
        button.onclick = () => loadAudioFromRecord({ ...f, name: trackName });
        lI.appendChild(button);
        document.getElementById('saved-tracks').appendChild(lI);
    }

    // ── Post-processing setup (must precede deserializeAll) ──
    await initShaders();
    ppPreviews = generatePPPreviews();
    const globalPipeline = new PostProcessingPipeline(builder.renderer, window.innerWidth, window.innerHeight);
    builder.setPostPipeline(globalPipeline);
    ppContexts.set('global', { layers: [], pipeline: globalPipeline });

    const saved = await loadAllFromDB();
    if (saved?.length > 0) {
        await deserializeAll(saved);
    } else {
        builder.addLayer(new Layer('Background', true));
    }
    renderLayerList();
    switchPPContext('global');

    if (builder.layers.length > 0) selectLayer(builder.layers[0]);
    if (allFiles.length > 0) loadAudioFromRecord(allFiles[0]);

    // Tab switching
    document.getElementById('oe-btn').addEventListener('click',   () => switchTab('oe'));
    document.getElementById('pp-editor').addEventListener('click', () => switchTab('pp'));

});



// ─────────────────────────────────────────────
//  Animation loop
// ─────────────────────────────────────────────
function animate(time) {
    builder.updateAudioData(analyser, Volume);
    updateProgressBar();
    sound.setVolume(Volume);
    builder.update(time);
}

builder.renderer.setAnimationLoop(animate);