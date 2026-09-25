The plugin now speaks the language of your Obsidian interface: English or Russian. Any other interface language gets English.

- **Everything the plugin says follows the interface language** — the commands, the notices, the settings page, the status bar, the binding window, the conflicts panel and the backup window. One dictionary under one type, so a missing translation is a build error rather than a stray Russian string.
- **So does the section it writes into your notes**: the heading, the *Thought.* label, the words for an ink stroke or an underline. Until now they were Russian for everyone, whatever the description said. Switching the interface language redraws the machine-written blocks once; blocks you edited stay yours, as always.
- **New notes for books that have none go to a `Library` folder at the root of your vault** (`Библиотека` when the interface is Russian). The folder is chosen once, at first launch, and the plugin never changes it afterwards; a folder already set in the settings is kept.
- **The last highlight's anchor no longer shows as text under the last quote.** The closing marker is now preceded by a blank line, so the `^hl-…` line stays a block anchor instead of leaking into the reading view.
- The low-level location labels inside a "shard cannot be parsed" message stay Russian: they are diagnostics for whoever repairs a broken export file, not words meant for the reader.

Install by hand: put `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/beresta/` and enable the plugin in settings.

Without the Beresta app there is nothing to show: the snapshot it reads is written by the app into your vault.
