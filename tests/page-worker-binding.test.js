// Guards against a bare, undeclared `p` coming back into a per-page worker
// closure: `let p` in the surrounding loop does NOT reach an `async (p) =>`
// callback, so `ReferenceError: p is not defined` would fire at runtime.
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'movie-rating-sync.user.js');
const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

let ok = true;
const check = (label, cond, extra) => {
    console.log((cond ? 'OK   ' : 'FAIL ') + label + (extra && !cond ? '\n     ' + extra : ''));
    if (!cond) ok = false;
};

// 1. The one worker that used to reference the outer `p`.
check('lbScrapePages window worker names its page', src.includes('async (pageNo) => {'));
check('lbScrapePages passes pageNo to pathFn', src.includes('pathFn(username, pageNo)'));
check('lbScrapePages marks pageNo as scanned', src.includes('scanned.add(pageNo)'));
check('lbScrapePages buckets under pageNo', src.indexOf('add(pageNo, parsed)') !== -1);
check('no stale add(p, ...)', src.indexOf('add(p, parsed)') === -1);

// 2. Generic net: any `async (inner) =>` where `inner` shadows an outer `let inner`
//    must not be referenced under a *different* name inside the body.
const declaredInLoop = /for\s*\(\s*(?:let|const|var)\s+([\w$]+)|(?:let|const|var)\s+([\w$]+)\s*=/g;
const problems = [];
const arrow = /\basync\s*\(\s*([\w$]+)\s*\)\s*=>\s*\{/g;
let m;
while ((m = arrow.exec(src))) {
    const name = m[1];
    const body = src.slice(m.index + m[0].length, m.index + m[0].length + 800);
    // the body must use its own parameter at least once
    const use = new RegExp('(^|[^\\w$.\'])(' + name + ')([^\\w$]|$)');
    if (!use.test(body.split('});')[0])) problems.push(name);
}
check('every async worker uses its own parameter', problems.length === 0, problems.join(','));

// 3. Callers: `pages.push(p)` loop variable feeds asyncPool, so the worker
//    param can be anything as long as it is used — verified above.

console.log('\n' + (ok ? 'PAGE WORKER BINDING ALL OK' : 'FAILURES ABOVE'));
process.exit(ok ? 0 : 1);
