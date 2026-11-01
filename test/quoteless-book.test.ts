import { describe, expect, test } from "vitest";

import { RATING_KEY, readScalar } from "../src/merge/frontmatter";
import { merge, type KnownSection } from "../src/merge/merge";
import { defaultTemplate } from "../src/render/defaults";
import { SECTION_BEGIN, renderSection } from "../src/render/section";
import type { SnapshotAnnotation, SnapshotBook } from "../src/snapshot/model";

/**
 * Книга без хайлайтов, но с отзывом или оценкой (слово владельца 20261031
 * «Да, выгружать»): заметка с разделом «Отзыв» и свойством `beresta-rating`,
 * без заголовка «Хайлайты» над пустотой.
 *
 * Рез (прогнан на закоммиченном дереве, итог — в PR): снять `{{#highlighted}}`
 * вокруг заголовка в `DEFAULT_TEMPLATE` — краснеет «заголовок хайлайтов над
 * пустотой».
 */

const OFFSET = { timeZoneOffsetMinutes: 300, language: "ru" };
const NOTHING_KNOWN: KnownSection = { blocks: {} };

function book(verdict: string | undefined, rating?: number): SnapshotBook {
  return {
    uuid: "2B0B0C0D-0000-5000-A000-0000000000C1",
    title: "С отзывом",
    authors: ["Автор Отзыва"],
    source: undefined,
    ownThought: undefined,
    details: {
      kind: "book",
      subtitle: undefined,
      publisher: undefined,
      published: undefined,
      language: undefined,
      series: undefined,
      seriesIndex: undefined,
      tags: [],
      collections: [],
      readStatus: "read",
      rating,
      verdict,
      addedAt: "2026-08-01T00:00:00Z",
      finishedAt: undefined,
    },
    shard: "2B0B0C0D-0000-5000-A000-0000000000C1.jsonld",
    total: 0,
    removedTotal: 0,
    updatedAt: "2026-10-31T00:00:00Z",
    sha256: "0".repeat(64),
    annotations: [],
    tombstones: [],
    unknown: {},
  };
}

const QUOTE: SnapshotAnnotation = {
  id: "urn:uuid:AAAAAAAA-0000-0000-0000-000000000001",
  uuid: "AAAAAAAA-0000-0000-0000-000000000001",
  bookUUID: "2B0B0C0D-0000-5000-A000-0000000000C1",
  motivation: "highlighting",
  markKind: "highlight",
  created: "2026-08-06T07:06:40Z",
  modified: "2026-08-06T07:07:40Z",
  comment: undefined,
  commentFormat: undefined,
  tags: [],
  selectors: [],
  quote: "Цитата из книги.",
  strandedText: undefined,
  cfi: "epubcfi(/6/8!/4/2/2)",
  color: "blue",
  colorHex: "#4a90d9",
  sortIndex: "000001",
  pageLabel: undefined,
  chapterPath: [],
  intent: undefined,
  processed: "raw",
  topic: undefined,
  position: undefined,
  unknown: {},
};

describe("книга без хайлайтов", () => {
  test("секция — раздел «Отзыв» без заголовка хайлайтов над пустотой", () => {
    const section = renderSection(book("Абзац отзыва.\n\nИ второй."), [], defaultTemplate("ru"), OFFSET);
    expect(section, "заголовок хайлайтов над пустотой").not.toContain("Хайлайты");
    expect(section.startsWith(`${SECTION_BEGIN}\n### Отзыв\n\nАбзац отзыва.\n\nИ второй.`)).toBe(true);
  });

  test("у книги с хайлайтами заголовок на месте, как был", () => {
    const section = renderSection(book("Отзыв."), [QUOTE], defaultTemplate("ru"), OFFSET);
    expect(section.startsWith(`${SECTION_BEGIN}\n## Хайлайты из Beresta\n`)).toBe(true);
  });

  test("книга с одной оценкой — пустая секция и свойство оценки", () => {
    const rendered = renderSection(book(undefined, 4), [], defaultTemplate("ru"), OFFSET);
    const created = merge("", rendered, NOTHING_KNOWN, {
      mayCreateSection: true,
      language: "ru",
      frontmatter: { bookIds: [book(undefined).uuid], lastSync: "20261031 1200", rating: 4 },
    });
    expect(readScalar(created.text, RATING_KEY)).toBe("4");
    expect(created.text).not.toContain("Хайлайты");
  });
});
