# Privacy Policy for Movie Rating Sync

**Last updated:** August 7, 2026

## What this userscript does

Movie Rating Sync is a userscript that helps you export and import movie ratings between Kinopoisk, IMDb, and Letterboxd.

## Data collection

This userscript **does not collect, store, or transmit any personal data to any external servers** operated by the author. All operations run locally in your browser and interact only with the websites you are logged into.

### What data is processed

- Movie titles, ratings, watch dates, and favorite status read from the pages you visit on Kinopoisk, IMDb, and Letterboxd
- CSV files that you choose to import or export (stored only on your local machine)
- Your user IDs / usernames on the three platforms, read from the pages to locate your ratings

### How data is used

- **Export**: reads movie data from the current page and downloads a CSV file to your computer.
- **Import**: reads a CSV file you select and sends ratings to the respective website's own API, exactly as if you had rated them in the browser yourself.
- **Caching**: search results and film details are cached locally in the browser's IndexedDB (with a userscript-manager storage fallback) to speed up repeat syncs. This data never leaves your browser.

## Data storage

- Exported CSV files are saved to your computer's Downloads folder.
- Cache data is stored in your browser's IndexedDB / userscript-manager storage and is cleared when you uninstall the userscript.
- No data is sent to third-party analytics or advertising services.

## Permissions

The userscript requests access to Kinopoisk, IMDb, and Letterboxd only to read and write your movie rating data on those platforms. This data never leaves your browser beyond the interactions with those websites' own APIs.

## Third parties

This userscript does not use any third-party analytics, tracking, or advertising services.

## Changes

If this policy changes, you will be notified via the repository release notes.

## Contact

For questions, open an issue at: https://github.com/Smokelweiss/MovieRatingSync/issues
