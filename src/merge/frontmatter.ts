/**
 * Frontmatter: два своих ключа, и ни одной чужой строки.
 *
 * **Зона вторая из трёх.** Плагину принадлежат ровно два ключа —
 * `beresta-book-id` (всегда список) и `beresta-last-sync`. Всё остальное в
 * блоке — человека: `tags: 📖` одиночным значением без списка, пустой
 * `aliases:`, `date: 20221025 1047` без кавычек (не дата ISO, а его формат
 * `YYYYMMDD HHMM`), порядок ключей. Ничего из этого не переписывается: правка
 * идёт построчно, чужие строки доезжают байт в байт.
 *
 * **Почему построчно, а не `processFrontMatter`.** Замер задачи 2 (вопрос 4)
 * показал, что штатный `app.fileManager.processFrontMatter` ничего не
 * перетасовывает: холостой вызов оставляет файл побайтово тем же, новый ключ
 * дописывается в конец, `date: 20221025 1047` остаётся без кавычек, `tags: 📖`
 * — скаляром. То есть API годится. Не берём мы его по другой причине: он
 * **сам пишет файл**, а слияние — чистая функция от строки к строке, и запись
 * у неё ровно одна, через `vault.process`. Два вызова на один файл означали бы
 * две записи, два события изменения и две побудки чужой синхронизации
 * хранилища на ровном месте — при том, что правило «байты не изменились — не
 * писать» второй записи не видит вовсе. Поэтому правку frontmatter делает то
 * же слияние и в тех же байтах, а замер задачи 2 остаётся тем, что нам
 * рассказало, какие формы обязаны пережить.
 *
 * Дописывание новых ключей **в конец блока** — оттуда же: так делает
 * `processFrontMatter`, и совпадение поведения значит, что заметку можно
 * править обоими способами вперемешку, не получая разных байтов.
 */

/** Имя ключа со списком идентификаторов книг. Список — всегда, даже из одной. */
export const BOOK_ID_KEY = "beresta-book-id";

/** Имя ключа с отметкой о том, на какой момент данные в этой заметке. */
export const LAST_SYNC_KEY = "beresta-last-sync";

/** Черта, ограничивающая блок frontmatter. */
const FENCE = /^---[\t \r]*$/;

/** Строка ключа верхнего уровня: без отступа, до первого двоеточия. */
const TOP_KEY = /^([^\s:#][^:]*):(.*)$/;

/** Строка-продолжение значения: отступ или элемент списка. */
const CONTINUATION = /^([\t ]+\S|-[\t ])/;

/** Блок frontmatter и тело заметки — раздельно. */
export interface FrontmatterSplit {
  /** Строки блока вместе с обеими чертами. `undefined` — блока нет вовсе. */
  readonly frontmatter: string[] | undefined;
  /** Всё остальное. */
  readonly body: string[];
}

/**
 * Делит заметку на блок frontmatter и тело.
 *
 * Блок считается блоком, только если файл начинается чертой и вторая черта
 * нашлась. Иначе это просто текст, начинающийся с черты, — и трогать его
 * нельзя: у владельца черта посреди заметки — привычный разделитель.
 */
export function splitFrontmatter(lines: readonly string[]): FrontmatterSplit {
  if (lines.length === 0 || !FENCE.test(lines[0] ?? "")) {
    return { frontmatter: undefined, body: [...lines] };
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (FENCE.test(lines[index] ?? "")) {
      return { frontmatter: lines.slice(0, index + 1), body: lines.slice(index + 1) };
    }
  }
  return { frontmatter: undefined, body: [...lines] };
}

/**
 * Идентификаторы книг, привязанных к заметке.
 *
 * Читает все три вида записи, потому что все три встречаются в живом
 * хранилище: блочный список (`- значение` на своих строках), список в
 * квадратных скобках и одиночное значение без списка. Последнее — не наша
 * запись, но человек вправе написать так руками, и понимать его надо.
 */
export function readBookIds(text: string): string[] {
  const { frontmatter } = splitFrontmatter(text.split("\n"));
  if (frontmatter === undefined) return [];
  const found = findKey(frontmatter, BOOK_ID_KEY);
  if (found === undefined) return [];
  return readValues(frontmatter, found);
}

/** Значение одиночного ключа — или `undefined`, если ключа нет. */
export function readScalar(text: string, key: string): string | undefined {
  const { frontmatter } = splitFrontmatter(text.split("\n"));
  if (frontmatter === undefined) return undefined;
  const found = findKey(frontmatter, key);
  if (found === undefined) return undefined;
  const values = readValues(frontmatter, found);
  return values[0];
}

/** Что положить в frontmatter этим проходом. Пустое поле — не трогать ключ. */
export interface FrontmatterPatch {
  readonly bookIds?: readonly string[];
  readonly lastSync?: string;
}

/**
 * Кладёт наши ключи в блок, оставляя чужие строки нетронутыми.
 *
 * Существующий ключ переписывается **на своём месте** (порядок цел), новый
 * дописывается перед закрывающей чертой. Блока не было вовсе — заводится
 * сверху, тело не двигается.
 */
export function applyFrontmatter(
  lines: readonly string[],
  patch: FrontmatterPatch,
): string[] {
  const entries: { key: string; value: string[] }[] = [];
  if (patch.bookIds !== undefined && patch.bookIds.length > 0) {
    entries.push({ key: BOOK_ID_KEY, value: listLines(BOOK_ID_KEY, patch.bookIds) });
  }
  if (patch.lastSync !== undefined && patch.lastSync !== "") {
    entries.push({ key: LAST_SYNC_KEY, value: [`${LAST_SYNC_KEY}: ${scalar(patch.lastSync)}`] });
  }
  if (entries.length === 0) return [...lines];

  const split = splitFrontmatter(lines);
  let block = split.frontmatter === undefined ? ["---", "---"] : [...split.frontmatter];
  for (const entry of entries) {
    block = putKey(block, entry.key, entry.value);
  }
  return [...block, ...split.body];
}

// MARK: - Внутреннее

interface KeyRange {
  /** Строка самого ключа. */
  readonly start: number;
  /** Первая строка ЗА значением. */
  readonly end: number;
  /** То, что стояло в той же строке после двоеточия. */
  readonly inline: string;
}

function findKey(block: readonly string[], key: string): KeyRange | undefined {
  for (let index = 1; index < block.length - 1; index += 1) {
    const match = TOP_KEY.exec(block[index] ?? "");
    if (match === null) continue;
    if (match[1] !== key) continue;
    let end = index + 1;
    while (end < block.length - 1 && CONTINUATION.test(block[end] ?? "")) end += 1;
    return { start: index, end, inline: (match[2] ?? "").trim() };
  }
  return undefined;
}

function readValues(block: readonly string[], range: KeyRange): string[] {
  if (range.inline.startsWith("[")) {
    return range.inline
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .map((item) => unquote(item.trim()))
      .filter((item) => item !== "");
  }
  if (range.inline !== "") return [unquote(range.inline)];
  const values: string[] = [];
  for (let index = range.start + 1; index < range.end; index += 1) {
    const line = (block[index] ?? "").trim();
    if (line.startsWith("- ")) values.push(unquote(line.slice(2).trim()));
  }
  return values;
}

function putKey(block: readonly string[], key: string, value: readonly string[]): string[] {
  const found = findKey(block, key);
  if (found !== undefined) {
    return [...block.slice(0, found.start), ...value, ...block.slice(found.end)];
  }
  const closing = block.length - 1;
  return [...block.slice(0, closing), ...value, ...block.slice(closing)];
}

function listLines(key: string, values: readonly string[]): string[] {
  return [`${key}:`, ...values.map((value) => `  - ${scalar(value)}`)];
}

/**
 * Значение как есть — или в кавычках, если как есть его прочтут неверно.
 *
 * Кавычки ставятся ровно там, где без них YAML прочтёт другое: двоеточие с
 * пробелом, решётка, ведущий знак разметки, краевые пробелы. `20260806 2114` и
 * `9504E37E-…` в кавычках не нуждаются, и получать их в кавычках человек не
 * должен — рядом лежит его собственный `date: 20221025 1047` без кавычек.
 */
function scalar(value: string): string {
  const plain =
    value !== "" &&
    value === value.trim() &&
    !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) &&
    !/:\s/.test(value) &&
    !/\s#/.test(value) &&
    !value.endsWith(":");
  return plain ? value : JSON.stringify(value);
}

function unquote(value: string): string {
  if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
    const quote = value[0]!;
    if (value.endsWith(quote)) return value.slice(1, -1);
  }
  return value;
}
