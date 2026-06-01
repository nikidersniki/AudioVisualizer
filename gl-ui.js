import { GoldenLayout, LayoutConfig } from 'https://cdn.jsdelivr.net/npm/golden-layout@2.6.0/+esm';

(function () {
    const MOBILE_MQ = window.matchMedia('(max-width: 768px)');
    if (MOBILE_MQ.matches) return;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        const GL = GoldenLayout;
        if (!GL) { console.error('Golden Layout not loaded'); return; }

        window.__GL_ACTIVE__ = true;
        document.body.classList.add('gl-mode');

        const stash = document.createElement('div');
        stash.id = 'gl-stash';
        stash.style.display = 'none';
        document.body.appendChild(stash);

        // ── Build hosts (rent existing nodes) ─────────────
        const canvas    = document.getElementById('three-canvas');
        const dragDrop  = document.getElementById('drag-drop');
        const controlls = document.getElementById('controlls');
        const layers    = document.getElementById('layers');
        const objList   = document.getElementById('object-list');
        const addBtns   = document.getElementById('layerTopButtons');
        const objEditor = document.getElementById('current-layer-controls');
        const ppSection = document.getElementById('pp-section');
        const animSec   = document.getElementById('anim-section');
        const audioMon  = document.getElementById('audio-monitor');
        const keyMap    = document.getElementById('key-map');
        const player    = document.getElementById('player');
        const progress  = document.getElementById('progress-bar-container');
        const nowPlay   = document.getElementById('now-playing');
        const editorSwitch = document.getElementById('editorSwitch');
        if (editorSwitch) editorSwitch.style.display = 'none';

        // Always show all editor sections — independent windows now
        if (objEditor) objEditor.style.display = '';
        if (ppSection) ppSection.style.display = '';
        if (animSec)   animSec.style.display = '';
        if (audioMon)  audioMon.style.display = '';
        if (keyMap)    keyMap.style.display = '';
        if (layers)    layers.style.display = '';

        // Viewport host: canvas wrapped in a frame so it can be letterboxed for fixed aspect
        const viewportHost = document.createElement('div');
        viewportHost.id = 'viewport-host';
        const viewportFrame = document.createElement('div');
        viewportFrame.id = 'viewport-frame';
        if (canvas)  viewportFrame.appendChild(canvas);
        viewportHost.appendChild(viewportFrame);
        if (dragDrop) viewportHost.appendChild(dragDrop);
        const gizmoSwitch = document.getElementById('gizmo-mode-switch');
        if (gizmoSwitch) viewportHost.appendChild(gizmoSwitch);

        // Fullscreen toggle — overlays the viewport. In fullscreen the gizmo
        // overlay (TransformControls) and gizmo-mode chip are hidden so the
        // render is clean. Esc / native exit triggers `fullscreenchange`.
        const fsBtn = document.createElement('div');
        fsBtn.id = 'viewport-fullscreen-btn';
        fsBtn.className = 'viewport-overlay-btn';
        fsBtn.title = 'Fullscreen viewport';
        fsBtn.textContent = '⛶';
        fsBtn.addEventListener('click', () => {
            const inFs = document.fullscreenElement === viewportHost;
            if (inFs) document.exitFullscreen?.();
            else      viewportHost.requestFullscreen?.();
        });
        viewportHost.appendChild(fsBtn);
        document.addEventListener('fullscreenchange', () => {
            const active = document.fullscreenElement === viewportHost;
            viewportHost.classList.toggle('viewport-fullscreen', active);
            const sb = window.__SCENE_BUILDER__;
            sb?.setGizmoVisible?.(!active);
            fsBtn.textContent = active ? '⤬' : '⛶';
        });

        // Outliner host: layers + add-object buttons + object-list (the latter
        // two are plucked out of #current-layer-controls).
        const outlinerHost = document.createElement('div');
        outlinerHost.id = 'outliner-host';
        if (layers)  outlinerHost.appendChild(layers);
        if (addBtns) outlinerHost.appendChild(addBtns);
        if (objList) outlinerHost.appendChild(objList);

        // Progress host: now-playing + progress bar container
        const progressHost = document.createElement('div');
        progressHost.id = 'progress-host';
        if (nowPlay)  progressHost.appendChild(nowPlay);
        if (progress) progressHost.appendChild(progress);

        [viewportHost, outlinerHost, objEditor, ppSection, animSec, audioMon, keyMap, player, progressHost, controlls]
            .filter(Boolean).forEach(h => stash.appendChild(h));

        // ── Component definitions ─────────────────────────
        const COMPONENTS = {
            'viewport':        { title: 'Viewport',        hostId: 'viewport-host' },
            'saved-tracks':    { title: 'Audio Input',    hostId: 'player' },
            'outliner':        { title: 'Outliner',        hostId: 'outliner-host' },
            'object-editor':   { title: 'Object Editor',   hostId: 'current-layer-controls' },
            'post-processing': { title: 'Post Processing', hostId: 'pp-section' },
            'animation':       { title: 'Animation',       hostId: 'anim-section' },
            'audio-monitor':   { title: 'Audio Monitor',   hostId: 'audio-monitor' },
            'key-map':         { title: 'Key Map',         hostId: 'key-map' },
            'progress-bar':    { title: 'Player',          hostId: 'progress-host' },
            'settings':        { title: 'Settings',        hostId: 'controlls' }
        };

        const glContainer = document.getElementById('gl-container');
        const layout = new GL(glContainer);

        const onContainerEvent = (container, event, fn) => {
            if (typeof container.on === 'function')                container.on(event, fn);
            else if (typeof container.addEventListener === 'function') container.addEventListener(event, fn);
        };

        Object.entries(COMPONENTS).forEach(([type, info]) => {
            layout.registerComponentFactoryFunction(type, (container) => {
                const host = document.getElementById(info.hostId);
                if (host) {
                    container.element.classList.add('gl-host-wrapper');
                    container.element.appendChild(host);
                }
                const release = () => {
                    const h = document.getElementById(info.hostId);
                    if (h && h.isConnected) {
                        const ancestor = h.closest('#gl-stash');
                        if (!ancestor) stash.appendChild(h);
                    } else if (h) {
                        stash.appendChild(h);
                    }
                };
                onContainerEvent(container, 'destroy', release);
                onContainerEvent(container, 'beforeComponentRelease', release);
            });
        });

        const SAVE_KEY = 'gl-layout-v12';

        // Defensive: drop any component nodes whose componentType is no longer
        // registered (e.g. removed entries like 'project-settings'). GL v2
        // throws when asked to instantiate an unknown component, which would
        // leave the whole page half-initialised.
        const _validTypes = new Set(Object.keys(COMPONENTS));
        const _stripUnknownComponents = (node) => {
            if (!node || typeof node !== 'object') return node;
            // GL config has a `root` wrapper — recurse into it
            if (node.root) node.root = _stripUnknownComponents(node.root);
            if (Array.isArray(node.content)) {
                node.content = node.content
                    .map(_stripUnknownComponents)
                    .filter(child => {
                        if (!child || typeof child !== 'object') return false;
                        if (child.type === 'component') {
                            const t = child.componentType ?? child.componentName;
                            return !t || _validTypes.has(t);
                        }
                        return true;
                    });
            }
            return node;
        };

        // Filter duplicate component entries from a layout config before load.
        // Each component type hosts a single shared DOM node, so two instances
        // would fight over the same host. Keep the first occurrence in tree
        // order; drop subsequent ones (then collapse empty stacks/rows/cols).
        const _dedupeComponents = (cfg) => {
            if (!cfg || typeof cfg !== 'object') return cfg;
            const seen = new Set();
            const walk = (node) => {
                if (!node || typeof node !== 'object') return node;
                if (Array.isArray(node.content)) {
                    node.content = node.content
                        .map(child => {
                            if (child?.type === 'component') {
                                const t = child.componentType ?? child.componentName;
                                if (t && seen.has(t)) return null;
                                if (t) seen.add(t);
                                return child;
                            }
                            return walk(child);
                        })
                        .filter(Boolean)
                        // drop now-empty stacks/rows/columns
                        .filter(child => !(['stack', 'row', 'column'].includes(child.type)
                                           && (!Array.isArray(child.content) || child.content.length === 0)));
                }
                return node;
            };
            if (cfg.root) cfg.root = walk(cfg.root);
            return cfg;
        };

        // GL v2 saveLayout returns a ResolvedLayoutConfig (with numeric `size`)
        // while loadLayout always expects an unresolved LayoutConfig (string `size`).
        // Convert before loading so JSON-persisted snapshots round-trip cleanly.
        const _maybeUnresolve = (cfg) => {
            if (!cfg || typeof cfg !== 'object') return cfg;
            const isResolved = cfg.resolved === true || (cfg.root && typeof cfg.root.size === 'number');
            if (isResolved && LayoutConfig?.fromResolved) {
                try { return LayoutConfig.fromResolved(cfg); } catch { return cfg; }
            }
            return cfg;
        };
        const defaultLayout = {
            settings: {
                showPopoutIcon: false,
                showMaximiseIcon: false,
                showCloseIcon: true
            },
            root: {
                type: 'row',
                content: [
                    {
                        type: 'column',
                        content: [
                            { type: 'component', componentType: 'outliner',     title: 'Outliner' },
                            { type: 'component', componentType: 'saved-tracks', title: 'Audio Input' }
                        ]
                    },
                    {
                        type: 'column',
                        content: [
                            { type: 'component', componentType: 'viewport',     title: 'Viewport' },
                            { type: 'component', componentType: 'progress-bar', title: 'Player' }
                        ]
                    },
                    {
                        type: 'column',
                        content: [
                            { type: 'stack', content: [
                                { type: 'component', componentType: 'object-editor',   title: 'Object Editor' },
                                { type: 'component', componentType: 'post-processing', title: 'Post Processing' },
                                { type: 'component', componentType: 'animation',       title: 'Animation' }
                            ]},
                            { type: 'component', componentType: 'settings', title: 'Settings' }
                        ]
                    }
                ]
            }
        };

        const findComponentsByType = (type) => {
            // GL v2 ContentItem.getItemsByType may not exist on layout.rootItem in
            // every edge case; fall back to walking the tree.
            const root = layout.rootItem;
            if (!root) return [];
            const out = [];
            const walk = (n) => {
                if (!n) return;
                const t = n.componentType ?? n.componentName;
                if (n.isComponent && t === type) out.push(n);
                const kids = n.contentItems ?? n.content ?? [];
                for (const c of kids) walk(c);
            };
            walk(root);
            return out;
        };

        const focusExisting = (item) => {
            const stack = item?.parentItem;
            if (stack?.setActiveContentItem) {
                try { stack.setActiveContentItem(item); } catch {}
            }
        };

        // Gate every component-creation path through this check. Wrapping
        // addComponent covers Windows menu, programmatic adds, and any GL
        // drag-to-create path that flows through the public API.
        const _origAddComponent = layout.addComponent?.bind(layout);
        if (_origAddComponent) {
            layout.addComponent = function (type, state, title) {
                const dupes = findComponentsByType(type);
                if (dupes.length > 0) {
                    focusExisting(dupes[0]);
                    return dupes[0];
                }
                return _origAddComponent(type, state, title);
            };
        }

        // Runtime safety net: if a component slips in through a path the wrap
        // missed (raw addItem, drag-from-tab-bar), nuke the duplicate.
        let _isLoadingLayout = true;
        const onItemCreated = (event) => {
            const item = event?.target ?? event?.item ?? event;
            if (!item || !item.isComponent) return;
            const type = item.componentType ?? item.componentName;
            if (!type) return;
            queueMicrotask(() => {
                const dupes = findComponentsByType(type);
                if (dupes.length <= 1) return;
                // Keep the first instance, drop the rest
                const keep = dupes[0];
                for (let i = 1; i < dupes.length; i++) {
                    const dup = dupes[i];
                    try { dup.parentItem?.removeChild?.(dup); }
                    catch { try { dup.remove?.(); } catch {} }
                }
                focusExisting(keep);
                if (_isLoadingLayout) return;
                const title = COMPONENTS[type]?.title ?? type;
                notifyPopup(`Only one "${title}" window can exist.`);
            });
        };
        // GL v2 LayoutManager extends EventEmitter — addEventListener is an
        // alias of on(). Register via addEventListener to match the persist
        // listener loop below (registering on both would double-fire).
        if (typeof layout.addEventListener === 'function') {
            layout.addEventListener('itemCreated', onItemCreated);
        } else if (typeof layout.on === 'function') {
            layout.on('itemCreated', onItemCreated);
        }

        const saved = localStorage.getItem(SAVE_KEY);
        let toLoad = defaultLayout;
        if (saved) {
            try { toLoad = JSON.parse(saved); } catch { toLoad = defaultLayout; }
        }
        let _bootRecovered = false;
        try { layout.loadLayout(_dedupeComponents(_stripUnknownComponents(_maybeUnresolve(toLoad)))); }
        catch (e) {
            console.warn('saved layout invalid, loading default', e);
            try { layout.loadLayout(_dedupeComponents(defaultLayout)); } catch (e2) { console.error(e2); }
            try { localStorage.removeItem(SAVE_KEY); } catch {}
            _bootRecovered = true;
        }
        queueMicrotask(() => {
            _isLoadingLayout = false;
            // Force a persist after recovery so the project DB and localStorage
            // get overwritten with a valid snapshot ASAP.
            if (_bootRecovered) persist();
        });

        let _persistTimer = 0;
        const persist = () => {
            if (_isLoadingLayout) return;
            let resolved = null;
            try { resolved = layout.saveLayout(); } catch {}
            if (!resolved) return;
            // Convert resolved config (numeric sizes) back to input config (string sizes)
            // so loadLayout can re-parse it without crashing on numeric `size`.
            let inputCfg = resolved;
            try {
                if (LayoutConfig?.fromResolved) inputCfg = LayoutConfig.fromResolved(resolved);
            } catch {}
            window.__GL_LAYOUT_JSON__ = inputCfg;
            try { localStorage.setItem(SAVE_KEY, JSON.stringify(inputCfg)); } catch {}
            window.dispatchEvent(new CustomEvent('gl-layout-changed'));
        };
        const persistDebounced = () => {
            clearTimeout(_persistTimer);
            _persistTimer = setTimeout(persist, 250);
        };
        ['stateChanged', 'itemCreated', 'itemDestroyed', 'activeContentItemChanged', 'tabCreated', 'rowCreated', 'columnCreated', 'stackCreated']
            .forEach(ev => layout.addEventListener?.(ev, persistDebounced));

        // Prepend a type-matched icon to each GL tab header
        const decorateTab = (event) => {
            const tab = event?.target ?? event?.tab ?? event;
            if (!tab) return;
            const el = tab.element ?? tab._element;
            if (!el) return;
            const ci = tab.componentItem ?? tab.contentItem;
            const type = ci?.componentType ?? ci?.componentName;
            if (!type) return;
            // Avoid double-insertion on re-decorate
            if (el.querySelector('.lm_tab_icon')) return;
            const titleEl = el.querySelector('.lm_title') ?? el;
            const icon = document.createElement('span');
            icon.className = `lm_tab_icon menu-icon-${type}`;
            titleEl.parentNode.insertBefore(icon, titleEl);
        };
        if (typeof layout.addEventListener === 'function') {
            layout.addEventListener('tabCreated', decorateTab);
        } else if (typeof layout.on === 'function') {
            layout.on('tabCreated', decorateTab);
        }
        // tabCreated only fires going forward; sweep tabs created during the
        // initial loadLayout (which ran before this listener was attached).
        const decorateExistingTabs = () => {
            const visit = (n) => {
                if (!n) return;
                const tabs = n.header?.tabs;
                if (Array.isArray(tabs)) tabs.forEach(decorateTab);
                const kids = n.contentItems ?? n.content ?? [];
                for (const c of kids) visit(c);
            };
            visit(layout.rootItem);
        };
        queueMicrotask(decorateExistingTabs);
        // Also re-sweep after applyGLLayout etc.
        window.addEventListener('gl-layout-changed', () => queueMicrotask(decorateExistingTabs));
        window.addEventListener('beforeunload', persist);
        window.addEventListener('pagehide', persist);

        const resize = () => {
            const r = glContainer.getBoundingClientRect();
            layout.setSize(r.width, r.height);
        };
        window.addEventListener('resize', resize);
        resize();

        // Force a renderer recompute after layout settles — fixes initial dark-canvas glitch
        requestAnimationFrame(() => {
            resize();
            window.dispatchEvent(new Event('resize'));
        });

        // ── Windows menu ──────────────────────────────────
        setupWindowsMenu(layout, COMPONENTS);

        // ── Viewport aspect ratio ─────────────────────────
        const ASPECTS = {
            '16:9': 16/9, '9:16': 9/16, '4:3': 4/3, '3:4': 3/4, '21:9': 21/9, '1:1': 1
        };
        const VP_FIXED_KEY  = 'gl-viewport-fixed';
        const VP_ASPECT_KEY = 'gl-viewport-aspect';
        let vpFixed  = localStorage.getItem(VP_FIXED_KEY) === '1';
        let vpAspect = localStorage.getItem(VP_ASPECT_KEY) || '16:9';

        const fixedToggle  = document.getElementById('viewport-fixed-toggle');
        const aspectSelect = document.getElementById('viewport-aspect-select');
        if (fixedToggle)  fixedToggle.checked = vpFixed;
        if (aspectSelect) aspectSelect.value  = vpAspect;

        const applyViewportAspect = () => {
            const host  = document.getElementById('viewport-host');
            const frame = document.getElementById('viewport-frame');
            if (!host || !frame) return;
            const r = host.getBoundingClientRect();
            if (!vpFixed || !ASPECTS[vpAspect]) {
                frame.style.left = '0';
                frame.style.top  = '0';
                frame.style.width  = '100%';
                frame.style.height = '100%';
                window.dispatchEvent(new Event('resize'));
                return;
            }
            const ratio = ASPECTS[vpAspect];
            let w = r.width, h = r.height;
            if (w / h > ratio) w = h * ratio;
            else               h = w / ratio;
            frame.style.left   = ((r.width  - w) / 2) + 'px';
            frame.style.top    = ((r.height - h) / 2) + 'px';
            frame.style.width  = w + 'px';
            frame.style.height = h + 'px';
            window.dispatchEvent(new Event('resize'));
        };

        fixedToggle?.addEventListener('change', () => {
            vpFixed = !!fixedToggle.checked;
            localStorage.setItem(VP_FIXED_KEY, vpFixed ? '1' : '0');
            applyViewportAspect();
        });
        aspectSelect?.addEventListener('change', () => {
            vpAspect = aspectSelect.value;
            localStorage.setItem(VP_ASPECT_KEY, vpAspect);
            applyViewportAspect();
        });

        if (typeof ResizeObserver !== 'undefined') {
            const vpHost = document.getElementById('viewport-host');
            if (vpHost) new ResizeObserver(applyViewportAspect).observe(vpHost);
        }
        requestAnimationFrame(applyViewportAspect);

        // ── Debug HUD ─────────────────────────────────────
        const VP_DEBUG_KEY = 'gl-debug-hud';
        const debugToggle = document.getElementById('viewport-debug-toggle');
        const hud = document.createElement('div');
        hud.id = 'viewport-debug-hud';
        hud.style.display = 'none';
        viewportFrame.appendChild(hud);

        const setDebug = (on) => {
            hud.style.display = on ? 'block' : 'none';
            const sb = window.__SCENE_BUILDER__;
            if (sb) sb._debugEnabled = on;
            window.__DEBUG_HUD__ = on ? hud : null;
        };
        const initDbg = localStorage.getItem(VP_DEBUG_KEY) === '1';
        if (debugToggle) debugToggle.checked = initDbg;
        // SceneBuilder may not be on window yet; defer apply
        requestAnimationFrame(() => setDebug(initDbg));
        debugToggle?.addEventListener('change', () => {
            const on = !!debugToggle.checked;
            localStorage.setItem(VP_DEBUG_KEY, on ? '1' : '0');
            setDebug(on);
        });

        // Reset layout helper (exposed)
        window.resetLayout = () => {
            localStorage.removeItem(SAVE_KEY);
            location.reload();
        };

        // Apply a project-loaded layout (called from main.js on project load)
        window.applyGLLayout = (json) => {
            if (!json) return;
            _isLoadingLayout = true;
            try { layout.loadLayout(_dedupeComponents(_stripUnknownComponents(_maybeUnresolve(json)))); }
            catch (e) {
                console.warn('applyGLLayout failed (incompatible layout, keeping current)', e);
            }
            queueMicrotask(() => {
                _isLoadingLayout = false;
                persist(); // overwrite stored bad data with current (known-good) snapshot
            });
        };

        setupLayoutMenu();

        // Reload when crossing the mobile breakpoint so mobile-ui can take over
        MOBILE_MQ.addEventListener?.('change', () => location.reload());
    }

    function setupLayoutMenu() {
        const btn  = document.getElementById('layout-menu-btn');
        const list = document.getElementById('layout-menu-list');
        if (!btn || !list) return;

        const buildMenu = () => {
            list.innerHTML = '';
            const reset = document.createElement('div');
            reset.className = 'windows-menu-item';
            const resetIcon = document.createElement('span');
            resetIcon.className = 'windows-menu-icon menu-icon-reset';
            reset.appendChild(resetIcon);
            reset.appendChild(document.createTextNode('Reset Layout'));
            reset.addEventListener('click', (ev) => {
                ev.stopPropagation();
                list.classList.remove('open');
                window.resetLayout?.();
            });
            list.appendChild(reset);
        };

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            buildMenu();
            list.classList.toggle('open');
        });
        document.addEventListener('click', () => list.classList.remove('open'));
    }

    function notifyPopup(message) {
        const bg = document.createElement('div');
        bg.className = 'popup-bg';
        const popup = document.createElement('div');
        popup.className = 'popup';
        const title = document.createElement('div');
        title.className = 'h1 popup-title-text';
        title.textContent = message;
        const ok = document.createElement('div');
        ok.className = 'big-Btn';
        ok.textContent = 'OK';
        const buttonBox = document.createElement('div');
        buttonBox.classList.add('popup-button-box');
        buttonBox.appendChild(ok);
        popup.appendChild(title);
        popup.appendChild(buttonBox);
        bg.appendChild(popup);
        const close = () => bg.remove();
        ok.addEventListener('click', close);
        bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
        document.body.appendChild(bg);
    }

    function setupWindowsMenu(layout, components) {
        const btn  = document.getElementById('windows-menu-btn');
        const list = document.getElementById('windows-menu-list');
        if (!btn || !list) return;

        const findComponents = (type) => {
            const items = layout.rootItem ? layout.rootItem.getItemsByType?.('component') ?? [] : [];
            return items.filter(i => (i.componentType ?? i.componentName) === type);
        };

        const buildMenu = () => {
            list.innerHTML = '';
            Object.entries(components).forEach(([type, info]) => {
                const open = findComponents(type).length > 0;
                const row = document.createElement('div');
                row.className = 'windows-menu-item' + (open ? ' is-open' : '');
                const icon = document.createElement('span');
                icon.className = `windows-menu-icon menu-icon-${type}`;
                row.appendChild(icon);
                row.appendChild(document.createTextNode((open ? '✓ ' : '') + info.title));
                row.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const existing = findComponents(type)[0];
                    if (existing) {
                        const stack = existing.parentItem;
                        if (stack && stack.setActiveContentItem) stack.setActiveContentItem(existing);
                    } else {
                        try { layout.addComponent(type, undefined, info.title); }
                        catch (e) { console.warn('addComponent failed', e); }
                    }
                    buildMenu();
                });
                list.appendChild(row);
            });

        };

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            buildMenu();
            list.classList.toggle('open');
        });
        document.addEventListener('click', () => list.classList.remove('open'));
    }
})();
