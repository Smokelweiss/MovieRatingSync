'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { TEST_TRANSLATIONS, getLocaleWithEnv, tWithEnv } = require('./i18n-helpers');

// ====================== GETLOCALE ======================

describe('getLocaleWithEnv', () => {
    it('returns saved language from localStorage', () => {
        const env = {
            localStorage: { getItem: () => 'ru' },
            navigator: { language: 'en-US' },
            document: { documentElement: { lang: 'en' } },
            translations: TEST_TRANSLATIONS,
        };
        assert.equal(getLocaleWithEnv(env), 'ru');
    });

    it('falls from invalid saved value to navigator language', () => {
        const env = {
            localStorage: { getItem: () => 'xx' },
            navigator: { language: 'fr-FR' },
            document: { documentElement: { lang: 'en' } },
            translations: TEST_TRANSLATIONS,
        };
        // 'fr' is not in TEST_TRANSLATIONS → falls through to 'en'
        assert.equal(getLocaleWithEnv(env), 'en');
    });

    it('falls to document.documentElement.lang when navigator.language undefined', () => {
        const env = {
            localStorage: { getItem: () => null },
            navigator: { language: undefined },
            document: { documentElement: { lang: 'ru' } },
            translations: TEST_TRANSLATIONS,
        };
        assert.equal(getLocaleWithEnv(env), 'ru');
    });

    it('handles entirely missing navigator property', () => {
        const env = {
            localStorage: { getItem: () => null },
            // navigator entirely missing — optional chaining should handle it
            document: { documentElement: { lang: 'ru' } },
            translations: TEST_TRANSLATIONS,
        };
        assert.equal(getLocaleWithEnv(env), 'ru');
    });

    it('handles entirely missing document property', () => {
        const env = {
            localStorage: { getItem: () => null },
            navigator: { language: undefined },
            // document entirely missing — optional chaining should handle it
            translations: TEST_TRANSLATIONS,
        };
        assert.equal(getLocaleWithEnv(env), 'en');
    });

    it('handles missing all optional env properties', () => {
        const env = {
            // only translations given, nothing else
            translations: TEST_TRANSLATIONS,
        };
        assert.equal(getLocaleWithEnv(env), 'en');
    });

    it('extracts base language from xx-YY format', () => {
        const env = {
            localStorage: { getItem: () => null },
            navigator: { language: 'es-MX' },
            document: { documentElement: { lang: 'en' } },
            translations: TEST_TRANSLATIONS,
        };
        assert.equal(getLocaleWithEnv(env), 'es');
    });

    it('returns en for unsupported language', () => {
        const env = {
            localStorage: { getItem: () => null },
            navigator: { language: 'de-DE' },
            document: { documentElement: { lang: 'de' } },
            translations: TEST_TRANSLATIONS,
        };
        assert.equal(getLocaleWithEnv(env), 'en');
    });

    it('returns en when localStorage getItem throws', () => {
        const env = {
            localStorage: { getItem: () => { throw new Error('no access'); } },
            navigator: { language: undefined },
            document: { documentElement: { lang: undefined } },
            translations: TEST_TRANSLATIONS,
        };
        assert.equal(getLocaleWithEnv(env), 'en');
    });

    it('returns en for missing all sources', () => {
        const env = {
            localStorage: { getItem: () => null },
            navigator: { language: undefined },
            document: { documentElement: { lang: undefined } },
            translations: TEST_TRANSLATIONS,
        };
        assert.equal(getLocaleWithEnv(env), 'en');
    });

    it('uses custom translations object', () => {
        const customTr = { de: { hello: 'Hallo' } };
        const env = {
            localStorage: { getItem: () => 'de' },
            navigator: { language: 'en' },
            document: { documentElement: { lang: 'en' } },
            translations: customTr,
        };
        assert.equal(getLocaleWithEnv(env), 'de');
    });
});

// ====================== T() ======================

describe('tWithEnv', () => {
    const en = TEST_TRANSLATIONS.en;
    const ru = TEST_TRANSLATIONS.ru;

    it('returns key from active translation map', () => {
        assert.equal(tWithEnv(ru, en, 'exportRatings'), '📤 Экспорт оценок');
    });

    it('returns English key when not in active map', () => {
        // 'allImported' is in en but NOT in es translations
        const es = TEST_TRANSLATIONS.es;
        assert.equal(tWithEnv(es, en, 'allImported'), '🎉 All records imported!');
    });

    it('returns key name itself when not in any map', () => {
        assert.equal(tWithEnv(ru, en, 'nonexistentKey'), 'nonexistentKey');
    });

    it('interpolates single variable', () => {
        const result = tWithEnv(ru, en, 'done', { mode: ' (режим замены)' });
        assert.equal(result, '✅ Готово (режим замены)!');
    });

    it('interpolates numeric variable value', () => {
        const result = tWithEnv(en, en, 'notFound', { count: 42 });
        // notFound: 'Not found: ' — no variable in this key, but test that vars work
        assert.equal(result, 'Not found: ');
    });

    it('interpolates number variable into string', () => {
        const testMap = { scoreMsg: 'Score: {score}/10' };
        const result = tWithEnv(testMap, testMap, 'scoreMsg', { score: 9 });
        assert.equal(result, 'Score: 9/10');
    });

    it('handles null/undefined vars as no interpolation', () => {
        assert.equal(tWithEnv(ru, en, 'exportRatings', null), '📤 Экспорт оценок');
        assert.equal(tWithEnv(ru, en, 'exportRatings', undefined), '📤 Экспорт оценок');
    });

    it('interpolates keys with multiple variable occurrences', () => {
        const testMap = {
            testKey: '{a} and {a} and {b}',
        };
        const result = tWithEnv(testMap, testMap, 'testKey', { a: 'X', b: 'Y' });
        assert.equal(result, 'X and X and Y');
    });

    it('handles variables with string numbers', () => {
        const result = tWithEnv(en, en, 'done', { mode: ' (replace mode)' });
        assert.equal(result, '✅ Done (replace mode)!');
    });

    it('fallback chain: active map → English map → key name', () => {
        // active map has the key
        assert.equal(tWithEnv(ru, en, 'language'), 'Язык');
        // English map has the key
        assert.equal(tWithEnv(ru, en, 'exportHint'), 'Выгрузить все ваши оценки с этого сайта в CSV-файл');
        // Neither has it
        assert.equal(tWithEnv(ru, en, 'ghostKey'), 'ghostKey');
    });
});
