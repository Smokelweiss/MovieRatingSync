// Regression guard for "el is not defined", which aborted the IMDb export and
// the Letterboxd export right after the per-channel status refactor.
//
// setStatus / clearStatus / renderResult / channelWriter / finishChannel all take
// the status element as their first argument. Some call sites were left passing a
// bare `el` inside a function whose element is named `statusEl`; that throws
// ReferenceError the first time the export reaches the line and kills the whole
// export mid-way (the user sees "Оборвался экспорт").
//
// The check uses the file's own layout: the userscript keeps one function per
// 4-space-indented header line, so a call site's scope is the innermost such
// span, and names declared anywhere in that span (or at module level, indent 4)
// are in scope. A name declared only inside a sibling function is not.
import { readFileSync } from 'node:fs';

const raw = readFileSync('movie-rating-sync.user.js', 'utf8').replace(/\r\n/g, '\n');
const lines = raw.split('\n');

const indentOf = (line) => line.length - line.trimStart().length;

// Blank out quoted strings and template text so brace counting, identifier
// extraction and regexes never see text the user reads in the UI.
function stripText(line) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i += 1;
      while (i < line.length && line[i] !== q) {
        if (line[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      out += ' ';
      continue;
    }
    if (c === '/' && line[i + 1] === '/') break;
    out += c;
    i += 1;
  }
  return out;
}

const codeLines = lines.map(stripText);

// ----------------------------------------------------- module-level names
// Module level in this file means exactly 4 spaces of indentation (the script
// body sits inside one IIFE).
const MODULE_INDENT = 4;
const moduleNames = new Set();
const declarationNames = (text, into) => {
  for (const m of text.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) into.add(m[1]);
  // `const { a, b: c } = ...` and `const [ x, y ] = ...`
  for (const m of text.matchAll(/\b(?:const|let|var)\s*\{([^}]{0,300})\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().split('=')[0].replace('...', '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) into.add(name);
    }
  }
  for (const m of text.matchAll(/\b(?:const|let|var)\s*\[([^\]]{0,300})\]\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split('=')[0].replace('...', '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) into.add(name);
    }
  }
};
for (const line of codeLines) {
  if (indentOf(line) === MODULE_INDENT) declarationNames(line, moduleNames);
}

// ------------------------------------------------------- function spans
// A span starts on the header line and ends on the first line that closes it.
// Multi-line headers are joined when the header does not contain `{`.
const isFunctionHeader = (text) => {
  const t = text.trim();
  return /^(async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.test(t)
    || /^(async\s+)?function\s*\(/.test(t)
    || /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(async\s*)?(?:function\s*\(|\()/.test(t)
    || /^[A-Za-z_$][\w$]*\s*:\s*(async\s*)?(?:function\s*\(|\()/.test(t); // object method
};

const spans = [];
for (let n = 0; n < codeLines.length; n += 1) {
  const line = codeLines[n];
  if (indentOf(line) > MODULE_INDENT) continue;
  if (!isFunctionHeader(line)) continue;
  // header may wrap: collect until the line that opens the body
  let header = line;
  let h = n;
  while (!header.includes('{') && h + 1 < codeLines.length) {
    h += 1;
    header += ' ' + codeLines[h];
  }
  const startLine = n;
  // body ends at the next line indented <= header indent that is `}`, `})`, `};`
  let endLine = codeLines.length - 1;
  for (let m = h + 1; m < codeLines.length; m += 1) {
    const t = codeLines[m].trim();
    if (indentOf(codeLines[m]) <= indentOf(line) && /^(}\s*(\)|\]|,|;)?\s*)$/.test(t)) { endLine = m; break; }
  }
  const names = new Set();
  // parameters of the header, including destructured ones
  const paramMatch = header.match(/\(\s*([^)]*)\)\s*(?:=>|\{)/);
  if (paramMatch) {
    for (const part of paramMatch[1].split(',')) {
      const name = part.split(/[:=]/)[0].replace('...', '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  spans.push({ startLine, endLine, header, names });
  declarationNames(header, spans[spans.length - 1].names);
  for (let m = startLine; m <= endLine; m += 1) declarationNames(codeLines[m], spans[spans.length - 1].names);
}

// Inner spans win over outer ones.
function scopeFor(lineIndex) {
  let best = null;
  for (const span of spans) {
    if (lineIndex >= span.startLine && lineIndex <= span.endLine) {
      if (!best || span.endLine - span.startLine < best.endLine - best.startLine) best = span;
    }
  }
  return best;
}

// ------------------------------------------------------------- the check
const HELPERS = new Set(['setStatus', 'clearStatus', 'renderResult', 'channelWriter', 'finishChannel', 'ensureChannels', 'beginRun', 'ensureStatusShell', 'setTitle']);
const problems = [];
for (let n = 0; n < codeLines.length; n += 1) {
  const text = codeLines[n];
  for (const m of text.matchAll(new RegExp(`\\b(${[...HELPERS].join('|')})\\s*\\(\\s*([A-Za-z_$][\\w$]*)\\s*[,)]`, 'g'))) {
    const helper = m[1];
    const name = m[2];
    // function definitions, not calls: `function setStatus(el, ...)` is a header
    if (new RegExp(`\\bfunction\\s+${helper}\\b`).test(text)) continue;
    if (moduleNames.has(name)) continue;
    const scope = scopeFor(n);
    if (scope && scope.names.has(name)) continue;
    problems.push(`${n + 1}: ${helper}(${name}, …)`);
  }
}

const failures = [];
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures.push(name);
};

check('every status helper receives a name that is in scope', problems.length === 0, problems.join(' | '));
check('IMDb export passes its own status element', /async function performIMDbExport\(statusEl\)\s*\{\s*const el = statusEl;/.test(raw));
check('no bare `el` remains in the IMDb export', !raw.includes("setStatus(el, t('fetchingLid'"));
check('KP export keeps its local alias', /async function performKPExport\(statusEl\)\s*\{\s*(?:const \w+ = Date\.now\(\);\s*)?const el = statusEl;/.test(raw));
check(
  'LB export keeps its local alias',
  /async function performLBExport\(statusEl\)\s*\{\s*const el = statusEl;/.test(raw)
);

console.log('');
console.log(failures.length ? `STATUS ELEMENT CHECK FAILED (${failures.length})` : 'STATUS ELEMENT CHECK ALL OK');
process.exit(failures.length ? 1 : 0);
