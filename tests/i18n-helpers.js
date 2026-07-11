'use strict';

// ====================== I18N (test helpers) ======================

// Minimal TRANSLATIONS for testing (subset of the real one)
const TEST_TRANSLATIONS = {
    en: {
        exportRatings: '📤 Export Ratings',
        importRatings: '📥 Import',
        hardImport: '🔄 Hard Import',
        done: '✅ Done{mode}!',
        replaceMode: ' (replace mode)',
        allImported: '🎉 All records imported!',
        exportDone: '✅ Export complete! File saved.',
        notFound: 'Not found: ',
        failed: 'Errors: ',
        favorites: 'Favorites: ',
        importFavorites: 'Import favorites',
        language: 'Language',
        exportHint: 'Download all your ratings from this platform as a CSV file',
        importFavoritesHint: 'When enabled, films marked as favorites in the CSV will be added',
    },
    ru: {
        exportRatings: '📤 Экспорт оценок',
        importRatings: '📥 Импорт',
        hardImport: '🔄 Полная замена',
        done: '✅ Готово{mode}!',
        replaceMode: ' (режим замены)',
        allImported: '🎉 Все записи импортированы!',
        exportDone: '✅ Экспорт завершён! Файл сохранён.',
        notFound: 'Не найдено: ',
        failed: 'Ошибок: ',
        favorites: 'Избранное: ',
        importFavorites: 'Импортировать избранное',
        language: 'Язык',
        exportHint: 'Выгрузить все ваши оценки с этого сайта в CSV-файл',
        importFavoritesHint: 'Если включено, фильмы-избранники из CSV будут добавлены',
    },
    es: {
        exportRatings: '📤 Exportar valoraciones',
        done: '✅ ¡Listo{mode}!',
        language: 'Idioma',
    },
};

// Pure testable getLocale() — takes environment mocks as parameter
function getLocaleWithEnv({ localStorage: ls, navigator: nav, document: doc, translations }) {
    const tr = translations || TEST_TRANSLATIONS;
    try {
        const saved = ls?.getItem('mrs_lang');
        if (saved && tr[saved]) return saved;
    } catch (e) { /* ignore */ }
    const lang = (nav?.language) || (doc?.documentElement?.lang) || 'en';
    const base = String(lang).split('-')[0].toLowerCase();
    return tr[base] ? base : 'en';
}

// Pure testable t() — takes translations map and English fallback
function tWithEnv(tMap, enMap, key, vars) {
    let s = tMap[key] ?? enMap[key] ?? key;
    if (vars && typeof vars === 'object') {
        for (const [k, v] of Object.entries(vars)) {
            s = s.split(`{${k}}`).join(String(v));
        }
    }
    return s;
}

module.exports = {
    TEST_TRANSLATIONS,
    getLocaleWithEnv,
    tWithEnv,
};
