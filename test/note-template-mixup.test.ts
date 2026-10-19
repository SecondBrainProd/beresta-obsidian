/**
 * Шаблон секции в поле шаблона заметки (владелец 20261019: «Beresta: заметка не
 * создана — строка 2: шаблон просит «thought»…» — поле перепутано, а ошибка об
 * этом молчала).
 *
 * Рез (прогнан 20261019): `looksLikeSectionTemplate` всегда `false` — краснеет
 * «говорит, что перепутано поле»; всегда `true` — краснеет «готовые шаблоны
 * заметок не принимаются за секцию».
 */
import { describe, expect, test } from "vitest";
import { defaultFormats, defaultSectionFile } from "../src/render/default-formats";
import { renderNote } from "../src/render/note";
import type { SnapshotBook } from "../src/snapshot/model";
import { panelWords } from "../src/ui/words";

const RU = panelWords("ru");

function book(): SnapshotBook {
  return {
    uuid: "5650781E-4943-515E-B644-7745D3BB9759",
    title: "Гибкое сознание",
    authors: ["Кэрол Дуэк"],
    source: undefined,
    ownThought: "Способности растут от усилия",
    details: {
      kind: "book",
      subtitle: undefined,
      publisher: "МИФ",
      published: "2013-04-12",
      language: "ru",
      series: undefined,
      seriesIndex: undefined,
      tags: ["психология"],
      collections: ["Ремесло"],
      readStatus: "read",
      rating: 5,
      addedAt: "2024-01-05T10:00:00Z",
      finishedAt: undefined,
    },
    shard: "x.jsonld",
    total: 0,
    removedTotal: 0,
    updatedAt: "",
    sha256: "",
    annotations: [],
    tombstones: [],
    unknown: {},
  };
}

describe("шаблон секции в поле шаблона заметки", () => {
  test("говорит, что перепутано поле, а не про незнакомое значение", () => {
    const section = defaultSectionFile("ru").text;
    expect(() => renderNote(section, book(), "Книга", RU.pass)).toThrow(
      /в поле «Файл шаблона заметки» стоит шаблон секции хайлайтов/,
    );
    const loop = "---\nНазвание: {{ title }}\n---\n{% for a in annotations %}{{ a }}{% endfor %}";
    expect(() => renderNote(loop, book(), "Книга", RU.pass)).toThrow(/шаблон секции хайлайтов/);
  });

  test("готовые шаблоны заметок с местом {{ annotations }} за секцию не принимаются", () => {
    for (const language of ["ru", "en"]) {
      for (const ready of defaultFormats(language)) {
        expect(() => renderNote(ready.text, book(), ready.name, RU.pass)).not.toThrow();
      }
    }
  });
});
