Directory review fix.

- The plugin now requires Obsidian 1.8.7 or later and takes the interface language only from Obsidian's own `getLanguage()`. 0.3.1 declared 1.7.2 while calling `getLanguage()` (added in 1.8.7), and the community directory's automated review rejected it. Obsidian older than 1.8.7 keeps 0.3.1 through `versions.json`.
- Two needless escapes in regular expressions removed. No behaviour changes.

Install by hand: put `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/beresta/` and enable the plugin in settings.
