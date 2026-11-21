// Guard: every run entry point must turn a thrown error into the shared error
// card. Previously the export handler rendered `'❌ ' + e.message` through the
// result renderer, which wiped the phase rows and left a bare "p is not
// defined" with no hint about the phase that died.
//
// The error card keeps the rows, marks the in-flight one as failed and shows
// the message in the (red) header.
import { readFileSync } from 'node:fs';

const src = readFileSync('movie-rating-sync.user.js', 'utf8').replace(/\r\n/g, '\n');

let ok = true;
const check = (label, cond, extra) => {
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (extra && !cond ? '\n     ' + extra : ''));
  if (!cond) ok = false;
};

// 1. The helper exists and does the three things that make the card readable.
const renderError = src.match(/function renderError\(el, err, elapsedMs\) \{[\s\S]*?\n    \}/);
check('renderError is defined', !!renderError);
check('renderError marks the in-flight phase row as failed',
  !!renderError && /finishChannel\(el, channel, false\)/.test(renderError[0]));
check('renderError keeps the rows (no result renderer)',
  !!renderError && !/renderResult\(/.test(renderError[0]) && !/textContent = ''/.test(renderError[0]));
check('renderError paints the header as a failure',
  !!renderError && /mrs-status__header--fail/.test(renderError[0]));
check('renderError stops the run timer',
  !!renderError && /clearInterval\(el\.__statusTimer\)/.test(renderError[0]));

// 2. A failing helper must never take the whole handler down with it.
check('reportRunError wraps renderError in a try/catch',
  /function reportRunError[\s\S]*?try \{ renderError\([\s\S]*?catch/.test(src));

// 3. Every entry point reports through reportRunError.
check('export button reports errors through reportRunError',
  /catch \(e\) \{\s*\n\s*reportRunError\(statusEl, e, Date\.now\(\) - exportStart\);/.test(src));
check('import file handler reports errors through reportRunError',
  /catch \(err\) \{ reportRunError\(statusEl, err, Date\.now\(\) - importStart\); \}/.test(src));
check('KP deep-search retry reports errors',
  /runKPImportBatch\(result\.missed, statusEl, mode, true, getImportOptions\(\)\)[\s\S]{0,400}catch \(err\) \{ reportRunError/.test(src));
check('IMDb deep-search retry reports errors',
  /imdbProcess\(result\.missed, rated, watched, statusEl, true, mode, getImportOptions\(\)\)[\s\S]{0,400}catch \(err\) \{ reportRunError/.test(src));
check('LB deep-search retry reports errors',
  /performLBImport\(buildCSV\(result\.missed\), statusEl, mode, true, getImportOptions\(\), result\.sourcePlatform\)[\s\S]{0,200}catch \(err\) \{ reportRunError/.test(src));

// 4. No handler should fall back to the old bare-message path.
check('no bare ❌ result renderer remains',
  !/renderResult\(statusEl, '❌ '/.test(src));

// 5. The in-flight channel is recorded by the shared writer.
check('the row writer records the active channel',
  /el\.__lastChannel = channel;/.test(src));
check('clearStatus forgets the active channel',
  /el\.__lastChannel = null;/.test(src));

console.log('\n' + (ok ? 'ERROR CARD ALL OK' : 'FAILURES ABOVE'));
process.exit(ok ? 0 : 1);
