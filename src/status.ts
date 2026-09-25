/**
 * Состояние словами: строка в углу окна и подпись к ней.
 *
 * **Молчаливое отставание — главный отказ опроса, и лечится оно видимостью.**
 * Плагин, который не заметил новых выписок, выглядит ровно как плагин, которому
 * нечего показать: заметки на месте, ошибок нет, всё спокойно. Разница
 * появляется только тогда, когда состояние названо вслух — «данные на 20260806
 * 21:14», а сегодня девятое. Поэтому строка состояния говорит НА КАКОЙ МОМЕНТ
 * данные, а не «синхронизировано» и не значок галочки.
 *
 * **Ни одного слова тревоги.** Расхождение — обычное дело: человек правит свои
 * заметки, приложение правит свои выписки, иногда они трогают одно и то же
 * место. Это не авария и не ошибка, и называть это ошибкой значит учить
 * человека бояться собственных правок. Поэтому здесь «две правки ваши» и
 * «жду, пока сохранится», а не «конфликт», «сбой» и «внимание».
 *
 * Ни `Date.now()`, ни часового пояса машины внутри: и время, и сдвиг приходят
 * входом. Поэтому все слова проверяются обычным тестом, а не подгонкой часов.
 */

import { interfaceLanguage } from "./render/defaults";
import type { SnapshotHealth } from "./settings";
import { counted, fill, panelWords, type PanelWords } from "./ui/words";

/** Что показывать. Собирается тем, кто гоняет проход. */
export interface StatusState {
  readonly snapshot: SnapshotHealth;
  /** На какой момент данные в заметках, `YYYYMMDD HHMM`. */
  readonly dataStamp: string | undefined;
  /** Расхождений накопилось. */
  readonly conflicts: number;
  /** Заметок отложено (открыты с несохранённым). */
  readonly deferred: number;
  /** Книг снимка не разобралось. */
  readonly problems: number;
  /**
   * Заметок, в которых СЕЙЧАС лежит секция Beresta.
   *
   * **Не «сколько заметок обошёл последний проход».** Именно этим числом поле
   * было до 20260818 (`lastReport.visited.length`), и прогон глазами поймал
   * ложь: после привязки второй книги подпись держала единицу, потому что
   * последний проход был точечный, и менялась на двойку только от ручного
   * запуска команды. Число, которое зависит от того, ЧЕМ был вызван последний
   * проход, не описывает хранилище.
   */
  readonly notesWithQuotes: number;
  /** Книг в выгрузке. */
  readonly books: number;
  /** Выписок в выгрузке — по всем её книгам. */
  readonly quotes: number;
  /**
   * Книг выгрузки, которым некуда лечь: ни одна заметка их не назвала.
   *
   * Считается по книгам, а не по признаку «есть ли хоть одна привязка». Разница
   * не теоретическая: у владельца одна книга привязана с первого дня, и правило
   * «подсказать, если привязок ноль» не сработает у него больше никогда — а
   * десять книг, приехавших через месяц, так и будут висеть молча.
   */
  readonly unbound: number;
  /** Когда смотрели на указатель, мс. */
  readonly lookedAt: number | undefined;
}

export const EMPTY_STATUS: StatusState = {
  snapshot: "неизвестно",
  dataStamp: undefined,
  conflicts: 0,
  deferred: 0,
  problems: 0,
  notesWithQuotes: 0,
  books: 0,
  quotes: 0,
  unbound: 0,
  lookedAt: undefined,
};

/**
 * Строка в углу окна — коротко и словами.
 *
 * Пример на живых данных: `Beresta: данные на 20260806 21:14 · 2 ваши правки`.
 */
export function statusLine(
  state: StatusState,
  words: PanelWords = panelWords(interfaceLanguage()),
): string {
  const say = words.status.line;
  const parts: string[] = [head(state, words)];
  if (state.conflicts > 0) parts.push(counted(words, state.conflicts, say.ownEdits));
  if (state.deferred > 0) parts.push(counted(words, state.deferred, say.waitingToSave));
  if (state.problems > 0) parts.push(counted(words, state.problems, say.booksStillArriving));
  return `Beresta: ${parts.join(" · ")}`;
}

/**
 * Подпись при наведении — то же самое, но с разбором.
 *
 * `now` нужен ровно для одной строки: сколько времени назад собран снимок.
 * Отставание — единственное, чего не видно из самой отметки, и именно оно
 * бывает молчаливым.
 */
export function statusHint(
  state: StatusState,
  now: number,
  offsetMinutes: number,
  words: PanelWords = panelWords(interfaceLanguage()),
): string[] {
  const say = words.status.hint;
  const lines: string[] = [];
  switch (state.snapshot) {
    case "нет":
      lines.push(say.noExport);
      break;
    case "не-читается":
      lines.push(say.unreadable);
      break;
    case "наполовину":
      lines.push(say.halfway);
      break;
    case "целый":
    case "неизвестно":
      break;
  }

  if (state.dataStamp !== undefined) {
    const stamp = state.dataStamp;
    lines.push(fill(say.dataAt, { stamp, age: age(stamp, now, offsetMinutes, words) }));
  }
  if (state.notesWithQuotes > 0) {
    lines.push(fill(say.notesWithQuotes, { count: state.notesWithQuotes }));
  }
  if (state.unbound > 0) lines.push(fill(say.unbound, { count: state.unbound }));
  if (state.conflicts > 0) lines.push(fill(say.ownEdits, { count: state.conflicts }));
  if (state.deferred > 0) lines.push(fill(say.deferred, { count: state.deferred }));
  return lines;
}

/**
 * Ответ на команду «Разложить выписки сейчас».
 *
 * **Команду нажимают именно потому, что не верят строке состояния.** Прогон
 * глазами 20260818, находка 4: команда отвечала строкой состояния СЛОВО В
 * СЛОВО — `Beresta: данные на 20260818 1047`, ровно то, что уже написано в
 * углу окна. Человек, нажавший её первой, решил, что плагин сломан; в
 * хранилище в это время лежали 291 выписка в 11 книгах, из которых не
 * разложена была ни одна.
 *
 * Отсюда два требования к этим словам, и оба про числа.
 *
 * **Первое: сказать, сколько данных есть и сколько из них доехало.** Отметка
 * времени не отвечает ни на один вопрос человека: она говорит, КОГДА собрана
 * выгрузка, а спрашивал он, ЧТО в ней и где оно теперь.
 *
 * **Второе: сказать, скольким книгам некуда лечь.** Прежняя подсказка «начните
 * с привязки» показывалась при `bound === 0` — то есть только человеку, у
 * которого не привязано вовсе ничего. У владельца одна книга привязана с
 * первого дня, значит на его хранилище это правило не сработает никогда: десять
 * книг, приехавших через месяц, повиснут молча. Считать надо книги, а не
 * наличие хоть одной привязки.
 *
 * **Бодрости здесь нет.** «Готово» там, где раскладывать было некуда, — хуже
 * тишины, потому что это неправда.
 */
export function syncNowWords(
  state: StatusState,
  words: PanelWords = panelWords(interfaceLanguage()),
): string {
  const say = words.status.syncNow;
  if (state.snapshot === "нет") return say.noExport;
  if (state.snapshot === "не-читается") return say.unreadable;
  if (state.books === 0) return say.noBooks;

  const lines: string[] = [
    fill(say.inExport, {
      books: counted(words, state.books, say.books),
      quotes: counted(words, state.quotes, say.quotes),
    }),
  ];

  if (state.notesWithQuotes === 0) {
    lines.push(say.noNotesYet);
  } else {
    lines.push(counted(words, state.notesWithQuotes, say.quotesLieIn));
  }

  if (state.unbound === state.books) {
    lines.push(say.nothingBound);
  } else if (state.unbound > 0) {
    lines.push(counted(words, state.unbound, say.stillUnbound));
  }

  if (state.problems > 0) lines.push(counted(words, state.problems, say.halfway));
  if (state.deferred > 0) lines.push(counted(words, state.deferred, say.deferred));
  return lines.join("\n");
}

/**
 * Момент данных в привычном владельцу виде: `YYYYMMDD HHMM`, местное время.
 *
 * Формат его собственный и сквозной: так записаны `date: 20221025 1047` в его
 * frontmatter и так же выглядит `beresta-last-sync`. Дата с дефисами была бы
 * здесь чужой строкой в его же заметке.
 */
export function stampOf(generatedAt: string | undefined, offsetMinutes: number): string {
  return format(atMillis(generatedAt), offsetMinutes, " ", false);
}

/** Метка для имени файла запасной копии: `YYYYMMDD-HHMMSS`. */
export function fileStamp(atMs: number, offsetMinutes: number): string {
  return format(atMs, offsetMinutes, "-", true);
}

// MARK: - Внутреннее

function head(state: StatusState, words: PanelWords): string {
  const say = words.status.head;
  const stamp = state.dataStamp;
  switch (state.snapshot) {
    case "нет":
      return say.noExport;
    case "не-читается":
      return say.unreadable;
    case "неизвестно":
      return stamp === undefined ? say.looking : fill(say.dataAt, { stamp });
    case "наполовину":
      return stamp === undefined ? say.stillArriving : fill(say.dataAtStillArriving, { stamp });
    case "целый":
      return stamp === undefined ? say.noQuotes : fill(say.dataAt, { stamp });
  }
}

/**
 * Сколько прошло — словами и только когда это уже заметно.
 *
 * Меньше суток — молчим: «данные на сегодня, 40 минут назад» не говорит
 * человеку ничего, чего он не знает. Больше — называем дни: именно так
 * выглядит отставание, о котором иначе никто не узнает.
 */
function age(stamp: string, now: number, offsetMinutes: number, words: PanelWords): string {
  const today = format(now, offsetMinutes, " ", false);
  const days = daysBetween(stamp, today);
  if (days === undefined || days < 1) return "";
  return counted(words, days, words.status.hint.daysAgo);
}

function daysBetween(from: string, to: string): number | undefined {
  const one = dayNumber(from);
  const two = dayNumber(to);
  if (one === undefined || two === undefined) return undefined;
  return Math.round((two - one) / 86_400_000);
}

function dayNumber(stamp: string): number | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(stamp);
  if (match === null) return undefined;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function atMillis(generatedAt: string | undefined): number {
  if (generatedAt === undefined) return 0;
  const at = new Date(generatedAt).getTime();
  return Number.isNaN(at) ? 0 : at;
}

function format(atMs: number, offsetMinutes: number, gap: string, seconds: boolean): string {
  const local = new Date(atMs + offsetMinutes * 60_000);
  const two = (value: number) => String(value).padStart(2, "0");
  const day = `${local.getUTCFullYear()}${two(local.getUTCMonth() + 1)}${two(local.getUTCDate())}`;
  const time = `${two(local.getUTCHours())}${two(local.getUTCMinutes())}`;
  return `${day}${gap}${time}${seconds ? two(local.getUTCSeconds()) : ""}`;
}
