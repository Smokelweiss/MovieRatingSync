/**
 * Movie Rating Sync — extension background.
 *
 * The page-side engine cannot make cross-origin requests to Kinopoisk/IMDb/
 * Letterboxd (CORS), so every network call is proxied here. The background
 * context carries the user's cookies and the host permissions, so requests
 * look like the user's own.
 *
 * Works both as an MV3 service worker (Chrome/Edge) and as an MV2 background
 * page (Firefox) without a browser.*/chrome.* polyfill.
 */

// Cap simultaneous upstream requests so the sites do not throttle us harder.
const MAX_INFLIGHT = 12;

// Tab IDs whose content script has announced itself. Only those may trigger
// downloads.
const TRUSTED_TABS = new Set();

let inflight = 0;
const queue = [];

function acquire() {
    if (inflight < MAX_INFLIGHT) {
        inflight++;
        return Promise.resolve();
    }
    return new Promise(resolve => queue.push(resolve));
}

function release() {
    const next = queue.shift();
    if (next) next();
    else inflight--;
}

async function handleStorage(msg, sender) {
    const tabId = sender && sender.tab && sender.tab.id;
    if (!TRUSTED_TABS.has(tabId)) return { ok: false };
    const key = msg.key;
    if (typeof key !== 'string' || !key.startsWith('mrs_')) return { ok: false };
    if (msg.op === 'set') {
        await chrome.storage.local.set({ [key]: msg.value });
        return { ok: true };
    }
    if (msg.op === 'del') {
        await chrome.storage.local.remove(key);
        return { ok: true };
    }
    return { ok: false };
}

async function handleFetch(msg) {
    const url = msg.url;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        throw new Error('Blocked URL: ' + String(url).slice(0, 80));
    }
    await acquire();
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), msg.timeout || 15000);
    try {
        const opts = {
            method: msg.method || 'GET',
            headers: msg.headers || {},
            credentials: 'include',
            redirect: 'follow',
            signal: ctrl.signal,
        };
        if (msg.body != null) opts.body = msg.body;
        const resp = await fetch(url, opts);
        const text = await resp.text();
        let headers = '';
        try {
            for (const [k, v] of resp.headers) headers += `${k}: ${v}\r\n`;
        } catch (e) { /* opaque headers — ignore */ }
        return {
            ok: resp.ok,
            status: resp.status,
            statusText: resp.statusText || '',
            responseHeaders: headers,
            text,
            finalUrl: resp.url || url,
        };
    } finally {
        clearTimeout(tid);
        release();
    }
}

function handleDownload(msg, sender) {
    const tabId = sender && sender.tab && sender.tab.id;
    if (!TRUSTED_TABS.has(tabId)) return Promise.resolve({ ok: false, error: 'Untrusted sender' });
    if (typeof msg.url !== 'string' || !msg.url.startsWith('blob:')) {
        return Promise.resolve({ ok: false, error: 'Only blob: URLs may be downloaded' });
    }
    if (typeof chrome.downloads === 'undefined') return Promise.resolve({ ok: false, error: 'downloads unavailable' });
    return new Promise((resolve) => {
        chrome.downloads.download({ url: msg.url, filename: msg.filename, saveAs: false }, (id) => {
            const err = chrome.runtime.lastError;
            resolve({ ok: !err && id != null, id: id == null ? null : id, error: err && err.message });
        });
    });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.type === 'mrs:hello') {
        if (sender && sender.tab && sender.tab.id != null) TRUSTED_TABS.add(sender.tab.id);
        sendResponse({ ok: true });
        return false;
    }
    if (msg.type === 'mrs:storage') {
        handleStorage(msg, sender)
            .then(sendResponse)
            .catch(() => sendResponse({ ok: false }));
        return true;
    }
    if (msg.type === 'mrs:fetch') {
        handleFetch(msg)
            .then(sendResponse)
            .catch(e => sendResponse({
                status: 0,
                statusText: '',
                responseHeaders: '',
                text: '',
                error: String((e && e.message) || e),
            }));
        return true;
    }
    if (msg.type === 'mrs:download') {
        handleDownload(msg, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
        return true;
    }
    return false;
});

if (chrome.tabs && chrome.tabs.onRemoved) {
    chrome.tabs.onRemoved.addListener((tabId) => TRUSTED_TABS.delete(tabId));
}
