// Guard tests for the precision rules that decide whether a search hit may be
// written. Every check here corresponds to a real wrong-rating bug, so a
// regression fails loudly instead of silently mixing up films.
// Run: node tests/match-guards.test.js
//
// The implementations are lifted out of the userscript with the vm pattern from
// title-key.test.js, so the tests cannot drift from the shipped code.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'movie-rating-sync.user.js'), 'utf8');

function grabDecl(name) {
    const start = src.indexOf(`const ${name} `);
    if (start < 0) throw new Error(`declaration not found: ${name}`);
    let depth = 0;
    for (let i = start; i < src.length; i++) {
        const ch = src[i];
        if (ch === '(' || ch === '{' || ch === '[') depth++;
        else if (ch === ')' || ch === '}' || ch === ']') depth--;
        else if (ch === ';' && depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unterminated declaration: ${name}`);
}

function grabFunction(name) {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`function not found: ${name}`);
    let depth = 0;
    for (let i = src.indexOf('(', start); i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    throw new Error(`unterminated function: ${name}`);
}

// `const NAME = {...}` and `const NAME = new Set(...)` live outside grabDecl
// because they start with `const NAME =` rather than `const NAME `.
function grabAssignment(name) {
    const needle = `const ${name} =`;
    const start = src.indexOf(needle);
    if (start < 0) throw new Error(`assignment not found: ${name}`);
    let depth = 0;
    for (let i = start; i < src.length; i++) {
        const ch = src[i];
        if (ch === '(' || ch === '{' || ch === '[') depth++;
        else if (ch === ')' || ch === '}' || ch === ']') depth--;
        else if (ch === ';' && depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unterminated assignment: ${name}`);
}

const parts = [
    'const DEBUG = false;',
    'const YEAR_TOL = 1;',
    grabDecl('memoStr'),
    grabDecl('NUM_WORDS'),
    grabDecl('normalizeNumerals'),
    grabDecl('normTitle'),
    grabDecl('cleanTitle'),
    grabDecl('hasCyr'),
    grabDecl('CYR'),
    grabDecl('translit'),
    grabDecl('yearsMatch'),
    grabAssignment('DERIVATIVE_TYPES'),
    grabFunction('typeFamily'),
    grabFunction('titleMatchKind'),
    grabFunction('isSearchableTitle'),
    grabFunction('scoreCandidateDetail'),
    grabFunction('titleEvidenceOk'),
    grabFunction('bestAcceptable'),
    grabFunction('confidenceLabel'),
    'module.exports = { normTitle, cleanTitle, translit, yearsMatch, typeFamily, titleMatchKind, isSearchableTitle, scoreCandidateDetail, titleEvidenceOk, bestAcceptable, confidenceLabel };',
];
const sandbox = { module: { exports: {} }, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
try {
    vm.runInContext(parts.join('\n'), sandbox, { filename: 'match-guards-extract.js' });
} catch (e) {
    console.error('EXTRACT ERROR:', e.message);
    process.exit(1);
}
const M = sandbox.module.exports;

let pass = 0;
let fail = 0;
const eq = (actual, expected, msg) => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log(`  ok   ${msg}`); return; }
    fail++;
    console.log(`  FAIL ${msg}\n         expected: ${JSON.stringify(expected)}\n         actual:   ${JSON.stringify(actual)}`);
};
const ok = (cond, msg) => eq(!!cond, true, msg);

console.log('isSearchableTitle() — rows that must never reach a search endpoint');
ok(!M.isSearchableTitle(''), 'empty title rejected');
ok(!M.isSearchableTitle(null), 'null title rejected');
ok(!M.isSearchableTitle('   '), 'whitespace-only title rejected');
ok(!M.isSearchableTitle('film:378945'), 'Letterboxd film placeholder rejected');
ok(!M.isSearchableTitle('tv:1234'), 'Letterboxd tv placeholder rejected');
ok(!M.isSearchableTitle('123456'), 'bare numeric id rejected');
ok(!M.isSearchableTitle('The'), 'article-only title rejected');
ok(M.isSearchableTitle('Up'), 'short but real title accepted');
ok(M.isSearchableTitle('Saw'), 'two-letter-plus title accepted');
ok(M.isSearchableTitle('Пила'), 'Cyrillic title accepted');

console.log('\ntitleMatchKind() — prefix vs random shared substring');
eq(M.titleMatchKind('the matrix', 'the matrix'), 'exact', 'identical titles are exact');
eq(M.titleMatchKind('leon', 'leon the professional'), 'prefix', 'shortened title is a prefix');
eq(M.titleMatchKind('the raid', 'the raid redemption'), 'prefix', 'prefix with a dropped colon');
eq(M.titleMatchKind('matrix', 'a glitch in the matrix'), '', 'query inside a longer title is not evidence');
eq(M.titleMatchKind('alien', 'aliens'), '', 'no prefix without a word boundary');
eq(M.titleMatchKind('saw', 'saw 2'), 'prefix', 'sequel relation is still a prefix');

console.log('\nscoreCandidateDetail() — titleKind/idExact reporting');
{
    const srcObj = { title: 'The Raid', titleRu: 'The Raid', year: '2011', allTitles: [] };
    const exact = M.scoreCandidateDetail(srcObj, { title: 'The Raid', year: '2011' });
    eq(exact.titleKind, 'exact', 'same title reports exact');
    const pref = M.scoreCandidateDetail(srcObj, { title: 'The Raid: Redemption', year: '2011' });
    eq(pref.titleKind, 'substring', 'subtitle relation reports substring');
    const mid = M.scoreCandidateDetail(srcObj, { title: 'A Glitch in the Matrix', year: '2021' });
    eq(mid.titleKind, '', 'shared words in the middle report no title evidence');
    const id = M.scoreCandidateDetail(
        { ...srcObj, ttId: 'tt1899353' },
        { ttId: 'tt1899353', title: 'Serbuan maut', year: '2011' });
    eq(id.idExact, true, 'identical external id is reported as idExact');
}

console.log('\nbestAcceptable() — the final write gate');
{
    const source = { title: 'The Raid', year: '2012' };
    ok(!M.bestAcceptable({ titleKind: '', score: 700, confidence: 'medium', year: '2012' }, source, false),
        'no title evidence is refused even at medium score');
    ok(!M.bestAcceptable({ titleKind: 'substring', score: 690, confidence: 'medium', year: '2014' }, source, false),
        'subtitle guess with a disagreeing year is refused');
    ok(M.bestAcceptable({ titleKind: 'substring', score: 690, confidence: 'medium', year: '2012' }, source, false),
        'subtitle guess with an agreeing year passes');
    ok(!M.bestAcceptable({ titleKind: 'substring', score: 900, confidence: 'high', year: '' }, source, true),
        'subtitle guess without any year stays refused even in Hard Import');
    ok(M.bestAcceptable({ titleKind: 'exact', score: 520, confidence: 'medium', year: '2012' }, source, false),
        'exact title with an agreeing year passes');
    ok(M.bestAcceptable({ idExact: true, titleKind: '', score: 1000, confidence: 'high', year: '1999' }, { year: '2012' }, false),
        'identical external id overrides the year');
}

console.log('\ntitleEvidenceOk() — summary gate used by the early-return paths');
{
    const srcObj = { title: 'Saw', year: '2003' };
    ok(!M.titleEvidenceOk({ titleKind: '' }, srcObj, { year: '2003' }), 'no title evidence refused');
    ok(M.titleEvidenceOk({ titleKind: 'exact' }, srcObj, { year: '2004' }), 'exact title accepted regardless of year');
    ok(!M.titleEvidenceOk({ titleKind: 'substring' }, srcObj, { year: '' }), 'substring without a year refused');
    ok(M.titleEvidenceOk({ idExact: true, titleKind: '' }, { year: '2003' }, { year: '1999' }), 'id bridge accepted');
}

console.log('\ntypeFamily() / DERIVATIVE_TYPES — extras must not win a film row');
eq(M.typeFamily('TvMovie'), 'tvmovie', 'TV movie recognised');
eq(M.typeFamily('Video'), 'video', 'video recognised');
eq(M.typeFamily('Short'), 'short', 'short recognised');
eq(M.typeFamily('Film'), 'movie', 'film maps to movie');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
