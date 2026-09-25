import { describe, expect, test } from "vitest";

import { bindingNoticeWords, chosenCountWords, moreCandidatesWords } from "../src/binding/binding-view";
import { commandSpecs } from "../src/commands";
import { splitFile } from "../src/merge/zones";
import { SECTION_BEGIN, SECTION_END } from "../src/render/section";
import { renderTemplate } from "../src/render/template";
import { ForeignSnapshotFormat, SnapshotTooNew } from "../src/snapshot/model";
import { writeVerdict } from "../src/write/gate";
import { ConflictBoard, describeBoard } from "../src/conflicts-view";
import {
  INTERVAL_FIELD,
  KEEP_BACKUPS_FIELD,
  OFFSET_FIELD,
  REMOVAL_COUNT_FIELD,
  readFolderField,
  readNumberField,
  readTemplateField,
} from "../src/settings";
import { EMPTY_STATUS, statusHint, statusLine, syncNowWords, type StatusState } from "../src/status";
import { counted, fill, panelWords, type PanelWords } from "../src/ui/words";

/**
 * Панели плагина по языку интерфейса — партия 1 долга 0.3в: команды,
 * уведомления, страница настроек.
 *
 * Тип `PanelWords` не даёт пропустить ключ, но не ловит два промаха, которые
 * тип не видит: русское слово, оставшееся в английской таблице после
 * копирования, и подстановку, которую забыли заполнить. Обе ловятся здесь.
 */

const CYRILLIC = /[А-Яа-яЁё]/;

/** Все строки словаря списком: ключ → слово, по вложенным группам. */
function leaves(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === "string") return [[path.join("."), node]];
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) => leaves(value, [...path, key]));
}

describe("слова панелей", () => {
  test("в английской таблице нет кириллицы, в обеих — пустых строк", () => {
    for (const [key, word] of leaves(panelWords("en"))) {
      expect(word, key).not.toMatch(CYRILLIC);
      expect(word.trim().length, key).toBeGreaterThan(0);
    }
    for (const [key, word] of leaves(panelWords("ru"))) {
      expect(word.trim().length, key).toBeGreaterThan(0);
    }
  });

  test("подстановки в двух языках одни и те же", () => {
    // Порядок слов разный, набор подстановок — нет: `{path}` есть в обеих
    // строках или ни в одной, иначе в одном языке человек не увидит, где
    // искали указатель.
    const en = new Map(leaves(panelWords("en")));
    for (const [key, ru] of leaves(panelWords("ru"))) {
      const holes = (word: string): string[] =>
        [...word.matchAll(/(?<!\{)\{([a-zA-Z]+)\}(?!\})/g)].map((m) => m[1]).sort();
      expect(holes(en.get(key) ?? ""), key).toEqual(holes(ru));
    }
  });

  test("незнакомый язык — английский, не пустота и не русский", () => {
    expect(panelWords("de")).toBe(panelWords("en"));
    expect(panelWords("")).toBe(panelWords("en"));
    expect(panelWords("ru")).not.toBe(panelWords("en"));
  });

  test("`fill` подставляет своё и не трогает слова шаблона", () => {
    expect(fill("{a} и {b}", { a: 1, b: "два" })).toBe("1 и два");
    // `{{anchor}}` — слово шаблона секции, а не подстановка: пояснение поля
    // шаблона печатает его буквально.
    expect(fill("нет {{anchor}} и {x}", { x: "икс", anchor: "НЕТ" })).toBe("нет {{anchor}} и икс");
    // Незаполненная подстановка видна, а не проглочена.
    expect(fill("от {savedAt}", {})).toBe("от {savedAt}");
  });
});

describe("страница настроек по-английски", () => {
  const EN = panelWords("en").settings;

  test("отказ поля собран из английских слов и называет поле", () => {
    const verdict = readNumberField(OFFSET_FIELD, "Karaganda", EN);
    expect(verdict.kind).toBe("refused");
    if (verdict.kind !== "refused") return;
    expect(verdict.said).toContain("“Karaganda”");
    expect(verdict.said).toContain("stays as it was");
    expect(verdict.said).toContain("300 — Karaganda");
    expect(verdict.said).not.toMatch(CYRILLIC);
  });

  test("границы названы числами — они не переводятся", () => {
    const verdict = readNumberField(KEEP_BACKUPS_FIELD, "500", EN);
    expect(verdict.kind).toBe("refused");
    if (verdict.kind !== "refused") return;
    expect(verdict.said).toContain("1 to 100");
    expect(verdict.said).toContain("5 — as now");
  });

  test("у каждого поля есть слова на обоих языках", () => {
    for (const field of [OFFSET_FIELD, INTERVAL_FIELD, KEEP_BACKUPS_FIELD, REMOVAL_COUNT_FIELD]) {
      for (const language of ["ru", "en"]) {
        const words = panelWords(language).settings.fields[field.key];
        expect(words.name, `${language} ${field.key}`).not.toBe("");
        expect(words.description, `${language} ${field.key}`).not.toBe("");
      }
    }
  });

  test("шаблон и папка отказывают по-английски и без кириллицы", () => {
    const template = readTemplateField("{{text}}", EN);
    expect(template.kind).toBe("refused");
    if (template.kind === "refused") expect(template.said).not.toMatch(CYRILLIC);

    const folder = readFolderField("Library: books", () => true, EN);
    expect(folder.kind).toBe("refused");
    if (folder.kind === "refused") expect(folder.said).toContain("“:”");

    const missing = readFolderField("Library", () => false, EN);
    expect(missing.kind).toBe("ok");
    if (missing.kind === "ok") expect(missing.said).toContain("“Library”");
  });
});

describe("команды по языку", () => {
  test("русские и английские имена — по одному `id`", () => {
    const actions = {
      syncNow: () => undefined,
      bindBooks: () => undefined,
      showConflicts: () => undefined,
      returnSection: () => undefined,
      confirmRemovals: () => undefined,
      restoreVersion: () => undefined,
    };
    const byLanguage = (words: PanelWords) =>
      commandSpecs(actions, words.commands).map((one) => [one.id, one.name] as const);
    const ru = byLanguage(panelWords("ru"));
    const en = byLanguage(panelWords("en"));
    expect(ru.map(([id]) => id)).toEqual(en.map(([id]) => id));
    for (const [, name] of en) expect(name).not.toMatch(CYRILLIC);
    for (const [, name] of ru) expect(name).toMatch(CYRILLIC);
  });
});

describe("строка состояния по-английски", () => {
  const EN = panelWords("en");
  const whole: StatusState = { ...EMPTY_STATUS, snapshot: "целый", dataStamp: "20260806 21:14" };

  test("строка, подпись и ответ команды — теми же числами, без кириллицы", () => {
    const line = statusLine({ ...whole, conflicts: 2, deferred: 1, problems: 3 }, EN);
    expect(line).toBe(
      "Beresta: data as of 20260806 21:14 · 2 edits of yours · " +
        "1 note waiting to be saved · 3 books still arriving",
    );
    const hint = statusHint({ ...whole, unbound: 1 }, Date.parse("2026-08-09T10:00:00Z"), 300, EN);
    expect(hint.join("\n")).toContain("Data as of 20260806 21:14 — that is 3 days ago.");
    expect(hint.join("\n")).toContain("Books without a note: 1.");
    expect(hint.join("\n")).not.toMatch(CYRILLIC);
    const said = syncNowWords({ ...whole, books: 1, quotes: 1, notesWithQuotes: 1 }, EN);
    expect(said).toContain("the export holds 1 book, 1 highlight.");
    expect(said).toContain("The highlights lie in 1 note.");
    expect(said).not.toMatch(CYRILLIC);
  });

  test("здоровье выгрузки словами — на обоих языках, и они разные", () => {
    for (const snapshot of ["нет", "не-читается", "наполовину"] as const) {
      const ru = statusLine({ ...EMPTY_STATUS, snapshot }, panelWords("ru"));
      const en = statusLine({ ...EMPTY_STATUS, snapshot }, EN);
      expect(ru, snapshot).toMatch(CYRILLIC);
      expect(en, snapshot).not.toMatch(CYRILLIC);
      expect(en, snapshot).toMatch(/^Beresta: /);
    }
  });

  test("две формы против трёх: 21 по-русски «книга», по-английски «books»", () => {
    const ru = panelWords("ru");
    expect(counted(ru, 21, ru.status.syncNow.books)).toBe("21 книга");
    expect(counted(ru, 3, ru.status.syncNow.books)).toBe("3 книги");
    expect(counted(ru, 11, ru.status.syncNow.books)).toBe("11 книг");
    expect(counted(EN, 21, EN.status.syncNow.books)).toBe("21 books");
    expect(counted(EN, 1, EN.status.syncNow.books)).toBe("1 book");
  });
});

describe("панель расхождений по-английски", () => {
  const EN = panelWords("en");

  test("пустая доска и доска с записями — без кириллицы, счёт по-английски", () => {
    expect(describeBoard([], EN).join("\n")).toContain("No discrepancies.");
    expect(describeBoard([], EN).join("\n")).not.toMatch(CYRILLIC);

    const board = new ConflictBoard(EN);
    board.accept({
      stamp: "20260806 2114",
      visited: [],
      written: [],
      quotes: {},
      conflicts: {},
      deferred: ["Books/Jedi.md"],
      refusals: [],
      missing: ["Books/Mind.md"],
      removed: {},
      deleted: {},
      unknownBooks: { "Books/Gone.md": ["5650781E", "AB12CD34"] },
    });
    const words = describeBoard(board.entries, EN).join("\n");
    expect(words).toContain("Books/Jedi.md — 1 entry");
    expect(words).toContain("The export has no books 5650781E, AB12CD34.");
    expect(words).toContain("data as of 20260806 2114");
    expect(words).not.toMatch(CYRILLIC);
    // Внутренние виды записей языку не подчиняются: по ним считает строка состояния.
    expect(board.entries.map((entry) => entry.kind)).toEqual(["ждёт-сохранения", "заметки-нет", "книги-нет"]);
  });
});

describe("окно привязки по-английски", () => {
  const EN = panelWords("en");

  test("ответ на нажатие — числами, без кириллицы, с формами на язык", () => {
    const words = bindingNoticeWords(
      {
        chosen: 1,
        written: [{ path: "Books/Jedi.md", quotes: 40 }],
        deferred: [],
        failed: ["Books/Mind.md", "Books/Gone.md"],
      },
      EN,
    );
    expect(words.head).toBe("Beresta: 1 book bound, 40 highlights landed in the note:");
    expect(words.notes).toEqual([{ path: "Books/Jedi.md", tail: "— 40 highlights" }]);
    expect(words.rest).toEqual([
      "The pass refused 2 more notes — the reason comes as a separate message.",
    ]);
    for (const line of [words.head, ...words.rest]) expect(line).not.toMatch(CYRILLIC);
  });

  test("ничего не легло — сказано почему", () => {
    const words = bindingNoticeWords(
      { chosen: 2, written: [], deferred: ["Books/Jedi.md"], failed: [] },
      EN,
    );
    expect(words.head).toContain("the note is open with unsaved edits");
    expect(words.head).not.toMatch(CYRILLIC);
  });

  test("счётчик и кнопка «показать ещё»", () => {
    expect(chosenCountWords(0, 5, EN)).toBe("Nothing chosen yet");
    expect(chosenCountWords(2, 5, EN)).toBe("2 books chosen of 5");
    expect(chosenCountWords(1, 5, panelWords("ru"))).toBe("Выбрано 1 книга из 5");
    expect(moreCandidatesWords([], EN)).toBe("Show 0 more notes with a weak match");
  });
});

describe("слова прохода по-английски", () => {
  const EN = panelWords("en");

  test("предохранитель называет оба числа, уведомления — заметки", () => {
    const fuse = fill(counted(EN, 1, EN.pass.tooManyRemovals), { previous: 40 });
    expect(fuse).toContain("remove 1 block of 40.");
    expect(fill(counted(EN, 7, EN.pass.tooManyRemovals), { previous: 40 })).toContain("7 blocks of 40");
    const deferred = fill(EN.pass.deferredNotes[EN.form(2)], { paths: "a.md, b.md" });
    expect(deferred).toBe(
      "Beresta: notes are open with unsaved edits — the highlights will arrive as " +
        "soon as you save: a.md, b.md",
    );
    expect(fill(counted(EN, 1, EN.pass.backupRecord), { savedAt: "20260806-2114" })).toBe(
      "20260806-2114 — 1 character",
    );
  });
});

describe("маркеры и шаблон по-английски", () => {
  const EN = panelWords("en").pass;

  test("отказ по маркерам и ошибки шаблона — по языку, без кириллицы", () => {
    const zones = splitFile(`${SECTION_END}\n${SECTION_BEGIN}\n`, EN);
    expect(zones.kind).toBe("broken");
    if (zones.kind === "broken") {
      expect(zones.message).toContain("comes before the opening one");
      expect(zones.message).not.toMatch(CYRILLIC);
    }
    const scope = { fields: { a: "1" }, lists: {} };
    expect(() => renderTemplate("{{#a}}", scope, EN)).toThrow("does not close the piece “{{#a}}”");
    expect(() => renderTemplate("{{nope}}", scope, EN)).toThrow("Available: a");
    expect(() => renderTemplate("{{nope}}", scope, panelWords("ru").pass)).toThrow("Доступны: a");
    // Слова шаблона «{{имя}}» в подсказке — не подстановки: они печатаются как есть.
    expect(() => renderTemplate("{{ a }", scope, EN)).toThrow("written as “{{name}}”");
  });
});

describe("ошибки формата и отказ по несохранённой заметке — по языку", () => {
  test("ошибки формата выгрузки и отказ записи — из словаря", () => {
    const EN = panelWords("en").pass;
    expect(new SnapshotTooNew(9, EN).message).toContain("format version 9");
    expect(new SnapshotTooNew(9, panelWords("ru").pass).message).toContain("Обновите плагин");
    expect(new ForeignSnapshotFormat("x", EN).message).toContain("calls itself format “x”");
    const verdict = writeVerdict({ path: "a.md", onDisk: "1", inEditor: "2" }, EN);
    expect(verdict.kind).toBe("defer");
    if (verdict.kind === "defer") {
      expect(verdict.message).toContain("The note “a.md” is open");
      expect(verdict.message).not.toMatch(CYRILLIC);
    }
  });
});
