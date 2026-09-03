/**
 * Проход синка: снимок → отрисовка → слияние → предохранитель → запасная копия
 * → запись.
 *
 * **До этого файла порядка не существовало нигде.** Задачи 9–12 сделали кубики
 * — разбор снимка, отрисовку, слияние, привязку, запасную копию, решение по
 * несохранённым правкам, — и каждый закрыт своими проверками. Складывал их в
 * ряд только шов 2 (задача 13), внутри собственного стенда: до задачи 14 в
 * `src/` этого не было вовсе. Теперь порядок здесь, а шов складывает те же
 * кубики через этот же вызов — иначе он проверял бы порядок, которого нет в
 * плагине.
 *
 * **Файловая система приходит портом.** Ни `vault`, ни `adapter`, ни часов
 * внутри: `NoteStore` — четыре действия, `BackupStore` — три, время входом.
 * Поэтому проход целиком проверяется обычными тестами, а живой Obsidian
 * остаётся швом, а не обязательным условием проверки.
 *
 * **Порядок шагов — не вкусовщина, каждый на своём месте по причине.**
 *
 * 1. Отрисовка до слияния: если шаблон негоден, писать нечего вовсе, и лучше
 *    узнать это до того, как тронули файл.
 * 2. Слияние до предохранителя: предохранителю нужен ТЕКСТ ДИСКА, а не то, что
 *    мы собираемся записать.
 * 3. Предохранитель до запасной копии: откладывать надо молча и дёшево, а не
 *    оставляя за собой копию, которую никто не просил.
 * 4. Запасная копия до записи. Обратный порядок — копия того, что мы уже
 *    испортили.
 * 5. Запись под замком (`process`), и внутри — предохранитель ВТОРОЙ раз, уже
 *    с текстом диска на руках.
 */

import { merge, type MergeConflict, type MergeOptions, type MergeRefusal } from "../merge/merge";
import type { KnownSection } from "../merge/fuse";
import { anchorsIn, splitFile } from "../merge/zones";
import { DEFAULT_TEMPLATE } from "../render/defaults";
import { renderBookBody, wrapSection } from "../render/section";
import type { Snapshot, SnapshotBook } from "../snapshot/model";
import { fileStamp, stampOf } from "../status";
import { rememberBefore, type BackupStore } from "../write/backup";
import { writeVerdict } from "../write/gate";

/**
 * Заметки хранилища — ровно столько действий, сколько нужно проходу.
 *
 * Обхода папок здесь нет и не будет: что с чем связано, знает frontmatter
 * (`beresta-book-id`), а не раскладка файлов, — заметку можно переименовать и
 * переложить, и привязка это переживёт.
 */
export interface NoteStore {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  create(path: string, text: string): Promise<void>;
  /**
   * Правка под замком: обработчику даётся текст С ДИСКА, его ответ уходит на
   * диск. У Obsidian это `vault.process`, и замер задачи 2 показал главное про
   * него: обработчик получает диск, а не то, что человек видит на экране.
   */
  process(path: string, revise: (onDisk: string) => string): Promise<void>;
  /** Текст в редакторе, если заметка открыта хоть в одной вкладке. */
  editorText(path: string): string | undefined;
}

/** Что плагин записал в заметку последним. Живёт в `data.json`. */
export interface SyncMemory {
  get(path: string): KnownSection | undefined;
  set(path: string, known: KnownSection): void;
}

export interface PassSettings {
  readonly timeZoneOffsetMinutes: number;
  readonly keepBackups: number;
  readonly removalShare: number;
  readonly removalCount: number;
  readonly template?: string;
}

/** Почему проход отказался от файла. */
export type PassRefusal = MergeRefusal | "render-failed";

export interface Refusal {
  readonly path: string;
  readonly refused: PassRefusal;
  readonly message: string;
}

export interface SyncInput {
  readonly snapshot: Snapshot;
  /** Путь заметки → идентификаторы книг в ней. */
  readonly bindings: ReadonlyMap<string, readonly string[]>;
  readonly notes: NoteStore;
  readonly backups: BackupStore;
  readonly memory: SyncMemory;
  readonly settings: PassSettings;
  /** Когда идёт проход, мс. Нужно только для имени запасной копии. */
  readonly now: number;
  /** Заметки, которых ещё нет и которые владелец велел завести. */
  readonly creating?: ReadonlySet<string>;
  /** Заметки, в которых разрешено завести секцию заново. */
  readonly mayCreateSection?: ReadonlySet<string>;
  /** Заметки, по которым владелец подтвердил снятие предохранителя. */
  readonly allowRemovals?: ReadonlySet<string>;
  /** Сверить только эти заметки. Пусто — все привязанные. */
  readonly only?: ReadonlySet<string>;
}

export interface SyncReport {
  /** На какой момент данные разложенного снимка, `YYYYMMDD HHMM`. */
  readonly stamp: string;
  /**
   * Заметки, которые проход смотрел.
   *
   * Не то же самое, что записанные: заметку могли посмотреть и не тронуть.
   * Нужно панели расхождений — она заменяет записи только по тем заметкам, о
   * которых узнала что-то новое, а про остальные молчит (проход мог сверять
   * одну книгу).
   */
  readonly visited: string[];
  readonly written: string[];
  /**
   * Сколько выписок Beresta держит в заметке СЕЙЧАС: путь → число.
   *
   * Ключ появляется у каждой заметки, файл которой проход прочитал, — не только
   * у записанных. Записанная заметка отвечает по памяти о своей секции (это то,
   * что Beresta считает своим, и именно про это она вправе говорить); заметка,
   * которую проход посмотрел и не тронул, — по буквам файла, потому что ничего
   * другого про неё в этот заход не известно. Заметка без секции отвечает нулём,
   * и ноль здесь — ответ, а не отсутствие ответа.
   *
   * **Двух потребителей у этого поля два разных вопроса, и оба про правду.**
   * Ответ на нажатие («40 выписок легли в заметку») берёт отсюда записанные.
   * Подпись строки состояния («Заметок с выписками: N») складывает это число по
   * всему хранилищу и потому обязана получать его и от заметок, которых проход
   * не менял: до 20260818 она считала `visited.length` — «сколько заметок обошёл
   * последний проход», — и после точечного прохода застревала на единице, пока
   * человек не запускал команду руками (находка 5 прогона глазами).
   *
   * Заметки, файл которой проход не читал вовсе (её книги нет в снимке), в
   * отчёте нет: «не знаю» и «нисколько» — разные ответы, и складывать их в один
   * ноль значит соврать тем же способом, только тише.
   */
  readonly quotes: Record<string, number>;
  /** Отложено: заметка открыта с несохранёнными правками. */
  readonly deferred: string[];
  /** Привязанной заметки нет на месте. Заново не заводим — говорим. */
  readonly missing: string[];
  readonly refusals: Refusal[];
  readonly conflicts: Record<string, MergeConflict[]>;
  /** Якоря, убранные проходом: в приложении выписок больше нет. */
  readonly removed: Record<string, readonly string[]>;
  /** Якоря, удалённые человеком: не воскрешаем. */
  readonly deleted: Record<string, readonly string[]>;
  /** Заметка привязана к книге, которой в снимке нет. */
  readonly unknownBooks: Record<string, readonly string[]>;
}

/**
 * Раскладывает выписки снимка по привязанным заметкам.
 *
 * Снимок, которого нет, — не пустой снимок: заметки не трогаются вовсе, и
 * отчёт пуст. Разница та же, что в `snapshot/model.ts` между `absent` и
 * снимком без книг.
 */
export async function runSync(input: SyncInput): Promise<SyncReport> {
  const stamp = stampOf(
    input.snapshot.kind === "present" ? input.snapshot.header.generatedAt : undefined,
    input.settings.timeZoneOffsetMinutes,
  );
  const report: SyncReport = {
    stamp,
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
  };
  if (input.snapshot.kind !== "present") return report;

  const byUUID = new Map(input.snapshot.books.map((book) => [book.uuid, book]));
  const template = input.settings.template ?? DEFAULT_TEMPLATE;

  for (const [path, bookIds] of input.bindings) {
    if (input.only !== undefined && !input.only.has(path)) continue;
    report.visited.push(path);

    const books: SnapshotBook[] = [];
    const unknown: string[] = [];
    for (const id of bookIds) {
      const book = byUUID.get(id);
      if (book === undefined) unknown.push(id);
      else books.push(book);
    }
    if (unknown.length > 0) report.unknownBooks[path] = unknown;
    // Книг этой заметки в снимке нет ни одной. Не «нарисовать пустую секцию»:
    // пустая секция стёрла бы блоки, которых приложение сейчас просто не
    // называет, — а не называть их оно может и потому, что снимок собран с
    // другой машины.
    if (books.length === 0) continue;

    const exists = await input.notes.exists(path);
    if (!exists && input.creating?.has(path) !== true) {
      report.missing.push(path);
      continue;
    }
    const onDisk = exists ? await input.notes.read(path) : "";
    // Сколько выписок в заметке ДО прохода. Дальше это число уточнит запись,
    // а если записи не будет — оно и есть правда об этой заметке.
    report.quotes[path] = quotesInSection(onDisk);

    let rendered: string;
    try {
      rendered = wrapSection(
        books.map((book) =>
          renderBookBody(book, book.annotations, template, {
            timeZoneOffsetMinutes: input.settings.timeZoneOffsetMinutes,
          }),
        ),
      );
    } catch (error) {
      report.refusals.push({
        path,
        refused: "render-failed",
        message: `Секция для «${path}» не отрисовалась: ${(error as Error).message}`,
      });
      continue;
    }

    const known = input.memory.get(path) ?? { blocks: {} };
    const options: MergeOptions = {
      mayCreateSection: !exists || input.mayCreateSection?.has(path) === true,
      frontmatter: { bookIds: [...bookIds], lastSync: stamp },
      allowRemovals: input.allowRemovals?.has(path) === true,
      removalShare: input.settings.removalShare,
      removalCount: input.settings.removalCount,
    };

    const result = merge(onDisk, rendered, known, options);
    if (result.conflicts.length > 0) report.conflicts[path] = [...result.conflicts];
    if (result.removed.length > 0) report.removed[path] = result.removed;
    if (result.deleted.length > 0) report.deleted[path] = result.deleted;
    if (result.refused !== undefined) {
      report.refusals.push({
        path,
        refused: result.refused,
        message: result.message ?? "",
      });
      continue;
    }

    if (!result.changed) continue;

    const verdict = writeVerdict({ path, onDisk, inEditor: input.notes.editorText(path) });
    if (verdict.kind === "defer") {
      report.deferred.push(path);
      continue;
    }

    if (!exists) {
      await input.notes.create(path, result.text);
      input.memory.set(path, result.known);
      report.written.push(path);
      report.quotes[path] = Object.keys(result.known.blocks).length;
      continue;
    }

    await rememberBefore(input.backups, {
      path,
      text: onDisk,
      savedAt: stampOf(new Date(input.now).toISOString(), input.settings.timeZoneOffsetMinutes),
      stamp: fileStamp(input.now, input.settings.timeZoneOffsetMinutes),
      keep: input.settings.keepBackups,
    });

    let wrote: KnownSection | undefined;
    let deferredInside = false;
    await input.notes.process(path, (current) => {
      // Второй раз — здесь. Обработчик синхронный, JS однопоточен, и в этот
      // промежуток человек напечатать ничего не успевает: значит вопрос «нет
      // ли несохранённого» задаётся ровно тогда, когда ответ на него ещё
      // будет верен в момент записи.
      const second = writeVerdict({ path, onDisk: current, inEditor: input.notes.editorText(path) });
      if (second.kind === "defer") {
        deferredInside = true;
        return current;
      }
      if (current === onDisk) {
        wrote = result.known;
        return result.text;
      }
      // Файл изменился между чтением и записью — сливаем заново, уже с ним.
      const again = merge(current, rendered, known, options);
      if (again.refused !== undefined || !again.changed) return current;
      wrote = again.known;
      return again.text;
    });

    if (deferredInside) {
      report.deferred.push(path);
      continue;
    }
    if (wrote !== undefined) {
      input.memory.set(path, wrote);
      report.written.push(path);
      report.quotes[path] = Object.keys(wrote.blocks).length;
    }
  }

  return report;
}

/** Сколько расхождений в отчёте — одним числом для строки состояния. */
export function conflictCount(report: SyncReport): number {
  return Object.values(report.conflicts).reduce((sum, list) => sum + list.length, 0);
}

/**
 * Сколько выписок Beresta держит в этой заметке — по буквам файла.
 *
 * Считаются якоря внутри маркеров, и только внутри: якорь, унесённый человеком
 * в свой текст, — его цитата, а не наша выписка. Маркеров нет вовсе (человек
 * стёр секцию) — ноль, и это правда: сколько бы блоков мы ни помнили, в заметке
 * их сейчас нет.
 */
function quotesInSection(text: string): number {
  const zones = splitFile(text);
  return zones.kind === "section" ? anchorsIn(zones.innerLines).size : 0;
}
