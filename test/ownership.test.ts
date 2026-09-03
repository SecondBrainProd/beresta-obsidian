import { createHash } from "node:crypto";

import { beforeEach, describe, expect, test } from "vitest";

import { readBindings } from "../src/binding/binding-view";
import { initialState, type PluginState } from "../src/settings";
import { indexPath, shardPath } from "../src/snapshot/paths";
import { laggingBehind, SyncRunner, type RunnerPorts } from "../src/sync/runner";
import { FakeVault } from "./harness/vault";

/**
 * Владение блоками: три дыры, из-за которых заметка переставала обновляться.
 *
 * Здесь проверяется не слияние (оно чистая функция и разобрано в
 * `merge.test.ts`), а **заход целиком** — тот, что зовёт `main.ts` по таймеру:
 * взгляд на указатель, решение «работать или нет», проход, память в
 * `data.json`. Обе беды этого набора видны только отсюда: одна живёт в ПУТИ
 * заметки, вторая — в решении применять снимок или нет, и ни та, ни другая в
 * слияние не попадает вовсе.
 *
 * **Дыры 2 и 3 (R02, R03): владение лежало снаружи заметки.** Память «этот
 * блок писали мы» жила в `data.json` по пути заметки. Переименовал заметку,
 * переустановил плагин, открыл хранилище на втором Маке — памяти нет, слияние
 * уходит в `unknown-origin` и не трогает блоки НИКОГДА. Заметка замерзала
 * молча и навсегда.
 *
 * **Дыра 1 (R01): чужой снимок постарше применялся как свой.** Оба Мака пишут
 * в одну папку `.beresta/`; снимок второго отстаёт на день, и проход убирал из
 * заметки выписки, которых на той машине ещё нет. Замер приёмки 20260816: три
 * блока из «Джедайских техник», потолок молчаливой потери — 20 блоков за
 * проход (выше встаёт предохранитель).
 *
 * Стенд — тот же, что у опроса: подделана файловая система, а не Obsidian.
 */

/** «Гибкое сознание» — четыре выписки, самая маленькая книга образца. */
const SMALL_BOOK = "5650781E-4943-515E-B644-7745D3BB9759";
/** «Джедайские техники» — 81 выписка: на ней меряется тихая потеря. */
const BIG_BOOK = "9504E37E-2CE3-5AD4-81F9-35414188FAC9";

const SMALL_NOTE = "Base/Библиотека/Гибкое сознание.md";
const BIG_NOTE = "Base/Библиотека/Джедайские техники.md";
const MOVED_NOTE = "Base/Прочитанное/Гибкое сознание (2022).md";

/** Кусок цитаты, который в образце есть ровно один раз. */
const QUOTE = "Правило простое: сначала список, потом порядок.";
const NEW_QUOTE = "Правило простое: сначала порядок, потом список.";

/** Устройство образца — то, что стоит в его указателе. */
const OWN_DEVICE = "84DDD8A9-1A69-4A64-A0AE-1B0F1D2C3B4A";
const OTHER_DEVICE = "1C1F0B8E-77E5-4C0E-9E51-2D2B7F0A9C33";

/** Момент образца. */
const OWN_MOMENT = "2026-08-06T08:06:40Z";

let vault: FakeVault;
let said: string[];
let state: PluginState;

beforeEach(() => {
  vault = new FakeVault();
  vault.putSnapshot("owner-library");
  vault.put(SMALL_NOTE, boundNote(SMALL_BOOK, "## Главная идея книги\n\nМышление роста."));
  vault.put(BIG_NOTE, boundNote(BIG_BOOK, "## Главная идея книги\n\nПустой инбокс."));
  said = [];
  unparsed = new Set<string>();
  // Сдвиг Караганды: время выделения показывается тем же, что в приложении.
  state = initialState(300);
});

function boundNote(bookUUID: string, body: string): string {
  return ["---", "tags: 📖", "beresta-book-id:", `  - ${bookUUID}`, "---", "", body, ""].join("\n");
}

/**
 * Заметки, чей frontmatter заходу не показывают.
 *
 * Так выглядит холодный `metadataCache` Obsidian: файл на месте и читается, а
 * разобран ещё не был, и привязку из него взять неоткуда.
 */
let unparsed: Set<string>;

/** Заводило поверх того, что сохранилось в `data.json`, — как после перезапуска. */
function runner(): SyncRunner {
  const ports: RunnerPorts = {
    source: vault,
    notes: vault,
    backups: vault.backups(),
    bindings: async () => {
      const notes = vault
        .paths()
        .filter((path) => path.endsWith(".md") && !path.startsWith(".obsidian/"))
        .filter((path) => !unparsed.has(path))
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
 * Меняет цитату в осколке и переписывает указатель под неё.
 *
 * Отпечаток считается `node:crypto`, а не нашим `sha256Hex`: стенд, который
 * готовит данные тем же кодом, каким они потом проверяются, доказывает лишь
 * согласие кода с самим собой.
 */
function editSnapshot(bookUUID: string, from: string, to: string): void {
  const file = `books/${bookUUID}.jsonld`;
  const shard = vault.peek(shardPath(file))!;
  expect(shard).toContain(from);
  writeShard(file, shard.replace(from, to));
}

/**
 * Убирает из осколка книги последние выписки — с пересчётом отпечатка.
 *
 * Пересчёт обязателен: осколок без него не сойдётся с указателем, и проверка
 * проверяла бы «файл испорчен» вместо «выписок стало меньше». Это разные беды
 * и разные ветки.
 */
function thinBook(bookUUID: string, count: number): void {
  const file = `books/${bookUUID}.jsonld`;
  const shard = JSON.parse(vault.peek(shardPath(file))!) as {
    first: { items: unknown[] };
    total: number;
  };
  shard.first.items = shard.first.items.slice(0, shard.first.items.length - count);
  shard.total = shard.first.items.length;
  writeShard(file, JSON.stringify(shard));
}

function writeShard(file: string, bytes: string): void {
  vault.put(shardPath(file), bytes);
  const index = JSON.parse(vault.peek(indexPath())!) as {
    books: { file: string; sha256: string }[];
  };
  index.books.find((book) => book.file === file)!.sha256 = createHash("sha256")
    .update(bytes, "utf8")
    .digest("hex");
  vault.put(indexPath(), JSON.stringify(index));
}

/** Правит заголовок указателя: чьё это и на какой момент. */
function stampIndex(deviceId: string, generatedAt: string): void {
  const index = JSON.parse(vault.peek(indexPath())!) as Record<string, unknown>;
  vault.put(indexPath(), JSON.stringify({ ...index, deviceId, generatedAt }));
}

/** Момент со сдвигом в миллисекундах, тем же видом строки. */
function shift(iso: string, milliseconds: number): string {
  return new Date(Date.parse(iso) + milliseconds).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function anchorsIn(path: string): string[] {
  return [...(vault.peek(path) ?? "").matchAll(/^\^(hl-\S+)$/gm)].map((match) => match[1]!);
}

// MARK: - Дыры 2 и 3: владение переживает путь заметки

describe("владение блоками переживает путь заметки", () => {
  // Вырежьте чтение отпечатка из заметки — тест обязан упасть.
  test("переименованную заметку проход обновляет, а не замораживает", async () => {
    const first = runner();
    await first.tick("загрузка");
    const laid = vault.peek(SMALL_NOTE)!;
    expect(laid).toContain(QUOTE);

    // Человек переименовал заметку и переложил её в другую папку. Память в
    // `data.json` лежит по прежнему пути — и о новом не знает ничего.
    vault.put(MOVED_NOTE, laid);
    vault.drop(SMALL_NOTE);
    editSnapshot(SMALL_BOOK, QUOTE, NEW_QUOTE);

    const after = runner();
    const outcome = await after.tick("опрос");

    expect(vault.peek(MOVED_NOTE)).toContain(NEW_QUOTE);
    expect(vault.peek(MOVED_NOTE)).not.toContain(QUOTE);
    expect(outcome.report?.written).toContain(MOVED_NOTE);
    expect(after.board.entries.map((one) => one.kind)).not.toContain("не-помню");
  });

  test("переустановка плагина: заметка узнаётся по себе самой", async () => {
    await runner().tick("загрузка");
    editSnapshot(SMALL_BOOK, QUOTE, NEW_QUOTE);

    // `data.json` стёрт целиком — плагин поставлен заново, а хранилище то же.
    state = initialState(300);
    const fresh = runner();
    const outcome = await fresh.tick("загрузка");

    expect(vault.peek(SMALL_NOTE)).toContain(NEW_QUOTE);
    expect(outcome.report?.written).toContain(SMALL_NOTE);
    expect(fresh.board.entries.map((one) => one.kind)).not.toContain("не-помню");
  });

  test("три прохода подряд не меняют ни байта, даже с пустой памятью", async () => {
    await runner().tick("загрузка");
    const laid = vault.peek(SMALL_NOTE)!;
    const laidBig = vault.peek(BIG_NOTE)!;

    // Каждый заход — с чистого листа: так выглядит и переустановка, и второй
    // Мак. Отпечаток, который менял бы сам себя, здесь бы и вскрылся.
    for (const step of [1, 2, 3]) {
      state = initialState(300);
      const again = runner();
      vault.forget();
      await again.tick("команда");
      expect(vault.peek(SMALL_NOTE), `проход ${step}`).toBe(laid);
      expect(vault.peek(BIG_NOTE), `проход ${step}`).toBe(laidBig);
      expect(vault.writes, `проход ${step}`).toEqual([]);
    }
  });

  // Вырежьте подрезку `known` — тест обязан упасть.
  test("мёртвые пути не копятся в data.json", async () => {
    await runner().tick("загрузка");
    expect(Object.keys(state.known).sort()).toEqual([BIG_NOTE, SMALL_NOTE].sort());

    vault.put(MOVED_NOTE, vault.peek(SMALL_NOTE)!);
    vault.drop(SMALL_NOTE);
    editSnapshot(SMALL_BOOK, QUOTE, NEW_QUOTE);
    await runner().tick("опрос");

    // Заметки по прежнему пути больше нет — и записи о ней тоже.
    expect(Object.keys(state.known).sort()).toEqual([BIG_NOTE, MOVED_NOTE].sort());
  });

  /**
   * Холодный `metadataCache` — не повод стирать память.
   *
   * Привязки читаются из разметочного кэша Obsidian, а он к первому проходу
   * (`onLayoutReady`) разобран не весь: на хранилище владельца больше сотни
   * заметок с выписками, и часть их к этому мгновению ещё без frontmatter.
   * Подрезка по одному признаку «нет в привязках» уносила бы вместе с записью
   * и `known.head`, а он отпечатками в заметке НЕ подстрахован: заголовок
   * замерзал бы навсегда и висел расхождением в панели — молча и по причине,
   * которую человек ничем не вызывал.
   */
  // Вырежьте проверку `exists` в подрезке — тест обязан упасть.
  test("заметка на месте, а frontmatter ещё не разобран: память цела", async () => {
    await runner().tick("загрузка");
    const headBefore = state.known[BIG_NOTE]?.head;
    expect(headBefore, "заголовок секции не запомнен — проверять нечего").toBeDefined();

    // Файл не тронут ни единым байтом — его просто не успели разобрать.
    unparsed.add(BIG_NOTE);
    editSnapshot(SMALL_BOOK, QUOTE, NEW_QUOTE);
    await runner().tick("опрос");

    expect(Object.keys(state.known).sort()).toEqual([BIG_NOTE, SMALL_NOTE].sort());
    expect(state.known[BIG_NOTE]?.head).toBe(headBefore);
  });

  test("привязок ноль — память не подрезается: так же выглядит и непрочитанное", async () => {
    await runner().tick("загрузка");
    const remembered = Object.keys(state.known).sort();

    // Все привязанные заметки исчезли разом. Отличить «человек отвязал всё» от
    // «хранилище ещё не прочитано» отсюда нечем, а стереть память — значит
    // выбрать худший из двух ответов.
    vault.drop(SMALL_NOTE);
    vault.drop(BIG_NOTE);
    editSnapshot(SMALL_BOOK, QUOTE, NEW_QUOTE);
    await runner().tick("опрос");

    expect(Object.keys(state.known).sort()).toEqual(remembered);
  });
});

// MARK: - Дыра 1: чужой снимок постарше

describe("чужой снимок постарше не применяется", () => {
  // Вырежьте правило в заводиле — тест обязан упасть.
  test("снимок другого устройства старше разложенного: ничего не сделано", async () => {
    const first = runner();
    await first.tick("загрузка");
    const laid = vault.peek(BIG_NOTE)!;
    const blocks = anchorsIn(BIG_NOTE).length;
    expect(blocks).toBeGreaterThan(20);

    // На второй машине этих трёх выписок ещё нет, и её снимок отстаёт на сутки.
    // Три блока — ниже предохранителя (пятая часть или двадцать штук), то есть
    // ровно тот случай, который до 20260901 проходил молча.
    thinBook(BIG_BOOK, 3);
    stampIndex(OTHER_DEVICE, shift(OWN_MOMENT, -24 * 60 * 60_000));
    vault.forget();

    const outcome = await first.tick("команда");

    expect(outcome.report).toBeUndefined();
    expect(vault.writes).toEqual([]);
    expect(vault.peek(BIG_NOTE)).toBe(laid);
    expect(anchorsIn(BIG_NOTE).length).toBe(blocks);
    // И человек об этом узнаёт: молчаливое «ничего не изменилось» неотличимо
    // от сломанного плагина.
    expect(said.join("\n")).toContain("другим устройством");
    expect(said.join("\n")).toContain("заметки не тронуты");
  });

  test("та же беда молчит один раз, а не каждые пять секунд", async () => {
    const one = runner();
    await one.tick("загрузка");
    thinBook(BIG_BOOK, 3);
    stampIndex(OTHER_DEVICE, shift(OWN_MOMENT, -24 * 60 * 60_000));

    await one.tick("команда");
    said.length = 0;
    await one.tick("опрос");

    expect(said).toEqual([]);
  });

  test("чужой снимок НОВЕЕ разложенного применяется", async () => {
    const one = runner();
    await one.tick("загрузка");
    const blocks = anchorsIn(BIG_NOTE).length;

    // Вторая машина ушла вперёд: там выписки удалены, и это правда, а не
    // отставание. Правило, ошибающееся в эту сторону, даёт молчаливое
    // отставание — худший из отказов всего подхода (`poller.ts`).
    thinBook(BIG_BOOK, 3);
    stampIndex(OTHER_DEVICE, shift(OWN_MOMENT, 60 * 60_000));

    const outcome = await one.tick("команда");

    expect(outcome.report?.written).toContain(BIG_NOTE);
    expect(anchorsIn(BIG_NOTE).length).toBe(blocks - 3);
  });

  test("своё устройство применяется всегда, даже с моментом назад", async () => {
    const one = runner();
    await one.tick("загрузка");
    const blocks = anchorsIn(BIG_NOTE).length;

    // Часы на машине перевели назад, приложение выгрузило снова. Устройство
    // своё — спорить с ним не о чем.
    thinBook(BIG_BOOK, 3);
    stampIndex(OWN_DEVICE, shift(OWN_MOMENT, -24 * 60 * 60_000));

    const outcome = await one.tick("команда");

    expect(outcome.report?.written).toContain(BIG_NOTE);
    expect(anchorsIn(BIG_NOTE).length).toBe(blocks - 3);
  });

  test("догнавший снимок той же машины приезжает как обычно", async () => {
    const one = runner();
    await one.tick("загрузка");
    thinBook(BIG_BOOK, 3);
    stampIndex(OTHER_DEVICE, shift(OWN_MOMENT, -24 * 60 * 60_000));
    await one.tick("команда");
    const blocks = anchorsIn(BIG_NOTE).length;

    // Та же вторая машина, но снимок уже свежее нашего: пропуск был отсрочкой,
    // а не запретом.
    stampIndex(OTHER_DEVICE, shift(OWN_MOMENT, 60 * 60_000));
    const outcome = await one.tick("команда");

    expect(outcome.report?.written).toContain(BIG_NOTE);
    expect(anchorsIn(BIG_NOTE).length).toBe(blocks - 3);
  });

  /**
   * Правило отказывает в сторону «применить» — и это выбор, а не небрежность.
   *
   * Ошибись оно в другую сторону, плагин молча перестанет обновлять заметки, а
   * молчаливое отставание `poller.ts` называет главным отказом всего подхода.
   */
  test("сомнение решается в пользу работы", () => {
    const laid = { deviceId: OWN_DEVICE, generatedAt: OWN_MOMENT };
    const older = shift(OWN_MOMENT, -60_000);
    const head = (deviceId: string | undefined, generatedAt: string | undefined) =>
      ({ deviceId, generatedAt }) as Parameters<typeof laggingBehind>[0];

    expect(laggingBehind(head(OTHER_DEVICE, older), laid)).toBe(true);
    // Устройство не названо — снимок древней сборки; чьё это, неизвестно.
    expect(laggingBehind(head(undefined, older), laid)).toBe(false);
    expect(laggingBehind(head(OTHER_DEVICE, older), { ...laid, deviceId: undefined })).toBe(false);
    // Момент не разбирается или его нет.
    expect(laggingBehind(head(OTHER_DEVICE, "позавчера"), laid)).toBe(false);
    expect(laggingBehind(head(OTHER_DEVICE, undefined), laid)).toBe(false);
    const noMoment = { ...laid, generatedAt: undefined };
    expect(laggingBehind(head(OTHER_DEVICE, older), noMoment)).toBe(false);
    // Момент тот же — не «старше».
    expect(laggingBehind(head(OTHER_DEVICE, OWN_MOMENT), laid)).toBe(false);
  });

  test("первый снимок в пустом хранилище применяется: сравнивать не с чем", async () => {
    stampIndex(OTHER_DEVICE, shift(OWN_MOMENT, -365 * 24 * 60 * 60_000));

    const outcome = await runner().tick("загрузка");

    expect(outcome.report?.written).toContain(SMALL_NOTE);
    expect(state.appliedDeviceId).toBe(OTHER_DEVICE);
  });
});
