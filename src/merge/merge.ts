/**
 * Слияние: чистая функция от трёх зон.
 *
 * **Самая опасная часть замысла — и потому чистая функция.** Ни файловой
 * системы, ни `vault`, ни `adapter`, ни времени, ни настроек: на входе строка
 * заметки, отрисованная секция и память о прошлом проходе, на выходе строка и
 * отчёт. Всё поведение проверяется обычными тестами; то, что так проверить
 * нельзя, обязано жить в другом месте — запись в задаче 14, живое хранилище в
 * шве задачи 13.
 *
 * **Отказы вместо угадывания.** Каждый отказ возвращает исходный текст байт в
 * байт и говорит словами, что случилось:
 *
 * - `no-snapshot` — снимка нет вовсе. Приложение сюда ещё не писало, трогать
 *   заметки нельзя. Пустой снимок — не то же самое: он значит «книг с
 *   выписками нет», и это уже повод стереть секцию (с подтверждением).
 * - `markers-broken` — пара маркеров сломана, границы зоны машины не видно.
 * - `section-missing` — маркеров нет вовсе. Секцию **не воссоздаём молча**:
 *   дописать 81 цитату в конец заметки, которую человек только что вычистил, —
 *   грубость, а не синхронизация. Одно уведомление и ожидание команды;
 *   команда приходит признаком `mayCreateSection`.
 * - `too-many-removals` — предохранитель: проход убирает больше пятой части
 *   прежних блоков или больше двадцати штук. Отчёт при этом заполнен: человеку
 *   показывается, что именно собирались убрать.
 *
 * **Байты не изменились — не писать.** Признак `changed` считается здесь, а не
 * у того, кто пишет: запись ради тех же байтов трогает время изменения файла и
 * будит чужую синхронизацию хранилища на пустом месте.
 *
 * **Чего эта функция не делает и делать не должна.** Не решает, открыта ли
 * заметка с несохранёнными правками, — это `writeVerdict` из
 * `src/write/gate.ts`, и звать его обязан тот, кто пишет, дважды: до записи и
 * внутри обработчика `vault.process`. Не делает запасную копию — это
 * `src/write/backup.ts`, и она тоже на стороне записи. Не ищет, куда уехал
 * якорь из соседней заметки: слияние видит один файл, а не хранилище.
 */

import { SECTION_BEGIN, SECTION_END } from "../render/section";
import { applyFrontmatter, type FrontmatterPatch } from "./frontmatter";
import {
  fuse,
  splitInner,
  type InnerSplit,
  type KnownSection,
  type MergeConflict,
} from "./fuse";
import { anchorsIn, splitFile } from "./zones";

export type { KnownSection, MergeConflict } from "./fuse";
export { WARNING_HEAD } from "./fuse";

/** Почему проход отказался от файла. */
export type MergeRefusal = "no-snapshot" | "markers-broken" | "section-missing" | "too-many-removals";

/** Что подкрутить снаружи. Всё остальное — не настройка. */
export interface MergeOptions {
  /**
   * Разрешено ли завести секцию в заметке, где её нет.
   *
   * По умолчанию — нет, и это главное правило этой пары. Признак ставит
   * человек: привязкой книги к заметке (задача 12) или командой после
   * уведомления «маркеры стёрты».
   */
  readonly mayCreateSection?: boolean;
  /** Наши ключи frontmatter. Пусто — блок не трогаем вовсе. */
  readonly frontmatter?: FrontmatterPatch;
  /** Подтверждение человека на снятие предохранителя. */
  readonly allowRemovals?: boolean;
  /** Доля прежних блоков, выше которой проход останавливается. */
  readonly removalShare?: number;
  /** Число блоков, выше которого проход останавливается. */
  readonly removalCount?: number;
}

/** Доля и число из плана: больше пятой части ИЛИ больше двадцати штук. */
export const DEFAULT_REMOVAL_SHARE = 0.2;
export const DEFAULT_REMOVAL_COUNT = 20;

export interface MergeResult {
  /** Что записать. При любом отказе — исходный текст, байт в байт. */
  readonly text: string;
  /** Отличается ли от исходного. Равно — не писать. */
  readonly changed: boolean;
  readonly conflicts: readonly MergeConflict[];
  /** Якоря, убранные проходом (или те, что проход отказался убирать). */
  readonly removed: readonly string[];
  /** Якоря, найденные в зоне человека: цитата унесена в его текст. */
  readonly withdrawn: readonly string[];
  /** Якоря, удалённые человеком: не воскрешаем. */
  readonly deleted: readonly string[];
  readonly refused: MergeRefusal | undefined;
  /** Слова для человека при отказе. */
  readonly message: string | undefined;
  /** Что запомнить, если запись состоится. */
  readonly known: KnownSection;
}

/**
 * Сливает заметку с отрисованной секцией.
 *
 * `rendered` — вывод `renderSection`/`wrapSection` задачи 10 целиком, вместе с
 * маркерами. `undefined` значит «снимка нет»: это не то же самое, что пустая
 * секция, и разница здесь та же, что между `absent` и пустым снимком в
 * `snapshot/model.ts`.
 */
export function merge(
  fileText: string,
  rendered: string | undefined,
  known: KnownSection,
  options: MergeOptions = {},
): MergeResult {
  if (rendered === undefined) {
    return refusal(fileText, known, "no-snapshot", REFUSAL_WORDS["no-snapshot"]);
  }

  const zones = splitFile(fileText);
  if (zones.kind === "broken") {
    return refusal(fileText, known, "markers-broken", zones.message);
  }

  const renderedInner = splitInner(innerOf(rendered));

  if (zones.kind === "no-section") {
    if (options.mayCreateSection !== true) {
      return refusal(fileText, known, "section-missing", REFUSAL_WORDS["section-missing"]);
    }
    return create(fileText, zones.frontmatterLines, zones.bodyLines, renderedInner, options);
  }

  const previousInner = splitInner(zones.innerLines);
  const fused = fuse({
    previous: previousInner,
    rendered: renderedInner,
    known,
    outside: anchorsIn([...zones.beforeLines, ...zones.afterLines]),
  });

  if (tripsSafety(fused.removed.length, fused.previousCount, options)) {
    return {
      text: fileText,
      changed: false,
      conflicts: fused.conflicts,
      removed: fused.removed,
      withdrawn: fused.withdrawn,
      deleted: fused.deleted,
      refused: "too-many-removals",
      message:
        `Этот проход убрал бы ${fused.removed.length} ${plural(fused.removed.length)} из ` +
        `${fused.previousCount}. Так бывает, когда указатель Beresta прочитан наполовину ` +
        "или снимок приехал с другой машины, — поэтому Beresta остановилась и ничего не " +
        "записала. Посмотрите список и подтвердите, если всё верно.",
      known,
    };
  }

  const sectionChanged =
    zones.innerLines.length !== fused.inner.length ||
    zones.innerLines.some((line, index) => line !== fused.inner[index]);

  const frontmatter = frontmatterFor(zones.frontmatterLines, options, sectionChanged);
  const text = zones.assemble(fused.inner, frontmatter);

  return {
    text,
    changed: text !== fileText,
    conflicts: fused.conflicts,
    removed: fused.removed,
    withdrawn: fused.withdrawn,
    deleted: fused.deleted,
    refused: undefined,
    message: undefined,
    known: text === fileText ? known : fused.known,
  };
}

// MARK: - Внутреннее

const REFUSAL_WORDS: Readonly<Record<"no-snapshot" | "section-missing", string>> = {
  "no-snapshot":
    "Выгрузки Beresta в этом хранилище ещё нет: приложение сюда ни разу не писало. " +
    "Заметки не трогаем.",
  "section-missing":
    "В этой заметке нет секции Beresta — ни открывающего маркера, ни закрывающего. " +
    "Сама Beresta её не заводит: если вы убрали секцию нарочно, возвращать её без " +
    "спроса значит спорить с вами. Скажите «Вернуть секцию Beresta», и она появится " +
    "в конце заметки.",
};

function refusal(
  fileText: string,
  known: KnownSection,
  refused: MergeRefusal,
  message: string,
): MergeResult {
  return {
    text: fileText,
    changed: false,
    conflicts: [],
    removed: [],
    withdrawn: [],
    deleted: [],
    refused,
    message,
    known,
  };
}

/**
 * Заводит секцию в конце заметки — по команде и только по ней.
 *
 * Байты человека остаются началом файла: секция дописывается, ничего не
 * удаляется и не переставляется. Перевод строки перед секцией добавляется
 * только тот, которого не хватает.
 *
 * **Память при этом берётся ПУСТАЯ, а вот зона человека читается.** Пустая
 * память — потому что команда «верните секцию» и есть согласие человека
 * получить её заново; помни мы прежние удаления, команда вернула бы пустую
 * секцию и выглядела бы сломанной. Зона человека — потому что якорь, унесённый
 * в его текст, остаётся унесённым: вернуть цитату в секцию рядом с его копией
 * значит сделать два блока с одним адресом, а адрес блока обязан быть один.
 */
function create(
  fileText: string,
  frontmatterLines: readonly string[],
  bodyLines: readonly string[],
  renderedInner: InnerSplit,
  options: MergeOptions,
): MergeResult {
  const fused = fuse({
    previous: { head: [], blocks: [], tail: [] },
    rendered: renderedInner,
    known: { blocks: {} },
    outside: anchorsIn(bodyLines),
  });

  const body = bodyLines.join("\n");
  const separator = body === "" ? "" : body.endsWith("\n") ? "\n" : "\n\n";
  const section = [SECTION_BEGIN, ...fused.inner, SECTION_END].join("\n");
  const frontmatter = frontmatterFor(frontmatterLines, options, true);
  const text = [...frontmatter, ...`${body}${separator}${section}\n`.split("\n")].join("\n");

  return {
    text,
    changed: text !== fileText,
    conflicts: fused.conflicts,
    removed: [],
    withdrawn: fused.withdrawn,
    deleted: [],
    refused: undefined,
    message: undefined,
    known: fused.known,
  };
}

/**
 * Отметка о времени ставится только когда секция изменилась.
 *
 * Иначе опрос задачи 14 (раз в пять секунд при фокусе окна) переписывал бы
 * каждую привязанную заметку каждый проход — то есть ровно то, что запрещает
 * правило «байты не изменились — не писать», только через frontmatter. Смысл
 * ключа от этого не страдает: он отвечает не «когда мы заглядывали», а «на
 * какой момент данные в этой заметке».
 */
function frontmatterFor(
  lines: readonly string[],
  options: MergeOptions,
  sectionChanged: boolean,
): string[] {
  const patch = options.frontmatter;
  if (patch === undefined) return [...lines];
  const applied: FrontmatterPatch = {
    bookIds: patch.bookIds,
    lastSync: sectionChanged ? patch.lastSync : undefined,
  };
  return applyFrontmatter(lines, applied);
}

function tripsSafety(removed: number, previousCount: number, options: MergeOptions): boolean {
  if (removed === 0) return false;
  if (options.allowRemovals === true) return false;
  const share = options.removalShare ?? DEFAULT_REMOVAL_SHARE;
  const count = options.removalCount ?? DEFAULT_REMOVAL_COUNT;
  return removed > previousCount * share || removed > count;
}

/** Середина отрисованной секции — без строк маркеров. */
function innerOf(rendered: string): string[] {
  const zones = splitFile(rendered);
  if (zones.kind === "section") return [...zones.innerLines];
  // Отрисовка без пары маркеров сюда не доедет (задача 10 такую отвергает), но
  // если доедет — считаем, что рисовать нечего, а не выдумываем границы.
  return [];
}

function plural(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return "блоков";
  if (ones === 1) return "блок";
  if (ones >= 2 && ones <= 4) return "блока";
  return "блоков";
}

