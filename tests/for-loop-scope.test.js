// Regression guard: a `for (let X ...)` variable does NOT exist after the loop
// closes, because `let`/`const` in a loop header are block-scoped to the loop.
// Reading it afterwards throws `ReferenceError: X is not defined` at runtime.
//
// This is exactly what killed the IMDb export right after "Detecting IMDb
// profile": the loop declared `p`, and a status write after the loop read it.
//
// The detector below is a small, self-validated scanner: it braces the loop,
// then looks for reads of the loop-only name in the rest of the enclosing
// function, ignoring property access, object keys, and shadowing arrow params.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'movie-rating-sync.user.js');
const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const LINES = raw.split('\n');

// Remove comments and quoted text but KEEP code inside template-literal ${...}
// expressions, where the offending read lived.
function stripText(line) {
    let out = '', i = 0;
    const lastChar = () => { for (let k = out.length - 1; k >= 0; k--) if (!/\s/.test(out[k])) return out[k]; return ''; };
    while (i < line.length) {
        const c = line[i];
        if (c === '/' && line[i + 1] === '/') break;
        if (c === '/' && line[i + 1] === '*') { const e = line.indexOf('*/', i + 2); i = e < 0 ? line.length : e + 2; continue; }
        if (c === '"' || c === "'") { const q = c; i++; while (i < line.length && line[i] !== q) { if (line[i] === '\\') i++; i++; } i++; out += 'S'; continue; }
        if (c === '`') {
            i++;
            while (i < line.length && line[i] !== '`') {
                if (line[i] === '\\') { i += 2; continue; }
                if (line[i] === '$' && line[i + 1] === '{') {
                    i += 2; let depth = 1; out += '(';
                    while (i < line.length && depth > 0) {
                        if (line[i] === '{') depth++;
                        else if (line[i] === '}') { depth--; if (!depth) { i++; break; } }
                        else if (line[i] === '"' || line[i] === "'") { const q = line[i]; i++; while (i < line.length && line[i] !== q) { if (line[i] === '\\') i++; i++; } i++; out += 'S'; continue; }
                        out += line[i]; i++;
                    }
                    out += ')';
                    continue;
                }
                i++;
            }
            i++; continue;
        }
        if (c === '/') {
            const p = lastChar();
            if (p === '' || '(,=:[!&|{;?'.includes(p)) {
                i++; let cls = false;
                while (i < line.length) {
                    if (line[i] === '\\') { i += 2; continue; }
                    if (line[i] === '[') cls = true;
                    else if (line[i] === ']') cls = false;
                    else if (line[i] === '/' && !cls) { i++; break; }
                    i++;
                }
                while (i < line.length && /[gimsuy]/.test(line[i])) i++;
                out += 'R'; continue;
            }
        }
        out += c; i++;
    }
    return out;
}

// A shadowing arrow parameter (`x =>`, `(a, x) =>`) makes later reads legal.
const shadowedByArrow = (name, code) =>
    new RegExp('(?:^|[(,{])\\s*' + name + '\\s*(?:[,)=])[^;]*=>').test(code) ||
    new RegExp('\\b' + name + '\\s*=>').test(code);

function findForOnlyReads(lines) {
    const issues = [];
    for (let i = 0; i < lines.length; i++) {
        const m = /^(\s*)for\s*\(\s*(let|const)\s+([A-Za-z_$][\w$]*)/.exec(lines[i]);
        if (!m) continue;
        const name = m[3];

        // brace the loop body
        let open = -1, depth = 0, close = -1;
        for (let k = i; k < lines.length; k++) {
            const code = stripText(lines[k]);
            if (open < 0) {
                if (!code.includes('{')) continue;
                open = k;
            }
            depth += (code.match(/\{/g) || []).length - (code.match(/\}/g) || []).length;
            if (depth === 0) { close = k; break; }
        }
        if (close <= i) continue;

        for (let n = close + 1; n < lines.length; n++) {
            const rawLine = lines[n];
            if (!/\S/.test(rawLine)) continue;
            // Stop at the end of the block that held the loop: a `let` from the
            // loop header only dies with that block, not with the whole function.
            const ind = rawLine.match(/^ */)[0].length;
            const loopInd = lines[i].match(/^ */)[0].length;
            if (ind < loopInd) break;
            const code = stripText(rawLine);
            if (!/\S/.test(code)) continue;
            // a new declaration or a new loop header ends the search (the read is
            // then legal: either it is the loop's own scope or a fresh binding)
            if (new RegExp('\\b(?:let|const|var|function)\\s+(?:[\\[{][^\\]}]*[\\[{]?)?' + name + '\\b').test(code)) break;
            if (new RegExp('\\bfor\\s*\\(\\s*(?:const|let|var)\\s*(?:[\\[{][^\\]}]*)?\\b' + name + '\\b').test(code)) break;
            if (shadowedByArrow(name, code)) break;
            // object property / key positions are not reads
            const probe = code
                .replace(new RegExp('\\.' + name + '\\b', 'g'), '.P')
                .replace(new RegExp('\\b' + name + '\\s*:(?!:)', 'g'), 'K')
                .replace(new RegExp('([,{]\\s*)' + name + '\\s*[,}]', 'g'), '$1O')
                .replace(new RegExp('\\b' + name + '\\s*=>', 'g'), 'F')
                .replace(new RegExp('\\(\\s*[A-Za-z_$][\\w$]*(?:\\s*,\\s*[A-Za-z_$][\\w$]*)*\\s*,\\s*' + name + '\\s*\\)\\s*=>', 'g'), 'F');
            if (!new RegExp('\\b' + name + '\\b').test(probe)) continue;
            issues.push('line ' + (n + 1) + ': `' + name + '` is read after its loop (loop at line ' + (i + 1) + ')');
            break;
        }
    }
    return issues;
}

let ok = true;
const check = (label, cond, extra) => {
    console.log((cond ? 'OK   ' : 'FAIL ') + label + (extra && !cond ? '\n     ' + extra : ''));
    if (!cond) ok = false;
};

// 1. The detector itself must catch the shape it is here to catch.
const buggy = [
    'const scan = async () => {',
    '    const items = [];',
    '    for (let p = 1; p <= 10; p++) {',
    '        const nd = await fetchPage(p);',
    '        if (!nd) break;',
    '        items.push(nd);',
    '    }',
    '    write(`page ${Math.max(1, p - 1)}`, { extra: items.length });',
    '};',
].join('\n').split('\n');
check('detector flags a loop variable read in a later template literal',
    findForOnlyReads(buggy).length === 1, findForOnlyReads(buggy).join(' | '));

// 2. Legal shapes must not be flagged.
const legal = [
    'function good() {',
    '    let last = 0;',
    '    for (let p = 1; p <= 10; p++) { last = p; }',
    '    write(`page ${Math.max(1, last)}`);',
    '    const arr = [1, 2, 3];',
    '    for (let i = 0; i < arr.length; i++) { total += arr[i]; }',
    '    const mapped = arr.map(i => i * 2);',
    '    return total + mapped.length;',
    '}',
].join('\n').split('\n');
check('detector ignores a tracked variable and arrow params',
    findForOnlyReads(legal).length === 0, findForOnlyReads(legal).join(' | '));

// 3. The real script must be clean.
const issues = findForOnlyReads(LINES);
check('no for-loop variable is read after its loop in the userscript',
    issues.length === 0, issues.join('\n     '));

// 4. Keep the specific fix in place: the IMDb listings report a tracked page.
check('IMDb export tracks the page number outside the loop',
    /let lastPage = 0;/.test(raw) && /Math\.max\(1, lastPage\)/.test(raw));

console.log('\n' + (ok ? 'FOR LOOP SCOPE ALL OK' : 'FAILURES ABOVE'));
process.exit(ok ? 0 : 1);
