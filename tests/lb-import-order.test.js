// Guards the PHASE ORDER inside performLBImport.
//
// The id prefetch (needLid) used to run over every resolved row, including the
// ones `toApply` then drops as already-rated. On a re-import that is one wasted
// Letterboxd film-page request per skipped movie — hundreds of requests that
// buy nothing. The fix is an ordering contract:
//
//   1. `toApply` is decided first (it needs no network data),
//   2. `needLid` is a filter over `toApply`, never over `resolved`,
//   3. the prefetch loop is the only thing that fetches ids.
import { readFileSync } from 'node:fs';

const raw = readFileSync('movie-rating-sync.user.js', 'utf8').replace(/\r\n/g, '\n');

function body(name) {
  const start = raw.indexOf(`async function ${name}(`);
  if (start < 0) throw new Error(`not found: async function ${name}`);
  // Start after the parameter list: default values like `opts = {}` contain
  // braces that would close the brace counter immediately.
  let i = raw.indexOf(')', start);
  let parens = 0;
  for (i = raw.indexOf('(', start); i < raw.length; i += 1) {
    if (raw[i] === '(') parens += 1;
    else if (raw[i] === ')') { parens -= 1; if (!parens) break; }
  }
  let depth = 0;
  for (i = raw.indexOf('{', i); i < raw.length; i += 1) {
    if (raw[i] === '{') depth += 1;
    else if (raw[i] === '}') {
      depth -= 1;
      if (!depth) return raw.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced: ${name}`);
}

const import_ = body('performLBImport');
const failures = [];
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures.push(name);
};

const at = needle => import_.indexOf(needle);

// --- 1. toApply exists exactly once, before needLid --------------------------
check('toApply is built exactly once', (import_.match(/const toApply = /g) || []).length === 1,
  `${(import_.match(/const toApply = /g) || []).length} declarations`);
check('needLid is filtered from toApply', /const needLid = toApply\.filter\(/.test(import_),
  'expected `const needLid = toApply.filter(`');
check('needLid is never filtered from resolved', !/const needLid = resolved\.filter\(/.test(import_));
check('toApply is decided before needLid', at('const toApply = ') < at('const needLid = '),
  `toApply@${at('const toApply = ')}, needLid@${at('const needLid = ')}`);

// --- 2. Counters are declared once, before they are written ------------------
for (const name of ['rated', 'watched', 'skipped', 'notFound', 'failed', 'missed', 'favorites']) {
  const decl = name === 'favorites'
    ? (import_.match(/let favorites = 0/g) || []).length
    : (import_.match(new RegExp(`(?:let|const)[^;\\n]*\\b${name}\\b`, 'g')) || []).length;
  check(`\`${name}\` is declared once`, decl === 1, `${decl} declaration(s)`);
}

// --- 3. The id prefetch only walks needLid ------------------------------------
const poolLine = import_.split('\n').find(l => /await asyncPool\(10, needLid/.test(l));
check('id prefetch walks needLid only', !!poolLine, poolLine ? poolLine.trim().slice(0, 70) : 'missing');

console.log('');
if (failures.length) {
  console.log(`LB IMPORT ORDER FAILED (${failures.length})`);
  process.exit(1);
}
console.log('LB IMPORT ORDER ALL OK');
