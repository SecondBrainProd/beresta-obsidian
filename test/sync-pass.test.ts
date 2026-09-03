import { beforeEach, describe, expect, test } from "vitest";

import { readSnapshot, type Snapshot } from "../src/snapshot";
import { listBackups, restoreBackup } from "../src/write/backup";
import { runSync, type SyncInput, type SyncReport } from "../src/sync/pass";
import type { KnownSection } from "../src/merge/fuse";
import { FakeVault } from "./harness/vault";

/**
 * Проход синка: порядок, которого до задачи 14 не существовало нигде.
 *
 * Кубики — разбор снимка, отрисовка, слияние, запасная копия, предохранитель
 * записи — сделаны задачами 9–12, и каждый закрыт своими проверками. Здесь
 * проверяется **порядок**: что снимается копия и когда, что предохранитель
 * спрашивают до записи и с текстом диска на руках, что заметка без изменений не
 * трогается вовсе. Порядок — это то, чего не видно из проверок отдельных
 * кубиков: каждый из них по-прежнему зелёный, когда порядок перепутан.
 *
 * Живой Obsidian сюда не входит по-прежнему: `vault.process` меряется швом
 * задачи 13 на копии хранилища владельца.
 */

const SMALL_BOOK = "5650781E-4943-515E-B644-7745D3BB9759";
const NOTE = "Base/Библиотека/Гибкое сознание.md";
const OWNER_TEXT = [
  "---",
  "tags: 📖",
  "aliases:",
  "name: Гибкое сознание",
  "date: 20221025 1047",
  "beresta-book-id:",
  `  - ${SMALL_BOOK}`,
  "---",
  "",
  "## Главная идея книги",
  "",
  "Способности растут от усилия, а не выдаются при рождении.",
  "",
  "### Мысль номер 1",
  "",
  "Похвала за талант вредит сильнее, чем молчание.",
  "",
].join("\n");

let vault: FakeVault;
let memory: Map<string, KnownSection>;

beforeEach(() => {
  vault = new FakeVault();
  vault.putSnapshot("owner-library");
  vault.put(NOTE, OWNER_TEXT);
  memory = new Map();
});

async function snapshot(): Promise<Snapshot> {
  return await readSnapshot(vault);
}

async function pass(over: Partial<SyncInput> = {}): Promise<SyncReport> {
  return await runSync({
    snapshot: await snapshot(),
    bindings: new Map([[NOTE, [SMALL_BOOK]]]),
    notes: vault,
    backups: vault.backups(),
    memory: {
      get: (path) => memory.get(path),
      set: (path, known) => {
        memory.set(path, known);
      },
    },
    settings: {
      timeZoneOffsetMinutes: 300,
      keepBackups: 5,
      removalShare: 0.2,
      removalCount: 20,
    },
    now: Date.parse("2026-08-12T16:14:03Z"),
    mayCreateSection: new Set([NOTE]),
    ...over,
  });
}

/** Снимок, из которого в приложении убрали одну выписку книги. */
async function withoutOne(): Promise<Snapshot> {
  const whole = await snapshot();
  if (whole.kind !== "present") throw new Error("снимка нет");
  return {
    ...whole,
    books: whole.books.map((book) =>
      book.uuid === SMALL_BOOK ? { ...book, annotations: book.annotations.slice(1) } : book,
    ),
  };
}

describe("проход синка", () => {
  test("первый проход кладёт секцию, не тронув ни строки владельца", async () => {
    const report = await pass();

    expect(report.written).toEqual([NOTE]);
    expect(report.visited).toEqual([NOTE]);
    const after = vault.peek(NOTE)!;
    // Текст владельца — НАЧАЛО файла: его frontmatter строка в строку начало
    // нового frontmatter, его тело — префикс нового тела. Ни перестановки, ни
    // вставки в середину, ни потерянной строки это не переживёт (проверка
    // выведена швом 2 задачи 13: «вне маркеров байт в байт» неверно, потому
    // что перед секцией встаёт недостающий перевод строки).
    const was = split(OWNER_TEXT);
    const now = split(after);
    expect(now.front.slice(0, was.front.length)).toEqual(was.front);
    expect(now.body.startsWith(was.body)).toBe(true);
    expect(after).toContain("date: 20221025 1047");
    expect(after).toContain("%% beresta:begin %%");
    expect(after).toContain("%% beresta:end %%");
    // Отметка — момент ДАННЫХ, а не время прохода.
    expect(after).toContain("beresta-last-sync: 20260806 1306");
  });

  /**
   * Число, которым проход отвечает человеку на его нажатие.
   *
   * Прогон глазами 20260818: после «Привязать выбранные» на экране не менялось
   * ничего, хотя в заметку легли 40 цитат. Уведомление называет это число, и
   * взять его больше неоткуда: отчёт до сегодняшнего дня говорил только «в
   * какие заметки писали», но не «сколько там теперь выписок».
   *
   * Вырежьте `report.quotes` — уведомление после привязки скажет «0 выписок»
   * там, где их сорок.
   */
  test("проход считает выписки записанной заметки — тем же числом, что в файле", async () => {
    const report = await pass();

    const anchors = (vault.peek(NOTE)!.match(/^\^hl-\S+$/gm) ?? []).length;
    expect(anchors).toBeGreaterThan(0);
    expect(report.quotes[NOTE]).toBe(anchors);
  });

  test("заведённая заметка считается так же, как дописанная", async () => {
    vault.drop(NOTE);

    const report = await pass({ creating: new Set([NOTE]) });

    const anchors = (vault.peek(NOTE)!.match(/^\^hl-\S+$/gm) ?? []).length;
    expect(report.quotes[NOTE]).toBe(anchors);
  });

  test("второй проход не пишет ни байта и не трогает файл вовсе", async () => {
    const first = await pass();
    const settled = vault.peek(NOTE);
    vault.forget();

    const report = await pass();

    expect(report.written).toEqual([]);
    expect(vault.writes).toEqual([]);
    expect(vault.peek(NOTE)).toBe(settled);
    // А число выписок отчёт всё равно называет, и то же самое. Находка 5
    // прогона глазами 20260818: подпись строки состояния считала «сколько
    // заметок обошёл последний проход» и после точечного прохода застревала на
    // единице. Считать можно только то, о чём отчёт говорит и когда не писал.
    expect(report.quotes[NOTE]).toBe(first.quotes[NOTE]);
  });

  /**
   * Заметка, из которой человек стёр секцию, отвечает нулём.
   *
   * Память о ней при этом остаётся (`known` помнит девять блоков) — иначе
   * следующий проход счёл бы привязку свежей и вернул бы секцию, которую
   * человек убрал нарочно. Значит считать «сколько выписок в заметке» по памяти
   * нельзя: правда здесь в буквах файла.
   */
  test("секцию стёрли — в отчёте ноль, а не память о девяти блоках", async () => {
    const first = await pass();
    expect(first.quotes[NOTE]).toBeGreaterThan(0);

    vault.put(NOTE, OWNER_TEXT);
    // Секцию не воскрешаем: команды «Вернуть секцию» не было.
    const report = await pass({ mayCreateSection: new Set() });

    expect(report.quotes[NOTE]).toBe(0);
    expect(report.refusals.map((one) => one.refused)).toContain("section-missing");
  });

  test("запасная копия снята до записи и возвращает прежний текст", async () => {
    await pass();

    const copies = await listBackups(vault.backups(), NOTE);
    expect(copies.length).toBe(1);
    const restored = await restoreBackup(vault.backups(), copies[0]!.id);
    // Копия — того, что было ДО нашей записи. Обратный порядок дал бы копию
    // того, что мы уже испортили.
    expect(restored?.text).toBe(OWNER_TEXT);
    expect(copies[0]!.savedAt).toBe("20260812 2114");
  });

  test("заметка открыта с несохранённым — проход откладывается, файл цел", async () => {
    vault.openEditor(NOTE, `${OWNER_TEXT}\nещё не сохранено`);

    const report = await pass();

    expect(report.deferred).toEqual([NOTE]);
    expect(report.written).toEqual([]);
    expect(vault.writes).toEqual([]);
    expect(vault.peek(NOTE)).toBe(OWNER_TEXT);
    // И копии тоже нет: откладывать надо дёшево, не оставляя за собой того,
    // чего никто не просил.
    expect(await listBackups(vault.backups())).toEqual([]);
  });

  test("та же заметка сохранена — выписки приезжают следующим проходом", async () => {
    vault.openEditor(NOTE, `${OWNER_TEXT}\nещё не сохранено`);
    await pass();
    vault.closeEditor(NOTE);

    const report = await pass();
    expect(report.written).toEqual([NOTE]);
  });

  test("привязанной заметки нет на месте — говорим, но не заводим заново", async () => {
    vault.drop(NOTE);

    const report = await pass();

    expect(report.missing).toEqual([NOTE]);
    expect(report.written).toEqual([]);
    expect(vault.peek(NOTE)).toBeUndefined();
  });

  test("владелец велел завести заметку — она появляется вместе с секцией", async () => {
    vault.drop(NOTE);

    const report = await pass({ creating: new Set([NOTE]) });

    expect(report.written).toEqual([NOTE]);
    const made = vault.peek(NOTE)!;
    expect(made).toContain(`beresta-book-id:`);
    expect(made).toContain(SMALL_BOOK);
    expect(made).toContain("%% beresta:begin %%");
  });

  test("книги нет в выгрузке — заметка не трогается, и это названо", async () => {
    const report = await pass({
      bindings: new Map([[NOTE, ["00000000-0000-4000-8000-000000000000"]]]),
    });

    expect(report.unknownBooks[NOTE]).toEqual(["00000000-0000-4000-8000-000000000000"]);
    expect(report.written).toEqual([]);
    // Пустая секция стёрла бы блоки, которых приложение сейчас просто не
    // называет, — а не называть их оно может и потому, что снимок пришёл с
    // другой машины.
    expect(vault.peek(NOTE)).toBe(OWNER_TEXT);
  });

  test("правку человека внутри блока проход замораживает и называет", async () => {
    await pass();
    const edited = vault
      .peek(NOTE)!
      .split("\n")
      .map((line) => (line.startsWith("> ") ? `${line} — так у меня в тетради` : line))
      .join("\n");
    vault.put(NOTE, edited);

    const report = await pass();

    expect(report.conflicts[NOTE]?.map((one) => one.kind)).toContain("edited");
    expect(vault.peek(NOTE)).toBe(edited);
    expect(vault.peek(NOTE)).toContain("так у меня в тетради");
  });

  test("предохранитель останавливает проход и показывает, что убрал бы", async () => {
    await pass();
    const settled = vault.peek(NOTE);
    vault.forget();

    // У книги четыре выписки; удаление одной — больше пятой части. Край
    // острый и назван ещё в задаче 11: в маленькой заметке предохранитель
    // срабатывает от одной выписки, и снимается он подтверждением человека, а
    // не подкрученным порогом.
    const stopped = await pass({ snapshot: await withoutOne() });
    expect(stopped.refusals.map((one) => one.refused)).toEqual(["too-many-removals"]);
    expect(stopped.refusals[0]!.message).toContain("остановилась");
    expect(vault.peek(NOTE)).toBe(settled);
    expect(vault.writes).toEqual([]);

    // Человек подтвердил — блок уходит.
    const allowed = await pass({ snapshot: await withoutOne(), allowRemovals: new Set([NOTE]) });
    expect(allowed.written).toEqual([NOTE]);
    expect(Object.keys(allowed.removed)).toEqual([NOTE]);
    expect(vault.peek(NOTE)).not.toBe(settled);
  });

  test("секция стёрта человеком — уведомление, а не новая секция в конце", async () => {
    await pass();
    const cleaned = vault
      .peek(NOTE)!
      .split("%% beresta:begin %%")[0]!
      .trimEnd();
    vault.put(NOTE, cleaned);
    vault.forget();

    // Память о заметке есть, значит секцию мы уже заводили: её отсутствие
    // теперь означает «человек стёр», а не «свежая привязка».
    const report = await pass({ mayCreateSection: new Set() });

    expect(report.refusals.map((one) => one.refused)).toEqual(["section-missing"]);
    expect(vault.peek(NOTE)).toBe(cleaned);
    expect(vault.writes).toEqual([]);

    // И возвращается она командой — тем же проходом, но с разрешением.
    const back = await pass({ mayCreateSection: new Set([NOTE]) });
    expect(back.written).toEqual([NOTE]);
    expect(vault.peek(NOTE)).toContain("%% beresta:begin %%");
  });

  test("снимка нет — заметки не трогаются вовсе", async () => {
    const report = await pass({ snapshot: { kind: "absent" } });

    expect(report.visited).toEqual([]);
    expect(vault.writes).toEqual([]);
    expect(vault.peek(NOTE)).toBe(OWNER_TEXT);
  });
});

/** Блок frontmatter и тело — разбором, независимым от кода, который проверяем. */
function split(text: string): { front: string[]; body: string } {
  const lines = text.split("\n");
  if (lines[0] !== "---") return { front: [], body: text };
  const end = lines.slice(1).findIndex((line) => line === "---");
  if (end < 0) return { front: [], body: text };
  return { front: lines.slice(1, end + 1), body: lines.slice(end + 2).join("\n") };
}

describe("шаблон человека доезжает до заметки", () => {
  /**
   * Главная проверка задачи: настройка не «лежит в data.json», а меняет то,
   * что человек видит в заметке.
   *
   * До 20260822 путь обрывался на полпути: поле `template` в проходе было, а
   * настройки его не несли — заводило передавало `BerestaSettings`, где такого
   * поля не было вовсе. Шаблон всегда оставался стандартным, и заметить это
   * можно было только чтением исходников.
   */
  test("свой шаблон меняет вид блока в заметке", async () => {
    const report = await pass({
      settings: {
        timeZoneOffsetMinutes: 300,
        keepBackups: 5,
        removalShare: 0.2,
        removalCount: 20,
        template: "{{#annotations}}\nВЫПИСКА: {{text}}\n\n^{{anchor}}\n{{/annotations}}",
      },
    });

    expect(report.written.length).toBeGreaterThan(0);
    const text = await vault.read(NOTE);
    expect(text).toContain("ВЫПИСКА: ");
    // И стандартного вида в заметке больше нет — иначе «свой шаблон» означал бы
    // «свой шаблон вдобавок к нашему».
    expect(text).not.toContain("[!quote|beresta");
  });

  test("без своего шаблона рисуется стандартный", async () => {
    await pass();

    const text = await vault.read(NOTE);
    expect(text).toContain("[!quote|beresta");
    expect(text).not.toContain("ВЫПИСКА: ");
  });
});
