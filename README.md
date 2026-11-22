<p align="center">
  <img src="icon.png" width="120" alt="Movie Rating Sync">
</p>

<h1 align="center">Movie Rating Sync</h1>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/English-1f6feb?style=for-the-badge" alt="English"></a>
  <a href="README.ru.md"><img src="https://img.shields.io/badge/%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-6e7781?style=for-the-badge" alt="Русский"></a>
  <a href="README.uk.md"><img src="https://img.shields.io/badge/%D0%A3%D0%BA%D1%80%D0%B0%D1%97%D0%BD%D1%81%D1%8C%D0%BA%D0%B0-6e7781?style=for-the-badge" alt="Українська"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-GPL--3.0-blue.svg" alt="GPL-3.0 License">
  <img src="https://img.shields.io/badge/Platform-Firefox%20%7C%20Chrome%20%7C%20Tampermonkey%20%7C%20Violentmonkey-orange" alt="Platform Support">
  <img src="https://img.shields.io/badge/Services-Kinopoisk%20%7C%20IMDb%20%7C%20Letterboxd-success" alt="Supported services">
</p>

<p align="center">
  Move your movie ratings between
  <a href="https://www.kinopoisk.ru/">Kinopoisk</a>,
  <a href="https://www.imdb.com/">IMDb</a>
  and
  <a href="https://letterboxd.com/">Letterboxd</a>
  — as a browser extension or a userscript.
</p>

```
┌──────────────┐    CSV export     ┌──────────────────┐   CSV import   ┌──────────────┐
│  Kinopoisk   │ ────────────────▶ │  Movie Rating    │ ─────────────▶ │    IMDb      │
│  IMDb        │                   │  Sync (in-page)  │                │  Letterboxd  │
│  Letterboxd  │ ◀──────────────── │                  │ ◀───────────── │              │
└──────────────┘                   └──────────────────┘                └──────────────┘
```

* **One CSV — every platform.** Export your ratings from any supported service, import them into any other one. The file is plain, readable CSV, so it doubles as a backup you own.
* **Two import modes.** *Import* only fills the gaps and skips films you already rated (`IMDb id` / `Kinopoisk id` / Letterboxd slug are reused, not re-searched). *Hard Import* overwrites existing ratings — the button is labelled **Replace All** and asks before it starts.
* **Matching that refuses to guess.** Titles are matched by id first, then by exact title, transliteration, year tolerance and alternative titles. A shared middle word earns nothing, and a year that disagrees blocks the write — a rating never lands on a namesake film just because the names look similar.
* **Built for large libraries.** Search results are cached in IndexedDB (7 days), already-rated films are filtered out before any network call, and request speed adapts to `429 / Retry-After` answers.
* **Favorites.** Films flagged as favorite in the CSV can be added to favorites on the target profile.
* **9 interface languages.** English, Russian, Spanish, French, German, Portuguese, Chinese, Japanese and Korean — switchable in the panel.

## Supported services

| Service | Export | Import | Favorites |
| :--- | :---: | :---: | :---: |
| **Kinopoisk** | ✅ | ✅ | ✅ |
| **IMDb** | ✅ | ✅ | ✅ |
| **Letterboxd** | ✅ | ✅ | ✅ |

## Installation

### Browser extension (recommended)

The extension ships the same engine as a native WebExtension, so it keeps working when a site tightens its CSP.

* **Firefox:** install it from [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/movie-rating-sync/), or load `extension/manifest.firefox.json` from `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on*.
* **Chrome / Edge:** open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**, click **Load unpacked** and pick the `extension` folder.
* The round sync-arrow launcher appears in the bottom-right corner of Kinopoisk, IMDb and Letterboxd pages.

### Userscript

1. Install a userscript manager — [Tampermonkey](https://www.tampermonkey.net/) (recommended) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open [`movie-rating-sync.user.js`](movie-rating-sync.user.js) in this repository and click **Raw** — the manager offers to install it.
3. Updates arrive automatically from the `@updateURL` in the script header.

## Usage

1. Log into the **source** service (for example Kinopoisk) and click **Export Ratings** — a CSV file downloads.
2. Log into the **destination** service (for example IMDb).
3. Click **Import** (or **Hard Import → Replace All** to overwrite existing ratings), pick the CSV, and watch the progress panel.
4. Optionally tick **Import favorites** so favorites from the CSV are added on the destination.

Every run ends with counts — `Rated`, `Watched`, `Skipped`, `Not found`, `Errors` — and a **missed** CSV you can feed back into a second run.

## Matching notes

Cross-service matching is the hard part of this project, and the rules are deliberately conservative:

* An exact id (`tt…`, Kinopoisk film id, Letterboxd slug) always wins over any title evidence.
* `exact` title matches also require a compatible release year (or no year at all).
* `substring` matches require an agreeing year; Hard Import lowers the confidence bar, never the year bar.
* RU↔EN titles are bridged through transliteration plus IMDb's own suggestion list, and only when the year agrees.
* Letterboxd→IMDb resolves through the film page itself (`More at imdb.com/title/…`), which is an exact id, not a title guess.

Rare, regional or unreleased titles can still be missing from the target service. Those arrive in the missed CSV instead of as a wrong rating.

## Development

The userscript is the single source of truth; the extension is generated from it.

* `node --check movie-rating-sync.user.js` — syntax check.
* `node tools/build-extension.js` — **required after every userscript change**: regenerates `extension/content.js` (the `GM_*` shim lives in this script, not in the userscript).
* `node tests/extension-build.test.js` — checks the generated extension against the userscript (version, shim, launcher).
* `node tests/pure-functions.test.js`, `node tests/i18n.test.js`, `node tests/match-guards.test.js`, `node tests/title-key.test.js` — unit and parity tests.
* `node tests/matcher-harness.js` — dry-run matcher over the real CSVs in the repo; use `--limit`, `--filter`, `--trace`.
* Manual checklist: [`MANUAL_TEST_GUIDE.md`](MANUAL_TEST_GUIDE.md).

Releases: pushing a tag (`v1.11`, `v1.12` …) runs `.github/workflows/release.yml`, which rebuilds both builds, publishes the Firefox package to Mozilla Add-ons and attaches all artifacts to a tagged GitHub release.

## Privacy

The script talks only to the sites you are already logged into. There is no telemetry and no third-party server — see [PRIVACY.md](PRIVACY.md).

## License

GPL-3.0. Issues and pull requests are welcome.
