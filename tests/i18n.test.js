'use strict';

/**
 * i18n tests for movie-rating-sync.user.js
 * Run: node tests/i18n.test.js
 *
 * Verifies:
 *  1. TRANSLATIONS parses without invoking t() (a past regression crashed at load)
 *  2. Every language defines exactly the same key set as English
 *  3. t() returns a non-empty string for every key in every language
 *  4. All t('...') / t("...") call sites reference keys that exist in the table
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'movie-rating-sync.user.js'), 'utf8');

// ---------------------------------------------------------------------------
// Extract the TRANSLATIONS literal with brace-matching (string-aware).
// Works whether the object is on one line or reformatted across many.
// ---------------------------------------------------------------------------
function extractTranslations(src) {
    const marker = 'const TRANSLATIONS = ';
    const start = src.indexOf(marker);
    assert(start !== -1, 'Could not locate `const TRANSLATIONS =` in the userscript');

    const openIdx = src.indexOf('{', start + marker.length);
    assert(openIdx !== -1, 'No `{` after const TRANSLATIONS');

    let depth = 0;
    let inStr = null; // null | "'" | '"'
    let escaped = false;
    for (let i = openIdx; i < src.length; i++) {
        const ch = src[i];
        if (inStr) {
            if (escaped) { escaped = false; continue; }
            if (ch === '\\') { escaped = true; continue; }
            if (ch === inStr) inStr = null;
            continue;
        }
        if (ch === "'" || ch === '"') { inStr = ch; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return src.slice(openIdx, i + 1);
        }
    }
    assert.fail('Unbalanced braces while extracting TRANSLATIONS literal');
}
const literalText = extractTranslations(SRC);

let TRANSLATIONS;
try {
    // eslint-disable-next-line no-new-func
    TRANSLATIONS = new Function('t', `return ${literalText};`)(() => {
        throw new Error('t() was called during TRANSLATIONS initialization — this crashes the script at load time');
    });
} catch (e) {
    assert.fail(`TRANSLATIONS literal must not call t() at module init: ${e.message}`);
}

const LANGS = Object.keys(TRANSLATIONS);
const EN_KEYS = Object.keys(TRANSLATIONS.en);

// Guard against accidental test pass when the literal didn't extract
assert(LANGS.length >= 9, `Expected at least 9 languages, got ${LANGS.length}: ${LANGS.join(', ')}`);
assert(EN_KEYS.length > 40, `Suspiciously few English keys (${EN_KEYS.length}) — extraction may have failed`);

let passed = 0;
const check = (name, fn) => {
    try {
        fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        console.error(`  ❌ ${name}`);
        throw e;
    }
};

console.log('Languages:', LANGS.join(', '));
console.log('English keys:', EN_KEYS.length);

// ---------------------------------------------------------------------------
// 1. Key parity across languages
// ---------------------------------------------------------------------------
check('Every language has identical key sets', () => {
    const problems = [];
    for (const lang of LANGS) {
        const keys = Object.keys(TRANSLATIONS[lang]);
        const notInEn = keys.filter(k => !EN_KEYS.includes(k));
        const notInLang = EN_KEYS.filter(k => !keys.includes(k));
        if (notInEn.length) problems.push(`${lang} has extra keys: ${notInEn.join(', ')}`);
        if (notInLang.length) problems.push(`${lang} is missing keys: ${notInLang.join(', ')}`);
    }
    assert.strictEqual(problems.length, 0, problems.join('\n'));
});

// ---------------------------------------------------------------------------
// 2. All translations are non-empty strings
// ---------------------------------------------------------------------------
check('Every key has a non-empty string in every language', () => {
    const empty = [];
    for (const lang of LANGS) {
        for (const key of EN_KEYS) {
            const v = TRANSLATIONS[lang][key];
            if (typeof v !== 'string' || v.trim() === '') empty.push(`${lang}.${key}`);
        }
    }
    assert.strictEqual(empty.length, 0, `Empty/missing values: ${empty.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 3. No t(...) references inside the TRANSLATIONS literal
//    (the HEAD regression was `ratings: t(t('ratings'))` inside the literal)
// ---------------------------------------------------------------------------
check('TRANSLATIONS literal contains no t() calls', () => {
    const bad = [...literalText.matchAll(/\bt\(/g)];
    assert.strictEqual(bad.length, 0, `Found ${bad.length} t() call(s) inside TRANSLATIONS: ` +
        literalText.substring(Math.max(0, (bad[0]?.index ?? 0) - 60), (bad[0]?.index ?? 0) + 60));
});

// ---------------------------------------------------------------------------
// 4. Every t('...') call site (outside the literal) references a known key
// ---------------------------------------------------------------------------
check('All t(...) call sites use known keys', () => {
    const endOfLiteral = SRC.indexOf(literalText) + literalText.length;
    const body = SRC.slice(endOfLiteral);
    const calls = new Set();
    for (const mm of body.matchAll(/\bt\(\s*['"]([^'"]+)['"]\s*\)/g)) calls.add(mm[1]);
    const unknown = [...calls].filter(k => !EN_KEYS.includes(k));
    assert.strictEqual(unknown.length, 0, `Unknown translation keys used in code: ${unknown.join(', ')}`);
});

console.log(`\n📊 Results: ${passed} passed, 0 failed`);
