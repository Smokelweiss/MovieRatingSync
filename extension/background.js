/**
 * Movie Rating Sync — extension background request proxy.
 *
 * The in-page engine cannot make every request itself: Kinopoisk, IMDb and
 * Letterboxd only send CORS headers for their own origin (verified — IMDb's
 * GraphQL gateway answers `Access-Control-Allow-Origin: https://www.imdb.com`,
 * Kinopoisk's answers `https://www.kinopoisk.ru`, Letterboxd's autocomplete
 * answers none at all). So every network call is proxied here, where the
 * extension's host permissions and the user's cookies apply.
 *
 * Works as a MV3 service worker (Chrome/Edge) and as a MV2 background page
 * (Firefox), with no polyfill for the extension API namespaces.
 */

// Cap simultaneous upstream requests so the sites do not throttle us harder
// than the engine already does.
const MAX_INFLIGHT = 16;

// Hosts this proxy may talk to — mirrors the manifest permissions.
const ALLOWED_HOSTS = [
    'www.kinopoisk.ru',
    'graphql.kinopoisk.ru',
    'www.imdb.com',
    'api.graphql.imdb.com',
    'sg.media-imdb.com',
    'letterboxd.com',
];

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

function isAllowed(url) {
    if (typeof url !== 'string') return false;
    let parsed;
    try {
        parsed = new URL(url);
    } catch (e) {
        return false;
    }
    return /^https?:$/.test(parsed.protocol) && ALLOWED_HOSTS.includes(parsed.hostname);
}

function headersToString(headers) {
    if (!headers) return '';
    let out = '';
    try {
        for (const [k, v] of Object.entries(headers)) {
            if (v == null) continue;
            out += `${k}: ${v}\r\n`;
        }
    } catch (e) { /* ignore */ }
    return out;
}

// `Retry-After` is what the engine's throttling reads, so header parsing must
// stay raw text — no header object survives the message boundary.
async function handleFetch(msg) {
    if (!isAllowed(msg.url)) {
        return { status: 0, statusText: '', responseHeaders: '', text: '', error: `Blocked URL: ${String(msg.url).slice(0, 80)}` };
    }

    const timeout = Number(msg.timeout) > 0 ? Number(msg.timeout) : 15000;
    await acquire();
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeout);
    try {
        const method = msg.method || 'GET';
        const init = {
            method,
            headers: msg.headers || {},
            // The sites authenticate by cookie, so the proxy sends the user's
            // own session — the same thing the page would have sent.
            credentials: 'include',
            redirect: 'follow',
            signal: ctrl.signal,
        };
        if (msg.data != null && method !== 'GET' && method !== 'HEAD') {
            init.body = msg.data;
        }
        const r = await fetch(msg.url, init);
        const text = await r.text();
        return {
            status: r.status,
            statusText: r.statusText || '',
            responseHeaders: headersToString(Object.fromEntries([...r.headers.entries()])),
            text,
            finalUrl: r.url,
        };
    } catch (e) {
        const reason = e && e.name === 'AbortError'
            ? `Timeout after ${timeout}ms`
            : String((e && e.message) || e);
        return { status: 0, statusText: '', responseHeaders: '', text: '', error: reason };
    } finally {
        clearTimeout(tid);
        release();
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'mrs:fetch') return false;
    handleFetch(msg).then(sendResponse, (e) => {
        sendResponse({ status: 0, statusText: '', responseHeaders: '', text: '', error: String((e && e.message) || e) });
    });
    // Keep the channel open for the async reply.
    return true;
});
