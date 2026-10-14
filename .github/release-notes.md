Note formats — templates in the spirit of Zotero Integration.

- **Note formats.** Define formats in the settings: a name, a note template, a highlights-block template and a path pattern. Every format gets its own command; a book picker creates the note in the right place, with the `beresta-format` property. Two ready formats, "Book" and "Article", are one button away.
- **Templates, second version.** Paths, filters, `if/elif/else`, `for` with `loop`, whitespace trimming the way Nunjucks does it; the old syntax keeps working. A broken template is reported with its line number.
- **More about each book in the snapshot.** Kind, subtitle, publisher, publication date, language, series, tags and shelves, reading status, rating — all available to templates.
- **Fixes.** A backslash in a book title no longer breaks the shard file name; a failed repeated merge is reported instead of passing silently; a damaged backup index is set aside and named; frontmatter values go through a YAML filter, so an article title cannot add properties, and a path pattern cannot leave the folder.
- The interface language now comes from Obsidian's own `getLanguage()`.

Install by hand: put `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/beresta/` and enable the plugin in settings.

Without the Beresta app there is nothing to show: the snapshot it reads is written by the app into your vault.
