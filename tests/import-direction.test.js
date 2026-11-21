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
  slice(/const COLUMN_SOURCE = \{[^}]*\};/),
  helper('splitCsvLine'),
  helper('detectCsvSource'),
  helper('missedFileName'),
].join('\n');

const impl = new Function(`${code}\nreturn { detectCsvSource, missedFileName, PLATFORM_DIRECTION };`)();

let ok = true;
const check = (label, cond, extra) => {
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (extra && !cond ? '\n     ' + extra : ''));
  if (!cond) ok = false;
};

const date = new Date().toISOString().slice(0, 10);
const EXT_HEADER = 'TitleRu,TitleOrig,AllTitles,Type,KpId,TtId,LbSlug,YearStart,YearEnd,Rating10,Genres,Src';

// A real export of ours: same extended header every time, only one id column
// is filled. This is what used to be misread as Kinopoisk.
const ourFile = (row) => `${EXT_HEADER}\r\n${row}\r\n`;

// 1. Our own exports: the filled id column wins over the shared header.
check('Letterboxd export (only LbSlug filled) is read as Letterboxd',
  impl.detectCsvSource(ourFile('"","Носферату","Nosferatu | Носферату",Film,,,nosferatu,1922,,8,Horror,lb')) === 'lb');
check('IMDb export (only TtId filled) is read as IMDb',
  impl.detectCsvSource(ourFile('"","The Matrix","The Matrix",Film,,tt0133093,1999,,9,,,imdb')) === 'imdb');
check('Kinopoisk export (only KpId filled) is read as Kinopoisk',
  impl.detectCsvSource(ourFile('"Матрица","The Matrix","Матрица | The Matrix",Film,301,,,1999,,9,,,kp')) === 'kp');
check('the source wins even with no Src column (older files)',
  impl.detectCsvSource(EXT_HEADER.replace(',Src', '') + '\r\n"","X","X",Film,,,x-slug,1999,,7,,,\r\n') === 'lb');
check('the shared extended header alone does not mean Kinopoisk',
  impl.detectCsvSource(EXT_HEADER + '\r\n"","X","X",Film,,,,"1999",,7,,,\r\n') === null);

// 2. Foreign files without an id still resolve from their header.
check('Letterboxd web export (Title,Year,LbSlug) is read as Letterboxd',
  impl.detectCsvSource('\uFEFFDate,Name,Year,Letterboxd URI,Rating\r\n2026-01-01,X,1999,https://boxd.it/1,4\r\n') === 'lb');
check('IMDb ratings export (Const column) is read as IMDb',
  impl.detectCsvSource('\uFEFFConst,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Runtime,Year,Genres\r\ntt0133093,9,2026-01-01,The Matrix,https://www.imdb.com/title/tt0133093/,movie,8.7,136,1999,Sci-Fi\r\n') === 'imdb');
check('a foreign header (Title,Year,Rating10) is unknown, not guessed',
  impl.detectCsvSource('Title,Year,Rating10\r\nX,1999,7\r\n') === null);
check('an empty file is unknown', impl.detectCsvSource('') === null);

// 3. A file with two filled ids prefers the more specific column.
check('LbSlug beats an IMDb id when both are present',
  impl.detectCsvSource(ourFile('"","X","X",Film,tt0133093,tt0133093,nosferatu,1922,,8,,,') ) === 'lb');

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
