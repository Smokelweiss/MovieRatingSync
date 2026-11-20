// Regression test for asyncPool: a worker that returns a plain value (a cached
// tt id, a fast-path result, null) used to crash the whole batch with
// "worker(...).then is not a function" and freeze the import before any write.
import { readFileSync } from 'node:fs';

const src = readFileSync('movie-rating-sync.user.js', 'utf8').replace(/\r\n/g, '\n');

function loadPool() {
  const start = src.indexOf('async function asyncPool(');
  if (start < 0) throw new Error('asyncPool not found in the shipped script');
  const open = src.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (; end < src.length; end += 1) {
    if (src[end] === '{') depth += 1;
    else if (src[end] === '}') { depth -= 1; if (depth === 0) { end += 1; break; } }
  }
  const body = src.slice(start, end);
  return new Function(`${body}\nreturn asyncPool;`)();
}

const asyncPool = loadPool();
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures += 1;
};

const statuses = (res) => res.map((r) => (r.status === 'fulfilled' ? 'f' : 'r')).join('');

// 1. Sync return: the exact shape of a shallow IMDb hit (tt id / null).
{
  const res = await asyncPool(3, ['tt0111161', null], (x) => x);
  check('sync return does not crash the batch', true);
  check('sync return keeps per-item status', statuses(res) === 'ff', statuses(res));
  check('sync return keeps the values', res[0].value === 'tt0111161' && res[1].value === null);
}

// 2. Sync throw: the failing item is rejected, siblings still resolve.
{
  const res = await asyncPool(2, [1, 2], (n) => { if (n === 1) throw new Error('boom'); return 'ok'; });
  check('sync throw is wrapped as rejected, not rethrown', statuses(res) === 'rf', statuses(res));
  check('sync throw keeps the error', res[0].reason?.message === 'boom');
  check('sync throw does not poison siblings', res[1].value === 'ok');
}

// 3. Async worker still works.
{
  const res = await asyncPool(2, ['a', 'b'], async (x) => x.toUpperCase());
  check('promise worker still resolves', statuses(res) === 'ff');
  check('promise worker keeps values', res.map((r) => r.value).join(',') === 'A,B');
}

// 4. Order preserved, concurrency cap respected.
{
  const inFlight = { max: 0, now: 0 };
  const res = await asyncPool(3, [30, 10, 20, 5], async (ms) => {
    inFlight.now += 1;
    inFlight.max = Math.max(inFlight.max, inFlight.now);
    await new Promise((r) => setTimeout(r, ms));
    inFlight.now -= 1;
    return ms;
  });
  check('result order follows input order', res.map((r) => r.value).join(',') === '30,10,20,5');
  check('concurrency cap is respected', inFlight.max <= 3, `max ${inFlight.max}`);
}

// 5. A rejected promise is captured, not thrown out of the pool.
{
  const res = await asyncPool(2, ['x'], () => Promise.reject(new Error('nope')));
  check('async rejection is captured as rejected', statuses(res) === 'r');
}

// 6. Reflects a sync pass-through of a mixed batch (the IMDb search slice case):
//    tt ids, null misses and async lookups in one pool never abort that batch.
{
  const res = await asyncPool(4, ['tt1', null, 'tt2', 'tt3'], (x) => {
    if (x === 'tt3') return Promise.resolve({ ttId: 'tt3', confidence: 'high' });
    return x;
  });
  check('mixed sync/async batch completes', statuses(res) === 'ffff', statuses(res));
  check('mixed batch values are intact', res[3].value?.ttId === 'tt3');
}

console.log('');
console.log(failures ? `ASYNC POOL FAILED (${failures})` : 'ASYNC POOL ALL OK');
process.exit(failures ? 1 : 0);
