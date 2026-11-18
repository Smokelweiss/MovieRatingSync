// Unit test for titleKey() — the matching key used to skip a network search
// for films that are already rated on the target profile.
// Run: node tests/title-key.test.js
//
// titleKey() leans on normTitle() and its helper chain, so the real
// implementations are lifted out of the userscript instead of being copied.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'movie-rating-sync.user.js'), 'utf8');

// Return the source text of a top-level `const NAME = ...;` declaration,
// stopping at the matching semicolon so nested braces do not end it early.
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

const parts = [
    grabDecl('memoStr'),
    grabDecl('NUM_WORDS'),
    grabDecl('normalizeNumerals'),
    grabDecl('normTitle'),
    grabFunction('titleKey'),
    'module.exports = { titleKey, normTitle };',
];
const sandbox = { module: { exports: {} }, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(parts.join('\n'), sandbox, { filename: 'titleKey-extract.js' });
const { titleKey, normTitle } = sandbox.module.exports;

let pass = 0;
let fail = 0;
const eq = (actual, expected, msg) => {
    if (actual === expected) { pass++; console.log(`  ok   ${msg}`); return; }
    fail++;
    console.log(`  FAIL ${msg}\n         expected: ${JSON.stringify(expected)}\n         actual:   ${JSON.stringify(actual)}`);
};

console.log('titleKey()');

// Same film listed with and without a year must differ, so a remake does not
// shadow the original.
eq(titleKey('The Matrix', '1999'), `${normTitle('The Matrix')}|1999`, 'year is appended to the normalised title');
eq(titleKey('The Matrix', '1999') !== titleKey('The Matrix', '2021'), true, 'different years produce different keys');

// Year-less fallback: CSV rows without a year keep the plain title key.
eq(titleKey('The Matrix', ''), normTitle('The Matrix'), 'empty year yields a bare title key');
eq(titleKey('The Matrix', null), normTitle('The Matrix'), 'null year yields a bare title key');
eq(titleKey('The Matrix'), normTitle('The Matrix'), 'missing year yields a bare title key');

// Series years arrive as ranges such as "2021-2023"; the start year is the one
// Letterboxd and Kinross both index by.
const s = titleKey('Dark', '2017–2020');
if (s.endsWith('|2017')) { pass++; console.log('  ok   en-dash series range keeps the start year'); }
else { fail++; console.log(`  FAIL en-dash series range keeps the start year (got ${s})`); }
const h = titleKey('Dark', '2017-2020');
if (h.endsWith('|2017')) { pass++; console.log('  ok   hyphen series range keeps the start year'); }
else { fail++; console.log(`  FAIL hyphen series range keeps the start year (got ${h})`); }

// A year glued to punctuation (trailing comma from CSV) still parses.
const p = titleKey('The Matrix', '1999,');
if (p.endsWith('|1999')) { pass++; console.log('  ok   trailing punctuation does not break the year'); }
else { fail++; console.log(`  FAIL trailing punctuation does not break the year (got ${p})`); }

// Non-1900s/2000s numbers are not years and must not be used as one.
eq(titleKey('1917', '2019').endsWith('|2019'), true, 'film titled 1917 uses its release year, not its title');

// Case, accents, articles and Cyrillic/Latin spelling are normalised the same
// way on both sides of the lookup.
eq(titleKey('THE MATRIX', '1999'), titleKey('The Matrix', '1999'), 'case-insensitive');
eq(titleKey('Amélie', '2001'), titleKey('Amelie', '2001'), 'accents are folded');
eq(titleKey('Ёлки', '2010'), titleKey('Ёлки', '2010'), 'Cyrillic titles are stable');
eq(titleKey('Ёлки', '2010'), titleKey('Елки', '2010'), 'Cyrillic ё folds to е so both spellings match');
eq(titleKey('Иван Васильевич меняет профессию', '1973'), titleKey('ИВАН ВАСИЛЬЕВИЧ МЕНЯЕТ ПРОФЕССИЮ', '1973'), 'Cyrillic case-insensitive');

// Degenerate input must return an empty key, never the string "undefined",
// so a blank CSV title cannot collide with a real one.
eq(titleKey('', '1999'), '', 'empty title yields an empty key');
eq(titleKey(null, '1999'), '', 'null title yields an empty key');
eq(titleKey(undefined), '', 'undefined title yields an empty key');
eq(titleKey('   ', ''), '', 'whitespace-only title yields an empty key');

console.log(`\n📊 ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
