/**
 * **ШОВ 2 (задача 13 плана `20260812-obsidian-plugin`): первый синк в копию
 * хранилища владельца.**
 *
 * Пять задач плагина — чтение снимка, отрисовка, слияние трёх зон, привязка,
 * запасная копия и предохранитель записи — делались по отдельности, и каждая
 * закрыта своими проверками на выдуманных данных. Шов спрашивает то, чего ни
 * одна из них не спрашивала: лягут ли выписки в НАСТОЯЩИЕ конспекты владельца,
 * которые он вёл четыре года, не потеряв ни одной его строки.
 *
 * **Что здесь настоящее.**
 *
 * - Снимок — тот самый, что собрал шов 1 (`VaultExportSeamTests`) настоящей
 *   выгрузкой из копии боевой базы. Не выдуманный и не собранный этим файлом:
 *   собрать его нечем, `VaultExportService` живёт в цели приложения.
 * - База — та же одноразовая копия, из которой снимок собран. Нужна затем,
 *   чтобы «блоков доехало столько, сколько живых выписок» проверялось по
 *   НЕЗАВИСИМОМУ источнику, а не по тому же снимку.
 * - Заметки — КОПИЯ папки `Base/Библиотека/` хранилища владельца во временном
 *   каталоге. **Хранилище владельца открывается только на чтение и только
 *   один раз — при снятии копии.** Отпечатки настоящей папки снимаются до и
 *   после всего захода и обязаны совпасть пофайлово.
 *
 * **Гоняется вручную:** ни настоящих заметок, ни боевой базы нет ни на какой
 * другой машине.
 *
 * ```
 * # 1. Настоящий снимок из шва 1 — в папку внутри контейнера песочницы:
 * make project
 * KEEP="$HOME/Library/Containers/com.secondbrain.beresta.Beresta/Data/tmp/beresta-seam2"
 * TEST_RUNNER_BERESTA_RUN_VAULT_EXPORT=1 TEST_RUNNER_BERESTA_VAULT_EXPORT_KEEP="$KEEP" \
 *   xcodebuild -project apps/macos/Beresta.xcodeproj -scheme Beresta \
 *   -destination 'platform=macOS,arch=arm64' -derivedDataPath apps/macos/build \
 *   -only-testing:BerestaTests/VaultExportSeamTests test
 *
 * # 2. Сам шов:
 * BERESTA_RUN_VAULT_MERGE=1 BERESTA_SEAM_SNAPSHOT="$KEEP" \
 *   npm --prefix packages/obsidian-plugin test -- test/seam
 * ```
 *
 * **Гейт не имеет права молча позеленеть.** Переменная `BERESTA_RUN_VAULT_MERGE`
 * решает, гонять ли шов вообще; но если она стоит, а снимка или хранилища на
 * месте нет — это отказ с объяснением, а не пропуск. Пропуск здесь означал бы
 * ровно ту беду, ради которой заведён `docs/gates.md`: зелёный прогон, в
 * котором ничего не проверялось.
 */

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, test } from "vitest";

import {
  applyChoices,
  planBinding,
  readBindings,
  describePlan,
  DEFAULT_LIBRARY_FOLDER,
  type BindingPlan,
  type Choice,
  type VaultNote,
} from "../../src/binding/binding-view";
import type { KnownSection, MergeConflict } from "../../src/merge/merge";
import { SECTION_BEGIN, SECTION_END } from "../../src/render/section";
import { runSync, type NoteStore, type SyncReport } from "../../src/sync/pass";
import {
  readSnapshot,
  type Snapshot,
  type SnapshotBook,
  type SnapshotSource,
} from "../../src/snapshot";
import { listBackups, restoreBackup, type BackupStore } from "../../src/write/backup";

// MARK: - Условия прогона

const RUN = process.env["BERESTA_RUN_VAULT_MERGE"] === "1";

/** Папка, куда шов 1 отдал снимок и копию базы. */
const SNAPSHOT_HOME = process.env["BERESTA_SEAM_SNAPSHOT"] ?? "";

/** Хранилище владельца. Только чтение, и только при снятии копии. */
const OWNER_VAULT =
  process.env["BERESTA_OWNER_VAULT"] ?? join(process.env["HOME"] ?? "", "Documents/Obsidian/Main");

/** Сдвиг Караганды: время выделения показывается тем же, что в приложении. */
const TIME_ZONE_OFFSET_MINUTES = 300;

/**
 * Нижние границы, а не равенства: владелец продолжает читать, и числа растут.
 *
 * Числа плана (287 выписок, 8 книг, 61 + 45 заметок) сняты 20260812; к
 * 20260815 выписок 289, книг 10, заметок 120. Гейт, написанный равенствами,
 * покраснел бы от того, что владелец прочитал ещё одну книгу, — и его бы
 * отключили.
 */
const ANNOTATION_FLOOR = 287;
const BOOK_FLOOR = 8;
const LIBRARY_NOTE_FLOOR = 106;

// MARK: - Сам шов

describe.runIf(RUN)("ШОВ 2: первый синк в копию хранилища владельца", () => {
  test("конспекты владельца принимают выписки, не потеряв ни строки автора", async () => {
    const stand = await Stand.make();
    try {
      // ── Отпечаток НАСТОЯЩЕЙ папки до всего ─────────────────────────────
      const ownerBefore = await fingerprintTree(stand.ownerLibrary);
      expect(Object.keys(ownerBefore).length).toBeGreaterThanOrEqual(LIBRARY_NOTE_FLOOR);

      // ── Снимок шва 1 ───────────────────────────────────────────────────
      const snapshot = await readSnapshot(fileSource(stand.vault));
      expect(snapshot.kind).toBe("present");
      if (snapshot.kind !== "present") return;
      expect(snapshot.problems).toEqual([]);
      expect(snapshot.books.length).toBeGreaterThanOrEqual(BOOK_FLOOR);
      expect(snapshot.annotations.length).toBeGreaterThanOrEqual(ANNOTATION_FLOOR);
      console.log(
        `снимок шва 1: книг ${snapshot.books.length}, выписок ${snapshot.annotations.length}, ` +
          `надгробий ${snapshot.books.reduce((sum, book) => sum + book.tombstones.length, 0)}, ` +
          `собран ${snapshot.header.generatedAt}`,
      );

      // ── Привязка руками ────────────────────────────────────────────────
      const notes = await stand.notes();
      const plan = planBinding(snapshot, notes);
      expect(plan.automatic).toEqual([]);
      expect(plan.awaitingUser.length).toBe(snapshot.books.length);
      console.log(["=== экран привязки ===", ...describePlan(plan)].join("\n"));

      // Самое опасное место экрана — «Building a Second Brain»: у книги четыре
      // кандидата, три из них машинный экспорт Readwise, и один из машинных
      // совпадает названием дословно. Все четыре обязаны быть предложены, три
      // помечены машинными, выбранным — ни один.
      // И общее правило экрана на живых данных: ни одна машинная заметка не
      // стоит выше своей. На «Джедайских техниках» это проверяется всерьёз —
      // там конспект владельца и экспорт Readwise набирают ровно поровну.
      for (const row of plan.awaitingUser) {
        const firstMachine = row.candidates.findIndex((one) => one.machineGenerated);
        const lastOwn = lastIndexWhere(row.candidates, (one) => !one.machineGenerated);
        if (firstMachine >= 0 && lastOwn >= 0) {
          expect(firstMachine, `${row.title}: машинная заметка выше своей`).toBeGreaterThan(lastOwn);
        }
      }

      const risky = plan.awaitingUser.find((row) => row.title.startsWith("Building a Second Brain"));
      expect(risky).toBeDefined();
      expect(risky!.chosen).toBeUndefined();
      expect(risky!.candidates.length).toBe(4);
      expect(risky!.candidates.filter((one) => one.machineGenerated).length).toBe(3);
      expect(risky!.candidates[0]!.machineGenerated).toBe(false);

      const choices = chooseByHand(plan);
      const outcome = applyChoices(plan, choices, readBindings(notes));
      expect(outcome.untouched).toEqual([]);
      const bindings = new Map<string, readonly string[]>(outcome.bindings);
      for (const creation of outcome.creations) bindings.set(creation.path, [creation.bookUUID]);
      const boundExisting = [...outcome.bindings.keys()];
      const created = outcome.creations.map((one) => one.path);
      console.log(
        `привязано руками: ${boundExisting.length} заметок владельца, ` +
          `заведено новых: ${created.length}`,
      );

      // ── Первый проход ──────────────────────────────────────────────────
      const before = await fingerprintTree(stand.vault);
      const beforeText = await stand.readAll(boundExisting);
      const first = await stand.sync(snapshot, bindings, {
        mayCreateSection: true,
        creating: new Set(created),
      });
      console.log(stand.summary(first, "проход 1"));
      expect(first.refusals).toEqual([]);
      expect(first.deferred).toEqual([]);
      expect(first.missing).toEqual([]);
      expect(first.written.sort()).toEqual([...bindings.keys()].sort());

      // 1. Новых файлов ровно столько, сколько заметок владелец велел завести.
      const after = await fingerprintTree(stand.vault);
      const appeared = Object.keys(after).filter((path) => !(path in before));
      expect(appeared.filter(isNote).sort()).toEqual([...created].sort());
      expect(await stand.noteCount()).toBe(countNotes(before) + created.length);

      // 2. Текст владельца остался НАЧАЛОМ файла — байт в байт.
      //
      //    **Проверка переписана против плана, и вот почему.** План писал
      //    «вне маркеров — байт в байт»; на первом же прогоне это покраснело
      //    на собственном щупе. Секция дописывается в конец, и перед ней
      //    появляется недостающий перевод строки: байты ВНЕ маркеров от этого
      //    отличаются на один пустой ряд, хотя ни одна строка владельца не
      //    тронута. Правильный ход — не вычесть щуп из ожидания, а сказать
      //    точнее: тело заметки владельца обязано быть ПРЕФИКСОМ нового файла,
      //    добавлено может быть только это — пустой ряд, секция и перевод
      //    строки в конце. Проверка от этого строже плановой: она ловит и
      //    переставленные строки, и вставку в середину.
      for (const path of boundExisting) {
        expectOwnersTextKept(beforeText[path]!, await stand.read(path), path);
      }

      // 3. Frontmatter владельца цел — построчно и в прежнем порядке.
      const jedi = "Base/Библиотека/Джедайские техники.md";
      expect(boundExisting).toContain(jedi);
      expect(frontmatterOf(beforeText[jedi]!)).toEqual([
        "tags: 📖",
        "aliases:",
        "name: Джедайские техники",
        "date: 20221025 1047",
      ]);
      const jediNow = frontmatterOf(await stand.read(jedi));
      expect(jediNow.slice(0, 4)).toEqual(frontmatterOf(beforeText[jedi]!));
      // Отметка о времени — момент ДАННЫХ снимка, а не время прогона: иначе
      // пункт 5 («второй проход не меняет ни байта») зависел бы от часов.
      expect(jediNow).toContain(`beresta-last-sync: ${stampOf(snapshot.header.generatedAt)}`);
      expect(jediNow).toContain("beresta-book-id:");
      expect(jediNow.filter((line) => line.startsWith("  - ")).join()).toContain(
        bindings.get(jedi)![0]!,
      );

      // 4. Блоков доехало столько, сколько ЖИВЫХ выписок у этих книг по
      //    БАЗЕ — независимый источник, а не то же число из снимка.
      const boundBooks = [...bindings.values()].flat();
      const expected = stand.liveAnnotationCount(boundBooks);
      const anchors = await stand.anchorCount([...bindings.keys()]);
      console.log(`блоков разложено: ${anchors}, живых выписок в базе: ${expected}`);
      expect(anchors).toBe(expected);
      // И поимённо: не «столько же штук», а те самые адреса. Сверка по числу
      // прошла бы и при перепутанных между заметками блоках.
      for (const [path, ids] of bindings) {
        const inFile = await stand.anchorsIn(path);
        const inBase = ids.flatMap((id) => stand.liveAnchors(id));
        expect([...inFile].sort(), path).toEqual([...inBase].sort());
      }

      // 5. Второй проход не меняет ни байта.
      const bytes = await fingerprintTree(stand.vault);
      const idle = await stand.sync(snapshot, bindings, { mayCreateSection: false });
      expect(idle.written).toEqual([]);
      expect(await fingerprintTree(stand.vault)).toEqual(bytes);

      // 6. Ни один файл, которого владелец не привязывал, не тронут — включая
      //    все 45 заметок Readwise.
      const touched = new Set(bindings.keys());
      for (const [path, hash] of Object.entries(before)) {
        if (touched.has(path)) continue;
        expect(after[path], path).toBe(hash);
      }
      expect(folderOf(after, "Base/Библиотека/Readwise")).toEqual(
        folderOf(before, "Base/Библиотека/Readwise"),
      );

      // 7. Запасная копия снята до первой записи и возвращает прежний текст.
      const copies = await listBackups(stand.backups);
      expect(copies.map((one) => one.path).sort()).toEqual([...boundExisting].sort());
      const restored = await restoreBackup(stand.backups, copies[0]!.id);
      expect(restored?.text).toBe(beforeText[copies[0]!.path]!);

      // ── Щупы ───────────────────────────────────────────────────────────
      // Без них шов проверяет только счастливый случай: заметки, которых
      // человек не касался между проходами, а выписок в базе не убыло.
      const probes = await stand.addProbes(bindings, snapshot);
      console.log(stand.probeSummary(probes));

      const afterDelete = await readSnapshot(fileSource(stand.snapshotAfterDelete));
      expect(afterDelete.kind).toBe("present");
      if (afterDelete.kind !== "present") return;
      expect(afterDelete.annotations.length).toBe(snapshot.annotations.length - 1);

      // Проход при открытой заметке с несохранёнными правками: запись видит
      // диск, а не экран, — поэтому она откладывается целиком.
      const dirty = await stand.sync(afterDelete, bindings, {
        mayCreateSection: false,
        editors: new Map([[probes.removed.path, `${probes.removed.textOnDisk}\nещё не сохранено`]]),
      });
      expect(dirty.deferred).toEqual([probes.removed.path]);
      expect(await stand.read(probes.removed.path)).toBe(probes.removed.textOnDisk);

      // Тот же проход с сохранённой заметкой.
      const third = await stand.sync(afterDelete, bindings, { mayCreateSection: false });
      console.log(stand.summary(third, "проход 3 (щупы)"));

      // Щуп 1: правленый человеком блок заморожен и назван расхождением.
      expect(conflictKinds(third.conflicts, probes.edited.path)).toContain("edited");
      expect(await stand.read(probes.edited.path)).toBe(probes.edited.textOnDisk);
      expect(await stand.read(probes.edited.path)).toContain(probes.edited.mark);

      // Щуп 2: удалённый человеком блок не воскресает — и удаление не выдаётся
      // за правку соседнего блока.
      expect(third.deleted[probes.deleted.path] ?? []).toContain(probes.deleted.anchor);
      expect(await stand.anchorsIn(probes.deleted.path)).not.toContain(probes.deleted.anchor);
      expect(conflictKinds(third.conflicts, probes.deleted.path)).toEqual([]);
      expect(await stand.read(probes.deleted.path)).toBe(probes.deleted.textOnDisk);

      // Щуп 3: маркеры стёрты — уведомление, а не новая секция.
      expect(refusalsOf(third, probes.erased.path)).toEqual(["section-missing"]);
      expect(await stand.read(probes.erased.path)).toBe(probes.erased.textOnDisk);

      // Щуп 4: ломаная пара маркеров — отказ по файлу без записи.
      expect(refusalsOf(third, probes.broken.path)).toEqual(["markers-broken"]);
      expect(await stand.read(probes.broken.path)).toBe(probes.broken.textOnDisk);

      // Щуп 5: выписка мягко удалена в приложении — блок ушёл из заметки.
      expect(third.removed[probes.removed.path] ?? []).toContain(probes.removed.anchor);
      expect(await stand.anchorsIn(probes.removed.path)).not.toContain(probes.removed.anchor);
      expect(authorZone(await stand.read(probes.removed.path))).toBe(
        authorZone(probes.removed.textOnDisk),
      );

      // Щуп 6: снимок пересобран, данные те же. Отметка о времени отвечает
      // «на какой момент данные», а не «когда мы заглядывали», — значит проход
      // с новым моментом и прежними выписками не пишет НИЧЕГО. Без этого опрос
      // задачи 14 переписывал бы каждую привязанную заметку раз в пять секунд.
      const settled = await fingerprintTree(stand.vault);
      const later: Snapshot = {
        ...afterDelete,
        header: { ...afterDelete.header, generatedAt: "2026-08-15T18:30:00Z" },
      };
      const fourth = await stand.sync(later, bindings, { mayCreateSection: false });
      expect(stampOf(later.header.generatedAt)).not.toBe(stampOf(afterDelete.header.generatedAt));
      expect(fourth.written).toEqual([]);
      expect(await fingerprintTree(stand.vault)).toEqual(settled);

      // ── Настоящая папка владельца не изменилась ────────────────────────
      expect(await fingerprintTree(stand.ownerLibrary)).toEqual(ownerBefore);
      console.log(`отпечатков настоящей папки сверено: ${Object.keys(ownerBefore).length}`);
    } finally {
      await stand.cleanup();
    }
  }, 300_000);

  /**
   * **Проверка самого гейта: он умеет падать и не падает от роста.**
   *
   * Без неё зелёный прогон выше не отличается от прогона, в котором проверять
   * было нечего. Проверяются оба направления, потому что оба уже подводили:
   * гейт равенствами краснеет от новой книги владельца, гейт без утверждений
   * зеленеет на пустой папке.
   */
  test("гейт падает от пропавшей заметки и не падает от лишней книги", async () => {
    const stand = await Stand.make();
    try {
      const snapshot = await readSnapshot(fileSource(stand.vault));
      if (snapshot.kind !== "present") throw new Error("снимка нет");
      const notes = await stand.notes();
      const plan = planBinding(snapshot, notes);
      const choices = chooseByHand(plan);
      const outcome = applyChoices(plan, choices, readBindings(notes));

      // Одна привязанная заметка пропала из копии — гейт обязан покраснеть.
      const victim = [...outcome.bindings.keys()][0]!;
      await rm(join(stand.vault, victim));
      const bindings = new Map<string, readonly string[]>(outcome.bindings);
      const shrunk = await stand.sync(snapshot, bindings, {
        mayCreateSection: true,
        creating: new Set(outcome.creations.map((one) => one.path)),
      });
      expect(shrunk.missing).toContain(victim);
      expect(shrunk.written).not.toContain(victim);
      expect(await exists(join(stand.vault, victim))).toBe(false);

      // Лишняя книга в снимке — гейт обязан остаться зелёным: границы нижние.
      const extra: SnapshotBook = { ...snapshot.books[0]!, uuid: "00000000-0000-4000-8000-книга" };
      const grown: Snapshot = {
        ...snapshot,
        books: [...snapshot.books, extra],
        annotations: [...snapshot.annotations, ...extra.annotations],
      };
      expect(grown.books.length).toBeGreaterThanOrEqual(BOOK_FLOOR);
      expect(grown.annotations.length).toBeGreaterThanOrEqual(ANNOTATION_FLOOR);
      expect(planBinding(grown, notes).awaitingUser.length).toBe(grown.books.length);
    } finally {
      await stand.cleanup();
    }
  }, 300_000);
});

// MARK: - Выбор владельца

/**
 * Что нажал бы владелец.
 *
 * **Выбор всё равно делается снаружи `planBinding`** — тем же входом
 * `applyChoices`, каким его сделает окно задачи 14. Правило простое и
 * записанное: свой конспект, совпавший названием; машинные заметки не
 * выбираются никогда; книге без такого кандидата — «завести новую».
 */
function chooseByHand(plan: BindingPlan): Map<string, Choice> {
  const choices = new Map<string, Choice>();
  for (const row of plan.awaitingUser) {
    const own = row.candidates.find(
      (one) => !one.machineGenerated && !one.authorOnly && one.reasons.some(isTitleReason),
    );
    choices.set(row.bookUUID, own === undefined ? { kind: "create" } : { kind: "bind", path: own.path });
  }
  return choices;
}

function isTitleReason(reason: string): boolean {
  return reason === "title-exact" || reason === "title-prefix" || reason === "title-contains";
}

// MARK: - Стенд

interface SyncOptions {
  readonly mayCreateSection: boolean;
  /**
   * Заметки, которых ещё нет и которые владелец велел завести.
   *
   * **Только они и заводятся.** Привязанная заметка, которой на месте нет, —
   * это пропажа, о которой надо сказать, а не повод написать её заново: тем
   * же проходом плагин вернул бы человеку заметку, которую тот только что
   * удалил, и вернул бы одной секцией, без его четырёх лет.
   */
  readonly creating?: ReadonlySet<string>;
  /** Путь → текст в редакторе, если заметка открыта с несохранённым. */
  readonly editors?: ReadonlyMap<string, string>;
}

interface Probe {
  readonly path: string;
  /** Текст, который человек оставил на диске. */
  readonly textOnDisk: string;
  readonly anchor: string;
  readonly mark: string;
}

interface Probes {
  readonly edited: Probe;
  readonly deleted: Probe;
  readonly erased: Probe;
  readonly broken: Probe;
  readonly removed: Probe;
}

/**
 * Копия хранилища, копия базы и проход синка над ними.
 *
 * Проход собран здесь, а не взят из `src/`: связывать чтение снимка,
 * отрисовку, слияние, предохранитель и запасную копию будет задача 14 внутри
 * Obsidian, и до неё этого кода нет вовсе. Шов складывает те же кубики в том
 * же порядке — и в этом его смысл: он первый, кто их складывает.
 */
class Stand {
  static async make(): Promise<Stand> {
    if (SNAPSHOT_HOME === "") {
      throw new Error(
        "BERESTA_RUN_VAULT_MERGE=1, но BERESTA_SEAM_SNAPSHOT не задан: настоящий снимок " +
          "шва 1 собрать нечем. Сначала прогон VaultExportSeamTests с BERESTA_VAULT_EXPORT_KEEP.",
      );
    }
    for (const required of [
      join(SNAPSHOT_HOME, ".beresta", "index.json"),
      join(SNAPSHOT_HOME, "beresta.sqlite"),
      join(SNAPSHOT_HOME, "после-удаления", ".beresta", "index.json"),
    ]) {
      if (!(await exists(required))) {
        throw new Error(`снимка шва 1 нет на месте: ${required}`);
      }
    }
    const ownerLibrary = join(OWNER_VAULT, DEFAULT_LIBRARY_FOLDER);
    if (!(await exists(ownerLibrary))) {
      throw new Error(`папки заметок владельца нет: ${ownerLibrary}`);
    }

    const root = await mkdtemp(join(tmpdir(), "beresta-vault-merge-"));
    const vault = join(root, "хранилище");
    // Копия — и ни одной записи по исходному пути. `cp` читает, `writeFile`
    // ниже пишет только внутрь `vault`.
    await mkdir(join(vault, DEFAULT_LIBRARY_FOLDER), { recursive: true });
    await cp(ownerLibrary, join(vault, DEFAULT_LIBRARY_FOLDER), { recursive: true });
    await cp(join(SNAPSHOT_HOME, ".beresta"), join(vault, ".beresta"), { recursive: true });

    return new Stand(root, vault, ownerLibrary);
  }

  private readonly memory = new Map<string, KnownSection>();
  private readonly database: DatabaseSync;

  private constructor(
    private readonly root: string,
    readonly vault: string,
    readonly ownerLibrary: string,
  ) {
    this.database = new DatabaseSync(join(SNAPSHOT_HOME, "beresta.sqlite"), { readOnly: true });
  }

  /** Снимок, собранный после мягкого удаления одной выписки. */
  readonly snapshotAfterDelete = join(SNAPSHOT_HOME, "после-удаления");

  /** Склад запасных копий — папка плагина внутри копии хранилища. */
  readonly backups: BackupStore = {
    read: async (path) => {
      const at = join(this.vault, ".obsidian/plugins/beresta", path);
      return (await exists(at)) ? await readFile(at, "utf8") : undefined;
    },
    write: async (path, text) => {
      const at = join(this.vault, ".obsidian/plugins/beresta", path);
      await mkdir(dirname(at), { recursive: true });
      await writeFile(at, text, "utf8");
    },
    remove: async (path) => {
      await rm(join(this.vault, ".obsidian/plugins/beresta", path), { force: true });
    },
  };

  async cleanup(): Promise<void> {
    this.database.close();
    await rm(this.root, { recursive: true, force: true });
  }

  // MARK: Чтение копии

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

  async readAll(paths: readonly string[]): Promise<Record<string, string>> {
    const all: Record<string, string> = {};
    for (const path of paths) all[path] = await this.read(path);
    return all;
  }

  async noteCount(): Promise<number> {
    return (await walk(this.vault)).filter(isNote).length;
  }

  async anchorsIn(path: string): Promise<string[]> {
    return anchorsOf(await this.read(path));
  }

  async anchorCount(paths: readonly string[]): Promise<number> {
    let total = 0;
    for (const path of paths) total += (await this.anchorsIn(path)).length;
    return total;
  }

  // MARK: Независимый источник — база

  /** Сколько живых выписок у этих книг ПО БАЗЕ. */
  liveAnnotationCount(bookUUIDs: readonly string[]): number {
    let total = 0;
    for (const uuid of bookUUIDs) total += this.liveAnchors(uuid).length;
    return total;
  }

  /** Якоря живых выписок книги — как их построит отрисовка, но из базы. */
  liveAnchors(bookUUID: string): string[] {
    const rows = this.database
      .prepare("SELECT uuid FROM annotation WHERE bookUUID = ? AND deletedAt IS NULL")
      .all(bookUUID) as { uuid: string }[];
    return rows.map((row) => `hl-${row.uuid.replace(/-/g, "").toLowerCase()}`);
  }

  // MARK: Проход синка

  /**
   * Проход синка — ТОТ ЖЕ, что в плагине.
   *
   * **До задачи 14 его не было в `src/` вовсе,** и шов складывал порядок сам:
   * снимок → отрисовка → слияние → предохранитель → запасная копия → запись.
   * Это было записано долгом в `docs/gates.md` — «в день, когда порядок соберёт
   * точка входа, шов обязан перестать собирать его сам». День настал: порядок
   * живёт в `src/sync/pass.ts`, и шов зовёт ровно его. Собирай он свой — он
   * проверял бы на живом хранилище порядок, которого в плагине нет.
   */
  async sync(
    snapshot: Snapshot,
    bindings: ReadonlyMap<string, readonly string[]>,
    options: SyncOptions,
  ): Promise<SyncReport> {
    return await runSync({
      snapshot,
      bindings,
      notes: this.noteStore(options.editors),
      backups: this.backups,
      memory: {
        get: (path) => this.memory.get(path),
        set: (path, known) => {
          this.memory.set(path, known);
        },
      },
      settings: {
        timeZoneOffsetMinutes: TIME_ZONE_OFFSET_MINUTES,
        keepBackups: 5,
        removalShare: 0.2,
        removalCount: 20,
      },
      // Время прохода — момент данных снимка, а не часы машины: имя запасной
      // копии от этого перестаёт зависеть от того, когда шов гоняли.
      now: momentOf(snapshot),
      creating: options.creating,
      mayCreateSection: options.mayCreateSection ? new Set(bindings.keys()) : new Set(),
    });
  }

  /** Заметки копии хранилища — четыре действия поверх файловой системы. */
  private noteStore(editors?: ReadonlyMap<string, string>): NoteStore {
    return {
      exists: (path) => exists(join(this.vault, path)),
      read: (path) => readFile(join(this.vault, path), "utf8"),
      create: async (path, text) => {
        await mkdir(dirname(join(this.vault, path)), { recursive: true });
        await writeFile(join(this.vault, path), text, "utf8");
      },
      process: async (path, revise) => {
        // Обработчику даётся текст С ДИСКА — ровно как `vault.process` у
        // Obsidian по замеру задачи 2.
        const at = join(this.vault, path);
        const current = await readFile(at, "utf8");
        const next = revise(current);
        if (next !== current) await writeFile(at, next, "utf8");
      },
      editorText: (path) => editors?.get(path),
    };
  }

  // MARK: Щупы

  /**
   * Дописывает в КОПИЮ то, чего в счастливом случае нет: правку человека,
   * удалённый им блок, стёртые маркеры, ломаную пару.
   *
   * Заметки для щупов выбираются устройством, а не именем: самые толстые
   * привязанные — на них щуп заведомо есть на чём поставить.
   */
  async addProbes(
    bindings: ReadonlyMap<string, readonly string[]>,
    snapshot: Snapshot,
  ): Promise<Probes> {
    const paths = [...bindings.keys()];
    const sized: { path: string; anchors: string[] }[] = [];
    for (const path of paths) sized.push({ path, anchors: await this.anchorsIn(path) });
    sized.sort((one, two) => two.anchors.length - one.anchors.length);

    // Пятый щуп — про книгу, у которой выписка ушла из снимка: только её
    // заметка может показать, что блок исчез.
    const gone = removedAnnotation(snapshot, await readSnapshot(fileSource(this.snapshotAfterDelete)));
    const removedPath = [...bindings].find(([, ids]) => ids.includes(gone.bookUUID))?.[0];
    if (removedPath === undefined) throw new Error("книга удалённой выписки не привязана");

    const pool = sized.filter((one) => one.path !== removedPath && one.anchors.length >= 3);
    if (pool.length < 4) throw new Error("привязанных заметок с блоками меньше четырёх");

    const edited = await this.probeEdit(pool[0]!.path, pool[0]!.anchors[0]!);
    const deleted = await this.probeDelete(pool[1]!.path, pool[1]!.anchors[1]!);
    const erased = await this.probeErase(pool[2]!.path);
    const broken = await this.probeBreak(pool[3]!.path);
    return {
      edited,
      deleted,
      erased,
      broken,
      removed: {
        path: removedPath,
        textOnDisk: await this.read(removedPath),
        anchor: gone.anchor,
        mark: gone.uuid,
      },
    };
  }

  /** Человек поправил слово внутри блока. */
  private async probeEdit(path: string, anchor: string): Promise<Probe> {
    const mark = "— так у меня в тетради";
    const lines = (await this.read(path)).split("\n");
    const at = lines.findIndex((line) => line.trim() === `^${anchor}`);
    const quote = lastIndexWhere(lines.slice(0, at), (line) => line.startsWith("> "));
    lines[quote] = `${lines[quote]!} ${mark}`;
    const text = lines.join("\n");
    await writeFile(join(this.vault, path), text, "utf8");
    return { path, textOnDisk: text, anchor, mark };
  }

  /**
   * Человек стёр блок целиком — от конца предыдущего блока до якоря этого.
   *
   * Границу отсчитываем от ЯКОРЯ предыдущего блока, а не от ближайшей пустой
   * строки: первый заход резал по пустой строке и оставлял в заметке цитату
   * без якоря, а она прирастала к предыдущему блоку и меняла его хеш. Щуп
   * тогда проверял не «человек стёр блок», а «человек поправил соседний».
   */
  private async probeDelete(path: string, anchor: string): Promise<Probe> {
    const lines = (await this.read(path)).split("\n");
    const at = lines.findIndex((line) => line.trim() === `^${anchor}`);
    const previous = lastIndexWhere(lines.slice(0, at), (line) => /^\^hl-\S+$/.test(line.trim()));
    if (previous < 0) throw new Error("щуп удаления: перед блоком нет другого блока");
    const text = [...lines.slice(0, previous + 1), ...lines.slice(at + 1)].join("\n");
    await writeFile(join(this.vault, path), text, "utf8");
    return { path, textOnDisk: text, anchor, mark: "" };
  }

  /** Человек убрал секцию вместе с маркерами. */
  private async probeErase(path: string): Promise<Probe> {
    const lines = (await this.read(path)).split("\n");
    const from = lines.findIndex((line) => line.trim() === SECTION_BEGIN);
    const to = lines.findIndex((line) => line.trim() === SECTION_END);
    const text = [...lines.slice(0, from), ...lines.slice(to + 1)].join("\n");
    await writeFile(join(this.vault, path), text, "utf8");
    return { path, textOnDisk: text, anchor: "", mark: "" };
  }

  /** Закрывающий маркер потерялся — границы зоны машины не видно. */
  private async probeBreak(path: string): Promise<Probe> {
    const lines = (await this.read(path)).split("\n");
    const to = lines.findIndex((line) => line.trim() === SECTION_END);
    const text = [...lines.slice(0, to), ...lines.slice(to + 1)].join("\n");
    await writeFile(join(this.vault, path), text, "utf8");
    return { path, textOnDisk: text, anchor: "", mark: "" };
  }

  // MARK: Отчёт

  summary(report: SyncReport, title: string): string {
    const lines = [
      `=== ${title} ===`,
      `  записано ${report.written.length}, отложено ${report.deferred.length}, ` +
        `отказов ${report.refusals.length}`,
    ];
    for (const refusal of report.refusals) lines.push(`  отказ: ${refusal.path} — ${refusal.refused}`);
    for (const [path, conflicts] of Object.entries(report.conflicts)) {
      lines.push(`  расхождения в ${path}: ${conflicts.map((one) => one.kind).join(", ")}`);
    }
    for (const [path, anchors] of Object.entries(report.removed)) {
      lines.push(`  убрано блоков в ${path}: ${anchors.length}`);
    }
    return lines.join("\n");
  }

  probeSummary(probes: Probes): string {
    return [
      "=== щупы в копии хранилища ===",
      `  правка человека:   ${probes.edited.path} (блок ^${probes.edited.anchor})`,
      `  удалённый блок:    ${probes.deleted.path} (блок ^${probes.deleted.anchor})`,
      `  стёртые маркеры:   ${probes.erased.path}`,
      `  ломаная пара:      ${probes.broken.path}`,
      `  выписка удалена:   ${probes.removed.path} (выписка ${probes.removed.mark})`,
    ].join("\n");
  }
}

// MARK: - Чтение зон независимо от кода, который проверяем

/**
 * Зона человека: всё, кроме секции между маркерами и наших двух ключей.
 *
 * Разбор здесь свой, а не из `src/merge/zones.ts`, нарочно: сравнивать вывод
 * кода с ожиданием, посчитанным ТЕМ ЖЕ кодом, значит доказать, что он
 * согласен сам с собой. Здесь — простой поиск строк-маркеров и вычёркивание
 * ключей `beresta-*` из frontmatter.
 */
function authorZone(text: string): string {
  const lines = text.split("\n");
  const begin = lines.findIndex((line) => line.trim() === SECTION_BEGIN);
  const end = lines.findIndex((line) => line.trim() === SECTION_END);
  const body = begin >= 0 && end > begin ? [...lines.slice(0, begin), ...lines.slice(end + 1)] : lines;
  return withoutOurKeys(body).join("\n");
}

/**
 * Текст владельца пережил первую запись целиком.
 *
 * Три утверждения, и каждое про своё:
 *
 * 1. Frontmatter владельца — начало нового frontmatter, строка в строку;
 *    дописано только наше, и ничего кроме.
 * 2. Тело заметки — ПРЕФИКС нового тела, байт в байт. Ни перестановки, ни
 *    вставки в середину, ни потерянной строки это не переживёт.
 * 3. Дописано ровно одно: не больше одного пустого ряда, пара маркеров и то,
 *    что между ними. Всё остальное — повод покраснеть.
 */
function expectOwnersTextKept(before: string, after: string, path: string): void {
  const was = splitAtFrontmatter(before);
  const now = splitAtFrontmatter(after);

  expect(now.front.slice(0, was.front.length), `${path}: frontmatter владельца`).toEqual(was.front);
  for (const line of now.front.slice(was.front.length)) {
    expect(line, `${path}: чужая строка во frontmatter`).toMatch(
      /^(beresta-(book-id|last-sync):|\s+-\s)/,
    );
  }

  expect(now.body.startsWith(was.body), `${path}: тело владельца больше не начало файла`).toBe(true);
  const added = now.body.slice(was.body.length);
  expect(added, `${path}: дописано не только секцией`).toMatch(
    new RegExp(`^\\n{0,2}${escape(SECTION_BEGIN)}\\n[\\s\\S]*\\n${escape(SECTION_END)}\\n?$`),
  );
}

function splitAtFrontmatter(text: string): { front: string[]; body: string } {
  const lines = text.split("\n");
  if (lines[0] !== "---") return { front: [], body: text };
  const end = lines.slice(1).findIndex((line) => line === "---");
  if (end < 0) return { front: [], body: text };
  return { front: lines.slice(1, end + 1), body: lines.slice(end + 2).join("\n") };
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Строки frontmatter как есть. */
function frontmatterOf(text: string): string[] {
  const lines = text.split("\n");
  if (lines[0] !== "---") return [];
  const end = lines.slice(1).findIndex((line) => line === "---");
  return end < 0 ? [] : lines.slice(1, end + 1);
}

function withoutOurKeys(lines: readonly string[]): string[] {
  const kept: string[] = [];
  let dropping = false;
  for (const line of lines) {
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
  return kept;
}

/** Якоря блоков в тексте. */
function anchorsOf(text: string): string[] {
  return [...text.matchAll(/^\^(hl-\S+)$/gm)].map((match) => match[1]!);
}

/** Последний подходящий — `findLastIndex` в наш уровень языка не входит. */
function lastIndexWhere<T>(items: readonly T[], fits: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (fits(items[index]!)) return index;
  }
  return -1;
}

function refusalsOf(report: SyncReport, path: string): string[] {
  return report.refusals.filter((one) => one.path === path).map((one) => one.refused);
}

/** Момент данных снимка в миллисекундах. */
function momentOf(snapshot: Snapshot): number {
  const at = snapshot.kind === "present" ? snapshot.header.generatedAt : undefined;
  const parsed = at === undefined ? Number.NaN : Date.parse(at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function conflictKinds(conflicts: Record<string, MergeConflict[]>, path: string): string[] {
  return (conflicts[path] ?? []).map((one) => one.kind);
}

/** Какая выписка ушла между двумя снимками — по самим снимкам, а не по имени. */
function removedAnnotation(
  before: Snapshot,
  after: Snapshot,
): { uuid: string; anchor: string; bookUUID: string } {
  if (before.kind !== "present" || after.kind !== "present") throw new Error("снимка нет");
  const alive = new Set(after.annotations.map((one) => one.id));
  for (const book of before.books) {
    for (const annotation of book.annotations) {
      if (alive.has(annotation.id)) continue;
      const uuid = annotation.uuid ?? "";
      return {
        uuid,
        anchor: `hl-${uuid.replace(/-/g, "").toLowerCase()}`,
        bookUUID: book.uuid,
      };
    }
  }
  throw new Error("между снимками ни одна выписка не ушла: щуп удаления поставить не на чем");
}

// MARK: - Файловая система

function fileSource(root: string): SnapshotSource {
  return {
    exists: (path) => exists(join(root, path)),
    readBinary: async (path) => {
      const bytes = await readFile(join(root, path));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
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

/** Все файлы под корнем, путями от корня и через косую черту. */
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

function folderOf(tree: Record<string, string>, folder: string): Record<string, string> {
  return Object.fromEntries(Object.entries(tree).filter(([path]) => path.startsWith(`${folder}/`)));
}

/**
 * Заметка хранилища — и `.obsidian/` в это слово не входит.
 *
 * Различение не педантизм: запасные копии задачи 11 лежат в папке плагина и
 * тоже кончаются на `.md`. Считай их заметками — и «новых файлов ровно
 * столько, сколько велел завести владелец» покраснело бы на собственной
 * запасной копии, а вычесть её из ожидания значило бы подогнать проверку.
 */
function isNote(path: string): boolean {
  return path.endsWith(".md") && !path.startsWith(".obsidian/");
}

function countNotes(tree: Record<string, string>): number {
  return Object.keys(tree).filter(isNote).length;
}

/** Момент данных снимка в привычном владельцу виде: `YYYYMMDD HHMM`, местное. */
function stampOf(generatedAt: string | undefined): string {
  const when = generatedAt === undefined ? new Date(0) : new Date(generatedAt);
  const local = new Date(when.getTime() + TIME_ZONE_OFFSET_MINUTES * 60_000);
  const two = (value: number) => String(value).padStart(2, "0");
  return (
    `${local.getUTCFullYear()}${two(local.getUTCMonth() + 1)}${two(local.getUTCDate())} ` +
    `${two(local.getUTCHours())}${two(local.getUTCMinutes())}`
  );
}
