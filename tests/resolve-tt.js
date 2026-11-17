// Resolve ttIds to real titles/years via IMDb suggest API
const ids = (process.argv[2] || '').split(',').filter(Boolean);
if (!ids.length) { console.log('usage: node resolve-tt.js tt1,tt2,...'); process.exit(0); }

async function resolve(tt) {
  try {
    const r = await fetch('https://v2.sg.media-imdb.com/suggestion/t/' + tt + '.json');
    const text = await r.text();
    const m = text.match(/\((\{.*\})\)\s*$/);
    if (!m) return { tt, raw: text.slice(0, 80) };
    const j = JSON.parse(m[1]);
    const it = j.d && j.d[0];
    if (!it) return { tt, raw: text.slice(0, 120) };
    return {
      tt,
      title: it.l,
      year: it.y,
      type: it.qid || (it.q ? it.q : ''),
      id: it.id
    };
  } catch (e) {
    return { tt, err: String(e && e.message || e).slice(0, 100) };
  }
}

(async () => {
  for (const tt of ids) {
    const info = await resolve(tt);
    console.log(JSON.stringify(info));
  }
})();
