(function () {
    const MQ = window.matchMedia('(max-width: 768px)');

    // Windows the user can pin as tabs in the mobile drawer. Each appears on
    // the tab bar; clicking switches the drawer body to that window.
    const PINNABLE = [
        { id: 'controlls',              title: 'Settings'         },
        { id: 'player',                 title: 'Audio Input'      },
        { id: 'project-settings',       title: 'Project Settings' },
        { id: 'current-layer-controls', title: 'Object Editor'    },
        { id: 'pp-section',             title: 'Post Processing'  },
        { id: 'anim-section',           title: 'Animation'        },
        { id: 'layers',                 title: 'Layers'           },
        { id: 'audio-monitor',          title: 'Audio Monitor'    },
        { id: 'key-map',                title: 'Key Map'          },
    ];
    const STORAGE_KEY = 'mobile-pinned-v3';
    const DEFAULT_PINNED = [
        'controlls',
        'project-settings',
        'current-layer-controls',
        'pp-section',
        'anim-section',
        'player',
    ];

    let drawer, handle, tabBar, body, headerSlot, topSlot, addBtn, pinMenu;
    let isOpen = false;
    let pinned = new Set();
    let activeTab = 'controlls';

    // Comment-node placeholders so DOM nodes can be returned to their original
    // positions when leaving mobile mode.
    const hostPlaceholders = new Map(); // hostId -> Comment
    let headerPlaceholder = null;

    function loadPinned() {
        try {
            const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (Array.isArray(s) && s.length) {
                pinned = new Set(s.filter(id => PINNABLE.some(w => w.id === id)));
            } else pinned = new Set(DEFAULT_PINNED);
        } catch { pinned = new Set(DEFAULT_PINNED); }
        if (pinned.size === 0) pinned = new Set(DEFAULT_PINNED);
    }
    function savePinned() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...pinned])); } catch {}
    }

    function build() {
        if (drawer) return;
        loadPinned();
        if (!pinned.has(activeTab)) activeTab = [...pinned][0] ?? DEFAULT_PINNED[0];

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

        handle.addEventListener('click', toggle);

        // Drawer drag (touch + mouse)
        let startY = 0, startOpen = false, dragging = false, deltaY = 0;
        const onStart = (e) => {
            dragging = true;
            startY = (e.touches ? e.touches[0].clientY : e.clientY);
            startOpen = isOpen;
            drawer.style.transition = 'none';
        };
        const onMove = (e) => {
            if (!dragging) return;
            const y = (e.touches ? e.touches[0].clientY : e.clientY);
            deltaY = y - startY;
            const h = drawer.offsetHeight;
            const baseTranslate = startOpen ? 0 : (h - peekHeight());
            let t = baseTranslate + deltaY;
            t = Math.max(0, Math.min(h - peekHeight(), t));
            drawer.style.transform = `translateY(${t}px)`;
        };
        const onEnd = () => {
            if (!dragging) return;
            dragging = false;
            drawer.style.transition = '';
            drawer.style.transform = '';
            const h = drawer.offsetHeight;
            const threshold = h * 0.2;
            if (startOpen)  { if (deltaY > threshold) close(); else open(); }
            else            { if (deltaY < -threshold) open(); else close(); }
            deltaY = 0;
        };
        handle.addEventListener('touchstart', onStart, { passive: true });
        window.addEventListener('touchmove',  onMove,  { passive: true });
        window.addEventListener('touchend',   onEnd);
        handle.addEventListener('mousedown',  onStart);
        window.addEventListener('mousemove',  onMove);
        window.addEventListener('mouseup',    onEnd);

        // Close the pin menu on outside tap
        document.addEventListener('click', (e) => {
            if (!pinMenu.contains(e.target) && e.target !== addBtn)
                pinMenu.classList.remove('open');
        });
    }

    function peekHeight() {
        return (handle?.offsetHeight || 0) + (tabBar?.offsetHeight || 0);
    }

    function open()   { isOpen = true;  drawer.classList.add('open'); }
    function close()  { isOpen = false; drawer.classList.remove('open'); }
    function toggle() { isOpen ? close() : open(); }

    function setActive(hostId) {
        if (!pinned.has(hostId)) return;
        activeTab = hostId;
        // Update tab selected state
        tabBar.querySelectorAll('.drawer-tab').forEach(t =>
            t.classList.toggle('selected', t.dataset.tab === hostId));
        // Show only the active host in the body
        body.querySelectorAll('.drawer-tab-host').forEach(host => {
            host.style.display = host.dataset.tab === hostId ? '' : 'none';
        });
        if (!isOpen) open();
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
                const on = cb.checked;
                if (on) pinned.add(w.id);
                else    pinned.delete(w.id);
                if (pinned.size === 0) {
                    pinned.add(DEFAULT_PINNED[0]);
                    if (w.id === DEFAULT_PINNED[0]) cb.checked = true;
                }
                savePinned();
                reparent();
                if (!pinned.has(activeTab)) setActive([...pinned][0]);
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

        // Pin progress + now-playing into the top slot
        const progress   = document.getElementById('progress-bar-container');
        const nowPlaying = document.getElementById('now-playing');
        topSlot.innerHTML = '';
        if (nowPlaying) { ensurePlaceholder(nowPlaying); topSlot.appendChild(nowPlaying); }
        if (progress)   { ensurePlaceholder(progress);   topSlot.appendChild(progress); }

        // Move each pinned host into the body, wrapped so they can hide
        // independently of the host's own display rules.
        const inBody = new Map();
        body.querySelectorAll('.drawer-tab-host').forEach(el => inBody.set(el.dataset.tab, el));

        // Build the active set in the desired order, reusing existing wrappers
        const orderedWrappers = [];
        for (const w of PINNABLE) {
            if (!pinned.has(w.id)) continue;
            const host = document.getElementById(w.id);
            if (!host) continue;
            ensurePlaceholder(host);
            let wrap = inBody.get(w.id);
            if (!wrap) {
                wrap = document.createElement('div');
                wrap.className = 'drawer-tab-host';
                wrap.dataset.tab = w.id;
                wrap.appendChild(host);
            } else if (wrap.firstChild !== host) {
                wrap.innerHTML = '';
                wrap.appendChild(host);
            }
            host.style.display = ''; // override per-panel hiding
            orderedWrappers.push(wrap);
            inBody.delete(w.id);
        }
        // Stash any now-unpinned hosts back to their placeholders
        for (const [id, wrap] of inBody) {
            const host = document.getElementById(id);
            const ph = hostPlaceholders.get(id);
            if (host && ph?.parentNode) ph.parentNode.insertBefore(host, ph);
            wrap.remove();
        }
        body.innerHTML = '';
        for (const w of orderedWrappers) body.appendChild(w);

        renderTabs();
        setActive(pinned.has(activeTab) ? activeTab : [...pinned][0]);
    }

    function restore() {
        // Return header
        const header = drawer?.querySelector('body > header')
            ?? drawer?.querySelector('header');
        if (headerPlaceholder && header && headerPlaceholder.parentNode) {
            headerPlaceholder.parentNode.insertBefore(header, headerPlaceholder);
            headerPlaceholder.remove();
            headerPlaceholder = null;
        }
        // Return every relocated host
        for (const [id, ph] of hostPlaceholders) {
            const host = document.getElementById(id);
            if (host) host.style.display = '';
            if (host && ph.parentNode) ph.parentNode.insertBefore(host, ph);
            ph.remove();
        }
        hostPlaceholders.clear();
    }

    function apply() {
        if (window.__GL_ACTIVE__) return; // desktop GoldenLayout owns the DOM
        if (MQ.matches) {
            build();
            document.body.classList.add('mobile-mode');
            reparent();
            drawer.style.display = '';
        } else {
            document.body.classList.remove('mobile-mode');
            if (drawer) drawer.style.display = 'none';
            restore();
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
