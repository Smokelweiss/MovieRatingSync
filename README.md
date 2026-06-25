# Movie Ratings Sync

Синхронизация оценок фильмов между [Кинопоиском](https://www.kinopoisk.ru/), [IMDb](https://www.imdb.com/) и другими сервисами.

## Возможности

- **Экспорт** — выгрузка ваших оценок Кинопоиска в CSV
- **Импорт** — загрузка оценок на IMDb с автоматическим подбором названий
- **Умный поиск** — транслитерация, нечёткое сравнение, допуск по году
- **Два режима:**
  - *Обычный* — пропускает уже оценённые/просмотренные фильмы
  - *Замена* — перезаписывает существующие оценки
- **Адаптивная задержка** — автоматически подстраивает скорость под лимиты сервера
- **Глубокий поиск** — HTTP-поиск для фильмов, не найденных в локальном кэше

## Поддерживаемые сервисы

| Сервис    | Экспорт | Импорт |
|-----------|---------|--------|
| Кинопоиск | ✅      | ❌     |
| IMDb      | ❌      | ✅     |
| Letterboxd| 🔜     | 🔜    |

## Установка

1. Установите менеджер пользовательских скриптов ([Tampermonkey](https://www.tampermonkey.net/), [Violentmonkey](https://violentmonkey.github.io/))
2. Откройте [`movie-ratings-sync.user.js`](movie-ratings-sync.user.js) и нажмите «Raw» — менеджер предложит установить
3. Или вставьте скрипт вручную в новый пользовательский скрипт

## Использование

### Кинопоиск → CSV
1. Перейдите в свой профиль на Кинопоиске
2. Нажмите **📥 Экспорт оценок в CSV**

### CSV → IMDb
1. Перейдите на IMDb, войдя в аккаунт
2. Нажмите **📥 Импортировать** или **🔄 Жёсткий импорт**
3. Выберите CSV-файл

---

# Movie Rating Sync

Sync movie ratings across [Kinopoisk](https://www.kinopoisk.ru/), [IMDb](https://www.imdb.com/) and more.

## Features

- **Export** — download your Kinopoisk ratings as CSV
- **Import** — upload ratings to IMDb with automatic title matching
- **Smart matching** — transliteration, fuzzy search, year tolerance
- **Two modes:**
  - *Normal* — skip already rated/watched titles
  - *Replace* — overwrite existing ratings
- **Adaptive throttling** — auto-adjusts speed to avoid 429 errors
- **Deep search** — fallback HTTP search for titles not found in local cache

## Supported Services

| Service   | Export | Import |
|-----------|--------|--------|
| Kinopoisk | ✅     | 🔜     |
| IMDb      | 🔜     | ✅     |
| Letterboxd| 🔜    | 🔜    |

## Installation

1. Install a userscript manager ([Tampermonkey](https://www.tampermonkey.net/), [Violentmonkey](https://violentmonkey.github.io/))
2. Open [`movie-ratings-sync.user.js`](movie-ratings-sync.user.js) and click "Raw" — your manager will prompt install
3. Or paste the script manually into a new userscript

## Usage

### Kinopoisk → CSV
1. Go to your Kinopoisk profile
2. Click **📥 Экспорт оценок в CSV**

### CSV → IMDb
1. Go to IMDb while logged in
2. Click **📥 Импортировать** or **🔄 Жёсткий импорт**
3. Select the CSV file

## License

[GPL-3.0](LICENSE)

## Support

Found a bug? Have a feature request? Open an [issue](https://github.com/Smokelweiss/MovieRatingsSync/issues).
