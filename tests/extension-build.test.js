// Regression test: extension/content.js must satisfy its GM_* shim contract.
// Loads the generated file in a minimal sandbox and checks that the GM APIs
// resolve to the bridge instead of throwing ReferenceError.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'extension', 'content.js');
const code = fs.readFileSync(file, 'utf8');

let failures = 0;
const check = (cond, msg) => {
    if (cond) { console.log('  ok   ' + msg); return; }
    failures++;
    console.log('  FAIL ' + msg);
};

const storage = new Map();
const hook = {
    sync: {},
    getValue: (k, d) => (storage.has(k) ? storage.get(k) : d),
    setValue: (k, v) => { storage.set(k, v); return Promise.resolve({ ok: true }); },
    deleteValue: (k) => { storage.delete(k); return Promise.resolve({ ok: true }); },
    listValues: () => [...storage.keys()],
    request: (d) => Promise.resolve({ status: 0, error: 'sandbox' }),
    download: () => Promise.resolve({ ok: true }),
};

const messages = [];
const noop = () => {};
const fakeEl = () => ({
    style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    children: [], childNodes: [],
    setAttribute: noop, removeAttribute: noop, getAttribute: () => null, hasAttribute: () => false,
    appendChild: (c) => c, removeChild: (c) => c, insertBefore: (c) => c, replaceChild: (c) => c,
    addEventListener: noop, removeEventListener: noop, remove: noop, click: noop, focus: noop,
    querySelector: () => null, querySelectorAll: () => [], closest: () => null, contains: () => false,
    insertAdjacentHTML: noop, insertionStyle: undefined, textContent: '', innerHTML: '',
});
const sandbox = {
    console: { log: (...a) => messages.push(a.join(' ')), warn: (...a) => messages.push(a.join(' ')),
               error: (...a) => messages.push('ERROR ' + a.join(' ')), info: () => {}, debug: () => {} },
    window: { __mrsExtHook: hook, location: { hostname: 'www.kinopoisk.ru', href: 'https://www.kinopoisk.ru/' },
              addEventListener: noop, removeEventListener: noop, postMessage: noop },
    document: {
        head: fakeEl(),
        documentElement: fakeEl(),
        body: fakeEl(),
        createElement: fakeEl,
        createElementNS: fakeEl,
        createDocumentFragment: fakeEl,
        getElementById: () => null,
        getElementsByClassName: () => [],
        querySelectorAll: () => [],
        querySelector: () => null,
        createTextNode: (t) => ({ nodeType: 3, textContent: t }),
        readyState: 'complete',
        addEventListener: noop,
        removeEventListener: noop,
    },
    location: { hostname: 'www.kinopoisk.ru', href: 'https://www.kinopoisk.ru/', pathname: '/', search: '', hash: '' },
    history: { pushState: noop, replaceState: noop, state: null },
    navigator: { language: 'ru-RU', userAgent: 'node' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    URL, URLSearchParams, TextEncoder, TextDecoder, DOMException, Promise, JSON, Math, Date,
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    addEventListener: noop,
    indexedDB: { open: () => ({ onupgradeneeded: null, onsuccess: null, onerror: null }) },
    fetch: () => Promise.reject(new Error('sandbox')),
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox.window;
sandbox.window.window = sandbox.window;
// In a browser window === globalThis; in vm they are distinct objects.
sandbox.window.MRS_GM = undefined;
Object.defineProperty(sandbox, 'MRS_GM', {
    get: () => sandbox.window.MRS_GM,
    set: (v) => { sandbox.window.MRS_GM = v; },
    configurable: true,
});

console.log('content.js shim test (' + path.basename(file) + ', ' + code.length + ' chars)');
let threw = null;
try {
    vm.runInNewContext(code, sandbox, { filename: 'content.js', timeout: 5000 });
} catch (e) {
    threw = e;
}

check(!threw, 'engine initializes without throwing' + (threw ? ': ' + threw.message : ''));
const errs = messages.filter(m => m.startsWith('ERROR'));
check(errs.length === 0, 'no errors logged' + (errs.length ? ' -> ' + errs.slice(0, 3).join(' | ') : ''));
check(typeof sandbox.MRS_GM === 'object' && sandbox.MRS_GM !== null, 'GM shim exported for debugging');
check(typeof sandbox.MRS_GM.GM_getValue === 'function', 'GM_getValue resolves');
check(typeof sandbox.MRS_GM.GM.xmlHttpRequest === 'function', 'GM.xmlHttpRequest resolves');
check(sandbox.MRS_GM.GM_getValue('mrs_lang', 'en') === 'en', 'GM_getValue falls back to the default');
const jsonBlocked = !/^\s*\/\/ ==UserScript==/m.test(code);
check(jsonBlocked, 'userscript metadata block stripped');
check(!/GM_info|GM_listValues/.test(code.replace(/\/\*[\s\S]*?\*\//g, '')), 'no unsupported GM_* calls');

// The launched button must carry the sync icon, not the old "MRS" label.
check(!code.includes("textContent: 'MRS'"), 'launcher no longer uses the MRS label');
check(code.includes("'M20 12a8 8 0 0 1-13.66 5.66'"), 'launcher uses the cyclic-arrow SVG');

// UI must not be restyled by the host page: the status card resets inherited
// styles and must not rely on min-width (which overrides max-width) or on a
// backdrop-filter/glow that turned the card unreadable on dark themes.
const statusRule = code.match(/#mrs-status\{([^}]*)\}/)?.[1] ?? '';
const titleRule = code.match(/\.mrs-status__title\{([^}]*)\}/)?.[1] ?? '';
const panelRule = code.match(/#mrs-panel\{([^}]*)\}/)?.[0] ?? '';
check(statusRule.includes('all:initial'), 'status card resets page-inherited styles');
check(statusRule.indexOf('all:initial') === 0, 'all:initial is declared first so later longhands win');
check(!/min-width/.test(statusRule), 'status card has no min-width fighting max-width');
check(!/backdrop-filter/.test(statusRule), 'status card is opaque (no backdrop-filter)');
check(!/text-shadow\s*:\s*(?!none)/.test(`x{${titleRule}}`), 'status title has no glow');
check(/max-height/.test(panelRule), 'panel is height-capped');
check(/bottom:calc\(100%/.test(panelRule), 'panel anchors above the status card, not over it');

console.log(failures === 0 ? 'ALL OK' : failures + ' FAILURE(S)');
process.exit(failures === 0 ? 0 : 1);
