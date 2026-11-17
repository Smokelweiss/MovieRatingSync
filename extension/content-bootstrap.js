/**
 * Movie Rating Sync — content entry point.
 *
 * Loaded as a content script in the isolated world. Forwards a small API to
 * the page-side engine (injected as content.js) and receives it via
 * window.postMessage.
 */
(function () {
    'use strict';

    const hasExt = typeof chrome !== 'undefined'
        && chrome.runtime && typeof chrome.runtime.getURL === 'function'
        && typeof chrome.runtime.sendMessage === 'function';

    const MARK = '__MRS_EXT__';
    const HOOK_ID = '__mrsExtHook';
    const TARGETS = 'kinopoisk.ru,imdb.com,letterboxd.com';

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------
    function isOwnKey(key) {
        return typeof key === 'string' && key.startsWith('mrs_');
    }

    const storage = (() => {
        const mirror = new Map();
        const ready = new Promise((resolve) => {
            if (!hasExt) { resolve(); return; }
            try {
                chrome.storage.local.get(null, (all) => {
                    if (!chrome.runtime.lastError && all) {
                        for (const [k, v] of Object.entries(all)) if (isOwnKey(k)) mirror.set(k, v);
                    }
                    resolve();
                });
            } catch (e) { resolve(); }
        });
        return { mirror, ready };
    })();

    function send(msg) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(msg, (resp) => {
                    if (chrome.runtime.lastError) {
                        resolve({ ok: false, error: chrome.runtime.lastError.message });
                        return;
                    }
                    resolve(resp);
                });
            } catch (e) {
                resolve({ ok: false, error: String((e && e.message) || e) });
            }
        });
    }

    // ------------------------------------------------------------------
    // Page-world bridge. The page gets a tiny API the engine calls; every call
    // is forwarded to this content script via window.postMessage.
    // ------------------------------------------------------------------
    function pageHookSource() {
        return '(' + function () {
            const HOOK_ID = '__mrsExtHook';
            if (window[HOOK_ID]) return;
            const pending = new Map();
            let seq = 0;
            window.addEventListener('message', (e) => {
                if (e.source !== window) return;
                const d = e.data;
                if (!d || d.__mrsExt !== 1 || d.dir !== 'res') return;
                const cb = pending.get(d.id);
                if (!cb) return;
                pending.delete(d.id);
                cb(d.payload);
            });
            const call = (op, args) => new Promise((resolve) => {
                const id = ++seq;
                pending.set(id, resolve);
                window.postMessage({ __mrsExt: 1, dir: 'req', id, op, args: args || [] }, '*');
            });
            const sync = {};
            window[HOOK_ID] = {
                extension: true,
                sync,
                getValue: (k, d) => (k in sync ? sync[k] : d),
                setValue: (k, v) => { sync[k] = v; return call('set', [k, v]); },
                deleteValue: (k) => { delete sync[k]; return call('del', [k]); },
                listValues: () => Object.keys(sync),
                request: (details) => call('req', [details]),
                download: (url, filename) => call('dl', [url, filename]),
            };
        }.toString() + ')();';
    }

    function handlePageMessage(event) {
        if (event.source !== window) return;
        const d = event.data;
        if (!d || d.__mrsExt !== 1 || d.dir !== 'req') return;
        const reply = (payload) => window.postMessage({ __mrsExt: 1, dir: 'res', id: d.id, payload }, '*');
        const args = Array.isArray(d.args) ? d.args : [];

        if (d.op === 'set') {
            const [key, value] = args;
            if (!isOwnKey(key)) { reply({ ok: false }); return; }
            storage.mirror.set(key, value);
            send({ type: 'mrs:storage', op: 'set', key, value }).then(reply);
            return;
        }
        if (d.op === 'del') {
            const [key] = args;
            if (!isOwnKey(key)) { reply({ ok: false }); return; }
            storage.mirror.delete(key);
            send({ type: 'mrs:storage', op: 'del', key }).then(reply);
            return;
        }
        if (d.op === 'req') {
            const det = args[0] || {};
            send({
                type: 'mrs:fetch',
                url: det.url,
                method: det.method || 'GET',
                headers: det.headers || {},
                body: det.data == null ? null : det.data,
                timeout: det.timeout || 15000,
            }).then((r) => {
                const resp = r || {};
                reply({
                    error: resp.error || (resp.status === 0 ? 'Network error' : ''),
                    status: resp.status || 0,
                    statusText: resp.statusText || '',
                    responseHeaders: resp.responseHeaders || '',
                    responseText: resp.text || '',
                    finalUrl: resp.finalUrl,
                });
            });
            return;
        }
        if (d.op === 'dl') {
            const [url, filename] = args;
            if (typeof url !== 'string' || !url.startsWith('blob:')) { reply({ ok: false }); return; }
            send({ type: 'mrs:download', url, filename: filename || undefined }).then(reply);
            return;
        }
        reply({ ok: false });
    }

    async function start() {
        if (hasExt) {
            // Wait (briefly) for the synchronous storage mirror so the engine's
            // startup reads (language, options) are already populated.
            await Promise.race([storage.ready, new Promise(r => setTimeout(r, 1500))]);
            send({ type: 'mrs:hello' });
            window.addEventListener('message', (e) => handlePageMessage(e), false);
            const hook = document.createElement('script');
            hook.textContent = pageHookSource();
            (document.head || document.documentElement).appendChild(hook);
            hook.remove();
        }

        const el = document.createElement('script');
        el.src = hasExt ? chrome.runtime.getURL('content.js') : 'content.js';
        el.addEventListener('load', () => el.remove());
        el.addEventListener('error', () => el.remove());
        (document.documentElement || document.head).appendChild(el);
    }

    void MARK; void TARGETS;
    start();
})();
