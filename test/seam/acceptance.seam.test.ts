/**
 * **ШОВ 4 (задача 16 плана `20260812-obsidian-plugin`): приёмка подпроекта и
 * извлечение без Beresta.**
 *
 * Швы 1–3 спрашивали каждый про свою половину: выгружается ли библиотека
 * (`VaultExportSeamTests`), ложится ли снимок в настоящие конспекты владельца
 * (`vault-merge.seam.test.ts`), доезжает ли выделение до заметки за секунды
 * (полуручной круг задачи 15). Этот шов спрашивает то, чего не спрашивал ни
 * один: **можно ли на всё это положиться** — три прохода подряд, пять
 * поломок, предохранитель — и **останутся ли данные у человека, если Beresta
 * исчезнет с лица земли**.
 *
 * Последнее — обещание продукта, а не свойство кода, и проверяется оно
 * соответственно: сторонними средствами по файлам на диске. Ни одной строки
 * плагина в шагах 4 и 5 не исполняется — `python3` со стандартной библиотекой,
 * `jq` и `pandoc` читают `.beresta/` и готовую заметку так, как их прочитал бы
 * человек через десять лет.
 *
 * **Что здесь настоящее.** Снимок — тот самый, что собрал шов 1 настоящей
 * выгрузкой из копии боевой базы (289 выписок, 10 книг, 1 надгробие). Заметки
 * — КОПИЯ папки `Base/Библиотека/` хранилища владельца. Хранилище владельца
 * открывается только на чтение и только при снятии копии; его отпечатки
 * снимаются до и после и обязаны совпасть пофайлово.
 *
 * **Проход собирает не этот файл, а плагин.** Шов зовёт `SyncRunner.tick` —
 * то же самое, что зовёт `main.ts` по таймеру: взгляд на указатель, решение
 * «работать или нет», проход, панель, состояние. Собирай шов свой порядок — он
 * проверял бы приёмкой порядок, которого в плагине нет.
 *
 * **Гоняется вручную:** ни настоящих заметок, ни боевой базы нет ни на какой
 * другой машине.
 *
 * ```
 * # 1. Настоящий снимок шва 1 — в папку ВНУТРИ контейнера песочницы:
 * make project
 * KEEP="$HOME/Library/Containers/com.secondbrain.beresta.Beresta/Data/tmp/beresta-seam4"
 * TEST_RUNNER_BERESTA_RUN_VAULT_EXPORT=1 TEST_RUNNER_BERESTA_VAULT_EXPORT_KEEP="$KEEP" \
 *   xcodebuild -project apps/macos/Beresta.xcodeproj -scheme Beresta \
 *   -destination 'platform=macOS,arch=arm64' -derivedDataPath apps/macos/build \
 *   -only-testing:BerestaTests/VaultExportSeamTests test
 *
 * # 2. Сам шов:
 * BERESTA_RUN_ACCEPTANCE=1 BERESTA_SEAM_SNAPSHOT="$KEEP" \
 *   npm --prefix packages/obsidian-plugin test -- test/seam/acceptance.seam.test.ts
 * ```
 *
 * **Гейт не имеет права молча позеленеть.** `BERESTA_RUN_ACCEPTANCE` решает,
 * гонять ли шов вообще; но если она стоит, а снимка, хранилища или стороннего
 * средства (`python3`, `jq`, `pandoc`) на месте нет — это отказ с объяснением,
 * а не пропуск. Пропуск здесь означал бы ровно ту беду, ради которой заведён
 * `docs/gates.md`: зелёный прогон, в котором ничего не проверялось.
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  applyChoices,
  planBinding,
  readBindings,
  DEFAULT_LIBRARY_FOLDER,
  type BindingPlan,
  type Choice,
  type VaultNote,
} from "../../src/binding/binding-view";
import type { FileHint } from "../../src/poller";
import { SECTION_BEGIN, SECTION_END } from "../../src/render/section";
import { initialState, type PluginState } from "../../src/settings";
import {
  readSnapshot,
  SNAPSHOT_FORMAT_VERSION,
  type Snapshot,
  type SnapshotSource,
} from "../../src/snapshot";
import type { NoteStore } from "../../src/sync/pass";
import { SyncRunner, type RunnerPorts, type RunOutcome, type TickOptions } from "../../src/sync/runner";
import type { BackupStore } from "../../src/write/backup";

// MARK: - Условия прогона

const RUN = process.env["BERESTA_RUN_ACCEPTANCE"] === "1";

/** Папка, куда шов 1 отдал настоящий снимок и копию базы. */
const SNAPSHOT_HOME = process.env["BERESTA_SEAM_SNAPSHOT"] ?? "";

/** Хранилище владельца. Только чтение, и только при снятии копии. */
const OWNER_VAULT =
  process.env["BERESTA_OWNER_VAULT"] ?? join(process.env["HOME"] ?? "", "Documents/Obsidian/Main");

/** Сдвиг Караганды: время выделения показывается тем же, что в приложении. */
const TIME_ZONE_OFFSET_MINUTES = 300;

/** Корень репозитория — отсюда берётся `docs/tools/extract-highlights.py`. */
const REPOSITORY = fileURLToPath(new URL("../../../..", import.meta.url));

/**
 * Нижние границы, а не равенства: владелец продолжает читать, и числа растут.
 * 20260812 выписок было 287 в 8 книгах, 20260816 — 289 в 10.
 */
const ANNOTATION_FLOOR = 287;
const BOOK_FLOOR = 8;
const LIBRARY_NOTE_FLOOR = 106;

/** Книга, на которой ставится предохранитель: самая толстая у владельца. */
const THICK_BOOK = "Джедайские техники";

// MARK: - Шаг 1: три прохода подряд

describe.runIf(RUN)("ШОВ 4: приёмка подпроекта", () => {
  test("три прохода подряд: второй и третий не меняют ни байта", async () => {
    const stand = await Stand.make();
    try {
      const ownerBefore = await fingerprintTree(stand.ownerLibrary);
      expect(Object.keys(ownerBefore).length).toBeGreaterThanOrEqual(LIBRARY_NOTE_FLOOR);

      const snapshot = await stand.snapshot();
      expect(snapshot.books.length).toBeGreaterThanOrEqual(BOOK_FLOOR);
      expect(snapshot.annotations.length).toBeGreaterThanOrEqual(ANNOTATION_FLOOR);

      // ── Проход 1: раскладка ────────────────────────────────────────────
      const first = await stand.bindAndSync();
      expect(first.look).toBe("новые-данные");
      expect(first.report?.refusals).toEqual([]);
      expect(first.report?.deferred).toEqual([]);
      expect(first.report?.missing).toEqual([]);
      const laid = await stand.anchorCount();
      console.log(
        `проход 1: записано ${first.report?.written.length} заметок, ` +
          `разложено ${laid} блоков, данные на ${first.report?.stamp}`,
      );
      expect(laid).toBe(snapshot.annotations.length);

      // ── Проход 2: те же байты указателя ────────────────────────────────
      // Плагин, который не тронул заметки, потому что данные прежние, — это и
      // есть главное свойство опроса: он крутится раз в пять секунд и обязан
      // молчать. Дешёвый путь здесь запрещён нарочно (`команда`, а не
      // `опрос`): указатель читается по-настоящему, и решение принимается по
      // отпечатку его байтов, а не по времени файла.
      const afterFirst = await fingerprintTree(stand.vault);
      const second = await stand.tick("команда");
      expect(second.look).toBe("те-же-данные");
      expect(second.report).toBeUndefined();
      expectSameTree(afterFirst, await fingerprintTree(stand.vault), "проход 2");

      // ── Проход 3: полная раскладка заново ──────────────────────────────
      // Память об указателе забыта — так выглядит перезапуск Obsidian и
      // переустановка плагина. Проход идёт целиком: снимок читается, секции
      // собираются заново, слияние сверяет их с тем, что лежит на диске. Ни
      // одного байта разницы — значит отрисовка и слияние сходятся сами с
      // собой, а не «сошлись, пока никто не перезапускался».
      stand.runner.forgetSnapshot();
      const third = await stand.tick("команда");
      expect(third.look).toBe("новые-данные");
      expect(third.report?.written).toEqual([]);
      expect(third.report?.refusals).toEqual([]);
      expectSameTree(afterFirst, await fingerprintTree(stand.vault), "проход 3");
      console.log(
        `проход 3 (память забыта): посмотрено ${third.report?.visited.length} заметок, ` +
          `записано ${third.report?.written.length}`,
      );

      // ── Настоящая папка владельца не изменилась ────────────────────────
      expect(await fingerprintTree(stand.ownerLibrary)).toEqual(ownerBefore);
      console.log(`отпечатков настоящей папки сверено: ${Object.keys(ownerBefore).length}`);
    } finally {
      await stand.cleanup();
    }
  }, 300_000);

  // MARK: - Шаг 2: отказы по списку

  /**
   * Пять поломок снимка. Каждая обязана кончиться ничем — не порчей.
   *
   * «Ничем» проверяется отпечатками ВСЕХ заметок, а не отсутствием исключения:
   * плагин, стерший секцию и не упавший, тоже «отработал без ошибок». И каждая
   * поломка ставится на хранилище, УЖЕ разложенное первым проходом, — иначе
   * ломать было бы нечего: в пустых заметках порчи не видно.
   */
  test("нет снимка: заметки не трогаются вовсе", async () => {
    const stand = await Stand.synced();
    try {
      const before = await fingerprintTree(stand.vault);
      const blocks = await stand.anchorCount();
      await stand.dropSnapshot();

      const look = await stand.tick("команда");
      expect(look.look).toBe("снимка-нет");
      expect(look.report).toBeUndefined();
      expect(look.status.snapshot).toBe("нет");
      // Секции на месте: «снимка нет» — это не «книг ноль».
      expect(await stand.anchorCount()).toBe(blocks);
      expectSameNotes(before, await fingerprintTree(stand.vault), "снимка нет");
    } finally {
      await stand.cleanup();
    }
  }, 300_000);

  test("формат новее нашего: плагин говорит словами и не пишет ничего", async () => {
    const stand = await Stand.synced();
    try {
      const before = await fingerprintTree(stand.vault);
      await stand.editIndex((index) => ({
        ...index,
        formatVersion: SNAPSHOT_FORMAT_VERSION + 1,
      }));

      const look = await stand.tick("команда");
      expect(look.look).toBe("не-читается");
      expect(look.report).toBeUndefined();
      expect(look.status.snapshot).toBe("не-читается");
      expect(stand.said.join("\n")).toContain("Обновите плагин");
      // Сравниваются заметки, а не всё дерево: указатель поломал сам щуп.
      expectSameNotes(before, await fingerprintTree(stand.vault), "формат новее");
    } finally {
      await stand.cleanup();
    }
  }, 300_000);

  /**
   * Снимок с чужого Мака, собранный РАНЬШЕ уже разложенного.
   *
   * Так выглядит хранилище, синхронизированное между двумя машинами: обе
   * пишут в одну папку `.beresta/`, и снимок второй машины отстаёт на день.
   * План требует «ничего не сделано»: чужой отстающий снимок не должен
   * убирать из заметки выписки, которых на той машине ещё нет.
   *
   * **Эта проверка была КРАСНОЙ с 20260816 по 20260901.** Замер: чужой снимок
   * на сутки старше убрал из «Джедайских техник» три блока и переписал
   * заметку. Поле `deviceId` плагин читал, клал в `header` и не спрашивал ни
   * разу — при том, что `snapshot/model.ts` обещает обратное словами «плагин
   * обязан уметь сказать, чей это снимок, а не молча смешать два».
   * Предохранитель прикрывает только крупную убыль (больше пятой части блоков
   * заметки или больше двадцати штук), поэтому потолок молчаливой потери был
   * 20 блоков на заметку за проход.
   *
   * **Починено 20260901 задачей 2 плана «выписки снаружи»** — правилом
   * `laggingBehind` в заводиле (`sync/runner.ts`), а не здесь: приёмка
   * проверяет то, что есть, а не чинит. Правило отказывает в сторону
   * «применить», потому что ошибка в другую сторону даёт молчаливое
   * отставание — худший из отказов этого подхода; оба направления закрыты
   * обычными проверками в `test/ownership.test.ts`.
   *
   * Прогон 20260901 на настоящем снимке шва 1 и копии заметок владельца:
   * зелено. С вырезанным правилом — красно тем же замечанием, что 20260816:
   * `written` = `['Base/Библиотека/Джедайские техники.md']`.
   */
  test("снимок чужого устройства старше разложенного: ничего не сделано", async () => {
    const stand = await Stand.synced();
    try {
      const before = await fingerprintTree(stand.vault);
      const blocks = await stand.anchorCount();
      const thinned = await stand.thinBook(THICK_BOOK, 3);
      await stand.editIndex((index) => ({
        ...index,
        deviceId: "00000000-0000-4000-8000-ЧУЖОЙ-МАК",
        generatedAt: shift(index["generatedAt"] as string, -24 * 60 * 60_000),
      }));
      console.log(`чужой снимок: из «${THICK_BOOK}» убрано ${thinned} выписок, момент на сутки назад`);

      const look = await stand.tick("команда");
      expect(look.report?.written ?? []).toEqual([]);
      expect(await stand.anchorCount()).toBe(blocks);
      expectSameNotes(before, await fingerprintTree(stand.vault), "чужой снимок постарше");
    } finally {
      await stand.cleanup();
    }
  }, 300_000);

  test("осколок не сходится с отпечатком: книга пропускается, заметка цела", async () => {
    const stand = await Stand.synced();
    try {
      const before = await fingerprintTree(stand.vault);
      const blocks = await stand.anchorCount();
      const spoiled = await stand.spoilShard(THICK_BOOK);

      // Сперва то, что случится на самом деле чаще всего: указатель не
      // менялся, и плагин внутрь папки не заглядывает вовсе. Это тоже
      // «ничего не сделано», и оно тоже обязано быть проверено — иначе шов
      // молча проверял бы вторую половину случая вместо первой.
      const quiet = await stand.tick("команда");
      expect(quiet.look).toBe("те-же-данные");
      expect(quiet.report).toBeUndefined();

      // А теперь — перезапуск Obsidian: снимок читается заново, при живом
      // указателе и испорченном осколке.
      stand.runner.forgetSnapshot();
      const look = await stand.tick("загрузка");
      expect(look.look).toBe("новые-данные");
      expect(look.status.snapshot).toBe("наполовину");
      expect(look.status.problems).toBe(1);
      const problems = (await stand.snapshot()).problems;
      expect(problems.map((one) => one.kind)).toEqual(["shard-checksum"]);
      expect(problems[0]!.message).toContain("не сходится с отпечатком");
      expect(problems[0]!.file).toBe(spoiled);
      // Ни одного блока не убрано: книга, которой в снимке не оказалось, — не
      // книга без выписок.
      expect(look.report?.written ?? []).toEqual([]);
      expect(await stand.anchorCount()).toBe(blocks);
      expectSameNotes(before, await fingerprintTree(stand.vault), "осколок испорчен");
    } finally {
      await stand.cleanup();
    }
  }, 300_000);

  test("половина осколков не доехала: приезжают остальные, блоки на месте", async () => {
    const stand = await Stand.synced();
    try {
      const before = await fingerprintTree(stand.vault);
      const blocks = await stand.anchorCount();
      const hidden = await stand.hideShards(0.5);
      expect(hidden).toBeGreaterThanOrEqual(BOOK_FLOOR / 2);

      stand.runner.forgetSnapshot();
      const look = await stand.tick("загрузка");
      expect(look.look).toBe("новые-данные");
      expect(look.status.snapshot).toBe("наполовину");
      expect(look.status.problems).toBe(hidden);
      const problems = (await stand.snapshot()).problems;
      expect(new Set(problems.map((one) => one.kind))).toEqual(new Set(["shard-missing"]));
      expect(look.report?.written ?? []).toEqual([]);
      // И ни одного отказа: книга, осколок которой ещё едет, — не книга без
      // выписок. Прими её проход за пустую — заметка поехала бы в
      // предохранитель, и человек получил бы пять сообщений об остановке
      // вместо тишины.
      expect(look.report?.refusals ?? []).toEqual([]);
      expect(await stand.anchorCount()).toBe(blocks);
      expectSameNotes(before, await fingerprintTree(stand.vault), "половина осколков");

      // И то, ради чего в опросе заведён признак `whole`: недоехавшее
      // приезжает само, без нового указателя. Возвращаем осколки на место и
      // смотрим тем же указателем — снимок обязан стать целым.
      await stand.returnShards();
      const again = await stand.tick("опрос");
      expect(again.status.snapshot).toBe("целый");
      expect(again.status.problems).toBe(0);
    } finally {
      await stand.cleanup();
    }
  }, 300_000);

  // MARK: - Шаг 3: предохранитель

  /**
   * Из снимка ушли 25 выписок «Джедайских техник» — четверть книги.
   *
   * Так выглядит наполовину прочитанный указатель и снимок с чужой машины.
   * Проход обязан остановиться и показать список, а не стереть блоки: 25 цитат
   * из конспекта, который человек вёл четыре года, восстанавливаются только из
   * запасной копии, а её он ещё должен догадаться поискать.
   */
  test("предохранитель: 25 пропавших выписок останавливают проход, а не стирают блоки", async () => {
    const stand = await Stand.synced();
    try {
      const before = await fingerprintTree(stand.vault);
      const path = await stand.noteOf(THICK_BOOK);
      const textBefore = await stand.read(path);
      const blocksBefore = (await stand.anchorsIn(path)).length;
      expect(blocksBefore).toBeGreaterThanOrEqual(25);

      const gone = await stand.thinBook(THICK_BOOK, 25);
      expect(gone).toBe(25);
      await stand.touchIndexMoment();

      const look = await stand.tick("команда");
      const refusal = (look.report?.refusals ?? []).find((one) => one.path === path);
      expect(refusal?.refused).toBe("too-many-removals");
      expect(refusal?.message).toContain(`убрал бы 25 блоков из ${blocksBefore}`);
      expect(refusal?.message).toContain("Посмотрите список");
      // Список — не слова, а якоря: их показывает панель.
      expect((look.report?.removed[path] ?? []).length).toBe(25);
      expect(stand.said.join("\n")).toContain("убрал бы 25 блоков");
      expect(stand.board(path).map((one) => one.kind)).toContain("отказ");

      // Заметка не тронута — байт в байт, и блоков столько же.
      expect(await stand.read(path)).toBe(textBefore);
      expect((await stand.anchorsIn(path)).length).toBe(blocksBefore);
      expectSameNotes(before, await fingerprintTree(stand.vault), "предохранитель сработал");

      // Предохранитель — остановка, а не стена: владелец посмотрел список и
      // подтвердил. Без этого шага проверка не отличала бы предохранитель от
      // сломанного прохода.
      stand.runner.forgetSnapshot();
      const confirmed = await stand.tick("команда", { allowRemovals: new Set([path]) });
      expect(confirmed.report?.written).toContain(path);
      expect((await stand.anchorsIn(path)).length).toBe(blocksBefore - 25);
      // Текст владельца при этом цел: убрали блоки, а не заметку. Сравнивается
      // зона человека — всё, кроме секции между маркерами и наших двух ключей
      // frontmatter: `beresta-last-sync` обязан был поменяться, он и есть
      // ответ на вопрос «на какой момент данные».
      expect(authorZone(await stand.read(path))).toBe(authorZone(textBefore));
    } finally {
      await stand.cleanup();
    }
  }, 300_000);

  // MARK: - Шаг 4: извлечение без Beresta

  /**
   * Сорок строк на Python читают `.beresta/` и отдают всё до последней выписки.
   *
   * **Это и есть второй критерий владельца, выраженный проверкой.** Здесь не
   * исполняется ни строки плагина: сторонний `python3` со стандартной
   * библиотекой читает те же файлы и получает то же число, что и разбор
   * плагина. Разойдись они — врёт либо формат, либо документ о формате.
   *
   * Второе средство — `jq`, и оно здесь не для красоты: `python3` и плагин
   * могли бы одинаково ошибиться на одном и том же поле, а `jq` считает
   * элементы `first.items` вообще ничего не зная про Beresta.
   */
  test("сторонний скрипт достаёт все выписки: ни SQLite, ни Swift, ни Obsidian", async () => {
    const stand = await Stand.make();
    try {
      const snapshot = await stand.snapshot();
      const script = join(REPOSITORY, "docs/tools/extract-highlights.py");
      expect(await exists(script)).toBe(true);

      const started = Date.now();
      const run = spawnSync("python3", [script, stand.vault], { encoding: "utf8" });
      expect(run.error, `python3 не запустился: ${run.error?.message}`).toBeUndefined();
      expect(run.status, run.stderr).toBe(0);
      const seconds = (Date.now() - started) / 1000;

      const counted = /всего выписок: (\d+)/.exec(run.stdout)?.[1];
      expect(counted, "скрипт не напечатал число выписок").toBeDefined();
      expect(Number(counted)).toBe(snapshot.annotations.length);
      console.log(
        `извлечение без Beresta: ${counted} выписок за ${seconds.toFixed(2)} с, ` +
          `${run.stdout.split("\n").length} строк вывода`,
      );

      // Не только число: цитаты, пути по оглавлению, свои мысли и даты.
      const withPath = snapshot.annotations.find((one) => one.chapterPath.length >= 2);
      const withComment = snapshot.annotations.find(
        (one) => (one.comment ?? "") !== "" && (one.quote ?? "") !== "",
      );
      expect(withPath, "в снимке нет выписки с многоуровневым путём").toBeDefined();
      expect(withComment, "в снимке нет выписки со своей мыслью").toBeDefined();
      expect(run.stdout).toContain(withPath!.chapterPath.join(" → "));
      expect(run.stdout).toContain(withPath!.quote ?? "");
      expect(run.stdout).toContain(`мысль: ${withComment!.comment}`);
      expect(run.stdout).toContain(withComment!.created.slice(0, 10));

      // Скрипт правда короткий: обещание «сорок строк» проверяется, а не
      // повторяется. Считаются строки кода, без пустых и без пояснений.
      const lines = (await readFile(script, "utf8")).split("\n");
      const code = lines.filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
      const body = code.slice(code.findIndex((line) => line.startsWith("import")));
      expect(body.length).toBeLessThanOrEqual(50);
      console.log(`docs/tools/extract-highlights.py: ${body.length} строк кода`);

      // Второе средство, ничего не знающее ни про Beresta, ни про Python.
      const jq = spawnSync(
        "/bin/sh",
        [
          "-c",
          `jq -s '[.[] | .first.items | length] | add' ${JSON.stringify(join(stand.vault, ".beresta/books"))}/*.jsonld`,
        ],
        { encoding: "utf8" },
      );
      expect(jq.status, jq.stderr).toBe(0);
      expect(Number(jq.stdout.trim())).toBe(snapshot.annotations.length);
      console.log(`jq насчитал по осколкам: ${jq.stdout.trim()}`);
    } finally {
      await stand.cleanup();
    }
  }, 300_000);

  // MARK: - Шаг 5: заметка без Beresta

  /**
   * Заметка читается обычным средством: коллаут вырождается в блочную цитату.
   *
   * `pandoc` про Obsidian не знает вовсе — для него `> [!quote]+ …` просто
   * блочная цитата, первая строка которой начинается с квадратных скобок.
   * Именно это и требуется: место в книге названо словами, цитата читается,
   * ссылка осталась строкой, а не пропала вместе с приложением.
   */
  test("заметка читается без Obsidian и без Beresta", async () => {
    const stand = await Stand.synced();
    try {
      const path = await stand.noteOf(THICK_BOOK);
      const text = await stand.read(path);
      const file = join(stand.root, "заметка.md");
      await writeFile(file, text, "utf8");

      // Читатель — `markdown-yaml_metadata_block`, то есть обычный Markdown
      // БЕЗ разбора frontmatter: ровно так заметку видит и человек в простом
      // редакторе, и любой сторонний просмотрщик, не знающий про Obsidian.
      const html = pandoc(file, "html5");
      expect(html.error, `pandoc не запустился: ${html.error?.message}`).toBeUndefined();
      expect(html.status, html.stderr).toBe(0);
      expect(html.stdout).toContain("<blockquote>");

      const plain = pandoc(file, "plain");
      expect(plain.status, plain.stderr).toBe(0);

      // **Наша секция не сделала заметку хуже для стороннего средства.**
      // Проверка сравнительная, а не абсолютная, потому что абсолютная тут
      // соврала бы: `pandoc` со СВОИМ разбором YAML спотыкается на
      // frontmatter владельца (`aliases:` без значения) и на ИСХОДНОЙ его
      // заметке — до всякой Beresta. Утверждать «заметка читается» значило бы
      // приписать себе чужую беду; утверждать «не читается» — приписать себе
      // чужую вину. Верное утверждение одно: как читалась, так и читается.
      const original = join(stand.root, "оригинал.md");
      await writeFile(original, await readFile(join(stand.ownerLibrary, basename(path)), "utf8"), "utf8");
      const strictOurs = spawnSync("pandoc", ["-f", "markdown", "-t", "plain", file], {
        encoding: "utf8",
      });
      const strictOriginal = spawnSync("pandoc", ["-f", "markdown", "-t", "plain", original], {
        encoding: "utf8",
      });
      expect(strictOurs.status, "секция изменила судьбу заметки у строгого читателя").toBe(
        strictOriginal.status,
      );
      console.log(
        `pandoc со своим разбором YAML: оригинал владельца ${strictOriginal.status}, ` +
          `наша заметка ${strictOurs.status} (0 — разобрал, 64 — споткнулся о frontmatter)`,
      );

      const snapshot = await stand.snapshot();
      const book = snapshot.books.find((one) => (one.title ?? "").startsWith(THICK_BOOK))!;
      const sample = book.annotations.find(
        (one) => (one.quote ?? "").length > 40 && one.chapterPath.length > 0 && one.cfi !== undefined,
      );
      expect(sample, "в книге нет выписки с цитатой, путём и CFI — проверять нечего").toBeDefined();

      // 1. Текст цитаты читается.
      expect(plain.stdout).toContain(sample!.quote!.slice(0, 40));
      // 2. Место в книге названо словами.
      expect(plain.stdout).toContain(sample!.chapterPath.join(" → "));
      // 3. Ссылка осталась строкой — вместе с местом внутри книги. CFI в ней
      //    закодирован по RFC 3986 (`render/link.ts`), поэтому ищется слово
      //    `epubcfi`, а не сама строка привязки: место названо, но человеку
      //    придётся раскодировать проценты руками.
      expect(html.stdout).toContain("beresta://open/");
      expect(html.stdout).toContain("epubcfi");
      console.log(
        `${path}: ${(await stand.anchorsIn(path)).length} блоков, ` +
          `${html.stdout.split("<blockquote>").length - 1} блочных цитат в HTML pandoc`,
      );

      // Половина шага 5 — человеческая: заметку надо ОТКРЫТЬ глазами в
      // обычном редакторе. Сама по себе она не воспроизводима, но её вход
      // воспроизводим: по просьбе шов кладёт получившуюся заметку наружу.
      const keep = process.env["BERESTA_ACCEPTANCE_KEEP"];
      if (keep !== undefined && keep !== "") {
        await mkdir(keep, { recursive: true });
        await writeFile(join(keep, basename(path)), text, "utf8");
        await writeFile(join(keep, "заметка.html"), html.stdout, "utf8");
        console.log(`заметка отдана глазам: ${join(keep, basename(path))}`);
      }
    } finally {
      await stand.cleanup();
    }
  }, 300_000);

  // MARK: - Сам гейт умеет падать

  /**
   * **Проверка гейта: он краснеет от порчи и не краснеет от роста.**
   *
   * Без неё зелёный прогон выше не отличается от прогона, в котором проверять
   * было нечего. Оба направления уже подводили: гейт равенствами краснеет от
   * новой книги владельца, гейт без утверждений зеленеет на пустой папке.
   */
  test("гейт падает от стёртого блока и не падает от лишней книги", async () => {
    const stand = await Stand.synced();
    try {
      const before = await fingerprintTree(stand.vault);
      const path = await stand.noteOf(THICK_BOOK);
      const anchors = await stand.anchorsIn(path);

      // Порча: один блок стёрт из заметки. Сравнение отпечатков обязано это
      // увидеть — иначе оно не увидело бы и стёртые 25.
      const text = await stand.read(path);
      await writeFile(join(stand.vault, path), text.replace(`^${anchors[0]!}`, ""), "utf8");
      expect(() =>
        expectSameNotes(before, { ...before, [path]: "другой" }, "проверка гейта"),
      ).toThrow();
      expect(await fingerprintTree(stand.vault)).not.toEqual(before);

      // Рост: лишняя книга в снимке границы не ломает.
      const snapshot = await stand.snapshot();
      expect(snapshot.books.length + 1).toBeGreaterThanOrEqual(BOOK_FLOOR);
      expect(snapshot.annotations.length + 47).toBeGreaterThanOrEqual(ANNOTATION_FLOOR);
    } finally {
      await stand.cleanup();
    }
  }, 300_000);
});

// MARK: - Выбор владельца

/**
 * Что нажал бы владелец: свой конспект, совпавший названием; машинные заметки
 * не выбираются никогда; книге без такого кандидата — «завести новую».
 */
function chooseByHand(plan: BindingPlan): Map<string, Choice> {
  const choices = new Map<string, Choice>();
  for (const row of plan.awaitingUser) {
    const own = row.candidates.find(
      (one) => !one.machineGenerated && !one.authorOnly && one.reasons.some(isTitleReason),
    );
    choices.set(
      row.bookUUID,
      own === undefined ? { kind: "create" } : { kind: "bind", path: own.path },
    );
  }
  return choices;
}

function isTitleReason(reason: string): boolean {
  return reason === "title-exact" || reason === "title-prefix" || reason === "title-contains";
}

// MARK: - Стенд

/**
 * Копия хранилища владельца, настоящий снимок шва 1 и заводило плагина над
 * ними.
 *
 * Порядок «взгляд → проход → панель → состояние» стенд не собирает: его
 * собирает `SyncRunner`, тот самый, что зовёт `main.ts`.
 */
class Stand {
  static async make(): Promise<Stand> {
    if (SNAPSHOT_HOME === "") {
      throw new Error(
        "BERESTA_RUN_ACCEPTANCE=1, но BERESTA_SEAM_SNAPSHOT не задан: настоящий снимок " +
          "шва 1 собрать нечем. Сначала прогон VaultExportSeamTests с BERESTA_VAULT_EXPORT_KEEP.",
      );
    }
    for (const required of [join(SNAPSHOT_HOME, ".beresta", "index.json")]) {
      if (!(await exists(required))) throw new Error(`снимка шва 1 нет на месте: ${required}`);
    }
    const ownerLibrary = join(OWNER_VAULT, DEFAULT_LIBRARY_FOLDER);
    if (!(await exists(ownerLibrary))) {
      throw new Error(`папки заметок владельца нет: ${ownerLibrary}`);
    }
    for (const tool of ["python3", "jq", "pandoc"]) {
      const found = spawnSync("/usr/bin/which", [tool], { encoding: "utf8" });
      if (found.status !== 0) {
        throw new Error(
          `нет стороннего средства «${tool}»: шов 4 доказывает извлечение БЕЗ Beresta, ` +
            "и доказывать его нечем. Пропуск здесь был бы зелёным прогоном ни о чём.",
        );
      }
    }

    const root = await mkdtemp(join(tmpdir(), "beresta-acceptance-"));
    const vault = join(root, "хранилище");
    // Копия — и ни одной записи по исходному пути.
    await mkdir(join(vault, DEFAULT_LIBRARY_FOLDER), { recursive: true });
    await cp(ownerLibrary, join(vault, DEFAULT_LIBRARY_FOLDER), { recursive: true });
    await cp(join(SNAPSHOT_HOME, ".beresta"), join(vault, ".beresta"), { recursive: true });
    return new Stand(root, vault, ownerLibrary);
  }

  /** Стенд, по которому уже прошёл первый проход: есть чему ломаться. */
  static async synced(): Promise<Stand> {
    const stand = await Stand.make();
    const first = await stand.bindAndSync();
    if ((first.report?.written.length ?? 0) === 0) {
      throw new Error("первый проход ничего не записал: ломать нечего");
    }
    stand.said.length = 0;
    return stand;
  }

  readonly runner: SyncRunner;
  /** Что плагин сказал человеку вслух. */
  readonly said: string[] = [];
  private state: PluginState;
  private hiddenShards: string[] = [];

  private constructor(
    readonly root: string,
    readonly vault: string,
    readonly ownerLibrary: string,
  ) {
    this.state = initialState(TIME_ZONE_OFFSET_MINUTES);
    this.runner = new SyncRunner(this.ports(), this.state);
  }

  async cleanup(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }

  // MARK: Проходы

  async tick(reason: "загрузка" | "опрос" | "команда" | "заметка", options: TickOptions = {}): Promise<RunOutcome> {
    return await this.runner.tick(reason, options);
  }

  /** Первый проход: привязка руками и раскладка. */
  async bindAndSync(): Promise<RunOutcome> {
    const snapshot = await this.snapshot();
    const notes = await this.notes();
    const plan = planBinding(snapshot, notes);
    if (plan.automatic.length > 0) throw new Error("экран привязки выбрал что-то сам");
    const outcome = applyChoices(plan, chooseByHand(plan), readBindings(notes));
    if (outcome.untouched.length > 0) throw new Error("владелец не выбрал ничего по книге");

    const alsoBind = new Map<string, readonly string[]>(outcome.bindings);
    for (const creation of outcome.creations) alsoBind.set(creation.path, [creation.bookUUID]);
    return await this.tick("команда", {
      alsoBind,
      creating: new Set(outcome.creations.map((one) => one.path)),
    });
  }

  // MARK: Чтение

  /** Снимок, прочитанный НАПРЯМУЮ с диска — мимо плагина и его памяти. */
  async snapshot(): Promise<Extract<Snapshot, { kind: "present" }>> {
    const read = await readSnapshot(fileSource(this.vault));
    if (read.kind !== "present") throw new Error(`снимка нет: ${read.kind}`);
    return read;
  }

  async notes(): Promise<VaultNote[]> {
    const found: VaultNote[] = [];
    for (const path of await walk(this.vault)) {
      if (!isNote(path)) continue;
      found.push({ path, text: await readFile(join(this.vault, path), "utf8") });
    }
    return found;
  }

  async read(path: string): Promise<string> {
    return await readFile(join(this.vault, path), "utf8");
  }

  async anchorsIn(path: string): Promise<string[]> {
    return anchorsOf(await this.read(path));
  }

  /** Блоков во всём хранилище. */
  async anchorCount(): Promise<number> {
    let total = 0;
    for (const note of await this.notes()) total += anchorsOf(note.text).length;
    return total;
  }

  /** Заметка, к которой привязана книга с таким названием. */
  async noteOf(title: string): Promise<string> {
    const snapshot = await this.snapshot();
    const book = snapshot.books.find((one) => (one.title ?? "").startsWith(title));
    if (book === undefined) throw new Error(`книги «${title}» в снимке нет`);
    for (const [path, ids] of readBindings(await this.notes())) {
      if (ids.includes(book.uuid)) return path;
    }
    throw new Error(`книга «${title}» ни к чему не привязана`);
  }

  board(path: string): { kind: string; words: string }[] {
    return this.runner.board.entries.filter((one) => one.path === path);
  }

  // MARK: Поломки снимка

  async dropSnapshot(): Promise<void> {
    await rm(join(this.vault, ".beresta"), { recursive: true, force: true });
  }

  /** Правит указатель, оставляя всё прочее на месте. */
  async editIndex(
    revise: (index: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void> {
    const at = join(this.vault, ".beresta/index.json");
    const index = JSON.parse(await readFile(at, "utf8")) as Record<string, unknown>;
    await writeFile(at, JSON.stringify(revise(index)), "utf8");
  }

  /** Двигает момент указателя вперёд: снимок становится новым для опроса. */
  async touchIndexMoment(): Promise<void> {
    await this.editIndex((index) => ({
      ...index,
      generatedAt: shift(index["generatedAt"] as string, 60_000),
    }));
  }

  /**
   * Убирает из осколка книги последние `count` выписок — с пересчётом
   * отпечатка в указателе.
   *
   * Пересчёт обязателен: осколок без него не сойдётся с указателем, и проверка
   * проверяла бы не «выписки пропали», а «файл испорчен». Это разные беды и
   * разные ветки.
   */
  async thinBook(title: string, count: number): Promise<number> {
    const at = join(this.vault, ".beresta/index.json");
    const index = JSON.parse(await readFile(at, "utf8")) as {
      books: { file: string; sha256: string; total: number }[];
    };
    for (const entry of index.books) {
      const shardAt = join(this.vault, ".beresta", entry.file);
      const shard = JSON.parse(await readFile(shardAt, "utf8")) as {
        "beresta:book"?: { label?: string };
        first?: { items?: unknown[] };
        total?: number;
      };
      if (!(shard["beresta:book"]?.label ?? "").startsWith(title)) continue;
      const items = shard.first?.items ?? [];
      const kept = items.slice(0, Math.max(0, items.length - count));
      const gone = items.length - kept.length;
      shard.first!.items = kept;
      shard.total = kept.length;
      const bytes = JSON.stringify(shard);
      await writeFile(shardAt, bytes, "utf8");
      entry.sha256 = createHash("sha256").update(bytes).digest("hex");
      entry.total = kept.length;
      await writeFile(at, JSON.stringify(index), "utf8");
      return gone;
    }
    throw new Error(`книги «${title}» в снимке нет`);
  }

  /** Дописывает в осколок пробел: байты другие, отпечаток в указателе прежний. */
  async spoilShard(title: string): Promise<string> {
    const snapshot = await this.snapshot();
    const book = snapshot.books.find((one) => (one.title ?? "").startsWith(title));
    if (book === undefined) throw new Error(`книги «${title}» в снимке нет`);
    const file = `books/${book.shard}`;
    const at = join(this.vault, ".beresta", file);
    await writeFile(at, `${await readFile(at, "utf8")} `, "utf8");
    return file;
  }

  /** Уносит долю осколков, не трогая указателя. */
  async hideShards(share: number): Promise<number> {
    const books = join(this.vault, ".beresta/books");
    const files = (await readdir(books)).sort();
    const take = Math.floor(files.length * share);
    this.hiddenShards = files.slice(0, take);
    for (const name of this.hiddenShards) {
      await cp(join(books, name), join(this.root, `спрятано-${name}`));
      await rm(join(books, name));
    }
    return take;
  }

  async returnShards(): Promise<void> {
    for (const name of this.hiddenShards) {
      await cp(join(this.root, `спрятано-${name}`), join(this.vault, ".beresta/books", name));
    }
    this.hiddenShards = [];
  }

  // MARK: Порты плагина

  private ports(): RunnerPorts {
    const vault = this.vault;
    return {
      source: {
        exists: (path) => exists(join(vault, path)),
        readBinary: async (path) => {
          const bytes = await readFile(join(vault, path));
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
        },
        stat: async (path): Promise<FileHint | undefined> => {
          try {
            const info = await stat(join(vault, path));
            return { mtime: info.mtimeMs, size: info.size };
          } catch {
            return undefined;
          }
        },
      },
      notes: this.noteStore(),
      backups: this.backups(),
      bindings: async () => readBindings(await this.notes()),
      persist: async (state) => {
        this.state = state;
      },
      // Часы стенда стоят: имя запасной копии не должно зависеть от того,
      // когда шов гоняли.
      now: () => Date.parse("2026-08-16T12:00:00Z"),
      announce: (line) => {
        this.said.push(line);
      },
    };
  }

  private noteStore(): NoteStore {
    const vault = this.vault;
    return {
      exists: (path) => exists(join(vault, path)),
      read: (path) => readFile(join(vault, path), "utf8"),
      create: async (path, text) => {
        await mkdir(dirname(join(vault, path)), { recursive: true });
        await writeFile(join(vault, path), text, "utf8");
      },
      process: async (path, revise) => {
        const at = join(vault, path);
        const current = await readFile(at, "utf8");
        const next = revise(current);
        if (next !== current) await writeFile(at, next, "utf8");
      },
      // Открытых редакторов в приёмке нет: их случай меряет шов 2.
      editorText: () => undefined,
    };
  }

  private backups(): BackupStore {
    const folder = join(this.vault, ".obsidian/plugins/beresta");
    return {
      read: async (path) =>
        (await exists(join(folder, path))) ? await readFile(join(folder, path), "utf8") : undefined,
      write: async (path, text) => {
        await mkdir(dirname(join(folder, path)), { recursive: true });
        await writeFile(join(folder, path), text, "utf8");
      },
      remove: async (path) => {
        await rm(join(folder, path), { force: true });
      },
    };
  }
}

// MARK: - Сравнение деревьев

/**
 * Отпечаток дерева: путь → sha256 содержимого.
 *
 * Отпечатком, а не размером и не временем: время меняется и от чтения, а
 * «переписали тем же по длине» размером не поймать вовсе.
 */
async function fingerprintTree(root: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {};
  for (const path of await walk(root)) {
    tree[path] = createHash("sha256")
      .update(await readFile(join(root, path)))
      .digest("hex");
  }
  return tree;
}

/** Всё дерево совпало — и если нет, разница печатается, а не прячется. */
function expectSameTree(
  before: Record<string, string>,
  after: Record<string, string>,
  title: string,
): void {
  const difference = describeDifference(before, after);
  if (difference.length > 0) console.log([`=== разница, ${title} ===`, ...difference].join("\n"));
  expect(after, title).toEqual(before);
}

/** То же, но про заметки: папку `.beresta/` ломает сам щуп. */
function expectSameNotes(
  before: Record<string, string>,
  after: Record<string, string>,
  title: string,
): void {
  const ours = (tree: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(tree).filter(([path]) => !path.startsWith(".beresta/")));
  const difference = describeDifference(ours(before), ours(after));
  if (difference.length > 0) console.log([`=== разница, ${title} ===`, ...difference].join("\n"));
  expect(ours(after), title).toEqual(ours(before));
}

function describeDifference(
  before: Record<string, string>,
  after: Record<string, string>,
): string[] {
  const lines: string[] = [];
  for (const path of Object.keys(after)) {
    if (!(path in before)) lines.push(`  появился: ${path}`);
    else if (before[path] !== after[path]) lines.push(`  изменился: ${path}`);
  }
  for (const path of Object.keys(before)) {
    if (!(path in after)) lines.push(`  пропал: ${path}`);
  }
  return lines;
}

// MARK: - Мелочи

function fileSource(root: string): SnapshotSource {
  return {
    exists: (path) => exists(join(root, path)),
    readBinary: async (path) => {
      const bytes = await readFile(join(root, path));
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
    },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(root: string): Promise<string[]> {
  const found: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const at = stack.pop()!;
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) found.push(relative(root, full).split(sep).join("/"));
    }
  }
  return found.sort();
}

/** Заметка хранилища — и `.obsidian/` в это слово не входит. */
function isNote(path: string): boolean {
  return path.endsWith(".md") && !path.startsWith(".obsidian/");
}

function anchorsOf(text: string): string[] {
  return [...text.matchAll(/^\^(hl-\S+)$/gm)].map((match) => match[1]!);
}

/**
 * Зона человека: всё, кроме секции между маркерами и наших двух ключей.
 *
 * Разбор здесь свой, а не из `src/merge/zones.ts`, нарочно: сравнивать вывод
 * кода с ожиданием, посчитанным ТЕМ ЖЕ кодом, значит доказать, что он согласен
 * сам с собой.
 */
function authorZone(text: string): string {
  const lines = text.split("\n");
  const begin = lines.findIndex((line) => line.trim() === SECTION_BEGIN);
  const end = lines.findIndex((line) => line.trim() === SECTION_END);
  const body =
    begin >= 0 && end > begin ? [...lines.slice(0, begin), ...lines.slice(end + 1)] : lines;
  const kept: string[] = [];
  let dropping = false;
  for (const line of body) {
    if (/^beresta-(book-id|last-sync):/.test(line)) {
      dropping = /^beresta-book-id:/.test(line);
      continue;
    }
    if (dropping) {
      if (/^\s*-\s/.test(line)) continue;
      dropping = false;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

/**
 * Обычный Markdown без разбора frontmatter — так заметку видит сторонний
 * просмотрщик, ничего не знающий ни про Obsidian, ни про Beresta.
 */
function pandoc(file: string, to: string): SpawnSyncReturns<string> {
  return spawnSync("pandoc", ["-f", "markdown-yaml_metadata_block", "-t", to, file], {
    encoding: "utf8",
  });
}

/** Момент со сдвигом в миллисекундах, тем же видом строки. */
function shift(iso: string, milliseconds: number): string {
  return new Date(Date.parse(iso) + milliseconds).toISOString().replace(/\.\d{3}Z$/, "Z");
}
