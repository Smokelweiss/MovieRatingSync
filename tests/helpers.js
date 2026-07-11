'use strict';

// ====================== CONSTANTS ======================

const CYR = {
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo', 'Ж': 'Zh', 'З': 'Z', 'И': 'I', 'Й': 'Y',
    'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F',
    'Х': 'Kh', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch', 'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya',
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y',
    'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f',
    'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
};

const CONFIDENCE = { HIGH: 0.80, MEDIUM: 0.55, LOW: 0.30 };
const MATCH_THRESHOLD = 800; // configurable additive threshold; default preserves previous 0.80 high-confidence boundary // additive threshold for diagnostics / future UI
const YEAR_TOL = 1;

// ====================== UTILITIES ======================

function memo(fn, maxSize = 500) {
    const cache = new Map();
    return (...args) => {
        const key = JSON.stringify(args);
        if (cache.has(key)) return cache.get(key);
        const val = fn(...args);
        if (cache.size >= maxSize) cache.delete(cache.keys().next().value);
        cache.set(key, val);
        return val;
    };
}

// ====================== TITLE HELPERS ======================

const hasCyr = memo(s => /[а-яА-ЯёЁ]/.test(s));
// Characters unique to non-Russian Cyrillic alphabets:
// Serbian: ђ ј љ њ ћ џ
// Ukrainian: є і ї ґ (і also used in Belarusian)
// Belarusian: ў
// Macedonian: ѓ ќ ѕ
const NON_RUSSIAN_CYR = /[ђѓєѕіїјљњћќўџґЂЃЄЅІЇЈЉЊЋЌЎЏҐ]/;
const isRussianCyrillic = memo(s => {
    if (!hasCyr(s)) return false;
    if (NON_RUSSIAN_CYR.test(s)) return false;
    return true;
});
const translit = memo(s => s.split('').map(c => CYR[c] ?? c).join(''));

const normalizeNumerals = memo(s => s
    // Superscript numerals may be attached to words (e.g. Alien³). Insert spaces first.
    .replace(/³/g, ' 3 ')
    .replace(/²/g, ' 2 ')
    .replace(/\b(?:iii|3)\b/g, '3')
    .replace(/\b(?:ii|2)\b/g, '2')
    .replace(/\b(?:iv|4)\b/g, '4')
    .replace(/\b(?:v|5)\b/g, '5')
    .replace(/\b(?:vi|6)\b/g, '6')
    .replace(/\b(?:vii|7)\b/g, '7')
    .replace(/\b(?:viii|8)\b/g, '8')
    .replace(/\b(?:ix|9)\b/g, '9')
    .replace(/\b(?:x|10)\b/g, '10')
    .replace(/\b(?:xi|11)\b/g, '11')
    .replace(/\b(?:xii|12)\b/g, '12')
    .replace(/\b(?:xiii|13)\b/g, '13'));

const normTitle = memo(s => {
    let n = s.replace(/№/g, ' no ')
        // Superscript numerals may be attached to words (e.g. Alien³). Insert spaces before NFKD normalization.
        .replace(/³/g, ' 3 ')
        .replace(/²/g, ' 2 ')
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/œ/g, 'oe')
        .replace(/æ/g, 'ae');
    n = normalizeNumerals(n);
    return n
        .replace(/[\-–—.,!?;:'"«»()\[\]\\\/]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\b(the|a|an|le|la|les|un|une|el|los|las|der|die|das|il|lo|gli|de|het|en|et)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
});

const cleanTitle = memo(t => {
    const m = t.match(/\((.+?)(?:,\s*\d{4}(?:-\d{4})?)\)$/);
    let res = m ? m[1].trim() : t
        .replace(/,\s*\d{4}(?:-\d{4})?\s*$/, '')        // "Title, 1999"
        .replace(/[,]?\s*\(\d{4}(?:-\d{4})?\)\s*$/, '') // "Title (1999)"
        .replace(/[«»]/g, '').trim();
    // Strip slug-style year suffix (e.g., dune-2021 → dune)
    res = res.replace(/-\d{4}$/, '').trim();
    return res;
});

function decodeHtmlEntities(str) {
    if (!str || typeof str !== 'string') return str;
    return str
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(+code))
        .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

const yearsMatch = memo((a, b) => {
    const ya = parseInt(String(a).match(/^(\d{4})/)?.[1], 10);
    const yb = parseInt(b, 10);
    return !isNaN(ya) && !isNaN(yb) && Math.abs(ya - yb) <= YEAR_TOL;
});

function getTitleVariants(title) {
    if (!title) return [];
    const v = new Set([title.trim()]);
    const add = s => { const t = s?.trim(); if (t && t.length > 1) v.add(t); };
    add(title.replace(/[\(\[].*?[\)\]]/g, '').trim());
    add(title.replace(/^[^:]+[:\-–—]\s*/, '').trim());
    add(title.replace(/[\-–—]?\s*(?:Episode|Part|Season|Сезон|Серия)\s+[IVXLCDM\d]+/gi, '').trim());
    add(title.replace(/^(The|A|An)\s+/i, '').trim());
    add(title.replace(/[^a-zа-яё0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim());
    if (hasCyr(title)) add(translit(title));
    return [...v];
}

// ====================== MATCHING ======================

function getTokens(s) {
    return new Set(normTitle(s).split(' ').filter(Boolean));
}

function jaccard(a, b) {
    const sa = getTokens(a), sb = getTokens(b);
    if (!sa.size && !sb.size) return 0;
    const inter = [...sa].filter(x => sb.has(x)).length;
    return inter / (sa.size + sb.size - inter);
}

function titleSimilarity(a, b) {
    if (!a || !b) return 0;
    const na = normTitle(a), nb = normTitle(b);
    if (na === nb) return 1.0;
    if (na.includes(nb) || nb.includes(na)) return 0.92;
    const jac = jaccard(a, b);
    if (jac >= 0.8) return 0.85;
    if (jac >= 0.5) return 0.65;
    if (jac >= 0.3) return 0.40;
    return jac;
}

function yearPenalty(targetYear, candYear) {
    // Missing year data should not penalize the candidate (spec requirement).
    if (!targetYear || !candYear) return 0.0;
    const t = parseInt(String(targetYear).match(/^(\d{4})/)?.[1], 10);
    const c = parseInt(String(candYear).match(/^(\d{4})/)?.[1], 10);
    if (isNaN(t) || isNaN(c)) return 0.0;
    const diff = Math.abs(t - c);
    if (diff === 0) return 0.0;
    if (diff === 1) return -0.05;
    if (diff <= YEAR_TOL) return -0.15;
    return -0.55;
}

function typeBonus(targetType, candType) {
    if (!targetType || !candType) return 0;
    const tSeries = targetType !== 'Film';
    const cSeries = candType !== 'Film';
    // Strong penalty for film/series mismatch so confidence never reaches HIGH.
    return tSeries === cSeries ? 0.10 : -0.60;
}

function listScore(targetStr, candStr, weight, maxItems = 3) {
    if (!targetStr || !candStr) return 0;
    const tList = targetStr.split(',').map(s => normTitle(s));
    const cList = candStr.split(',').map(s => normTitle(s));
    let matches = 0;
    for (const t of tList.slice(0, maxItems)) {
        if (cList.includes(t)) matches++;
    }
    return matches * weight;
}

function runtimeScore(targetRt, candRt) {
    if (!targetRt || !candRt) return 0;
    const t = parseInt(targetRt, 10);
    const c = parseInt(candRt, 10);
    if (Number.isNaN(t) || Number.isNaN(c)) return 0;
    const diff = Math.abs(t - c);
    if (diff <= 2) return 80;
    if (diff <= 5) return 60;
    if (diff <= 10) return 30;
    if (diff <= 15) return 10;
    return 0;
}

function directorScore(targetDirectors, candDirectors) {
    return listScore(targetDirectors, candDirectors, 150, 1);
}

function actorScore(targetActors, candActors) {
    return listScore(targetActors, candActors, 10, 3);
}

function genreScore(targetGenres, candGenres) {
    return listScore(targetGenres, candGenres, 20, 3);
}

function countryScore(targetCountries, candCountries) {
    return listScore(targetCountries, candCountries, 60, 3);
}

function isValidExternalId(id) {
    if (typeof id !== 'string') return false;
    const trimmed = id.trim();
    if (!trimmed) return false;
    // IMDb IDs must be 'tt' followed by at least 7 digits; TMDb/TVDb are numeric.
    if (/^tt/i.test(trimmed)) return /^tt\d{7,}$/i.test(trimmed);
    return /^\d+$/.test(trimmed);
}function scoreCandidate(target, candidate) {
    return scoreCandidateDiagnostics(target, candidate).score;
}

function confidenceLabel(score) {
    // MATCH_THRESHOLD maps the additive 0-1000 scale to the 0-1 score scale.
    if (score >= (MATCH_THRESHOLD / 1000)) return 'high';
    if (score >= CONFIDENCE.MEDIUM) return 'medium';
    return 'low';
}

/**
 * Compute a detailed score breakdown for diagnostics.
 * Returns { score, classicScore, additiveScore, normalizedAdditive, reasons }.
 */
function scoreCandidateDiagnostics(target, candidate) {
    // External ID priority: if IDs match, it's a perfect match.
    const imdbId = target.imdbId || target.ttId;
    const candImdbId = candidate.imdbId || candidate.ttId;
    if (isValidExternalId(imdbId) && isValidExternalId(candImdbId) && imdbId === candImdbId) {
        return { score: 1.0, classicScore: 1.0, additiveScore: 1000, normalizedAdditive: 1.0, reasons: ['IMDb ID Match +1000'] };
    }
    const typesCompatible = !target.type || !candidate.type || target.type === candidate.type;
    if (typesCompatible && isValidExternalId(target.tmdbId) && isValidExternalId(candidate.tmdbId) && target.tmdbId === candidate.tmdbId) {
        return { score: 1.0, classicScore: 1.0, additiveScore: 900, normalizedAdditive: 0.9, reasons: ['TMDb ID Match +900'] };
    }
    if (typesCompatible && isValidExternalId(target.tvdbId) && isValidExternalId(candidate.tvdbId) && target.tvdbId === candidate.tvdbId) {
        return { score: 1.0, classicScore: 1.0, additiveScore: 900, normalizedAdditive: 0.9, reasons: ['TVDb ID Match +900'] };
    }

    const tTitle = target.title || target.titleOrig || target.titleRu || '';
    const cTitle = candidate.title || candidate.titleOrig || candidate.titleRu || '';
    const sim = titleSimilarity(tTitle, cTitle);

    let classicScore = sim;
    classicScore += yearPenalty(target.year, candidate.year);
    classicScore += typeBonus(target.type, candidate.type);
    if (target.year && candidate.year && yearsMatch(target.year, candidate.year)) {
        classicScore += 0.05;
    }
    classicScore = Math.max(0, Math.min(1, classicScore));

    let addScore = 0;
    const reasons = [];

    if (sim >= 0.99) { addScore += 500; reasons.push('Title Exact +500'); }
    else if (sim >= 0.92) { addScore += 450; reasons.push('Title Strong +450'); }
    else if (sim >= 0.85) { addScore += 400; reasons.push('Title High +400'); }
    else if (sim >= 0.65) { addScore += 300; reasons.push('Title Good +300'); }
    else if (sim >= 0.40) { addScore += 150; reasons.push('Title Partial +150'); }

    if (target.year && candidate.year) {
        const tYr = parseInt(String(target.year).match(/^(\d{4})/)?.[1], 10);
        const cYr = parseInt(String(candidate.year).match(/^(\d{4})/)?.[1], 10);
        if (!Number.isNaN(tYr) && !Number.isNaN(cYr)) {
            if (tYr === cYr) { addScore += 300; reasons.push('Year Exact +300'); }
            else if (Math.abs(tYr - cYr) <= 1) { addScore += 250; reasons.push('Year ±1 +250'); }
        }
    }

    if (target.type && candidate.type) {
        if (target.type === candidate.type) { addScore += 200; reasons.push('Type Exact +200'); }
        else {
            const tSeries = target.type !== 'Film';
            const cSeries = candidate.type !== 'Film';
            if (tSeries !== cSeries) { addScore -= 200; reasons.push('Type Mismatch -200'); }
        }
    }

    const rtScore = runtimeScore(target.runtime, candidate.runtime);
    if (rtScore) { addScore += rtScore; reasons.push(`Runtime +${rtScore}`); }

    const dScore = directorScore(target.directors, candidate.directors);
    if (dScore) { addScore += dScore; reasons.push(`Director +${dScore}`); }

    const aScore = actorScore(target.actors, candidate.actors);
    if (aScore) { addScore += aScore; reasons.push(`Actors +${aScore}`); }

    const gScore = genreScore(target.genres, candidate.genres);
    if (gScore) { addScore += gScore; reasons.push(`Genres +${gScore}`); }

    const coScore = countryScore(target.countries, candidate.countries);
    if (coScore) { addScore += coScore; reasons.push(`Country +${coScore}`); }

    const normalizedAdditive = Math.min(1.0, Math.max(0, addScore) / 1000);
    const score = Math.max(classicScore, normalizedAdditive);

    return {
        score,
        classicScore,
        additiveScore: addScore,
        normalizedAdditive,
        reasons,
    };
}

function matchMovie(movie, nKey, year) {
    if (!movie?.id) return null;
    const mYear = movie.productionYear ?? movie.releaseYears?.start ?? movie.releaseYears?.end;
    const nRu = normTitle(movie.title?.russian ?? '');
    const nOrig = normTitle(movie.title?.original ?? '');
    const nTr = hasCyr(movie.title?.russian ?? '') ? normTitle(translit(movie.title.russian)) : '';
    const hit = [nRu, nOrig, nTr].some(n => n === nKey || n.includes(nKey) || nKey.includes(n));
    if (!hit) return null;
    return (!year || yearsMatch(mYear, year)) ? movie : null;
}

// ====================== CSV ======================

const csvEsc = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
const TITLE_DELIM = ' | ';
const escapeTitleDelim = s => String(s ?? '').replace(/\|/g, '\\|');
const splitAllTitles = s => {
    if (!s) return [];
    const parts = [];
    let current = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '\\' && i + 1 < s.length && s[i + 1] === '|') {
            current += '|';
            i++;
        } else if (ch === '|') {
            parts.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) parts.push(current.trim());
    return parts.filter(Boolean);
};

function splitCsvLine(line) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            cells.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    cells.push(current);
    return cells;
}

function parseCSVExtended(lines) {
    const header = splitCsvLine(lines[0]).map(h => h.toLowerCase().trim());
    const result = [];
    for (let i = 1; i < lines.length; i++) {
        const l = lines[i].trim();
        if (!l) continue;
        const cells = splitCsvLine(l);
        if (cells.length < Math.min(3, header.length)) continue;
        const row = {};
        header.forEach((h, idx) => row[h] = cells[idx] ?? '');
        const unq = s => (s || '').replace(/""/g, '"');
        const titleRu = decodeHtmlEntities(unq(row.titleru));
        const titleOrig = decodeHtmlEntities(unq(row.titleorig));
        const cleanRu = cleanTitle(titleRu);
        const cleanOrig = cleanTitle(titleOrig);
        const rawRating = (row.rating10 === 'w' || row.rating10 === '') ? null : +row.rating10;
        result.push({
            titleRu: cleanRu || titleRu,
            titleOrig: cleanOrig || titleOrig,
            title: cleanOrig || cleanRu || titleOrig || titleRu,
            type: (row.type || '').trim(),
            kpId: (row.kpid || '').trim(),
            ttId: (row.ttid || '').trim(),
            lbSlug: (row.lbslug || '').trim(),
            year: (row.yearstart || row.year || '').trim(),
            yearStart: (row.yearstart || row.year || '').trim(),
            yearEnd: (row.yearend || '').trim(),
            rating: Number.isNaN(rawRating) ? null : rawRating,
            genres: unq(row.genres),
            watchedDate: (row.watcheddate || '').trim(),
            favorite: (row.favorite || '').trim() === '1',
            src: (row.src || '').trim(),
        });
    }
    return result;
}

function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const hdrLine = lines[0].toLowerCase();

    if (/titleru|kpid|titleorig|ttid|lbslug/.test(hdrLine)) {
        return parseCSVExtended(lines);
    }

    const hasDates = hdrLine.includes('watcheddate');
    const RE_DATE = /^"((?:[^"]|"")*)",\s*(\d{4})?\s*,\s*(\d*|w)\s*,\s*"?(\d{4}-\d{2}-\d{2})?"?\s*$/;
    const RE_PLAIN = /^"((?:[^"]|"")*)",\s*(\d{4})?\s*,\s*(\d*|w)\s*$/;

    const skipped = [];
    const result = lines.slice(1).flatMap(line => {
        const l = line.trim();
        if (!l) return [];
        const m = hasDates ? l.match(RE_DATE) : l.match(RE_PLAIN);
        if (!m) { skipped.push(l); return []; }
        const title = cleanTitle(decodeHtmlEntities(m[1].replace(/""/g, '"').trim()));
        const rawRating = (m[3] === 'w' || m[3] === '') ? null : +m[3];
        return [{ title, year: m[2] ?? '', rating: rawRating, ...(hasDates && { watchedDate: m[4] ?? '' }) }];
    });
    return result;
}

function buildCSV(rows) {
    const first = rows[0] || {};
    const ext = first === rows[0] && (first.src || first.kpId !== undefined || first.ttId !== undefined || first.lbSlug !== undefined || first.titleRu !== undefined || first.titleOrig !== undefined);

    if (ext) {
        const hasDates = rows.some(r => r.watchedDate);
        const hasFav = rows.some(r => r.favorite);
        const hdr = hasDates && hasFav
            ? 'TitleRu,TitleOrig,Type,KpId,TtId,LbSlug,YearStart,YearEnd,Rating10,Genres,Favorite,WatchedDate'
            : hasDates
            ? 'TitleRu,TitleOrig,Type,KpId,TtId,LbSlug,YearStart,YearEnd,Rating10,Genres,WatchedDate'
            : hasFav
            ? 'TitleRu,TitleOrig,Type,KpId,TtId,LbSlug,YearStart,YearEnd,Rating10,Genres,Favorite'
            : 'TitleRu,TitleOrig,Type,KpId,TtId,LbSlug,YearStart,YearEnd,Rating10,Genres,Runtime,Directors,Actors,PremiereDate';
        const lines = [hdr, ...rows.map(r => {
            const ratingVal = r.rating == null ? '' : r.rating;
            const favVal = r.favorite == null ? '' : (r.favorite ? '1' : '0');
            const base = [
                csvEsc(r.titleRu ?? ''),
                csvEsc(r.titleOrig ?? r.title ?? ''),
                r.type ?? '',
                r.kpId ?? '',
                r.ttId ?? '',
                r.lbSlug ?? '',
                r.year ?? r.yearStart ?? '',
                r.yearEnd ?? '',
                ratingVal,
                csvEsc(r.genres ?? ''),
            ].join(',');
            if (hasDates && hasFav) return `${base},${favVal},${r.watchedDate ?? ''}`;
            if (hasDates) return `${base},${r.watchedDate ?? ''}`;
            if (hasFav) return `${base},${favVal}`;
            return base;
        })];
        return lines.join('\n');
    }

    const hasDates = rows.some(r => r.watchedDate);
    const hdr = hasDates ? 'Title,Year,Rating10,WatchedDate' : 'Title,Year,Rating10';
    const lines = [hdr, ...rows.map(r =>
        hasDates
            ? `${csvEsc(r.title)},${r.year ?? ''},${r.rating ?? ''},${r.watchedDate ?? ''}`
            : `${csvEsc(r.title)},${r.year ?? ''},${r.rating ?? ''}`
    )];
    return lines.join('\n');
}

// ====================== ADAPTIVE DELAY / PROBE ======================

const DELAY = {
    KP_INIT: 100, GQL_INIT: 30,
    KP_MIN_FAST: 10, KP_MIN_SLOW: 20, KP_MAX: 3000,
    PAGE_BETWEEN: 15, HISTORY_PAGE: 150,
    F_FAST: 0.70, F_MID: 0.85, F_SLOW: 1.05, F_429: 2.00, F_ERR: 1.30,
};

const CONCURRENCY = { INIT: 20, MAX: 200, UP: 10, DOWN: 5, MIN: 5 };
const PLATFORM_MAX = { kp: 50, kpGql: 50, imdb: 200, lb: 50 };

function adjDelay(d, outcome, rt = 0) {
    const { F_FAST, F_MID, F_SLOW, F_429, F_ERR, KP_MIN_FAST, KP_MIN_SLOW, KP_MAX } = DELAY;
    if (outcome === 'ok') {
        d.val = rt < 300 ? Math.max(KP_MIN_FAST, Math.floor(d.val * F_FAST))
            : rt < 1000 ? Math.max(KP_MIN_SLOW, Math.floor(d.val * F_MID))
                : Math.min(KP_MAX, Math.floor(d.val * F_SLOW));
    } else {
        d.val = Math.min(KP_MAX, Math.floor(d.val * (outcome === '429' ? F_429 : F_ERR)));
    }
}

function makeProbe(init = CONCURRENCY.INIT, maxC = CONCURRENCY.MAX) {
    return { c: init, minLatency: Infinity, window: [], windowSize: 10, maxC };
}

function probeOk(p, latency) {
    p.window.push(latency);
    if (p.window.length > p.windowSize) p.window.shift();
    p.minLatency = Math.min(p.minLatency, latency);

    const avgLatency = p.window.reduce((a, b) => a + b, 0) / p.window.length;
    const gradient = p.minLatency / avgLatency;
    const max = p.maxC || CONCURRENCY.MAX;

    if (gradient > 0.95 && p.c < max) {
        p.c = Math.min(max, p.c + CONCURRENCY.UP);
    } else if (gradient < 0.85 && p.c > CONCURRENCY.MIN) {
        p.c = Math.max(CONCURRENCY.MIN, p.c - CONCURRENCY.DOWN);
    }
}

function probeFail(p) { p.c = Math.max(CONCURRENCY.MIN, p.c - CONCURRENCY.DOWN); }

// ====================== EXPORTS ======================

module.exports = {
    CYR, CONFIDENCE, MATCH_THRESHOLD, YEAR_TOL, DELAY, CONCURRENCY, PLATFORM_MAX,
    memo,
    hasCyr, isRussianCyrillic, NON_RUSSIAN_CYR, translit, normTitle, cleanTitle, decodeHtmlEntities, yearsMatch, getTitleVariants,
    getTokens, jaccard, titleSimilarity, yearPenalty, typeBonus, scoreCandidate, scoreCandidateDiagnostics, confidenceLabel, matchMovie,
    listScore, runtimeScore, directorScore, actorScore, genreScore, countryScore, isValidExternalId,
    csvEsc, splitCsvLine, parseCSV, parseCSVExtended, buildCSV,
    adjDelay, makeProbe, probeOk, probeFail,
    TITLE_DELIM, escapeTitleDelim, splitAllTitles,
};
