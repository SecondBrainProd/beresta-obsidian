import { afterEach, describe, expect, it } from "vitest";

import type { SettingDefinitionItem } from "obsidian";

import { DEFAULT_SETTINGS, type BerestaSettings, type NoteFormat } from "../src/settings";
import { BerestaSettingTab, type SettingsHost } from "../src/ui/settings-tab";
import { fill, panelWords } from "../src/ui/words";

/**
 * Страница настроек описанием (API Obsidian 1.13, плагин 0.3.4, решение
 * владельца 20261018).
 *
 * Окна здесь нет: строки рисует сам Obsidian, и как они выглядят, эта проверка
 * не видит (раздел «не проверено живьём» в PR). Видит она ОПИСАНИЕ — то, что
 * Obsidian индексирует для поиска и по чему узнаёт строки при перерисовке:
 *
 * 1. каждое слово прежней страницы — имя или пояснение строки, на обоих языках;
 *    поиск находит только то, что лежит в описании;
 * 2. ключи не повторяются: строку Obsidian узнаёт по имени внутри группы,
 *    группу — по заголовку (сверено по коду Obsidian 1.14.4, `C4`/`E4`), и на
 *    повторе перерисовывает непредсказуемо;
 * 3. сколько форматов в настройке — столько групп формата, у каждой кнопка
 *    удаления и четыре поля;
 * 4. `display()` у вкладки не переопределён — его каталог и считает
 *    устаревшим, а на 1.13 он при непустом описании не зовётся вовсе.
 *
 * Резы (прогнаны 20261018, каждый красный в одиночку):
 * - в `formatGroup` заголовок без номера (`words.formatHeading` вместо `fill`) —
 *   краснеет «заголовки групп не повторяются»;
 * - в `formatText` пояснение не передаётся — краснеет «каждое слово страницы
 *   в описании»;
 * - в `getSettingDefinitions` форматы `slice(1)` — краснеет «групп формата
 *   столько же, сколько форматов»;
 * - вернуть в класс `override display(): void {}` — краснеет «display не
 *   переопределён».
 */

const storage = globalThis.localStorage;

afterEach(() => {
  if (storage === undefined) {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  } else {
    (globalThis as { localStorage?: unknown }).localStorage = storage;
  }
});

function speak(language: string): void {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => (key === "language" ? language : null),
  };
}

function tab(formats: NoteFormat[], withCreateFile = true): BerestaSettingTab {
  const settings: BerestaSettings = { ...DEFAULT_SETTINGS, timeZoneOffsetMinutes: 300, formats };
  const host: SettingsHost = {
    settingsNow: () => settings,
    save: async () => {},
    ...(withCreateFile ? { createFile: async () => true } : {}),
  };
  return new BerestaSettingTab({} as never, {} as never, host);
}

interface Group {
  readonly heading: string | undefined;
  readonly names: string[];
  readonly descs: string[];
  readonly extraButtons: number;
}

/** Описание — плоским списком групп: так его и раскладывает Obsidian. */
function groups(items: SettingDefinitionItem[]): Group[] {
  return items.map((item) => {
    expect("type" in item && item.type === "group", "верхний уровень — только группы").toBe(true);
    const group = item as Extract<SettingDefinitionItem, { type: "group" | "list" }>;
    const rows = (group.items ?? []) as { name: string; desc?: unknown; render?: unknown }[];
    for (const row of rows) {
      expect(typeof row.render, `строка «${row.name}» рисуется своим кодом`).toBe("function");
    }
    return {
      heading: group.heading,
      names: rows.map((row) => row.name),
      descs: rows.map((row) => (typeof row.desc === "string" ? row.desc : "")),
      extraButtons: group.extraButtons?.length ?? 0,
    };
  });
}

const FORMATS: NoteFormat[] = [{ name: "Книга" }, { name: "Статья" }, { name: "Лекция" }];

describe("страница настроек описанием", () => {
  for (const language of ["ru", "en"] as const) {
    it(`каждое слово страницы в описании (${language})`, () => {
      speak(language);
      const words = panelWords(language).settings;
      const all = groups(tab(FORMATS).getSettingDefinitions());
      const texts = new Set(all.flatMap((group) => [group.heading ?? "", ...group.names, ...group.descs]));

      const expected = [
        ...Object.values(words.fields).flatMap((field) => [field.name, field.description]),
        words.folderName,
        words.folderDescription,
        words.templateName,
        words.templateDescription,
        words.formats.heading,
        words.formats.description,
        words.formats.add,
        words.formats.addDefaults,
        words.formats.addDefaultsDescription,
        words.formats.name,
        words.formats.noteTemplate,
        words.formats.blockTemplate,
        words.formats.blockTemplateDescription,
        words.formats.pathPattern,
        fill(words.formats.formatHeading, { index: "1" }),
      ];
      for (const text of expected) {
        expect(texts.has(text), `нет в описании: «${text}»`).toBe(true);
      }
    });
  }

  it("ключи не повторяются: имена внутри группы и заголовки групп", () => {
    speak("ru");
    const all = groups(tab(FORMATS).getSettingDefinitions());
    for (const group of all) {
      expect(new Set(group.names).size, `повтор имени в группе «${group.heading ?? "без заголовка"}»`).toBe(
        group.names.length,
      );
    }
    const headings = all.map((group) => group.heading).filter((heading) => heading !== undefined);
    expect(new Set(headings).size, "заголовки групп не повторяются").toBe(headings.length);
  });

  it("групп формата столько же, сколько форматов, у каждой удаление и четыре поля", () => {
    speak("ru");
    const words = panelWords("ru").settings.formats;
    for (const formats of [[], FORMATS.slice(0, 1), FORMATS]) {
      const all = groups(tab(formats).getSettingDefinitions());
      const ofFormats = all.filter((group) => group.heading?.startsWith("Формат ") === true);
      expect(ofFormats.map((group) => group.heading), "групп формата столько же, сколько форматов").toEqual(
        formats.map((_, index) => fill(words.formatHeading, { index: String(index + 1) })),
      );
      for (const group of ofFormats) {
        expect(group.extraButtons).toBe(1);
        expect(group.names).toEqual([words.name, words.noteTemplate, words.blockTemplate, words.pathPattern]);
      }
    }
  });

  it("кнопка готовых форматов — только когда есть чем заводить файлы", () => {
    speak("ru");
    const words = panelWords("ru").settings.formats;
    const names = (withCreateFile: boolean): string[] =>
      groups(tab([], withCreateFile).getSettingDefinitions()).flatMap((group) => group.names);
    expect(names(true)).toContain(words.addDefaults);
    expect(names(false)).not.toContain(words.addDefaults);
  });

  it("display не переопределён, описание — переопределено", () => {
    const own = Object.getOwnPropertyNames(BerestaSettingTab.prototype);
    expect(own, "display не переопределён").not.toContain("display");
    expect(own).toContain("getSettingDefinitions");
  });
});
