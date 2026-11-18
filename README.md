# Movie Rating Sync

<p align="center">
  <img src="https://img.shields.io/badge/License-GPL--3.0-blue.svg" alt="GPL-3.0 License">
  <img src="https://img.shields.io/badge/Platform-Tampermonkey%20%7C%20Violentmonkey-orange" alt="Platform Support">
</p>

---

🌐 **Language / Выберите язык:**
* [🇺🇸 English (Default)](#-movie-rating-sync-english)
* [🇷🇺 Русский](#-movie-rating-sync-русский)

---

## 🇺🇸 Movie Rating Sync (English)

A cross-platform userscript to sync, backup, and migrate your movie ratings between **Kinopoisk**, **IMDb**, and **Letterboxd**.

### ✨ Features

* **🔄 Full Cross-Platform Support** — Import and export are available on all supported websites.
* **📦 Universal CSV Format** — Download your ratings from any service into one structured CSV file.
* **🧠 Smart Title Matching** — Transliteration, fuzzy search, and release-year tolerance map titles across services.
* **⚡ Dual Sync Modes** — *Normal Mode* skips already rated/watched titles; *Replace Mode* overwrites them.
* **⭐ Favorites Support** — Films marked as favorites in the CSV can be added to your favorites on the target platform.
* **🛡️ Adaptive Throttling** — Request speed adapts to server responses (429 / Retry-After handling) to avoid rate limits.
* **🌍 9 Languages** — English, Russian, Spanish, French, German, Portuguese, Chinese, Japanese, Korean.
* **💾 Local Cache** — Search results are cached in IndexedDB (with GM storage fallback) so repeat syncs are fast.

### 📊 Supported Services

| Service | Export | Import | Favorites |
| :--- | :---: | :---: | :---: |
| **Kinopoisk** | ✅ | ✅ | ✅ |
| **IMDb** | ✅ | ✅ | ✅ |
| **Letterboxd** | ✅ | ✅ | ✅ |

### 🚀 Installation

**Option A — browser extension (recommended)**

The extension ships the same engine as a native WebExtension, so it keeps working when a site tightens its CSP.

* **Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `extension/manifest.firefox.json`.
* **Chrome / Edge:** `chrome://extensions` (or `edge://extensions`) → enable **Developer mode** → **Load unpacked** → pick the `extension` folder.
* The icon shows up in the toolbar; the in-page launcher is the round **sync-arrow** button in the bottom-right corner.

**Option B — userscript**

1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) *(recommended)* or [Violentmonkey](https://violentmonkey.github.io/).
2. Open [`movie-rating-sync.user.js`](movie-rating-sync.user.js) in this repository.
3. Click **Raw** — your userscript manager will offer to install it.

### 📖 How To Use

1. Log into your profile on the **source** site (e.g. Kinopoisk) and click **📤 Export Ratings** to download the CSV.
2. Log into the **destination** site (e.g. IMDb).
3. Click **📥 Import** (or **🔄 Hard Import** to overwrite existing ratings), pick the CSV, and watch the progress.
4. Optionally tick **Import favorites** so favorites from the CSV are added on the destination.

### 🧪 Development

* `node --check movie-rating-sync.user.js` — syntax check.
* `node tools/build-extension.js` — **required after every userscript change**: regenerates `extension/content.js` from the userscript (the userscript is the single source of truth).
* `powershell -File tools/make-icons.ps1` — regenerates `extension/icons/*` from `icon.png`.
* `node tests/pure-functions.test.js` — pure-function unit tests.
* `node tests/i18n.test.js` — translation key parity checks.
* `node tests/extension-build.test.js` - checks the generated extension file still honours its GM_* shim and launcher icon.
* `node tests/title-key.test.js` - checks `titleKey()`, the lookup that lets a re-import skip films already on the profile without a network search.
* Manual test guide: [`MANUAL_TEST_GUIDE.md`](MANUAL_TEST_GUIDE.md)

**Import performance.** A re-import used to take ~12 minutes for 899 films because every film was searched on the network first and only then discarded as "already rated" (about 86% of the work). Both importers now build a `titleKey(title, year)` index from the existing profile and skip a film *before* searching. Keep that order in `runKPImportBatch` and `performLBImport`, and keep `fetchT` returning `null` on failure (retry logic depends on it).

---

## 🇷🇺 Movie Rating Sync (Русский)

Кроссплатформенный пользовательский скрипт для синхронизации, резервного копирования и переноса оценок фильмов между **Кинопоиском**, **IMDb** и **Letterboxd**.

### ✨ Возможности

* **🔄 Полная кроссплатформенность** — Импорт и экспорт работают на всех поддерживаемых сайтах.
* **📦 Универсальный CSV-формат** — Выгрузка оценок с любого сервиса в единый файл.
* **🧠 Умный поиск** — Транслитерация, нечёткое сравнение названий и допуск по году.
* **⚡ Два режима работы** — *Обычный* пропускает уже оценённые фильмы; *Жёсткий* перезаписывает.
* **⭐ Избранное** — Фильмы из CSV, отмеченные как избранные, добавляются в избранное на целевом сайте.
* **🛡️ Адаптивная задержка** — Скрипт подстраивается под ответы серверов (429 / Retry-After).
* **🌍 9 языков** — Английский, русский, испанский, французский, немецкий, португальский, китайский, японский, корейский.
* **💾 Локальный кэш** — Результаты поиска кэшируются в IndexedDB (с запасным GM-хранилищем).

### 📊 Поддерживаемые сервисы

| Сервис | Экспорт | Импорт | Избранное |
| :--- | :---: | :---: | :---: |
| **Кинопоиск** | ✅ | ✅ | ✅ |
| **IMDb** | ✅ | ✅ | ✅ |
| **Letterboxd** | ✅ | ✅ | ✅ |

### 🚀 Установка

**Вариант A — расширение браузера (рекомендуется)**

Расширение содержит тот же движок, что и скрипт, но как полноценный WebExtension — оно продолжает работать, когда сайт ужесточает CSP.

* **Firefox:** `about:debugging#/runtime/this-firefox` → **Загрузить временное дополнение** → выберите `extension/manifest.firefox.json`.
* **Chrome / Edge:** `chrome://extensions` (или `edge://extensions`) → включите **Режим разработчика** → **Загрузить распакованное** → выберите папку `extension`.
* Иконка появится на панели; на странице — круглая кнопка со **стрелками синхронизации** в правом нижнем углу.

**Вариант B — пользовательский скрипт**

1. Установите менеджер пользовательских скриптов: [Tampermonkey](https://www.tampermonkey.net/) *(рекомендуется)* или [Violentmonkey](https://violentmonkey.github.io/).
2. Откройте файл [`movie-rating-sync.user.js`](movie-rating-sync.user.js) в этом репозитории.
3. Нажмите **Raw** — менеджер скриптов предложит установку.

### 📖 Инструкция

1. Войдите в профиль на **исходном** сайте (например, на Кинопоиск) и нажмите **📤 Экспорт оценок** — CSV сохранится на диск.
2. Войдите на **целевой** сайт (например, IMDb).
3. Нажмите **📥 Импортировать** (или **🔄 Полная замена** для перезаписи), выберите CSV и следите за прогрессом.
4. При желании включите опцию **Импортировать избранное**.

### 🧪 Разработка

* `node --check movie-rating-sync.user.js` — проверка синтаксиса.
* `node tools/build-extension.js` — **обязательно после каждой правки скрипта**: пересобирает `extension/content.js` из `movie-rating-sync.user.js` (скрипт — единственный источник истины).
* `powershell -File tools/make-icons.ps1` — пересобирает `extension/icons/*` из `icon.png`.
* `node tests/pure-functions.test.js` — юнит-тесты чистых функций.
* `node tests/i18n.test.js` — проверка паритета ключей переводов.
* `node tests/extension-build.test.js` — проверяет, что собранный файл расширения по-прежнему работает с GM_*-шихтой и иконкой лаунчера.
* Руководство по ручному тестированию: [`MANUAL_TEST_GUIDE.md`](MANUAL_TEST_GUIDE.md)

---

### 📄 License

Distributed under the [GPL-3.0](LICENSE) License.

### 🤝 Support & Contribution

Found a bug or have a feature request? Open an [issue](https://github.com/Smokelweiss/MovieRatingSync/issues). Pull requests are welcome!
