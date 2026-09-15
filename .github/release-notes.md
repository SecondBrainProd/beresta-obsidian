Fixes from the community directory's automated review.

- The manifest now declares Obsidian 1.7.2 as its minimum. The plugin calls `revealLeaf`, which the API marks as available from 1.7.2, and promising to work on older versions was a promise it could not keep.
- Settings no longer assign styles directly: the template field is styled by a class, so your theme can still override it.
- Smaller fixes from the same report: `createDiv` in place of `createEl("div")`, no aliasing of `this`, no unchecked value taken from a note's frontmatter, and thirty-one redundant non-null assertions removed. The thirty-second was earned, and became a real check instead.
- `isDesktopOnly` is now stated explicitly as `false`. The plugin reads a snapshot through the vault adapter and works on phones too.

Install by hand: put `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/beresta/` and enable the plugin in settings.

Without the Beresta app there is nothing to show: the snapshot it reads is written by the app into your vault.
