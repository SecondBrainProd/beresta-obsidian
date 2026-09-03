import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  EXPORT_BOOKS_FOLDER_NAME,
  EXPORT_FOLDER_NAME,
  EXPORT_INDEX_FILE_NAME,
} from "../src/main";

// Адрес снимка: одна граница, две стороны, один источник истины.
//
// **Что здесь ловится.** Приложение на Swift пишет снимок по адресу из
// `VaultLocation`; плагин читает по адресу из `main.ts`. Если стороны
// разойдутся — переименуют папку, поправят имя указателя, — не упадёт
// ничего: приложение будет исправно писать, плагин исправно читать пустоту,
// а в заметках человека просто не появится ни одной новой цитаты. Молчание
// вместо ошибки. Поэтому сверка не «мы помним, что там `.beresta`», а чтение
// объявления из исходника Swift.
//
// Это единственный тест плагина, который смотрит на чужой код, и смотрит он
// на три строки. Если объявления переедут, тест скажет об этом словами, а не
// сравнит `undefined` с `undefined` и позеленеет.

const swiftSource = fileURLToPath(
  new URL(
    "../../beresta-core/Sources/BerestaCore/Export/VaultLocation.swift",
    import.meta.url,
  ),
);

function swiftConstant(name: string): string {
  const source = readFileSync(swiftSource, "utf8");
  const match = source.match(
    new RegExp(`static let ${name}\\s*=\\s*"([^"]*)"`),
  );
  if (!match) {
    throw new Error(
      `в ${swiftSource} нет объявления «static let ${name}». ` +
        "Оно переехало или переименовано — общая граница со Swift потеряна, " +
        "и её надо восстановить, а не убрать эту проверку.",
    );
  }
  return match[1];
}

describe("адрес снимка совпадает со стороной приложения", () => {
  test("папка снимка — та же, что пишет Swift", () => {
    expect(EXPORT_FOLDER_NAME).toBe(swiftConstant("exportFolderName"));
  });

  test("папка осколков — та же", () => {
    expect(EXPORT_BOOKS_FOLDER_NAME).toBe(swiftConstant("booksFolderName"));
  });

  test("имя указателя — то же", () => {
    expect(EXPORT_INDEX_FILE_NAME).toBe(swiftConstant("indexFileName"));
  });

  // Точка в начале — то, ради чего папку так и назвали: по замеру задачи 2
  // Obsidian такую папку не показывает, не индексирует и не тянет в граф.
  test("имя папки начинается с точки, иначе снимок полезет в поиск и граф", () => {
    expect(EXPORT_FOLDER_NAME.startsWith(".")).toBe(true);
  });
});
