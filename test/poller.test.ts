import { createHash } from "node:crypto";

import { beforeEach, describe, expect, test } from "vitest";

import { readBindings } from "../src/binding/binding-view";
import { FOCUSED_INTERVAL_MS, PollSchedule, UNFOCUSED_INTERVAL_MS } from "../src/poller";
import { indexPath, shardPath } from "../src/snapshot/paths";
import { SyncRunner, type RunnerPorts } from "../src/sync/runner";
import { initialState, type PluginState } from "../src/settings";
import { FakeVault } from "./harness/vault";

/**
 * Опрос указателя: когда плагин смотрит на снимок и что из этого следует.
 *
 * **Главное свойство — истина это ХЕШ, а время изменения только подсказка.**
 * Поверх хранилища работает чужая синхронизация (iCloud, Obsidian Sync,
 * Dropbox): она трогает файлы, не меняя байтов, и переставляет время в обе
 * стороны — вперёд при доставке, назад при разрешении конфликта копий и после
 * перевода часов на машине. Правило «время новее — значит новые данные» на
 * таком хранилище ошибается дважды и по-разному: пропускает настоящие
 * изменения (время уехало назад) и затевает проход на пустом месте (время
 * дёрнулось, байты те же). Первое — молчаливое отставание, главный отказ
 * опроса; второе — переписанные заметки и разбуженная синхронизация каждые
 * пять секунд.
 *
 * Отсюда устройство: подсказка решает, стоит ли ЧИТАТЬ указатель, а решение
 * «работать или нет» принимает только отпечаток его байтов. Указатель несёт
 * `sha256` каждого осколка — значит его собственный отпечаток меняется от
 * любой перемены в снимке, и одного отпечатка хватает.
 *
 * **Проверки смотрят в журнал стенда, а не только в файлы.** «Проход не
 * начинался» по содержимому заметок неотличимо от «проход начался и ничего не
 * изменил»: файлы в обоих случаях те же. Поэтому стенд ведёт журнал обращений
 * (`reads`, `writes`), и утверждения о лишней работе проверяются по нему.
 */

// MARK: - Что лежит в хранилище стенда

/** «Гибкое сознание» — четыре выписки, самая маленькая книга образца. */
const SMALL_BOOK = "5650781E-4943-515E-B644-7745D3BB9759";
/** «Джедайские техники» — 81 выписка. */
const BIG_BOOK = "9504E37E-2CE3-5AD4-81F9-35414188FAC9";

const SMALL_NOTE = "Base/Библиотека/Гибкое сознание.md";
const BIG_NOTE = "Base/Библиотека/Джедайские техники.md";

/** Кусок цитаты, который в образце есть ровно один раз. */
const QUOTE = "Правило простое: сначала список, потом порядок.";

function boundNote(bookUUID: string, body: string): string {
  return ["---", "tags: 📖", `beresta-book-id:`, `  - ${bookUUID}`, "---", "", body, ""].join("\n");
}

let vault: FakeVault;
let said: string[];
let state: PluginState;

beforeEach(() => {
  vault = new FakeVault();
  vault.putSnapshot("owner-library");
  vault.put(SMALL_NOTE, boundNote(SMALL_BOOK, "## Главная идея книги\n\nМышление роста."));
  vault.put(BIG_NOTE, boundNote(BIG_BOOK, "## Главная идея книги\n\nПустой инбокс."));
  said = [];
  // Сдвиг Караганды: время выделения показывается тем же, что в приложении.
  state = initialState(300);
});

function runner(): SyncRunner {
  const ports: RunnerPorts = {
    source: vault,
    notes: vault,
    backups: vault.backups(),
    bindings: async () => {
      const notes = vault
        .paths()
        .filter((path) => path.endsWith(".md") && !path.startsWith(".obsidian/"))
        .map((path) => ({ path, text: vault.peek(path) ?? "" }));
      return readBindings(notes);
    },
    persist: async (next) => {
      state = next;
    },
    now: () => 1_755_300_000_000,
    announce: (line) => said.push(line),
  };
  return new SyncRunner(ports, state);
}

/**
 * Меняет текст одной цитаты в осколке и переписывает указатель под неё.
 *
 * Отпечаток считается `node:crypto`, а не нашим `sha256Hex`: стенд, который
 * готовит данные тем же кодом, каким они потом проверяются, доказывает лишь
 * согласие кода с самим собой.
 */
function editSnapshot(bookUUID: string, from: string, to: string): void {
  const file = `books/${bookUUID}.jsonld`;
  const shard = vault.peek(shardPath(file))!;
  expect(shard).toContain(from);
  const next = shard.replace(from, to);
  vault.put(shardPath(file), next);

  const index = JSON.parse(vault.peek(indexPath())!) as {
    books: { file: string; sha256: string }[];
  };
  const entry = index.books.find((book) => book.file === file)!;
  entry.sha256 = createHash("sha256").update(next, "utf8").digest("hex");
  vault.put(indexPath(), JSON.stringify(index));
}

/**
 * Сырой кусок осколка с первой цитатой книги.
 *
 * Нужен затем, чтобы править цитату в ЛЮБОЙ книге образца заменой строки, не
 * зная её текста наизусть: в осколке он лежит с экранированием (`\n` внутри
 * цитаты — обычное дело), и подставить его разэкранированным значит не найти.
 */
function firstQuoteRaw(bookUUID: string): string {
  const shard = vault.peek(shardPath(`books/${bookUUID}.jsonld`))!;
  const match = /"exact"\s*:\s*"(?:[^"\\]|\\.)*"/.exec(shard);
  if (match === null) throw new Error(`в осколке ${bookUUID} нет ни одной цитаты`);
  return match[0];
}

// MARK: - Указатель

describe("опрос указателя", () => {
  test("время ушло назад, а данные другие — выписки всё равно доезжают", async () => {
    const first = runner();
    await first.tick("загрузка");
    expect(vault.peek(SMALL_NOTE)).toContain(QUOTE);

    // Приложение дописало выписку, а чужая синхронизация поставила файлу время
    // СТАРШЕ прежнего — так бывает при разрешении конфликта копий и после
    // перевода часов. Данные при этом новые.
    editSnapshot(SMALL_BOOK, QUOTE, "Правило простое: сначала порядок, потом список.");
    vault.touch(indexPath(), 1);
    vault.forget();

    const outcome = await first.tick("опрос");
    expect(outcome.look).toBe("новые-данные");
    expect(vault.peek(SMALL_NOTE)).toContain("сначала порядок, потом список");
    expect(vault.peek(SMALL_NOTE)).not.toContain(QUOTE);
    expect(vault.writes).toContain(SMALL_NOTE);
  });

  test("те же данные под другим временем — ни одной записи и ни одного осколка", async () => {
    const one = runner();
    await one.tick("загрузка");
    const settled = vault.peek(SMALL_NOTE);
    vault.forget();

    // Чужая синхронизация тронула файл, не изменив ни байта.
    vault.touch(indexPath(), 9_000_000);
    const outcome = await one.tick("опрос");

    expect(outcome.look).toBe("те-же-данные");
    // Указатель прочитан — подсказка двигалась, и верить ей нельзя.
    expect(vault.reads).toContain(indexPath());
    // А дальше не пошло: осколки не разобраны, заметки не тронуты.
    expect(vault.reads.filter((path) => path.startsWith(".beresta/books"))).toEqual([]);
    expect(vault.writes).toEqual([]);
    expect(vault.peek(SMALL_NOTE)).toBe(settled);
  });

  test("подсказка не двигалась — указатель не читается вовсе", async () => {
    const one = runner();
    await one.tick("загрузка");
    vault.forget();

    const outcome = await one.tick("опрос");
    expect(outcome.look).toBe("те-же-данные");
    expect(vault.statCalls).toBe(1);
    expect(vault.reads).toEqual([]);
    expect(vault.writes).toEqual([]);
  });

  test("человек попросил — смотрим по-настоящему, даже если подсказка та же", async () => {
    const one = runner();
    await one.tick("загрузка");
    vault.forget();

    await one.tick("команда");
    // Дешёвый путь по подсказке — только для самостоятельного опроса. Команда
    // человека обязана привести к чтению: он нажал ровно потому, что не верит
    // тому, что видит.
    expect(vault.reads).toContain(indexPath());
    expect(vault.writes).toEqual([]);
  });

  test("указателя нет — заметки не трогаются, и это сказано словами", async () => {
    vault.drop(indexPath());
    const before = vault.peek(SMALL_NOTE);

    const outcome = await runner().tick("загрузка");

    expect(outcome.look).toBe("снимка-нет");
    expect(vault.writes).toEqual([]);
    expect(vault.peek(SMALL_NOTE)).toBe(before);
    expect(outcome.status.snapshot).toBe("нет");
  });

  test("осколок не доехал — тот же указатель перечитывается, пока снимок не сойдётся", async () => {
    const file = `books/${SMALL_BOOK}.jsonld`;
    const shard = vault.peek(shardPath(file))!;
    vault.drop(shardPath(file));

    const one = runner();
    const half = await one.tick("загрузка");
    expect(half.report?.written ?? []).not.toContain(SMALL_NOTE);
    expect(vault.peek(SMALL_NOTE)).not.toContain(QUOTE);
    expect(half.status.snapshot).toBe("наполовину");

    // Осколок доехал. Указатель при этом НЕ переписан — приложение его не
    // трогало, и подсказка не двинулась. Молчаливое отставание начинается
    // ровно здесь: снимок недосинхронизирован, а плагин считает, что смотреть
    // не на что.
    // Указатель НЕ трогаем вовсе: ни байтов, ни времени. Опрос обязан прийти
    // сюда сам, потому что помнит, что прошлый снимок не сошёлся.
    vault.put(shardPath(file), shard);
    vault.forget();

    const whole = await one.tick("опрос");
    expect(whole.look).toBe("новые-данные");
    expect(vault.peek(SMALL_NOTE)).toContain(QUOTE);
    expect(whole.status.snapshot).toBe("целый");
  });

  test("указатель испорчен — сказано словами, заметки целы, и не повторяется каждый опрос", async () => {
    vault.put(indexPath(), '{"format":"beresta-archive","formatVersion":99}');
    const before = vault.peek(SMALL_NOTE);

    const one = runner();
    const outcome = await one.tick("загрузка");
    expect(outcome.look).toBe("не-читается");
    expect(vault.writes).toEqual([]);
    expect(vault.peek(SMALL_NOTE)).toBe(before);
    expect(said.join("\n")).toContain("Beresta");

    // Второй опрос по тем же байтам молчит: указатель сам не починится, а
    // уведомление раз в пять секунд — это способ приучить человека нажимать
    // «закрыть», не читая.
    said.length = 0;
    vault.forget();
    const again = await one.tick("опрос");
    expect(again.look).toBe("те-же-данные");
    expect(said).toEqual([]);
  });

  test("открыл заметку — сверяется только её книга", async () => {
    const one = runner();
    await one.tick("загрузка");

    // **Обе книги изменились** — и в этом смысл проверки. Первый заход был
    // слабым: правилась одна книга, и «сверяется только её» проходило само
    // собой, потому что второй заметке всё равно нечего было получать. Вырез
    // сужения тогда краснел на чужом тесте, а этот оставался зелёным.
    editSnapshot(SMALL_BOOK, QUOTE, "Правило простое: сначала порядок, потом список.");
    editSnapshot(BIG_BOOK, firstQuoteRaw(BIG_BOOK), '"exact": "правка в другой книге"');
    const bigBefore = vault.peek(BIG_NOTE);
    vault.forget();

    const outcome = await one.tick("заметка", { only: new Set([SMALL_NOTE]) });

    expect(outcome.report?.visited).toEqual([SMALL_NOTE]);
    expect(vault.writes).toEqual([SMALL_NOTE]);
    expect(vault.peek(SMALL_NOTE)).toContain("сначала порядок, потом список");
    // Вторая заметка не тронута и даже не прочитана: открытие одной заметки не
    // повод обходить всё хранилище.
    expect(vault.peek(BIG_NOTE)).toBe(bigBefore);
    expect(vault.reads).not.toContain(BIG_NOTE);
  });

  test("данные те же — второй проход не пишет ни байта", async () => {
    const one = runner();
    await one.tick("загрузка");
    const settled = vault.paths().map((path) => `${path}\n${vault.peek(path)}`);
    vault.forget();

    await one.tick("команда");

    expect(vault.writes).toEqual([]);
    expect(vault.paths().map((path) => `${path}\n${vault.peek(path)}`)).toEqual(settled);
  });

  test("снимок исчез и вернулся тем же — он раскладывается заново, а не считается прежним", async () => {
    const one = runner();
    await one.tick("загрузка");
    const index = vault.peek(indexPath())!;

    vault.drop(indexPath());
    expect((await one.tick("опрос")).look).toBe("снимка-нет");

    // Те же байты — но между ними снимка не было вовсе. Помни плагин отпечаток
    // через пропажу, вернувшаяся выгрузка не доехала бы до заметок никогда: она
    // «та же», а заметки за это время могли уехать куда угодно.
    vault.put(indexPath(), index);
    vault.forget();
    const back = await one.tick("опрос");

    expect(back.look).toBe("новые-данные");
    expect(vault.reads.filter((path) => path.startsWith(".beresta/books")).length).toBeGreaterThan(0);
  });

  test("человек стёр секцию — опрос её не возвращает", async () => {
    const one = runner();
    await one.tick("загрузка");

    const cleaned = vault.peek(SMALL_NOTE)!.split("%% beresta:begin %%")[0]!.trimEnd();
    vault.put(SMALL_NOTE, cleaned);
    editSnapshot(SMALL_BOOK, QUOTE, "Правило простое: сначала порядок, потом список.");
    vault.forget();

    const outcome = await one.tick("опрос");

    // Дописать четыре цитаты в конец заметки, которую человек только что
    // вычистил, — грубость, а не синхронизация. Возвращается секция командой.
    expect(outcome.report?.refusals.map((one) => one.refused)).toContain("section-missing");
    expect(vault.peek(SMALL_NOTE)).toBe(cleaned);
    expect(vault.writes).toEqual([]);
  });

  test("выбор в окне привязки виден проходу до того, как ключ попал во frontmatter", async () => {
    const fresh = "Base/Библиотека/Гибкое сознание — новая.md";
    vault.put(fresh, "## Мои мысли\n\nЕщё ничего.\n");

    const outcome = await runner().tick("команда", {
      alsoBind: new Map([[fresh, [SMALL_BOOK]]]),
      only: new Set([fresh]),
    });

    expect(outcome.report?.written).toEqual([fresh]);
    expect(vault.peek(fresh)).toContain(SMALL_BOOK);
    expect(vault.peek(fresh)).toContain(QUOTE);
    expect(vault.peek(fresh)).toContain("## Мои мысли");
  });

  test("смена настройки не стирает ни памяти, ни расхождений", async () => {
    const one = runner();
    await one.tick("загрузка");

    // Человек поправил цитаты в заметке, и проход это увидел.
    vault.put(
      SMALL_NOTE,
      vault
        .peek(SMALL_NOTE)!
        .split("\n")
        .map((line) => (line.startsWith("> ") ? `${line} — так у меня в тетради` : line))
        .join("\n"),
    );
    editSnapshot(SMALL_BOOK, QUOTE, "Правило простое: сначала порядок, потом список.");
    await one.tick("опрос");
    expect(one.board.count).toBeGreaterThan(0);
    const remembered = Object.keys(one.state.known);

    one.applySettings({ ...one.state.settings, keepBackups: 7 });

    // Настройка принята, а память о записанном и накопленные расхождения на
    // месте: человек, поправивший размер круга копий, не должен получить
    // пустую панель и заметку, в которую секцию заведут заново.
    expect(one.state.settings.keepBackups).toBe(7);
    expect(one.state.settings.timeZoneOffsetMinutes).toBe(300);
    expect(Object.keys(one.state.known)).toEqual(remembered);
    expect(one.board.count).toBeGreaterThan(0);
  });

  /**
   * Находка 5 прогона глазами 20260818, дословно.
   *
   * Подпись строки состояния считала «Заметок с выписками» как
   * `lastReport.visited.length` — то есть сколько заметок обошёл ПОСЛЕДНИЙ
   * проход. Владелец привязал вторую книгу, секции встали в двух заметках, а
   * подпись держала единицу: последний проход был точечный. Цифра менялась на
   * двойку только от ручного запуска команды.
   *
   * Вырежьте карту `sections` из заводила (верните `visited.length`) — тест
   * обязан упасть на втором `expect`.
   */
  test("точечный проход не сбивает счёт заметок с выписками", async () => {
    const one = runner();
    await one.tick("загрузка");
    expect(one.status.notesWithQuotes).toBe(2);

    editSnapshot(SMALL_BOOK, QUOTE, "Правило простое: сначала порядок, потом список.");
    await one.tick("заметка", { only: new Set([SMALL_NOTE]) });

    // Проход обошёл ОДНУ заметку. Секции по-прежнему в двух.
    expect(one.status.notesWithQuotes).toBe(2);
    expect(one.quotesPerNote.get(BIG_NOTE)).toBeGreaterThan(0);
  });

  test("счёт выписок в заметке — по буквам файла, а не по числу пройденных заметок", async () => {
    const one = runner();
    await one.tick("загрузка");

    const anchors = (path: string): number =>
      (vault.peek(path)!.match(/^\^hl-\S+$/gm) ?? []).length;
    expect(one.quotesPerNote.get(SMALL_NOTE)).toBe(anchors(SMALL_NOTE));
    expect(one.quotesPerNote.get(BIG_NOTE)).toBe(anchors(BIG_NOTE));
  });

  test("человек стёр секцию — заметка перестаёт считаться заметкой с выписками", async () => {
    const one = runner();
    await one.tick("загрузка");
    expect(one.status.notesWithQuotes).toBe(2);

    vault.put(SMALL_NOTE, boundNote(SMALL_BOOK, "## Главная идея книги\n\nМышление роста."));
    editSnapshot(SMALL_BOOK, QUOTE, "Правило простое: сначала порядок, потом список.");
    await one.tick("опрос");

    // Секцию не воскрешаем — и не делаем вид, что она на месте.
    expect(one.quotesPerNote.get(SMALL_NOTE)).toBe(0);
    expect(one.status.notesWithQuotes).toBe(1);
  });

  test("перезапуск на той же выгрузке не обнуляет подпись", async () => {
    await runner().tick("загрузка");
    const before = runner();

    // Прохода не будет вовсе: байты указателя те же. Считать при этом «заметок
    // с выписками: 0» значит соврать после каждого запуска Obsidian.
    const outcome = await before.tick("загрузка");

    expect(outcome.look).toBe("те-же-данные");
    expect(before.status.notesWithQuotes).toBe(2);
  });

  test("книги, которым некуда лечь, сосчитаны — а не «есть ли хоть одна привязка»", async () => {
    const one = runner();
    await one.tick("загрузка");

    const status = one.status;
    expect(status.books).toBeGreaterThan(2);
    // Привязаны две заметки на две книги; остальные книги выгрузки ждут.
    expect(status.unbound).toBe(status.books - 2);
    expect(status.unbound).toBeGreaterThan(0);
  });

  test("память об указателе переживает перезапуск: тот же снимок не переписывает заметки", async () => {
    await runner().tick("загрузка");
    vault.forget();

    // Новый `SyncRunner` с тем, что сохранилось в `data.json`, — как после
    // перезапуска Obsidian.
    const after = runner();
    const outcome = await after.tick("загрузка");

    expect(outcome.look).toBe("те-же-данные");
    expect(vault.writes).toEqual([]);
  });
});

// MARK: - Как часто смотреть

describe("частота опроса", () => {
  test("при фокусе раз в пять секунд, без фокуса раз в минуту", () => {
    expect(FOCUSED_INTERVAL_MS).toBe(5_000);
    expect(UNFOCUSED_INTERVAL_MS).toBe(60_000);

    const schedule = new PollSchedule();
    expect(schedule.due(0, true)).toBe(true);
    expect(schedule.due(4_999, true)).toBe(false);
    expect(schedule.due(5_000, true)).toBe(true);

    const idle = new PollSchedule();
    expect(idle.due(0, false)).toBe(true);
    expect(idle.due(5_000, false)).toBe(false);
    expect(idle.due(59_999, false)).toBe(false);
    expect(idle.due(60_000, false)).toBe(true);
  });

  test("вернулся фокус — смотрим сразу, не дожидаясь срока", () => {
    const schedule = new PollSchedule();
    expect(schedule.due(0, true)).toBe(true);
    expect(schedule.due(1_000, false)).toBe(false);
    // Человек вернулся в окно: он смотрит на заметку прямо сейчас, и «данные
    // на 20260806 21:14» обязано быть правдой к моменту, когда он прочитает
    // строку состояния.
    expect(schedule.due(1_100, true)).toBe(true);
    expect(schedule.due(1_200, true)).toBe(false);
  });
});
