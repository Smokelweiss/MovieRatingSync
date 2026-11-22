/**
 * Movie Rating Sync — content bootstrap.
 *
 * Runs before `content.js` in the same content-script (isolated) world, so both
 * files share one global object and no page-world script injection is needed
 * (injection is blocked by IMDb's and Kinopoisk's CSP).
 *
 * Responsibilities:
 *   1. install `window.__mrsExtHook` — the tiny API the generated GM_* shim in
 *      content.js is backed by,
 *   2. mirror `chrome.storage.local` into `localStorage`, because the engine
 *      reads its settings synchronously at startup,
 *   3. proxy every network call to the background page, where host permissions
 *      and the user's cookies live.
 */
(function () {
    'use strict';

    const hasExt = typeof chrome !== 'undefined'
        && chrome.runtime && typeof chrome.runtime.sendMessage === 'function';

    if (!hasExt) {
        console.error('[mrs] extension APIs missing: content.js cannot run');
        return;
    }

    const KEY_PREFIX = 'mrs_';
    const MIRROR_PREFIX = 'mrs:';

    function isOwnKey(key) {
        return typeof key === 'string' && key.startsWith(KEY_PREFIX);
    }

    // Storage, written straight to chrome.storage.local — a content script has
    // that API on its own, no background round trip needed.
    function storageSet(key, value) {
        try {
            chrome.storage.local.set({ [key]: value });
        } catch (e) { /* quota / unavailable */ }
    }

    function storageRemove(key) {
        try { chrome.storage.local.remove(key); } catch (e) { /* ignore */ }
    }

    // Synchronous mirror the engine reads. `localStorage` survives reloads, so
    // language and import options are available on the very first read; the
    // authoritative copy still lives in chrome.storage.local.
    const mirror = {
        read(key) {
            try {
                const raw = localStorage.getItem(MIRROR_PREFIX + key);
                if (raw != null) return JSON.parse(raw);
            } catch (e) { /* private mode / quota */ }
            return undefined;
        },
        write(key, value) {
            try { localStorage.setItem(MIRROR_PREFIX + key, JSON.stringify(value)); }
            catch (e) { /* quota exceeded — chrome.storage still has it */ }
        },
        remove(key) {
            try { localStorage.removeItem(MIRROR_PREFIX + key); } catch (e) { /* ignore */ }
        },
    };

    function send(msg) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(msg, (resp) => {
                    if (chrome.runtime.lastError) {
                        resolve({ ok: false, error: chrome.runtime.lastError.message });
                        return;
                    }
                    resolve(resp || { ok: false });
                });
            } catch (e) {
                resolve({ ok: false, error: String((e && e.message) || e) });
            }
        });
    }

    window.__mrsExtHook = {
        extension: true,
        // Engine-facing storage: returns undefined when the key is unset, which
        // the shim turns into the caller's default value.
        readValue: (key) => mirror.read(key),
        setValue(key, value) {
            if (!isOwnKey(key)) return;
            mirror.write(key, value);
            storageSet(key, value);
        },
        deleteValue(key) {
            if (!isOwnKey(key)) return;
            mirror.remove(key);
            storageRemove(key);
        },
        // Resolves with { status, statusText, responseHeaders, responseText, error }.
        request(details) {
            const d = details || {};
            return send({
                type: 'mrs:fetch',
                url: d.url,
                method: d.method || 'GET',
                headers: d.headers || {},
                data: d.data == null ? null : d.data,
                timeout: d.timeout || 15000,
            }).then((r) => ({
                status: r.status || 0,
                statusText: r.statusText || '',
                responseHeaders: r.responseHeaders || '',
                responseText: r.text ?? r.responseText ?? '',
                error: r.error || (r.status === 0 ? 'Network error' : ''),
                finalUrl: r.finalUrl,
            }));
        },
    };
    // No `download` hook on purpose: the engine detects it and would route the
    // CSV through the background page, but a blob URL minted in this world is
    // not reachable from there. Without the hook the engine keeps its plain
    // anchor-click path, which works for content scripts in every browser.

    // Pull the saved settings from extension storage. Reading it is async, so
    // it lands after content.js already started with its defaults; the engine
    // listens for `mrs-gm-hydrated` and re-applies the interface language.
    try {
        chrome.storage.local.get(null, (all) => {
            if (chrome.runtime.lastError || !all) return;
            let changed = false;
            for (const [key, value] of Object.entries(all)) {
                if (!isOwnKey(key)) continue;
                // chrome.storage is authoritative: the mirror is per-origin, so a
                // setting changed on kinopoisk.ru would otherwise stay stale on
                // imdb.com forever (the mirror there already holds an old copy).
                // Compare serialised values — objects never compare equal by !==.
                if (JSON.stringify(mirror.read(key)) !== JSON.stringify(value)) {
                    mirror.write(key, value);
                    changed = true;
                }
            }
            if (changed) {
                window.dispatchEvent(new CustomEvent('mrs-gm-hydrated'));
            }
        });
    } catch (e) { /* storage unavailable */ }

    void KEY_PREFIX;
})();
