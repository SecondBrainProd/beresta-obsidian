/**
 * Опрос указателя: когда плагин смотрит на снимок и по чему решает, что тот
 * изменился.
 *
 * **Почему опрос, а не событие.** Замер задачи 2 (`docs/plans/notes/
 * 20260812-замер-obsidian.md`): по скрытой папке `.beresta/` штатные события
 * хранилища (`create`, `modify`, `delete`, `metadataCache.on('changed')`)
 * молчат все до одного, а адаптер работает полностью. Событие `raw` по такой
 * папке приходит за 12–64 мс — но его **нет в `obsidian.d.ts`**, то есть
 * обещания поддержки на него никто не давал, и своя же запись через адаптер
 * порождает его дважды. Значит опрос — основной путь; `raw`, если его когда-то
 * объявят, станет ускорителем поверх, а не заменой.
 *
 * **Истина — отпечаток, время изменения только подсказка.** Поверх хранилища
 * работает чужая синхронизация (iCloud, Obsidian Sync, Dropbox): она трогает
 * файлы, не меняя байтов, и двигает время в обе стороны — вперёд при доставке,
 * назад при разрешении конфликта копий и после перевода часов. Правило «время
 * новее — значит новые данные» ошибается на таком хранилище дважды и
 * по-разному:
 *
 * - **пропускает настоящие изменения**, когда время уехало назад, — это
 *   молчаливое отставание, главный отказ всего подхода;
 * - **затевает проход на ровном месте**, когда время дёрнулось, а байты те
 *   же, — это переписанные заметки и разбуженная чужая синхронизация каждые
 *   пять секунд.
 *
 * Поэтому подсказка решает ровно один вопрос — стоит ли ЧИТАТЬ указатель, — а
 * «работать или нет» решает только `sha256` его байтов. Одного отпечатка
 * хватает: указатель несёт `sha256` каждого осколка, значит меняется от любой
 * перемены в снимке.
 *
 * **Недосинхронизированный снимок перечитывается по тем же байтам.** Указатель
 * доехал, осколок ещё нет — обычное дело посреди чужой синхронизации. Указатель
 * при этом больше не изменится: приложение его не трогало. Помни мы только
 * отпечаток — книга, чей осколок опоздал, не приехала бы никогда. Поэтому в
 * памяти есть и признак `whole`: снимок разложен целиком или ещё нет.
 */

import { readSnapshot, type Snapshot, type SnapshotSource } from "./snapshot";
import { indexPath } from "./snapshot/paths";
import { sha256Hex } from "./snapshot/sha256";

/** Что адаптер Obsidian рассказывает о файле. Только подсказка, не истина. */
export interface FileHint {
  readonly mtime: number;
  readonly size: number;
}

/**
 * Источник снимка, умеющий ещё и подсказку.
 *
 * `stat` возвращает `undefined` и когда файла нет, и когда сказать нечего.
 * Разница между этими случаями нам не нужна: оба означают «дешёвым путём не
 * пойдём», а есть ли снимок — спрашивается `exists`, у которого ответ
 * однозначный.
 */
export interface WatchSource extends SnapshotSource {
  stat(path: string): Promise<FileHint | undefined>;
}

/** Зачем смотрим. От этого зависит только право на дешёвый путь. */
export type LookReason = "загрузка" | "опрос" | "команда" | "заметка";

export type LookKind = "снимка-нет" | "те-же-данные" | "новые-данные" | "не-читается";

/** Что плагин помнит об указателе между взглядами и между запусками. */
export interface WatchMemory {
  /** `sha256` байтов указателя, разложенного последним. */
  readonly hash: string | undefined;
  /** Подсказка того же файла в тот момент. */
  readonly hint: FileHint | undefined;
  /**
   * Разложен ли снимок этих байтов целиком.
   *
   * `false` — что-то не сошлось (осколок не доехал, отпечаток не сошёлся), и
   * те же байты надо перечитать при следующем взгляде: недостающее приезжает
   * само, не трогая указателя.
   */
  readonly whole: boolean;
}

export const EMPTY_WATCH_MEMORY: WatchMemory = {
  hash: undefined,
  hint: undefined,
  whole: false,
};

export interface Look {
  readonly kind: LookKind;
  /** Отпечаток указателя, если его читали. */
  readonly hash: string | undefined;
  /** Снимок — только при `новые-данные`. */
  readonly snapshot: Snapshot | undefined;
  /** Слова человеку — только при `не-читается`. */
  readonly message: string | undefined;
  /** Читали ли байты указателя. Нет — прошли дешёвым путём по подсказке. */
  readonly readIndex: boolean;
  /** Что помнить дальше. */
  readonly memory: WatchMemory;
}

/**
 * Смотрит на указатель.
 *
 * Дешёвый путь (не читать вовсе) разрешён **только самостоятельному опросу** и
 * только когда прошлый снимок разложен целиком. Человек, нажавший команду,
 * получает настоящее чтение: он нажал ровно потому, что не верит тому, что
 * видит, и ответить ему подсказкой файловой системы значит не ответить.
 */
export async function lookAtSnapshot(
  source: WatchSource,
  memory: WatchMemory,
  reason: LookReason,
): Promise<Look> {
  const path = indexPath();
  const hint = await source.stat(path);

  if (
    reason === "опрос" &&
    memory.whole &&
    memory.hash !== undefined &&
    hint !== undefined &&
    memory.hint !== undefined &&
    hint.mtime === memory.hint.mtime &&
    hint.size === memory.hint.size
  ) {
    return {
      kind: "те-же-данные",
      hash: memory.hash,
      snapshot: undefined,
      message: undefined,
      readIndex: false,
      memory,
    };
  }

  if (!(await source.exists(path))) {
    return {
      kind: "снимка-нет",
      hash: undefined,
      snapshot: undefined,
      message: undefined,
      readIndex: false,
      // Память сбрасывается: снимок, который появится, обязан приехать в
      // заметки, даже если его отпечаток совпадёт с тем, что был до удаления.
      memory: { hash: undefined, hint: undefined, whole: false },
    };
  }

  const bytes = new Uint8Array(await source.readBinary(path));
  const hash = sha256Hex(bytes);

  if (hash === memory.hash && memory.whole) {
    return {
      kind: "те-же-данные",
      hash,
      snapshot: undefined,
      message: undefined,
      readIndex: true,
      memory: { hash, hint, whole: true },
    };
  }

  let snapshot: Snapshot;
  try {
    snapshot = await readSnapshot(withIndexBytes(source, path, bytes));
  } catch (error) {
    return {
      kind: "не-читается",
      hash,
      snapshot: undefined,
      message: (error as Error).message,
      readIndex: true,
      // `whole: true` нарочно: сам по себе указатель не починится, и повторять
      // разбор (и уведомление) каждые пять секунд по тем же байтам — способ
      // приучить человека закрывать сообщения не читая. Изменятся байты —
      // прочитаем заново.
      memory: { hash, hint, whole: true },
    };
  }

  return {
    kind: "новые-данные",
    hash,
    snapshot,
    message: undefined,
    readIndex: true,
    memory: {
      hash,
      hint,
      whole: snapshot.kind === "present" && snapshot.problems.length === 0,
    },
  };
}

/**
 * Тот же источник, но байты указателя уже на руках.
 *
 * Иначе `readSnapshot` прочитал бы файл во второй раз за один взгляд: отпечаток
 * считается по байтам, и разбирать надо ровно те байты, у которых он посчитан.
 * Прочитай мы файл дважды — между чтениями поместилась бы чужая
 * синхронизация, и отпечаток в памяти оказался бы от одного содержимого, а
 * разложенный снимок от другого.
 */
function withIndexBytes(source: SnapshotSource, path: string, bytes: Uint8Array): SnapshotSource {
  return {
    exists: (at) => source.exists(at),
    readBinary: async (at) => {
      if (at !== path) return await source.readBinary(at);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
  };
}

/** Раз в пять секунд при фокусе окна. */
export const FOCUSED_INTERVAL_MS = 5_000;

/** И раз в минуту без него. */
export const UNFOCUSED_INTERVAL_MS = 60_000;

/**
 * Когда пора смотреть.
 *
 * Отдельно от самого взгляда и без единого таймера внутри: время приходит
 * снаружи, поэтому расписание проверяется обычным тестом, а не секундомером.
 * Таймер заводит точка входа — один на плагин, через `registerInterval`, чтобы
 * Obsidian снял его при выключении плагина.
 *
 * **Возвращение фокуса — повод посмотреть немедленно.** Человек вернулся в
 * окно и читает заметку прямо сейчас; строка «данные на 20260806 21:14»
 * обязана быть правдой к моменту, когда он на неё посмотрит, а не через
 * минуту.
 */
export class PollSchedule {
  private lastAt: number | undefined;
  private wasFocused: boolean | undefined;

  constructor(
    private readonly focusedMs: number = FOCUSED_INTERVAL_MS,
    private readonly unfocusedMs: number = UNFOCUSED_INTERVAL_MS,
  ) {}

  due(now: number, focused: boolean): boolean {
    const returned = focused && this.wasFocused === false;
    this.wasFocused = focused;
    if (this.lastAt === undefined || returned) {
      this.lastAt = now;
      return true;
    }
    if (now - this.lastAt < (focused ? this.focusedMs : this.unfocusedMs)) return false;
    this.lastAt = now;
    return true;
  }
}
