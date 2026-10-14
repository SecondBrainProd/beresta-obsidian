Security fixes for the ready-made "Book" and "Article" formats introduced in 0.3.0.

- **Authors are now a YAML list** in the "Book" front matter. An author name with a quote or a backslash could break the whole front matter, and a book with several authors produced a line that was not valid YAML.
- **The source link of "Article" is escaped.** A page title from a web site could close the link and add its own Markdown or HTML to your note; an address with another scheme than http(s) or mailto is no longer linked.
- New template filters for your own formats: `wikilink`, `mdtext` and `mdurl`. Use them for anything that came from a web page.

If you already pressed "Add ready formats" in 0.3.0, delete `Templates/Beresta Book.md` and `Templates/Beresta Article.md` (or the Russian ones) and press the button again — existing files are never overwritten.

Install by hand: put `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/beresta/` and enable the plugin in settings.
