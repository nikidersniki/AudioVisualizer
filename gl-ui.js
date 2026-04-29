import { GoldenLayout } from 'https://cdn.jsdelivr.net/npm/golden-layout@2.6.0/+esm';

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
        const projSet   = document.getElementById('project-settings');
        const layers    = document.getElementById('layers');
        const objList   = document.getElementById('object-list');
        const objEditor = document.getElementById('current-layer-controls');
        const ppSection = document.getElementById('pp-section');
        const animSec   = document.getElementById('anim-section');
        const player    = document.getElementById('player');
        const progress  = document.getElementById('progress-bar-container');
        const nowPlay   = document.getElementById('now-playing');
        const editorSwitch = document.getElementById('editorSwitch');
        if (editorSwitch) editorSwitch.style.display = 'none';

        // Always show all editor sections — independent windows now
        if (objEditor) objEditor.style.display = '';
        if (ppSection) ppSection.style.display = '';
        if (animSec)   animSec.style.display = '';
        if (layers)    layers.style.display = '';

        // Viewport host: canvas wrapped in a frame so it can be letterboxed for fixed aspect
        const viewportHost = document.createElement('div');
        viewportHost.id = 'viewport-host';
        const viewportFrame = document.createElement('div');
        viewportFrame.id = 'viewport-frame';
        if (canvas)  viewportFrame.appendChild(canvas);
        viewportHost.appendChild(viewportFrame);
        if (dragDrop) viewportHost.appendChild(dragDrop);

        // Outliner host: layers + object-list (object-list is plucked out of #current-layer-controls)
        const outlinerHost = document.createElement('div');
        outlinerHost.id = 'outliner-host';
        if (layers)  outlinerHost.appendChild(layers);
        if (objList) outlinerHost.appendChild(objList);

        // Progress host: now-playing + progress bar container
        const progressHost = document.createElement('div');
        progressHost.id = 'progress-host';
        if (nowPlay)  progressHost.appendChild(nowPlay);
        if (progress) progressHost.appendChild(progress);

        [viewportHost, outlinerHost, objEditor, ppSection, animSec, player, progressHost, controlls, projSet]
            .filter(Boolean).forEach(h => stash.appendChild(h));

        // ── Component definitions ─────────────────────────
        const COMPONENTS = {
            'viewport':        { title: 'Viewport',        hostId: 'viewport-host' },
            'saved-tracks':    { title: 'Saved Tracks',    hostId: 'player' },
            'outliner':        { title: 'Outliner',        hostId: 'outliner-host' },
            'object-editor':   { title: 'Object Editor',   hostId: 'current-layer-controls' },
            'post-processing': { title: 'Post Processing', hostId: 'pp-section' },
            'animation':       { title: 'Animation',       hostId: 'anim-section' },
            'progress-bar':    { title: 'Player',          hostId: 'progress-host' },
            'settings':        { title: 'Settings',        hostId: 'controlls' },
            'project-settings':{ title: 'Project Settings', hostId: 'project-settings' }
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

        const SAVE_KEY = 'gl-layout-v8';
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
                        type: 'column', size: '20%',
                        content: [
                            { type: 'component', componentType: 'outliner',     title: 'Outliner' },
                            { type: 'component', componentType: 'saved-tracks', title: 'Saved Tracks' }
                        ]
                    },
                    {
                        type: 'column', size: '55%',
                        content: [
                            { type: 'component', componentType: 'viewport',     title: 'Viewport',     size: '75%' },
                            { type: 'component', componentType: 'progress-bar', title: 'Player', size: '25%' }
                        ]
                    },
                    {
                        type: 'column', size: '25%',
                        content: [
                            { type: 'stack', size: '70%', content: [
                                { type: 'component', componentType: 'object-editor',   title: 'Object Editor' },
                                { type: 'component', componentType: 'post-processing', title: 'Post Processing' },
                                { type: 'component', componentType: 'animation',       title: 'Animation' }
                            ]},
                            { type: 'stack', size: '30%', content: [
                                { type: 'component', componentType: 'settings',         title: 'Settings' },
                                { type: 'component', componentType: 'project-settings', title: 'Project Settings' }
                            ]}
                        ]
                    }
                ]
            }
        };

        const findComponentsByType = (type) => {
            const all = layout.rootItem?.getItemsByType?.('component') ?? [];
            return all.filter(i => (i.componentType ?? i.componentName) === type);
        };

        // Block duplicate components — only one window per type allowed
        let _isLoadingLayout = true;
        const onItemCreated = (event) => {
            const item = event?.target ?? event?.item ?? event;
            if (!item || !item.isComponent) return;
            const type = item.componentType ?? item.componentName;
            if (!type) return;
            queueMicrotask(() => {
                const dupes = findComponentsByType(type);
                if (dupes.length <= 1) return;
                try { item.parentItem?.removeChild?.(item); }
                catch (e) { try { item.remove?.(); } catch {} }
                if (_isLoadingLayout) return;
                const title = COMPONENTS[type]?.title ?? type;
                notifyPopup(`Only one "${title}" window can exist.`);
            });
        };
        layout.addEventListener?.('itemCreated', onItemCreated);

        const saved = localStorage.getItem(SAVE_KEY);
        let toLoad = defaultLayout;
        if (saved) {
            try { toLoad = JSON.parse(saved); } catch { toLoad = defaultLayout; }
        }
        try { layout.loadLayout(toLoad); }
        catch (e) { console.warn('saved layout invalid, loading default', e); layout.loadLayout(defaultLayout); }
        queueMicrotask(() => { _isLoadingLayout = false; });

        let _persistTimer = 0;
        const persist = () => {
            if (_isLoadingLayout) return;
            try { localStorage.setItem(SAVE_KEY, JSON.stringify(layout.saveLayout())); } catch {}
        };
        const persistDebounced = () => {
            clearTimeout(_persistTimer);
            _persistTimer = setTimeout(persist, 250);
        };
        ['stateChanged', 'itemCreated', 'itemDestroyed', 'activeContentItemChanged', 'tabCreated', 'rowCreated', 'columnCreated', 'stackCreated']
            .forEach(ev => layout.addEventListener?.(ev, persistDebounced));
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

        // Reset layout helper (exposed)
        window.resetLayout = () => {
            localStorage.removeItem(SAVE_KEY);
            location.reload();
        };

        // Reload when crossing the mobile breakpoint so mobile-ui can take over
        MOBILE_MQ.addEventListener?.('change', () => location.reload());
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
                row.textContent = (open ? '✓ ' : '   ') + info.title;
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

            const sep = document.createElement('div');
            sep.className = 'windows-menu-sep';
            list.appendChild(sep);

            const reset = document.createElement('div');
            reset.className = 'windows-menu-item';
            reset.textContent = '   Reset Layout';
            reset.addEventListener('click', (ev) => {
                ev.stopPropagation();
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
})();
