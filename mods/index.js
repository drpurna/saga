// TizenBrew module: YouTube TV style row/column navigation
(function() {
    let items = [], rows = [], currentIdx = 0;

    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setup);
        } else {
            setup();
        }
    }

    function setup() {
        scan();
        buildRows();
        attachKeys();
        observe();
        window.navigationModule = { rescan: () => { scan(); buildRows(); } };
    }

    function scan() {
        items = Array.from(document.querySelectorAll('[data-focusable="true"]'))
            .filter(el => el.offsetParent !== null);
    }

    function buildRows() {
        const tolerance = 30;
        const withPos = items.map(el => ({ el, top: el.getBoundingClientRect().top }));
        withPos.sort((a,b) => a.top - b.top);
        rows = [];
        withPos.forEach(p => {
            let found = rows.find(r => Math.abs(r.top - p.top) <= tolerance);
            if (found) found.items.push(p.el);
            else rows.push({ top: p.top, items: [p.el] });
        });
        rows.forEach(r => {
            r.items.sort((a,b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        });
        items = rows.flatMap(r => r.items);
    }

    function attachKeys() {
        document.addEventListener('keydown', (e) => {
            const key = e.keyCode;
            const UP=38, DOWN=40, LEFT=37, RIGHT=39, ENTER=13, BACK=10009;
            if ([UP,DOWN,LEFT,RIGHT,ENTER,BACK].includes(key)) e.preventDefault();

            switch(key) {
                case UP: move('up'); break;
                case DOWN: move('down'); break;
                case LEFT: move('left'); break;
                case RIGHT: move('right'); break;
                case ENTER: activate(); break;
                case BACK: goBack(); break;
            }
        });
    }

    function move(dir) {
        if (!items.length) return;
        let rowIdx = -1, colIdx = -1;
        for (let r=0; r<rows.length; r++) {
            let c = rows[r].items.indexOf(items[currentIdx]);
            if (c !== -1) { rowIdx = r; colIdx = c; break; }
        }
        if (rowIdx === -1) return;

        let nr = rowIdx, nc = colIdx;
        if (dir === 'left' && colIdx > 0) nc--;
        else if (dir === 'right' && colIdx < rows[rowIdx].items.length-1) nc++;
        else if (dir === 'up' && rowIdx > 0) {
            nr--;
            nc = Math.min(rows[nr].items.length-1, colIdx);
        } else if (dir === 'down' && rowIdx < rows.length-1) {
            nr++;
            nc = Math.min(rows[nr].items.length-1, colIdx);
        }

        if (nr !== rowIdx || nc !== colIdx) {
            const newEl = rows[nr].items[nc];
            setFocus(items.indexOf(newEl));
        }
    }

    function setFocus(idx) {
        items.forEach(el => el.classList.remove('tv-focused'));
        items[idx].classList.add('tv-focused');
        items[idx].scrollIntoView({ block: 'nearest', inline: 'nearest' });
        currentIdx = idx;
    }

    function activate() {
        items[currentIdx]?.click();
        items[currentIdx]?.dispatchEvent(new CustomEvent('tv-enter', { bubbles: true }));
    }

    function goBack() {
        const back = document.querySelector('[data-action="back"]');
        if (back) { back.click(); back.dispatchEvent(new CustomEvent('tv-enter')); }
        else window.dispatchEvent(new CustomEvent('tv-back'));
    }

    function observe() {
        new MutationObserver(() => { scan(); buildRows(); }).observe(document.body, { childList: true, subtree: true });
    }

    init();
})();