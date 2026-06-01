(function () {
    const MQ = window.matchMedia('(max-width: 768px)');

    // Windows the user can pin as tabs in the mobile drawer.
    const PINNABLE = [
        { id: 'controlls',              title: 'Settings'         },
        { id: 'player',                 title: 'Audio Input'      },
        { id: 'current-layer-controls', title: 'Object Editor'    },
        { id: 'pp-section',             title: 'Post Processing'  },
        { id: 'anim-section',           title: 'Animation'        },
        { id: 'layers',                 title: 'Layers'           },
        { id: 'audio-monitor',          title: 'Audio Monitor'    },
        { id: 'key-map',                title: 'Key Map'          },
    ];
    const STORAGE_KEY = 'mobile-pinned-v4';
    const DEFAULT_PINNED = [
        'controlls',
        'current-layer-controls',
        'pp-section',
        'anim-section',
        'player',
    ];

    // Vertical area at the top of the viewport reserved for the gizmo
    // controls — the canvas never extends above this and the drawer rises up
    // to just below it in the open state.
    const TOP_OFFSET = 42;

    let drawer, handle, tabBar, body, headerSlot, topSlot, addBtn, pinMenu;
    let drawerState = 'closed'; // 'closed' | 'half' | 'open'
    let pinned = new Set();
    let activeTab = null;

    // Placeholders so DOM nodes can be put back when leaving mobile mode.
    const hostPlaceholders = new Map(); // hostId -> Comment
    let headerPlaceholder = null;

    function loadPinned() {
        try {
            const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (Array.isArray(s) && s.length)
                pinned = new Set(s.filter(id => PINNABLE.some(w => w.id === id)));
            else
                pinned = new Set(DEFAULT_PINNED);
        } catch { pinned = new Set(DEFAULT_PINNED); }
        if (pinned.size === 0) pinned = new Set(DEFAULT_PINNED);
    }
    function savePinned() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...pinned])); } catch {}
    }

    function build() {
        if (drawer) return;
        loadPinned();
        activeTab = pinned.has('controlls') ? 'controlls' : [...pinned][0];

        drawer = document.createElement('div');
        drawer.id = 'mobile-drawer';
        drawer.innerHTML = `
            <div id="drawer-handle"><div class="drawer-grip"></div></div>
            <div id="drawer-header-slot"></div>
            <div id="drawer-top-slot"></div>
            <div id="drawer-tabs-bar">
                <div id="drawer-tabs"></div>
                <div id="drawer-add-tab" title="Pin / unpin windows">+</div>
            </div>
            <div id="drawer-body"></div>
            <div id="drawer-pin-menu"></div>
        `;
        document.body.appendChild(drawer);

        handle     = drawer.querySelector('#drawer-handle');
        headerSlot = drawer.querySelector('#drawer-header-slot');
        topSlot    = drawer.querySelector('#drawer-top-slot');
        tabBar     = drawer.querySelector('#drawer-tabs');
        body       = drawer.querySelector('#drawer-body');
        pinMenu    = drawer.querySelector('#drawer-pin-menu');
        addBtn     = drawer.querySelector('#drawer-add-tab');
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            renderPinMenu();
            pinMenu.classList.toggle('open');
        });

        handle.addEventListener('click', cycleState);

        // Drawer drag (touch + mouse). Snaps to nearest of three rest
        // positions on release: closed (peek), half, open.
        let startY = 0, startState = 'closed', dragging = false, deltaY = 0;
        const onStart = (e) => {
            dragging = true;
            startY = (e.touches ? e.touches[0].clientY : e.clientY);
            startState = drawerState;
            drawer.style.transition = 'none';
        };
        const onMove = (e) => {
            if (!dragging) return;
            const y = (e.touches ? e.touches[0].clientY : e.clientY);
            deltaY = y - startY;
            const h = drawer.offsetHeight;
            const peek = peekHeight();
            const baseTranslate = stateTranslate(startState);
            let t = baseTranslate + deltaY;
            t = Math.max(0, Math.min(h - peek, t));
            drawer.style.transform = `translateY(${t}px)`;
            // Canvas does NOT update during the drag — only when the slider
            // snaps to its rest position in onEnd → setState.
        };
        const onEnd = () => {
            if (!dragging) return;
            dragging = false;
            drawer.style.transition = '';
            const h = drawer.offsetHeight;
            const peek = peekHeight();
            const currentT = Math.max(0, Math.min(h - peek, stateTranslate(startState) + deltaY));
            const targets = [
                { name: 'open',   t: 0 },
                { name: 'half',   t: stateTranslate('half') },
                { name: 'closed', t: h - peek },
            ];
            let nearest = targets[0];
            for (const tg of targets) {
                if (Math.abs(tg.t - currentT) < Math.abs(nearest.t - currentT)) nearest = tg;
            }
            setState(nearest.name);
            deltaY = 0;
        };
        handle.addEventListener('touchstart', onStart, { passive: true });
        window.addEventListener('touchmove',  onMove,  { passive: true });
        window.addEventListener('touchend',   onEnd);
        handle.addEventListener('mousedown',  onStart);
        window.addEventListener('mousemove',  onMove);
        window.addEventListener('mouseup',    onEnd);


        document.addEventListener('click', (e) => {
            if (!pinMenu.contains(e.target) && e.target !== addBtn)
                pinMenu.classList.remove('open');
        });
    }

    function peekHeight() {
        return (handle?.offsetHeight || 0) + (tabBar?.parentElement?.offsetHeight || 0) - 40;
    }

    function stateTranslate(state) {
        const h = drawer.offsetHeight;
        const peek = peekHeight();
        if (state === 'open')   return 0;
        if (state === 'half')   return Math.max(0, (h - peek) / 2);
        return h - peek; // 'closed'
    }

    function setState(state) {
        drawerState = state;
        drawer.style.transform = `translateY(${stateTranslate(state)}px)`;
        drawer.classList.toggle('open',   state === 'open');
        drawer.classList.toggle('half',   state === 'half');
        drawer.classList.toggle('closed', state === 'closed');
        // Canvas only resizes when the slider is at rest — applyAspect picks
        // the right area based on drawerState directly, so no need to wait
        // for the CSS transition to finish.
        _aspectApplyFn?.();
    }

    const open  = () => setState('open');
    const close = () => setState('closed');
    function cycleState() {
        const order = ['closed', 'half', 'open'];
        const i = order.indexOf(drawerState);
        setState(order[(i + 1) % order.length]);
    }

    function setActive(hostId) {
        if (!pinned.has(hostId)) hostId = [...pinned][0];
        activeTab = hostId;
        tabBar.querySelectorAll('.drawer-tab').forEach(t =>
            t.classList.toggle('selected', t.dataset.tab === hostId));
        for (const w of PINNABLE) {
            const host = document.getElementById(w.id);
            if (host) host.classList.toggle('mobile-active-tab', w.id === hostId);
        }
        if (drawerState === 'closed') setState('half');
    }

    function renderTabs() {
        tabBar.innerHTML = '';
        for (const w of PINNABLE) {
            if (!pinned.has(w.id)) continue;
            const t = document.createElement('div');
            t.className = 'drawer-tab' + (w.id === activeTab ? ' selected' : '');
            t.dataset.tab = w.id;
            t.textContent = w.title;
            t.addEventListener('click', () => setActive(w.id));
            tabBar.appendChild(t);
        }
    }

    function renderPinMenu() {
        pinMenu.innerHTML = '';
        for (const w of PINNABLE) {
            const row = document.createElement('div');
            row.className = 'drawer-pin-menu-item';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = pinned.has(w.id);
            const lbl = document.createElement('span');
            lbl.textContent = w.title;
            row.appendChild(cb);
            row.appendChild(lbl);
            row.addEventListener('click', (e) => {
                if (e.target !== cb) cb.checked = !cb.checked;
                if (cb.checked) pinned.add(w.id);
                else            pinned.delete(w.id);
                if (pinned.size === 0) { pinned.add(DEFAULT_PINNED[0]); if (w.id === DEFAULT_PINNED[0]) cb.checked = true; }
                savePinned();
                renderTabs();
                setActive(pinned.has(activeTab) ? activeTab : [...pinned][0]);
                renderPinMenu();
            });
            pinMenu.appendChild(row);
        }
    }

    function ensurePlaceholder(host) {
        if (hostPlaceholders.has(host.id)) return;
        const ph = document.createComment(`${host.id}-placeholder`);
        host.parentNode?.insertBefore(ph, host);
        hostPlaceholders.set(host.id, ph);
    }

    function ensureHeaderInDrawer() {
        const header = document.querySelector('body > header');
        if (!header) return;
        if (!headerPlaceholder) {
            headerPlaceholder = document.createComment('header-placeholder');
            header.parentNode.insertBefore(headerPlaceholder, header);
        }
        headerSlot.appendChild(header);
    }

    function reparent() {
        ensureHeaderInDrawer();

        // Top slot: now-playing + progress (always shown)
        const progress   = document.getElementById('progress-bar-container');
        const nowPlaying = document.getElementById('now-playing');
        topSlot.innerHTML = '';
        if (nowPlaying) { ensurePlaceholder(nowPlaying); topSlot.appendChild(nowPlaying); }
        if (progress)   { ensurePlaceholder(progress);   topSlot.appendChild(progress); }

        // Move every pinnable host into drawer-body once. Visibility is
        // driven by the .mobile-active-tab class; unpinned hosts stay parked
        // here (hidden by CSS) so re-pinning is instant and no re-parenting
        // fights with desktop position:absolute rules.
        for (const w of PINNABLE) {
            const host = document.getElementById(w.id);
            if (!host) continue;
            ensurePlaceholder(host);
            if (host.parentNode !== body) body.appendChild(host);
        }
        renderTabs();
        setActive(pinned.has(activeTab) ? activeTab : [...pinned][0]);
    }

    function restore() {
        // Header back
        const header = drawer?.querySelector('header') ?? document.querySelector('header');
        if (headerPlaceholder && header && headerPlaceholder.parentNode) {
            headerPlaceholder.parentNode.insertBefore(header, headerPlaceholder);
            headerPlaceholder.remove();
            headerPlaceholder = null;
        }
        // Every relocated host back; strip the visibility class
        for (const [id, ph] of hostPlaceholders) {
            const host = document.getElementById(id);
            if (host) host.classList.remove('mobile-active-tab');
            if (host && ph.parentNode) ph.parentNode.insertBefore(host, ph);
            ph.remove();
        }
        hostPlaceholders.clear();
    }

    // ── Viewport fixed-aspect (mirrors the GoldenLayout build) ──────────────
    const ASPECTS = {
        '16:9': 16/9, '9:16': 9/16, '4:3': 4/3, '3:4': 3/4, '21:9': 21/9, '1:1': 1,
    };
    const VP_FIXED_KEY  = 'gl-viewport-fixed';
    const VP_ASPECT_KEY = 'gl-viewport-aspect';
    let _aspectWired = false;
    let _aspectApplyFn = null;
    function setupAspectControls() {
        const fixedToggle  = document.getElementById('viewport-fixed-toggle');
        const aspectSelect = document.getElementById('viewport-aspect-select');
        if (!fixedToggle || !aspectSelect || _aspectWired) return;
        _aspectWired = true;

        let vpFixed  = localStorage.getItem(VP_FIXED_KEY) === '1';
        let vpAspect = localStorage.getItem(VP_ASPECT_KEY) || '16:9';
        fixedToggle.checked = vpFixed;
        aspectSelect.value  = vpAspect;

        const canvas = document.getElementById('three-canvas');
        const parent = canvas?.parentElement;
        if (parent && !parent.style.position) parent.style.position = 'relative';

        let _applying = false;
        const applyAspect = () => {
            if (_applying) return;        // guard against re-entry
            if (!canvas) return;
            _applying = true;
            try {
                if (!MQ.matches) {
                    canvas.style.position = '';
                    canvas.style.left = ''; canvas.style.top = '';
                    canvas.style.width = ''; canvas.style.height = '';
                    return;
                }
                // Only the half state shrinks the canvas; closed and open both
                // render at full viewport size (the drawer just overlays).
                const fullH = window.innerHeight - TOP_OFFSET;
                let availableH = fullH;
                if (drawerState === 'half') {
                    const drawerH = window.innerHeight - TOP_OFFSET;
                    availableH = Math.max(0, (drawerH - peekHeight()) / 2);
                }
                const availableW = window.innerWidth;

                let w = availableW, h = availableH;
                if (vpFixed && ASPECTS[vpAspect] && availableH > 0) {
                    const ratio = ASPECTS[vpAspect];
                    if (w / h > ratio) w = h * ratio;
                    else               h = w / ratio;
                }
                canvas.style.position = 'fixed';
                canvas.style.left   = ((availableW - w) / 2) + 'px';
                canvas.style.top    = (TOP_OFFSET + (availableH - h) / 2) + 'px';
                canvas.style.width  = w + 'px';
                canvas.style.height = h + 'px';

                window.dispatchEvent(new Event('resize'));
            } finally { _applying = false; }
        };
        _aspectApplyFn = applyAspect;

        fixedToggle.addEventListener('change', () => {
            vpFixed = !!fixedToggle.checked;
            localStorage.setItem(VP_FIXED_KEY, vpFixed ? '1' : '0');
            applyAspect();
        });
        aspectSelect.addEventListener('change', () => {
            vpAspect = aspectSelect.value;
            localStorage.setItem(VP_ASPECT_KEY, vpAspect);
            applyAspect();
        });
        // The re-entrancy guard above means our own dispatched resize won't
        // recurse, so we can safely listen on window for orientation changes.
        window.addEventListener('resize', applyAspect);
        requestAnimationFrame(applyAspect);
    }

    function clearAspectStyles() {
        const canvas = document.getElementById('three-canvas');
        if (canvas) {
            canvas.style.position = '';
            canvas.style.left = ''; canvas.style.top = '';
            canvas.style.width = ''; canvas.style.height = '';
        }
        window.dispatchEvent(new Event('resize'));
    }

    // True once we've actually built the mobile drawer this session. The
    // reload below is only needed on a real mobile→desktop transition; a
    // plain desktop start must not reload.
    let _mobileWasActive = false;

    function apply() {
        if (window.__GL_ACTIVE__) return;
        if (MQ.matches) {
            build();
            document.body.classList.add('mobile-mode');
            reparent();
            drawer.style.display = '';
            setupAspectControls();
            _aspectApplyFn?.();
            _mobileWasActive = true;
        } else {
            if (_mobileWasActive) {
                // gl-ui only builds the GoldenLayout DOM once at startup, and
                // it bails when MOBILE_MQ matches. Putting hosts back into
                // <main> (which is display:none on desktop) yields the black
                // screen the user reported — reload so gl-ui can run fresh.
                location.reload();
                return;
            }
            document.body.classList.remove('mobile-mode');
            if (drawer) drawer.style.display = 'none';
            restore();
            clearAspectStyles();
        }
    }

    function init() {
        apply();
        MQ.addEventListener?.('change', apply);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
