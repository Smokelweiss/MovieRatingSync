// Dry-run matcher harness: loads the REAL userscript (main folder version),
// exposes internal resolveIMDb + parseCSV, and checks KP films against IMDb ttIds.
// Usage: node tests/matcher-harness.js <kp-csv> <imdb-csv> [--limit N]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let LIMIT = 0, FILTER = '', TRACE = false;
const positional = [];
{
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--limit') LIMIT = parseInt(args[++i], 10) || 0;
        else if (args[i] === '--filter') FILTER = String(args[++i] || '').toLowerCase();
        else if (args[i] === '--trace') TRACE = true;
        else positional.push(args[i]);
    }
}
const SCRIPT_PATH = positional[0] || path.join(__dirname, '..', 'movie-rating-sync.user.js');
const KP_CSV = positional[1] || path.join(__dirname, '..', 'kp-real.csv');
const IMDB_CSV = positional[2] || path.join(__dirname, '..', 'imdb-real.csv');

// ---------- CSV parsing (mirror of the script's splitCsvLine) ----------
function splitCsvLine(line) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            cells.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    cells.push(current);
    return cells;
}

function parseCsvFile(p) {
    const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    const header = splitCsvLine(lines[0]).map(h => h.toLowerCase().trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = splitCsvLine(lines[i]);
        if (cells.length < Math.min(3, header.length)) continue;
        const row = {};
        header.forEach((h, idx) => row[h] = (cells[idx] ?? '').replace(/""/g, '"'));
        rows.push(row);
    }
    return { header, rows };
}

// ---------- Build ground truth: title(+year)->ttId from IMDb export ----------
function buildGroundTruth(imdbRows) {
    const map = new Map();       // normTitle -> ttId (first seen)
    const byYear = new Map();    // normTitle|year -> ttId
    const ttYears = new Map();   // ttId -> Set(years) — to distinguish remakes
    for (const r of imdbRows) {
        const ttId = (r.ttid || '').trim();
        if (!ttId) continue;
        const year = (r.yearstart || r.year || '').trim().match(/\d{4}/)?.[0] || '';
        if (!ttYears.has(ttId)) ttYears.set(ttId, new Set());
        if (year) ttYears.get(ttId).add(year);
        const keys = new Set();
        for (const k of [r.titleorig, r.titleru, r.title, r.alltitles]) {
            if (!k) continue;
            for (const part of String(k).split('|')) {
                const t = norm(part);
                if (t.length >= 3) keys.add(t);
            }
        }
        keys.add(ttId.toLowerCase());
        for (const key of keys) {
            if (!map.has(key)) map.set(key, ttId);
            if (year && !byYear.has(key + '|' + year)) byYear.set(key + '|' + year, ttId);
        }
    }
    return { map, byYear, ttYears };
}

function norm(s) {
    return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

// ---------- Sandbox ----------
function loadScript() {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    // Expose internal functions: append an export statement before the final IIFE close.
    const exportSnippet = `
    globalThis.__mrsInternals = { resolveIMDb, parseCSV, getTitleVariants, scoreCandidate };
})();`;
    // The script ends with `})();` possibly followed by newline. Replace the LAST occurrence.
    const idx = src.lastIndexOf('})();');
    const wrapped = src.slice(0, idx) + exportSnippet + src.slice(idx + 5);

    const fakeLocalStorage = (() => {
        let store = {};
        return {
            getItem: k => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: k => { delete store[k]; },
            clear: () => { store = {}; },
        };
    })();

    // Minimal DOM-ish stubs + network via node fetch.
    const fetchTWrapper = (url, timeout, opts) => {
        return new Promise((resolve) => {
            const ctrl = new AbortController();
            const tid = setTimeout(() => ctrl.abort(), timeout || 15000);
            const method = (opts && opts.method) || 'GET';
            const headers = (opts && opts.headers) || {};
            fetch(url, { method, headers, body: (opts && opts.body) || undefined, signal: ctrl.signal, redirect: 'follow' })
                .then(r => r.text().then(t => {
                    clearTimeout(tid);
                    resolve({
                        ok: r.status >= 200 && r.status < 300,
                        status: r.status,
                        statusText: r.statusText || '',
                        responseHeaders: '',
                        responseText: t,
                        text: () => Promise.resolve(t),
                        json: () => { try { return Promise.resolve(JSON.parse(t)); } catch (e) { return Promise.reject(e); } },
                    });
                }))
                .catch(e => {
                    clearTimeout(tid);
                    console.error('  [fetch]', method, url, '->', e.message);
                    resolve(null);
                });
        });
    };

    const sandbox = {
        console,
        setTimeout, clearTimeout, setInterval, clearInterval,
        Math, Date, JSON, Promise, Map, Set, Array, Object, String, Number, Boolean, RegExp, Error, TypeError, RangeError,
        Intl, AbortController, AbortSignal, TextDecoder, TextEncoder,
        fetch, // for any direct fetch fallback
        URL, URLSearchParams, Blob, File,
        globalThis: null, // set below
        location: { href: 'https://www.kinopoisk.ru/', hostname: 'www.kinopoisk.ru', pathname: '/', search: '', hash: '', origin: 'https://www.kinopoisk.ru' },
        navigator: { language: 'ru-RU', userAgent: 'node-harness' },
        history: { pushState: () => {}, replaceState: () => {} },
        window: null, // set below
        document: {
            body: null,
            documentElement: { lang: 'ru' },
            readyState: 'loading',
            addEventListener: () => {},
            getElementById: () => null,
            createElement: () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, click() {} }),
            querySelector: () => null,
            querySelectorAll: () => [],
            head: null,
        },
        addEventListener: () => {},
        indexedDB: undefined, // triggers fallback path
        localStorage: fakeLocalStorage,
        GM_getValue: (k, d) => { try { const v = fakeLocalStorage.getItem('mrs_' + k); return v !== null ? JSON.parse(v) : d; } catch { return d; } },
        GM_setValue: (k, v) => { try { fakeLocalStorage.setItem('mrs_' + k, JSON.stringify(v)); } catch {} },
        GM_deleteValue: (k) => { try { fakeLocalStorage.removeItem('mrs_' + k); } catch {} },
        GM_addStyle: () => {},
        GM: { xmlHttpRequest: (o) => fetchTWrapper(o.url, o.timeout, o).then(r => { o.onload && o.onload(r); }) },
        MutationObserver: function () { return { observe() {}, disconnect() {} }; },
        DOMParser: function () { return { parseFromString: (html) => ({ querySelectorAll: () => [], querySelector: () => null }) }; },
        Node: function () {}, HTMLElement: function () {}, Element: function () {},
        XMLHttpRequest: function () {},
        performance: { now: () => Date.now() },
        __dirname,
        require,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    // 'history' is referenced as a bare global in the script
    sandbox.history = sandbox.history;

    vm.createContext(sandbox);
    try {
        vm.runInContext(wrapped, sandbox, { filename: 'movie-rating-sync.user.js' });
    } catch (e) {
        console.error('LOAD ERROR:', e.message);
        process.exit(1);
    }
    return sandbox.__mrsInternals;
}

async function main() {
    const kp = parseCsvFile(KP_CSV);
    const imdb = parseCsvFile(IMDB_CSV);
    const groundTruth = buildGroundTruth(imdb.rows);
    console.log(`KP rows: ${kp.rows.length}, IMDb rows: ${imdb.rows.length}, GT entries: ${groundTruth.map.size}, byYear: ${groundTruth.byYear.size}`);

    const internals = loadScript();
    console.log('Script loaded OK. Internals:', Object.keys(internals).join(', '));

    let checked = 0, matched = 0, mismatched = 0, notFound = 0, gtMissing = 0;
    const mismatches = [];
    const notFoundList = [];

    const rows = LIMIT ? kp.rows.slice(0, LIMIT) : kp.rows;
    const filters = FILTER.split('|').filter(Boolean);
    const rowsFiltered = FILTER
        ? rows.filter(r => filters.some(f => String(r.titleorig + '|' + r.titleru + '|' + (r.alltitles || '')).toLowerCase().includes(f)))
        : rows;
    for (const r of rowsFiltered) {
        const titleOrig = (r.titleorig || '').trim();
        const titleRu = (r.titleru || '').trim();
        const year = (r.yearstart || r.year || '').trim();
        const rating = r.rating10;
        const allTitles = String(r.alltitles || '').split('|').map(s => s.trim()).filter(Boolean);

        const title = titleOrig || titleRu;
        const query = titleRu && titleOrig ? titleOrig : (titleOrig || titleRu);

        // Ground truth for this row: prefer exact (title+year), then any-title match
        let gt = null;
        let gtIsYearExact = false;
        const candKeys = [titleOrig, titleRu, ...allTitles].map(norm).filter(t => t.length >= 3);
        const yearDigits = year.match(/\d{4}/)?.[0] || '';
        for (const key of candKeys) {
            const yv = groundTruth.byYear.get(key + '|' + yearDigits);
            if (yv) { gt = yv; gtIsYearExact = true; break; }
        }
        if (!gt) {
            for (const key of candKeys) {
                const v = groundTruth.map.get(key);
                if (v) { gt = v; break; }
            }
        }
        if (!gt) { gtMissing++; continue; }

        checked++;
        let result = null;
        try {
            result = await internals.resolveIMDb(query, year, false, allTitles, { type: (r.type || '').trim(), genres: (r.genres || '').trim() });
        } catch (e) {
            notFound++;
            notFoundList.push({ title: query, year, err: e.message });
            continue;
        }
        const ttId = result && result.ttId;
        if (TRACE) console.log(`[trace] "${query}" (${year}) type=${(r.type || '').trim()} → ${ttId || 'NULL'} conf=${result && result.confidence} score=${result && result.score && result.score.toFixed(2)}`);
        if (!ttId || result.confidence === 'low') {
            notFound++;
            notFoundList.push({ title: query, year, ru: titleRu, gt });
            continue;
        }
        if (ttId === gt) matched++;
        else if (!gtIsYearExact) {
            // GT was title-only (different films share the name) — can't call this a wrong rating.
            matched++;
        } else if (ttId && groundTruth.ttYears.has(ttId) && yearDigits && groundTruth.ttYears.get(ttId).has(yearDigits)) {
            // Matched a different row with the same title+year (duplicate in user's IMDb) — not a wrong film.
            matched++;
        } else {
            mismatched++;
            mismatches.push({ title: query, year, ru: titleRu, got: ttId, expected: gt, conf: result.confidence });
        }
    }

    console.log(`\n=== RESULTS (checked ${checked} of ${rows.length}; ${gtMissing} rows without ground truth) ===`);
    console.log(`MATCHED:   ${matched}`);
    console.log(`MISMATCH:  ${mismatched}`);
    console.log(`NOT FOUND: ${notFound}`);
    if (mismatches.length) {
        console.log('\n--- MISMATCHES (would rate WRONG film!) ---');
        for (const m of mismatches.slice(0, 40)) {
            console.log(`  [${m.conf}] "${m.title}" (${m.year}) ru="${m.ru}" → got ${m.got}, expected ${m.expected}`);
        }
    }
    if (notFoundList.length) {
        console.log('\n--- NOT FOUND (would be missed) ---');
        for (const m of notFoundList.slice(0, 40)) {
            console.log(`  "${m.title}" (${m.year}) ru="${m.ru}" expected ${m.gt}`);
        }
    }
    console.log(`\nTOTAL: ${matched} matched, ${mismatched} mismatched, ${notFound} not-found`);
    process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
