import { describe, expect, test } from "vitest";

import { readBookIds, splitFrontmatter } from "../src/merge/frontmatter";
import { merge, type KnownSection, type MergeResult } from "../src/merge/merge";
import { splitFile } from "../src/merge/zones";
import { SECTION_BEGIN, SECTION_END, anchorFor, renderBookBody, renderSection, wrapSection } from "../src/render/section";
import type { SnapshotAnnotation, SnapshotBook } from "../src/snapshot/model";

/**
 * Слияние трёх зон.
 *
 * **Почему всё проверяется здесь, а не на живом Obsidian.** Слияние — самая
 * опасная часть замысла: оно единственное, что трогает файл, который человек
 * писал руками четыре года. Поэтому оно сделано чистой функцией от строки к
 * строке, и поэтому весь её разбор помещается в обычный набор тестов: ни
 * файловой системы, ни `vault`, ни приложения. Что нельзя проверить так —
 * живёт в другом месте: как это выглядит в отрисованном виде (замер задачи 2),
 * как ложится в НАСТОЯЩИЕ заметки владельца (шов задачи 13).
 *
 * **Образцы порождает отрисовка задачи 10, а не машинопись.** `rendered` во
 * всех проверках — вывод настоящего `renderSection`, а не строка, набранная
 * руками под ожидание. Иначе слияние проверялось бы против выдуманного текста,
 * и первое же изменение шаблона разошлось бы с жизнью молча.
 *
 * **`known` берётся из прошлого прохода слияния, а не собирается тестом.**
 * Плагин помнит хеши того, что он записал последним, — и в жизни эта память
 * приходит ровно оттуда, из предыдущего `merge`. Тест, собирающий хеши сам,
 * проверял бы согласие функции с собой, а не круг «записали → запомнили →
 * встретили снова».
 */

/** Сдвиг владельца, UTC+5 (Караганда), — чтобы даты в образцах не плыли. */
const OFFSET = { timeZoneOffsetMinutes: 300 };

/** Память пуста: этой заметки плагин ещё не касался. */
const NOTHING_KNOWN: KnownSection = { blocks: {} };

const BOOK: SnapshotBook = {
  uuid: "9504E37E-2CE3-5AD4-81F9-35414188FAC9",
  title: "Джедайские техники",
  authors: ["Максим Дорофеев"],
  source: undefined,
  shard: "9504E37E-2CE3-5AD4-81F9-35414188FAC9.jsonld",
  total: 0,
  removedTotal: 0,
  updatedAt: "2026-08-06T07:06:40Z",
  sha256: "0".repeat(64),
  annotations: [],
  tombstones: [],
  unknown: {},
};

const SECOND_BOOK: SnapshotBook = {
  ...BOOK,
  uuid: "1D0E4A91-2CE3-5AD4-81F9-35414188FAC9",
  title: "Путь джедая",
};

function annotation(index: number, quote: string): SnapshotAnnotation {
  const uuid = `AAAAAAAA-0000-0000-0000-${String(index).padStart(12, "0")}`;
  return {
    id: `urn:uuid:${uuid}`,
    uuid,
    bookUUID: BOOK.uuid,
    motivation: "highlighting",
    markKind: "highlight",
    created: "2026-08-06T07:06:40Z",
    modified: "2026-08-06T07:07:40Z",
    comment: undefined,
    commentFormat: undefined,
    tags: [],
    selectors: [],
    quote,
    strandedText: undefined,
    cfi: "epubcfi(/6/8!/4/2/2)",
    color: "blue",
    colorHex: "#4a90d9",
    sortIndex: String(index).padStart(6, "0"),
    pageLabel: undefined,
    chapterPath: [],
    intent: undefined,
    processed: "raw",
    topic: undefined,
    position: undefined,
    unknown: {},
  };
}

/** Три выписки, которыми живёт большинство проверок. */
const A = annotation(1, "Мыслетопливо тратится не на действия, а на решения.");
const B = annotation(2, "Обезьянка любит быстрые и понятные дела.");
const C = annotation(3, "Список задач — не память, а точка опоры.");

function anchor(item: SnapshotAnnotation): string {
  return anchorFor(item);
}

function render(items: readonly SnapshotAnnotation[]): string {
  return renderSection(BOOK, items, undefined, OFFSET);
}

/**
 * Заметка владельца — по его настоящим привычкам.
 *
 * Frontmatter, порядок ключей, `date: 20221025 1047` без кавычек, одиночный
 * `tags: 📖` без списка, пустой `aliases:` — всё это снято с
 * `Base/Библиотека/Джедайские техники.md` (только чтение, замер 20260812).
 * Тело — тоже его: `## <Название>`, поля жирными подписями, вики-ссылка на
 * автора, черта, «Главная идея книги», «Мысль номер N».
 */
const OWNER_NOTE = [
  "---",
  "tags: 📖",
  "aliases:",
  "name: Джедайские техники",
  "date: 20221025 1047",
  "---",
  "## Джедайские техники",
  "",
  "**Оценка** 9/10",
  "**Автор** [[Максим Дорофеев]]",
  "",
  "---",
  "",
  "## Главная идея книги",
  "",
  "Мыслетопливо кончается раньше времени, чем время.",
  "",
  "### Мысль номер 1",
  "",
  "Обезьянка любит быстрые дела, и с этим бесполезно спорить.",
  "",
].join("\n");

/**
 * Текст вне маркеров — собран независимо от кода, который проверяем.
 *
 * Нарочно не через `splitFile`: помощник, вызывающий разбираемую функцию,
 * проверял бы её согласие с собой. Здесь — тупое деление по строкам-маркерам.
 */
function outside(text: string): string {
  const lines = text.split("\n");
  const begin = lines.indexOf(SECTION_BEGIN);
  const end = lines.indexOf(SECTION_END);
  if (begin < 0 || end < 0) return text;
  return [...lines.slice(0, begin), ...lines.slice(end + 1)].join("\n");
}

/** Текст между маркерами. */
function inside(text: string): string {
  const lines = text.split("\n");
  const begin = lines.indexOf(SECTION_BEGIN);
  const end = lines.indexOf(SECTION_END);
  if (begin < 0 || end < 0) return "";
  return lines.slice(begin + 1, end).join("\n");
}

/** Дописать строку человека внутрь блока — так, как это делает человек. */
function withBlockEdited(text: string, anchorName: string, addition: string): string {
  const lines = text.split("\n");
  const at = lines.indexOf(`^${anchorName}`);
  expect(at).toBeGreaterThan(0);
  let last = at - 1;
  while (last > 0 && lines[last]!.trim() === "") last -= 1;
  return [...lines.slice(0, last + 1), addition, ...lines.slice(last + 1)].join("\n");
}

/**
 * Убрать блок целиком — так, как это делает человек: от служебной строки с
 * отпечатком до якоря включительно.
 *
 * Блок начинается сразу за якорем предыдущего — этим он здесь и находится.
 * Первый блок секции помощнику не по силам, и он говорит это вслух, а не режет
 * заодно заголовок.
 */
function withBlockDeleted(text: string, anchorName: string): string {
  const lines = text.split("\n");
  const at = lines.indexOf(`^${anchorName}`);
  expect(at).toBeGreaterThan(0);
  let from = at;
  while (from > 0 && !/^\^hl-/.test(lines[from - 1] ?? "")) from -= 1;
  expect(from, "помощник умеет убирать только блок, у которого есть предыдущий").toBeGreaterThan(0);
  return [...lines.slice(0, from), ...lines.slice(at + 1)].join("\n");
}

/**
 * Текст без служебных строк с отпечатками — то же, что рисует задача 10.
 *
 * Разбор нарочно тупой и свой: помощник, зовущий разбираемый код, проверял бы
 * согласие этого кода с самим собой.
 */
function withoutPrints(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    if (!/^%% beresta:hash \S+ [0-9a-f]+ %%$/.test(lines[at] ?? "")) {
      kept.push(lines[at]!);
      continue;
    }
    // Служебная строка уезжает вместе со своей пустой строкой: иначе «текст
    // без отпечатков» означало бы «текст с их следами».
    if ((lines[at + 1] ?? "").trim() === "") at += 1;
  }
  return kept.join("\n");
}

/** Отпечатки блоков секции: якорь → то, что записано в служебной строке. */
function printsIn(text: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of text.matchAll(/^%% beresta:hash (\S+) ([0-9a-f]+) %%$/gm)) {
    found[match[1]!] = match[2]!;
  }
  return found;
}

/** Первый проход в чистую заметку: и текст, и память для следующих проходов. */
function firstPass(items: readonly SnapshotAnnotation[]): MergeResult {
  return merge(OWNER_NOTE, render(items), NOTHING_KNOWN, { mayCreateSection: true });
}

describe("слияние", () => {
  // Вырежьте ветку «блок тронут — заморозить» — тест обязан упасть.
  test("правка человека внутри секции переживает ресинк", () => {
    const previous = firstPass([A, B, C]);
    const edited = withBlockEdited(previous.text, anchor(B), "> — моя формулировка");

    const { text, conflicts, changed } = merge(edited, render([A, B, C]), previous.known);

    expect(text).toContain("— моя формулировка");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.anchor).toBe(anchor(B));
    expect(conflicts[0]!.kind).toBe("edited");
    expect(changed).toBe(false);
  });

  // Вырежьте сохранение зоны человека — тест обязан упасть.
  test("текст вне маркеров совпадает побайтово", () => {
    const previous = firstPass([A, B]);
    // Секция не в конце: под ней — снова текст человека, как бывает, когда он
    // передвинул её к себе в конспект.
    const ownersNote = `${previous.text}\n### Мысль номер 2\n\nДописано после секции.\n`;
    const first = merge(ownersNote, render([A, B]), previous.known);

    const { text } = merge(first.text, render([A, B, C]), first.known);

    expect(outside(text)).toBe(outside(ownersNote));
    expect(text).not.toBe(ownersNote);
    expect(text).toContain("Дописано после секции.");
  });

  test("слияние дважды даёт тот же результат", () => {
    const previous = firstPass([A, B]);
    const once = merge(previous.text, render([A, B, C]), previous.known);
    const twice = merge(once.text, render([A, B, C]), once.known);

    expect(twice.text).toBe(once.text);
    expect(twice.changed).toBe(false);
  });

  test("удалённый человеком блок не воскресает", () => {
    const previous = firstPass([A, B, C]);
    const pruned = withBlockDeleted(previous.text, anchor(B));
    expect(pruned).not.toContain(anchor(B));

    const first = merge(pruned, render([A, B, C]), previous.known);
    expect(first.text).not.toContain(anchor(B));
    expect(first.deleted).toEqual([anchor(B)]);

    // И на следующем проходе тоже: память об удалении обязана пережить проход.
    const second = merge(first.text, render([A, B, C]), first.known);
    expect(second.text).not.toContain(anchor(B));
  });

  test("маркеры стёрты — секция не воссоздаётся, а спрашивается", () => {
    const previous = firstPass([A, B]);
    const cleaned = OWNER_NOTE;

    const result = merge(cleaned, render([A, B]), previous.known);

    expect(result.refused).toBe("section-missing");
    expect(result.text).toBe(cleaned);
    expect(result.changed).toBe(false);
    expect(result.message ?? "").not.toBe("");
  });

  test("непарные маркеры — отказ по файлу, ни байта не записано", () => {
    const previous = firstPass([A, B]);
    const broken = previous.text.replace(`${SECTION_END}\n`, "");

    const result = merge(broken, render([A, B]), previous.known);

    expect(result.refused).toBe("markers-broken");
    expect(result.text).toBe(broken);
    expect(result.changed).toBe(false);
  });

  test("две пары маркеров — тот же отказ", () => {
    const previous = firstPass([A, B]);
    const doubled = `${previous.text}\n${SECTION_BEGIN}\n${SECTION_END}\n`;

    const result = merge(doubled, render([A, B]), previous.known);

    expect(result.refused).toBe("markers-broken");
    expect(result.text).toBe(doubled);
  });

  test("якорь вне секции — блок не дублируется", () => {
    const previous = firstPass([A, B]);
    // Человек перенёс цитату в свой текст: якорь теперь ВНЕ маркеров.
    const moved = withBlockDeleted(previous.text, anchor(B)).replace(
      "### Мысль номер 1",
      `### Мысль номер 1\n\n> [!quote]+ Джедайские техники\n> ${B.quote}\n\n^${anchor(B)}\n`,
    );

    const result = merge(moved, render([A, B]), previous.known);

    expect(result.withdrawn).toEqual([anchor(B)]);
    expect(inside(result.text)).not.toContain(anchor(B));
    expect(result.text.split(`^${anchor(B)}`)).toHaveLength(2);
  });

  test("байты не изменились — записи не происходит", () => {
    const previous = firstPass([A, B, C]);

    const again = merge(previous.text, render([A, B, C]), previous.known);

    expect(again.text).toBe(previous.text);
    expect(again.changed).toBe(false);
    expect(again.conflicts).toHaveLength(0);
  });

  test("надгробие уносит блок, но не тронутый человеком", () => {
    const previous = firstPass([A, B, C]);
    const edited = withBlockEdited(previous.text, anchor(C), "> — не выбрасывать");

    // В приложении удалены обе выписки, B и C; в заметке C тронута человеком.
    const result = merge(edited, render([A]), previous.known, { allowRemovals: true });

    expect(result.removed).toEqual([anchor(B)]);
    expect(result.text).not.toContain(anchor(B));
    expect(result.text).toContain(anchor(C));
    expect(result.text).toContain("— не выбрасывать");
    expect(result.conflicts.map((item) => item.kind)).toEqual(["gone-in-app"]);
  });

  // Вырежьте предохранитель — тест обязан упасть.
  test("исчезновение четверти блоков останавливает проход", () => {
    const many = Array.from({ length: 81 }, (_, index) => annotation(index + 1, `цитата ${index + 1}`));
    const previous = firstPass(many);

    const result = merge(previous.text, render(many.slice(0, 40)), previous.known);

    expect(result.refused).toBe("too-many-removals");
    expect(result.text).toBe(previous.text);
    expect(result.changed).toBe(false);
    // Отказ обязан показать, что именно собирался убрать.
    expect(result.removed).toHaveLength(41);
  });

  test("предохранитель снимается подтверждением, и тогда блоки уходят", () => {
    const many = Array.from({ length: 81 }, (_, index) => annotation(index + 1, `цитата ${index + 1}`));
    const previous = firstPass(many);

    const result = merge(previous.text, render(many.slice(0, 40)), previous.known, {
      allowRemovals: true,
    });

    expect(result.refused).toBeUndefined();
    expect(result.removed).toHaveLength(41);
    expect(result.changed).toBe(true);
  });

  test("порядок ключей frontmatter и формат даты владельца сохраняются", () => {
    const previous = firstPass([A, B]);

    const result = merge(previous.text, render([A, B, C]), previous.known, {
      frontmatter: { bookIds: [BOOK.uuid], lastSync: "20260806 2114" },
    });

    const front = splitFrontmatter(result.text.split("\n")).frontmatter ?? [];
    // Порядок прежних ключей цел, ни один не переписан; наши дописаны в конец
    // — ровно так, как это делает `processFrontMatter` (замер задачи 2, в. 4).
    expect(front.slice(0, 5)).toEqual([
      "---",
      "tags: 📖",
      "aliases:",
      "name: Джедайские техники",
      "date: 20221025 1047",
    ]);
    expect(front[5]).toBe("beresta-book-id:");
    expect(front[6]).toBe(`  - ${BOOK.uuid}`);
    expect(front[7]).toBe("beresta-last-sync: 20260806 2114");
    expect(front[8]).toBe("---");
    expect(front).toHaveLength(9);
  });

  test("beresta-book-id — список: две книги на одну заметку", () => {
    const previous = firstPass([A]);

    const result = merge(previous.text, render([A]), previous.known, {
      frontmatter: { bookIds: [BOOK.uuid, SECOND_BOOK.uuid] },
    });

    expect(readBookIds(result.text)).toEqual([BOOK.uuid, SECOND_BOOK.uuid]);
    const front = splitFrontmatter(result.text.split("\n")).frontmatter ?? [];
    expect(front).toContain("beresta-book-id:");
    expect(front).toContain(`  - ${BOOK.uuid}`);
    expect(front).toContain(`  - ${SECOND_BOOK.uuid}`);
    // Одна книга — всё равно список: разбор обязан читать оба вида записи.
    expect(readBookIds(`---\nberesta-book-id: ${BOOK.uuid}\n---\n`)).toEqual([BOOK.uuid]);
    expect(readBookIds(`---\nberesta-book-id: [${BOOK.uuid}, ${SECOND_BOOK.uuid}]\n---\n`)).toEqual([
      BOOK.uuid,
      SECOND_BOOK.uuid,
    ]);
  });

  test("нет снимка — не делаем ничего", () => {
    const previous = firstPass([A, B]);

    const result = merge(previous.text, undefined, previous.known, {
      frontmatter: { lastSync: "20260806 2114" },
      mayCreateSection: true,
    });

    expect(result.refused).toBe("no-snapshot");
    expect(result.text).toBe(previous.text);
    expect(result.changed).toBe(false);
  });

  test("изменённая в приложении цитата перерисовывается", () => {
    const previous = firstPass([A, B]);
    const fixed = annotation(2, "Обезьянка любит быстрые дела. Исправленная цитата.");

    const result = merge(previous.text, render([A, fixed]), previous.known);

    expect(result.text).toContain("Исправленная цитата");
    expect(result.text).not.toContain(B.quote);
    expect(result.conflicts).toHaveLength(0);
    expect(result.changed).toBe(true);
    expect(outside(result.text)).toBe(outside(previous.text));
  });

  test("новая выписка встаёт на своё место по порядку, а не в конец", () => {
    const previous = firstPass([A, C]);

    const result = merge(previous.text, render([A, B, C]), previous.known);

    const order = [...result.text.matchAll(/^\^(hl-\S+)$/gm)].map((match) => match[1]);
    expect(order).toEqual([anchor(A), anchor(B), anchor(C)]);
    expect(withoutPrints(inside(result.text))).toBe(inside(render([A, B, C])));
  });

  test("правка человека и изменение в приложении: предупреждение один раз", () => {
    const previous = firstPass([A, B]);
    const edited = withBlockEdited(previous.text, anchor(B), "> — моя формулировка");
    const changedInApp = [A, annotation(2, "Обезьянка любит быстрые дела. Уточнённая цитата.")];

    const first = merge(edited, render(changedInApp), previous.known);

    expect(first.conflicts.map((item) => item.kind)).toEqual(["edited-and-changed"]);
    expect(first.text).toContain("— моя формулировка");
    expect(first.text).toContain("> [!warning]- Beresta");
    expect(first.text).toContain("Уточнённая цитата");
    expect(count(first.text, "> [!warning]- Beresta")).toBe(1);

    // Второй проход теми же данными не добавляет второго предупреждения.
    const second = merge(first.text, render(changedInApp), first.known);
    expect(count(second.text, "> [!warning]- Beresta")).toBe(1);
    expect(second.text).toBe(first.text);
    expect(second.changed).toBe(false);

    // Приложение вернулось к прежнему тексту — предупреждение уходит,
    // правка человека остаётся.
    const third = merge(second.text, render([A, B]), second.known);
    expect(third.text).not.toContain("> [!warning]- Beresta");
    expect(third.text).toContain("— моя формулировка");
  });

  test("блок неизвестного происхождения не переписывается", () => {
    // Заметку писала сборка до 20260901: служебных строк с отпечатками в ней
    // нет. Память плагина при этом потеряна — переустановка, другой Мак, сброс
    // `data.json`. Спросить больше некого, и блок не трогается.
    const previous = firstPass([A, B]);
    const older = withoutPrints(previous.text);

    const result = merge(older, render([A, annotation(2, "Другая цитата")]), NOTHING_KNOWN);

    expect(result.text).toBe(older);
    expect(result.changed).toBe(false);
    expect(result.conflicts.map((item) => item.kind)).toEqual([
      "unknown-origin",
      "unknown-origin",
    ]);
  });

  // Вырежьте запрет воссоздавать секцию — тест обязан упасть.
  test("по команде секция создаётся в конце, байты человека — префикс", () => {
    const result = merge(OWNER_NOTE, render([A, B]), NOTHING_KNOWN, { mayCreateSection: true });

    expect(result.refused).toBeUndefined();
    expect(result.changed).toBe(true);
    expect(result.text.startsWith(OWNER_NOTE)).toBe(true);
    expect(withoutPrints(inside(result.text))).toBe(inside(render([A, B])));
    expect(Object.keys(result.known.blocks)).toEqual([anchor(A), anchor(B)]);
  });

  test("по команде секция создаётся заново, но унесённая цитата не возвращается", () => {
    const previous = firstPass([A, B]);
    // Человек унёс одну цитату к себе в текст и стёр секцию целиком.
    const lines = previous.text.split("\n");
    const begin = lines.indexOf(SECTION_BEGIN);
    const end = lines.indexOf(SECTION_END);
    const cleaned = [
      ...lines.slice(0, begin),
      "### Мысль номер 2",
      "",
      "> [!quote]+ Джедайские техники",
      `> ${B.quote}`,
      "",
      `^${anchor(B)}`,
      ...lines.slice(end + 1),
    ].join("\n");

    const result = merge(cleaned, render([A, B]), previous.known, { mayCreateSection: true });

    expect(result.refused).toBeUndefined();
    expect(result.withdrawn).toEqual([anchor(B)]);
    expect(count(result.text, `^${anchor(B)}`)).toBe(1);
    expect(inside(result.text)).toContain(anchor(A));
    expect(inside(result.text)).not.toContain(anchor(B));
    expect(Object.keys(result.known.blocks)).toEqual([anchor(A)]);
  });

  test("заголовок секции, переписанный человеком, переживает проход", () => {
    const previous = firstPass([A, B]);
    const renamed = previous.text.replace("## Выписки из Beresta", "## Цитаты (мои пометки ниже)");

    const result = merge(renamed, render([A, B, C]), previous.known);

    expect(result.text).toContain("## Цитаты (мои пометки ниже)");
    expect(result.text).not.toContain("## Выписки из Beresta");
    expect(result.conflicts.map((item) => item.kind)).toEqual(["head"]);
    expect(result.text).toContain(anchor(C));
  });

  test("текст человека внутри маркеров после последнего якоря сохраняется", () => {
    const previous = firstPass([A, B]);
    const withTail = previous.text.replace(
      `\n${SECTION_END}`,
      `\n\nЭто мой хвост внутри секции.\n${SECTION_END}`,
    );

    const result = merge(withTail, render([A, B, C]), previous.known);

    expect(result.text).toContain("Это мой хвост внутри секции.");
    expect(result.text).toContain(anchor(C));
    expect(result.text.indexOf(anchor(C))).toBeLessThan(result.text.indexOf("Это мой хвост"));
  });

  test("пустой снимок стирает секцию только с подтверждением", () => {
    const previous = firstPass([A, B, C]);

    const refused = merge(previous.text, wrapSection([]), previous.known);
    expect(refused.refused).toBe("too-many-removals");
    expect(refused.text).toBe(previous.text);

    const allowed = merge(previous.text, wrapSection([]), previous.known, { allowRemovals: true });
    expect(inside(allowed.text)).toBe("");
    expect(outside(allowed.text)).toBe(outside(previous.text));
  });

  test("отказ не трогает frontmatter", () => {
    const previous = firstPass([A, B]);
    const broken = previous.text.replace(`${SECTION_END}\n`, "");

    const result = merge(broken, render([A, B]), previous.known, {
      frontmatter: { bookIds: [BOOK.uuid], lastSync: "20260806 2114" },
    });

    expect(result.text).toBe(broken);
    expect(result.text).not.toContain("beresta-book-id");
  });

  test("отметка о времени ставится только когда секция изменилась", () => {
    const previous = firstPass([A, B]);

    const idle = merge(previous.text, render([A, B]), previous.known, {
      frontmatter: { lastSync: "20260806 2114" },
    });
    expect(idle.text).toBe(previous.text);
    expect(idle.text).not.toContain("beresta-last-sync");

    const busy = merge(previous.text, render([A, B, C]), previous.known, {
      frontmatter: { lastSync: "20260806 2114" },
    });
    expect(busy.text).toContain("beresta-last-sync: 20260806 2114");
  });

  test("заметка без frontmatter получает блок сверху, тело цело", () => {
    const bare = "## Джедайские техники\n\nМоя мысль.\n";
    const created = merge(bare, render([A]), NOTHING_KNOWN, {
      mayCreateSection: true,
      frontmatter: { bookIds: [BOOK.uuid] },
    });

    expect(created.text.startsWith("---\nberesta-book-id:\n  - " + BOOK.uuid + "\n---\n")).toBe(true);
    expect(created.text).toContain("## Джедайские техники\n\nМоя мысль.\n");
  });

  test("две книги в одной секции: блоки обеих на месте", () => {
    const second = { ...annotation(9, "Джедай не спорит с обезьянкой."), bookUUID: SECOND_BOOK.uuid };
    const rendered = wrapSection([
      renderBookBody(BOOK, [A], undefined, OFFSET),
      renderBookBody(SECOND_BOOK, [second], undefined, OFFSET),
    ]);
    const created = merge(OWNER_NOTE, rendered, NOTHING_KNOWN, { mayCreateSection: true });

    expect(withoutPrints(inside(created.text))).toBe(inside(rendered));
    const again = merge(created.text, rendered, created.known);
    expect(again.text).toBe(created.text);
    expect(again.changed).toBe(false);
  });

  test("разбор зон возвращает файл байт в байт", () => {
    const previous = firstPass([A, B]);
    const split = splitFile(previous.text);

    expect(split.kind).toBe("section");
    if (split.kind !== "section") throw new Error("не секция");
    expect(split.assemble(split.innerLines)).toBe(previous.text);
    // И с чужим отступом у маркера — тоже: строку маркера мы не переписываем.
    const indented = previous.text.replace(SECTION_BEGIN, `  ${SECTION_BEGIN}`);
    const other = splitFile(indented);
    if (other.kind !== "section") throw new Error("не секция");
    expect(other.assemble(other.innerLines)).toBe(indented);
  });
});

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/**
 * Владение блоком, записанное в самой заметке.
 *
 * **Что здесь чинится.** До 20260901 «этот блок писали мы» жило только в
 * `data.json`, по ПУТИ заметки. Переименуй заметку, переустанови плагин, открой
 * хранилище на втором Маке — и памяти нет: слияние идёт в ветку
 * `unknown-origin` и НЕ ТРОГАЕТ блоки больше никогда. Заметка замерзает молча и
 * навсегда, а восстановления не предусмотрено ничем.
 *
 * Два адреса из трёх и так живут в файле — привязка книги во frontmatter и
 * якорь блока. Третьим туда переезжает отпечаток: служебная строка
 * `%% beresta:hash hl-… 1a2b… %%` перед текстом блока. `data.json` остаётся
 * вторым эшелоном — для заметок, записанных прежними сборками.
 *
 * **Проверки здесь смотрят в обе стороны сразу.** Отпечаток обязан не только
 * возвращать владение, но и НЕ выдавать за наш блок, который человек правил:
 * правило, ошибающееся в эту сторону, переписывает его текст поверх — то
 * единственное, чего вся эта машинерия и не должна делать.
 */
describe("владение блоками: отпечаток живёт в заметке", () => {
  // Вырежьте служебную строку из записи — тест обязан упасть.
  test("у каждого блока в заметке свой отпечаток", () => {
    const previous = firstPass([A, B, C]);

    const prints = printsIn(previous.text);
    expect(Object.keys(prints).sort()).toEqual([anchor(A), anchor(B), anchor(C)].sort());
    // Разные блоки — разные отпечатки: одинаковые значили бы, что отпечаток
    // считается не от текста блока.
    expect(new Set(Object.values(prints)).size).toBe(3);
    // И ничего, кроме служебных строк, в секцию не добавилось.
    expect(withoutPrints(inside(previous.text))).toBe(inside(render([A, B, C])));
  });

  // Вырежьте чтение отпечатка из заметки — тест обязан упасть.
  test("память потеряна, а заметка помнит: блок перерисовывается", () => {
    const previous = firstPass([A, B]);
    const fixed = annotation(2, "Обезьянка любит быстрые дела. Исправленная цитата.");

    // Так выглядит и переименование заметки (память лежит по прежнему пути), и
    // переустановка плагина, и второй Мак: `data.json` про эту заметку не знает
    // ничего, а сама заметка — знает.
    const result = merge(previous.text, render([A, fixed]), NOTHING_KNOWN);

    expect(result.text).toContain("Исправленная цитата");
    expect(result.text).not.toContain(B.quote);
    expect(result.conflicts).toEqual([]);
    expect(outside(result.text)).toBe(outside(previous.text));
  });

  test("правка человека узнаётся по отпечатку и без всякой памяти", () => {
    const previous = firstPass([A, B]);
    const edited = withBlockEdited(previous.text, anchor(B), "> — моя формулировка");

    const result = merge(edited, render([A, B]), NOTHING_KNOWN);

    // Не `unknown-origin`: отпечаток при блоке говорит, что писали его мы, и
    // говорит же, что с тех пор текст изменился. Это правка, и она названа.
    expect(result.conflicts.map((one) => one.kind)).toEqual(["edited"]);
    expect(result.text).toBe(edited);
    expect(result.changed).toBe(false);
  });

  test("правка и изменение в приложении: предупреждение приходит и без памяти", () => {
    const previous = firstPass([A, B]);
    const edited = withBlockEdited(previous.text, anchor(B), "> — моя формулировка");
    const changedInApp = [A, annotation(2, "Обезьянка любит быстрые дела. Уточнённая цитата.")];

    const result = merge(edited, render(changedInApp), NOTHING_KNOWN);

    expect(result.conflicts.map((one) => one.kind)).toEqual(["edited-and-changed"]);
    expect(result.text).toContain("— моя формулировка");
    expect(count(result.text, "> [!warning]- Beresta")).toBe(1);
    // Служебная строка при этом на месте и не задвоилась: иначе следующий
    // проход не узнал бы блок вовсе.
    expect(count(result.text, `%% beresta:hash ${anchor(B)}`)).toBe(1);
  });

  /**
   * Отпечаток не отпечатывает сам себя.
   *
   * Войди служебная строка в то, что она же и считает, — каждый проход менял бы
   * её, а с ней и байты заметки. «Три прохода подряд не меняют ни байта»
   * (приёмочный шов 4) перестало бы быть верным по устройству, и чужая
   * синхронизация хранилища будилась бы вечно.
   */
  test("три прохода подряд с пустой памятью не меняют ни байта", () => {
    const first = firstPass([A, B, C]);

    const second = merge(first.text, render([A, B, C]), NOTHING_KNOWN);
    const third = merge(second.text, render([A, B, C]), NOTHING_KNOWN);

    expect(second.text).toBe(first.text);
    expect(second.changed).toBe(false);
    expect(third.text).toBe(first.text);
    expect(third.changed).toBe(false);
  });

  /**
   * Заметка прежней сборки получает отпечатки первой же записью.
   *
   * Это и есть вся миграция: отдельного шага нет, потому что блок, узнанный по
   * `data.json`, записывается заново уже со служебной строкой. Заметка, которую
   * не пришлось трогать вовсе, остаётся без отпечатков — и правильно: писать в
   * файл человека ради своей бухгалтерии не за чем.
   */
  test("блоки прежней сборки узнаются памятью и получают отпечатки", () => {
    const previous = firstPass([A, B]);
    const older = withoutPrints(previous.text);
    expect(printsIn(older)).toEqual({});

    const result = merge(older, render([A, B, C]), previous.known);

    expect(result.conflicts).toEqual([]);
    expect(Object.keys(printsIn(result.text)).sort()).toEqual(
      [anchor(A), anchor(B), anchor(C)].sort(),
    );
    // И следующему проходу память уже не нужна.
    const again = merge(result.text, render([A, B, C]), NOTHING_KNOWN);
    expect(again.text).toBe(result.text);
    expect(again.changed).toBe(false);
  });

  test("человек стёр служебную строку — блок замерзает, а не переписывается", () => {
    const previous = firstPass([A, B]);
    const stripped = withoutPrints(previous.text);

    const result = merge(stripped, render([A, annotation(2, "Другая цитата")]), NOTHING_KNOWN);

    expect(result.text).toBe(stripped);
    expect(result.conflicts.map((one) => one.kind)).toEqual(["unknown-origin", "unknown-origin"]);
  });
});
