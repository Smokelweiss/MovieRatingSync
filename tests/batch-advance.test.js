// Guards the batch loops that slice by an adaptive concurrency value.
//
// The pattern `slice = items.slice(cur, cur + probe.c)` followed by
// `cur += probe.c` is a silent data-loss bug: probeOk/probeFail may change
// `probe.c` between the slice and the advance, so the loop skips (or re-runs)
// items without ever searching or writing them. The advance must use the
// slice length (`cur = to`) instead.

const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'movie-rating-sync.user.js');
const src = fs.readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n');
const lines = src.split('\n');

const failures = [];
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures.push(name);
};

// --- 1. No loop advances by a live probe value -------------------------------
// `cur += chunkSize` (a local snapshot taken before the await) is fine;
// `cur += <something>.c` is not.
const offenders = [];
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i].trim();
  if (!/^cur \+= /.test(line)) continue;
  if (/^cur \+= chunkSize;/i.test(line) || /^cur \+= pages\.length;/i.test(line)) continue;
  offenders.push(`${i + 1}: ${line}`);
}
check(
  'no batch loop advances by an adaptive probe value',
  offenders.length === 0,
  offenders.join(' | ')
);

// --- 2. Every probe-sliced loop advances from the slice end ------------------
// Each `const to = Math.min(cur + X.c, ...)` must be followed by `cur = to;`
// before the loop closes.
const probeSlices = [];
for (let i = 0; i < lines.length; i += 1) {
  if (/const to = Math\.min\(cur \+ .*\.c, /.test(lines[i])) probeSlices.push(i);
}
check('probe-sliced loops found', probeSlices.length >= 4, `${probeSlices.length} loops`);

const missingAdvance = [];
for (const start of probeSlices) {
  let found = false;
  for (let i = start; i < Math.min(start + 120, lines.length); i += 1) {
    if (/cur = to;/.test(lines[i])) { found = true; break; }
    if (/^while \(cur < /.test(lines[i]) && i > start) break;
  }
  if (!found) missingAdvance.push(`${start + 1}: ${lines[start].trim()}`);
}
check('each probe-sliced loop advances with cur = to', missingAdvance.length === 0, missingAdvance.join(' | '));

// --- 3. The slices are captured before any await -----------------------------
// `cur + probe.c` must appear in the same statement as the slice/to pair so a
// probe change can never desynchronise them.
const desync = [];
for (const start of probeSlices) {
  const sliceLine = lines[start - 1] ?? '';
  const mSlice = sliceLine.match(/^const slice = items\.slice\(cur, cur \+ (.*\.c)\);/);
  const mTo = lines[start].match(/const to = Math\.min\(cur \+ (.*\.c), /);
  if (mSlice && mTo && mSlice[1] !== mTo[1]) {
    desync.push(`${start}: slice uses ${mSlice[1]} but to uses ${mTo[1]}`);
  }
}
check('slice and to use the same concurrency value', desync.length === 0, desync.join(' | '));

console.log('');
if (failures.length) {
  console.log(`BATCH ADVANCE FAILED (${failures.length})`);
  process.exit(1);
}
console.log('BATCH ADVANCE ALL OK');
