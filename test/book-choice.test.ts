/**
 * «Хайлайты книги…» — правила выбора записи (постановка
 * `docs/plans/20261019-хайлайты-одной-книги-постановка.md`; владелец 20261019:
 * «мне непонятно, как текущими командами… создать заметку по книге Warez»).
 *
 * Резы (прогнаны 20261019):
 * - в `bookChoices` отсеять книги с заметкой (как прежняя команда формата) —
 *   краснеет «книга с заметкой в списке, с путём»;
 * - `isArticle` → только `source` — краснеет «статья по виду записи»;
 * - `formatsFor` без перестановки — краснеет «подходящий формат первым»;
 * - `installDefaultFormats` пишет файлы поверх — краснеет «существующие
 *   файлы не перезаписываются».
 */
import { describe, expect, test } from "vitest";
import { bookChoices, choiceText, formatsFor, isArticle } from "../src/book-choice";
import { installDefaultFormats } from "../src/render/default-formats";
import type { SnapshotBook } from "../src/snapshot/model";

function book(uuid: string, title: string, over: Partial<SnapshotBook> = {}): SnapshotBook {
  return {
    uuid,
    title,
    authors: ["Автор"],
    source: undefined,
    ownThought: undefined,
    details: undefined,
    shard: "x.jsonld",
    total: 0,
    removedTotal: 0,
    updatedAt: "",
    sha256: "",
    annotations: [],
    tombstones: [],
    unknown: {},
    ...over,
  } as SnapshotBook;
}

const WAREZ = book("W", "Warez");
const ESSAY = book("E", "Академическое эссе", { source: "https://iq-media.ru/a.html" });
const PAPER = book("P", "Статья без адреса", {
  details: { kind: "article", tags: [], collections: [] } as unknown as SnapshotBook["details"],
});
const MARKS = { article: "статья", note: "заметка: {path}" };

describe("записи команды «Хайлайты книги…»", () => {
  test("книга с заметкой в списке, с путём; без заметки — тоже", () => {
    const choices = bookChoices([WAREZ, ESSAY], new Map([["Библиотека/Warez.md", ["W"]]]));
    expect(choices.map((one) => one.book.uuid).sort()).toEqual(["E", "W"]);
    const warez = choices.find((one) => one.book.uuid === "W")!;
    expect(warez.notes).toEqual(["Библиотека/Warez.md"]);
    expect(choiceText(warez, MARKS)).toBe("Warez — Автор · заметка: Библиотека/Warez.md");
    expect(choices.find((one) => one.book.uuid === "E")!.notes).toEqual([]);
  });

  test("статья — по адресу первоисточника и по виду записи", () => {
    expect(isArticle(ESSAY)).toBe(true);
    expect(isArticle(PAPER)).toBe(true);
    expect(isArticle(WAREZ)).toBe(false);
    const [essay] = bookChoices([ESSAY], new Map());
    expect(choiceText(essay, MARKS)).toBe("Академическое эссе — Автор · статья");
  });

  test("запись без uuid не показывается", () => {
    expect(bookChoices([book("", "Пустая")], new Map())).toEqual([]);
  });

  test("подходящий виду записи формат — первым, остальные как в настройках", () => {
    const formats = [
      { name: "@Книга" },
      { name: "Конспект" },
      { name: "@Статья" },
    ] as const;
    const [warez] = bookChoices([WAREZ], new Map());
    const [essay] = bookChoices([ESSAY], new Map());
    expect(formatsFor(warez, formats).map((one) => one.name)).toEqual(["@Книга", "Конспект", "@Статья"]);
    expect(formatsFor(essay, formats).map((one) => one.name)).toEqual(["@Статья", "@Книга", "Конспект"]);
  });
});

describe("установка готовых форматов", () => {
  test("заводит «Книга» и «Статья», существующие файлы не перезаписываются", async () => {
    const files = new Map<string, string>([["Templates/Береста Книга.md", "МОЙ ШАБЛОН"]]);
    const createFile = async (path: string, text: string) => {
      if (files.has(path)) return false;
      files.set(path, text);
      return true;
    };
    const result = await installDefaultFormats([], "ru", createFile);
    expect(result.formats.map((one) => one.name)).toEqual(["Книга", "Статья"]);
    expect(files.get("Templates/Береста Книга.md")).toBe("МОЙ ШАБЛОН");
    expect(result.kept).toEqual(["Templates/Береста Книга.md"]);
    expect(result.created).toContain("Templates/Береста Статья.md");
    expect(result.formats.every((one) => one.blockTemplate === "Templates/Береста Секция.md")).toBe(true);
  });

  test("формат с тем же именем второй раз не заводится", async () => {
    const result = await installDefaultFormats(
      [{ name: "Книга", noteTemplate: "Templates/Своя.md" }],
      "ru",
      async () => true,
    );
    expect(result.formats.filter((one) => one.name === "Книга")).toHaveLength(1);
    expect(result.formats[0].noteTemplate).toBe("Templates/Своя.md");
  });
});
