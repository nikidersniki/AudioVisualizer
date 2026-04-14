import {
    AudioListener, Audio, AudioAnalyser,
} from './modules/three.js/build/three.module.js';

import { SceneBuilder, PRESETS}    from './SceneBuilder.js';
import { Layer, ModelObject, PointLightObject, WaveObject, PropertyBinding} from './Sceneobjects.js';

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
let pauseTime    = 0;
let isPlaying    = false;
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

async function saveLayersToDB() {
    const db = await openDB();
    const tx = db.transaction(LAYERS_STORE, 'readwrite');
    tx.objectStore(LAYERS_STORE).put({ id: 'current', layers: builder.toJSON() });
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}

async function loadLayersFromDB() {
    const db = await openDB();
    const tx = db.transaction(LAYERS_STORE, 'readonly');
    return new Promise((res, rej) => {
        const req = tx.objectStore(LAYERS_STORE).get('current');
        req.onsuccess = () => res(req.result?.layers ?? null);
        req.onerror   = () => rej(req.error);
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

function loadAudioFromRecord(record) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        audioContext = listener.context;
        const decoded = await audioContext.decodeAudioData(e.target.result);
        document.getElementById('track-name').textContent = record.name;
        applyAudioBuffer(decoded);
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
            if (type == "select"){
                input = document.createElement("select");
                element[2].forEach(element => {
                    const z = document.createElement('option');
                    const t = document.createTextNode(element);
                    z.value = element;
                    z.appendChild(t);
                    input.appendChild(z);
                });
                input.id = "popup-input-" + index;            }
            else if (type === "color") {
                input = document.createElement("input");
                input.type = "color";
                input.value = "#ffffff"; // default white
            }
            else{
                input.type = type;
            }

            const nameField = document.createElement('div');
            nameField.classList.add("h2");
            nameField.textContent = text;

            const box = document.createElement('div');
            box.appendChild(nameField);
            box.appendChild(input);

            inputBox.appendChild(box);

            inputs.push({ input, type, required, label: text });
        });

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
//  Layer UI
// ─────────────────────────────────────────────
let selectedObject = null;

function refreshCounters() {
    Array.from(document.getElementsByClassName('layer-item'))
        .forEach((el, i) => el.querySelector('.layer-count').textContent = i + 1);
}

function renderLayerList() {
    const container = document.getElementById('layer-list');
    container.innerHTML = '';
    for (const layer of builder.layers) {
        addLayerElement(layer);
    }
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
                saveLayersToDB();
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
                saveLayersToDB();
            }
        });

        const removeBtn = mkBtn('remove-layer');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            builder.removeLayer(layer.id);
            renderLayerList();
            saveLayersToDB();
        });

        buttonBox.appendChild(removeBtn);
        buttonBox.appendChild(upBtn);
        buttonBox.appendChild(downBtn);
    }

    el.addEventListener('click', () => selectLayer(layer));
    document.getElementById('layer-list').appendChild(el);
}

function selectLayer(layer) {
    selectedObject = null;

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
            const availableModels = [];
            PRESETS.MODEL_CATALOGUE.forEach(element => {
                availableModels.push(element['name']);
            });
            spawnPopup('Add Model to Scene', [
                ['Model', 'select', availableModels],
                ['Name', 'text'],
                ['Material', 'select', ["normal", "wireframe", "standard"]],
                ['Scale Mode', 'select', ["avgFrequency","lowFreq","midFreq","highFreq"]],
                ['Scale Source', 'select', ["constant","audio"]],
            ])
            .then(data => {
                const {
                    Model, Name, Material,
                    "Scale Mode": scaleMode,
                    "Scale Source": scaleSource,
                } = data;
                onAddModel(layer, Model, Name, scaleMode, scaleSource, Material);
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
            saveLayersToDB();
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

    const save = () => saveLayersToDB();

    let currentSection = null; // content div of the active section

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

        return container;
    }

    // ── Common: Name + Visible ──────────────────
    section('General');
    textInput('Name', () => obj.name, v => { obj.name = v; renderObjectList(layer); });
    checkbox('Visible', () => obj.visible, v => { obj.visible = v; });

    // ── Transform bindings ──────────────────────
    section('Position');
    bindingPanel('Position X', obj.posX);
    bindingPanel('Position Y', obj.posY);
    bindingPanel('Position Z', obj.posZ);

    section('Rotation');
    bindingPanel('Rotation X', obj.rotX);
    bindingPanel('Rotation Y', obj.rotY);
    bindingPanel('Rotation Z', obj.rotZ);

    section('Scale');
    bindingPanel('Scale X', obj.scaleX);
    bindingPanel('Scale Y', obj.scaleY);
    bindingPanel('Scale Z', obj.scaleZ);

    // ── Model-specific ──────────────────────────
    if (obj.type === 'model') {
        section('Model');

        const availableModels = PRESETS.MODEL_CATALOGUE.map(m => m.name);
        selectInput('Model', availableModels, () => obj.modelName, v => { obj.modelName = v; });

        section('Material Properties');

        let opacityRowRef    = null; // forward refs set after their rows are created
        let roughnessRowRef  = null;
        let metalnessRowRef  = null;
        let smoothRowRef     = null;

        const isStandard = () => obj.materialType === 'standard';
        const isNormal   = () => obj.materialType === 'normal';

        selectInput('Material', ['normal','wireframe','standard'],
            () => obj.materialType,
            v => {
                obj.materialType = v;
                // _updateModel handles the actual material swap via _ownMaterialType check
                if (opacityRowRef)   opacityRowRef.style.display   = v === 'normal'   ? 'none' : '';
                if (roughnessRowRef) roughnessRowRef.style.display = v === 'standard' ? '' : 'none';
                if (metalnessRowRef) metalnessRowRef.style.display = v === 'standard' ? '' : 'none';
                if (smoothRowRef)    smoothRowRef.style.display    = v === 'normal'   ? 'none' : '';
            }
        );

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
            v  => { obj.waveType = v; save(); }
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
    saveLayersToDB();
}

// ─────────────────────────────────────────────
//  Add object handlers
// ─────────────────────────────────────────────
async function onAddModel(layer, model, modelDiplayName, scaleMode, scaleSource, Material) {
    const modelObj = new ModelObject();
    modelObj.audioScale.source   = scaleMode;
    modelObj.audioScale.mode     = scaleSource;
    modelObj.audioScale.min      = 0.5;
    modelObj.audioScale.max      = 1.0;
    modelObj.name                = modelDiplayName;
    modelObj.modelName           = model;
    modelObj.materialType        = Material;
    await builder.addModelToLayer(layer.id, modelObj);
    renderObjectList(layer);
    saveLayersToDB();
}

function onAddLight(layer) {
    const lightObj = new PointLightObject();
    lightObj.intensity.mode   = 'audio';
    lightObj.intensity.source = 'avgFrequency';
    lightObj.intensity.min    = 0;
    lightObj.intensity.max    = 10;

    builder.addLightToLayer(layer.id, lightObj);
    renderObjectList(layer);
    saveLayersToDB();
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
    saveLayersToDB();
}

// ─────────────────────────────────────────────
//  Global controls
// ─────────────────────────────────────────────
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
    await saveLayersToDB();
});

document.getElementById('audio-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await saveAudioFile(file);

    const songName = await readID3Title({ file });
    const lI = document.createElement('div');
    const button = document.createElement('button');
    button.textContent = songName || file.name;
    button.classList.add('list-button');
    button.onclick = () => loadAudioFromRecord({ file, name: songName || file.name });
    lI.appendChild(button);
    document.getElementById('saved-tracks').appendChild(lI);

    loadAudioFromRecord({ file, name: songName || file.name });
});

// ─────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────
window.addEventListener('load', async () => {
    const allFiles = await loadAllAudioFiles();
    for (const f of allFiles) {
        const songName = await readID3Title(f);
        const lI = document.createElement('div');
        const button = document.createElement('button');
        button.textContent = songName || f.name;
        button.classList.add('list-button');
        button.onclick = () => loadAudioFromRecord(f);
        lI.appendChild(button);
        document.getElementById('saved-tracks').appendChild(lI);
    }

    const savedLayers = await loadLayersFromDB();
    if (savedLayers && savedLayers.length > 0) {
        await builder.loadFromJSON(savedLayers);
    } else {
        builder.addLayer(new Layer('Background', true));
    }
    renderLayerList();

    if (builder.layers.length > 0) selectLayer(builder.layers[0]);
    if (allFiles.length > 0) loadAudioFromRecord(allFiles[0]);
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