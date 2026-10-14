/**
 * Форматы заметок в настройках (план `20261008-шаблоны-плагина-план.md`,
 * задача 3; слова владельца R01, R04, путь П07).
 *
 * **Резы, каждый в одиночку:**
 * 1. `readFormats` пропускает повтор имени — краснеет «повтор имени: побеждает первый»;
 * 2. `hasAnchor` ищет строку буквально (`includes("{{anchor}}")`) — краснеет
 *    «якорь с пробелами годится»;
 * 3. `stateToJSON` не пишет форматы — краснеет «форматы переживают запись и чтение».
 */
import { describe, expect, test } from "vitest";
import {
  acceptableTemplate,
  formatNamed,
  hasAnchor,
  readFormats,
  readState,
  stateToJSON,
} from "../src/settings";

describe("форматы заметок в настройках", () => {
  test("старые настройки без форматов — форматов нет, всё как прежде (П07)", () => {
    const state = readState({ settings: { libraryFolder: "Библиотека", template: "> {{text}} ^{{anchor}}" } }, 300, "ru");
    expect(state.settings.formats).toEqual([]);
    expect(state.settings.template).toBe("> {{text}} ^{{anchor}}");
  });

  test("форматы разбираются: имя, пути, образец пути; пустые пути — нет пути", () => {
    const formats = readFormats([
      { name: "Книга", noteTemplate: "Templates/Береста Книга.md", blockTemplate: "", pathPattern: "Библиотека/{{title}}.md" },
      { name: " Статья ", noteTemplate: "Templates/Береста Статья.md" },
    ]);
    expect(formats).toEqual([
      { name: "Книга", noteTemplate: "Templates/Береста Книга.md", blockTemplate: undefined, pathPattern: "Библиотека/{{title}}.md" },
      { name: "Статья", noteTemplate: "Templates/Береста Статья.md", blockTemplate: undefined, pathPattern: undefined },
    ]);
  });

  test("битые записи пропускаются; повтор имени: побеждает первый", () => {
    const formats = readFormats([
      "строка",
      { noteTemplate: "без имени.md" },
      { name: "" },
      { name: "Книга", noteTemplate: "первый.md" },
      { name: "Книга", noteTemplate: "второй.md" },
    ]);
    expect(formats.map((format) => format.noteTemplate)).toEqual(["первый.md"]);
    expect(readFormats("не список")).toEqual([]);
  });

  test("форматы переживают запись и чтение", () => {
    const state = readState(
      { settings: { formats: [{ name: "Книга", noteTemplate: "Templates/Книга.md" }] } },
      300,
      "ru",
    );
    const again = readState(JSON.parse(JSON.stringify(stateToJSON(state))), 300, "ru");
    expect(again.settings.formats).toEqual(state.settings.formats);
    expect(formatNamed(again.settings, "Книга")?.noteTemplate).toBe("Templates/Книга.md");
    expect(formatNamed(again.settings, "Нет такого")).toBeUndefined();
  });

  test("якорь с пробелами годится — шаблон второй версии не отбрасывается молча", () => {
    expect(hasAnchor("> {{text}} ^{{anchor}}")).toBe(true);
    expect(hasAnchor("> {{ text }} ^{{ anchor }}")).toBe(true);
    expect(hasAnchor("> {{ text }} ^{{- anchor -}}")).toBe(true);
    expect(hasAnchor("> {{ text }}")).toBe(false);
    expect(acceptableTemplate("> {{ text }} ^{{ anchor }}")).toBe("> {{ text }} ^{{ anchor }}");
  });

  // Приёмка вслепую 20261012, Н2: файл секции с циклом второй версии писал
  // якорь путём — `{{ a.anchor }}` — и сторож отвергал его как «без якоря».
  test("якорь путём внутри цикла второй версии — тоже якорь", () => {
    expect(hasAnchor("{% for a in annotations %}> {{ a.text }}\n^{{ a.anchor }}\n{% endfor %}")).toBe(true);
    expect(hasAnchor("{% for a in annotations %}^{{a.anchor}}{% endfor %}")).toBe(true);
    expect(hasAnchor("{% for a in annotations %}{{ a.text }}{% endfor %}")).toBe(false);
    // Чужое имя с таким же хвостом якорем не считается.
    expect(hasAnchor("{{ a.anchorless }}")).toBe(false);
  });
});
