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

import type { SnapshotHealth } from "./settings";

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
export function statusLine(state: StatusState): string {
  const parts: string[] = [head(state)];
  if (state.conflicts > 0) parts.push(`${state.conflicts} ${own(state.conflicts)}`);
  if (state.deferred > 0) parts.push(`${state.deferred} ${waiting(state.deferred)} сохранения`);
  if (state.problems > 0) parts.push(`${state.problems} ${books(state.problems)} ещё едет`);
  return `Beresta: ${parts.join(" · ")}`;
}

/**
 * Подпись при наведении — то же самое, но с разбором.
 *
 * `now` нужен ровно для одной строки: сколько времени назад собран снимок.
 * Отставание — единственное, чего не видно из самой отметки, и именно оно
 * бывает молчаливым.
 */
export function statusHint(state: StatusState, now: number, offsetMinutes: number): string[] {
  const lines: string[] = [];
  switch (state.snapshot) {
    case "нет":
      lines.push(
        "Выгрузки Beresta в этом хранилище ещё нет. Приложение пишет её само; " +
          "заметки до тех пор не трогаются.",
      );
      break;
    case "не-читается":
      lines.push(
        "Указатель выгрузки не разбирается. Заметки не трогаются, пока он не " +
          "станет читаемым — обычно это лечится следующей выгрузкой из приложения.",
      );
      break;
    case "наполовину":
      lines.push(
        "Выгрузка доехала не целиком — так выглядит хранилище посреди " +
          "синхронизации. Плагин смотрит снова и доложит книги, как только они " +
          "появятся.",
      );
      break;
    case "целый":
    case "неизвестно":
      break;
  }

  if (state.dataStamp !== undefined) {
    lines.push(`Данные на ${state.dataStamp}${age(state.dataStamp, now, offsetMinutes)}.`);
  }
  if (state.notesWithQuotes > 0) {
    lines.push(`Заметок с выписками: ${state.notesWithQuotes}.`);
  }
  if (state.unbound > 0) {
    lines.push(
      `Книг без заметки: ${state.unbound}. Им некуда лечь — команда «Привязать книги ` +
        "к заметкам».",
    );
  }
  if (state.conflicts > 0) {
    lines.push(
      `Ваших правок в секции: ${state.conflicts}. Эти блоки заморожены и остаются ` +
        "вашими; список — команда «Показать расхождения Beresta».",
    );
  }
  if (state.deferred > 0) {
    lines.push(
      `Ждут сохранения: ${state.deferred}. Заметка открыта с несохранёнными правками — ` +
        "запись видит файл на диске, а не то, что у вас на экране.",
    );
  }
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
export function syncNowWords(state: StatusState): string {
  if (state.snapshot === "нет") {
    return (
      "Beresta: выгрузки Beresta в этом хранилище нет — раскладывать нечего. " +
      "Приложение пишет её само; заметки до тех пор не трогаются."
    );
  }
  if (state.snapshot === "не-читается") {
    return (
      "Beresta: указатель выгрузки не разбирается — заметки не тронуты. " +
      "Обычно это лечится следующей выгрузкой из приложения."
    );
  }
  if (state.books === 0) {
    return "Beresta: в выгрузке нет ни одной книги с выписками — раскладывать нечего.";
  }

  const lines: string[] = [
    `Beresta: в выгрузке ${state.books} ${books(state.books)}, ` +
      `${state.quotes} ${quotes(state.quotes)}.`,
  ];

  if (state.notesWithQuotes === 0) {
    lines.push("Ни в одной заметке выписок Beresta пока нет.");
  } else {
    lines.push(
      `Выписки лежат в ${state.notesWithQuotes} ${notesWord(state.notesWithQuotes)}.`,
    );
  }

  if (state.unbound === state.books) {
    lines.push(
      "Ни одна книга не привязана к заметке — раскладывать некуда. " +
        "Начните с команды «Привязать книги к заметкам».",
    );
  } else if (state.unbound > 0) {
    lines.push(
      `Ещё ${state.unbound} ${booksDative(state.unbound)} некуда лечь — ` +
        "команда «Привязать книги к заметкам».",
    );
  }

  if (state.problems > 0) {
    lines.push(
      `Выгрузка доехала не целиком: ${state.problems} ${books(state.problems)} ещё едет.`,
    );
  }
  if (state.deferred > 0) {
    lines.push(
      `${state.deferred} ${waiting(state.deferred)} сохранения: заметка открыта с ` +
        "несохранёнными правками, выписки приедут, как только вы сохраните.",
    );
  }
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

function head(state: StatusState): string {
  switch (state.snapshot) {
    case "нет":
      return "выгрузки ещё нет";
    case "не-читается":
      return "указатель не читается";
    case "неизвестно":
      return state.dataStamp === undefined ? "смотрю" : `данные на ${state.dataStamp}`;
    case "наполовину":
      return state.dataStamp === undefined
        ? "выгрузка ещё едет"
        : `данные на ${state.dataStamp}, выгрузка ещё едет`;
    case "целый":
      return state.dataStamp === undefined ? "выписок нет" : `данные на ${state.dataStamp}`;
  }
}

/**
 * Сколько прошло — словами и только когда это уже заметно.
 *
 * Меньше суток — молчим: «данные на сегодня, 40 минут назад» не говорит
 * человеку ничего, чего он не знает. Больше — называем дни: именно так
 * выглядит отставание, о котором иначе никто не узнает.
 */
function age(stamp: string, now: number, offsetMinutes: number): string {
  const today = format(now, offsetMinutes, " ", false);
  const days = daysBetween(stamp, today);
  if (days === undefined || days < 1) return "";
  return ` — это ${days} ${dayWord(days)} назад`;
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

function own(count: number): string {
  return `${plural(count, "ваша", "ваши", "ваших")} ${plural(count, "правка", "правки", "правок")}`;
}

function waiting(count: number): string {
  return plural(count, "заметка ждёт", "заметки ждут", "заметок ждут");
}

function books(count: number): string {
  return plural(count, "книга", "книги", "книг");
}

/** «1 книге некуда лечь», «9 книгам некуда лечь». */
function booksDative(count: number): string {
  return plural(count, "книге", "книгам", "книгам");
}

function quotes(count: number): string {
  return plural(count, "выписка", "выписки", "выписок");
}

function notesWord(count: number): string {
  return plural(count, "заметке", "заметках", "заметках");
}

function dayWord(count: number): string {
  return plural(count, "день", "дня", "дней");
}

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  if (tens >= 11 && tens <= 14) return many;
  const ones = count % 10;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}
