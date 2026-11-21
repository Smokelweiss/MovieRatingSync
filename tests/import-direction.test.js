// Guard: the file of records that could not be imported must say where the
// data came from and which site refused it — `imdb_to_lb_missed_…` rather than
// `lb_missed.csv`. The direction is detected from the CSV header (KpId / TtId /
// LbSlug) and survives the deep-search retry.
//
// The real implementations are extracted from the userscript and executed,
// so the test exercises the shipped code rather than a copy of it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'movie-rating-sync.user.js'), 'utf8').replace(/\r\n/g, '\n');

// Slice a top-level helper: from its name up to the first line holding only
// `}` at exactly 4 spaces of indentation.
function helper(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('helper not found: ' + name);
  const end = src.indexOf('\n    }\n', start);
  if (end < 0) throw new Error('helper end not found: ' + name);
  return src.slice(start, end + 6);
}
const slice = (re) => {
  const m = src.match(re);
  if (!m) throw new Error('slice not found: ' + re);
  return m[0];
};

const code = [
  slice(/const PLATFORM_SHORT = \{[^}]*\};/),
  slice(/const PLATFORM_NAME = \{[^}]*\};/),
  slice(/const PLATFORM_DIRECTION = (?:[^;]|\n)*?;\n/),
  helper('detectCsvSource'),
  helper('missedFileName'),
].join('\n');

const impl = new Function(`${code}\nreturn { detectCsvSource, missedFileName, PLATFORM_DIRECTION };`)();

let ok = true;
const check = (label, cond, extra) => {
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (extra && !cond ? '\n     ' + extra : ''));
  if (!cond) ok = false;
};

const hdr = (...c) => '\uFEFF' + c.join(',') + '\r\n';
const date = new Date().toISOString().slice(0, 10);

// 1. Source detection from the export columns.
check('KpId header means the file came from Kinopoisk',
  impl.detectCsvSource(hdr('TitleRu', 'KpId', 'Rating10')) === 'kp');
check('TtId header means the file came from IMDb',
  impl.detectCsvSource(hdr('TitleRu', 'TitleOrig', 'TtId', 'Rating10')) === 'imdb');
check('LbSlug header means the file came from Letterboxd',
  impl.detectCsvSource(hdr('Title', 'Year', 'LbSlug', 'Rating10')) === 'lb');
check('a foreign header (Title,Year,Rating10) is unknown, not guessed',
  impl.detectCsvSource(hdr('Title', 'Year', 'Rating10')) === null);
check('an empty file is unknown', impl.detectCsvSource('') === null);

// 2. File names carry both ends, the count and the date.
const f1 = impl.missedFileName('imdb', 'lb', 42);
check('IMDb → Letterboxd file names both ends', f1 === `imdb_to_lb_missed_42_${date}.csv`, f1);
const f2 = impl.missedFileName('kp', 'imdb', 7);
check('Kinopoisk → IMDb file names both ends', f2 === `kp_to_imdb_missed_7_${date}.csv`, f2);
const f3 = impl.missedFileName(null, 'lb', 3);
check('unknown source still names the target', f3 === `to_lb_missed_3_${date}.csv`, f3);
check('no two directions share a name',
  new Set([impl.missedFileName('kp', 'lb', 1), impl.missedFileName('imdb', 'lb', 1), impl.missedFileName('lb', 'kp', 1)]).size === 3);
check('the old short names are gone',
  !/downloadCSV\(buildCSV\(result\.missed\), '(?:kp|imdb|lb)_missed\.csv'/.test(src));

// 3. Directions read naturally in the card title.
check('direction label reads Kinopoisk → IMDb',
  impl.PLATFORM_DIRECTION('kp', 'imdb') === 'Kinopoisk \u2192 IMDb');
check('unknown source renders as a dash, not "undefined"',
  impl.PLATFORM_DIRECTION(null, 'lb') === '- \u2192 Letterboxd');

// 4. The source is detected at import time and survives the deep-search retry.
check('every import detects the source platform',
  (src.match(/const from = detectCsvSource\(csvData\);/g) || []).length >= 2
  && /performLBImport\(csvData, statusEl, mode, deep = false, opts = \{\}, sourcePlatform = null\)/.test(src)
  && /\? sourcePlatform : detectCsvSource\(csvData\)/.test(src));
check('the result carries the source platform',
  (src.match(/result\.sourcePlatform = from;/g) || []).length === 2
  && /sourcePlatform: from \}, statusEl, mode\)/.test(src));
check('deep-search retries keep the original direction',
  (src.match(/r2\.sourcePlatform = result\.sourcePlatform;/g) || []).length === 2
  && /performLBImport\(buildCSV\(result\.missed\), statusEl, mode, true, getImportOptions\(\), result\.sourcePlatform\)/.test(src));
check('the missed file name comes from the direction, not a constant',
  (src.match(/downloadCSV\(buildCSV\(result\.missed\), missedFileName\(from, '/g) || []).length === 3);
check('the run title states the direction',
  (src.match(/beginRun\(statusEl, PLATFORM_DIRECTION\(from, '(?:kp|imdb|lb)'\)\);/g) || []).length === 3);

console.log('\n' + (ok ? 'IMPORT DIRECTION ALL OK' : 'FAILURES ABOVE'));
process.exit(ok ? 0 : 1);
