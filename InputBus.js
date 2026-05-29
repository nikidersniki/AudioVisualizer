// ─────────────────────────────────────────────
//  InputBus
//  Unified runtime input state for keyboard + Web MIDI.
//
//  Two kinds of input:
//    • Triggers  (keys, MIDI notes, MIDI CC buttons) → held / toggle state,
//      queried by PropertyBinding key overrides via isActive(id, trigger).
//    • Continuous (MIDI CC knobs/faders) → 0..1 values, queried via
//      ccValue(id) and usable as a "sampled" override source.
//
//  Trigger / source ids are layout-independent strings:
//    'key:KeyA'  'midi:note:36'  'midi:cc:7'
// ─────────────────────────────────────────────
class InputBus {
    constructor() {
        this._held    = new Set();   // trigger ids currently down
        this._toggles = new Map();   // trigger id -> bool (flips on each down)
        this._cc      = new Map();   // cc id -> 0..1
        this._ccSeen  = new Set();   // cc ids ever observed (for source dropdowns)
        this._learnCb = null;        // one-shot fn(id) for next input
        this._listeners = new Set(); // change subscribers (midi connect / new cc)
        this._midiAccess = null;
        this._initKeyboard();
    }

    // ── Trigger query ──────────────────────────
    isActive(id, trigger) {
        if (!id) return false;
        if (trigger === 'toggle') return this._toggles.get(id) === true;
        return this._held.has(id); // 'hold'
    }

    // ── Continuous query (0..1) ────────────────
    ccValue(id) { return this._cc.get(id) ?? 0; }

    // ── MIDI-learn: capture the next input id ──
    startLearn(cb) { this._learnCb = cb; }
    cancelLearn()  { this._learnCb = null; }
    isLearning()   { return !!this._learnCb; }

    _emitLearn(id) {
        if (!this._learnCb) return false;
        const cb = this._learnCb;
        this._learnCb = null;
        cb(id);
        return true;
    }

    _down(id) {
        if (this._emitLearn(id)) return;   // consumed by learn — don't change state
        if (!this._held.has(id)) {
            this._held.add(id);
            this._toggles.set(id, !this._toggles.get(id));
        }
    }
    _up(id) { this._held.delete(id); }

    // ── Keyboard ───────────────────────────────
    _initKeyboard() {
        const typing = (t) => t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            if (typing(e.target)) return;
            this._down('key:' + e.code);
        });
        window.addEventListener('keyup', (e) => {
            if (typing(e.target)) return;
            this._up('key:' + e.code);
        });
        // Held keys would otherwise stick if focus is lost mid-press.
        window.addEventListener('blur', () => this._held.clear());
    }

    // ── Web MIDI ───────────────────────────────
    async enableMIDI() {
        if (this._midiAccess) return true;
        if (!navigator.requestMIDIAccess) return false;
        try {
            const access = await navigator.requestMIDIAccess({ sysex: false });
            this._midiAccess = access;
            const bind = (input) => { input.onmidimessage = (m) => this._onMIDI(m); };
            access.inputs.forEach(bind);
            access.onstatechange = (e) => {
                if (e.port?.type === 'input' && e.port?.state === 'connected') bind(e.port);
                this._notify();
            };
            this._notify();
            return true;
        } catch (e) {
            console.warn('MIDI access denied / unavailable', e);
            return false;
        }
    }
    midiEnabled()  { return !!this._midiAccess; }
    midiSupported() { return !!navigator.requestMIDIAccess; }

    _onMIDI(msg) {
        const [status, d1, d2] = msg.data;
        const cmd = status & 0xf0;
        if (cmd === 0x90 && d2 > 0) {                       // note on
            this._down(`midi:note:${d1}`);
        } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) { // note off
            this._up(`midi:note:${d1}`);
        } else if (cmd === 0xb0) {                          // control change
            const id = `midi:cc:${d1}`;
            this._cc.set(id, d2 / 127);
            if (!this._ccSeen.has(id)) { this._ccSeen.add(id); this._notify(); }
            // Drive trigger state too — many controllers send button presses as CC 127/0.
            if (d2 >= 64) this._down(id); else this._up(id);
        }
    }

    knownCCs() { return [...this._ccSeen]; }

    // ── Change subscription (UI refresh on connect / new cc) ──
    onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
    _notify() { for (const fn of this._listeners) { try { fn(); } catch {} } }
}

export const inputBus = new InputBus();
