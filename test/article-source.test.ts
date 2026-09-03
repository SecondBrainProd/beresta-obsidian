import { describe, expect, test } from "vitest";

import { renderBookBody } from "../src/render/section";
import { parseShard } from "../src/snapshot/shard";
import type { SnapshotBook } from "../src/snapshot/model";

/**
 * Адрес первоисточника у статьи — путь человека П09.
 *
 * **Зачем поле вообще.** У статьи нет года издания, а у части статей нет и
 * автора: адрес — единственное, чем цитата из статьи перестаёт быть цитатой
 * ниоткуда. Заметка обязана его пережить.
 *
 * Задача 8 плана `docs/plans/20260827-статьи.md`.
 */
describe("адрес первоисточника у статьи", () => {
  const shardOf = (book: Record<string, unknown>): string =>
    JSON.stringify({
      "@context": ["http://www.w3.org/ns/anno.jsonld", "../context.jsonld"],
      id: "urn:uuid:1E1FC030-1F3E-54B0-84C9-F3CFC7CAE46B",
      type: "AnnotationCollection",
      label: "Что случилось с чтением",
      total: 0,
      generated: "2026-08-27T00:00:00Z",
      "beresta:book": book,
    });

  test("осколок статьи отдаёт адрес", () => {
    const parsed = parseShard(
      shardOf({
        id: "urn:uuid:064AEB6F-28F4-5208-949F-9F292581430E",
        type: "Text",
        label: "Что случилось с чтением",
        "beresta:sourceURL": "https://example.org/чтение",
      }),
      "осколок",
    );

    expect(parsed.source).toBe("https://example.org/чтение");
    // И поле не считается незнакомым: иначе плагин доложил бы человеку о
    // непонятом формате там, где он понят.
    expect(Object.keys(parsed.unknown)).not.toContain("beresta:sourceURL");
  });

  test("у книги адреса нет, и это не пустая строка", () => {
    const parsed = parseShard(
      shardOf({
        id: "urn:uuid:064AEB6F-28F4-5208-949F-9F292581430E",
        type: "Text",
        label: "Гибкое сознание",
        "beresta:authors": ["Кэрол Дуэк"],
      }),
      "осколок",
    );

    expect(parsed.source).toBeUndefined();
    expect(parsed.authors).toEqual(["Кэрол Дуэк"]);
  });

  // MARK: - Заметка

  const book = (source: string | undefined): SnapshotBook => ({
    uuid: "064AEB6F-28F4-5208-949F-9F292581430E",
    title: "Что случилось с чтением",
    authors: [],
    source,
    shard: "books/064AEB6F-28F4-5208-949F-9F292581430E.jsonld",
    total: 0,
    removedTotal: 0,
    updatedAt: "2026-08-27T00:00:00Z",
    sha256: "0".repeat(64),
    annotations: [],
    tombstones: [],
    unknown: {},
  });

  const TEMPLATE = ["# {{title}}", "{{#source}}Первоисточник: {{source}}{{/source}}"].join("\n");

  test("шаблон заметки подставляет адрес", () => {
    const text = renderBookBody(book("https://example.org/чтение"), [], TEMPLATE);
    expect(text).toContain("Первоисточник: https://example.org/чтение");
  });

  /**
   * У книги строки нет вовсе. Пустая строка «Первоисточник:» хуже, чем её
   * отсутствие: она обещает читателю дверь, которая никуда не ведёт.
   */
  test("у книги строки первоисточника не появляется", () => {
    const text = renderBookBody(book(undefined), [], TEMPLATE);
    expect(text).not.toContain("Первоисточник");
    expect(text).toContain("Что случилось с чтением");
  });
});
