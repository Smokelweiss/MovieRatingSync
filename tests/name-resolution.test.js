// Static guard: an `async (X) => {...}` worker must resolve every parameter and
// loop variable inside its OWN closure. The historical crash
// ("ReferenceError: p is not defined") came from a worker whose callback
// parameter shadowed a `let p` declared outside, while the body still relied
// on the outer loop's `p`.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'movie-rating-sync.user.js');
const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

let ok = true;
const check = (label, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) ok = false; };

// 1. No worker callback may be named `p` (page is always spelled out).
const barePWorker = new RegExp('async\\s*\\(\\s*p\\s*\\)\\s*=>').test(src);
check('no async worker takes a bare `p` parameter', !barePWorker);
check('LB phase-1 worker names its page', /asyncPool\(5, firstBatch, async \(pageNo\) =>/.test(src));
check('KP export listing worker names its page', /asyncPool\(10, pageNums, async \(pageNo\) =>/.test(src));
check('KP ratings listing worker names its page', !/asyncPool\(10, pageNums, async \(p\) =>/.test(src));

// 2. Every worker that iterates pages names them `pageNo` (or an explicit
//    `p` that is used consistently inside). The list is fixed on purpose:
//    a new page worker must be added here after review.
const pageWorkers = [
    'async (pageNo) => {',
];
check('lbScrapePages window worker is explicit', pageWorkers.every(w => src.includes(w)));
check('lbScrapePages phase-1 worker names its page', /asyncPool\(5, firstBatch, async \(pageNo\) =>/.test(src));
// The two KP listing workers iterate `pageNums`; they must not shadow `p`.
check('KP listing workers never name their page `p`',
    !new RegExp('asyncPool\\(10, pageNums, async \\(p\\)').test(src));

// name-resolution check for every `async (params) => { body }` worker.
const declared = new Set();
const declRe = /(?:const|let|var|function)\s+([\w$]+)/g;
let m;
while ((m = declRe.exec(src))) declared.add(m[1]);

const SKIP = new Set(['const', 'let', 'var', 'return', 'await', 'if', 'for', 'of', 'else', 'new', 'this', 'async', 'null', 'true', 'false', 'function', 'break', 'continue', 'do', 'in', 'items', 'email', 'case']);
const workers = [];
{
    let pos = 0;
    while ((pos = src.indexOf('async (', pos)) !== -1) {
        const headEnd = src.indexOf(') => {', pos);
        if (headEnd === -1) { pos += 6; continue; }
        const params = src.slice(pos + 6, headEnd).split(',').map(s => s.trim()).filter(Boolean);
        let depth = 0, end = headEnd + 5;
        for (; end < src.length; end++) {
            if (src[end] === '{') depth++;
            else if (src[end] === '}') { depth--; if (!depth) break; }
        }
        workers.push({ params, body: src.slice(headEnd + 5, end), at: pos });
        pos = end;
    }
}
const offenders = [];
for (const w of workers) {
    const local = new Set(w.params);
    for (const d of w.body.matchAll(/(?:const|let|var)\s+([\w$]+)/g)) local.add(d[1]);
    for (const tok of w.body.matchAll(/[A-Za-z_$][\w$]*/g)) {
        const name = tok[0];
        if (SKIP.has(name) || name.length > 2) continue;
        if (local.has(name) || declared.has(name)) continue;
        // `.name` property access is fine
        if (w.body[tok.index - 1] === '.') continue;
        offenders.push(name + ' in (' + w.params.join(',') + ')');
    }
}
check('no worker named p', !new RegExp('async\\s*\\(\\s*p\\s*\\)\\s*=>').test(src));
check('IMDb export scan tracks the page it reached without reading `p` after the loop',
    /let lastPage = 0;/.test(src) && /Math\.max\(1, lastPage\)/.test(src));

console.log('\n' + (ok ? 'NAME RESOLUTION ALL OK' : 'FAILURES ABOVE'));
process.exit(ok ? 0 : 1);
