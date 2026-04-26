(function () {
    const MQ = window.matchMedia('(max-width: 768px)');

    let drawer, handle, tabBar, body, tabs;
    let placeholderControls, placeholderPlayer;
    let currentTab = 'controls';
    let isOpen = false;

    function build() {
        if (drawer) return;

        drawer = document.createElement('div');
        drawer.id = 'mobile-drawer';
        const progress = document.getElementById('progress-bar-container');
        progress.remove();
        drawer.innerHTML = `
            <div id="drawer-handle"><div class="drawer-grip"></div></div>
        `;

        document.body.appendChild(drawer);
        drawer.appendChild(progress);
        drawer.innerHTML += `
            <div id="drawer-tabs">
                <div class="drawer-tab" data-tab="tracks">Saved Tracks</div>
                <div class="drawer-tab selected" data-tab="controls">Controls</div>
            </div>
            <div id="drawer-body"></div>
        `;
        handle = drawer.querySelector('#drawer-handle');
        tabBar = drawer.querySelector('#drawer-tabs');
        body = drawer.querySelector('#drawer-body');
        tabs = drawer.querySelectorAll('.drawer-tab');

        tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));

        handle.addEventListener('click', () => toggle());

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
            if (startOpen) {
                if (deltaY > threshold) close(); else open();
            } else {
                if (deltaY < -threshold) open(); else close();
            }
            deltaY = 0;
        };
        handle.addEventListener('touchstart', onStart, { passive: true });
        window.addEventListener('touchmove', onMove, { passive: true });
        window.addEventListener('touchend', onEnd);
        handle.addEventListener('mousedown', onStart);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);
    }

    function peekHeight() {
        return (handle?.offsetHeight || 0) + (tabBar?.offsetHeight || 0);
    }

    function setTab(name) {
        currentTab = name;
        tabs.forEach(t => t.classList.toggle('selected', t.dataset.tab === name));
        const ctrls = document.getElementById('controlls');
        const plyr  = document.getElementById('player');
        if (ctrls) ctrls.classList.toggle('drawer-hidden', name !== 'controls');
        if (plyr)  plyr.classList.toggle('drawer-hidden',  name !== 'tracks');
        if (!isOpen) open();
    }

    function open()  { isOpen = true;  drawer.classList.add('open'); }
    function close() { isOpen = false; drawer.classList.remove('open'); }
    function toggle(){ isOpen ? close() : open(); }

    function reparent() {
        const ctrls = document.getElementById('controlls');
        const plyr  = document.getElementById('player');
        if (!ctrls || !plyr) return;

        if (!placeholderControls) {
            placeholderControls = document.createComment('controlls-placeholder');
            ctrls.parentNode.insertBefore(placeholderControls, ctrls);
        }
        if (!placeholderPlayer) {
            placeholderPlayer = document.createComment('player-placeholder');
            plyr.parentNode.insertBefore(placeholderPlayer, plyr);
        }
        body.appendChild(plyr);
        body.appendChild(ctrls);

        const hc = document.getElementById('hide-controlls');
        const hp = document.getElementById('hide-player');
        if (hc) hc.style.display = 'none';
        if (hp) hp.style.display = 'none';

        setTab(currentTab);
    }

    function restore() {
        const ctrls = document.getElementById('controlls');
        const plyr  = document.getElementById('player');
        if (placeholderControls && ctrls) {
            placeholderControls.parentNode.insertBefore(ctrls, placeholderControls);
            placeholderControls.remove();
            placeholderControls = null;
        }
        if (placeholderPlayer && plyr) {
            placeholderPlayer.parentNode.insertBefore(plyr, placeholderPlayer);
            placeholderPlayer.remove();
            placeholderPlayer = null;
        }
        if (ctrls) ctrls.classList.remove('drawer-hidden');
        if (plyr)  plyr.classList.remove('drawer-hidden');

        const hc = document.getElementById('hide-controlls');
        const hp = document.getElementById('hide-player');
        if (hc) hc.style.display = '';
        if (hp) hp.style.display = '';
    }

    function apply() {
        if (MQ.matches) {
            build();
            reparent();
            drawer.style.display = '';
        } else {
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
