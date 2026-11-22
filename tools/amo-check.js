/**
 * Ask AMO whether a version already exists, using a signed JWT.
 *
 * The public API only lists reviewed versions, so a version that was uploaded
 * minutes ago is invisible to it. This script signs the same JWT the publish
 * action uses and queries the authenticated endpoint, which sees everything —
 * that is what stops a re-push from failing with "version already exists".
 *
 * Usage:  node tools/amo-check.js <addon-id> <version>
 * Env:    AMO_JWT_ISSUER, AMO_JWT_SECRET
 * Prints: exists / missing  (and exits 0 either way)
 */
'use strict';

const crypto = require('crypto');

function b64url(value) {
    return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signJwt(issuer, secret) {
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64url(JSON.stringify({ iss: issuer, jti: crypto.randomBytes(8).toString('hex'), iat: now, exp: now + 240, aud: 'api' }));
    const sig = b64url(crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest());
    return `${head}.${body}.${sig}`;
}

async function main() {
    const [addonId, version] = process.argv.slice(2);
    if (!addonId || !version) throw new Error('usage: node tools/amo-check.js <addon-id> <version>');

    const issuer = process.env.AMO_JWT_ISSUER;
    const secret = process.env.AMO_JWT_SECRET;
    if (!issuer || !secret) {
        // Without credentials the check cannot be authoritative. Say so loudly
        // instead of pretending the version is missing.
        console.log('missing');
        console.log('::warning::AMO credentials are not configured — cannot verify whether ' + version + ' is already published');
        return;
    }

    // The default listing hides unreviewed and unlisted uploads, so a version
    // uploaded minutes ago looks absent. `all_with_unlisted` includes it.
    const url = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(addonId)}/versions/?filter=all_with_unlisted&page_size=50`;
    const r = await fetch(url, { headers: { Authorization: `JWT ${signJwt(issuer, secret)}` } });
    if (!r.ok) {
        console.log('missing');
        console.log(`::warning::AMO version lookup answered ${r.status}`);
        return;
    }
    const body = await r.json();
    const found = (body.results || []).some(v => v.version === version);
    console.log(found ? 'exists' : 'missing');
    if (found) console.log(`AMO already has ${version} — the workflow will not upload it again`);
}

main().catch((e) => console.log('missing'), (e) => console.log('missing'));
