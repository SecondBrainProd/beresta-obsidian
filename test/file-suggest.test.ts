import { describe, expect, test } from "vitest";
import { suggestTemplatePaths } from "../src/ui/file-suggest";

/**
 * Подсказка файла шаблона в настройках форматов (заказ владельца 20261019:
 * «начинаю набирать Bere, и чтобы плагин показывал, какие заметки есть с
 * такими символами в названии»).
 *
 * Резы (прогнаны 20261019):
 * - сравнение без `toLowerCase` у пути — краснеет «bere находит Beresta»;
 * - `every` → `some` — краснеет «каждое слово набранного»;
 * - без сортировки по рангу — краснеет «имя с начала — первым».
 */
const VAULT = [
  "Библиотека/Beresta и я.md",
  "Templates/Zotero Book.md",
  "Templates/Beresta Highlights.md",
  "Templates/Beresta Book.md",
  "Templates/Beresta Articles.md",
  "Beresta/Заметки.md",
  "Дневник/20261019.md",
];

describe("подсказка файла шаблона", () => {
  test("bere находит Beresta без учёта регистра", () => {
    const found = suggestTemplatePaths(VAULT, "bere");
    expect(found).toContain("Templates/Beresta Book.md");
    expect(found).toContain("Templates/Beresta Highlights.md");
    expect(found).not.toContain("Templates/Zotero Book.md");
    expect(found).not.toContain("Дневник/20261019.md");
  });

  test("каждое слово набранного обязано найтись в пути", () => {
    expect(suggestTemplatePaths(VAULT, "beresta book")).toEqual(["Templates/Beresta Book.md"]);
    expect(suggestTemplatePaths(VAULT, "tem art")).toEqual(["Templates/Beresta Articles.md"]);
  });

  test("имя с начала — первым, имя с серединой — потом, совпавшие папкой — в конце", () => {
    expect(suggestTemplatePaths(VAULT, "beresta")).toEqual([
      "Templates/Beresta Articles.md",
      "Templates/Beresta Book.md",
      "Templates/Beresta Highlights.md",
      "Библиотека/Beresta и я.md",
      "Beresta/Заметки.md",
    ]);
  });

  test("пустой набор показывает все пути по алфавиту, не больше предела", () => {
    expect(suggestTemplatePaths(VAULT, "  ")).toHaveLength(VAULT.length);
    expect(suggestTemplatePaths(VAULT, "", 2)).toHaveLength(2);
  });

  test("ничего не подошло — пустой список, а не все пути", () => {
    expect(suggestTemplatePaths(VAULT, "шаблон-которого-нет")).toEqual([]);
  });
});
