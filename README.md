# Beresta for Obsidian

Brings highlights and notes from the [Beresta](https://beresta.page) reader into your book notes: one managed section per book, written as Markdown callouts, next to the notes you wrote yourself.

The point is the *next to*. Your reading lives in two halves — quotes in a reading app, thoughts about them in Obsidian — and the halves drift apart. This plugin puts the quotes where the thoughts already are, and it never edits a line you wrote by hand.

**Status: complete end to end, not yet run inside a live Obsidian.** Reading the snapshot, rendering, merging into a note, binding books to notes by hand, the backup before the first write, polling, the commands, the status bar and the conflicts panel are all in place and tested — including a run over a copy of a real 121-note library, where 289 highlights landed in seven hand-written book notes without changing a byte the author wrote. What has *not* happened yet is the plugin running inside Obsidian itself: `vault.process`, the modals and the panel are exercised through their ports in tests, and the live round trip is the next step. This section goes away when it is done.

## Requirements

- The **Beresta** app for macOS. The plugin reads what Beresta writes; without it there is nothing to read.
- **Obsidian 1.4.0 or newer.** That is the version that introduced `vault.process`, which is how the plugin writes into a note without stepping on an editor that has the file open. Measured against Obsidian 1.13.7 on macOS; see "Not tested" below.

## How it works

Beresta writes a machine-readable snapshot of your highlights into one hidden folder inside your vault:

```
<your vault>/.beresta/
  index.json           the header: format version, when it was made, which books are in it
  context.jsonld       the vocabulary for the beresta: fields, described in words
  anno.jsonld          a verbatim copy of the W3C vocabulary, so a reader needs no network
  books/<uuid>.jsonld  one shard per book, in W3C Web Annotation JSON-LD
```

The plugin reads that folder through Obsidian's own vault adapter and lays the highlights out into your book notes. Nothing else writes to your notes; Beresta itself does not know your notes exist.

**That snapshot is a documented open format, not our private wire protocol.** Every file in `.beresta/`, every field, the rule for raising the format version, how long tombstones live and how to read a snapshot safely are written down in [`docs/vault-export.md`](docs/vault-export.md) — in Russian and English, under CC0 1.0, so that anyone may implement it. The document's rule is that no claim in it needs our code to check: each section ends with the command that checks it. There is also a 72-line reader in [`docs/tools/extract-highlights.py`](docs/tools/extract-highlights.py) that prints every quote using nothing but Python's standard library — no SQLite, no Swift, no Obsidian, no network. So this plugin is one reader of your highlights, not the only one; if it went away tomorrow, your quotes would still be plain files you can read.

Two consequences worth knowing up front:

- **The exchange is one-way.** The plugin writes highlights into notes. It never parses notes back into highlights — guessing structure out of Markdown is guessing, and a wrong guess costs you text you cannot get back.
- **The snapshot is plain text inside your vault.** The full text of every quote sits in `.beresta/` in readable JSON, and your vault is probably synchronised by something. That is stated here rather than buried, because it is your call, not ours.

The folder name starts with a dot on purpose: Obsidian does not show such folders in the file explorer, does not index them for search, and does not pull them into the graph — measured, not assumed.

## The managed section

Everything the plugin writes lives between two marker lines, and nothing outside them is ever touched:

```markdown
%% beresta:begin %%
## Выписки из Beresta

%% beresta:hash hl-cdb6804dd44e5717983502f1e493bb6f 6b2f0a1c7d4e5f80 %%

> [!quote]+ Part I → Chapter 3 → The mental Shylock
> Attention is the only currency that buys understanding.
> [06.08.2026 12:06](beresta://open/9504E37E-…?cfi=epubcfi%28%2F6%2F8%21%2F4%29)

^hl-cdb6804dd44e5717983502f1e493bb6f
%% beresta:end %%
```

Read that as four separate rules.

- **Outside the markers is yours.** The plugin does not write there, and does not read there for data either. Your headings, your ratings, your links, the four years of notes above the section — bytes preserved.
- **The block anchor addresses the callout above it.** `^hl-…` on its own line after a blank line is what makes `[[Note#^hl-…]]` resolve to the whole quote. That layout was measured on a live Obsidian against two alternatives, three ways each, with a negative control.
- **The anchor is derived from the highlight's own id and from nothing else** — not from its position, not from its neighbours. Delete one highlight and the rest keep their anchors, so links you made to them keep working.
- **The comment line above a block is how the note itself remembers that the block is the plugin's.** It holds a fingerprint of the text the plugin wrote there last. Edit the block and the fingerprints stop matching, so the block freezes and stays yours; the plugin never guesses. Obsidian hides `%% … %%` comments in reading view, and deleting one costs you nothing but a frozen block. The blank line under it is not spacing: `pandoc` refuses to start a callout right after a paragraph, and without that line the whole block collapses into one run-on paragraph for every reader that is not Obsidian. Until 20260901 that fingerprint lived only in the plugin's `data.json`, keyed by the note's *path* — so renaming the note, reinstalling the plugin, or opening the vault on a second Mac lost it, and the note stopped updating for good. Two of the three addresses already lived in the file; this is the third.

The callout title is the chapter path from the book's table of contents; where there is no path it degrades to the book title, and where there is neither it degrades to a bare callout rather than to an empty heading. A highlight with no quotable text — an ink stroke on a PDF page — says so in words instead of rendering an empty quote. A highlight without your own note gets no separator, no subheading and no blank line.

The layout is a template you can edit. It is a deliberately small language: substitute a value, repeat a block per highlight, show a block when a value is non-empty. There are no expressions and no function calls in it. A mistake in your template — an unknown name, an unclosed block, a stray brace — is reported in words and **stops the write**: a broken template cannot produce a half-rendered section, because it produces nothing at all.

**If a note is open with unsaved changes, the plugin defers writing it and says so.** This is not caution, it is a measurement: `vault.process` hands the writer the text *on disk*, not the text on your screen, so writing at that moment splices your unsaved line into the middle of a machine-generated block. Nothing is lost — but the block's checksum no longer matches, the next pass reads that as "the human edited this block", and freezes it for good. Deferring costs nothing: the snapshot is still there on the next pass, when your buffer is saved.

## What you see and what you press

**One line in the status bar, and it says when — not whether.** `Beresta: данные на 20260806 2114` names the moment the snapshot was made, not "synced" and not a checkmark. The failure this plugin is most likely to have is silent lag: highlights stopped arriving and nothing looks wrong. A checkmark hides exactly that; a date does not. Hover it and you get the rest in words — how many days ago, how many notes carry highlights, how many blocks are frozen because you edited them, which notes are waiting for you to save.

**Nothing is bound automatically.** Books are matched to notes by a command, in a window, one book at a time, with the candidates ranked and the machine-generated exports (Readwise and friends) marked as such and pushed to the bottom. There is no "bind when the match is exact" threshold, because on real data the exact match is sometimes the *wrong* note: a Readwise export can match a book title more precisely than the note you wrote by hand. The binding lives in the note's frontmatter (`beresta-book-id`, always a list), so renaming or moving the note keeps it — and so does the plugin's claim on the blocks it wrote, which is in the note too.

**Six commands, and each of them is something the plugin will not do on its own:**

| Command | What it does |
| --- | --- |
| Разложить выписки сейчас | Looks at the snapshot right now, ignoring what it remembers |
| Привязать книги к заметкам | The binding window |
| Показать расхождения | The conflicts panel, in the right sidebar |
| Вернуть секцию Beresta в эту заметку | Re-creates a managed section you deleted |
| Подтвердить удаление блоков в этой заметке | Releases the safety catch when a pass would remove a lot of blocks |
| Восстановить прежнюю версию этой заметки | Rolls the note back to one of the backups taken before a write |

**The conflicts panel is not an alarm.** A conflict here means you edited a quote and the app changed the same quote — an ordinary event, not a failure. Those blocks stay yours and stop being redrawn; the app's newer version arrives as a folded callout above your text. The panel exists so you know which blocks went quiet, because otherwise you find out six months later.

**How often it looks.** Every five seconds while the Obsidian window has focus, every minute when it does not, plus on load, on command, and when you open a note that carries a binding (then only that book is checked). The check itself is one `stat` call; nothing is read or written unless the snapshot's own checksum changed. File modification time is treated as a hint and never as the truth — vault sync tools move it in both directions, and a plugin that trusts it either misses your new highlights or rewrites your notes for nothing.

## Network use: none

**This plugin makes no network requests at all.** Not to a remote host, not to `127.0.0.1`, not on first run, not to check for updates. There is no telemetry of any kind, no usage counter, no crash reporter. The plugin never updates itself or anything it depends on.

This is not a promise made in prose only. `test/bundle.test.ts` builds the very bundle that ships and searches it for `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `requestUrl`, `http://`, `localhost`, `127.0.0.1` and the usual analytics names. It then searches every file under `src/` separately, including modules the entry point does not import yet — a bundle only contains what the entry point reached, and the promise above is about the plugin, not about the part of it already wired up. If any of them ever appears, the build goes red the same day. The bundle is deliberately **not minified**, so you can grep it yourself instead of taking our word for it.

Checksums are verified with a SHA-256 written out in plain TypeScript rather than with `crypto.subtle`, which is only available in a secure context and which we have not measured inside Obsidian on either desktop or mobile.

Because there are no network requests, the Obsidian catalogue's "Network use" disclosure does not apply to this plugin.

## File access: inside the vault only

The plugin reads and writes **only inside your vault**, through Obsidian's own API:

- reads `.beresta/` — the snapshot the app leaves there;
- writes to your book notes, and only inside the section it manages;
- keeps its own settings where every plugin does, in `.obsidian/plugins/`.

It never touches a path outside the vault, and it does not shell out — there is no Node in it at all: `require`, `fs`, `process` and `Buffer` are not merely unused, they do not typecheck (`tsconfig.json` compiles the plugin with an empty `types` list). So the catalogue's "Accessing files outside of Obsidian vaults" disclosure does not apply either.

The Beresta app, for its part, writes to `.beresta/` and to nothing else in the vault — the app enforces that on its side and tests it.

## Not tested

- **Mobile.** The plugin declares no `isDesktopOnly`, because it honestly uses neither Node nor the network and has no reason to be desktop-only. But everything above was measured on macOS. Mobile Obsidian is untested, and until it is measured, working there is not a promise. (Beresta itself is a macOS app today, so on mobile there would be nothing writing the snapshot anyway — unless your vault syncs it over from the Mac.)
- **Obsidian Sync's behaviour with the `.beresta/` folder.** Untested.

## Development

```bash
make test-plugin    # typecheck (tsc) + tests (vitest)
make build-plugin   # bundle src/ into main.js with esbuild
```

Both go through the repository `Makefile` on purpose: the command a person runs and the command CI runs are the same command, or they drift apart and only one of them is telling the truth.

Tests check data; they cannot see a window. For layout there is a stand:

```bash
node стенд-окна/собрать.mjs --корень . --выход /tmp/окно.html   # add --тёмная for the dark palette
```

It renders the real binding modal — real screen code, real `styles.css`, a real plan
read from the test vault by `readSnapshot`/`planBinding` — on top of a stub Obsidian
and hand-copied theme variables. So it proves layout (overlap, clipping, whether the
footer is reachable) and nothing about behaviour; the eye-check inside a live Obsidian
stays the real one. The stub is deliberately behaviour-free — see the header of
`стенд-окна/обсидиан.mjs`.

A release is exactly three files — `main.js`, `manifest.json`, `styles.css`. `main.js` is built from the TypeScript in `src/`, is not committed, and is not minified.

## Licence

MIT — see [LICENSE](LICENSE) next to this file. The plugin is open source and free. The Beresta reader application it takes highlights from is a separate, proprietary paid app for macOS.
