# Синхронизация Кинооценок (Movie Rating Sync)

<p align="center">
  <img src="https://img.shields.io/badge/License-GPL--3.0-blue.svg" alt="GPL-3.0 License">
  <img src="https://img.shields.io/badge/Platform-Tampermonkey%20%7C%20Violentmonkey-orange" alt="Platform Support">
  <img src="https://img.shields.io/badge/Status-Active-success" alt="Status Active">
</p>

<p align="center">
  Userscript для переноса, синхронизации и резервного копирования оценок фильмов между
  <a href="https://www.kinopoisk.ru/">Кинопоиском</a>,
  <a href="https://www.imdb.com/">IMDb</a>
  и
  <a href="https://letterboxd.com/">Letterboxd</a>.
</p>

<p align="center">
  🇺🇸 <a href="./README.md">English version</a>
</p>

---

## Возможности

* 🔄 Импорт и экспорт оценок между сервисами
* 📦 Универсальный CSV-формат для резервных копий
* 🧠 Умное сопоставление фильмов (транслитерация, fuzzy matching, год)
* ⚡ Два режима импорта — обычный и жёсткий (с перезаписью)
* 🛡️ Адаптивная задержка для защиты от лимитов запросов
* 🔍 Глубокий HTTP-поиск для отсутствующих фильмов

---

## Поддерживаемые сервисы

| Сервис     | Экспорт | Импорт |
| :--------- | :-----: | :----: |
| Кинопоиск  |   ✅    |   ✅   |
| IMDb       |   ✅    |   ✅   |
| Letterboxd |   ✅    |   ✅   |

---

## Установка

### 1. Установите менеджер userscript

* [Tampermonkey](https://www.tampermonkey.net/) (рекомендуется)
* [Violentmonkey](https://violentmonkey.github.io/)

### 2. Установите скрипт

Откройте файл: [`movie-rating-sync.user.js`](./movie-rating-sync.user.js)

Нажмите кнопку **Raw**, менеджер автоматически предложит установку.

---

## Использование

### Экспорт

1. Откройте профиль на исходном сервисе  
2. Нажмите `📥 Экспорт оценок`  
3. Сохраните CSV-файл  

### Импорт

1. Откройте целевой сервис  
2. Нажмите `📥 Импорт` или `🔄 Жёсткий импорт`  
3. Выберите CSV-файл  
4. Дождитесь завершения  

---

## Для чего можно использовать

* Перенос оценок между Кинопоиском, IMDb и Letterboxd
* Экспорт оценок фильмов в CSV
* Резервное копирование оценок
* Миграция между кино-сервисами
* Синхронизация оценок между платформами

---

## Особенности Жёсткого импорта

Автоматическое сопоставление фильмов не всегда идеально.

Используются:
* транслитерация
* fuzzy matching
* допуск по году
* HTTP fallback поиск

Редкие или локализованные фильмы могут требовать ручной проверки. Скрипт часто их путает.

---

## Лицензия

GPL-3.0 License

---

## Вклад

Issues и pull request'ы приветствуются.
