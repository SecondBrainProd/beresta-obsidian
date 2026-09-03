import { describe, expect, test } from "vitest";

import { ConflictBoard, describeBoard } from "../src/conflicts-view";
import type { SyncReport } from "../src/sync/pass";

/**
 * Панель расхождений.
 *
 * Проверяется то же, что и у строки состояния, и по той же причине: панель —
 * это слова, и решение здесь ровно одно — какими они будут. Плюс одно
 * устройство: записи заметки **заменяются**, а не копятся. Панель, которая
 * копит, через неделю показывает то, чего давно нет, и человек перестаёт в неё
 * смотреть — то есть перестаёт узнавать про замороженные блоки.
 */

const JEDI = "Base/Библиотека/Джедайские техники.md";
const MIND = "Base/Библиотека/Гибкое сознание.md";

function report(over: Partial<SyncReport> = {}): SyncReport {
  return {
    stamp: "20260806 1306",
    visited: [],
    written: [],
    quotes: {},
    deferred: [],
    missing: [],
    refusals: [],
    conflicts: {},
    removed: {},
    deleted: {},
    unknownBooks: {},
    ...over,
  };
}

describe("панель расхождений", () => {
  test("правка человека попадает в панель и названа его правкой", () => {
    const board = new ConflictBoard();
    board.accept(
      report({
        visited: [JEDI],
        conflicts: {
          [JEDI]: [
            {
              anchor: "hl-aaaa1111",
              kind: "edited",
              message: "Блок правили вы — он остаётся вашим и больше не перерисовывается.",
            },
          ],
        },
      }),
    );

    expect(board.count).toBe(1);
    expect(board.ownEdits).toBe(1);
    expect(board.entries[0]).toMatchObject({ path: JEDI, anchor: "hl-aaaa1111", kind: "ваша-правка" });
  });

  test("записи заметки заменяются проходом, который её видел", () => {
    const board = new ConflictBoard();
    board.accept(report({ visited: [MIND], deferred: [MIND] }));
    expect(board.count).toBe(1);

    // Человек сохранил заметку, запись состоялась. Строка «ждёт сохранения»
    // обязана уйти сама: панель показывает положение дел, а не журнал.
    board.accept(report({ visited: [MIND], written: [MIND] }));
    expect(board.count).toBe(0);
  });

  test("заметку, которой проход не касался, панель не забывает", () => {
    const board = new ConflictBoard();
    board.accept(report({ visited: [JEDI, MIND], deferred: [JEDI] }));
    // Следующий проход сверял только одну книгу — про вторую он ничего нового
    // не узнал, и молчание о ней не значит «расхождение исчезло».
    board.accept(report({ visited: [MIND], written: [MIND] }));
    expect(board.entries.map((entry) => entry.path)).toEqual([JEDI]);
  });

  test("отложенная запись и отказ по файлу видны словами, а не кодом", () => {
    const board = new ConflictBoard();
    board.accept(
      report({
        visited: [JEDI, MIND],
        deferred: [MIND],
        refusals: [
          {
            path: JEDI,
            refused: "section-missing",
            message: "В этой заметке нет секции Beresta — ни открывающего маркера, ни закрывающего.",
          },
        ],
      }),
    );
    const words = describeBoard(board.entries).join("\n");
    expect(words).toContain("несохранённые правки");
    expect(words).toContain("нет секции Beresta");
    expect(words).toContain(MIND);
    expect(words).toContain(JEDI);
  });

  test("книга, которой нет в выгрузке, названа заметкой и книгой", () => {
    const board = new ConflictBoard();
    board.accept(report({ visited: [MIND], unknownBooks: { [MIND]: ["5650781E"] } }));
    const words = describeBoard(board.entries).join("\n");
    expect(words).toContain("5650781E");
    expect(words).toContain("не трогаются");
    // Это не «ваша правка»: счётчик в строке состояния считает то, что человек
    // сделал сам, а не то, что случилось с выгрузкой.
    expect(board.ownEdits).toBe(0);
  });

  test("пустая панель объясняет, что здесь появится", () => {
    const words = describeBoard([]).join("\n");
    expect(words).toContain("Расхождений нет.");
    expect(words).toContain("остаются вашими");
  });

  test("панель начинается с ответа «делать ничего не нужно»", () => {
    const board = new ConflictBoard();
    board.accept(
      report({
        visited: [JEDI],
        conflicts: {
          [JEDI]: [{ anchor: "hl-1", kind: "edited-and-changed", message: "Блок правили вы." }],
        },
      }),
    );
    const lines = describeBoard(board.entries);
    expect(lines[0]).toContain("ваша правка и приложение разошлись");
    expect(lines.join("\n")).toContain("Делать ничего не нужно");
  });

  test("ни одного слова тревоги на всех видах записей", () => {
    const board = new ConflictBoard();
    board.accept(
      report({
        visited: [JEDI, MIND],
        deferred: [MIND],
        missing: ["Base/Библиотека/Пропавшая.md"],
        unknownBooks: { [MIND]: ["1884685D"] },
        conflicts: {
          [JEDI]: [
            { anchor: "hl-1", kind: "gone-in-app", message: "В приложении этой выписки больше нет." },
            { anchor: "", kind: "head", message: "Заголовок секции переписан вами." },
          ],
        },
      }),
    );
    const words = describeBoard(board.entries).join("\n").toLowerCase();
    for (const alarm of ["ошибк", "сбой", "авари", "внимание", "критич", "конфликт"]) {
      expect(words, `тревожное слово: ${alarm}`).not.toContain(alarm);
    }
  });
});
