// ==UserScript==
// @name         Movie Rating Sync
// @name:ru      Синхронизация Кинооценок
// @namespace    https://github.com/Smokelweiss
// @version      1.4
// @description  Sync movie ratings across Kinopoisk, IMDb, Letterboxd and more
// @description:ru Синхронизируйте оценки фильмов между Kinopoisk, IMDb и другими сервисами
// @author       Smokelweiss
// @icon         https://www.google.com/s2/favicons?sz=64&domain=imdb.com
// @match        https://www.kinopoisk.ru/*
// @match        https://www.imdb.com/*
// @match        https://letterboxd.com/*
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      graphql.kinopoisk.ru
// @connect      www.kinopoisk.ru
// @connect      api.graphql.imdb.com
// @connect      www.imdb.com
// @connect      sg.media-imdb.com
// @connect      letterboxd.com
// @homepageURL  https://github.com/Smokelweiss/MovieRatingSync
// @supportURL   https://github.com/Smokelweiss/MovieRatingSync/issues
// @updateURL    https://raw.githubusercontent.com/Smokelweiss/MovieRatingSync/main/movie-rating-sync.user.js
// @downloadURL  https://raw.githubusercontent.com/Smokelweiss/MovieRatingSync/main/movie-rating-sync.user.js
// @license      GPL-3.0
// ==/UserScript==

(function () {
    'use strict';

    const DEBUG = false;

    // ====================== CONSTANTS ======================

    const SITE = {
        isKP: location.hostname.includes('kinopoisk.ru'),
        isIMDb: location.hostname.includes('imdb.com'),
        isLB: location.hostname.includes('letterboxd.com'),
    };

    const DELAY = {
        KP_INIT: 100, GQL_INIT: 30,
        KP_MIN_FAST: 10, KP_MIN_SLOW: 20, KP_MAX: 3000,
        PAGE_BETWEEN: 15, HISTORY_PAGE: 25,
        F_FAST: 0.70, F_MID: 0.85, F_SLOW: 1.05, F_429: 2.00, F_ERR: 1.30,
    };

    const CONCURRENCY = { INIT: 20, MAX: 200, UP: 10, DOWN: 5, MIN: 5 };
    // kpGql is capped at 24 on purpose: measured with 40 concurrent Suggest
    // requests, anything above ~24 in flight starts returning HTML 403 pages
    // (Kinopoisk anti-fraud), and every 403 costs a retry round-trip plus the
    // delay multiplier, so higher "concurrency" is strictly slower.
    const PLATFORM_MAX = { kp: 50, kpGql: 24, imdb: 200, lb: 50 };
    const RETRY = { FETCH: 3, GQL: 3, PAGES: 100 };
    const YEAR_TOL = 1;
    const KP_GQL = 'https://graphql.kinopoisk.ru/graphql/';

    // ====================== I18N ======================

    const TRANSLATIONS = { en: { time: 'Time', exportRatings: '📤 Export Ratings', importRatings: '📥 Import', hardImport: '🔄 Hard Import', loadingPage: 'Loading page {p}{total} ({count} movies)', kpParseFailed: 'Failed to parse Kinopoisk listing — SSR JSON and HTML fallback failed', kpListingFailed: 'Failed to load Kinopoisk listing', profileDetect: 'Detecting {platform} profile', loadedRecords: 'Loaded {count} records. {next}', checkingExisting: 'Checking existing ratings...', startingImport: 'Starting import...', importProgress: 'Import to {platform} {from}–{to}/{total}', searchProgress: 'Search {from}–{to}/{total}', resolveProgress: 'Resolving {from}–{to}/{total}', resolveIdCount: 'Resolving IDs: {count} movies', fetchingLid: 'Fetching LID: {count} movies', applyProgress: 'Applying {from}–{to}/{total}', loadingExisting: 'Loading existing ratings: page {p}{total} ({count} movies)', deepSearch: 'Deep search {platform}', scanHistory: 'Scanning {platform} history', foundCount: 'Found: {count} movies. Generating CSV', userIdWarn: '⚠️ Could not detect user ID — existing ratings will not be skipped', ratings: 'Ratings', watchHistory: 'Watch history', diary: 'Diary', watched: 'Watched', page: 'page', kpUserIdNotFound: 'User ID not found — open your Kinopoisk profile page', imdbUserIdNotFound: '❌ IMDb user ID not found — log in to your account', lbUsernameNotFound: 'Could not detect Letterboxd username — open your profile', csrfNotFound: '❌ CSRF token not found — log in to your Letterboxd account', csvEmpty: '❌ CSV is empty or not recognized', done: '✅ Done{mode}!', replaceMode: ' (replace mode)', rated: 'Rated: ', watchedShort: 'Watched: ', skipped: 'Skipped: ', notFound: 'Not found: ', failed: 'Errors: ', errorNotFoundKP: 'Not found on Kinopoisk', errorNotFoundIMDb: 'Not found on IMDb', errorNotFoundLB: 'Not found on Letterboxd', errorApi: 'API error / network failure', allImported: '🎉 All records imported!', exportDone: '✅ Export complete! File saved.', deepSearchBtn: '🔍 Deep search ({count})', movies: 'movies', favorites: 'Favorites: ', likes: 'Likes', importFavorites: 'Import favorites', language: 'Language', exportHint: 'Download all your ratings from this platform as a CSV file', importHint: 'Import ratings from a CSV file — existing ratings are kept,new ones are added', hardImportHint: 'Import from CSV and overwrite existing ratings (normal mode skips already-rated films)', importFavoritesHint: 'When enabled,films marked as favorites in the CSV will be added to your favorites list', runtime: 'Runtime', directors: 'Directors', actors: 'Actors', premiereDate: 'Premiere date', languageHint: 'Select the interface language', imdbNoData: 'No ratings or watch history found — make sure you are logged in and have rated films on IMDb', lblDetails: 'Details', lblSearch: 'Search', lblApply: 'Apply', lblFavorites: 'Favorites', lblExisting: 'Existing', lblHistory: 'History', lblImport: 'Import', lblPages: 'Pages', }, ru: { time: 'Время', exportRatings: '📤 Экспорт оценок', importRatings: '📥 Импорт', hardImport: '🔄 Полная замена', loadingPage: 'Загрузка стр. {p}{total} ({count} фильмов)', kpParseFailed: 'Не удалось распарсить листинг КП — SSR JSON и HTML fallback не сработали', kpListingFailed: 'Не удалось загрузить листинг КП', profileDetect: 'Определяем профиль {platform}', loadedRecords: 'Загружено {count} записей. {next}', checkingExisting: 'Проверяем существующие оценки...', startingImport: 'Начинаем импорт...', importProgress: 'Импорт на {platform} {from}–{to}/{total}', searchProgress: 'Поиск {from}–{to}/{total}', resolveProgress: 'Резолвинг {from}–{to}/{total}', resolveIdCount: 'Резолвинг ID: {count} фильмов', fetchingLid: 'Получение LID: {count} фильмов', applyProgress: 'Применение {from}–{to}/{total}', loadingExisting: 'Загрузка существующих оценок: стр. {p}{total} ({count} фильмов)', deepSearch: 'Глубокий поиск {platform}', scanHistory: 'Сканируем историю {platform}', foundCount: 'Найдено: {count} фильмов. Формируем CSV', userIdWarn: '⚠️ Не удалось определить user ID — существующие оценки не будут пропущены', ratings: 'Оценки', watchHistory: 'Просмотры', diary: 'Дневник', watched: 'Просмотрено', page: 'стр.', kpUserIdNotFound: 'user ID не найден — откройте страницу профиля КП', imdbUserIdNotFound: '❌ IMDb user ID не найден — войдите в аккаунт', lbUsernameNotFound: 'Не удалось определить имя пользователя Letterboxd — откройте свой профиль', csrfNotFound: '❌ CSRF токен не найден — войдите в аккаунт Letterboxd', csvEmpty: '❌ CSV пуст или не распознан', done: '✅ Готово{mode}!', replaceMode: ' (режим замены)', rated: 'Оценено: ', watchedShort: 'Просмотрено: ', skipped: 'Пропущено: ', notFound: 'Не найдено: ', failed: 'Ошибок: ', errorNotFoundKP: 'Не найдено на Кинопоиске', errorNotFoundIMDb: 'Не найдено на IMDb', errorNotFoundLB: 'Не найдено на Letterboxd', errorApi: 'Ошибка API / сетевой сбой', allImported: '🎉 Все записи импортированы!', exportDone: '✅ Экспорт завершён! Файл сохранён.', deepSearchBtn: '🔍 Искать глубже ({count})', movies: 'фильмов', favorites: 'Избранное: ', likes: 'Лайки', importFavorites: 'Импортировать избранное', language: 'Язык', exportHint: 'Выгрузить все ваши оценки с этого сайта в CSV-файл', importHint: 'Импорт оценок из CSV — существующие оценки сохраняются,новые добавляются', hardImportHint: 'Импорт из CSV с перезаписью существующих оценок (обычный режим пропускает уже оценённые фильмы)', importFavoritesHint: 'Если включено,фильмы-избранники из CSV будут добавлены в ваш список избранного', runtime: 'Длительность', directors: 'Режиссёры', actors: 'Актёры', premiereDate: 'Дата премьеры', languageHint: 'Выбор языка интерфейса', imdbNoData: 'Нет оценок или истории просмотров — убедитесь, что вы вошли в аккаунт и оценили фильмы на IMDb', lblDetails: 'Детали', lblSearch: 'Поиск', lblApply: 'Применение', lblFavorites: 'Избранное', lblExisting: 'Существующие', lblHistory: 'История', lblImport: 'Импорт', lblPages: 'Страницы', }, es: { time: 'Tiempo', exportRatings: '📤 Exportar valoraciones', importRatings: '📥 Importar', hardImport: '🔄 Importación forzada', loadingPage: 'Cargando pág. {p}{total} ({count} películas)', kpParseFailed: 'Error al analizar el listado de Kinopoisk', kpListingFailed: 'Error al cargar el listado de Kinopoisk', profileDetect: 'Detectando perfil de {platform}', loadedRecords: 'Cargados {count} registros. {next}', checkingExisting: 'Comprobando valoraciones existentes...', startingImport: 'Iniciando importación...', importProgress: 'Importando a {platform} {from}–{to}/{total}', searchProgress: 'Buscando {from}–{to}/{total}', resolveProgress: 'Resolviendo {from}–{to}/{total}', resolveIdCount: 'Resolviendo IDs: {count} películas', fetchingLid: 'Obteniendo LID: {count} películas', applyProgress: 'Aplicando {from}–{to}/{total}', loadingExisting: 'Cargando valoraciones: pág. {p}{total} ({count} películas)', deepSearch: 'Búsqueda profunda {platform}', scanHistory: 'Escaneando historial de {platform}', foundCount: 'Encontradas: {count} películas. Generando CSV', userIdWarn: '⚠️ No se detectó el user ID — no se omitirán valoraciones existentes', ratings: 'Valoraciones', watchHistory: 'Historial', diary: 'Diario', watched: 'Visto', page: 'página', kpUserIdNotFound: 'User ID no encontrado — abre tu perfil de Kinopoisk', imdbUserIdNotFound: '❌ User ID de IMDb no encontrado — inicia sesión', lbUsernameNotFound: 'No se detectó el usuario de Letterboxd — abre tu perfil', csrfNotFound: '❌ Token CSRF no encontrado — inicia sesión en Letterboxd', csvEmpty: '❌ CSV vacío o no reconocido', done: '✅ ¡Listo{mode}!', replaceMode: ' (modo reemplazo)', rated: 'Valorado: ', watchedShort: 'Visto: ', skipped: 'Omitido: ', notFound: 'No encontrado: ', failed: 'Errores: ', errorNotFoundKP: 'No encontrado en Kinopoisk', errorNotFoundIMDb: 'No encontrado en IMDb', errorNotFoundLB: 'No encontrado en Letterboxd', errorApi: 'Error de API / fallo de red', allImported: '🎉 ¡Todos los registros importados!', exportDone: '✅ ¡Exportación completa! Archivo guardado.', deepSearchBtn: '🔍 Búsqueda profunda ({count})', movies: 'películas', favorites: 'Favoritos: ', likes: 'Me gusta', importFavorites: 'Importar favoritos', language: 'Idioma', exportHint: 'Descarga todas tus valoraciones de esta plataforma como archivo CSV', importHint: 'Importa valoraciones desde CSV — las existentes se conservan,las nuevas se añaden', hardImportHint: 'Importa desde CSV y sobrescribe las valoraciones existentes', importFavoritesHint: 'Si está activado,las películas marcadas como favoritas en el CSV se añadirán a tu lista', runtime: 'Duración', directors: 'Directores', actors: 'Actores', premiereDate: 'Fecha de estreno', languageHint: 'Selecciona el idioma de la interfaz', imdbNoData: 'No se encontraron valoraciones ni historial — inicia sesión y valora películas en IMDb', lblDetails: 'Detalles', lblSearch: 'Búsqueda', lblApply: 'Aplicar', lblFavorites: 'Favoritos', lblExisting: 'Existentes', lblHistory: 'Historial', lblImport: 'Importar', lblPages: 'Páginas', }, fr: { time: 'Temps', exportRatings: '📤 Exporter les notes', importRatings: '📥 Importer', hardImport: '🔄 Importation forcée', loadingPage: 'Chargement p. {p}{total} ({count} films)', kpParseFailed: "Échec de l'analyse du listing Kinopoisk", kpListingFailed: 'Échec du chargement du listing Kinopoisk', profileDetect: 'Détection du profil {platform}', loadedRecords: '{count} enregistrements chargés. {next}', checkingExisting: 'Vérification des notes existantes...', startingImport: "Démarrage de l'importation...", importProgress: 'Importation vers {platform} {from}–{to}/{total}', searchProgress: 'Recherche {from}–{to}/{total}', resolveProgress: 'Résolution {from}–{to}/{total}', resolveIdCount: 'Résolution des IDs: {count} films', fetchingLid: 'Récupération LID: {count} films', applyProgress: 'Application {from}–{to}/{total}', loadingExisting: 'Chargement des notes: p. {p}{total} ({count} films)', deepSearch: 'Recherche approfondie {platform}', scanHistory: "Analyse de l'historique {platform}", foundCount: 'Trouvés: {count} films. Génération CSV', userIdWarn: '⚠️ ID utilisateur non détecté — les notes existantes ne seront pas ignorées', ratings: 'Notes', watchHistory: 'Historique', diary: 'Journal', watched: 'Vu', page: 'page', kpUserIdNotFound: 'ID utilisateur introuvable — ouvrez votre profil Kinopoisk', imdbUserIdNotFound: '❌ ID IMDb introuvable — connectez-vous', lbUsernameNotFound: 'Utilisateur Letterboxd non détecté — ouvrez votre profil', csrfNotFound: '❌ Token CSRF introuvable — connectez-vous à Letterboxd', csvEmpty: '❌ CSV vide ou non reconnu', done: '✅ Terminé{mode}!', replaceMode: ' (mode remplacement)', rated: 'Noté: ', watchedShort: 'Vu: ', skipped: 'Ignoré: ', notFound: 'Introuvable: ', failed: 'Erreurs: ', errorNotFoundKP: 'Non trouvé sur Kinopoisk', errorNotFoundIMDb: 'Non trouvé sur IMDb', errorNotFoundLB: 'Non trouvé sur Letterboxd', errorApi: 'Erreur API / problème réseau', allImported: '🎉 Tous les enregistrements importés!', exportDone: '✅ Export terminé! Fichier sauvegardé.', deepSearchBtn: '🔍 Recherche approfondie ({count})', movies: 'films', favorites: 'Favoris: ', likes: 'J\'aime', importFavorites: 'Importer les favoris', language: 'Langue', exportHint: 'Télécharge toutes vos notes depuis cette plateforme en fichier CSV', importHint: 'Importe les notes depuis un CSV — les notes existantes sont conservées,les nouvelles ajoutées', hardImportHint: 'Importe depuis CSV et écrase les notes existantes', importFavoritesHint: 'Si activé,les films marqués favoris dans le CSV seront ajoutés à vos favoris', runtime: 'Durée', directors: 'Réalisateurs', actors: 'Acteurs', premiereDate: 'Date de sortie', languageHint: 'Sélectionnez la langue de l\'interface — la page se rechargera', imdbNoData: 'Aucune note ni historique trouvé — connectez-vous et notez des films sur IMDb', lblDetails: 'Détails', lblSearch: 'Recherche', lblApply: 'Appliquer', lblFavorites: 'Favoris', lblExisting: 'Existants', lblHistory: 'Historique', lblImport: 'Importer', lblPages: 'Pages', }, de: { time: 'Zeit', exportRatings: '📤 Bewertungen exportieren', importRatings: '📥 Importieren', hardImport: '🔄 Hartimport', loadingPage: 'Lade Seite {p}{total} ({count} Filme)', kpParseFailed: 'Kinopoisk-Liste konnte nicht geparst werden', kpListingFailed: 'Kinopoisk-Liste konnte nicht geladen werden', profileDetect: 'Erkenne {platform}-Profil', loadedRecords: '{count} Einträge geladen. {next}', checkingExisting: 'Prüfe bestehende Bewertungen...', startingImport: 'Starte Import...', importProgress: 'Importiere zu {platform} {from}–{to}/{total}', searchProgress: 'Suche {from}–{to}/{total}', resolveProgress: 'Auflösen {from}–{to}/{total}', resolveIdCount: 'Löse IDs auf: {count} Filme', fetchingLid: 'Hole LID: {count} Filme', applyProgress: 'Wende an {from}–{to}/{total}', loadingExisting: 'Lade bestehende Bewertungen: Seite {p}{total} ({count} Filme)', deepSearch: 'Tiefensuche {platform}', scanHistory: 'Scanne {platform}-Verlauf', foundCount: 'Gefunden: {count} Filme. Erstelle CSV', userIdWarn: '⚠️ User ID nicht erkannt — bestehende Bewertungen werden nicht übersprungen', ratings: 'Bewertungen', watchHistory: 'Verlauf', diary: 'Tagebuch', watched: 'Gesehen', page: 'Seite', kpUserIdNotFound: 'User ID nicht gefunden — öffne dein Kinopoisk-Profil', imdbUserIdNotFound: '❌ IMDb User ID nicht gefunden — bitte anmelden', lbUsernameNotFound: 'Letterboxd-Name nicht erkannt — öffne dein Profil', csrfNotFound: '❌ CSRF-Token nicht gefunden — bitte bei Letterboxd anmelden', csvEmpty: '❌ CSV leer oder nicht erkannt', done: '✅ Fertig{mode}!', replaceMode: ' (Ersetzungsmodus)', rated: 'Bewertet: ', watchedShort: 'Gesehen: ', skipped: 'Übersprungen: ', notFound: 'Nicht gefunden: ', failed: 'Fehler: ', errorNotFoundKP: 'Nicht gefunden auf Kinopoisk', errorNotFoundIMDb: 'Nicht gefunden auf IMDb', errorNotFoundLB: 'Nicht gefunden auf Letterboxd', errorApi: 'API-Fehler / Netzwerkfehler', allImported: '🎉 Alle Einträge importiert!', exportDone: '✅ Export abgeschlossen! Datei gespeichert.', deepSearchBtn: '🔍 Tiefensuche ({count})', movies: 'Filme', favorites: 'Favoriten: ', likes: 'Gefällt mir', importFavorites: 'Favoriten importieren', language: 'Sprache', exportHint: 'Lädt alle deine Bewertungen von dieser Plattform als CSV-Datei herunter', importHint: 'Importiert Bewertungen aus CSV — bestehende bleiben,neue werden hinzugefügt', hardImportHint: 'Importiert aus CSV und überschreibt bestehende Bewertungen', importFavoritesHint: 'Wenn aktiviert,werden als Favorits markierte Filme aus dem CSV zu Favoriten hinzugefügt', runtime: 'Laufzeit', directors: 'Regisseur', actors: 'Schauspieler', premiereDate: 'Premiere', languageHint: 'Wähle die Sprache der Oberfläche', imdbNoData: 'Keine Bewertungen oder Verlauf gefunden — melde dich an und bewerte Filme auf IMDb', lblDetails: 'Details', lblSearch: 'Suche', lblApply: 'Anwenden', lblFavorites: 'Favoriten', lblExisting: 'Vorhandene', lblHistory: 'Verlauf', lblImport: 'Import', lblPages: 'Seiten', }, pt: { time: 'Tempo', exportRatings: '📤 Exportar avaliações', importRatings: '📥 Importar', hardImport: '🔄 Importação forçada', loadingPage: 'Carregando pág. {p}{total} ({count} filmes)', kpParseFailed: 'Falha ao analisar listagem do Kinopoisk', kpListingFailed: 'Falha ao carregar listagem do Kinopoisk', profileDetect: 'Detectando perfil {platform}', loadedRecords: '{count} registros carregados. {next}', checkingExisting: 'Verificando avaliações existentes...', startingImport: 'Iniciando importação...', importProgress: 'Importando para {platform} {from}–{to}/{total}', searchProgress: 'Pesquisando {from}–{to}/{total}', resolveProgress: 'Resolvendo {from}–{to}/{total}', resolveIdCount: 'Resolvendo IDs: {count} filmes', fetchingLid: 'Obtendo LID: {count} filmes', applyProgress: 'Aplicando {from}–{to}/{total}', loadingExisting: 'Carregando avaliações: pág. {p}{total} ({count} filmes)', deepSearch: 'Pesquisa profunda {platform}', scanHistory: 'Escaneando histórico {platform}', foundCount: 'Encontrados: {count} filmes. Gerando CSV', userIdWarn: '⚠️ ID do usuário não detectado — avaliações existentes não serão ignoradas', ratings: 'Avaliações', watchHistory: 'Histórico', diary: 'Diário', watched: 'Assistido', page: 'página', kpUserIdNotFound: 'ID do usuário não encontrado — abra seu perfil no Kinopoisk', imdbUserIdNotFound: '❌ ID do IMDb não encontrado — faça login', lbUsernameNotFound: 'Usuário do Letterboxd não detectado — abra seu perfil', csrfNotFound: '❌ Token CSRF não encontrado — faça login no Letterboxd', csvEmpty: '❌ CSV vazio ou não reconhecido', done: '✅ Concluído{mode}!', replaceMode: ' (modo substituição)', rated: 'Avaliado: ', watchedShort: 'Assistido: ', skipped: 'Ignorado: ', notFound: 'Não encontrado: ', failed: 'Erros: ', errorNotFoundKP: 'Não encontrado no Kinopoisk', errorNotFoundIMDb: 'Não encontrado no IMDb', errorNotFoundLB: 'Não encontrado no Letterboxd', errorApi: 'Erro de API / falha de rede', allImported: '🎉 Todos os registros importados!', exportDone: '✅ Exportação concluída! Arquivo salvo.', deepSearchBtn: '🔍 Pesquisa profunda ({count})', movies: 'filmes', favorites: 'Favoritos: ', likes: 'Curtidas', importFavorites: 'Importar favoritos', language: 'Idioma', exportHint: 'Baixa todas as suas avaliações desta plataforma como arquivo CSV', importHint: 'Importa avaliações de CSV — existentes são mantidas,novas são adicionadas', hardImportHint: 'Importa de CSV e sobrescreve as avaliações existentes', importFavoritesHint: 'Se ativado,filmes marcados como favoritos no CSV serão adicionados aos seus favoritos', runtime: 'Duração', directors: 'Diretores', actors: 'Atores', premiereDate: 'Data de estreia', languageHint: 'Selecione o idioma da interface', imdbNoData: 'Nenhuma avaliação ou histórico encontrado — faça login e avalie filmes no IMDb', lblDetails: 'Detalhes', lblSearch: 'Busca', lblApply: 'Aplicar', lblFavorites: 'Favoritos', lblExisting: 'Existentes', lblHistory: 'Histórico', lblImport: 'Importar', lblPages: 'Páginas', }, zh: { time: '时间', exportRatings: '📤 导出评分', importRatings: '📥 导入', hardImport: '🔄 强制导入', loadingPage: '加载第 {p}{total} 页 ({count} 部电影)', kpParseFailed: '无法解析 Kinopoisk 列表', kpListingFailed: '无法加载 Kinopoisk 列表', profileDetect: '正在检测 {platform} 个人资料', loadedRecords: '已加载 {count} 条记录。{next}', checkingExisting: '正在检查现有评分...', startingImport: '开始导入...', importProgress: '正在导入到 {platform} {from}–{to}/{total}', searchProgress: '搜索中 {from}–{to}/{total}', resolveProgress: '解析中 {from}–{to}/{total}', resolveIdCount: '解析 ID: {count} 部电影', fetchingLid: '获取 LID: {count} 部电影', applyProgress: '应用中 {from}–{to}/{total}', loadingExisting: '加载现有评分: 第 {p}{total} 页 ({count} 部电影)', deepSearch: '深度搜索 {platform}', scanHistory: '扫描 {platform} 历史记录', foundCount: '找到: {count} 部电影。正在生成 CSV', userIdWarn: '⚠️ 无法检测到用户 ID — 不会跳过现有评分', ratings: '评分', watchHistory: '观看历史', diary: '日记', watched: '已看', page: '页', kpUserIdNotFound: '未找到用户 ID — 请打开 Kinopoisk 个人资料页面', imdbUserIdNotFound: '❌ 未找到 IMDb 用户 ID — 请登录账户', lbUsernameNotFound: '无法检测到 Letterboxd 用户名 — 请打开个人资料', csrfNotFound: '❌ 未找到 CSRF 令牌 — 请登录 Letterboxd', csvEmpty: '❌ CSV 为空或无法识别', done: '✅ 完成{mode}!', replaceMode: ' (替换模式)', rated: '已评分: ', watchedShort: '已看: ', skipped: '已跳过: ', notFound: '未找到: ', failed: '错误: ', errorNotFoundKP: '未在 Kinopoisk 上找到', errorNotFoundIMDb: '未在 IMDb 上找到', errorNotFoundLB: '未在 Letterboxd 上找到', errorApi: 'API 错误 / 网络故障', allImported: '🎉 所有记录已导入!', exportDone: '✅ 导出完成! 文件已保存。', deepSearchBtn: '🔍 深度搜索 ({count})', movies: '部电影', favorites: '收藏: ', likes: '赞', importFavorites: '导入收藏', language: '语言', exportHint: '将您在该平台的所有评分下载为 CSV 文件', importHint: '从 CSV 导入评分 — 保留现有评分，添加新评分', hardImportHint: '从 CSV 导入并覆盖现有评分', importFavoritesHint: '启用后，CSV 中标记为收藏的电影将被添加到您的收藏列表', runtime: '片长', directors: '导演', actors: '演员', premiereDate: '首映日期', languageHint: '选择界面语言', imdbNoData: '未找到评分或观看历史 — 请登录并在IMDb上评分电影', lblDetails: '详情', lblSearch: '搜索', lblApply: '应用', lblFavorites: '收藏', lblExisting: '现有', lblHistory: '历史', lblImport: '导入', lblPages: '翻页', }, ja: { time: '时间', exportRatings: '📤 評価をエクスポート', importRatings: '📥 インポート', hardImport: '🔄 強制インポート', loadingPage: 'ページ {p}{total} を読み込み中 ({count} 作品)', kpParseFailed: 'Kinopoisk リストの解析に失敗しました', kpListingFailed: 'Kinopoisk リストの読み込みに失敗しました', profileDetect: '{platform} プロフィールを検出中', loadedRecords: '{count} 件のレコードを読み込みました。{next}', checkingExisting: '既存の評価を確認中...', startingImport: 'インポートを開始中...', importProgress: '{platform} へのインポート {from}–{to}/{total}', searchProgress: '検索中 {from}–{to}/{total}', resolveProgress: '解決中 {from}–{to}/{total}', resolveIdCount: 'ID を解決中: {count} 作品', fetchingLid: 'LID を取得中: {count} 作品', applyProgress: '適用中 {from}–{to}/{total}', loadingExisting: '既存の評価を読み込み中: ページ {p}{total} ({count} 作品)', deepSearch: '詳細検索 {platform}', scanHistory: '{platform} の履歴をスキャン中', foundCount: '見つかりました: {count} 作品。CSV を生成中', userIdWarn: '⚠️ ユーザー ID を検出できません — 既存の評価をスキップしません', ratings: '評価', watchHistory: '視聴履歴', diary: '日記', watched: '視聴済み', page: 'ページ', kpUserIdNotFound: 'ユーザー ID が見つかりません — Kinopoisk プロフィールページを開いてください', imdbUserIdNotFound: '❌ IMDb ユーザー ID が見つかりません — ログインしてください', lbUsernameNotFound: 'Letterboxd ユーザー名を検出できません — プロフィールを開いてください', csrfNotFound: '❌ CSRF トークンが見つかりません — Letterboxd にログインしてください', csvEmpty: '❌ CSV が空であるか認識できません', done: '✅ 完了{mode}!', replaceMode: ' (置換モード)', rated: '評価済み: ', watchedShort: '視聴済み: ', skipped: 'スキップ: ', notFound: '見つかりません: ', failed: 'エラー: ', errorNotFoundKP: 'Kinopoisk で見つかりません', errorNotFoundIMDb: 'IMDb で見つかりません', errorNotFoundLB: 'Letterboxd で見つかりません', errorApi: 'API エラー / ネットワーク障害', allImported: '🎉 すべてのレコードをインポートしました!', exportDone: '✅ エクスポート完了! ファイルを保存しました。', deepSearchBtn: '🔍 詳細検索 ({count})', movies: '作品', favorites: 'お気に入り: ', likes: 'いいね', importFavorites: 'お気に入りをインポート', language: '言語', exportHint: 'このプラットフォームのすべての評価をCSVファイルとしてダウンロード', importHint: 'CSVから評価をインポート — 既存の評価は保持、新しい評価が追加されます', hardImportHint: 'CSVからインポートし、既存の評価を上書きします', importFavoritesHint: '有効にすると、CSVでお気に入りとマークされた映画がお気に入りリストに追加されます', runtime: '上映時間', directors: '監督', actors: '出演者', premiereDate: '公開日', languageHint: 'インターフェース言語を選択', imdbNoData: '評価や視聴履歴が見つかりません — ログインしてIMDbで映画を評価してください', lblDetails: '詳細', lblSearch: '検索', lblApply: '適用', lblFavorites: 'お気に入り', lblExisting: '既存', lblHistory: '履歴', lblImport: 'インポート', lblPages: 'ページ', }, ko: { time: '시간', exportRatings: '📤 평점 내보내기', importRatings: '📥 가져오기', hardImport: '🔄 강제 가져오기', loadingPage: '페이지 {p}{total} 로드 중 ({count} 편)', kpParseFailed: 'Kinopoisk 목록을 분석할 수 없습니다', kpListingFailed: 'Kinopoisk 목록을 불러올 수 없습니다', profileDetect: '{platform} 프로필 감지 중', loadedRecords: '{count}개 기록을 로드했습니다. {next}', checkingExisting: '기존 평점 확인 중...', startingImport: '가져오기 시작...', importProgress: '{platform} 가져오기 중 {from}–{to}/{total}', searchProgress: '검색 중 {from}–{to}/{total}', resolveProgress: '해결 중 {from}–{to}/{total}', resolveIdCount: 'ID 해결 중: {count}편', fetchingLid: 'LID 가져오는 중: {count}편', applyProgress: '적용 중 {from}–{to}/{total}', loadingExisting: '기존 평점 로드 중: 페이지 {p}{total} ({count}편)', deepSearch: '심층 검색 {platform}', scanHistory: '{platform} 기록 스캔 중', foundCount: '찾음: {count}편. CSV 생성 중', userIdWarn: '⚠️ 사용자 ID를 감지할 수 없습니다 — 기존 평점을 건너뛰지 않습니다', ratings: '평점', watchHistory: '시청 기록', diary: '다이어리', watched: '시청함', page: '페이지', kpUserIdNotFound: '사용자 ID를 찾을 수 없습니다 — Kinopoisk 프로필 페이지를 여세요', imdbUserIdNotFound: '❌ IMDb 사용자 ID를 찾을 수 없습니다 — 로그인하세요', lbUsernameNotFound: 'Letterboxd 사용자 이름을 감지할 수 없습니다 — 프로필을 여세요', csrfNotFound: '❌ CSRF 토큰을 찾을 수 없습니다 — Letterboxd에 로그인하세요', csvEmpty: '❌ CSV가 비어 있거나 인식할 수 없습니다', done: '✅ 완료{mode}!', replaceMode: ' (대체 모드)', rated: '평가됨: ', watchedShort: '시청함: ', skipped: '건너뜀: ', notFound: '찾을 수 없음: ', failed: '오류: ', errorNotFoundKP: 'Kinopoisk에서 찾을 수 없음', errorNotFoundIMDb: 'IMDb에서 찾을 수 없음', errorNotFoundLB: 'Letterboxd에서 찾을 수 없음', errorApi: 'API 오류 / 네트워크 오류', allImported: '🎉 모든 기록을 가져왔습니다!', exportDone: '✅ 내보내기 완료! 파일이 저장되었습니다.', deepSearchBtn: '🔍 심층 검색 ({count})', movies: '편', favorites: '즐겨찾기: ', likes: '좋아요', importFavorites: '즐겨찾기 가져오기', language: '언어', exportHint: '이 플랫폼의 모든 평점을 CSV 파일로 다운로드', importHint: 'CSV에서 평점 가져오기 — 기존 평점은 유지,새 평점이 추가됩니다', hardImportHint: 'CSV에서 가져오고 기존 평점을 덮어씁니다', importFavoritesHint: '활성화하면 CSV에서 즐겨찾기로 표시된 영화가 즐겨찾기 목록에 추가됩니다', runtime: '상영 시간', directors: '감독', actors: '배우', premiereDate: '개봉일', languageHint: '인터페이스 언어 선택', imdbNoData: '평점이나 시청 기록이 없습니다 — 로그인 후 IMDb에서 영화를 평가하세요', lblDetails: '상세', lblSearch: '검색', lblApply: '적용', lblFavorites: '즐겨찾기', lblExisting: '기존', lblHistory: '기록', lblImport: '가져오기', lblPages: '페이지', }, };

    function getLocale() {
        // Check localStorage for user-saved language preference
        try {
            const saved = GM_getValue('mrs_lang', null);
            if (saved && TRANSLATIONS[saved]) return saved;
        } catch (e) { /* ignore */ }
        const lang = (typeof navigator !== 'undefined' && navigator.language)
            || (typeof document !== 'undefined' && document.documentElement?.lang)
            || 'en';
        const base = String(lang).split('-')[0].toLowerCase();
        return TRANSLATIONS[base] ? base : 'en';
    }

    let __locale = getLocale();
    let __tMap = TRANSLATIONS[__locale] || TRANSLATIONS.en;

    // --- Import Options ---
    function getImportOptions() {
        try {
            const raw = GM_getValue('mrs_options', null);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* ignore */ }
        return { importFavorites: true };
    }
    function saveImportOptions(opts) {
        try { GM_setValue('mrs_options', JSON.stringify(opts)); } catch (e) { /* ignore */ }
    }

    function t(key, vars) {
        let s = __tMap[key] ?? TRANSLATIONS.en[key] ?? key;
        if (vars && typeof vars === 'object') {
            for (const [k, v] of Object.entries(vars)) {
                s = s.split(`{${k}}`).join(String(v));
            }
        }
        return s;
    }

    function formatElapsed(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (minutes > 0) return minutes + 'm ' + seconds + 's';
        return seconds + 's';
    }

    function applyLocale(code) {
        if (!TRANSLATIONS[code]) return;
        __locale = code;
        __tMap = TRANSLATIONS[code];
        try { GM_setValue('mrs_lang', code); } catch (e) { /* ignore */ }
        const panel = document.getElementById('mrs-panel');
        if (!panel) return;
        const btnExport = panel.querySelector('.mrs-btn--primary');
        const btnImport = panel.querySelector('.mrs-btn--secondary');
        const btnReplace = panel.querySelector('.mrs-btn--danger');
        if (btnExport) { btnExport.textContent = t('exportRatings'); btnExport.title = t('exportHint'); }
        if (btnImport) { btnImport.textContent = t('importRatings'); btnImport.title = t('importHint'); }
        if (btnReplace) { btnReplace.textContent = t('hardImport'); btnReplace.title = t('hardImportHint'); }
        const labelFav = panel.querySelector('.mrs-opts__row');
        if (labelFav) {
            labelFav.title = t('importFavoritesHint');
            for (let i = labelFav.childNodes.length - 1; i >= 0; i--) {
                if (labelFav.childNodes[i].nodeType === 3) { labelFav.childNodes[i].textContent = t('importFavorites'); break; }
            }
        }
        const langLabel = panel.querySelector('.mrs-lang-row label');
        if (langLabel) langLabel.textContent = t('language');

        const langSelect = document.getElementById('mrs-lang-select');
        if (langSelect) {
            langSelect.title = t('languageHint');
            for (const opt of langSelect.options) {
                if (opt.value === code) { opt.selected = true; break; }
            }
        }
    }

    // ====================== UTILITIES ======================

    const sleep = ms => new Promise(r => setTimeout(r, Math.max(ms, 1)));

    let _dots = 0;
    const dots = () => { _dots = (_dots + 1) % 3; return '.'.repeat(_dots + 1); };

    // --- Memoization Cache (LRU-style, max 500 entries) ---
    const memo = (fn, maxSize = 500) => {
        const cache = new Map();
        return (...args) => {
            const key = JSON.stringify(args);
            if (cache.has(key)) return cache.get(key);
            const val = fn(...args);
            if (cache.size >= maxSize) cache.delete(cache.keys().next().value);
            cache.set(key, val);
            return val;
        };
    };

    // Specialized memo for functions with a single string argument — avoids JSON.stringify overhead
    const memoStr = (fn, maxSize = 500) => {
        const cache = new Map();
        return (s) => {
            if (cache.has(s)) return cache.get(s);
            const val = fn(s);
            if (cache.size >= maxSize) cache.delete(cache.keys().next().value);
            cache.set(s, val);
            return val;
        };
    };

    // Parse Retry-After header from GM.xmlHttpRequest response headers
    function parseRetryAfter(responseHeaders) {
        if (!responseHeaders) return null;
        const m = responseHeaders.match(/retry-after:\s*(\d+)/i);
        return m ? parseInt(m[1], 10) * 1000 : null;
    }

    // Detect Cloudflare challenge pages (403/503 with cf markers)
    function isCloudflareChallenge(status, text) {
        if (status === 503) return true;
        if (status === 403) {
            if (!text) return false;
            return text.includes('cf-challenge') ||
                text.includes('cloudflare') ||
                text.includes('cdn-cgi/challenge-platform') ||
                text.includes('cf-mitigated');
        }
        return false;
    }

    async function fetchT(url, timeout = 15000, opts = {}) {
        try {
            const resp = await new Promise((resolve, reject) => {
                const tid = setTimeout(() => reject(new DOMException('Timeout', 'AbortError')), timeout);
                GM.xmlHttpRequest({
                    method: opts.method || 'GET',
                    url: url,
                    headers: opts.headers || {},
                    data: opts.body || null,
                    timeout: timeout,
                    onload: function (r) {
                        clearTimeout(tid);
                        // Extension bridge reports transport failures as status 0
                        // with an `error` field (GM managers call onerror instead).
                        if (r?.error && !(r.status > 0)) {
                            reject(new Error(r.error));
                            return;
                        }
                        resolve({
                            ok: r.status >= 200 && r.status < 300,
                            status: r.status,
                            statusText: r.statusText || '',
                            responseHeaders: r.responseHeaders || '',
                            text: () => Promise.resolve(r.responseText),
                            json: () => {
                                try { return Promise.resolve(JSON.parse(r.responseText)); }
                                catch (e) { return Promise.reject(e); }
                            },
                        });
                    },
                    onerror: function () {
                        clearTimeout(tid);
                        reject(new Error('GM.xmlHttpRequest failed'));
                    },
                    ontimeout: function () {
                        clearTimeout(tid);
                        reject(new DOMException('Timeout', 'AbortError'));
                    },
                });
            });
            return resp;
        } catch (e) {
            if (e.name === 'AbortError') console.warn('[mrs] Timeout:', url);
            else console.error('[mrs] fetchT error:', e.message || e, 'url:', url);
            return null;
        }
    }
    // --- Streaming Concurrency (asyncPool pattern) ---
    // Runs async functions with max concurrency, starts new ones as soon as any completes
    async function asyncPool(concurrency, items, worker) {
        const results = new Array(items.length);
        let index = 0;
        const executing = new Set();

        async function next() {
            while (index < items.length) {
                const i = index++;
                // A worker may return a plain value (a cached tt id, a fast-path
                // result, null) or throw before returning a promise. Calling .then
                // on the result used to throw TypeError and abort the whole batch
                // before any write. Routing through a microtask gives every item
                // its own fulfilled/rejected slot, sync return or sync throw included.
                const promise = Promise.resolve()
                    .then(() => worker(items[i], i))
                    .then(
                        r => ({ status: 'fulfilled', value: r }),
                        e => ({ status: 'rejected', reason: e })
                    );
                results[i] = promise;
                executing.add(promise);
                try {
                    await promise;
                } finally {
                    executing.delete(promise);
                }
                if (executing.size >= concurrency) {
                    await Promise.race(executing);
                }
            }
        }

        const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
        await Promise.all(workers);
        return await Promise.all(results);
    }

    // Resolve with `fallback` if `promise` does not settle within `ms`.
    // Prevents a single slow title from stalling a whole concurrency batch.
    function withTimeout(promise, ms, fallback = null) {
        let tid;
        const guard = new Promise(resolve => { tid = setTimeout(() => resolve(fallback), ms); });
        return Promise.race([promise, guard]).finally(() => clearTimeout(tid));
    }

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

    // --- Adaptive Concurrency v2: Latency-Gradient (TCP Vegas/Netflix style) ---
    // Compares the current round's average latency with the best *sustained*
    // average seen so far. The old code used the single fastest request ever as
    // the baseline, so a normal 200↔400 ms spread looked like congestion,
    // concurrency shrank by 5 every round and every import settled at MIN=5.
    function makeProbe(init = CONCURRENCY.INIT, maxC = CONCURRENCY.MAX) {
        // Clamp the start: callers pass a per-platform init that may sit above a
        // lowered cap, and an un-clamped start would ignore the cap until the
        // first probeFail.
        return { c: Math.max(CONCURRENCY.MIN, Math.min(init, maxC)), maxC, window: [], windowSize: 8, base: 0 };
    }

    function probeOk(p, latency) {
        if (!(latency > 0)) return;
        p.window.push(latency);
        if (p.window.length > p.windowSize) p.window.shift();
        if (p.window.length < 3) return;
        const avg = p.window.reduce((a, b) => a + b, 0) / p.window.length;
        const max = p.maxC || CONCURRENCY.MAX;
        if (!p.base || avg < p.base) { p.base = avg; return; }
        const ratio = p.base / avg;
        if (ratio >= 0.8) {
            // Latency is still within normal jitter of the best round: grow.
            if (p.c < max) p.c = Math.min(max, p.c + CONCURRENCY.UP);
        } else if (ratio < 0.5 && p.c > CONCURRENCY.MIN) {
            // Only a real doubling of latency (queueing at the server) backs off.
            p.c = Math.max(CONCURRENCY.MIN, p.c - CONCURRENCY.DOWN);
        }
    }

    function probeFail(p) { p.c = Math.max(CONCURRENCY.MIN, p.c - CONCURRENCY.DOWN); }

    const kpGqlProbe = makeProbe(20, PLATFORM_MAX.kpGql); const pageBetweenDelay = { val: DELAY.PAGE_BETWEEN };
    const gqlProbe = makeProbe(20, PLATFORM_MAX.imdb);
    // Letterboxd listing cache: reused within one scan, 10 min TTL.
    const lbPageCache = new Map();
    const lbProbe = makeProbe(20, PLATFORM_MAX.lb);
    const imdbProbe = makeProbe(20, PLATFORM_MAX.imdb);
    const kpGqlDelay = { val: DELAY.GQL_INIT }, imdbGqlDelay = { val: DELAY.GQL_INIT };
    // Negative search cache: a title that failed to resolve is not retried on
    // every subsequent import for the next few hours.
    const SEARCH_NEG_TTL = 6 * 60 * 60 * 1000;
    const _kpNeg = new Map();
    const _lbNeg = new Map();

    // A fallback search endpoint that keeps failing is not worth its timeout on
    // every remaining title: after `maxFails` consecutive misses the slow path
    // is disabled for the rest of the run and re-enabled on the next one.
    function makeBreaker(maxFails = 8) {
        return {
            fails: 0,
            open: false,
            fail() { this.fails++; if (this.fails >= maxFails) this.open = true; return this.open; },
            ok() { this.fails = 0; },
            reset() { this.fails = 0; this.open = false; },
        };
    }
    let kpHtmlBreaker = makeBreaker(8);
    let imdbHtmlBreaker = makeBreaker(8);
    let lbHtmlBreaker = makeBreaker(8);

    const clearStatus = (el) => {
        if (!el) return;
        if (el.__timerInterval) { clearInterval(el.__timerInterval); el.__timerInterval = null; }
        clearInterval(el.__statusTimer); el.__statusTimer = null;
        el.__titleText = null;
        el.__statusStart = null;
        el.textContent = '';
        el.style.display = 'none';
        el.__progressBar = null;
    };

    // Card shell: header (pulse, title, elapsed timer) + thin progress bar.
    // Created once and never cleared, so phase rows written before the first
    // title update are not wiped. Every flow funnels through this.
    const ensureStatusShell = (el) => {
        if (!el) return null;
        el.style.display = 'block';
        let header = el.querySelector('.mrs-status__header');
        if (!header) {
            header = document.createElement('div');
            header.className = 'mrs-status__header';
            const pulse = document.createElement('span');
            pulse.className = 'mrs-pulse';
            const titleSpan = document.createElement('span');
            titleSpan.className = 'mrs-status__title';
            const titleText = document.createElement('span');
            titleText.className = 'mrs-status__title-text';
            titleSpan.appendChild(titleText);
            const timerSpan = document.createElement('span');
            timerSpan.className = 'mrs-status__timer';
            header.append(pulse, titleSpan, timerSpan);
            el.insertBefore(header, el.firstChild);
            el.__statusStart = Date.now();
        }
        if (!el.__statusTimer) {
            el.__statusTimer = setInterval(() => {
                const timer = el.querySelector('.mrs-status__timer');
                if (timer && el.__statusStart) timer.textContent = formatElapsed(Date.now() - el.__statusStart);
            }, 500);
        }
        let bar = el.querySelector('.mrs-status__progress-bar');
        if (!bar) {
            const progressEl = document.createElement('div');
            progressEl.className = 'mrs-status__progress';
            bar = document.createElement('div');
            bar.className = 'mrs-status__progress-bar';
            progressEl.appendChild(bar);
            el.appendChild(progressEl);
        }
        el.__progressBar = bar;
        if (!el.__statusStart) el.__statusStart = Date.now();
        return { header, bar };
    };

    // Header title only. Unlike the old setStatus it never wipes the card, so
    // the phase rows below it survive every text update.
    const setTitle = (el, text) => {
        if (!el || text == null) return;
        ensureStatusShell(el);
        const titleSpan = el.querySelector('.mrs-status__title');
        if (!titleSpan) return;
        const cached = el.__titleText ?? '';
        if (cached === text) return;
        el.__titleText = text;
        let main = titleSpan.querySelector('.mrs-status__title-text');
        if (!main) {
            titleSpan.textContent = '';
            main = document.createElement('span');
            main.className = 'mrs-status__title-text';
            titleSpan.appendChild(main);
        }
        main.textContent = text;
    };

    // Fresh card for a new run (normal import, deep search retry): old rows and
    // their checkmarks must never survive into the next pass.
    const beginRun = (el, title) => {
        if (!el) return;
        clearStatus(el);
        ensureStatusShell(el);
        setTitle(el, title);
        // A new run gets a fresh chance at the optional search endpoints.
        kpHtmlBreaker.reset();
        imdbHtmlBreaker.reset();
        lbHtmlBreaker.reset();
    };

    // ── Multi-channel status ────────────────────────────────────────────────
    // Ratings / Diary / Watched / Likes are scraped in parallel. Writing all of
    // them into one line made the text flip back and forth, so each channel now
    // owns its own row inside the status card and updates independently.
    function ensureChannels(el) {
        if (!el) return null;
        let list = el.querySelector('.mrs-status__channels');
        if (!list) {
            list = document.createElement('div');
            list.className = 'mrs-status__channels';
            const header = el.querySelector('.mrs-status__header');
            if (header && header.parentNode === el) header.after(list);
            else el.appendChild(list);
        }
        return list;
    }

    // `channel` is a stable internal id; `label` is the visible, translated
    // name. Keeping them apart means two phases can never collide and a row
    // keeps its identity even when the language changes mid-run.
    function channelRow(el, channel, label) {
        const list = ensureChannels(el);
        if (!list) return null;
        let row = list.querySelector('[data-channel="' + CSS.escape(channel) + '"]');
        if (row) return row;

        row = document.createElement('div');
        row.className = 'mrs-status__row';
        row.dataset.channel = channel;
        row.dataset.started = String(Date.now());
        const labelEl = document.createElement('span');
        labelEl.className = 'mrs-status__row-label';
        labelEl.textContent = label || channel;
        const text = document.createElement('span');
        text.className = 'mrs-status__row-text';
        row.append(labelEl, text);
        list.appendChild(row);
        return row;
    }

    // Text stays put; only the muted part after the separator is rewritten, so
    // a row never flashes between two unrelated states.
    function setRowParts(row, main, meta) {
        const textEl = row.querySelector('.mrs-status__row-text');
        if (!textEl) return;
        let mainEl = textEl.querySelector('.mrs-status__row-main');
        let metaEl = textEl.querySelector('.mrs-status__row-meta');
        if (!mainEl) { mainEl = document.createElement('span'); mainEl.className = 'mrs-status__row-main'; textEl.appendChild(mainEl); }
        if (!metaEl) { metaEl = document.createElement('span'); metaEl.className = 'mrs-status__row-meta'; textEl.appendChild(metaEl); }
        if (mainEl.textContent !== main) mainEl.textContent = main;
        const metaText = meta ? '\u00b7 ' + meta : '';
        if (metaEl.textContent !== metaText) metaEl.textContent = metaText;
    }

    function setChannelStatus(el, channel, text, progress, label) {
        if (!el || !channel) return;
        el.style.display = 'block';
        const row = channelRow(el, channel, label);
        if (!row) return;
        const hasProgress = !!(progress && progress.total > 0);
        // `extra` is the muted tail after the separator: the found-item count,
        // a checkmark tally, or '' for "no tail". Passing no `extra` with a
        // total falls back to `done/total`, which is only used when the main
        // text does not already spell it out.
        const extra = progress && progress.extra != null ? String(progress.extra)
            : hasProgress ? progress.current + '/' + progress.total
                : '';
        if (hasProgress) {
            row.dataset.done = String(progress.current);
            row.dataset.total = String(progress.total);
        }
        // A finished row keeps its final text: a straggling request must not
        // repaint a ✓ row back to "1/5".
        if (row.dataset.mark) return;
        if (progress && (hasProgress || progress.extra != null)) {
            setRowParts(row, text, extra);
            updateOverallBar(el);
            return;
        }
        const secs = Math.max(0, Math.round((Date.now() - Number(row.dataset.started || Date.now())) / 1000));
        setRowParts(row, text, secs >= 1 ? formatElapsed(secs * 1000) : '');
    }

    // Aggregate bar: the sum of every phase row's done/total, so the thin strip
    // reflects the whole run instead of flickering per channel.
    function updateOverallBar(el) {
        if (!el) return;
        const bar = el.querySelector('.mrs-status__progress-bar');
        if (!bar) return;
        let done = 0, total = 0;
        for (const row of el.querySelectorAll('.mrs-status__row')) {
            const t = Number(row.dataset.total || 0);
            if (!t) continue;
            const d = row.dataset.mark ? t : Number(row.dataset.done || 0);
            total += t;
            done += Math.min(d, t);
        }
        if (!total) return;
        bar.style.width = Math.round((done / total) * 100) + '%';
    }

    function finishChannel(el, channel, ok, keepMeta) {
        if (!el || !channel) return;
        const row = el.querySelector('[data-channel="' + CSS.escape(channel) + '"]');
        if (!row || row.dataset.mark) return;
        row.dataset.mark = ok ? 'ok' : 'fail';
        row.classList.add(ok ? 'mrs-status__row--done' : 'mrs-status__row--fail');
        // Drop the muted progress part unless the caller wants a final tally
        // (e.g. "· 250 films"), and put the mark in the row tail so it stays
        // visible even when the main text is ellipsised.
        if (!keepMeta) {
            const meta = row.querySelector('.mrs-status__row-text .mrs-status__row-meta');
            if (meta) meta.remove();
        }
        const mark = document.createElement('span');
        mark.className = 'mrs-status__row-mark';
        mark.textContent = ok ? '\u2713' : '!';
        row.appendChild(mark);
        updateOverallBar(el);
    }

    // Writer bound to one channel; callers just push text/progress.
    function channelWriter(el, channel, label) {
        return (text, progress) => setChannelStatus(el, channel, text, progress, label);
    }


    const setStatus = (el, text, progress) => {
        if (!el) return;
        // Never wipe: `el.textContent = ''` here used to erase phase rows that
        // the parallel scrapers had already drawn.
        ensureStatusShell(el);
        setTitle(el, text);
        if (progress && progress.total && el.__progressBar) {
            const pct = Math.round((progress.current / progress.total) * 100);
            el.__progressBar.style.width = pct + '%';
        }
    };

    function renderResult(el, title, pairs, done, elapsedMs) {
        if (el.__timerInterval) { clearInterval(el.__timerInterval); el.__timerInterval = null; }
        clearInterval(el.__statusTimer); el.__statusTimer = null;
        el.__titleText = null;
        el.__statusStart = null;
        el.textContent = '';
        el.style.display = 'block';
        const header = document.createElement('div');
        header.className = 'mrs-status__header mrs-status__header--result';
        const indicator = document.createElement('span');
        indicator.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#10b981;flex-shrink:0;';
        header.appendChild(indicator);
        const titleSpan = document.createElement('span');
        titleSpan.className = 'mrs-status__title';
        titleSpan.textContent = title;
        header.appendChild(titleSpan);
        const pairsSpan = document.createElement('div');
        pairsSpan.className = 'mrs-result-pairs';
        for (const [label, value] of pairs) {
            const pairEl = document.createElement('span');
            pairEl.className = 'mrs-result-pair';
            const labelEl = document.createElement('span');
            labelEl.className = 'mrs-result-label';
            labelEl.textContent = label;
            const valueEl = document.createElement('span');
            valueEl.className = 'mrs-result-value';
            valueEl.textContent = String(value);
            pairEl.appendChild(labelEl);
            pairEl.appendChild(valueEl);
            pairsSpan.appendChild(pairEl);
        }
        header.appendChild(pairsSpan);
        if (done) {
            const doneSpan = document.createElement('span');
            doneSpan.style.color = '#10b981';
            doneSpan.style.fontWeight = '600';
            doneSpan.style.flexShrink = '0';
            doneSpan.textContent = done;
            header.appendChild(doneSpan);
        }
        const timerSpan = document.createElement('span');
        timerSpan.className = 'mrs-status__timer';
        if (elapsedMs != null) timerSpan.textContent = `${t('time')}${formatElapsed(elapsedMs)}`;
        header.appendChild(timerSpan);
        el.appendChild(header);
        const progress = document.createElement('div');
        progress.className = 'mrs-status__progress';
        const bar = document.createElement('div');
        bar.className = 'mrs-status__progress-bar';
        bar.style.width = '100%';
        progress.appendChild(bar);
        el.appendChild(progress);
    }

    // ====================== CSV ======================

    const csvEsc = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const TITLE_DELIM = ' | ';
    const escapeTitleDelim = s => String(s ?? '').replace(/\|/g, '\\|');
    const unescapeTitleDelim = s => String(s ?? '').replace(/\\\|/g, '|');
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

    function buildCSV(rows) {
        const first = rows[0] || {};
        const ext = first === rows[0] && (first.src || first.kpId !== undefined || first.ttId !== undefined || first.lbSlug !== undefined || first.titleRu !== undefined || first.titleOrig !== undefined);
        const hasErrors = rows.some(r => r.error);

        if (ext) {
            const hasDates = rows.some(r => r.watchedDate);
            const hasFav = rows.some(r => r.favorite);
            const hasMeta = rows.some(r => r.runtime || r.directors || r.actors || r.premiereDate || r.genres);
            let baseHdr = 'TitleRu,TitleOrig,AllTitles,Type,KpId,TtId,LbSlug,YearStart,YearEnd,Rating10,Genres';
            if (hasMeta) baseHdr += ',Runtime,Directors,Actors,PremiereDate';
            let hdr = hasDates && hasFav
                ? baseHdr + ',Favorite,WatchedDate'
                : hasDates
                    ? baseHdr + ',WatchedDate'
                    : hasFav
                        ? baseHdr + ',Favorite'
                        : baseHdr;
            if (hasErrors) hdr += ',Error';
            const lines = [hdr, ...rows.map(r => {
                const ratingVal = r.rating == null ? '' : r.rating;
                const favVal = r.favorite == null ? '' : (r.favorite ? '1' : '0');
                const allTitles = Array.isArray(r.allTitles) && r.allTitles.length
                    ? r.allTitles.map(escapeTitleDelim).join(TITLE_DELIM)
                    : (r.allTitles || '');
                let line = [
                    csvEsc(r.titleRu ?? ''),
                    csvEsc(r.titleOrig ?? r.title ?? ''),
                    csvEsc(allTitles),
                    r.type ?? '',
                    r.kpId ?? '',
                    r.ttId ?? '',
                    r.lbSlug ?? '',
                    r.year ?? r.yearStart ?? '',
                    r.yearEnd ?? '',
                    ratingVal,
                    csvEsc(r.genres ?? ''),
                ].join(',');
                if (hasMeta) line += `,${csvEsc(r.runtime ?? '')},${csvEsc(r.directors ?? '')},${csvEsc(r.actors ?? '')},${csvEsc(r.premiereDate ?? '')}`;
                if (hasDates && hasFav) line += `,${favVal},${r.watchedDate ?? ''}`;
                else if (hasDates) line += `,${r.watchedDate ?? ''}`;
                else if (hasFav) line += `,${favVal}`;
                if (hasErrors) line += `,${csvEsc(r.error ?? '')}`;
                return line;
            })];
            return lines.join('\n');
        }

        const hasDates = rows.some(r => r.watchedDate);
        let hdr = hasDates ? 'Title,Year,Rating10,WatchedDate' : 'Title,Year,Rating10';
        if (hasErrors) hdr += ',Error';
        const lines = [hdr, ...rows.map(r => {
            let line = hasDates
                ? `${csvEsc(r.title)},${r.year ?? ''},${r.rating ?? ''},${r.watchedDate ?? ''}`
                : `${csvEsc(r.title)},${r.year ?? ''},${r.rating ?? ''}`;
            if (hasErrors) line += `,${csvEsc(r.error ?? '')}`;
            return line;
        })];
        return lines.join('\n');
    }

    function downloadCSV(csv, name) {
        // Use Blob parts to avoid concatenating BOM + entire CSV into one string
        const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
        const href = URL.createObjectURL(blob);
        // Page-world (extension) mode: route the download through the content
        // script → background so Chrome/Firefox handle it natively.
        const ext = window.__mrsExtHook;
        if (ext && typeof ext.download === 'function') {
            Promise.resolve(ext.download(href, name)).finally(() => setTimeout(() => URL.revokeObjectURL(href), 60000));
            return;
        }
        const a = Object.assign(document.createElement('a'), { href, download: name });
        a.click();
        setTimeout(() => URL.revokeObjectURL(href), 10000);
    }

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
        const skipped = [];
        for (let i = 1; i < lines.length; i++) {
            const l = lines[i].trim();
            if (!l) continue;
            const cells = splitCsvLine(l);
            if (cells.length < Math.min(3, header.length)) { skipped.push(l); continue; }
            const row = {};
            header.forEach((h, idx) => row[h] = cells[idx] ?? '');
            const unq = s => (s || '').replace(/""/g, '"');
            const titleRu = decodeHtmlEntities(unq(row.titleru));
            const titleOrig = decodeHtmlEntities(unq(row.titleorig));
            const cleanRu = cleanTitle(titleRu);
            const cleanOrig = cleanTitle(titleOrig);
            const rawAllTitles = decodeHtmlEntities(unq(row.alltitles));
            const allTitles = splitAllTitles(rawAllTitles);
            const rawRating = (row.rating10 === 'w' || row.rating10 === '') ? null : +row.rating10;
            result.push({
                titleRu: cleanRu || titleRu,
                titleOrig: cleanOrig || titleOrig,
                title: cleanOrig || cleanRu || titleOrig || titleRu,
                allTitles,
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
                runtime: (row.runtime || '').trim(),
                directors: decodeHtmlEntities(unq(row.directors)),
                actors: decodeHtmlEntities(unq(row.actors)),
                premiereDate: (row.premieredate || '').trim(),
                src: (row.src || '').trim(),
            });
        }
        if (skipped.length) console.warn(`[mrs] CSV: ${skipped.length} rows not recognized:`, skipped.slice(0, 10));
        return result;
    }

    function parseCSV(text) {
        // Strip BOM if present (common in CSVs exported from IMDb/Letterboxd)
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
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
        if (skipped.length) console.warn(`[mrs] CSV: ${skipped.length} rows not recognized:`, skipped.slice(0, 10));
        return result;
    }

    // ====================== TITLE HELPERS ======================

    const CYR = {
        'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo', 'Ж': 'Zh', 'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'Kh', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch', 'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya',
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
    };

    const hasCyr = memoStr(s => /[а-яА-ЯёЁ]/.test(s));
    // Characters unique to non-Russian Cyrillic alphabets:
    // Serbian: ђ ј љ њ ћ џ | Ukrainian: є і ї ґ
    // Serbian: ђ ј љ њ ћ џ | Ukrainian: є і ї ґ | Belarusian: ў | Macedonian: ѓ ќ ѕ
    const NON_RUSSIAN_CYR = /[ђѓєѕіїјљњћќўџґЂЃЄЅІЇЈЉЊЋЌЎЏҐ]/;
    const isRussianCyrillic = memoStr(s => {
        if (!hasCyr(s)) return false;
        if (NON_RUSSIAN_CYR.test(s)) return false;
        return true;
    });
    const translit = memoStr(s => s.split('').map(c => CYR[c] ?? c).join(''));
    const normalizeNumerals = memoStr(s => s
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

    // Numeric words that differ between KP and IMDb titles (e.g. "Se7en" vs "Seven", "8 Mile" vs "Eight Mile").
    const NUM_WORDS = {
        '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five',
        '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten',
        '11': 'eleven', '12': 'twelve', '13': 'thirteen', '14': 'fourteen', '15': 'fifteen',
        '16': 'sixteen', '17': 'seventeen', '18': 'eighteen', '19': 'nineteen', '20': 'twenty',
        '21': 'twentyone', '22': 'twentytwo', '23': 'twentythree', '24': 'twentyfour', '25': 'twentyfive',
        '26': 'twentysix', '27': 'twentyseven', '28': 'twentyeight', '29': 'twentynine', '30': 'thirty',
        '40': 'forty', '50': 'fifty', '60': 'sixty', '70': 'seventy', '80': 'eighty', '90': 'ninety',
        '100': 'onehundred', '200': 'twohundred', '300': 'threehundred', '500': 'fivehundred',
        '1000': 'onethousand', '2000': 'twothousand', '2010': 'twothousandten', '2020': 'twothousandtwenty',
    };
    const normTitle = memoStr(s => {
        let n = s.replace(/№/g, ' no ')
            // Superscript numerals may be attached to words (e.g. Alien³). Insert spaces before NFKD normalization.
            .replace(/³/g, ' 3 ')
            .replace(/²/g, ' 2 ')
            .normalize('NFKD').replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/œ/g, 'oe')
            .replace(/æ/g, 'ae');
        n = normalizeNumerals(n);
        // Expand standalone numerals into words ("se7en" → "seven", "8 mile" → "eight mile").
        // Only standalone digits (not years/IDs) to avoid turning "1984" into "one nine eight four".
        n = n.replace(/(^|[^\p{L}\p{N}])[0-9]{1,2}([^\p{L}\p{N}]|$)/gu, (m, pre, post) => {
            const d = m.replace(/[^0-9]/g, '');
            const w = NUM_WORDS[d];
            return w ? pre + w + post : m;
        });
        return n
            .replace(/[\-–—.,!?;:'"«»()\[\]\/]/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\b(the|a|an|and|le|la|les|un|une|el|los|las|der|die|das|il|lo|gli|de|het|en|et|e)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    });
    const cleanTitle = memoStr(t => {
        const m = t.match(/\((.+?)(?:,\s*\d{4}(?:-\d{4})?)\)$/);
        let res = m ? m[1].trim() : t
            .replace(/,\s*\d{4}(?:-\d{4})?\s*$/, '')        // "Title, 1999"
            .replace(/[,]?\s*\(\d{4}(?:-\d{4})?\)\s*$/, '') // "Title (1999)"
            .replace(/[«»]/g, '').trim();
        // Strip slug-style year suffix (e.g., dune-2021 → dune)
        res = res.replace(/-\d{4}$/, '').trim();
        return res;
    });
    const __dedupeMap = new Map();
    function dedupeFetch(key, factory) {
        if (__dedupeMap.has(key)) return __dedupeMap.get(key);
        const p = factory().finally(() => __dedupeMap.delete(key));
        __dedupeMap.set(key, p);
        return p;
    }

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

    // Extract schema.org Movie/TVSeries metadata from HTML JSON-LD blocks.
    function extractSchemaOrg(html, pageUrl, doc) {
        if (!html && !doc) return null;
        // Use DOM parsing to find JSON-LD blocks regardless of attribute order or quotes.
        if (!doc) doc = new DOMParser().parseFromString(html, 'text/html');
        const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
        const candidates = [];
        for (const script of scripts) {
            try {
                let raw = (script.textContent || '').trim().replace(/\u0000/g, '');
                // Strip CDATA markers and HTML comments that some sites wrap around JSON-LD.
                raw = raw.replace(/\/\*[\s\S]*?<!\[CDATA\[[\s\S]*?\*\//g, '').replace(/\/\*[\s\S]*?\]\]>\s*\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').trim();
                if (!raw) continue;
                const data = JSON.parse(raw);
                const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
                for (const item of items) {
                    if (item && (item['@type'] === 'Movie' || item['@type'] === 'TVSeries' || item['@type'] === 'TVEpisode')) {
                        candidates.push(item);
                    }
                }
            } catch (e) { /* ignore malformed JSON-LD */ }
        }
        if (!candidates.length) return null;
        // Prefer the block whose url matches the current page, otherwise the first one.
        const pagePath = (pageUrl || '').split('?')[0].replace(/#$/, '');
        const movie = candidates.find(i => i.url && pagePath && (i.url === pageUrl || i.url === pagePath)) || candidates[0];

        const altTitles = [];
        const pushAlt = (val) => {
            if (!val) return;
            if (Array.isArray(val)) { for (const v of val) pushAlt(v); return; }
            if (typeof val === 'string') altTitles.push(val);
        };
        pushAlt(movie.alternateName);
        pushAlt(movie.alternativeHeadline);
        if (Array.isArray(movie.name)) {
            for (const n of movie.name) pushAlt(n);
        }

        const parseList = (field) => {
            if (!field) return '';
            const arr = Array.isArray(field) ? field : [field];
            return arr.filter(Boolean).map(x => (typeof x === 'string' ? x : x.name || x.text || '')).filter(Boolean).join(', ');
        };
        const directorNames = [parseList(movie.director), parseList(movie.creator)].filter(Boolean).join(', ');

        const duration = movie.duration || movie.timeRequired || '';
        let runtime = '';
        if (typeof duration === 'number') runtime = String(duration);
        else if (typeof duration === 'string') {
            const dm = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
            if (dm) runtime = String((parseInt(dm[1] || 0) * 60) + parseInt(dm[2] || 0));
        }

        return {
            title: decodeHtmlEntities((Array.isArray(movie.name) ? movie.name.find(n => typeof n === 'string') : movie.name) || ''),
            altTitles: [...new Set(altTitles.filter(Boolean).map(decodeHtmlEntities))],
            directors: decodeHtmlEntities(directorNames),
            actors: decodeHtmlEntities(parseList(movie.actor)),
            genres: decodeHtmlEntities(parseList(movie.genre)),
            countries: decodeHtmlEntities(parseList(movie.countryOfOrigin)),
            runtime,
            premiereDate: (() => {
                // KP puts a bare year into datePublished; only a full date is useful.
                const raw = movie.dateCreated || movie.datePublished || '';
                return /^\d{4}-\d{2}-\d{2}/.test(String(raw)) ? String(raw).slice(0, 10) : '';
            })(),
        };
    }

    // ====================== SEARCH & SCORING HELPERS ======================

    // --- Year matching with tolerance (YEAR_TOL=1) ---
    const yearsMatch = (a, b) => {
        if (!a || !b) return true;
        const parseY = s => {
            const m = String(s).match(/(\d{4})/);
            return m ? parseInt(m[1], 10) : null;
        };
        const ya = parseY(a);
        const yb = parseY(b);
        if (ya == null || yb == null) return true;
        return Math.abs(ya - yb) <= YEAR_TOL;
    };

    // --- Generate title variants for search ---
    // Uses original title, alternative titles, localized titles, and transliterations
    function getTitleVariants(title, allTitles = []) {
        const set = new Set();
        const add = t => {
            const v = String(t ?? '').trim();
            if (!v || v.length < 1) return;
            set.add(v);
            const cleaned = cleanTitle(v);
            if (cleaned && cleaned !== v && cleaned.length > 1) set.add(cleaned);
            if (hasCyr(v)) {
                const tr = translit(v);
                if (tr !== v) { set.add(tr); set.add(normTitle(tr)); }
            }
            set.add(normTitle(v));
        };
        add(title);
        if (Array.isArray(allTitles)) {
            for (const alt of allTitles) {
                add(alt);
                if (set.size >= 12) break; // Early exit: don't process hundreds of titles
            }
        }
        // Limit to first 10 unique variants
        return [...set].filter(Boolean).slice(0, 10);
    }

    // --- Extract series parent from episode title ---
    // Handles patterns like "Series: Episode" or "Series - Episode"
    function extractSeriesParent(title) {
        if (!title || typeof title !== 'string') return null;
        const m = title.match(/^(.+?)\s*[:\u2013\u2014\u2015]\s*.+/);
        if (m) {
            const parent = m[1].trim();
            if (parent && parent.length > 1 && parent !== title) return parent;
        }
        // Also try with dash pattern
        const m2 = title.match(/^(.+?)\s*-\s+[A-Z]/);
        if (m2) {
            const parent = m2[1].trim();
            if (parent && parent.length > 1 && parent !== title) return parent;
        }
        return null;
    }

    // --- Additive scoring for candidate matching ---
    // Weights based on reliability of each data field
    // extraTitles: additional query variants (transliterations, alt titles) used to find the candidate.

    // Normalize a type string (IMDb qid / KP CSV type) into a coarse family.
    function typeFamily(t) {
        const s = String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!s) return '';
        if (/tvmovie/.test(s)) return 'tvmovie';
        if (/movie|feature|film/.test(s)) return 'movie';
        if (/series|mini/.test(s)) return 'series';
        if (/short/.test(s)) return 'short';
        if (/video/.test(s)) return 'video';
        if (/music/.test(s)) return 'music';
        if (/special/.test(s)) return 'special';
        if (/episode/.test(s)) return 'episode';
        if (/doc/.test(s)) return 'doc';
        return s;
    }

    // Derivative works (making-ofs, trailers, music videos, TV specials, episodes) that must NEVER
    // win via a weak substring match — a plain film row would otherwise map to "The Making of X".
    const DERIVATIVE_TYPES = new Set(['video', 'music', 'special', 'episode', 'doc', 'tvmovie']);

    function scoreCandidate(source, candidate, extraTitles = []) {
        let score = 0;
        const parts = [];

        // 1. External IDs (highest priority)
        if (candidate.ttId && source.ttId && candidate.ttId === source.ttId) {
            score += 1000; parts.push('+1000 IMDb ID');
        }

        // 2. Original Title Exact
        const srcTitle = source.titleOrig || source.titleRu || source.title || '';
        const candTitle = candidate.titleOrig || candidate.titleRu || candidate.title || '';
        const nCand = normTitle(candTitle);
        // All title variants to compare against: primary + allTitles + translit + extraTitles
        const titlePool = [srcTitle];
        if (Array.isArray(source.allTitles)) titlePool.push(...source.allTitles);
        if (hasCyr(srcTitle)) titlePool.push(translit(srcTitle));
        titlePool.push(...extraTitles.filter(Boolean));
        let titleMatched = false;
        let titleKind = ''; // 'exact' | 'substring' | ''
        // Exact match against any variant
        for (const t of titlePool) {
            const n = normTitle(t);
            if (n && n === nCand) {
                score += 500; parts.push('+500 Title');
                titleMatched = true; titleKind = 'exact';
                break;
            }
        }
        // Clean-title match (strips years, quotes, etc.)
        if (!titleMatched) {
            const cCand = cleanTitle(candTitle);
            for (const t of titlePool) {
                const c = cleanTitle(t);
                if (c && cCand && normTitle(c) === normTitle(cCand)) {
                    score += 480; parts.push('+480 Clean Title');
                    titleMatched = true; titleKind = 'exact';
                    break;
                }
            }
        }

        // Substring/includes match (e.g. Leon in Leon: The Professional).
        // Denied for derivative types — a film row must not map to "The Making of X" / "X: Interviews" / trailers.
        if (!titleMatched && nCand && !DERIVATIVE_TYPES.has(typeFamily(candidate.type))) {
            for (const t of titlePool) {
                const n = normTitle(t);
                if (n && n.length >= 3 && nCand.length >= 3 && (nCand.includes(n) || n.includes(nCand))) {
                    score += 350; parts.push('+350 Substring Title');
                    titleMatched = true; titleKind = 'substring';
                    break;
                }
            }
        }

        // 3. Alternative Title Exact (legacy path; titlePool already covers allTitles)
        if (!titleMatched && source.allTitles && source.allTitles.length && nCand) {
            for (const alt of source.allTitles) {
                const nAlt = normTitle(alt);
                if (nAlt === nCand) {
                    score += 450; parts.push('+450 Alt Title');
                    titleMatched = true; titleKind = 'exact';
                    break;
                }
            }
        }

        // 4. Russian title match (for KP)
        if (!titleMatched && source.titleRu && candidate.titleRu) {
            if (normTitle(source.titleRu) === normTitle(candidate.titleRu)) {
                score += 400; parts.push('+400 Russian Title');
                titleMatched = true; titleKind = 'exact';
            }
        }

        // 2b. Suggest rank bonus: candidate was the TOP result AND year matches — strong signal,
        // even for substring matches (e.g. the real "Rogue One: A Star Wars Story" is rank 0 for "Rogue One",
        // while the fan-edit "Rogue One" (2017) only gets an exact-title-but-wrong-year match).
        if (titleKind !== 'exact' && candidate.suggestRank === 0 && source.year && candidate.year && yearsMatch(candidate.year, source.year)) {
            score += 280; parts.push('+280 Top Suggest + Year');
        }

        // 5. Year
        if (source.year && candidate.year) {
            const sYr = String(source.year).match(/\d{4}/);
            const cYr = String(candidate.year).match(/\d{4}/);
            if (sYr && cYr) {
                const y1 = parseInt(sYr[0], 10), y2 = parseInt(cYr[0], 10);
                if (y1 === y2) { score += 300; parts.push('+300 Year Exact'); }
                else if (Math.abs(y1 - y2) <= YEAR_TOL) { score += 250; parts.push('+250 Year +/-1'); }
            }
        }

        // 6. Type — family-based scoring (KP "Film" ↔ IMDb "movie", KP "TvSeries" ↔ "tvSeries").
        // No hard rejections: KP often mislabels series as Film (e.g. "The Thick of It"), so a series
        // candidate for a Film source is allowed (it just gets no bonus and must rely on title+year).
        const sf = typeFamily(source.type);
        const cf = typeFamily(candidate.type);
        if (sf && cf) {
            if (sf === cf || (sf === 'movie' && cf === 'tvmovie') || (sf === 'tvmovie' && cf === 'movie')) {
                score += 200; parts.push('+200 Type');
            }
        }

        // 6b. Short-film safety: a KP row whose genre says "короткометражка" (short film) must not
        // silently map to a feature with the same name (e.g. Saw (2003 short) vs Saw (2004 feature)).
        if (cf && cf !== 'short' && cf !== 'series') {
            const srcGenres = String(source.genres || '').toLowerCase();
            if (sf === 'short' || srcGenres.includes('короткометражка')) {
                const yExact = !!(source.year && candidate.year &&
                    String(source.year).match(/\d{4}/)?.[0] === String(candidate.year).match(/\d{4}/)?.[0]);
                // Same-name feature with the exact year is likely the intended film; any other year is
                // almost certainly a different work (the user rated the short).
                score -= yExact ? 200 : 650;
                parts.push(yExact ? '-200 Short-source year-exact' : '-650 Short-source vs ' + cf);
            }
        }

        // 7. Director
        if (candidate.directors && source.directors) {
            const sDirs = source.directors.split(',').map(d => normTitle(d.trim())).filter(Boolean);
            const cDirs = candidate.directors.split(',').map(d => normTitle(d.trim())).filter(Boolean);
            if (sDirs.length && cDirs.length && sDirs.some(sd => cDirs.some(cd => cd.includes(sd) || sd.includes(cd)))) {
                score += 150; parts.push('+150 Director');
            }
        }

        // 8. Runtime (graduated scoring)
        if (candidate.runtime && source.runtime) {
            const sR = parseInt(source.runtime, 10);
            const cR = parseInt(candidate.runtime, 10);
            if (sR > 0 && cR > 0) {
                const diff = Math.abs(sR - cR);
                if (diff <= 2) { score += 80; parts.push('+80 Runtime'); }
                else if (diff <= 5) { score += 60; parts.push('+60 Runtime'); }
                else if (diff <= 10) { score += 40; parts.push('+40 Runtime'); }
                else if (diff <= 15) { score += 20; parts.push('+20 Runtime'); }
            }
        }

        // 9. Country
        if (candidate.countries && source.countries) {
            const sCountries = source.countries.toLowerCase();
            const cList = candidate.countries.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
            if (cList.some(c => sCountries.includes(c))) {
                score += 60; parts.push('+60 Country');
            }
        }

        // 10. Genres (max 3, graduated)
        if (candidate.genres && source.genres) {
            const sGenres = source.genres.toLowerCase().split(/[,;]/).map(g => g.trim()).filter(Boolean);
            const cGenres = candidate.genres.toLowerCase().split(/[,;]/).map(g => g.trim()).filter(Boolean);
            let gCount = 0;
            for (const sg of sGenres) {
                if (gCount >= 3) break;
                if (cGenres.some(cg => cg.includes(sg) || sg.includes(cg))) {
                    score += 20; parts.push('+20 Genre');
                    gCount++;
                }
            }
        }

        // 11. Actors (max 3)
        if (candidate.actors && source.actors) {
            const sActors = source.actors.toLowerCase().split(/[,;]/).map(a => a.trim()).filter(Boolean);
            const cActors = candidate.actors.toLowerCase().split(/[,;]/).map(a => a.trim()).filter(Boolean);
            let aCount = 0;
            for (const sa of sActors) {
                if (aCount >= 3) break;
                if (cActors.some(ca => ca.includes(sa) || sa.includes(ca))) {
                    score += 10; parts.push('+10 Actor');
                    aCount++;
                }
            }
        }

        DEBUG && parts.length && console.log(`[mrs] Score: ${score} for "${srcTitle}" (${source.year || '?'}) — ${parts.join(', ')}`);
        return score;
    }

    // --- Confidence label based on total score ---
    function confidenceLabel(score) {
        if (score >= 800) return 'high';
        if (score >= 500) return 'medium';
        return 'low';
    }
    // ====================== KP MODULE ======================

    // Kinopoisk profile URLs may use a numeric ID (/user/33976584/) or a social
    // alias (/user/zigger/). Both work in /user/<ref>/movies/voted-watched URLs,
    // and the site now redirects numeric IDs to the alias form.
    function parseKPUserRefFromNextData() {
        try {
            const d = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent ?? 'null');
            const pp = d?.props?.pageProps;
            const id = pp?.user?.id ?? pp?.userData?.id ?? pp?.requestContext?.user?.id ?? pp?.currentUser?.id;
            if (id) return String(id);
            const alias = pp?.socialAlias ?? pp?.user?.socialAlias ?? pp?.userData?.socialAlias;
            return alias ? String(alias) : null;
        } catch { return null; }
    }

    function getKPUserId() {
        const m = location.href.match(/\/user\/([A-Za-z0-9_-]+)(?:[/?#]|$)/);
        if (m) return decodeURIComponent(m[1]);
        return parseKPUserRefFromNextData();
    }

    async function resolveKPUserId(statusEl) {
        let uid = getKPUserId();
        if (uid) return uid;

        // Try to fetch the profile page in the background
        setStatus(statusEl, 'Detecting Kinopoisk profile...');
        const profileUrls = [
            'https://www.kinopoisk.ru/api/profile',
            'https://www.kinopoisk.ru/mykp/movies/',
            'https://www.kinopoisk.ru/',
        ];
        // Prefer the logged-in user's own SSR ref/alias. Generic /user/<slug>
        // links go last: profile pages also link to other users.
        const patterns = [
            /UserProfile:(\d+):/,
            /"socialAlias"\s*:\s*"([A-Za-z0-9_-]+)"/,
            /"userId"\s*:\s*"?(\d+)/,
            /"user"\s*:\s*\{[^}]*"id"\s*:\s*"?(\d+)/,
            /\/user\/([A-Za-z0-9_-]+)\/?(?:["'?]|$)/,
        ];
        for (const url of profileUrls) {
            try {
                const r = await fetchT(url, 10000);
                if (!r?.ok) continue;
                const text = await r.text();
                for (const re of patterns) {
                    const m = text.match(re);
                    if (m) { uid = m[1]; break; }
                }
                if (uid) break;
            } catch (e) { console.warn('[mrs] KP profile fetch error:', e.message); }
        }

        if (!uid) {
            // Last resort: navigate to profile page
            console.warn('[mrs] Could not detect KP user ID, navigating to profile page');
            window.location.href = 'https://www.kinopoisk.ru/mykp/movies/';
            throw new Error(t('kpUserIdNotFound'));
        }
        return uid;
    }

    function parseKPSSRJson(doc) {
        const scripts = doc.querySelectorAll('script');
        let ssrText = null;
        for (const s of scripts) {
            const txt = s.textContent || '';
            if (txt.includes('__ssr_initial_data')) { ssrText = txt; break; }
        }
        if (!ssrText) return null;
        // Accept both "window.Ya.__ssr_initial_data = {...}" and minified variants.
        const prefixMatch = ssrText.match(/__ssr_initial_data\s*=\s*/);
        if (!prefixMatch) return null;
        const jsonStart = prefixMatch.index + prefixMatch[0].length;
        const scriptEndIdx = ssrText.indexOf('</script>', jsonStart);
        const boundary = scriptEndIdx === -1 ? ssrText.length : scriptEndIdx;
        let jsonText = ssrText.substring(jsonStart, boundary).trim();
        while (jsonText && /[\s;]/.test(jsonText.slice(-1))) jsonText = jsonText.slice(0, -1);
        try { return JSON.parse(jsonText); } catch (e1) {
            const positions = [];
            let depth = 0, inStr = false;
            for (let i = jsonStart; i < jsonStart + jsonText.length; i++) {
                const ch = ssrText[i];
                if (ch === '\\' && inStr) { i++; continue; }
                if (ch === '"') { inStr = !inStr; continue; }
                if (inStr) continue;
                if (ch === '{') depth++;
                else if (ch === '}') { depth--; if (depth === 0) positions.push(i + 1); }
            }
            for (const pos of positions.reverse()) {
                try { return JSON.parse(ssrText.substring(jsonStart, pos)); } catch (_) { continue; }
            }
            console.warn('[mrs] KP SSR parse failed with both methods:', e1.message);
            return null;
        }
    }

    function extractMoviesFromSSR(ssr) {
        const state = ssr?.apolloState;
        if (!state) return null;
        const findReactions = (obj, depth = 0) => {
            if (!obj || typeof obj !== 'object' || depth > 6) return null;
            if (Array.isArray(obj)) return null;
            for (const key of Object.keys(obj)) {
                if (key.startsWith('movieReactions') && obj[key]?.items?.length) {
                    return obj[key];
                }
            }
            if (depth < 6) {
                for (const key of Object.keys(obj)) {
                    const val = obj[key];
                    if (val && typeof val === 'object' && !Array.isArray(val)) {
                        const found = findReactions(val, depth + 1);
                        if (found) return found;
                    }
                }
            }
            return null;
        };
        const reactionsObj = findReactions(state);
        if (!reactionsObj) return null;
        const items = reactionsObj.items || [];
        const results = [];
        for (const item of items) {
            if (item?.__typename !== 'UserMovieReactions') continue;
            const movieRef = item.movie?.__ref;
            if (!movieRef) continue;
            const movie = state[movieRef];
            if (!movie || !movie.id) continue;
            const type = movie.__typename || 'Film';
            const isSeries = type !== 'Film';
            let yearStart = '', yearEnd = '';
            if (isSeries && movie.releaseYears?.[0]) {
                yearStart = String(movie.releaseYears[0].start ?? '');
                yearEnd = String(movie.releaseYears[0].end ?? '');
            } else if (movie.productionYear) {
                yearStart = String(movie.productionYear);
            }
            let rating = null, watched = false, favorite = false;
            const reactionsEntry = Object.entries(item).find(([k]) => /^reactions(?:\(|$)/.test(k));
            const reactions = reactionsEntry ? reactionsEntry[1] : [];
            for (const r of reactions) {
                if (!r) continue;
                const rObj = r.__ref ? state[r.__ref] : r;
                if (!rObj) continue;
                if (rObj.__typename === 'Vote' && rObj.value != null) rating = +rObj.value;
                else if (rObj.__typename === 'Watched' || rObj.watched === true) watched = true;
                else if (rObj.__typename === 'Favorite' || rObj.favorite === true) favorite = true;
            }
            let genres = '';
            if (movie.genres?.length) {
                genres = movie.genres.map(g => {
                    if (!g) return null;
                    const gObj = g.__ref ? state[g.__ref] : g;
                    return gObj?.name || null;
                }).filter(Boolean).join(', ');
            }
            results.push({
                titleRu: decodeHtmlEntities(movie.title?.russian || ''),
                titleOrig: decodeHtmlEntities(movie.title?.original || ''),
                type: isSeries ? 'TvSeries' : 'Film',
                kpId: String(movie.id),
                yearStart, yearEnd,
                rating, watched, favorite,
                genres,
            });
        }
        return results;
    }

    // Determine the last page number from pagination links. The new profile
    // layout only renders a small window of links, so fall back to the SSR
    // reaction count divided by the page size.
    function kpTotalPages(doc, pageSize) {
        let maxPage = 0;
        for (const a of doc.querySelectorAll('a[href*="?page="], a[href*="&page="]')) {
            const m = (a.getAttribute('href') || '').match(/[?&]page=(\d+)/);
            if (m) maxPage = Math.max(maxPage, +m[1]);
        }
        if (maxPage) return maxPage;
        try {
            const ssr = parseKPSSRJson(doc);
            const state = ssr?.apolloState;
            if (state) {
                for (const key of Object.keys(state)) {
                    const v = state[key];
                    if (!v || typeof v !== 'object') continue;
                    for (const kk of Object.keys(v)) {
                        if (kk.startsWith('movieReactions') && Number.isFinite(v[kk]?.total) && pageSize > 0) {
                            return Math.max(1, Math.ceil(v[kk].total / pageSize));
                        }
                    }
                }
            }
        } catch (e) { /* ignore */ }
        return 1;
    }

    function parseKPListingPage(doc) {
        const ssr = parseKPSSRJson(doc);
        if (ssr) {
            const movies = extractMoviesFromSSR(ssr);
            if (movies && movies.length > 0) return movies;
        }

        const results = [], seen = new Set();
        for (const item of doc.querySelectorAll('[class*="styles_item"]')) {
            const link = item.querySelector('a[href*="/film/"], a[href*="/series/"]');
            if (!link) continue;
            const href = link.getAttribute('href') || '';
            const match = href.match(/\/(film|series)\/(\d+)/);
            if (!match || seen.has(match[2])) continue;
            seen.add(match[2]);
            const titleEl = item.querySelector('[class*="styles_title"]');
            const subtitleEl = item.querySelector('[class*="styles_subtitle"]');
            const ratingEl = item.querySelector('[class*="styles_value"]');
            const titleRu = titleEl?.textContent?.trim()
                || link.querySelector('img')?.alt?.split('.')[0]?.trim() || '';
            if (!titleRu) continue;
            const subtitle = subtitleEl?.textContent?.trim() || '';
            const year = subtitle.match(/\b(19|20)\d{2}\b/)?.[0] || '';
            const ratingText = ratingEl?.textContent?.trim() || '';
            const rating = /^\d{1,2}$/.test(ratingText) && +ratingText >= 1 && +ratingText <= 10 ? +ratingText : null;
            results.push({
                titleRu, titleOrig: (() => { if (!subtitle || hasCyr(subtitle)) return ''; const s = subtitle.replace(/^\d{4},\s*/, '').split(',')[0].trim(); return /^\d{4}$/.test(s) ? '' : s; })(),
                type: match[1] === 'series' ? 'TvSeries' : 'Film',
                kpId: match[2],
                yearStart: year, yearEnd: '',
                rating, watched: true,
                favorite: false,
                genres: '',
            });
        }
        return results;
    }

    async function fetchDocTimed(url) {
        const t0 = Date.now();
        const resp = await fetchT(url, 15000);
        if (!resp) return { doc: null };
        if (resp.status === 429) {
            const ra = parseRetryAfter(resp.responseHeaders);
            if (ra) { await sleep(ra); }
            else { adjDelay(pageBetweenDelay, '429'); }
            DEBUG && console.log('[mrs] 429 on ' + url + ', page delay ' + pageBetweenDelay.val + 'ms');
            return { doc: null };
        }
        if (!resp.ok) {
            adjDelay(pageBetweenDelay, 'error');
            return { doc: null };
        }
        adjDelay(pageBetweenDelay, 'ok', Date.now() - t0);
        const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
        return { doc };
    }

    async function performKPExport(statusEl) {
        const kpExportStart = Date.now();
        const el = statusEl;
        beginRun(el, t('profileDetect', { platform: 'Kinopoisk' }));
        const uid = await resolveKPUserId(statusEl);
        if (!uid) throw new Error(t('kpUserIdNotFound'));

        const baseUrl = `https://www.kinopoisk.ru/user/${uid}/movies/voted-watched`;
        let allItems = [], totalPages = 0;
        const stats = { pages: 0, ssr: 0, fallback: 0, retries: 0 };
        // Two long phases, so two rows: listing pages, then film detail pages.
        const chPages = channelWriter(el, 'kpExportPages', t('lblPages'));
        const chDetails = channelWriter(el, 'kpDetails', t('lblDetails'));
        const writePages = (done, total) => chPages(`${t('page')} ${done}/${total}`, { current: done, total, extra: '' });

        // Fetch page 1 first to discover totalPages
        chPages(`${t('page')} 1`, { current: 0, total: 0 });
        {
            let items = [];
            for (let attempt = 1; attempt <= 3; attempt++) {
                const { doc } = await fetchDocTimed(`${baseUrl}/?page=1`);
                if (!doc) break;
                items = parseKPListingPage(doc);
                if (items.length > 0) {
                    if (!totalPages) totalPages = kpTotalPages(doc, items.length);
                    break;
                }
                if (attempt < 3) { stats.retries++; await sleep(800 * attempt); }
            }
            if (items.length === 0) throw new Error(t('kpParseFailed'));
            stats.pages++;
            if (items[0].titleOrig !== undefined && items[0].genres !== undefined) stats.ssr++;
            else stats.fallback++;
            allItems = allItems.concat(items);
        }

        // Fetch remaining pages in parallel
        if (totalPages > 1) {
            const pageNums = [];
            for (let p = 2; p <= totalPages; p++) pageNums.push(p);
            let kpPagesDone = 1; // page 1 was fetched above
            const kpPageReport = () => writePages(kpPagesDone, totalPages);
            kpPageReport();
            const pageResults = await asyncPool(10, pageNums, async (p) => {
                try {
                for (let attempt = 1; attempt <= 3; attempt++) {
                    const { doc } = await fetchDocTimed(`${baseUrl}/?page=${p}`);
                    if (!doc) break;
                    const items = parseKPListingPage(doc);
                    if (items.length > 0) {
                        return { page: p, items };
                    }
                    if (attempt < 3) { stats.retries++; await sleep(800 * attempt); }
                }
                return { page: p, items: [] };
                } finally {
                    kpPagesDone++;
                    if (kpPagesDone % 2 === 0 || kpPagesDone >= totalPages) kpPageReport();
                }
            });
            for (const r of pageResults) {
                if (r.status === 'fulfilled' && r.value && r.value.items.length) {
                    const v = r.value;
                    stats.pages++;
                    if (v.items[0].titleOrig !== undefined && v.items[0].genres !== undefined) stats.ssr++;
                    else stats.fallback++;
                    allItems = allItems.concat(v.items);
                }
            }
            writePages(totalPages, totalPages);
        } else {
            writePages(1, 1);
        }
        finishChannel(el, 'kpExportPages', allItems.length > 0);

        if (allItems.length === 0) throw new Error(t('kpListingFailed'));

        const unique = [...new Map(allItems.map(i => [i.kpId, i])).values()];

        // Fetch film details from Kinopoisk film pages
        chDetails(`0/${unique.length}`, { current: 0, total: unique.length });
        const kpRateLimit = makeRateLimiter(15);
        let kpDetailsDone = 0;
        const kpDetailResults = await asyncPool(20, unique, async i => {
            try {
                if (!i.kpId) return null;
                const cacheKey = 'kp:' + i.kpId;
                const cached = filmDetailCache.get(cacheKey);
                if (cached) return cached;
                await kpRateLimit();
                const result = await kpFetchFilmDetailsHTML(i.kpId);
                if (result) filmDetailCache.set(cacheKey, result);
                return result;
            } finally {
                kpDetailsDone++;
                if (kpDetailsDone % 5 === 0 || kpDetailsDone === unique.length) {
                    chDetails(`${kpDetailsDone}/${unique.length}`, { current: kpDetailsDone, total: unique.length });
                }
            }
        });
        kpDetailResults.forEach((r, i) => {
            const item = unique[i];
            if (r.status === 'fulfilled' && r.value) {
                item.allTitles = [...new Set([item.titleRu, item.titleOrig, ...(item.allTitles || []), ...r.value.allTitles.map(decodeHtmlEntities)].filter(Boolean))];
                item.runtime = r.value.runtime;
                item.directors = r.value.directors;
                item.actors = r.value.actors;
                item.genres = r.value.genres;
                item.premiereDate = r.value.premiereDate;
            }
        });
        finishChannel(el, 'kpDetails', true, true);
        filmDetailCache.flush();
        const kpExportElapsed = Date.now() - kpExportStart;
        DEBUG && console.log(`[mrs] KP export: ${unique.length} ${t('movies')}, pages: ${totalPages || '?'}, SSR: ${stats.ssr}, fallback: ${stats.fallback}, retries: ${stats.retries}, time: ${formatElapsed(kpExportElapsed)}`);
        return buildCSV(unique.map(i => ({
            titleRu: i.titleRu || '',
            titleOrig: i.titleOrig || '',
            allTitles: [...new Set([i.titleRu, i.titleOrig, ...(i.allTitles || [])].filter(Boolean))],
            type: i.type || '',
            kpId: i.kpId || '',
            ttId: '',
            lbSlug: '',
            yearStart: i.yearStart || i.year || '',
            yearEnd: i.yearEnd || '',
            // Rating10 is numeric-only: watched-but-unrated items stay empty.
            rating: i.rating == null ? null : i.rating,
            genres: i.genres || '',
            runtime: i.runtime || '',
            directors: i.directors || '',
            actors: i.actors || '',
            premiereDate: i.premiereDate || '',
            favorite: i.favorite || false,
            src: 'kp',
        })));
    }

    // ----- KP GQL -----
    // TODO: Batch GQL queries via aliases to reduce request count for large libraries.
    // e.g. query { t1: film(id:1){...} t2: film(id:2){...} } — needs API testing.
    // Risk: API may not support batching or may have alias limits.

    const KP_SUGGEST_QUERY = `query SuggestSearch($keyword: String!, $yandexCityId: Int, $limit: Int, $withUserData: Boolean!) { suggest(keyword: $keyword) { top(yandexCityId: $yandexCityId, limit: $limit) { topResult { global { ...SuggestMovieItem ...SuggestPersonItem ...SuggestCinemaItem ...SuggestMovieListItem __typename } __typename } movies { movie { ...SuggestMovieItem __typename } __typename } persons { person { ...SuggestPersonItem __typename } __typename } cinemas { cinema { ...SuggestCinemaItem __typename } __typename } movieLists { movieList { ...SuggestMovieListItem __typename } __typename } __typename } __typename } } fragment ShortImage on Image { avatarsUrl fallbackUrl __typename } fragment MovieHdVerticalPoster on Movie { gallery { posters { hdVertical: vertical(override: OTT_WHEN_EXISTS) { ...ShortImage __typename } __typename } __typename } __typename } fragment MovieKpVerticalPoster on Movie { gallery { posters { kpVertical: vertical { ...ShortImage __typename } __typename } __typename } __typename } fragment TicketOption on Movie { ticketOption { purchasable releaseAnnounce { available releaseDate { accuracy date __typename } __typename } __typename } __typename } fragment SuggestMovieItem on Movie { id contentId title { russian original __typename } rating { kinopoisk { isActive value __typename } __typename } ...MovieHdVerticalPoster ...MovieKpVerticalPoster viewOption { buttonText isAvailableOnline: isWatchable(filter: {anyDevice: false, anyRegion: false}) purchasabilityStatus contentPackageToBuy { billingFeatureName __typename } subscriptionBadge { image { avatarsUrl __typename } __typename } type availabilityAnnounce { groupPeriodType announcePromise availabilityDate type __typename } __typename } ...TicketOption userData @include(if: $withUserData) { isPlannedToWatch __typename } ... on Film { productionYear __typename } ... on TvSeries { releaseYears { end start __typename } __typename } ... on TvShow { releaseYears { end start __typename } __typename } ... on MiniSeries { releaseYears { end start __typename } __typename } __typename } fragment SuggestPersonItem on Person { id name originalName birthDate poster { avatarsUrl fallbackUrl __typename } __typename } fragment SuggestCinemaItem on Cinema { id ctitle: title city { id name geoId __typename } __typename } fragment SuggestMovieListItem on MovieListMeta { id cover { avatarsUrl __typename } coverBackground { avatarsUrl __typename } name url description movies(limit: 0) { total __typename } __typename }`;
    const KP_VOTE_MUT = `mutation MovieSetVote($movieId: Long!, $rate: Int!) {\n  movie {\n    vote {\n      set(input: {movieId: $movieId, rate: $rate}) {\n        error {\n          message\n          __typename\n        }\n        status\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n`;
    const KP_WATCH_MUT = `mutation MovieSetWatched($movieId: Long!) {\n  movie {\n    watched {\n      set(input: {movieId: $movieId}) {\n        error {\n          message\n          __typename\n        }\n        status\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n`;
    const KP_FAVORITE_MUT = `mutation SetMovieFavorite($movieId: Long!) {\n  movie {\n    favorite {\n      set(input: {movieId: $movieId}) {\n        status\n        error {\n          message\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n`;
    const KP_FILM_DETAIL_QUERY = `query FilmDetail($id: Long!) {
  movie {
    film(id: $id) {
      id
      title { russian original alternative { name } }
      duration
      premiereWorld { date }
      genres { name }
      productionYear
      ... on Film { productionYear }
      ... on TvSeries { releaseYears { start end } }
      ... on MiniSeries { releaseYears { start end } }
      ... on TvShow { releaseYears { start end } }
      persons(limit: 20) {
        name { russian original }
        professionText
      }
    }
  }
}`;

    async function kpGql(query, variables, op) {
        const url = op ? `${KP_GQL}?operationName=${encodeURIComponent(op)}` : KP_GQL;
        const genId = () => `${Date.now()}-${Math.random().toString().slice(2)}:${Math.floor(Math.random() * 100)}`;
        const genSearchId = () => `${Date.now()}${Math.floor(Math.random() * 1000000000)}`;
        const genTraceId = () => {
            const hex = () => Math.random().toString(16).slice(2, 18);
            return `00-${hex()}${hex()}-${hex()}-01`;
        };
        for (let i = 1; i <= RETRY.GQL; i++) {
            try {
                const bodyStr = JSON.stringify({ operationName: op, variables, query });
                // Use GM.xmlHttpRequest (via fetchT) instead of raw XHR — unified fetch pattern
                // GM.xmlHttpRequest sends cookies for @connect domains by default
                const r = await fetchT(url, 10000, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'Accept': '*/*',
                        'Accept-Language': 'ru,en;q=0.9',
                        'x-kp-testids': '414549,436857,436979,1615440',
                        'x-search-request-id': genSearchId(),
                        'service-id': '25',
                        'source-id': '1',
                        'x-preferred-language': 'ru',
                        'x-request-id': genId(),
                        'traceparent': genTraceId(),
                    },
                    body: bodyStr,
                });
                if (!r) {
                    adjDelay(kpGqlDelay, 'error');
                    if (i < RETRY.GQL) await sleep(kpGqlDelay.val * 1.6);
                    continue;
                }
                const status = r.status;
                const text = await r.text();
                if (status === 429) {
                    const ra = parseRetryAfter(r.responseHeaders);
                    if (ra) { await sleep(ra); }
                    else { adjDelay(kpGqlDelay, '429'); await sleep(kpGqlDelay.val * 1.5); }
                    continue; }
                if (!text) { adjDelay(kpGqlDelay, 'error'); continue; }
                let json;
                try { json = JSON.parse(text); } catch {
                    // Kinopoisk answers a throttled request with an HTML 403 page,
                    // not JSON. Measured: the same keyword succeeds again after
                    // ~400 ms, so retrying after a short pause saves the film
                    // instead of throwing it away as "not found".
                    if (status === 403 || status === 429 || status >= 500) {
                        adjDelay(kpGqlDelay, status === 429 ? '429' : 'error');
                        if (i < RETRY.GQL) await sleep(300 + Math.random() * 250 + i * 200);
                        continue;
                    }
                    console.warn(`[mrs] KP GQL non-JSON response (${status}):`, text.slice(0, 300));
                    adjDelay(kpGqlDelay, 'error');
                    continue;
                }
                if (json?.errors && !json?.data) {
                    // 403/429/5xx here is Kinopoisk's anti-fraud throttle, not a
                    // dead query: measured with 40 concurrent Suggest calls, a
                    // 403'd request succeeds again after ~400 ms, so treating it
                    // as fatal marked perfectly good films as "failed".
                    if (status === 403 || status === 429 || status >= 500) {
                        adjDelay(kpGqlDelay, status === 429 ? '429' : 'error');
                        if (i < RETRY.GQL) await sleep(300 + Math.random() * 300 + i * 200);
                        continue;
                    }
                    console.warn(`[mrs] KP GQL errors (${status}):`, JSON.stringify(json.errors).slice(0, 500));
                    adjDelay(kpGqlDelay, 'error');
                    if (status >= 400 && status < 500) throw new Error(`GQL ${status}`);
                    continue;
                }
                adjDelay(kpGqlDelay, 'ok', 200);
                return json;
            } catch (e) {
                console.warn(`[mrs] KP GQL exception (attempt ${i}/${RETRY.GQL}):`, e.message);
                adjDelay(kpGqlDelay, 'error');
                if (i === RETRY.GQL) throw e;
            }
            if (i < RETRY.GQL) await sleep(kpGqlDelay.val * 1.6);
        }
        return null;
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

    async function searchKPId(title, year, deep = false, allTitles = []) {
        const cacheKey = `kp:${normTitle(title)}|${year || ''}|${deep ? '1' : '0'}`;
        // Successful matches survive between runs: a re-import of the same CSV
        // must not pay for the same lookup twice.
        const cached = searchCache.get(cacheKey);
        if (cached !== undefined) return cached;
        const negTs = _kpNeg.get(cacheKey);
        if (negTs && Date.now() - negTs < SEARCH_NEG_TTL) return null;
        return dedupeFetch(cacheKey, async () => {
            const nKey = normTitle(title);
            const variants = deep ? getTitleVariants(title, allTitles) : getTitleVariants(title, allTitles).slice(0, 5);
            let best = null;

            // --- Phase 1: GQL Suggest ---
            // One request per variant, stopped at the first confident hit. The
            // old loop asked the same query twice (`for pass = 0; pass < 2`) and
            // parsed the identical JSON again — that alone doubled the cost of
            // every KP search. Spellings stay sequential on purpose: GraphQL is
            // the rate-limited, anti-fraud-guarded endpoint here.
            for (const q of variants.slice(0, deep ? variants.length : 3)) {
                const json = await kpGql(KP_SUGGEST_QUERY, { keyword: q, yandexCityId: 6, limit: 20, withUserData: true }, 'SuggestSearch');
                if (json?.errors) console.warn('[mrs] KP search errors:', JSON.stringify(json.errors).slice(0, 500));
                const top = json?.data?.suggest?.top;
                if (!top) continue;

                const candidates = [];
                const tr = top.topResult?.global;
                if (tr && !tr.__typename?.includes('Person')) candidates.push(tr);
                for (const e of top.movies ?? []) candidates.push(e?.movie);

                for (const m of candidates) {
                    if (!m?.id) continue;
                    const hit = matchMovie(m, nKey, year);
                    if (!hit) continue;
                    const cand = {
                        kpId: String(hit.id),
                        titleRu: hit.title?.russian || '',
                        titleOrig: hit.title?.original || '',
                        year: String(hit.productionYear ?? hit.releaseYears?.start ?? hit.releaseYears?.end ?? ''),
                        type: hit.__typename || 'Film',
                    };
                    const score = scoreCandidate({ title, titleRu: title, titleOrig: title, year, type: '', allTitles }, cand);
                    const conf = confidenceLabel(score);
                    if (conf === 'high' && (!year || !cand.year || yearsMatch(cand.year, year))) {
                        const result = { ...cand, score, confidence: conf };
                        searchCache.set(cacheKey, result);
                        DEBUG && console.log(`[mrs] KP search HIGH: "${title}" (${year}) → kpId=${cand.kpId} score=${score.toFixed(2)}`);
                        return result;
                    }
                    if (!best || score > best.score) best = { ...cand, score, confidence: conf };
                }
                if (best && best.confidence === 'high' && (!year || !best.year || yearsMatch(best.year, year))) {
                    searchCache.set(cacheKey, best);
                    return best;
                }
            }

            // --- Phase 2: HTML fallback ---
            // NOTE: /index.php?kp_query= endpoint may be deprecated by Yandex.
            // If this stops working, GQL Suggest (Phase 1) is the primary search method.
            // Only worth paying when Suggest produced nothing usable, and only
            // for the first few spellings: ten variants × one page each was the
            // slowest path in a whole KP import.
            if (!kpHtmlBreaker.open && (deep || !best || best.confidence !== 'high')) {
                const maxQueries = deep ? variants.length : Math.min(variants.length, 2);
                for (const q of variants.slice(0, maxQueries)) {
                    if (kpHtmlBreaker.open) break;
                    try {
                        const r = await fetchT(`https://www.kinopoisk.ru/index.php?kp_query=${encodeURIComponent(q)}`);
                        if (!r?.ok) {
                            if (kpHtmlBreaker.fail()) console.warn('[mrs] KP HTML search disabled for this run after repeated failures');
                            continue;
                        }
                        kpHtmlBreaker.ok();
                        const html = await r.text();
                        // The endpoint now often answers 200 with an anti-bot stub
                        // (<body></body> + `var it = {...}`) instead of results.
                        // Parsing it yields nothing, but each such page still costs
                        // ~1.5 s per spelling — treat it as a failed fallback so the
                        // breaker can switch the dead path off for this run.
                        const isAntiBot = !/href="\/(?:film|series)\/\d+"/.test(html) && /var it =|ss\./i.test(html);
                        const matches = [...html.matchAll(/<a[^>]+href="\/(?:film|series)\/(\d+)"[^>]*>([^<]+)</g)];
                        if (!matches.length || isAntiBot) {
                            if (kpHtmlBreaker.fail()) console.warn('[mrs] KP HTML search disabled for this run (endpoint returns no results)');
                            continue;
                        }
                        const seen = new Set();
                        for (const [, id, text] of matches) {
                            if (seen.has(id)) continue;
                            seen.add(id);
                            const ctxIdx = html.indexOf(id);
                            const ctxStart = Math.max(0, ctxIdx - 200);
                            const ctx = html.substring(ctxStart, ctxStart + 400);
                            const yr = ctx.match(/\b(19|20)\d{2}\b/);
                            const ruTitle = text.trim();
                            let origTitle = '';
                            const origSpan = ctx.match(/<span[^>]+class="[^"]*\b(?:original?|orig|en|subtitle)[^"]*"[^>]*>([^<]+)</i);
                            if (origSpan) {
                                origTitle = origSpan[1].trim();
                            } else {
                                const textFrags = ctx.split(/<[^>]+>/).map(s => s.trim()).filter(Boolean);
                                for (const frag of textFrags) {
                                    const clean = frag.replace(/[,;•–—]+/g, ' ').trim();
                                    if (clean && clean !== ruTitle && clean.length > 2 && !/[а-яА-ЯёЁ]/.test(clean)) {
                                        origTitle = clean;
                                        break;
                                    }
                                }
                            }
                            const cand = {
                                kpId: id,
                                titleRu: ruTitle,
                                titleOrig: origTitle,
                                year: yr ? yr[0] : '',
                                type: '',
                            };
                            const score = scoreCandidate({ title, titleRu: title, titleOrig: title, year, type: '', allTitles }, cand);
                            const conf = confidenceLabel(score);
                            if (conf === 'high' && (!year || !cand.year || yearsMatch(cand.year, year))) {
                                const result = { ...cand, score, confidence: conf };
                                searchCache.set(cacheKey, result);
                                DEBUG && console.log(`[mrs] KP HTML HIGH: "${title}" (${year}) → kpId=${id} score=${score.toFixed(2)}`);
                                return result;
                            }
                            if (!best || score > best.score) best = { ...cand, score, confidence: conf };
                        }
                    } catch (e) { console.warn("[mrs] catch:", e?.message ?? e); }
                }
            }

            if (best) {
                DEBUG && console.log(`[mrs] KP search best: "${title}" (${year}) → kpId=${best.kpId} score=${best.score.toFixed(2)} conf=${best.confidence}`);
                const yearOk = !best.year || !year || yearsMatch(best.year, year);
                if (yearOk && (best.confidence === 'high'
                    || (deep && best.confidence !== 'low')
                    || (best.confidence === 'medium')
                    || (best.confidence === 'low' && best.score >= 350))) {
                    searchCache.set(cacheKey, best);
                    return best;
                }
            }

            // Try matching the parent series for episode titles
            const parent = extractSeriesParent(title);
            if (parent && parent !== title) {
                DEBUG && console.log(`[mrs] KP trying series parent: "${parent}" for "${title}"`);
                const parentResult = await searchKPId(parent, year, deep);
                if (parentResult) { searchCache.set(cacheKey, parentResult); return parentResult; }
            }

            console.warn(`[mrs] KP search FAILED: "${title}" (${year})`);
            _kpNeg.set(cacheKey, Date.now());
            return null;
        });
    }

    async function applyKP(kpId, rating) {
        const hasR = rating != null && String(rating) !== '' && +rating >= 1 && +rating <= 10;
        const op = hasR ? 'MovieSetVote' : 'MovieSetWatched';
        const vars = hasR ? { movieId: +kpId, rate: +rating } : { movieId: +kpId };
        const json = await kpGql(hasR ? KP_VOTE_MUT : KP_WATCH_MUT, vars, op);
        if (!json) {
            console.warn(`[mrs] KP apply FAILED (null response): kpId=${kpId} rating=${rating}`);
            return null;
        }
        if (json.errors) {
            console.warn(`[mrs] KP apply ERRORS: kpId=${kpId} rating=${rating}`, JSON.stringify(json.errors).slice(0, 500));
        }
        const r = hasR ? json?.data?.movie?.vote?.set : json?.data?.movie?.watched?.set;
        if (r?.error) {
            console.warn(`[mrs] KP apply GQL ERROR: kpId=${kpId} rating=${rating} msg=${r.error.message}`, JSON.stringify(r).slice(0, 300));
        }
        const ok = r && !r.error;
        if (ok) DEBUG && console.log(`[mrs] KP apply OK: kpId=${kpId} rating=${rating} → ${hasR ? 'rated' : 'watched'}`);
        if (!ok) return null;
        return hasR ? 'rated' : 'watched';
    }

    async function kpFetchRatings(statusEl) {
        const el = statusEl;
        const uid = await resolveKPUserId(statusEl);
        if (!uid) {
            setStatus(statusEl, t('userIdWarn'));
            return new Map();
        }
        const baseUrl = `https://www.kinopoisk.ru/user/${uid}/movies/voted-watched`;
        const map = new Map();
        // Title index lets the importer recognise an already-rated film BEFORE
        // paying for a network search — with 899 items that was most of the time.
        const byTitle = new Map();
        let seen = 0;
        const indexItem = (item) => {
            if (!item.kpId || map.has(item.kpId)) return;
            map.set(item.kpId, item.rating != null ? item.rating : 'watched');
            seen++;
            // Index every spelling we know: the profile page carries the Russian
            // title while a CSV row may carry the original one, and a key that is
            // missing here silently costs a network search.
            for (const name of [item.titleRu, item.titleOrig, ...(item.allTitles || [])]) {
                const k = titleKey(name, item.yearStart || item.year);
                if (k && !byTitle.has(k)) byTitle.set(k, item.kpId);
            }
        };
        const chExisting = channelWriter(el, 'kpExisting', t('lblExisting'));
        const report = (done, total) => chExisting(`${t('page')} ${done}/${total}`,
            { current: done, total, extra: `${seen} ${t('movies')}` });
        let totalPages = 0;
        // Fetch page 1 first to discover totalPages
        chExisting(`${t('page')} 1`, { extra: `${seen} ${t('movies')}` });
        {
            const { doc } = await fetchDocTimed(`${baseUrl}/?page=1`);
            if (doc) {
                const items = parseKPListingPage(doc);
                if (!totalPages) totalPages = kpTotalPages(doc, items.length);
                for (const item of items) indexItem(item);
            }
        }

        // Fetch remaining pages in parallel
        if (totalPages > 1) {
            const pageNums = [];
            for (let p = 2; p <= totalPages; p++) pageNums.push(p);
            let pagesDone = 1;
            const results = await asyncPool(10, pageNums, async (p) => {
                try {
                    const { doc } = await fetchDocTimed(`${baseUrl}/?page=${p}`);
                    if (!doc) return [];
                    return parseKPListingPage(doc);
                } finally {
                    pagesDone++;
                    if (pagesDone % 3 === 0 || pagesDone >= totalPages) report(pagesDone, totalPages);
                }
            });
            for (const r of results) {
                if (r.status === 'fulfilled' && r.value) {
                    for (const item of r.value) indexItem(item);
                }
            }
            report(Math.max(1, totalPages), Math.max(1, totalPages));
        } else {
            report(1, 1);
        }
        finishChannel(el, 'kpExisting', seen > 0, true);
        map.byTitle = byTitle;
        return map;
    }

    // Normalised title+year key used to match CSV rows against the existing list
    // without hitting the search endpoint.
    function titleKey(title, year) {
        if (!title) return '';
        const n = normTitle(title);
        if (!n) return '';
        const y = String(year || '').match(/\b(19|20)\d{2}\b/)?.[0] || '';
        return y ? `${n}|${y}` : n;
    }

    async function runKPImportBatch(items, statusEl, mode, deep = false, opts = {}) {
        const el = statusEl;
        Object.assign(kpGqlProbe, makeProbe(30, PLATFORM_MAX.kpGql));
        kpGqlDelay.val = DELAY.GQL_INIT;
        setTitle(el, `${items.length} ${t('movies')}`);
        const existing = mode === 'normal' && !deep ? await kpFetchRatings(statusEl) : new Map();
        let rated = 0, watched = 0, skipped = 0, notFound = 0, failed = 0, favCount = 0;
        const missed = [];
        const skippedFavIds = [];
        const appliedFavIds = [];
        let cur = 0;
        // The loop searches and applies per item, so it is one phase; its row
        // fills to completion and stays on screen while favorites are applied.
        const chApply = channelWriter(el, 'kpApply', t('lblApply'));

        while (cur < items.length) {
            const slice = items.slice(cur, cur + kpGqlProbe.c);
            const to = Math.min(cur + kpGqlProbe.c, items.length);
            chApply(`${cur + 1}–${to}/${items.length}`, { current: to, total: items.length, extra: `${rated} ${t('rated')}` });
            // Measure the batch itself: taking t0 AFTER the pool made every
            // elapsed value ~0 ms, so probeOk judged latency from noise.
            const t0 = Date.now();
            const res = await asyncPool(kpGqlProbe.c, slice, async item => {
                const hasR0 = item.rating != null && +item.rating >= 1 && +item.rating <= 10;
                const canSkip = mode === 'normal' && existing.size > 0;

                // Fast path: if the film is already in the profile we can skip it
                // WITHOUT a search. Checking the id first, then the title index,
                // avoids a network round-trip for ~86% of a re-import.
                let knownId = (item.kpId && /^\d+$/.test(item.kpId)) ? item.kpId : null;
                if (!knownId && canSkip && existing.byTitle) {
                    for (const name of [item.title, item.titleRu, item.titleOrig, ...(item.allTitles || [])]) {
                        knownId = existing.byTitle.get(titleKey(name, item.year))
                            || existing.byTitle.get(titleKey(name)); // year-less fallback
                        if (knownId != null) break;
                    }
                }
                if (knownId != null && existing.has(knownId)) {
                    const ex = existing.get(knownId);
                    if (mode === 'normal' && (ex !== 'watched' || !hasR0)) {
                        if (opts.importFavorites && item.favorite) skippedFavIds.push(knownId);
                        return 'skipped';
                    }
                }

                const kpResult = knownId ? { kpId: knownId, score: 1.0, confidence: 'high' }
                    : await searchKPId(item.title, item.year, deep, item.allTitles);
                if (!kpResult || kpResult.confidence === 'low') return 'notfound';

                const ex = existing.get(kpResult.kpId);
                const hasR = item.rating != null && +item.rating >= 1 && +item.rating <= 10;
                if (mode === 'normal' && ex != null && (ex !== 'watched' || !hasR)) {
                    if (opts.importFavorites && item.favorite) skippedFavIds.push(kpResult.kpId);
                    return 'skipped';
                }
                // Favorites are applied later, in one parallel phase, instead of
                // a second serial mutation inside every worker.
                const appResult = await applyKP(kpResult.kpId, item.rating);
                if (appResult && opts.importFavorites && item.favorite) {
                    appliedFavIds.push(kpResult.kpId);
                    return 'rated+fav';
                }
                return appResult ?? 'failed';
            });
            let fail = 0;
            res.forEach((r, j) => {
                const s = r.status === 'fulfilled' ? r.value : 'failed';
                if (s === 'rated' || s === 'rated+fav') rated++;
                else if (s === 'watched') watched++;
                else if (s === 'skipped') skipped++;
                else if (s === 'notfound') { notFound++; missed.push({ ...slice[j], error: t('errorNotFoundKP') }); }
                else { failed++; missed.push({ ...slice[j], error: t('errorApi') }); fail++; }
            });
            // Advance by the size of the slice that actually ran: probeOk below
            // may raise kpGqlProbe.c, and `cur += probe.c` then skipped films
            // without ever searching or rating them.
            cur = to;
            const elapsed = Date.now() - t0;
            // "Not found" is normal and must not shrink concurrency; only a
            // batch where most writes actually failed should slow us down.
            fail / slice.length >= 0.5 ? probeFail(kpGqlProbe) : probeOk(kpGqlProbe, elapsed);
            // No artificial sleep between batches
        }
        finishChannel(el, 'kpApply', failed === 0, true);
        // Favorites: one parallel phase for both the skipped films (rating kept
        // as-is, only the heart was missing) and the newly applied ones. The old
        // code sent the heart as a second serial mutation inside every worker,
        // then walked the skipped list one id per 200 ms.
        const favIds = [...new Set([...skippedFavIds, ...appliedFavIds])];
        if (opts.importFavorites && favIds.length) {
            const chFav = channelWriter(el, 'kpFavorites', t('lblFavorites'));
            let favDone = 0;
            favDone = (skippedFavIds.length + appliedFavIds.length) - favIds.length;
            const favReport = () => chFav(`${favDone}/${favIds.length}`, { current: favDone, total: favIds.length });
            favReport();
            await asyncPool(6, favIds, async kpId => {
                try {
                    const favJson = await kpGql(KP_FAVORITE_MUT, { movieId: +kpId }, 'SetMovieFavorite');
                    if (favJson?.data?.movie?.favorite?.set && !favJson?.data?.movie?.favorite?.set?.error) {
                        favCount++;
                        if (favCount <= 5 || favCount % 20 === 0) DEBUG && console.log(`[mrs] KP favorite OK: kpId=${kpId}`);
                    }
                } catch (e) {
                    console.warn(`[mrs] KP favorite error: kpId=${kpId}`, e.message);
                }
                favDone++;
                if (favDone % 5 === 0 || favDone === favIds.length) favReport();
            });
            favReport();
            finishChannel(el, 'kpFavorites', true, true);
        }
        return { rated, watched, skipped, notFound, failed, missed, favorites: favCount };
    }

    function renderKPResult(result, statusEl, mode) {
        const lbl = mode === 'replace' ? t('replaceMode') : '';
        const kpPairs = [
            [t('rated'), result.rated],
            [t('watchedShort'), result.watched],
            [t('skipped'), result.skipped],
            [t('notFound'), result.notFound],
            [t('failed'), result.failed],
        ];
        if (result.favorites != null) kpPairs.push([t('favorites'), result.favorites]);
        renderResult(statusEl, t('done', { mode: lbl }), kpPairs, result.notFound === 0 && result.failed === 0 ? t('allImported') : null, result.elapsedMs);
        if (result.missed.length) {
            downloadCSV(buildCSV(result.missed), 'kp_missed.csv');
            const btn = Object.assign(document.createElement('button'), {
                id: 'mrs-retry-kp',
                className: 'mrs-btn mrs-btn--secondary',
                textContent: t('deepSearchBtn', { count: result.missed.length }),
            });
            btn.addEventListener('click', async () => {
                beginRun(statusEl, t('deepSearch', { platform: 'Kinopoisk' }));
                const r2 = await runKPImportBatch(result.missed, statusEl, mode, true, getImportOptions());
                renderKPResult(r2, statusEl, mode);
            });
            const btnWrap = document.createElement('div');
            btnWrap.style.padding = '0 18px 14px';
            btnWrap.appendChild(btn);
            statusEl.appendChild(btnWrap);
        }
    }

    async function performKPImport(csvData, statusEl, mode, deep = false, opts = {}) {
        const items = parseCSV(csvData);
        if (!items.length) return setStatus(statusEl, t('csvEmpty'));
        beginRun(statusEl, `${items.length} ${t('movies')}`);
        const started = Date.now();
        // `deep` must reach the batch: it decides whether the existing profile is
        // loaded for skipping and how many spellings the search may try. It used
        // to be hard-coded to false, so the "deep search missed" retry silently
        // ran as a normal import and skipped everything it was meant to find.
        const result = await runKPImportBatch(items, statusEl, mode, deep, opts);
        result.elapsedMs = Date.now() - started;
        renderKPResult(result, statusEl, mode);
    }

    // ====================== IMDb MODULE ======================

    let titleMap = new Map(), imdbHistory = null;
    const resetTitleMap = () => { titleMap = new Map(); };

    function registerTitle(id, title, orig, year) {
        const add = raw => {
            if (!raw) return;
            for (const k of [raw.toLowerCase().trim(), normTitle(raw), ...(hasCyr(raw) ? [translit(raw).toLowerCase(), normTitle(translit(raw))] : [])]) {
                if (k.length > 1) titleMap.set(k, { ttId: id, year });
            }
        };
        add(title); if (orig && orig !== title) add(orig);
    }

    function lookupTitle(title, year) {
        const nKey = normTitle(title);
        const keys = [title.toLowerCase().trim(), nKey, hasCyr(title) ? translit(title).toLowerCase() : null].filter(Boolean);
        for (const k of keys) {
            const e = titleMap.get(k);
            if (e?.ttId && yearsMatch(e.year, year)) return e.ttId;
        }
        for (const [k, v] of titleMap) {
            if (yearsMatch(v.year, year) && (normTitle(k) === nKey || normTitle(k).includes(nKey) || nKey.includes(normTitle(k)))) return v.ttId;
        }
        return null;
    }

    function parseEdges(edges, set) {
        for (const e of edges) {
            const n = e?.node?.title ?? e?.node;
            if (!n?.id?.startsWith('tt')) continue;
            set?.add(n.id);
            registerTitle(n.id, n?.titleText?.text, n?.originalTitleText?.text, n?.releaseYear?.year);
        }
    }

    function getIMDbUid() {
        try {
            const d = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent ?? 'null');
            const uid = d?.props?.pageProps?.requestContext?.sidecar?.account?.userId;
            if (uid) return uid;
        } catch (e) { console.warn("[mrs] catch:", e?.message ?? e); }
        return location.href.match(/\/user\/(ur\d+)/i)?.[1] ?? null;
    }

    // Returns null when the page has no __NEXT_DATA__; throws on transport
    // failure so scanIMDb can tell "empty page" (stop) from "failed page" (retry).
    async function fetchNextData(url, timeout = 20000) {
        const r = await fetchT(url, timeout);
        // fetchT returns null on transport failure / timeout (it logs the
        // reason itself). Rethrow so scanIMDb can retry instead of stopping.
        if (!r) throw new Error(`fetch failed: ${url}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const m = (await r.text()).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        return m ? JSON.parse(m[1]) : null;
    }

    // Walk a paginated IMDb listing sequentially. A failed page is retried and,
    // if it still fails, SKIPPED with a visible warning instead of silently
    // truncating the whole history (which used to look like a hang).
    // `channel` (optional) makes the walk own a status row that fills up.
    async function scanIMDb(uid, urlFn, label, statusEl, set, channel) {
        let failed = 0;
        const write = channel ? channelWriter(statusEl, channel, label) : null;
        const count = () => `${set?.size ?? 0} ${t('movies')}`;
        let p = 1;
        for (; p <= RETRY.PAGES; p++) {
            const text = `${t('page')} ${p}/${RETRY.PAGES}`;
            if (write) write(text, { extra: count() });
            else setStatus(statusEl, `${label} ${text} · ✓ ${set?.size ?? 0}` + dots());
            let nd = null, lastErr = null;
            for (let attempt = 1; attempt <= RETRY.FETCH; attempt++) {
                try {
                    nd = await fetchNextData(urlFn(uid, p));
                    lastErr = null;
                    break;
                } catch (e) {
                    lastErr = e;
                    if (attempt < RETRY.FETCH) await sleep(700 * attempt + Math.random() * 300);
                }
            }
            if (nd === null) {
                if (lastErr) {
                    // Transport failure: skip this page, keep going.
                    failed++;
                    console.warn(`[mrs] ${label} page ${p} failed after ${RETRY.FETCH} attempts:`, lastErr?.message ?? lastErr);
                    if (write) write(text, { extra: `⚠️ ${failed}` });
                    else setStatus(statusEl, `${label} ${text} · ⚠️ ${failed} skipped` + dots());
                    await sleep(Math.max(15, DELAY.HISTORY_PAGE - 20));
                    continue;
                }
                break; // No __NEXT_DATA__ / no listing on this page: real end.
            }
            const search = nd?.props?.pageProps?.mainColumnData?.advancedTitleSearch;
            const edges = search?.edges ?? [];
            if (!edges.length) { p--; break; }
            parseEdges(edges, set);
            if (!search?.pageInfo?.hasNextPage) break;
            await sleep(Math.max(15, DELAY.HISTORY_PAGE - 20));
        }
        if (channel) {
            const done = Math.max(1, Math.min(p - 1, RETRY.PAGES));
            const tail = failed ? `⚠️ ${failed}` : count();
            channelWriter(statusEl, channel)(`${t('page')} ${done}`, { extra: tail });
            finishChannel(statusEl, channel, failed === 0 && (set?.size ?? 0) > 0, true);
        }
        if (failed) {
            console.warn(`[mrs] ${label}: ${failed} page(s) skipped — the resulting list may be incomplete`);
        }
        return failed;
    }

    async function getIMDbHistory(statusEl) {
        if (imdbHistory) return imdbHistory;
        setTitle(statusEl, t('lblHistory'));
        const uid = getIMDbUid();
        if (!uid) {
            setStatus(statusEl, t('imdbUserIdNotFound'));
            return imdbHistory = { rated: new Set(), watched: new Set() };
        }
        const rated = new Set(), watched = new Set();
        // Two independent listings, two independent rows: fetching them one
        // after the other doubled the wait before the first film was imported.
        const [f1, f2] = await Promise.all([
            scanIMDb(uid, (u, p) => `https://www.imdb.com/user/${u}/ratings/?page=${p}`, t('ratings'), statusEl, rated, 'imdbHistRated'),
            scanIMDb(uid, (u, p) => `https://www.imdb.com/user/${u}/watchhistory/?my_ratings=exclude&page=${p}`, t('watchHistory'), statusEl, watched, 'imdbHistWatched'),
        ]);
        const failed = (f1 || 0) + (f2 || 0);
        // Keep the warning visible until the next status update: a silently
        // truncated history looks like a bug to the user.
        if (failed) setStatus(statusEl, `⚠️ ${failed} page(s) skipped — exported list may be incomplete`);
        return imdbHistory = { rated, watched, failed };
    }

    const IMDB_GQL = 'https://api.graphql.imdb.com/';
    const GQL_RATE = `mutation RateTitle($titleId:ID!,$rating:Int!){rateTitle(input:{titleId:$titleId,rating:$rating}){rating{value}}}`;
    const GQL_WATCH = `mutation AddWatched($titleId:ID!){addWatchedTitle(titleId:$titleId){success}}`;
    const GQL_CREATE_LIST = `mutation CreateList($input: CreateListInput!){createList(input:$input){listId __typename}}`;
    const GQL_ADD_TO_LIST = `mutation AddItemToList($input: AddItemToListInput!){addItemToList(input:$input){listId __typename}}`;
    const IMDB_TITLE_QUERY = `query GetTitleMetadata($tConst: ID!) {
  title(id: $tConst) {
    titleText { text }
    originalTitleText { text }
    releaseYear { year }
    runtime { seconds }
    genres { genres { text } }
    userRating { value }
    principalCredits {
      category { id text }
      credits { name { nameText { text } } }
    }
    akas(first: 10) { edges { node { text } } }
  }
}`;

    async function imdbGql(query, variables) {
        for (let i = 1; i <= RETRY.GQL; i++) {
            try {
                const r = await fetchT(IMDB_GQL, 10000, {
                    method: 'POST',
                    // IMDb's GraphQL gateway answers 403 when Origin/Referer are
                    // missing, which used to fake an "API unavailable" warning.
                    headers: {
                        'Content-Type': 'application/json',
                        'Origin': 'https://www.imdb.com',
                        'Referer': 'https://www.imdb.com/',
                    },
                    credentials: 'include',
                    body: JSON.stringify({ query, variables }),
                });
                if (!r) { adjDelay(imdbGqlDelay, 'error'); continue; }
                if (r.status === 429) {
                    const ra = parseRetryAfter(r.responseHeaders);
                    if (ra) { await sleep(ra); }
                    else { adjDelay(imdbGqlDelay, '429'); await sleep(imdbGqlDelay.val * 1.5); }
                    continue; }
                const json = await r.json().catch(() => ({}));
                adjDelay(imdbGqlDelay, json?.errors ? '429' : 'ok', 200);
                return json;
            } catch { adjDelay(imdbGqlDelay, 'error'); }
            if (i < RETRY.GQL) await sleep(imdbGqlDelay.val * 1.6);
        }
        return null;
    }

    let __imdbFavouritesListId = null;
    async function getIMDbFavouritesList() {
        if (__imdbFavouritesListId) return __imdbFavouritesListId;
        const uid = getIMDbUid();
        if (uid) {
            try {
                const r = await fetchT(`https://www.imdb.com/user/${uid}/lists`);
                if (r?.ok) {
                    const html = await r.text();
                    // Method 1: data-testid="list-name" (standard IMDb)
                    const blocks = [...html.matchAll(/list\/(ls\d+)[^>]*>[\s\S]*?data-testid="list-name"[^>]*>([^<]+)</g)];
                    for (const [, id, name] of blocks) {
                        if (/favou?rites/i.test(name.trim())) {
                            __imdbFavouritesListId = id;
                            DEBUG && console.log(`[mrs] IMDb found Favorites list (data-testid): ${id}`);
                            return id;
                        }
                    }
                    // Method 2: fallback — find all list links and check surrounding text
                    const listLinks = [...html.matchAll(/href=['"]\/list\/(ls\d+)(?:\/[^'"]*)?['"]/g)];
                    for (const match of listLinks) {
                        const id = match[1];
                        const ctxStart = Math.max(0, match.index - 300);
                        const ctx = html.substring(ctxStart, match.index + 300);
                        if (/favou?rites/i.test(ctx)) {
                            __imdbFavouritesListId = id;
                            DEBUG && console.log(`[mrs] IMDb found Favorites list (context fallback): ${id}`);
                            return id;
                        }
                    }
                }
            } catch (e) { console.warn('[mrs] IMDb list scrape error:', e.message); }
        }
        return null;
    }
    async function getOrCreateIMDbFavouritesList() {
        if (__imdbFavouritesListId) return __imdbFavouritesListId;
        // Check persistent cache first — once found/created, never search again
        try {
            const cached = GM_getValue('mrs_imdb_fav_list', null);
            if (cached) {
                __imdbFavouritesListId = cached;
                return cached;
            }
        } catch (e) { /* ignore */ }
        const lid = await dedupeFetch('imdbCreateFavList', async () => {
            const existing = await getIMDbFavouritesList();
            if (existing) {
                try { GM_setValue('mrs_imdb_fav_list', existing); } catch (e) { /* ignore */ }
                return existing;
            }
            const j = await imdbGql(GQL_CREATE_LIST, {
                input: { name: 'Favorites', listDescription: 'My favorite movies', allowDuplicates: false, listType: 'TITLES', visibility: 'PRIVATE' }
            });
            const newLid = j?.data?.createList?.listId ?? null;
            if (newLid) {
                try { GM_setValue('mrs_imdb_fav_list', newLid); } catch (e) { /* ignore */ }
            }
            return newLid;
        });
        if (lid) __imdbFavouritesListId = lid;
        return lid;
    }

    let __imdbFavCache = null;
    async function getIMDbFavCache(listId) {
        if (__imdbFavCache && __imdbFavCache.listId === listId) return __imdbFavCache;
        __imdbFavCache = await dedupeFetch(`imdbFavCache:${listId}`, async () => {
            const ids = new Set();
            for (let page = 1; page <= 10; page++) {
                const url = `https://www.imdb.com/list/${listId}/?page=${page}`;
                const r = await fetchT(url);
                if (!r?.ok) { DEBUG && console.log('[mrs] IMDb fav cache: HTTP error for', url); break; }
                const html = await r.text();
                // Method 1: data-const attributes (classic IMDb list items)
                const dataConsts = [...html.matchAll(/data-const="(tt\d+)"/g)];
                if (dataConsts.length > 0) {
                    const before = ids.size;
                    for (const m of dataConsts) ids.add(m[1]);
                    if (ids.size === before) break;
                } else {
                    // Method 2: /title/tt\d+/ links (full page — false positive risk is low on list pages)
                    const titleLinks = [...html.matchAll(/\/title\/(tt\d+)/g)];
                    if (titleLinks.length === 0) break;
                    const before = ids.size;
                    for (const m of titleLinks) ids.add(m[1]);
                    if (ids.size === before) break;
                }
                await sleep(250);
            }
            // Fallback: try GQL if HTML returned nothing
            if (ids.size === 0) {
                DEBUG && console.warn('[mrs] IMDb fav cache: HTML scraping found 0 items, trying GQL variants');
                // Try multiple GQL query structures — IMDb's internal schema varies
                const gqlVariants = [
                    { q: `query GetListTitles($listId: ID!, $limit: Int!) { list(listId: $listId) { listItems(limit: $limit) { listItem { item { id } } } } }`, v: { listId, limit: 10000 }, fn: d => d?.list?.listItems?.map(it => it?.listItem?.item?.id) },
                    { q: `query GetListTitles($listId: ID!, $first: Int!) { list(listId: $listId) { items(first: $first) { edges { node { ... on Title { id } } } } } }`, v: { listId, first: 10000 }, fn: d => d?.list?.items?.edges?.map(e => e?.node?.id) },
                    { q: `query GetListTitles($listId: ID!, $first: Int!) { list(listId: $listId) { items(first: $first) { nodes { id } } } } }`, v: { listId, first: 10000 }, fn: d => d?.list?.items?.nodes?.map(n => n?.id) },
                    { q: `query GetListTitles($listId: ID!, $limit: Int!) { list(listId: $listId) { items(limit: $limit) { item { id } } } } }`, v: { listId, limit: 10000 }, fn: d => d?.list?.items?.map(i => i?.item?.id) },
                    { q: `query GetListTitles($listId: ID!) { titleList(listId: $listId) { items { item { id } } } } }`, v: { listId }, fn: d => d?.titleList?.items?.map(i => i?.item?.id) },
                ];
                for (const gv of gqlVariants) {
                    const existing = await imdbGql(gv.q, gv.v);
                    const gqlIds = (gv.fn(existing?.data) ?? []).filter(Boolean);
                    if (gqlIds.length > 0) {
                        for (const id of gqlIds) ids.add(id);
                        DEBUG && console.log(`[mrs] IMDb fav cache: GQL variant found ${gqlIds.length} items`);
                        break;
                    }
                }
                if (ids.size === 0) {
                    DEBUG && console.warn('[mrs] IMDb fav cache: all GQL variants returned 0 items — duplicates may occur');
                }
            }
            return { listId, ids };
        });
        return __imdbFavCache;
    }

    async function applyIMDb(ttId, rating, rated, watched) {
        const hasR = rating != null && String(rating) !== '' && +rating >= 1 && +rating <= 10;
        let status = null;
        if (hasR) {
            const j = await imdbGql(GQL_RATE, { titleId: ttId, rating: +rating });
            if (j?.data?.rateTitle?.rating?.value) { rated.add(ttId); watched.add(ttId); status = 'rated'; }
        } else {
            const j = await imdbGql(GQL_WATCH, { titleId: ttId });
            if (j?.data?.addWatchedTitle?.success) { watched.add(ttId); status = 'watched'; }
        }
        return status;
    }

    // --- IndexedDB cache backend (async, non-blocking) ---
    // Replaces GM_setValue for large cache data — avoids UI freezes
    const _idb = (() => {
        let _db = null;
        const _ready = new Promise((resolve) => {
            try {
                const req = indexedDB.open('mrs_cache', 1);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('searchCache')) {
                        db.createObjectStore('searchCache');
                    }
                    if (!db.objectStoreNames.contains('filmCache')) {
                        db.createObjectStore('filmCache');
                    }
                };
                req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
                req.onerror = () => { console.warn('[mrs] IndexedDB open failed, falling back to GM_setValue'); resolve(null); };
            } catch (e) {
                console.warn('[mrs] IndexedDB not available, falling back to GM_setValue:', e.message);
                resolve(null);
            }
        });
        // Write a single entry to an object store (async, non-blocking)
        async function put(store, key, value) {
            const db = await _ready;
            if (!db) return;
            try {
                const tx = db.transaction(store, 'readwrite');
                tx.objectStore(store).put(value, key);
                await new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
            } catch (e) { /* ignore — in-memory cache is primary */ }
        }
        // Bulk write all entries from a Map to an object store
        async function putAll(store, map) {
            const db = await _ready;
            if (!db) throw new Error('IndexedDB unavailable'); // triggers flush() .catch() fallback
            const tx = db.transaction(store, 'readwrite');
            const os = tx.objectStore(store);
            for (const [k, v] of map) os.put(v, k);
            await new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
        }
        // Read all entries from an object store into a Map
        async function getAll(store) {
            const db = await _ready;
            if (!db) return null;
            try {
                const tx = db.transaction(store, 'readonly');
                return await new Promise((resolve) => {
                    const os = tx.objectStore(store);
                    const result = new Map();
                    const cursorReq = os.openCursor();
                    cursorReq.onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (cursor) { result.set(cursor.key, cursor.value); cursor.continue(); }
                        else resolve(result);
                    };
                    cursorReq.onerror = () => resolve(null);
                });
            } catch (e) { return null; }
        }
        // Clear an object store
        async function clear(store) {
            const db = await _ready;
            if (!db) return;
            try {
                const tx = db.transaction(store, 'readwrite');
                tx.objectStore(store).clear();
                await new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
            } catch (e) { /* ignore */ }
        }
        // Delete a single entry
        async function del(store, key) {
            const db = await _ready;
            if (!db) return;
            try {
                const tx = db.transaction(store, 'readwrite');
                tx.objectStore(store).delete(key);
                await new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
            } catch (e) { /* ignore */ }
        }
        return { put, putAll, getAll, clear, del, ready: _ready };
    })();

    // --- Search result cache (in-memory Map + IndexedDB persist) ---
    const _memCache = new Map();
    const _memCacheTTL = 7 * 24 * 60 * 60 * 1000;
    // Hydrate from IndexedDB (async, non-blocking) + migrate from GM_getValue if needed
    (async () => {
        // Try IndexedDB first
        const idbData = await _idb.getAll('searchCache');
        if (idbData && idbData.size > 0) {
            const now = Date.now();
            for (const [k, v] of idbData) {
                if (v && v.value != null && now - v.ts <= _memCacheTTL) _memCache.set(k, v);
            }
            return;
        }
        // Migration: read old GM_getValue data and migrate to IndexedDB
        try {
            const raw = GM_getValue('mrs_search_cache', null);
            if (raw) {
                const disk = JSON.parse(raw);
                const now = Date.now();
                const toMigrate = new Map();
                for (const [k, v] of Object.entries(disk)) {
                    if (v && v.value != null && now - v.ts <= _memCacheTTL) {
                        _memCache.set(k, v);
                        toMigrate.set(k, v);
                    }
                }
                if (toMigrate.size > 0) await _idb.putAll('searchCache', toMigrate);
                // Clear old GM storage after successful migration
                try { GM_deleteValue('mrs_search_cache'); } catch (e) { /* ignore */ }
            }
        } catch (e) { console.warn("[mrs] searchCache migration error:", e?.message ?? e); }
    })();
    const searchCache = {
        get(key) {
            const entry = _memCache.get(key);
            if (entry === undefined) return undefined;
            if (Date.now() - entry.ts > _memCacheTTL) { _memCache.delete(key); return undefined; }
            return entry.value;
        },
        set(key, value) {
            _memCache.set(key, { ts: Date.now(), value });
            if (_memCache.size > 3000) {
                const entries = [..._memCache.entries()];
                entries.sort((a, b) => a[1].ts - b[1].ts);
                for (let i = 0; i < entries.length - 2500; i++) _memCache.delete(entries[i][0]);
            }
        },
        flush() {
            // Async write to IndexedDB — no JSON.stringify, no UI freeze
            _idb.putAll('searchCache', _memCache).catch(() => {
                // Fallback to GM_setValue if IndexedDB failed
                try { GM_setValue('mrs_search_cache', JSON.stringify(Object.fromEntries(_memCache))); } catch (e) { /* ignore */ }
            });
        }
    };
    // --- Persistent film detail cache (in-memory Map + IndexedDB persist) ---
    const _filmCache = new Map();
    const _filmCacheTTL = 30 * 24 * 60 * 60 * 1000; // 30 days
    // Hydrate from IndexedDB (async, non-blocking) + migrate from GM_getValue if needed
    (async () => {
        const idbData = await _idb.getAll('filmCache');
        if (idbData && idbData.size > 0) {
            const now = Date.now();
            for (const [k, v] of idbData) {
                if (v && v.value != null && now - v.ts <= _filmCacheTTL) _filmCache.set(k, v);
            }
            return;
        }
        // Migration from old GM_getValue storage
        try {
            const raw = GM_getValue('mrs_film_cache', null);
            if (raw) {
                const disk = JSON.parse(raw);
                const now = Date.now();
                const toMigrate = new Map();
                for (const [k, v] of Object.entries(disk)) {
                    if (v && v.value != null && now - v.ts <= _filmCacheTTL) {
                        _filmCache.set(k, v);
                        toMigrate.set(k, v);
                    }
                }
                if (toMigrate.size > 0) await _idb.putAll('filmCache', toMigrate);
                try { GM_deleteValue('mrs_film_cache'); } catch (e) { /* ignore */ }
            }
        } catch (e) { /* ignore */ }
    })();
    const filmDetailCache = {
        get(key) {
            const entry = _filmCache.get(key);
            if (entry === undefined) return undefined;
            if (Date.now() - entry.ts > _filmCacheTTL) { _filmCache.delete(key); return undefined; }
            return entry.value;
        },
        set(key, value) {
            _filmCache.set(key, { ts: Date.now(), value });
            if (_filmCache.size > 5000) {
                const entries = [..._filmCache.entries()];
                entries.sort((a, b) => a[1].ts - b[1].ts);
                for (let i = 0; i < entries.length - 4000; i++) _filmCache.delete(entries[i][0]);
            }
        },
        flush() {
            // Async write to IndexedDB — no JSON.stringify, no UI freeze
            _idb.putAll('filmCache', _filmCache).catch(() => {
                // Fallback to GM_setValue if IndexedDB failed
                try { GM_setValue('mrs_film_cache', JSON.stringify(Object.fromEntries(_filmCache))); } catch (e) { /* ignore */ }
            });
        }
    };
    async function searchIMDbSuggest(title) {
        const cacheKey = `imdbSuggest:${normTitle(title)}`;
        return dedupeFetch(cacheKey, async () => {
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const rawFirst = (title[0] || 'a').toLowerCase();
                    const firstLetter = encodeURIComponent(CYR[rawFirst.toUpperCase()] ? (CYR[rawFirst.toUpperCase()] || rawFirst).toLowerCase() : rawFirst);
                    const r = await fetchT(`https://sg.media-imdb.com/suggests/${firstLetter}/${encodeURIComponent(title)}.json`, 5000);
                    if (!r) { await sleep(300 + attempt * 400); continue; }
                    if (r.status === 429) { await sleep(300 + attempt * 400); continue; }
                    if (!r.ok) {
                        if (r.status === 404) return [];
                        if (attempt < 2) { await sleep(500 + attempt * 500); continue; }
                        return [];
                    }
                    const text = await r.text();
                    // The JSONP payload always starts with '({"d"'. A naive indexOf('(') breaks on titles
                    // with parens ("The Human Centipede (First Sequence)"), and lastIndexOf('(') breaks on
                    // image URLs inside the payload that contain parens (e.g. "..._V1_(2016).jpg").
                    const jsonStart = text.indexOf('({"d"');
                    if (jsonStart === -1) return []; // e.g. Cyrillic queries return percent-encoded garbage
                    let jsonText = text.slice(jsonStart + 1).trim();
                    if (jsonText.endsWith(')')) jsonText = jsonText.slice(0, -1);
                    if (jsonText.endsWith(';')) jsonText = jsonText.slice(0, -1);
                    if (!jsonText.startsWith('{')) return [];
                    const data = JSON.parse(jsonText);
                    return (data.d || []).map((item, idx) => {
                        if (!item.id?.startsWith('tt')) return null;
                        return {
                            ttId: item.id,
                            title: item.l || '',
                            titleOrig: item.l || '',
                            year: String(item.y || ''),
                            type: item.qid || item.q || '',
                            suggestRank: idx,
                        };
                    }).filter(Boolean);
                } catch (e) {
                    if (attempt < 2) { await sleep(300 + attempt * 400); continue; }
                    console.warn('[mrs] IMDb suggest error:', e.message);
                    return [];
                }
            }
            console.warn('[mrs] IMDb suggest exhausted retries for:', title);
            return [];
        });
    }

    // Short-lived negative cache: avoids re-searching the same missing title
    // during repeated imports without poisoning results for long.
    const _imdbNeg = new Map();
    const IMDB_NEG_TTL = 6 * 60 * 60 * 1000;

    async function searchIMDbFallback(title, year, deep = false, allTitles = [], src = {}) {
        const cacheKey = `imdb:${normTitle(title)}|${year || ''}|${deep ? '1' : '0'}|${allTitles.slice(0, 3).map(normTitle).join(',')}`;
        const cached = searchCache.get(cacheKey);
        if (cached !== undefined) return cached;
        const negTs = _imdbNeg.get(cacheKey);
        if (negTs && Date.now() - negTs < IMDB_NEG_TTL) return null;
        return dedupeFetch(cacheKey, async () => {
            // --- Phase 1: Suggest API (fast JSON, ~200ms) ---
            // Try the primary title first, then transliteration (for Cyrillic) and
            // non-Cyrillic alt titles (e.g. "Your Name" for "Твоё имя").
            const suggestQueries = [title];
            if (hasCyr(title)) suggestQueries.push(translit(title));
            if (Array.isArray(allTitles)) {
                for (const alt of allTitles) {
                    if (alt && alt !== title && alt.length >= 3) suggestQueries.push(alt);
                }
            }
            const suggestCandidates = [];
            const seenSugg = new Set();
            // The Suggest endpoint is independent per spelling, and each call is
            // ~500 ms of pure latency. Sequentially probing 4 spellings for every
            // unresolved title was the single largest cost of an IMDb import.
            const uniqQueries = [...new Set(suggestQueries)].slice(0, 4);
            const suggestLists = await Promise.all(uniqQueries.map(q => searchIMDbSuggest(q).catch(() => [])));
            for (const cands of suggestLists) {
                for (const c of cands) {
                    if (seenSugg.has(c.ttId)) continue;
                    seenSugg.add(c.ttId);
                    suggestCandidates.push(c);
                }
            }
            // Rank per suggestion query (0 = top result). Only trust top-1 + year when title is unrelated.
            let best = null;
            for (const cand of suggestCandidates) {
                const score = scoreCandidate({ title, titleOrig: title, year, type: src.type || '', genres: src.genres || '', allTitles }, cand);
                const conf = confidenceLabel(score);
                if (conf === 'high') {
                    DEBUG && console.log(`[mrs] IMDb suggest HIGH: "${title}" (${year}) → ${cand.ttId} score=${score.toFixed(2)}`);
                    if (!year || !cand.year || yearsMatch(cand.year, year)) {
                        const result = { ...cand, score, confidence: conf };
                        searchCache.set(cacheKey, result);
                        return result;
                    }
                }
                if (!best || score > best.score) best = { ...cand, score, confidence: conf };
            }

            // --- Phase 2: HTML fallback ---
            // This is the slow path: one full search page per title variant.
            // Cap it in normal mode and stop as soon as a confident match appears.
            const variants = getTitleVariants(title, allTitles);
            const qs = [...new Set([...variants, ...(hasCyr(title) ? [translit(title)] : [])])];
            const maxQueries = deep ? qs.length : Math.min(qs.length, 3);

            for (const q of qs.slice(0, maxQueries)) {
                if (imdbHtmlBreaker.open) break;
                const r = await fetchT(`https://www.imdb.com/find/?q=${encodeURIComponent(q)}&s=tt`);
                if (!r || r.status === 429 || !r.ok) {
                    // 5xx/timeouts used to be a silent `continue`, which burned
                    // a timeout per variant and — worse — turned a broken search
                    // into "not found", losing the rating. Count them, and if
                    // the endpoint is systemically down stop paying for it for
                    // the rest of the run; a 429 still backs off and retries.
                    if (r?.status === 429) { await sleep(1200 + Math.random() * 800); continue; }
                    if (imdbHtmlBreaker.fail()) {
                        console.warn('[mrs] IMDb HTML search disabled for this run after repeated failures');
                        break;
                    }
                    continue;
                }
                imdbHtmlBreaker.ok();
                const html = await r.text();
                const ids = [...new Set([...html.matchAll(/\/title\/(tt\d+)/g)].map(m => m[1]))];
                if (!ids.length) continue;

                for (const id of ids.slice(0, 5)) {
                    let cand = null;
                    for (const [k, v] of titleMap) {
                        if (v.ttId === id) {
                            cand = { ttId: id, title: k, titleOrig: '', year: v.year, type: '' };
                            break;
                        }
                    }
                    if (!cand) {
                        const idx = html.indexOf(id);
                        const context = html.substring(Math.max(0, idx - 300), idx + 300);
                        const yrMatch = context.match(/\b(19|20)\d{2}\b/);
                        const nameMatch = context.match(/>([^<]{3,100})</);
                        const mainTitle = nameMatch ? nameMatch[1].trim() : '';
                        let origTitle = '';
                        const origPattern = context.match(/[—–\-|]\s*([^<]{2,200}?)\s*\(original\s*title\)/i);
                        if (origPattern) {
                            origTitle = origPattern[1].trim();
                        } else if (mainTitle && nameMatch) {
                            const afterIdx = nameMatch.index + nameMatch[0].length;
                            const afterHtml = context.substring(afterIdx);
                            const textFrags = afterHtml.split(/<[^>]+>/).map(s => s.trim()).filter(Boolean);
                            for (const frag of textFrags) {
                                const fragClean = frag.replace(/\s*\(original\s*title\)\s*/i, '').trim();
                                const clean = fragClean.replace(/[,;•–—()]+/g, ' ').trim();
                                if (clean && clean !== mainTitle && clean.length > 3 && !/^\d{4}$/.test(clean) && !clean.includes(mainTitle) && !mainTitle.includes(clean)) {
                                    origTitle = clean;
                                    break;
                                }
                            }
                        }
                        cand = {
                            ttId: id,
                            title: mainTitle,
                            titleOrig: origTitle,
                            year: yrMatch ? yrMatch[0] : '',
                            type: '',
                        };
                    }
                    const score = scoreCandidate({ title, titleOrig: title, year, type: src.type || '', genres: src.genres || '', allTitles }, cand);
                    const conf = confidenceLabel(score);
                    if (conf === 'high') {
                        DEBUG && console.log(`[mrs] IMDb fallback HIGH: "${title}" (${year}) → ${id} score=${score.toFixed(2)}`);
                        if (!year || !cand.year || yearsMatch(cand.year, year)) {
                            const result = { ...cand, score, confidence: conf };
                            searchCache.set(cacheKey, result);
                            return result;
                        }
                    }
                    if (!best || score > best.score) best = { ...cand, score, confidence: conf };
                }
                if (best?.confidence === 'high' && (!year || !best.year || yearsMatch(best.year, year))) break;
            }

            if (best) {
                DEBUG && console.log(`[mrs] IMDb fallback best: "${title}" (${year}) → ${best.ttId} score=${best.score.toFixed(2)} conf=${best.confidence}`);
                const yearOk = !best.year || !year || yearsMatch(best.year, year);
                if (yearOk && (deep ? best.confidence !== 'low' || best.score >= 350 : (best.confidence === 'high' || best.confidence === 'medium' || (best.confidence === 'low' && best.score >= 350)))) {
                    searchCache.set(cacheKey, best);
                    return best;
                }
            }
            // Try matching the parent series for episode titles
            const parent = extractSeriesParent(title);
            if (parent && parent !== title) {
                DEBUG && console.log(`[mrs] IMDb trying series parent: "${parent}" for "${title}"`);
                const parentResult = await searchIMDbFallback(parent, year, deep, allTitles, src);
                if (parentResult) searchCache.set(cacheKey, parentResult);
                else _imdbNeg.set(cacheKey, Date.now());
                return parentResult;
            }

            console.warn(`[mrs] IMDb search FAILED: "${title}" (${year})`);
            _imdbNeg.set(cacheKey, Date.now());
            return null;
        });
    }

    async function resolveIMDb(title, year, deep, allTitles = [], src = {}) {
        const cached = lookupTitle(title, year);
        if (cached) {
            return { ttId: cached, score: 0.95, confidence: 'high' };
        }
        return searchIMDbFallback(title, year, deep, allTitles, src);
    }

    async function imdbApplyPhase(resolved, rated, watched, statusEl, mode, total, opts = {}) {
        Object.assign(gqlProbe, makeProbe(20, PLATFORM_MAX.imdb));
        imdbGqlDelay.val = DELAY.GQL_INIT;
        let r = 0, w = 0, fav = 0, sk = 0, nf = 0, fa = 0;
        const missed = [];
        const toApply = [];
        const skippedFavs = [];

        for (const { item, ttId } of resolved) {
            if (!ttId) { nf++; missed.push({ ...item, error: t('errorNotFoundIMDb') }); continue; }
            const hasR = item.rating != null && String(item.rating) !== '' && +item.rating >= 1 && +item.rating <= 10;
            if (mode !== 'replace' && (rated.has(ttId) || (watched.has(ttId) && !hasR))) {
                sk++;
                if (opts.importFavorites && item.favorite) skippedFavs.push({ item, ttId });
                continue;
            }
            toApply.push({ item, ttId });
        }

        let cur = 0;
        const chApply = channelWriter(statusEl, 'imdbApply', t('lblApply'));
        while (cur < toApply.length) {
            const slice = toApply.slice(cur, cur + gqlProbe.c);
            const to = Math.min(cur + gqlProbe.c, toApply.length);
            chApply(`${cur + 1}–${to}/${toApply.length}`, { current: to, total: toApply.length });
            const t0 = Date.now();
            const res = await asyncPool(gqlProbe.c, slice, ({ item, ttId }) => applyIMDb(ttId, item.rating, rated, watched));
            let fail = 0;
            res.forEach((x, j) => {
                const s = x.status === 'fulfilled' ? x.value : null;
                const item = slice[j].item;
                if (s === 'rated') r++;
                else if (s === 'watched') w++;
                else { fa++; missed.push({ ...item, error: t('errorApi') }); fail++; }
            });
            cur = to; // slice length, not the post-probe value: see kpApply
            const elapsed = Date.now() - t0;
            // Only a mostly-failing batch means the endpoint is overloaded; a
            // single rejected write must not cut concurrency for the rest of the run.
            fail / slice.length >= 0.5 ? probeFail(gqlProbe) : probeOk(gqlProbe, elapsed);
            // No artificial sleep — asyncPool naturally paces requests
        }
        if (toApply.length) chApply(`${toApply.length}/${toApply.length}`, { current: toApply.length, total: toApply.length });
        finishChannel(statusEl, 'imdbApply', fa === 0, true);

        // Favorites: one parallel phase covering both the films rated just now
        // and those skipped because they were already rated. The old code added
        // the heart as a second serial GQL call inside every apply worker (plus
        // a one-at-a-time loop over skipped films), which for a big library was
        // a full extra round-trip per favorite.
        const favIds = [];
        if (opts.importFavorites) {
            for (const { item, ttId } of toApply) if (item.favorite) favIds.push(ttId);
            for (const { ttId } of skippedFavs) favIds.push(ttId);
        }
        const uniqueFavs = [...new Set(favIds)];
        if (uniqueFavs.length) {
            const listId = await getOrCreateIMDbFavouritesList();
            if (listId) {
                const chFav = channelWriter(statusEl, 'imdbFavorites', t('lblFavorites'));
                let favDone = 0;
                let favFails = 0;
                const favReport = () => chFav(`${favDone}/${uniqueFavs.length}`, { current: favDone, total: uniqueFavs.length });
                favReport();
                try {
                    const cache = await getIMDbFavCache(listId);
                    const todo = uniqueFavs.filter(id => !cache.ids.has(id));
                    favDone = uniqueFavs.length - todo.length;
                    favReport();
                    await asyncPool(8, todo, async ttId => {
                        const j = await imdbGql(GQL_ADD_TO_LIST, { input: { listId, item: { itemElementId: ttId } } });
                        if (j?.data?.addItemToList?.listId) {
                            cache.ids.add(ttId);
                            fav++;
                            DEBUG && console.log(`[mrs] IMDb favorite OK: ${ttId}`);
                        } else favFails++;
                        favDone++;
                        if (favDone % 10 === 0 || favDone === uniqueFavs.length) favReport();
                    });
                } catch (e) { console.warn(`[mrs] IMDb favorite error:`, e.message); }
                favReport();
                finishChannel(statusEl, 'imdbFavorites', favFails === 0, true);
            }
        }

        return { rated: r, watched: w, favorites: fav, skipped: sk, notFound: nf, failed: fa, missed };
    }

    async function imdbProcess(items, rated, watched, statusEl, deep, mode, opts = {}) {
        Object.assign(imdbProbe, makeProbe(30, PLATFORM_MAX.imdb));
        const resolved = [];
        let cur = 0, done = 0, found = 0, lastReport = 0;
        // One row for the whole search phase. It must fill to completion while
        // the apply phase below appends its own row.
        const chSearch = channelWriter(statusEl, 'imdbSearch', t('lblSearch'));
        // Report steady per-title progress, not just once per batch. Users see a
        // frozen "1–20/6790" otherwise, because a batch can take minutes.
        const report = (force) => {
            const now = Date.now();
            if (!force && now - lastReport < 250) return;
            lastReport = now;
            const to = Math.max(done, 1);
            chSearch(`${to}/${items.length}`, { current: to, total: items.length, extra: `✓ ${found}` });
        };
        // 15 s is already several times the real worst case (3 suggest spellings
        // + 3 HTML fallbacks); the old 30–60 s budget meant one hung request held
        // a whole batch hostage.
        const itemBudget = deep ? 45000 : 15000;
        while (cur < items.length) {
            const chunkSize = Math.max(1, imdbProbe.c);
            const slice = items.slice(cur, cur + chunkSize);
            report(true);
            const t0 = Date.now();
            const res = await asyncPool(chunkSize, slice, async i => {
                let result;
                if (i.ttId && /^tt\d+$/.test(i.ttId)) {
                    result = { ttId: i.ttId, score: 1.0, confidence: 'high' };
                } else {
                    result = await withTimeout(resolveIMDb(i.title, i.year, deep, i.allTitles || [], i), itemBudget, null);
                }
                done++;
                if (result?.ttId && result.confidence !== 'low') found++;
                report(false);
                return result;
            });
            let errs = 0;
            res.forEach((r, j) => {
                const result = r.status === 'fulfilled' ? r.value : null;
                if (r.status === 'rejected') errs++;
                const ttId = result?.ttId ?? null;
                const confidence = result?.confidence ?? 'low';
                if (!ttId || confidence === 'low') {
                    resolved.push({ item: slice[j], ttId: null });
                } else {
                    resolved.push({ item: slice[j], ttId });
                }
            });
            cur += chunkSize;
            const elapsed = Date.now() - t0;
            // A title that simply has no IMDb entry is a normal outcome and must
            // never throttle the run; only thrown (network/endpoint) errors mean
            // the gateway is pushing back.
            errs / slice.length >= 0.5 ? probeFail(imdbProbe) : probeOk(imdbProbe, elapsed);
            report(true);
        }
        chSearch(`${items.length}/${items.length}`, { current: items.length, total: items.length, extra: `✓ ${found}` });
        finishChannel(statusEl, 'imdbSearch', found > 0, true);
        return imdbApplyPhase(resolved, rated, watched, statusEl, mode, items.length, opts);
    }

    function renderIMDbResult(result, statusEl, rated, watched, mode) {
        const lbl = mode === 'replace' ? t('replaceMode') : '';
        const imdbPairs = [
            [t('rated'), result.rated],
            [t('watched'), result.watched],
            [t('skipped'), result.skipped],
            [t('notFound'), result.notFound],
            [t('failed'), result.failed],
        ];
        if (result.favorites != null) imdbPairs.push([t('favorites'), result.favorites]);
        renderResult(statusEl, t('done', { mode: lbl }), imdbPairs, result.notFound === 0 && result.failed === 0 ? t('allImported') : null, result.elapsedMs);
        if (result.missed.length) {
            downloadCSV(buildCSV(result.missed), 'imdb_missed.csv');
            const btn = Object.assign(document.createElement('button'), {
                id: 'mrs-retry',
                className: 'mrs-btn mrs-btn--secondary',
                textContent: t('deepSearchBtn', { count: result.missed.length }),
            });
            btn.addEventListener('click', async () => {
                beginRun(statusEl, t('deepSearch', { platform: 'IMDb' }));
                const r2 = await imdbProcess(result.missed, rated, watched, statusEl, true, mode, getImportOptions());
                renderIMDbResult(r2, statusEl, rated, watched, mode);
            });
            const btnWrap = document.createElement('div');
            btnWrap.style.padding = '0 18px 14px';
            btnWrap.appendChild(btn);
            statusEl.appendChild(btnWrap);
        }
    }

    // Health-check: confirm IMDb GraphQL answers before a bulk operation.
    // A failure here is NOT fatal — the export path itself has its own retries,
    // so this only logs a hint instead of alarming the user.
    async function imdbHealthCheck() {
        try {
            const json = await imdbGql('query { title(id: "tt0111161") { id titleText { text } } }', {});
            return !!(json?.data?.title);
        } catch (e) { return false; }
    }

    async function performIMDbExport(statusEl) {
        const el = statusEl;
        beginRun(el, t('profileDetect', { platform: 'IMDb' }));
        const uid = getIMDbUid();
        if (!uid) throw new Error(t('imdbUserIdNotFound'));
        // Optional warm-up probe. IMDb's gateway intermittently throttles the
        // first request of a session; that is not an error worth reporting.
        imdbHealthCheck().then(ok => { if (!ok) console.info('[mrs] IMDb probe skipped — export continues with per-request retries'); });
        resetTitleMap(); imdbHistory = null;

        const HASH = '7c4e0771d67f21fc27fd44fc46d49cc589225a9c5e63e51cc0b8d42f39ee99cc';
        const seen = new Set();

        // Two independent listings, so two rows that fill side by side. IMDb
        // does not expose the page count up front: the row shows the page being
        // fetched and the number of titles already collected.
        const scan = async (urlFn, label, channel) => {
            const write = channelWriter(el, channel, label);
            const items = [];
            for (let p = 1; p <= RETRY.PAGES; p++) {
                write(`${t('page')} ${p}`, { extra: `${items.length} ${t('movies')}` });
                const nd = await fetchNextData(urlFn(uid, p));
                if (!nd) break;
                const s = nd?.props?.pageProps?.mainColumnData?.advancedTitleSearch;
                const edges = s?.edges ?? [];
                if (!edges.length) break;
                for (const e of edges) {
                    const n = e?.node?.title ?? e?.node;
                    if (!n?.id?.startsWith('tt') || seen.has(n.id)) continue;
                    seen.add(n.id);
                    const typeTxt = (n?.titleType?.text || '').toLowerCase();
                    items.push({
                        titleRu: '',
                        titleOrig: n?.originalTitleText?.text ?? n?.titleText?.text ?? '',
                        type: typeTxt.includes('series') ? 'TvSeries' : 'Film',
                        ttId: n.id,
                        yearStart: String(n?.releaseYear?.year ?? ''),
                        yearEnd: String(n?.releaseYear?.endYear ?? ''),
                        rating: null,
                    });
                }
                if (!s?.pageInfo?.hasNextPage) break;
                await sleep(DELAY.HISTORY_PAGE);
            }
            write(`${t('page')} ${Math.max(1, p - 1)}`, { extra: `${items.length} ${t('movies')}` });
            finishChannel(el, channel, items.length > 0, true);
            return items;
        };

        // Parallelize ratings + watch history scanning
        const [rated, watched] = await Promise.all([
            scan((u, p) => `https://www.imdb.com/user/${u}/ratings/?page=${p}`, t('ratings'), 'imdbExportRatings'),
            scan((u, p) => `https://www.imdb.com/user/${u}/watchhistory/?my_ratings=exclude&page=${p}`, t('watchHistory'), 'imdbExportWatched'),
        ]);

        // Check if any data was found
        if (rated.length === 0 && watched.length === 0) {
            throw new Error(t('imdbNoData'));
        }

        // Fetch actual rating values in parallel batches
        const BATCH = 250;
        const batches = [];
        for (let i = 0; i < rated.length; i += BATCH) batches.push(rated.slice(i, i + BATCH).map(x => x.ttId));

        const results = await Promise.allSettled(batches.map(batch =>
            fetchT(IMDB_GQL, 30000, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Origin': 'https://www.imdb.com', 'Referer': 'https://www.imdb.com/' },
                credentials: 'include',
                body: JSON.stringify({
                    operationName: 'PersonalizedUserData',
                    variables: { locale: 'en-US', idArray: batch, includeUserData: true, includeWatchedData: true, location: { latLong: { lat: '55.75', long: '37.58' } }, fetchOtherUserRating: false },
                    extensions: { persistedQuery: { version: 1, sha256Hash: HASH } },
                }),
            })
        ));

        for (const r of results) {
            if (r.status === 'fulfilled' && r.value.ok) {
                const j = await r.value.json();
                for (const t of j?.data?.titles ?? []) {
                    const item = rated.find(x => x.ttId === t.id);
                    if (item && t?.userRating?.value != null) item.rating = t.userRating.value;
                }
            }
        }

        let favIds = new Set();
        try {
            const favListId = await getIMDbFavouritesList();
            if (favListId) {
                const j = await imdbGql(`query GetListTitles($listId: ID!, $limit: Int!) { list(listId: $listId) { listItems(limit: $limit) { listItem { item { id } } } } }`, { listId: favListId, limit: 10000 });
                const items = j?.data?.list?.listItems ?? [];
                for (const it of items) {
                    const id = it?.listItem?.item?.id;
                    if (id) favIds.add(id);
                }
            }
        } catch (e) { console.warn('[mrs] IMDb fetch favourites error:', e.message); }

        const allItems = [...rated, ...watched.map(i => ({ ...i, rating: 'w' }))];
        const itemMap = new Map(allItems.map(i => [i.ttId, i]));
        for (const ttId of favIds) {
            if (itemMap.has(ttId)) itemMap.get(ttId).favorite = true;
            else itemMap.set(ttId, { titleRu: '', titleOrig: '', allTitles: [], type: 'Film', ttId, yearStart: '', yearEnd: '', rating: '', favorite: true, src: 'imdb' });
        }

        // Fetch film details (titles + extended metadata) from IMDb film pages
        const uniqueItems = [...itemMap.values()];
        const chDetails = channelWriter(el, 'imdbDetails', t('lblDetails'));
        chDetails(`0/${uniqueItems.length}`, { current: 0, total: uniqueItems.length });
        const imdbRateLimit = makeRateLimiter(15);
        let imdbDetailsDone = 0;
        const titleResults = await asyncPool(25, uniqueItems, async i => {
            try {
                if (!i.ttId) return null;
                const cacheKey = 'imdb:' + i.ttId;
                const cached = filmDetailCache.get(cacheKey);
                if (cached) return cached;
                await imdbRateLimit();
                const result = await imdbFetchFilmDetailsHTML(i.ttId);
                if (result) filmDetailCache.set(cacheKey, result);
                return result;
            } finally {
                imdbDetailsDone++;
                if (imdbDetailsDone % 5 === 0 || imdbDetailsDone === uniqueItems.length) {
                    chDetails(`${imdbDetailsDone}/${uniqueItems.length}`, { current: imdbDetailsDone, total: uniqueItems.length });
                }
            }
        });
        titleResults.forEach((r, i) => {
            const item = uniqueItems[i];
            if (r.status === 'fulfilled' && r.value) {
                item.allTitles = [...new Set([item.titleOrig, item.titleRu, ...(item.allTitles || []), ...r.value.allTitles.map(decodeHtmlEntities)].filter(Boolean))];
                if (r.value.rating != null && item.rating == null) item.rating = r.value.rating;
                item.runtime = r.value.runtime;
                item.directors = r.value.directors;
                item.actors = r.value.actors;
                item.genres = r.value.genres;
                item.premiereDate = r.value.premiereDate;
            }
        });
        chDetails(`${uniqueItems.length}/${uniqueItems.length}`, { current: uniqueItems.length, total: uniqueItems.length });
        finishChannel(el, 'imdbDetails', imdbDetailsDone !== 0);

        filmDetailCache.flush();
        return buildCSV([...itemMap.values()].map(i => ({ ...i, allTitles: [...new Set([i.titleOrig, i.titleRu, ...(i.allTitles || [])].filter(Boolean))], src: 'imdb' })));
    }

    async function performIMDbImport(csvData, statusEl, mode, deep = false, opts = {}) {
        const items = parseCSV(csvData);
        if (!items.length) return setStatus(statusEl, t('csvEmpty'));
        imdbHistory = null;
        resetTitleMap();

        const uid = getIMDbUid();
        if (!uid) return setStatus(statusEl, t('imdbUserIdNotFound'));

        beginRun(statusEl, `${items.length} ${t('movies')}`);
        // Skip history scan if importing items without IMDb IDs (e.g. from Letterboxd)
        let rated, watched;
        ({ rated, watched } = await getIMDbHistory(statusEl));
        if (mode === 'replace') { rated = new Set(rated); watched = new Set(watched); }

        const shouldDeep = deep;
        const t0 = Date.now();
        const result = await imdbProcess(items, rated, watched, statusEl, shouldDeep, mode, opts);
        result.elapsedMs = Date.now() - t0;
        renderIMDbResult(result, statusEl, rated, watched, mode);
    }

    // ====================== LETTERBOXD MODULE ======================

    // Letterboxd has no public API — all writes go through their internal API v0.
    // Reading is done via HTML scraping (their site is server-rendered).
    // Key endpoints:
    //   Search: GET /s/autocompletefilm?q=...  → JSON {matches:[{film:{id,slug,name,releaseYear}}]}
    //   Film page: GET /film/:slug/            → contains data-film-id in DOM
    //   Log/rate: PATCH https://letterboxd.com/api/v0/me/rate/{LID}  → JSON body with rating (0.5–5.0, 0.5 increments)
    //   Add to watched: POST same endpoint with no rating field
    // CSRF: available as supermodelCSRF global JS variable, sent via X-CSRF-TOKEN header

    function getLBUsername() {
        // Primary: Letterboxd sets `person` global on every page for logged-in users
        try {
            if (typeof person !== 'undefined' && person?.loggedIn && person?.username) return person.username;
        } catch (e) { console.warn("[mrs] catch:", e?.message ?? e); }
        // Fallback: URL path (only works on profile pages)
        const m = location.pathname.match(/^\/([^/]+)\/?$/);
        const excluded = new Set(['films', 'lists', 'members', 'journal', 'search', 'activity', 'import', 'settings', 'create-account', 'sign-in', 'about', 'pro', 'apps', 'contact', 'legal', 'stats', 'year-in-review', 'gift-guide', 'welcome', 'crew', 'api-beta', 'podcast']);
        if (m && !excluded.has(m[1])) return m[1];
        // Fallback: nav link (may not exist since nav is now React)
        for (const sel of ['a.main-nav-account-link', 'a[href^="/"][class*="account"]', '.main-nav .person-link']) {
            const el = document.querySelector(sel);
            const um = el?.getAttribute('href')?.match(/^\/([^/]+)\/?$/);
            if (um && !excluded.has(um[1])) return um[1];
        }
        return null;
    }

    function getLBCsrf() {
        // Primary: supermodelCSRF is set as a global JS variable on every Letterboxd page
        try { if (typeof supermodelCSRF !== 'undefined' && supermodelCSRF) return supermodelCSRF; } catch (e) { console.warn("[mrs] catch:", e?.message ?? e); }
        // Fallback: window.csrf
        try { if (typeof window.csrf !== 'undefined' && window.csrf) return window.csrf; } catch (e) { console.warn("[mrs] catch:", e?.message ?? e); }
        // Fallback: cookie (may be HttpOnly, so often unreadable)
        try {
            const c = document.cookie.match(/\bcom\.xk72\.webparts\.csrf=([^;]+)/);
            if (c) return decodeURIComponent(c[1]);
        } catch (e) { console.warn("[mrs] catch:", e?.message ?? e); }
        // Fallback: DOM elements
        return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
            ?? document.querySelector('input[name="__csrf"]')?.value
            ?? null;
    }

    // Fast regex-based parsers for Letterboxd (replaces DOMParser, ~100x faster)
    // Updated for Letterboxd's React-based grid layout (2026)
    const LB_GRIDITEM_RE = /<li[^>]*class="[^"]*(?:griditem|poster-container)[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
    const LB_SLUG_RE = /data-(?:item|film)-slug="([^"]+)"/;
    const LB_NAME_RE = /data-item-name="([^"]+)"/;
    const LB_ITEM_UID_RE = /(?:data-item-uid="film:(\d+)"|data-film-id="(\d+)")/;
    const LB_RATED_RE = /class="[^"]*rated-(\d+)[^"]*"/;
    const LB_GRIDITEM_JSON_RE = /data-postered-identifier='([^']+)'/;
    const LB_DIARY_ROW_RE = /<tr[^>]*class="[^"]*diary-entry-row[^"]*"[^>]*>([\s\S]*?)<\/tr>/g;
    const LB_POSTER_LI_RE = /<li[^>]*>([\s\S]*?)<\/li>/g;
    const LB_DIARY_DATE_RE = /<td[^>]*class="[^"]*td-day[^"]*"[^>]*>[\s\S]*?(\d{4}\/\d{2}\/\d{2})/;
    const LB_TIME_DATETIME_RE = /<time[^>]+datetime="([^"]+)"/;
    const LB_PAGINATION_NEXT_RE = /<a[^>]*(?:class="[^"]*next[^"]*"|rel="next")[^>]*>/;

    async function fetchLBHtml(url) {
        for (let attempt = 0; attempt < 3; attempt++) {
            const r = await fetchT(url, 15000);
            if (!r) {
                await sleep(500 + attempt * 500);
                continue;
            }
            if (r.status === 429) {
                const ra = parseRetryAfter(r.responseHeaders);
                await sleep(ra || (1000 + attempt * 800));
                continue;
            }
            if (!r.ok) {
                if (r.status === 404) return null;
                // Detect Cloudflare challenge (403/503) — stop retrying with a warning
                if (r.status === 403 || r.status === 503) {
                    const body = await r.text().catch(() => '');
                    if (isCloudflareChallenge(r.status, body)) {
                        console.warn(`[mrs] Cloudflare challenge detected (${r.status}) for ${url} — stopping retries`);
                        return null;
                    }
                }
                await sleep(500 + attempt * 500);
                continue;
            }
            return await r.text();
        }
        return null;
    }

    function parseLBRatings(html) { return parseLBItems(html, 'grid'); }
    function parseLBDiary(html) { return parseLBItems(html, 'diary'); }
    const parseLBWatched = parseLBRatings;

    function parseLBItems(html, mode) {
        const results = [];
        let sources = [];
        if (mode === 'diary') {
            const diary = [...html.matchAll(LB_DIARY_ROW_RE)];
            if (diary.length) sources = diary.map(m => m[1]);
            else sources = [...html.matchAll(LB_GRIDITEM_RE)].map(m => m[1]);
        } else {
            sources = [...html.matchAll(LB_GRIDITEM_RE)].map(m => m[1]);
            if (!sources.length) sources = [...html.matchAll(LB_POSTER_LI_RE)].map(m => m[1]);
        }
        for (const liHtml of sources) {
            let slug = (liHtml.match(LB_SLUG_RE)?.[1] || '').replace(/^\/film\//, '').replace(/\/$/, '');
            if (!slug) {
                let fallbackFilmId = '';
                const jsonMatch3 = liHtml.match(LB_GRIDITEM_JSON_RE);
                if (jsonMatch3) {
                    try { const d3 = JSON.parse(jsonMatch3[1].replace(/&quot;/g, '"')); fallbackFilmId = d3?.uid?.replace('film:', '') ?? ''; } catch (e3) {}
                }
                if (!fallbackFilmId) {
                    const uidMatch3 = liHtml.match(LB_ITEM_UID_RE);
                    if (uidMatch3) fallbackFilmId = (uidMatch3[1] || uidMatch3[2] || '').replace('film:', '');
                }
                if (!fallbackFilmId) continue;
                slug = 'film:' + fallbackFilmId;
            }
            let filmId = '';
            const jsonMatch = liHtml.match(LB_GRIDITEM_JSON_RE);
            if (jsonMatch) {
                try { const d = JSON.parse(jsonMatch[1]); filmId = d?.uid?.replace('film:', '') ?? ''; } catch (e) { console.warn("[mrs] catch:", e?.message ?? e); }
            }
            if (!filmId) {
                const uidMatch = liHtml.match(LB_ITEM_UID_RE);
                filmId = uidMatch ? (uidMatch[1] || uidMatch[2] || '') : '';
            }
            const nameMatch = liHtml.match(LB_NAME_RE);
            const altMatch = liHtml.match(/<img[^>]*alt="([^"]+)"/);
            const rawName = (nameMatch ? nameMatch[1] : '') || (altMatch ? altMatch[1] : '');
            const yearMatch = rawName.match(/\((\d{4}(?:-\d{4})?)\)\s*$/);
            const title = yearMatch ? rawName.replace(/\s*\(\d{4}(?:-\d{4})?\)\s*$/, '').trim() : rawName;
            const year = yearMatch ? yearMatch[1] : '';
            const ratingMatch = liHtml.match(LB_RATED_RE);
            const rating = ratingMatch ? parseInt(ratingMatch[1], 10) : null;
            const dateMatch = liHtml.match(LB_DIARY_DATE_RE) ?? liHtml.match(LB_TIME_DATETIME_RE);
            const watchedDate = dateMatch ? dateMatch[1].replace(/\//g, '-').split('T')[0] : '';
            results.push({ slug, filmId, title, year, rating, watchedDate });
        }
        return results;
    }

    // Scrapes Letterboxd listing pages (ratings / diary / watched / likes).
    // Progress goes through `onProgress(done, total)` so the caller owns its own
    // status row. One scan per tab is cached for 10 minutes.
    async function lbScrapePages(username, pathFn, parseFn, pageSize = 200, onProgress = null) {
        const key = typeof pathFn === 'function' ? pathFn(username, 1) : null;
        if (key && lbPageCache.has(key)) {
            const hit = lbPageCache.get(key);
            if (Date.now() - hit.ts < 10 * 60 * 1000) {
                if (onProgress) onProgress(1, 1);
                return hit.entries;
            }
            lbPageCache.delete(key);
        }

        const byPage = new Map();
        const add = (p, items) => {
            if (!items?.length) return;
            if (!byPage.has(p)) byPage.set(p, []);
            const bucket = byPage.get(p);
            const seen = new Set(bucket.map(i => i.slug));
            for (const item of items) {
                if (!item.slug || seen.has(item.slug)) continue;
                seen.add(item.slug);
                bucket.push(item);
            }
        };
        const report = (done, total) => { if (onProgress) onProgress(done, Math.max(done, total)); };

        // Phase 1: a small parallel window discovers how deep the library goes.
        // A single failed page no longer forces a slow serial pass.
        const scanned = new Set();
        const firstBatch = [];
        for (let p = 1; p <= Math.min(pageSize, 5); p++) firstBatch.push(p);
        await asyncPool(5, firstBatch, async (p) => {
            const html = await fetchLBHtml(pathFn(username, p));
            scanned.add(p);
            if (html) add(p, parseFn(html));
        });
        report(scanned.size, scanned.size);

        // Phase 2: fetch the rest in windows, stopping once a window adds nothing.
        let next = firstBatch[firstBatch.length - 1] + 1;
        while (next <= pageSize) {
            const pages = [];
            for (let p = next; p < next + 10 && p <= pageSize; p++) pages.push(p);
            let fetched = 0;
            let items = 0;
            await asyncPool(5, pages, async (pageNo) => {
                const html = await fetchLBHtml(pathFn(username, pageNo));
                scanned.add(pageNo);
                if (!html) return;
                const parsed = parseFn(html);
                fetched++;
                items += parsed ? parsed.length : 0;
                add(pageNo, parsed);
            });
            next += pages.length;
            report(scanned.size, next - 1);
            if (items === 0 || fetched === 0) break;
        }

        const all = [];
        for (const [, items] of [...byPage.entries()].sort((x, y) => x[0] - y[0])) all.push(...items);
        if (key) lbPageCache.set(key, { entries: all, ts: Date.now() });
        return all;
    }

    async function lbFetchFilmDetails(slug) {
        if (!slug) return null;
        const url = `https://letterboxd.com/film/${slug}/`;
        return fetchWithRetry(url, html => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            // Prefer schema.org JSON-LD for metadata.
            const schema = extractSchemaOrg(html, url);
            const altTitles = [];
            let originalTitle = '', runtime = '', directors = '', actors = '', genres = '', premiereDate = '';
            if (schema) {
                originalTitle = schema.title || '';
                if (schema.altTitles?.length) altTitles.push(...schema.altTitles);
                runtime = schema.runtime || '';
                directors = schema.directors || '';
                actors = schema.actors || '';
                genres = schema.genres || '';
                premiereDate = schema.premiereDate || '';
            }
            // Fallback: original title via CSS selector
            // Parse __NEXT_DATA__ for additional structured data (Next.js SSR state)
            try {
                // __NEXT_DATA__ is a SECONDARY fallback — Schema.org JSON-LD is primary.
                // Note: Letterboxd does not use Next.js natively; this may be a React hydration blob.
                // If __NEXT_DATA__ disappears in future updates, Schema.org will still work.
                const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
                if (ndMatch) {
                    const nd = JSON.parse(ndMatch[1]);
                    const film = nd?.props?.pageProps?.film;
                    if (film) {
                        if (!originalTitle) {
                            originalTitle = decodeHtmlEntities(film.originalName || film.alternateTitle || '');
                        }
                        if (!altTitles.length && film.alternateNames?.length) {
                            for (const n of film.alternateNames) {
                                const name = typeof n === 'string' ? n : n?.name;
                                if (name) altTitles.push(decodeHtmlEntities(name));
                            }
                        }
                        if (!runtime && film.runTime) runtime = String(film.runTime);
                        if (!directors && film.directors?.length) directors = film.directors.map(d => decodeHtmlEntities(d.name || d)).filter(Boolean).join(', ');
                        if (!actors && film.cast?.length) actors = film.cast.slice(0, 10).map(a => decodeHtmlEntities(a.name || a)).filter(Boolean).join(', ');
                        if (!genres && film.genres?.length) genres = film.genres.map(g => g.name || g).filter(Boolean).join(', ');
                        if (!premiereDate && film.releaseDate) premiereDate = film.releaseDate;
                    }
                }
            } catch (e) { /* __NEXT_DATA__ parse failed, continuing with HTML fallbacks */ }

            if (!originalTitle) {
                const origEl = doc.querySelector('h2.originalname em.quoted-creative-work-title');
                if (origEl) originalTitle = decodeHtmlEntities(origEl.textContent.trim());
            }
            if (!originalTitle) {
                DEBUG && console.log('[mrs] LB no original title found for', slug);
            }
            // Fallback: alternative titles via heading + adjacent div
            if (!altTitles.length) {
                const headings = doc.querySelectorAll('h3, h4');
                for (const h of headings) {
                    const label = (h.textContent || '').trim();
                    if (label.toLowerCase() === 'alternative titles') {
                        let div = h.nextElementSibling;
                        if (div && !div.classList.contains('text-indentedlist')) {
                            div = div.querySelector('.text-indentedlist');
                        }
                        if (div) {
                            const text = div.textContent.replace(/\s+/g, ' ').trim();
                            for (const part of text.split(/,\s+|\s+\|\s+|\s+\/\s+/)) {
                                const trimmed = part.trim();
                                if (trimmed) altTitles.push(decodeHtmlEntities(trimmed));
                            }
                        }
                        break;
                    }
                }
            }
            if (!altTitles.length) {
                DEBUG && console.log('[mrs] LB no alternative titles found for', slug);
            }
            return { originalTitle, alternativeTitles: altTitles, runtime, directors, actors, genres, premiereDate };
        }, slug, { name: 'LB film detail fetch', jitter: 300 });
    }

    // Rate limiter: ensures at least `minIntervalMs` between successive calls.
    function makeRateLimiter(minIntervalMs) {
        let last = 0;
        return async () => {
            const now = Date.now();
            const wait = Math.max(0, last + minIntervalMs - now);
            if (wait > 0) await sleep(wait);
            last = Date.now();
        };
    }

    // Fetch helper with retries, exponential backoff, and 429 handling.
    // `parser(html)` should return the parsed value or null/throw on failure.
    async function fetchWithRetry(url, parser, id, opts = {}) {
        const name = opts.name || 'fetch';
        const maxAttempts = opts.attempts || RETRY.FETCH;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Jitter before each request to spread concurrent load
                if (opts.jitter) await sleep(Math.random() * opts.jitter);
                const r = await fetchT(url, opts.timeout || 15000);
                if (!r) {
                    if (attempt < RETRY.FETCH) await sleep(500 * attempt + Math.random() * 200);
                    continue;
                }
                if (r.status === 429) {
                    const ra = parseRetryAfter(r.responseHeaders);
                    const backoff = ra || Math.min(30000, 1000 * Math.pow(2, attempt) + Math.random() * 1000);
                    console.warn(`[mrs] ${name} 429 for ${id}, backing off ${Math.round(backoff)}ms`);
                    await sleep(backoff);
                    continue;
                }
                if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
                    DEBUG && console.log(`[mrs] ${name} ${r.status} for ${id}, skipping`);
                    return null;
                }
                if (!r.ok) {
                    if (attempt < maxAttempts) await sleep(500 * attempt + Math.random() * 200);
                    continue;
                }
                const html = await r.text();
                const parsed = parser(html);
                // `null` means "this page has no usable data" — retrying the same URL
                // cannot help, so let the caller try the next URL.
                if (parsed == null) return null;
                return parsed;
            } catch (e) {
                console.warn(`[mrs] ${name} failed for ${id}:`, e.message);
                if (attempt < maxAttempts) await sleep(500 * attempt + Math.random() * 200);
            }
        }
        return null;
    }

    async function imdbFetchFilmDetailsGQL(ttId) {
        try {
            const vars = { tConst: ttId };
            const json = await imdbGql(IMDB_TITLE_QUERY, vars);
            if (!json?.data?.title) return null;
            const t = json.data.title;
            const allTitles = [];
            if (t.titleText?.text) allTitles.push(decodeHtmlEntities(t.titleText.text));
            if (t.originalTitleText?.text) allTitles.push(decodeHtmlEntities(t.originalTitleText.text));
            for (const edge of (t.akas?.edges || [])) {
                if (edge?.node?.text) allTitles.push(decodeHtmlEntities(edge.node.text));
            }
            let rating = null;
            if (t.userRating?.value != null) rating = t.userRating.value;
            let runtime = '';
            if (t.runtime?.seconds) runtime = String(Math.floor(t.runtime.seconds / 60));
            let premiereDate = '';
            if (t.releaseYear?.year) premiereDate = String(t.releaseYear.year);
            const genres = (t.genres?.genres || []).map(g => g?.text).filter(Boolean).join(', ');
            const directors = [], actors = [];
            for (const cat of (t.principalCredits || [])) {
                const catText = (cat?.category?.text || '').toLowerCase();
                for (const credit of (cat?.credits || [])) {
                    const name = decodeHtmlEntities(credit?.name?.nameText?.text || '');
                    if (!name) continue;
                    if (catText === 'director' || catText === 'directors') {
                        if (directors.length < 3) directors.push(name);
                    } else if (catText === 'actor' || catText === 'actress' || catText === 'cast' || catText === 'star') {
                        if (actors.length < 3) actors.push(name);
                    }
                }
            }
            return {
                allTitles: [...new Set(allTitles.filter(Boolean))],
                rating,
                runtime,
                directors: directors.join(', '),
                actors: actors.join(', '),
                genres,
                premiereDate,
            };
        } catch (e) {
            if (DEBUG) console.warn('[mrs] IMDb GQL detail fetch failed, falling back to HTML:', e.message);
            return null;
        }
    }
    async function imdbFetchFilmDetailsHTML(ttId) {
        if (!ttId || !/^tt\d+$/.test(ttId)) return null;
        const gqlResult = await imdbFetchFilmDetailsGQL(ttId);
        if (gqlResult) return gqlResult;
        // Fallback: fetch HTML pages (main + releaseinfo) in parallel
        const mainUrl = `https://www.imdb.com/title/${ttId}/`;
        const releaseUrl = `https://www.imdb.com/title/${ttId}/releaseinfo/`;
        const [mainResult, releaseResult] = await Promise.all([
            fetchWithRetry(mainUrl, html => {
                // Prefer schema.org JSON-LD for directors/actors/genres/runtime.
                const schema = extractSchemaOrg(html, mainUrl);
                const allTitles = [];
                let rating = null, runtime = '', directors = '', actors = '', genres = '', premiereDate = '';
                if (schema) {
                    if (schema.title) allTitles.push(decodeHtmlEntities(schema.title));
                    if (schema.altTitles?.length) allTitles.push(...schema.altTitles.map(decodeHtmlEntities));
                    runtime = schema.runtime || '';
                    directors = schema.directors || '';
                    actors = schema.actors || '';
                    genres = schema.genres || '';
                    premiereDate = schema.premiereDate || '';
                }
                // Fallback to __NEXT_DATA__ for alternative titles and any missing fields.
                try {
                    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
                    if (m) {
                        const json = JSON.parse(m[1]);
                        const data = json?.props?.pageProps?.mainColumnData || {};
                        const akas = data?.akas?.edges || [];
                        for (const edge of akas) {
                            const text = decodeHtmlEntities(edge?.node?.text);
                            if (text) allTitles.push(text);
                        }
                        if (!runtime && data?.runtime?.displayText) runtime = String(parseInt(data.runtime.displayText, 10) || '');
                        if (!runtime && data?.runtime?.seconds) runtime = String(Math.floor(data.runtime.seconds / 60));
                        if (!premiereDate && data?.releaseDate?.day && data?.releaseDate?.month && data?.releaseDate?.year) {
                            premiereDate = `${data.releaseDate.year}-${String(data.releaseDate.month).padStart(2, '0')}-${String(data.releaseDate.day).padStart(2, '0')}`;
                        }
                        if (!premiereDate && data?.releaseYear?.year) premiereDate = String(data.releaseYear.year);
                        // Extract user rating from already-parsed JSON
                        const aboveFold = json?.props?.pageProps?.aboveTheFoldData;
                        if (aboveFold?.userRating?.value != null) rating = aboveFold.userRating.value;
                        else if (data?.userRating?.value != null) rating = data.userRating.value;
                    }
                } catch (e) { /* ignore fallback errors */ }
                return { allTitles, rating, runtime, directors, actors, genres, premiereDate };
            }, ttId, { name: 'IMDb film details fetch', jitter: 300 }),
            fetchWithRetry(releaseUrl, html => {
                // Extract full AKA list from __NEXT_DATA__ on releaseinfo page
                const allTitles = [];
                try {
                    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
                    if (m) {
                        const json = JSON.parse(m[1]);
                        const data = json?.props?.pageProps;
                        if (data) {
                            // AKAs are nested in mainColumnData on releaseinfo page
                            const akas = data?.mainColumnData?.akas?.edges
                                || data?.akas?.edges
                                || [];
                            for (const edge of akas) {
                                const text = decodeHtmlEntities(edge?.node?.text);
                                if (text) allTitles.push(text);
                            }
                        }
                    }
                } catch (e) { /* ignore */ }
                return { allTitles };
            }, ttId, { name: 'IMDb releaseinfo fetch', jitter: 300 }),
        ]);
        const allTitles = [...new Set([
            ...(mainResult?.allTitles || []),
            ...(releaseResult?.allTitles || []),
        ].filter(Boolean))];
        return {
            allTitles,
            rating: mainResult?.rating ?? null,
            runtime: mainResult?.runtime || '',
            directors: mainResult?.directors || '',
            actors: mainResult?.actors || '',
            genres: mainResult?.genres || '',
            premiereDate: mainResult?.premiereDate || '',
        };
    }

    async function kpFetchFilmDetailsGQL(kpId) {
        try {
            const vars = { id: +kpId };
            const json = await kpGql(KP_FILM_DETAIL_QUERY, vars, 'FilmDetail');
            if (!json?.data?.movie?.film) return null;
            const film = json.data.movie.film;
            const allTitles = [];
            if (film.title?.russian) allTitles.push(decodeHtmlEntities(film.title.russian));
            if (film.title?.original) allTitles.push(decodeHtmlEntities(film.title.original));
            for (const a of (film.title?.alternative || [])) { if (a?.name) allTitles.push(decodeHtmlEntities(a.name)); }
            let runtime = film.duration != null ? String(film.duration) : '';
            let premiereDate = film.premiereWorld?.date || '';
            const genres = (film.genres || []).map(g => g?.name).filter(Boolean).join(', ');
            const directors = [], actors = [];
            for (const p of (film.persons || [])) {
                const name = decodeHtmlEntities(p?.name?.russian || p?.name?.original || '');
                if (!name) continue;
                const prof = (p.professionText || '').toLowerCase();
                if (prof.includes('режиссер') || prof.includes('director') || prof.includes('режиссёр')) {
                    if (directors.length < 3) directors.push(name);
                } else if (prof.includes('актер') || prof.includes('actor') || prof.includes('актёр')) {
                    if (actors.length < 3) actors.push(name);
                }
            }
            return {
                allTitles: [...new Set(allTitles.filter(Boolean))],
                runtime,
                directors: directors.join(', '),
                actors: actors.join(', '),
                genres,
                premiereDate: premiereDate ? String(premiereDate).split('T')[0] : '',
            };
        } catch (e) {
            if (DEBUG) console.warn('[mrs] KP GQL detail fetch failed, falling back to HTML:', e.message);
            return null;
        }
    }
    // Kinopoisk GraphQL requires a signed operation hash and rejects anonymous
    // POSTs, so the public film page is the primary source: it ships schema.org
    // JSON-LD plus the full Apollo SSR state with crew/genres/runtime.
    let _kpGqlFailureTime = Date.now();  // assume GQL is broken until a film page proves otherwise
    // Parse one Kinopoisk film page into extended metadata. Returns null when the
    // page carries no film data (bot wall, removed title, wrong URL type).
    // Exposed on window so the parsers can be regression-tested from the console.
    function parseKPFilmPage(html, pageUrl, kpId) {
        // Prefer schema.org JSON-LD for directors/actors/genres/runtime.
        const schema = extractSchemaOrg(html, pageUrl);
        const allTitles = [];
        let runtime = '', directors = '', actors = '', genres = '', premiereDate = '', type = '';
        if (schema) {
            if (schema.title) allTitles.push(decodeHtmlEntities(schema.title));
            if (schema.altTitles?.length) allTitles.push(...schema.altTitles.map(decodeHtmlEntities));
            runtime = schema.runtime || '';
            directors = schema.directors || '';
            actors = schema.actors || '';
            genres = schema.genres || '';
            premiereDate = schema.premiereDate || '';
        }
        // SSR Apollo state: film type, alternative titles, crew, genres, duration.
        try {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const ssr = parseKPSSRJson(doc);
            const state = ssr?.apolloState;
            if (state) {
                const movie = state[`Film:${kpId}`] || state[`TvSeries:${kpId}`]
                    || Object.values(state).find(v => v && v.id != null && String(v.id) === String(kpId));
                if (movie) {
                    type = movie.__typename || '';
                    if (movie.title?.russian) allTitles.push(decodeHtmlEntities(movie.title.russian));
                    if (movie.title?.localized) allTitles.push(decodeHtmlEntities(movie.title.localized));
                    if (movie.title?.original) allTitles.push(decodeHtmlEntities(movie.title.original));
                    if (Array.isArray(movie.title?.alternative)) {
                        for (const t of movie.title.alternative) {
                            const name = typeof t === 'string' ? t : t?.name;
                            if (name) allTitles.push(decodeHtmlEntities(name));
                        }
                    }
                    if (!runtime && movie.duration != null) runtime = String(movie.duration);
                    if (!premiereDate && movie.worldPremiere?.date) premiereDate = movie.worldPremiere.date;
                    const collectPeople = (val, limit) => {
                        const arr = Array.isArray(val) ? val : (val?.items || []);
                        const names = [];
                        for (const entry of arr) {
                            const person = entry?.__ref ? state[entry.__ref]
                                : (entry?.person?.__ref ? state[entry.person.__ref] : (entry?.person || entry));
                            if (!person) continue;
                            // KP SSR keeps the display name in `name.russian` for some
                            // entries and in `originalName` for others — try both.
                            const name = decodeHtmlEntities(person.name?.russian || person.name?.original
                                || person.name || person.originalName || '');
                            if (name && !names.includes(name)) names.push(name);
                            if (names.length >= limit) break;
                        }
                        return names.join(', ');
                    };
                    const movieFields = Object.keys(movie);
                    const directorField = movieFields.find(f => /^members\(\{.*"role":"DIRECTOR"/.test(f));
                    const writerField = movieFields.find(f => /^members\(\{.*"role":"WRITER"/.test(f));
                    const actorField = movieFields.find(f => /^members\(\{.*"role":\[?"?ACTOR/.test(f));
                    if (!directors && directorField) directors = collectPeople(movie[directorField], 3);
                    if (!directors && writerField) directors = collectPeople(movie[writerField], 1);
                    if (!actors && actorField) actors = collectPeople(movie[actorField], 10);
                    if (!genres && movie.genres?.length) {
                        genres = movie.genres.map(g => {
                            const gObj = g?.__ref ? state[g.__ref] : g;
                            return gObj?.name || '';
                        }).filter(Boolean).join(', ');
                    }
                }
            }
        } catch (e) { /* ignore SSR errors */ }
        // A page with neither JSON-LD nor SSR movie data is not a film page.
        if (!schema && !type && !allTitles.length) return null;
        return {
            type: type === 'Film' ? 'Film' : (type ? 'TvSeries' : ''),
            allTitles: [...new Set(allTitles.filter(Boolean))],
            runtime,
            directors,
            actors,
            genres,
            premiereDate: premiereDate ? String(premiereDate).split('T')[0] : '',
        };
    }
    try { if (typeof window !== 'undefined') window.mrsParseKPFilmPage = parseKPFilmPage; } catch (e) { /* ignore */ }

    async function kpFetchFilmDetailsHTML(kpId) {
        if (!kpId || !/^\d+$/.test(String(kpId))) return null;
        // Facade pages (/film/N/) predate the current film pages and have no metadata.
        if (+kpId < 100000) return null;
        // Typed URL: some KP ids are only reachable with a type prefix, so try both.
        const urls = [`https://www.kinopoisk.ru/film/${kpId}/`, `https://www.kinopoisk.ru/series/${kpId}/`];
        for (const url of urls) {
            const result = await fetchWithRetry(
                url,
                html => parseKPFilmPage(html, url, kpId),
                kpId,
                { name: 'KP film details fetch', jitter: 300, attempts: 1 }
            );
            if (result) return result;
        }
        // Last resort: GraphQL (best effort, may be rejected by the API).
        if (Date.now() >= _kpGqlFailureTime + 5 * 60000) {
            const gqlResult = await kpFetchFilmDetailsGQL(kpId);
            if (gqlResult) { _kpGqlFailureTime = 0; return gqlResult; }
            _kpGqlFailureTime = Date.now();
            DEBUG && console.log('[mrs] KP GQL detail fetch unavailable, using HTML only');
        }
        return null;
    }

    async function performLBExport(statusEl) {
        const el = statusEl;
        const username = getLBUsername();
        if (!username) throw new Error(t('lbUsernameNotFound'));

        const map = new Map();
        const merge = items => items.forEach(i => {
            if (!i.slug) return;
            if (!map.has(i.slug)) { map.set(i.slug, { ...i }); return; }
            const ex = map.get(i.slug);
            if (i.watchedDate && !ex.watchedDate) ex.watchedDate = i.watchedDate;
            if (i.rating != null && ex.rating == null) ex.rating = i.rating;
            if (i.filmId && !ex.filmId) ex.filmId = i.filmId;
        });

        // One row per source: each row owns its own channel and never fights
        // another one for the same line, so nothing flickers.
        beginRun(el, `${t('profileDetect', { platform: 'Letterboxd' })}`.trim());
        const chRatings = channelWriter(el, 'lbRatings', t('ratings'));
        const chDiary = channelWriter(el, 'lbDiary', t('diary'));
        const chWatched = channelWriter(el, 'lbWatched', t('watched'));
        const chLikes = channelWriter(el, 'lbLikes', t('likes'));
        const scrape = (write, pathFn, parseFn) => lbScrapePages(username, pathFn, parseFn, 200,
            (done, total) => write(`${t('page')} ${done}/${total}`, { current: done, total, extra: '' }));
        const settle = (channel, p) => p.then(
            (value) => { finishChannel(el, channel, true, true); return value; },
            (err) => { finishChannel(el, channel, false); throw err; }
        );
        const started = Date.now();
        const [ratings, diary, watched, liked] = await Promise.all([
            settle('lbRatings', scrape(chRatings, (u, p) => p === 1 ? `https://letterboxd.com/${u}/films/ratings/` : `https://letterboxd.com/${u}/films/ratings/page/${p}/`, parseLBRatings)),
            settle('lbDiary', scrape(chDiary, (u, p) => p === 1 ? `https://letterboxd.com/${u}/films/diary/` : `https://letterboxd.com/${u}/films/diary/page/${p}/`, parseLBDiary)),
            settle('lbWatched', scrape(chWatched, (u, p) => p === 1 ? `https://letterboxd.com/${u}/films/` : `https://letterboxd.com/${u}/films/page/${p}/`, parseLBWatched)),
            settle('lbLikes', scrape(chLikes, (u, p) => p === 1 ? `https://letterboxd.com/${u}/likes/` : `https://letterboxd.com/${u}/likes/page/${p}/`, parseLBWatched)
                .catch(e => { console.error('[mrs] LB likes scrape failed:', e); return []; })),
        ]);
        setTitle(el, `${map.size} ${t('movies')}`);
        void started;

        merge(ratings);
        merge(diary);
        merge(watched);
        const likedSlugs = new Set(liked.map(i => i.slug).filter(Boolean));

        // Fetch film details for films in parallel
        const uniqueItems = [...map.values()];
        const chDetails = channelWriter(el, 'lbDetails', t('lblDetails'));
        chDetails(`0/${uniqueItems.length}`, { current: 0, total: uniqueItems.length });
        const lbRateLimit = makeRateLimiter(15);
        let detailsDone = 0;
        const details = await asyncPool(25, uniqueItems, async u => {
            try {
                if (!u.slug) return null;
                const cacheKey = 'lb:' + u.slug;
                const cached = filmDetailCache.get(cacheKey);
                if (cached) return cached;
                await lbRateLimit();
                const res = await lbFetchFilmDetails(u.slug);
                if (res) filmDetailCache.set(cacheKey, res);
                return res;
            } finally {
                detailsDone++;
                if (detailsDone % 5 === 0 || detailsDone === uniqueItems.length) {
                    chDetails(`${detailsDone}/${uniqueItems.length}`, { current: detailsDone, total: uniqueItems.length });
                }
            }
        });
        details.forEach((r, i) => {
            const item = uniqueItems[i];
            if (r.status === 'fulfilled' && r.value) {
                item.originalTitle = r.value.originalTitle;
                item.alternativeTitles = r.value.alternativeTitles;
                item.runtime = r.value.runtime;
                item.directors = r.value.directors;
                item.actors = r.value.actors;
                item.genres = r.value.genres;
                item.premiereDate = r.value.premiereDate;
            }
        });
        chDetails(`${uniqueItems.length}/${uniqueItems.length}`, { current: uniqueItems.length, total: uniqueItems.length });
        finishChannel(el, 'lbDetails', true, true);
        filmDetailCache.flush();

        const rows = uniqueItems.map(i => {
            const allTitles = [...new Set([i.originalTitle, ...(i.alternativeTitles || []), i.title].filter(Boolean))];
            const cyrTitles = allTitles.filter(t => isRussianCyrillic(t));
            const latTitles = allTitles.filter(t => !hasCyr(t));
            const titleRu = cyrTitles[0] || '';
            const titleOrig = latTitles[0] || i.slug;
            return {
                titleRu,
                titleOrig,
                allTitles,
                type: 'Film',
                lbSlug: i.slug || '',
                yearStart: i.year || '',
                rating: i.rating ?? null,
                watchedDate: i.watchedDate ?? '',
                runtime: i.runtime || '',
                directors: i.directors || '',
                actors: i.actors || '',
                premiereDate: i.premiereDate || '',
                favorite: likedSlugs.has(i.slug),
                src: 'lb',
            };
        });
        setStatus(statusEl, t('foundCount', { count: rows.length }) + dots());
        return buildCSV(rows);
    }

    // Letterboxd film lookup: multiple strategies with progressive fallback
    async function lbSearchFilm(title, year, csrfRef, deep = false, allTitles = [], src = {}) {
        const cacheKey = `lb:${normTitle(title)}|${year || ''}|${deep ? '1' : '0'}`;
        const cached = searchCache.get(cacheKey);
        if (cached !== undefined) return cached;
        const negTs = _lbNeg.get(cacheKey);
        if (negTs && Date.now() - negTs < SEARCH_NEG_TTL) return null;
        return dedupeFetch(cacheKey, async () => {
            const variants = deep ? getTitleVariants(title, allTitles) : getTitleVariants(title, allTitles).slice(0, 5);
            const ts = Date.now();
            let best = null;

            const slugFromUrl = u => u?.replace(/^\/(?:film|tv)\/|\/$/g, '') || null;

            const tryAutocomplete = async (q) => {
                const results = [];
                const endpoints = [
                    { url: `https://letterboxd.com/s/autocompletefilm?q=${encodeURIComponent(q)}&limit=20&timestamp=${ts}`, type: 'Film' },
                    { url: `https://letterboxd.com/s/autocompletetv?q=${encodeURIComponent(q)}&limit=20&timestamp=${ts}`, type: 'TvSeries' },
                ];
                for (let attempt = 0; attempt < 3; attempt++) {
                    const responses = await Promise.all(endpoints.map(ep => fetchT(ep.url).catch(() => null)));
                    if (responses.some(r => r?.status === 429)) { await sleep(400 + attempt * 600); continue; }
                    for (let ei = 0; ei < endpoints.length; ei++) {
                        const r = responses[ei];
                        if (!r?.ok) continue;
                        const json = await r.json().catch(() => null);
                        if (json?.result !== true) continue;
                        if (csrfRef && json.csrf) csrfRef.val = json.csrf;
                        for (let ri = 0; ri < (json.data ?? []).length; ri++) {
                            const entry = json.data[ri];
                            const entrySlug = slugFromUrl(entry.url);
                            if (!entrySlug) continue;
                            const isTv = entry.url?.startsWith('/tv/');
                            const entryType = isTv ? 'TvSeries' : endpoints[ei].type;
                            const slugWithPrefix = isTv ? 'tv:' + entrySlug : entrySlug;
                            results.push({
                                slug: slugWithPrefix,
                                filmId: entry.id ? String(entry.id) : null,
                                lid: entry.lid ?? null,
                                title: entry.name ?? '',
                                year: String(entry.releaseYear ?? ''),
                                type: entryType,
                                suggestRank: ri,
                            });
                        }
                    }
                    return results;
                }
                return results;
            };

            // In normal mode three spellings are plenty (the title, its cleaned
            // form and the transliteration); deep mode may use the whole list.
            const maxAuto = deep ? variants.length : Math.min(variants.length, 3);
            for (const q of variants.slice(0, maxAuto)) {
                const items = await tryAutocomplete(q);
                for (const cand of items) {
                    const score = scoreCandidate({ title, year, type: src.type || '', genres: src.genres || '', allTitles }, cand);
                    const conf = confidenceLabel(score);
                    if (conf === 'high' && (!year || !cand.year || yearsMatch(cand.year, year))) {
                        const result = { ...cand, score, confidence: conf };
                        searchCache.set(cacheKey, result);
                        DEBUG && console.log(`[mrs] LB autocomplete HIGH: "${title}" (${year}) → ${cand.slug} score=${score.toFixed(2)}`);
                        return result;
                    }
                    if (!best || score > best.score) best = { ...cand, score, confidence: conf };
                }
                // A confident hit on the primary spelling is enough: every
                // extra variant costs two autocomplete requests *and* possibly
                // two HTML search pages.
                if (best && best.confidence === 'high' && (!year || !best.year || yearsMatch(best.year, year))) {
                    searchCache.set(cacheKey, best);
                    return best;
                }
            }
            // Autocomplete is empty or uncertain. Stop here in normal mode when
            // it already produced a usable medium/low match: the HTML search
            // below is two full page fetches per spelling and is the single
            // slowest step of a large Letterboxd import.
            if (!deep && best && best.confidence !== 'low') {
                searchCache.set(cacheKey, best);
                return best;
            }

            const tryHtmlSearch = async (q) => {
                const results = [];
                try {
                    const [filmHtml, tvHtml] = await Promise.all([
                        fetchLBHtml(`https://letterboxd.com/search/films/?q=${encodeURIComponent(q)}`).catch(() => null),
                        fetchLBHtml(`https://letterboxd.com/search/tv/?q=${encodeURIComponent(q)}`).catch(() => null),
                    ]);
                    const parseSearchHtml = (html, itemType) => {
                        if (!html) return [];
                        const items = [];
                        const slugMatches = [...html.matchAll(/data-item-slug="([^"]+)"/g)];
                        const nameMatches = [...html.matchAll(/data-item-name="([^"]+)"/g)];
                        const jsonMatches = [...html.matchAll(/data-postered-identifier='(\{[^']+\})'/g)];
                        for (let i = 0; i < slugMatches.length; i++) {
                            const rawSlug = slugMatches[i][1];
                            const fullName = nameMatches[i]?.[1] ?? '';
                            const yr = fullName.match(/\((\d{4})\)/)?.[1] ?? '';
                            const filmName = fullName.replace(/\s*\(\d{4}\)\s*$/, '').trim();
                            let filmId = null, lid = null;
                            if (jsonMatches[i]) {
                                try { const d = JSON.parse(jsonMatches[i][1]); filmId = d?.uid?.replace('film:', '') ?? null; lid = d?.lid ?? null; } catch (e) { console.warn("[mrs] catch:", e?.message ?? e); }
                            }
                            const entrySlug = itemType === 'TvSeries' ? 'tv:' + rawSlug : rawSlug;
                            items.push({ slug: entrySlug, filmId, lid, title: filmName, year: yr, type: itemType });
                        }
                        return items;
                    };
                    results.push(...parseSearchHtml(filmHtml, 'Film'));
                    results.push(...parseSearchHtml(tvHtml, 'TvSeries'));
                } catch (e) { console.warn("[mrs] catch:", e?.message ?? e); }
                return results;
            };

            const htmlVariants = deep ? variants : variants.slice(0, 2);
            for (const q of htmlVariants) {
                if (lbHtmlBreaker.open) break;
                const items = await tryHtmlSearch(q);
                if (!items.length) {
                    if (lbHtmlBreaker.fail()) console.warn('[mrs] LB HTML search disabled for this run after repeated empty answers');
                } else lbHtmlBreaker.ok();
                for (const cand of items) {
                    const score = scoreCandidate({ title, year, type: src.type || '', genres: src.genres || '', allTitles }, cand);
                    const conf = confidenceLabel(score);
                    if (conf === 'high' && (!year || !cand.year || yearsMatch(cand.year, year))) {
                        const result = { ...cand, score, confidence: conf };
                        searchCache.set(cacheKey, result);
                        DEBUG && console.log(`[mrs] LB HTML HIGH: "${title}" (${year}) → ${cand.slug} score=${score.toFixed(2)}`);
                        return result;
                    }
                    if (!best || score > best.score) best = { ...cand, score, confidence: conf };
                }
            }

            if (best) {
                DEBUG && console.log(`[mrs] LB best: "${title}" (${year}) → ${best.slug} score=${best.score.toFixed(2)} conf=${best.confidence}`);
                const yearOk = !best.year || !year || yearsMatch(best.year, year);
                if (yearOk && (best.confidence === 'high'
                    || (deep && best.confidence !== 'low')
                    || best.confidence === 'medium'
                    || (best.confidence === 'low' && best.score >= 350))) {
                    searchCache.set(cacheKey, best);
                    return best;
                }
            }
            console.warn(`[mrs] LB search FAILED: "${title}" (${year})`);
            _lbNeg.set(cacheKey, Date.now());
            return null;
        });
    }

    // One Letterboxd film page carries everything needed to write a rating:
    // the slug (canonical / og:url), the rating LID and the numeric film id
    // hidden in `production:identifier`. Shared by the slug lookup and the
    // IMDb-id resolver so both parse the same page the same way.
    function parseLBPageIds(html) {
        if (!html) return null;
        let filmId = null, lid = null;
        const unescape = s => s.replace(/&quot;/g, '"');
        const prodId = html.match(/name="production:identifier"\s+content="([^"]+)"/);
        if (prodId) {
            try {
                const d = JSON.parse(unescape(prodId[1]));
                if (d?.lid) lid = d.lid;
                if (d?.uid) filmId = String(d.uid).replace(/^film:/, '');
            } catch { /* malformed meta */ }
        }
        if (!filmId || !lid) {
            const jsonId = html.match(/data-postered-identifier='([^']+)'/);
            if (jsonId) {
                try {
                    const d = JSON.parse(unescape(jsonId[1]));
                    if (!lid && d?.lid) lid = d.lid;
                    if (!filmId && d?.uid) filmId = String(d.uid).replace(/^film:/, '');
                } catch { /* malformed attribute */ }
            }
        }
        if (!filmId) {
            const fm = html.match(/data-film-id="(\d+)"/) || html.match(/\bfilm:(\d+)\b/);
            if (fm) filmId = fm[1];
        }
        const slug = html.match(/<meta property="og:url" content="https:\/\/letterboxd\.com\/(?:film|tv)\/([^"/]+)\/"/)?.[1]
            || html.match(/data-film-slug="([^"]+)"/)?.[1]
            || null;
        return (lid || filmId) ? { lid, filmId, slug } : null;
    }

    // Resolve a film by its IMDb id. Letterboxd redirects /imdb/tt…/ to the
    // film page, so ONE request yields the slug + LID + film id. For an
    // IMDb→Letterboxd import this replaces a title search (two autocomplete
    // calls per spelling, up to three spellings, plus two HTML search pages
    // when unsure) with a single exact lookup: measured 51 ms/film at 16
    // concurrent from the shell.
    async function lbResolveByImdbId(ttId, csrfRef) {
        if (!ttId || !/^tt\d+$/.test(ttId)) return null;
        const cacheKey = `lbImdb:${ttId}`;
        const cached = searchCache.get(cacheKey);
        if (cached !== undefined) return cached;
        const negTs = _lbNeg.get(cacheKey);
        if (negTs && Date.now() - negTs < SEARCH_NEG_TTL) return null;
        return dedupeFetch(cacheKey, async () => {
            const html = await fetchLBHtml(`https://letterboxd.com/imdb/${ttId}/`);
            if (!html) return null;
            if (csrfRef) {
                const csrfInPage = html.match(/supermodelCSRF\s*=\s*['"]([^'"]+)['"]/);
                if (csrfInPage) csrfRef.val = csrfInPage[1];
            }
            const ids = parseLBPageIds(html);
            if (!ids) {
                // Letterboxd answers 200 with an ~80 KB page and no ids for a
                // title it does not have; that is "not on LB", not a transport
                // failure, so memoise it briefly instead of searching again.
                _lbNeg.set(cacheKey, Date.now());
                return null;
            }
            const result = { slug: ids.slug, filmId: ids.filmId, lid: ids.lid, score: 1.0, confidence: 'high' };
            searchCache.set(cacheKey, result);
            return result;
        });
    }

    // Read a film's internal ids from its page: LID (rating API) and numeric
    // film id (watch / rate / like form endpoints). One page fetch yields both,
    // and for a slug-only CSV row the numeric id is what enables "watched".
    async function lbGetFilmIds(slug, csrfRef, filmId = null) {
        if (!slug && !filmId) return null;
        // Strip tv: prefix if present — it was added by lbSearchFilm to distinguish TV series
        const isTv = !!slug && slug.startsWith('tv:');
        const cleanSlug = isTv ? slug.slice(3) : slug;
        // /film/{id}/ redirects to the slugged page, so it yields the same ids
        // and stays usable when the form endpoint rejected a filmId-only row.
        const paths = !slug ? [`/film/${filmId}/`]
            : isTv ? [`/tv/${cleanSlug}/`]
                : [`/film/${cleanSlug}/`, `/tv/${cleanSlug}/`];
        for (const path of paths) {
            try {
                const html = await fetchLBHtml(`https://letterboxd.com${path}`);
                if (!html) continue;
                if (csrfRef) {
                    const csrfInPage = html.match(/supermodelCSRF\s*=\s*['"]([^'"]+)['"]/);
                    if (csrfInPage) csrfRef.val = csrfInPage[1];
                }
                const ids = parseLBPageIds(html);
                if (ids) return ids;
            } catch { continue; }
        }
        return null;
    }

    async function lbGetFilmLid(slug, csrfRef, filmId = null) {
        const ids = await lbGetFilmIds(slug, csrfRef, filmId);
        return ids?.lid ?? null;
    }

    // Rate a film through Letterboxd's form endpoint. `filmId` is the internal
    // numeric id that search results already carry, so this costs one request
    // instead of "fetch the film page to discover the LID, then PATCH".
    // Returns true on success, false when LB rejected the action (it hands back
    // a fresh csrf in that case), null when the response was not usable.
    async function lbRateForm(filmId, ratingVal, csrfRef) {
        const csrf = csrfRef?.val || getLBCsrf() || '';
        const r = await fetchT(`https://letterboxd.com/s/film:${filmId}/rate/`, 10000, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Accept': 'text/json, application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRF-Token': csrf,
                'Referer': location.href,
            },
            body: `rating=${ratingVal}&__csrf=${encodeURIComponent(csrf)}`,
        });
        if (!r?.status) return null;
        const text = await r.text().catch(() => '');
        if (text.trimStart().startsWith('{')) {
            try {
                const j = JSON.parse(text);
                if (j?.csrf && csrfRef) csrfRef.val = j.csrf;
                if (typeof j?.result === 'boolean') return j.result;
            } catch { /* fall through */ }
        }
        return r.ok ? null : false;
    }

    let _lbApplyOkCount = 0;  // counter for successful LB apply operations

    // Apply rating or mark as watched via Letterboxd internal API v0.
    // csrfRef: { val: string } — mutable ref, updated from each response
    // Returns { status: 'rated'|'watched'|null }
    async function applyLBRating(slug, lid, filmId, rating10, csrfRef, watchedDate) {
        const hasR = rating10 != null && String(rating10) !== '' && +rating10 >= 1 && +rating10 <= 10;

        if (!hasR && !filmId) {
            // Need filmId for watch endpoint
            return { status: null };
        }

        if (!csrfRef.val) {
            console.warn('[mrs] CSRF token is empty! supermodelCSRF=', typeof supermodelCSRF !== 'undefined' ? supermodelCSRF : 'undefined');
        }

        // Fast path: a known filmId skips the LID lookup entirely, which for a
        // full import used to mean one extra film page per rated movie.
        if (hasR && filmId) {
            const ratingVal = Math.min(5, Math.max(0.5, Math.round(+rating10) / 2));
            for (let attempt = 0; attempt < 2; attempt++) {
                const ok = await lbRateForm(filmId, ratingVal, csrfRef);
                if (ok === true) {
                    _lbApplyOkCount++;
                    DEBUG && console.log(`[mrs] LB RATED OK #${_lbApplyOkCount}: ${slug} filmId=${filmId} rating=${ratingVal} (csv=${rating10})`);
                    return { status: 'rated' };
                }
                // Rejected form (usually an expired csrf, which the response
                // just refreshed) or a transport hiccup: retry with the fresh
                // token before paying for the slow LID path.
                if (attempt === 1) break;
                await sleep(150);
            }
        }

        for (let attempt = 0; attempt < 3; attempt++) {
            let r;
            if (hasR) {
                // Rating: PATCH /me/rate/{LID}  body: {"rating": 0.5–5.0}
                if (!lid) lid = await lbGetFilmLid(slug, csrfRef, filmId);
                if (!lid) return { status: null };
                const ratingVal = Math.min(5, Math.max(0.5, Math.round(+rating10) / 2));
                const hdrs = {
                    'Content-Type': 'application/json; charset=UTF-8',
                    'Accept': '*/*',
                    'Referer': location.href,
                    'X-CSRF-TOKEN': csrfRef.val ?? '',
                };
                r = await fetchT(`https://letterboxd.com/api/v0/me/rate/${lid}`, 10000, {
                    method: 'PATCH', headers: hdrs,
                    body: JSON.stringify({ rating: ratingVal }),
                });
            } else {
                // Watched only: POST /s/film:{filmId}/watch/  body: watched=true&__csrf={csrf}
                if (!filmId) { console.warn(`[mrs] LB no filmId for ${slug}`); return { status: null }; }
                const watchUrl = `https://letterboxd.com/s/film:${filmId}/watch/`;
                r = await fetchT(watchUrl, 10000, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': '*/*',
                        'Referer': location.href,
                    },
                    body: `watched=true&__csrf=${encodeURIComponent(csrfRef.val ?? '')}`,
                });
            }

            if (r) {
                // fetchT returns a plain object with string-backed text(), so it
                // is safely re-readable; .clone() never existed and the old
                // `r.clone().text().catch()` always produced ''.
                const respText = await r.text().catch(() => '');
                let jsonResult = null;
                if (respText.trimStart().startsWith('{')) {
                    try {
                        const j = JSON.parse(respText);
                        if (j?.csrf) csrfRef.val = j.csrf;
                        if (typeof j?.result === 'boolean') jsonResult = j.result;
                    } catch { /* not JSON after all */ }
                }
                // The form endpoints answer HTTP 200 even when the action was
                // rejected ("The form on this page had expired..."). Trusting
                // r.ok alone counted unrated films as rated and lost ratings.
                if (r.ok && jsonResult !== false) {
                    const status = hasR ? 'rated' : 'watched';
                    _lbApplyOkCount++;
                    if (_lbApplyOkCount <= 5 || _lbApplyOkCount % 50 === 0) {
                        DEBUG && console.log(`[mrs] LB ${status.toUpperCase()} OK #${_lbApplyOkCount}: ${slug} filmId=${filmId} lid=${lid} rating=${hasR ? Math.min(5, Math.max(0.5, Math.round(+rating10) / 2)) : 'none'} (csv=${rating10}) status=${r.status} resp=${respText.slice(0, 200)}`);
                    }
                    return { status };
                }
                if (jsonResult === false) {
                    // A fresh csrf was stored above; retry with it.
                    if (attempt < 2) { await sleep(150 + attempt * 250); continue; }
                }
                if (r.status === 429) {
                    // A 429 here means Letterboxd is throttling a burst; the old
                    // 3 s + 6 s ladder stalled an entire import behind one film.
                    const waitMs = 900 + attempt * 900 + Math.floor(Math.random() * 300);
                    DEBUG && console.warn(`[mrs] LB 429: ${slug} — retry in ${waitMs}ms (attempt ${attempt + 1}/3)`);
                    await sleep(waitMs);
                    continue;
                }
                if (r.status >= 500 && r.status < 600 && attempt < 2) {
                    console.warn(`[mrs] LB ${r.status}: ${slug} — retry (attempt ${attempt + 1}/3)`);
                    await sleep(500 + attempt * 500);
                    continue;
                }
                console.warn(`[mrs] LB FAILED: ${slug} filmId=${filmId} lid=${lid} rating=${hasR ? rating10 : 'none'} status=${r.status} body=${respText.slice(0, 300)}`);
                return { status: null };
            } else {
                console.warn(`[mrs] LB timeout: ${slug} filmId=${filmId}`);
            }
        }
        return { status: null };
    }

    async function applyLBFavorite(filmId, csrfRef) {
        if (!filmId) return { status: null };
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const csrf = csrfRef?.val || getLBCsrf();
                if (!csrf) return { status: null };
                const r = await fetchT(`https://letterboxd.com/s/film:${filmId}/like/`, 15000, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest',
                        'X-CSRF-Token': csrf,
                    },
                    body: `liked=true&__csrf=${encodeURIComponent(csrf)}`,
                });
                if (r?.status === 429) { await sleep(500 + attempt * 600); continue; }
                if (r?.ok) {
                    // Same trap as the rate endpoint: /like/ answers HTTP 200 with
                    // {"result":false,...} when the form token expired, so trusting
                    // r.ok counted rejected likes as successful ones.
                    const text = await r.text().catch(() => '');
                    let result = null;
                    if (text.trimStart().startsWith('{')) {
                        try {
                            const j = JSON.parse(text);
                            if (j?.csrf && csrfRef) csrfRef.val = j.csrf;
                            if (typeof j?.result === 'boolean') result = j.result;
                        } catch { /* not JSON */ }
                    }
                    if (result !== false) {
                        DEBUG && console.log(`[mrs] LB favorite OK: filmId=${filmId}`);
                        return { status: 'favorited' };
                    }
                    console.warn(`[mrs] LB favorite rejected: filmId=${filmId} (csrf refreshed, retrying)`);
                    if (attempt < 2) {
                        // The response carried a fresh token, so retry immediately
                        // instead of falling through to the slower backoff below.
                        await sleep(150 + attempt * 250);
                        continue;
                    }
                    return { status: null };
                }
                console.warn(`[mrs] LB favorite failed: filmId=${filmId} status=${r?.status}`);
            } catch (e) {
                console.warn(`[mrs] LB favorite exception: filmId=${filmId}`, e.message);
            }
            // Only back off after a real failure. The old sleep(1000) ran even
            // on the retry path of a successful request, making every like cost
            // a full extra second.
            if (attempt < 2) await sleep(400 + attempt * 400);
        }
        return { status: null };
    }

    async function lbFetchRatings(statusEl) {
        const username = getLBUsername();
        if (!username) {
            setStatus(statusEl, t('lbUsernameNotFound'));
            return new Map();
        }
        const el = statusEl;
        const map = new Map();
        // Title index so the importer can recognise an already-rated film
        // before spending a search request on it.
        const byTitle = new Map();
        let seen = 0;
        const indexItem = (item, rating) => {
            if (!item.slug) return;
            if (!map.has(item.slug)) { map.set(item.slug, rating); seen++; }
            // Index every known spelling so a title that differs from the page
            // title still hits the fast path instead of falling through to search.
            for (const name of [item.title, item.titleRu, item.titleOrig, ...(item.allTitles || [])]) {
                const k = titleKey(name, item.year);
                if (k && !byTitle.has(k)) byTitle.set(k, item.slug);
            }
        };
        const write = (channel, label) => {
            const ch = channelWriter(el, channel, label);
            return (done, total) => ch(`${t('page')} ${done}/${total}`,
                { current: done, total, extra: `${seen} ${t('movies')}` });
        };
        // Both listings are independent and each owns its own row, so fetch them
        // together: sequentially they doubled the cost of every re-import before
        // a single film was even looked up.
        const [rated, watched] = await Promise.all([
            lbScrapePages(username, (u, p) => p === 1 ? `https://letterboxd.com/${u}/films/ratings/` : `https://letterboxd.com/${u}/films/ratings/page/${p}/`, parseLBRatings, 200,
                write('lbExistingRated', t('ratings'))),
            lbScrapePages(username, (u, p) => p === 1 ? `https://letterboxd.com/${u}/films/` : `https://letterboxd.com/${u}/films/page/${p}/`, parseLBWatched, 200,
                write('lbExistingWatched', t('lblExisting'))),
        ]);
        // Rated first so a rated film is never downgraded to plain "watched".
        for (const item of rated) indexItem(item, item.rating ?? 'watched');
        finishChannel(el, 'lbExistingRated', rated.length > 0, true);
        for (const item of watched) indexItem(item, 'watched');
        finishChannel(el, 'lbExistingWatched', watched.length > 0, true);
        map.byTitle = byTitle;
        return map;
    }

    async function performLBImport(csvData, statusEl, mode, deep = false, opts = {}) {
        const t0 = Date.now();
        const items = parseCSV(csvData);
        if (!items.length) return setStatus(statusEl, t('csvEmpty'));

        const csrfRef = { val: getLBCsrf() };
        if (!csrfRef.val) return setStatus(statusEl, t('csrfNotFound'));

        // Phase 1: resolve slugs
        Object.assign(lbProbe, makeProbe(25, PLATFORM_MAX.lb));
        beginRun(statusEl, `${items.length} ${t('movies')}`);
        // Load the existing profile FIRST: 773 of 899 films in a re-import are
        // already rated, and resolving them by search was the bulk of the time.
        const existing = mode === 'normal' && !deep ? await lbFetchRatings(statusEl) : new Map();
        const resolved = [];
        let cur = 0;
        const chResolve = channelWriter(statusEl, 'lbResolve', t('lblSearch'));
        let foundCount = 0;

        while (cur < items.length) {
            const slice = items.slice(cur, cur + lbProbe.c);
            const to = Math.min(cur + lbProbe.c, items.length);
            chResolve(`${cur + 1}–${to}/${items.length}`, { current: to, total: items.length, extra: `✓ ${foundCount}` });
            const t0 = Date.now();
            const res = await asyncPool(lbProbe.c, slice, i => {
                // Fast path: already on the profile → no search needed at all.
                if (mode === 'normal' && existing.size > 0 && existing.byTitle) {
                    let knownSlug = null;
                    for (const name of [i.title, i.titleRu, i.titleOrig, ...(i.allTitles || [])]) {
                        knownSlug = existing.byTitle.get(titleKey(name, i.year))
                            || existing.byTitle.get(titleKey(name));
                        if (knownSlug != null) break;
                    }
                    if (knownSlug != null && existing.has(knownSlug)) {
                        // Return the known slug even when it will be skipped in
                        // the apply phase: falling through to a search here was
                        // paying for a lookup of ~86% of a re-import, only for
                        // `toApply` to drop the item as already rated.
                        return Promise.resolve({ slug: knownSlug, filmId: null, lid: null, score: 1.0, confidence: 'high', filmIdKey: i.filmIdKey ?? null, ttIdKey: i.ttIdKey ?? null });
                    }
                }
                // Direct slug match (valid URL slug or film: ID)
                if (i.lbSlug && !deep) {
                    // Handle film:ID format (resolved later) and tv:slug format (used directly)
                    const filmIdMatch = i.lbSlug.match(/^film:(\d+)$/);
                    const tvSlugMatch = i.lbSlug.match(/^tv:(.+)$/);
                    if (filmIdMatch) {
                        // Internal LB film ID - use filmId directly, fetch slug later
                        const filmId = filmIdMatch[1];
                        return Promise.resolve({ slug: null, filmId, lid: null, score: 1.0, confidence: 'high' });
                    }
                    if (tvSlugMatch) {
                        // TV series slug from LB export — use directly
                        return Promise.resolve({ slug: i.lbSlug, filmId: null, lid: null, score: 1.0, confidence: 'high' });
                    }
                    if (/^[a-z0-9-]+$/i.test(i.lbSlug)) {
                        return Promise.resolve({ slug: i.lbSlug, filmId: null, lid: null, score: 1.0, confidence: 'high' });
                    }
                }
                // Exact id → one page fetch, no title search at all. An IMDb
                // CSV always carries TtId, so a 700-film IMDb→Letterboxd
                // import no longer pays ~2–8 search requests per film.
                // Series must stay on the search path: /imdb/tt…/ only maps
                // films and answers "IMDb ID Not found" for a TV series.
                if (i.ttId && /^tt\d+$/.test(i.ttId) && typeFamily(i.type) !== 'series') {
                    return lbResolveByImdbId(i.ttId, csrfRef).then(r => r ?? lbSearchFilm(i.title, i.year, csrfRef, deep, i.allTitles, i));
                }
                return lbSearchFilm(i.title, i.year, csrfRef, deep, i.allTitles, i);
            });
            let miss = 0;
            res.forEach((r, j) => {
                const found = r.status === 'fulfilled' ? r.value : null;
                if (!found || found.confidence === 'low') {
                    resolved.push({ item: slice[j], slug: null, filmId: null, lid: null });
                    miss++;
                } else {
                    foundCount++;
                    resolved.push({ item: slice[j], slug: found.slug, filmId: found.filmId, lid: found.lid });
                }
            });
            cur = to;
            const elapsed = Date.now() - t0;
            // An unresolved title is a normal outcome, not a network failure.
            // Treating every miss as one collapsed concurrency to MIN for the
            // rest of the run, which is what made big imports take minutes.
            miss / slice.length >= 0.5 ? probeFail(lbProbe) : probeOk(lbProbe, elapsed);
            // No artificial sleep between resolve batches
        }
        finishChannel(statusEl, 'lbResolve', foundCount > 0, true);

        // No slug-resolution phase: an item known by its internal film id can be
        // written directly through /s/film:{id}/rate/ and /watch/, so fetching
        // the film page just to learn its slug was one wasted request per row.

        // Decide what will actually be written BEFORE fetching any page ids:
        // `toApply` drops already-rated rows, and collecting ids for them was
        // one wasted film-page request per skipped movie (hundreds on a re-import).
        let rated = 0, watched = 0, skipped = 0, notFound = 0, failed = 0;
        const missed = [];
        const toApply = resolved.filter(x => {
            // An item is only truly unresolved when it has neither a slug nor an
            // internal film id. A failed slug lookup must not discard a rating
            // that can be written through /s/film:{id}/rate/.
            if (!x.slug && !x.filmId) {
                notFound++; missed.push({ ...x.item, error: t('errorNotFoundLB') }); return false;
            }
            const hasR = x.item.rating != null && String(x.item.rating) !== '' && +x.item.rating >= 1 && +x.item.rating <= 10;
            // A row known only by its internal id still matches the profile index
            // when that index was built from a listing without slugs.
            const ex = existing.get(x.slug) ?? (x.filmId ? existing.get('film:' + x.filmId) : undefined);
            if (mode === 'normal' && ex != null && (ex !== 'watched' || !hasR)) { skipped++; return false; }
            return true;
        });
        DEBUG && console.log(`[mrs] LB PHASE SUMMARY: CSV parsed=${items.length} resolved=${resolved.length} withSlug=${toApply.length} noSlug=${notFound} skipped=${skipped}`);

        // Pre-fetch missing ids for the rows that WILL be written. Search
        // results already carry filmId + lid; a bare slug needs one page
        // lookup, which yields both. A watched-only row always needs filmId
        // (rating can go through the LID), and so does a favorite: likes are
        // only writable through the form endpoint, which takes the numeric id.
        const needLid = toApply.filter(x => {
            if (!x.slug || x.filmId) return false;
            if (!x.lid) return true;
            const hasR = x.item.rating != null && String(x.item.rating) !== '' && +x.item.rating >= 1 && +x.item.rating <= 10;
            return !hasR || !!x.item.favorite;
        });
        if (needLid.length) {
            const chLids = channelWriter(statusEl, 'lbLids', t('lblDetails'));
            let lidDone = 0;
            const lidReport = () => chLids(`${lidDone}/${needLid.length}`, { current: lidDone, total: needLid.length });
            lidReport();
            const ids = await asyncPool(10, needLid, async x => {
                try { return await lbGetFilmIds(x.slug, csrfRef); }
                finally {
                    lidDone++;
                    if (lidDone % 5 === 0 || lidDone === needLid.length) lidReport();
                }
            });
            ids.forEach((r, i) => {
                if (r.status === 'fulfilled' && r.value) {
                    needLid[i].lid = r.value.lid;
                    needLid[i].filmId = r.value.filmId;
                }
            });
            chLids(`${needLid.length}/${needLid.length}`, { current: needLid.length, total: needLid.length });
            finishChannel(statusEl, 'lbLids', needLid.some(x => x.lid || x.filmId), true);
        }

        // Phase 2: apply
        Object.assign(lbProbe, makeProbe(25, PLATFORM_MAX.lb));
        // `existing` was loaded before phase 1 so that search could be skipped,
        // and `toApply` was decided before the id prefetch for the same reason.

        cur = 0;
        let favorites = 0;
        const chApply = channelWriter(statusEl, 'lbApply', t('lblApply'));
        while (cur < toApply.length) {
            const slice = toApply.slice(cur, cur + lbProbe.c);
            const to = Math.min(cur + lbProbe.c, toApply.length);
            chApply(`${cur + 1}–${to}/${toApply.length}`, { current: to, total: toApply.length, extra: `${rated} ${t('rated')}` });
            const t0 = Date.now();
            const res = await asyncPool(lbProbe.c, slice, entry => applyLBRating(entry.slug, entry.lid, entry.filmId, entry.item.rating, csrfRef, entry.item.watchedDate));
            let fail = 0;
            res.forEach((r, j) => {
                const st = r.status === 'fulfilled' ? (r.value?.status ?? null) : null;
                if (st === 'rated') rated++;
                else if (st === 'watched') watched++;
                else { failed++; fail++; missed.push({ ...toApply[cur + j].item, error: t('errorApi') }); }
            });
            cur = to;
            // A rejected write is a normal outcome (bad match, taken down film);
            // only a mostly-failing batch means the endpoint is pushing back.
            fail / slice.length >= 0.5 ? probeFail(lbProbe) : probeOk(lbProbe, Date.now() - t0);
        }
        if (toApply.length) chApply(`${toApply.length}/${toApply.length}`, { current: toApply.length, total: toApply.length, extra: `${rated} ${t('rated')}` });
        finishChannel(statusEl, 'lbApply', failed === 0, true);

        const favItems = opts.importFavorites !== false ? toApply.filter(x => x.item.favorite && x.filmId) : [];
        if (favItems.length) {
            const chFav = channelWriter(statusEl, 'lbFavorites', t('lblFavorites'));
            let favDone = 0;
            const favReport = () => chFav(`${favDone}/${favItems.length}`, { current: favDone, total: favItems.length });
            favReport();
            // Parallel favorites: the old serial loop with sleep(200) added
            // ~3.5 minutes for a thousand likes on top of the ratings.
            await asyncPool(4, favItems, async entry => {
                const r = await applyLBFavorite(entry.filmId, csrfRef);
                if (r.status === 'favorited') favorites++;
                favDone++;
                if (favDone % 5 === 0 || favDone === favItems.length) favReport();
            });
            favReport();
            finishChannel(statusEl, 'lbFavorites', true, true);
        }

        DEBUG && console.log(`[mrs] LB APPLY DONE: rated=${rated} watched=${watched} favorites=${favorites} failed=${failed} toApply=${toApply.length}`);
        searchCache.flush();
        renderLBResult({ rated, watched, skipped, notFound, failed, missed, favorites, elapsedMs: Date.now() - t0 }, statusEl, mode);
    }

    function renderLBResult(result, statusEl, mode) {
        const lbl = mode === 'replace' ? t('replaceMode') : '';
        const lbPairs = [
            [t('rated'), result.rated],
            [t('watchedShort'), result.watched],
            [t('skipped'), result.skipped],
            [t('notFound'), result.notFound],
            [t('failed'), result.failed],
        ];
        if (result.favorites != null) lbPairs.push([t('favorites'), result.favorites]);
        renderResult(statusEl, t('done', { mode: lbl }), lbPairs, result.notFound === 0 && result.failed === 0 ? t('allImported') : null, result.elapsedMs);
        if (result.missed.length) {
            downloadCSV(buildCSV(result.missed), 'lb_missed.csv');
            const btn = Object.assign(document.createElement('button'), {
                id: 'mrs-retry-lb',
                className: 'mrs-btn mrs-btn--secondary',
                textContent: t('deepSearchBtn', { count: result.missed.length }),
            });
            btn.addEventListener('click', async () => {
                beginRun(statusEl, t('deepSearch', { platform: 'Letterboxd' }));
                await performLBImport(buildCSV(result.missed), statusEl, mode, true, getImportOptions());
            });
            const btnWrap = document.createElement('div');
            btnWrap.style.padding = '0 18px 14px';
            btnWrap.appendChild(btn);
            statusEl.appendChild(btnWrap);
        }
    }

    // ====================== MODULE REGISTRY ======================

    const MODULES = {
        kp: {
            isActive: () => SITE.isKP,
            'export': performKPExport,
            'import': performKPImport,
            exportFileName: () => `kinopoisk_ratings_${new Date().toISOString().slice(0, 10)}.csv`,
        },
        imdb: {
            isActive: () => SITE.isIMDb,
            'export': performIMDbExport,
            'import': performIMDbImport,
            exportFileName: () => `imdb_ratings_${new Date().toISOString().slice(0, 10)}.csv`,
        },
        lb: {
            isActive: () => SITE.isLB,
            'export': performLBExport,
            'import': performLBImport,
            exportFileName: () => `letterboxd_ratings_${new Date().toISOString().slice(0, 10)}.csv`,
        },
    };

    // ====================== UI ======================

    // GM_addStyle fallback — some managers don't define it, which would crash the entire script
    const __mrsAddStyle = typeof GM_addStyle === 'function'
        ? GM_addStyle
        : (css) => {
            const s = document.createElement('style');
            s.textContent = css;
            (document.head || document.documentElement).appendChild(s);
        };
    __mrsAddStyle(`
        #mrs-wrap{--mrs-fg:#111;--mrs-fg-strong:#111;--mrs-muted:#6b7280;--mrs-meta:#9ca3af;--mrs-ok:#10b981;--mrs-fail:#e11d48;--mrs-fail-fg:#b91c1c;--mrs-done:#4b5563;--mrs-surface:#fff;--mrs-hairline:rgba(0,0,0,0.06);color-scheme:light;all:initial;position:fixed;bottom:24px;right:24px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:12px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:normal;text-align:initial;direction:ltr;color:var(--mrs-fg)}
        #mrs-wrap *{box-sizing:border-box}
        #mrs-panel{position:absolute;right:0;bottom:calc(100% + 12px);transform-origin:bottom right;background:#fff;border:1px solid rgba(0,0,0,0.12);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,0.12),0 0 0 1px rgba(0,0,0,0.02);padding:4px;display:flex;flex-direction:column;gap:0;max-height:calc(100vh - 160px);overflow-y:auto;transition:transform .3s cubic-bezier(.34,1.56,.64,1),opacity .25s ease;transform:scale(.95) translateY(10px);opacity:0;pointer-events:none}
        #mrs-panel.mrs--visible{transform:scale(1) translateY(0);opacity:1;pointer-events:auto}
        #mrs-launcher{width:44px;height:44px;border-radius:50%;border:1px solid rgba(0,0,0,0.12);background:#111;color:#fff;font:600 10px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;letter-spacing:.04em;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,0.18);display:flex;align-items:center;justify-content:center;padding:0;transition:transform .2s ease,background .2s ease}
        #mrs-launcher:hover{transform:scale(1.06);background:#222}
        #mrs-launcher:focus-visible{outline:2px solid #3b82f6;outline-offset:2px}
        .mrs-btn{padding:10px 16px;font-weight:600;border:none;border-radius:0;cursor:pointer;font-size:13px;letter-spacing:-.01em;transition:all .2s cubic-bezier(.4,0,.2,1);display:flex;align-items:center;gap:8px;background:#fff;color:#333}
        .mrs-btn:hover{background:#f5f5f5}
        .mrs-btn:first-child{border-radius:13px 13px 0 0}
        .mrs-btn:last-of-type{border-radius:0 0 13px 13px}
        .mrs-btn--primary{background:#111;color:#fff}
        .mrs-btn--primary:hover{background:#222}
        .mrs-btn--secondary{background:#f3f4f6;color:#111}
        .mrs-btn--secondary:hover{background:#e5e7eb}
        .mrs-btn--danger{color:#e11d48;background:#fff}
        .mrs-btn--danger:hover{background:#fee2e2}
        .mrs-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
        #mrs-status{all:initial;display:none;box-sizing:border-box;width:min(380px,calc(100vw - 48px));background:var(--mrs-surface);color:var(--mrs-fg);border:1px solid rgba(0,0,0,0.10);border-radius:18px;font:400 13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:left;direction:ltr;color-scheme:light;padding:0;overflow:hidden;box-shadow:0 24px 64px rgba(15,23,42,0.28),0 2px 8px rgba(15,23,42,.12);isolation:isolate;animation:mrs-fade-in .3s ease}
        #mrs-status *{box-sizing:border-box;text-shadow:none}
        #mrs-status,#mrs-status span,#mrs-status div,#mrs-status button{color:var(--mrs-fg)}
        @keyframes mrs-fade-in{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
        .mrs-status__header{padding:14px 18px;border-bottom:1px solid var(--mrs-hairline);font-weight:600;color:var(--mrs-fg-strong);display:flex;align-items:flex-start;gap:10px}
        .mrs-status__title{color:var(--mrs-fg-strong);font-weight:600;text-shadow:none;flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
        .mrs-status__timer{margin-left:auto;color:var(--mrs-muted);font-size:11px;font-weight:500;font-variant-numeric:tabular-nums;flex-shrink:0;padding-top:2px}
        .mrs-status__header--result{align-items:center;gap:8px;border-bottom:none}
        .mrs-status__channels{display:flex;flex-direction:column;gap:4px;padding:8px 22px 12px;color:var(--mrs-fg)}
        .mrs-status__row{display:flex;align-items:baseline;gap:6px;min-width:0;font-size:12px;line-height:1.5;color:var(--mrs-fg);padding-top:1px}
        .mrs-status__row-label{flex:0 0 auto;color:var(--mrs-fg-strong);font-weight:600;max-width:44%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .mrs-status__row-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--mrs-fg)}
        .mrs-status__row-main{color:var(--mrs-done)}
        .mrs-status__row-meta{color:var(--mrs-meta);font-variant-numeric:tabular-nums;margin-left:2px}
        .mrs-status__row-mark{flex:0 0 auto;margin-left:auto;color:var(--mrs-ok);font-weight:700}
        .mrs-status__row--fail .mrs-status__row-mark{color:var(--mrs-fail)}
        .mrs-status__row--fail .mrs-status__row-main{color:var(--mrs-fail-fg)}
        .mrs-status__row--done .mrs-status__row-main{color:var(--mrs-done)}
        .mrs-status__title-text{overflow-wrap:anywhere;color:inherit}
        .mrs-status__title-timer{margin-left:8px;color:var(--mrs-meta);font-size:11px;font-weight:500;font-variant-numeric:tabular-nums}
        @media (prefers-reduced-motion:reduce){.mrs-pulse{animation:none}}
        .mrs-status__progress{height:3px;background:rgba(0,0,0,0.04);border-radius:0 0 18px 18px;overflow:hidden}
        .mrs-status__progress-bar{height:100%;background:linear-gradient(90deg,#3b82f6,#8b5cf6);border-radius:0 2px 2px 0;transition:width .3s ease;width:0%}
        .mrs-pulse{width:8px;height:8px;border-radius:50%;background:#3b82f6;animation:mrs-pulse 1.5s ease-in-out infinite;flex-shrink:0}
        @keyframes mrs-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}
        .mrs-result-pairs{color:#444;font-size:12px;display:flex;flex-direction:column;gap:2px;flex:0 1 auto;min-width:0}
        .mrs-result-pair{display:inline-flex;align-items:center;gap:2px;white-space:nowrap}
        .mrs-result-label{color:#888;font-size:12px}
        .mrs-result-value{font-weight:600;color:#111;font-size:12px}
        .mrs-opts{display:flex;flex-direction:column;gap:6px;padding:10px 12px 8px;border-top:1px solid rgba(0,0,0,0.1)}
        .mrs-opts__row{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:#555;transition:color .15s}
        .mrs-opts__row:hover{color:#111}
        .mrs-opts__row input{margin:0;width:14px;height:14px;accent-color:#3b82f6;cursor:pointer}
        .mrs-lang-row{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid rgba(0,0,0,0.1);font-size:12px;color:#555}
        .mrs-lang-row label{font-weight:600;color:#333;white-space:nowrap}
        .mrs-lang-select{flex:1;padding:4px 8px;border:1px solid rgba(0,0,0,0.1);border-radius:8px;font-size:12px;background:#fff;color:#333;cursor:pointer;outline:none;transition:border-color .15s}
        .mrs-lang-select:hover{border-color:rgba(59,130,246,0.5)}
        .mrs-lang-select:focus{border-color:#3b82f6}
    `);

    let _mrsBuilding = false;
    function buildUI() {
        DEBUG && console.log("[mrs] buildUI called");
        if (document.getElementById('mrs-wrap')) return;
        if (_mrsBuilding) { console.warn('[mrs] buildUI already in progress, skipping'); return; }
        const mod = Object.values(MODULES).find(m => m.isActive());
        if (!mod) return;
        if (!document.body) { console.warn('[mrs] document.body not ready, deferring buildUI'); return false; }
        _mrsBuilding = true;
        try {
            const frag = document.createDocumentFragment();
            const wrap = document.createElement('div');
            wrap.id = 'mrs-wrap';

            const statusEl = document.createElement('div');
            statusEl.id = 'mrs-status';
            wrap.appendChild(statusEl);

            const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.csv' });
            fileInput.style.display = 'none';
            wrap.appendChild(fileInput);

            // --- Import options checkboxes ---
            const opts = getImportOptions();
            const cbFav = Object.assign(document.createElement('input'), { type: 'checkbox', checked: opts.importFavorites });
            cbFav.addEventListener('change', () => { opts.importFavorites = cbFav.checked; saveImportOptions(opts); });

            const labelFav = document.createElement('label');
            labelFav.className = 'mrs-opts__row';
            labelFav.title = t('importFavoritesHint');
            labelFav.appendChild(cbFav);
            labelFav.appendChild(document.createTextNode(t('importFavorites')));

            const optsDiv = document.createElement('div');
            optsDiv.className = 'mrs-opts';
            optsDiv.appendChild(labelFav);

            DEBUG && console.log('[mrs] buildUI: optsDiv created, children=', optsDiv.childNodes.length);
            // ---

            // --- Language selector ---
            const langRow = document.createElement('div');
            langRow.className = 'mrs-lang-row';
            const langLabel = document.createElement('label');
            langLabel.textContent = t('language');
            langLabel.htmlFor = 'mrs-lang-select';
            const langSelect = document.createElement('select');
            langSelect.id = 'mrs-lang-select';
            langSelect.className = 'mrs-lang-select';
            langSelect.title = t('languageHint');
            const supportedLangs = [['en', 'English'], ['ru', 'Русский'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'], ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어']];
            for (const [code, name] of supportedLangs) {
                const opt = document.createElement('option');
                opt.value = code;
                opt.textContent = name;
                if (code === __locale) opt.selected = true;
                langSelect.appendChild(opt);
            }
            langSelect.addEventListener('change', () => {
                applyLocale(langSelect.value);
            });
            langRow.appendChild(langLabel);
            langRow.appendChild(langSelect);
            DEBUG && console.log('[mrs] buildUI: langRow created, children=', langRow.childNodes.length);
            // ---
            let mode = 'normal';
            const btns = [];
            const setDisabled = v => btns.forEach(b => b.disabled = v);

            const btnExport = Object.assign(document.createElement('button'), { className: 'mrs-btn mrs-btn--primary', textContent: t('exportRatings'), title: t('exportHint') });
            btnExport.addEventListener('click', async () => {
                setDisabled(true);
                buildUI._collapsePanel?.();
                const exportStart = Date.now();
                // Fresh card for every run, so rows from a previous export never
                // linger and the user always sees exactly what is happening now.
                clearStatus(statusEl);
                try {
                    const csv = await mod.export(statusEl);
                    if (csv) {
                        const fname = typeof mod.exportFileName === 'function' ? mod.exportFileName() : mod.exportFileName;
                        downloadCSV(csv, fname);
                        renderResult(statusEl, t('exportDone'), [], null, Date.now() - exportStart);
                    }
                } catch (e) {
                    renderResult(statusEl, '❌ ' + (e.message ?? String(e)), [], null, Date.now() - exportStart);
                } finally { setDisabled(false); }
            });

            const btnImport = Object.assign(document.createElement('button'), { className: 'mrs-btn mrs-btn--secondary', textContent: t('importRatings'), title: t('importHint') });
            const btnReplace = Object.assign(document.createElement('button'), { className: 'mrs-btn mrs-btn--danger', textContent: t('hardImport'), title: t('hardImportHint') });

            btnImport.addEventListener('click', () => { mode = 'normal'; fileInput.click(); });
            btnReplace.addEventListener('click', () => { mode = 'replace'; fileInput.click(); });

            fileInput.addEventListener('change', async e => {
                const file = e.target.files?.[0];
                if (!file) return;
                fileInput.value = '';
                setDisabled(true);
                buildUI._collapsePanel?.();
                clearStatus(statusEl);
                statusEl.style.display = 'block';
                try { await mod.import(await file.text(), statusEl, mode, false, getImportOptions()); }
                finally { setDisabled(false); }
            });

            btns.push(btnExport, btnImport, btnReplace);
            const panel = document.createElement('div');
            panel.id = 'mrs-panel';
            panel.appendChild(btnExport);
            panel.appendChild(btnImport);
            panel.appendChild(btnReplace);
            panel.appendChild(optsDiv);
            panel.appendChild(langRow);

            // Collapsed launcher: keeps the fixed widget out of Kinopoisk's profile
            // dropdown (issue #3) while remaining one click away.
            const launcher = Object.assign(document.createElement('button'), {
                type: 'button',
                id: 'mrs-launcher',
                title: 'Movie Rating Sync',
            });
            // Cyclic arrow = "sync". Built with createElementNS so no innerHTML is needed.
            const SVG_NS = 'http://www.w3.org/2000/svg';
            const icon = document.createElementNS(SVG_NS, 'svg');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.setAttribute('width', '24');
            icon.setAttribute('height', '24');
            icon.setAttribute('aria-hidden', 'true');
            icon.setAttribute('focusable', 'false');
            const arc1 = document.createElementNS(SVG_NS, 'path');
            arc1.setAttribute('d', 'M20 12a8 8 0 0 1-13.66 5.66');
            const arc2 = document.createElementNS(SVG_NS, 'path');
            arc2.setAttribute('d', 'M4 12a8 8 0 0 1 13.66-5.66');
            const head1 = document.createElementNS(SVG_NS, 'path');
            head1.setAttribute('d', 'M17 3.5v4h-4');
            const head2 = document.createElementNS(SVG_NS, 'path');
            head2.setAttribute('d', 'M7 20.5v-4h4');
            for (const p of [arc1, arc2, head1, head2]) {
                p.setAttribute('fill', 'none');
                p.setAttribute('stroke', 'currentColor');
                p.setAttribute('stroke-width', '2');
                p.setAttribute('stroke-linecap', 'round');
                p.setAttribute('stroke-linejoin', 'round');
                icon.appendChild(p);
            }
            launcher.appendChild(icon);
            launcher.setAttribute('aria-controls', 'mrs-panel');
            launcher.setAttribute('aria-expanded', 'false');
            const setPanelOpen = (open) => {
                panel.classList.toggle('mrs--visible', open);
                launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
            };
            launcher.addEventListener('click', (e) => {
                e.stopPropagation();
                setPanelOpen(!panel.classList.contains('mrs--visible'));
            });

            DEBUG && console.log('[mrs] buildUI: panel children count after append=', panel.childNodes.length);
            wrap.appendChild(panel);
            wrap.appendChild(launcher);
            frag.appendChild(wrap);
            document.body.appendChild(frag);

            // Close on any click outside the widget (e.g. opening the profile menu).
            if (buildUI._onDocPointerDown) document.removeEventListener('pointerdown', buildUI._onDocPointerDown, true);
            buildUI._onDocPointerDown = (e) => {
                if (!panel.classList.contains('mrs--visible')) return;
                if (wrap.contains(e.target)) return;
                setPanelOpen(false);
            };
            document.addEventListener('pointerdown', buildUI._onDocPointerDown, true);

            // Collapse the panel when an action starts or the site UI is used.
            buildUI._collapsePanel = () => setPanelOpen(false);
        } catch (e) {
            console.error('[mrs] buildUI failed:', e);
            const partial = document.getElementById('mrs-wrap');
            if (partial) partial.remove();
        } finally {
            _mrsBuilding = false;
        }
        // SPA resilience: re-check UI still exists after delays
        if (buildUI._recheckTimers) buildUI._recheckTimers.forEach(clearTimeout);
        buildUI._recheckTimers = [];
        const recheck = (delay) => {
            const tid = setTimeout(() => {
                const wrap = document.getElementById('mrs-wrap');
                const panel = document.getElementById('mrs-panel');
                const hasOpts = !!panel?.querySelector('.mrs-opts');
                const hasLang = !!panel?.querySelector('.mrs-lang-row');
                if ((!wrap || !hasOpts || !hasLang) && document.body) {
                    DEBUG && console.log('[mrs] UI incomplete or removed by SPA, re-injecting (' + delay + 'ms)');
                    if (wrap) wrap.remove();
                    buildUI();
                }
            }, delay);
            buildUI._recheckTimers.push(tid);
        };
        recheck(100); recheck(500); recheck(2000);
    }

    // ====================== INIT ======================

    if (SITE.isKP || SITE.isIMDb || SITE.isLB) {
        // MutationObserver: re-inject if SPA removes our UI
        let _mrsObserver = null;
        let _mrsReinjectCount = 0;
        const MAX_REINJECT = 10;
        const _mrsSetupObserver = () => {
            if (!document.body) return;
            if (_mrsObserver) _mrsObserver.disconnect();
            const obs = new MutationObserver(() => {
                try {
                    const wrap = document.getElementById('mrs-wrap');
                    const panel = document.getElementById('mrs-panel');
                    const hasOpts = !!panel?.querySelector('.mrs-opts');
                    const hasLang = !!panel?.querySelector('.mrs-lang-row');
                    if ((!wrap || !hasOpts || !hasLang) && document.body) {
                        if (_mrsReinjectCount >= MAX_REINJECT) { obs.disconnect(); return; }
                        _mrsReinjectCount++;
                        DEBUG && console.log('[mrs] UI incomplete or removed by SPA, re-injecting');
                        if (wrap) wrap.remove();
                        buildUI();
                    }
                } catch (e) { console.error('[mrs] Observer error:', e.message); }
            });
            _mrsObserver = obs;
            obs.observe(document.body, { childList: true, subtree: true });
        };
        try {
            // If body isn't ready yet, wait for DOMContentLoaded
            if (document.body) {
                buildUI();
                _mrsSetupObserver();
            } else {
                DEBUG && console.log('[mrs] body not ready, waiting for DOMContentLoaded');
                document.addEventListener('DOMContentLoaded', () => {
                    buildUI();
                    _mrsSetupObserver();
                }, { once: true });
            }
            const reinit = () => setTimeout(buildUI, 500);
            window.addEventListener('popstate', reinit);
            const _push = history.pushState.bind(history);
            history.pushState = (...a) => { _push(...a); reinit(); };
            const _replace = history.replaceState.bind(history);
            history.replaceState = (...a) => { _replace(...a); reinit(); };

        } catch (e) {
            console.error('[mrs] Init error:', e.message, e.stack);
        }
    }
    // ====================== KP FAVORITE DIAGNOSTIC ======================
    // Call `mrsDiagnoseKPFavorite()` from the console while on a KP film page,
    // then click the ♥ heart (favorite) button. The captured GraphQL request
    // will be logged so we can fix the MovieSetFavorite mutation.
    window.mrsDiagnoseKPFavorite = function () {
        const origFetch = window.fetch;
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;

        function logReq(type, url, body, resp) {
            DEBUG && console.log(`%c[mrs-diag] === KP FAVORITE DIAGNOSTIC ===`, 'font-size:14px;font-weight:bold;color:#f59e0b');
            DEBUG && console.log(`%cURL: ${url}`, 'color:#3b82f6');
            if (body) {
                try { DEBUG && console.log(`%cREQUEST:`, 'color:#10b981', JSON.parse(body)); }
                catch { DEBUG && console.log(`%cREQUEST:`, 'color:#10b981', body); }
            }
            if (resp) {
                try { DEBUG && console.log(`%cRESPONSE:`, 'color:#8b5cf6', typeof resp === 'string' ? JSON.parse(resp) : resp); }
                catch { DEBUG && console.log(`%cRESPONSE:`, 'color:#8b5cf6', resp); }
            }
            DEBUG && console.log(`%c====================================`, 'font-size:14px;font-weight:bold;color:#f59e0b');
        }

        // Intercept XHR
        XMLHttpRequest.prototype.open = function (method, url, ...args) {
            this._mrsUrl = url;
            this._mrsMethod = method;
            return origOpen.call(this, method, url, ...args);
        };
        XMLHttpRequest.prototype.send = function (body) {
            if (this._mrsUrl && typeof this._mrsUrl === 'string' &&
                this._mrsUrl.includes('graphql.kinopoisk.ru')) {
                const url = this._mrsUrl;
                const b = body;
                this.addEventListener('load', function () {
                    logReq('XHR', url, b, this.responseText);
                });
                this.addEventListener('error', function () {
                    console.warn('[mrs-diag] XHR error:', url);
                });
            }
            return origSend.call(this, body);
        };

        // Intercept fetch
        window.fetch = function (input, init) {
            const url = typeof input === 'string' ? input : (input?.url || '');
            if (typeof url === 'string' && url.includes('graphql.kinopoisk.ru')) {
                const body = init?.body || '';
                return origFetch.call(window, input, init).then(function (resp) {
                    resp.clone().text().then(function (text) {
                        logReq('fetch', url, body, text);
                    }).catch(function () { });
                    return resp;
                }).catch(function (e) {
                    console.warn('[mrs-diag] fetch error:', url, e.message);
                    throw e;
                });
            }
            return origFetch.call(window, input, init);
        };

        // Add click listener on the page to help detect favorite button clicks.
        // Declared as a const: the named function expression used to be scoped to
        // itself, so removeEventListener below could never actually detach it.
        const mrsFavClick = (e) => {
            const target = e.target;
            if (!target || typeof target.closest !== 'function') return;
            const isFavBtn = target.closest('[class*="favorite"], [class*="favourite"], [aria-label*="favorite"], [aria-label*="избран"], button[class*="heart"], a[class*="heart"], svg[class*="heart"]');
            if (isFavBtn) {
                DEBUG && console.log(`%c[mrs-diag] 🖱️ Favorite button clicked! Check XHR/fetch logs above.`, 'font-size:13px;font-weight:bold;color:#ef4444');
            }
        };
        document.addEventListener('click', mrsFavClick, true);

        DEBUG && console.log(`%c[mrs-diag] ✅ Diagnostic active!`, 'font-size:16px;font-weight:bold;color:#22c55e');
        DEBUG && console.log(`%c[mrs-diag] Instructions:`, 'font-weight:bold');
        DEBUG && console.log(`  1. Navigate to a Kinopoisk film page (e.g., /film/12345/)`);
        DEBUG && console.log(`  2. Click the ♥ heart (Избранное / Favorite) button`);
        DEBUG && console.log(`  3. Check the console for the captured GraphQL request ↓`);
        DEBUG && console.log(`%c[mrs-diag] To disable, call: mrsDisableKPFavorite()`, 'color:#f59e0b');

        return function disable() {
            XMLHttpRequest.prototype.open = origOpen;
            XMLHttpRequest.prototype.send = origSend;
            window.fetch = origFetch;
            document.removeEventListener('click', mrsFavClick, true);
            DEBUG && console.log('%c[mrs-diag] ❌ Diagnostic disabled.', 'font-size:13px;font-weight:bold;color:#ef4444');
        };
    };

    // Helper to easily disable diagnostic
    window.mrsDisableKPFavorite = function () {
        if (window.__mrsDiagDisable) {
            window.__mrsDiagDisable();
            window.__mrsDiagDisable = null;
        }
    };
    // Patch window.mrsDiagnoseKPFavorite to store the disable function
    const _origDiag = window.mrsDiagnoseKPFavorite;
    window.mrsDiagnoseKPFavorite = function () {
        if (window.__mrsDiagDisable) window.__mrsDiagDisable();
        window.__mrsDiagDisable = _origDiag();
        return window.__mrsDiagDisable;
    };

})();
