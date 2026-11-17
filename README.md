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

1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) *(recommended)* or [Violentmonkey](https://violentmonkey.github.io/).
2. Open [`movie-rating-sync.user.js`](movie-rating-sync.user.js) in this repository.
3. Click **Raw** — your userscript manager will offer to install it.

### 📖 How To Use

1. Log into your profile on the **source** site (e.g. Kinopoisk) and click **📤 Export Ratings** to download the CSV.
2. Log into the **destination** site (e.g. IMDb).
3. Click **📥 Import** (or **🔄 Hard Import** to overwrite existing ratings), pick the CSV, and watch the progress.
4. Optionally tick **Import favorites** so favorites from the CSV are added on the destination.

### 🧪 Development

* `node -c movie-rating-sync.user.js` — syntax check.
* `node tests/pure-functions.test.js` — pure-function unit tests.
* `node tests/i18n.test.js` — translation key parity checks.
* Manual test guide: [`MANUAL_TEST_GUIDE.md`](MANUAL_TEST_GUIDE.md)

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

1. Установите менеджер пользовательских скриптов: [Tampermonkey](https://www.tampermonkey.net/) *(рекомендуется)* или [Violentmonkey](https://violentmonkey.github.io/).
2. Откройте файл [`movie-rating-sync.user.js`](movie-rating-sync.user.js) в этом репозитории.
3. Нажмите **Raw** — менеджер скриптов предложит установку.

### 📖 Инструкция

1. Войдите в профиль на **исходном** сайте (например, на Кинопоиск) и нажмите **📤 Экспорт оценок** — CSV сохранится на диск.
2. Войдите на **целевой** сайт (например, IMDb).
3. Нажмите **📥 Импортировать** (или **🔄 Полная замена** для перезаписи), выберите CSV и следите за прогрессом.
4. При желании включите опцию **Импортировать избранное**.

### 🧪 Разработка

* `node -c movie-rating-sync.user.js` — проверка синтаксиса.
* `node tests/pure-functions.test.js` — юнит-тесты чистых функций.
* `node tests/i18n.test.js` — проверка паритета ключей переводов.
* Руководство по ручному тестированию: [`MANUAL_TEST_GUIDE.md`](MANUAL_TEST_GUIDE.md)

---

### 📄 License

Distributed under the [GPL-3.0](LICENSE) License.

### 🤝 Support & Contribution

Found a bug or have a feature request? Open an [issue](https://github.com/Smokelweiss/MovieRatingSync/issues). Pull requests are welcome!
