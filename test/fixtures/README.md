# Snapshot fixtures — written by Swift, read by TypeScript

Every file under this folder except this README is **generated**, not hand-written.

The snapshot format has two sides: the macOS app (Swift) writes it, this plugin
(TypeScript) reads it. If each side is only ever tested against its own idea of
the format, the two can drift apart in complete silence — the app keeps writing,
the plugin keeps reading, and nothing ever shows up in the user's notes. No test
on either side goes red.

So both sides are tested against **one set of files**:

- `packages/beresta-core/Tests/BerestaCoreTests/Export/FixtureExportTests.swift`
  writes these files with the real serializer (`VaultSnapshotPlan`,
  `AnnotationJSONLD`, `VaultIndex.encodedJSON`) and fails if what is committed
  here differs from what the serializer would produce today.
- `packages/obsidian-plugin/test/snapshot.test.ts` parses the very same files.

Change the encoder and forget the parser, and the Swift test goes red. Update
the fixtures too, and the *TypeScript* test goes red. Either way the divergence
is loud.

## Regenerating

```
BERESTA_WRITE_FIXTURES=1 swift test --package-path packages/beresta-core --filter FixtureExport
```

The run is deliberately red afterwards: read `git diff` before committing. The
whole point of the check is that a format change gets *noticed*.

## The data is invented

The shape is real — the same distribution of highlights per book
(81/75/47/40/30/9/4/1), the same colour proportions, the same share of notes —
but every quote is made up. The owner's actual reading does not go into a public
repository.

## The worlds

| Folder | What it is for |
| --- | --- |
| `owner-library` | A whole library: 10 shards, 291 live highlights, 3 tombstones, an orphan shard, a foreign selector, an opaque position, an ink stroke, a stranded quote, tags |
| `empty-library` | An index that lists no books. Not the same thing as no index |
| `format-version-99` | A snapshot from a future major format. Must be refused whole |
| `foreign-format` | Someone else's `index.json` under our file name |
| `hash-mismatch` | A shard whose bytes do not match the checksum in the index |
| `doctored-index` | An index naming files outside `books/`. Must never be read |
| `future-writer` | Today's output plus keys a future Beresta would add. Must survive |

`future-writer` is the one file set today's serializer cannot produce on its
own — by definition, since it has no tomorrow's fields. It is assembled from
real serializer output plus three named insertions; the generator says exactly
where and why.