import { describe, expect, test } from "vitest";

import {
  EMPTY_STATUS,
  fileStamp,
  stampOf,
  statusHint,
  statusLine,
  syncNowWords,
  type StatusState,
} from "../src/status";

/**
 * Состояние словами.
 *
 * **Что здесь на самом деле проверяется.** Не форматирование, а два обещания
 * задачи 14: состояние **названо** (молчаливое отставание лечится видимостью, а
 * не механикой) и названо **спокойно** (расхождение — обычное дело, а не
 * авария). Оба выражаются словами, значит проверяются словами.
 */

const KARAGANDA = 300;

function status(over: Partial<StatusState> = {}): StatusState {
  return { ...EMPTY_STATUS, ...over };
}

describe("строка состояния", () => {
  test("говорит, на какой момент данные, а не «синхронизировано»", () => {
    const line = statusLine(status({ snapshot: "целый", dataStamp: "20260806 21:14" }));
    expect(line).toBe("Beresta: данные на 20260806 21:14");
    // «Готово», «синхронизировано» и галочка — это ответ на вопрос, которого
    // человек не задавал. Отставание такими словами не видно.
    expect(line).not.toMatch(/синхрон|готов|✓/i);
  });

  test("выгрузки ещё нет — так и сказано, а не «0 книг»", () => {
    expect(statusLine(status({ snapshot: "нет" }))).toBe("Beresta: выгрузки ещё нет");
  });

  test("выгрузка приехала наполовину — это видно в строке", () => {
    const line = statusLine(status({ snapshot: "наполовину", dataStamp: "20260806 21:14", problems: 2 }));
    expect(line).toContain("выгрузка ещё едет");
    expect(line).toContain("2 книги ещё едет");
  });

  test("числа склоняются по-русски", () => {
    expect(statusLine(status({ snapshot: "целый", dataStamp: "20260806 21:14", conflicts: 1 }))).toContain(
      "1 ваша правка",
    );
    expect(statusLine(status({ snapshot: "целый", dataStamp: "20260806 21:14", conflicts: 3 }))).toContain(
      "3 ваши правки",
    );
    expect(statusLine(status({ snapshot: "целый", dataStamp: "20260806 21:14", conflicts: 11 }))).toContain(
      "11 ваших правок",
    );
    expect(statusLine(status({ snapshot: "целый", dataStamp: "20260806 21:14", deferred: 2 }))).toContain(
      "2 заметки ждут сохранения",
    );
  });

  test("ни одного слова тревоги — расхождение это обычное дело", () => {
    const busy = status({
      snapshot: "наполовину",
      dataStamp: "20260806 21:14",
      conflicts: 4,
      deferred: 1,
      problems: 2,
      notesWithQuotes: 7,
      books: 11,
      quotes: 291,
      unbound: 4,
    });
    const words = [
      statusLine(busy),
      ...statusHint(busy, Date.parse("2026-08-09T10:00:00Z"), KARAGANDA),
      syncNowWords(busy),
    ].join("\n");
    for (const alarm of ["ошибк", "сбой", "авари", "внимание", "критич", "!"]) {
      expect(words.toLowerCase(), `тревожное слово: ${alarm}`).not.toContain(alarm);
    }
  });
});

describe("подпись к строке состояния", () => {
  test("отставание названо днями — иначе оно молчаливое", () => {
    const lines = statusHint(
      status({ snapshot: "целый", dataStamp: "20260806 21:14" }),
      Date.parse("2026-08-09T16:00:00Z"),
      KARAGANDA,
    );
    expect(lines.join("\n")).toContain("Данные на 20260806 21:14 — это 3 дня назад");
  });

  test("свежие данные о возрасте не бормочут", () => {
    const lines = statusHint(
      status({ snapshot: "целый", dataStamp: "20260806 21:14" }),
      Date.parse("2026-08-06T18:40:00Z"),
      KARAGANDA,
    );
    expect(lines.join("\n")).toContain("Данные на 20260806 21:14.");
    expect(lines.join("\n")).not.toContain("назад");
  });

  test("объясняет каждое состояние снимка своими словами", () => {
    expect(statusHint(status({ snapshot: "нет" }), 0, KARAGANDA).join("\n")).toContain(
      "Выгрузки Beresta в этом хранилище ещё нет",
    );
    expect(statusHint(status({ snapshot: "не-читается" }), 0, KARAGANDA).join("\n")).toContain(
      "не разбирается",
    );
    expect(statusHint(status({ snapshot: "наполовину" }), 0, KARAGANDA).join("\n")).toContain(
      "посреди синхронизации",
    );
  });

  test("отложенная запись объяснена причиной, а не «не удалось»", () => {
    const lines = statusHint(status({ snapshot: "целый", deferred: 1 }), 0, KARAGANDA).join("\n");
    expect(lines).toContain("несохранёнными правками");
    expect(lines).toContain("на диске");
  });
});

describe("отметки времени", () => {
  test("момент данных — в формате владельца и в его поясе", () => {
    // 20260806T08:06:40Z + 5 часов Караганды = 13:06 того же дня.
    expect(stampOf("2026-08-06T08:06:40Z", KARAGANDA)).toBe("20260806 1306");
    // Дефисов в датах у владельца нет нигде — ни в файлах, ни во frontmatter.
    expect(stampOf("2026-08-06T08:06:40Z", KARAGANDA)).not.toContain("-");
  });

  test("пояс двигает и дату, а не только часы", () => {
    expect(stampOf("2026-08-06T20:30:00Z", KARAGANDA)).toBe("20260807 0130");
    expect(stampOf("2026-08-06T20:30:00Z", 0)).toBe("20260806 2030");
  });

  test("момента нет — отметка не выдумывается", () => {
    expect(stampOf(undefined, KARAGANDA)).toBe("19700101 0500");
    expect(stampOf("не дата вовсе", KARAGANDA)).toBe("19700101 0500");
  });

  test("имя запасной копии несёт секунды: две копии за минуту не одна", () => {
    const one = fileStamp(Date.parse("2026-08-12T16:14:03Z"), KARAGANDA);
    const two = fileStamp(Date.parse("2026-08-12T16:14:44Z"), KARAGANDA);
    expect(one).toBe("20260812-211403");
    expect(two).toBe("20260812-211444");
    expect(one).not.toBe(two);
  });
});

/**
 * Ответ на «Разложить выписки сейчас».
 *
 * **Находка 4 прогона глазами 20260818.** Команда отвечала строкой состояния
 * СЛОВО В СЛОВО: `Beresta: данные на 20260818 1047` — то самое, что уже
 * написано в углу окна. Человек нажимает эту команду именно потому, что не
 * верит строке в углу; получить в ответ её же значит не получить ответа.
 *
 * И вторая половина находки: подсказка «начните с привязки» показывалась
 * только при НУЛЕ привязок. У владельца одна книга привязана с первого дня —
 * значит на его хранилище правило не сработает больше никогда, а десять новых
 * книг повиснут молча.
 */
describe("ответ на команду «Разложить выписки сейчас»", () => {
  /** Хранилище владельца на 20260818: 11 книг, 291 выписка, привязана одна. */
  const OWNER = status({
    snapshot: "целый",
    dataStamp: "20260818 1047",
    books: 11,
    quotes: 291,
    unbound: 10,
    notesWithQuotes: 1,
  });

  test("не повторяет строку состояния", () => {
    const said = syncNowWords(OWNER);
    expect(said).not.toBe(statusLine(OWNER));
    // Отметка времени — единственное, что говорила прежняя команда, и
    // единственное, чего человек не спрашивал.
    expect(said).not.toContain("20260818 1047");
  });

  test("называет, сколько данных есть и где они", () => {
    const said = syncNowWords(OWNER);
    expect(said).toContain("11 книг");
    expect(said).toContain("291 выписка");
    expect(said).toContain("Выписки лежат в 1 заметке");
  });

  test("считает книги, которым некуда лечь, а не «есть ли хоть одна привязка»", () => {
    const said = syncNowWords(OWNER);
    expect(said).toContain("Ещё 10 книгам некуда лечь");
    expect(said).toContain("«Привязать книги к заметкам»");
  });

  test("привязано ноль — подсказка та же, но сказана целиком", () => {
    const said = syncNowWords({ ...OWNER, unbound: 11, notesWithQuotes: 0 });
    expect(said).toContain("Ни одна книга не привязана к заметке");
    expect(said).toContain("Начните с команды «Привязать книги к заметкам»");
  });

  test("все книги на местах — про привязку молчим", () => {
    const said = syncNowWords({ ...OWNER, unbound: 0, notesWithQuotes: 9 });
    expect(said).toContain("Выписки лежат в 9 заметках");
    expect(said).not.toContain("Привязать книги к заметкам");
  });

  test("выгрузки нет — сказано это, а не отметка времени", () => {
    const said = syncNowWords(status({ snapshot: "нет" }));
    expect(said).toContain("выгрузки Beresta в этом хранилище нет");
    expect(said).toContain("раскладывать нечего");
  });

  test("указатель не читается — сказано, что заметки не тронуты", () => {
    expect(syncNowWords(status({ snapshot: "не-читается" }))).toContain("заметки не тронуты");
  });

  test("выгрузка есть, книг в ней нет — это не «раскладывать некуда»", () => {
    const said = syncNowWords(status({ snapshot: "целый", books: 0 }));
    expect(said).toContain("нет ни одной книги с выписками");
    expect(said).not.toContain("Привязать книги к заметкам");
  });

  test("недоехавшая выгрузка и отложенные заметки названы отдельными строками", () => {
    const said = syncNowWords({ ...OWNER, snapshot: "наполовину", problems: 2, deferred: 1 });
    expect(said).toContain("2 книги ещё едет");
    expect(said).toContain("1 заметка ждёт сохранения");
  });

  test("числа склоняются по-русски", () => {
    const one = syncNowWords({ ...OWNER, books: 1, quotes: 1, unbound: 0, notesWithQuotes: 1 });
    expect(one).toContain("1 книга, 1 выписка");
    const alone = syncNowWords({ ...OWNER, books: 2, quotes: 5, unbound: 1, notesWithQuotes: 1 });
    expect(alone).toContain("Ещё 1 книге некуда лечь");
    const few = syncNowWords({ ...OWNER, books: 4, quotes: 22, unbound: 3, notesWithQuotes: 2 });
    expect(few).toContain("4 книги, 22 выписки");
    expect(few).toContain("Ещё 3 книгам некуда лечь");
    expect(few).toContain("в 2 заметках");
  });
});

/**
 * Подпись строки состояния — про хранилище, а не про последний проход.
 *
 * Находка 5: «Заметок с выписками» считалось как `lastReport.visited.length`.
 * После точечного прохода цифра застревала — 1 при двух заметках с секциями, —
 * и держалась, пока человек не запускал команду руками.
 */
describe("подпись про заметки с выписками", () => {
  test("названо число заметок с выписками и число книг без заметки", () => {
    const lines = statusHint(
      status({ snapshot: "целый", dataStamp: "20260818 1047", notesWithQuotes: 2, unbound: 9 }),
      Date.parse("2026-08-18T05:47:00Z"),
      KARAGANDA,
    ).join("\n");
    expect(lines).toContain("Заметок с выписками: 2.");
    expect(lines).toContain("Книг без заметки: 9.");
  });

  test("книг без заметки нет — строки о них тоже нет", () => {
    const lines = statusHint(
      status({ snapshot: "целый", notesWithQuotes: 2, unbound: 0 }),
      0,
      KARAGANDA,
    ).join("\n");
    expect(lines).not.toContain("Книг без заметки");
  });
});
