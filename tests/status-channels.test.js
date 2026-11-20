// Smoke test for the parallel-source status rows: Ratings / Diary / Watched /
// Likes must each own one row and never overwrite each other's text.
import { readFileSync } from 'node:fs';

const src = readFileSync('movie-rating-sync.user.js', 'utf8');

class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this._text = '';
    this.dataset = {};
    this.className = '';
    this.style = {};
    this.isConnected = true;
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get classList() {
    const self = this;
    const list = () => self.className.split(/\s+/).filter(Boolean);
    return {
      add: (...c) => { self.className = [...new Set([...list(), ...c])].join(' '); },
      remove: (...c) => { self.className = list().filter(x => !c.includes(x)).join(' '); },
      contains: c => list().includes(c),
    };
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...kids) { kids.forEach(k => this.appendChild(k)); }
  after(node) {
    const p = this.parentNode;
    if (!p) return;
    p.children.splice(p.children.indexOf(this) + 1, 0, node);
    node.parentNode = p;
  }
  replaceWith(node) {
    const p = this.parentNode;
    if (!p) return;
    p.children[p.children.indexOf(this)] = node;
    node.parentNode = p;
  }
  matches(sel) {
    const m = /^\.([\w-]+)$/.exec(sel);
    return m ? this.classList.contains(m[1]) : false;
  }
  querySelector(sel) {
    const ch = /^\[data-channel="(.+)"\]$/.exec(sel);
    if (ch) {
      const want = ch[1].replace(/\\(.)/g, '$1');
      return this.walk().find(e => e.dataset.channel === want) || null;
    }
    return this.walk().find(e => e.matches(sel)) || null;
  }
  walk() { return this.children.flatMap(c => [c, ...c.walk()]); }
  querySelectorAll(sel) { return this.walk().filter(e => e.matches(sel)); }
}

globalThis.document = { createElement: t => new El(t) };
globalThis.CSS = { escape: s => String(s).replace(/["\\]/g, m => '\\' + m) };

const names = ['ensureChannels', 'channelRow', 'setRowParts', 'updateOverallBar', 'setChannelStatus', 'finishChannel', 'channelWriter'];
const decls = names.map(name => {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('missing function ' + name);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
});

const rules = [];
const check = (label, ok) => rules.push([label, !!ok]);

const api = new Function(decls.join('\n') + '\nreturn { channelWriter, finishChannel, setChannelStatus };')();

// Realistic shell: a header, then the channels list.
const statusEl = new El();
const header = statusEl.appendChild(new El());
header.className = 'mrs-status__header';

const ratings = api.channelWriter(statusEl, 'Ratings');
const diary = api.channelWriter(statusEl, 'Diary');
const watched = api.channelWriter(statusEl, 'Watched');
const likes = api.channelWriter(statusEl, 'Likes');

ratings('page 1/5', { current: 1, total: 5 });
diary('page 2/5', { current: 2, total: 5 });
watched('page 3/5', { current: 3, total: 5 });
likes('page 1/5', { current: 1, total: 5 });
ratings('page 4/5', { current: 4, total: 5 });

const list = statusEl.querySelector('.mrs-status__channels');
check('channels list created', !!list);
check('one row per source', list.children.length === 4);
check('rows live under the header', statusEl.children.indexOf(list) === 1);

const text = (channel) => {
  const row = statusEl.querySelector(`[data-channel="${channel}"]`);
  return row.querySelector('.mrs-status__row-main')?.textContent ?? '';
};
const meta = (channel) => {
  const row = statusEl.querySelector(`[data-channel="${channel}"]`);
  return row.querySelector('.mrs-status__row-meta')?.textContent ?? '';
};

check('ratings keeps its own latest text', text('Ratings') === 'page 4/5');
check('diary was not overwritten by ratings', text('Diary') === 'page 2/5');
check('watched was not overwritten by ratings', text('Watched') === 'page 3/5');
check('likes was not overwritten by ratings', text('Likes') === 'page 1/5');
check('ratings meta shows 4/5', meta('Ratings').includes('4/5'));

api.finishChannel(statusEl, 'Diary', true);
const diaryRow = statusEl.querySelector('[data-channel="Diary"]');
check('finished row is marked done', diaryRow.classList.contains('mrs-status__row--done'));
check('finished row shows a check', diaryRow.querySelector('.mrs-status__row-mark')?.textContent === '✓');
check('diary text survives completion', text('Diary') === 'page 2/5');

api.finishChannel(statusEl, 'Likes', false);
const likesRow = statusEl.querySelector('[data-channel="Likes"]');
check('failed row is marked fail', likesRow.classList.contains('mrs-status__row--fail'));
check('failed row shows !', likesRow.querySelector('.mrs-status__row-mark')?.textContent === '!');

// A late update must not un-finish a row.
api.finishChannel(statusEl, 'Diary', true);
check('row is finished once only', diaryRow.querySelectorAll('.mrs-status__row-mark').length === 1);

// Text without progress still lands in the row, never in the header.
ratings('done');
check('plain text update keeps the row', text('Ratings') === 'done');

let failed = 0;
for (const [label, ok] of rules) {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
}
console.log(failed === 0 ? `\nALL OK (${rules.length} checks)` : `\n${failed} FAILED of ${rules.length}`);
process.exit(failed === 0 ? 0 : 1);
