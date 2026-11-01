import { describe, expect, test } from "vitest";

import { RATING_KEY, readScalar } from "../src/merge/frontmatter";
import { merge, type KnownSection } from "../src/merge/merge";
import { defaultTemplate } from "../src/render/defaults";
import { renderSection, verdictAnchorFor } from "../src/render/section";
import { parseShard } from "../src/snapshot/shard";
import type { SnapshotAnnotation, SnapshotBook } from "../src/snapshot/model";

/**
 * Отзыв разделом в тексте заметки и оценка свойством (решение владельца
 * 20261031): «отзыв — разделом в теле заметки книги, оценка — своя ось вместо
 * Calibre».
 *
 * Резы (прогнаны на закоммиченном дереве, итог — в PR):
 * - убрать `"^{{verdictAnchor}}"` из `DEFAULT_TEMPLATE` — краснеют «со своим
 *   якорем» и «цитата не обновилась рядом с правленым отзывом» (первый прогон
 *   реза 20261031 оставил проверку правки зелёной: без якоря правку держал
 *   соседний блок цитаты — шаг с исправленной цитатой добавлен ради этого);
 * - в `merge.ts` не передавать `rating:` в `applyFrontmatter` — краснеет
 *   «оценки нет свойством».
 */

const OFFSET = { timeZoneOffsetMinutes: 300 };
const NOTHING_KNOWN: KnownSection = { blocks: {} };
const VERDICT = "Первый абзац отзыва.\n\nВторой — о главном.";

const QUOTE: SnapshotAnnotation = {
  id: "urn:uuid:AAAAAAAA-0000-0000-0000-000000000001",
  uuid: "AAAAAAAA-0000-0000-0000-000000000001",
  bookUUID: "9504E37E-2CE3-5AD4-81F9-35414188FAC9",
  motivation: "highlighting",
  markKind: "highlight",
  created: "2026-08-06T07:06:40Z",
  modified: "2026-08-06T07:07:40Z",
  comment: undefined,
  commentFormat: undefined,
  tags: [],
  selectors: [],
  quote: "Мыслетопливо тратится не на действия, а на решения.",
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

function book(verdict: string | undefined, rating?: number): SnapshotBook {
  return {
    uuid: "9504E37E-2CE3-5AD4-81F9-35414188FAC9",
    title: "Джедайские техники",
    authors: ["Максим Дорофеев"],
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
    shard: "9504E37E-2CE3-5AD4-81F9-35414188FAC9.jsonld",
    total: 1,
    removedTotal: 0,
    updatedAt: "2026-08-06T07:06:40Z",
    sha256: "0".repeat(64),
    annotations: [QUOTE],
    tombstones: [],
    unknown: {},
  };
}

const NOTE = [
  "---",
  "tags: 📖",
  "Оценка: 3",
  "---",
  "## Главная идея книги",
  "",
  "Моя мысль, которую плагин не трогает.",
  "",
].join("\n");

describe("Отзыв разделом в заметке", () => {
  test("отзыв встаёт разделом «Отзыв» абзацами, как написан, со своим якорем", () => {
    const section = renderSection(book(VERDICT), [QUOTE], defaultTemplate("ru"), { ...OFFSET, language: "ru" });
    const lines = section.split("\n");
    const head = lines.indexOf("### Отзыв");
    expect(head).toBeGreaterThan(0);
    expect(lines.slice(head + 2, head + 5)).toEqual(["Первый абзац отзыва.", "", "Второй — о главном."]);
    expect(section).toContain(`^${verdictAnchorFor(book(VERDICT))}`);
    expect(section.indexOf("### Отзыв")).toBeLessThan(section.indexOf("Мыслетопливо"));
  });

  test("без отзыва секция та же, что была до раздела", () => {
    const section = renderSection(book(undefined), [QUOTE], defaultTemplate("ru"), { ...OFFSET, language: "ru" });
    expect(section).not.toContain("Отзыв");
    expect(section).not.toContain("hl-verdict-");
  });

  test("правка отзыва в заметке замерзает, а текст человека вне секции цел", () => {
    const rendered = renderSection(book(VERDICT), [QUOTE], defaultTemplate("ru"), { ...OFFSET, language: "ru" });
    const first = merge(NOTE, rendered, NOTHING_KNOWN, { mayCreateSection: true, language: "ru" });
    expect(first.text.startsWith(NOTE.replace(/\n$/, ""))).toBe(true);

    const edited = first.text.replace("Второй — о главном.", "Второй — о главном. И моя приписка.");
    expect(edited).not.toBe(first.text);
    // Тем временем в приложении поправили цитату: соседний блок обязан
    // обновиться. Без своего якоря отзыв слипся бы с блоком цитаты, правка
    // заморозила бы ОБА, и новая цитата не приехала бы (рез 20261031: без
    // этого шага проверка была зелёной и без якоря — правку держал чужой блок).
    const fixed = { ...QUOTE, quote: "Мыслетопливо тратится на решения. Исправлено в приложении." };
    const rerendered = renderSection(book(VERDICT), [fixed], defaultTemplate("ru"), { ...OFFSET, language: "ru" });
    const second = merge(edited, rerendered, first.known, { language: "ru" });

    expect(second.text, "правка отзыва затёрлась").toContain("И моя приписка.");
    expect(second.text, "цитата не обновилась рядом с правленым отзывом").toContain("Исправлено в приложении.");
    expect(second.conflicts.map((one) => one.anchor)).toEqual([verdictAnchorFor(book(VERDICT))]);
    expect(second.text).toContain("Моя мысль, которую плагин не трогает.");
  });

  test("осколок с beresta:verdict читается в сведения книги", () => {
    const shard = JSON.stringify({
      "@context": ["http://www.w3.org/ns/anno.jsonld", "../context.jsonld"],
      id: "urn:uuid:11111111-1111-5111-8111-111111111111",
      type: "AnnotationCollection",
      total: 0,
      "beresta:book": {
        id: "urn:uuid:9504E37E-2CE3-5AD4-81F9-35414188FAC9",
        type: "beresta:Book",
        "beresta:kind": "book",
        "beresta:readStatus": "read",
        "beresta:rating": 5,
        "beresta:verdict": VERDICT,
      },
    });
    const parsed = parseShard(shard, "проверка");
    expect(parsed.details.verdict).toBe(VERDICT);
    expect(parsed.details.rating).toBe(5);
    expect(Object.keys(parsed.unknown)).not.toContain("beresta:verdict");
  });
});

describe("Оценка свойством заметки", () => {
  const rendered = renderSection(book(undefined, 4), [QUOTE], defaultTemplate("ru"), { ...OFFSET, language: "ru" });

  test("оценка своей оси ложится ключом beresta-rating, своё «Оценка» человека цело", () => {
    const result = merge(NOTE, rendered, NOTHING_KNOWN, {
      mayCreateSection: true,
      language: "ru",
      frontmatter: { bookIds: [book(undefined).uuid], lastSync: "20261031 1200", rating: 4 },
    });
    expect(readScalar(result.text, RATING_KEY), "оценки нет свойством").toBe("4");
    expect(result.text).toContain("Оценка: 3");
  });

  test("оценку сняли в приложении — ключ снимается, остальное цело", () => {
    const rated = merge(NOTE, rendered, NOTHING_KNOWN, {
      mayCreateSection: true,
      language: "ru",
      frontmatter: { bookIds: [book(undefined).uuid], lastSync: "20261031 1200", rating: 4 },
    });
    const unrated = merge(rated.text, rendered, rated.known, {
      language: "ru",
      frontmatter: { bookIds: [book(undefined).uuid], lastSync: "20261031 1300", rating: null },
    });
    expect(readScalar(unrated.text, RATING_KEY)).toBeUndefined();
    expect(unrated.text).toContain("Оценка: 3");
    expect(unrated.text).toContain("tags: 📖");
  });
});
