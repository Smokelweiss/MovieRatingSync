// Regression guard for the adaptive concurrency controller.
//
// The old controller compared each round's average latency against the single
// fastest request ever seen. With a normal 200↔400 ms spread the "gradient"
// was permanently below 0.85, so concurrency shrank by 5 every round and every
// import (KP 899 films, IMDb 700, LB 899) settled at MIN = 5 — the root cause
// of the "minutes per import" complaint.
//
// Expected behaviour now:
//   * jitter around a stable latency must NOT shrink concurrency,
//   * stable latency must grow concurrency towards the platform maximum,
//   * a real (2×+) latency blow-up must back off,
//   * probeFail must back off and never go below MIN.
import { readFileSync } from 'node:fs';

const raw = readFileSync('movie-rating-sync.user.js', 'utf8').replace(/\r\n/g, '\n');

// Grab a function by name, balancing braces so the slice is exactly its body.
function grabFunction(name) {
  const start = raw.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`not found: function ${name}`);
  let depth = 0;
  let started = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '{') { depth += 1; started = true; }
    else if (ch === '}') {
      depth -= 1;
      if (started && depth === 0) return raw.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced: ${name}`);
}

const source = [
  'const CONCURRENCY = { INIT: 20, MAX: 200, UP: 10, DOWN: 5, MIN: 5 };',
  grabFunction('makeProbe'),
  grabFunction('probeOk'),
  grabFunction('probeFail'),
  'return { makeProbe, probeOk, probeFail };',
].join('\n');

const api = new Function(source)();

const failures = [];
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures.push(name);
};

// --- 1. Jitter must not collapse concurrency ------------------------------
// Realistic pattern: alternating "fast" and "slow" rounds for 40 rounds.
const jitter = api.makeProbe(30, 200);
for (let i = 0; i < 40; i += 1) api.probeOk(jitter, i % 2 ? 420 : 210);
check(
  'jittery latency does not shrink concurrency',
  jitter.c >= 30,
  `c=${jitter.c} (started at 30)`
);

// --- 2. Stable latency grows concurrency ----------------------------------
const stable = api.makeProbe(20, 200);
for (let i = 0; i < 30; i += 1) api.probeOk(stable, 250);
check('stable latency grows concurrency', stable.c > 20, `c=${stable.c} (started at 20)`);
check('growth is capped by maxC', stable.c <= 200, `c=${stable.c}`);

// --- 3. A real latency blow-up backs off ----------------------------------
const blow = api.makeProbe(100, 200);
for (let i = 0; i < 10; i += 1) api.probeOk(blow, 200);  // baseline ~200 ms
const before = blow.c;
for (let i = 0; i < 6; i += 1) api.probeOk(blow, 900);   // 4.5× slower rounds
check(
  'sustained 4.5× latency reduces concurrency',
  blow.c < before,
  `c=${blow.c}, before=${before}`
);

// --- 4. probeFail always backs off ---------------------------------------
const failing = api.makeProbe(50, 200);
api.probeFail(failing);
check('probeFail reduces concurrency', failing.c === 45, `c=${failing.c}`);

const floored = api.makeProbe(5, 200);
api.probeFail(floored);
check('probeFail never goes below MIN', floored.c === 5, `c=${floored.c}`);

console.log('');
console.log(failures.length ? `CONCURRENCY PROBE FAILED (${failures.length})` : 'CONCURRENCY PROBE ALL OK');
process.exit(failures.length ? 1 : 0);
