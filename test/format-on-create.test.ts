/**
 * Первая секция НОВОЙ заметки — шаблоном её формата (владелец 20261019:
 * заметка «@Книга» с `Templates/Beresta Highlights.md` получила стандартную
 * секцию «Хайлайты из Beresta»).
 *
 * Секцию новой заметки рисует тот же проход, что её заводит, а формат заметки
 * берётся из кэша свойств Obsidian — у ещё не созданного файла там пусто.
 * Двойник `formatOf` здесь нарочно отвечает «не знаю» про новый путь: ровно как
 * кэш Obsidian в ту минуту.
 *
 * Резы (прогнаны 20261019): в `templateFor` убрать `this.creating.get(…) ??` —
 * краснеет «новая заметка — шаблоном формата»; в возвращённой функции не
 * удалять пути — краснеет «после прохода путь забыт».
 */
import { describe, expect, test } from "vitest";
import { FormatTemplates } from "../src/formats";
import { readState } from "../src/settings";
import { panelWords } from "../src/ui/words";

const RU = panelWords("ru");
const BLOCK = "### Хайлайты\n{{#annotations}}\n> {{text}}\n^{{anchor}}\n{{/annotations}}";

function templatesFor(): FormatTemplates {
  const settings = readState(
    { settings: { formats: [{ name: "@Книга", blockTemplate: "Templates/Beresta Highlights.md" }] } },
    300,
    "ru",
  ).settings;
  return new FormatTemplates(
    // Кэш свойств Obsidian о новом файле не знает ничего.
    { read: async () => BLOCK, formatOf: () => undefined },
    () => settings,
    () => RU,
  );
}

describe("формат заводимой заметки", () => {
  test("новая заметка — шаблоном формата, хотя кэш свойств о ней молчит", async () => {
    const templates = templatesFor();
    await templates.reload();
    expect(templates.templateFor("Библиотека/Warez.md")).toBeUndefined();
    const release = templates.expectCreating(new Map([["Библиотека/Warez.md", "@Книга"]]));
    expect(templates.templateFor("Библиотека/Warez.md")).toBe(BLOCK);
    expect(templates.templateFor("Библиотека/Другая.md")).toBeUndefined();
    release();
  });

  test("после прохода путь забыт: дальше формат — только из свойства заметки", async () => {
    const templates = templatesFor();
    await templates.reload();
    const release = templates.expectCreating(new Map([["Библиотека/Warez.md", "@Книга"]]));
    release();
    expect(templates.templateFor("Библиотека/Warez.md")).toBeUndefined();
  });
});
