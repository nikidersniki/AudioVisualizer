import {
    AudioListener, Audio, AudioAnalyser,
} from 'three';

import { SceneBuilder, PRESETS}    from './SceneBuilder.js';
import { Layer, ModelObject, PointLightObject, WaveObject, FillObject, PropertyBinding} from './Sceneobjects.js';
import { PP_SHADER_REGISTRY, PP_NATIVE_REGISTRY, PostProcessingLayer, PostProcessingPipeline, NativePassLayer, initShaders } from './PostProcessing.js';
import {generateMaterialPreviews, generateModelPreviews, generatePPPreviews} from './PreviewRenderer.js';
import { readID3Title } from './SoundNameReader.js';
import './mobile-ui.js';

// ─────────────────────────────────────────────
//  Global Range Input Decorator
//  Wraps every <input type="range"> in a rectangle with
//  fill % background and value printed inside.
// ─────────────────────────────────────────────
const _rangeValueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
function decorateRangeInput(input) {
    if (input._decorated) return;
    if (input.closest('.custom-slider')) { input._decorated = true; return; }
    input._decorated = true;

    const slider = document.createElement('div');
    slider.className = 'custom-slider';
    const fill = document.createElement('div');
    fill.className = 'custom-slider-fill';
    const valueEl = document.createElement('div');
    valueEl.className = 'custom-slider-value';

    // Preserve flex sizing from the original input
    if (input.classList.contains('prop-slider') || input.classList.contains('layer-opacity-slider')) {
        slider.style.flex = '1';
    }

    input.parentNode.insertBefore(slider, input);
    slider.appendChild(fill);
    slider.appendChild(valueEl);
    slider.appendChild(input);

    const update = () => {
        const min = parseFloat(input.min) || 0;
        const max = parseFloat(input.max);
        const maxV = isNaN(max) ? 100 : max;
        const v = parseFloat(input.value) || 0;
        const pct = ((v - min) / (maxV - min)) * 100;
        fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
        const step = parseFloat(input.step) || 1;
        const decimals = step >= 1 ? 0 : Math.min(3, (step.toString().split('.')[1]?.length ?? 2));
        valueEl.textContent = v.toFixed(decimals);
    };

    input.addEventListener('input', update);
    input.addEventListener('change', update);
    Object.defineProperty(input, 'value', {
        configurable: true,
        get() { return _rangeValueDesc.get.call(this); },
        set(v) { _rangeValueDesc.set.call(this, v); update(); },
    });
    update();

    slider.addEventListener('dblclick', e => {
        e.preventDefault();
        e.stopPropagation();
        if (slider.querySelector('.custom-slider-edit')) return;

        const editor = document.createElement('input');
        editor.type = 'number';
        editor.className = 'custom-slider-edit';
        editor.min  = input.min;
        editor.max  = input.max;
        editor.step = input.step;
        editor.value = input.value;
        slider.appendChild(editor);
        editor.focus();
        editor.select();

        const commit = () => {
            let v = parseFloat(editor.value);
            if (isNaN(v)) v = parseFloat(input.value);
            const min = parseFloat(input.min) || 0;
            const max = parseFloat(input.max);
            if (v < min)        input.min = v;
            if (!isNaN(max) && v > max) input.max = v;
            input.value = v;
            input.dispatchEvent(new Event('input',  { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            editor.remove();
        };
        editor.addEventListener('blur', commit);
        editor.addEventListener('keydown', ev => {
            if (ev.key === 'Enter')  { ev.preventDefault(); editor.blur(); }
            if (ev.key === 'Escape') { editor.value = input.value; editor.blur(); }
        });
    });
}

function decorateAllRangeInputs(root = document) {
    root.querySelectorAll?.('input[type="range"]').forEach(decorateRangeInput);
}

const _rangeObserver = new MutationObserver(muts => {
    for (const m of muts) {
        for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches?.('input[type="range"]')) decorateRangeInput(node);
            decorateAllRangeInputs(node);
        }
    }
});
_rangeObserver.observe(document.body, { childList: true, subtree: true });
decorateAllRangeInputs();

// ─────────────────────────────────────────────
//  Global hotkey gate
//  Swallow T/R/S/Space (and prevent browser scroll on Space) whenever a
//  modal popup is open or focus is in a form control. Capture-phase so it
//  beats any module-level keydown listener regardless of registration order.
// ─────────────────────────────────────────────
const _GATED_KEYS = new Set(['t', 'r', 's', ' ']);
window.addEventListener('keydown', e => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    if (!document.querySelector('.popup-bg')) return;
    if (_GATED_KEYS.has(e.key.toLowerCase())) {
        e.stopPropagation();
        e.preventDefault();
    }
}, { capture: true });

// ─────────────────────────────────────────────
//  Theme system
//  All colours derive from a small {bg, panel, accent, text} seed; the
//  rest (lifts, hovers, border alpha, scrollbar, grain) are computed so
//  themes stay coherent and adding a new one is trivial.
// ─────────────────────────────────────────────
function _hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function _rgbToHex(rgb) {
    return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}
function _rgba(rgb, a) { return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`; }
function _lerpHex(a, b, t) {
    const A = _hexToRgb(a), B = _hexToRgb(b);
    return _rgbToHex([A[0]+(B[0]-A[0])*t, A[1]+(B[1]-A[1])*t, A[2]+(B[2]-A[2])*t]);
}
function _isLight(hex) {
    const [r, g, b] = _hexToRgb(hex);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 140; // perceptual luminance
}

function deriveTheme({ bg, panel, accent, text }) {
    const liftTowards = _isLight(bg) ? '#000000' : '#ffffff';
    const accentRgb   = _hexToRgb(accent);
    const textRgb     = _hexToRgb(text);
    const panelRgb    = _hexToRgb(panel);
    return {
        '--bg':                bg,
        '--bg-panel':          panel,
        '--bg-lift':           _lerpHex(bg, liftTowards, 0.06),
        '--bg-hover':          _lerpHex(bg, liftTowards, 0.12),
        '--border':            _rgba(textRgb, 0.12),
        '--border-bright':     _rgba(textRgb, 0.35),
        '--accent':            accent,
        '--accent-dim':        _rgba(accentRgb, 0.15),
        '--accent-glow':       _rgba(accentRgb, 0.06),
        '--text':              _rgba(textRgb, 0.88),
        '--text-dim':          _rgba(textRgb, 0.53),
        '--text-faint':        _rgba(textRgb, 0.76),
        '--scroll-thumb':      _rgba(accentRgb, 0.35),
        '--scroll-thumb-hover':_rgba(accentRgb, 0.55),
        '--grain':             _rgba(_isLight(bg) ? [0,0,0] : [255,255,255], 0.012),
        '--pannel-bg':         _rgba(panelRgb, 0.61),
    };
}

const THEME_SEEDS = {
    'Terminal Noir': { bg: '#080808', panel: '#0d0d0d', accent: '#c8f035', text: '#ffffff' },
    'Pure Dark':     { bg: '#000000', panel: '#080808', accent: '#ffffff', text: '#ffffff' },
    'Light':         { bg: '#f5f5f3', panel: '#ffffff', accent: '#2c5cff', text: '#000000' },
    'Synthwave':     { bg: '#150024', panel: '#1d0033', accent: '#ff2bd6', text: '#ffdcff' },
    'Forest':        { bg: '#0d1410', panel: '#121b16', accent: '#b8d97d', text: '#e8f0dc' },
    'Solar Flare':   { bg: '#1a0a05', panel: '#22100a', accent: '#ff7a30', text: '#ffe6d2' },
};
const THEME_NAMES  = Object.keys(THEME_SEEDS);
const DEFAULT_THEME = 'Terminal Noir';
const THEME_KEY        = 'theme-name';
const THEME_CUSTOM_KEY = 'theme-custom-seed';
const THEME_ICON_PREFIX = 'theme-icon:'; // per-theme override; absent = auto-derive

function applyThemeVars(vars) {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}
function _activeThemeName() {
    return localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
}
// Returns 1 if icons should render dark (black on a light theme), 0 for light
// (white on dark themes). Per-theme override via THEME_ICON_PREFIX; absent
// falls back to auto-derive from the theme's background luminance.
function _resolveIconInvert(seed, themeName = _activeThemeName()) {
    const mode = localStorage.getItem(THEME_ICON_PREFIX + themeName);
    if (mode === 'dark')  return 1;
    if (mode === 'light') return 0;
    return _isLight(seed.bg) ? 1 : 0;
}
function applyIconMode(seed) {
    const dark = _resolveIconInvert(seed) === 1;
    document.documentElement.style.setProperty('--icon-color', dark ? '#000000' : '#ffffff');
}
function _applyColorScheme(seed) {
    document.documentElement.style.colorScheme = _isLight(seed.bg) ? 'light' : 'dark';
}
function applyThemeByName(name) {
    const seed = THEME_SEEDS[name] || THEME_SEEDS[DEFAULT_THEME];
    // Write THEME_KEY first — applyIconMode resolves the per-theme icon
    // override by reading the active theme name from localStorage.
    localStorage.setItem(THEME_KEY, name);
    applyThemeVars(deriveTheme(seed));
    applyIconMode(seed);
    _applyColorScheme(seed);
}
function applyCustomTheme(seed) {
    localStorage.setItem(THEME_KEY, '__custom__');
    localStorage.setItem(THEME_CUSTOM_KEY, JSON.stringify(seed));
    applyThemeVars(deriveTheme(seed));
    applyIconMode(seed);
    _applyColorScheme(seed);
}
function _restoreTheme() {
    const name = localStorage.getItem(THEME_KEY);
    if (name === '__custom__') {
        try {
            const seed = JSON.parse(localStorage.getItem(THEME_CUSTOM_KEY));
            if (seed) {
                applyThemeVars(deriveTheme(seed));
                applyIconMode(seed);
                _applyColorScheme(seed);
                return;
            }
        } catch {}
    }
    const seed = (name && THEME_SEEDS[name]) ? THEME_SEEDS[name] : THEME_SEEDS[DEFAULT_THEME];
    applyThemeVars(deriveTheme(seed));
    applyIconMode(seed);
    _applyColorScheme(seed);
}
_restoreTheme();

function _getActiveSeed() {
    const name = localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
    if (name === '__custom__') return _getCurrentCustomSeed();
    return THEME_SEEDS[name] || THEME_SEEDS[DEFAULT_THEME];
}

function _getCurrentCustomSeed() {
    try {
        const stored = JSON.parse(localStorage.getItem(THEME_CUSTOM_KEY));
        if (stored && stored.bg) return stored;
    } catch {}
    return { ...THEME_SEEDS[DEFAULT_THEME] };
}

// Inline theme picker — mounts into a given container (no popup wrapping).
function mountThemePicker(container) {
    if (!container) return;
    container.innerHTML = '';

    const currentName = localStorage.getItem(THEME_KEY) || DEFAULT_THEME;

    const grid = document.createElement('div');
    grid.className = 'theme-grid';
    container.appendChild(grid);

    let iconCheckbox = null;
    let customCard   = null;

    const renderCard = (name, seed, isCustom = false) => {
        const card = document.createElement('div');
        card.className = 'theme-card';
        if ((isCustom && currentName === '__custom__') ||
            (!isCustom && currentName === name)) card.classList.add('selected');

        const swatches = document.createElement('div');
        swatches.className = 'theme-swatches';
        ['bg', 'panel', 'accent', 'text'].forEach(k => {
            const s = document.createElement('div');
            s.className = 'theme-swatch';
            s.style.background = seed[k];
            swatches.appendChild(s);
        });

        const label = document.createElement('div');
        label.className = 'theme-card-label';
        label.textContent = name;

        card.appendChild(swatches);
        card.appendChild(label);
        card.addEventListener('click', () => {
            if (isCustom) applyCustomTheme(seed);
            else          applyThemeByName(name);
            grid.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            if (iconCheckbox) iconCheckbox.checked = _resolveIconInvert(_getActiveSeed()) === 1;
        });
        return card;
    };

    THEME_NAMES.forEach(n => grid.appendChild(renderCard(n, THEME_SEEDS[n])));
    const customSeed = _getCurrentCustomSeed();
    customCard = renderCard('Custom', customSeed, true);
    grid.appendChild(customCard);

    // Icon mode toggle
    const optsSection = document.createElement('div');
    optsSection.className = 'theme-custom-editor';
    const optsTitle = document.createElement('div');
    optsTitle.className = 'theme-custom-title';
    optsTitle.textContent = 'Options';
    optsSection.appendChild(optsTitle);

    const iconRow = document.createElement('label');
    iconRow.className = 'theme-custom-row theme-checkbox-row';
    const iconText = document.createElement('span');
    iconText.textContent = 'Dark icons';
    iconCheckbox = document.createElement('input');
    iconCheckbox.type = 'checkbox';
    iconCheckbox.checked = _resolveIconInvert(_getActiveSeed()) === 1;
    iconCheckbox.addEventListener('change', () => {
        localStorage.setItem(
            THEME_ICON_PREFIX + _activeThemeName(),
            iconCheckbox.checked ? 'dark' : 'light',
        );
        applyIconMode(_getActiveSeed());
    });
    iconRow.appendChild(iconText);
    iconRow.appendChild(iconCheckbox);
    optsSection.appendChild(iconRow);
    container.appendChild(optsSection);

    // Custom editor
    const editor = document.createElement('div');
    editor.className = 'theme-custom-editor';
    const editorTitle = document.createElement('div');
    editorTitle.className = 'theme-custom-title';
    editorTitle.textContent = 'Customize';
    editor.appendChild(editorTitle);

    const fields = [
        ['Background',       'bg'],
        ['Panel Background', 'panel'],
        ['Accent',           'accent'],
        ['Text',             'text'],
    ];
    const seedDraft = { ...customSeed };
    fields.forEach(([label, key]) => {
        const row = document.createElement('label');
        row.className = 'theme-custom-row';
        const text = document.createElement('span');
        text.textContent = label;
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.value = seedDraft[key];
        picker.addEventListener('input', () => {
            seedDraft[key] = picker.value;
            applyCustomTheme(seedDraft);
            if (!localStorage.getItem(THEME_ICON_PREFIX + '__custom__')) {
                iconCheckbox.checked = _isLight(seedDraft.bg);
            }
            const swatches = customCard.querySelectorAll('.theme-swatch');
            swatches[fields.findIndex(f => f[1] === key)].style.background = picker.value;
            grid.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
            customCard.classList.add('selected');
        });
        row.appendChild(text);
        row.appendChild(picker);
        editor.appendChild(row);
    });
    container.appendChild(editor);

    // Reset row
    const resetRow = document.createElement('div');
    resetRow.className = 'theme-reset-row';
    const resetBtn = document.createElement('div');
    resetBtn.className = 'theme-reset-link';
    resetBtn.textContent = 'Reset to Default';
    resetBtn.addEventListener('click', () => {
        applyThemeByName(DEFAULT_THEME);
        mountThemePicker(container); // re-render to reflect new selection
    });
    resetRow.appendChild(resetBtn);
    container.appendChild(resetRow);
}

// Mount inline picker into the Settings panel and wire its collapse header
const _themeSectionBody   = document.getElementById('theme-section-body');
const _themeSectionHeader = document.getElementById('theme-section-header');
if (_themeSectionBody) mountThemePicker(_themeSectionBody);
if (_themeSectionHeader && _themeSectionBody) {
    _themeSectionHeader.addEventListener('click', () => {
        const open = _themeSectionBody.style.display !== 'none';
        _themeSectionBody.style.display = open ? 'none' : '';
        const arrow = _themeSectionHeader.querySelector('.prop-section-arrow');
        if (arrow) arrow.style.transform = open ? 'rotate(-90deg)' : '';
    });
}

// ─────────────────────────────────────────────
//  Scene
// ─────────────────────────────────────────────
const canvas  = document.getElementById('three-canvas');
const builder = new SceneBuilder(canvas);
// Expose for gl-ui.js (separate module) to toggle the gizmo overlay
window.__SCENE_BUILDER__ = builder;

// ─────────────────────────────────────────────
//  Audio
// ─────────────────────────────────────────────
const listener = new AudioListener();
builder.camera.add(listener);
const sound    = new Audio(listener);
const analyser = new AudioAnalyser(sound, 1024);

let audioBuffer = null;
let syncedVideoObjId = null;
let audioContext = null;
let audioSource  = null;
let startTime    = 0;
let pauseTime    = 0;
let isPlaying    = false;
let isDragging   = false;
const VOLUME_KEY = 'audio-volume-pref';
let Volume = (() => {
    try {
        const v = parseFloat(localStorage.getItem(VOLUME_KEY));
        if (!isNaN(v) && v >= 0 && v <= 3) return v;
    } catch {}
    return 1;
})();
listener.setMasterVolume(Volume);
let allTracks    = [];   // { id, file, name, ... } in display order
let currentTrackId = null;
const customCatalogues = { hdri: [], bg: [], video: [], model: [] }; // hdri/bg/video: { name, dataURL }; model: { name, dataURL, format, scale } — persisted in global layer
let animatedProperties = []; // [{ objectId, key, label }] — persisted in global layer
let animTab = 'obj'; // 'obj' | 'pp'
const _animBtnRefreshers = []; // refresh fns for currently rendered property-panel animate buttons
const _ppAnimBtnRefreshers = []; // refresh fns for PP property-panel animate buttons
const _audioInlineMeterUpdaters = []; // fns(audioData) for mini-meters next to Source dropdowns

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
    const id = Date.now() + '_' + file.name;
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id, file, name: file.name, type: file.type, isPlaying: false });
    return new Promise((res, rej) => { tx.oncomplete = () => res(id); tx.onerror = rej; });
}

async function setPlayingTrackById(id) {
    if (!id) return;
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((res, rej) => {
        const req = store.getAll();
        req.onsuccess = () => {
            for (const rec of req.result) { rec.isPlaying = rec.id === id; store.put(rec); }
        };
        tx.oncomplete = res; tx.onerror = rej;
    });
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
        { id: 'global', name: 'Global', isGlobal: true, objects: [], ppLayers: globalPPLayers,
          bgColor: builder._bgColor, hdri: builder.selectedHDRI,
          syncedVideoObjId,
          glLayout: window.__GL_LAYOUT_JSON__ ?? null,
          customCatalogues, animatedProperties },
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

    // Reset selection / property panel — old object refs are about to be invalidated
    selectedObject = null;
    const propPanel = document.getElementById('object-properties');
    if (propPanel) propPanel.innerHTML = '';

    // Restore custom catalogues BEFORE loadFromJSON so FillObjects can resolve
    // their image references and HDRI lookups work on first frame
    if (globalEntry?.customCatalogues) {
        const saved = globalEntry.customCatalogues;
        customCatalogues.hdri  = [];
        customCatalogues.bg    = [];
        customCatalogues.video = [];
        customCatalogues.model = [];
        for (const e of (saved.hdri  ?? [])) _registerCustomHDRI(e.name,  e.dataURL);
        for (const e of (saved.bg    ?? [])) _registerCustomBG(e.name,    e.dataURL);
        for (const e of (saved.video ?? [])) _registerCustomVideo(e.name, e.dataURL);
        for (const e of (saved.model ?? [])) _registerCustomModel(e.name, e.dataURL, e.format, e.scale);
    }

    await builder.loadFromJSON(sceneLayers);

    // Restore animated property list
    animatedProperties = Array.isArray(globalEntry?.animatedProperties)
        ? [...globalEntry.animatedProperties] : [];

    // Restore scene settings
    if (globalEntry?.bgColor) {
        builder.setClearColor(globalEntry.bgColor);
        const el = document.getElementById('scene-clear-color');
        if (el) el.value = globalEntry.bgColor;
    }
    if (globalEntry?.hdri) {
        builder.setHDRI(globalEntry.hdri);
        const el = document.getElementById('scene-hdri');
        if (el) el.value = globalEntry.hdri;
    }
    // Volume is a global user preference now (localStorage), no longer per-project
    syncedVideoObjId = globalEntry?.syncedVideoObjId ?? null;

    if (globalEntry?.glLayout && typeof window.applyGLLayout === 'function') {
        window.applyGLLayout(globalEntry.glLayout);
    }

    // Restore global PP (always reset, even if loaded project has none)
    const globalCtx = ppContexts.get('global');
    if (globalCtx) {
        globalCtx.layers = (globalEntry?.ppLayers ?? []).map(_deserializePPLayer);
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

// ── Custom catalogue registration helpers ──────────────────────
function _registerCustomHDRI(name, dataURL) {
    if (PRESETS.HDRI_CATALOGUE.find(e => e.name === name)) return;
    PRESETS.HDRI_CATALOGUE.push({ name, path: dataURL });
    customCatalogues.hdri.push({ name, dataURL });
    const sel = document.getElementById('scene-hdri');
    if (sel && !sel.querySelector(`option[value="${CSS.escape(name)}"]`)) {
        const opt = document.createElement('option');
        opt.value = opt.textContent = name;
        sel.appendChild(opt);
    }
}

function _registerCustomBG(name, dataURL) {
    if (PRESETS.BG_CATALOGUE.find(e => e.name === name)) return;
    PRESETS.BG_CATALOGUE.push({ name, path: dataURL });
    customCatalogues.bg.push({ name, dataURL });
}

function _registerCustomVideo(name, dataURL) {
    if (!PRESETS.VIDEO_CATALOGUE) PRESETS.VIDEO_CATALOGUE = [];
    if (PRESETS.VIDEO_CATALOGUE.find(e => e.name === name)) return;
    PRESETS.VIDEO_CATALOGUE.push({ name, path: dataURL });
    customCatalogues.video.push({ name, dataURL });
}

function _registerCustomModel(name, dataURL, format, scale) {
    if (PRESETS.MODEL_CATALOGUE.find(e => e.name === name)) return;
    const fmt = (format ?? 'fbx').toLowerCase();
    const sc  = Array.isArray(scale) && scale.length === 3 ? scale : [0.01, 0.01, 0.01];
    PRESETS.MODEL_CATALOGUE.push({ name, path: dataURL, scale: sc, format: fmt, isCustom: true });
    customCatalogues.model.push({ name, dataURL, format: fmt, scale: sc });
}

function fileToDataURL(file) {
    return new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload  = e => res(e.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
    });
}

// ── Animation registry ─────────────────────────────────────────
function findObjectById(id) {
    for (const layer of builder.layers) {
        const obj = layer.objects?.find(o => o.id === id);
        if (obj) return { obj, layer };
    }
    return null;
}

function findPPLayerById(id) {
    for (const [contextId, ctx] of ppContexts) {
        const ppLayer = ctx.layers?.find(l => l.id === id);
        if (ppLayer) return { ppLayer, contextId };
    }
    return null;
}

function isPropertyAnimated(objectId, key) {
    return animatedProperties.some(e => e.objectId === objectId && e.key === key);
}

function toggleAnimatedProperty(objectId, key, label, range = { min: -10, max: 10 }, opts = {}) {
    const idx = animatedProperties.findIndex(e => e.objectId === objectId && e.key === key);
    if (idx >= 0) {
        animatedProperties.splice(idx, 1);
        if (opts.isPP) {
            const found = findPPLayerById(objectId);
            if (found?.ppLayer) {
                delete found.ppLayer.propertyBindings[key];
                found.ppLayer.invalidateMaterial?.();
            }
        } else {
            const found = findObjectById(objectId);
            if (found && found.obj[key]) found.obj[key].mode = 'constant';
        }
    } else {
        const entry = { objectId, key, label, range };
        if (opts.isPP) {
            entry.isPP = true;
            entry.ppContextId = opts.ppContextId ?? null;
            const found = findPPLayerById(objectId);
            if (found?.ppLayer) {
                const cur = found.ppLayer.propertyBindings[key];
                if (cur) {
                    cur.mode = 'audio';
                } else {
                    const b = new PropertyBinding(found.ppLayer.properties[key] ?? 0);
                    b.mode   = 'audio';
                    b.source = 'beat';
                    b.min    = range.min;
                    b.max    = range.max;
                    found.ppLayer.propertyBindings[key] = b;
                }
            }
        } else {
            const found = findObjectById(objectId);
            if (found && found.obj[key]) found.obj[key].mode = 'audio';
        }
        animatedProperties.push(entry);
    }
    saveAllToDB();
    renderAnimationList();
    for (const fn of _animBtnRefreshers)   fn();
    for (const fn of _ppAnimBtnRefreshers) fn();
}

function _animPropRow(labelText, control) {
    const row = document.createElement('div');
    row.className = 'prop-row';
    const lbl = document.createElement('label');
    lbl.className = 'prop-label';
    lbl.textContent = labelText;
    row.appendChild(lbl);
    row.appendChild(control);
    return row;
}

function _animSliderControl(value, range, step, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'prop-slider-wrap';
    const slider = document.createElement('input');
    slider.type = 'range'; slider.className = 'prop-slider';
    slider.min = range.min; slider.max = range.max; slider.step = step;
    slider.value = value;
    const num = document.createElement('input');
    num.type = 'number'; num.className = 'prop-number';
    num.step = step; num.value = value;
    slider.addEventListener('input', () => { num.value = slider.value; onChange(parseFloat(slider.value)); });
    num.addEventListener('input',    () => { slider.value = num.value; onChange(parseFloat(num.value)); });
    wrap.appendChild(slider); wrap.appendChild(num);
    return wrap;
}

function _animSourceControl(binding, onChange) {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.flex = '1';
    wrap.style.gap = '4px';
    const setTitle = () => { wrap.title = AUDIO_SOURCE_DESC[binding.source] || binding.source; };
    const sel = _animSelectControl(AUDIO_SOURCES, binding.source, v => {
        binding.source = v;
        setTitle();
        onChange();
    });
    setTitle();
    const meter = document.createElement('div');
    meter.className = 'audio-mini-meter';
    const fill = document.createElement('span');
    meter.appendChild(fill);
    wrap.appendChild(sel);
    wrap.appendChild(meter);
    _audioInlineMeterUpdaters.push((ad) => {
        const raw = ad[binding.source] ?? 0;
        const norm = binding.source === 'bpm' ? raw / 240 : raw / 255;
        fill.style.width = (Math.min(1, Math.max(0, norm)) * 100) + '%';
    });
    return wrap;
}

function _animSelectControl(options, value, onChange) {
    const sel = document.createElement('select');
    sel.className = 'prop-select';
    options.forEach(o => {
        const opt = document.createElement('option');
        opt.value = opt.textContent = o;
        sel.appendChild(opt);
    });
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
}

function _setupAnimTabs() {
    const objBtn = document.getElementById('anim-tab-obj');
    const ppBtn  = document.getElementById('anim-tab-pp');
    if (!objBtn || !ppBtn) return;
    const setTab = (t) => {
        animTab = t;
        objBtn.classList.toggle('selected', t === 'obj');
        ppBtn.classList.toggle('selected',  t === 'pp');
        renderAnimationList();
    };
    objBtn.addEventListener('click', () => setTab('obj'));
    ppBtn.addEventListener('click',  () => setTab('pp'));
}

function renderAnimationList() {
    const list = document.getElementById('anim-list');
    list.innerHTML = '';
    _audioInlineMeterUpdaters.length = 0;

    animatedProperties = animatedProperties.filter(e =>
        e.isPP ? findPPLayerById(e.objectId) : findObjectById(e.objectId));

    const visible = animatedProperties.filter(e => animTab === 'pp' ? e.isPP : !e.isPP);

    if (visible.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'anim-empty';
        empty.textContent = animTab === 'pp'
            ? 'No animated post-processing properties yet — click the ● next to any PP slider.'
            : 'No animated object properties yet — click the ● next to any property.';
        list.appendChild(empty);
        return;
    }

    const byObject = new Map();
    for (const entry of visible) {
        if (!byObject.has(entry.objectId)) byObject.set(entry.objectId, []);
        byObject.get(entry.objectId).push(entry);
    }

    for (const [objectId, entries] of byObject) {
        const firstEntry = entries[0];
        const isPP = !!firstEntry.isPP;
        let displayName, getBinding;
        if (isPP) {
            const pp = findPPLayerById(objectId);
            if (!pp) continue;
            displayName = `PP: ${pp.ppLayer.name}`;
            getBinding = (key) => pp.ppLayer.propertyBindings[key];
        } else {
            const found = findObjectById(objectId);
            if (!found) continue;
            const objName   = found.obj.name || found.obj.type;
            const layerName = found.layer?.name ?? '';
            displayName = layerName ? `${layerName}: ${objName}` : objName;
            getBinding = (key) => found.obj[key];
        }

        const groupWrap = document.createElement('div');
        groupWrap.className = 'anim-group';

        const header = document.createElement('div');
        header.className = 'anim-object';
        const arrow = document.createElement('span');
        arrow.className = 'anim-object-arrow';
        arrow.textContent = '▾';
        const title = document.createElement('span');
        title.textContent = displayName;
        header.appendChild(arrow);
        header.appendChild(title);
        groupWrap.appendChild(header);

        const body = document.createElement('div');
        body.className = 'anim-group-body';

        for (const entry of entries) {
            const binding = getBinding(entry.key);
            if (!binding) continue;
            const range = entry.range ?? { min: -10, max: 10 };

            const propWrap = document.createElement('div');
            propWrap.className = 'anim-property-block';

            const propHead = document.createElement('div');
            propHead.className = 'anim-property-head collapsed';
            const propName = document.createElement('span');
            propName.textContent = entry.label;
            const propArrow = document.createElement('span');
            propArrow.className = 'anim-property-arrow';
            propArrow.textContent = '▾';
            const rm = document.createElement('span');
            rm.className = 'anim-property-remove';
            rm.textContent = '✕';
            rm.title = 'Remove';
            rm.addEventListener('click', e => {
                e.stopPropagation();
                toggleAnimatedProperty(entry.objectId, entry.key, entry.label, range,
                    entry.isPP ? { isPP: true, ppContextId: entry.ppContextId } : {});
            });
            propHead.appendChild(propName);
            propHead.appendChild(propArrow);
            propHead.appendChild(rm);
            propWrap.appendChild(propHead);

            const propBody = document.createElement('div');
            propBody.className = 'anim-property-body';
            propBody.style.display = 'none';

            propBody.appendChild(_animPropRow('Source',
                _animSourceControl(binding, () => saveAllToDB())));
            propBody.appendChild(_animPropRow('Curve',
                _animSelectControl(CURVES, binding.curve, v => { binding.curve = v; saveAllToDB(); })));
            propBody.appendChild(_animPropRow('Min',
                _animSliderControl(binding.min, range, 0.001, v => { binding.min = v; saveAllToDB(); })));
            propBody.appendChild(_animPropRow('Max',
                _animSliderControl(binding.max, range, 0.001, v => { binding.max = v; saveAllToDB(); })));

            propHead.addEventListener('click', () => {
                const collapsed = propHead.classList.toggle('collapsed');
                propBody.style.display = collapsed ? 'none' : '';
            });

            propWrap.appendChild(propBody);
            body.appendChild(propWrap);
        }
        header.classList.add('collapsed');
        body.style.display = 'none';
        groupWrap.appendChild(body);

        header.addEventListener('click', () => {
            const collapsed = header.classList.toggle('collapsed');
            body.style.display = collapsed ? 'none' : '';
        });

        list.appendChild(groupWrap);
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


let currentProjectName = '';

// File menu dropdown toggle
(() => {
    const btn  = document.getElementById('file-menu-btn');
    const list = document.getElementById('file-menu-list');
    if (!btn || !list) return;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        list.classList.toggle('open');
    });
    document.addEventListener('click', () => list.classList.remove('open'));
})();

// About popup
(() => {
    const btn = document.getElementById('about-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const bg = document.createElement('div');
        bg.className = 'popup-bg';
        const popup = document.createElement('div');
        popup.className = 'popup';

        const title = document.createElement('div');
        title.className = 'h1 popup-title-text';
        title.textContent = 'Revisualize 3D';

        const body = document.createElement('div');
        body.className = 'popup-body';
        body.innerHTML = `
            <p>
                A browser-based real-time 3D audio visualizer.
                Build scenes from models, waves, lights, and images.
                Drive any numeric property from the live audio spectrum.
                Stack shader and native post-processing effects per-layer or globally.
            </p>
            <p class="muted">Built on Three.js with Golden Layout panels.</p>
            <p class="muted small">Version 0.1 · Open the <strong>Help</strong> button for full documentation.</p>
        `;

        const ok = document.createElement('div');
        ok.className = 'big-Btn';
        ok.textContent = 'Close';

        const buttonBox = document.createElement('div');
        buttonBox.className = 'popup-button-box';
        buttonBox.appendChild(ok);

        popup.appendChild(title);
        popup.appendChild(body);
        popup.appendChild(buttonBox);
        bg.appendChild(popup);

        const close = () => bg.remove();
        ok.addEventListener('click', close);
        bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
        document.body.appendChild(bg);
    });
})();

document.getElementById('file-save').addEventListener('click', ()=>{
    spawnPopup("Save Project", [['Name','text', false, currentProjectName]])
            .then(data => {
                const { Name } = data;
                currentProjectName = Name;
                downloadLayersToFile(Name);
            })
            .catch(() => {});

});

const newProjectBtn = document.getElementById('file-new');
if (newProjectBtn) {
    newProjectBtn.addEventListener('click', async () => {
        const choice = await spawnPopup("Save current project first?", [
            ['Save before clearing','select', ['Yes','No','Cancel']]
        ]).catch(() => null);
        if (!choice) return;
        const action = choice['Save before clearing'];
        if (action === 'Cancel') return;
        if (action === 'Yes') {
            const data = await spawnPopup("Save Project",
                [['Name','text', false, currentProjectName]]).catch(() => null);
            if (!data) return;
            currentProjectName = data.Name;
            downloadLayersToFile(data.Name);
        }
        const named = await spawnPopup("New Project", [['Name','text']]).catch(() => null);
        if (!named) return;
        currentProjectName = named.Name || '';
        await deserializeAll([
            { id: 'global', name: 'Global', isGlobal: true, objects: [],
              ppLayers: [], customCatalogues: { hdri: [], bg: [], video: [] },
              animatedProperties: [] }
        ]);
        const globalCtx = ppContexts.get('global');
        if (globalCtx) {
            globalCtx.layers = [];
            globalCtx.pipeline.layers = [];
        }
        for (const id of [...ppContexts.keys()]) {
            if (id !== 'global') ppContexts.delete(id);
        }
        builder.addLayer(new Layer('Background', true));
        renderLayerList();
        switchPPContext('global');
        if (builder.layers.length > 0) selectLayer(builder.layers[0]);
        renderAnimationList();
        saveAllToDB();
    });
}
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
                    renderAnimationList();
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
//  Presets / Start Screen
// ─────────────────────────────────────────────
const BUILTIN_PRESETS = ['Blobs', 'Colors', 'Pulsar', 'Rave', 'Wave'];
const THUMB_W = 320, THUMB_H = 180;
const THUMB_PREFIX = 'preset-thumb-v1:';

function _thumbKey(name, hash) { return `${THUMB_PREFIX}${name}:${hash}`; }
function _getCachedThumb(name, hash) {
    try { return localStorage.getItem(_thumbKey(name, hash)); } catch { return null; }
}
function _setCachedThumb(name, hash, dataURL) {
    try { localStorage.setItem(_thumbKey(name, hash), dataURL); } catch {}
}
async function _hashStr(str) {
    const buf = new TextEncoder().encode(str);
    const h = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(h)).slice(0, 8)
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

async function _renderBuilderToThumb() {
    // Drive one update so the freshly-deserialized scene renders to canvas
    builder.update(performance.now() / 1000);
    const src = builder.renderer.domElement;
    const srcW = src.width, srcH = src.height;
    if (!srcW || !srcH) return null;
    const dst = document.createElement('canvas');
    dst.width = THUMB_W; dst.height = THUMB_H;
    const ctx = dst.getContext('2d');
    const srcRatio = srcW / srcH, dstRatio = THUMB_W / THUMB_H;
    let sx = 0, sy = 0, sw = srcW, sh = srcH;
    if (srcRatio > dstRatio) { sw = srcH * dstRatio; sx = (srcW - sw) / 2; }
    else                     { sh = srcW / dstRatio; sy = (srcH - sh) / 2; }
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, THUMB_W, THUMB_H);
    return dst.toDataURL('image/webp', 0.7);
}

// Time-shares the main builder: pauses anim loop, snapshots current project,
// deserializes each preset, captures a thumbnail, restores the snapshot.
let _thumbGenInProgress = null;
async function generatePresetThumbnails(items) {
    if (_thumbGenInProgress) await _thumbGenInProgress;
    let release;
    _thumbGenInProgress = new Promise(r => release = r);
    try {
        builder.renderer.setAnimationLoop(null);
        const snapshot = serializeAll();
        for (const item of items) {
            try {
                await deserializeAll(item.json);
                // First update tick: kicks off lazy texture loads inside
                // _updateImage (BG image / video first-frame).
                builder.update(performance.now() / 1000);
                // Wait for HDRI, BG textures, video first-frame, etc. to all
                // finish before capturing.
                await builder.resourcesReady();
                await new Promise(r => requestAnimationFrame(r));
                const dataURL = await _renderBuilderToThumb();
                if (dataURL) _setCachedThumb(item.name, item.hash, dataURL);
                item.onReady(dataURL);
            } catch (e) {
                console.warn('Preset thumbnail failed', item.name, e);
                item.onReady(null);
            }
        }
        try {
            await deserializeAll(snapshot);
            builder.update(performance.now() / 1000);
            await builder.resourcesReady();
        } catch (e) { console.warn(e); }
    } finally {
        builder.renderer.setAnimationLoop(animate);
        release();
        _thumbGenInProgress = null;
    }
}

async function loadPresetByName(name) {
    const url = `${import.meta.env.BASE_URL}Presets/${encodeURIComponent(name)}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Preset "${name}" not found (${res.status})`);
    const data = await res.json();
    await deserializeAll(data);
    currentProjectName = name;
    renderLayerList();
    renderAnimationList();
    switchPPContext('global');
    if (builder.layers.length > 0) selectLayer(builder.layers[0]);
    await saveAllToDB();
}

async function _fetchPresetItem(name) {
    const url = `${import.meta.env.BASE_URL}Presets/${encodeURIComponent(name)}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const json = JSON.parse(text);
    const hash = await _hashStr(text);
    return { name, json, hash };
}

function _applyThumbToCard(els, dataURL) {
    els.thumb.style.backgroundImage = `url("${dataURL}")`;
    els.thumb.classList.add('loaded');
}

async function showPresetPicker({ canDismiss = true } = {}) {
    if (document.getElementById('start-screen-popup-bg')) return;

    const bg = document.createElement('div');
    bg.className = 'popup-bg';
    bg.id = 'start-screen-popup-bg';

    const popup = document.createElement('div');
    popup.className = 'popup start-screen-popup';

    const title = document.createElement('div');
    title.className = 'h1 popup-title-text';
    title.textContent = canDismiss ? 'Load Preset' : 'Welcome to Revisualize 3D';

    let intro = null;
    if (!canDismiss) {
        intro = document.createElement('div');
        intro.className = 'popup-body start-screen-intro';
        intro.innerHTML = `
            <p>
                A browser-based real-time 3D audio visualizer.
                Build scenes from <strong>models</strong>, <strong>waves</strong>,
                <strong>lights</strong>, and <strong>images</strong>.
                Drive any numeric property from the live audio spectrum.
                Stack shader and native <strong>post-processing</strong> effects
                per-layer or globally.
            </p>
            <p class="muted">
                Pick a preset below to explore — or
                <a class="start-screen-link" id="start-screen-empty-link">start with an empty scene</a>.
                You can also load your own <strong>.json</strong> project from the File menu.
            </p>
            <div class="start-screen-link-row">
                <a class="start-screen-link" href="docs/" target="_blank" rel="noopener">Documentation ↗</a>
                <span class="muted small">Built on Three.js · v0.1</span>
            </div>
            <div class="start-screen-section-header">Choose a Preset to Start</div>
        `;
    }

    const grid = document.createElement('div');
    grid.className = 'preset-grid';

    const cardEls = new Map();
    BUILTIN_PRESETS.forEach(name => {
        const card = document.createElement('div');
        card.className = 'preset-card pending';
        const thumb = document.createElement('div');
        thumb.className = 'preset-card-thumb';
        const label = document.createElement('div');
        label.className = 'preset-card-label';
        label.textContent = name;
        card.appendChild(thumb);
        card.appendChild(label);
        grid.appendChild(card);
        cardEls.set(name, { card, label, thumb });
    });

    popup.appendChild(title);
    if (intro) popup.appendChild(intro);
    popup.appendChild(grid);

    const buttonBox = document.createElement('div');
    buttonBox.className = 'popup-button-box';
    const dismissBtn = document.createElement('div');
    dismissBtn.className = 'big-Btn';
    dismissBtn.textContent = canDismiss ? 'Close' : 'Start Empty';
    dismissBtn.addEventListener('click', () => bg.remove());
    buttonBox.appendChild(dismissBtn);
    popup.appendChild(buttonBox);

    bg.appendChild(popup);
    if (canDismiss) {
        bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    }
    document.body.appendChild(bg);

    const emptyLink = intro?.querySelector('#start-screen-empty-link');
    emptyLink?.addEventListener('click', (e) => { e.preventDefault(); bg.remove(); });

    // Fetch all preset JSONs in parallel
    const fetched = await Promise.all(BUILTIN_PRESETS.map(async name => {
        try { return await _fetchPresetItem(name); }
        catch (e) {
            const els = cardEls.get(name);
            els.card.classList.remove('pending');
            els.card.classList.add('error');
            els.label.textContent = `${name} (unavailable)`;
            return null;
        }
    }));

    const toGenerate = [];
    for (const item of fetched) {
        if (!item) continue;
        const els = cardEls.get(item.name);
        els.card.classList.remove('pending');

        els.card.addEventListener('click', async () => {
            if (_thumbGenInProgress) return; // block during generation
            els.card.classList.add('loading');
            try {
                await deserializeAll(item.json);
                currentProjectName = item.name;
                renderLayerList();
                renderAnimationList();
                switchPPContext('global');
                if (builder.layers.length > 0) selectLayer(builder.layers[0]);
                await saveAllToDB();
                bg.remove();
            } catch (e) {
                console.error(e);
                els.card.classList.remove('loading');
            }
        });

        const cached = _getCachedThumb(item.name, item.hash);
        if (cached) {
            _applyThumbToCard(els, cached);
        } else {
            els.card.classList.add('rendering');
            toGenerate.push({
                name: item.name, json: item.json, hash: item.hash,
                onReady: (dataURL) => {
                    els.card.classList.remove('rendering');
                    if (dataURL) _applyThumbToCard(els, dataURL);
                },
            });
        }
    }

    if (toGenerate.length > 0) {
        grid.classList.add('grid-disabled');
        generatePresetThumbnails(toGenerate).finally(() => {
            grid.classList.remove('grid-disabled');
        });
    }
}

document.getElementById('file-load-preset')?.addEventListener('click', () => {
    showPresetPicker({ canDismiss: true });
});

// ─────────────────────────────────────────────
//  Audio playback
// ─────────────────────────────────────────────
function formatTime(s) {
    if (isNaN(s)) return '0:00';
    return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
}

async function loadVideoAudioAsTrack(fillObj) {
    const entry = (PRESETS.VIDEO_CATALOGUE || []).find(e => e.name === fillObj.videoName);
    if (!entry) throw new Error('Video source not found');
    const ctx = listener.context;
    const res = await fetch(entry.path);
    if (!res.ok) throw new Error('Failed to fetch video');
    const buf = await res.arrayBuffer();
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    if (!decoded || decoded.length === 0) throw new Error('Video has no audio');
    applyAudioBuffer(decoded);
}

function notifyVideoAudio(msg) {
    const bg = document.createElement('div');
    bg.className = 'popup-bg';
    const popup = document.createElement('div');
    popup.className = 'popup';
    const title = document.createElement('div');
    title.className = 'h1 popup-title-text';
    title.textContent = msg;
    const ok = document.createElement('div');
    ok.className = 'big-Btn';
    ok.textContent = 'OK';
    const buttonBox = document.createElement('div');
    buttonBox.classList.add('popup-button-box');
    buttonBox.appendChild(ok);
    popup.appendChild(title);
    popup.appendChild(buttonBox);
    bg.appendChild(popup);
    ok.addEventListener('click', () => bg.remove());
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    document.body.appendChild(bg);
}

function _syncVideoToAudio() {
    if (!syncedVideoObjId || !audioBuffer || !audioContext) return;
    let fillObj = null;
    for (const layer of builder.layers) {
        const o = layer.getObject(syncedVideoObjId);
        if (o) { fillObj = o; break; }
    }
    const v = fillObj?.threeObject?._video;
    if (!v) return;
    if (v.muted === false) v.muted = true; // audio plays via the track; keep video silent
    const target = isPlaying
        ? Math.max(0, audioContext.currentTime - startTime)
        : pauseTime;
    if (Math.abs(v.currentTime - target) > 0.15) {
        try { v.currentTime = Math.min(target, v.duration || target); } catch {}
    }
    if (isPlaying && v.paused) v.play().catch(() => {});
    else if (!isPlaying && !v.paused) v.pause();
}

function applyAudioBuffer(buffer) {
    if (sound.isPlaying) { sound.onEnded = null; sound.stop(); }
    audioBuffer = buffer;
    audioSource = null;
    sound.setBuffer(buffer);
    sound.setLoop(false);
    listener.setMasterVolume(Volume);
    sound.onEnded = playNext;
    durationDisplay.textContent = formatTime(buffer.duration);
    audioContext = listener.context;
    startTime = audioContext.currentTime;
    pauseTime = 0;
    isPlaying = true;
    sound.play();
    _generateWaveformPeaks(buffer);
    _drawWaveformPreview();
}

let _waveformPeaks = null;

function _generateWaveformPeaks(buffer, buckets = 400) {
    if (!buffer) { _waveformPeaks = null; return; }
    const ch = buffer.numberOfChannels;
    const len = buffer.length;
    const samplesPerBucket = Math.max(1, Math.floor(len / buckets));
    const peaks = new Float32Array(buckets);
    const channels = [];
    for (let c = 0; c < ch; c++) channels.push(buffer.getChannelData(c));
    for (let b = 0; b < buckets; b++) {
        const start = b * samplesPerBucket;
        const end   = Math.min(start + samplesPerBucket, len);
        let max = 0;
        for (let c = 0; c < ch; c++) {
            const data = channels[c];
            for (let i = start; i < end; i++) {
                const v = Math.abs(data[i]);
                if (v > max) max = v;
            }
        }
        peaks[b] = max;
    }
    let globalMax = 0;
    for (let i = 0; i < buckets; i++) if (peaks[i] > globalMax) globalMax = peaks[i];
    if (globalMax > 0) {
        const inv = 1 / globalMax;
        for (let i = 0; i < buckets; i++) peaks[i] *= inv;
    }
    _waveformPeaks = peaks;
}

function _drawWaveformPreview() {
    const cv = _freqPreviewCanvas;
    const ctx = _freqPreviewCtx;
    if (!cv || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = cv.clientWidth, cssH = cv.clientHeight;
    if (!cssW || !cssH) return;
    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    ctx.clearRect(0, 0, w, h);
    if (!_waveformPeaks) return;
    const peaks = _waveformPeaks;
    const N = peaks.length;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c8f035';

    const buildPath = () => {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i < N; i++) {
            const x = (i / (N - 1)) * w;
            const y = h - peaks[i] * h;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
    };

    // Match the progress-bar fill (which has a CSS transition)
    let progress = 0;
    const fillEl = document.getElementById('progress-fill');
    const barEl  = document.getElementById('progress-bar');
    if (fillEl && barEl) {
        const bw = barEl.getBoundingClientRect().width;
        const fw = fillEl.getBoundingClientRect().width;
        if (bw > 0) progress = Math.max(0, Math.min(1, fw / bw));
    } else if (audioBuffer && audioContext) {
        const cur = isPlaying
            ? Math.max(0, audioContext.currentTime - startTime)
            : pauseTime;
        progress = Math.max(0, Math.min(1, cur / audioBuffer.duration));
    }

    // Unplayed portion uses theme-aware muted text colour
    const rootStyle = getComputedStyle(document.documentElement);
    const muted = rootStyle.getPropertyValue('--text-dim').trim() || '#3a3a3a';
    ctx.fillStyle = muted;
    buildPath();
    ctx.fill();

    // Played portion in accent
    if (progress > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, w * progress, h);
        ctx.clip();
        ctx.fillStyle = accent;
        buildPath();
        ctx.fill();
        ctx.restore();
    }
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
    isPlaying = false; // set before stop so onEnded guard fires correctly
    if (audioSource) { audioSource.onended = null; try { audioSource.stop(); } catch (_) {} audioSource = null; }
    else { sound.onEnded = null; sound.stop(); }
    updatePauseBtn();
}

function resumeAudio() {
    if (isPlaying || !audioBuffer || !audioContext) return;
    playAudioFromTime(pauseTime);
    updatePauseBtn();
}

function loadAudioFromRecord(record) {
    _stopSystemCapture(); // file playback takes over
    currentTrackId = record.id ?? null;
    setPlayingTrackById(currentTrackId);
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

function playNext() {
    if (!isPlaying) return; // guard: stopped by user, not natural end
    isPlaying = false;
    updatePauseBtn();
    const idx = allTracks.findIndex(t => t.id === currentTrackId);
    if (idx === -1 || idx >= allTracks.length - 1) return;
    loadAudioFromRecord(allTracks[idx + 1]);
}

function playAudioFromTime(offsetTime) {
    sound.onEnded = null; sound.stop();
    isPlaying = false; // clear before stopping old source so its onended is a no-op
    if (audioSource) { audioSource.onended = null; try { audioSource.stop(); } catch(e) {} }
    audioContext = listener.context;
    audioSource = audioContext.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.loop = false;
    audioSource.connect(analyser.analyser);
    analyser.analyser.connect(listener.getInput());
    audioSource.onended = playNext;
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
                const previewType = required; // 'model', 'material', 'pp', 'bg', or 'video'
                const defaultVal  = previewType === 'model'
                    ? PRESETS.MODEL_CATALOGUE[0]?.name
                    : previewType === 'pp'
                    ? Object.values(PP_SHADER_REGISTRY)[0]?.name
                    : previewType === 'bg'
                    ? PRESETS.BG_CATALOGUE[0]?.name
                    : previewType === 'video'
                    ? (PRESETS.VIDEO_CATALOGUE || [])[0]?.name
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
                if (element[3] !== undefined) input.value = element[3];
            }

            const nameField = document.createElement('div');
            nameField.classList.add("h2");
            nameField.textContent = text;

            const box = document.createElement('div');
            if (extraElement) box.classList.add('preview-field');
            box.dataset.label = text;
            box.appendChild(nameField);
            box.appendChild(input);
            if (extraElement) box.appendChild(extraElement);

            inputBox.appendChild(box);

            inputs.push({ input, type, required: type === 'preview' ? false : required, label: text });
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
//  Drag and Drop Handler
// ─────────────────────────────────────────────
const dragDrop = document.getElementById('drag-drop');

async function handleDroppedFile(file) {
    if (file.type.startsWith('audio/')) {
        const trackId = await saveAudioFile(file);
        const songName = await readID3Title({ file });
        const name = songName || file.name;
        const record = { id: trackId, file, name, type: file.type, isPlaying: false };
        allTracks.push(record);
        const lI = document.createElement('div');
        const button = document.createElement('button');
        button.textContent = name;
        button.classList.add('list-button');
        button.dataset.trackName = name;
        button.onclick = () => loadAudioFromRecord(record);
        lI.appendChild(button);
        document.getElementById('saved-tracks').appendChild(lI);
        loadAudioFromRecord(record);
        return;
    }

    if (file.type.startsWith('image/')) {
        let result;
        try {
            result = await spawnPopup('Add Image', [
                ['Name', 'text', true],
                ['Type', 'select', ['HDRI', 'Background']],
            ]);
        } catch { return; }
        const { Name: name, Type: type } = result;
        const dataURL = await fileToDataURL(file);
        if (type === 'HDRI') {
            _registerCustomHDRI(name, dataURL);
            const hdriSelect = document.getElementById('scene-hdri');
            hdriSelect.value = name;
            builder.setHDRI(name);
        } else {
            _registerCustomBG(name, dataURL);
            if (selectedObject) {
                const layer = builder.layers.find(l => l.objects?.some(o => o.id === selectedObject.id));
                if (layer) renderObjectProperties(selectedObject, layer);
            }
        }
        saveAllToDB();
        return;
    }

    if (file.type.startsWith('video/')) {
        let result;
        try {
            result = await spawnPopup('Add Video', [
                ['Name', 'text', true],
            ]);
        } catch { return; }
        const { Name: name } = result;
        const dataURL = await fileToDataURL(file);
        _registerCustomVideo(name, dataURL);
        saveAllToDB();
        return;
    }

    // ── 3D model (.fbx / .obj) ────────────────────────────
    const lower = (file.name || '').toLowerCase();
    const isFBX = lower.endsWith('.fbx');
    const isOBJ = lower.endsWith('.obj');
    if (isFBX || isOBJ) {
        const defaultName = file.name.replace(/\.(fbx|obj)$/i, '');
        let result;
        try {
            result = await spawnPopup('Add Model', [
                ['Name',  'text',   true, defaultName],
                ['Scale', 'number', false, 0.01],
            ]);
        } catch { return; }
        const { Name: name, Scale: scaleRaw } = result;
        if (PRESETS.MODEL_CATALOGUE.find(e => e.name === name)) {
            alert(`Model "${name}" already exists. Pick a different name.`);
            return;
        }
        const s = parseFloat(scaleRaw);
        const scale = Number.isFinite(s) && s > 0 ? [s, s, s] : [0.01, 0.01, 0.01];
        const dataURL = await fileToDataURL(file);
        _registerCustomModel(name, dataURL, isFBX ? 'fbx' : 'obj', scale);
        modelPreviews = generateModelPreviews();
        await saveAllToDB();
        window.dispatchEvent(new CustomEvent('resources-changed'));
        // Refresh property panel if a model is selected so its picker shows the new entry
        if (selectedObject?.type === 'model') {
            const layer = builder.layers.find(l => l.objects?.some(o => o.id === selectedObject.id));
            if (layer) renderObjectProperties(selectedObject, layer);
        }
    }
}

let _dragCounter = 0;
window.addEventListener('dragenter', e => {
    e.preventDefault();
    _dragCounter++;
    dragDrop.classList.add('active');
});
window.addEventListener('dragleave', () => {
    _dragCounter--;
    if (_dragCounter <= 0) { _dragCounter = 0; dragDrop.classList.remove('active'); }
});
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', async e => {
    e.preventDefault();
    _dragCounter = 0;
    dragDrop.classList.remove('active');
    const file = e.dataTransfer.files[0];
    if (file) await handleDroppedFile(file);
});

const resourceInput = document.getElementById('resource-input');
resourceInput.addEventListener('change', async e => {
    for (const file of e.target.files) await handleDroppedFile(file);
    resourceInput.value = '';
    window.dispatchEvent(new CustomEvent('resources-changed'));
});

// ─────────────────────────────────────────────
//  Resources popup (manages imported audio / HDRI / BG / video)
// ─────────────────────────────────────────────
async function _deleteAudioFileFromDB(id) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}

function _deleteCustomHDRI(name) {
    const ci = customCatalogues.hdri.findIndex(e => e.name === name);
    if (ci >= 0) customCatalogues.hdri.splice(ci, 1);
    const pi = PRESETS.HDRI_CATALOGUE.findIndex(e => e.name === name);
    if (pi >= 0) PRESETS.HDRI_CATALOGUE.splice(pi, 1);
    const sel = document.getElementById('scene-hdri');
    if (sel) {
        const opt = sel.querySelector(`option[value="${CSS.escape(name)}"]`);
        opt?.remove();
        if (sel.value === name) {
            const fallback = PRESETS.HDRI_CATALOGUE[0]?.name;
            if (fallback) { sel.value = fallback; builder.setHDRI(fallback); }
        }
    }
}

function _deleteCustomBG(name) {
    const ci = customCatalogues.bg.findIndex(e => e.name === name);
    if (ci >= 0) customCatalogues.bg.splice(ci, 1);
    const pi = PRESETS.BG_CATALOGUE.findIndex(e => e.name === name);
    if (pi >= 0) PRESETS.BG_CATALOGUE.splice(pi, 1);
}

function _deleteCustomVideo(name) {
    const ci = customCatalogues.video.findIndex(e => e.name === name);
    if (ci >= 0) customCatalogues.video.splice(ci, 1);
    const pi = (PRESETS.VIDEO_CATALOGUE || []).findIndex(e => e.name === name);
    if (pi >= 0) PRESETS.VIDEO_CATALOGUE.splice(pi, 1);
}

function _deleteCustomModel(name) {
    const ci = customCatalogues.model.findIndex(e => e.name === name);
    if (ci >= 0) customCatalogues.model.splice(ci, 1);
    const pi = PRESETS.MODEL_CATALOGUE.findIndex(e => e.name === name);
    if (pi >= 0) PRESETS.MODEL_CATALOGUE.splice(pi, 1);
    // Drop cached three.js clone source so re-uploads with the same name reload
    if (builder?._modelCache)        delete builder._modelCache[name];
    if (builder?._modelFBXTextures)  delete builder._modelFBXTextures[name];
    modelPreviews = generateModelPreviews();
}

async function _deleteAudioTrack(record) {
    // Stop playback if this track is currently loaded
    if (sound?.isPlaying) { sound.onEnded = null; sound.stop(); }
    isPlaying = false;
    try { await _deleteAudioFileFromDB(record.id); } catch (e) { console.warn(e); }
    const idx = allTracks.indexOf(record);
    if (idx >= 0) allTracks.splice(idx, 1);
    document.querySelectorAll(
        `#saved-tracks .list-button[data-track-name="${CSS.escape(record.name)}"]`
    ).forEach(b => b.parentElement?.remove());
}

function _renderResourceSection(parent, title, items, getName, onDelete) {
    if (!items || items.length === 0) return;
    const section = document.createElement('div');
    section.className = 'resources-section';
    const h = document.createElement('div');
    h.className = 'resources-section-header';
    h.textContent = `${title} (${items.length})`;
    section.appendChild(h);
    const list = document.createElement('div');
    list.className = 'resources-list';
    items.forEach(it => {
        const row = document.createElement('div');
        row.className = 'resources-row';
        const label = document.createElement('span');
        label.className = 'resources-row-name';
        label.textContent = getName(it);
        const del = document.createElement('div');
        del.className = 'resources-row-delete';
        del.textContent = '×';
        del.title = 'Delete';
        del.addEventListener('click', async () => { await onDelete(it); });
        row.appendChild(label);
        row.appendChild(del);
        list.appendChild(row);
    });
    section.appendChild(list);
    parent.appendChild(section);
}

function showResourcesPopup() {
    if (document.getElementById('resources-popup-bg')) return;

    const bg = document.createElement('div');
    bg.className = 'popup-bg';
    bg.id = 'resources-popup-bg';

    const popup = document.createElement('div');
    popup.className = 'popup resources-popup';

    const title = document.createElement('div');
    title.className = 'h1 popup-title-text';
    title.textContent = 'Resources';

    const body = document.createElement('div');
    body.className = 'resources-body';

    const render = () => {
        body.innerHTML = '';
        _renderResourceSection(body, 'Audio Tracks', allTracks,
            t => t.name,
            async t => { await _deleteAudioTrack(t); render(); });
        _renderResourceSection(body, 'HDRI', customCatalogues.hdri,
            e => e.name,
            async e => { _deleteCustomHDRI(e.name); await saveAllToDB(); render(); });
        _renderResourceSection(body, 'Background Images', customCatalogues.bg,
            e => e.name,
            async e => { _deleteCustomBG(e.name); await saveAllToDB(); render(); });
        _renderResourceSection(body, 'Video', customCatalogues.video,
            e => e.name,
            async e => { _deleteCustomVideo(e.name); await saveAllToDB(); render(); });
        _renderResourceSection(body, 'Models', customCatalogues.model,
            e => `${e.name} (${(e.format ?? 'fbx').toUpperCase()})`,
            async e => {
                _deleteCustomModel(e.name);
                await saveAllToDB();
                render();
                if (selectedObject?.type === 'model') {
                    const layer = builder.layers.find(l => l.objects?.some(o => o.id === selectedObject.id));
                    if (layer) renderObjectProperties(selectedObject, layer);
                }
            });

        const total = allTracks.length + customCatalogues.hdri.length
            + customCatalogues.bg.length + customCatalogues.video.length
            + customCatalogues.model.length;
        if (total === 0) {
            const empty = document.createElement('div');
            empty.className = 'resources-empty';
            empty.textContent = 'No imported resources yet. Click Import to add audio, images, or video.';
            body.appendChild(empty);
        }
    };
    render();

    const onResourcesChanged = () => render();
    window.addEventListener('resources-changed', onResourcesChanged);

    popup.appendChild(title);
    popup.appendChild(body);

    const buttonBox = document.createElement('div');
    buttonBox.className = 'popup-button-box';

    const importBtn = document.createElement('div');
    importBtn.className = 'big-Btn';
    importBtn.textContent = 'Import';
    importBtn.addEventListener('click', () => resourceInput.click());

    const closeBtn = document.createElement('div');
    closeBtn.className = 'big-Btn';
    closeBtn.textContent = 'Close';
    const close = () => {
        window.removeEventListener('resources-changed', onResourcesChanged);
        bg.remove();
    };
    closeBtn.addEventListener('click', close);

    buttonBox.appendChild(importBtn);
    buttonBox.appendChild(closeBtn);
    popup.appendChild(buttonBox);

    bg.appendChild(popup);
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    document.body.appendChild(bg);
}

document.getElementById('manage-resources')?.addEventListener('click', showResourcesPopup);

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
    if (isPlaying) currentTime = audioContext.currentTime - startTime;
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
    const percent = ((e.clientX - rect.left) / rect.width * 100).toFixed(2);
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

function _updateTabPill() {
    const pill = document.getElementById('editor-switch-pill');
    const active = document.querySelector('#editorSwitch .switch-tab.selected');
    if (!pill || !active) return;
    pill.style.left  = active.offsetLeft + 'px';
    pill.style.width = active.offsetWidth + 'px';
}

function switchTab(tab) {
    currentTab = tab;
    const isOE   = tab === 'oe';
    const isPP   = tab === 'pp';
    const isAnim = tab === 'anim';
    document.getElementById('current-layer-controls').style.display = isOE   ? '' : 'none';
    document.getElementById('pp-section').style.display             = isPP   ? '' : 'none';
    document.getElementById('anim-section').style.display           = isAnim ? '' : 'none';
    document.getElementById('layers').style.display                 = isAnim ? 'none' : '';
    document.getElementById('oe-btn').classList.toggle('selected',     isOE);
    document.getElementById('pp-editor').classList.toggle('selected',  isPP);
    document.getElementById('anim-btn').classList.toggle('selected',   isAnim);
    _updateTabPill();
    if (isAnim) renderAnimationList();
    else        renderLayerList();
}
window.addEventListener('resize', _updateTabPill);

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
    updatePPPills();
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
    el.draggable = true;

    el.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-pp-layer', ppLayer.id);
        el.classList.add('drag-source');
    });
    el.addEventListener('dragend', () => {
        el.classList.remove('drag-source');
        document.querySelectorAll(
            '#pp-layer-list .drag-over-above, #pp-layer-list .drag-over-below'
        ).forEach(x => x.classList.remove('drag-over-above', 'drag-over-below'));
    });
    el.addEventListener('dragover', (e) => {
        if (!e.dataTransfer.types.includes('application/x-pp-layer')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = el.getBoundingClientRect();
        const above = (e.clientY - rect.top) < rect.height / 2;
        el.classList.toggle('drag-over-above',  above);
        el.classList.toggle('drag-over-below', !above);
    });
    el.addEventListener('dragleave', () => {
        el.classList.remove('drag-over-above', 'drag-over-below');
    });
    el.addEventListener('drop', (e) => {
        const srcId = e.dataTransfer.getData('application/x-pp-layer');
        if (!srcId || srcId === ppLayer.id) return;
        e.preventDefault();
        el.classList.remove('drag-over-above', 'drag-over-below');
        const rect = el.getBoundingClientRect();
        const above = (e.clientY - rect.top) < rect.height / 2;
        const srcIdx = ctx.layers.findIndex(l => l.id === srcId);
        if (srcIdx < 0) return;
        const [moved] = ctx.layers.splice(srcIdx, 1);
        let dstIdx = ctx.layers.findIndex(l => l.id === ppLayer.id);
        if (dstIdx < 0) dstIdx = ctx.layers.length;
        ctx.layers.splice(above ? dstIdx : dstIdx + 1, 0, moved);
        ctx.pipeline.layers = ctx.layers;
        renderPPLayerList();
        saveAllToDB();
    });

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
    _ppAnimBtnRefreshers.length = 0;

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

            const range = { min: def.min ?? 0, max: def.max ?? 1 };
            const animBtn = document.createElement('div');
            animBtn.className = 'prop-animate-btn';
            animBtn.textContent = '●';
            animBtn.title = 'Animate (audio sync)';
            const refresh = () => {
                const on = !!ppLayer.propertyBindings[def.key];
                animBtn.classList.toggle('active', on);
                slider.disabled = on;
                num.disabled    = on;
                rowEl.classList.toggle('animated', on);
            };
            refresh();
            animBtn.addEventListener('click', () => {
                toggleAnimatedProperty(ppLayer.id, def.key, def.label, range,
                    { isPP: true, ppContextId });
            });
            _ppAnimBtnRefreshers.push(refresh);
            wrap.appendChild(animBtn);

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
        } else if (def.type === 'select') {
            const sel = document.createElement('select');
            sel.className = 'prop-select';
            (def.options ?? []).forEach(opt => {
                const o = document.createElement('option');
                if (typeof opt === 'object') { o.value = opt.value; o.textContent = opt.label ?? opt.value; }
                else { o.value = opt; o.textContent = opt; }
                sel.appendChild(o);
            });
            sel.value = ppLayer.properties[def.key];
            sel.addEventListener('change', () => {
                ppLayer.properties[def.key] = sel.value;
                ppLayer.invalidateMaterial?.();
                saveAllToDB();
            });
            rowEl.appendChild(sel);
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
    // Global is PP-only — accessible from the PP editor's Global pill, not here.
    for (const layer of builder.layers) addLayerElement(layer);
    refreshCounters();
}

function addLayerElement(layer) {
    const el = document.createElement('div');
    el.classList.add('list-button', 'layer-item');
    el.dataset.layerId = layer.id;
    // Only non-base layers can be dragged; base is always anchored at idx 0
    el.draggable = !layer.isBase;

    el.addEventListener('dragstart', (e) => {
        if (layer.isBase) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-layer', layer.id);
        el.classList.add('drag-source');
    });
    el.addEventListener('dragend', () => {
        el.classList.remove('drag-source');
        document.querySelectorAll(
            '#layer-list .drag-over-above, #layer-list .drag-over-below, #layer-list .drag-over-into'
        ).forEach(x => x.classList.remove(
            'drag-over-above', 'drag-over-below', 'drag-over-into'));
    });
    el.addEventListener('dragover', (e) => {
        const types = e.dataTransfer.types;
        if (types.includes('application/x-layer')) {
            if (layer.isBase) return; // can't drop a layer above the base
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = el.getBoundingClientRect();
            const above = (e.clientY - rect.top) < rect.height / 2;
            el.classList.toggle('drag-over-above',  above);
            el.classList.toggle('drag-over-below', !above);
        } else if (types.includes('application/x-object')) {
            // Accept; concrete type-validation happens on drop (getData
            // is restricted to drop-time for security).
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            el.classList.add('drag-over-into');
        }
    });
    el.addEventListener('dragleave', () => {
        el.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-into');
    });
    el.addEventListener('drop', (e) => {
        el.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-into');
        const objPayload = _tryParseObjectDrag(e);
        if (objPayload) {
            e.preventDefault();
            if (objPayload.sourceLayerId === layer.id) return;
            if (!_layerAcceptsObject(layer, objPayload.objectType)) return;
            moveObjectToLayer(objPayload.sourceLayerId, layer, objPayload.objectId);
            return;
        }
        const srcLayerId = e.dataTransfer.getData('application/x-layer');
        if (srcLayerId && srcLayerId !== layer.id) {
            e.preventDefault();
            if (layer.isBase) return;
            const rect = el.getBoundingClientRect();
            const above = (e.clientY - rect.top) < rect.height / 2;
            reorderLayerInBuilder(srcLayerId, layer.id, above);
        }
    });

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

const currentLayerControllBox = document.getElementById('current-layer-controls');
let currentSelectedLayerId = null;
function selectLayer(layer) {
    selectedObject = null;
    builder.detachGizmo();
    currentSelectedLayerId = layer?.id ?? null;

    document.querySelectorAll('.layer-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.layerId === layer.id);
    });

    currentLayerControllBox.children[0].textContent = layer.name;
    updatePPPills();

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

    if (layer.isBase) {
        const addImage = document.createElement('div');
        addImage.classList.add('Btn');
        addImage.textContent = 'Add Fill(Image/Video)';
        addImage.addEventListener('click', () => {
            const p = spawnPopup('Add Image/Video', [
                ['Name',  'text'],
                ['Type',  'select', ['image', 'video']],
                ['Image', 'preview', 'bg'],
                ['Video', 'preview', 'video'],
            ]);
            const popup = document.querySelector('.popup');
            const typeSel = popup?.querySelector('[data-label="Type"] select');
            const imgBox  = popup?.querySelector('[data-label="Image"]');
            const vidBox  = popup?.querySelector('[data-label="Video"]');
            const apply = () => {
                const isVideo = typeSel?.value === 'video';
                if (imgBox) imgBox.style.display = isVideo ? 'none' : '';
                if (vidBox) vidBox.style.display = isVideo ? '' : 'none';
            };
            typeSel?.addEventListener('change', apply);
            apply();
            p.then(data => onAddImage(layer, data)).catch(() => {});
        });
        buttonBox.appendChild(addImage);
    }

    renderObjectList(layer);
    if (layer.objects.length > 0) {
        selectObject(layer.objects[0], layer);
    } else {
        document.getElementById('object-properties').innerHTML = '';
    }
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
        row.draggable = true;

        row.addEventListener('click', () => selectObject(obj, layer));

        // Drag-reorder (same-layer) + source for cross-layer drops on layer rows
        row.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('application/x-object', JSON.stringify({
                objectId: obj.id,
                sourceLayerId: layer.id,
                objectType: obj.type,
            }));
            // Fallback so older drop handlers / dev tools still see something
            e.dataTransfer.setData('text/plain', obj.id);
            row.classList.add('drag-source');
        });
        row.addEventListener('dragend', () => {
            row.classList.remove('drag-source');
            document.querySelectorAll(
                '.drag-over-above, .drag-over-below, .drag-over-into'
            ).forEach(el => el.classList.remove(
                'drag-over-above', 'drag-over-below', 'drag-over-into'));
        });
        row.addEventListener('dragover', (e) => {
            if (!e.dataTransfer.types.includes('application/x-object')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = row.getBoundingClientRect();
            const above = (e.clientY - rect.top) < rect.height / 2;
            row.classList.toggle('drag-over-above',  above);
            row.classList.toggle('drag-over-below', !above);
        });
        row.addEventListener('dragleave', () => {
            row.classList.remove('drag-over-above', 'drag-over-below');
        });
        row.addEventListener('drop', (e) => {
            const payload = _tryParseObjectDrag(e);
            if (!payload) return;
            e.preventDefault();
            row.classList.remove('drag-over-above', 'drag-over-below');
            // Cross-layer drops are handled by layer rows, not here
            if (payload.sourceLayerId !== layer.id) return;
            if (payload.objectId === obj.id) return;
            const rect = row.getBoundingClientRect();
            const above = (e.clientY - rect.top) < rect.height / 2;
            reorderObjectInLayer(layer, payload.objectId, obj.id, above);
        });

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

function reorderObjectInLayer(layer, srcId, dstId, dropAbove) {
    const srcIdx = layer.objects.findIndex(o => o.id === srcId);
    if (srcIdx < 0) return;
    const [moved] = layer.objects.splice(srcIdx, 1);
    let dstIdx = layer.objects.findIndex(o => o.id === dstId);
    if (dstIdx < 0) dstIdx = layer.objects.length;
    layer.objects.splice(dropAbove ? dstIdx : dstIdx + 1, 0, moved);
    renderObjectList(layer);
    saveAllToDB();
}

function _tryParseObjectDrag(e) {
    try {
        const raw = e.dataTransfer.getData('application/x-object');
        if (!raw) return null;
        return JSON.parse(raw);
    } catch { return null; }
}

// Each object type is only allowed on certain layer kinds — mirrors the
// "Add X" button gating in selectLayer.
function _layerAcceptsObject(layer, objType) {
    if (objType === 'wave')                        return true;
    if (objType === 'image' || objType === 'fill') return !!layer.isBase;
    return !layer.isBase; // model, pointLight
}

function moveObjectToLayer(srcLayerId, dstLayer, objectId) {
    if (srcLayerId === dstLayer.id) return false;
    const ok = builder.moveObjectBetweenLayers(srcLayerId, dstLayer.id, objectId);
    if (!ok) return false;
    // If the moved object was the active selection, refresh the gizmo / property
    // panel against its new layer
    if (selectedObject && selectedObject.id === objectId) {
        builder.detachGizmo();
        builder.attachGizmo(selectedObject, saveAllToDB, () => _gizmoLiveRefresh?.());
        renderObjectProperties(selectedObject, dstLayer);
    }
    renderLayerList();
    const cur = builder.layers.find(l => l.id === currentSelectedLayerId);
    if (cur) renderObjectList(cur);
    saveAllToDB();
    return true;
}

function reorderLayerInBuilder(srcId, dstId, dropAbove) {
    const list = builder.layers;
    const srcIdx = list.findIndex(l => l.id === srcId);
    if (srcIdx < 0) return;
    if (list[srcIdx].isBase) return; // base never moves
    const [moved] = list.splice(srcIdx, 1);
    let dstIdx = list.findIndex(l => l.id === dstId);
    if (dstIdx < 0) dstIdx = list.length;
    let insertAt = dropAbove ? dstIdx : dstIdx + 1;
    if (insertAt < 1) insertAt = 1; // never above the base layer
    list.splice(insertAt, 0, moved);
    renderLayerList();
    saveAllToDB();
}

// ─────────────────────────────────────────────
//  Object selection
// ─────────────────────────────────────────────
function selectObject(obj, layer) {
    selectedObject = obj;

    document.querySelectorAll('#object-list .list-button').forEach(el => {
        el.classList.toggle('selected', el.dataset.objectId === obj.id);
    });

    builder.detachGizmo();
    builder.attachGizmo(obj, saveAllToDB, () => _gizmoLiveRefresh?.());
    renderObjectProperties(obj, layer);
}

// ─────────────────────────────────────────────
//  Property panel builder
// ─────────────────────────────────────────────

const AUDIO_SOURCES = [
    'sub','bass','lowMid','mid','highMid','presence','brilliance',
    'rms','centroid','flatness','flux','zcr',
    'beat','bpm',
    'volumeFast','volumeSlow','avgFast','avgSlow',
];
const CURVES        = ['linear','exponential','inverse'];

function renderObjectProperties(obj, layer) {
    const panel = document.getElementById('object-properties');
    panel.innerHTML = '';
    _animBtnRefreshers.length = 0;

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
        return r;
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

    // PropertyBinding sub-panel — constant value + animate icon.
    // Audio sync configuration lives in the Animation tab.
    function bindingPanel(label, binding, range = { min: -10, max: 10 }) {
        const container = document.createElement('div');
        container.className = 'prop-binding';
        (currentSection || panel).appendChild(container);

        const ownerKey = selectedObject
            ? Object.keys(selectedObject).find(k => selectedObject[k] === binding)
            : null;

        const valueRow = document.createElement('div');
        valueRow.className = 'prop-row';
        const lbl = document.createElement('label');
        lbl.className = 'prop-label';
        lbl.textContent = label;
        const wrap = document.createElement('div');
        wrap.className = 'prop-slider-wrap';

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

        wrap.appendChild(cSlider);
        wrap.appendChild(cNum);

        if (ownerKey) {
            const animBtn = document.createElement('div');
            animBtn.className = 'prop-animate-btn';
            animBtn.textContent = '●';
            animBtn.title = 'Animate (audio sync)';
            const panelObjId = selectedObject.id;
            const refresh = () => {
                if (!selectedObject || selectedObject.id !== panelObjId) return;
                const on = isPropertyAnimated(panelObjId, ownerKey);
                animBtn.classList.toggle('active', on);
                cSlider.disabled = on;
                cNum.disabled    = on;
                valueRow.classList.toggle('animated', on);
            };
            refresh();
            animBtn.addEventListener('click', () => {
                const nowOn = !isPropertyAnimated(panelObjId, ownerKey);
                binding.mode = nowOn ? 'audio' : 'constant';
                toggleAnimatedProperty(panelObjId, ownerKey, label, range);
            });
            _animBtnRefreshers.push(refresh);
            wrap.appendChild(animBtn);
        }

        valueRow.appendChild(lbl);
        valueRow.appendChild(wrap);
        container.appendChild(valueRow);

        container.refreshFromBinding = () => {
            cSlider.value = binding.value;
            cNum.value    = binding.value;
        };
        return container;
    }

    // ── Common: Name + Visible ──────────────────
    section('General');
    textInput('Name', () => obj.name, v => { obj.name = v; renderObjectList(layer); });
    checkbox('Visible', () => obj.visible, v => { obj.visible = v; });

    // ── Transform bindings ──────────────────────────────────
    section('Position');
    const _pPosX = bindingPanel('Position X', obj.posX);
    const _pPosY = bindingPanel('Position Y', obj.posY);
    const _pPosZ = bindingPanel('Position Z', obj.posZ);

    section('Rotation');
    const _pRotX = bindingPanel('Rotation X', obj.rotX);
    const _pRotY = bindingPanel('Rotation Y', obj.rotY);
    const _pRotZ = bindingPanel('Rotation Z', obj.rotZ);

    section('Scale');
    const _pGlobal = bindingPanel('Scale',   obj.globalScale);
    const _pScaleX = bindingPanel('Scale X', obj.scaleX);
    const _pScaleY = bindingPanel('Scale Y', obj.scaleY);
    const _pScaleZ = bindingPanel('Scale Z', obj.scaleZ);

    _gizmoLiveRefresh = () => {
        [_pPosX, _pPosY, _pPosZ, _pRotX, _pRotY, _pRotZ, _pScaleX, _pScaleY, _pScaleZ, _pGlobal]
            .forEach(p => p.refreshFromBinding());
    };

    // ── Model-specific ──────────────────────────
    if (obj.type === 'model') {
        section('Model');

        currentSection.appendChild(createPreviewArea('model', obj.modelName, v => { obj.modelName = v; save(); }));

        section('Material Properties');

        // forward refs — assigned below after their rows are created
        let opacityRowRef    = null;
        let roughnessRowRef  = null;
        let metalnessRowRef  = null;
        let smoothRowRef     = null;
        let colorRowRef      = null;
        let crRowRef         = null;
        let sensitivityRowRef = null;
        let fbxMapRowRef     = null;
        let fbxRoughRowRef   = null;
        let fbxMetalRowRef   = null;
        let fbxNormalRowRef  = null;

        const isStandard = () => obj.materialType === 'standard';
        const isNormal   = () => obj.materialType === 'normal';

        // Centralised visibility sync — all refs may be null when called during init
        let syncMatVisibility = (type = obj.materialType) => {
            const std = type === 'standard';
            const nor = type === 'normal';
            const hideColor = std && obj.useMapTexture;
            if (opacityRowRef)    opacityRowRef.style.display    = nor   ? 'none' : '';
            if (smoothRowRef)     smoothRowRef.style.display     = nor   ? 'none' : '';
            if (colorRowRef)      colorRowRef.style.display      = hideColor ? 'none' : '';
            if (crRowRef)         crRowRef.style.display         = hideColor ? 'none' : '';
            if (sensitivityRowRef) sensitivityRowRef.style.display =
                (hideColor || !obj.colorReactive) ? 'none' : '';
            if (fbxMapRowRef)     fbxMapRowRef.style.display     = std   ? '' : 'none';
            if (fbxRoughRowRef)   fbxRoughRowRef.style.display   = std   ? '' : 'none';
            if (fbxMetalRowRef)   fbxMetalRowRef.style.display   = std   ? '' : 'none';
            if (fbxNormalRowRef)  fbxNormalRowRef.style.display  = std   ? '' : 'none';
            if (roughnessRowRef)  roughnessRowRef.style.display  =
                std && !obj.useRoughnessMapTexture ? '' : 'none';
            if (metalnessRowRef)  metalnessRowRef.style.display  =
                std && !obj.useMetalnessMapTexture ? '' : 'none';
        };

        currentSection.appendChild(createPreviewArea('material', obj.materialType, v => {
            obj.materialType = v;
            syncMatVisibility(v);
            save();
        }));

        colorRowRef = colorInput('Color', () => obj.color, v => { obj.color = v; });

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
        sensitivityRowRef = sensitivityRow;

        crRowRef = row('Color Reactive');
        const crInp = document.createElement('input');
        crInp.type = 'checkbox'; crInp.className = 'prop-checkbox';
        crInp.checked = obj.colorReactive;
        crInp.addEventListener('change', () => {
            obj.colorReactive = crInp.checked;
            sensitivityRow.style.display = obj.colorReactive ? '' : 'none';
            save();
        });
        crRowRef.appendChild(crInp);
        (currentSection || panel).appendChild(sensitivityRow);

        // ── FBX texture toggles (standard only) ─────────────────
        fbxMapRowRef = row('FBX Color Texture');
        { const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'prop-checkbox';
          cb.checked = obj.useMapTexture;
          cb.addEventListener('change', () => { obj.useMapTexture = cb.checked; syncMatVisibility(); save(); });
          fbxMapRowRef.appendChild(cb); fbxMapRowRef.style.display = isStandard() ? '' : 'none'; }

        fbxRoughRowRef = row('FBX Roughness Texture');
        { const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'prop-checkbox';
          cb.checked = obj.useRoughnessMapTexture;
          cb.addEventListener('change', () => { obj.useRoughnessMapTexture = cb.checked; syncMatVisibility(); save(); });
          fbxRoughRowRef.appendChild(cb); fbxRoughRowRef.style.display = isStandard() ? '' : 'none'; }

        fbxMetalRowRef = row('FBX Metalness Texture');
        { const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'prop-checkbox';
          cb.checked = obj.useMetalnessMapTexture;
          cb.addEventListener('change', () => { obj.useMetalnessMapTexture = cb.checked; syncMatVisibility(); save(); });
          fbxMetalRowRef.appendChild(cb); fbxMetalRowRef.style.display = isStandard() ? '' : 'none'; }

        fbxNormalRowRef = row('FBX Normal Map');
        { const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'prop-checkbox';
          cb.checked = obj.useNormalMapTexture;
          cb.addEventListener('change', () => { obj.useNormalMapTexture = cb.checked; syncMatVisibility(); save(); });
          fbxNormalRowRef.appendChild(cb); fbxNormalRowRef.style.display = isStandard() ? '' : 'none'; }

        roughnessRowRef = bindingPanel('Roughness', obj.roughness, { min: 0, max: 1 });
        roughnessRowRef.style.display = isStandard() && !obj.useRoughnessMapTexture ? '' : 'none';

        metalnessRowRef = bindingPanel('Metalness', obj.metalness, { min: 0, max: 1 });
        metalnessRowRef.style.display = isStandard() && !obj.useMetalnessMapTexture ? '' : 'none';

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

        const wireLineWidthRowRef = slider('Wire Line Width', 1, 20, 0.1,
            () => obj.wireframeLineWidth ?? 2,
            v => { obj.wireframeLineWidth = v; }
        );
        wireLineWidthRowRef.style.display = obj.materialType === 'wireframe' ? '' : 'none';

        // Hook into the existing visibility sync so it shows/hides with the material type
        const _origSyncMatVisibility = syncMatVisibility;
        syncMatVisibility = (type = obj.materialType) => {
            _origSyncMatVisibility(type);
            wireLineWidthRowRef.style.display = type === 'wireframe' ? '' : 'none';
        };

        section('Audio Scale');
        bindingPanel('Audio Scale', obj.audioScale);

        section('Spin');
        bindingPanel('Spin Speed', obj.spinSpeed);
        selectInput('Spin Axis',
            ['+x', '-x', '+y', '-y', '+z', '-z'],
            () => obj.spinAxis ?? '+y',
            v => { obj.spinAxis = v; }
        );

        section('Displacement');
        selectInput('Type',
            ['simplex', 'perlin', 'voronoi', 'sine'],
            () => obj.noiseType ?? 'simplex',
            v => { obj.noiseType = v; }
        );
        selectInput('Direction',
            ['radial', 'normal'],
            () => obj.displaceDirection ?? 'radial',
            v => { obj.displaceDirection = v; }
        );
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

        colorInput('Line Color', () => obj.color, v => { obj.color = v; });

        const fillSupported = ['linear','linear-up','line'].includes(obj.waveType);
        if (fillSupported) {
            const fillRow = row('Fill');
            const fillInp = document.createElement('input');
            fillInp.type = 'checkbox'; fillInp.className = 'prop-checkbox';
            fillInp.checked = !!obj.fill;
            fillInp.addEventListener('change', () => {
                obj.fill = fillInp.checked;
                save();
                renderObjectProperties(obj, layer);
            });
            fillRow.appendChild(fillInp);

            if (obj.fill) {
                colorInput('Fill Color', () => obj.fillColor ?? obj.color, v => { obj.fillColor = v; });
            }
        }

        slider('Segments', 2, 256, 1,
            () => obj.segments,
            v => { obj.segments = Math.max(2, Math.round(v)); }
        );

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

        slider('Line Width', 1, 30, 0.1,
            () => obj.lineWidth ?? 1,
            v => { obj.lineWidth = v; }
        );

        slider('Opacity', 0, 1, 0.01,
            () => obj.opacity ?? 0.5,
            v => { obj.opacity = v; }
        );

        obj.sampleCount = 100;

        section('Amplitude');
        bindingPanel('Amplitude', obj.amplitude);
    }

    // ── Image-specific ──────────────────────────
    if (obj.type === 'image') {
        section('Media');

        selectInput('Type', ['image', 'video'],
            () => obj.mediaType ?? 'image',
            v => { obj.mediaType = v; renderObjectProperties(obj, layer); });

        if ((obj.mediaType ?? 'image') === 'video') {
            const vRow = row('Video');
            vRow.appendChild(createPreviewArea('video', obj.videoName, name => {
                obj.videoName = name; save();
            }));
            slider('Playback Rate', 0.1, 4, 0.05,
                () => obj.playbackRate ?? 1,
                v => { obj.playbackRate = v; });

            const audioRow = row('Audio');
            const audioBtn = document.createElement('div');
            audioBtn.className = 'Btn';
            const isSynced = syncedVideoObjId === obj.id;
            audioBtn.textContent = isSynced ? 'Unlink Track' : 'Load as Track';
            audioBtn.addEventListener('click', async () => {
                if (syncedVideoObjId === obj.id) {
                    syncedVideoObjId = null;
                    saveAllToDB();
                    renderObjectProperties(obj, layer);
                    return;
                }
                if (!obj.videoName) return;
                try {
                    await loadVideoAudioAsTrack(obj);
                    syncedVideoObjId = obj.id;
                    saveAllToDB();
                    renderObjectProperties(obj, layer);
                } catch (e) {
                    notifyVideoAudio(e?.message || 'Failed to load audio from video');
                }
            });
            audioRow.appendChild(audioBtn);
        } else {
            const imgRow = row('Image');
            imgRow.appendChild(createPreviewArea('bg', obj.imageName, name => {
                obj.imageName = name; save();
            }));
        }

        slider('Opacity', 0, 1, 0.01, () => obj.opacity ?? 1, v => { obj.opacity = v; });

        section('Audio Scale');
        bindingPanel('Audio Scale', obj.audioScale);

        section('Spin');
        bindingPanel('Spin Speed', obj.spinSpeed);
        selectInput('Spin Axis',
            ['+x', '-x', '+y', '-y', '+z', '-z'],
            () => obj.spinAxis ?? '+z',
            v => { obj.spinAxis = v; }
        );
    }
}

// ─────────────────────────────────────────────
//  Duplicate object
// ─────────────────────────────────────────────
async function duplicateObject(obj, layer) {
    const data = { ...obj.toJSON(), id: crypto.randomUUID(), name: obj.name + ' copy' };
    let newObj = null;
    if (obj.type === 'model') {
        newObj = ModelObject.fromJSON(data);
        await builder.addModelToLayer(layer.id, newObj);
    } else if (obj.type === 'pointLight') {
        newObj = PointLightObject.fromJSON(data);
        builder.addLightToLayer(layer.id, newObj);
    } else if (obj.type === 'wave') {
        newObj = WaveObject.fromJSON(data);
        builder.addWaveToLayer(layer.id, newObj);
    } else if (obj.type === 'image') {
        newObj = FillObject.fromJSON(data);
        builder.addImageToLayer(layer.id, newObj);
    }
    renderObjectList(layer);
    if (newObj) selectObject(newObj, layer);
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
    selectObject(modelObj, layer);
    saveAllToDB();
}

function onAddLight(layer) {
    const lightObj = new PointLightObject();
    lightObj.intensity.mode   = 'audio';
    lightObj.intensity.source = 'beat';
    lightObj.intensity.min    = 0;
    lightObj.intensity.max    = 10;

    builder.addLightToLayer(layer.id, lightObj);
    renderObjectList(layer);
    selectObject(lightObj, layer);
    saveAllToDB();
}

function onAddWave(layer, data) {
    const waveObj      = new WaveObject();
    waveObj.name       = data['Name'] || 'Wave';
    waveObj.waveType   = data['Type'] || 'circular';
    waveObj.segments   = Math.max(2, parseInt(data['Segments']) || 64);
    waveObj.color      = /^#[0-9a-fA-F]{6}$/.test(data['Color']) ? data['Color'] : '#ffffff';
    waveObj.amplitude.mode  = 'audio';
    waveObj.amplitude.source = 'beat';
    waveObj.amplitude.min   = 0;
    waveObj.amplitude.max   = 1;
    builder.addWaveToLayer(layer.id, waveObj);
    renderObjectList(layer);
    selectObject(waveObj, layer);
    saveAllToDB();
}

function onAddImage(layer, data) {
    const fillObj     = new FillObject();
    const type        = data['Type'] || 'image';
    fillObj.name      = data['Name'] || (type === 'video' ? 'Video' : 'Image');
    fillObj.mediaType = type;
    if (type === 'video') {
        fillObj.videoName = data['Video'] || null;
    } else {
        fillObj.imageName = data['Image'] || null;
    }
    builder.addImageToLayer(layer.id, fillObj);
    renderObjectList(layer);
    selectObject(fillObj, layer);
    saveAllToDB();
}

// ─────────────────────────────────────────────
//  Global controls
// ─────────────────────────────────────────────
document.getElementById('pause-btn').addEventListener('click', () => {
    isPlaying ? pauseAudio() : resumeAudio();
});

const _volumeSlider = document.getElementById('audio-volume');
if (_volumeSlider) _volumeSlider.value = Volume;
_volumeSlider?.addEventListener('input', (e) => {
    Volume = parseFloat(e.target.value);
    listener.setMasterVolume(Volume);
    try { localStorage.setItem(VOLUME_KEY, String(Volume)); } catch {}
});

let _glLayoutSaveTimer = 0;
window.addEventListener('gl-layout-changed', () => {
    clearTimeout(_glLayoutSaveTimer);
    _glLayoutSaveTimer = setTimeout(() => { saveAllToDB(); }, 400);
});

document.getElementById('add-layer').addEventListener('click', async () => {
    const data = await spawnPopup('New Layer', [['Name', 'text', true]]).catch(() => null);
    if (!data) return;
    const name = (data.Name || '').trim();
    if (!name) return;
    const layer = new Layer(name, false);
    builder.addLayer(layer);
    addLayerElement(layer);
    refreshCounters();
    await saveAllToDB();
});

// ─────────────────────────────────────────────
//  System audio capture (getDisplayMedia)
// ─────────────────────────────────────────────
let _captureStream = null;
let _captureSource = null;

function _stopSystemCapture() {
    if (_captureSource) {
        try { _captureSource.disconnect(); } catch {}
        _captureSource = null;
    }
    if (_captureStream) {
        _captureStream.getTracks().forEach(t => t.stop());
        _captureStream = null;
    }
    const btn = document.getElementById('capture-audio-btn');
    if (btn) btn.textContent = 'Capture System Audio';
}

async function _startSystemCapture() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
        alert('getDisplayMedia is not supported in this browser.');
        return;
    }
    let stream;
    try {
        stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
        });
    } catch (err) {
        if (err?.name !== 'NotAllowedError') console.warn('Capture failed:', err);
        return;
    }
    if (stream.getAudioTracks().length === 0) {
        alert('No audio track in the share. In the picker, tick "Share audio" (Chrome tab or system audio).');
        stream.getTracks().forEach(t => t.stop());
        return;
    }
    // Drop the video — we only need the audio
    stream.getVideoTracks().forEach(t => t.stop());

    // Stop the previous file-based playback
    if (sound.isPlaying) { sound.onEnded = null; sound.stop(); }
    audioBuffer = null;
    isPlaying   = false;
    progressFill.style.width = '0%';
    currentTimeDisplay.textContent = '0:00';
    durationDisplay.textContent    = 'LIVE';

    // Route the live stream into the existing AnalyserNode so the visualizer
    // sees it. Do NOT connect to destination — the user is already hearing
    // the audio from its original source app, and routing back would feedback.
    const ctx = listener.context;
    if (ctx.state === 'suspended') await ctx.resume();
    _captureSource = ctx.createMediaStreamSource(stream);
    _captureSource.connect(analyser.analyser);

    _captureStream = stream;
    // Auto-stop if the user clicks the browser's "Stop sharing" button
    stream.getAudioTracks()[0].addEventListener('ended', _stopSystemCapture);

    const btn = document.getElementById('capture-audio-btn');
    if (btn) btn.textContent = 'Stop Capture';
}

document.getElementById('capture-audio-btn')?.addEventListener('click', () => {
    if (_captureStream) _stopSystemCapture();
    else _startSystemCapture();
});

document.getElementById('audio-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    _stopSystemCapture(); // file playback takes over

    const songName = await readID3Title({ file });
    const name = songName || file.name;

    const dup = allTracks.find(t =>
        t.name === name &&
        t.file?.size === file.size &&
        t.file?.type === file.type
    );
    if (dup) {
        loadAudioFromRecord(dup);
        return;
    }

    const trackId = await saveAudioFile(file);
    const record = { id: trackId, file, name, type: file.type, isPlaying: false };
    allTracks.push(record);

    const lI = document.createElement('div');
    const button = document.createElement('button');
    button.textContent = name;
    button.classList.add('list-button');
    button.dataset.trackName = name;
    button.onclick = () => loadAudioFromRecord(record);
    lI.appendChild(button);
    document.getElementById('saved-tracks').appendChild(lI);

    loadAudioFromRecord(record);
});
// ─────────────────────────────────────────────
//  PreviewArea
// ─────────────────────────────────────────────
let materialPreviews = generateMaterialPreviews();
let modelPreviews    = generateModelPreviews();
let ppPreviews;
const bgPreviews = () => PRESETS.BG_CATALOGUE.map(e => ({ name: e.name, url: e.path }));
const videoPreviews = () => (PRESETS.VIDEO_CATALOGUE || []).map(e => ({ name: e.name, url: e.path, isVideo: true }));

function createPreviewArea(type, currentValue, onChange) {
    const grid = document.createElement('div');
    grid.className = 'preview-grid';

    const promise = type === 'material' ? materialPreviews
                  : type === 'model'    ? modelPreviews
                  : type === 'bg'       ? bgPreviews()
                  : type === 'video'    ? videoPreviews()
                  : ppPreviews;
    Promise.resolve(promise).then(items => {
        items.forEach(({ name, url, isVideo }) => {
            const item = document.createElement('div');
            item.className = 'preview-item';
            if (name === currentValue) item.classList.add('selected');
            item.title = name;

            const useVideo = isVideo || type === 'video';
            const img = document.createElement(useVideo ? 'video' : (url ? 'img' : 'div'));
            img.className = 'preview-img';
            if (url) img.src = url;
            if (useVideo) { img.muted = true; img.loop = true; img.playsInline = true; img.autoplay = true; }
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
        const record = { ...f, name: trackName };
        allTracks.push(record);
        const lI = document.createElement('div');
        const button = document.createElement('button');
        button.textContent = trackName;
        button.classList.add('list-button');
        button.dataset.trackName = trackName;
        button.onclick = () => loadAudioFromRecord(record);
        lI.appendChild(button);
        document.getElementById('saved-tracks').appendChild(lI);
    }

    // ── Scene Settings ────────────────────────────────────────
    const sceneSettingsHeader = document.getElementById('scene-settings-header');
    const sceneSettingsBody   = document.getElementById('scene-settings-body');
    sceneSettingsHeader.addEventListener('click', () => {
        const open = sceneSettingsBody.style.display !== 'none';
        sceneSettingsBody.style.display = open ? 'none' : '';
        sceneSettingsHeader.querySelector('.prop-section-arrow').style.transform = open ? 'rotate(-90deg)' : '';
    });
    document.getElementById('scene-clear-color').addEventListener('input', e => {
        builder.setClearColor(e.target.value);
        saveAllToDB();
    });
    const hdriSelect = document.getElementById('scene-hdri');
    PRESETS.HDRI_CATALOGUE.forEach(e => {
        const o = document.createElement('option');
        o.value = o.textContent = e.name;
        hdriSelect.appendChild(o);
    });
    hdriSelect.value = builder.selectedHDRI;
    hdriSelect.addEventListener('change', () => { builder.setHDRI(hdriSelect.value); saveAllToDB(); });

    // ── Post-processing setup (must precede deserializeAll) ──
    await initShaders();
    ppPreviews = generatePPPreviews();
    const globalPipeline = new PostProcessingPipeline(builder.renderer, window.innerWidth, window.innerHeight);
    builder.setPostPipeline(globalPipeline);
    ppContexts.set('global', { layers: [], pipeline: globalPipeline });

    const saved = await loadAllFromDB();
    const noProject = !(saved?.length > 0);
    if (saved?.length > 0) {
        await deserializeAll(saved);
    } else {
        builder.addLayer(new Layer('Background', true));
    }
    renderLayerList();
    renderAnimationList();
    _setupAnimTabs();
    switchPPContext('global');

    if (builder.layers.length > 0) selectLayer(builder.layers[0]);
    if (noProject) showPresetPicker({ canDismiss: false });
    const lastPlaying = allTracks.find(t => t.isPlaying);
    if (lastPlaying) loadAudioFromRecord(lastPlaying);

    // Tab switching
    document.getElementById('oe-btn').addEventListener('click',     () => switchTab('oe'));
    document.getElementById('pp-editor').addEventListener('click',  () => switchTab('pp'));
    document.getElementById('anim-btn').addEventListener('click',   () => switchTab('anim'));
    requestAnimationFrame(_updateTabPill);

    // Gizmo mode switch (header)
    _setupGizmoModeSwitch();

    // PP context tabs
    const tabGlobal = document.getElementById('pp-tab-global');
    const tabLayer  = document.getElementById('pp-tab-layer');
    tabGlobal?.addEventListener('click', () => switchPPContext('global'));
    tabLayer?.addEventListener('click', () => {
        if (!currentSelectedLayerId) return;
        switchPPContext(currentSelectedLayerId);
    });
    updatePPPills();
});

function _setupGizmoModeSwitch() {
    const els = {
        translate: document.getElementById('gizmo-mode-translate'),
        rotate:    document.getElementById('gizmo-mode-rotate'),
        scale:     document.getElementById('gizmo-mode-scale'),
    };
    if (!els.translate) return;
    const refresh = (mode) => {
        for (const m of Object.keys(els)) els[m]?.classList.toggle('selected', m === mode);
    };
    for (const m of Object.keys(els)) {
        els[m]?.addEventListener('click', () => builder.setGizmoMode(m));
    }
    window.addEventListener('gizmo-mode-changed', e => refresh(e.detail.mode));
    refresh(builder.getGizmoMode());
}

function updatePPPills() {
    const tabGlobal = document.getElementById('pp-tab-global');
    const tabLayer  = document.getElementById('pp-tab-layer');
    if (!tabGlobal || !tabLayer) return;

    const layer = currentSelectedLayerId
        ? builder.layers.find(l => l.id === currentSelectedLayerId)
        : null;
    tabLayer.textContent = layer ? `Layer: ${layer.name}` : 'Layer: —';
    tabLayer.classList.toggle('is-disabled', !layer);

    tabGlobal.classList.toggle('selected', ppContextId === 'global');
    tabLayer.classList.toggle('selected',  ppContextId !== 'global' && ppContextId === currentSelectedLayerId);
}



// ─────────────────────────────────────────────
//  Animation loop
// ─────────────────────────────────────────────
const _freqPreviewCanvas = document.getElementById('freq-preview');
const _freqPreviewCtx    = _freqPreviewCanvas?.getContext('2d') ?? null;
if (typeof ResizeObserver !== 'undefined' && _freqPreviewCanvas) {
    new ResizeObserver(_drawWaveformPreview).observe(_freqPreviewCanvas);
}

// ── Audio Monitor (live spectrum + waveform + per-source meters) ──
const _audioMonitorEls = {
    monitor:  document.getElementById('audio-monitor'),
    spectrum: document.getElementById('audio-spectrum'),
    waveform: document.getElementById('audio-waveform'),
    beatDot:  document.getElementById('audio-beat-dot'),
    bpm:      document.getElementById('audio-bpm'),
    meters:   document.getElementById('audio-meters'),
};
const AUDIO_SOURCE_DESC = {
    sub:        'Sub-bass energy (20–60 Hz). Felt more than heard — kick drums, bass drops.',
    bass:       'Bass energy (60–250 Hz). Kick drums, bass guitar fundamentals.',
    lowMid:     'Low-mid (250–500 Hz). Body of most instruments and vocals.',
    mid:        'Mid-range (500–2000 Hz). Where most musical content sits.',
    highMid:    'High-mid (2–4 kHz). Vocal presence, attack of percussion.',
    presence:   'Presence band (4–6 kHz). Clarity, definition, snare crack.',
    brilliance: 'Brilliance / air (6+ kHz). Cymbals, sibilance, sparkle.',
    rms:        'True loudness from the raw waveform. Smoother than spectral averages.',
    centroid:   'Spectral centroid — perceived brightness. High = treble-heavy sound.',
    flatness:   'Tonal vs noisy character. Low = pure tone, high = noise (cymbals, hiss).',
    flux:       'Total spectral change between frames. Spikes on new notes / transients.',
    zcr:        'Zero-crossing rate. Cheap pitch / noisiness proxy.',
    beat:       'Pulses to max on detected beats, decays between. Best for rhythmic motion.',
    bpm:        'Estimated tempo (40–240 BPM). Use min/max to remap to a useful range.',
    volumeFast: 'Volume envelope, fast attack. Snappy follower.',
    volumeSlow: 'Volume envelope, slow attack. Sustained average.',
    avgFast:    'Average frequency, fast-smoothed.',
    avgSlow:    'Average frequency, slow-smoothed.',
};
const _audioMeterBars = new Map();
(function _buildAudioMeters() {
    if (!_audioMonitorEls.meters) return;
    _audioMonitorEls.meters.innerHTML = '';
    for (const key of AUDIO_SOURCES) {
        const wrap = document.createElement('div');
        wrap.className = 'audio-meter-cube-wrap';
        wrap.title = AUDIO_SOURCE_DESC[key] || key;
        const cube = document.createElement('div');
        cube.className = 'audio-meter-cube';
        const fill = document.createElement('div');
        fill.className = 'audio-meter-cube-fill';
        const lbl = document.createElement('div');
        lbl.className = 'audio-meter-cube-label';
        lbl.textContent = key;
        cube.appendChild(fill);
        wrap.appendChild(cube);
        wrap.appendChild(lbl);
        _audioMonitorEls.meters.appendChild(wrap);
        _audioMeterBars.set(key, { fill });
    }
})();

function _updateAudioMonitor(ad) {
    if (!ad || !_audioMonitorEls.monitor) return;
    if (_audioMonitorEls.monitor.offsetParent === null) return; // window closed / stashed

    const accent = getComputedStyle(document.documentElement)
        .getPropertyValue('--accent').trim() || '#c8f035';

    const sc = _audioMonitorEls.spectrum;
    if (sc && ad.freqData) {
        const ctx2 = sc.getContext('2d');
        const w = sc.width, h = sc.height;
        ctx2.clearRect(0, 0, w, h);
        const NBars = 64;
        const data = ad.freqData;
        // Log-binned spectrum: only show ~0–11 kHz (right half is mostly silent
        // for music) and distribute bars logarithmically so lows are readable.
        const minBin = 1;
        const maxBin = Math.max(2, Math.floor(data.length * 0.5));
        const logMin = Math.log(minBin);
        const logMax = Math.log(maxBin);
        const bw = w / NBars;
        ctx2.fillStyle = accent;
        for (let i = 0; i < NBars; i++) {
            const a = Math.exp(logMin + (logMax - logMin) * (i / NBars));
            const b = Math.exp(logMin + (logMax - logMin) * ((i + 1) / NBars));
            const s = Math.max(minBin, Math.floor(a));
            const e = Math.min(maxBin, Math.max(s + 1, Math.ceil(b)));
            let sum = 0;
            for (let j = s; j < e; j++) sum += data[j];
            const v = (sum / (e - s)) / 255;
            const bh = v * h;
            ctx2.fillRect(i * bw, h - bh, bw - 1, bh);
        }
    }

    const wf = _audioMonitorEls.waveform;
    if (wf && ad.timeData) {
        const ctx2 = wf.getContext('2d');
        const w = wf.width, h = wf.height;
        ctx2.clearRect(0, 0, w, h);
        ctx2.strokeStyle = accent;
        ctx2.lineWidth = 1;
        ctx2.beginPath();
        const N = ad.timeData.length;
        const step = Math.max(1, Math.floor(N / w));
        for (let x = 0; x < w; x++) {
            const v = (ad.timeData[x * step] - 128) / 128;
            const y = h / 2 - v * (h / 2 - 1);
            if (x === 0) ctx2.moveTo(x, y); else ctx2.lineTo(x, y);
        }
        ctx2.stroke();
    }

    if (_audioMonitorEls.beatDot)
        _audioMonitorEls.beatDot.classList.toggle('hit', (ad.beat ?? 0) > 80);
    if (_audioMonitorEls.bpm)
        _audioMonitorEls.bpm.textContent = `BPM: ${ad.bpm > 0 ? Math.round(ad.bpm) : '--'}`;

    for (const [key, { fill }] of _audioMeterBars) {
        const raw = ad[key] ?? 0;
        const norm = key === 'bpm' ? raw / 240 : raw / 255;
        fill.style.height = (Math.min(1, Math.max(0, norm)) * 100) + '%';
    }
}

let _lastFrameTime = 0;
let _hudUpdateAcc = 0;
function animate(time) {
    const dbg = builder._debugEnabled;
    const t0 = dbg ? performance.now() : 0;
    builder.updateAudioData(analyser, Volume);
    _updateAudioMonitor(builder.audioData);
    for (const fn of _audioInlineMeterUpdaters) fn(builder.audioData);
    updateProgressBar();
    _drawWaveformPreview();
    _syncVideoToAudio();
    listener.setMasterVolume(Volume);
    const tAudio = dbg ? performance.now() : 0;
    builder.update(time);
    if (dbg) {
        const tEnd = performance.now();
        const t = builder._timings;
        const a = 0.1;
        t.audio = t.audio * (1 - a) + (tAudio - t0) * a;
        t.frame = t.frame * (1 - a) + (tEnd - t0)   * a;
        const dt = _lastFrameTime ? (tEnd - _lastFrameTime) : 0;
        if (dt > 0) t.fps = t.fps * (1 - a) + (1000 / dt) * a;
        _lastFrameTime = tEnd;
        _hudUpdateAcc += dt;
        const hud = window.__DEBUG_HUD__;
        if (hud && (_hudUpdateAcc >= 100 || !hud.textContent)) {
            _hudUpdateAcc = 0;
            const fmt = (v) => v.toFixed(2).padStart(5, ' ');
            hud.textContent =
                `fps     ${t.fps.toFixed(1)}\n` +
                `frame   ${fmt(t.frame)} ms\n` +
                `audio   ${fmt(t.audio)} ms\n` +
                `objects ${fmt(t.objects)} ms\n` +
                `layers  ${fmt(t.layers)} ms\n` +
                `postFx  ${fmt(t.postFx)} ms\n` +
                `gizmo   ${fmt(t.gizmo)} ms\n` +
                `render  ${fmt(t.render)} ms`;
        }
    }
}

builder.renderer.setAnimationLoop(animate);

// ─────────────────────────────────────────────
//  Background-tab flicker fix
//  Browsers throttle / suspend rAF when the tab is hidden, so when the
//  user returns the first frame can flash stale render-target / PP
//  ping-pong contents. Hard-stop the loop on hide and reattach on show.
//  Skipped while the preset thumbnail generator is mid-flight — it owns
//  the loop and will re-attach in its `finally`.
// ─────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
    if (_thumbGenInProgress) return;
    if (document.hidden) {
        builder.renderer.setAnimationLoop(null);
    } else {
        builder.renderer.setAnimationLoop(animate);
    }
});

// ─────────────────────────────────────────────
//  Command palette  (Ctrl+K / Cmd+K)
//  Fuzzy-filtered list of every reachable action — file menu items,
//  tab switches, theme presets, layers, objects in the current layer.
// ─────────────────────────────────────────────
function _cmdFuzzyMatch(query, text) {
    if (!query) return true;
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    // 1. exact substring wins
    if (t.includes(q)) return true;
    // 2. otherwise: every char of q appears in t in order
    let qi = 0;
    for (let i = 0; i < t.length && qi < q.length; i++) {
        if (t[i] === q[qi]) qi++;
    }
    return qi === q.length;
}

function _buildCommandList() {
    const cmds = [];
    const add = (group, label, run) => cmds.push({ group, label, run });

    add('File', 'New Project',         () => document.getElementById('file-new')?.click());
    add('File', 'Open Project…',       () => document.getElementById('file-open')?.click());
    add('File', 'Save Project',        () => document.getElementById('file-save')?.click());
    add('File', 'Load Preset…',        () => showPresetPicker({ canDismiss: true }));
    add('File', 'Resources…',          () => showResourcesPopup());
    add('Help', 'About',               () => document.getElementById('about-btn')?.click());
    add('Help', 'Open Documentation',  () => window.open('docs/', '_blank', 'noopener'));

    THEME_NAMES.forEach(n => add('Theme', `Apply theme: ${n}`, () => applyThemeByName(n)));

    builder.layers.forEach(l => add('Layer', `Select layer: ${l.name}`,
        () => { selectLayer(l); switchTab('oe'); }));

    const layer = currentSelectedLayerId
        ? builder.layers.find(l => l.id === currentSelectedLayerId) : null;
    if (layer) {
        layer.objects.forEach(o => add('Object', `Select object: ${o.name}`,
            () => { selectObject(o, layer); switchTab('oe'); }));
    }

    return cmds;
}

function showCommandPalette() {
    if (document.getElementById('cmd-palette-bg')) return;

    const cmds = _buildCommandList();

    const bg = document.createElement('div');
    bg.className = 'popup-bg cmd-palette-bg';
    bg.id = 'cmd-palette-bg';

    const panel = document.createElement('div');
    panel.className = 'cmd-palette';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cmd-palette-input';
    input.placeholder = 'Type to filter — ↑↓ navigate, Enter run, Esc close';

    const list = document.createElement('div');
    list.className = 'cmd-palette-list';

    panel.appendChild(input);
    panel.appendChild(list);
    bg.appendChild(panel);

    let filtered = cmds.slice();
    let selected = 0;

    const close = () => bg.remove();

    const updateSelection = () => {
        const rows = list.querySelectorAll('.cmd-palette-row');
        rows.forEach((el, i) => el.classList.toggle('selected', i === selected));
        const selEl = rows[selected];
        if (selEl) selEl.scrollIntoView({ block: 'nearest' });
    };

    const render = () => {
        list.innerHTML = '';
        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'cmd-palette-empty';
            empty.textContent = 'No matches';
            list.appendChild(empty);
            return;
        }
        filtered.forEach((c, i) => {
            const row = document.createElement('div');
            row.className = 'cmd-palette-row';
            if (i === selected) row.classList.add('selected');
            const g = document.createElement('span');
            g.className = 'cmd-palette-group';
            g.textContent = c.group;
            const lbl = document.createElement('span');
            lbl.className = 'cmd-palette-label';
            lbl.textContent = c.label;
            row.appendChild(g);
            row.appendChild(lbl);
            row.addEventListener('mouseenter', () => { selected = i; updateSelection(); });
            row.addEventListener('mousedown',  (e) => {
                e.preventDefault(); // keep focus in input
                c.run(); close();
            });
            list.appendChild(row);
        });
    };

    const filter = () => {
        const q = input.value.trim();
        filtered = cmds.filter(c => _cmdFuzzyMatch(q, c.label) || _cmdFuzzyMatch(q, c.group));
        selected = 0;
        render();
    };

    input.addEventListener('input', filter);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (filtered.length === 0) return;
            selected = (selected + 1) % filtered.length;
            updateSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (filtered.length === 0) return;
            selected = (selected - 1 + filtered.length) % filtered.length;
            updateSelection();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const c = filtered[selected];
            if (c) { c.run(); close(); }
        }
    });

    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    document.body.appendChild(bg);

    render();
    setTimeout(() => input.focus(), 0);
}

window.addEventListener('keydown', (e) => {
    // Don't trigger when typing into a form control or another popup is open
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    if (document.querySelector('.popup-bg')) return;

    const ctrlK = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
        && e.key.toLowerCase() === 'k';
    const bareSpace = e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
    if (ctrlK || bareSpace) {
        e.preventDefault();
        showCommandPalette();
    }
});

// ─────────────────────────────────────────────
//  Delete shortcut — removes the currently active element based on the
//  active editor tab. Object Editor: selected object > selected non-base
//  layer. Post Processing: selected PP layer. Background layer is never
//  delete-able (it's structural).
// ─────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete') return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    if (document.querySelector('.popup-bg')) return;

    if (currentTab === 'pp') {
        const sel = document.querySelector('#pp-layer-list .list-button.selected');
        const id  = sel?.dataset.ppLayerId;
        if (!id) return;
        const ctx = getPPContext();
        if (!ctx) return;
        ctx.layers = ctx.layers.filter(l => l.id !== id);
        ctx.pipeline.layers = ctx.layers;
        if (ppContextId !== 'global' && ctx.layers.length === 0) {
            builder.setLayerPPPipeline(ppContextId, null);
        }
        renderPPLayerList();
        document.getElementById('pp-layer-properties').innerHTML = '';
        saveAllToDB();
        e.preventDefault();
        return;
    }

    // Object Editor (and Animation falls through to the same selection)
    if (selectedObject) {
        const layer = builder.layers.find(l => l.objects?.some(o => o.id === selectedObject.id));
        if (!layer) return;
        const id = selectedObject.id;
        selectedObject = null;
        document.getElementById('object-properties').innerHTML = '';
        builder.removeObjectFromLayer(layer.id, id);
        renderObjectList(layer);
        saveAllToDB();
        e.preventDefault();
        return;
    }

    if (currentSelectedLayerId) {
        const layer = builder.layers.find(l => l.id === currentSelectedLayerId);
        if (!layer || layer.isBase) return; // base is structural, never deleted
        builder.removeLayer(layer.id);
        currentSelectedLayerId = null;
        selectedObject = null;
        document.getElementById('object-properties').innerHTML = '';
        document.getElementById('object-list').innerHTML = '';
        renderLayerList();
        saveAllToDB();
        e.preventDefault();
    }
});