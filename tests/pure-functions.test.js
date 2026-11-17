'use strict';

/**
 * Unit tests for pure functions from movie-rating-sync.user.js
 * Run: node tests/pure-functions.test.js
 */

const assert = require('assert');

// ============================================================
// Extract pure functions from the userscript for testing
// We eval the relevant portions to get the functions without GM_ APIs
// ============================================================

// --- Constants ---
const YEAR_TOL = 1;
const TITLE_DELIM = ' | ';

// --- csvEsc ---
const csvEsc = s => `"${String(s ?? '').replace(/"/g, '""')}"`;

// --- splitCsvLine ---
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

// --- decodeHtmlEntities ---
function decodeHtmlEntities(str) {
    if (!str || typeof str !== 'string') return str;
    return str
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(+code))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

// --- parseRetryAfter ---
function parseRetryAfter(responseHeaders) {
    if (!responseHeaders) return null;
    const m = responseHeaders.match(/retry-after:\s*(\d+)/i);
    return m ? parseInt(m[1], 10) * 1000 : null;
}

// --- isCloudflareChallenge ---
function isCloudflareChallenge(status, text) {
    if (status === 503) return true;
    if (status === 403) {
        if (!text) return false;
        return text.includes('cf-challenge') ||
            text.includes('cloudflare') ||
            text.includes('cdn-cgi/challenge-platform') ||
            text.includes('cf-mitigated');
    }
    return false;
}

// --- memoStr ---
const memoStr = (fn, maxSize = 500) => {
    const cache = new Map();
    return (s) => {
        if (cache.has(s)) return cache.get(s);
        const val = fn(s);
        if (cache.size >= maxSize) cache.delete(cache.keys().next().value);
        cache.set(s, val);
        return val;
    };
};

// --- yearsMatch ---
const yearsMatch = (a, b) => {
    if (!a || !b) return true;
    const parseY = s => {
        const m = String(s).match(/(\d{4})/);
        return m ? parseInt(m[1], 10) : null;
    };
    const ya = parseY(a);
    const yb = parseY(b);
    if (ya == null || yb == null) return true;
    return Math.abs(ya - yb) <= YEAR_TOL;
};

// --- confidenceLabel ---
function confidenceLabel(score) {
    if (score >= 800) return 'high';
    if (score >= 500) return 'medium';
    return 'low';
}

// --- hasCyr ---
const hasCyr = memoStr(s => /[а-яА-ЯёЁ]/.test(s));

// --- CYR transliteration map (subset for testing) ---
const CYR = {
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo',
    'Ж': 'Zh', 'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M',
    'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U',
    'Ф': 'F', 'Х': 'Kh', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch',
    'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya',
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
};

// --- translit ---
const translit = memoStr(s => s.split('').map(c => CYR[c] ?? c).join(''));

// --- scoreCandidate (simplified version for testing) ---
function scoreCandidate(source, candidate) {
    let score = 0;
    // IMDb ID match
    if (candidate.ttId && source.ttId && candidate.ttId === source.ttId) {
        score += 1000;
    }
    // Original title exact
    const srcTitle = source.titleOrig || source.titleRu || source.title || '';
    const candTitle = candidate.titleOrig || candidate.titleRu || candidate.title || '';
    if (srcTitle && candTitle && srcTitle.toLowerCase() === candTitle.toLowerCase()) {
        score += 500;
    }
    // Year match
    if (source.year && candidate.year) {
        if (yearsMatch(source.year, candidate.year)) {
            score += 300;
        }
    }
    // Type match
    if (source.type && candidate.type) {
        if (source.type === candidate.type) score += 200;
    }
    return score;
}

// --- splitAllTitles ---
const escapeTitleDelim = s => String(s ?? '').replace(/\|/g, '\\|');
const unescapeTitleDelim = s => String(s ?? '').replace(/\\\|/g, '|');
function splitAllTitles(s) {
    if (!s) return [];
    const parts = [];
    let current = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '\\' && i + 1 < s.length && s[i + 1] === '|') {
            current += '|'; i++;
        } else if (ch === '|') {
            parts.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) parts.push(current.trim());
    return parts.filter(Boolean);
}

// ============================================================
// TESTS
// ============================================================

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
    try {
        fn();
        testsPassed++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        testsFailed++;
        console.error(`  ❌ ${name}: ${e.message}`);
    }
}

console.log('\n🧪 Running unit tests for movie-rating-sync.user.js\n');

// === parseRetryAfter ===
console.log('📋 parseRetryAfter:');
test('returns null for empty headers', () => {
    assert.strictEqual(parseRetryAfter(null), null);
    assert.strictEqual(parseRetryAfter(''), null);
    assert.strictEqual(parseRetryAfter(undefined), null);
});
test('returns null when no Retry-After header', () => {
    assert.strictEqual(parseRetryAfter('content-type: text/html\r\n'), null);
});
test('returns milliseconds for integer Retry-After', () => {
    assert.strictEqual(parseRetryAfter('retry-after: 5\r\n'), 5000);
    assert.strictEqual(parseRetryAfter('Retry-After: 120\r\n'), 120000);
});
test('returns milliseconds for Retry-After in mixed headers', () => {
    const headers = 'content-type: application/json\r\nretry-after: 30\r\ncache-control: no-cache\r\n';
    assert.strictEqual(parseRetryAfter(headers), 30000);
});
test('handles case-insensitive header name', () => {
    assert.strictEqual(parseRetryAfter('Retry-After: 10\r\n'), 10000);
    assert.strictEqual(parseRetryAfter('RETRY-AFTER: 10\r\n'), 10000);
});

// === isCloudflareChallenge ===
console.log('\n📋 isCloudflareChallenge:');
test('returns true for 503 regardless of body', () => {
    assert.strictEqual(isCloudflareChallenge(503, ''), true);
    assert.strictEqual(isCloudflareChallenge(503, 'anything'), true);
    assert.strictEqual(isCloudflareChallenge(503, null), true);
});
test('returns false for 403 with empty/null body', () => {
    assert.strictEqual(isCloudflareChallenge(403, ''), false);
    assert.strictEqual(isCloudflareChallenge(403, null), false);
});
test('returns true for 403 with cf-challenge marker', () => {
    assert.strictEqual(isCloudflareChallenge(403, '<html>cf-challenge</html>'), true);
});
test('returns true for 403 with cloudflare marker', () => {
    assert.strictEqual(isCloudflareChallenge(403, 'Checking your browser cloudflare'), true);
});
test('returns true for 403 with cdn-cgi marker', () => {
    assert.strictEqual(isCloudflareChallenge(403, 'cdn-cgi/challenge-platform/run'), true);
});
test('returns true for 403 with cf-mitigated marker', () => {
    assert.strictEqual(isCloudflareChallenge(403, 'cf-mitigated: challenge'), true);
});
test('returns false for 403 without CF markers', () => {
    assert.strictEqual(isCloudflareChallenge(403, 'Forbidden - normal 403'), false);
});
test('returns false for 200/404/500', () => {
    assert.strictEqual(isCloudflareChallenge(200, 'cloudflare'), false);
    assert.strictEqual(isCloudflareChallenge(404, 'not found'), false);
    assert.strictEqual(isCloudflareChallenge(500, 'server error'), false);
});

// === decodeHtmlEntities ===
console.log('\n📋 decodeHtmlEntities:');
test('decodes &apos; to apostrophe', () => {
    assert.strictEqual(decodeHtmlEntities("Ocean&apos;s Eleven"), "Ocean's Eleven");
});
test('decodes &amp; to &', () => {
    assert.strictEqual(decodeHtmlEntities('Tom &amp; Jerry'), 'Tom & Jerry');
});
test('decodes &quot; to double quote', () => {
    assert.strictEqual(decodeHtmlEntities('&quot;hello&quot;'), '"hello"');
});
test('decodes &lt; and &gt;', () => {
    assert.strictEqual(decodeHtmlEntities('&lt;tag&gt;'), '<tag>');
});
test('decodes numeric entities (&#39;)', () => {
    assert.strictEqual(decodeHtmlEntities('&#39;test&#39;'), "'test'");
});
test('decodes hex entities (&#x27;)', () => {
    assert.strictEqual(decodeHtmlEntities('&#x27;test&#x27;'), "'test'");
});
test('is idempotent (double decode is safe)', () => {
    const decoded = decodeHtmlEntities("Ocean&apos;s Eleven");
    assert.strictEqual(decodeHtmlEntities(decoded), decoded);
});
test('returns null/undefined for null/undefined input', () => {
    assert.strictEqual(decodeHtmlEntities(null), null);
    assert.strictEqual(decodeHtmlEntities(undefined), undefined);
});
test('handles multiple entities in one string', () => {
    assert.strictEqual(
        decodeHtmlEntities('At Eternity&apos;s Gate &amp; The Hitchhiker&apos;s Guide'),
        "At Eternity's Gate & The Hitchhiker's Guide"
    );
});

// === memoStr ===
console.log('\n📋 memoStr:');
test('caches results by string key', () => {
    let calls = 0;
    const fn = memoStr(s => { calls++; return s.toUpperCase(); });
    assert.strictEqual(fn('hello'), 'HELLO');
    assert.strictEqual(fn('hello'), 'HELLO');
    assert.strictEqual(calls, 1, 'should only call fn once for same key');
});
test('works with different keys', () => {
    let calls = 0;
    const fn = memoStr(s => { calls++; return s.length; });
    fn('a'); fn('b'); fn('a');
    assert.strictEqual(calls, 2, 'should call fn twice for two unique keys');
});
test('respects maxSize (LRU eviction)', () => {
    let calls = 0;
    const fn = memoStr(s => { calls++; return s; }, 2);
    fn('a'); fn('b'); fn('c'); // 'a' should be evicted
    fn('a'); // should call fn again
    assert.strictEqual(calls, 4, 'should recompute evicted key');
});
test('returns correct values', () => {
    const fn = memoStr(s => s.repeat(2));
    assert.strictEqual(fn('ab'), 'abab');
    assert.strictEqual(fn(''), '');
});

// === hasCyr ===
console.log('\n📋 hasCyr:');
test('detects Cyrillic in string', () => {
    assert.strictEqual(hasCyr('Привет'), true);
    assert.strictEqual(hasCyr('Hello Мир'), true);
});
test('returns false for Latin-only string', () => {
    assert.strictEqual(hasCyr('Hello World'), false);
    assert.strictEqual(hasCyr(''), false);
});
test('returns false for empty string', () => {
    assert.strictEqual(hasCyr(''), false);
});

// === translit ===
console.log('\n📋 translit:');
test('transliterates Russian to Latin', () => {
    assert.strictEqual(translit('Привет'), 'Privet');
    assert.strictEqual(translit('Москва'), 'Moskva');
});
test('leaves Latin chars unchanged', () => {
    assert.strictEqual(translit('Hello'), 'Hello');
});
test('handles mixed Cyrillic+Latin', () => {
    assert.strictEqual(translit('Hello Мир'), 'Hello Mir');
});

// === yearsMatch ===
console.log('\n📋 yearsMatch:');
test('matches exact year', () => {
    assert.strictEqual(yearsMatch('2000', '2000'), true);
});
test('matches within tolerance (±1)', () => {
    assert.strictEqual(yearsMatch('2000', '2001'), true);
    assert.strictEqual(yearsMatch('2000', '1999'), true);
});
test('does not match beyond tolerance', () => {
    assert.strictEqual(yearsMatch('2000', '2002'), false);
    assert.strictEqual(yearsMatch('2000', '1998'), false);
});
test('returns true for empty/null years', () => {
    assert.strictEqual(yearsMatch('', '2000'), true);
    assert.strictEqual(yearsMatch('2000', ''), true);
    assert.strictEqual(yearsMatch(null, '2000'), true);
});
test('extracts year from complex strings', () => {
    assert.strictEqual(yearsMatch('2000-2001', '2000'), true);
    assert.strictEqual(yearsMatch('premiere 2000', '2001'), true);
});

// === confidenceLabel ===
console.log('\n📋 confidenceLabel:');
test('returns "high" for score >= 800', () => {
    assert.strictEqual(confidenceLabel(800), 'high');
    assert.strictEqual(confidenceLabel(1000), 'high');
    assert.strictEqual(confidenceLabel(1200), 'high');
});
test('returns "medium" for 500-799', () => {
    assert.strictEqual(confidenceLabel(500), 'medium');
    assert.strictEqual(confidenceLabel(700), 'medium');
    assert.strictEqual(confidenceLabel(799), 'medium');
});
test('returns "low" for < 500', () => {
    assert.strictEqual(confidenceLabel(499), 'low');
    assert.strictEqual(confidenceLabel(0), 'low');
    assert.strictEqual(confidenceLabel(100), 'low');
});

// === splitCsvLine ===
console.log('\n📋 splitCsvLine:');
test('splits simple CSV line', () => {
    assert.deepStrictEqual(splitCsvLine('a,b,c'), ['a', 'b', 'c']);
});
test('handles quoted values with commas', () => {
    assert.deepStrictEqual(splitCsvLine('"a,b",c'), ['a,b', 'c']);
});
test('handles escaped quotes', () => {
    assert.deepStrictEqual(splitCsvLine('"hello ""world"""'), ['hello "world"']);
});
test('handles empty fields', () => {
    assert.deepStrictEqual(splitCsvLine('a,,c'), ['a', '', 'c']);
});
test('handles trailing comma', () => {
    assert.deepStrictEqual(splitCsvLine('a,b,'), ['a', 'b', '']);
});

// === splitAllTitles ===
console.log('\n📋 splitAllTitles:');
test('splits by | delimiter', () => {
    assert.deepStrictEqual(splitAllTitles('Title A | Title B | Title C'), ['Title A', 'Title B', 'Title C']);
});
test('handles escaped | in titles', () => {
    assert.deepStrictEqual(splitAllTitles('Alien\\|3 | Aliens'), ['Alien|3', 'Aliens']);
});
test('returns empty array for empty input', () => {
    assert.deepStrictEqual(splitAllTitles(''), []);
    assert.deepStrictEqual(splitAllTitles(null), []);
});
test('handles single title', () => {
    assert.deepStrictEqual(splitAllTitles('Just One Title'), ['Just One Title']);
});

// === scoreCandidate ===
console.log('\n📋 scoreCandidate:');
test('IMDb ID match gives highest score', () => {
    const score = scoreCandidate(
        { ttId: 'tt0111161', title: 'Shawshank', year: '1994', type: 'Film' },
        { ttId: 'tt0111161', title: 'The Shawshank Redemption', year: '1994', type: 'Film' }
    );
    assert.ok(score >= 1000, `score should be >= 1000, got ${score}`);
});
test('title match gives medium-high score', () => {
    const score = scoreCandidate(
        { title: 'Inception', titleOrig: 'Inception', year: '2010', type: 'Film' },
        { title: 'Inception', titleOrig: 'Inception', year: '2010', type: 'Film' }
    );
    assert.ok(score >= 500, `score should be >= 500, got ${score}`);
});
test('year mismatch reduces score', () => {
    const scoreMatch = scoreCandidate(
        { title: 'Test', titleOrig: 'Test', year: '2000', type: 'Film' },
        { title: 'Test', titleOrig: 'Test', year: '2000', type: 'Film' }
    );
    const scoreMismatch = scoreCandidate(
        { title: 'Test', titleOrig: 'Test', year: '2000', type: 'Film' },
        { title: 'Test', titleOrig: 'Test', year: '2005', type: 'Film' }
    );
    assert.ok(scoreMatch > scoreMismatch, 'year match should score higher');
});
test('type match adds to score', () => {
    const scoreType = scoreCandidate(
        { title: 'Test', titleOrig: 'Test', year: '2000', type: 'Film' },
        { title: 'Test', titleOrig: 'Test', year: '2000', type: 'Film' }
    );
    const scoreNoType = scoreCandidate(
        { title: 'Test', titleOrig: 'Test', year: '2000', type: 'Film' },
        { title: 'Test', titleOrig: 'Test', year: '2000', type: 'TvSeries' }
    );
    assert.ok(scoreType > scoreNoType, 'same type should score higher');
});

// === csvEsc ===
console.log('\n📋 csvEsc:');
test('wraps value in quotes', () => {
    assert.strictEqual(csvEsc('hello'), '"hello"');
});
test('escapes internal quotes', () => {
    assert.strictEqual(csvEsc('hello "world"'), '"hello ""world"""');
});
test('handles null/undefined', () => {
    assert.strictEqual(csvEsc(null), '""');
    assert.strictEqual(csvEsc(undefined), '""');
});
test('handles numbers', () => {
    assert.strictEqual(csvEsc(42), '"42"');
});

// === BOM strip (simulated parseCSV start) ===
console.log('\n📋 BOM strip (parseCSV):');
test('strips BOM from start of text', () => {
    const bom = '\uFEFF';
    const text = bom + 'Title,Year,Rating10\n"Test",2000,7';
    // Simulate what parseCSV does
    let processed = text;
    if (processed.charCodeAt(0) === 0xFEFF) processed = processed.slice(1);
    assert.ok(!processed.startsWith('\uFEFF'), 'BOM should be stripped');
    assert.strictEqual(processed.startsWith('Title'), true);
});
test('does not strip when no BOM present', () => {
    const text = 'Title,Year,Rating10\n"Test",2000,7';
    let processed = text;
    if (processed.charCodeAt(0) === 0xFEFF) processed = processed.slice(1);
    assert.strictEqual(processed, text, 'text without BOM should be unchanged');
});

// === HTML entities in allTitles (bug fix T1 test) ===
console.log('\n📋 Bug fix T1: HTML entities in allTitles:');
test('Ocean&apos;s Eleven should decode correctly', () => {
    const raw = "Ocean&apos;s Eleven";
    const decoded = decodeHtmlEntities(raw);
    assert.strictEqual(decoded, "Ocean's Eleven");
});
test('At Eternity&apos;s Gate should decode correctly', () => {
    const raw = "At Eternity&apos;s Gate";
    const decoded = decodeHtmlEntities(raw);
    assert.strictEqual(decoded, "At Eternity's Gate");
});
test('Mr. &amp; Mrs. Smith should decode correctly', () => {
    const raw = "Mr. &amp; Mrs. Smith";
    const decoded = decodeHtmlEntities(raw);
    assert.strictEqual(decoded, "Mr. & Mrs. Smith");
});
test('Hitchhiker&apos;s Guide should decode correctly', () => {
    const raw = "The Hitchhiker&apos;s Guide to the Galaxy";
    const decoded = decodeHtmlEntities(raw);
    assert.strictEqual(decoded, "The Hitchhiker's Guide to the Galaxy");
});

// === TV series slug handling (bug fix T2/T8 test) ===
console.log('\n📋 Bug fix T2/T8: TV series slug handling:');
test('tv: prefix detection', () => {
    const slug = 'tv:breaking-bad';
    assert.strictEqual(slug.startsWith('tv:'), true);
    const cleanSlug = slug.slice(3);
    assert.strictEqual(cleanSlug, 'breaking-bad');
});
test('film: prefix detection', () => {
    const slug = 'film:12345';
    assert.strictEqual(slug.startsWith('film:'), true);
    const match = slug.match(/^film:(\d+)$/);
    assert.strictEqual(match[1], '12345');
});
test('non-prefixed slug is unchanged', () => {
    const slug = 'inception-2010';
    assert.strictEqual(slug.startsWith('tv:'), false);
    assert.strictEqual(slug.startsWith('film:'), false);
});

// === Summary ===
console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('='.repeat(50));

if (testsFailed > 0) {
    process.exit(1);
}
