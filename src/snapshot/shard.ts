import {
  SnapshotUnreadable,
  type JsonValue,
  type SnapshotAnnotation,
  type SnapshotSelector,
  type SnapshotTombstone,
  type UnknownKeys,
} from "./model";

/**
 * Разбор одного осколка — собрания выписок одной книги (W3C Web Annotation,
 * JSON-LD).
 *
 * **Разбор терпим к отсутствию и нетерпим к вранью.** Отсутствие полей
 * миграции v32+ (`beresta:chapterPath`, `beresta:intent`, `beresta:topic`,
 * метки) — норма, а не ошибка: у владельца их физически нет, и у первого
 * человека с чужим импортом их тоже не будет. А вот документ, который не
 * объект, или страница, у которой `items` не массив, — это не «мало данных»,
 * это не наш файл, и делать вид, что мы его поняли, нельзя.
 */

/** Что вышло из одного осколка. */
export interface ParsedShard {
  /** `uuid` книги из `beresta:book`. Пусто — книга снимку неизвестна. */
  bookUUID: string | undefined;
  title: string | undefined;
  authors: string[];
  /**
   * Адрес первоисточника. Есть у статей и нет у книг: у статьи нет года
   * издания, а часть их вовсе без автора, и адрес — единственное, чем цитата
   * из статьи перестаёт быть цитатой ниоткуда.
   */
  source: string | undefined;
  /** Живых выписок по самому осколку — сверяется с числом из указателя. */
  total: number | undefined;
  generated: string | undefined;
  annotations: SnapshotAnnotation[];
  tombstones: SnapshotTombstone[];
  unknown: UnknownKeys;
}

/** Ключи собрания, которые мы знаем; всё прочее уезжает в `unknown`. */
const COLLECTION_KEYS = [
  "@context",
  "id",
  "type",
  "label",
  "total",
  "first",
  "last",
  "generated",
  "beresta:book",
  "beresta:removed",
];

const BOOK_KEYS = ["id", "type", "label", "beresta:authors", "beresta:sourceURL"];

const ITEM_KEYS = [
  "id",
  "type",
  "motivation",
  "created",
  "modified",
  "body",
  "target",
  "beresta:type",
  "beresta:color",
  "beresta:style",
  "beresta:colorHex",
  "beresta:sortIndex",
  "beresta:pageLabel",
  "beresta:chapterPath",
  "beresta:intent",
  "beresta:processed",
  "beresta:topic",
  "beresta:text",
  "beresta:position",
];

const TOMBSTONE_KEYS = ["id", "beresta:deletedAt"];

export function parseShard(text: string, where: string): ParsedShard {
  const document = asObject(parseJSON(text, where), `${where}: собрание`);

  const bookNode = optionalObject(document["beresta:book"], `${where}: книга`);
  const page = optionalObject(document["first"], `${where}: страница`);

  const items = page === undefined ? [] : asArray(page["items"] ?? [], `${where}: items`);
  const bookUUID = bookNode === undefined ? undefined : uuidOf(bookNode["id"]);

  const annotations = items.map((item, at) =>
    parseItem(asObject(item, `${where}: выписка ${at}`), bookUUID, `${where}: выписка ${at}`),
  );

  const removed = asArray(document["beresta:removed"] ?? [], `${where}: beresta:removed`);
  const tombstones = removed.map((entry, at) =>
    parseTombstone(asObject(entry, `${where}: надгробие ${at}`)),
  );

  return {
    bookUUID,
    title: optionalString(document["label"]),
    authors:
      bookNode === undefined
        ? []
        : asArray(bookNode["beresta:authors"] ?? [], `${where}: авторы`).flatMap((name) => {
            const value = optionalString(name);
            return value === undefined ? [] : [value];
          }),
    source: bookNode === undefined ? undefined : optionalString(bookNode["beresta:sourceURL"]),
    total: optionalNumber(document["total"]),
    generated: optionalString(document["generated"]),
    annotations,
    tombstones,
    // Незнакомое собрания и незнакомое книги складываются в одну связку:
    // разделять их было бы честнее, но пользоваться этим различием некому, а
    // два поля вместо одного пришлось бы протаскивать через всю модель.
    unknown: {
      ...leftovers(document, COLLECTION_KEYS),
      ...(bookNode === undefined ? {} : leftovers(bookNode, BOOK_KEYS)),
    },
  };
}

function parseItem(
  item: Record<string, JsonValue>,
  bookUUID: string | undefined,
  where: string,
): SnapshotAnnotation {
  const target = optionalObject(item["target"], `${where}: мишень`);
  const rawSelectors =
    target === undefined ? [] : asArray(target["selector"] ?? [], `${where}: селекторы`);
  const selectors = rawSelectors.map((selector, at) =>
    parseSelector(asObject(selector, `${where}: селектор ${at}`)),
  );

  const bodies = parseBodies(item["body"], where);
  const strandedText = optionalString(item["beresta:text"]);
  const quoteSelector = selectors.find((selector) => selector.kind === "quote");
  const fragment = selectors.find((selector) => selector.kind === "fragment");

  const id = requireString(item["id"], `${where}: id`);
  return {
    id,
    uuid: uuidOf(item["id"]),
    // Мишень называет источником книгу, но у осколка сирот источник —
    // детерминированная заглушка «книга неизвестна», а не книга. Поэтому
    // принадлежность берётся из `beresta:book` осколка, а не из мишени: там
    // она про адрес, а не про то, в чьей заметке место этой выписке.
    bookUUID,
    motivation: requireString(item["motivation"], `${where}: motivation`),
    markKind: optionalString(item["beresta:type"]),
    created: requireString(item["created"], `${where}: created`),
    modified: requireString(item["modified"], `${where}: modified`),
    comment: bodies.comment,
    commentFormat: bodies.commentFormat,
    tags: bodies.tags,
    selectors,
    quote: quoteSelector?.kind === "quote" ? quoteSelector.exact : strandedText,
    strandedText,
    cfi: fragment?.kind === "fragment" ? fragment.value : undefined,
    color: optionalString(item["beresta:color"]),
    colorHex: optionalString(item["beresta:colorHex"]),
    sortIndex: optionalString(item["beresta:sortIndex"]),
    pageLabel: optionalString(item["beresta:pageLabel"]),
    chapterPath: asArray(item["beresta:chapterPath"] ?? [], `${where}: chapterPath`).flatMap(
      (part) => {
        const value = optionalString(part);
        return value === undefined ? [] : [value];
      },
    ),
    intent: optionalString(item["beresta:intent"]),
    processed: optionalString(item["beresta:processed"]),
    topic: optionalString(item["beresta:topic"]),
    position: optionalString(item["beresta:position"]),
    unknown: leftovers(item, ITEM_KEYS),
  };
}

/**
 * Тела выписки: своя мысль (`commenting`) и метки (`tagging`).
 *
 * Одно тело стандарт разрешает писать объектом, несколько — массивом, и Swift
 * пишет ровно так (примеры 5 и 15 стандарта). Разбор обязан понимать оба вида:
 * у 264 выписок владельца из 287 тела нет вовсе, у остальных оно одно, а
 * массив появляется только там, где есть метки, — то есть на данных владельца
 * ни разу. Ветка, которую живая библиотека не покрывает, покрыта образцом.
 */
function parseBodies(
  raw: JsonValue | undefined,
  where: string,
): { comment: string | undefined; commentFormat: string | undefined; tags: string[] } {
  if (raw === undefined || raw === null) {
    return { comment: undefined, commentFormat: undefined, tags: [] };
  }
  const list = Array.isArray(raw) ? raw : [raw];
  let comment: string | undefined;
  let commentFormat: string | undefined;
  const tags: string[] = [];
  for (const [at, entry] of list.entries()) {
    const body = asObject(entry, `${where}: тело ${at}`);
    const purpose = optionalString(body["purpose"]);
    const value = optionalString(body["value"]);
    if (value === undefined) continue;
    if (purpose === "tagging") {
      tags.push(value);
    } else if (comment === undefined) {
      // Назначение `commenting` — то, чем стандарт отвечает на вопрос «зачем
      // тело включено». Тело без назначения тоже считаем мыслью: сторонний
      // писатель вправе его не поставить, а выбросить текст человека из-за
      // отсутствующего ключа нельзя.
      comment = value;
      commentFormat = optionalString(body["format"]);
    }
  }
  return { comment, commentFormat, tags };
}

/**
 * Один селектор.
 *
 * **`raw` держит селектор целиком, а не остаток.** Разобранные поля лежат
 * рядом для удобства, но истиной остаётся то, что лежало в файле: незнакомый
 * селектор доезжает дословно, а знакомый — вместе с полями, которых мы сегодня
 * не читаем (`refinedBy`, `renderedVia` и прочее из словаря W3C). Разбор
 * селектора не имеет права быть местом, где данные человека убывают.
 */
function parseSelector(selector: Record<string, JsonValue>): SnapshotSelector {
  const raw = { ...selector };
  const kind = optionalString(selector["type"]);
  if (kind === "FragmentSelector") {
    const value = optionalString(selector["value"]);
    const conformsTo = optionalString(selector["conformsTo"]);
    if (value !== undefined) {
      return conformsTo === undefined
        ? { kind: "fragment", value, raw }
        : { kind: "fragment", value, conformsTo, raw };
    }
  }
  if (kind === "TextQuoteSelector") {
    const exact = optionalString(selector["exact"]);
    if (exact !== undefined) {
      return {
        kind: "quote",
        // Пустой контекст Swift не пишет вовсе: он ничего не уточняет и
        // засоряет формат. Отсутствие — пустая строка, а не «нет данных».
        prefix: optionalString(selector["prefix"]) ?? "",
        exact,
        suffix: optionalString(selector["suffix"]) ?? "",
        raw,
      };
    }
  }
  return { kind: "unknown", raw };
}

function parseTombstone(entry: Record<string, JsonValue>): SnapshotTombstone {
  return {
    id: optionalString(entry["id"]) ?? "",
    uuid: uuidOf(entry["id"]),
    deletedAt: optionalString(entry["beresta:deletedAt"]),
    unknown: leftovers(entry, TOMBSTONE_KEYS),
  };
}

// MARK: - Мелочи

const URN_UUID = "urn:uuid:";

/**
 * `uuid` из адреса `urn:uuid:…`.
 *
 * Регистр букв НЕ трогаем: в базе приложения `uuid` лежит ровно этой строкой, и
 * приведение к нижнему регистру развело бы адрес в заметке с адресом в базе —
 * молча, потому что оба остались бы валидными.
 */
export function uuidOf(raw: JsonValue | undefined): string | undefined {
  const value = optionalString(raw);
  if (value === undefined || !value.startsWith(URN_UUID)) return undefined;
  const uuid = value.slice(URN_UUID.length);
  return uuid === "" ? undefined : uuid;
}

/** Ключи объекта, которых нет в списке знакомых. */
export function leftovers(
  object: Record<string, JsonValue>,
  known: readonly string[],
): UnknownKeys {
  const rest: UnknownKeys = {};
  for (const key of Object.keys(object)) {
    if (known.includes(key)) continue;
    const value = object[key];
    if (value !== undefined) rest[key] = value;
  }
  return rest;
}

export function parseJSON(text: string, where: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch (error) {
    throw new SnapshotUnreadable(
      `${where}: файл не разбирается как JSON (${(error as Error).message})`,
    );
  }
}

export function asObject(value: JsonValue | undefined, where: string): Record<string, JsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SnapshotUnreadable(`${where}: ожидался объект JSON`);
  }
  return value;
}

function optionalObject(
  value: JsonValue | undefined,
  where: string,
): Record<string, JsonValue> | undefined {
  if (value === undefined || value === null) return undefined;
  return asObject(value, where);
}

export function asArray(value: JsonValue, where: string): JsonValue[] {
  if (!Array.isArray(value)) throw new SnapshotUnreadable(`${where}: ожидался массив`);
  return value;
}

export function optionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function optionalNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function requireString(value: JsonValue | undefined, where: string): string {
  const text = optionalString(value);
  if (text === undefined) throw new SnapshotUnreadable(`${where}: нет обязательной строки`);
  return text;
}
