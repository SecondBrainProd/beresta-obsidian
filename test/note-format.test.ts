/**
 * Формат заметки в работе (план `20261008-шаблоны-плагина-план.md`, задачи 4–6):
 * шаблон заметки, свойство формата, путь по образцу, шаблон блока по заметке,
 * готовые форматы.
 *
 * **Резы, каждый в одиночку:**
 * 1. проход берёт `""` вместо `initialText` у новой заметки — краснеет
 *    «выписки на своём месте в шаблоне заметки»;
 * 2. проход рисует блоки шаблоном настроек, а не `templateFor(path)` — краснеет
 *    «разные блоки у разных форматов»;
 * 3. `FormatTemplates.templateFor` при негодном файле отдаёт `undefined` вместо
 *    броска — краснеет «нет файла — слова с путём, а не стандартный шаблон».
 */
import { beforeEach, describe, expect, test } from "vitest";

import { FormatTemplateError, FormatTemplates, notePathFor } from "../src/formats";
import { EMPTY_SECTION, FORMAT_KEY, renderNote, withFormatProperty } from "../src/render/note";
import { defaultFormats, defaultSectionFile } from "../src/render/default-formats";
import { hasAnchor } from "../src/settings";
import { readState } from "../src/settings";
import { readSnapshot } from "../src/snapshot";
import type { SnapshotBook } from "../src/snapshot/model";
import { runSync, type SyncInput } from "../src/sync/pass";
import type { KnownSection } from "../src/merge/fuse";
import { panelWords } from "../src/ui/words";
import { FakeVault } from "./harness/vault";

const RU = panelWords("ru");

function book(over: Partial<SnapshotBook> = {}): SnapshotBook {
  return {
    uuid: "5650781E-4943-515E-B644-7745D3BB9759",
    title: "Гибкое сознание: новый взгляд",
    authors: ["Кэрол Дуэк"],
    source: undefined,
    ownThought: "Способности растут от усилия",
    details: {
      kind: "book",
      subtitle: undefined,
      publisher: "Манн, Иванов и Фербер",
      published: "2013-04-12",
      language: "ru",
      series: undefined,
      seriesIndex: undefined,
      tags: ["психология", "личная эффективность"],
      collections: ["Ремесло", "Фокус"],
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
    ...over,
  };
}

describe("шаблон заметки и формат", () => {
  test("готовый формат «Книга» рисует свойства, мысль и место хайлайтов", () => {
    const ready = defaultFormats("ru")[0];
    const text = renderNote(ready.text, book(), ready.name, RU.pass);
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain('Название: "Гибкое сознание: новый взгляд"');
    expect(text).toContain('Автор:\n  - "[[Кэрол Дуэк]]"\n');
    expect(text).toContain("Год издания: 2013");
    expect(text).toContain('  - "личная_эффективность"');
    expect(text).toContain('Полки: "Ремесло, Фокус"');
    expect(text).toContain(`${FORMAT_KEY}: Книга`);
    expect(text).toContain("> Способности растут от усилия");
    expect(text).toContain(EMPTY_SECTION);
    expect(text).not.toMatch(/\{\{|\{%/);
  });

  test("готовый формат «Статья» без автора и меток не ломается", () => {
    const ready = defaultFormats("ru")[1];
    const text = renderNote(
      ready.text,
      book({ authors: [], source: "https://example.org/a", details: { ...book().details!, kind: "article", tags: [] } }),
      ready.name,
      RU.pass,
    );
    expect(text).toContain('URL: "https://example.org/a"');
    expect(text).toContain("> [Гибкое сознание\\: новый взгляд](https://example.org/a)");
    expect(text).toContain(EMPTY_SECTION);
  });

  // Проверка безопасности 0.3.0 (20261014): чужое имя автора с кавычкой,
  // обратной косой и переводом строки ломало шапку; у книги с соавторами
  // строка `"[[А]]", "[[Б]]"` не была законным YAML вовсе.
  // Рез: верните автора строкой с `replace('"', '')` — краснеет.
  test("авторы в шапке «Книги» — список законных строк, чужие символы не ломают её", () => {
    const ready = defaultFormats("ru")[0];
    const text = renderNote(
      ready.text,
      book({ authors: ['Иван "Тёмный"\\', "Мария]]|#Б\nберesta-book-id: подмена"] }),
      ready.name,
      RU.pass,
    );
    const head = text.split("\n---\n")[0].split("\n");
    const start = head.indexOf("Автор:");
    expect(start, text).toBeGreaterThan(0);
    const items = head.slice(start + 1, start + 3);
    for (const item of items) {
      expect(item, item).toMatch(/^  - "/);
      const value = JSON.parse(item.slice(4)) as string;
      expect(value.startsWith("[[") && value.endsWith("]]"), value).toBe(true);
      expect(value.slice(2, -2), value).not.toMatch(/[[\]|#^\\\n]/);
    }
    expect(head.some((line) => line.startsWith("берesta-book-id") || line.startsWith("beresta-book-id")), text).toBe(false);
  });

  // Проверка безопасности 0.3.0: название статьи с чужого сайта закрывало
  // ссылку на источник и дописывало Markdown; адрес не той схемы попадал в ссылку.
  // Рез: верните `[{{ title }}]({{ url }})` — краснеет.
  test("ссылка на источник у «Статьи»: чужое название и адрес не выходят из неё", () => {
    const ready = defaultFormats("ru")[1];
    const article = (title: string, source: string) =>
      renderNote(
        ready.text,
        book({ title, authors: [], source, details: { ...book().details!, kind: "article", tags: [] } }),
        ready.name,
        RU.pass,
      );
    const hostile = article("Взлом](javascript:alert(1))\n# Подмена", "https://example.org/a (b)");
    const linkLine = (note: string) =>
      note.split("\n").find((line) => line.startsWith("> [") && !line.startsWith("> [!"));
    const link = linkLine(hostile);
    expect(link, hostile).toBe(
      "> [Взлом\\]\\(javascript\\:alert\\(1\\)\\) \\# Подмена](https://example.org/a%20%28b%29)",
    );
    expect(hostile).not.toMatch(/^# Подмена/m);

    const script = article("Статья", "javascript:alert(1)");
    expect(linkLine(script), script).toBe("> [Статья]()");

    // HTML в названии не открывает тега: `<` экранирован.
    const html = article('<img src=x onerror="alert(1)"> и <iframe src="https://evil">', "https://example.org/a");
    const htmlLink = linkLine(html) ?? "";
    expect(htmlLink, html).not.toMatch(/(^|[^\\])</);
  });

  // Приёмка вслепую 20261012, Н1: `Серия: "…" (12)` — текст после закрывающей
  // кавычки, YAML целиком не разбирался, Obsidian не видел ни одного свойства.
  test("книга с номером серии: каждое свойство — своей строкой, шапка разбирается", () => {
    const ready = defaultFormats("ru")[0];
    const text = renderNote(
      ready.text,
      book({ details: { ...book().details!, series: "Литературные памятники", seriesIndex: 12 } }),
      ready.name,
      RU.pass,
    );
    expect(text).toContain('Серия: "Литературные памятники"\nНомер в серии: 12\n');
    const head = text.split("\n---\n")[0].split("\n").slice(1);
    // Каждая строка шапки — `ключ: значение` или элемент списка; значение в
    // кавычках кончается кавычкой, хвоста после неё нет.
    for (const line of head) {
      expect(line, line).toMatch(/^(\s+- .*|[^:]+:( .*)?)$/);
      if (/: "/.test(line)) expect(line, line).toMatch(/"$/);
    }
    // Н8: перенос строки в аргументе `replace` — экранированный, не живой.
    expect(ready.text).not.toMatch(/replace\("\n/);
    // Н6: секция приносит свой заголовок — второго над местом хайлайтов нет.
    expect(ready.text).not.toContain("### Хайлайты");
  });

  // Н9: у книги без адреса «Статья» давала `URL: ""` и пустую ссылку `[…]()`.
  test("«Статья» без адреса — ни пустого URL, ни пустой ссылки", () => {
    const ready = defaultFormats("ru")[1];
    const text = renderNote(ready.text, book({ source: undefined }), ready.name, RU.pass);
    expect(text).not.toContain("URL:");
    expect(text).not.toContain("]()");
    expect(text).not.toContain("[!link]");
  });

  // Н2: кнопка кладёт и файл секции — стандартную секцию с циклом и якорем.
  test("готовый файл секции — стандартная секция на языке интерфейса, с якорем", () => {
    for (const language of ["ru", "en"]) {
      const section = defaultSectionFile(language);
      expect(section.file).toMatch(/^Templates\//);
      expect(hasAnchor(section.text)).toBe(true);
      expect(section.text).toContain("{{#annotations}}");
    }
    expect(defaultSectionFile("ru").text).toContain("## Хайлайты из Beresta");
    expect(defaultSectionFile("en").text).not.toContain("Выписки");
  });

  test("свойство формата заводит frontmatter, если его не было, и не двоится", () => {
    expect(withFormatProperty("тело", "Книга")).toBe(`---\n${FORMAT_KEY}: Книга\n---\nтело`);
    const twice = withFormatProperty(withFormatProperty("---\na: 1\n---\nтело", "Книга"), "Статья");
    expect(twice.match(new RegExp(FORMAT_KEY, "g"))?.length).toBe(1);
    expect(twice).toContain(`${FORMAT_KEY}: Статья`);
  });

  test("путь по образцу формата — с той же очисткой имени", () => {
    const path = notePathFor({ name: "Книга", pathPattern: "Библиотека/Книги/{{ title }}.md" }, book(), "Library");
    expect(path).toBe("Библиотека/Книги/Гибкое сознание. новый взгляд.md");
    expect(notePathFor(undefined, book(), "Library")).toBe("Library/Гибкое сознание. новый взгляд.md");
  });
});

describe("находки проверки безопасности 20261008", () => {
  // Рез: уберите `| yaml` у `title` в готовом шаблоне — краснеет.
  test("название с переводом строки не дописывает свойства заметки", () => {
    const ready = defaultFormats("ru")[1];
    const hostile = book({ title: 'Статья\nberesta-book-id: ["чужая"]\ntags: [взлом]' });
    const text = renderNote(ready.text, hostile, ready.name, RU.pass);
    const front = text.split("\n---")[0];
    expect(front).not.toMatch(/^beresta-book-id:/m);
    expect(front).not.toMatch(/^tags: \[взлом\]/m);
    expect(front).toContain('Название: "Статья beresta-book-id: [\\"чужая\\"] tags: [взлом]"');
  });

  // Рез: уберите фильтр сегментов `..` в `notePathFor` — краснеет.
  test("название из «../» не выводит заметку за папку формата", () => {
    const path = notePathFor({ name: "Книга", pathPattern: "Библиотека/{{ title }}.md" }, book({ title: "../../../etc/x" }), "Library");
    expect(path.startsWith("Библиотека/")).toBe(true);
    expect(path.split("/")).not.toContain("..");
    expect(path.split("/").length).toBe(2);
    const sneaky = notePathFor({ name: "Книга", pathPattern: "{{ title }}/{{ title }}.md" }, book({ title: ".." }), "Library");
    expect(sneaky.split("/")).not.toContain("..");
  });
});

describe("шаблоны блоков по форматам", () => {
  const settingsWith = (formats: unknown) =>
    readState({ settings: { formats } }, 300, "ru").settings;

  test("нет файла — слова с путём, а не стандартный шаблон (Р4)", async () => {
    const settings = settingsWith([{ name: "Книга", blockTemplate: "Templates/Нет.md" }]);
    const templates = new FormatTemplates(
      { read: async () => Promise.reject(new Error("нет")), formatOf: () => "Книга" },
      () => settings,
      () => RU,
    );
    await templates.reload();
    expect(() => templates.templateFor("Заметка.md")).toThrow(FormatTemplateError);
    expect(() => templates.templateFor("Заметка.md")).toThrow(/Templates\/Нет\.md/);
  });

  test("у заметки без формата и у формата без своего блока — стандартный", async () => {
    const settings = settingsWith([{ name: "Книга", noteTemplate: "Templates/Книга.md" }]);
    const templates = new FormatTemplates(
      { read: async () => "> {{text}} ^{{anchor}}", formatOf: (path) => (path === "А.md" ? "Книга" : undefined) },
      () => settings,
      () => RU,
    );
    await templates.reload();
    expect(templates.templateFor("А.md")).toBeUndefined();
    expect(templates.templateFor("Б.md")).toBeUndefined();
  });

  // Н4 приёмки 20261012: формат удалён, заметка его помнит — проход молчал.
  test("заметки с форматом, которого больше нет, копятся и отдаются один раз", async () => {
    const settings = settingsWith([{ name: "Книга", noteTemplate: "Templates/Книга.md" }]);
    const templates = new FormatTemplates(
      { read: async () => "", formatOf: (path) => (path === "Без.md" ? undefined : "Опыт") },
      () => settings,
      () => RU,
    );
    await templates.reload();
    expect(templates.templateFor("Dracula.md")).toBeUndefined();
    expect(templates.templateFor("Шинель.md")).toBeUndefined();
    expect(templates.templateFor("Без.md")).toBeUndefined();
    const gone = templates.takeGone();
    expect([...gone.keys()]).toEqual(["Опыт"]);
    expect([...gone.get("Опыт")!].sort()).toEqual(["Dracula.md", "Шинель.md"]);
    expect(templates.takeGone().size).toBe(0);
  });
});

// ⚠️ Проход целиком — на снимке владельца, как в `sync-pass.test.ts`.
const SMALL_BOOK = "5650781E-4943-515E-B644-7745D3BB9759";
let vault: FakeVault;
let memory: Map<string, KnownSection>;

beforeEach(() => {
  vault = new FakeVault();
  vault.putSnapshot("owner-library");
  memory = new Map();
});

function input(over: Partial<SyncInput>): Omit<SyncInput, "snapshot"> & Partial<SyncInput> {
  return {
    bindings: new Map(),
    notes: vault,
    backups: vault.backups(),
    language: "ru",
    memory: {
      get: (path) => memory.get(path),
      set: (path, known) => {
        memory.set(path, known);
      },
    },
    settings: { timeZoneOffsetMinutes: 300, keepBackups: 5, removalShare: 0.2, removalCount: 20 },
    now: Date.parse("2026-10-08T16:14:03Z"),
    ...over,
  };
}

describe("проход с форматами", () => {
  test("выписки на своём месте в шаблоне заметки, рукописное вокруг цело", async () => {
    const NEW = "Библиотека/Новая.md";
    const initial = withFormatProperty(`# Мои мысли\n\n${EMPTY_SECTION}\n\n## После хайлайтов\n`, "Книга");
    await runSync({
      snapshot: await readSnapshot(vault),
      ...input({
        bindings: new Map([[NEW, [SMALL_BOOK]]]),
        creating: new Set([NEW]),
        initialText: (path) => (path === NEW ? initial : undefined),
      }),
    } as SyncInput);
    const after = vault.peek(NEW)!;
    expect(after).toContain(`${FORMAT_KEY}: Книга`);
    expect(after).toContain("beresta-book-id");
    const begin = after.indexOf("%% beresta:begin %%");
    expect(after.indexOf("# Мои мысли")).toBeLessThan(begin);
    expect(after.indexOf("## После хайлайтов")).toBeGreaterThan(after.indexOf("%% beresta:end %%"));
    expect(after.slice(begin)).toMatch(/\^hl-/);
  });

  test("разные блоки у разных форматов в одном проходе", async () => {
    const A = "Библиотека/А.md";
    const B = "Библиотека/Б.md";
    for (const path of [A, B]) {
      vault.put(path, `---\nberesta-book-id:\n  - ${SMALL_BOOK}\n---\n`);
    }
    const report = await runSync({
      snapshot: await readSnapshot(vault),
      ...input({
        bindings: new Map([
          [A, [SMALL_BOOK]],
          [B, [SMALL_BOOK]],
        ]),
        mayCreateSection: new Set([A, B]),
        templateFor: (path) =>
          path === A ? "{{#annotations}}- ФОРМАТ-А {{text}} ^{{anchor}}\n{{/annotations}}" : undefined,
      }),
    } as SyncInput);
    expect(report.refusals).toEqual([]);
    expect(vault.peek(A)!).toContain("ФОРМАТ-А");
    expect(vault.peek(B)!).not.toContain("ФОРМАТ-А");
  });
});
